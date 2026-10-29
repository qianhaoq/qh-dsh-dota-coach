import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoachStore } from '../packages/coach/src/store.ts'
import type { RecordValue } from '../packages/coach/src/types.ts'
async function setup(t: { after: (f: () => Promise<void>) => void }) {
  const home = await mkdtemp(join(tmpdir(), 'dota-store-'))
  const store = new CoachStore(home)
  t.after(async () => {
    store.close()
    await rm(home, { recursive: true, force: true })
  })
  return store
}
const material = {
  action: 'import',
  source_id: 'user:lesson-1',
  title: 'Ward placement',
  body: 'Place vision before moving toward the next objective. Check teammates before entering the river.',
  locator: 'paragraph 2',
  patch: '7.41f',
}
const record = (r: RecordValue) => r.record as RecordValue
function note(source: RecordValue): RecordValue {
  return {
    action: 'append',
    kind: 'fact',
    source_record_id: source.id!,
    source_id: source.source_id!,
    title: 'Vision before an objective',
    body: 'Place vision before moving to an objective.',
    stamp: '[7.41f · 2026-10-30 · user:lesson-1]',
    patch: '7.41f',
    tags: ['vision'],
  }
}
test('readable sources deduplicate by source, locator and content while retaining raw content', async (t) => {
  const s = await setup(t)
  const first = record(s.source(material)),
    second = s.source(material)
  assert.equal(second.deduplicated, true)
  assert.equal(record(second).id, first.id)
  assert.notEqual(record(s.source({ ...material, locator: 'paragraph 3' })).id, first.id)
  assert.equal(first.origin, 'user_import')
  assert.match(String(first.content_hash), /^[a-f0-9]{64}$/)
  assert.equal(record(s.source({ action: 'get', id: first.id! })).body, material.body)
})
test('notes reject titles-only and comment evidence, then expose patch applicability and revision history', async (t) => {
  const s = await setup(t)
  const title = record(s.source({ ...material, body: 'title' }))
  assert.throws(() => s.note(note(title)), /insufficient/i)
  const comment = record(s.source({ ...material, material_type: 'comment' }))
  assert.throws(() => s.note(note(comment)), /insufficient/i)
  const source = record(s.source(material)),
    first = record(s.note(note(source)))
  const out = record(s.note({ action: 'get', id: first.id!, current_patch: '7.42' }))
  assert.equal(out.applicability, 'outdated')
  assert.equal(out.needs_recheck, true)
  const revised = record(
    s.note({
      ...note(source),
      action: 'revise',
      id: first.id!,
      body: 'A narrower rule supported by the new material.',
    }),
  )
  assert.equal(revised.supersedes, first.id)
  assert.equal(s.get(String(first.id)).superseded_by, revised.id)
  assert.equal(s.list('note', { query: 'vision' }).length, 2)
})
test('review and one training goal commit together, with readable evidence references and user reports', async (t) => {
  const s = await setup(t)
  const source = record(s.source(material))
  const review = {
    action: 'save',
    match_id: 424242,
    from: 100,
    to: 140,
    title: 'River decision',
    body: 'Review with explicit evidence.',
    learner_explanation: 'I wanted to secure the next objective.',
    evidence_ids: [source.id!],
    trigger: 'Before crossing the river',
    action_rule: 'Check allied positions',
    check_method: 'After the next game inspect this decision',
  }
  assert.throws(() => s.review({ ...review, evidence_ids: ['missing'] }), /not found/)
  assert.equal(s.list('review').length, 0)
  assert.equal(s.list('training').length, 0)
  const saved = s.review(review),
    goal = saved.training as RecordValue
  assert.equal(s.list('training').length, 1)
  assert.equal(record(s.training({ action: 'create', review_id: record(saved).id! })).id, goal.id)
  const checked = record(
    s.training({
      action: 'checkin',
      id: goal.id!,
      match_id: 424243,
      body: 'Checked the minimap twice before crossing.',
      completed: true,
    }),
  )
  assert.equal((checked.checkins as RecordValue[])[0]!.basis, 'user_report')
  assert.equal(checked.completion_basis, 'user_report')
  assert.equal(checked.score, undefined)
})
test('legacy migration preserves backups, is repeatable and leaves unsupported material unverified', async (t) => {
  const s = await setup(t)
  await writeFile(
    join(s.home, 'library.md'),
    '# Old library\n\n## 001 · Old belief\n\nUnknown source.\n',
  )
  await writeFile(join(s.home, 'coach-log.jsonl'), '{"title":"Old note","source":"missing"}\n')
  const first = s.migrate()
  assert.equal(first.imported, 3)
  assert.equal(s.migrate().imported, 0)
  assert.equal(s.list('note').length, 3)
  assert.ok(
    s.list('note').every((r) => r.evidence_status === 'unverified_legacy' && r.needs_recheck),
  )
  assert.equal((await readdir(join(s.home, 'legacy-backup'))).length, 2)
})
test('serialized concurrent writes and stale projection acknowledgements preserve the latest record', async (t) => {
  const s = await setup(t)
  const source = record(s.source(material))
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      Promise.resolve().then(() => s.note({ ...note(source), title: 'Rule ' + i })),
    ),
  )
  assert.equal(s.list('note', { limit: 100 }).length, 30)
  const pending = s.pendingProjections().find((r) => r.record.kind === 'note')!
  s.note({ action: 'recheck', id: pending.record.id!, body: 'New contradictory material' })
  s.markProjected(String(pending.record.id), pending.hash, 'old-trace')
  assert.equal(s.projectionRecord('old-trace'), null)
  assert.ok(Number(s.projectionState().pending) > 0)
})
