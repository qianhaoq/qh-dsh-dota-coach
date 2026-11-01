import { useState, useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInjected } from './api.ts'
import type { Json, RecordValue } from '../types.ts'
import type { ReviewSession, CoachPlayer, PracticeGoal } from '../coaching-types.ts'
import { errorMessage, readDraft, writeDraft } from './network.ts'
import { LegacyPanel } from './LegacyPanel.tsx'
import mapImage from './assets/map-740.webp'
type Props = PropsRuntime<'main'> & InjectFace<PanelInjected> & PropsLocale<'dotaCoach'>
const rows = (v: Json | undefined): RecordValue[] =>
  Array.isArray(v)
    ? v.filter((r): r is RecordValue => !!r && typeof r === 'object' && !Array.isArray(r))
    : []
const obj = (v: Json | undefined): RecordValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {}
const clock = (n: number) =>
  `${n < 0 ? '−' : ''}${Math.floor(Math.abs(n) / 60)}:${String(Math.floor(Math.abs(n) % 60)).padStart(2, '0')}`
const heroImage = (npc: string) =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${npc}.png`
const abilityImage = (name: string) =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/${name}.png`
const itemImage = (name: string) =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${name.replace(/^item_/, '')}.png`
const dual = (s: string, en: boolean) => {
  const bits = s.split(' / ')
  return en ? bits.at(-1)! : bits[0]
}
function Asset({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
export function GuidedPanel(p: Props) {
  const en = p.t('title') === 'Dota coach',
    l = (zh: string, english: string) => (en ? english : zh)
  const known = (v: string) => (v === 'unknown' ? l('未知', 'Unknown') : v)
  const modeLabel = (v: string) =>
    ({
      '1': l('全英雄选择', 'All Pick'),
      '2': l('队长模式', 'Captains Mode'),
      '3': l('随机征召', 'Random Draft'),
      '4': l('单一征召', 'Single Draft'),
      '18': l('技能征召', 'Ability Draft'),
      '22': l('全英雄选择', 'All Pick'),
      '23': l('加速模式', 'Turbo'),
    })[v] || known(v)
  const rankLabel = (v: string) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 10 || n > 89) return known(v)
    return (
      [
        l('未知', 'Unknown'),
        l('先锋', 'Herald'),
        l('卫士', 'Guardian'),
        l('中军', 'Crusader'),
        l('统帅', 'Archon'),
        l('传奇', 'Legend'),
        l('万古', 'Ancient'),
        l('超凡', 'Divine'),
        l('冠绝', 'Immortal'),
      ][Math.floor(n / 10)] + (n % 10 >= 1 && n % 10 <= 5 ? ' ' + (n % 10) : '')
    )
  }
  const selection = p.useSelection((s) => s)
  const [view, setView] = useState<'coach' | 'records'>('coach'),
    [library, setLibrary] = useState(false),
    [settings, setSettings] = useState(false)
  const [account, setAccount] = useState(''),
    [matchInput, setMatchInput] = useState(''),
    [role, setRole] = useState(0)
  const [matches, setMatches] = useState<RecordValue[]>([]),
    [sessions, setSessions] = useState<ReviewSession[]>([]),
    [training, setTraining] = useState<RecordValue[]>([])
  const [session, setSession] = useState<ReviewSession | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState(''),
    [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const generation = useRef(0),
    mounted = useRef(true),
    selectedRevision = useRef(-1)
  const call = async (args: RecordValue) => {
    const r = await p.call('dota_coach', args)
    if (!r.ok) throw new Error(String(r.detail || r.reason))
    return r
  }
  const accept = (r: RecordValue) => {
    if (r.session) setSession(r.session as unknown as ReviewSession)
  }
  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await f()
    } catch (e) {
      if (mounted.current) setError(errorMessage(e, en))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const loadRecords = async () => {
    const [a, b] = await Promise.all([
      call({ action: 'list' }),
      p.call('dota_training', { action: 'list' }),
    ])
    if (!mounted.current) return
    setSessions(rows(a.items) as unknown as ReviewSession[])
    setTraining(rows(b.items))
  }
  const loadMatches = async (id: number) => {
    const r = await p.call('dota_matches', { account: String(id), limit: 8 })
    if (!r.ok) throw new Error(String(r.detail || r.reason))
    if (mounted.current) setMatches(rows(r.items))
  }
  useEffect(() => {
    mounted.current = true
    void run(async () => {
      const [config, saved] = await Promise.all([p.settings(), call({ action: 'list' })])
      if (!mounted.current) return
      setAccount(config.accountId ? String(config.accountId) : '')
      setSessions(rows(saved.items) as unknown as ReviewSession[])
      if (saved.active_id) {
        const r = await call({ action: 'get', id: saved.active_id })
        if (mounted.current) accept(r)
      }
      const goals = await p.call('dota_training', { action: 'list' })
      if (mounted.current) setTraining(rows(goals.items))
      if (config.accountId) await loadMatches(config.accountId)
    })
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [])
  useEffect(() => {
    if (selection.matchId && selectedRevision.current !== selection.revision) {
      selectedRevision.current = selection.revision
      setMatchInput(String(selection.matchId))
      setSession(null)
      setView('coach')
    }
  }, [selection])
  useEffect(() => {
    if (!session || session.phase !== 'preparing') return
    let alive = true
    const id = session.id
    let timer: ReturnType<typeof setTimeout>
    const poll = () => {
      void call({ action: 'get', id })
        .then(
          (r) => {
            if (alive) accept(r)
          },
          (e) => {
            if (alive) setError(errorMessage(e, en))
          },
        )
        .finally(() => {
          if (alive) timer = setTimeout(poll, 1200)
        })
    }
    timer = setTimeout(poll, 800)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [session?.id, session?.phase])
  useEffect(() => {
    const m = session?.moments[session.current]
    setAnswer(
      m?.pending_answer || (session && m ? readDraft('answer:' + session.id + ':' + m.id, '') : ''),
    )
  }, [session?.id, session?.current, session?.phase])
  useEffect(() => {
    const m = session?.moments[session.current]
    if (session && m && answer) writeDraft('answer:' + session.id + ':' + m.id, answer)
  }, [answer, session?.id, session?.current])
  const begin = async (id: number, slot?: number) => {
    const token = ++generation.current
    await run(async () => {
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error(
          l('请输入有效的比赛 ID 或比赛链接。', 'Enter a valid match ID or match link.'),
        )
      const r = await call({
        action: 'start',
        format: 'guided',
        match_id: id,
        account_id: Number(account) || 0,
        role,
        locale: en ? 'en' : 'zh',
        ...(selection.sessionId ? { session_id: selection.sessionId } : {}),
        ...(slot === undefined ? {} : { player_slot: slot }),
      })
      if (token !== generation.current) return
      accept(r)
      setView('coach')
      setMatchInput(String(id))
      setAnswer('')
    })
  }
  const parseMatch = () =>
    Number(matchInput.trim().match(/(?:matches\/)?(\d{6,})(?:[/?#].*)?$/)?.[1] || matchInput.trim())
  const respond = (text: string) =>
    void run(async () => {
      accept(await call({ action: 'answer', id: session!.id, answer: text }))
      const m = session!.moments[session!.current]
      writeDraft('answer:' + session!.id + ':' + m.id, '')
      setAnswer('')
    })
  useEffect(() => {
    setHistoryIndex(null)
  }, [session?.id])
  const thinking = session?.phase === 'preparing' && session.stage === 'thinking'
  const current = session?.moments[historyIndex ?? session.current],
    activeGoal = training.find((t) => t.status === 'active')
  const art = session?.player?.npc || String(matches[0]?.npc || 'juggernaut')
  const phases = [
    l('选择比赛', 'Choose a match'),
    l('回到现场', 'Revisit'),
    l('理解选择', 'Understand'),
    l('下一局练习', 'Practice'),
  ]
  const phaseIndex = !session
    ? 0
    : session.phase === 'practice' || session.phase === 'complete'
      ? 3
      : session.phase === 'explanation'
        ? 2
        : 1
  if (library)
    return (
      <div className="dota-workbench">
        <button className="dc-back" onClick={() => setLibrary(false)}>
          ← {l('返回教练', 'Back to coach')}
        </button>
        <LegacyPanel {...p} />
      </div>
    )
  return (
    <div className="dota-workbench" data-testid="coach-workbench">
      <header className="dc-nav">
        <button
          className="dc-brand"
          onClick={() => {
            setView('coach')
            setSession(null)
          }}
        >
          <span className="dc-emblem">◈</span>
          <span>
            DOTA <b>COACH</b>
            <small>{l('每次进步一个选择', 'ONE BETTER DECISION')}</small>
          </span>
        </button>
        <nav aria-label={l('主导航', 'Main navigation')}>
          <button
            aria-current={view === 'coach' ? 'page' : undefined}
            onClick={() => setView('coach')}
          >
            {l('教练', 'Coach')}
          </button>
          <button
            aria-current={view === 'records' ? 'page' : undefined}
            onClick={() => {
              setView('records')
              void run(loadRecords)
            }}
          >
            {l('记录', 'Journal')}
          </button>
        </nav>
        <div className="dc-nav-end">
          <button onClick={() => setLibrary(true)}>{l('资料与高级工具', 'Library & tools')}</button>
          <button aria-expanded={settings} onClick={() => setSettings(!settings)}>
            {l('设置', 'Settings')} <span aria-hidden>⚙</span>
          </button>
        </div>
      </header>
      {settings && (
        <section className="dc-settings" aria-label={l('教练设置', 'Coach settings')}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await p.settings(Number(account) || 0)
                if (session?.player && role && session.role !== role)
                  await begin(session.match_id, session.player.slot)
                if (Number(account)) await loadMatches(Number(account))
                setSettings(false)
              })
            }}
          >
            <label>
              {l('OpenDota 账号 ID', 'OpenDota account ID')}
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              {l('本局位置（可纠正推断）', 'Role (override inference)')}
              <select value={role} onChange={(e) => setRole(Number(e.target.value))}>
                <option value={0}>{l('根据本局判断', 'Infer from match')}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} ·{' '}
                    {
                      [
                        l('核心', 'Carry'),
                        l('中单', 'Mid'),
                        l('劣势路', 'Offlane'),
                        l('游走辅助', 'Support'),
                        l('优势路辅助', 'Hard support'),
                      ][n - 1]
                    }
                  </option>
                ))}
              </select>
            </label>
            <button className="dc-primary" type="submit">
              {l('保存设置', 'Save settings')}
            </button>
          </form>
          <p>
            {l(
              '模型沿用 DSH 配置。位置不确定时会保留未知，不按补刀或 KDA 直接评分。',
              'Uses your DSH model. Uncertain roles remain unknown; farm and KDA are not grades.',
            )}
          </p>
        </section>
      )}
      {(error || session?.error) && (
        <div role="alert" className="dc-error">
          {error || session?.error}
          <button
            onClick={() => {
              setError('')
              if (session?.phase === 'failed' || session?.phase === 'cancelled')
                void begin(session.match_id, session.player?.slot)
            }}
          >
            {l('重试', 'Retry')}
          </button>
        </div>
      )}
      {view === 'records' ? (
        <div className="dc-content">
          <div className="dc-section-heading">
            <div>
              <span className="dc-eyebrow">{l('复盘手记', 'YOUR JOURNAL')}</span>
              <h1>{l('把理解，留到下一局。', 'Carry the lesson forward.')}</h1>
            </div>
            <button onClick={() => void run(loadRecords)}>{l('刷新', 'Refresh')}</button>
          </div>
          <div className="dc-journal-grid">
            <section>
              <h2>{l('复盘记录', 'Reviewed matches')}</h2>
              {!sessions.length && (
                <p className="dc-muted">
                  {l(
                    '完成第一局复盘后，这里会记录你的选择与练习。',
                    'Your decisions and practice will appear after your first review.',
                  )}
                </p>
              )}
              {sessions.map((s) => (
                <button
                  className="dc-record"
                  key={s.id}
                  onClick={() =>
                    void run(async () => {
                      accept(await call({ action: 'get', id: s.id }))
                      setView('coach')
                    })
                  }
                >
                  <Asset src={heroImage(s.player?.npc || 'juggernaut')} alt="" />
                  <span>
                    <strong>
                      {s.goal?.title || s.player?.hero || l('待完成复盘', 'Review in progress')}
                    </strong>
                    <small>
                      #{s.match_id} · {new Date(s.updated_at).toLocaleDateString(en ? 'en' : 'zh')}{' '}
                      ·{' '}
                      {s.phase === 'complete' ? l('已完成', 'Complete') : l('继续复盘', 'Continue')}
                    </small>
                  </span>
                  <span>↗</span>
                </button>
              ))}
            </section>
            <section>
              <h2>{l('练习中的习惯', 'Habits in practice')}</h2>
              {!training.length && (
                <p className="dc-muted">
                  {l('每次只保留一个值得练习的改变。', 'Keep one practical change in focus.')}
                </p>
              )}
              {training.map((t) => (
                <Training
                  key={String(t.id)}
                  row={t}
                  en={en}
                  call={p.call}
                  refresh={() => void run(loadRecords)}
                />
              ))}
            </section>
          </div>
        </div>
      ) : !session ? (
        <div className="dc-content">
          <section className="dc-hero">
            <div className="dc-hero-art" style={{ backgroundImage: `url("${heroImage(art)}")` }} />
            <div className="dc-hero-copy">
              <span className="dc-eyebrow">{l('你的赛后教练', 'YOUR POST-MATCH COACH')}</span>
              <h1>{l('回到关键的那一刻。', 'Revisit the moment that matters.')}</h1>
              <p>
                {l(
                  '一起看清当时的选择。下一局，只练一个改变。',
                  'Understand your choices. Take one change into the next game.',
                )}
              </p>
              <form
                className="dc-match-input"
                onSubmit={(e) => {
                  e.preventDefault()
                  void begin(parseMatch())
                }}
              >
                <label className="dc-sr" htmlFor="dc-match">
                  {l('比赛 ID 或链接', 'Match ID or link')}
                </label>
                <input
                  id="dc-match"
                  placeholder={l('粘贴比赛 ID 或比赛链接', 'Paste a match ID or match link')}
                  value={matchInput}
                  onChange={(e) => setMatchInput(e.target.value)}
                />
                <button className="dc-primary" disabled={busy} type="submit">
                  {l('开始复盘', 'Start review')} <span>→</span>
                </button>
              </form>
              <small>
                {l(
                  '约 5 分钟 · AI 带你看现场 · 留下一个训练重点',
                  'About 5 minutes · Guided moments · One practice focus',
                )}
              </small>
            </div>
          </section>
          <div className="dc-home-grid">
            <section>
              <div className="dc-section-heading">
                <div>
                  <span className="dc-eyebrow">{l('最近的战场', 'RECENT BATTLES')}</span>
                  <h2>{l('从这局开始', 'Choose where to begin')}</h2>
                </div>
                {Number(account) > 0 && (
                  <button
                    disabled={busy || thinking}
                    onClick={() => void run(() => loadMatches(Number(account)))}
                  >
                    {l('刷新', 'Refresh')} ↻
                  </button>
                )}
              </div>
              {!matches.length ? (
                <div className="dc-empty">
                  <span className="dc-empty-symbol">◈</span>
                  <h3>{l('你的下一次进步，从一局比赛开始', 'One match is enough to begin')}</h3>
                  <p>
                    {l(
                      '直接粘贴比赛链接，或设置账号查看最近对局。',
                      'Paste a match link, or set your account to see recent matches.',
                    )}
                  </p>
                  <button onClick={() => setSettings(true)}>
                    {l('设置我的账号', 'Set my account')} →
                  </button>
                </div>
              ) : (
                <div className="dc-matches">
                  {matches.map((m) => (
                    <button
                      className="dc-match-row"
                      key={String(m.match_id)}
                      onClick={() => void begin(Number(m.match_id))}
                    >
                      <Asset src={heroImage(String(m.npc || 'juggernaut'))} alt="" />
                      <span className="dc-match-name">
                        <strong>{String(m.hero)}</strong>
                        <small>#{String(m.match_id)}</small>
                      </span>
                      <span className={m.result === 'win' ? 'dc-win' : 'dc-loss'}>
                        {m.result === 'win'
                          ? l('胜利', 'Victory')
                          : m.result === 'loss'
                            ? l('失利', 'Defeat')
                            : '—'}
                      </span>
                      <span className="dc-muted">
                        {typeof m.duration === 'number'
                          ? clock(m.duration)
                          : String(m.duration || '')}
                      </span>
                      <span className="dc-review-link">{l('一起复盘', 'Review')} ↗</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <aside className="dc-focus-card">
              <span className="dc-eyebrow">{l('带进下一局', 'YOUR NEXT GAME')}</span>
              <span className="dc-focus-icon">◇</span>
              <h2>
                {activeGoal ? String(activeGoal.title) : l('只练一个改变', 'One change at a time')}
              </h2>
              <p>
                {activeGoal
                  ? String(activeGoal.action_rule)
                  : l(
                      '从你能控制的选择开始，找到值得重复的好习惯。',
                      'Start with a choice you control. Find a habit worth repeating.',
                    )}
              </p>
              {activeGoal && (
                <button
                  onClick={() => {
                    setView('records')
                    void run(loadRecords)
                  }}
                >
                  {l('查看练习', 'View practice')} →
                </button>
              )}
              <div className="dc-focus-foot">
                {l('理解现场 → 尝试行动 → 回来看变化', 'Understand → Practice → Revisit')}
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="dc-content dc-review-content">
          <div className="dc-review-header">
            <div className="dc-review-identity">
              <Asset src={heroImage(session.player?.npc || art)} alt="" />
              <div>
                <span className="dc-eyebrow">
                  {l('本局复盘', 'MATCH REVIEW')} · #{session.match_id}
                </span>
                <h1>{session.player?.hero || l('找到你的英雄', 'Find your hero')}</h1>
                <div className="dc-context">
                  {session.role
                    ? `${session.role} ${l('号位', 'position')}`
                    : l('位置待确认', 'Role unknown')}{' '}
                  <button onClick={() => setSettings(true)}>{l('调整', 'Adjust')}</button>
                  <span>
                    · {l('版本', 'Patch')} {known(session.patch)}
                  </span>
                  <span>
                    · {l('模式', 'Mode')} {modeLabel(session.mode)}
                  </span>
                  <span>
                    · {l('分段', 'Rank')} {rankLabel(session.rank)}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setSession(null)
                void run(loadRecords)
              }}
            >
              {l('选择其他比赛', 'Another match')} ↗
            </button>
          </div>
          <ol className="dc-steps" aria-label={l('复盘进度', 'Review progress')}>
            {phases.map((name, i) => (
              <li key={name} className={i === phaseIndex ? 'active' : i < phaseIndex ? 'done' : ''}>
                <span>{i < phaseIndex ? '✓' : String(i + 1).padStart(2, '0')}</span>
                {name}
              </li>
            ))}
          </ol>
          {session.stage === 'choose_player' ? (
            <section className="dc-choose">
              <span className="dc-eyebrow">{l('先认识你', 'YOUR PERSPECTIVE')}</span>
              <h2>{l('这局，你使用的是哪位英雄？', 'Which hero did you play?')}</h2>
              <div>
                {session.players.map((player) => (
                  <button
                    key={player.slot}
                    onClick={() => void begin(session.match_id, player.slot)}
                  >
                    <Asset src={heroImage(player.npc)} alt="" />
                    <strong>{player.hero}</strong>
                    <small>
                      {player.name ||
                        l(
                          player.team === 2 ? '天辉' : '夜魇',
                          player.team === 2 ? 'Radiant' : 'Dire',
                        )}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          ) : session.phase === 'preparing' && !thinking ? (
            <section className="dc-preparing" role="status">
              <span className="dc-orbit">◈</span>
              <span className="dc-eyebrow">
                {session.stage === 'thinking'
                  ? l('听到了你的想法', 'CONSIDERING YOUR CHOICE')
                  : l('正在准备现场', 'PREPARING YOUR REVIEW')}
              </span>
              <h2>
                {session.stage === 'replay'
                  ? l('正在读取录像中的关键细节', 'Reading the details in your replay')
                  : session.stage === 'thinking'
                    ? l('把你的判断，放回当时的局面。', 'Putting your choice back in context.')
                    : l('挑出值得一起看的选择', 'Finding a decision worth revisiting')}
              </h2>
              <p>
                {l(
                  '比赛事件、英雄状态与时间顺序会分别核对。',
                  'Checking events, hero state and their sequence.',
                )}
              </p>
              <button
                onClick={() =>
                  void run(async () => accept(await call({ action: 'cancel', id: session.id })))
                }
              >
                {l('暂停准备', 'Pause preparation')}
              </button>
            </section>
          ) : session.phase === 'failed' || session.phase === 'cancelled' ? (
            <section className="dc-empty">
              <h2>{l('可以从这里继续', 'Pick up from here')}</h2>
              <p>{l('已有比赛资料和复盘记录会保留。', 'Your match data and journal are kept.')}</p>
              <button
                className="dc-primary"
                onClick={() => void begin(session.match_id, session.player?.slot)}
              >
                {l('继续准备', 'Continue')}
              </button>
            </section>
          ) : session.phase === 'practice' ||
            (session.phase === 'complete' && historyIndex === null) ? (
            <>
              <Practice
                session={session}
                en={en}
                busy={busy}
                save={(goal) =>
                  void run(async () => {
                    accept(
                      await call({
                        action: 'save',
                        id: session.id,
                        title: goal.title,
                        trigger: goal.trigger,
                        action_rule: goal.action,
                        check_method: goal.check,
                      }),
                    )
                    await loadRecords()
                  })
                }
              />
              {session.phase === 'complete' && (
                <div className="dc-history-links">
                  {session.moments.map((m, i) => (
                    <button key={m.id} onClick={() => setHistoryIndex(i)}>
                      {l('回看时刻', 'Revisit moment')} {String(i + 1).padStart(2, '0')} ·{' '}
                      {clock(m.time)} ↗
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            current && (
              <>
                {session.followup && (
                  <details className="dc-followup">
                    <summary>
                      {l('先看看上次的练习', 'Your previous focus')} · {session.followup.title}
                    </summary>
                    <p>{dual(session.followup.summary, en)}</p>
                    <span>{l('需要玩家结合现场确认', 'Player confirmation needed')}</span>
                  </details>
                )}
                <div className="dc-workspace">
                  <section className="dc-stage">
                    <div className="dc-stage-heading">
                      <span className="dc-eyebrow">
                        {l('关键时刻', 'KEY MOMENT')}{' '}
                        {String((historyIndex ?? session.current) + 1).padStart(2, '0')} /{' '}
                        {String(session.moments.length).padStart(2, '0')}
                      </span>
                      <span>{clock(current.time)}</span>
                    </div>
                    <Scene
                      session={
                        historyIndex === null
                          ? session
                          : { ...session, current: historyIndex, phase: 'explanation' }
                      }
                      en={en}
                      invoke={call}
                    />
                  </section>
                  <section className="dc-dialogue" aria-label={l('教练对话', 'Coach conversation')}>
                    <div className="dc-coach-avatar">◈</div>
                    <span className="dc-eyebrow">
                      {l('教练正在和你看这局', 'YOUR COACH, IN THIS MOMENT')}
                    </span>
                    <h2>{current.question}</h2>
                    {thinking && (
                      <div className="dc-thinking" role="status">
                        {l(
                          '教练正在核对你的判断与现场证据…',
                          'Checking your choice against the evidence…',
                        )}
                        <button
                          onClick={() =>
                            void run(async () =>
                              accept(await call({ action: 'cancel', id: session.id })),
                            )
                          }
                        >
                          {l('暂停', 'Pause')}
                        </button>
                      </div>
                    )}
                    {session.phase === 'question' || (thinking && !current.explanation) ? (
                      <>
                        <p className="dc-muted">
                          {l(
                            '先说说当时想做什么，没有标准答案。',
                            'Start with your intention. This is not a test.',
                          )}
                        </p>
                        <div className="dc-choices">
                          {current.choices?.map((choice, i) => (
                            <button
                              key={choice}
                              disabled={busy || thinking}
                              onClick={() => respond(choice)}
                            >
                              <span>{String.fromCharCode(65 + i)}</span>
                              {choice}
                              <b>↗</b>
                            </button>
                          ))}
                        </div>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            if (answer.trim()) respond(answer)
                          }}
                        >
                          <label className="dc-sr" htmlFor="dc-answer">
                            {l('你当时的想法', 'Your intention')}
                          </label>
                          <textarea
                            id="dc-answer"
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder={l(
                              '也可以说说你的想法…',
                              'Or tell me what you had in mind…',
                            )}
                            maxLength={4000}
                          />
                          <div className="dc-answer-actions">
                            <button
                              type="button"
                              disabled={busy || thinking}
                              onClick={() =>
                                respond(
                                  l(
                                    '我记不清了，请根据已有证据讲解，并保留不确定性。',
                                    'I do not recall; explain from the evidence and keep uncertainties explicit.',
                                  ),
                                )
                              }
                            >
                              {l('记不清 / 直接讲解', 'I don’t recall / Explain')}
                            </button>
                            <button
                              type="submit"
                              className="dc-primary"
                              disabled={busy || thinking || !answer.trim()}
                            >
                              {l('告诉教练', 'Tell coach')} ↑
                            </button>
                          </div>
                        </form>
                      </>
                    ) : (
                      current.explanation && (
                        <div className="dc-explanation">
                          <div className="dc-player-answer">
                            <span>{l('你当时的想法', 'YOUR INTENTION')}</span>
                            <p>{current.answer}</p>
                          </div>
                          {[
                            ['observation', l('现场事实', 'What happened')],
                            ['reasoning', l('教练的判断', 'Coach interpretation')],
                            ['alternative', l('另一个可尝试的选择', 'An alternative to try')],
                            ['uncertainty', l('判断的边界', 'What remains uncertain')],
                          ].map(([key, label]) => (
                            <section key={key}>
                              <h3>{label}</h3>
                              <p>
                                {
                                  current.explanation![
                                    key as
                                      | 'observation'
                                      | 'reasoning'
                                      | 'alternative'
                                      | 'uncertainty'
                                  ]
                                }
                              </p>
                            </section>
                          ))}
                          <details className="dc-evidence">
                            <summary>
                              {l('查看这条建议的依据', 'Inspect the evidence')} ·{' '}
                              {current.explanation.evidence_ids.length}
                            </summary>
                            {current.facts.map((f) => (
                              <article key={f.id}>
                                <strong>
                                  {dual(f.label, en)} · {clock(f.time)}
                                </strong>
                                <small>
                                  {f.source} ·{' '}
                                  {f.scope === 'team'
                                    ? l('我方可见', 'Team perspective')
                                    : l('赛后事实', 'Post-match fact')}
                                </small>
                                {f.facts.map((fact) => (
                                  <p key={fact}>{fact}</p>
                                ))}
                              </article>
                            ))}
                          </details>
                          {session.phase !== 'complete' && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                if (answer.trim()) respond(answer)
                              }}
                            >
                              <label className="dc-sr" htmlFor="dc-followup">
                                {l('追问或纠正教练', 'Ask or correct coach')}
                              </label>
                              <input
                                id="dc-followup"
                                value={answer}
                                onChange={(e) => setAnswer(e.target.value)}
                                placeholder={l(
                                  '有不同判断？告诉教练…',
                                  'See it differently? Tell the coach…',
                                )}
                              />
                              <button disabled={busy || thinking || !answer.trim()}>
                                {l('追问', 'Ask')}
                              </button>
                            </form>
                          )}
                          {session.phase === 'complete' ? (
                            <div className="dc-history-links">
                              {session.moments.map((m, i) => (
                                <button key={m.id} onClick={() => setHistoryIndex(i)}>
                                  {clock(m.time)}
                                </button>
                              ))}
                              <button onClick={() => setHistoryIndex(null)}>
                                {l('返回训练卡', 'Back to practice')}
                              </button>
                            </div>
                          ) : (
                            <button
                              className="dc-primary dc-next"
                              disabled={busy || thinking}
                              onClick={() =>
                                void run(async () =>
                                  accept(await call({ action: 'next', id: session.id })),
                                )
                              }
                            >
                              {session.current + 1 === session.moments.length
                                ? l('确定下一局的练习', 'Choose next game’s focus')
                                : l('看下一个时刻', 'Next moment')}{' '}
                              →
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </section>
                </div>
              </>
            )
          )}
          {!!session.warnings.length && (
            <details className="dc-data-note">
              <summary>
                {l('本局资料完整性', 'Data availability')} · {session.warnings.length}
              </summary>
              {session.warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </details>
          )}
        </div>
      )}
      <footer className="dc-footer">
        <span>DOTA COACH</span>
        <span>{l('看清选择，练习改变。', 'Understand the choice. Practice the change.')}</span>
        <small>{l('基于比赛证据 · 使用 DSH 模型', 'Match evidence · Your DSH model')}</small>
      </footer>
    </div>
  )
}
export function Scene({
  session,
  en,
  invoke,
  initialTime,
}: {
  session: ReviewSession
  en: boolean
  invoke: (a: RecordValue) => Promise<RecordValue>
  initialTime?: number
}) {
  const l = (zh: string, english: string) => (en ? english : zh),
    m = session.moments[session.current],
    question = session.phase === 'question' || (session.phase === 'preparing' && !m.answer)
  const [scene, setScene] = useState<RecordValue>({ states: [], events: [] }),
    [full, setFull] = useState(false),
    [at, setAt] = useState(Math.max(m.from, m.time - 5)),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('')
  const end = question ? Math.max(m.from, m.time - 1) : m.to
  useEffect(() => {
    let live = true
    setPlaying(false)
    setError('')
    void invoke({ action: 'scene', id: session.id, full, from: m.from, to: end }).then(
      (r) => {
        if (live) setScene(r)
      },
      (e) => {
        if (live) setError(errorMessage(e, en))
      },
    )
    return () => {
      live = false
    }
  }, [session.id, session.current, question, full])
  useEffect(() => {
    setAt(Math.max(m.from, Math.min(end, initialTime ?? m.time - 5)))
    setSelected('')
  }, [session.id, session.current, initialTime])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(
      () =>
        setAt((t) => {
          if (t >= end) {
            setPlaying(false)
            return end
          }
          return Math.min(end, t + 0.25)
        }),
      250,
    )
    return () => clearInterval(timer)
  }, [playing, end])
  const frames = rows(scene.states),
    latest = new Map<string, RecordValue>()
  for (const row of frames)
    if (
      Number(row.t) <= at &&
      (!latest.has(String(row.entity_id)) ||
        Number(latest.get(String(row.entity_id))!.t) < Number(row.t))
    )
      latest.set(String(row.entity_id), row)
  const wards = new Map<string, RecordValue>()
  for (const ward of rows(scene.wards))
    if (Number(ward.t) <= at) {
      if (ward.event === 'deleted') wards.delete(String(ward.entity_id))
      else wards.set(String(ward.entity_id), ward)
    }
  const units = [...latest.values()],
    self = units.find(
      (r) => String(r.hero).replaceAll('_', '') === session.player!.npc.replaceAll('_', ''),
    )
  const focused = units.find((r) => r.entity_id === selected) || self
  const point = (r: RecordValue) => ({
    x: ((Number(r.x) + 8192) / 16384) * 600,
    y: 600 - ((Number(r.y) + 8192) / 16384) * 600,
  })
  const playerFor = (name: string) =>
    session.players.find((p) => p.npc.replaceAll('_', '') === name.replaceAll('_', ''))
  return (
    <>
      <div className="dc-perspective">
        <span className={full ? 'dc-omniscient' : ''}>
          ● {full ? l('事后全图', 'Post-match all vision') : l('我方可见信息', 'Team perspective')}
        </span>
        <button
          disabled={question}
          aria-pressed={full}
          onClick={() => setFull(!full)}
          title={question ? l('回答后可展开事后全图', 'Available after your answer') : ''}
        >
          {full ? l('回到我方信息', 'Team perspective') : l('展开事后全图', 'Reveal all vision')}
        </button>
      </div>
      <div className="dc-map">
        <svg viewBox="0 0 600 600" role="img" aria-label={l('战术回放地图', 'Tactical replay map')}>
          <defs>
            <radialGradient id="dc-map-vignette">
              <stop offset="40%" stopColor="#111" stopOpacity="0" />
              <stop offset="100%" stopColor="#080b09" stopOpacity=".58" />
            </radialGradient>
            <filter id="dc-marker-shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity=".8" />
            </filter>
          </defs>
          <image href={mapImage} width="600" height="600" opacity=".73" />
          <rect width="600" height="600" fill="url(#dc-map-vignette)" />
          {[...wards.values()].map((ward) => {
            const pt = point(ward)
            return (
              <g key={String(ward.entity_id)} transform={`translate(${pt.x},${pt.y})`}>
                <title>
                  {ward.kind === 'sentry'
                    ? l('岗哨守卫', 'Sentry ward')
                    : l('侦察守卫', 'Observer ward')}
                </title>
                <circle
                  r="6"
                  fill={ward.kind === 'sentry' ? '#80b9d1' : '#ddc47e'}
                  stroke="#152018"
                  strokeWidth="2"
                />
                <circle r="2" fill="#253321" />
              </g>
            )
          })}
          {units.map((r) => {
            const last = obj(r.last_seen),
              ghost = typeof r.x !== 'number',
              data = ghost ? last : r
            if (typeof data.x !== 'number' || typeof data.y !== 'number') return null
            const pt = point(data),
              player = playerFor(String(r.hero)),
              own = r.team === session.player!.team,
              isSelf = player?.slot === session.player!.slot
            return (
              <g
                key={String(r.entity_id)}
                transform={`translate(${pt.x},${pt.y})`}
                opacity={ghost ? 0.45 : 1}
                tabIndex={ghost ? -1 : 0}
                role="button"
                aria-label={player?.hero || String(r.hero)}
                onClick={() => setSelected(String(r.entity_id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelected(String(r.entity_id))
                }}
                style={{ cursor: 'pointer' }}
              >
                <title>
                  {player?.hero || String(r.hero)}
                  {ghost ? ` · ${l('最后露头', 'Last seen')} ${clock(Number(last.t))}` : ''}
                </title>
                {isSelf && (
                  <circle r="22" fill="none" stroke="#d7bc80" strokeWidth="1" opacity=".6" />
                )}
                <circle
                  r={isSelf ? 17 : 13}
                  fill="#111"
                  stroke={isSelf ? '#e6c787' : own ? '#8db99c' : '#cf756d'}
                  strokeWidth="2"
                  filter="url(#dc-marker-shadow)"
                />
                <image
                  href={heroImage(player?.npc || String(r.hero))}
                  x={isSelf ? -13 : -10}
                  y={isSelf ? -10 : -7}
                  width={isSelf ? 26 : 20}
                  height={isSelf ? 20 : 14}
                  preserveAspectRatio="xMidYMid slice"
                />
                {ghost && (
                  <text y="28" textAnchor="middle" fill="#c6bca8" fontSize="11">
                    {clock(Number(last.t))}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <span className="dc-map-time">{clock(at)}</span>
        {!frames.length && (
          <div className="dc-map-empty">
            <span>◇</span>
            <strong>{l('先从已知事件看起', 'Start with the known events')}</strong>
            <small>
              {l(
                '当前没有精细坐标，地图仅作参考',
                'Fine positions unavailable; map is a reference',
              )}
            </small>
          </div>
        )}
      </div>
      <div className="dc-timeline">
        <button
          aria-label={playing ? l('暂停', 'Pause') : l('播放', 'Play')}
          onClick={() => {
            if (at >= end) setAt(m.from)
            setPlaying(!playing)
          }}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <input
          type="range"
          aria-label={l('回放时间', 'Replay time')}
          min={m.from}
          max={end}
          step={0.25}
          value={Math.min(at, end)}
          onChange={(e) => {
            setPlaying(false)
            setAt(Number(e.target.value))
          }}
        />
        <time>{clock(at)}</time>
        <span>/ {clock(end)}</span>
      </div>
      <div className="dc-map-caption">
        {l('7.40 参考底图 · 非地形视野模拟', '7.40 reference map · No terrain-vision simulation')}
        <span>
          {l(
            '虚线语义：最后露头；未记录处为未知',
            'Faded markers: last seen; unrecorded visibility is unknown',
          )}
        </span>
      </div>
      {focused && (
        <div className="dc-unit-state">
          <div className="dc-unit-heading">
            <strong>{playerFor(String(focused.hero))?.hero || String(focused.hero)}</strong>
            <small>
              {clock(Number(focused.t))} · {l('冷却不等于可施放', 'Cooldown ≠ castability')}
            </small>
          </div>
          {typeof focused.hp === 'number' && (
            <div className="dc-bars">
              <span
                className="dc-hp"
                style={
                  {
                    '--fill': `${(100 * focused.hp) / Math.max(1, Number(focused.max_hp) || focused.hp)}%`,
                  } as React.CSSProperties
                }
              >
                {Math.round(focused.hp)} / {Math.round(Number(focused.max_hp) || 0)}
              </span>
              {typeof focused.mana === 'number' && (
                <span
                  className="dc-mana"
                  style={
                    {
                      '--fill': `${(100 * focused.mana) / Math.max(1, Number(focused.max_mana) || focused.mana)}%`,
                    } as React.CSSProperties
                  }
                >
                  {Math.round(focused.mana)} / {Math.round(Number(focused.max_mana) || 0)}
                </span>
              )}
            </div>
          )}
          <div className="dc-control-tags">
            {Object.entries(obj(focused.controls))
              .filter(([, active]) => active === true)
              .map(([name]) => (
                <span key={name}>
                  {(
                    {
                      rooted: l('缠绕', 'Rooted'),
                      silenced: l('沉默', 'Silenced'),
                      muted: l('物品禁用', 'Muted'),
                      stunned: l('眩晕', 'Stunned'),
                      hexed: l('妖术', 'Hexed'),
                      nightmared: l('梦魇', 'Nightmared'),
                      feared: l('恐惧', 'Feared'),
                      taunted: l('嘲讽', 'Taunted'),
                      command_restricted: l('指令受限', 'Command restricted'),
                      out_of_game: l('移出游戏', 'Out of game'),
                      debuff_immune: l('减益免疫', 'Debuff immune'),
                    } as Record<string, string>
                  )[name] || name}
                </span>
              ))}
          </div>
          <div className="dc-loadout">
            {rows(focused.abilities)
              .filter((a) => Number(a.slot) < 6)
              .map((a) => (
                <span
                  key={String(a.slot)}
                  title={`${a.name} · ${l('等级', 'Level')} ${a.level ?? '?'} · ${l('冷却', 'Cooldown')} ${a.cooldown ?? '?'}s`}
                >
                  <Asset src={abilityImage(String(a.name))} alt={String(a.name)} />
                  <b>
                    {Number(a.cooldown) > 0
                      ? `${Math.ceil(Number(a.cooldown))}s`
                      : a.level === 0
                        ? '—'
                        : ''}
                  </b>
                </span>
              ))}
            <i />
            {rows(focused.items)
              .filter((a) => Number(a.slot) < 9 || Number(a.slot) === 15 || Number(a.slot) === 16)
              .map((a) => (
                <span
                  key={String(a.slot)}
                  className={Number(a.slot) >= 6 && Number(a.slot) < 9 ? 'dc-backpack' : ''}
                  title={`${a.name} · slot ${a.slot} · cooldown ${a.cooldown ?? '?'}s`}
                >
                  <Asset src={itemImage(String(a.name))} alt={String(a.name)} />
                  <b>{Number(a.cooldown) > 0 ? `${Math.ceil(Number(a.cooldown))}s` : ''}</b>
                </span>
              ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="dc-muted">
          {error}
        </p>
      )}
      <p className="dc-visibility-note">
        {l(
          '敌方未出现时保持未知。地图不代表玩家当时看了哪里。',
          'Unobserved enemies remain unknown. This map does not establish player attention.',
        )}
      </p>
    </>
  )
}
function Practice({
  session,
  en,
  busy,
  save,
}: {
  session: ReviewSession
  en: boolean
  busy: boolean
  save: (g: PracticeGoal) => void
}) {
  const l = (zh: string, english: string) => (en ? english : zh),
    [goal, setGoal] = useState<PracticeGoal>(session.goal!),
    done = session.phase === 'complete'
  return (
    <section className="dc-practice">
      <div className="dc-practice-intro">
        <span className="dc-eyebrow">
          {done
            ? l('已放进你的训练手记', 'SAVED TO YOUR JOURNAL')
            : l('带进接下来的五局', 'TAKE INTO YOUR NEXT FIVE GAMES')}
        </span>
        <span className="dc-practice-seal">{done ? '✓' : '◇'}</span>
        <h2>
          {done
            ? l('下一局，就从这里开始。', 'Your next game starts here.')
            : l('今天，只练这一件事。', 'One thing to practice.')}
        </h2>
        <p>
          {l(
            '有机会时再检查执行。没有遇到相关局面，不算失败。',
            'Check execution when the opportunity exists. No opportunity is not a failure.',
          )}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save(goal)
        }}
      >
        {[
          ['title', l('练习主题', 'Practice focus')],
          ['trigger', l('什么时候', 'When this happens')],
          ['action', l('做什么', 'What to do')],
          ['check', l('怎么检查', 'How to check')],
        ].map(([key, label], i) => (
          <label key={key}>
            <span>
              <b>{String(i + 1).padStart(2, '0')}</b>
              {label}
            </span>
            <textarea
              required
              readOnly={done}
              maxLength={key === 'title' ? 100 : 700}
              value={goal[key as keyof PracticeGoal] || ''}
              onChange={(e) => setGoal({ ...goal, [key]: e.target.value })}
            />
          </label>
        ))}
        <p className="dc-muted">
          {l(
            '执行意图以你的回看与反馈为准，AI 不会自动把建议当成已养成的习惯。',
            'Execution requires your review and feedback; a suggestion is not a learned habit.',
          )}
        </p>
        {!done && (
          <button className="dc-primary" disabled={busy} type="submit">
            {l('保存这一项练习', 'Save this practice focus')} →
          </button>
        )}
      </form>
    </section>
  )
}
export function Training({
  row,
  en,
  call,
  refresh,
}: {
  row: RecordValue
  en: boolean
  call: Props['call']
  refresh: () => void
}) {
  const l = (zh: string, english: string) => (en ? english : zh),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const checkins = rows(row.checkins),
    distinct = new Set(checkins.filter((c) => c.opportunity !== false).map((c) => c.match_id))
  return (
    <article className="dc-training">
      <div>
        <span className="dc-eyebrow">
          {row.status === 'active' ? l('进行中', 'IN PRACTICE') : String(row.status)}
        </span>
        <span className="dc-muted">
          {distinct.size} / 5 {l('局记录', 'games logged')}
        </span>
      </div>
      <h3>{String(row.title)}</h3>
      <p>
        <b>{l('当', 'When')} </b>
        {String(row.trigger)}
      </p>
      <p>
        <b>→ </b>
        {String(row.action_rule)}
      </p>
      <small>{String(row.check_method)}</small>
      <button onClick={() => setOpen(!open)}>{l('记录执行', 'Log practice')} +</button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            const values = Object.fromEntries(new FormData(e.currentTarget))
            try {
              const r = await call('dota_training', {
                action: 'checkin',
                id: row.id!,
                match_id: Number(values.match_id),
                body: String(values.body),
                completed: values.completed === 'on',
                opportunity: values.opportunity !== 'none',
              })
              if (!r.ok) throw new Error(String(r.detail || r.reason))
              setOpen(false)
              refresh()
            } catch (e) {
              setError(errorMessage(e, en))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            {l('比赛 ID', 'Match ID')}
            <input required name="match_id" inputMode="numeric" />
          </label>
          <label>
            {l('执行说明', 'What happened')}
            <textarea required name="body" />
          </label>
          <label>
            {l('这局是否遇到相关机会', 'Was there an opportunity?')}
            <select name="opportunity">
              <option value="yes">{l('遇到了', 'Yes')}</option>
              <option value="none">{l('没有遇到', 'No opportunity')}</option>
            </select>
          </label>
          <label className="dc-checkbox">
            <input type="checkbox" name="completed" />
            {l('有机会时已执行', 'Executed when the opportunity arose')}
          </label>
          <button className="dc-primary" disabled={busy}>
            {l('保存记录', 'Save log')}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {checkins.length > 0 && (
        <details>
          <summary>
            {l('查看执行记录', 'Practice history')} ({checkins.length})
          </summary>
          {checkins.map((c, i) => (
            <p key={i}>
              #{String(c.match_id)} ·{' '}
              {c.opportunity === false
                ? l('无机会', 'No opportunity')
                : c.basis === 'replay'
                  ? l('录像观测', 'Replay observation')
                  : l('玩家自述', 'Player report')}
              <br />
              {String(c.body)}
            </p>
          ))}
        </details>
      )}
    </article>
  )
}
