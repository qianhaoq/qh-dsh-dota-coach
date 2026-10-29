/**
 * 纯函数层：把 OpenDota 的原始 JSON / 本地轨迹裁成「教练能读、模型能算」的形状。
 * 这里不碰网络和磁盘（clampResult 除外），方便 fixtures 离线自测。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const LANE_ROLE = { 1: '优势路', 2: '中路', 3: '劣势路', 4: '野区' }
const LOBBY = {
  0: '普通',
  1: '练习',
  2: '锦标赛',
  4: '合作',
  5: '组队',
  6: '单排',
  7: '天梯',
  8: '低优先级',
  9: '教程',
}
const GAME_MODE = {
  1: '全英雄选择',
  2: '队长模式',
  3: '随机征召',
  4: '单中',
  5: '全随机',
  22: '全英雄选择(天梯)',
}

export function fmtTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '?'
  const s = Math.round(Number(seconds))
  const sign = s < 0 ? '-' : ''
  const a = Math.abs(s)
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}

const RANKS = {
  1: 'Herald',
  2: 'Guardian',
  3: 'Crusader',
  4: 'Archon',
  5: 'Legend',
  6: 'Ancient',
  7: 'Divine',
  8: 'Immortal',
}

/** rank_tier（如 41）→ "Archon ★1" */
export function rankLabel(rankTier) {
  const n = Number(rankTier)
  if (!Number.isFinite(n) || n <= 0) return null
  const tier = Math.floor(n / 10)
  const star = n % 10
  const name = RANKS[tier] || `tier${tier}`
  return star ? `${name} ★${star}` : name
}

export function localTime(unixSeconds) {
  if (!unixSeconds) return null
  try {
    return new Date(unixSeconds * 1000)
      .toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-')
  } catch {
    return new Date(unixSeconds * 1000).toISOString()
  }
}

function npcShort(npc) {
  return String(npc || '').replace(/^npc_dota_hero_/, '')
}

export function heroOf(heroes, input) {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return heroes?.byId?.get(input) || null
  const s = String(input)
  if (/^\d+$/.test(s)) return heroes?.byId?.get(Number(s)) || null
  return heroes?.byNpc?.get(npcShort(s)) || heroes?.byName?.get(s.toLowerCase()) || null
}

export function heroName(heroes, input) {
  return heroOf(heroes, input)?.name || npcShort(input) || 'unknown'
}

export function isRadiantOf(player) {
  return typeof player?.isRadiant === 'boolean'
    ? player.isRadiant
    : (player?.player_slot ?? 0) < 128
}

export function itemName(itemsById, id) {
  const it = itemsById?.get(id)
  return it ? it.dname || it.key || String(id) : String(id)
}

export function keyItems(itemsByKey) {
  const out = new Map()
  for (const [key, it] of itemsByKey || []) {
    const cost = Number(it.cost) || 0
    const qual = String(it.qual || '')
    const excluded = [
      'consumable',
      'component',
      'recipe',
      'secret_shop',
      'deprecated',
      'attribute_bonus',
    ]
    if (cost >= 2000 && !excluded.includes(qual)) out.set(key, it)
  }
  return out
}

// ---------------------------------------------------------------- 对局列表

export function matchSummaryRow(row, heroes, accountId, { forceSelf = false } = {}) {
  const hero = heroOf(heroes, row.hero_id)
  const radiant = (row.player_slot ?? 0) < 128
  const win =
    row.radiant_win === undefined ? null : radiant === Boolean(row.radiant_win) ? 'win' : 'loss'
  return {
    match_id: row.match_id,
    hero: hero?.name || `hero_${row.hero_id}`,
    hero_id: row.hero_id,
    result: win,
    kda: `${row.kills ?? '?'}/${row.deaths ?? '?'}/${row.assists ?? '?'}`,
    duration: fmtTime(row.duration),
    duration_s: row.duration,
    gpm: row.gold_per_min ?? null,
    xpm: row.xp_per_min ?? null,
    last_hits: row.last_hits ?? null,
    lane: LANE_ROLE[row.lane_role] || null,
    start_local: localTime(row.start_time),
    start_time: row.start_time,
    lobby: LOBBY[row.lobby_type] || null,
    is_self: forceSelf ? true : row.account_id ? row.account_id === accountId : undefined,
  }
}

