import type { ReactNode } from 'react'
import type { CoachEvidence, ReportDecision, ReviewSession } from '../coaching-types.ts'
import {
  fallbackUi,
  reduceMessages,
  resolveUiAction,
  surfaceMessages,
  validateUi,
  type UiPatch,
} from '../a2ui.ts'
import { recommendationPreview } from '../reading.ts'
import { Icon } from './Icons.tsx'
import mapImage from './assets/map-740.webp'
export type InspectTarget = {
  mode: 'replay' | 'analysis' | 'evidence' | 'match'
  decisionId?: string
  evidenceId?: string
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
export function ReviewSurface({
  session,
  surfaceId,
  ui,
  decisions,
  evidence,
  en,
  readable,
  inspect,
  ask,
}: {
  session: ReviewSession
  surfaceId: string
  ui?: UiPatch
  decisions: ReportDecision[]
  evidence: CoachEvidence[]
  en: boolean
  readable: (s: string) => string
  inspect: (target: InspectTarget) => void
  ask: (d: ReportDecision) => void
}) {
  const l = (zh: string, eng: string) => (en ? eng : zh)
  const refs = { surfaceId, decisions, evidence }
  const patch = validateUi(ui, refs) || fallbackUi(surfaceId, decisions)
  const surface = reduceMessages(
    surfaceMessages(patch, {
      decisions,
      evidence,
      match: { id: session.match_id, hero: session.player?.hero },
    }),
  ).get(surfaceId)!
  // All component bindings resolve into the host-supplied surface data, never model-authored facts.
  const data = surface.data as { decisions: ReportDecision[]; evidence: CoachEvidence[] }
  const act = (
    sourceComponentId: string,
    name: Parameters<typeof resolveUiAction>[0]['action']['name'],
    context: { decisionId?: string; evidenceId?: string } = {},
  ) => {
    const action = resolveUiAction(
      {
        version: 'v0.9.1',
        action: {
          surfaceId,
          sourceComponentId,
          timestamp: new Date().toISOString(),
          name,
          context,
        },
      },
      patch,
      refs,
    )
    if (!action) return
    const d = data.decisions.find((d) => d.id === action.decisionId)
    if (name === 'ask_coach') {
      if (d) ask(d)
      return
    }
    inspect({
      mode:
        name === 'open_match'
          ? 'match'
          : name === 'open_replay'
            ? 'replay'
            : name === 'open_evidence'
              ? 'evidence'
              : 'analysis',
      decisionId: action.decisionId,
      evidenceId: action.evidenceId,
    })
  }
  const render = (id: string): ReactNode => {
    const c = surface.components.get(id)
    if (!c) return null
    if ('children' in c)
      return (
        <div key={id} className={`dc-ui-${c.component.toLowerCase()}`}>
          {c.children.map(render)}
        </div>
      )
    if (c.component === 'MatchOverview')
      return (
        <button key={id} className="dc-ui-match" onClick={() => act(id, 'open_match')}>
          <Icon name="focus" />
          <span>
            {l('对局详情', 'Match details')}
            <small>
              #{session.match_id} · {session.player?.hero}
            </small>
          </span>
          <Icon name="arrow" />
        </button>
      )
    if (c.component === 'EvidenceList')
      return (
        <section key={id} className="dc-ui-evidence">
          <h3>{l('分析依据', 'Supporting records')}</h3>
          {c.evidenceIds.map((key) => {
            const e = data.evidence.find((e) => e.id === key)!
            return (
              <button key={key} onClick={() => act(id, 'open_evidence', { evidenceId: key })}>
                <span className="dc-time">{clock(e.time)}</span>
                <span>
                  {e.label}
                  <small>
                    {l(e.source === 'replay' ? '原生录像记录' : '赛后数据记录', e.source)}
                  </small>
                </span>
                <Icon name="arrow" size={15} />
              </button>
            )
          })}
        </section>
      )
    const d = data.decisions.find((d) => d.id === c.decisionId)!
    const state = d.state || {},
      context = { decisionId: d.id }
    return (
      <article
        key={id}
        className={`dc-ui-card dc-ui-${c.component.toLowerCase()}`}
        aria-label={`${clock(d.time)} ${l('复盘片段', 'Review moment')}`}
      >
        <header>
          <span className="dc-time">
            {clock(c.component === 'ResourceSnapshot' ? (d.decision_time ?? d.time) : d.time)}
          </span>
          <h3>
            {l(
              c.component === 'ReplayClip'
                ? '回看这一刻'
                : c.component === 'ResourceSnapshot'
                  ? '当时能做什么'
                  : '选择与结果',
              c.component === 'ReplayClip'
                ? 'Watch this moment'
                : c.component === 'ResourceSnapshot'
                  ? 'Available resources'
                  : 'Choice & outcome',
            )}
          </h3>
        </header>
        {c.component === 'ReplayClip' ? (
          <button
            className="dc-ui-poster"
            style={{
              backgroundImage: `linear-gradient(0deg,#14191ddd,#14191d33),url(${mapImage})`,
            }}
            onClick={() => act(id, 'open_replay', context)}
            aria-label={`${l('打开回放', 'Open replay')} ${clock(d.time)}`}
          >
            <span className="dc-ui-play">▶</span>
            <span>
              {clock(d.from)} — {clock(d.to)}
              <small>{l('二维战术回放', '2D tactical replay')}</small>
            </span>
          </button>
        ) : null}
        {c.component === 'ResourceSnapshot' ? (
          <div className="dc-ui-resource-values">
            <span>
              <small>HP</small>
              {typeof state.hp === 'number' ? Math.round(state.hp) : '—'}
            </span>
            <span>
              <small>MP</small>
              {typeof state.mana === 'number' ? Math.floor(state.mana) : '—'}
            </span>
            <p>
              {clock(d.decision_time ?? d.time)} · {l('决策前快照', 'Pre-decision snapshot')}
            </p>
          </div>
        ) : (
          <p className="dc-ui-conclusion">
            {readable(recommendationPreview(d.recommendation || d.actual[0] || ''))}
          </p>
        )}
        {!!d.conditions?.length && (
          <button className="dc-ui-condition" onClick={() => act(id, 'open_analysis', context)}>
            <Icon name="focus" size={13} />
            {d.conditions.length} {l('项行动前提', 'action prerequisites')}
            <Icon name="arrow" size={13} />
          </button>
        )}
        <footer>
          <button onClick={() => act(id, 'open_analysis', context)}>
            {l('打开分析', 'Analysis')}
            <Icon name="arrow" size={13} />
          </button>
          <button onClick={() => act(id, 'open_replay', context)}>
            <Icon name="play" size={13} />
            {l('回放', 'Replay')}
          </button>
          <button onClick={() => act(id, 'open_evidence', context)}>
            <Icon name="book" size={13} />
            {l('依据', 'Evidence')}
          </button>
          <button
            aria-label={`${clock(d.time)} ${l('问 AI', 'Ask AI')}`}
            onClick={() => act(id, 'ask_coach', context)}
          >
            <Icon name="mark" size={14} />
          </button>
        </footer>
      </article>
    )
  }
  return (
    <div className="dc-ui-surface" data-a2ui-version="v0.9.1" data-surface-id={surfaceId}>
      {render('root')}
    </div>
  )
}
