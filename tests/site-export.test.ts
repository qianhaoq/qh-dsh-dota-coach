import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CoachService } from '../packages/coach/src/service.ts'
import { CoachStore } from '../packages/coach/src/store.ts'
import { Config } from '../packages/coach/src/config.ts'
import { buildSiteSnapshot } from '../packages/coach/src/site-export.ts'
import type { RecordValue } from '../packages/coach/src/types.ts'

function material(store: CoachStore, suffix = '', publicSource = true, sourceArgs: RecordValue = {}) {
  const source = store.source({ action:'import', source_id:'BV1xx411c7mD', title:'Public fixture',
    body:'A synthetic public transcript about checking objectives before moving.', locator:'12:30–12:45',
    material_type:publicSource?'transcript':'user_notes', origin:publicSource?'bilibili':'user_import', patch:'7.41f', ...sourceArgs }).record as RecordValue
  return store.note({ kind:'principle', title:'Check the next objective'+suffix, body:'Look at the next objective before deciding to cross the river.'+suffix,
    stamp:'[long-term · 2026-11-05 · BV1xx411c7mD]', source_id:source.source_id!, source_record_id:source.id!, hero:'', patch:'unknown' }).record as RecordValue
}

test('public snapshot selects explicit knowledge only and preserves provenance across reopen', async t => {
  const home = await mkdtemp(join(tmpdir(),'coach-site-export-'))
  let store = new CoachStore(home)
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true})})
  const selected = material(store), hidden = material(store,' PRIVATE_UNSELECTED')
  const snapshot = buildSiteSnapshot(store,[selected.id,selected.id],'2026-11-05T00:00:00Z')
  const text = JSON.stringify(snapshot)
  assert.equal((snapshot.entries as RecordValue[]).length,1)
  assert.ok(!text.includes(String(selected.id)))
  assert.ok(!text.includes(String(hidden.id)))
  assert.ok(!text.includes('PRIVATE_UNSELECTED'))
  assert.ok(!text.includes(home))
  const entry = (snapshot.entries as RecordValue[])[0]!
  assert.equal(entry.source_url,'https://www.bilibili.com/video/BV1xx411c7mD')
  assert.equal(entry.locator,'12:30–12:45')
  assert.match(String(entry.content_hash),/^[a-f0-9]{64}$/)
  store.close();store = new CoachStore(home)
  assert.deepEqual(buildSiteSnapshot(store,[selected.id],'2026-11-05T00:00:00Z'),snapshot)
  assert.throws(()=>buildSiteSnapshot(store,[]))
})

test('private, superseded and flagged knowledge cannot enter a public snapshot', async t => {
  const home = await mkdtemp(join(tmpdir(),'coach-site-denied-'))
  const store = new CoachStore(home)
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true})})
  const privateNote = material(store,'private',false)
  assert.throws(()=>buildSiteSnapshot(store,[privateNote.id]),/public/)
  const note = material(store)
  store.note({action:'recheck',id:note.id!,body:'Recheck applicability'})
  assert.throws(()=>buildSiteSnapshot(store,[note.id]),/Recheck/)
})

test('export tool writes the versioned snapshot atomically and rejects implicit selection', async t => {
  const home = await mkdtemp(join(tmpdir(),'coach-site-tool-'))
  const service = new CoachService(new Context(),Config({memoryEnabled:false}),home,'.')
  t.after(async()=>{await service.dispose();await rm(home,{recursive:true,force:true})})
  const note = material(service.store)
  const result = await service.invoke('dota_kb',{action:'export',ids:[note.id!]})
  assert.equal(result.ok,true,JSON.stringify(result))
  const text = await readFile(join(home,'export/site/knowledge.v1.json'),'utf8')
  assert.deepEqual(JSON.parse(text),result.snapshot)
  assert.equal((await service.invoke('dota_kb',{action:'export'})).ok,false)
  assert.equal(await readFile(join(home,'export/site/knowledge.v1.json'),'utf8'),text)
})

test('video URL locators retain timestamp and multipart selectors without tracking data', async t => {
  const home = await mkdtemp(join(tmpdir(),'coach-site-locators-'))
  const store = new CoachStore(home)
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true})})
  for (const [source_id, origin, locator, expected] of [
    ['dQw4w9WgXcQ','youtube','https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=750s&si=tracking','https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=750s'],
    ['BV1xx411c7mD','bilibili','https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=750&session=private','https://www.bilibili.com/video/BV1xx411c7mD?t=750&p=2'],
  ]) {
    const note = material(store,origin,true,{source_id:source_id!,origin:origin!,locator:locator!})
    const entry = (buildSiteSnapshot(store,[note.id]).entries as RecordValue[])[0]!
    assert.equal(entry.source_url,expected)
    assert.equal(entry.locator,expected)
  }
})

test('private/account routes and mismatched video locators are not public provenance', async t => {
  const home = await mkdtemp(join(tmpdir(),'coach-site-private-routes-'))
  const store = new CoachStore(home)
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true})})
  for (const locator of ['https://www.reddit.com/message/messages/abc123','https://www.youtube.com/feed/history','https://www.bilibili.com/account','https://www.dota2.com/account']) {
    const note = material(store,locator,true,{source_id:locator,origin:'forum',material_type:'article',locator})
    assert.throws(()=>buildSiteSnapshot(store,[note.id]),/public resource/)
  }
  const wrong = material(store,'wrong video',true,{origin:'youtube',source_id:'dQw4w9WgXcQ',locator:'https://youtu.be/abcdefghijk?t=10'})
  assert.throws(()=>buildSiteSnapshot(store,[wrong.id]),/same supported public resource/)
  const post = material(store,'public post',true,{source_id:'public-post',origin:'forum',material_type:'article',locator:'https://www.reddit.com/r/DotA2/comments/abc123/public_post/?token=private'})
  assert.equal((buildSiteSnapshot(store,[post.id]).entries as RecordValue[])[0]!.source_url,'https://www.reddit.com/r/DotA2/comments/abc123/public_post/')
})

test('promotion rehashes durable bodies and refuses excerpt or mismatched patch facts', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'coach-site-integrity-'))
  const store = new CoachStore(home)
  t.after(async () => {
    store.close()
    await rm(home, { recursive: true, force: true })
  })
  const note = material(store)
  const source = store.get(String(note.source_record_id), 'source')
  const mutate = (row: RecordValue) =>
    store.db
      .prepare('UPDATE records SET data=? WHERE id=?')
      .run(JSON.stringify(row), String(row.id))
  mutate({
    ...source,
    body: 'Tampered text which must never be exported as the original material.',
  })
  assert.throws(() => buildSiteSnapshot(store, [note.id]), /hash/)
  mutate({ ...source, completeness: 'excerpt' })
  assert.throws(() => buildSiteSnapshot(store, [note.id]), /completeness/)
  mutate(source)
  mutate({ ...note, category: 'fact', patch: '7.41' })
  assert.throws(() => buildSiteSnapshot(store, [note.id]), /exact source patch/)
  mutate({ ...note, category: 'fact', patch: '7.41f' })
  assert.equal((buildSiteSnapshot(store, [note.id]).entries as RecordValue[])[0]!.patch, '7.41f')
  assert.equal(store.kbGet({ id: note.id!, current_patch: '7.41' }).record !== undefined, true)
})
