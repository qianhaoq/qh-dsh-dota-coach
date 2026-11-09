import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CoachError } from './errors.ts'
import type { CoachStore } from './store.ts'
import type { RecordValue } from './types.ts'

const selection = z.array(z.string().trim().min(1)).min(1).max(100)
const publicHosts = new Set(['bilibili.com', 'www.bilibili.com', 'youtube.com', 'www.youtube.com', 'youtu.be', 'reddit.com', 'www.reddit.com', 'old.reddit.com', 'dota2.com', 'www.dota2.com', 'steamcommunity.com', 'news.wmpvp.com', 'www.news.wmpvp.com'])

function publicResource(url: URL): string | null {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !publicHosts.has(url.hostname)) return null
  if (url.hostname === 'steamcommunity.com') return url.href === 'https://steamcommunity.com/sharedfiles/filedetails/?id=827490913' ? 'steam-guide-827490913' : null
  if (url.hostname === 'news.wmpvp.com' || url.hostname === 'www.news.wmpvp.com') {
    return url.pathname === '/news.html' && url.searchParams.get('id') === '305703' && url.searchParams.get('gameTypeStr') === '1'
      ? 'wmpvp-news-305703'
      : null
  }
  if (url.hostname.endsWith('bilibili.com')) return /^\/video\/(BV[A-Za-z0-9]{10})\/?$/.exec(url.pathname)?.[1] ?? null
  if (url.hostname === 'youtu.be') return /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
  if (url.hostname.endsWith('youtube.com')) {
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  }
  // A host alone does not prove public provenance: admit public post/patch routes only.
  if (url.hostname.endsWith('reddit.com')) return /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/.test(url.pathname) ? 'article' : null
  return /^\/(?:newsentry\/\d+|patches\/\d+(?:\.\d+)?[a-z]?)(?:\/|$)/.test(url.pathname) ? 'article' : null
}

function sourceUrl(source: RecordValue): string {
  if (!['bilibili', 'youtube', 'forum'].includes(String(source.origin)) ||
      !['transcript', 'article'].includes(String(source.material_type)))
    throw new CoachError('invalid_evidence', 'Only selected public articles or transcripts can be exported')
  let url: URL
  let located: URL | undefined
  if (/^https?:/i.test(String(source.locator))) {
    try { located = new URL(String(source.locator)) } catch { throw new CoachError('invalid_evidence', 'A public source URL is required') }
    if (!publicResource(located)) throw new CoachError('invalid_evidence', 'Source must identify a supported public resource')
  }
  if (source.origin === 'bilibili' && /^BV[A-Za-z0-9]{10}$/.test(String(source.source_id)))
    url = new URL(`https://www.bilibili.com/video/${source.source_id}`)
  else if (source.origin === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(String(source.source_id)))
    url = new URL(`https://www.youtube.com/watch?v=${source.source_id}`)
  else {
    try { url = new URL(String(source.locator)) }
    catch { throw new CoachError('invalid_evidence', 'A public source URL is required') }
  }
  const resource = publicResource(url)
  if (!resource || (located && (publicResource(located) !== resource ||
      located.hostname.replace(/^(?:www\.|old\.)/, '').replace('youtu.be', 'youtube.com') !== url.hostname.replace(/^www\./, '').replace('youtu.be', 'youtube.com'))))
    throw new CoachError('invalid_evidence', 'Source must identify the same supported public resource')
  // Publish canonical video IDs, never provider session or tracking parameters.
  const video = url.searchParams.get('v')
  const time = (located ?? url).searchParams.get('t')
  const start = (located ?? url).searchParams.get('start')
  const part = (located ?? url).searchParams.get('p')
  const steamGuide = url.hostname === 'steamcommunity.com'
  const wmpvpAce = url.hostname === 'news.wmpvp.com' || url.hostname === 'www.news.wmpvp.com'
  url.search = ''
  url.hash = ''
  if (steamGuide) url.searchParams.set('id', '827490913')
  if (wmpvpAce) {
    url.hostname = 'news.wmpvp.com'
    url.searchParams.set('id', '305703')
    url.searchParams.set('gameTypeStr', '1')
  }
  if (['youtube.com', 'www.youtube.com'].includes(url.hostname) && video && /^[A-Za-z0-9_-]{11}$/.test(video)) url.searchParams.set('v', video)
  if (time && /^\d{1,7}s?$/.test(time)) url.searchParams.set('t', time)
  if (url.hostname.endsWith('youtube.com') && start && /^\d{1,7}$/.test(start)) url.searchParams.set('start', start)
  if (url.hostname.endsWith('bilibili.com') && part && /^[1-9]\d{0,3}$/.test(part)) url.searchParams.set('p', part)
  return url.toString()
}

