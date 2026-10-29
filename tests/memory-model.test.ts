import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { KnowledgeMemory } from '../packages/coach/lib/types/memory.js'
import { Config } from '../packages/coach/src/config.ts'
test('MemOS auxiliary calls use the owning DSH route and repeated review learning is idempotent', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dota-model-')),
    ctx = new Context()
  let calls = 0
  ctx.provide('llm', {
    resolveModelInfo: async (provider: string, model: string) => {
      assert.equal(provider, 'fixture-provider')
      assert.equal(model, 'fixture-model')
      return { reasoning: { efforts: [{ id: 'off' }] } }
    },
    prepareCall: async (config: Record<string, unknown>) => {
      assert.equal(config.provider, 'fixture-provider')
      assert.equal(config.model, 'fixture-model')
      assert.equal(config.reasoningEffort, 'off')
      return {
        config,
        stream: async function* (request: { system?: string }) {
          calls++
          let text = 'A grounded reflection about checking map information before moving.'
          if (request.system?.includes('"alpha"'))
            text = JSON.stringify({
              alpha: 0.8,
              usable: true,
              reason: 'Grounded in the saved evidence',
            })
          else if (request.system?.includes('"goal_achievement"'))
            text = JSON.stringify({
              goal_achievement: 0.5,
              process_quality: 0.5,
              user_satisfaction: 0,
              label: 'partial',
              reason: 'User report requires later verification',
            })
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  })
  const memory = new KnowledgeMemory(ctx, home, Config({ memoryOffline: true }))
  t.after(async () => {
    await memory.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const exec = {
    agent: { options: { provider: 'fixture-provider', model: 'fixture-model' } },
  } as ToolRunContext
  const record = {
    id: 'one-review',
    kind: 'review',
    title: 'Map check',
    learner_explanation: 'I crossed the river before checking allied positions.',
    body: 'Evidence shows where the allies were; visibility remains unknown.',
    evidence_ids: ['synthetic-evidence'],
    trigger: 'Before crossing',
    action_rule: 'Check the minimap',
    check_method: 'Review the next match',
    created_at: new Date().toISOString(),
  }
  const first = await memory.request('learn', { record }, exec)
  assert.ok(first.traceId)
  assert.ok(calls > 0)
  const count = calls
  const second = await memory.request('learn', { record }, exec)
  assert.equal(second.traceId, first.traceId)
  assert.equal(second.deduplicated, true)
  assert.equal(calls, count)
})