// ---------------------------------------------------------------- 单局总览

export function matchOverview(match, heroes) {
  return {
    match_id: match.match_id,
    start_local: localTime(match.start_time),
    duration: fmtTime(match.duration),
    duration_s: match.duration,
    winner: match.radiant_win ? 'radiant' : 'dire',
    game_mode: GAME_MODE[match.game_mode] || match.game_mode,
    lobby: LOBBY[match.lobby_type] || match.lobby_type,
    patch: match.patch ?? null,
    cluster: match.cluster ?? null,
    league_id: match.leagueid || null,
    picks_count: Array.isArray(match.picks_bans) ? match.picks_bans.length : 0,
    replay_url: match.replay_url || null,
    od_parsed: Array.isArray(match.players) && match.players.length > 0,
  }
}

export function matchPlayers(match, heroes, itemsById, { accountId } = {}) {
  return (match.players || []).map((p) => {
    const radiant = isRadiantOf(p)
    const win = Boolean(match.radiant_win) === radiant
    const b = p.benchmarks || {}
    return {
      slot: p.player_slot,
      team: radiant ? 'radiant' : 'dire',
      account_id: p.account_id ?? null,
      name: p.personaname || p.name || null,
      is_self: accountId ? p.account_id === accountId : undefined,
      hero: heroName(heroes, p.hero_id),
      hero_id: p.hero_id,
      level: p.level ?? null,
      kda: `${p.kills ?? '?'}/${p.deaths ?? '?'}/${p.assists ?? '?'}`,
      win,
      net_worth: p.net_worth ?? null,
      gpm: p.gold_per_min ?? null,
      xpm: p.xp_per_min ?? null,
      lh_dn: `${p.last_hits ?? '?'}/${p.denies ?? '?'}`,
      hero_damage: p.hero_damage ?? null,
      tower_damage: p.tower_damage ?? null,
      healing: p.hero_healing ?? p.hero_healing ?? null,
      lane: LANE_ROLE[p.lane_role] || null,
      roaming: Boolean(p.is_roaming),
      items: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5]
        .filter((x) => x !== undefined && x !== null && x !== 0)
        .map((id) => itemName(itemsById, id)),
      pct: {
        gpm: b.gold_per_min?.pct ?? null,
        xpm: b.xp_per_min?.pct ?? null,
        lh: b.last_hits_per_min?.pct ?? null,
        deaths: b.deaths_per_min?.pct ?? null,
      },
    }
  })
}

export function matchDraft(match, heroes) {
  const picks = []
  const bans = []
  for (const pb of match.picks_bans || []) {
    const row = {
      order: pb.order,
      team: pb.team === 0 ? 'radiant' : 'dire',
      hero: heroName(heroes, pb.hero_id),
    }
    if (pb.is_pick) picks.push(row)
    else bans.push(row)
  }
  picks.sort((a, b) => a.order - b.order)
  bans.sort((a, b) => a.order - b.order)
  return {
    picks,
    bans,
    first_pick: picks[0]?.team || null,
    draft_timings: (match.draft_timings || []).map((d) => ({
      order: d.order,
      pick: d.pick,
      team: d.active_team === 0 ? 'radiant' : 'dire',
      hero: d.hero_id ? heroName(heroes, d.hero_id) : null,
      time_taken_s: d.total_time_taken ?? null,
    })),
  }
}

/** 关键装备时间线：purchase_log + constants/items 的 cost 过滤。 */
export function matchItemTimings(
  match,
  heroes,
  itemsByKey,
  { minCost = 2000, perPlayer = 10 } = {},
) {
  const notable = keyItems(itemsByKey)
  const rows = []
  for (const p of match.players || []) {
    const radiant = isRadiantOf(p)
    const own = []
    for (const entry of p.purchase_log || []) {
      const key = String(entry.key || '')
      const meta = notable.get(key)
      if (!meta && !(Number(itemsByKey?.get(key)?.cost) >= minCost)) continue
      if (entry.time === undefined || entry.time < 0) continue
      own.push({
        t: entry.time,
        time: fmtTime(entry.time),
        item: meta?.dname || itemsByKey?.get(key)?.dname || key,
      })
    }
    own.sort((a, b) => a.t - b.t)
    rows.push({
      player: p.personaname || null,
      hero: heroName(heroes, p.hero_id),
      team: radiant ? 'radiant' : 'dire',
      is_self: undefined,
      items: own.slice(0, perPlayer).map((x) => ({ t: x.t, time: x.time, item: x.item })),
      more: Math.max(0, own.length - perPlayer),
    })
  }
  return rows
}

