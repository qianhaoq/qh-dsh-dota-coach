/** Optional network smoke: download a public multilingual model and verify actual local vector retrieval. */
import { KnowledgeMemory } from '../packages/coach/lib/types/memory.js'
import { Config } from '../packages/coach/lib/types/config.js'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
const home = process.env.DOTA_SEMANTIC_HOME || (await mkdtemp(join(tmpdir(), 'dota-semantic-')))
const memory = new KnowledgeMemory(new Context(), home, Config({ memorySearchTimeoutMs: 15000 }))
try {
  console.log('Model cache:', home)
  await memory.request('project', {
    record: {
      id: 'semantic-fixture',
      kind: 'source',
      title: '移动决策',
      body: '跨越中线前查看小地图和友军，确认安全再向前走。',
      source_id: 'user:synthetic-fixture',
      locator: 'paragraph 1',
      patch: 'unknown',
      created_at: new Date().toISOString(),
    },
  })
  const rebuilt = await memory.request('rebuild')
  console.log('Embedding repair:', JSON.stringify(rebuilt))
  assert.ok(Number(rebuilt.updated) > 0, 'No embedding was generated')
  const result = await memory.request('search', {
    query: '进河道需要留意什么信息？',
    timeout_ms: 15000,
  })
  assert.ok(Array.isArray(result.hits) && result.hits.length > 0, 'No semantic result')
  console.log('Local semantic search passed:', JSON.stringify(result.hits))
} finally {
  await memory.dispose()
}
