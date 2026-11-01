import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { CoachError } from './errors.ts'
export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}
export interface CoachMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
/** Shared model bridge for coaching and memory; the host owns credentials and adapters. */
export class CoachModel {
  constructor(private ctx: Context) {}
  route(owning?: ModelRoute): ModelRoute {
    if (owning?.provider && owning.model) return { ...owning }
    const defaults = this.ctx.get('agentDefaultModel' as never) as
      | { currentSelection?: () => ModelRoute }
      | undefined
    const route = defaults?.currentSelection?.()
    if (!route?.provider || !route.model)
      throw new CoachError(
        'model_route_missing',
        '请先在 DSH 中配置默认模型 / Configure the DSH default model',
      )
    return route
  }
  complete(
    route: ModelRoute,
    system: string,
    input: unknown,
    signal: AbortSignal,
    maxTokens = 2200,
  ): Promise<string> {
    return this.messages(
      route,
      [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
      signal,
      { maxTokens, temperature: 0.2, timeoutMs: 90000 },
    )
  }
  async messages(
    route: ModelRoute,
    input: CoachMessage[],
    signal: AbortSignal,
    options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
  ): Promise<string> {
    const llm = this.ctx.get('llm')
    if (!llm) throw new CoachError('model_unavailable', 'DSH model service is unavailable')
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs || 90000)])
    const info = await llm.resolveModelInfo(route.provider, route.model, bounded)
    const off = info.reasoning?.efforts.find((e) => e.id === 'off')
    const prepared = await llm.prepareCall(
      {
        provider: route.provider,
        model: route.model,
        ...(off ? { reasoningEffort: off.id } : {}),
        maxTokens: options.maxTokens || 2200,
        temperature: options.temperature ?? 0,
      },
      bounded,
    )
    const assembler = new BlockAssembler()
    const messages = input
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.role === 'assistant'
          ? createAssistantMessage({
              content: [{ type: 'text', text: m.content }],
              source: { provider: route.provider, model: route.model },
            })
          : createUserMessage({
              content: [{ type: 'text', text: m.content }],
              source: { kind: 'dota-coach-memory', form: 'notice' },
            }),
      )
    for await (const chunk of prepared.stream({
      ...prepared.config,
      system: input
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
      messages,
      signal: bounded,
    }))
      assembler.push(chunk)
    if (assembler.finish.kind !== 'stop')
      throw new CoachError(
        'model_output_incomplete',
        '教练回答未完成，请重试 / Coach response was incomplete',
      )
    const text = assembler
      .blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text.trim()) throw new CoachError('model_output_empty', 'Coach returned no text')
    return text
  }
}