export function matchFights(match, heroes, { limit = 12, minDeaths = 2 } = {}) {
  return (match.teamfights || [])
    .filter((f) => (f.deaths ?? 0) >= minDeaths)
    .slice(0, limit)
    .map((f) => {
      const players = (f.players || []).map((p, idx) => {
        const mp = match.players?.[idx] || {}
        return {
          hero: heroName(heroes, mp.hero_id),
          team: isRadiantOf(mp) ? 'radiant' : 'dire',
          damage: p.damage ?? 0,
          healing: p.healing ?? 0,
          deaths: p.deaths ?? 0,
          kills: Object.keys(p.killed || {}).length,
          gold_delta: p.gold_delta ?? 0,
        }
      })
      const top = [...players]
        .sort((a, b) => b.damage + b.healing - (a.damage + a.healing))
        .slice(0, 3)
      const deathsBy = players.filter((p) => p.deaths > 0)
      return {
        start: fmtTime(f.start),
        end: fmtTime(f.end),
        last_death: fmtTime(f.last_death),
        deaths: f.deaths ?? 0,
        top: top.map((p) => ({ hero: p.hero, team: p.team, damage: p.damage, healing: p.healing })),
        deaths_by: deathsBy.map((p) => ({ hero: p.hero, team: p.team, deaths: p.deaths })),
      }
    })
}

const OBJ_LABEL = {
  building_kill: '建筑',
  CHAT_MESSAGE_ROSHAN_KILL: '肉山',
  CHAT_MESSAGE_AEGIS: '不朽盾',
  CHAT_MESSAGE_FIRSTBLOOD: '一血',
  CHAT_MESSAGE_COURIER_LOST: '信使',
}

export function matchObjectives(match) {
  return (match.objectives || [])
    .filter((o) =>
      [
        'building_kill',
        'CHAT_MESSAGE_ROSHAN_KILL',
        'CHAT_MESSAGE_AEGIS',
        'CHAT_MESSAGE_FIRSTBLOOD',
      ].includes(o.type),
    )
    .map((o) => {
      // building_kill：key 是被拆的建筑（goodguys=Radiant），player_slot 是拆的人。
      const owner = String(o.key || '').includes('goodguys')
        ? 'radiant'
        : String(o.key || '').includes('badguys')
          ? 'dire'
          : null
      const killerTeam =
        o.player_slot !== undefined
          ? o.player_slot < 128
            ? 'radiant'
            : 'dire'
          : o.team === 2
            ? 'radiant'
            : o.team === 3
              ? 'dire'
              : null
      return {
        time: fmtTime(o.time),
        t: o.time,
        kind: OBJ_LABEL[o.type] || o.type,
        building: o.key ? String(o.key).replace(/^npc_dota_/, '') : null,
        owner,
        by: o.unit ? npcShort(o.unit) : null,
        team: killerTeam,
      }
    })
}

export function matchCurves(match, { stepSeconds = 300 } = {}) {
  const gold = match.radiant_gold_adv || []
  const xp = match.radiant_xp_adv || []
  const points = []
  for (let i = 0; i < Math.max(gold.length, xp.length); i++) {
    const t = i * 60
    if (t % stepSeconds !== 0) continue
    points.push({ time: fmtTime(t), t, gold_adv: gold[i] ?? null, xp_adv: xp[i] ?? null })
  }
  return points
}

