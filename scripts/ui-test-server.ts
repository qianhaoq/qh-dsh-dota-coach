import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { build } from 'esbuild'
import { mkdtemp, readFile, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../packages/coach/src/config.ts'
import { CoachService } from '../packages/coach/src/service.ts'
import { fixtureModel } from '../tests/coach-fixture.ts'
import { indexTactical } from '../packages/coach/src/scene.ts'
const dir = await mkdtemp(join(tmpdir(), 'dota-ui-'))
const fixtureDir = join(dir, 'fixture')
const result = await build({
  entryPoints: ['tests/ui-harness.tsx'],
  bundle: true,
  jsx: 'automatic',
  format: 'iife',
  write: false,
  loader: { '.css': 'text', '.webp': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const match = JSON.parse(await readFile('packages/coach/fixtures/match.json', 'utf8'))
const datasets = new Map<string, unknown>()
const cache = async (path: string, data: unknown) => {
  datasets.set(path, data)
  await mkdir(join(fixtureDir, 'cache'), { recursive: true })
  await writeFile(
    join(fixtureDir, 'cache', createHash('sha256').update(path).digest('hex') + '.json'),
    JSON.stringify({ at: Date.now(), body: data }),
  )
}
await cache('/constants/patch', { '54': { name: '7.40' } })
await cache('/matches/424242', match)
await cache('/matches/424243', { ...match, match_id: 424243 })
await cache(
  '/constants/heroes',
  JSON.parse(await readFile('packages/coach/fixtures/heroes.trim.json', 'utf8')),
)
await cache(
  '/constants/items',
  JSON.parse(await readFile('packages/coach/fixtures/items.trim.json', 'utf8')),
)
await cache('/players/123/matches?limit=100', [
  { ...match, hero_id: 1, player_slot: 0, kills: 5, deaths: 2, assists: 4 },
])
const traceDir = join(fixtureDir, 'replays/424242/trace')
await mkdir(traceDir, { recursive: true })
await writeFile(
  join(fixtureDir, 'replays/424242/manifest.json'),
  JSON.stringify({ match_id: 424242, status: 'ready', trace_version: 3, tactical_index: 1 }),
)
await writeFile(
  join(traceDir, 'objectives.jsonl'),
  JSON.parse(await readFile('packages/coach/fixtures/objectives.trace.json', 'utf8'))
    .map(JSON.stringify)
    .join('\n'),
)
await writeFile(
  join(traceDir, 'heroes.jsonl'),
  Array.from({ length: 30 }, (_, i) =>
    JSON.stringify({
      t: 200 + i * 2,
      hero: 'AntiMage',
      entity_id: '1:1',
      entity_kind: 'real_hero',
      x: 100 + i * 40,
      y: 100 + i * 10,
      team: 2,
      alive: 0,
    }),
  ).join('\n'),
)
await writeFile(join(traceDir, 'wards.jsonl'), '')
await writeFile(
  join(traceDir, 'states.jsonl'),
  Array.from({ length: 2401 }, (_, i) =>
    [27, 15]
      .map((hero, j) =>
        JSON.stringify({
          t: i / 4,
          entity_id: `${j}:1`,
          entity_kind: 'real_hero',
          hero: j ? 'razor' : 'shadow_shaman',
          team: 2,
          x: -3700 + i * 1.5 + j * 1000,
          y: -3200 + i * 0.8 + j * 700,
          hp: 800,
          max_hp: 1000,
          mana: 350,
          max_mana: 500,
          life_state: 0,
          visible_radiant: true,
          abilities: [
            {
              slot: 0,
              name: j ? 'razor_plasma_field' : 'necrolyte_death_pulse',
              level: 2,
              cooldown: (i % 20) / 4,
            },
          ],
          items: [{ slot: 0, name: 'blink', cooldown: 0 }],
        }),
      )
      .join('\n'),
  ).join('\n'),
)
await writeFile(join(traceDir, 'events.jsonl'), '')
await indexTactical(traceDir, new AbortController().signal)
const services = new Map<string, Promise<CoachService>>()
async function createService(id: string) {
  const home = join(dir, 'profiles', id)
  await mkdir(home, { recursive: true })
  await cp(fixtureDir, home, { recursive: true })
  const ctx = new Context()
  fixtureModel(ctx)
  const service = new CoachService(
    ctx,
    Config({ homeDir: home, memoryEnabled: false, skillEnabled: false }),
    home,
    join(process.cwd(), 'packages/coach'),
  )
  // Keep long manual acceptance sessions hermetic after the ordinary five-minute cache TTL.
  service.od.get = async (path) => {
    if (!datasets.has(path)) throw new Error('Synthetic dataset unavailable: ' + path)
    return structuredClone(datasets.get(path)) as import('../packages/coach/src/types.ts').Json
  }
  return service
}
function serviceFor(req: IncomingMessage, res: ServerResponse) {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dota-ui-profile='))
  const existing = cookie && services.get(cookie.slice('dota-ui-profile='.length))
  if (existing) return existing
  // Browser contexts have separate cookies. Bind the backend before sending HTML so the
  // panel's concurrent startup calls share a profile, and reloads retain saved progress.
  const id = randomUUID()
  const service = createService(id)
  services.set(id, service)
  res.setHeader('set-cookie', `dota-ui-profile=${id}; Path=/; HttpOnly; SameSite=Lax`)
  return service
}
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.url === '/app.js') {
        res.setHeader('content-type', 'text/javascript')
        res.end(result.outputFiles[0]!.text)
      } else {
        await serviceFor(req, res)
        res.setHeader('content-type', 'text/html')
        res.end(
          '<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dota coach fixture</title><style>html,body,#root{height:100%;margin:0;background:#14191d}[data-testid=draft]{pointer-events:none;position:fixed;bottom:0;background:#28333b;padding:12px;white-space:pre-wrap}</style><div id="root"></div><script src="/app.js"></script></html>',
        )
      }
      return
    }
    const service = await serviceFor(req, res)
    let raw = ''
    for await (const chunk of req) raw += chunk
    const args = JSON.parse(raw || '{}')
    let value: unknown
    if (req.url === '/api/call') value = await service.invoke(args.tool, args.args)
    else if (req.url === '/api/settings') {
      if (args.accountId !== undefined) service.store.setting('accountId', args.accountId)
      value = { accountId: Number(service.store.setting('accountId') || 0) }
    } else if (req.url === '/api/jobs') value = service.tasks.list()
    else if (req.url === '/api/cancel') value = service.tasks.cancel(args.id)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(value))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(error) }))
  }
})
server.listen(4178, '127.0.0.1', () => console.log('UI fixture listening on 4178'))
process.on('SIGTERM', () => {
  server.close()
  void Promise.allSettled([...services.values()].map(async (service) => (await service).dispose()))
    .then(() => rm(dir, { recursive: true, force: true }))
    .finally(() => process.exit())
})
