import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { setTimeout as delay } from 'node:timers/promises'
import {
  GuidedCoach,
  pickMoments,
  reviewPlayers,
  validateExplanation,
  type ReviewData,
} from '../packages/coach/src/coaching.ts'
import { CoachStore } from '../packages/coach/src/store.ts'
import { CoachModel } from '../packages/coach/src/model.ts'
import { filterScene } from '../packages/coach/src/scene.ts'
import type { Replays } from '../packages/coach/src/replay.ts'
import type { ReviewSession } from '../packages/coach/src/coaching-types.ts'
import type { RecordValue } from '../packages/coach/src/types.ts'
import { fixtureModel } from './coach-fixture.ts'
const data: ReviewData = {
  match: JSON.parse(await readFile('packages/coach/fixtures/match.json', 'utf8')),
  heroes: [
    { id: 27, npc: 'npc_dota_hero_necrolyte', name: 'Necrophos' },
    { id: 15, npc: 'npc_dota_hero_razor', name: 'Razor' },
  ],
}
const frame = (t: number, team = 3, extra: RecordValue = {}) => ({
  t,
  team,
  entity_id: 'enemy:1',
  hero: 'axe',
  entity_kind: 'real_hero',
  x: 100 + t,
  y: 200,
  hp: 600,
  max_hp: 1000,
  abilities: [{ name: 'axe_berserkers_call', cooldown: 0 }],
  visible_radiant: null,
  ...extra,
})
test('team scene never leaks enemy position, cooldown, future observations or post-decision combat', () => {
  const states = [frame(8), frame(9), frame(10), frame(11), frame(12)],
    events = [
      { t: 9, target: 'npc_dota_hero_axe', target_hero: true, visible_radiant: true },
      { t: 12, target: 'npc_dota_hero_axe', target_hero: true, visible_radiant: true },
    ]
  const result = filterScene(states, events, 8, 11, 2, false),
    rows = result.states as RecordValue[]
  assert.equal(rows[0].last_seen, undefined)
  for (const row of rows) {
    assert.equal(row.x, undefined)
    assert.equal(row.hp, undefined)
    assert.equal(row.abilities, undefined)
    if (row.last_seen) assert.ok(Number((row.last_seen as RecordValue).t) <= Number(row.t))
  }
  assert.equal((result.events as RecordValue[]).length, 1)
  const visible = filterScene([frame(10, 3, { visible_radiant: true })], [], 10, 10, 2, false)
    .states as RecordValue[]
  assert.equal(visible[0].x, 110)
  assert.equal(visible[0].abilities, undefined)
  const full = filterScene(states, events, 8, 11, 2, true).states as RecordValue[]
  assert.equal(full[0].x, 108)
})
test('guided review persists, keeps outcomes out of questions, validates citations, saves once and resumes after reload', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-guided-'))
  const store = new CoachStore(home),
    ctx = new Context(),
    shutdown = new AbortController()
  let questionCalls = 0
  fixtureModel(ctx, (_, input) => {
    if (!input.player_report) {
      questionCalls++
      assert.equal(input.postmatch_evidence, undefined)
      assert.equal(input.scene.perspective, 'team')
    }
  })
  const replay = {
    keyEvents: async () => [],
    scene: async (_id: number, from: number, to: number, team: number, full: boolean) =>
      filterScene([frame(from, team, { hero: 'necrolyte' })], [], from, to, team, full),
  } as unknown as Replays
  const make = () =>
    new GuidedCoach(
      store,
      replay,
      new CoachModel(ctx),
      async () => data,
      async () => ({ ok: false, reason: 'expired_replay', detail: 'Replay expired' }),
      shutdown.signal,
    )
  let coach = make()
  try {
    const started = await Promise.all([
      coach.invoke({
        action: 'start',
        format: 'guided',
        match_id: 424242,
        account_id: 1000,
        role: 3,
      }),
      coach.invoke({
        action: 'start',
        format: 'guided',
        match_id: 424242,
        account_id: 1000,
        role: 3,
      }),
    ])
    const id = String((started[0].session as RecordValue).id)
    assert.equal((started[1].session as RecordValue).id, id)
    const wait = async () => {
      for (let n = 0; n < 200; n++) {
        const s = (await coach.invoke({ action: 'get', id })).session as unknown as ReviewSession
        if (s.phase !== 'preparing') return s
        await delay(5)
      }
      throw Error('review did not settle')
    }
    let s = await wait()
    assert.equal(s.phase, 'question')
    assert.equal(questionCalls, 1)
    assert.ok(s.warnings[0].includes('expired'))
    const leaked = await coach.invoke({ action: 'scene', id, from: 100, to: 140, full: true })
    assert.equal((leaked.window as RecordValue).to, s.moments[0].time - 1)
    assert.equal(leaked.perspective, 'team')
    while (s.phase !== 'practice') {
      await coach.invoke({ action: 'answer', id, answer: 'I wanted to push the wave' })
      s = await wait()
      assert.equal(s.phase, 'explanation')
      assert.throws(
        () =>
          validateExplanation(
            { ...s.moments[s.current].explanation, evidence_ids: ['foreign'] },
            s.moments[s.current],
          ),
        /outside/,
      )
      await coach.invoke({ action: 'next', id })
      s = await wait()
    }
    const saved = await coach.invoke({ action: 'save', id })
    assert.equal((saved.session as RecordValue).phase, 'complete')
    await coach.invoke({ action: 'save', id })
    assert.equal(store.list('review').length, 1)
    assert.equal(store.list('training').length, 1)
    const goal = store.list('training')[0]
    store.training({
      action: 'checkin',
      id: goal.id!,
      match_id: 424244,
      body: 'No relevant opportunity',
      completed: true,
      opportunity: false,
    })
    store.training({
      action: 'checkin',
      id: goal.id!,
      match_id: 424244,
      body: 'Still no relevant opportunity',
      completed: true,
      opportunity: false,
    })
    const checks = store.get(String(goal.id)).checkins as RecordValue[]
    assert.equal(checks.length, 1)
    assert.equal(checks[0].completed, false)
    await coach.dispose()
    coach = make()
    assert.equal(
      ((await coach.invoke({ action: 'get', id })).session as RecordValue).phase,
      'complete',
    )
  } finally {
    await coach.dispose()
    store.close()
    await rm(home, { recursive: true, force: true })
  }
})
test('moment selection requires evidence, keeps material chronologies and supports each role without KDA scores', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-moments-')),
    store = new CoachStore(home)
  try {
    for (const role of [1, 2, 3, 4, 5]) {
      const player = { ...reviewPlayers(data)[0], role }
      const moments = pickMoments(data, player, store)
      assert.ok(moments.length > 0 && moments.length <= 3)
      for (const m of moments) {
        assert.ok(m.from <= m.time && m.to >= m.time)
        assert.equal(store.get(m.facts[0].id).kind, 'evidence')
      }
    }
  } finally {
    store.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('native replay events remain usable when the upstream match has no parsed event log', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-native-moments-')),
    store = new CoachStore(home)
  try {
    const incomplete = {
      ...data,
      match: {
        ...data.match,
        players: [{ account_id: 1000, player_slot: 0, hero_id: 27 }],
        teamfights: [],
        objectives: [],
      },
    }
    const moments = pickMoments(incomplete, reviewPlayers(incomplete)[0], store, [
      {
        t: 90.125,
        type: 'DOTA_COMBATLOG_DEATH',
        target: 'npc_dota_hero_necrolyte',
        attacker: 'npc_dota_hero_axe',
      },
    ])
    assert.equal(moments.length, 1)
    assert.equal(moments[0].time, 90.125)
    assert.equal(moments[0].facts[0].source, 'replay')
    assert.equal((store.get(moments[0].facts[0].id).body as RecordValue).source, 'replay')
  } finally {
    store.close()
    await rm(home, { recursive: true, force: true })
  }
})
test('invalid event chronology and controlled cooldown assertions are rejected', () => {
  const moment = {
    id: 'm',
    time: 120,
    from: 100,
    to: 130,
    kind: 'death' as const,
    title: 'Decision',
    facts: [
      {
        id: 'e',
        label: 'event',
        time: 120,
        source: 'replay' as const,
        scope: 'postmatch' as const,
        facts: ['Death at 120 seconds.'],
      },
    ],
  }
  const base = {
    observation: 'Recorded event.',
    reasoning: 'Interpretation with uncertainty.',
    alternative: 'Try a different route.',
    uncertainty: 'Attention unknown.',
    evidence_ids: ['e'],
    goal: {
      title: 'Practice',
      trigger: 'Before moving',
      action: 'Check allies',
      check: 'Review five opportunities',
      basis: 'user_report',
    },
  }
  assert.throws(
    () =>
      validateExplanation(
        { ...base, checks: [{ evidence_id: 'e', time: 90, kind: 'event_time' }] },
        moment,
      ),
    /time/,
  )
  assert.throws(
    () => validateExplanation({ ...base, reasoning: 'At 12:00 you already had the item.' }, moment),
    /time/,
  )
  assert.throws(
    () =>
      validateExplanation(
        {
          ...base,
          checks: [{ evidence_id: 'e', time: 119, kind: 'cooldown_ready', name: 'spell' }],
        },
        moment,
        [
          {
            t: 119,
            life_state: 0,
            controls: { stunned: true },
            abilities: [{ name: 'spell', cooldown: 0, level: 1 }],
          },
        ],
      ),
    /availability/,
  )
})

test('cancel drains model work and a paused review can resume without duplicate goals', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-cancel-')),
    store = new CoachStore(home),
    ctx = new Context()
  fixtureModel(ctx)
  const model = new CoachModel(ctx),
    normal = model.complete.bind(model)
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  model.complete = async (_route, _system, _input, signal) => {
    entered()
    return new Promise<string>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
  }
  const replays = {
    keyEvents: async () => [],
    scene: async () => ({ states: [], events: [], perspective: 'team' }),
  } as unknown as Replays
  let coach = new GuidedCoach(
    store,
    replays,
    model,
    async () => data,
    async () => ({ ok: true }),
    new AbortController().signal,
  )
  try {
    const r = await coach.invoke({
      action: 'start',
      format: 'guided',
      match_id: 424242,
      account_id: 1000,
    })
    const id = String((r.session as RecordValue).id)
    await started
    await coach.invoke({ action: 'cancel', id })
    await coach.dispose()
    assert.equal((store.get(id) as RecordValue).phase, 'cancelled')
    assert.equal(store.list('training').length, 0)
    model.complete = normal
    coach = new GuidedCoach(
      store,
      replays,
      model,
      async () => data,
      async () => ({ ok: true }),
      new AbortController().signal,
    )
    await coach.invoke({ action: 'start', format: 'guided', match_id: 424242, account_id: 1000 })
    for (let n = 0; n < 100; n++) {
      const s = (await coach.invoke({ action: 'get', id })).session as RecordValue
      if (s.phase === 'question') break
      await delay(5)
    }
    assert.equal((store.get(id) as RecordValue).phase, 'question')
    assert.equal(store.list('coach_session').length, 1)
  } finally {
    await coach.dispose()
    store.close()
    await rm(home, { recursive: true, force: true })
  }
})
