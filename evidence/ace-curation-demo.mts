// Ace t317u curation: import wmpvp reprint → candidate principle → host-authorized promote → export.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '../node_modules/@deepseek-ai/cordis/lib/index.js'
import Tools from '../node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import SystemPrompt from '../node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { CoachService } from '../packages/coach/src/service.ts'
import { Config } from '../packages/coach/src/config.ts'
import { makeTools } from '../packages/coach/src/tools.ts'

const root = dirname(fileURLToPath(import.meta.url))
const bodyPath = join(root, 'ace-305703.txt')
const principlePath = join(root, 'ace-principle-body.txt')
const jsonPath = join(root, 'ace-305703.json')
const sourceBody = (await readFile(bodyPath, 'utf8')).trimEnd() + '\n'
// Keep exact principle body from locked file (no trailing newline in ontology body).
const principleBody = (await readFile(principlePath, 'utf8')).trim()
const responseHash = createHash('sha256').update(await readFile(jsonPath)).digest('hex')
const sourceUrl = 'https://news.wmpvp.com/news.html?id=305703&gameTypeStr=1'
assert.equal(principleBody.length <= 1000, true)
assert.ok(!principleBody.includes('7.41f'))

const home = new URL(`./ace-curation-run-${Date.now()}/`, import.meta.url)
await mkdir(home)
const ctx = new Context()
new SystemPrompt(ctx, {})
new Tools(ctx, {})
let service = new CoachService(ctx, Config({ memoryEnabled: false }), home.pathname, '.')
for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec)))
  ctx.tools.register(tool)
const trace: any[] = []
async function kb(args: any) {
  const outcome = await ctx.tools.execute({
    callId: `ace-curation-${trace.length}` as never,
    name: 'dota_kb',
    arguments: args,
    signal: new AbortController().signal,
  })
  trace.push({ args, value: outcome.value })
  return outcome.value as any
}

try {
  const imported = service.store.source({
    action: 'import',
    source_id: 'wmpvp-news-305703',
    title: '来自Ace的14个三号位小技巧',
    body: sourceBody,
    locator: sourceUrl,
    material_type: 'article',
    origin: 'forum',
    patch: 'unknown',
    evidence_level: 'post_body',
    completeness: 'full',
    retrieval: {
      method: 'anonymous_wmpvp_appactivity_getAppNewsById',
      url: 'https://appactivity.wmpvp.com/steamcn/app/news/getAppNewsById?gameType=1&newsId=305703',
      response_hash: responseHash,
      attribution: 'Ace（Marcus Hoelgaard / Ace Dota 2）；完美世界电竞转载',
      permission: 'reprint_linked_not_republished_raw',
    },
  })
  assert.equal(imported.ok, true)
  const source = imported.record as any
  const legacy = service.store.note({
    kind: 'principle',
    title: 'Ace：三号位对线外的14条短规则（legacy candidate）',
    body: principleBody,
    stamp: '[unknown · 2026-11-09 · wmpvp-news-305703]',
    source_id: source.source_id,
    source_record_id: source.id,
    patch: 'unknown',
    role: 'offlane',
  }).record as any

  const created = await kb({
    action: 'create',
    kind: 'principle',
    title: 'Ace：三号位对线外的14条短规则',
    body: principleBody,
    source_record_id: source.id,
    patch: 'unknown',
    role: 'offlane',
    concepts: ['三号位', '赢线后', 'Ace'],
  })
  assert.equal(created.ok, true)
  const id = created.record.id
  assert.equal((await kb({ action: 'export', ids: [id] })).ok, false)

  const curation = {
    reviewer: '钱浩（经 Grok Bot 消息 t317u「蒸馏」）',
    approval_ref: 't317u',
    decision: 'approve_version_independent',
    rationale:
      '人类批准按修订短摘要晋升为版本无关原则；保留 Ace 署名、完美世界电竞转载原链及适用边界，不发布旧长正文，不钉死具体补丁。',
    reviewed_at:
      new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00',
    timezone: 'Asia/Shanghai',
    candidate_id: legacy.id,
  }
  const attribution = 'Ace（Marcus Hoelgaard / Ace Dota 2）；完美世界电竞转载'
  const applicability_boundary =
    '历史作者建议；版本无关的局势判断原则。须按当前兵线、装备与团战条件判断，不构成具体补丁或具体对局的有效性验证。原视频见 YouTube Ace Dota 2《14 Offlane Tips That Win Games at Any MMR》。'
  const promotion = {
    action: 'promote',
    id,
    curation,
    attribution,
    applicability_boundary,
  }
  assert.equal((await kb(promotion)).ok, false, 'reviewer text alone cannot self-authorize')
  service.store.ontology.authorizePromotion(promotion)
  const promoted = await kb(promotion)
  assert.equal(promoted.record.state, 'active')
  assert.equal(promoted.record.exportable, true)
  assert.equal(promoted.record.applicability_scope, 'version_independent')

  for (const query of ['三号位', 'Ace', '赢线后']) {
    for (const patch of ['unknown', '7.41f', '60']) {
      const recall = await kb({ action: 'recall', patch, role: 'offlane', query })
      assert.equal(recall.items[0]?.id, id, `${query}/${patch}`)
      assert.equal(recall.items[0]?.applicability, 'version_independent')
    }
  }
  assert.equal((await kb({ action: 'get', id, current_patch: '7.41f' })).record.applicability, 'version_independent')
  assert.equal((await kb({ action: 'export', ids: [legacy.id] })).ok, false)

  const exported = await kb({ action: 'export', ids: [id] })
  assert.equal(exported.ok, true)
  const entry = exported.snapshot.entries[0]
  assert.equal(entry.summary, principleBody)
  assert.equal(entry.patch, 'unknown')
  assert.equal(entry.source_url, sourceUrl)
  assert.equal(entry.attribution, attribution)
  assert.equal(entry.applicability_scope, 'version_independent')
  assert.ok(!JSON.stringify(exported.snapshot).includes('7.41f'))
  assert.ok(!JSON.stringify(exported.snapshot).includes('t317u'))
  assert.ok(!JSON.stringify(exported.snapshot).includes(String(legacy.id)))

  await writeFile(new URL('./ace-curation-snapshot.json', import.meta.url), JSON.stringify(exported.snapshot, null, 2) + '\n')
  await writeFile(new URL('trace.json', home), JSON.stringify(trace, null, 2) + '\n')
  await copyFile(new URL('coach.sqlite', home), new URL('./ace-curation-coach.sqlite', import.meta.url)).catch(() => {})

  await service.dispose()
  service = new CoachService(ctx, Config({ memoryEnabled: false }), home.pathname, '.')
  assert.equal((await kb({ action: 'get', id })).record.state, 'active')
  const summary = {
    principle_id: id,
    public_kb_id: entry.id,
    content_hash: entry.content_hash,
    curation,
    final_state: 'active',
    human_reviews: 1,
    promotions: 1,
    exports: 1,
    snapshot: exported.snapshot,
    database: home.pathname + 'coach.sqlite',
    source_url: sourceUrl,
    youtube_reference: 'https://www.youtube.com/watch?v=bPltAi7r0Qk',
    package_version_unchanged: '0.6.5',
  }
  await writeFile(new URL('./ace-curation-demo-summary.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await service.dispose()
}
