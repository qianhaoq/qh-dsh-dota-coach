import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { CoachConfig } from './config.ts'
import { CoachError } from './errors.ts'
import { download } from './http.ts'
import type { RecordValue } from './types.ts'
export function extractor(config: CoachConfig, pkg: string): string {
  return (
    config.extractBin ||
    join(
      pkg,
      'bin',
      `dota-extract-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`,
    )
  )
}
/** Resolves only after the process exits, including abort/timeout paths. */
export async function runExtractor(
  bin: string,
  args: string[],
  signal: AbortSignal,
): Promise<RecordValue> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '',
      stderr = ''
    let spawnError: Error | undefined
    const abort = () => {
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString()
      if (stdout.length > 65536) {
        spawnError = new CoachError('extractor_output_limit', 'Extractor output exceeds limit')
        abort()
      }
    })
    child.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-8000)
    })
    child.on('error', (e) => {
      spawnError = e
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      if (spawnError) {
        reject(spawnError)
        return
      }
      let result: RecordValue
      try {
        result = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as RecordValue
      } catch (e) {
        reject(new CoachError('parse_failed', stderr || String(e)))
        return
      }
      if (code !== 0 || !result.ok) {
        const message = String(result.error || stderr || `Exit ${code}`)
        reject(
          new CoachError(message.includes('size limit') ? 'size_limit' : 'parse_failed', message),
        )
      } else resolve(result)
    })
  })
}
/** Current replay hosts include the official China CDN returned by OpenDota. */
export function isReplayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      /^replay\d+\.(?:valve\.net|steamcontent\.com|dota2\.com\.cn)$/.test(parsed.hostname)
    )
  } catch {
    return false
  }
}
export class Replays {
  constructor(
    private home: string,
    private cfg: CoachConfig,
    private pkg: string,
  ) {}
  dir(id: number): string {
    return join(this.home, 'replays', String(id))
  }
  async inspect(id: number): Promise<RecordValue> {
    try {
      return JSON.parse(await readFile(join(this.dir(id), 'manifest.json'), 'utf8')) as RecordValue
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { match_id: id, status: 'missing' }
      throw e
    }
  }
  async list(): Promise<RecordValue> {
    let names: string[] = []
    try {
      names = await readdir(join(this.home, 'replays'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    const items = []
    for (const n of names.filter((n) => /^\d+$/.test(n))) items.push(await this.inspect(Number(n)))
    return { ok: true, items }
  }
  async remove(id: number): Promise<RecordValue> {
    await rm(this.dir(id), { recursive: true, force: true })
    return { ok: true, removed: id }
  }
  async fetch(id: number, url: string | undefined, signal: AbortSignal): Promise<RecordValue> {
    const old = await this.inspect(id)
    const demo = join(this.dir(id), 'replay.dem')
    if (old.status === 'ready') {
      try {
        const size = (await stat(demo)).size
        if (size === old.demo_bytes) {
          const sha = createHash('sha256')
          await pipeline(createReadStream(demo), sha, { signal })
          if (sha.digest('hex') === old.demo_sha256)
            return { ok: true, cached: true, manifest: old }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    if (!url) throw new CoachError('no_replay_url', 'No replay URL; match events remain available')
    if (!isReplayUrl(url))
      throw new CoachError('invalid_replay_url', 'Replay URL is not an official replay CDN')
    const temp = this.dir(id) + '.' + randomUUID() + '.part'
    await mkdir(temp, { recursive: true })
    try {
      const used = await this.diskBytes(join(this.home, 'replays'))
      const budget = this.cfg.replayMaxBytes - used
      if (budget <= 0)
        throw new CoachError('disk_limit', 'Replay storage budget reached; delete an old replay')
      const compressed = join(temp, 'replay.compressed')
      const dl = await download(url, compressed, {
        signal,
        maxBytes: Math.min(this.cfg.downloadMaxBytes, budget),
        userAgent: this.cfg.userAgent,
      })
      if (budget - dl.bytes <= 0)
        throw new CoachError('disk_limit', 'No replay storage budget for decompression')
      const result = await runExtractor(
        extractor(this.cfg, this.pkg),
        [
          compressed,
          temp,
          '--decompress-only',
          '--max-bytes',
          String(Math.min(this.cfg.decompressedMaxBytes, budget - dl.bytes)),
        ],
        signal,
      )
      const bytes = Number(result.bytes)
      if (bytes + dl.bytes > budget)
        throw new CoachError('disk_limit', 'Decompressed replay exceeds storage budget')
      const manifest: RecordValue = {
        match_id: id,
        status: 'ready',
        fetched_at: new Date().toISOString(),
        download_bytes: dl.bytes,
        download_sha256: dl.sha256,
        demo_bytes: bytes,
        demo_sha256: result.sha256 ?? null,
        format: result.format ?? null,
      }
      await rm(compressed, { force: true })
      await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await rm(this.dir(id), { recursive: true, force: true })
      await rename(temp, this.dir(id))
      return { ok: true, manifest }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
  private async diskBytes(dir: string): Promise<number> {
    let total = 0
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        total += e.isDirectory() ? await this.diskBytes(path) : (await stat(path)).size
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return total
  }
  async parse(id: number, signal: AbortSignal): Promise<RecordValue> {
    const manifest = await this.inspect(id)
    if (manifest.status !== 'ready') throw new CoachError('no_demo', 'Fetch a replay first')
    if (manifest.trace_version === 2) return { ok: true, cached: true }
    const temp = join(this.dir(id), 'trace-' + randomUUID() + '.part')
    await mkdir(temp, { recursive: true })
    try {
      const budget =
        this.cfg.replayMaxBytes - (await this.diskBytes(join(this.home, 'replays'))) - 4096
      if (budget <= 0)
        throw new CoachError('disk_limit', 'No space in replay storage budget for a trace')
      const summary = await runExtractor(
        extractor(this.cfg, this.pkg),
        [
          join(this.dir(id), 'replay.dem'),
          temp,
          '--max-bytes',
          String(this.cfg.decompressedMaxBytes),
          '--max-output-bytes',
          String(budget),
          '--quiet',
        ],
        signal,
      )
      await rm(join(this.dir(id), 'trace'), { recursive: true, force: true })
      await rename(join(temp, 'trace'), join(this.dir(id), 'trace'))
      const tmp = join(this.dir(id), 'manifest.json.part')
      await writeFile(
        tmp,
        JSON.stringify({
          ...manifest,
          trace_version: 2,
          parsed_at: new Date().toISOString(),
          trace: summary,
        }),
      )
      await rename(tmp, join(this.dir(id), 'manifest.json'))
      return { ok: true, summary }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
  async trace(
    id: number,
  ): Promise<{ heroes: RecordValue[]; wards: RecordValue[]; objectives: RecordValue[] } | null> {
    const manifest = await this.inspect(id)
    if (manifest.trace_version !== 2) return null
    const read = async (file: string) => {
      const rows = (await readFile(join(this.dir(id), 'trace', file + '.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean)
      return rows.map((r) => JSON.parse(r) as RecordValue)
    }
    return {
      heroes: await read('heroes'),
      wards: await read('wards'),
      objectives: await read('objectives'),
    }
  }
}
