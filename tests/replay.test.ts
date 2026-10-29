import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Replays, runExtractor } from '../packages/coach/src/replay.ts'
import { Config } from '../packages/coach/src/config.ts'
test('trace parsing respects the remaining storage budget and cleans its temporary directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-quota-'))
  try {
    const replay = new Replays(home, Config({ replayMaxBytes: 1 }), '.')
    const dir = replay.dir(42)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ status: 'ready' }))
    await assert.rejects(replay.parse(42, new AbortController().signal), { code: 'disk_limit' })
    assert.deepEqual(await readdir(dir), ['manifest.json'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
test('an extractor deadline waits for child exit and preserves the timeout category', async () => {
  await assert.rejects(
    runExtractor(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], AbortSignal.timeout(50)),
    { name: 'TimeoutError' },
  )
})
