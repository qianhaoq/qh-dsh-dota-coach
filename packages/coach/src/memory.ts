import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { HostLlmCompleteInput, HostLlmCompletion } from '@memtensor/memos-local-plugin'
import { CoachError, failure } from './errors.ts'
import type { CoachConfig } from './config.ts'
import type { RecordValue } from './types.ts'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dota-coach-memory': { kind: 'dota-coach-memory'; form: 'notice' }
  }
}
interface ModelRoute {
  provider: string
  model: string
}
interface Waiter {
  resolve: (value: RecordValue) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}
/** Public MemOS API lives behind a worker and an operation-bound DSH model route. */
export class KnowledgeMemory {
  private worker: Worker
  private sequence = 0
  private waiters = new Map<number, Waiter>()
  private modelWork = new Set<Promise<void>>()
  private stopping = false
  private llmCalls = new Map<number, AbortController>()
  private ready: Promise<void>
  private stopped = false
  constructor(
    private ctx: Context,
    home: string,
    private cfg: CoachConfig,
  ) {
    this.worker = new Worker(new URL('./memory-worker.js', import.meta.url), {
      workerData: {
        home,
        embeddingModel: cfg.memoryEmbeddingModel,
        offline: cfg.memoryOffline,
        modelPath: cfg.memoryModelPath,
      },
      stdout: true,
      stderr: true,
      execArgv: [],
    })
    // Worker diagnostics stay in the host logger and contain no configured credential.
    this.worker.stdout?.resume()
    this.worker.stderr?.on('data', (b: Buffer) => ctx.logger.warn(b.toString().slice(-2000)))
    this.ready = new Promise((resolve, reject) => {
      const ready = (m: { type: string }) => {
        if (m.type === 'ready') {
          this.worker.off('message', ready)
          resolve()
        }
      }
      this.worker.on('message', ready)
      this.worker.once('error', reject)
      this.worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`Memory worker exit ${code}`))
      })
    })
    this.worker.on(
      'message',
      (m: {
        type: string
        id: number
        operation: number
        input: HostLlmCompleteInput
        modelRoute?: ModelRoute
        value: RecordValue
        error?: RecordValue
      }) => {
        if (m.type === 'llm') {
          const operation = this.complete(m.id, m.modelRoute, m.input)
          this.modelWork.add(operation)
          void operation.finally(() => this.modelWork.delete(operation))
          return
        }
        if (m.type === 'llm_cancel') {
          this.llmCalls.get(m.id)?.abort()
          return
        }
        if (m.type !== 'result') return
        const w = this.waiters.get(m.id)
        if (!w) return
        this.waiters.delete(m.id)
        clearTimeout(w.timer)
        if (m.error)
          w.reject(
            new CoachError('memory_error', String(m.error.detail || 'Memory operation failed')),
          )
        else w.resolve(m.value)
      },
    )
    this.worker.on('error', (e) => this.rejectPending(e))
    this.worker.on('exit', (code) => {
      this.stopped = true
      this.rejectPending(new Error(`Memory worker stopped (${code})`))
    })
  }
  private rejectPending(e: Error): void {
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer)
      w.reject(e)
    }
    this.waiters.clear()
  }
  async request(
    method: string,
    args: RecordValue = {},
    exec?: ToolRunContext,
    signal?: AbortSignal,
  ): Promise<RecordValue> {
    if (this.stopped) throw new CoachError('memory_unavailable', 'Memory worker stopped')
    await this.ready
    signal?.throwIfAborted()
    const id = ++this.sequence
    const agent = exec?.agent,
      modelRoute =
        agent?.options.model && agent.options.provider
          ? { provider: agent.options.provider, model: agent.options.model }
          : undefined
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.worker.postMessage({ type: 'cancel', id })
        const w = this.waiters.get(id)
        if (w) {
          clearTimeout(w.timer)
          this.waiters.delete(id)
          reject(signal?.reason)
        }
      }
      const timer = setTimeout(
        () => {
          this.waiters.delete(id)
          this.worker.postMessage({ type: 'cancel', id })
          signal?.removeEventListener('abort', abort)
          reject(new CoachError('memory_timeout', 'Memory operation timed out'))
        },
        method === 'search' ? this.cfg.memorySearchTimeoutMs : 120000,
      )
      this.waiters.set(id, {
        resolve: (v) => {
          signal?.removeEventListener('abort', abort)
          resolve(v)
        },
        reject: (e) => {
          signal?.removeEventListener('abort', abort)
          reject(e)
        },
        timer,
      })
      signal?.addEventListener('abort', abort, { once: true })
      this.worker.postMessage({ type: 'request', id, method, args, modelRoute })
    })
  }
  private async complete(
    id: number,
    route: ModelRoute | undefined,
    input: HostLlmCompleteInput,
  ): Promise<void> {
    const controller = new AbortController()
    this.llmCalls.set(id, controller)
    try {
      if (this.stopping) throw new CoachError('memory_unloaded', 'Memory is unloading')
      if (!route)
        throw new CoachError('model_route_missing', 'Run memory learning from a DSH conversation')
      const llm = this.ctx.get('llm')
      if (!llm) throw new CoachError('model_unavailable', 'DSH LLM service is unavailable')
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(input.timeoutMs || 45000),
      ])
      const info = await llm.resolveModelInfo(route.provider, route.model, signal)
      const off = info.reasoning?.efforts.find((e) => e.id === 'off')
      const prepared = await llm.prepareCall(
        {
          ...route,
          ...(off ? { reasoningEffort: off.id } : {}),
          maxTokens: input.maxTokens || 1024,
          temperature: input.temperature ?? 0,
        },
        signal,
      )
      const source = { kind: 'dota-coach-memory' as const, form: 'notice' as const }
      const messages = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) =>
          m.role === 'assistant'
            ? createAssistantMessage({
                content: [{ type: 'text', text: m.content }],
                source: { provider: route.provider, model: route.model },
              })
            : createUserMessage({ content: [{ type: 'text', text: m.content }], source }),
        )
      const assembler = new BlockAssembler(),
        start = Date.now()
      for await (const chunk of prepared.stream({
        ...prepared.config,
        messages,
        system: input.messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n'),
        signal,
      }))
        assembler.push(chunk)
      if (assembler.finish.kind !== 'stop')
        throw new CoachError('memory_model_output', 'Memory model response was incomplete')
      const text = assembler
        .blocks()
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
      if (!text.trim()) throw new CoachError('memory_model_output', 'Memory model returned no text')
      const value: HostLlmCompletion = { text, model: route.model, durationMs: Date.now() - start }
      this.worker.postMessage({ type: 'llm_result', id, value })
    } catch (error) {
      this.worker.postMessage({ type: 'llm_result', id, error: String(failure(error).detail) })
    } finally {
      this.llmCalls.delete(id)
    }
  }
  async dispose(): Promise<void> {
    this.stopping = true
    for (const c of this.llmCalls.values()) c.abort()
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.request('shutdown'),
        new Promise<void>((resolve) => {
          shutdownTimer = setTimeout(resolve, 10000)
        }),
      ])
    } finally {
      if (shutdownTimer) clearTimeout(shutdownTimer)
      this.stopped = true
      await Promise.allSettled([...this.modelWork])
      await this.worker.terminate()
      this.rejectPending(new Error('Memory unloaded'))
    }
  }
}
