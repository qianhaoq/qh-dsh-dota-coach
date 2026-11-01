import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-skill'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Config, dataHome, type CoachConfig } from './config.ts'
import { CoachService } from './service.ts'
import { validateArgs } from '@deepseek-ai/dsh-tools'
import { CoachError } from './errors.ts'
import { toolSpecs } from './tools.ts'
import { makeTools } from './tools.ts'
import { toolNames, type CoachRequest, type CoachReply, type TaskView, type Json } from './types.ts'
export { Config }
export type { CoachRequest, CoachReply, TaskView }
export const name = 'dota-coach'
export const inject = ['tools', 'typert']
const pkg = fileURLToPath(new URL('..', import.meta.url))
const version: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
declare module '@deepseek-ai/cordis' {
  interface Context {
    dotaCoach: CoachRemote
  }
}
/** One domain service is shared by the conversation tools and browser Remote. */
export class CoachRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly coach: CoachService,
  ) {
    super(ctx, 'dotaCoach', { namespace: 'dotaCoach' })
  }
  @Remote
  async invoke(request: CoachRequest, signal: AbortSignal): Promise<CoachReply> {
    z.enum(toolNames).parse(request.tool)
    const violations = validateArgs(toolSpecs[request.tool].parameters, request.args)
    if (violations.length) throw new CoachError('invalid_arguments', violations.join('; '))
    const data = await this.coach.invoke(request.tool, request.args, signal)
    return { ok: data.ok === true, data }
  }
  @Remote
  async settings(request: { accountId?: number }): Promise<{ accountId: number }> {
    if (request.accountId !== undefined) {
      z.number().int().min(0).max(4294967295).parse(request.accountId)
      this.coach.store.setting('accountId', request.accountId)
    }
    return { accountId: Number(this.coach.store.setting('accountId') ?? this.coach.cfg.accountId) }
  }
  @Remote
  async jobs(): Promise<TaskView[]> {
    return this.coach.tasks.list()
  }
  @Remote
  async cancel(request: { id: string }): Promise<{ cancelled: boolean }> {
    return { cancelled: this.coach.tasks.cancel(request.id) }
  }
}
/** All effects and work are owned by this Cordis scope, including asynchronous teardown. */
export async function apply(ctx: Context, config: CoachConfig): Promise<void> {
  if (!config.enabled) return
  const service = new CoachService(ctx, config, dataHome(config), pkg, version)
  ctx.effect(() => () => service.dispose())
  if (service.memory) await service.memory.request('health')
  if (service.tasks.controller.signal.aborted) return
  new CoachRemote(ctx, service)
  for (const tool of makeTools((name, args, exec) => service.invokeTool(name, args, exec)))
    ctx.effect(() => ctx.tools.register(tool))
  if (config.skillEnabled)
    ctx.inject(['skills'], (scope) => {
      scope.effect(() =>
        scope.skills.register({
          name: 'dota2-coach',
          description:
            'Dota 2 post-match evidence review, study and one training goal; retrieve prior knowledge before advising.',
          whenToUse:
            'Dota 2 coaching, match review, learning from a video or checking the previous training goal.',
          source: 'runtime',
          resourceBase: { kind: 'directory', path: service.home },
          content: readFileSync(new URL('../skills/dota2-coach/SKILL.md', import.meta.url), 'utf8'),
        }),
      )
    })
}
