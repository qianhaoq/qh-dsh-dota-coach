import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { CoachError } from './errors.ts'
import type { CoachStore } from './store.ts'
import type { RecordValue } from './types.ts'

const text = z.string().trim().min(1)
const relation = z.enum([
  'about_concept',
  'about_hero',
  'applies_to_patch',
  'in_phase',
  'derived_from_source',
  'supersedes',
  'supports',
  'contradicts',
])
const input = z.object({
  kind: z.enum(['principle', 'fact', 'counterexample']),
  title: text,
  body: text.max(20000),
  source_record_id: text,
  patch: text.default('unknown'),
  hero: z.string().default(''),
  role: z.string().default(''),
  phase: z.string().default(''),
  concepts: z.array(text).default([]),
  relations: z
    .array(z.object({ relation: z.enum(['supports', 'contradicts']), target: text }))
    .default([]),
})
const digest = (body: string) => createHash('sha256').update(body).digest('hex')
/** SQLite documents are authoritative; search is a disposable projection. No promotion API. */
export class OntologyKB {
  constructor(private store: CoachStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS ontology_nodes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ontology_edges(subject TEXT NOT NULL REFERENCES ontology_nodes(id), relation TEXT NOT NULL, target TEXT NOT NULL REFERENCES ontology_nodes(id), PRIMARY KEY(subject,relation,target));
      CREATE TABLE IF NOT EXISTS ontology_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL REFERENCES ontology_nodes(id),action TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS ontology_search USING fts5(id UNINDEXED,body,tokenize='trigram');
      INSERT OR IGNORE INTO migrations VALUES('ontology-v1',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `)
    store.transaction(() => {
      store.db.exec('DELETE FROM ontology_search')
      const insert = store.db.prepare('INSERT INTO ontology_search VALUES(?,?)')
      for (const row of store.db.prepare('SELECT id,data FROM ontology_nodes').all())
        insert.run(String(row.id), String(row.data))
    })
  }
  private save(node: RecordValue, action: string) {
    const data = JSON.stringify(node),
      db = this.store.db
    db.prepare(
      'INSERT INTO ontology_nodes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    ).run(String(node.id), data)
    db.prepare('INSERT INTO ontology_events(node_id,action,at,snapshot) VALUES(?,?,?,?)').run(
      String(node.id),
      action,
      new Date().toISOString(),
      data,
    )
    db.prepare('DELETE FROM ontology_search WHERE id=?').run(String(node.id))
    db.prepare('INSERT INTO ontology_search VALUES(?,?)').run(String(node.id), data)
    return node
  }
  private entity(type: string, value: string, details: RecordValue = {}): string {
    const id = `onto:${type}:${digest(value)}`
    if (!this.store.db.prepare('SELECT 1 FROM ontology_nodes WHERE id=?').get(id))
      this.save({ id, type, title: value, state: 'active', ...details }, 'register_entity')
    return id
  }
  get(id: string): RecordValue {
    const row = this.store.db.prepare('SELECT data FROM ontology_nodes WHERE id=?').get(id)
    if (!row) throw new CoachError('not_found', 'Ontology node not found', { id })
    const node = JSON.parse(String(row.data)) as RecordValue
    return {
      ...node,
      relations: this.store.db
        .prepare(
          'SELECT relation,target FROM ontology_edges WHERE subject=? ORDER BY relation,target',
        )
        .all(id)
        .map((r) => ({ relation: String(r.relation), target: String(r.target) })),
      history: this.store.db
        .prepare('SELECT seq,action,at,snapshot FROM ontology_events WHERE node_id=? ORDER BY seq')
        .all(id)
        .map((r) => ({
          seq: Number(r.seq),
          action: String(r.action),
          at: String(r.at),
          snapshot: JSON.parse(String(r.snapshot)),
        })),
    }
  }
  private edge(subject: string, name: string, target: string) {
    relation.parse(name)
    this.get(target)
    this.store.db
      .prepare('INSERT OR IGNORE INTO ontology_edges VALUES(?,?,?)')
      .run(subject, name, target)
  }
  write(args: RecordValue): RecordValue {
    return this.store.transaction(() => {
      const previous =
        args.action === 'revise' || args.action === 'update' || args.action === 'archive'
          ? this.get(text.parse(args.id))
          : undefined
      if (previous && !['Principle', 'FactClaim'].includes(String(previous.type)))
        throw new CoachError('invalid_arguments', 'Lifecycle writes apply to claims, not shared taxonomy entities')
      if (previous && !['candidate', 'active'].includes(String(previous.state)))
        throw new CoachError('invalid_arguments', 'Only current nodes can be revised or archived')
      if (args.action === 'archive') {
        text.parse(args.source_record_id)
        this.store.get(String(args.source_record_id), 'source')
        const { history: _h, relations: _r, ...node } = previous!
        return {
          ok: true,
          record: this.save(
            {
              ...node,
              state: 'archived',
              archive_reason: text.parse(args.reason),
              archive_source_record_id: args.source_record_id,
            },
            'archive',
          ),
        }
      }
      if (args.state && args.state !== 'candidate')
        throw new CoachError(
          'invalid_evidence',
          'Human curation required; tools only create candidate claims',
        )
      // Revisions require an explicit source again; they never inherit approval.
      const data = input.parse({
        ...previous,
        ...args,
        source_record_id: args.source_record_id,
        relations: args.relations ?? (Array.isArray(previous?.relations) ? (previous.relations as RecordValue[]).filter(e => ['supports', 'contradicts'].includes(String(e.relation))) : []),
      })
      const source = this.store.get(data.source_record_id, 'source')
      if (
        typeof source.body !== 'string' ||
        source.body.trim().length < 20 ||
        digest(source.body) !== source.content_hash ||
        source.material_type === 'comment' ||
        ['title_only', 'comments_only'].includes(String(source.evidence_level))
      )
        throw new CoachError('invalid_evidence', 'Readable, hash-valid source material is required')
      if (data.patch !== source.patch || (source.hero && data.hero !== source.hero))
        throw new CoachError(
          'invalid_evidence',
          'Applicability must match source; unknown cannot become current',
        )
      const id = `onto:claim:${randomUUID()}`,
        at = new Date().toISOString()
      const node: RecordValue = {
        ...data,
        id,
        type: data.kind === 'principle' ? 'Principle' : 'FactClaim',
        state: 'candidate',
        revision: Number(previous?.revision || 0) + 1,
        created_at: at,
        stamp: `[${data.patch} · ${String(source.captured_at).slice(0, 10)} · ${source.source_id}]`,
        provenance: {
          source_record_id: source.id!,
          source_id: source.source_id!,
          content_hash: source.content_hash!,
          captured_at: source.captured_at!,
          locator: source.locator!,
          evidence_level: source.evidence_level || null,
        },
        verification: 'material_linked_not_independently_verified',
        exportable: false,
        ...(previous ? { supersedes: previous.id! } : {}),
      }
      this.save(node, 'create')
      this.edge(
        id,
        'derived_from_source',
        this.entity('SourceMaterial', String(source.id), {
          source_record_id: source.id!,
          content_hash: source.content_hash!,
        }),
      )
      this.edge(
        id,
        'applies_to_patch',
        this.entity('Patch', data.patch, {
          applicability: data.patch === 'unknown' ? 'unknown' : 'exact',
        }),
      )
      if (data.hero) this.edge(id, 'about_hero', this.entity('Hero', data.hero))
      if (data.phase) this.edge(id, 'in_phase', this.entity('PhaseSituation', data.phase))
      for (const concept of data.concepts)
        this.edge(id, 'about_concept', this.entity('Concept', concept))
      for (const link of data.relations) this.edge(id, link.relation, link.target)
      const evidence = this.entity('EvidenceLink', id, {
        claim_id: id,
        source_record_id: source.id!,
        content_hash: source.content_hash!,
        verification: node.verification!,
      })
      this.edge(evidence, 'supports', id)
      if (previous) {
        const { history: _h, relations: _r, ...old } = previous
        this.save({ ...old, state: 'superseded', replaced_by: id }, 'supersede')
        this.edge(id, 'supersedes', String(previous.id))
      }
      return { ok: true, record: this.get(id) }
    })
  }
  search(args: RecordValue, recall = false): RecordValue {
    const limit = z
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(args.limit ?? 20)
    const terms = String(args.query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    const items = this.store.db
      .prepare('SELECT data FROM ontology_nodes ORDER BY id')
      .all()
      .map((r) => JSON.parse(String(r.data)) as RecordValue)
      .filter((n) => {
        if (
          recall &&
          (!['Principle', 'FactClaim'].includes(String(n.type)) ||
            !['active', ...(args.include_candidates === true ? ['candidate'] : [])].includes(
              String(n.state),
            ))
        )
          return false
        if (args.state && n.state !== args.state) return false
        if (args.kind && n.kind !== args.kind) return false
        for (const key of ['hero', 'role', 'phase'])
          if (args[key] && (recall ? n[key] && n[key] !== args[key] : n[key] !== args[key])) return false
        if (args.patch && n.patch !== args.patch) return false
        if (args.concept && !(Array.isArray(n.concepts) && n.concepts.includes(args.concept)))
          return false
        if (
          !terms.every((t) =>
            `${n.title || ''} ${n.body || ''} ${JSON.stringify(n.concepts || [])}`
              .toLowerCase()
              .includes(t),
          )
        )
          return false
        if (args.relation || args.target) {
          const edges = this.get(String(n.id)).relations as RecordValue[]
          if (
            !edges.some(
              (e) =>
                (!args.relation || e.relation === args.relation) &&
                (!args.target || e.target === args.target),
            )
          )
            return false
        }
        return true
      })
      .sort((a, b) => Number(Boolean(b.kind)) - Number(Boolean(a.kind)) || Number(b.kind === 'principle') - Number(a.kind === 'principle') || String(a.id).localeCompare(String(b.id)))
      .slice(0, limit)
      .map((n) => ({
        ...n,
        applicability:
          !args.patch || n.patch === 'unknown'
            ? 'unknown'
            : n.patch === args.patch
              ? 'exact'
              : 'outdated',
        instruction_status: 'retrieved_material_only',
      }))
    return { ok: true, authority: 'ontology-v1', candidate_use: 'unverified_material_only', items }
  }
  status(): RecordValue {
    return {
      schema: 'ontology-v1',
      authority: 'SQLite ontology_nodes + ontology_edges + append-only ontology_events',
      index: 'ontology_search (rebuildable)',
      promotion: 'human_curation_required_not_implemented',
      counts: this.store.db
        .prepare(
          "SELECT json_extract(data,'$.type') AS type,json_extract(data,'$.state') AS state,COUNT(*) AS count FROM ontology_nodes GROUP BY type,state",
        )
        .all()
        .map((r) => ({ type: String(r.type), state: String(r.state), count: Number(r.count) })),
    }
  }
}