export function matchWards(match, heroes) {
  const rows = []
  for (const p of match.players || []) {
    const radiant = isRadiantOf(p)
    rows.push({
      hero: heroName(heroes, p.hero_id),
      team: radiant ? 'radiant' : 'dire',
      observer: (p.obs_log || []).length,
      sentry: (p.sen_log || []).length,
      observer_times: (p.obs_log || []).slice(0, 6).map((w) => fmtTime(w.time)),
      sentry_times: (p.sen_log || []).slice(0, 6).map((w) => fmtTime(w.time)),
    })
  }
  return rows
}

// ---------------------------------------------------------------- 英雄

export function heroBrief({ hero, stat, matchups, itemPop, heroes }) {
  const vs = (matchups || [])
    .filter((m) => (m.games_played ?? 0) >= 20)
    .map((m) => ({
      hero: heroName(heroes, m.hero_id),
      hero_id: m.hero_id,
      games: m.games_played,
      winrate: Number((((m.wins || 0) / (m.games_played || 1)) * 100).toFixed(1)),
    }))
  const good = [...vs].sort((a, b) => b.winrate - a.winrate).slice(0, 6)
  const bad = [...vs].sort((a, b) => a.winrate - b.winrate).slice(0, 6)
  const label = (stage) => {
    const bucket = itemPop?.[stage] || {}
    return Object.entries(bucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({ item_id: Number(id), count }))
  }
  return {
    hero: {
      id: hero.id,
      name: hero.name,
      npc: hero.npc,
      attr: hero.primaryAttr,
      attack: hero.attackType,
      roles: hero.roles,
    },
    meta: stat
      ? {
          pub_pick: stat['1_pick'] ?? null,
          pub_win: stat['1_win'] ?? null,
          pub_winrate:
            stat['1_win'] && stat['1_pick']
              ? Number(((stat['1_win'] / stat['1_pick']) * 100).toFixed(1))
              : null,
          pro_pick: stat['pro_pick'] ?? null,
          pro_win: stat['pro_win'] ?? null,
          pro_ban: stat['pro_ban'] ?? null,
        }
      : null,
    counters: { good_vs: good, bad_vs: bad, sample: vs.length, min_games: 20 },
    items: {
      start: label('start_game_items'),
      early: label('early_game_items'),
      mid: label('mid_game_items'),
      late: label('late_game_items'),
    },
  }
}

// ---------------------------------------------------------------- 轨迹：校准与合并

/** 用 OpenDota 的建筑击杀时间校准本地轨迹（轨迹 t 是净值时间，减掉 offset 就是游戏时间）。 */
export function calibrateOffset(
  traceObjectives,
  match,
  { minAnchors = 3, matchRatio = 0.6, residualSeconds = 2 } = {},
) {
  const od = (match.objectives || []).filter(
    (o) => o.type === 'building_kill' && typeof o.key === 'string',
  )
  const trace = (traceObjectives || []).filter((o) => typeof o.building_id === 'string')
  const pairs = []
  const used = new Set()
  for (const o of od) {
    const hits = trace.filter((t) => t.building_id === o.key)
    if (hits.length !== 1 || used.has(o.key)) continue
    const delta = Number(hits[0].t) - Number(o.time)
    if (!Number.isFinite(delta)) continue
    used.add(o.key)
    pairs.push({ id: o.key, delta })
  }
  const deltas = pairs.map((p) => p.delta).sort((a, b) => a - b)
  const offset = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null
  const good =
    offset === null ? [] : pairs.filter((p) => Math.abs(p.delta - offset) <= residualSeconds)
  const ratio = good.length / Math.max(od.length, trace.length, 1)
  const maxResidual = good.length ? Math.max(...good.map((p) => Math.abs(p.delta - offset))) : null
  const ok = good.length >= minAnchors && ratio >= matchRatio && maxResidual <= residualSeconds
  return {
    ok,
    offset_seconds: ok ? Number(offset.toFixed(3)) : null,
    matched: good.length,
    od_objectives: od.length,
    trace_objectives: trace.length,
    match_ratio: ratio,
    max_residual_seconds: maxResidual,
    method: 'same_building_id_median',
    reason: ok ? null : 'insufficient_identified_anchors_or_residual',
    anchors: good,
  }
}

