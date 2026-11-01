import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import {
  stageRanges,
  stageMetrics,
  normalizePreferences,
  selectStageCandidates,
  validateStageAnalysis,
  validateReadyUse,
  analyzeStage,
} from '../packages/coach/src/report.ts'
import { GuidedCoach } from '../packages/coach/src/coaching.ts'
import { CoachStore } from '../packages/coach/src/store.ts'
import { CoachModel } from '../packages/coach/src/model.ts'
import { isConnectionError, errorMessage } from '../packages/coach/src/client/network.ts'
import type { Replays } from '../packages/coach/src/replay.ts'
import type { ReviewSession, ReportStage } from '../packages/coach/src/coaching-types.ts'
import { fixtureModel } from './coach-fixture.ts'
test('phase coverage respects duration, exact boundaries and Turbo, without invented late stages', () => {
  assert.deepEqual(
    stageRanges(600).map((s) => [s.from, s.to]),
    [[0, 600]],
  )
  assert.deepEqual(
    stageRanges(2130).map((s) => [s.from, s.to]),
    [
      [0, 600],
      [600, 1200],
      [1200, 2100],
      [2100, 2130],
    ],
  )
  assert.equal(stageRanges(1200, true).length, 3)
  assert.throws(() => stageRanges(NaN))
  assert.deepEqual(
    stageMetrics({ times: [0, 60, 120], gold_t: [0, 100, 160], xp_t: [0, 200, 400] }, 0, 120),
    ['总金钱 +160（曲线采样）', '经验 +400（曲线采样）'],
  )
  assert.deepEqual(stageMetrics({ times: [0, 60], gold_t: [0, 100] }, 0, 600), [])
  const prefs = normalizePreferences({ focus: ['fight', 'items', 'fight'] })
  assert.deepEqual(prefs.focus, ['fight', 'items'])
  const candidates = [
    { time: 100, kind: 'death', score: 8, actual: 'death', source: 'replay' as const },
    { time: 200, kind: 'death', score: 8, actual: 'death', source: 'replay' as const },
    { time: 280, kind: 'item', score: 5, actual: 'item', source: 'opendota' as const },
    { time: 600, kind: 'fight', score: 9, actual: 'fight', source: 'replay' as const },
  ]
  const selected = selectStageCandidates(candidates, { from: 0, to: 600 }, prefs)
  assert.ok(selected.length >= 2 && selected.length <= 3)
  assert.ok(selected.some((c) => c.kind === 'item'))
  assert.ok(selected.every((c) => c.time < 600))
  assert.equal(selectStageCandidates([], { from: 600, to: 1200 }, prefs)[0]!.kind, 'checkpoint')
})
test('report rejects foreign citations, repeated decisions and missing analyses', () => {
  const stage = { decisions: [{ id: 'a', evidence_ids: ['own'] }] } as ReportStage
  const output = {
    summary: 'summary',
    decisions: [
      {
        id: 'a',
        recommendation: 'try',
        tradeoff: 'risk',
        uncertainty: 'unknown',
        evidence_ids: ['own'],
        ready_uses: [],
      },
    ],
    goal: { title: 'x', trigger: 'x', action: 'x', check: 'x', basis: 'user_report' },
  }
  assert.equal(validateStageAnalysis(output, stage).decisions[0]!.id, 'a')
  assert.throws(() =>
    validateStageAnalysis(
      { ...output, decisions: [{ ...output.decisions[0], evidence_ids: ['foreign'] }] },
      stage,
    ),
  )
  assert.throws(() => validateStageAnalysis({ ...output, decisions: [] }, stage))
  assert.throws(() =>
    validateStageAnalysis(
      { ...output, decisions: [output.decisions[0], output.decisions[0]] },
      stage,
    ),
  )
  assert.equal(
    isConnectionError(new Error('client api: dotaCoach/invoke failed: Failed to fetch')),
    true,
  )
  assert.equal(isConnectionError(new Error('Invalid schema for function')), false)
  assert.match(errorMessage(new Error('Failed to fetch')), /草稿已保留/)
})
test('full report persists all phases, preferences, observed outcomes, resumes and saves only one goal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-report-')),
    store = new CoachStore(home),
    ctx = new Context(),
    shutdown = new AbortController()
  let discussionCalls = 0
  let calls = 0,
    failStageOnce = true
  fixtureModel(ctx, (_, input) => {
    if (input.kind === 'review_discussion') {
      discussionCalls++
      if (input.question === 'foreign citation test') input.evidence[0].id = 'foreign'
    }
    if (input.kind === 'stage_report') {
      calls++
      assert.equal(input.preferences.style, 'safe')
      assert.equal(input.role, 3)
      assert.equal(input.stage.decisions.length > 0, true)
      assert.equal(input.player_intention, '希望减少无谓的接团')
      if (input.stage.id === 'stage-2' && failStageOnce) {
        failStageOnce = false
        throw Error('fixture stage timeout')
      }
    }
  })
  const data = {
    match: {
      match_id: 987654,
      duration: 2400,
      game_mode: 22,
      patch: '7.41',
      players: [
        {
          player_slot: 0,
          account_id: 123,
          hero_id: 15,
          lane_role: 3,
          deaths_log: [{ time: 100 }, { time: 900 }, { time: 1500 }, { time: 2200 }],
          purchase_log: [
            { time: 300, key: 'blink' },
            { time: 1300, key: 'black_king_bar' },
          ],
        },
      ],
    },
    heroes: [{ id: 15, npc: 'npc_dota_hero_razor', name: 'Razor' }],
  }
  const native = [100, 900, 1500, 2200].map((t) => ({
    t,
    type: 'DOTA_COMBATLOG_DEATH',
    target: 'npc_dota_hero_razor',
    target_hero: true,
    attacker: 'npc_dota_hero_axe',
  }))
  const replay = {
    reviewEvents: async () => native,
    keyEvents: async () => native,
    scene: async (_id: number, from: number, to: number, _team: number, full: boolean) => ({
      ok: true,
      states: [
        {
          t: to,
          hero: 'razor',
          entity_kind: 'real_hero',
          team: 2,
          hp: full ? 0 : 600,
          max_hp: 1000,
          mana: 200,
          level: 8,
          life_state: full ? 1 : 0,
        },
      ],
      events: full ? native.filter((e) => e.t >= from && e.t <= to) : [],
    }),
  } as unknown as Replays
  const make = () =>
    new GuidedCoach(
      store,
      replay,
      new CoachModel(ctx),
      async () => data,
      async () => ({ ok: true }),
      shutdown.signal,
    )
  let coach = make()
  const args = {
    action: 'start',
    format: 'report',
    match_id: 987654,
    account_id: 123,
    role: 3,
    preferences: { style: 'safe', focus: ['fight'], intention: '希望减少无谓的接团' },
  }
  const wait = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const s = (await coach.invoke({ action: 'get', id })).session as unknown as ReviewSession
      if (s.phase !== 'preparing') return s
      await delay(5)
    }
    throw Error('timed out')
  }
  try {
    const first = (await coach.invoke(args)).session as unknown as ReviewSession
    assert.equal(((await coach.invoke(args)).session as unknown as ReviewSession).id, first.id)
    const s = await wait(first.id)
    assert.equal(s.phase, 'report', s.error)
    assert.equal(s.report!.version, 4)
    assert.equal(s.report!.stages[0]!.decisions.find((d) => d.kind === 'death')!.decision_time, 85)
    assert.equal(s.report!.stages.length, 4)
    assert.equal(calls, 4)
    assert.ok(
      s.report!.stages.every(
        (stage) =>
          (stage.status === 'ready' || stage.status === 'failed') &&
          stage.decisions.some((d) => d.actual.length && d.impact.length),
      ),
    )
    assert.ok(
      s.report!.stages[0]!.decisions[0]!.impact.some(
        (v) => v.includes('600 → 0') && v.includes('跨死亡'),
      ),
    )
    assert.equal(s.report!.stages[2]!.status, 'failed')
    await coach.invoke({ action: 'report', id: s.id })
    const retried = await wait(s.id)
    assert.ok(retried.report!.stages.every((x) => x.status === 'ready'))
    assert.equal(calls, 5, 'retry only the failed phase')
    await coach.dispose()
    coach = make()
    assert.equal(
      ((await coach.invoke({ action: 'get', id: s.id })).session as unknown as ReviewSession)
        .report!.stages.length,
      4,
    )
    await coach.invoke({ action: 'report', id: s.id })
    await wait(s.id)
    assert.equal(calls, 5, 'ready stages are not charged again')
    await coach.invoke({ action: 'open', id: s.id })
    assert.equal(calls, 5, 'opening a completed report never regenerates it')
    const reportBeforePresentation = JSON.stringify(
      ((await coach.invoke({ action: 'get', id: s.id })).session as unknown as ReviewSession)
        .report,
    )
    await Promise.all([
      coach.invoke({ action: 'presentation', id: s.id }),
      coach.invoke({ action: 'presentation', id: s.id }),
    ])
    let presented: ReviewSession | undefined
    for (let n = 0; n < 200; n++) {
      presented = (await coach.invoke({ action: 'get', id: s.id }))
        .session as unknown as ReviewSession
      if (presented.presentation?.status !== 'pending') break
      await delay(5)
    }
    assert.equal(presented!.presentation?.status, 'ready')
    assert.equal(presented!.presentation!.surfaces!.length, 4)
    assert.equal(
      JSON.stringify(presented!.report),
      reportBeforePresentation,
      'presentation does not rewrite the report',
    )
    assert.equal(calls, 5, 'composing UI does not reanalyze stages')
    const chatArgs = {
      action: 'discuss',
      id: s.id,
      turn_id: 'discussion-test-1',
      message: '1:40 这里有哪些可行选择？',
      stage_id: s.report!.stages[0]!.id,
    }
    await Promise.all([coach.invoke(chatArgs), coach.invoke(chatArgs)])
    const waitChat = async () => {
      for (let n = 0; n < 200; n++) {
        const now = (await coach.invoke({ action: 'get', id: s.id }))
          .session as unknown as ReviewSession
        if (!now.discussion?.some((t) => t.status === 'pending')) return now
        await delay(5)
      }
      throw Error('chat timeout')
    }
    const chatted = await waitChat()
    assert.equal(chatted.discussion!.length, 1)
    assert.equal(chatted.discussion![0]!.status, 'ready')
    assert.ok(chatted.discussion![0]!.ui, 'the agent-authored reply surface is persisted')
    assert.equal(discussionCalls, 1)
    assert.ok(
      chatted.discussion![0]!.extra_evidence!.length > 0,
      'an explicit timestamp retrieves its own bounded replay scene',
    )
    await coach.dispose()
    coach = make()
    const restored = (await coach.invoke({ action: 'open', id: s.id }))
      .session as unknown as ReviewSession
    assert.equal(restored.discussion![0]!.answer, chatted.discussion![0]!.answer)
    assert.equal(calls, 5)
    await coach.invoke({
      action: 'discuss',
      id: s.id,
      turn_id: 'discussion-test-bad',
      message: 'foreign citation test',
    })
    const badChat = await waitChat()
    assert.equal(badChat.discussion![1]!.status, 'failed')
    assert.equal(badChat.phase, 'report', 'a failed reply does not damage the completed report')

    const saved = (await coach.invoke({ action: 'save', id: s.id }))
      .session as unknown as ReviewSession
    const again = (await coach.invoke({ action: 'save', id: s.id }))
      .session as unknown as ReviewSession
    assert.equal(again.training_id, saved.training_id)
    assert.equal(store.list('training').length, 1)
    const different = (
      await coach.invoke({
        action: 'report',
        id: s.id,
        preferences: { ...args.preferences, intention: '另一种目标' },
      })
    ).session as unknown as ReviewSession
    assert.notEqual(different.id, s.id)
    const prior = (await coach.invoke({ action: 'get', id: s.id }))
      .session as unknown as ReviewSession
    assert.equal(prior.phase, 'complete')
    assert.equal(prior.preferences!.intention, '希望减少无谓的接团')
    assert.equal(store.list('training').length, 1)
    await coach.invoke({ action: 'cancel', id: different.id })
  } finally {
    await coach.dispose()
    store.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('resource readiness rejects reused, silenced and backpack actions', () => {
  const d = {
    state: {
      life_state: 0,
      mana: 100,
      controls: Object.fromEntries(
        [
          'stunned',
          'hexed',
          'nightmared',
          'out_of_game',
          'command_restricted',
          'feared',
          'taunted',
          'silenced',
          'muted',
        ].map((k) => [k, false]),
      ),
      recorded_active_abilities: ['razor_static_link'],
      recorded_active_items: ['item_magic_wand', 'item_blink'],
      abilities: [{ name: 'razor_static_link', level: 1, cooldown: 0, mana_cost: 50 }],
      items: [
        { name: 'item_magic_wand', slot: 0, cooldown: 10, charges: 3 },
        { name: 'item_blink', slot: 7, cooldown: 0 },
      ],
    },
  } as any
  assert.doesNotThrow(() => validateReadyUse(d, { kind: 'ability', name: 'razor_static_link' }))
  assert.throws(() => validateReadyUse(d, { kind: 'item', name: 'item_magic_wand' }))
  assert.throws(() => validateReadyUse(d, { kind: 'item', name: 'item_blink' }))
  d.state.controls.silenced = true
  assert.throws(() => validateReadyUse(d, { kind: 'ability', name: 'razor_static_link' }))
  d.state.controls.silenced = false
  d.state.mana = 0
  assert.throws(() => validateReadyUse(d, { kind: 'ability', name: 'razor_static_link' }))
})

test('a malformed or unsupported model decision receives one bounded correction with feedback', async () => {
  const stage = {
    id: 'x',
    decisions: [
      {
        id: 'd',
        actual: ['observed'],
        impact: ['unknown'],
        evidence_ids: ['e'],
        state: { abilities: [{ name: 'razor_plasma_field', level: 0, cooldown: 0 }] },
      },
    ],
  } as any
  const goal = { title: 'x', trigger: 'x', action: 'x', check: 'x', basis: 'user_report' }
  let attempts = 0
  const model = {
    complete: async (_route: unknown, _system: string, input: any) => {
      attempts++
      if (attempts === 2) assert.match(input.validation_error, /razor_plasma_field/)
      return JSON.stringify({
        summary: 'summary',
        decisions: [
          {
            id: 'd',
            recommendation:
              attempts === 1
                ? '立刻使用 razor_plasma_field'
                : '先学会该技能、确认蓝量和目标，再考虑 razor_plasma_field',
            tradeoff: 'risk',
            uncertainty: 'unknown',
            evidence_ids: ['e'],
            ready_uses: attempts === 1 ? [{ kind: 'ability', name: 'razor_plasma_field' }] : [],
            conditional_uses:
              attempts === 1
                ? []
                : [
                    {
                      name: 'razor_plasma_field',
                      condition: '先学会技能，并确认蓝量与目标满足施放要求',
                    },
                  ],
          },
        ],
        goal,
      })
    },
  } as any
  const s = { locale: 'zh', player: { hero: 'Razor' }, players: [] } as any
  const out = await analyzeStage(
    s,
    stage,
    model,
    { provider: 'fixture', model: 'fixture' },
    new AbortController().signal,
  )
  assert.equal(attempts, 2)
  assert.equal(out.decisions[0]!.conditions.length, 1)
})

test('mentioning a spent item as a constraint retains advice and adds its recorded prerequisite', () => {
  const stage = {
    decisions: [
      {
        id: 'd',
        evidence_ids: ['e'],
        state: {
          life_state: 0,
          mana: 200,
          items: [{ name: 'item_magic_wand', slot: 0, cooldown: 14, charges: 2, mana_cost: 0 }],
          recorded_active_items: ['item_magic_wand'],
          controls: {},
        },
      },
    ],
  } as any
  const out = validateStageAnalysis(
    {
      summary: 'summary',
      decisions: [
        {
          id: 'd',
          recommendation: '魔棒还在冷却，因此不要把它当作当前的保命技能；先等待控制结束并后撤。',
          tradeoff: '保留血量，可能放弃追击。',
          uncertainty: '视野未知',
          evidence_ids: ['e'],
          ready_uses: [],
        },
      ],
      goal: { title: 'x', trigger: 'x', action: 'x', check: 'x', basis: 'user_report' },
    },
    stage,
  )
  assert.equal(out.decisions[0]!.conditions.length, 1)
  assert.match(out.decisions[0]!.conditions[0]!, /14.0 秒/)
})
