import { useId, useRef, useState, type ReactNode } from 'react'
import type { ReportDecision, ReportStage } from '../coaching-types.ts'
import { recommendationPreview } from '../reading.ts'
import { Icon } from './Icons.tsx'
type Mode = 'actual' | 'next' | 'impact'
type Detail = 'reason' | 'conditions' | 'evidence' | 'replay'
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const parts = (text: string) => text.split(' / ')
export function DecisionDeck({
  stage,
  en,
  readable,
  ask,
  replay,
}: {
  stage: ReportStage
  en: boolean
  readable: (s: string) => string
  ask: (d: ReportDecision) => void
  replay: (d: ReportDecision) => ReactNode
}) {
  const l = (zh: string, eng: string) => (en ? eng : zh)
  const [detail, setDetail] = useState<{ id: string; mode: Detail } | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const close = () => {
    setDetail(null)
    origin.current?.focus({ preventScroll: true })
  }
  const selected = stage.decisions.find((d) => d.id === detail?.id),
    detailId = useId()
  const open = (id: string, mode: Detail) => {
    const closing = detail?.id === id && detail.mode === mode
    if (!closing) origin.current = document.activeElement as HTMLElement | null
    setDetail(closing ? null : { id, mode })
    if (!closing)
      requestAnimationFrame(() => {
        const target = document.getElementById(detailId)
        target
          ?.querySelector<HTMLButtonElement>('button[aria-label]')
          ?.focus({ preventScroll: true })
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
  }
  return (
    <>
      <div className="dc-card-deck">
        {stage.decisions.map((d, i) => (
          <Decision
            key={d.id}
            d={d}
            index={i}
            en={en}
            readable={readable}
            detailId={detailId}
            selected={detail?.id === d.id}
            open={(mode) => open(d.id, mode)}
            ask={() => ask(d)}
          />
        ))}
      </div>
      <div id={detailId}>
        {selected && detail && (
          <section className="dc-reading-detail" aria-label={l('片段详情', 'Moment details')}>
            <header>
              <span className="dc-time">{clock(selected.time)}</span>
              <h3>
                {
                  {
                    reason: l('为什么这样处理', 'Why this option'),
                    conditions: l('行动前提', 'Action prerequisites'),
                    evidence: l('录像依据', 'Replay evidence'),
                    replay: l('战术现场', 'Replay context'),
                  }[detail.mode]
                }
              </h3>
              <button aria-label={l('收起片段详情', 'Close moment details')} onClick={close}>
                <Icon name="close" />
              </button>
            </header>
            {detail.mode === 'reason' && (
              <div className="dc-reading-explanation">
                <section>
                  <h4>{l('处理建议', 'Suggested response')}</h4>
                  <p>{readable(selected.recommendation || '')}</p>
                </section>
                {!!selected.conditions?.length && (
                  <section>
                    <h4>{l('先满足这些条件', 'Check these prerequisites')}</h4>
                    <ul>
                      {selected.conditions.map((v, i) => (
                        <li key={i}>{readable(v)}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section>
                  <h4>{l('取舍与代价', 'Tradeoffs')}</h4>
                  <p>{readable(selected.tradeoff || '')}</p>
                </section>
                {selected.uncertainty && (
                  <section>
                    <h4>{l('仍然不确定的部分', 'What remains unknown')}</h4>
                    <p>{readable(selected.uncertainty)}</p>
                  </section>
                )}
              </div>
            )}
            {detail.mode === 'conditions' && (
              <>
                <p className="dc-detail-caption">
                  {l(
                    '建议中的动作需要满足条件；冷却结束不代表一定可以施放。',
                    'These conditions apply to the named actions. Cooldown readiness alone does not guarantee a cast.',
                  )}
                </p>
                <ul className="dc-prerequisite-list">
                  {selected.conditions?.map((v, i) => (
                    <li key={i}>
                      <Icon name="focus" size={15} />
                      <span>{readable(v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {detail.mode === 'evidence' && (
              <div className="dc-evidence-columns">
                <section>
                  <h4>{l('记录到的动作', 'Recorded actions')}</h4>
                  <ul>
                    {selected.actual.map((v, i) => (
                      <li key={i}>{readable(en ? parts(v).at(-1)! : parts(v)[0]!)}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>{l('随后发生的结果', 'Subsequent outcomes')}</h4>
                  <ul>
                    {selected.impact.map((v, i) => (
                      <li key={i}>{readable(v)}</li>
                    ))}
                  </ul>
                </section>
                <p className="dc-detail-caption">
                  {l(
                    '同期发生不等于由个人选择导致；未记录的视野与意图保持未知。',
                    'Timing does not establish individual causation. Unobserved vision and intention remain unknown.',
                  )}
                </p>
                {selected.uncertainty && <p>{readable(selected.uncertainty)}</p>}
                <details>
                  <summary>{l('查看原始状态', 'Inspect recorded state')}</summary>
                  <pre>{selected.context}</pre>
                </details>
              </div>
            )}
            {detail.mode === 'replay' && replay(selected)}
          </section>
        )}
      </div>
    </>
  )
}
function Decision({
  d,
  index,
  en,
  readable,
  open,
  ask,
  detailId,
  selected,
}: {
  d: ReportDecision
  index: number
  en: boolean
  readable: (s: string) => string
  open: (mode: Detail) => void
  ask: () => void
  detailId: string
  selected: boolean
}) {
  const l = (zh: string, eng: string) => (en ? eng : zh),
    [mode, setMode] = useState<Mode>('next'),
    id = useId()
  const title =
    d.kind === 'death'
      ? l('交战与生存', 'Fight & survival')
      : d.kind === 'item'
        ? l('装备与节奏', 'Items & tempo')
        : d.kind === 'objective'
          ? l('地图目标', 'Map objective')
          : d.kind === 'checkpoint'
            ? l('阶段检查', 'Phase check')
            : l('行动与配合', 'Action & teamwork')
  const actual = d.actual.filter((v) => !/起终位置|endpoints/.test(v)),
    events = actual.slice(-3)
  const hp = d.impact.find((v) => /HP \d/.test(v)),
    damage = d.impact.find((v) => /英雄伤害|damage to real heroes/.test(v)),
    death =
      d.kind === 'death' ||
      d.impact.some((v) => /记录到英雄死亡|Hero death recorded|跨死亡|crosses death/.test(v))
  const preview = readable(
    recommendationPreview(
      d.recommendation || l('本片段没有可核验的处理建议。', 'No verified advice for this moment.'),
    ),
  )
  const tabs: Array<[Mode, string]> = [
    ['actual', l('我的选择', 'My action')],
    ['next', l('更好处理', 'Next time')],
    ['impact', l('实际结果', 'Outcome')],
  ]
  return (
    <article
      className="dc-choice-card"
      aria-label={`${clock(d.time)} ${title}`}
      data-selected={selected || undefined}
    >
      <header>
        <span className="dc-time">{clock(d.time)}</span>
        <h3 className="dc-choice-type">{title}</h3>
        <span className="dc-choice-index">{String(index + 1).padStart(2, '0')}</span>
      </header>
      <div className="dc-resource-strip">
        <span>
          {l('回看', 'Context')} {clock(d.decision_time ?? d.time)}
        </span>
        {typeof d.state?.hp === 'number' && (
          <span className="dc-resource-hp">
            HP <b>{Math.floor(d.state.hp)}</b>
          </span>
        )}
        {typeof d.state?.mana === 'number' && (
          <span className="dc-resource-mana">
            MP <b>{Math.floor(d.state.mana)}</b>
          </span>
        )}
      </div>
      <div
        className="dc-choice-tabs"
        role="tablist"
        aria-label={`${clock(d.time)} ${l('片段视图', 'moment view')}`}
      >
        {tabs.map(([key, label], i) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-${key}`}
            aria-controls={`${id}-panel`}
            aria-selected={mode === key}
            tabIndex={mode === key ? 0 : -1}
            onClick={() => setMode(key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]![0]
                setMode(next)
                document.getElementById(`${id}-${next}`)?.focus()
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="dc-choice-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${mode}`}
      >
        {mode === 'next' ? (
          <>
            {!!d.conditions?.length && (
              <button
                className="dc-condition-chip"
                aria-controls={detailId}
                onClick={() => open('conditions')}
              >
                <Icon name="focus" size={13} />
                {l('先核对', 'Check')} {d.conditions.length} {l('项动作条件', 'prerequisites')}
                <span>↗</span>
              </button>
            )}
            <p className="dc-choice-advice">{preview}</p>
            <button
              className="dc-card-text-action"
              aria-controls={detailId}
              onClick={() => open('reason')}
            >
              {l('看完整建议与取舍', 'Full advice & tradeoffs')}
              <Icon name="arrow" size={14} />
            </button>
          </>
        ) : mode === 'actual' ? (
          <>
            <ol className="dc-mini-events">
              {events.map((v, i) => (
                <li key={i}>{readable(en ? parts(v).at(-1)! : parts(v)[0]!)}</li>
              ))}
            </ol>
            <small>
              {l('记录动作，意图仍由你补充。', 'Recorded actions; intention is yours to explain.')}
            </small>
            {actual.length > 3 && (
              <button className="dc-card-text-action" onClick={() => open('evidence')}>
                {l('看全部', 'View all')} {actual.length} {l('条记录', 'events')}
                <Icon name="arrow" size={14} />
              </button>
            )}
          </>
        ) : (
          <>
            <div className="dc-outcome-tags">
              {death && (
                <span>
                  {d.impact.some((v) => /跨死亡|crosses death/.test(v))
                    ? l('窗口跨过死亡 / 复活', 'Window crosses death / respawn')
                    : l('记录到死亡事件', 'Death event recorded')}
                </span>
              )}
            </div>
            {hp && (
              <p className="dc-outcome-primary">
                {readable(hp.replace(/（.*?）|\s*\(.*?\)/g, ''))}
              </p>
            )}
            {damage && <p className="dc-outcome-secondary">{readable(damage)}</p>}
            {!hp && !damage && (
              <p>{readable(d.impact[0] || l('结果数据不足', 'Outcome data unavailable'))}</p>
            )}
            <small>
              {l(
                '后续记录，不等于因果归因。',
                'Subsequent observations do not establish causation.',
              )}
            </small>
          </>
        )}
      </div>
      <footer>
        <button aria-controls={detailId} onClick={() => open('evidence')}>
          <Icon name="book" size={14} />
          {l('依据', 'Evidence')}
        </button>
        <button aria-controls={detailId} onClick={() => open('replay')}>
          <Icon name="play" size={14} />
          {l('录像', 'Replay')}
        </button>
        <button className="dc-card-ask" onClick={ask}>
          <Icon name="mark" size={14} />
          {l('问 AI', 'Ask AI')}
        </button>
      </footer>
    </article>
  )
}
