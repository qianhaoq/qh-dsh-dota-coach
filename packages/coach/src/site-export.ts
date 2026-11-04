import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CoachError } from './errors.ts'
import type { CoachStore } from './store.ts'
import type { RecordValue } from './types.ts'

const selection = z.array(z.string().trim().min(1)).min(1).max(100)
const publicHosts = new Set(['bilibili.com', 'www.bilibili.com', 'youtube.com', 'www.youtube.com', 'youtu.be', 'reddit.com', 'www.reddit.com', 'old.reddit.com', 'dota2.com', 'www.dota2.com'])

function sourceUrl(source: RecordValue): string {
  if (!['bilibili', 'youtube', 'forum'].includes(String(source.origin)) ||
      !['transcript', 'article'].includes(String(source.material_type)))
    throw new CoachError('invalid_evidence', 'Only selected public articles or transcripts can be exported')
  let url: URL
  if (source.origin === 'bilibili' && /^BV[A-Za-z0-9]{10}$/.test(String(source.source_id)))
    url = new URL(`https://www.bilibili.com/video/${source.source_id}`)
  else if (source.origin === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(String(source.source_id)))
    url = new URL(`https://www.youtube.com/watch?v=${source.source_id}`)
  else {
    try { url = new URL(String(source.locator)) }
    catch { throw new CoachError('invalid_evidence', 'A public source URL is required') }
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !publicHosts.has(url.hostname))
    throw new CoachError('invalid_evidence', 'Source must have a supported public HTTPS URL')
  // Publish canonical video IDs, never provider session or tracking parameters.
  const video = url.searchParams.get('v')
  const time = url.searchParams.get('t')
  url.search = ''
  url.hash = ''
  if (['youtube.com', 'www.youtube.com'].includes(url.hostname) && video && /^[A-Za-z0-9_-]{11}$/.test(video)) url.searchParams.set('v', video)
  if (time && /^\d+s?$/.test(time)) url.searchParams.set('t', time)
  return url.toString()
}

/** Explicit selection only. No scans, raw source bodies, review or training records. */
export function buildSiteSnapshot(store: CoachStore, ids: unknown, generatedAt = new Date().toISOString()): RecordValue {
  const chosen = [...new Set(selection.parse(ids))]
  const entries = chosen.map(id => {
    const note = store.get(id, 'note')
    if (note.superseded_by || note.needs_recheck || !['fact', 'principle'].includes(String(note.category)))
      throw new CoachError('invalid_evidence', 'Recheck or superseded knowledge cannot be published')
    const source = store.get(String(note.source_record_id), 'source')
    const source_url = sourceUrl(source)
    if (typeof note.body !== 'string' || note.body.length > 2000 ||
        typeof source.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(source.content_hash))
      throw new CoachError('invalid_evidence', 'A short supported summary and source hash are required')
    const publicId = createHash('sha256').update(`${id}:${source.content_hash}`).digest('hex').slice(0, 24)
    const entry = {
      id: `kb-${publicId}`, kind: String(note.category), title: String(note.title), summary: note.body,
      hero: String(note.hero || ''), patch: String(note.patch || 'unknown'), stamp: String(note.stamp),
      source_url, source_date: String(source.captured_at), content_hash: source.content_hash,
      locator: /^(?:\d{1,3}:\d{2})(?:\s*[–-]\s*\d{1,3}:\d{2})?$/.test(String(source.locator)) ? String(source.locator) : source_url,
      verification: 'material_linked_not_independently_verified',
    }
    if (entry.title.length > 300 || entry.hero.length > 100 || entry.patch.length > 100 || entry.stamp.length > 500 ||
        entry.source_url.length > 2048 || !Number.isFinite(Date.parse(entry.source_date)))
      throw new CoachError('invalid_evidence', 'Selected knowledge exceeds the public snapshot contract')
    return entry
  }).sort((a, b) => a.id.localeCompare(b.id))
  return { schema: 'dota2.ai/site-knowledge@1', generated_at: generatedAt, entries }
}
