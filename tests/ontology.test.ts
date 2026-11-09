import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoachStore } from '../packages/coach/src/store.ts'
import { buildSiteSnapshot } from '../packages/coach/src/site-export.ts'
import type { RecordValue } from '../packages/coach/src/types.ts'
const record = (r: RecordValue) => r.record as RecordValue
const items = (r: RecordValue) => r.items as RecordValue[]
test('ontology candidate lifecycle, durable history/edges, recall boundaries and unknown export rejection', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ontology-'))
  let s = new CoachStore(home)
  t.after(() => {
    s.close()
    rmSync(home, { recursive: true, force: true })
  })
  const source = record(
    s.source({
      action: 'import',
      source_id: 'test:historical',
      title: 'Historical support guide',
      body: 'Conditional pulling depends on the lane situation and teammate readiness.',
      locator: 'section 2',
      patch: 'unknown',
      material_type: 'article',
      evidence_level: 'post_body',
    }),
  )
  const create: RecordValue = {
    action: 'create',
    kind: 'principle',
    title: 'Conditional pulling',
    body: 'Check lane pressure before pulling.',
    source_record_id: source.id!,
    patch: 'unknown',
    hero: 'axe',
    phase: 'lane',
    role: 'support',
    concepts: ['lane pressure'],
  }
  const first = record(s.ontology.write(create))
  assert.equal(first.state, 'candidate')
  assert.equal(first.exportable, false)
  assert.equal(
    items(
      s.ontology.search({
        concept: 'lane pressure',
        hero: 'axe',
        patch: 'unknown',
        kind: 'principle',
        query: 'pulling',
      }),
    )[0]?.id,
    first.id,
  )
  const edges = first.relations as RecordValue[]
  for (const name of [
    'about_concept',
    'about_hero',
    'applies_to_patch',
    'in_phase',
    'derived_from_source',
  ])
    assert.ok(edges.some((e) => e.relation === name))
  assert.equal(
    items(
      s.ontology.search({
        relation: 'about_hero',
        target: edges.find((e) => e.relation === 'about_hero')!.target!,
      }),
    ).length,
    1,
  )
  assert.equal(items(s.ontology.search({ patch: 'unknown' }, true)).length, 0)
  assert.equal(
    items(s.ontology.search({ patch: '7.41f', include_candidates: true }, true)).length,
    0,
  )
  assert.equal(
    items(s.ontology.search({ patch: 'unknown', hero: 'lina', include_candidates: true }, true))
      .length,
    0,
  )
  assert.equal(
    items(s.ontology.search({ patch: 'unknown', phase: 'late', include_candidates: true }, true))
      .length,
    0,
  )
  assert.equal(
    items(s.ontology.search({ patch: 'unknown', hero: 'axe', include_candidates: true }, true))
      .length,
    1,
  )
  assert.throws(() => s.ontology.write({ ...create, patch: '7.41f' }), /Applicability/)
  assert.throws(() => s.ontology.write({ ...create, state: 'active' }), /curation/)
  assert.throws(() => s.ontology.write({ ...create, source_record_id: 'absent' }), /not found/)
  const second = record(
    s.ontology.write({
      action: 'revise',
      id: first.id!,
      body: 'Check lane pressure and teammate readiness before pulling.',
      source_record_id: source.id!,
      relations: [{ relation: 'contradicts', target: first.id! }],
    }),
  )
  assert.equal(second.supersedes, first.id)
  assert.equal(s.ontology.get(String(first.id)).replaced_by, second.id)
  assert.equal(s.ontology.get(String(first.id)).state, 'superseded')
  assert.equal(
    items(s.ontology.search({ patch: 'unknown', include_candidates: true }, true))[0]?.id,
    second.id,
  )
  assert.throws(
    () => s.ontology.write({ action: 'revise', id: first.id!, source_record_id: source.id! }),
    /current nodes/,
  )
  assert.throws(
    () => s.ontology.write({ ...create, relations: [{ relation: 'supports', target: 'missing' }] }),
    /not found/,
  )
  assert.equal(
    items(s.ontology.search({ kind: 'principle' })).length,
    2,
    'failed edge mutation rolls back claim',
  )
  s.ontology.write({
    action: 'archive',
    id: second.id!,
    source_record_id: source.id!,
    reason: 'Awaiting human curation; historical patch unknown',
  })
  assert.equal(items(s.ontology.search({ include_candidates: true }, true)).length, 0)
  assert.throws(() => buildSiteSnapshot(s, [second.id!]), /human curation/)
  const count = s.db.prepare('SELECT count(*) AS n FROM ontology_events').get()!.n
  s.db.exec('DELETE FROM ontology_search')
  s.close()
  s = new CoachStore(home)
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM ontology_events').get()!.n, count)
  const restored = s.ontology.get(String(second.id))
  assert.equal(restored.state, 'archived')
  assert.ok(
    (restored.relations as RecordValue[]).some(
      (e) => e.relation === 'supersedes' && e.target === first.id,
    ),
  )
  assert.equal((restored.history as RecordValue[]).length, 2)
  assert.ok(s.db.prepare('SELECT 1 FROM ontology_search LIMIT 1').get())
  assert.equal((s.kbGet({ id: second.id! }).record as RecordValue).id, second.id)
  console.log(
    JSON.stringify({
      demo: 'ontology lifecycle',
      first_id: first.id,
      revised_id: second.id,
      final_state: restored.state,
      supersedes: restored.supersedes,
      events: count,
      unknown_patch_current_recall: 0,
      exports: 0,
    }),
  )
})

