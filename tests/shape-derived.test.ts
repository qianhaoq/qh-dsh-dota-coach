import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchDerived } from '../packages/coach/src/legacy/shape.mjs'

// Synthetic, anonymous minute samples; the largest Radiant loss is 5:00–10:00.
const fixture = () => ({
  duration: 900,
  players: [
    {
      hero_id: 1,
      player_slot: 0,
      account_id: 42,
      kills: 3,
      gold_t: Array.from({ length: 16 }, (_, i) => i * 100),
      xp_t: Array.from({ length: 16 }, (_, i) => i * 200),
      deaths_log: [{ time: 400, key: 'npc_dota_hero_axe' }],
      purchase_log: [
        { key: 'blink', time: 300 },
        { key: 'black_king_bar', time: 650 },
        { key: 'branches', time: 20 },
      ],
      killed_by: { npc_dota_hero_axe: 2 },
    },
    {
      hero_id: 2,
      player_slot: 128,
      kills: 5,
      gold_t: Array.from({ length: 16 }, (_, i) => i * 120),
      xp_t: Array.from({ length: 16 }, (_, i) => i * 220),
      deaths_log: [],
      purchase_log: [{ key: 'force_staff', time: 200 }],
    },
  ],
  radiant_gold_adv: [0, 0, 0, 0, 0, 0, -100, -200, -300, -400, -500, -500, -500, -500, -500, -500],
  objectives: [
    { time: 600, type: 'CHAT_MESSAGE_ROSHAN_KILL', team: 3 },
    { time: 601, type: 'CHAT_MESSAGE_AEGIS', team: 3 },
  ],
})
const derive = (m: any, accountId = 42) => matchDerived(m, null, new Map(), { accountId })

test('player gold/XP sums at minute ten and final kills respect focus', () => {
  const d = derive(fixture())
  assert.deepEqual(d.gold_t_summary, {
    source: 'players.gold_t',
    points: [
      {
        t: 600,
        label: '@10',
        radiant: 1000,
        dire: 1200,
        diff: -200,
        focus: 1000,
        focus_team_diff: -200,
      },
    ],
  })
  assert.equal(d.xp_t_summary.points[0].diff, -200)
  assert.equal(d.kills_diff.focus_diff, -2)
  assert.equal(derive(fixture(), 999).kills_diff.focus_diff, undefined)
})

test('five point intervals, inclusive deaths/objectives and purchase relations', () => {
  const d = derive(fixture())
  assert.deepEqual(d.worst_gold_window, {
    start_s: 300,
    end_s: 600,
    start: '5:00',
    end: '10:00',
    gold_delta_for_team: -500,
    team: 'radiant',
    source: 'radiant_gold_adv',
  })
  assert.equal(d.deaths_in_window[0].t, 400)
  assert.equal(d.objectives_in_window.length, 1)
  assert.deepEqual(
    d.purchases_key_items.map((p) => [p.item_key, p.vs_worst_window, p.vs_own_deaths]),
    [
      ['force_staff', 'before', 'no_deaths'],
      ['blink', 'during', 'before_first_death'],
      ['black_king_bar', 'after', 'after_a_death'],
    ],
  )
  assert.equal(d.purchases_key_items[1].is_self, true)
  assert.equal(JSON.stringify(d).includes('该出'), false)
  assert.deepEqual(d.killed_by[0], {
    hero: '1',
    team: 'radiant',
    killer_npc: 'npc_dota_hero_axe',
    killer: 'axe',
    count: 2,
  })
})

test('advantage fallback gives no absolute values; absent XP remains unknown', () => {
  const m: any = fixture()
  for (const p of m.players) {
    delete p.gold_t
    delete p.xp_t
  }
  const d = derive(m)
  assert.deepEqual(d.gold_t_summary, {
    source: 'radiant_gold_adv',
    points: [{ t: 600, label: '@10', gold_adv: -500 }],
  })
  assert.equal(d.xp_t_summary, null)
  assert.ok(d.missing_fields.includes('players.xp_t'))
  assert.ok(d.missing_fields.includes('xp_t'))
  m.radiant_xp_adv = m.radiant_gold_adv
  assert.equal(derive(m).xp_t_summary.points[0].xp_adv, -500)
})

test('gold-derived window, Dire perspective, incomplete samples and short curves', () => {
  const m: any = fixture()
  delete m.radiant_gold_adv
  assert.equal(derive(m).worst_gold_window.source, 'players.gold_t')
  m.players[1].account_id = 99
  assert.equal(derive(m, 99).worst_gold_window.gold_delta_for_team, 100)
  delete m.players[1].gold_t
  assert.deepEqual(derive(m).gold_t_summary.points, [])
  assert.equal(derive(m).worst_gold_window, null)
  m.radiant_gold_adv = [0, 1, 2, 3, 4]
  assert.ok(derive(m).missing_fields.includes('worst_gold_window'))
  assert.deepEqual(derive(m).deaths_in_window, [])
  delete m.players[0].deaths_log
  assert.equal(
    derive(m).purchases_key_items.find((p) => p.item_key === 'blink').vs_own_deaths,
    'unknown',
  )
})

test('all players contribute to team totals; empty purchases are marked missing', () => {
  const m: any = fixture()
  m.players.push({ ...m.players[0], hero_id: 3, account_id: 77, kills: 0 })
  const d = derive(m)
  assert.equal(d.gold_t_summary.points[0].radiant, 2000)
  assert.equal(d.gold_t_summary.points[0].diff, 800)
  for (const p of m.players) p.purchase_log = []
  assert.ok(derive(m).missing_fields.includes('purchase_log'))
  m.radiant_gold_adv = [0, 0, 0, 0, 0, 500, 600]
  m.players[1].account_id = 99
  assert.equal(derive(m, 99).worst_gold_window.gold_delta_for_team, -600)
})
