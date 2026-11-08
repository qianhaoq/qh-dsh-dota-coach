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
        ['reddit_json', 'official_patch_json'].includes(exec.name) ||
        (exec.name === 'dota_source' && ['fetch', 'get', 'list'].includes(String(args.action))) ||
        (exec.name === 'dota_kb' && ['search', 'get', 'status'].includes(String(args.action))) ||
        (exec.name === 'dota_coach_note' && args.action === 'append' && args.kind === 'fact')
      const requested = ['reddit_json', 'official_patch_json'].includes(exec.name)
        ? args.url
        : (args.provider_args as Record<string, unknown> | undefined)?.url
      if (
        !allowed ||
        ++calls > 12 ||
        (['reddit_json', 'official_patch_json', 'dota_source'].includes(exec.name) &&
          args.action !== 'get' &&
          args.action !== 'list' &&
          config.sourceUrl &&
          requested !== config.sourceUrl) ||
        (['reddit_json', 'official_patch_json'].includes(exec.name) && ++reads > 1) ||
        (exec.name === 'dota_source' && args.action === 'fetch' && ++fetches > 1) ||
        (exec.name === 'dota_coach_note' && ++notes > 1)
      )
        return {
          kind: 'deny',
          reason:
            'Bounded candidate learning permits one source, one fact note and reads only; promotion requires separate review',
        }
      return next()
    })
  }
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
