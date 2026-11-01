import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Tools, {
  defineTool,
  type ToolExecutionResult,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CoachService } from '../packages/coach/src/service.ts'
import { Config } from '../packages/coach/src/config.ts'
import { makeTools } from '../packages/coach/src/tools.ts'

const material = {
  ok: true,
  source_id: 'BVfixture',
  title: 'Map observation',
  text: 'Check allied positions before crossing the river toward the next objective.',
  evidence_level: 'subtitle_full',
}
const request = {
  action: 'fetch',
  provider_tool: 'bili_subtitle',
  provider_args: { bvid: 'BVfixture' },
  source_id: material.source_id,
  locator: 'paragraph 1',
}
const context = createUserMessage({
  source: { kind: 'dota-coach-memory', form: 'notice' },
  content: [{ type: 'text', text: 'Fixture source context' }],
})
const successful = (): ToolExecutionResult => ({
  isError: false,
  value: material,
  content: [{ type: 'text', text: JSON.stringify(material) }],
})
test('published source dispatch preserves parent policy and forwards deferred context', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dota-source-sdk-'))
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, {})
  const service = new CoachService(ctx, Config({ memoryEnabled: false }), home, '.')
  t.after(async () => {
    await service.dispose()
    await rm(home, { recursive: true, force: true })
  })
  let denied = true,
    calls = 0
  ctx.tools.register(
    defineTool({
      name: 'bili_subtitle',
      description: 'Fixture subtitle provider',
      parameters: { bvid: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(_args, exec) {
        calls++
        exec.deferContext(context)
        return material
      },
    }),
  )
  for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec)))
    ctx.tools.register(tool)
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'bili_subtitle') {
      assert.equal(typeof exec.parent, 'symbol')
      assert.equal(exec.rootCallId, 'source-root')
      if (denied) return { kind: 'deny', reason: 'Fixture policy denial' }
    }
    return next()
  })
  const invoke = () =>
    ctx.tools.execute({
      callId: 'source-root' as ToolRunContext['callId'],
      name: 'dota_source',
      arguments: request,
      signal: new AbortController().signal,
    })
  const rejected = await invoke()
  assert.equal((rejected.value as { reason: string }).reason, 'source_fetch_failed')
  assert.equal(calls, 0)
  assert.equal(service.store.list('source').length, 0)
  denied = false
  const saved = await invoke()
  assert.equal((saved.value as { ok: boolean }).ok, true, JSON.stringify(saved.value))
  assert.equal(calls, 1)
  assert.deepEqual(saved.additionalContexts, [context])
  assert.equal(service.store.list('source')[0]!.body, material.text)
})
test('batch source dispatch retains admission, scope, cancellation and result context', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dota-source-batch-'))
  const ctx = new Context()
  const signal = new AbortController().signal
  const toolSet = { fixture: 'current-step' }
  const agent = {} as NonNullable<ToolRunContext['agent']>
  const deferred: unknown[] = []
  let mode: 'success' | 'denied' | 'missing' = 'success',
    concluded = 0
  ctx.provide('tools', {
    get: (name: string) => (name === 'bili_subtitle' ? {} : undefined),
    setExecutor: () => {},
    execute: async (input: {
      calls: Array<{ type: string; id: string; name: string; arguments: string }>
      signal: AbortSignal
      toolSet: unknown
      agent: unknown
    }) => {
      assert.equal(input.signal.aborted, false)
      assert.equal(input.toolSet, toolSet)
      assert.equal(input.agent, agent)
      assert.equal(input.calls.length, 1)
      const call = input.calls[0]!
      assert.equal(call.type, 'tool-call')
      assert.equal(call.name, 'bili_subtitle')
      assert.deepEqual(JSON.parse(call.arguments), request.provider_args)
      const result: ToolExecutionResult =
        mode === 'denied'
          ? {
              isError: true,
              error: { message: 'Fixture policy denial' },
              content: [{ type: 'text', text: 'Denied' }],
            }
          : successful()
      return {
        results: mode === 'missing' ? [] : [{ callId: call.id, result }],
        additionalContexts: mode === 'success' ? [context] : [],
        concluded: mode === 'success',
      }
    },
  } as unknown as Context['tools'])
  const service = new CoachService(ctx, Config({ memoryEnabled: false }), home, '.')
  t.after(async () => {
    await service.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const owner = {
    callId: 'source-owner',
    rootCallId: 'source-owner',
    token: Symbol(),
    name: 'dota_source',
    arguments: request,
    signal,
    toolSet,
    agent,
    deferContext: (v: unknown) => deferred.push(v),
    concludeTurn: () => {
      concluded++
    },
  } as unknown as ToolRunContext
  const saved = await service.invoke('dota_source', request, signal, owner)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(service.store.list('source')[0]!.body, material.text)
  assert.deepEqual(deferred, [context])
  assert.equal(concluded, 1)
  for (mode of ['denied', 'missing'] as const) {
    const rejected = await service.invoke('dota_source', request, signal, owner)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.reason, 'source_fetch_failed')
    assert.equal(service.store.list('source').length, 1)
  }
})
