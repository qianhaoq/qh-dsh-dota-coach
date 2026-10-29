/** 小工具：时间格式化、路径、稳定字符串化、并发去重。 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const VERSION = '0.1.0'

/** 秒 → mm:ss（可为负，表示开局前）。 */
export function mmss(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '?'
  const s = Math.round(Number(seconds))
  const sign = s < 0 ? '-' : ''
  const a = Math.abs(s)
  const m = Math.floor(a / 60)
  const r = a % 60
  return `${sign}${m}:${String(r).padStart(2, '0')}`
}

/** 稳定 JSON（键排序），用于缓存键与去重。 */
export function stableKey(value) {
  const seen = new WeakSet()
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    if (Array.isArray(v)) return v.map(walk)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k])
    return out
  }
  return JSON.stringify(walk(value))
}

export function sha1(text) {
  return createHash('sha1').update(String(text)).digest('hex')
}

export async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value))
  await rename(tmp, path)
}

export async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

export async function removeQuiet(path) {
  try {
    await unlink(path)
  } catch {}
}

/** 同一 key 的异步任务合并，避免并发工具调用重复下载/解析。 */
export function singleFlight() {
  const inflight = new Map()
  return function run(key, fn) {
    const prev = inflight.get(key)
    if (prev) return prev
    const p = (async () => fn())().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}

export function nowIso() {
  return new Date().toISOString()
}

export function joinPath(...parts) {
  return join(...parts)
}

/** 把任意错误收成 {message, code, hint}，避免把栈甩给模型。 */
export function errorInfo(error) {
  const message = String(error?.message || error || 'unknown error')
  const code = error?.code || error?.cause?.code || ''
  return { message, code: String(code || '') }
}
