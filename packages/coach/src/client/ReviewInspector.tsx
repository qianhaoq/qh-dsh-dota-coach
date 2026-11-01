import { useEffect, useId, useRef, useState } from 'react'
import type { ReviewSession } from '../coaching-types.ts'
import type { RecordValue } from '../types.ts'
import type { InspectTarget } from './ReviewSurface.tsx'
import { Scene } from './GuidedPanel.tsx'
import { Icon } from './Icons.tsx'
import { recommendationPreview as recommendationPreviewSafe, resourceReason } from '../reading.ts'
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const rows = (v: unknown): RecordValue[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
export function ReviewInspector({
  session,
  target,
  en,
  readable,
  invoke,
  match,
  close,
  ask,
}: {
  session: ReviewSession
  target: InspectTarget
  en: boolean
  readable: (s: string) => string
  invoke: (a: RecordValue) => Promise<RecordValue>
  match: () => Promise<RecordValue>
  close: () => void
  ask: (stageId: string, decisionId: string, label: string) => void
}) {
  const l = (zh: string, eng: string) => (en ? eng : zh)
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId()
  const allEvidence = [
    ...(session.report?.evidence || []),
    ...(session.discussion || []).flatMap((t) => t.extra_evidence || []),
  ]
  const evidence = allEvidence.find((e) => e.id === target.evidenceId)
  const stage = session.report!.stages.find((s) =>
    s.decisions.some(
      (d) => d.id === target.decisionId || (evidence && d.evidence_ids.includes(evidence.id)),
    ),
  )
  const d = stage?.decisions.find(
    (d) => d.id === target.decisionId || (evidence && d.evidence_ids.includes(evidence.id)),
  )
  const [view, setView] = useState(target.mode),
    [seek, setSeek] = useState(evidence?.time ?? d?.decision_time ?? d?.time ?? 0)
  const [matchData, setMatchData] = useState<RecordValue | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [attempt, setAttempt] = useState(0)
  const from = d?.from ?? Math.max(0, seek - 20),
    to = d?.to ?? Math.min(session.report!.duration, seek + 20)
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => {
      origin?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (view !== 'match' || matchData) return
    let live = true
    setLoading(true)
    setError('')
    void match()
      .then(
        (r) => {
          if (live) setMatchData(r)
        },
        (e) => {
          if (live) setError(e instanceof Error ? e.message : String(e))
        },
      )
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [view, attempt])
  const cited = target.evidenceId
    ? allEvidence.filter((e) => e.id === target.evidenceId)
    : allEvidence.filter((e) => d?.evidence_ids.includes(e.id))
  let exact: { requested_time?: number; own?: RecordValue } | undefined
  if (!d && evidence) {
    try {
      exact = JSON.parse(evidence.facts.find((f) => f.trim().startsWith('{')) || '{}')
    } catch {
      /* Raw record remains available. */
    }
  }
  const replaySession: ReviewSession = {
    ...session,
    phase: 'report',
    current: 0,
    moments: [
      {
        id: d?.id || evidence?.id || 'inspection',
        time: d?.time ?? evidence?.time ?? seek,
        from,
        to,
        kind: 'fight',
        title: '',
        facts: [],
        answer: 'postmatch review',
      },
    ],
  }
  const line = (v: string, i: number) => {
    if (v.trim().startsWith('{')) {
      let raw = v
      try {
        raw = JSON.stringify(JSON.parse(v), null, 2)
      } catch {
        /* Preserve the recorded text. */
      }
      return (
        <li key={i}>
          <details>
            <summary>{l('查看原始记录', 'Original record')}</summary>
            <pre>{raw}</pre>
          </details>
        </li>
      )
    }
    const text = readable(v.split(' / ')[en ? v.split(' / ').length - 1 : 0]!)
    const timestamp = text.match(/^(\d{1,2}):([0-5]\d)/)
    const t = timestamp ? Number(timestamp[1]) * 60 + Number(timestamp[2]) : undefined
    return (
      <li key={i}>
        {t !== undefined && t >= from && t <= to ? (
          <button
            className="dc-inspector-time"
            onClick={() => {
              setSeek(t)
              setView('replay')
            }}
          >
            <Icon name="play" size={12} />
            {text}
          </button>
        ) : (
          text
        )}
      </li>
    )
  }
  return (
    <dialog
      ref={dialog}
      className="dc-inspector"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <header>
        <div>
          <span className="dc-kicker">
            #{session.match_id} · {session.player?.hero}
          </span>
          <h2 id={titleId}>
            {view === 'match'
              ? l('对局详情', 'Match details')
              : `${clock(d?.time ?? evidence?.time ?? seek)} · ${l('复盘现场', 'Review workspace')}`}
          </h2>
        </div>
        <button aria-label={l('关闭复盘详情', 'Close review details')} onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <nav aria-label={l('详情视图', 'Detail views')}>
        {(['replay', 'analysis', 'evidence', 'match'] as const)
          .filter((v) => v === 'match' || (v === 'analysis' ? !!d : !!(d || evidence)))
          .map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {
                {
                  replay: l('战术回放', 'Tactical replay'),
                  analysis: l('选择对比', 'Choices'),
                  evidence: l('具体支撑', 'Evidence'),
                  match: l('对局详情', 'Match details'),
                }[v]
              }
            </button>
          ))}
      </nav>
      <div className="dc-inspector-body">
        {view === 'match' ? (
          <>
            {loading && <p role="status">{l('正在读取这局数据…', 'Loading match data…')}</p>}
            {error && (
              <p role="alert">
                {error}
                <button onClick={() => setAttempt(attempt + 1)}>{l('重试读取', 'Retry')}</button>
              </p>
            )}
            {matchData && (
              <MatchDetails data={matchData} session={session} en={en} readable={readable} />
            )}
          </>
        ) : (
          <div className={view === 'replay' ? 'dc-inspector-split' : 'dc-inspector-analysis'}>
            <div>
              {view === 'replay' && (
                <div className="dota-workbench dc-inspector-player">
                  <Scene session={replaySession} en={en} invoke={invoke} initialTime={seek} />
                  <p className="dc-detail-caption">
                    {l(
                      '根据原生录像记录重建的二维战术回放。',
                      '2D tactical reconstruction from native replay records.',
                    )}
                  </p>
                </div>
              )}
              {view === 'analysis' && d && (
                <div className="dc-inspector-comparison">
                  <section>
                    <h3>{l('我实际做了什么', 'Recorded choice')}</h3>
                    <ul>{d.actual.map(line)}</ul>
                  </section>
                  <section>
                    <h3>{l('怎样处理会更好', 'Alternative')}</h3>
                    <p>{readable(d.recommendation || '')}</p>
                    {!!d.conditions?.length && (
                      <div className="dc-inspector-prerequisites">
                        <strong>{l('行动前提', 'Prerequisites')}</strong>
                        <ul>{d.conditions.map(line)}</ul>
                      </div>
                    )}
                    <h4>{l('取舍', 'Tradeoff')}</h4>
                    <p>{readable(d.tradeoff || '')}</p>
                  </section>
                  <section>
                    <h3>{l('随后发生了什么', 'Recorded outcome')}</h3>
                    <ul>{d.impact.map(line)}</ul>
                    <small>
                      {l(
                        '时间上的先后不能单独证明因果。',
                        'Sequence alone does not establish causation.',
                      )}
                    </small>
                  </section>
                </div>
              )}
              {view === 'evidence' && d && (
                <ResourceState
                  state={d.state || {}}
                  time={d.decision_time ?? d.time}
                  en={en}
                  readable={readable}
                />
              )}
              {view === 'evidence' &&
                !d &&
                evidence &&
                (exact?.own ? (
                  <ResourceState
                    state={exact.own}
                    label={l('此刻录像状态', 'Requested-time state')}
                    time={exact.requested_time ?? evidence.time}
                    en={en}
                    readable={readable}
                  />
                ) : (
                  <p>
                    {l(
                      '此条是追问时刻的独立记录，可切换战术回放查看该窗口。',
                      'This is a separate record for the requested timestamp. Open its replay window above.',
                    )}
                  </p>
                ))}
            </div>
            <aside className="dc-inspector-support">
              <span className="dc-kicker">{l('结论的支撑', 'SUPPORTING RECORDS')}</span>
              {d && view === 'replay' && (
                <>
                  <p>{readable(recommendationPreviewSafe(d.recommendation || ''))}</p>
                  <h3>{l('片段事件 · 点击定位', 'Events · click to seek')}</h3>
                  <ul>{d.actual.map(line)}</ul>
                </>
              )}
              {cited.map((e) => (
                <details key={e.id} open={view === 'evidence'}>
                  <summary>
                    {clock(e.time)} ·{' '}
                    {e.source === 'replay'
                      ? l('原生录像', 'Native replay')
                      : l('赛后数据', 'Post-match data')}
                  </summary>
                  <ul>{e.facts.map(line)}</ul>
                  <small>
                    {e.scope === 'team'
                      ? l('我方信息', 'Team perspective')
                      : l('赛后观测', 'Post-match observation')}{' '}
                    · {e.label}
                  </small>
                </details>
              ))}
              {d?.uncertainty && <p className="dc-inspector-unknown">{readable(d.uncertainty)}</p>}
              {d && stage && (
                <button
                  className="dc-primary"
                  onClick={() => {
                    close()
                    requestAnimationFrame(() =>
                      ask(stage.id, d.id, `${stage.title} · ${clock(d.time)}`),
                    )
                  }}
                >
                  <Icon name="mark" size={15} />
                  {l('就这波问教练', 'Ask about this moment')}
                </button>
              )}
            </aside>
          </div>
        )}
      </div>
    </dialog>
  )
}
function ResourceState({
  state,
  time,
  en,
  readable,
  label,
}: {
  state: RecordValue
  time: number
  en: boolean
  readable: (s: string) => string
  label?: string
}) {
  const controls =
    state.controls && typeof state.controls === 'object' ? Object.entries(state.controls) : []
  const controlNames: Record<string, string> = {
    stunned: '眩晕',
    rooted: '缠绕',
    silenced: '沉默',
    muted: '禁用物品',
    hexed: '妖术',
    disarmed: '缴械',
    nightmared: '噩梦',
    out_of_game: '脱离游戏',
    command_restricted: '指令受限',
    feared: '恐惧',
    taunted: '嘲讽',
  }
  const active = controls
    .filter(([, v]) => v === true)
    .map(([k]) => (en ? k : controlNames[k] || k))
  const unknown = controls.filter(([, v]) => typeof v !== 'boolean').length
  const controlText = !controls.length
    ? en
      ? 'Unknown'
      : '未知'
    : active.length
      ? active.join(' · ')
      : unknown
        ? en
          ? 'Some control states unknown'
          : '部分控制状态未知'
        : en
          ? 'No recorded control restriction'
          : '未记录到控制限制'
  return (
    <section className="dc-inspector-resources">
      <h3>
        {clock(time)} · {label || (en ? 'Pre-decision resources' : '决策前状态')}
      </h3>
      <div className="dc-ui-resource-values">
        <span>
          HP <b>{typeof state.hp === 'number' ? Math.floor(state.hp) : '—'}</b>
        </span>
        <span>
          MP <b>{typeof state.mana === 'number' ? Math.floor(state.mana) : '—'}</b>
        </span>
      </div>
      <p>
        {en ? 'Recorded controls' : '记录到的控制'}：{controlText}
      </p>
      {!!rows(state.blocked_resources).length && (
        <section>
          <h4>{en ? 'Action prerequisites' : '资源限制与前提'}</h4>
          {rows(state.blocked_resources)
            .filter(
              (r) =>
                Array.isArray(r.reasons) &&
                r.reasons.some((reason) =>
                  /^(cooldown=|needs |no stored|inactive inventory)/.test(String(reason)),
                ),
            )
            .map((r, i) => (
              <div className="dc-inspector-resource" key={i}>
                <strong>{readable(String(r.name))}</strong>
                <span>
                  {Array.isArray(r.reasons)
                    ? r.reasons.map((reason) => resourceReason(String(reason), en)).join(' · ')
                    : ''}
                </span>
              </div>
            ))}
          <details>
            <summary>{en ? 'All resource checks' : '查看全部资源检查'}</summary>
            {rows(state.blocked_resources).map((r, i) => (
              <div className="dc-inspector-resource" key={i}>
                <strong>{readable(String(r.name))}</strong>
                <span>
                  {Array.isArray(r.reasons)
                    ? r.reasons.map((reason) => resourceReason(String(reason), en)).join(' · ')
                    : ''}
                </span>
              </div>
            ))}
          </details>
        </section>
      )}
      {(['abilities', 'items'] as const)
        .filter((key) => rows(state[key]).length)
        .map((key) => (
          <section key={key}>
            <h4>{key === 'abilities' ? (en ? 'Abilities' : '技能') : en ? 'Items' : '物品'}</h4>
            {rows(state[key]).map((r, i) => (
              <div className="dc-inspector-resource" key={i}>
                <strong>{readable(String(r.name))}</strong>
                <span>
                  {en ? 'Cooldown' : '冷却'}{' '}
                  {typeof r.cooldown === 'number' ? `${r.cooldown.toFixed(2)}s` : '—'}
                </span>
                <span>
                  {en ? 'Mana' : '耗蓝'} {String(r.mana_cost ?? '—')}
                </span>
                {typeof r.charges === 'number' && (
                  <span>
                    {en ? 'Charges' : '充能'} {r.charges}
                  </span>
                )}
              </div>
            ))}
          </section>
        ))}
      <small>
        {en
          ? 'Cooldown alone does not establish castability; range and targets may remain unknown.'
          : '冷却归零不代表可施放，目标、范围和视野仍需核对。'}
      </small>
    </section>
  )
}
function MatchDetails({
  data,
  session,
  en,
  readable,
}: {
  data: RecordValue
  session: ReviewSession
  en: boolean
  readable: (s: string) => string
}) {
  const overview = (data.overview || {}) as RecordValue
  return (
    <div className="dc-match-detail">
      <div className="dc-match-facts">
        <span>
          {en ? 'Duration' : '时长'} <b>{String(overview.duration ?? '—')}</b>
        </span>
        <span>
          {en ? 'Patch' : '版本'} <b>{session.patch}</b>
        </span>
        <span>
          {en ? 'Mode' : '模式'} <b>{String(overview.game_mode ?? '—')}</b>
        </span>
        <span>
          {en ? 'Winner' : '胜方'}{' '}
          <b>{overview.winner === 'radiant' ? (en ? 'Radiant' : '天辉') : en ? 'Dire' : '夜魇'}</b>
        </span>
      </div>
      {(['radiant', 'dire'] as const).map((team) => (
        <section key={team}>
          <h3>{team === 'radiant' ? (en ? 'Radiant' : '天辉') : en ? 'Dire' : '夜魇'}</h3>
          <div className="dc-scoreboard">
            <table>
              <thead>
                <tr>
                  {[
                    en ? 'Hero' : '英雄',
                    'K / D / A',
                    en ? 'Net worth' : '总资产',
                    'GPM / XPM',
                    en ? 'Hero damage' : '对英雄伤害',
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows(data.players)
                  .filter((p) => p.team === team)
                  .map((p, i) => (
                    <tr key={i} data-self={p.slot === session.player?.slot || undefined}>
                      <td>
                        {readable(String(p.hero))}
                        {p.slot === session.player?.slot ? (en ? ' · You' : ' · 你') : ''}
                      </td>
                      <td>{String(p.kda ?? '—')}</td>
                      <td>{String(p.net_worth ?? '—')}</td>
                      <td>
                        {String(p.gpm ?? '—')} / {String(p.xpm ?? '—')}
                      </td>
                      <td>{String(p.hero_damage ?? '—')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <small>
        {en ? 'Source: OpenDota post-match records' : '来源：OpenDota 赛后数据'}
        {typeof data.fetched_at === 'string' ? ` · ${data.fetched_at}` : ''}
      </small>
    </div>
  )
}
