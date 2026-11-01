/** MemOS executes in its own worker: no shared host bridge singleton, native DB or model state. */
import { parentPort, workerData } from 'node:worker_threads'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  bootstrapMemoryCore,
  resolveConfig,
  type HostLlmCompletion,
  type HostLlmCompleteInput,
} from '@memtensor/memos-local-plugin'
import type { RecordValue } from './types.ts'
import { failure } from './errors.ts'
const port = parentPort!
const options = workerData as {
  home: string
  embeddingModel: string
  offline: boolean
  modelPath: string
}
const root = options.home
const namespace = { agentKind: 'dsh-dota-coach', profileId: 'dota-coach' }
const route = new AsyncLocalStorage<{
  id: number
  modelRoute?: { provider: string; model: string }
}>()
let seq = 0
const llmWaiters = new Map<
  number,
  {
    resolve: (v: HostLlmCompletion) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
const config = resolveConfig({
  telemetry: { enabled: false },
  hub: { enabled: false },
  viewer: { enabled: false },
  llm: { provider: 'host', fallbackToHost: false, maxRetries: 0 },
  embedding: {
    provider: 'local',
    model: options.embeddingModel,
    local: {
      offline: options.offline,
      modelPath: options.modelPath,
      cacheDir: join(root, 'models'),
    },
  },
  algorithm: {
    lightweightMemory: { enabled: false },
    retrieval: { llmFilterEnabled: false, includeLowValue: true },
    capture: { embedTraces: true },
    l2Induction: { minEpisodesForInduction: 3 },
    l3Abstraction: { minPolicies: 3, minPolicySupport: 3 },
    skill: { minSupport: 3, candidateTrials: 3 },
  },
  logging: { console: { enabled: false } },
})
const core = await bootstrapMemoryCore({
  agent: 'dsh-dota-coach',
  namespace,
  autoRecovery: false,
  pkgVersion: '2.0.21',
  config,
  home: {
    root,
    configFile: join(root, 'config.yaml'),
    dataDir: join(root, 'data'),
    dbFile: join(root, 'data/memos.db'),
    skillsDir: join(root, 'skills'),
    logsDir: join(root, 'logs'),
    daemonDir: join(root, 'daemon'),
  },
  hostLlmBridge: {
    id: 'dota-coach.dsh',
    complete(input: HostLlmCompleteInput) {
      const operation = route.getStore()
      if (!operation?.modelRoute) return Promise.reject(new Error('No owning DSH model route'))
      const id = ++seq
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          llmWaiters.delete(id)
          port.postMessage({ type: 'llm_cancel', id })
          reject(new Error('Memory model call timed out'))
        }, input.timeoutMs || 45000)
        llmWaiters.set(id, { resolve, reject, timer })
        const { signal, ...request } = input
        port.postMessage({
          type: 'llm',
          id,
          operation: operation.id,
          modelRoute: operation.modelRoute,
          input: request,
        })
      })
    },
  },
})
// Health reads the persisted configuration; this worker owns it through DSH.
await core.patchConfig({ ...config })
await core.init()
const controllers = new Map<number, AbortController>()
port.on(
  'message',
  async (message: {
    type: string
    id: number
    operation?: number
    method?: string
    args?: RecordValue
    modelRoute?: { provider: string; model: string }
    value?: HostLlmCompletion
    error?: string
  }) => {
    if (message.type === 'llm_result') {
      const p = llmWaiters.get(message.id)
      if (!p) return
      clearTimeout(p.timer)
      llmWaiters.delete(message.id)
      if (message.error) p.reject(new Error(message.error))
      else p.resolve(message.value!)
      return
    }
    if (message.type === 'cancel') {
      controllers.get(message.id)?.abort(new DOMException('Cancelled', 'AbortError'))
      return
    }
    const controller = new AbortController()
    controllers.set(message.id, controller)
    try {
      const value = await route.run(
        { id: message.id, modelRoute: message.modelRoute },
        async (): Promise<unknown> => {
          const a = message.args || {}
          if (message.method === 'health') return core.health()
          if (message.method === 'project') {
            const r = a.record as RecordValue,
              recordId = String(r.id),
              body = String(r.body || r.learner_explanation || r.title || '')
            const content = JSON.stringify(r),
              hash = createHash('sha256').update(content).digest('hex'),
              id = `dota:${recordId}:${hash.slice(0, 16)}`
            const chunks: string[] = []
            const rawBody = String(r.body || content)
            for (let start = 0; start < rawBody.length; start += 1200)
              chunks.push(rawBody.slice(Math.max(0, start - 150), start + 1200))
            const traces = chunks.map((chunk, index) => ({
              id: `${id}:chunk:${index}`,
              episodeId: `record:${recordId}`,
              sessionId: 'dota-records',
              ts: Date.parse(String(r.created_at)) || Date.now(),
              userText: String(r.title || 'Dota evidence'),
              agentText: `Record: ${recordId} · Kind: ${r.kind} · Source: ${r.source_id || 'review'} · Locator: ${r.locator || 'record'} · Chunk: ${index} · Patch: ${r.patch || 'unknown'}\n${chunk}`,
              summary: chunk.slice(0, 500),
              tags: [
                'dota',
                `record:${recordId}`,
                String(r.kind),
                String(r.hero || ''),
                String(r.patch || 'unknown'),
              ].filter(Boolean),
              toolCalls: [],
              value: 0,
              alpha: 0,
              priority: 0.1,
              ownerAgentKind: namespace.agentKind,
              ownerProfileId: namespace.profileId,
            }))
            const result = await core.importBundle(
              { traces },
              { ownership: 'target', targetProfileId: namespace.profileId },
            )
            if (a.previous && a.previous !== id) {
              const old = await core.listTraces({ limit: 10000 })
              for (const trace of old)
                if (trace.id.startsWith(String(a.previous) + ':chunk:'))
                  await core.deleteTrace(trace.id)
            }
            if (result.invalid || result.failed) throw new Error(JSON.stringify(result.issues))
            return { id, record_id: recordId, result }
          }
          if (message.method === 'search')
            return core.searchMemory(
              {
                agent: namespace.agentKind,
                namespace,
                query: String(a.query),
                reason: 'tool_driven',
                deadlineAt: Date.now() + Number(a.timeout_ms || 3000),
                topK: { tier1: 3, tier2: Math.min(30, Number(a.limit) || 10), tier3: 3 },
              },
              { signal: controller.signal, foreground: true },
            )
          if (message.method === 'get') {
            const id = String(a.id)
            if (a.kind === 'skill')
              return core.getSkill(id, { namespace, recordUse: false, recordTrial: false })
            if (a.kind === 'policy') return core.getPolicy(id, namespace)
            if (a.kind === 'world-model') return core.getWorldModel(id, namespace)
            if (a.kind === 'episode') {
              const traces = (
                await core.listTraces({ limit: 10000, ownerProfileId: namespace.profileId })
              ).filter((t) => t.episodeId === id)
              return { episode_id: id, traces }
            }
            return core.getTrace(id, namespace)
          }
          if (message.method === 'rebuild')
            return core.rebuildEmbeddings({
              mode: 'repair',
              limit: 20,
              offset: Number(a.offset) || 0,
            })
          if (message.method === 'learn') {
            const r = a.record as RecordValue,
              sessionId = `review:${r.id}`
            const prior = await core.listTraces({ sessionId, limit: 1 })
            if (prior.length)
              return { traceId: prior[0]!.id, episodeId: prior[0]!.episodeId, deduplicated: true }
            await core.openSession({ agent: namespace.agentKind, sessionId, namespace })
            const episodeId = await core.openEpisode({
              sessionId,
              episodeId: `learn:${r.id}`,
              userMessage: String(r.learner_explanation || r.title || 'Dota review'),
            })
            const result = await core.onTurnEnd({
              agent: namespace.agentKind,
              sessionId,
              episodeId,
              namespace,
              agentText: JSON.stringify(r),
              toolCalls: [],
              ts: Date.now(),
              contextHints: {
                record_id: r.id,
                evidence_ids: r.evidence_ids,
                training_is_user_report: true,
              },
            })
            await core.closeEpisode(episodeId)
            return result
          }
          if (message.method === 'feedback')
            return core.submitFeedback({
              traceId: String(a.trace_id),
              channel: 'explicit',
              polarity: a.positive === true ? 'positive' : 'negative',
              magnitude: 1,
              rationale: String(a.body || ''),
              raw: { basis: 'user_report', record_id: a.record_id },
            })
          if (message.method === 'shutdown') {
            await core.shutdown()
            return { closed: true }
          }
          throw new Error('Unknown memory operation')
        },
      )
      port.postMessage({ type: 'result', id: message.id, value })
      if (message.method === 'shutdown') port.close()
    } catch (error) {
      port.postMessage({ type: 'result', id: message.id, error: failure(error) })
    } finally {
      controllers.delete(message.id)
    }
  },
)
port.postMessage({ type: 'ready' })
