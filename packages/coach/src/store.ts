import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CoachError, required } from './errors.ts'
import type { Json, RecordValue } from './types.ts'
const text = z.string().trim().min(1)
const sourceInput = z.object({
  source_id: text,
  title: text,
  body: text.max(2_000_000),
  locator: text,
  material_type: z.enum(['transcript', 'article', 'user_notes', 'comment']).default('user_notes'),
  origin: z.enum(['user_import', 'bilibili', 'youtube', 'forum', 'match']).default('user_import'),
  patch: z.string().default('unknown'),
  hero: z.string().default(''),
  tags: z.array(z.string()).default([]),
  completeness: z.enum(['full', 'excerpt', 'unknown']).default('unknown'),
})
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()
/** Synchronous transactions serialize writes in one Host; WAL/busy_timeout cover other processes. */
export class CoachStore {
  readonly db: DatabaseSync
  constructor(readonly home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(join(home, 'coach.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`)
    const v = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (v > 2) throw new CoachError('database_version', 'Database was written by a newer plugin')
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dedupe(key TEXT PRIMARY KEY,id TEXT NOT NULL REFERENCES records(id));
      CREATE TABLE IF NOT EXISTS migrations(key TEXT PRIMARY KEY,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projections(id TEXT PRIMARY KEY REFERENCES records(id),hash TEXT NOT NULL,trace_id TEXT,pending INTEGER NOT NULL DEFAULT 1,error TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,kind UNINDEXED,body,tokenize='trigram');
      PRAGMA user_version=2; COMMIT;`)
  }
  close(): void {
    if (this.db.isOpen) this.db.close()
  }
  transaction<T>(f: () => T): T {
    if (this.db.isTransaction) return f()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = f()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  private put(kind: string, data: RecordValue, id: string = randomUUID()): RecordValue {
    const old = this.getOptional(id),
      row: RecordValue = {
        ...data,
        id,
        kind,
        created_at: old?.created_at ?? now(),
        updated_at: now(),
      }
    this.db
      .prepare(
        'INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at',
      )
      .run(id, kind, JSON.stringify(row), String(row.created_at), String(row.updated_at))
    this.db.prepare('DELETE FROM search WHERE id=?').run(id)
    this.db.prepare('INSERT INTO search VALUES(?,?,?)').run(id, kind, JSON.stringify(row))
    if (['source', 'note', 'review', 'training'].includes(kind))
      this.db
        .prepare(
          'INSERT INTO projections(id,hash,pending) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,pending=1,error=NULL',
        )
        .run(id, hash(JSON.stringify(row)))
    return row
  }
  private getOptional(id: string): RecordValue | undefined {
    const r = this.db.prepare('SELECT data FROM records WHERE id=?').get(id)
    return r ? (JSON.parse(String(r.data)) as RecordValue) : undefined
  }
  get(id: string, kind?: string): RecordValue {
    const r = this.getOptional(id)
    if (!r || (kind && r.kind !== kind))
      throw new CoachError('not_found', 'Record not found', { id })
    return r
  }
  list(kind: string, args: RecordValue = {}): RecordValue[] {
    const limit = Math.max(1, Math.min(200, Number(args.limit) || 30))
    const q = String(args.query || '').trim()
    const rows =
      q.length >= 3
        ? this.db
            .prepare(
              'SELECT r.data FROM records r JOIN search s ON r.id=s.id WHERE r.kind=? AND search MATCH ? ORDER BY r.updated_at DESC LIMIT ?',
            )
            .all(kind, '"' + q.replaceAll('"', '""') + '"', limit)
        : this.db
            .prepare('SELECT data FROM records WHERE kind=? ORDER BY updated_at DESC LIMIT 2000')
            .all(kind)
    return rows
      .map((r) => JSON.parse(String(r.data)) as RecordValue)
      .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
      .filter((r) => !args.hero || r.hero === args.hero)
      .filter((r) => !args.patch || r.patch === args.patch)
      .filter((r) => !args.tag || (Array.isArray(r.tags) && r.tags.includes(args.tag)))
      .slice(0, limit)
  }
  setting(key: string, value?: Json): Json {
    if (value !== undefined)
      this.db
        .prepare(
          'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .run(key, JSON.stringify(value))
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)
    return r ? (JSON.parse(String(r.value)) as Json) : null
  }
  source(args: RecordValue): RecordValue {
    const action = String(args.action || 'list')
    if (action === 'list') return { ok: true, items: this.list('source', args) }
    if (action === 'get') {
      const source = this.get(required(args.id, 'id'), 'source'),
        body = String(source.body),
        offset = Math.max(0, Number(args.offset) || 0),
        end = Math.min(
          body.length,
          offset + Math.max(100, Math.min(20000, Number(args.max_chars) || 12000)),
        )
      return {
        ok: true,
        record: { ...source, body: body.slice(offset, end) },
        body_total_chars: body.length,
        offset,
        next_offset: end < body.length ? end : null,
      }
    }
    if (action !== 'import') throw new CoachError('invalid_arguments', 'Use fetch/import/list/get')
    const input = sourceInput.parse(args)
    const content_hash = hash(input.body)
    const key = `source:${input.source_id}:${input.locator}:${content_hash}:${input.material_type}:${input.origin}:${input.patch}`
    return this.transaction(() => {
      const old = this.db.prepare('SELECT id FROM dedupe WHERE key=?').get(key)
      if (old) return { ok: true, deduplicated: true, record: this.get(String(old.id)) }
      const row = this.put('source', {
        ...input,
        content_hash,
        captured_at: now(),
        evidence_status: 'readable_material',
      })
      this.db.prepare('INSERT INTO dedupe VALUES(?,?)').run(key, String(row.id))
      return { ok: true, deduplicated: false, record: row }
    })
  }
  note(args: RecordValue): RecordValue {
    const action = String(args.action || 'append')
    if (action === 'list' || action === 'search')
      return {
        ok: true,
        items: this.list('note', args).map((r) => this.applicability(r, args.current_patch)),
      }
    if (action === 'get')
      return {
        ok: true,
        record: this.applicability(this.get(required(args.id, 'id'), 'note'), args.current_patch),
      }
    if (action === 'revise')
      return this.transaction(() => {
        const previous = this.get(required(args.id, 'id'), 'note')
        const created = this.note({ ...args, action: 'append' })
        const record = created.record as RecordValue
        return this.transaction(() => {
          this.put(
            'note',
            { ...previous, superseded_by: record.id, needs_recheck: true },
            String(previous.id),
          )
          return {
            ok: true,
            record: this.put('note', { ...record, supersedes: previous.id }, String(record.id)),
          }
        })
      })
    if (action === 'recheck') {
      const row = this.get(required(args.id, 'id'), 'note')
      return {
        ok: true,
        record: this.transaction(() =>
          this.put(
            'note',
            {
              ...row,
              needs_recheck: true,
              recheck_reason: String(args.body || 'Requested recheck'),
            },
            String(row.id),
          ),
        ),
      }
    }
    if (action !== 'append') throw new CoachError('invalid_arguments', 'Unknown note action')
    const input = z
      .object({
        kind: z.enum(['fact', 'principle', 'counterexample']),
        title: text,
        body: text,
        stamp: text,
        source_id: text,
        source_record_id: text,
        patch: z.string().default('unknown'),
        hero: z.string().default(''),
        tags: z.array(z.string()).default([]),
        match_id: z.number().int().positive().optional(),
      })
      .parse(args)
    if (!/^\[[^\]·]+·[^\]·]+·[^\]·]+\]$/.test(input.stamp))
      throw new CoachError('invalid_arguments', 'stamp must contain [patch · date · source]')
    const source = this.get(input.source_record_id, 'source')
    if (source.source_id !== input.source_id)
      throw new CoachError(
        'invalid_evidence',
        'source_id does not match the readable source record',
      )
    if (
      typeof source.body !== 'string' ||
      source.body.trim().length < 20 ||
      !source.locator ||
      source.material_type === 'comment'
    )
      throw new CoachError('invalid_evidence', 'A title, comment or source ID is insufficient')
    const { kind: category, ...rest } = input
    return this.transaction(() => ({
      ok: true,
      record: this.put('note', {
        ...rest,
        category,
        evidence_status: 'supported_by_material',
        needs_recheck: category === 'counterexample',
        verification: 'material_linked_not_independently_verified',
      }),
    }))
  }
  private applicability(r: RecordValue, current: Json | undefined): RecordValue {
    return {
      ...r,
      applicability:
        r.category === 'principle'
          ? 'long_term_principle'
          : !r.patch || r.patch === 'unknown' || !current
            ? 'patch_unknown'
            : r.patch !== current
              ? 'outdated'
              : 'patch_matches',
      needs_recheck: Boolean(
        r.needs_recheck || (r.category !== 'principle' && current && r.patch !== current),
      ),
    }
  }
  review(args: RecordValue): RecordValue {
    const action = String(args.action || 'list')
    if (action === 'list') return { ok: true, items: this.list('review', args) }
    if (action === 'get') return { ok: true, record: this.get(required(args.id, 'id'), 'review') }
    if (action !== 'save') throw new CoachError('invalid_arguments', 'Unknown review action')
    const input = z
      .object({
        match_id: z.number().int().positive(),
        from: z.number().finite(),
        to: z.number().finite(),
        title: text,
        body: text,
        learner_explanation: text,
        evidence_ids: z.array(text).min(1).max(20),
        trigger: text,
        action_rule: text,
        check_method: text,
        session_id: z.string().optional(),
      })
      .parse(args)
    if (input.to < input.from) throw new CoachError('invalid_arguments', 'to must be >= from')
    for (const id of input.evidence_ids) {
      const e = this.get(id)
      if (e.kind === 'evidence' && e.match_id !== input.match_id)
        throw new CoachError('invalid_evidence', 'Match evidence belongs to a different match')
      if (e.kind !== 'source' && e.kind !== 'evidence')
        throw new CoachError(
          'invalid_evidence',
          'Review must cite readable source or match evidence',
        )
    }
    return this.transaction(() => {
      const review = this.put('review', { ...input })
      const training = this.put('training', {
        title: input.title,
        review_id: String(review.id),
        match_id: input.match_id,
        trigger: input.trigger,
        action_rule: input.action_rule,
        check_method: input.check_method,
        status: 'active',
        checkins: [],
        completion_basis: 'user_report',
      })
      return { ok: true, record: review, training }
    })
  }
  /** Give auxiliary learning readable evidence, not opaque IDs alone. */
  learningContext(id: string): RecordValue {
    const review = this.get(id, 'review')
    const ids = review.evidence_ids as string[]
    const budget = Math.floor(24000 / ids.length)
    const evidence = ids.map((id) => {
      const row = this.get(id)
      const text = typeof row.body === 'string' ? row.body : JSON.stringify(row.body)
      return {
        id,
        content_hash: row.content_hash ?? null,
        source: row.source ?? row.origin ?? 'unknown',
        locator: row.locator ?? row.window ?? null,
        captured_at: row.captured_at ?? row.created_at ?? null,
        patch: row.patch ?? 'unknown',
        excerpt: text.slice(0, budget),
        excerpt_truncated: text.length > budget,
      }
    })
    return {
      ...review,
      evidence,
      training: this.training({ action: 'create', review_id: id }).record!,
    }
  }
  training(args: RecordValue): RecordValue {
    const action = String(args.action || 'list')
    if (action === 'list') return { ok: true, items: this.list('training', args) }
    if (action === 'create') {
      const review = this.get(required(args.review_id, 'review_id'), 'review')
      const saved = this.db
        .prepare(
          "SELECT data FROM records WHERE kind='training' AND json_extract(data,'$.review_id')=? LIMIT 1",
        )
        .get(String(review.id))
      const old = saved ? (JSON.parse(String(saved.data)) as RecordValue) : undefined
      if (old) return { ok: true, deduplicated: true, record: old }
      throw new CoachError('invalid_arguments', 'Save a review to create its single training goal')
    }
    const row = this.get(required(args.id, 'id'), 'training')
    if (action === 'get') return { ok: true, record: row }
    if (action === 'update') {
      const status = z.enum(['active', 'paused', 'completed']).parse(args.status)
      return this.transaction(() => ({
        ok: true,
        record: this.put(
          'training',
          { ...row, status, completion_basis: 'user_report' },
          String(row.id),
        ),
      }))
    }
    if (action !== 'checkin') throw new CoachError('invalid_arguments', 'Unknown training action')
    const checkin = z
      .object({ match_id: z.number().int().positive(), body: text, completed: z.boolean() })
      .parse(args)
    return this.transaction(() => ({
      ok: true,
      record: this.put(
        'training',
        {
          ...row,
          checkins: [
            ...(Array.isArray(row.checkins) ? row.checkins : []),
            { ...checkin, at: now(), basis: 'user_report' },
          ],
        },
        String(row.id),
      ),
    }))
  }
  evidence(matchId: number, window: RecordValue, body: RecordValue): RecordValue {
    const content = JSON.stringify(body)
    const key = `evidence:${matchId}:${hash(JSON.stringify(window) + content)}`
    return this.transaction(() => {
      const old = this.db.prepare('SELECT id FROM dedupe WHERE key=?').get(key)
      if (old) return this.get(String(old.id))
      const row = this.put('evidence', {
        match_id: matchId,
        window,
        body,
        content_hash: hash(content),
        source: body.source ?? 'unknown',
        captured_at: body.captured_at ?? now(),
        snapshot_at: now(),
      })
      this.db.prepare('INSERT INTO dedupe VALUES(?,?)').run(key, String(row.id))
      return row
    })
  }
  migrate(): RecordValue {
    const backup = join(this.home, 'legacy-backup')
    mkdirSync(backup, { recursive: true, mode: 0o700 })
    let imported = 0
    for (const file of ['library.md', 'principles.md', 'coach-log.jsonl']) {
      const path = join(this.home, file)
      if (!existsSync(path)) continue
      const body = readFileSync(path, 'utf8'),
        digest = hash(body),
        key = `legacy:${file}:${digest}`
      const backupPath = join(backup, `${digest}-${file}`)
      if (!existsSync(backupPath)) copyFileSync(path, backupPath)
      this.transaction(() => {
        if (this.db.prepare('SELECT key FROM migrations WHERE key=?').get(key)) return
        const entries = file.endsWith('.jsonl')
          ? body.split('\n').filter(Boolean)
          : body.split(/(?=^##\s)/m).filter((s) => s.trim())
        for (const entry of entries) {
          const itemKey = `legacy-entry:${file}:${hash(entry)}`
          if (this.db.prepare('SELECT key FROM migrations WHERE key=?').get(itemKey)) continue
          this.put('note', {
            title: `Legacy ${file}`,
            body: entry,
            category: file === 'principles.md' ? 'principle' : 'fact',
            patch: 'unknown',
            evidence_status: 'unverified_legacy',
            needs_recheck: true,
            legacy_file: file,
            legacy_hash: hash(entry),
          })
          this.db.prepare('INSERT INTO migrations VALUES(?,?)').run(itemKey, now())
          imported++
        }
        this.db.prepare('INSERT INTO migrations VALUES(?,?)').run(key, now())
      })
    }
    return { ok: true, imported, backup }
  }
  pendingProjections(): Array<{ record: RecordValue; hash: string; previous: string | null }> {
    return this.db
      .prepare(
        'SELECT r.data,p.hash,p.trace_id FROM projections p JOIN records r ON r.id=p.id WHERE p.pending=1 LIMIT 50',
      )
      .all()
      .map((r) => ({
        record: JSON.parse(String(r.data)) as RecordValue,
        hash: String(r.hash),
        previous: r.trace_id === null ? null : String(r.trace_id),
      }))
  }
  markProjected(id: string, digest: string, traceId: string): void {
    this.db
      .prepare('UPDATE projections SET pending=0,trace_id=?,error=NULL WHERE id=? AND hash=?')
      .run(traceId, id, digest)
  }
  projectionRecord(traceId: string): RecordValue | null {
    const r = this.db
      .prepare(
        "SELECT id FROM projections WHERE (trace_id=? OR ? LIKE trace_id || ':chunk:%') AND pending=0",
      )
      .get(traceId, traceId)
    return r ? this.get(String(r.id)) : null
  }
  projectionState(): RecordValue {
    return {
      pending: Number(
        this.db.prepare('SELECT COUNT(*) AS n FROM projections WHERE pending=1').get()?.n || 0,
      ),
    }
  }
  exportMarkdown(): string {
    const dir = join(this.home, 'exports')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'knowledge.md')
    const notes = this.list('note', { limit: 200 })
    writeFileSync(
      path,
      '# Dota coach knowledge\n\n' +
        notes
          .map(
            (r) =>
              `## ${r.title}\n\n${r.body}\n\nSource record: ${r.source_record_id || 'unverified legacy'} · Patch: ${r.patch}\n`,
          )
          .join('\n'),
    )
    return path
  }
}
