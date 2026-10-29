import { createServer } from 'node:http'
import { build } from 'esbuild'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../packages/coach/src/config.ts'
import { CoachService } from '../packages/coach/src/service.ts'
const dir = await mkdtemp(join(tmpdir(), 'dota-ui-'))
const result = await build({
  entryPoints: ['tests/ui-harness.tsx'],
  bundle: true,
  jsx: 'automatic',
  format: 'iife',
  write: false,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const ctx = new Context()
const service = new CoachService(
  ctx,
  Config({ homeDir: dir, memoryEnabled: false, skillEnabled: false }),
  dir,
  join(process.cwd(), 'packages/coach'),
)
const match = JSON.parse(await readFile('packages/coach/fixtures/match.json', 'utf8'))
const cache = async (path: string, data: unknown) => {
  await mkdir(join(dir, 'cache'), { recursive: true })
  await writeFile(
    join(dir, 'cache', createHash('sha256').update(path).digest('hex') + '.json'),
    JSON.stringify({ at: Date.now(), body: data }),
  )
}
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
const traceDir = join(dir, 'replays/424242/trace')
await mkdir(traceDir, { recursive: true })
await writeFile(
  join(dir, 'replays/424242/manifest.json'),
  JSON.stringify({ match_id: 424242, status: 'ready', trace_version: 2 }),
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
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.url === '/app.js') {
        res.setHeader('content-type', 'text/javascript')
        res.end(result.outputFiles[0]!.text)
      } else {
        res.setHeader('content-type', 'text/html')
        res.end(
          '<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dota coach fixture</title><style>html,body,#root{height:100%;margin:0;background:#14191d}aside{pointer-events:none;position:fixed;bottom:0;background:#28333b;padding:12px;white-space:pre-wrap}</style><div id="root"></div><script src="/app.js"></script></html>',
        )
      }
      return
    }
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
  void service
    .dispose()
    .then(() => rm(dir, { recursive: true, force: true }))
    .finally(() => process.exit())
})