function nearestSample(samples, t) {
  if (!samples || samples.length === 0) return null
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const a = samples[Math.max(0, lo - 1)]
  const b = samples[lo]
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b
  return Math.abs(best.t - t) <= 8 ? best : null
}

function dist(a, b) {
  if (!a || !b) return null
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y))
}

/** 把 OpenDota 的死亡记录与本地轨迹 join：位置、最近队友距离、敌方眼位覆盖。 */
export function joinDeaths(match, heroes, trace, offset, { from = -Infinity, to = Infinity } = {}) {
  if (!trace || !Array.isArray(trace.heroes) || !Number.isFinite(offset)) return null
  const norm = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/^npc_dota_hero_/, '')
      .replace(/[\s_-]+/g, '')
  const byHero = new Map()
  for (const s of trace.heroes) {
    if (s.entity_kind !== 'real_hero') continue
    const key = norm(s.hero)
    if (!byHero.has(key)) byHero.set(key, [])
    byHero.get(key).push(s)
  }
  for (const arr of byHero.values()) arr.sort((a, b) => a.t - b.t)
  const heroesByNpc = new Map()
  for (const h of heroes?.list || []) heroesByNpc.set(norm(h.npc), h)

  const rows = []
  for (const p of match.players || []) {
    const victim = heroOf(heroes, p.hero_id)
    if (!victim) continue
    for (const d of p.deaths_log || []) {
      const gameT = Number(d.time)
      if (!Number.isFinite(gameT) || gameT < from || gameT > to) continue
      const netT = gameT + offset
      const self = nearestSample(byHero.get(norm(victim.npc)), netT)
      const myTeam = isRadiantOf(p) ? 'radiant' : 'dire'
      let nearestMate = null
      if (self) {
        for (const [hname, arr] of byHero) {
          if (hname === norm(victim.npc)) continue
          const mate = heroesByNpc.get(hname)
          if (!mate) continue
          const pl = (match.players || []).find((x) => heroOf(heroes, x.hero_id)?.id === mate.id)
          if (!pl || (isRadiantOf(pl) ? 'radiant' : 'dire') !== myTeam) continue
          const s = nearestSample(arr, netT)
          if (!s || s.alive !== 0) continue
          const dd = dist(self, s)
          if (dd !== null && (nearestMate === null || dd < nearestMate.distance)) {
            nearestMate = { hero: mate.name, distance: dd }
          }
        }
      }
      const enemyWards = (trace.wards || [])
        .filter(
          (w) => w.event === 'created' && w.team === (myTeam === 'radiant' ? 3 : 2) && netT >= w.t,
        )
        .map((w) => {
          const end = (trace.wards || []).find(
            (d) => d.event === 'deleted' && d.entity_id === w.entity_id && d.t >= w.t,
          )
          return {
            kind: w.kind,
            distance: self ? dist(self, w) : null,
            lifecycle: end ? 'known' : 'unknown',
            active: end ? netT < end.t : null,
          }
        })
        .filter((w) => w.distance !== null && w.distance <= 1000 && w.active !== false)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
      rows.push({
        time: fmtTime(gameT),
        t: gameT,
        victim: victim.name,
        victim_team: myTeam,
        killer: d.key ? heroName(heroes, d.key) : '小兵/中立/建筑',
        time_dead_s: d.time_dead ?? null,
        gold_fed: d.gold_fed ?? null,
        pos: self ? { x: Math.round(self.x), y: Math.round(self.y) } : null,
        nearest_teammate: nearestMate,
        alone: nearestMate === null ? null : nearestMate.distance > 1600,
        enemy_wards_nearby: enemyWards,
        interpretation:
          'Distances and nearby entities are observations; visibility and cause of death are unknown.',
      })
    }
  }
  rows.sort((a, b) => a.t - b.t)
  return rows
}

