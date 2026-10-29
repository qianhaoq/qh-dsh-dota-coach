import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OpenDota, download, retrySeconds } from '../packages/coach/src/http.ts'
import { Config } from '../packages/coach/src/config.ts'
async function server(
  t: { after: (f: () => Promise<void>) => void },
  handler: Parameters<typeof createServer>[0],
) {
  const s = createServer(handler)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const addr = s.address()
  if (!addr || typeof addr === 'string') throw new Error('No port')
  t.after(async () => {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  })
  return `http://127.0.0.1:${addr.port}`
}
async function dir(t: { after: (f: () => Promise<void>) => void }) {
  const path = await mkdtemp(join(tmpdir(), 'dota-http-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
test('concurrent OpenDota cache misses coalesce; original collection time survives cache reads', async (t) => {
  let count = 0
  const base = await server(t, (_req, res) => {
    count++
    res.setHeader('content-type', 'application/json')
    setTimeout(() => res.end('{"players":[]}'), 20)
  })
  const c = new OpenDota(
    await dir(t),
    Config({ requestsPerMinute: 100 }),
    new AbortController().signal,
    base,
  )
  const results = await Promise.all(Array.from({ length: 12 }, () => c.get('/match')))
  assert.equal(count, 1)
  assert.equal(results.length, 12)
  const stamp = c.provenance('/match').captured_at
  await c.get('/match')
  assert.equal(count, 1)
  assert.equal(c.provenance('/match').captured_at, stamp)
  assert.equal(c.provenance('/match').cache_hit, true)
})
test('429 honours server Retry-After without retries; 404 remains an actionable error', async (t) => {
  let count = 0
  const base = await server(t, (req, res) => {
    count++
    res.statusCode = req.url === '/missing' ? 404 : 429
    res.setHeader('Retry-After', '90')
    res.end('{}')
  })
  const c = new OpenDota(await dir(t), Config({}), new AbortController().signal, base)
  await assert.rejects(
    c.get('/limited'),
    (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'rate_limited',
  )
  await assert.rejects(c.get('/limited'))
  assert.equal(count, 1)
  const c2 = new OpenDota(await dir(t), Config({}), new AbortController().signal, base)
  await assert.rejects(c2.get('/missing'), /404/)
  assert.equal(count, 2)
  assert.equal(retrySeconds('120'), 120)
  assert.ok(retrySeconds(new Date(Date.now() + 5000).toUTCString()) <= 5)
})
test('download limits, cancellation, truncation and timeout leave no committed or partial files', async (t) => {
  const home = await dir(t)
  const base = await server(t, (req, res) => {
    if (req.url === '/truncated') {
      res.setHeader('content-length', '1000')
      res.write('short')
      setTimeout(() => res.destroy(), 10)
    } else if (req.url === '/large') {
      res.setHeader('content-length', '1000')
      res.end('x'.repeat(1000))
    } else {
      res.write('wait')
      setTimeout(() => res.end('late'), 1000)
    }
  })
  const common = { maxBytes: 100, userAgent: 'test', signal: new AbortController().signal }
  await assert.rejects(download(base + '/large', join(home, 'large'), common), /size limit/)
  await assert.rejects(
    download(base + '/truncated', join(home, 'truncated'), { ...common, maxBytes: 2000 }),
  )
  await assert.rejects(
    download(base + '/slow', join(home, 'timeout'), { ...common, signal: AbortSignal.timeout(20) }),
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    download(base + '/slow', join(home, 'cancelled'), { ...common, signal: controller.signal }),
  )
  assert.deepEqual(await readdir(home), [])
})
