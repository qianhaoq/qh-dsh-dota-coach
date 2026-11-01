import type { Context } from '@deepseek-ai/cordis'
import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { CoachError } from './errors.ts'

/** The batch API exposed by source builds after the published rc.3 SDK. */
interface BatchTools {
  setExecutor: unknown
  execute(input: {
    calls: Array<{
      type: 'tool-call'
      id: ToolExecutionInput['callId']
      name: string
      arguments: string
    }>
    signal: AbortSignal
    agent?: ToolRunContext['agent']
    toolSet?: unknown
  }): Promise<{
    results: Array<{ callId: ToolExecutionInput['callId']; result: ToolExecutionResult }>
    additionalContexts: NonNullable<ToolExecutionResult['additionalContexts']>
    concluded: boolean
  }>
}

function usesBatches(tools: unknown): tools is BatchTools {
  return (
    typeof tools === 'object' &&
    tools !== null &&
    'setExecutor' in tools &&
    typeof tools.setExecutor === 'function'
  )
}

/** Dispatch through the host executor, retaining its scope, admission and policy checks. */
export async function dispatchSourceTool(
  ctx: Context,
  input: ToolExecutionInput,
  owner: ToolRunContext,
): Promise<ToolExecutionResult> {
  const tools = ctx.tools
  if (!usesBatches(tools)) return tools.execute(input)
  const { toolSet } = owner as ToolRunContext & { toolSet?: unknown }
  const batch = await tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: input.callId,
        name: input.name,
        arguments: JSON.stringify(input.arguments),
      },
    ],
    signal: input.signal,
    agent: input.agent,
    ...(toolSet === undefined ? {} : { toolSet }),
  })
  const outcome = batch.results.find((entry) => entry.callId === input.callId)?.result
  if (!outcome)
    throw new CoachError('source_fetch_failed', 'Source executor returned no matching result')
  if (batch.concluded && !outcome.isError) owner.concludeTurn()
  return { ...outcome, additionalContexts: batch.additionalContexts }
}