/** Explicit selection only. No scans, raw source bodies, review or training records. */
export function buildSiteSnapshot(
  store: CoachStore,
  ids: unknown,
  generatedAt = new Date().toISOString(),
): RecordValue {
  const chosen = [...new Set(selection.parse(ids))]
  const entries = chosen
    .map((id) => {
      const ontology = id.startsWith('onto:') ? store.ontology.get(id) : undefined
      if (
        ontology &&
        (ontology.state !== 'active' ||
          ontology.kind !== 'principle' ||
          ontology.applicability_scope !== 'version_independent' ||
          !ontology.curation ||
          !ontology.exportable)
      )
        throw new CoachError(
          'invalid_evidence',
          'Ontology export requires human curation of an active version-independent principle',
        )
      const note = ontology ? { ...ontology, category: ontology.kind } : store.get(id, 'note')
      if (
        note.superseded_by ||
        note.needs_recheck ||
        !['fact', 'principle'].includes(String(note.category))
      )
        throw new CoachError(
          'invalid_evidence',
          'Recheck or superseded knowledge cannot be published',
        )
      // Legacy notes have no host-authorized curation path. Explicit IDs must not
      // bypass the ontology promotion boundary for principles.
      if (note.category === 'principle' && !ontology)
        throw new CoachError(
          'invalid_evidence',
          'Principle export requires human curation through ontology promotion',
        )
      const source = store.get(String(note.source_record_id), 'source')
      const source_url = sourceUrl(source)
      // Revalidate durable evidence on promotion, including edits made outside the tools.
      if (
        typeof source.body !== 'string' ||
        source.body.trim().length < 20 ||
        createHash('sha256').update(source.body).digest('hex') !== source.content_hash ||
        source.source_id !==
          (ontology ? (ontology.provenance as RecordValue).source_id : note.source_id) ||
        source.completeness === 'excerpt' ||
        ['title_only', 'comments_only'].includes(String(source.evidence_level))
      )
        throw new CoachError(
          'invalid_evidence',
          'Source body hash, identity or completeness failed validation',
        )
      if (
        note.category === 'fact' &&
        (note.patch === 'unknown' ||
          note.patch !== source.patch ||
          (source.hero && note.hero !== source.hero))
      )
        throw new CoachError(
          'invalid_evidence',
          'Patch facts require the exact source patch and applicable hero',
        )
      if (
        typeof note.body !== 'string' ||
        note.body.length > 2000 ||
        typeof source.content_hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(source.content_hash)
      )
        throw new CoachError(
          'invalid_evidence',
          'A short supported summary and source hash are required',
        )
      const publicId = createHash('sha256')
        .update(`${id}:${source.content_hash}`)
        .digest('hex')
        .slice(0, 24)
      const entry = {
        id: `kb-${publicId}`,
        kind: String(note.category),
        title: String(note.title),
        summary: note.body,
        hero: String(note.hero || ''),
        patch: String(note.patch || 'unknown'),
        stamp: String(note.stamp),
        source_url,
        source_date: String(source.captured_at),
        content_hash: source.content_hash,
        locator: /^(?:\d{1,3}:\d{2})(?:\s*[–-]\s*\d{1,3}:\d{2})?$/.test(String(source.locator))
          ? String(source.locator)
          : source_url,
        verification: 'material_linked_not_independently_verified',
        evidence_level: String(
          source.evidence_level ||
            (source.material_type === 'transcript' ? 'subtitle_full' : 'post_body'),
        ),
        completeness: String(source.completeness || 'unknown'),
        ...(ontology
          ? {
              attribution: ontology.attribution,
              applicability_scope: 'version_independent',
              applicability_boundary: ontology.applicability_boundary,
            }
          : {}),
      }
      if (
        entry.title.length > 300 ||
        entry.hero.length > 100 ||
        entry.patch.length > 100 ||
        entry.stamp.length > 500 ||
        entry.source_url.length > 2048 ||
        !Number.isFinite(Date.parse(entry.source_date))
      )
        throw new CoachError(
          'invalid_evidence',
          'Selected knowledge exceeds the public snapshot contract',
        )
      return entry
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return { schema: 'dota2.ai/site-knowledge@1', generated_at: generatedAt, entries }
}
