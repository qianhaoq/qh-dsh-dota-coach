import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink } from 'node:fs/promises'
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
test('KB status reports local paths, note counts and FTS without inventing patch knowledge', async (t) => {
  const s = await setup(t)
  const status = s.kbStatus()
  assert.equal(status.home, s.home)
  assert.deepEqual(status.paths, {
    database: join(s.home, 'coach.sqlite'),
    principles: join(s.home, 'principles.md'),
    library: join(s.home, 'library.md'),
    patch: join(s.home, 'patch'),
  })
  assert.equal(status.fts_ready, true)
  assert.equal(status.principles_exists, false)
  assert.equal(status.library_exists, false)
  assert.equal(status.patch_exists, true)
  assert.deepEqual(await readdir(join(s.home, 'patch')), [])
  assert.deepEqual(status.notes_by_kind, {})
  s.note(note(record(s.source(material))))
  assert.deepEqual(s.kbStatus().notes_by_kind, { fact: 1 })
  await rm(join(s.home, 'patch'), { recursive: true })
  assert.equal(s.kbStatus().patch_exists, false)
  s.ensurePatchScaffold()
  s.ensurePatchScaffold()
  assert.equal(s.kbStatus().patch_exists, true)
  s.db.exec('DROP TABLE search')
  assert.equal(s.kbStatus().fts_ready, false)
  assert.equal((s.kbSearch({ query: 'vision' }).items as RecordValue[]).length, 1)
  await writeFile(
    join(s.home, 'principles.md'),
    '## Fixture principle\nA Markdown fixture without an index.\n',
  )
  assert.equal((s.kbSearch({ query: 'Markdown' }).items as RecordValue[])[0]!.kind, 'principle')
})
test('KB ranks current Markdown principles, stamped library facts and linked notes with evidence metadata', async (t) => {
  const s = await setup(t)
  await writeFile(
    join(s.home, 'principles.md'),
    '# Fixture principles\n\n## Vision principle\n\nCheck vision before moving.\n\n```md\n## Example inside a fence\n```\n',
  )
  await writeFile(
    join(s.home, 'library.md'),
    '# Fixture library\n\n## Axe vision fixture\n[7.41f · 2026-10-30 · user:fixture]\nhero: axe\nevidence_level: post_body\n\n' +
      'Fixture vision material. '.repeat(40) +
      '\n\n## Unstamped vision fixture\nhero: axe\nAn old claim without a source stamp.\n\n## Vision counterexample\n[7.40 · 2026-10-29 · user:fixture]\nA fixture counterexample.\n',
  )
  const source = record(s.source(material))
  const saved = record(s.note({ ...note(source), hero: 'axe' }))
  const hits = s.kbSearch({ query: 'vision' }).items as RecordValue[]
  assert.equal(hits.length, 5)
  assert.equal(hits[0]!.kind, 'principle')
  assert.ok(!hits.some((r) => r.title === 'Example inside a fence'))
  const library = hits.find((r) => r.title === 'Axe vision fixture')!
  assert.equal(library.path, 'library.md#axe-vision-fixture')
  assert.equal(library.stamp, '[7.41f · 2026-10-30 · user:fixture]')
  assert.equal(library.source_id, 'user:fixture')
  assert.equal(library.evidence_level, 'post_body')
  assert.equal(library.verification, 'unverified_legacy', 'a stamp is not independent verification')
  assert.ok(hits.every((r) => String(r.snippet).length <= 322 && r.body === undefined))
  const unstamped = hits.find((r) => r.title === 'Unstamped vision fixture')!
  assert.equal(unstamped.stamp, null)
  assert.equal(unstamped.stamp_status, 'missing')
  assert.equal(unstamped.needs_recheck, true)
  assert.equal(unstamped.evidence_status, 'unverified_legacy')
  assert.ok(hits.indexOf(library) < hits.indexOf(unstamped))
  const linked = hits.find((r) => r.id === saved.id)!
  assert.equal(linked.kind, 'fact')
  assert.equal(linked.source_record_id, source.id)
  assert.deepEqual(linked.evidence_refs, [
    {
      id: source.id,
      source_id: source.source_id,
      locator: source.locator,
      content_hash: source.content_hash,
      evidence_level: null,
    },
  ])
  assert.equal(linked.evidence_status, 'supported_by_material')
  const selected = s.kbSearch({
    query: 'VISION',
    hero: 'AXE',
    patch: '7.41f',
    kind: 'fact',
    limit: 1,
  }).items as RecordValue[]
  assert.equal(selected.length, 1)
  assert.equal(selected[0]!.kind, 'fact')
  assert.equal(selected[0]!.applicability, 'patch_matches')
  assert.deepEqual(s.kbSearch({ query: 'vision', hero: 'missing-hero' }).items, [])
  assert.equal(
    (s.kbSearch({ query: 'vision', kind: 'counterexample' }).items as RecordValue[])[0]!.title,
    'Vision counterexample',
  )
  const fetched = record(s.kbGet({ id: saved.id!, current_patch: '7.42' }))
  assert.equal(fetched.id, saved.id)
  assert.equal(fetched.body, saved.body)
  assert.equal(fetched.applicability, 'outdated')
  assert.equal(fetched.needs_recheck, true)
  assert.deepEqual(fetched.evidence_refs, linked.evidence_refs)
  assert.equal(s.kbStatus().principles_exists, true)
  assert.equal(s.kbStatus().library_exists, true)
})
test('KB gets bounded Markdown sections and patch files, reads edits immediately, and deduplicates legacy sections', async (t) => {
  const s = await setup(t)
  await writeFile(
    join(s.home, 'principles.md'),
    '# Fixtures\n\n## 地图意识\n小地图观察 fixture.\n\n## 地图意识\nSecond fixture.\n',
  )
  s.migrate()
  const hits = s.kbSearch({ query: '小地' }).items as RecordValue[]
  assert.equal(hits.length, 1, 'the live Markdown section and its migrated copy are one hit')
  assert.equal(hits[0]!.kind, 'principle')
  const page = s.kbGet({ path: 'principles.md' })
  assert.equal((page.items as RecordValue[]).length, 2)
  assert.ok((page.items as RecordValue[]).every((r) => !r.body))
  const first = record(s.kbGet({ id: hits[0]!.id!, max_chars: 7 }))
  const full = record(s.kbGet({ path: hits[0]!.path! }))
  assert.equal(first.body, String(full.body).slice(0, 7))
  assert.equal(s.kbGet({ id: hits[0]!.id!, max_chars: 7 }).next_offset, 7)
  assert.equal(record(s.kbGet({ id: hits[0]!.id!, offset: 7 })).body, String(full.body).slice(7))
  assert.notEqual((page.items as RecordValue[])[0]!.id, (page.items as RecordValue[])[1]!.id)
  await writeFile(join(s.home, 'principles.md'), '## Edited fixture\nUpdated knowledge fixture.\n')
  assert.equal(
    (s.kbSearch({ query: 'Updated' }).items as RecordValue[])[0]!.title,
    'Edited fixture',
  )
  const patchDir = join(s.home, 'patch/test-version/heroes/test-hero')
  await mkdir(patchDir, { recursive: true })
  await writeFile(join(patchDir, 'fixture.md'), '# Fixture only\nPatch reading fixture.\n')
  const patch = (
    s.kbSearch({ query: 'reading', patch: 'test-version', hero: 'test-hero' })
      .items as RecordValue[]
  )[0]!
  assert.equal(patch.kind, 'fact')
  assert.equal(patch.stamp_status, 'missing')
  assert.equal(patch.needs_recheck, true)
  assert.equal(record(s.kbGet({ id: patch.id! })).path, patch.path)
  assert.equal(
    (s.kbGet({ path: 'patch/test-version/heroes/test-hero/fixture.md' }).items as RecordValue[])
      .length,
    1,
  )
})
test('KB filters before limiting FTS hits and supports short queries without dropping matching notes', async (t) => {
  const s = await setup(t),
    source = record(s.source(material))
  const wanted = record(
    s.note({ ...note(source), hero: 'fixture-hero', body: 'Vision 小地图 fixture.' }),
  )
  for (let i = 0; i < 5; i++) s.note({ ...note(source), hero: 'other-hero', title: `Vision ${i}` })
  assert.equal(
    (s.kbSearch({ query: 'vision', hero: 'fixture-hero', limit: 1 }).items as RecordValue[])[0]!.id,
    wanted.id,
  )
  assert.equal((s.kbSearch({ query: '小地' }).items as RecordValue[])[0]!.id, wanted.id)
  assert.equal((s.kbSearch({ query: 'no-such-term' }).items as RecordValue[]).length, 0)
})
test('KB validates actions inputs and restricts path reads to knowledge Markdown under data home', async (t) => {
  const s = await setup(t)
  assert.throws(() => s.kbSearch({ query: ' ' }), /query/)
  assert.throws(() => s.kbSearch({ query: 'fixture', kind: 'invented' }), /kind/)
  assert.throws(() => s.kbGet({}), /exactly one/)
  assert.throws(() => s.kbGet({ id: 'missing', path: 'principles.md' }), /exactly one/)
  assert.throws(() => s.kbGet({ id: 'missing' }), /not found/)
  assert.throws(() => s.kbGet({ id: record(s.source(material)).id! }), /not found/)
  for (const path of [
    '../package.json',
    '/etc/passwd',
    'coach.sqlite',
    'patch/../library.md',
    'patch/local.dem',
  ])
    assert.throws(() => s.kbGet({ path }), /Use principles/)
  await symlink(join(process.cwd(), 'package.json'), join(s.home, 'patch/escape.md'))
  assert.throws(() => s.kbGet({ path: 'patch/escape.md' }), /under data home/)
  assert.throws(() => s.kbGet({ path: 'patch/missing.md' }), /not found/)
})
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
  const context = s.learningContext(String(record(saved).id))
  assert.equal((context.evidence as RecordValue[])[0]!.excerpt, source.body)
  assert.equal((context.evidence as RecordValue[])[0]!.content_hash, source.content_hash)
  assert.deepEqual(context.training, checked)
  const wrong = s.evidence(123, {}, { source: 'opendota', captured_at: '2026-01-01T00:00:00Z' })
  assert.equal(wrong.source, 'opendota')
  assert.equal(wrong.captured_at, '2026-01-01T00:00:00Z')
  assert.throws(() => s.review({ ...review, evidence_ids: [wrong.id!] }), /different match/)
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

test('an old review still resolves its single goal beyond the list page limit', async (t) => {
  const s = await setup(t)
  const source = record(s.source(material))
  let first: RecordValue | undefined
  for (let i = 0; i < 205; i++) {
    const saved = s.review({
      action: 'save',
      match_id: 424242,
      from: 100,
      to: 140,
      title: `Practice ${i}`,
      body: 'An evidence-linked review.',
      learner_explanation: 'I checked the map.',
      evidence_ids: [source.id!],
      trigger: 'Before crossing',
      action_rule: 'Check the map',
      check_method: 'Inspect the next match',
    })
    first ||= record(saved)
  }
  const result = record(s.training({ action: 'create', review_id: first!.id! }))
  assert.equal(result.review_id, first!.id)
  assert.equal((s.learningContext(String(first!.id)).training as RecordValue).id, result.id)
  assert.equal(result.title, 'Practice 0')
})
