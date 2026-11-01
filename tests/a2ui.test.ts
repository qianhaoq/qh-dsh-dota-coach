import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fallbackUi,
  validateUi,
  reduceMessages,
  surfaceMessages,
  resolveUiAction,
  CATALOG,
} from '../packages/coach/src/a2ui.ts'
import { discussReview } from '../packages/coach/src/discussion.ts'
import { composePresentation } from '../packages/coach/src/presentation.ts'
const decisions = [
  { id: 'd1', time: 100, evidence_ids: ['e1'] },
  { id: 'd2', time: 200, evidence_ids: ['e2'] },
] as any
const evidence = [{ id: 'e1' }, { id: 'e2' }] as any
const refs = { surfaceId: 'stage-0', decisions, evidence, requireCoverage: true }
test('presentation-only repair is bounded, preserves the report and does not request analysis', async () => {
  let calls = 0
  const session = {
    report: { stages: [{ id: 'stage-0', title: '对线', decisions }], evidence },
  } as any
  const original = JSON.stringify(session)
  const model = {
    complete: async (_route: unknown, _system: string, input: any) => {
      calls++
      assert.equal(input.kind, 'review_presentation')
      if (calls === 1) return JSON.stringify({ ui: [] })
      assert.match(input.validation_error, /surfaces/)
      return JSON.stringify({ surfaces: [fallbackUi('stage-0', decisions)] })
    },
  } as any
  const out = await composePresentation(
    session,
    model,
    { provider: 'fixture', model: 'fixture' },
    new AbortController().signal,
  )
  assert.equal(out.length, 1)
  assert.equal(calls, 2)
  assert.equal(JSON.stringify(session), original)
})
test('A2UI compositions accept only known components, acyclic trees and scoped record references', () => {
  const valid = fallbackUi(refs.surfaceId, decisions)
  assert.ok(validateUi(valid, refs))
  for (const mutate of [
    (p: any) => {
      p.updateComponents.components[1].component = 'Html'
      p.updateComponents.components[1].html = '<script/>'
    },
    (p: any) => {
      p.updateComponents.components[1].decisionId = 'foreign'
    },
    (p: any) => {
      p.updateComponents.components[0].children = ['root']
    },
    (p: any) => {
      p.updateComponents.components[0].children = ['absent']
    },
    (p: any) => {
      p.updateComponents.components[2].id = 'moment-0'
    },
    (p: any) => {
      p.updateComponents.components[2] = {
        id: 'moment-1',
        component: 'EvidenceList',
        evidenceIds: ['foreign'],
      }
    },
    (p: any) => {
      p.updateComponents.surfaceId = 'other'
    },
    (p: any) => {
      p.updateComponents.components[2].decisionId = 'd1'
    },
  ]) {
    const p = structuredClone(valid)
    mutate(p)
    assert.equal(validateUi(p, refs), undefined)
  }
})
test('A2UI ordered surfaces support component/data patches and deletion without unsafe object paths', () => {
  const patch = fallbackUi('stage-0', decisions)
  const messages = surfaceMessages(patch, { value: { hp: 26 } })
  const s = reduceMessages([
    ...messages,
    { version: 'v0.9.1', updateDataModel: { surfaceId: 'stage-0', path: '/value/hp', value: 97 } },
  ]).get('stage-0')!
  assert.equal((s.data as any).value.hp, 97)
  assert.equal(s.components.get('moment-0')?.component, 'DecisionCard')
  assert.equal(
    reduceMessages([...messages, { version: 'v0.9.1', deleteSurface: { surfaceId: 'stage-0' } }])
      .size,
    0,
  )
  assert.throws(() => reduceMessages([patch]), /not been created/)
  assert.throws(() => reduceMessages([...messages, messages[0]!]), /Invalid A2UI surface/)
  assert.throws(
    () =>
      reduceMessages([
        { version: 'v0.9.1', createSurface: { surfaceId: 's', catalogId: CATALOG } },
        {
          version: 'v0.9.1',
          updateDataModel: { surfaceId: 's', path: '/__proto__/injected', value: true },
        },
      ]),
    /Invalid data path/,
  )
  assert.equal(({} as any).injected, undefined)
})
test('A2UI action references remain bound to the issuing component and surface', () => {
  const patch = fallbackUi('stage-0', decisions)
  const event = {
    version: 'v0.9.1',
    action: {
      surfaceId: 'stage-0',
      sourceComponentId: 'moment-0',
      timestamp: new Date().toISOString(),
      name: 'open_replay',
      context: { decisionId: 'd1' },
    },
  } as const
  assert.equal(resolveUiAction(event, patch, refs)?.decisionId, 'd1')
  assert.equal(
    resolveUiAction(
      { ...event, action: { ...event.action, context: { decisionId: 'd2' } } },
      patch,
      refs,
    ),
    undefined,
  )
  assert.equal(
    resolveUiAction({ ...event, action: { ...event.action, surfaceId: 'foreign' } }, patch, refs),
    undefined,
  )
  assert.equal(
    resolveUiAction({ ...event, action: { ...event.action, name: 'open_match' } }, patch, refs),
    undefined,
  )
})
test('invalid optional A2UI never loses an answer or causes another analysis call', async () => {
  let calls = 0
  const session = {
    locale: 'zh',
    player: { hero: 'Razor', slot: 0, team: 2 },
    players: [],
    report: { duration: 600, stages: [], evidence: [] },
    discussion: [],
  } as any
  const out = await discussReview(
    session,
    { id: 'turn-test', question: '概括一下' } as any,
    {
      complete: async () => {
        calls++
        return JSON.stringify({ answer: '先核对状态。', citations: [], ui: { version: 'bad' } })
      },
    } as any,
    { provider: 'fixture', model: 'fixture' },
    {} as any,
    {} as any,
    new AbortController().signal,
  )
  assert.equal(out.answer, '先核对状态。')
  assert.equal(out.ui, undefined)
  assert.equal(calls, 1)
})
