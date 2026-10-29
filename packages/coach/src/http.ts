import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CoachError } from './errors.ts'
import type { CoachConfig } from './config.ts'
import type { Json } from './types.ts'
export function cancelled<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (v) => {
        cleanup()
        resolve(v)
      },
      (e) => {
        cleanup()
        reject(e)
      },
    )
  })
}
export function retrySeconds(value: string | null): number {
  if (value === null) return 30
  const n = Number(value)
  return Number.isFinite(n)
    ? Math.max(0, n)
    : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000)) || 30
}
/** Local pacing policy plus server-reported cooldown. Values are policy, not API quota claims. */
export class RateLimiter {
  private minute: number[] = []
  private day = ''
  private count = 0
  private blockedUntil = 0
  private queue: Promise<void> = Promise.resolve()
  remainingMinute: number | null = null
  remainingDay: number | null = null
  constructor(private cfg: Pick<CoachConfig, 'requestsPerMinute' | 'requestsPerDay'>) {}
  async acquire(signal?: AbortSignal): Promise<void> {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted()
        const day = new Date().toISOString().slice(0, 10)
        if (day !== this.day) {
          this.day = day
          this.count = 0
          this.remainingDay = null
        }
        this.minute = this.minute.filter((t) => Date.now() - t < 60000)
        if (this.count >= this.cfg.requestsPerDay || this.remainingDay === 0)
          throw new CoachError('rate_limited', 'Daily local policy or reported quota reached')
        const wait = Math.max(
          this.blockedUntil - Date.now(),
          this.minute.length >= this.cfg.requestsPerMinute
            ? 60000 - (Date.now() - this.minute[0])
            : 0,
        )
        if (wait > 5000)
          throw new CoachError('rate_limited', 'Retry after cooldown', {
            retry_after_s: Math.ceil(wait / 1000),
          })
        if (wait > 0) await delay(wait, undefined, { signal })
        this.minute.push(Date.now())
        this.count++
      })
    this.queue = next
    return next
  }
  record(h: Headers, status: number): void {
    const read = (key: string) => {
      const v = h.get(key)
      return v === null ? null : Number(v)
    }
    this.remainingMinute = read('x-rate-limit-remaining-minute')
    this.remainingDay = read('x-rate-limit-remaining-day')
    if (status === 429)
      this.blockedUntil = Math.max(
        this.blockedUntil,
        Date.now() + retrySeconds(h.get('retry-after')) * 1000,
      )
    else if (this.remainingMinute === 0)
      this.blockedUntil = Math.max(this.blockedUntil, Date.now() + 60000)
  }
  snapshot() {
    return {
      local_policy: {
        requestsPerMinute: this.cfg.requestsPerMinute,
        requestsPerDay: this.cfg.requestsPerDay,
      },
      remaining_minute: this.remainingMinute,
      remaining_day: this.remainingDay,
      cooldown_until: this.blockedUntil ? new Date(this.blockedUntil).toISOString() : null,
    }
  }
}
/** Shared cache misses use a plugin-owned signal; cancelling one caller preserves other waiters. */
export class OpenDota {
  private metadata = new Map<string, { at: number; cached: boolean }>()
  provenance(path: string) {
    const entry = this.metadata.get(path)
    return {
      source: 'opendota',
      captured_at: entry ? new Date(entry.at).toISOString() : null,
      cache_hit: entry?.cached ?? false,
    }
  }
  private flights = new Map<string, Promise<Json>>()
  readonly limiter: RateLimiter
  constructor(
    private home: string,
    private cfg: CoachConfig,
    private lifecycle: AbortSignal,
    readonly base = 'https://api.opendota.com/api',
  ) {
    this.limiter = new RateLimiter(cfg)
  }
  async get(path: string, signal?: AbortSignal, ttl = 300000): Promise<Json> {
    signal?.throwIfAborted()
    const file = join(this.home, 'cache', createHash('sha256').update(path).digest('hex') + '.json')
    let saved: { at: number; body: Json } | undefined
    try {
      saved = JSON.parse(await readFile(file, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
    }
    if (saved && Date.now() - saved.at < ttl) {
      this.metadata.set(path, { at: saved.at, cached: true })
      return saved.body
    }
    let task = this.flights.get(path)
    if (!task) {
      task = this.request(path)
        .then(async (body) => {
          await mkdir(dirname(file), { recursive: true })
          const tmp = file + '.' + randomUUID()
          const at = Date.now()
          await writeFile(tmp, JSON.stringify({ at, body }))
          await rename(tmp, file)
          this.metadata.set(path, { at, cached: false })
          return body
        })
        .finally(() => this.flights.delete(path))
      this.flights.set(path, task)
    }
    return cancelled(task, signal)
  }
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.flights.values()])
  }
  private async request(path: string): Promise<Json> {
    const url = new URL(this.base + path)
    if (this.cfg.opendotaApiKey) url.searchParams.set('api_key', this.cfg.opendotaApiKey)
    const signal = AbortSignal.any([this.lifecycle, AbortSignal.timeout(45000)])
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(signal)
      try {
        const response = await fetch(url, {
          signal,
          headers: { 'user-agent': this.cfg.userAgent, accept: 'application/json' },
        })
        this.limiter.record(response.headers, response.status)
        if (response.status === 429)
          throw new CoachError('rate_limited', 'OpenDota returned 429', {
            retry_after_s: retrySeconds(response.headers.get('retry-after')),
          })
        if (!response.ok) {
          await response.body?.cancel()
          throw new CoachError(
            response.status === 404 ? 'not_found' : 'http_error',
            `OpenDota HTTP ${response.status}`,
            { status: response.status },
          )
        }
        const bytes = await response.text()
        if (bytes.length > 20_000_000)
          throw new CoachError('response_too_large', 'OpenDota JSON exceeds limit')
        return JSON.parse(bytes) as Json
      } catch (e) {
        signal.throwIfAborted()
        if (
          e instanceof CoachError &&
          (e.code === 'rate_limited' || Number(e.details.status) < 500)
        )
          throw e
        if (attempt >= 2) throw e
        await delay(400 * (attempt + 1), undefined, { signal })
      }
    }
  }
}
/** Atomic bounded download; partial responses never replace a ready file. */
export async function download(
  url: string,
  dest: string,
  options: { signal: AbortSignal; maxBytes: number; userAgent: string },
): Promise<{ bytes: number; sha256: string }> {
  const temp = dest + '.' + randomUUID() + '.part'
  await mkdir(dirname(dest), { recursive: true })
  try {
    options.signal.throwIfAborted()
    const response = await fetch(url, {
      signal: options.signal,
      headers: { 'user-agent': options.userAgent, 'accept-encoding': 'identity' },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new CoachError(
        response.status === 404
          ? 'replay_unavailable'
          : response.status === 429
            ? 'rate_limited'
            : 'download_failed',
        `Replay HTTP ${response.status}`,
        {
          status: response.status,
          ...(response.status === 429
            ? { retry_after_s: retrySeconds(response.headers.get('retry-after')) }
            : {}),
        },
      )
    }
    const expected = response.headers.has('content-length')
      ? Number(response.headers.get('content-length'))
      : null
    if (expected !== null && expected > options.maxBytes) {
      await response.body?.cancel()
      throw new CoachError('size_limit', 'Download exceeds size limit')
    }
    if (!response.body) throw new CoachError('download_failed', 'Empty response')
    let bytes = 0
    const sha = createHash('sha256')
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > options.maxBytes) {
          callback(new CoachError('size_limit', 'Download exceeds size limit'))
          return
        }
        sha.update(chunk)
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.from(response.body),
      counter,
      createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      { signal: options.signal },
    )
    if (expected !== null && bytes !== expected)
      throw new CoachError('truncated_download', 'Content-Length mismatch', { expected, bytes })
    await rename(temp, dest)
    return { bytes, sha256: sha.digest('hex') }
  } catch (error) {
    options.signal.throwIfAborted()
    if (error instanceof CoachError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC')
      throw new CoachError('disk_limit', 'Disk has no free space')
    const cause = (error as { cause?: { code?: string } }).cause
    if (cause?.code === 'UND_ERR_SOCKET')
      throw new CoachError('truncated_download', 'Download connection ended before completion')
    throw new CoachError('download_failed', error instanceof Error ? error.message : String(error))
  } finally {
    await rm(temp, { force: true })
  }
}
