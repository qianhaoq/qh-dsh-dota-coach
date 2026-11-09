import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'

export const name = 'dota-public-source'
export const inject = ['tools']

/** Exact official balance feed; structured reference material, never tactical coaching. */
export async function readOfficialPatch(input: string, signal: AbortSignal, request = fetch) {
  const url = new URL(input)
  const patch = url.searchParams.get('version')
  if (
    !patch ||
    !/^7\.\d{2}[a-z]?$/.test(patch) ||
    input !== `https://www.dota2.com/datafeed/patchnotes?version=${patch}&language=english`
  )
    throw new Error('Use the exact public English patchnotes endpoint with an explicit version')
  const response = await request(input, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    redirect: 'error',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('application/json') ||
    !response.body
  )
    throw new Error('Official patch response unavailable')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > 2_000_000) throw new Error('Official patch exceeds the bounded evidence limit')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  const data = JSON.parse(body)
  if (
    data.success !== true ||
    data.patch_name !== patch ||
    data.patch_number !== patch ||
    !Array.isArray(data.heroes) ||
    !Array.isArray(data.items) ||
    /#DOTA_Patch_/.test(body)
  )
    throw new Error('Exact localized official patch identity or material unavailable')
  const hash = createHash('sha256').update(body).digest('hex')
  return {
    ok: true,
    source_id: `official-patch-${patch}`,
    title: `Official ${patch} balance reference (not tactical advice)`,
    body,
    url: input,
    patch,
    evidence_level: 'post_body',
    completeness: 'full',
    captured_at: new Date().toISOString(),
    published_at: Number.isFinite(data.patch_timestamp)
      ? new Date(data.patch_timestamp * 1000).toISOString()
      : null,
    content_hash: hash,
    retrieval: { method: 'anonymous_official_patch_json', url: input, response_hash: hash },
  }
}

/** One independently admitted public guide. No arbitrary HTML fetch or linked resources. */
export const supportGuideUrl = 'https://steamcommunity.com/sharedfiles/filedetails/?id=827490913'

export function parseSupportGuide(html: string) {
  if (
    !html.includes('<div class="apphub_AppName ellipsis">Dota 2</div>') ||
    !html.includes('<div class="workshopItemTitle">How to play Support in Dota 2</div>') ||
    /This item has been removed/.test(
      html.replace(
        /<div class="bannedNotification" id="bannedNotification" style="display: none" >[\s\S]*?<\/div>/,
        '',
      ),
    )
  )
    throw new Error('Public Dota guide identity unavailable')
  const sections = [...html.matchAll(/<div class="subSection detailBox" id="(\d+)">/g)]
  if (sections.length !== 10 || new Set(sections.map((s) => s[1])).size !== 10)
    throw new Error('Complete guide sections unavailable')
  const text = (value: string) =>
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
        const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' '
      })
      .replace(
        /&(amp|lt|gt|quot|apos|nbsp);/g,
        (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n]!,
      )
      .replace(/\s+/g, ' ')
      .trim()
  const bodies = sections.map((section) => {
    const start = section.index! + section[0].length
    let depth = 1,
      end = -1
    const tags = /<div\b[^>]*>|<\/div\s*>/gi
    tags.lastIndex = start
    for (let tag; (tag = tags.exec(html)); ) {
      depth += /^<\//.test(tag[0]) ? -1 : 1
      if (!depth) {
        end = tag.index
        break
      }
    }
    if (end < 0) throw new Error('Truncated guide section')
    const fragment = html.slice(start, end)
    if (
      !fragment.includes('class="subSectionTitle"') ||
      !fragment.includes('class="subSectionDesc"')
    )
      throw new Error('Guide section body missing')
    return text(fragment)
  })
  const body = bodies.join('\n\n')
  if (body.length < 1000 || body.length > 18000)
    throw new Error('Guide body outside bounded read limit')
  return { body, section_count: bodies.length }
}

export async function readSupportGuide(input: string, signal: AbortSignal, request = fetch) {
  if (input !== supportGuideUrl)
    throw new Error('Only the independently admitted support guide URL is allowed')
  const response = await request(input, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    redirect: 'error',
    credentials: 'omit',
    headers: { Accept: 'text/html' },
  })
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get('content-type')?.includes('text/html')
  )
    throw new Error('Public guide unavailable')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > 1_000_000) throw new Error('Guide response exceeds limit')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const { body, section_count } = parseSupportGuide(raw)
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  return {
    ok: true,
    source_id: 'steam-guide-827490913',
    title: 'How to play Support in Dota 2 (Steam Community author advice)',
    body,
    url: input,
    patch: 'unknown',
    evidence_level: 'post_body',
    completeness: 'full',
    captured_at: new Date().toISOString(),
    published_at: null,
    content_hash: hash(body),
    retrieval: {
      method: 'anonymous_public_steam_guide',
      url: input,
      response_hash: hash(raw),
      section_count,
      attribution: 'Steam Community guide authors; see original guide',
      permission:
        'No republication permission established; human review required; summary and link only',
    },
  }
}

