import { useEffect, useRef, useState } from 'react'
import type { ReviewSession, ReportDecision } from '../coaching-types.ts'
import { ReviewSurface, type InspectTarget } from './ReviewSurface.tsx'
import type { RecordValue } from '../types.ts'
import { Icon } from './Icons.tsx'
import { readDraft, writeDraft } from './network.ts'
import { answerPreview } from '../reading.ts'
export function Conversation({
  session,
  en,
  busy,
  context,
  request,
  resetContext,
  inspect,
  readable,
  askMoment,
}: {
  session: ReviewSession
  en: boolean
  busy: boolean
  context: { stage_id?: string; decision_id?: string; label: string }
  resetContext: () => void
  inspect: (target: InspectTarget) => void
  readable: (s: string) => string
  askMoment: (d: ReportDecision) => void
  request: (args: RecordValue) => Promise<void>
}) {
  const l = (zh: string, eng: string) => (en ? eng : zh),
    key = 'discussion:' + session.id
  const saved = readDraft(key, { text: '', turn_id: '', submitted: '' })
  const [text, setText] = useState(saved.text),
    [last, setLast] = useState({ id: saved.turn_id, text: saved.submitted }),
    log = useRef<HTMLDivElement>(null)
  const turns = session.discussion || [],
    pending = turns.some((t) => t.status === 'pending'),
    evidence = [
      ...(session.report?.evidence || []),
      ...turns.flatMap((t) => t.extra_evidence || []),
    ]
  useEffect(() => {
    writeDraft(key, { text, turn_id: last.id, submitted: last.text })
  }, [text, last, key])
  useEffect(() => {
    if (last.id && turns.some((t) => t.id === last.id)) {
      if (text === last.text) setText('')
      setLast({ id: '', text: '' })
    }
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [session.updated_at])
  const submit = (value = text) => {
    if (!value.trim() || value.trim().length > 2000 || pending || busy) return
    const turn_id = last.id && last.text === value ? last.id : crypto.randomUUID()
    setLast({ id: turn_id, text: value })
    writeDraft(key, { text: value, turn_id, submitted: value })
    void request({
      action: 'discuss',
      id: session.id,
      turn_id,
      message: value,
      ...(context.stage_id ? { stage_id: context.stage_id } : {}),
      ...(context.decision_id ? { decision_id: context.decision_id } : {}),
    })
  }
  return (
    <section
      className="dc-conversation"
      id="dc-coach-conversation"
      aria-label={l('与 AI 教练继续讨论', 'Continue with your AI coach')}
    >
      <div className="dc-conversation-heading">
        <span className="dc-chat-icon">
          <Icon name="mark" size={24} />
        </span>
        <div>
          <span className="dc-kicker">CONTINUE THE REVIEW</span>
          <h2>{l('这局，继续聊。', 'Keep talking about this game.')}</h2>
          <p>
            {l(
              '录像和复盘都在上下文里，直接问就好。',
              'The replay and review stay in context. Just ask.',
            )}
          </p>
        </div>
      </div>
      {turns.length > 0 && (
        <div className="dc-chat-log" ref={log} role="log" aria-live="polite">
          {turns.map((t) => (
            <article key={t.id} className="dc-chat-turn">
              <div className="dc-chat-user">
                <span>{l('你', 'You')}</span>
                <p>{t.question}</p>
              </div>
              <div className="dc-chat-answer">
                <span>
                  <Icon name="mark" size={15} />
                  {l('教练', 'Coach')}
                </span>
                {t.answer ? (
                  <Answer text={t.answer} brief={t.brief} en={en} />
                ) : t.status === 'pending' ? (
                  <p className="dc-chat-thinking">
                    <span className="dc-spinner" />
                    {l('正在对照录像和你的问题…', 'Checking the replay against your question…')}
                  </p>
                ) : (
                  <p>{t.error || l('这条回答已停止。', 'This answer was stopped.')}</p>
                )}
                {t.status === 'failed' && (
                  <button
                    disabled={busy || pending}
                    onClick={() =>
                      void request({
                        action: 'discuss',
                        id: session.id,
                        turn_id: t.id,
                        retry: true,
                      })
                    }
                  >
                    <Icon name="refresh" size={14} />
                    {l('重试这条提问', 'Retry this question')}
                  </button>
                )}
                {t.ui && t.status === 'ready' && (
                  <ReviewSurface
                    session={session}
                    surfaceId={t.id}
                    ui={t.ui}
                    decisions={session.report?.stages.flatMap((s) => s.decisions) || []}
                    evidence={evidence}
                    en={en}
                    readable={readable}
                    inspect={inspect}
                    ask={askMoment}
                  />
                )}
                {!!t.citations?.length && (
                  <details className="dc-chat-evidence">
                    <summary>
                      {l('这条回答的依据', 'Evidence for this reply')} · {t.citations.length}
                    </summary>
                    {t.citations.map((id) => {
                      const e = evidence.find((x) => x.id === id)
                      return e ? (
                        <div key={id}>
                          <button onClick={() => inspect({ mode: 'evidence', evidenceId: e.id })}>
                            {e.label}
                            <Icon name="arrow" size={14} />
                          </button>
                        </div>
                      ) : null
                    })}
                  </details>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="dc-chat-context">
        <Icon name="focus" size={14} />
        {l('当前讨论', 'Discussing')} · {context.label}
        {(context.stage_id || context.decision_id) && (
          <button onClick={resetContext}>{l('切换到整局', 'Whole match')}</button>
        )}
      </div>
      {!turns.length && (
        <div className="dc-chat-suggestions">
          {[
            l('这局我最该先改什么？', 'What should I improve first in this game?'),
            l('还有哪些不同的处理方式？', 'What other options did I have?'),
            l('下一局怎么具体练习？', 'How should I practice next game?'),
          ].map((q) => (
            <button key={q} disabled={busy || pending} onClick={() => submit(q)}>
              {q}
              <Icon name="arrow" size={14} />
            </button>
          ))}
        </div>
      )}
      <form
        className="dc-chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          aria-label={l('继续问教练', 'Ask the coach')}
          value={text}
          maxLength={2000}
          rows={3}
          placeholder={l('如：这波还有什么选择？', 'What other options did I have here?')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div>
          <span>
            {l(
              '只对这局深入讨论，无需重新生成报告',
              'Discuss this game without regenerating the report',
            )}
          </span>
          {pending ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request({ action: 'stop_discussion', id: session.id })}
            >
              {l('停止回答', 'Stop answer')}
            </button>
          ) : (
            <button className="dc-primary" disabled={busy || !text.trim()}>
              {l('发送', 'Send')}
              <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
function Answer({
  text,
  brief,
  en,
}: {
  text: string
  brief?: { conclusion: string; steps: string[]; caveat?: string }
  en: boolean
}) {
  const [expanded, setExpanded] = useState(false),
    preview = brief?.conclusion || answerPreview(text)
  return (
    <div className="dc-answer-card">
      <p className="dc-answer-lead">{preview}</p>
      {brief?.steps.length ? (
        <ol className="dc-answer-steps">
          {brief.steps.map((v, i) => (
            <li key={i}>
              <span>{i + 1}</span>
              <p>{v}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {brief?.caveat && (
        <p className="dc-answer-caveat">
          <Icon name="focus" size={14} />
          {brief.caveat}
        </p>
      )}
      {(text.trim() !== preview.trim() || brief) && (
        <>
          <button
            className="dc-answer-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (en ? 'Less' : '收起解释') : en ? 'Full explanation' : '展开完整回答'}
            <Icon name="arrow" size={14} />
          </button>
          {expanded && (
            <div className="dc-chat-prose">
              {text.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i}>
                  {paragraph
                    .split(/(\*\*[^*]+\*\*)/g)
                    .map((part, j) =>
                      part.startsWith('**') && part.endsWith('**') ? (
                        <strong key={j}>{part.slice(2, -2)}</strong>
                      ) : (
                        part
                      ),
                    )}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
