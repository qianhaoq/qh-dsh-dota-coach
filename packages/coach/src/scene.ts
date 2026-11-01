import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { RecordValue, Json } from './types.ts'
export const TRACE_VERSION = 3
const objects = (v: unknown): RecordValue[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
export async function indexTactical(traceDir: string, signal: AbortSignal): Promise<void> {
  await mkdir(join(traceDir, 'windows'), { recursive: true })
  for (const kind of ['states', 'events']) {
    let bucket: number | undefined,
      buffer: string[] = []
    const flush = async () => {
      if (buffer.length)
        await appendFile(
          join(traceDir, 'windows', `${kind}-${bucket}.jsonl.gz`),
          gzipSync(buffer.join('\n') + '\n'),
        )
      buffer = []
    }
    for await (const line of createInterface({
      input: createReadStream(join(traceDir, kind + '.jsonl')),
      crlfDelay: Infinity,
    })) {
      signal.throwIfAborted()
      if (!line) continue
      const row = JSON.parse(line)
      if (!Number.isFinite(row.t)) continue
      const next = Math.floor(row.t / 15)
      if (next !== bucket) {
        await flush()
        bucket = next
      }
      buffer.push(line)
    }
    await flush()
  }
}
export function filterScene(
  states: RecordValue[],
  events: RecordValue[],
  from: number,
  to: number,
  team: number,
  full = false,
): RecordValue {
  const visibility = team === 2 ? 'visible_radiant' : 'visible_dire'
  const seen = new Map<string, { t: number; x: Json; y: Json }>()
  const eligibleEvents = events
    .filter((e) => Number(e.t) <= to)
    .sort((a, b) => Number(a.t) - Number(b.t))
  let cursor = 0
  const history = new Map<string, RecordValue>()
  const filtered: RecordValue[] = []
  // Advance observations only forwards; never find a position from a future sample.
  for (const state of [...states].sort((a, b) => Number(a.t) - Number(b.t))) {
    const t = Number(state.t),
      key = String(state.hero).replaceAll('_', '').toLowerCase()
    history.set(key, state)
    while (cursor < eligibleEvents.length && Number(eligibleEvents[cursor].t) <= t) {
      const event = eligibleEvents[cursor++]
      if (
        event.visibility_scope === 'target' &&
        event[visibility] === true &&
        event.target_hero === true &&
        event.target_illusion !== true
      ) {
        const name = String(event.target)
            .replace('npc_dota_hero_', '')
            .replaceAll('_', '')
            .toLowerCase(),
          position = history.get(name)
        if (
          position &&
          Number(event.t) - Number(position.t) >= 0 &&
          Number(event.t) - Number(position.t) <= 0.25
        )
          seen.set(name, { t: Number(event.t), x: position.x!, y: position.y! })
      }
    }
    if (t < from || t > to) continue
    const own = state.team === team
    if (own || full) {
      filtered.push({ ...state, visibility: own ? 'team' : 'omniscient' })
      continue
    }
    if (state[visibility] === true) {
      seen.set(key, { t, x: state.x!, y: state.y! })
      // Enemy cooldowns and unit state are not observable merely because a hero is visible.
      filtered.push({
        t,
        entity_id: state.entity_id!,
        hero: state.hero!,
        team: state.team!,
        x: state.x!,
        y: state.y!,
        hp: state.hp!,
        max_hp: state.max_hp!,
        visibility: 'visible',
      })
    } else {
      const last = seen.get(key)
      filtered.push({
        t,
        entity_id: state.entity_id!,
        hero: state.hero!,
        team: state.team!,
        visibility: state[visibility] === false ? 'hidden' : 'unknown',
        ...(last ? { last_seen: last } : {}),
      })
    }
  }
  return {
    ok: true,
    window: { from, to },
    perspective: full ? 'omniscient' : 'team',
    team,
    states: filtered,
    events: eligibleEvents.filter(
      (e) =>
        Number(e.t) >= from &&
        (full ||
          (e[visibility] === true &&
            (e.attacker_team === team ||
              e.target_team === team ||
              e.visibility_scope === undefined))),
    ),
    precision_seconds: 0.25,
    visibility_scope: 'entity_mask_or_event_instant; unknown_between_events',
    castability: 'not_inferred',
  }
}
export async function readScene(
  traceDir: string,
  from: number,
  to: number,
  team: number,
  full: boolean,
): Promise<RecordValue> {
  const read = async (kind: string) => {
    const rows: RecordValue[] = []
    for (let b = Math.floor((from - 30) / 15); b <= Math.floor(to / 15); b++) {
      try {
        const text = gunzipSync(
          await readFile(join(traceDir, 'windows', `${kind}-${b}.jsonl.gz`)),
        ).toString('utf8')
        rows.push(
          ...text
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
        )
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    return rows
  }
  const [states, events] = await Promise.all([read('states'), read('events')])
  const result = filterScene(states, events, from, to, team, full)
  try {
    result.wards = (await readFile(join(traceDir, 'wards-native.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordValue)
      .filter((w) => Number(w.t) <= to && (full || w.team === team))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return result
}
export const records = objects
