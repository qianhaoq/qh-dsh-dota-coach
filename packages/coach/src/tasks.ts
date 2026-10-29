import { randomUUID } from 'node:crypto'
import { cancelled } from './http.ts'
import { failure } from './errors.ts'
import type { RecordValue, TaskView } from './types.ts'
/** Owns child work and joins every promise before storage closes on reload. */
export class Tasks {
  readonly controller = new AbortController()
  private pending = new Map<string, Promise<RecordValue>>()
  private views = new Map<string, TaskView>()
  private watchers = new Map<string, number>()
  private keyControls = new Map<string, AbortController>()
  private controls = new Map<string, AbortController>()
  run(
    key: string,
    f: (signal: AbortSignal) => Promise<RecordValue>,
    caller?: AbortSignal,
  ): Promise<RecordValue> {
    this.controller.signal.throwIfAborted()
    let promise = this.pending.get(key)
    if (!promise) {
      const controller = new AbortController(),
        id = randomUUID()
      const view: TaskView = {
        id,
        tool: key,
        status: 'running',
        started_at: new Date().toISOString(),
      }
      this.views.set(id, view)
      this.controls.set(id, controller)
      this.keyControls.set(key, controller)
      promise = Promise.resolve()
        .then(() => f(AbortSignal.any([controller.signal, this.controller.signal])))
        .then(
          (result) => {
            view.status = result.ok === false ? 'failed' : 'completed'
            view.result = result
            return result
          },
          (error) => {
            view.status =
              controller.signal.aborted || this.controller.signal.aborted ? 'cancelled' : 'failed'
            view.result = failure(error)
            return view.result
          },
        )
        .finally(() => {
          this.pending.delete(key)
          this.controls.delete(id)
          this.keyControls.delete(key)
          if (this.views.size > 100) {
            const oldest = [...this.views.values()].find((v) => v.status !== 'running')
            if (oldest) this.views.delete(oldest.id)
          }
        })
      this.pending.set(key, promise)
    }
    this.watchers.set(key, (this.watchers.get(key) || 0) + 1)
    return cancelled(promise, caller).finally(() => {
      const count = (this.watchers.get(key) || 1) - 1
      if (count === 0) {
        this.watchers.delete(key)
        this.keyControls.get(key)?.abort(new DOMException('All callers cancelled', 'AbortError'))
      } else this.watchers.set(key, count)
    })
  }
  list(): TaskView[] {
    return [...this.views.values()]
  }
  cancel(id: string): boolean {
    const c = this.controls.get(id)
    if (!c) return false
    c.abort(new DOMException('Cancelled by user', 'AbortError'))
    return true
  }
  async dispose(): Promise<void> {
    this.controller.abort(new DOMException('Plugin unloaded', 'AbortError'))
    await Promise.allSettled([...this.pending.values()])
  }
}
