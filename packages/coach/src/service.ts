import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { stat, mkdir, writeFile } from 'node:fs/promises'
import { CoachStore } from './store.ts'
import { OpenDota } from './http.ts'
import { KnowledgeMemory } from './memory.ts'
import { Tasks } from './tasks.ts'
import { Replays, extractor } from './replay.ts'
import { CoachError, failure, required } from './errors.ts'
import type { CoachConfig } from './config.ts'
import type { RecordValue, ToolName, Json } from './types.ts'
import * as S from './legacy/shape.mjs'
// OpenDota's evolving optional JSON fields are consumed only by the retained presentation helpers.
// Their upstream record has no complete stable schema; all model/wire inputs are validated separately.
type Upstream = Record<string, any>
function raw(value: unknown): Upstream {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Upstream) : {}
}
const json = (value: unknown): RecordValue => JSON.parse(JSON.stringify(value)) as RecordValue
export function seconds(v: Json | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v)
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^-?\d+:\d{1,2}$/.test(s)) {
    const [m, t] = s.replace('-', '').split(':').map(Number)
    if (t < 60) return (s.startsWith('-') ? -1 : 1) * (m * 60 + t)
  }
  throw new CoachError('invalid_arguments', 'Time must be seconds or mm:ss')
}
/** Source 2 uses zero for living entities; do not expose it as a false boolean. */
export function heroLifeState(value: unknown): {
  life_state: number | null
  alive: boolean | null
} {
  const state = typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
  return { life_state: state, alive: state === null ? null : state === 0 }
}
export class CoachService {
  readonly tasks = new Tasks()
  readonly store: CoachStore
  readonly od: OpenDota
  readonly replays: Replays
  private running = new Set<Promise<RecordValue>>()
  private replayQueue: Promise<unknown> = Promise.resolve()
  private closing = false
  readonly memory?: KnowledgeMemory
  private indexQueue: Promise<unknown> = Promise.resolve()
  constructor(
    readonly ctx: Context,
    readonly cfg: CoachConfig,
    readonly home: string,
    readonly pkg: string,
  ) {
    this.store = new CoachStore(home)
    this.store.migrate()
    this.od = new OpenDota(home, cfg, this.tasks.controller.signal)
    this.replays = new Replays(home, cfg, pkg)
    if (cfg.memoryEnabled) this.memory = new KnowledgeMemory(ctx, join(home, 'memory'), cfg)
  }
  invoke(
    name: ToolName,
    args: RecordValue,
    signal?: AbortSignal,
    exec?: ToolRunContext,
  ): Promise<RecordValue> {
    if (this.closing)
      return Promise.resolve({ ok: false, reason: 'unloaded', detail: 'Plugin is unloading' })
    const work = this.execute(
      name,
      args,
      AbortSignal.any([this.tasks.controller.signal, ...(signal ? [signal] : [])]),
      exec,
    )
      .then(async (result) => {
        if (
          this.memory &&
          result.ok &&
          ['dota_source', 'dota_coach_note', 'dota_review', 'dota_training'].includes(name)
        ) {
          try {
            await this.projectPending(exec)
          } catch (error) {
            result.memory_index = { status: 'pending', ...failure(error) }
          }
        }
        return json(result)
      })
      .catch(failure)
    this.running.add(work)
    void work.finally(() => this.running.delete(work))
    return work
  }
  async invokeTool(name: ToolName, args: RecordValue, exec: ToolRunContext): Promise<RecordValue> {
    const result = await this.invoke(name, args, exec.signal, exec),
      serialized = JSON.stringify(result),
      bytes = Buffer.byteLength(serialized)
    if (bytes <= this.cfg.maxOutputBytes) return result
    const dir = join(this.home, 'out', 'tool-results')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${name}-${randomUUID()}.json`)
    await writeFile(file, serialized, { mode: 0o600 })
    return {
      ok: result.ok === true,
      truncated: true,
      result_file: file,
      bytes,
      ...(typeof result.match_id === 'number' ? { match_id: result.match_id } : {}),
      ...(typeof result.evidence_id === 'string' ? { evidence_id: result.evidence_id } : {}),
      hint: 'Read result_file in bounded sections. Saved records remain available through get/list.',
    }
  }
  async dispose(): Promise<void> {
    this.closing = true
    await this.tasks.dispose()
    await this.od.dispose()
    await Promise.allSettled([...this.running])
    await this.indexQueue.catch(() => {})
    await this.memory?.dispose()
    this.store.close()
  }
  private calibrate(trace: Upstream, match: Upstream) {
    return S.calibrateOffset(trace.objectives, match, {
      minAnchors: this.cfg.calibrationMinAnchors,
      matchRatio: this.cfg.calibrationMatchRatio,
      residualSeconds: this.cfg.calibrationResidualSeconds,
    })
  }
  private async match(id: number, signal: AbortSignal): Promise<Upstream> {
    const m = raw(await this.od.get(`/matches/${id}`, signal, 300000))
    if (!m.match_id || !Array.isArray(m.players) || !m.players.length)
      throw new CoachError('not_parsed', 'Match data is unavailable or not parsed')
    return m
  }
  private async constants(signal: AbortSignal) {
    const [h, i] = await Promise.all([
      this.od.get('/constants/heroes', signal, 604800000),
      this.od.get('/constants/items', signal, 604800000),
    ])
    return { heroes: normalizeHeroes(h), items: normalizeItems(i) }
  }
  private async execute(
    name: ToolName,
    a: RecordValue,
    signal: AbortSignal,
    exec?: ToolRunContext,
  ): Promise<RecordValue> {
    signal.throwIfAborted()
    if (name === 'dota_status') {
      const bin = extractor(this.cfg, this.pkg)
      return {
        ok: true,
        version: '0.1.0',
        account: { configured: this.store.setting('accountId') || this.cfg.accountId || null },
        home: this.home,
        storage: 'sqlite',
        rate: this.od.limiter.snapshot(),
        extractor: {
          path: bin,
          ready: await stat(bin).then(
            (s) => s.isFile(),
            () => false,
          ),
        },
        video_tools: this.providers(),
        tasks: json(this.tasks.list()) as Json,
        source_import_available: true,
        memory: {
          engine: this.memory ? 'MemOS Local 2.0.21' : 'disabled',
          ...this.store.projectionState(),
        },
      }
    }
    if (name === 'dota_memory') return this.memoryTool(a, signal, exec)
    if (name === 'dota_source')
      return a.action === 'fetch' ? this.fetchSource(a, signal, exec) : this.store.source(a)
    if (name === 'dota_coach_note') {
      const out = this.store.note(a)
      if ((a.action || 'append') === 'append') out.export_path = this.store.exportMarkdown()
      return out
    }
    if (name === 'dota_review') return this.store.review(a)
    if (name === 'dota_training') return this.store.training(a)
    if (name === 'dota_matches') {
      const account = String(
        a.account || this.store.setting('accountId') || this.cfg.accountId || '',
      )
      if (!account || account === '0')
        throw new CoachError(
          'no_account',
          'Enter an OpenDota account ID in settings or the account parameter',
        )
      let id = Number(account)
      if (!Number.isSafeInteger(id) || id <= 0) {
        const hits = await this.od.get('/search?q=' + encodeURIComponent(account), signal)
        if (!Array.isArray(hits) || hits.length !== 1)
          throw new CoachError('ambiguous_account', 'Use a numeric account ID', {
            candidates: hits,
          })
        id = Number(raw(hits[0]).account_id)
      }
      const limit = Math.max(1, Math.min(50, Number(a.limit) || 10))
      const rows = await this.od.get(`/players/${id}/matches?limit=100`, signal)
      const { heroes } = await this.constants(signal)
      const hero = a.hero ? resolveHero(a.hero, heroes) : null
      if (a.hero && !hero) throw new CoachError('hero_not_found', 'Unknown hero')
      const items = (Array.isArray(rows) ? rows : [])
        .map(raw)
        .filter((r) => !hero || r.hero_id === hero.id)
        .filter(
          (r) =>
            !a.since_days || r.start_time * 1000 >= Date.now() - Number(a.since_days) * 86400000,
        )
        .map((r) => S.matchSummaryRow(r, heroes, id, { forceSelf: true }))
        .filter((r) => !a.result || r.result === a.result)
        .slice(0, limit)
      return {
        ok: true,
        ...this.od.provenance(`/players/${id}/matches?limit=100`),
        account_id: id,
        items: json(items) as Json,
      }
    }
    if (name === 'dota_hero') {
      const { heroes } = await this.constants(signal),
        hero = resolveHero(a.hero, heroes)
      if (!hero) throw new CoachError('hero_not_found', 'Unknown hero')
      const [stats, matchups, itemPop] = await Promise.all([
        this.od.get('/heroStats', signal),
        this.od.get(`/heroes/${hero.id}/matchups`, signal),
        this.od.get(`/heroes/${hero.id}/itemPopularity`, signal),
      ])
      return json({
        ok: true,
        ...this.od.provenance('/heroStats'),
        sources: [
          { dataset: 'heroStats', ...this.od.provenance('/heroStats') },
          { dataset: 'matchups', ...this.od.provenance(`/heroes/${hero.id}/matchups`) },
          { dataset: 'itemPopularity', ...this.od.provenance(`/heroes/${hero.id}/itemPopularity`) },
        ],
        patch: 'unknown',
        ...S.heroBrief({
          hero,
          stat: (Array.isArray(stats) ? stats : []).map(raw).find((s) => s.id === hero.id),
          matchups,
          itemPop,
          heroes,
        }),
      })
    }
    const id = Number(a.match_id)
    if (name === 'dota_replay' && a.action === 'list') return this.replays.list()
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new CoachError('invalid_arguments', 'match_id must be a positive safe integer')
    if (name === 'dota_replay' && (a.action === 'inspect' || a.action === 'delete'))
      return this.tasks.run(
        `${a.action}:${id}`,
        async (taskSignal) => {
          const operation = this.replayQueue
            .catch(() => {})
            .then(async () => {
              taskSignal.throwIfAborted()
              return a.action === 'delete'
                ? this.replays.remove(id)
                : { ok: true, manifest: await this.replays.inspect(id) }
            })
          this.replayQueue = operation
          return operation
        },
        signal,
      )
    const match = await this.match(id, signal)
    if (name === 'dota_replay' || name === 'dota_parse') {
      if (name === 'dota_replay' && !['fetch', undefined].includes(a.action as string | undefined))
        throw new CoachError('invalid_arguments', 'Unknown replay action')
      const job = await this.tasks.run(
        `${name}:${id}`,
        async (taskSignal) => {
          const run = async () => {
            const bounded = AbortSignal.any([
              taskSignal,
              AbortSignal.timeout(
                name === 'dota_replay' ? this.cfg.downloadTimeoutMs : this.cfg.parseTimeoutMs,
              ),
            ])
            return name === 'dota_replay'
              ? this.replays.fetch(id, match.replay_url, bounded)
              : this.replays.parse(id, bounded)
          }
          const p = this.replayQueue.catch(() => {}).then(run)
          this.replayQueue = p
          return p
        },
        signal,
      )
      if (!job.ok || name === 'dota_replay') return { ...job, match_id: id }
    }
    const { heroes, items } = await this.constants(signal)
    const trace = await this.replays.trace(id),
      calibration = trace ? this.calibrate(trace, match) : null,
      offset = calibration?.ok ? calibration.offset_seconds : null
    const from = seconds(a.from, 0),
      to = seconds(a.to, Number(match.duration) || 10000)
    if (to < from) throw new CoachError('invalid_arguments', 'to must be >= from')
    const missing = ['teamfights', 'objectives', 'radiant_gold_adv', 'radiant_xp_adv'].filter(
      (k) => !Array.isArray(match[k]) || !match[k].length,
    )
    if (!(match.players as Upstream[]).some((p) => Array.isArray(p.deaths_log)))
      missing.push('deaths_log')
    const base = {
      ok: true,
      match_id: id,
      ...this.od.provenance(`/matches/${id}`),
      patch: match.patch ?? 'unknown',
      missing,
    }
    if (name === 'dota_match') {
      const sections =
        Array.isArray(a.sections) && a.sections.length ? a.sections : ['overview', 'players']
      const out: Upstream = { ...base, sections, trace_ready: !!trace }
      for (const section of sections) {
        if (section === 'overview') out.overview = S.matchOverview(match, heroes)
        if (section === 'players')
          out.players = S.matchPlayers(match, heroes, items.byId, {
            accountId: Number(a.account) || this.cfg.accountId,
          })
        if (section === 'draft') out.draft = S.matchDraft(match, heroes)
        if (section === 'items') out.items = S.matchItemTimings(match, heroes, items.byKey)
        if (section === 'fights') out.fights = S.matchFights(match, heroes)
        if (section === 'objectives') out.objectives = S.matchObjectives(match)
        if (section === 'curves') out.curves = S.matchCurves(match)
        if (section === 'wards') out.wards = S.matchWards(match, heroes)
      }
      const evidence = this.store.evidence(id, { sections }, json(out))
      return json({ ...out, evidence_id: evidence.id })
    }
    if (name === 'dota_timeline') {
      const out = json({
        ...base,
        calibration,
        source: offset !== null ? 'opendota+local_trace' : 'opendota',
        trace_used: offset !== null,
        ...(offset !== null ? { trace_provenance: await this.replays.inspect(id) } : {}),
        trace_unavailable_reason: offset === null ? calibration?.reason || 'no_trace' : null,
        window: { from, to },
        ...S.buildTimeline({
          match,
          heroes,
          itemsByKey: items.byKey,
          trace: offset !== null ? trace : null,
          offset,
          from,
          to,
          teams: Array.isArray(a.teams) ? a.teams.map(String) : null,
          limit: Math.max(1, Math.min(500, Number(a.limit) || 250)),
        }),
      })
      const evidence = this.store.evidence(id, { from, to }, out)
      return { ...out, evidence_id: evidence.id }
    }
    if (name === 'dota_parse') {
      if (!trace) throw new CoachError('no_trace', 'No trace was produced')
      const baseTrace = {
        ...base,
        source: 'local_trace',
        trace_provenance: await this.replays.inspect(id),
        calibration,
        offset_seconds: offset,
      }
      if ((a.action || 'summary') === 'summary')
        return json({
          ...baseTrace,
          samples: trace.heroes.length,
          wards: trace.wards.length,
          objectives: trace.objectives.length,
        })
      if (offset === null)
        throw new CoachError(
          'calibration_failed',
          'Spatial data cannot be aligned; match events remain available',
          { calibration: json(calibration) },
        )
      let rows: unknown[] = []
      if (a.action === 'positions') {
        const only = Array.isArray(a.heroes)
          ? a.heroes.map((h) =>
              String(resolveHero(h, heroes)?.name || h)
                .replaceAll(/[^a-z]/gi, '')
                .toLowerCase(),
            )
          : []
        const last = new Map<string, number>()
        rows = trace.heroes
          .filter((s) => {
            const t = Number(s.t) - offset,
              key = String(s.entity_id)
            if (
              s.entity_kind !== 'real_hero' ||
              t < from ||
              t > to ||
              (only.length &&
                !only.includes(
                  String(s.hero)
                    .replace(/[^a-z]/gi, '')
                    .toLowerCase(),
                ))
            )
              return false
            if (t - (last.get(key) ?? -Infinity) < Math.max(1, Number(a.step) || 5)) return false
            last.set(key, t)
            return true
          })
          .map((s) => ({ ...s, ...heroLifeState(s.alive), t: Number(s.t) - offset }))
      } else if (a.action === 'wards')
        rows = trace.wards
          .map((w) => ({ ...w, t: Number(w.t) - offset }))
          .filter((w) => w.t >= from && w.t <= to)
      else if (a.action === 'deaths')
        rows = S.joinDeaths(match, heroes, trace, offset, { from, to }) || []
      else throw new CoachError('invalid_arguments', 'Unknown parse action')
      const out = json({
        ...baseTrace,
        window: { from, to },
        total: rows.length,
        truncated: rows.length > 600,
        items: rows.slice(0, 600),
        observation_only: true,
      })
      return { ...out, evidence_id: this.store.evidence(id, { from, to }, out).id! }
    }
    throw new CoachError('invalid_arguments', 'Unknown tool')
  }
  private async projectPending(exec?: ToolRunContext): Promise<void> {
    const operation = this.indexQueue
      .catch(() => {})
      .then(async () => {
        if (!this.memory) return
        for (const item of this.store.pendingProjections()) {
          const result = await this.memory.request(
            'project',
            { record: item.record, previous: item.previous },
            exec,
            this.tasks.controller.signal,
          )
          this.store.markProjected(String(item.record.id), item.hash, String(result.id))
        }
      })
    this.indexQueue = operation
    await operation
  }
  private async memoryTool(
    a: RecordValue,
    signal: AbortSignal,
    exec?: ToolRunContext,
  ): Promise<RecordValue> {
    if (!this.memory)
      throw new CoachError('memory_disabled', 'Enable memoryEnabled to use MemOS Local')
    if (a.action === 'status')
      return {
        ok: true,
        engine: 'MemOS Local 2.0.21',
        health: await this.memory.request('health', {}, exec, signal),
        ...this.store.projectionState(),
      }
    await this.projectPending(exec)
    if (a.action === 'search') {
      const result = await this.memory.request(
        'search',
        {
          query: required(a.query, 'query'),
          limit: Number(a.limit) || 10,
          timeout_ms: this.cfg.memorySearchTimeoutMs,
        },
        exec,
        signal,
      )
      const hits = Array.isArray(result.hits) ? result.hits : []
      return {
        ok: true,
        engine: 'MemOS Local 2.0.21',
        items: hits
          .map((h) => {
            const hit = raw(h)
            const record = this.store.projectionRecord(String(hit.refId))
            if (String(hit.refId).startsWith('dota:') && !record) return null
            return json({
              ...hit,
              snippet: String(hit.snippet || '').replace(/\n→ call `memos_[^\n]*/g, ''),
              read_with: record
                ? {
                    tool:
                      record.kind === 'source'
                        ? 'dota_source'
                        : record.kind === 'review'
                          ? 'dota_review'
                          : record.kind === 'training'
                            ? 'dota_training'
                            : 'dota_coach_note',
                    action: 'get',
                    id: record.id,
                  }
                : {
                    tool: 'dota_memory',
                    action: 'get',
                    id: hit.refId,
                    kind: String(hit.refId).startsWith('po_')
                      ? 'policy'
                      : hit.refKind === 'world-model'
                        ? 'world-model'
                        : hit.refKind === 'skill'
                          ? 'skill'
                          : hit.refKind === 'episode'
                            ? 'episode'
                            : 'trace',
                  },
              record,
              candidate: !record,
              evidence_status: record?.evidence_status || 'generated_candidate',
              instruction_status: 'retrieved_material_only',
            })
          })
          .filter((item): item is RecordValue => item !== null),
        retrieval: 'hybrid_when_local_embeddings_ready',
        ...this.store.projectionState(),
      }
    }
    if (a.action === 'get')
      return {
        ok: true,
        record: await this.memory.request(
          'get',
          { id: required(a.id, 'id'), kind: a.kind || 'trace' },
          exec,
          signal,
        ),
        candidate: true,
      }
    if (a.action === 'reindex')
      return {
        ok: true,
        result: await this.memory.request(
          'rebuild',
          { offset: Number(a.offset) || 0 },
          exec,
          signal,
        ),
      }
    if (a.action === 'learn') {
      if (!exec?.agent)
        throw new CoachError('model_route_missing', 'Learn from an owning DSH conversation')
      const record = this.store.get(required(a.record_id, 'record_id'), 'review')
      return this.tasks.run(
        `learn:${record.id}`,
        async (taskSignal): Promise<RecordValue> => {
          const learned = this.store.setting(`learned:${record.id}`)
          if (learned) return { ok: true, candidate: true, deduplicated: true, result: learned }
          const result = await this.memory!.request(
            'learn',
            { record: this.store.learningContext(String(record.id)) },
            exec,
            taskSignal,
          )
          this.store.setting(`learned:${record.id}`, result)
          return { ok: true, candidate: true, basis: 'grounded_review_and_user_report', result }
        },
        signal,
      )
    }
    if (a.action === 'feedback')
      return {
        ok: true,
        basis: 'user_report',
        result: await this.memory.request('feedback', a, exec, signal),
      }
    throw new CoachError('invalid_arguments', 'Unknown memory action')
  }
  private providers(): string[] {
    return ['bili_subtitle', 'yt_subtitle', 'forum_fetch', 'reddit_json'].filter(
      (t) => !!this.ctx.tools.get(t),
    )
  }
  private async fetchSource(
    a: RecordValue,
    signal: AbortSignal,
    exec?: ToolRunContext,
  ): Promise<RecordValue> {
    const provider = required(a.provider_tool, 'provider_tool')
    if (!this.providers().includes(provider))
      throw new CoachError(
        'source_provider_unavailable',
        'Import subtitles or article text with action=import',
        { available: this.providers() },
      )
    if (!exec)
      throw new CoachError(
        'source_requires_session',
        'Fetch from a DSH conversation; the panel can import text',
      )
    const outcome = await this.ctx.tools.execute({
      callId: `${exec.callId}:source:${randomUUID()}` as typeof exec.callId,
      rootCallId: exec.rootCallId,
      parent: exec.token,
      name: provider,
      arguments: a.provider_args || {},
      signal,
      agent: exec.agent,
    })
    if (outcome.isError)
      throw new CoachError('source_fetch_failed', 'Source plugin failed', {
        content: json(outcome.content) as Json,
      })
    for (const context of outcome.additionalContexts || []) exec.deferContext(context)
    const content = outcome.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
    if (!content.trim())
      throw new CoachError(
        'source_body_missing',
        'No readable text returned; import the full transcript',
      )
    // Keep the returned material verbatim; a file pointer is not a transcript.
    let payload: Upstream = {}
    try {
      payload = raw(JSON.parse(content))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    if (
      payload.ok === false ||
      ['title_only', 'comments_only'].includes(String(payload.evidence_level))
    )
      throw new CoachError('source_body_missing', 'Provider did not return source body evidence')
    const post = raw(payload.post)
    const body =
      typeof payload.transcript === 'string'
        ? payload.transcript
        : typeof payload.body === 'string'
          ? payload.body
          : typeof payload.text === 'string'
            ? payload.text
            : typeof payload.subtitle === 'string'
              ? payload.subtitle
              : payload.evidence_level === 'post_body' && typeof post.body === 'string'
                ? post.body
                : payload.evidence_level === 'post_body' && typeof post.selftext === 'string'
                  ? post.selftext
                  : null
    if (!body || body.trim().length < 20)
      throw new CoachError(
        'source_body_missing',
        'Provider returned no full readable body; import its transcript text',
      )
    const sourceId = String(
      payload.source_id || a.source_id || (payload.bvid ? String(payload.bvid) : ''),
    )
    if (a.source_id && payload.source_id && a.source_id !== payload.source_id)
      throw new CoachError(
        'invalid_evidence',
        'Requested source ID differs from the provider response',
      )
    return this.store.source({
      ...a,
      action: 'import',
      source_id: sourceId,
      title: String(a.title || payload.title || post.title || `Material ${sourceId}`),
      locator: String(
        a.locator ||
          payload.url ||
          `returned transcript · ${payload.language || payload.lang || 'language unknown'}`,
      ),
      body,
      material_type: provider.endsWith('subtitle') ? 'transcript' : 'article',
      completeness: payload.truncated ? 'excerpt' : 'unknown',
      origin: provider.startsWith('bili')
        ? 'bilibili'
        : provider.startsWith('yt')
          ? 'youtube'
          : 'forum',
    })
  }
}
function normalizeHeroes(value: unknown) {
  const list = Object.entries(raw(value)).map(([id, v]) => {
    const h = raw(v)
    return {
      id: Number(h.id || id),
      npc: String(h.name || ''),
      name: String(h.localized_name || h.name || ''),
      roles: h.roles || [],
      primaryAttr: h.primary_attr,
      attackType: h.attack_type,
    }
  })
  return {
    list,
    byId: new Map(list.map((h) => [h.id, h])),
    byNpc: new Map(list.map((h) => [h.npc.replace(/^npc_dota_hero_/, ''), h])),
    byName: new Map(list.map((h) => [h.name.toLowerCase(), h])),
  }
}
function normalizeItems(value: unknown) {
  const list = Object.entries(raw(value)).map(([key, v]) => {
    const i = raw(v)
    return { ...i, key, id: Number(i.id), dname: String(i.dname || key), cost: Number(i.cost) || 0 }
  })
  return { byKey: new Map(list.map((i) => [i.key, i])), byId: new Map(list.map((i) => [i.id, i])) }
}
function resolveHero(value: unknown, heroes: ReturnType<typeof normalizeHeroes>) {
  const s = String(value || '')
    .toLowerCase()
    .trim()
  return (
    heroes.byId.get(Number(s)) ||
    heroes.byNpc.get(s.replace(/^npc_dota_hero_/, '')) ||
    heroes.byName.get(s) ||
    heroes.list.find((h) => h.name.toLowerCase() === s.replaceAll('_', ' '))
  )
}
