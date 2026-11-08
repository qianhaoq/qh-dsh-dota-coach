import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoachService } from '../packages/coach/src/service.ts'
import { Config } from '../packages/coach/src/config.ts'
import { makeTools } from '../packages/coach/src/tools.ts'
import { readPublicPost, readOfficialPatch, apply } from '../packages/coach/src/public-source.ts'

const url = 'https://www.reddit.com/r/learndota2/comments/abc123/example/'
const post = {
  id: 'abc123',
  title: 'Enigma 7.41e study',
  selftext: 'Synthetic full article: preserve summons when the lane becomes unsafe.',
  is_self: true,
  created_utc: 1700000000,
}
test('official source dispatch keeps reference provenance and refuses public tactical export', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dota-official-reference-'))
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, {})
  const service = new CoachService(ctx, Config({ memoryEnabled: false }), home, '.')
  ctx.tools.register(
    defineTool({
      name: 'official_patch_json',
      description: 'Synthetic official contract response',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async () => ({
        ok: true,
        source_id: 'official-patch-7.41f',
        title: 'Synthetic official identity reference',
        body: 'Synthetic official patch identity only; no tactical coaching.',
        patch: '7.41f',
        url: 'https://www.dota2.com/datafeed/patchnotes?version=7.41f&language=english',
        completeness: 'full',
      }),
    }),
  )
  for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec)))
    ctx.tools.register(tool)
  const call = async (name: string, args: Record<string, unknown>) =>
    (
      await ctx.tools.execute({
        callId: 'official-contract' as never,
        name,
        arguments: args,
        signal: new AbortController().signal,
      })
    ).value as Record<string, any>
  try {
    const source = await call('dota_source', {
      action: 'fetch',
      provider_tool: 'official_patch_json',
      provider_args: {},
    })
    assert.equal(source.ok, true)
    assert.equal(source.record.origin, 'official')
    assert.equal(source.record.patch, '7.41f')
    const note = await call('dota_coach_note', {
      action: 'append',
      kind: 'fact',
      source_id: source.record.source_id,
      source_record_id: source.record.id,
      patch: '7.41f',
      title: 'Synthetic reference identity',
      body: 'Reference identity only, with no hero, tactical advice or match patch inference.',
      stamp: '[7.41f · 2026-11-08 · official-patch-7.41f]',
    })
    assert.equal(note.ok, true)
    assert.equal(
      (await call('dota_kb', { action: 'get', id: note.record.id, current_patch: '7.41f' })).record
        .applicability,
      'patch_matches',
    )
    const mismatch = await call('dota_kb', {
      action: 'get',
      id: note.record.id,
      current_patch: '7.41e',
    })
    assert.equal(mismatch.record.applicability, 'outdated')
    assert.equal(mismatch.record.needs_recheck, true)
    assert.equal((await call('dota_kb', { action: 'export', ids: [note.record.id] })).ok, false)
  } finally {
    await service.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
const response = (value: unknown) =>
  new Response(JSON.stringify([{ data: { children: [{ data: value }] } }]), {
    headers: { 'content-type': 'application/json' },
  })
test('official reference retains exact localized response and rejects identity substitutions', async () => {
  const url = 'https://www.dota2.com/datafeed/patchnotes?version=7.41f&language=english'
  const data = {
    success: true,
    patch_name: '7.41f',
    patch_number: '7.41f',
    heroes: [],
    items: [{ note: 'Synthetic balance reference' }],
  }
  const response = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  const result = await readOfficialPatch(
    url,
    new AbortController().signal,
    async (input, options) => {
      assert.equal(input, url)
      assert.equal(options?.credentials, 'omit')
      assert.equal(options?.redirect, 'error')
      return response(data)
    },
  )
  assert.equal(result.body, JSON.stringify(data))
  assert.equal(result.patch, '7.41f')
  assert.equal(result.published_at, null)
  assert.equal(result.content_hash, result.retrieval.response_hash)
  assert.match(result.title, /not tactical advice/)
  for (const invalid of [
    url.replace('www.dota2.com', 'localhost'),
    url + '&token=private',
    url.replace('english', 'schinese'),
    url.replace('https:', 'http:'),
  ])
    await assert.rejects(
      readOfficialPatch(invalid, new AbortController().signal, async () => {
        throw new Error('must not fetch')
      }),
    )
  for (const value of [
    { ...data, success: false },
    { ...data, patch_name: '7.41e' },
    { ...data, patch_number: '7.41' },
    { ...data, items: [{ note: '#DOTA_Patch_unresolved' }] },
  ])
    await assert.rejects(
      readOfficialPatch(url, new AbortController().signal, async () => response(value)),
    )
  await assert.rejects(
    readOfficialPatch(
      url,
      new AbortController().signal,
      async () => new Response('denied', { status: 403 }),
    ),
  )
  await assert.rejects(
    readOfficialPatch(
      url,
      new AbortController().signal,
      async () =>
        new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } }),
    ),
  )
})
test('anonymous provider preserves complete material, identity, exact patch and collection evidence', async () => {
  const result = await readPublicPost(url, new AbortController().signal, async (input, options) => {
    assert.equal(
      String(input),
      'https://www.reddit.com/r/learndota2/comments/abc123/.json?raw_json=1&limit=0',
    )
    assert.equal(options?.credentials, 'omit')
    assert.equal(options?.redirect, 'error')
    assert.deepEqual(Object.keys(options?.headers ?? {}).sort(), ['Accept', 'User-Agent'])
    return response(post)
  })
  assert.equal(result.body, post.selftext)
  assert.equal(result.patch, '7.41e')
  assert.equal(result.completeness, 'full')
  assert.equal(result.evidence_level, 'post_body')
  assert.match(result.content_hash, /^[a-f0-9]{64}$/)
  assert.ok(Number.isFinite(Date.parse(result.captured_at)))
  assert.match(result.retrieval.response_hash, /^[a-f0-9]{64}$/)
})
test('private routes, redirects, removal, wrong post and HTML are rejected', async () => {
  for (const candidate of [
    'http://www.reddit.com/r/x/comments/abc123/',
    'https://www.reddit.com/message/messages/abc123',
    url + '?token=secret',
    'https://localhost/r/x/comments/abc123/',
  ]) {
    await assert.rejects(
      readPublicPost(candidate, new AbortController().signal, async () => {
        throw new Error('must not fetch')
      }),
    )
  }
  for (const result of [
    response({ ...post, id: 'wrong' }),
    response({ ...post, selftext: '[removed]' }),
    new Response('<h1>Login</h1>'),
    new Response('denied', { status: 403 }),
  ])
    await assert.rejects(readPublicPost(url, new AbortController().signal, async () => result))
  const ambiguous = await readPublicPost(url, new AbortController().signal, async () =>
    response({ ...post, selftext: post.selftext + ' Compare 7.41f.' }),
  )
  assert.equal(ambiguous.patch, 'unknown')
})
test('learning profile policy denies promotion, principles and unrelated tools at the host seam', async () => {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, {})
  const fiber = ctx.plugin({ apply }, { learningOnly: true, sourceUrl: url })
  await fiber.inertia
  try {
    const result = await ctx.tools.execute({
      callId: 'policy' as never,
      name: 'reddit_json',
      arguments: { url: 'http://localhost/' },
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, true)
    // An external promotion tool remains denied even if another plugin registers it.
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    let executed = false
    ctx.tools.register(
      defineTool({
        name: 'dota_kb',
        description: 'test export',
        parameters: { action: { type: 'string' } },
        output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
        execute: async () => {
          executed = true
          return {}
        },
      }),
    )
    const denied = await ctx.tools.execute({
      callId: 'promote' as never,
      name: 'dota_kb',
      arguments: { action: 'export' },
      signal: new AbortController().signal,
    })
    assert.equal(denied.isError, true)
    assert.equal(executed, false)
    for (const [name, args] of [
      ['dota_coach_note', { action: 'append', kind: 'principle' }],
      ['shell', { command: 'not executed' }],
    ] as const) {
      ctx.tools.register(
        defineTool({
          name,
          description: 'Synthetic policy probe',
          parameters: {
            action: { type: 'string' },
            kind: { type: 'string' },
            command: { type: 'string' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
          execute: async () => {
            executed = true
            return {}
          },
        }),
      )
      const refused = await ctx.tools.execute({
        callId: `deny-${name}` as never,
        name,
        arguments: args,
        signal: new AbortController().signal,
      })
      assert.equal(refused.isError, true)
      assert.equal(executed, false)
    }
  } finally {
    await fiber.dispose()
  }
})

test('single admitted Steam guide fails closed on boundaries and incomplete sections', async () => {
  const { readSupportGuide, supportGuideUrl } = await import(
    '../packages/coach/src/public-source.ts'
  )
  const html =
    '<div class="apphub_AppName ellipsis">Dota 2</div>' +
    '<div class="workshopItemTitle">How to play Support in Dota 2</div>' +
    Array.from(
      { length: 10 },
      (_, i) =>
        `<div class="subSection detailBox" id="${i}"><div class="subSectionTitle">Section ${i}</div><div class="subSectionDesc"><div>Conditional advice for synthetic parser contract. ${'Evidence text. '.repeat(10)}</div></div></div>`,
    ).join('')
  const reply = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })
  const result = await readSupportGuide(
    supportGuideUrl,
    new AbortController().signal,
    async (url, options) => {
      assert.equal(url, supportGuideUrl)
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.credentials, 'omit')
      return reply(html)
    },
  )
  const hiddenNotice =
    '<div class="bannedNotification" id="bannedNotification" style="display: none" >This item has been removed</div>'
  const withHiddenNotice = await readSupportGuide(
    supportGuideUrl,
    new AbortController().signal,
    async () => reply(hiddenNotice + html),
  )
  assert.equal(withHiddenNotice.body, result.body)
  assert.equal(result.patch, 'unknown')
  assert.equal(result.published_at, null)
  assert.equal(result.retrieval.section_count, 10)
  assert.match(result.retrieval.permission, /human review required/)
  assert.equal(result.body.split('\n\n').length, 10)
  assert.doesNotMatch(result.body, /<div/)
  for (const url of [
    supportGuideUrl + '&x=1',
    supportGuideUrl.replace('827490913', '1'),
    supportGuideUrl.replace('https:', 'http:'),
    supportGuideUrl.replace('steamcommunity.com', 'localhost'),
  ])
    await assert.rejects(
      readSupportGuide(url, new AbortController().signal, async () => {
        throw Error('must not request')
      }),
    )
  for (const body of [
    html.replace('Dota 2</div>', 'Other</div>'),
    html.slice(0, -6),
    html.replace('id="9"', 'id="0"'),
    'This item has been removed' + html,
  ])
    await assert.rejects(
      readSupportGuide(supportGuideUrl, new AbortController().signal, async () => reply(body)),
    )
})
