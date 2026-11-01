import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInjected } from './api.ts'
import type { RecordValue, Json } from '../types.ts'
import type {
  ReviewSession,
  ReviewPreferences,
  ReportDecision,
  PracticeGoal,
} from '../coaching-types.ts'
import { Training } from './GuidedPanel.tsx'
import { LegacyPanel } from './LegacyPanel.tsx'
import { Icon } from './Icons.tsx'
import { Conversation } from './Conversation.tsx'
import { ReviewSurface, type InspectTarget } from './ReviewSurface.tsx'
import { ReviewInspector } from './ReviewInspector.tsx'
import { isConnectionError, errorMessage, readDraft, writeDraft } from './network.ts'
type Props = PropsRuntime<'main'> & InjectFace<PanelInjected> & PropsLocale<'dotaCoach'>
const rows = (v: Json | undefined): RecordValue[] =>
  Array.isArray(v)
    ? v.filter((r): r is RecordValue => !!r && typeof r === 'object' && !Array.isArray(r))
    : []
const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const dual = (v: string, en: boolean) => (en ? v.split(' / ').at(-1)! : v.split(' / ')[0]!)
const image = (npc: string) =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${npc.replace('npc_dota_hero_', '')}.png`
const defaults: ReviewPreferences = {
  focus: [],
  style: 'balanced',
  detail: 'detailed',
  intention: '',
}
const focusOptions = [
  ['laning', '对线细节', 'Laning'],
  ['farm', '发育转线', 'Economy'],
  ['fight', '团战处理', 'Teamfights'],
  ['items', '出装时机', 'Items'],
  ['objectives', '地图目标', 'Objectives'],
  ['support', '辅助职责', 'Support'],
] as const
class RenderBoundary extends Component<
  { children: ReactNode; en: boolean },
  { error: boolean; revision: number }
> {
  state = { error: false, revision: 0 }
  static getDerivedStateFromError() {
    return { error: true }
  }
  render() {
    if (this.state.error)
      return (
        <section className="dc-app dc-render-error" role="alert">
          <Icon name="refresh" />
          <h2>{this.props.en ? 'This view could not be displayed.' : '此视图暂时无法显示'}</h2>
          <p>
            {this.props.en
              ? 'Saved progress and local drafts are kept.'
              : '已保存的复盘和本地草稿仍然保留。'}
          </p>
          <button
            onClick={() => this.setState({ error: false, revision: this.state.revision + 1 })}
          >
            {this.props.en ? 'Restore view' : '恢复视图'}
          </button>
        </section>
      )
    return (
      <div key={this.state.revision} className="dc-app-boundary">
        {this.props.children}
      </div>
    )
  }
}
export function Panel(p: Props) {
  return (
    <RenderBoundary en={p.t('title') === 'Dota coach'}>
      <Workbench {...p} />
    </RenderBoundary>
  )
}
function Workbench(p: Props) {
  const en = p.t('title') === 'Dota coach',
    l = (zh: string, english: string) => (en ? english : zh),
    selection = p.useSelection((s) => s)
  const [view, setView] = useState<'review' | 'history' | 'tools'>('review'),
    [session, setSession] = useState<ReviewSession | null>(null)
  const [account, setAccount] = useState(''),
    [match, setMatch] = useState(''),
    [role, setRole] = useState(0),
    [matches, setMatches] = useState<RecordValue[]>([]),
    [history, setHistory] = useState<ReviewSession[]>([]),
    [training, setTraining] = useState<RecordValue[]>([])
  const [prefs, setPrefs] = useState<ReviewPreferences>(() => readDraft('preferences', defaults)),
    [preferencesOpen, setPreferencesOpen] = useState(false),
    [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [offline, setOffline] = useState(false),
    [stageIndex, setStageIndex] = useState(0),
    [inspection, setInspection] = useState<InspectTarget | null>(null),
    [replay, setReplay] = useState<ReportDecision | null>(null),
    [discussionContext, setDiscussionContext] = useState<{
      stage_id?: string
      decision_id?: string
      label: string
    }>({ label: en ? 'Whole match' : '整局' })
  const alive = useRef(true),
    generation = useRef(0),
    current = useRef<ReviewSession | null>(null),
    selected = useRef(-1),
    inflight = useRef(false),
    prefsTouched = useRef(!!readDraft('preferences', null)),
    offlineRef = useRef(false)
  const accept = (s: ReviewSession) => {
    if (!alive.current) return
    current.current = s
    setSession(s)
    setRole(s.role)
  }
  const fail = (e: unknown) => {
    if (!alive.current) return
    setError(errorMessage(e, en))
    const lost = isConnectionError(e)
    setOffline(lost)
    offlineRef.current = lost
  }
  const call = async (a: RecordValue) => {
    const r = await p.call('dota_coach', a)
    if (!r.ok) throw Error(String(r.detail || r.reason || 'Request failed'))
    return r
  }
  const run = async (fn: () => Promise<void>) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
      if (alive.current) {
        setOffline(false)
        offlineRef.current = false
      }
    } catch (e) {
      fail(e)
    } finally {
      inflight.current = false
      if (alive.current) setBusy(false)
    }
  }
  const refresh = async (restore = true) => {
    const token = generation.current
    const [config, list, preferences, goals] = await Promise.all([
      p.settings(),
      call({ action: 'list' }),
      call({ action: 'preferences' }),
      p.call('dota_training', { action: 'list' }),
    ])
    if (!alive.current || token !== generation.current) return
    setAccount(config.accountId ? String(config.accountId) : '')
    setHistory(rows(list.items) as unknown as ReviewSession[])
    setTraining(rows(goals.items))
    if (!prefsTouched.current && preferences.preferences)
      setPrefs(preferences.preferences as unknown as ReviewPreferences)
    const id = current.current?.id || (restore && !selection.matchId ? list.active_id : null)
    if (id) {
      const r = await p.call('dota_coach', { action: 'open', id })
      if (alive.current && token === generation.current) {
        if (r.ok) accept(r.session as unknown as ReviewSession)
        else if (r.reason === 'not_found') {
          current.current = null
          setSession(null)
        } else throw Error(String(r.detail || r.reason))
      }
    }
    setLoading(false)
    setError('')
    setOffline(false)
    offlineRef.current = false
    if (config.accountId)
      try {
        const recent = await p.call('dota_matches', { account: String(config.accountId), limit: 8 })
        if (alive.current && token === generation.current) setMatches(rows(recent.items))
      } catch (e) {
        if (isConnectionError(e)) fail(e)
      }
  }
  useEffect(() => {
    alive.current = true
    void refresh()
      .catch(fail)
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    const retry = setInterval(() => {
      if (offlineRef.current && !inflight.current) void run(() => refresh())
    }, 5000)
    return () => {
      alive.current = false
      generation.current++
      clearInterval(retry)
    }
  }, [])
  useEffect(() => {
    if (!loading && selection.matchId && selected.current !== selection.revision) {
      selected.current = selection.revision
      generation.current++
      current.current = null
      setSession(null)
      setMatch(String(selection.matchId))
      setView('review')
      setReplay(null)
      void begin(selection.matchId)
    }
  }, [selection, loading])
  useEffect(() => {
    if (
      session?.phase !== 'preparing' &&
      session?.presentation?.status !== 'pending' &&
      !session?.discussion?.some((t) => t.status === 'pending')
    )
      return
    let live = true,
      timer: ReturnType<typeof setTimeout>
    const id = session.id,
      token = generation.current
    const poll = async () => {
      try {
        const r = await call({ action: 'get', id })
        if (live && token === generation.current) {
          accept(r.session as unknown as ReviewSession)
          setError('')
          setOffline(false)
          offlineRef.current = false
        }
      } catch (e) {
        if (live) fail(e)
      } finally {
        if (live) timer = setTimeout(poll, offlineRef.current ? 4000 : 1200)
      }
    }
    timer = setTimeout(poll, 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [
    session?.id,
    session?.phase,
    session?.presentation?.status,
    session?.discussion?.some((t) => t.status === 'pending'),
  ])
  useEffect(() => {
    if (
      !session?.report ||
      session.presentation ||
      session.phase === 'preparing' ||
      session.report.stages.some((s) => s.status !== 'ready') ||
      session.report.stages.every((s) => s.ui)
    )
      return
    const id = session.id
    void run(async () => {
      const r = await call({ action: 'presentation', id })
      if (current.current?.id === id) accept(r.session as unknown as ReviewSession)
    })
  }, [session?.id, session?.phase, session?.presentation?.status])
  useEffect(() => {
    setStageIndex(0)
    setInspection(null)
    setReplay(null)
    setDiscussionContext({ label: en ? 'Whole match' : '整局' })
  }, [session?.id])
  useEffect(() => {
    document.getElementById('dc-current-stage')?.scrollIntoView({ block: 'start' })
  }, [stageIndex])
  const updatePrefs = (v: ReviewPreferences) => {
    prefsTouched.current = true
    setPrefs(v)
    writeDraft('preferences', v)
  }
  const home = () => {
    generation.current++
    current.current = null
    setSession(null)
    setView('review')
    setError('')
    setReplay(null)
  }
  const begin = (id: number, slot?: number) =>
    void run(async () => {
      if (!Number.isSafeInteger(id) || id <= 0)
        throw Error(l('请输入有效的比赛 ID 或比赛链接。', 'Enter a valid match ID or match link.'))
      const token = ++generation.current
      await call({ action: 'preferences', preferences: JSON.parse(JSON.stringify(prefs)) })
      const r = await call({
        action: 'start',
        match_id: id,
        account_id: Number(account) || 0,
        locale: en ? 'en' : 'zh',
        format: 'report',
        role,
        preferences: JSON.parse(JSON.stringify(prefs)),
        ...(slot === undefined ? {} : { player_slot: slot }),
        ...(selection.sessionId ? { session_id: selection.sessionId } : {}),
      })
      if (token === generation.current) {
        accept(r.session as unknown as ReviewSession)
        setView('review')
        setMatch(String(id))
        setPreferencesOpen(false)
      }
    })
  const parseMatch = () =>
    Number(match.trim().match(/(?:matches\/)?(\d{6,})(?:[/?#].*)?$/)?.[1] || match.trim())
  const analyze = (useDraft = false) =>
    void run(async () => {
      if (!session) return
      accept(
        (
          await call({
            action: 'report',
            id: session.id,
            ...(useDraft ? { preferences: JSON.parse(JSON.stringify(prefs)) } : {}),
          })
        ).session as unknown as ReviewSession,
      )
      setPreferencesOpen(false)
    })
  const open = (s: ReviewSession) =>
    void run(async () => {
      generation.current++
      accept((await call({ action: 'get', id: s.id })).session as unknown as ReviewSession)
      setView('review')
    })
  const report = session?.report,
    stage = report?.stages[Math.min(stageIndex, report.stages.length - 1)],
    preparing = session?.phase === 'preparing',
    selectedPrefs = report?.preferences
  const reportReady = !!report && !preparing && report.stages.every((s) => s.status === 'ready')
  const askAbout = (stage_id?: string, decision_id?: string, label = l('整局', 'Whole match')) => {
    setDiscussionContext({ stage_id, decision_id, label })
    document
      .getElementById('dc-coach-conversation')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const readable = (v: string) =>
    v
      .replaceAll('razor_plasma_field', l('等离子场', 'Plasma Field'))
      .replaceAll('razor_static_link', l('静电连接', 'Static Link'))
      .replaceAll('razor_eye_of_the_storm', l('风暴之眼', 'Eye of the Storm'))
      .replaceAll('item_magic_wand', l('魔棒', 'Magic Wand'))
      .replaceAll('item_faerie_fire', l('仙灵之火', 'Faerie Fire'))
      .replaceAll('item_black_king_bar', l('黑皇杖', 'Black King Bar'))
      .replaceAll('item_famango', l('芒果', 'Enchanted Mango'))
      .replaceAll('item_power_treads', l('动力鞋', 'Power Treads'))
      .replaceAll('item_tpscroll', l('回城卷轴', 'Town Portal Scroll'))
      .replaceAll('item_guardian_greaves', l('卫士胫甲', 'Guardian Greaves'))
      .replaceAll('item_satanic', l('撒旦之邪力', 'Satanic'))
      .replaceAll('item_lifesteal', l('攻击吸血', 'Attack lifesteal'))
      .replaceAll('item_blink', l('闪烁匕首', 'Blink Dagger'))
      .replaceAll('item_blade_mail', l('刃甲', 'Blade Mail'))
      .replaceAll('item_shivas_guard', l('希瓦的守护', "Shiva's Guard"))
      .replaceAll('dota_unknown', l('来源未明确', 'Unknown source'))
      .replaceAll('雷泽', en ? 'Razor' : '剃刀')
      .replace(
        /npc_dota_hero_([a-z_]+)/g,
        (_, npc: string) =>
          session?.players.find((p) => p.npc === npc)?.hero || npc.replaceAll('_', ' '),
      )
      .replace(
        /npc_dota_(goodguys|badguys)_tower([1-4])_(top|mid|bot)/g,
        (_, team: string, tier: string, lane: string) =>
          en
            ? `${team === 'goodguys' ? 'Radiant' : 'Dire'} ${lane} tier ${tier} tower`
            : `${team === 'goodguys' ? '天辉' : '夜魇'}${({ top: '上', mid: '中', bot: '下' } as Record<string, string>)[lane]}路${tier}塔`,
      )
      .replaceAll('building_kill', l('建筑被摧毁', 'Building destroyed'))
  if (view === 'tools')
    return (
      <div className="dc-secondary">
        <button
          className="dc-return"
          onClick={() => {
            setView('review')
            void run(() => refresh())
          }}
        >
          <Icon name="back" />
          {l('返回整局复盘', 'Back to match review')}
        </button>
        <LegacyPanel {...p} />
      </div>
    )
  return (
    <div className="dc-app" data-testid="coach-workbench">
      <header className="dc-topbar">
        <button
          className="dc-wordmark"
          onClick={home}
          aria-label={l('Dota Coach 首页', 'Dota Coach home')}
        >
          <span className="dc-logo">
            <Icon name="mark" size={27} />
          </span>
          <span>
            DOTA<span className="dc-wordmark-light"> / COACH</span>
          </span>
        </button>
        <nav aria-label={l('主导航', 'Main navigation')}>
          <button
            aria-current={view === 'review' ? 'page' : undefined}
            onClick={() => setView('review')}
          >
            {l('复盘', 'Review')}
          </button>
          <button
            aria-current={view === 'history' ? 'page' : undefined}
            onClick={() => {
              setView('history')
              void run(() => refresh(false))
            }}
          >
            {l('我的练习', 'My practice')}
          </button>
        </nav>
        <div className="dc-top-end">
          <button title={l('资料与高级工具', 'Library & tools')} onClick={() => setView('tools')}>
            <Icon name="book" />
            <span>{l('资料库', 'Library')}</span>
          </button>
          <button aria-expanded={settings} onClick={() => setSettings(!settings)}>
            <Icon name="sliders" />
            <span>{l('设置', 'Settings')}</span>
          </button>
        </div>
      </header>
      {settings && (
        <form
          className="dc-account"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const id = Number(account)
              if (!Number.isSafeInteger(id) || id < 0 || id > 4294967295)
                throw Error(l('请输入有效的账号 ID', 'Enter a valid account ID'))
              await p.settings(id)
              await refresh(false)
              setSettings(false)
            })
          }}
        >
          <label>
            {l('OpenDota 账号 ID', 'OpenDota account ID')}
            <input
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </label>
          <button className="dc-primary" disabled={busy}>
            {l('保存设置', 'Save settings')}
          </button>
          <button type="button" onClick={() => setSettings(false)}>
            {l('取消', 'Cancel')}
          </button>
        </form>
      )}
      {error && (
        <div className="dc-notice" role="alert">
          <Icon name={offline ? 'signal' : 'focus'} />
          <span>{error}</span>
          <button disabled={busy} onClick={() => void run(() => refresh())}>
            <Icon name="refresh" />
            {l('重新连接并恢复', 'Reconnect & restore')}
          </button>
        </div>
      )}
      <main className="dc-main">
        {view === 'history' ? (
          <section className="dc-history">
            <div className="dc-review-section-heading">
              <div>
                <span className="dc-kicker">YOUR PROGRESS</span>
                <h1>{l('把理解，变成习惯。', 'Turn understanding into a habit.')}</h1>
              </div>
              <button onClick={home}>
                {l('复盘新的一局', 'Review another match')}
                <Icon name="arrow" />
              </button>
            </div>
            <div className="dota-workbench dc-training-list">
              {training.length ? (
                training.map((t) => (
                  <Training
                    key={String(t.id)}
                    row={t}
                    en={en}
                    call={p.call}
                    refresh={() => void run(() => refresh(false))}
                  />
                ))
              ) : (
                <p className="dc-review-muted">
                  {l(
                    '复盘后选择一项练习，这里会记录你的进步。',
                    'Choose one practice goal after a review to track it here.',
                  )}
                </p>
              )}
            </div>
            <h2>{l('复盘记录', 'Review history')}</h2>
            <div className="dc-session-list">
              {history.map((s) => (
                <button key={s.id} onClick={() => open(s)}>
                  <span>
                    {s.player?.hero || l('待选择英雄', 'Choose hero')} <small>#{s.match_id}</small>
                  </span>
                  <span>
                    {s.format === 'report'
                      ? l('整局复盘', 'Match report')
                      : l('提问式复盘', 'Guided review')}
                    <Icon name="arrow" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : !session ? (
          <section className="dc-home">
            <div className="dc-home-intro">
              <span className="dc-kicker">
                <span className="dc-live-dot" /> AI REPLAY COACH
              </span>
              <h1>
                {l('看懂这一局。', 'Understand this game.')}
                <br />
                <span>{l('下一局，做得更好。', 'Make the next one better.')}</span>
              </h1>
              <p>
                {l(
                  '从你的实际选择出发，找到更适合你的打法。',
                  'Start with your actual decisions. Find a way to play that fits you.',
                )}
              </p>
            </div>
            <form
              className="dc-match-form"
              onSubmit={(e) => {
                e.preventDefault()
                begin(parseMatch())
              }}
            >
              <Icon name="focus" size={22} />
              <input
                aria-label={l('比赛 ID 或链接', 'Match ID or link')}
                placeholder={l(
                  '输入比赛 / 录像编号，或粘贴比赛链接',
                  'Enter a match / replay ID, or a match link',
                )}
                value={match}
                onChange={(e) => setMatch(e.target.value)}
                autoComplete="off"
              />
              <button className="dc-primary" disabled={busy || offline || loading}>
                {busy ? l('正在连接…', 'Connecting…') : l('开始复盘', 'Review match')}
                <Icon name="arrow" />
              </button>
            </form>
            <div className="dc-home-options">
              <button
                aria-expanded={preferencesOpen}
                onClick={() => setPreferencesOpen(!preferencesOpen)}
              >
                <Icon name="sliders" />
                {l('复盘偏好', 'Review preferences')}
                <span className="dc-count">
                  {prefs.focus.length ? prefs.focus.length : l('全面', 'All')}
                </span>
              </button>
              <span>
                {prefs.detail === 'detailed'
                  ? l('逐阶段详细分析', 'Detailed, phase by phase')
                  : l('重点概览', 'Focused overview')}{' '}
                · {l('使用 DSH 当前模型', 'Uses your DSH model')}
              </span>
            </div>
            {preferencesOpen && (
              <Preferences
                en={en}
                value={prefs}
                update={updatePrefs}
                role={role}
                setRole={setRole}
              />
            )}
            <div className="dc-recent-head">
              <h2>{l('最近的比赛', 'Recent matches')}</h2>
              <span>
                {loading
                  ? l('正在恢复…', 'Restoring…')
                  : account
                    ? l('选择一局，即可开始', 'Pick a game to begin')
                    : l(
                        '在设置中关联账号，可显示最近比赛',
                        'Add your account in Settings to show matches',
                      )}
              </span>
            </div>
            <div className="dc-match-list">
              {matches.slice(0, 6).map((m) => (
                <button
                  key={String(m.match_id)}
                  disabled={busy || offline}
                  onClick={() => begin(Number(m.match_id))}
                >
                  <img src={image(String(m.npc || 'juggernaut'))} alt="" />
                  <span>
                    <strong>{String(m.hero || m.hero_name || 'Dota 2')}</strong>
                    <small>#{String(m.match_id)}</small>
                  </span>
                  <span className="dc-match-result" data-win={m.result === 'win'}>
                    {m.result === 'win'
                      ? l('胜利', 'Won')
                      : m.result === 'loss'
                        ? l('失利', 'Lost')
                        : '—'}
                  </span>
                  <span className="dc-match-kda">{String(m.kda || '—')}</span>
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
            <div className="dc-home-foot">
              <span>
                {l(
                  '以录像为依据，建议有条件，练习有重点。',
                  'Grounded in replays. Conditional advice. Focused practice.',
                )}
              </span>
              <span>
                {l(
                  '一次处理，完整复盘，随时追问。',
                  'One analysis. A complete review. Keep the conversation going.',
                )}
              </span>
            </div>
          </section>
        ) : (
          <section className="dc-review">
            <div className="dc-review-top">
              <button onClick={home}>
                <Icon name="back" />
                {l('其他比赛', 'Other matches')}
              </button>
              <div>
                <button
                  disabled={preparing}
                  aria-expanded={preferencesOpen}
                  onClick={() => {
                    setPreferencesOpen(!preferencesOpen)
                  }}
                >
                  <Icon name="sliders" />
                  {l('调整偏好', 'Preferences')}
                </button>
              </div>
            </div>
            <header className="dc-match-heading">
              {session.player && <img src={image(session.player.npc)} alt={session.player.hero} />}
              <div>
                <span className="dc-kicker">
                  MATCH REVIEW <span>#{session.match_id}</span>
                </span>
                <h1>
                  {session.player?.hero || l('这局你使用了哪位英雄？', 'Which hero did you play?')}
                </h1>
                <p>
                  {session.role
                    ? `${session.role} ${l('号位', 'position')}`
                    : l('位置待确认', 'Role unconfirmed')}{' '}
                  · {l('版本', 'Patch')} {session.patch === 'unknown' ? '—' : session.patch}
                  {report ? ` · ${clock(report.duration)}` : ''}
                  {session.model ? ` · ${session.model}` : ''}
                </p>
              </div>
              {session.player && reportReady && (
                <button className="dc-open-match" onClick={() => setInspection({ mode: 'match' })}>
                  <Icon name="focus" size={15} />
                  {l('对局详情', 'Match details')}
                </button>
              )}
              <span className="dc-report-label">
                <span className="dc-live-dot" />
                {l('AI 教练复盘', 'AI COACH REVIEW')}
              </span>
            </header>
            {preferencesOpen && (
              <div className="dc-preferences-wrap">
                <Preferences
                  en={en}
                  value={prefs}
                  update={updatePrefs}
                  role={role}
                  setRole={setRole}
                />
                <div className="dc-preferences-actions">
                  <p>
                    {l(
                      '应用偏好后会自动更新这份分析，后续问题也可直接问教练。',
                      'Apply preferences to update the analysis automatically, or ask the coach below.',
                    )}
                  </p>
                  <button
                    className="dc-primary"
                    disabled={busy || preparing || offline}
                    onClick={() =>
                      session.role !== role
                        ? begin(session.match_id, session.player?.slot)
                        : analyze(true)
                    }
                  >
                    {l('应用偏好', 'Apply preferences')}
                    <Icon name="arrow" />
                  </button>
                </div>
              </div>
            )}
            {session.stage === 'choose_player' ? (
              <div className="dc-player-picker">
                {session.players.map((player) => (
                  <button
                    key={player.slot}
                    disabled={busy || offline}
                    onClick={() => begin(session.match_id, player.slot)}
                  >
                    <img src={image(player.npc)} alt="" />
                    <span>
                      {player.hero}
                      <small>{player.team === 2 ? l('天辉', 'Radiant') : l('夜魇', 'Dire')}</small>
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                {selectedPrefs && (
                  <div className="dc-applied-preferences">
                    <Icon name="focus" />
                    {(selectedPrefs.focus.length
                      ? focusOptions
                          .filter(([k]) => selectedPrefs.focus.includes(k))
                          .map((v) => (en ? v[2] : v[1]))
                      : [l('全面复盘', 'All phases')]
                    ).join(' · ')}
                    <span>
                      {selectedPrefs.style === 'safe'
                        ? l('稳健优先', 'Safety first')
                        : selectedPrefs.style === 'tempo'
                          ? l('主动节奏', 'Proactive tempo')
                          : l('均衡取舍', 'Balanced tradeoffs')}
                    </span>
                    {selectedPrefs.intention && (
                      <details>
                        <summary>{l('我的补充', 'My context')}</summary>
                        <p>{selectedPrefs.intention}</p>
                      </details>
                    )}
                  </div>
                )}
                {preparing && (
                  <div className="dc-progress" role="status">
                    <span className="dc-spinner" />
                    <div>
                      <strong>
                        {report
                          ? l('逐阶段推敲你的选择', 'Reviewing decisions, phase by phase')
                          : session.stage === 'replay'
                            ? l('正在准备录像', 'Preparing the replay')
                            : l('正在整理比赛证据', 'Collecting match evidence')}
                      </strong>
                      <p>
                        {report
                          ? `${report.stages.filter((s) => s.status === 'ready').length} / ${report.stages.length} ${l('阶段完成，全部完成后自动展示结论', 'phases complete. The full conclusions will open automatically.')}`
                          : l(
                              '正在自动拉取、解析录像并分析；完成后会直接打开完整结论。',
                              'Fetching, parsing and analyzing automatically. The complete report opens when ready.',
                            )}
                      </p>
                    </div>
                    <button
                      disabled={busy || offline}
                      onClick={() =>
                        void run(async () =>
                          accept(
                            (await call({ action: 'cancel', id: session.id }))
                              .session as unknown as ReviewSession,
                          ),
                        )
                      }
                    >
                      {l('暂停', 'Pause')}
                    </button>
                  </div>
                )}
                {(session.error || session.phase === 'cancelled' || session.phase === 'failed') && (
                  <div className="dc-notice" role="alert">
                    <span>
                      {session.error
                        ? errorMessage(session.error, en)
                        : l(
                            '分析已暂停，已完成的内容仍保留。',
                            'Analysis paused. Completed sections are kept.',
                          )}
                    </span>
                    <button
                      disabled={busy || offline}
                      onClick={() =>
                        report ? analyze() : begin(session.match_id, session.player?.slot)
                      }
                    >
                      {l('继续分析', 'Resume analysis')}
                    </button>
                  </div>
                )}
                {report && !preparing && !reportReady && session.phase !== 'cancelled' && (
                  <div className="dc-progress dc-processing-error">
                    <Icon name="focus" />
                    <div>
                      <strong>
                        {l(
                          '比赛事实已整理，部分教练结论暂未完成',
                          'Match evidence is ready; some coach conclusions are still incomplete',
                        )}
                      </strong>
                      <p>
                        {l(
                          '进度会保留，继续处理即可，无需重新下载录像。',
                          'Progress is kept. Continue without downloading the replay again.',
                        )}
                      </p>
                    </div>
                    <button disabled={busy || offline} onClick={() => analyze()}>
                      {l('继续处理', 'Continue processing')}
                    </button>
                  </div>
                )}
                {reportReady && report && stage && (
                  <div className="dc-report-layout">
                    <aside className="dc-outline" aria-label={l('比赛阶段', 'Match phases')}>
                      <span className="dc-kicker">{l('这一局的选择', 'DECISIONS THIS GAME')}</span>
                      {report.stages.map((s, i) => (
                        <button
                          key={s.id}
                          aria-current={stageIndex === i ? 'step' : undefined}
                          onClick={() => {
                            setStageIndex(i)
                            setReplay(null)
                          }}
                        >
                          <span className="dc-stage-number">{String(i + 1).padStart(2, '0')}</span>
                          <span>
                            <strong>{s.title}</strong>
                            <small>
                              {clock(s.from)} — {clock(s.to)}
                            </small>
                          </span>
                          {s.status === 'ready' ? (
                            <Icon name="check" size={15} />
                          ) : (
                            <span className="dc-stage-pending">
                              {s.status === 'failed' ? '!' : '·'}
                            </span>
                          )}
                        </button>
                      ))}
                      <button onClick={() => askAbout(stage.id, undefined, stage.title)}>
                        <Icon name="mark" size={16} />
                        <span>{l('和教练聊这阶段', 'Discuss this phase')}</span>
                      </button>
                      <p>
                        {l(
                          '阶段划分用于组织复盘，并非固定打法时钟。',
                          'Phase boundaries organize the review; they are not prescribed timings.',
                        )}
                      </p>
                      {report.goal && (
                        <button
                          className="dc-outline-goal"
                          onClick={() => {
                            const fold = document.getElementById(
                              'dc-practice-fold',
                            ) as HTMLDetailsElement | null
                            if (fold) fold.open = true
                            requestAnimationFrame(() =>
                              document
                                .getElementById('dc-report-goal')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                            )
                          }}
                        >
                          <Icon name="focus" />
                          <span>{l('下一局练什么', 'Your next practice')}</span>
                          <Icon name="arrow" size={15} />
                        </button>
                      )}
                    </aside>
                    <div className="dc-stage-body" id="dc-current-stage" key={stage.id}>
                      <div className="dc-review-stage-heading">
                        <div>
                          <span className="dc-kicker">
                            {clock(stage.from)} — {clock(stage.to)}
                          </span>
                          <h2>{stage.title}</h2>
                        </div>
                        <span>
                          {String(stageIndex + 1).padStart(2, '0')} /{' '}
                          {String(report.stages.length).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="dc-stage-scan">
                        {session.presentation?.status === 'pending' && (
                          <span role="status">
                            {l('正在编排交互内容…', 'Composing interactive review…')}
                          </span>
                        )}
                        <span>
                          {stage.decisions.length} {l('个关键片段', 'key moments')}
                        </span>
                        <span>
                          {l(
                            '先看处理，再按需展开',
                            'Start with the option. Open details when needed.',
                          )}
                        </span>
                      </div>
                      {stage.summary && (
                        <details className="dc-stage-overview">
                          <summary>{l('阶段总览', 'Phase overview')}</summary>
                          <p>{readable(stage.summary)}</p>
                        </details>
                      )}
                      {stage.metrics.length > 0 && (
                        <div className="dc-stage-metrics">
                          {stage.metrics.map((v, i) => (
                            <span key={i}>{v}</span>
                          ))}
                        </div>
                      )}
                      {stage.status === 'failed' && (
                        <div className="dc-notice">
                          <span>{errorMessage(stage.error, en)}</span>
                          <button disabled={busy || preparing || offline} onClick={() => analyze()}>
                            {l('重试未完成阶段', 'Retry incomplete phases')}
                          </button>
                        </div>
                      )}
                      <ReviewSurface
                        session={session}
                        surfaceId={stage.id}
                        ui={
                          stage.ui ||
                          session.presentation?.surfaces?.find(
                            (p) => p.updateComponents.surfaceId === stage.id,
                          )
                        }
                        decisions={stage.decisions}
                        evidence={report.evidence}
                        en={en}
                        readable={readable}
                        inspect={setInspection}
                        ask={(d) => askAbout(stage.id, d.id, `${stage.title} · ${clock(d.time)}`)}
                      />
                      <div className="dc-stage-next">
                        {stageIndex > 0 && (
                          <button
                            onClick={() => {
                              setStageIndex(stageIndex - 1)
                              setReplay(null)
                            }}
                          >
                            <Icon name="back" />
                            {report.stages[stageIndex - 1]?.title}
                          </button>
                        )}
                        {stageIndex < report.stages.length - 1 && (
                          <button
                            className="dc-primary"
                            onClick={() => {
                              setStageIndex(stageIndex + 1)
                              setReplay(null)
                            }}
                          >
                            {l('下一阶段', 'Next phase')} · {report.stages[stageIndex + 1]?.title}
                            <Icon name="arrow" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {reportReady && session && (
                  <Conversation
                    key={`conversation:${session.id}`}
                    session={session}
                    en={en}
                    busy={busy || offline || session.presentation?.status === 'pending'}
                    inspect={setInspection}
                    readable={readable}
                    askMoment={(d) => {
                      const s = report!.stages.find((s) => s.decisions.some((x) => x.id === d.id))!
                      askAbout(s.id, d.id, `${s.title} · ${clock(d.time)}`)
                    }}
                    context={discussionContext}
                    resetContext={() => setDiscussionContext({ label: l('整局', 'Whole match') })}
                    request={(args) =>
                      run(async () =>
                        accept((await call(args)).session as unknown as ReviewSession),
                      )
                    }
                  />
                )}
                {reportReady && report?.goal && (
                  <details className="dc-practice-fold" id="dc-practice-fold">
                    <summary>
                      <Icon name="focus" />
                      <span>
                        {l('下一局只练一件事', 'One thing to practice next')}
                        <strong>{report.goal!.title}</strong>
                        {session.phase === 'complete' && (
                          <small className="dc-practice-saved">
                            {l('练习已保存', 'Practice saved')}
                          </small>
                        )}
                      </span>
                      <Icon name="arrow" />
                    </summary>
                    <GoalEditor
                      key={`goal:${session.id}`}
                      session={session}
                      en={en}
                      busy={
                        busy ||
                        !!preparing ||
                        offline ||
                        report.version < 4 ||
                        session.discussion?.some((t) => t.status === 'pending') === true
                      }
                      save={(goal) =>
                        void run(async () => {
                          accept(
                            (
                              await call({
                                action: 'save',
                                id: session.id,
                                title: goal.title,
                                trigger: goal.trigger,
                                action_rule: goal.action,
                                check_method: goal.check,
                              })
                            ).session as unknown as ReviewSession,
                          )
                          await refresh(false)
                        })
                      }
                    />
                  </details>
                )}
              </>
            )}
            {session.warnings.length > 0 && (
              <details className="dc-source-notes">
                <summary>
                  {l('数据状态与来源', 'Data status & sources')} · {session.warnings.length}
                </summary>
                {session.warnings.map((w, i) => (
                  <p key={i}>{dual(w, en)}</p>
                ))}
              </details>
            )}
          </section>
        )}
      </main>
      {inspection && session?.report && (
        <ReviewInspector
          key={`${session.id}:${inspection.mode}:${inspection.decisionId || inspection.evidenceId || 'match'}`}
          session={session}
          target={inspection}
          en={en}
          readable={readable}
          invoke={call}
          match={() =>
            p.call('dota_match', { match_id: session.match_id, sections: ['overview', 'players'] })
          }
          close={() => setInspection(null)}
          ask={askAbout}
        />
      )}
      <footer className="dc-app-footer">
        <span>DOTA / COACH</span>
        <span>{l('看清选择，练习改变。', 'See the choice. Practice the change.')}</span>
        <span>{l('比赛证据 + 你的偏好', 'Match evidence + your preferences')}</span>
      </footer>
    </div>
  )
}
function Preferences({
  en,
  value,
  update,
  role,
  setRole,
}: {
  en: boolean
  value: ReviewPreferences
  update: (v: ReviewPreferences) => void
  role: number
  setRole: (v: number) => void
}) {
  const l = (zh: string, english: string) => (en ? english : zh)
  return (
    <section className="dc-preferences" aria-label={l('复盘偏好', 'Review preferences')}>
      <div>
        <label>{l('更想研究什么', 'What would you like to focus on?')}</label>
        <div className="dc-focus-chips">
          {focusOptions.map(([k, zh, eng]) => (
            <button
              type="button"
              key={k}
              aria-pressed={value.focus.includes(k)}
              onClick={() =>
                update({
                  ...value,
                  focus: value.focus.includes(k)
                    ? value.focus.filter((x) => x !== k)
                    : [...value.focus, k],
                })
              }
            >
              {value.focus.includes(k) && <Icon name="check" size={14} />} {en ? eng : zh}
            </button>
          ))}
        </div>
      </div>
      <div className="dc-preference-fields">
        <label>
          {l('风险偏好', 'Play preference')}
          <select
            value={value.style}
            onChange={(e) =>
              update({ ...value, style: e.target.value as ReviewPreferences['style'] })
            }
          >
            <option value="balanced">{l('均衡取舍', 'Balanced tradeoffs')}</option>
            <option value="tempo">{l('主动带节奏', 'Proactive tempo')}</option>
            <option value="safe">{l('稳健优先', 'Safety first')}</option>
          </select>
        </label>
        <label>
          {l('复盘深度', 'Detail')}
          <select
            value={value.detail}
            onChange={(e) =>
              update({ ...value, detail: e.target.value as ReviewPreferences['detail'] })
            }
          >
            <option value="detailed">
              {l('详细：每阶段最多 3 个片段', 'Detailed: up to 3 moments per phase')}
            </option>
            <option value="standard">
              {l('精简：每阶段最多 2 个片段', 'Focused: up to 2 moments per phase')}
            </option>
          </select>
        </label>
        <label>
          {l('本局位置', 'Your role')}
          <select value={role} onChange={(e) => setRole(Number(e.target.value))}>
            <option value="0">{l('从本局推断，之后可修改', 'Infer from match')}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {l('号位', 'position')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {l('补充你的目标或当时的想法（可选）', 'Your goal or intention (optional)')}
        <textarea
          value={value.intention}
          maxLength={1500}
          onChange={(e) => update({ ...value, intention: e.target.value })}
          placeholder={l(
            '例如：我想打主动一点，但总担心队友跟不上。',
            'For example: I want to set the tempo but worry my team cannot follow.',
          )}
          rows={2}
        />
      </label>
    </section>
  )
}
function GoalEditor({
  session,
  en,
  busy,
  save,
}: {
  session: ReviewSession
  en: boolean
  busy: boolean
  save: (goal: PracticeGoal) => void
}) {
  const l = (zh: string, english: string) => (en ? english : zh),
    [goal, setGoal] = useState(() =>
      readDraft<PracticeGoal>('goal:' + session.id, session.goal || session.report!.goal!),
    ),
    [editing, setEditing] = useState(false),
    done = session.phase === 'complete'
  const update = (k: keyof PracticeGoal, v: string) =>
    setGoal((old) => {
      const next = { ...old, [k]: v }
      writeDraft('goal:' + session.id, next)
      return next
    })
  return (
    <section className="dc-goal" id="dc-report-goal">
      <div className="dc-goal-icon">
        <Icon name={done ? 'check' : 'focus'} size={25} />
      </div>
      <div>
        <span className="dc-kicker">
          {done
            ? l('已加入我的练习', 'SAVED TO MY PRACTICE')
            : l('下一局，只练这一件事', 'ONE THING FOR THE NEXT GAME')}
        </span>
        <h2>{goal.title}</h2>
        <p>
          <b>{l('当', 'When')} </b>
          {goal.trigger}
          <br />
          <b>{l('就', 'Then')} </b>
          {goal.action}
        </p>
        <p className="dc-review-muted">{goal.check}</p>
        {editing && !done && (
          <div className="dc-goal-fields">
            {(['title', 'trigger', 'action', 'check'] as const).map((k, i) => (
              <label key={k}>
                {
                  [
                    l('练习名称', 'Title'),
                    l('触发条件', 'Trigger'),
                    l('具体行动', 'Action'),
                    l('检查方式', 'Check'),
                  ][i]
                }
                <textarea
                  value={goal[k]}
                  maxLength={k === 'title' ? 100 : k === 'trigger' ? 500 : 700}
                  onChange={(e) => update(k, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <div className="dc-goal-actions">
          {done ? (
            <span className="dc-saved">
              <Icon name="check" />
              {l(
                '已保存，下次回到「我的练习」记录实践',
                'Saved. Log your practice in My practice.',
              )}
            </span>
          ) : (
            <>
              <button
                className="dc-primary"
                disabled={
                  busy ||
                  !goal.title.trim() ||
                  !goal.trigger.trim() ||
                  !goal.action.trim() ||
                  !goal.check.trim()
                }
                onClick={() => save(goal)}
              >
                {l('保存这一项练习', 'Save this practice goal')}
                <Icon name="arrow" />
              </button>
              <button onClick={() => setEditing(!editing)}>
                {editing ? l('收起编辑', 'Done editing') : l('调整这项练习', 'Edit goal')}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