/** 合并时间线：死亡（OpenDota 时间 + 轨迹坐标）、建筑/肉山、关键装备、眼位、团战。 */
/** @param {{match: Object, heroes: Object, itemsByKey: Map, trace?: Object|null, offset?:number|null,from?:number,to?:number,teams?:string[]|null,limit?:number}} options */
export function buildTimeline({
  match,
  heroes,
  itemsByKey,
  trace,
  offset = null,
  from = 0,
  to = Infinity,
  teams = null,
  limit = 250,
}) {
  if (!Number.isFinite(offset)) trace = null
  const events = []
  const teamOk = (team) => !teams || teams.length === 0 || teams.includes(team)
  const gameT = (netT) => (offset === null ? netT : netT - offset)

  for (const row of matchObjectives(match)) {
    if (row.t >= from && row.t <= to && teamOk(row.team)) {
      events.push({
        t: row.t,
        time: row.time,
        kind: row.kind,
        detail: row.building || '',
        by: row.by,
        team: row.team,
      })
    }
  }
  const items = matchItemTimings(match, heroes, itemsByKey, { perPlayer: 6 })
  for (const p of items) {
    if (!teamOk(p.team)) continue
    for (const it of p.items) {
      const t = Number(it.t)
      if (!Number.isFinite(t) || t < from || t > to) continue
      events.push({ t, time: it.time, kind: '装备', detail: it.item, by: p.hero, team: p.team })
    }
  }
  if (trace && Array.isArray(trace.wards)) {
    for (const w of trace.wards) {
      const t = gameT(w.t)
      if (t < from || t > to) continue
      const team = w.team === 2 ? 'radiant' : 'dire'
      if (!teamOk(team)) continue
      events.push({
        t,
        time: fmtTime(t),
        kind: w.event === 'deleted' ? '眼位删除' : w.kind === 'sentry' ? '岗哨' : '观察者',
        detail: '',
        team,
        pos: { x: Math.round(w.x), y: Math.round(w.y) },
      })
    }
  }
  if (trace) {
    const deaths = joinDeaths(match, heroes, trace, offset ?? 0, { from, to })
    if (deaths) {
      for (const d of deaths) {
        if (!teamOk(d.victim_team)) continue
        events.push({
          t: d.t,
          time: d.time,
          kind: '死亡',
          detail: `${d.victim} 死于 ${d.killer}`,
          team: d.victim_team,
          pos: d.pos,
          alone: d.alone,
        })
      }
    }
  } else {
    for (const p of match.players || []) {
      const victim = heroName(heroes, p.hero_id)
      const team = isRadiantOf(p) ? 'radiant' : 'dire'
      for (const d of p.deaths_log || []) {
        if (d.time < from || d.time > to || !teamOk(team)) continue
        events.push({
          t: d.time,
          time: fmtTime(d.time),
          kind: '死亡',
          detail: `${victim} 死于 ${d.key ? heroName(heroes, d.key) : '小兵/中立'}`,
          team,
        })
      }
    }
  }
  for (const f of match.teamfights || []) {
    if (f.start < from || f.start > to) continue
    events.push({
      t: f.start,
      time: fmtTime(f.start),
      kind: '团战',
      detail: `${f.deaths || 0} 人死亡`,
      team: null,
    })
  }
  events.sort((a, b) => a.t - b.t)
  return {
    offset_seconds: offset,
    total: events.length,
    truncated: events.length > limit,
    events: events.slice(0, limit),
  }
}

// ---------------------------------------------------------------- 输出预算

/** 超预算就落盘，只回一个指针；绝不把 2.8MB 的轨迹塞进上下文。 */
export async function clampResult(value, { maxBytes = 24_576, dir, name = 'result', hint } = {}) {
  const json = JSON.stringify(value)
  const bytes = Buffer.byteLength(json)
  if (bytes <= maxBytes) return { value, bytes, truncated: false }
  let file = null
  if (dir) {
    await mkdir(dir, { recursive: true })
    file = `${dir}/${name}.json`
    await writeFile(file, json)
  }
  return {
    value: {
      ok: true,
      truncated: true,
      bytes,
      max_bytes: maxBytes,
      file,
      hint:
        hint || (file ? '结果超预算，已落盘；用 read 工具分段读该文件。' : '结果超预算且未落盘。'),
      keys: value && typeof value === 'object' ? Object.keys(value) : [],
      preview: json.slice(0, Math.max(0, maxBytes - 500)),
    },
    bytes,
    truncated: true,
    file,
  }
}
