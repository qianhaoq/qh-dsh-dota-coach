import { useState, useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInjected } from './api.ts'
import type { RecordValue, Json, TaskView } from '../types.ts'
import type { Key } from './locales.ts'
type Props = PropsRuntime<'main'> & InjectFace<PanelInjected> & PropsLocale<'dotaCoach'>
const rows = (v: Json | undefined): RecordValue[] =>
  Array.isArray(v)
    ? v.filter((r): r is RecordValue => !!r && typeof r === 'object' && !Array.isArray(r))
    : []
const object = (v: Json | undefined): RecordValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {}
const field = (r: RecordValue, k: string): string =>
  r[k] === null || r[k] === undefined
    ? '—'
    : typeof r[k] === 'string'
      ? (r[k] as string)
      : JSON.stringify(r[k])
const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`
export function LegacyPanel(p: Props) {
  const { t } = p,
    selection = p.useSelection((s) => s),
    [tab, setTab] = useState<'matches' | 'review' | 'knowledge' | 'training'>('matches')
  const [account, setAccount] = useState(''),
    [match, setMatch] = useState(''),
    [hero, setHero] = useState(''),
    [result, setResult] = useState(''),
    [matches, setMatches] = useState<RecordValue[]>([])
  const [from, setFrom] = useState(0),
    [to, setTo] = useState(180),
    [timeline, setTimeline] = useState<RecordValue | null>(null),
    [matchData, setMatchData] = useState<RecordValue | null>(null),
    [positions, setPositions] = useState<RecordValue[]>([]),
    [positionsTruncated, setPositionsTruncated] = useState(false),
    [nextSourceOffset, setNextSourceOffset] = useState<number | null>(null),
    [eventFilter, setEventFilter] = useState(''),
    [question, setQuestion] = useState('')
  const [knowledge, setKnowledge] = useState<RecordValue[]>([]),
    [query, setQuery] = useState(''),
    [mode, setMode] = useState<'lexical' | 'semantic' | 'sources'>('lexical'),
    [detail, setDetail] = useState<RecordValue | null>(null),
    [training, setTraining] = useState<RecordValue[]>([]),
    [reviews, setReviews] = useState<RecordValue[]>([]),
    [jobs, setJobs] = useState<TaskView[]>([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [noteForm, setNoteForm] = useState(false)
  const request = useRef(0),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current++
    }
  }, [])
  const run = async (f: () => Promise<void>) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await f()
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const call = async (name: Parameters<Props['call']>[0], args: RecordValue) => {
    const r = await p.call(name, args)
    if (!r.ok) throw new Error(String(r.detail || r.reason))
    return r
  }
  useEffect(() => {
    void p.settings().then(
      (s) => {
        if (mounted.current) setAccount(s.accountId ? String(s.accountId) : '')
      },
      (e) => {
        if (mounted.current) setError(String(e))
      },
    )
  }, [p.settings])
  useEffect(() => {
    if (selection.matchId) {
      setMatch(String(selection.matchId))
      setTab('review')
    }
  }, [selection])
  useEffect(() => {
    if (tab === 'training')
      void run(async () => {
        const [a, b] = await Promise.all([
          call('dota_training', { action: 'list' }),
          call('dota_review', { action: 'list' }),
        ])
        setTraining(rows(a.items))
        setReviews(rows(b.items))
      })
    if (tab === 'knowledge') void loadKnowledge()
  }, [tab])
  useEffect(() => {
    if (tab !== 'review' || !selection.matchId) return
    const id = ++request.current
    void run(async () => {
      const [a, b] = await Promise.all([
        call('dota_timeline', { match_id: selection.matchId, from: String(from), to: String(to) }),
        call('dota_match', {
          match_id: selection.matchId,
          sections: ['overview', 'players', 'curves'],
        }),
      ])
      if (id !== request.current) return
      setTimeline(a)
      setMatchData(b)
      if (a.trace_used) {
        const trace = await call('dota_parse', {
          action: 'positions',
          match_id: selection.matchId,
          from: String(from),
          to: String(to),
          step: 5,
        })
        if (id === request.current) {
          setPositions(rows(trace.items))
          setPositionsTruncated(trace.truncated === true)
        }
      } else {
        setPositions([])
        setPositionsTruncated(false)
      }
    })
    return () => {
      request.current++
    }
  }, [tab, selection.matchId, selection.revision, from, to])
  useEffect(() => {
    if (tab !== 'review') return
    let active = true
    const load = () =>
      p.jobs().then(
        (v) => {
          if (active) setJobs(v)
        },
        () => {},
      )
    void load()
    const timer = setInterval(load, 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [tab, p.jobs])
  async function loadKnowledge() {
    await run(async () => {
      const r =
        mode === 'semantic'
          ? await call('dota_memory', { action: 'search', query })
          : mode === 'sources'
            ? await call('dota_source', { action: 'list', query })
            : await call('dota_coach_note', { action: 'search', query })
      setKnowledge(rows(r.items))
      setDetail(null)
    })
  }
  async function readSource(id: string, offset = 0, append = false) {
    const v = await call('dota_source', { action: 'get', id, offset })
    const record = object(v.record)
    setDetail(
      append ? { ...record, body: String(detail?.body || '') + String(record.body || '') } : record,
    )
    setNextSourceOffset(typeof v.next_offset === 'number' ? v.next_offset : null)
  }
  const submitReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const a = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    await run(async () => {
      await call('dota_review', {
        action: 'save',
        match_id: Number(match),
        from,
        to,
        title: a.title!,
        body: a.body!,
        learner_explanation: a.learner_explanation!,
        evidence_ids: a
          .evidence_ids!.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        trigger: a.trigger!,
        action_rule: a.action_rule!,
        check_method: a.check_method!,
        ...(selection.sessionId ? { session_id: selection.sessionId } : {}),
      })
      setNotice(t('saved'))
    })
  }
  const submitImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const a = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    await run(async () => {
      await call('dota_source', { action: 'import', ...a, origin: 'user_import' })
      setImporting(false)
      setNotice(t('saved'))
      await loadKnowledge()
    })
  }
  const submitNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const a = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    await run(async () => {
      await call('dota_coach_note', { action: 'append', ...a })
      setNoteForm(false)
      setNotice(t('saved'))
      await loadKnowledge()
    })
  }
  const label = (key: Key, name: string, type = 'text', value?: string) => (
    <label key={name}>
      {t(key)}
      <input name={name} type={type} defaultValue={value} required />
    </label>
  )
  const events = rows(timeline?.events).filter((e) => !eventFilter || e.kind === eventFilter)
  const kinds = [...new Set(rows(timeline?.events).map((e) => String(e.kind)))]
  const curves = { points: matchData?.curves || [] } as RecordValue
  return (
    <div className="dota-coach">
      <header>
        <div>
          <span className="dota-eyebrow">DSH · DOTA 2</span>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <span className="dota-emblem" aria-hidden>
          ◈
        </span>
      </header>
      <nav role="tablist" aria-label={t('title')}>
        {(['matches', 'review', 'knowledge', 'training'] as const).map((k) => (
          <button role="tab" key={k} aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(k)}
          </button>
        ))}
      </nav>
      {error && (
        <div role="alert" className="dota-error">
          {t('error')}: {error}
        </div>
      )}
      {notice && (
        <div role="status" className="dota-notice">
          {notice}
        </div>
      )}
      {busy && (
        <div role="status" className="dota-loading">
          {t('loading')}
        </div>
      )}
      <main aria-busy={busy}>
        {tab === 'matches' && (
          <>
            <section className="dota-card">
              <h2>{t('account')}</h2>
              <div className="dota-row">
                <input
                  aria-label={t('account')}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  inputMode="numeric"
                />
                <button
                  onClick={() =>
                    void run(async () => {
                      await p.settings(Number(account))
                      setNotice(t('saved'))
                    })
                  }
                >
                  {t('save')}
                </button>
                <input
                  aria-label={t('hero')}
                  placeholder={t('hero')}
                  value={hero}
                  onChange={(e) => setHero(e.target.value)}
                />
                <select
                  aria-label={t('result')}
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="">{t('all')}</option>
                  <option value="win">{t('win')}</option>
                  <option value="loss">{t('loss')}</option>
                </select>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await call('dota_matches', {
                        account,
                        limit: 30,
                        ...(hero ? { hero } : {}),
                        ...(result ? { result } : {}),
                      })
                      setMatches(rows(r.items))
                    })
                  }
                >
                  {t('load')}
                </button>
              </div>
              <p>{t('noAccount')}</p>
            </section>
            <section className="dota-card">
              <div className="dota-row">
                <input
                  aria-label={t('match')}
                  placeholder={t('match')}
                  value={match}
                  onChange={(e) => setMatch(e.target.value)}
                  inputMode="numeric"
                />
                <button
                  onClick={() => {
                    if (Number(match) > 0) p.select(Number(match))
                  }}
                >
                  {t('open')}
                </button>
              </div>
              <div className="dota-match-list">
                {matches.map((r) => (
                  <button
                    className="dota-match"
                    key={field(r, 'match_id')}
                    onClick={() => p.select(Number(r.match_id))}
                  >
                    <strong>{field(r, 'hero')}</strong>
                    <span className={r.result === 'win' ? 'dota-win' : 'dota-loss'}>
                      {r.result === 'win' ? t('win') : t('loss')}
                    </span>
                    <span>{field(r, 'kda')}</span>
                    <span>{field(r, 'duration')}</span>
                    <small>#{field(r, 'match_id')}</small>
                  </button>
                ))}
              </div>
              {!matches.length && <Empty text={t('empty')} />}
            </section>
          </>
        )}
        {tab === 'review' && (
          <>
            <section className="dota-card">
              <div className="dota-row">
                <label>
                  {t('match')}
                  <input value={match} onChange={(e) => setMatch(e.target.value)} />
                </label>
                <button onClick={() => p.select(Number(match))}>{t('load')}</button>
                <label>
                  {t('from')}
                  <input
                    type="number"
                    value={from}
                    onChange={(e) => setFrom(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t('to')}
                  <input type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} />
                </label>
              </div>
              <div className="dota-row">
                <button
                  disabled={!selection.matchId || busy}
                  onClick={() =>
                    void run(async () => {
                      await call('dota_replay', { action: 'fetch', match_id: Number(match) })
                      setNotice(t('saved'))
                    })
                  }
                >
                  {t('download')}
                </button>
                <button
                  disabled={!selection.matchId || busy}
                  onClick={() =>
                    void run(async () => {
                      await call('dota_parse', { action: 'summary', match_id: Number(match) })
                      p.select(Number(match))
                    })
                  }
                >
                  {t('parse')}
                </button>
              </div>
              {timeline && (
                <p>
                  {t('source')}: {field(timeline, 'source')} · {t('evidence')}:{' '}
                  {field(timeline, 'evidence_id')}
                </p>
              )}
              {jobs.length > 0 && (
                <details>
                  <summary>{t('jobs')}</summary>
                  {jobs.map((j) => (
                    <div className="dota-row" key={j.id}>
                      {j.tool} · {j.status}
                      {j.status === 'running' && (
                        <button onClick={() => void p.cancel(j.id)}>{t('cancel')}</button>
                      )}
                    </div>
                  ))}
                </details>
              )}
            </section>
            <div className="dota-grid">
              <section className="dota-card">
                <h2>{t('economy')}</h2>
                <Economy data={curves} from={from} to={to} label={t('economy')} />
                {Array.isArray(matchData?.missing) && (
                  <small>
                    {t('missing')}: {matchData.missing.map(String).join(', ') || '—'}
                  </small>
                )}
              </section>
              <section className="dota-card">
                <h2>{t('map')}</h2>
                <BattleMap positions={positions} from={from} to={to} label={t('map')} />
                {!positions.length && <p>{t('noTrace')}</p>}
                {positionsTruncated && <p>{t('truncated')}</p>}
                <small>{t('observation')}</small>
              </section>
            </div>
            <section className="dota-card">
              <div className="dota-row">
                <h2>{t('timeline')}</h2>
                <select
                  aria-label={t('filter')}
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                >
                  <option value="">{t('all')}</option>
                  {kinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </div>
              {timeline?.truncated === true && <p>{t('truncated')}</p>}
              {!events.length && <Empty text={t('empty')} />}
              <ol className="dota-events">
                {events.map((e, i) => (
                  <li key={`${e.t}-${i}`}>
                    <time>{time(Number(e.t))}</time>
                    <strong>{field(e, 'kind')}</strong>
                    <span>{field(e, 'detail')}</span>
                    <small>{field(e, 'by')}</small>
                  </li>
                ))}
              </ol>
            </section>
            <section className="dota-card">
              <h2>{t('ask')}</h2>
              <textarea
                aria-label={t('question')}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t('question')}
              />
              <button
                onClick={() =>
                  void run(async () => {
                    await p.draft(
                      `${t('title')} · match_id=${match} · ${from}–${to}s\nevidence_id=${timeline?.evidence_id || ''}\n${question}`,
                    )
                    setNotice(t('draft'))
                  })
                }
              >
                {t('ask')}
              </button>
            </section>
            <section className="dota-card">
              <h2>{t('saveReview')}</h2>
              <form onSubmit={submitReview}>
                <div className="dota-grid">
                  {label('reviewTitle', 'title')}
                  {label('explanation', 'learner_explanation')}
                  {label('trigger', 'trigger')}
                  {label('action', 'action_rule')}
                  {label('check', 'check_method')}
                  {label(
                    'evidenceIds',
                    'evidence_ids',
                    'text',
                    String(timeline?.evidence_id || ''),
                  )}
                </div>
                <label>
                  {t('rule')}
                  <textarea name="body" required />
                </label>
                <button disabled={busy || !timeline}>{t('saveReview')}</button>
              </form>
            </section>
          </>
        )}
        {tab === 'knowledge' && (
          <>
            <section className="dota-card">
              <div className="dota-row">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t('query')}
                  placeholder={t('query')}
                />
                <select
                  aria-label={t('search')}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  {(['lexical', 'semantic', 'sources'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(k)}
                    </option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => void loadKnowledge()}>
                  {t('search')}
                </button>
                <button onClick={() => setImporting(!importing)}>{t('import')}</button>
                <button onClick={() => setNoteForm(!noteForm)}>{t('appendNote')}</button>
              </div>
              <p>{t('memoryHint')}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    let offset = 0
                    for (;;) {
                      const r = object(
                        (await call('dota_memory', { action: 'reindex', offset })).result,
                      )
                      if (r.done) break
                      offset = Number(r.nextOffset)
                      if (!Number.isFinite(offset)) break
                    }
                    setNotice(t('saved'))
                  })
                }
              >
                {t('index')}
              </button>
            </section>
            {importing && (
              <section className="dota-card">
                <h2>{t('import')}</h2>
                <p>{t('noProvider')}</p>
                <form onSubmit={submitImport}>
                  <div className="dota-grid">
                    {label('sourceId', 'source_id')}
                    {label('sourceTitle', 'title')}
                    {label('locator', 'locator')}
                    {label('patch', 'patch', 'text', 'unknown')}
                  </div>
                  <label>
                    {t('body')}
                    <textarea name="body" required rows={8} />
                  </label>
                  <button disabled={busy}>{t('save')}</button>
                </form>
              </section>
            )}
            {noteForm && (
              <section className="dota-card">
                <form onSubmit={submitNote}>
                  <div className="dota-grid">
                    {label('sourceTitle', 'title')}
                    {label('noteSource', 'source_record_id')}
                    {label('sourceId', 'source_id')}
                    {label('stamp', 'stamp')}
                    {label('patch', 'patch', 'text', 'unknown')}
                    <label>
                      {t('noteKind')}
                      <select name="kind">
                        <option value="principle">{t('principle')}</option>
                        <option value="fact">{t('supported')}</option>
                        <option value="counterexample">{t('counterexample')}</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    {t('body')}
                    <textarea name="body" required />
                  </label>
                  <button disabled={busy}>{t('save')}</button>
                </form>
              </section>
            )}
            <div className="dota-grid">
              <section className="dota-card">
                {!knowledge.length && <Empty text={t('noKnowledge')} />}
                <div className="dota-knowledge-list">
                  {knowledge.map((r, i) => {
                    const record = object(r.record || r)
                    return (
                      <button
                        key={String(r.id || r.refId || i)}
                        onClick={() =>
                          void run(async () => {
                            if (r.candidate) {
                              setDetail(r)
                              return
                            }
                            const id = String(record.id || r.id)
                            const v = await call(
                              record.kind === 'source' || mode === 'sources'
                                ? 'dota_source'
                                : record.kind === 'review'
                                  ? 'dota_review'
                                  : record.kind === 'training'
                                    ? 'dota_training'
                                    : 'dota_coach_note',
                              { action: 'get', id },
                            )
                            setDetail(object(v.record))
                            setNextSourceOffset(
                              typeof v.next_offset === 'number' ? v.next_offset : null,
                            )
                          })
                        }
                      >
                        <strong>{field(record, 'title')}</strong>
                        <small>
                          {r.candidate
                            ? t('candidate')
                            : record.needs_recheck
                              ? t('recheck')
                              : field(record, 'patch')}
                        </small>
                        <p>{String(r.snippet || record.body || '').slice(0, 150)}</p>
                      </button>
                    )
                  })}
                </div>
              </section>
              <section className="dota-card">
                {detail ? (
                  <>
                    <h2>{field(detail, 'title')}</h2>
                    <p>
                      {t('status')}: {field(detail, 'evidence_status')} · {t('applicability')}:{' '}
                      {field(detail, 'applicability')}
                    </p>
                    <p>
                      {t('source')}: {field(detail, 'source_id')} · {field(detail, 'locator')}
                    </p>
                    <pre className="dota-body">
                      {String(detail.body || detail.snippet || JSON.stringify(detail, null, 2))}
                    </pre>
                    {nextSourceOffset !== null && detail.kind === 'source' && (
                      <button
                        onClick={() =>
                          void run(() => readSource(String(detail.id), nextSourceOffset, true))
                        }
                      >
                        {t('moreSource')}
                      </button>
                    )}
                    {typeof detail.source_record_id === 'string' && (
                      <button
                        onClick={() =>
                          void run(async () => readSource(String(detail.source_record_id)))
                        }
                      >
                        {t('sourceBody')}
                      </button>
                    )}
                  </>
                ) : (
                  <Empty text={t('details')} />
                )}
              </section>
            </div>
          </>
        )}
        {tab === 'training' && (
          <>
            <p>{t('reported')}</p>
            {!training.length && <Empty text={t('noTraining')} />}
            <div className="dota-grid">
              {training.map((r) => (
                <section className="dota-card" key={field(r, 'id')}>
                  <span className="dota-eyebrow">
                    {t((r.status || 'active') as 'active' | 'paused' | 'completed')}
                  </span>
                  <h2>{field(r, 'title')}</h2>
                  <dl>
                    {(['trigger', 'action_rule', 'check_method'] as const).map((k, i) => (
                      <div key={k}>
                        <dt>{t((['trigger', 'action', 'check'] as const)[i]!)}</dt>
                        <dd>{field(r, k)}</dd>
                      </div>
                    ))}
                  </dl>
                  <select
                    aria-label={t('status')}
                    value={String(r.status)}
                    onChange={(e) =>
                      void run(async () => {
                        const v = await call('dota_training', {
                          action: 'update',
                          id: r.id!,
                          status: e.target.value,
                        })
                        setTraining(training.map((x) => (x.id === r.id ? object(v.record) : x)))
                      })
                    }
                  >
                    {(['active', 'paused', 'completed'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(k)}
                      </option>
                    ))}
                  </select>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const a = Object.fromEntries(new FormData(e.currentTarget)) as Record<
                        string,
                        string
                      >
                      void run(async () => {
                        const v = await call('dota_training', {
                          action: 'checkin',
                          id: r.id!,
                          match_id: Number(a.match_id),
                          body: a.body!,
                          completed: a.completed === 'on',
                        })
                        setTraining(training.map((x) => (x.id === r.id ? object(v.record) : x)))
                      })
                    }}
                  >
                    {label('match', 'match_id', 'number')}
                    <label>
                      {t('report')}
                      <textarea name="body" required />
                    </label>
                    <label className="dota-row">
                      <input type="checkbox" name="completed" />
                      {t('didComplete')}
                    </label>
                    <button disabled={busy}>{t('checkin')}</button>
                  </form>
                  <details>
                    <summary>
                      {t('checkin')} ({rows(r.checkins).length})
                    </summary>
                    {rows(r.checkins).map((c, i) => (
                      <p key={i}>
                        #{field(c, 'match_id')} · {field(c, 'body')} · {field(c, 'at')}
                      </p>
                    ))}
                  </details>
                </section>
              ))}
            </div>
            <section className="dota-card">
              <h2>{t('records')}</h2>
              {reviews.map((r) => (
                <div className="dota-row" key={field(r, 'id')}>
                  <strong>{field(r, 'title')}</strong>
                  <button onClick={() => p.select(Number(r.match_id))}>{t('open')}</button>
                  <button
                    onClick={() =>
                      void run(() => p.draft(`${t('learnPrompt')}\nrecord_id=${r.id}`))
                    }
                  >
                    {t('learn')}
                  </button>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
function Empty({ text }: { text: string }) {
  return <div className="dota-empty">{text}</div>
}
function Economy({
  data,
  from,
  to,
  label,
}: {
  data: RecordValue
  from: number
  to: number
  label: string
}) {
  // OpenDota's helper exports bounded curve samples as {t,gold,xp}.
  const samples = rows(data.points || data.samples || data.radiant_gold_adv)
  const values = samples.map((p, i) => ({
    t: Number(p.t ?? i * 60),
    gold: Number(p.gold_adv ?? p.gold ?? p.value ?? 0),
  }))
  const max = Math.max(1, ...values.map((v) => Math.abs(v.gold))),
    duration = Math.max(to, ...values.map((v) => v.t), 1)
  return (
    <svg viewBox="0 0 600 180" role="img" aria-label={label}>
      <rect
        x={(from / duration) * 600}
        y="0"
        width={(Math.max(0, to - from) / duration) * 600}
        height="180"
        fill="currentColor"
        opacity=".06"
      />
      <line x1="0" y1="90" x2="600" y2="90" stroke="currentColor" opacity=".25" />
      <polyline
        fill="none"
        stroke="#43bdad"
        strokeWidth="2"
        points={values
          .map((p) => `${(p.t / duration) * 600},${90 - (p.gold / max) * 75}`)
          .join(' ')}
      />
      <text x="4" y="16" fill="currentColor" fontSize="12">
        +{max}
      </text>
      <text x="4" y="172" fill="currentColor" fontSize="12">
        −{max}
      </text>
    </svg>
  )
}
function BattleMap({
  positions,
  from,
  to,
  label,
}: {
  positions: RecordValue[]
  from: number
  to: number
  label: string
}) {
  const sample = positions.filter((p) => Number(p.t) >= from && Number(p.t) <= to).slice(-200)
  return (
    <svg role="img" aria-label={label} viewBox="0 0 220 220" className="dota-map">
      <rect width="220" height="220" rx="10" fill="#18352c" />
      <path
        d="M0 35 Q60 70 100 110 T220 190"
        stroke="#407689"
        strokeWidth="16"
        fill="none"
        opacity=".55"
      />
      <path
        d="M18 202H202V18 M18 202V18H202 M18 202L202 18"
        stroke="#b5b588"
        strokeWidth="2"
        opacity=".35"
        fill="none"
      />
      {sample.map((p, i) => (
        <circle
          key={String(p.entity_id) + '-' + i}
          cx={((Number(p.x) + 8500) / 17000) * 220}
          cy={220 - ((Number(p.y) + 8500) / 17000) * 220}
          r="3"
          fill={p.team === 2 ? '#72e2ab' : '#ff8e82'}
          opacity=".7"
        >
          <title>
            {String(p.hero)} · {time(Number(p.t))}
          </title>
        </circle>
      ))}
    </svg>
  )
}
