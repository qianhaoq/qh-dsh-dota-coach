import type { Context } from '@deepseek-ai/cordis'
/** Deterministic host model for domain/UI acceptance. Never enabled in the plugin. */
export function fixtureModel(
  ctx: Context,
  inspect?: (system: string, input: Record<string, any>) => void,
) {
  ctx.provide(
    'agentDefaultModel' as never,
    { currentSelection: () => ({ provider: 'fixture', model: 'coach-fixture' }) } as never,
  )
  ctx.provide('llm', {
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }] } }),
    prepareCall: async (config: unknown) => ({
      config,
      stream: async function* (request: {
        system: string
        messages: Array<{ content: Array<{ text: string }> }>
      }) {
        const input = JSON.parse(request.messages[0].content[0].text)
        inspect?.(request.system, input)
        const en = input.locale === 'en'
        const ui = (surfaceId: string, decisions: any[]) => ({
          version: 'v0.9.1',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'Row',
                children: decisions.map((_: any, i: number) => `card-${i}`),
              },
              ...decisions.map((d: any, i: number) => ({
                id: `card-${i}`,
                component: i === 0 ? 'ReplayClip' : 'DecisionCard',
                decisionId: d.id,
              })),
            ],
          },
        })
        const value =
          input.kind === 'review_presentation'
            ? { surfaces: input.stages.map((s: any) => ui(s.surfaceId, s.decisions)) }
            : input.kind === 'review_discussion'
              ? {
                  ...(input.stages.flatMap((s: any) => s.decisions).length
                    ? {
                        ui: ui(
                          input.a2ui.surfaceId,
                          input.stages.flatMap((s: any) => s.decisions).slice(0, 1),
                        ),
                      }
                    : {}),
                  answer: en
                    ? 'Compare the recorded decision-time resources with the alternatives. Preserve a safe exit, and treat the later outcome as evidence rather than proof of intention.'
                    : '先核对这段录像在决策起点的血蓝、冷却和控制状态，再比较能执行的替代路线。保留可撤出的路径；之后发生的结果不能反过来证明当时的意图。',
                  citations: input.evidence.slice(0, 1).map((e: any) => e.id),
                }
              : input.kind === 'stage_report'
                ? {
                    ui: ui(input.a2ui.surfaceId, input.stage.decisions),
                    summary: en
                      ? 'Review allied availability and resource timing before committing. Compare the recorded actions with the risk you prefer to take.'
                      : '这一阶段先围绕兵线、自己的资源和队友能否接应做判断。不要只用最后的生死评价决策：把行动前可确认的信息与行动后的结果分开，再结合你偏好的风险水平，决定下一次是主动推进还是先稳住资源。',
                    decisions: input.stage.decisions.map((d: any) => ({
                      id: d.id,
                      recommendation: en
                        ? 'If allies can respond, check your health and available resources, then choose a route with a safe exit. If support is unavailable, clear the nearby wave first and reassess.'
                        : '如果队友能够及时接应，先确认自己的血量与可用资源，再选择保留退路的行动；若队友暂时无法配合，则先处理附近安全的兵线，等信息更新后再决定是否接团。',
                      tradeoff: en
                        ? 'Continuing can preserve pressure but increases exposure. Waiting may give up tempo while keeping resources for the next opportunity.'
                        : '继续行动可能维持地图压力，也会提高暴露风险；等待可能让出一部分节奏，但能保留下一次机会所需的状态。记录的结果不足以证明哪条路线一定获胜。',
                      uncertainty: en
                        ? 'Enemy vision and your attention are unknown.'
                        : '敌方实际视野和你的注意力没有完整记录，不能据此断言当时应该看见谁。',
                      evidence_ids: d.evidence_ids,
                      ready_uses: [],
                      conditional_uses: [],
                    })),
                    goal: {
                      title: en ? 'Check allies before committing' : '行动前确认队友',
                      trigger: en ? 'Before committing' : '准备推进、接团或过河之前',
                      action: en
                        ? 'Confirm ally support and a safe exit.'
                        : '确认队友能否接应，同时保留一条退路。',
                      check: en
                        ? 'Review five games, excluding those without an opportunity.'
                        : '接下来五局检查，有相关机会才记录，无机会不算失败。',
                      basis: 'user_report',
                    },
                  }
                : input.player_report
                  ? {
                      observation: en
                        ? 'The match event is recorded. It does not establish why the decision was made.'
                        : '比赛记录确认了这一事件，但没有说明你当时为什么这样选择。',
                      reasoning: en
                        ? 'Your intention matters. Compare the available information and the cost of waiting before judging the outcome.'
                        : '先把你的意图放回局面：队友是否能跟上、等待的代价是什么，都比单看结果更重要。',
                      alternative: en
                        ? 'Before committing, check allied positions and choose whether to wait or keep your route.'
                        : '下次行动前，先确认队友的位置，再决定等队友还是继续原来的路线。',
                      uncertainty: en
                        ? 'Enemy visibility and player attention remain unknown where the replay has no observation.'
                        : '没有观测到的敌方视野和你的注意力仍然未知，不能把这次事件直接认定为失误。',
                      evidence_ids: [input.postmatch_evidence[0].id],
                      goal: {
                        title: en ? 'Check allies before committing' : '行动前确认队友',
                        trigger: en ? 'Before committing to a move' : '准备推进、接团或过河之前',
                        action: en
                          ? 'Check where allies can help before choosing your route.'
                          : '先看队友能否及时跟上，再选择路线。',
                        check: en
                          ? 'Review five games. Log only games with an opportunity; no opportunity is not a failure.'
                          : '接下来五局回看关键行动，有相关机会才检查，并记录一次自己的判断。',
                        basis: 'user_report',
                      },
                    }
                  : {
                      question: en
                        ? 'What were you trying to achieve at this moment?'
                        : '这一刻，你最想优先完成什么？',
                      choices: ['resources', 'support', 'information'],
                    }
        yield { type: 'text-delta', index: 0, text: JSON.stringify(value) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  } as never)
}
