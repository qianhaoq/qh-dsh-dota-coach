import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Tasks } from '../packages/coach/src/tasks.ts'
test('one cancelled waiter preserves the shared job; the last cancelled waiter aborts it', async () => {
  const tasks = new Tasks(),
    a = new AbortController(),
    b = new AbortController()
  let count = 0
  const run = async (signal: AbortSignal) => {
    count++
    await delay(30, undefined, { signal })
    return { ok: true }
  }
  const pa = tasks.run('shared', run, a.signal),
    pb = tasks.run('shared', run, b.signal)
  a.abort()
  await assert.rejects(pa)
  assert.equal((await pb).ok, true)
  assert.equal(count, 1)
  const c = new AbortController()
  let aborted = false
  const pc = tasks.run(
    'last',
    async (signal) => {
      try {
        await delay(1000, undefined, { signal })
      } catch (e) {
        aborted = true
        throw e
      }
      return { ok: true }
    },
    c.signal,
  )
  await delay(5)
  c.abort()
  await assert.rejects(pc)
  await tasks.dispose()
  assert.equal(aborted, true)
})
test('explicit cancellation and disposal settle jobs before returning', async () => {
  const tasks = new Tasks()
  const job = tasks.run('job', async (signal) => {
    await delay(1000, undefined, { signal })
    return { ok: true }
  })
  await delay(2)
  assert.equal(tasks.cancel(tasks.list()[0]!.id), true)
  assert.equal((await job).ok, false)
  const other = tasks.run('other', async (signal) => {
    await delay(1000, undefined, { signal })
    return { ok: true }
  })
  await tasks.dispose()
  assert.equal((await other).ok, false)
  assert.ok(tasks.list().every((j) => j.status !== 'running'))
})
