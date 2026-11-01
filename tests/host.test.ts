import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import Tools, {
  assertObjectJsonSchema,
  defineTool,
  type ToolExecutionInput,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { toolNames } from '../packages/coach/src/types.ts'
import * as Plugin from '../packages/coach/lib/index.js'
import { Config } from '../packages/coach/src/config.ts'
const toolCallId = (id: string) => id as ToolExecutionInput['callId']
async function mounted(
  t: { after: (f: () => Promise<void>) => void },
  mode: 'native' | 'ptc' = 'native',
  memory = false,
) {
  const home = await mkdtemp(join(tmpdir(), 'dota-host-')),
    ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, { mode })
  new Typert(ctx)
  new SkillRegistry(ctx)
  const fiber = ctx.plugin(Plugin, {
    homeDir: home,
    memoryEnabled: memory,
    memoryOffline: true,
    skillEnabled: true,
    opendotaApiKey: 'TEST_SECRET_MUST_NOT_APPEAR',
  })
  await fiber.inertia
  assert.ok(ctx.tools.get('dota_status'))
  t.after(async () => {
    await fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  return { ctx, fiber, home }
}
async function invoke(ctx: Context, name: string, args: unknown, parent?: ToolRunContext['token']) {
  return ctx.tools.execute({
    callId: toolCallId('test-' + name),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...(parent ? { parent } : {}),
  })
}
test('all 13 official tools register, title remains a parameter, defaults are plain config fields and reload cleans up', async (t) => {
  const { ctx, fiber } = await mounted(t)
  assert.ok(await ctx.skills.get('dota2-coach'))
  for (const name of toolNames) {
    const definition = ctx.tools.get(name)!
    assert.ok(definition)
    assert.equal(definition.parameters.type, 'object')
    assert.ok(definition.output?.schema)
  }
  assert.ok(JSON.stringify(ctx.tools.get('dota_coach')!.parameters).includes('presentation'), 'the host registry admits presentation actions')
  const result = await invoke(ctx, 'dota_source', {
    action: 'import',
    source_id: 'user:fixture',
    title: 'Required title',
    body: 'Readable source text with an exact original locator.',
    locator: 'paragraph 1',
  })
  assert.equal(result.isError, false)
  assert.ok(JSON.stringify(result.value).includes('Required title'))
  const status = await invoke(ctx, 'dota_status', {})
  const manifest = JSON.parse(await readFile('packages/coach/package.json', 'utf8'))
  assert.equal((status.value as { version: string }).version, manifest.version)
  assert.ok(!JSON.stringify(status).includes('TEST_SECRET'))
  assert.ok(!JSON.stringify(Config({ homeDir: 'fixture' })).includes('[object Object]'))
  await fiber.restart()
  assert.equal((await invoke(ctx, 'dota_status', {})).isError, false)
  await fiber.dispose()
  for (const name of toolNames) assert.equal(ctx.tools.get(name), undefined)
  assert.equal(await ctx.skills.get('dota2-coach'), undefined)
})
test('model-facing schemas keep title in properties across reload and accept a titled knowledge note', async (t) => {
  const { ctx, fiber } = await mounted(t)
  const titledTools = ['dota_source', 'dota_coach_note', 'dota_review']
  const checkSchemas = () => {
    const schemas = ctx.tools
      .schemas()
      .filter((tool) => toolNames.includes(tool.name as (typeof toolNames)[number]))
    assert.equal(schemas.length, toolNames.length)
    assert.equal(new Set(schemas.map((tool) => tool.name)).size, toolNames.length)
    for (const tool of schemas) {
      assertObjectJsonSchema(tool.parameters)
      assert.equal(tool.parameters.title, undefined)
      if (titledTools.includes(tool.name))
        assert.deepEqual(tool.parameters.properties?.title, { type: 'string' })
    }
  }
  checkSchemas()
  const source = await invoke(ctx, 'dota_source', {
    action: 'import',
    source_id: 'user:schema-regression',
    title: 'Readable source title',
    body: 'Check allied positions before crossing the river toward an objective.',
    locator: 'paragraph 1',
  })
  assert.equal(source.isError, false)
  const sourceRecord = (source.value as { record: { id: string } }).record
  const args = {
    action: 'append',
    kind: 'principle',
    source_record_id: sourceRecord.id,
    source_id: 'user:schema-regression',
    stamp: '[unknown · 2026-10-31 · user:schema-regression]',
    title: 'Knowledge title remains a parameter',
    body: 'Check allied positions before crossing the river.',
  }
  const note = await invoke(ctx, 'dota_coach_note', args)
  assert.equal(note.isError, false)
  assert.equal((note.value as { ok: boolean }).ok, true, JSON.stringify(note.value))
  assert.equal((note.value as { record: { title: string } }).record.title, args.title)
  assert.equal((await invoke(ctx, 'dota_coach_note', { ...args, title: 123 })).isError, true)
  await fiber.restart()
  checkSchemas()
})
test('native and PTC transport preserve the same domain value with a fixture runtime', async (t) => {
  const native = await mounted(t),
    ptc = await mounted(t, 'ptc')
  const direct = await invoke(native.ctx, 'dota_status', {})
  ptc.ctx.provide('ptcRuntime', {
    language: 'typescript',
    isolation: 'fixture',
    programFormat: 'function-body',
    resolve: (request: Record<string, unknown>) => ({
      ...request,
      cwd: process.cwd(),
      timeoutMs: 1000,
    }),
    run: async (spec: {
      program: string
      bindings: Array<{ functions: Record<string, (a: unknown) => Promise<unknown>> }>
    }) => {
      assert.equal(spec.program, 'return await tools.dota_status({})')
      return { logs: [], value: await spec.bindings[0]!.functions.dota_status!({}) }
    },
    release: async () => {},
  })
  const nested = await invoke(ptc.ctx, 'run_code', {
    code: 'return await tools.dota_status({})',
    description: 'Read coach status',
  })
  assert.equal(nested.isError, false)
  const value = (nested.value as { result: Record<string, unknown> }).result
  assert.deepEqual({ ...value, home: native.home }, direct.value)
  const rendered = native.ctx.tools.get('dota_status')!.output!.render({}, value)
  assert.equal(rendered[0]!.type, 'text')
  assert.deepEqual(JSON.parse((rendered[0] as { text: string }).text), value)
})
test('required and enum validation reject malformed model inputs; material import works without providers', async (t) => {
  const { ctx } = await mounted(t)
  assert.equal((await invoke(ctx, 'dota_match', {})).isError, true)
  assert.equal((await invoke(ctx, 'dota_replay', { action: 'invalid' })).isError, true)
  const fetch = await invoke(ctx, 'dota_source', {
    action: 'fetch',
    provider_tool: 'yt_subtitle',
    provider_args: {},
  })
  assert.equal(fetch.isError, false)
  assert.match(JSON.stringify(fetch.value), /source_provider_unavailable/)
  const noAccount = await invoke(ctx, 'dota_matches', {})
  assert.match(JSON.stringify(noAccount.value), /no_account/)
})
test('built plugin owns a real MemOS worker and drains it across reload', async (t) => {
  const { ctx, fiber } = await mounted(t, 'native', true)
  const source = await invoke(ctx, 'dota_source', {
    action: 'import',
    source_id: 'user:local-memory',
    title: 'Vision before moving',
    body: 'Check the minimap before crossing the river and coordinate with nearby allies.',
    locator: 'paragraph 2',
  })
  assert.equal(source.isError, false)
  assert.ok(!JSON.stringify(source.value).includes('memory_error'))
  const health = await invoke(ctx, 'dota_memory', { action: 'status' })
  assert.equal(health.isError, false)
  assert.match(JSON.stringify(health.value), /2.0.21/)
  assert.ok(!JSON.stringify(health.value).includes('TEST_SECRET'))
  await fiber.restart()
  assert.equal((await invoke(ctx, 'dota_memory', { action: 'status' })).isError, false)
})