test('dota_kb registered tool API routes candidate writes, unified reads and filtered recall', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { CoachService } = await import('../packages/coach/src/service.ts')
  const { Config } = await import('../packages/coach/src/config.ts')
  const { makeTools } = await import('../packages/coach/src/tools.ts')
  const Tools = (await import('@deepseek-ai/dsh-tools')).default
  const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
  const home = mkdtempSync(join(tmpdir(), 'ontology-tool-'))
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, {})
  const service = new CoachService(ctx, Config({ memoryEnabled: false }), home, '.')
  t.after(async () => {
    await service.dispose()
    rmSync(home, { recursive: true, force: true })
  })
  for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec)))
    ctx.tools.register(tool)
  let call = 0
  const invoke = async (name: string, args: RecordValue) => {
    const result = await ctx.tools.execute({
      callId: `ontology-${call++}` as never,
      name,
      arguments: args,
      signal: new AbortController().signal,
    })
    return result.value as RecordValue
  }
  const source = record(
    await invoke('dota_source', {
      action: 'import',
      source_id: 'test:exact',
      title: 'Exact patch example',
      body: 'Review lane pressure before entering the river near the next objective.',
      locator: 'paragraph 1',
      patch: '7.41f',
    }),
  )
  const claim = record(
    await invoke('dota_kb', {
      action: 'create',
      kind: 'fact',
      title: 'Lane pressure',
      body: 'Review lane pressure.',
      source_record_id: source.id!,
      patch: '7.41f',
      concepts: ['pressure'],
    }),
  )
  assert.equal(claim.state, 'candidate')
  assert.equal(record(await invoke('dota_kb', { action: 'get', id: claim.id!, current_patch: '7.41e' })).applicability, 'outdated')
  assert.equal(record(await invoke('dota_kb', { action: 'get', id: claim.id!, current_patch: '7.41f' })).applicability, 'exact')
  assert.equal(
    items(await invoke('dota_kb', { action: 'search', query: 'pressure' }))[0]?.id,
    claim.id,
  )
  assert.equal(
    items(await invoke('dota_kb', { action: 'search', concept: 'pressure' }))[0]?.id,
    claim.id,
  )
  assert.equal(record(await invoke('dota_kb', { action: 'get', id: claim.id! })).stamp, claim.stamp)
  assert.equal(items(await invoke('dota_kb', { action: 'recall', patch: '7.41f' })).length, 0)
  assert.equal(
    items(await invoke('dota_kb', { action: 'recall', patch: '7.41e', include_candidates: true }))
      .length,
    0,
  )
  assert.equal(
    items(await invoke('dota_kb', { action: 'recall', patch: '7.41f', include_candidates: true }))
      .length,
    1,
  )
  assert.equal((await invoke('dota_kb', { action: 'export', ids: [claim.id!] })).ok, false)
  const revised = record(
    await invoke('dota_kb', {
      action: 'update',
      id: claim.id!,
      body: 'Review lane pressure and the objective.',
      source_record_id: source.id!,
    }),
  )
  assert.equal(revised.supersedes, claim.id)
  assert.equal(
    (
      await invoke('dota_kb', {
        action: 'archive',
        id: revised.id!,
        source_record_id: source.id!,
        reason: 'await review',
      })
    ).ok,
    true,
  )
  assert.equal(
    items(await invoke('dota_kb', { action: 'recall', patch: '7.41f', include_candidates: true }))
      .length,
    0,
  )
  assert.ok((await invoke('dota_kb', { action: 'status' })).ontology)
})

test('bounded learning admits one actual ontology candidate and denies second writes and promotion', async t => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { CoachService } = await import('../packages/coach/src/service.ts')
  const { Config } = await import('../packages/coach/src/config.ts')
  const { makeTools } = await import('../packages/coach/src/tools.ts')
  const { apply } = await import('../packages/coach/src/public-source.ts')
  const Tools = (await import('@deepseek-ai/dsh-tools')).default
  const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
  const home = mkdtempSync(join(tmpdir(), 'ontology-learning-'))
  const ctx = new Context(); new SystemPrompt(ctx, {}); new Tools(ctx, {})
  const service = new CoachService(ctx, Config({ memoryEnabled: false }), home, '.')
  t.after(async () => { await service.dispose(); rmSync(home, { recursive: true, force: true }) })
  const source = record(service.store.source({ action: 'import', source_id: 'test:unknown', title: 'Historical advice', body: 'Check lane pressure before conditional pulling; this is historical author advice.', locator: 'paragraph 1', patch: 'unknown' }))
  for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec))) ctx.tools.register(tool)
  const fiber = ctx.plugin({ apply }, { learningOnly: true })
  await fiber.inertia
  let count = 0
  const invoke = (name: string, args: RecordValue) => ctx.tools.execute({ callId: `learning-${count++}` as never, name, arguments: args, signal: new AbortController().signal })
  const create: RecordValue = { action: 'create', kind: 'fact', title: 'Historical pulling', body: 'Check lane pressure; pending human curator review.', patch: 'unknown', source_record_id: source.id! }
  const first = await invoke('dota_kb', create)
  const claim = record(first.value as RecordValue)
  assert.equal(claim.state, 'candidate')
  assert.equal(claim.patch, 'unknown')
  for (const [name, args] of [
    ['dota_kb', create], ['dota_kb', { ...create, state: 'active' }],
    ['dota_kb', { ...create, kind: 'principle' }],
    ['dota_kb', { action: 'revise', id: claim.id!, source_record_id: source.id! }],
    ['dota_kb', { action: 'archive', id: claim.id!, source_record_id: source.id!, reason: 'test' }],
    ['dota_kb', { action: 'export', ids: [claim.id!] }],
    ['dota_coach_note', { action: 'append', kind: 'fact' }],
  ] as [string, RecordValue][]) assert.equal((await invoke(name, args)).isError, true)
  assert.equal(items(service.store.ontology.search({ kind: 'fact' })).length, 1)
  await fiber.dispose()
})