/** A single anonymous public post, never comments, search results, cookies or redirects. */
export async function readPublicPost(input: string, signal: AbortSignal, request = fetch) {
  const url = new URL(input)
  const route = /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/[^/]*)?\/?$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.reddit.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !route
  )
    throw new Error('Use a canonical https://www.reddit.com/r/.../comments/... public post URL')
  const canonical = `https://www.reddit.com/r/${route[1]}/comments/${route[2]}/`
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  const response = await request(`${canonical}.json?raw_json=1&limit=0`, {
    signal: bounded,
    redirect: 'error',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'dsh-dota-public-source/1.0 (read-only learning)',
    },
  })
  if (!response.ok)
    throw new Error(`Public post unavailable (HTTP ${response.status}); no source imported`)
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Public provider did not return JSON; no source imported')
  if (!response.body) throw new Error('Public provider returned no body')
  let bytes = 0
  const chunks: Uint8Array[] = []
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > 2_000_000) {
      throw new Error('Public post exceeds the bounded evidence limit')
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const post = JSON.parse(raw)?.[0]?.data?.children?.[0]?.data
  if (
    post?.id !== route[2] ||
    typeof post.title !== 'string' ||
    typeof post.selftext !== 'string' ||
    post.selftext.trim().length < 20 ||
    post.is_self !== true ||
    post.over_18 ||
    post.quarantine ||
    ['[removed]', '[deleted]'].includes(post.selftext.trim())
  )
    throw new Error('Public post identity or full readable body unavailable')
  const patches = [...new Set(`${post.title}\n${post.selftext}`.match(/\b7\.\d{2}[a-z]?\b/g) ?? [])]
  return {
    ok: true,
    source_id: post.id as string,
    title: post.title as string,
    body: post.selftext as string,
    url: canonical,
    evidence_level: 'post_body',
    completeness: 'full',
    captured_at: new Date().toISOString(),
    published_at: Number.isFinite(post.created_utc)
      ? new Date(post.created_utc * 1000).toISOString()
      : null,
    patch: patches.length === 1 ? patches[0] : 'unknown',
    content_hash: createHash('sha256').update(post.selftext).digest('hex'),
    retrieval: {
      method: 'anonymous_public_json',
      url: `${canonical}.json?raw_json=1&limit=0`,
      response_hash: createHash('sha256').update(raw).digest('hex'),
    },
  }
}

/** Optional, separately mounted provider; source dispatch still passes through host policy. */
export function apply(ctx: Context, config: { learningOnly?: boolean; sourceUrl?: string } = {}) {
  if (config.learningOnly) {
    let calls = 0,
      fetches = 0,
      reads = 0,
      notes = 0
    ctx.on('tools/pre-execute', async (exec, next) => {
      const args = exec.arguments as Record<string, unknown>
      const allowed =
        ['reddit_json', 'official_patch_json', 'steam_support_guide'].includes(exec.name) ||
        (exec.name === 'dota_source' && ['fetch', 'get', 'list'].includes(String(args.action))) ||
        (exec.name === 'dota_kb' && (['search', 'get', 'status', 'recall'].includes(String(args.action)) ||
          (args.action === 'create' && args.kind === 'fact' && (!args.state || args.state === 'candidate'))))
      const requested = ['reddit_json', 'official_patch_json', 'steam_support_guide'].includes(
        exec.name,
      )
        ? args.url
        : (args.provider_args as Record<string, unknown> | undefined)?.url
      if (
        !allowed ||
        ++calls > 12 ||
        (['reddit_json', 'official_patch_json', 'steam_support_guide', 'dota_source'].includes(
          exec.name,
        ) &&
          args.action !== 'get' &&
          args.action !== 'list' &&
          config.sourceUrl &&
          requested !== config.sourceUrl) ||
        (['reddit_json', 'official_patch_json', 'steam_support_guide'].includes(exec.name) &&
          ++reads > 1) ||
        (exec.name === 'dota_source' && args.action === 'fetch' && ++fetches > 1) ||
        (exec.name === 'dota_kb' && args.action === 'create' && ++notes > 1)
      )
        return {
          kind: 'deny',
          reason:
            'Bounded candidate learning permits one source, one candidate ontology fact and reads only; promotion requires separate review',
        }
      return next()
    })
  }
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'steam_support_guide',
        description:
          'Read the single admitted public Steam support guide, all ten text sections. Unknown patch; old author advice requires human review. Never infer current applicability.',
        parameters: { url: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          try {
            return await readSupportGuide(String(args.url), exec.signal)
          } catch {
            return {
              ok: false,
              reason: 'public_guide_unavailable',
              message: 'No complete admitted public guide imported.',
            }
          }
        },
      }),
    ),
  )
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'official_patch_json',
        description:
          'Read one exact official English Dota patch feed anonymously. Returns the complete structured balance reference with exact identity and hashes. Balance notes do not establish tactical advice or match applicability.',
        parameters: { url: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          try {
            return await readOfficialPatch(String(args.url), exec.signal)
          } catch {
            return {
              ok: false,
              reason: 'official_patch_unavailable',
              message: 'No exact localized official material imported.',
            }
          }
        },
      }),
    ),
  )
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'reddit_json',
        description:
          'Read one complete public Reddit post anonymously. No comments or private endpoints. Returns full body, URL, time and hash; author claims remain unverified.',
        parameters: { url: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          try {
            return await readPublicPost(String(args.url), exec.signal)
          } catch {
            return {
              ok: false,
              reason: 'public_source_unavailable',
              message:
                'Public post retrieval failed; check access and retry. No evidence was imported.',
            }
          }
        },
      }),
    ),
  )
}
