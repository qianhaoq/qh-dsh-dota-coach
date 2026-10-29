/** Optional live acceptance. Nothing downloaded here is committed or uploaded by CI. */
import { Context } from '@deepseek-ai/cordis'
import { CoachService } from '../packages/coach/lib/types/service.js'
import { Config } from '../packages/coach/lib/types/config.js'
import { mkdtemp, rm, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const match = Number(process.env.DOTA_SMOKE_MATCH_ID)
if (!Number.isSafeInteger(match) || match <= 0)
  throw new Error('Set DOTA_SMOKE_MATCH_ID to a public parsed match with an available replay')
const home = await mkdtemp(join(tmpdir(), 'dota-live-'))
const service = new CoachService(
  new Context(),
  Config({ memoryEnabled: false }),
  home,
  resolve('packages/coach'),
)
try {
  const data = await service.invoke('dota_match', {
    match_id: match,
    sections: ['overview', 'curves', 'objectives'],
  })
  assert.equal(data.ok, true, JSON.stringify(data))
  assert.ok(data.evidence_id)
  console.log('Live OpenDota match and evidence passed')
  if (process.env.DOTA_SMOKE_DEMO) {
    const dir = service.replays.dir(match)
    await mkdir(dir, { recursive: true })
    await copyFile(process.env.DOTA_SMOKE_DEMO, join(dir, 'replay.dem'))
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({ status: 'ready', match_id: match, origin: 'user_provided' }),
    )
  } else {
    const replay = await service.invoke('dota_replay', { action: 'fetch', match_id: match })
    assert.equal(replay.ok, true, JSON.stringify(replay))
    console.log('Live replay download, checksum and portable decompression passed')
  }
  const trace = await service.invoke('dota_parse', { action: 'summary', match_id: match })
  assert.equal(trace.ok, true, JSON.stringify(trace))
  assert.equal((trace.calibration as { ok?: boolean })?.ok, true, JSON.stringify(trace))
  console.log('Real replay entity parsing and same-building calibration passed')
  const timeline = await service.invoke('dota_timeline', {
    match_id: match,
    from: '600',
    to: '900',
  })
  assert.equal(timeline.trace_used, true)
  console.log('Live aligned timeline passed')
} finally {
  await service.dispose()
  await rm(home, { recursive: true, force: true })
}
