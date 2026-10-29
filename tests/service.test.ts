import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { CoachService } from '../packages/coach/src/service.ts'
import { Config } from '../packages/coach/src/config.ts'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
test('cached hero datasets retain individual original collection timestamps', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-hero-time-'))
  const service = new CoachService(new Context(), Config({ memoryEnabled: false }), home, '.')
  try {
    await mkdir(join(home, 'cache'), { recursive: true })
    const at = Date.now() - 20000
    const put = async (path: string, body: unknown, time = at) =>
      writeFile(
        join(home, 'cache', createHash('sha256').update(path).digest('hex') + '.json'),
        JSON.stringify({ at: time, body }),
      )
    await put(
      '/constants/heroes',
      JSON.parse(await readFile('packages/coach/fixtures/heroes.trim.json', 'utf8')),
    )
    await put(
      '/constants/items',
      JSON.parse(await readFile('packages/coach/fixtures/items.trim.json', 'utf8')),
    )
    await put('/heroStats', [{ id: 1 }])
    await put('/heroes/1/matchups', [], at - 1000)
    await put('/heroes/1/itemPopularity', {}, at - 2000)
    const value = await service.invoke('dota_hero', { hero: '1' })
    assert.equal(value.ok, true, JSON.stringify(value))
    assert.equal(value.captured_at, new Date(at).toISOString())
    assert.equal(value.cache_hit, true)
    const sources = value.sources as { captured_at: string }[]
    assert.deepEqual(
      sources.map((s) => s.captured_at),
      [at, at - 1000, at - 2000].map((t) => new Date(t).toISOString()),
    )
  } finally {
    await service.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
