import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as shape from '../packages/coach/src/legacy/shape.mjs'
import { heroLifeState } from '../packages/coach/src/service.ts'
const match = JSON.parse(
  await readFile(new URL('../packages/coach/fixtures/match.json', import.meta.url), 'utf8'),
)
const objectives = JSON.parse(
  await readFile(
    new URL('../packages/coach/fixtures/objectives.trace.json', import.meta.url),
    'utf8',
  ),
)
test('public hero life state distinguishes alive, dead and unknown', () => {
  assert.deepEqual(heroLifeState(0), { life_state: 0, alive: true })
  assert.deepEqual(heroLifeState(2), { life_state: 2, alive: false })
  assert.deepEqual(heroLifeState(null), { life_state: null, alive: null })
})
test('calibration pairs the same building and requires three anchors, ratio and residual', () => {
  const good = shape.calibrateOffset(objectives, match)
  assert.equal(good.ok, true)
  assert.equal(good.offset_seconds, 100)
  assert.equal(shape.calibrateOffset(objectives.slice(0, 2), match).ok, false)
  assert.equal(
    shape.calibrateOffset(
      objectives.map((o: Record<string, unknown>) => ({ ...o, building_id: 'different' })),
      match,
    ).offset_seconds,
    null,
  )
  assert.equal(
    shape.calibrateOffset(
      objectives.map((o: Record<string, number>, i: number) => ({
        ...o,
        t: o.t + (i === 2 ? 8 : 0),
      })),
      match,
    ).ok,
    false,
  )
})
test('failed alignment retains API deaths and never merges coordinates at zero offset', () => {
  const timeline = shape.buildTimeline({
    match,
    heroes: { byId: new Map() },
    itemsByKey: new Map(),
    trace: {
      heroes: [{ t: 120, hero: 'AntiMage', x: 1, y: 1 }],
      wards: [{ t: 120, x: 1, y: 1, team: 2, kind: 'observer' }],
    },
    offset: null,
  })
  assert.ok(timeline.events.some((r: Record<string, unknown>) => r.kind === '死亡'))
  assert.ok(timeline.events.every((r: Record<string, unknown>) => !r.pos))
  assert.equal(
    timeline.events.filter((r: Record<string, unknown>) => r.kind === '观察者').length,
    0,
  )
})
test('real hero samples exclude replicas and clones, and unknown ward lifecycles stay unknown', () => {
  const heroes = {
    list: [
      { id: 1, npc: 'npc_dota_hero_antimage', name: 'AntiMage' },
      { id: 2, npc: 'npc_dota_hero_axe', name: 'Axe' },
    ],
    byId: new Map([
      [1, { id: 1, npc: 'npc_dota_hero_antimage', name: 'AntiMage' }],
      [2, { id: 2, npc: 'npc_dota_hero_axe', name: 'Axe' }],
    ]),
  }
  const m = {
    players: [
      { hero_id: 1, player_slot: 0, deaths_log: [{ time: 120 }] },
      { hero_id: 2, player_slot: 1 },
    ],
  }
  const trace = {
    heroes: [
      { t: 220, hero: 'AntiMage', entity_kind: 'real_hero', x: 100, y: 100, alive: 0 },
      { t: 220, hero: 'AntiMage', entity_kind: 'illusion_or_replica', x: 9999, y: 9999, alive: 0 },
      { t: 220, hero: 'Axe', entity_kind: 'real_hero', x: 200, y: 200, alive: 0 },
      { t: 220, hero: 'Axe', entity_kind: 'clone', x: 5000, y: 5000, alive: 0 },
    ],
    wards: [
      { t: 200, team: 3, kind: 'observer', event: 'created', entity_id: '1:1', x: 110, y: 110 },
    ],
    objectives: [],
  }
  const rows = shape.joinDeaths(m, heroes, trace, 100)!
  assert.deepEqual(rows[0]!.pos, { x: 100, y: 100 })
  assert.equal(rows[0]!.nearest_teammate.hero, 'Axe')
  assert.equal(rows[0]!.enemy_wards_nearby[0].lifecycle, 'unknown')
  assert.equal(rows[0]!.enemy_wards_nearby[0].active, null)
})

test('replay host validation accepts official regional hosts and rejects arbitrary URLs', async () => {
  const { isReplayUrl } = await import('../packages/coach/src/replay.ts')
  for (const host of [
    'replay123.valve.net',
    'replay413.dota2.com.cn',
    'replay123.steamcontent.com',
  ])
    assert.equal(isReplayUrl('http://' + host + '/570/synthetic.dem.bz2'), true)
  for (const url of [
    'http://127.0.0.1/replay.dem',
    'http://replay1.valve.net.evil.test/a',
    'http://replay1.valve.net:123/a',
    'http://user:password@replay1.valve.net/a',
    'file:///tmp/replay.dem',
    'broken',
  ])
    assert.equal(isReplayUrl(url), false)
})
