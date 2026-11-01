import type { ReviewSession } from './coaching-types.ts'
import type { CoachModel, ModelRoute } from './model.ts'
import { UI_CATALOG, validateUi, type UiPatch } from './a2ui.ts'
export async function composePresentation(
  s: ReviewSession,
  model: CoachModel,
  route: ModelRoute,
  signal: AbortSignal,
) {
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await model.complete(
      route,
      `Compose UI only from this verified report. Do not reanalyze or rewrite the advice. Return exactly {"surfaces":[...]} with one A2UI message for every supplied stage. Each message has version:"v0.9.1" and updateComponents:{surfaceId,components}. Use each supplied surfaceId exactly. In each stage, create a Row with id:"root" and children listing leaf IDs. Include exactly one leaf per decision: choose ReplayClip for reviewing the scene, DecisionCard for comparing choices, or ResourceSnapshot for checking resources. Each leaf has ONLY id,component,decisionId. Use exact supplied decisionId; no added prose, data, URLs or other keys. Vary component types to fit the advice and put the most useful moment first. Example single-stage response: {"surfaces":[{"version":"v0.9.1","updateComponents":{"surfaceId":"stage-0","components":[{"id":"root","component":"Row","children":["clip"]},{"id":"clip","component":"ReplayClip","decisionId":"stage-0-0"}]}}]}. Return all stages; replace the example IDs with supplied IDs.`,
      {
        kind: 'review_presentation',
        a2ui: UI_CATALOG,
        validation_error: feedback || null,
        stages: s.report!.stages.map((stage) => ({
          surfaceId: stage.id,
          title: stage.title,
          decisions: stage.decisions.map((d) => ({
            id: d.id,
            kind: d.kind,
            recommendation: d.recommendation,
          })),
        })),
      },
      signal,
      4000,
    )
    try {
      const value = JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, ''),
      )
      if (!Array.isArray(value.surfaces))
        throw new Error('Return an array named surfaces, not ui or a single message.')
      return s.report!.stages.map((stage) => {
        const patch = validateUi(
          value.surfaces.find((p: UiPatch) => p?.updateComponents?.surfaceId === stage.id),
          {
            surfaceId: stage.id,
            decisions: stage.decisions,
            evidence: s.report!.evidence,
            requireCoverage: true,
          },
        )
        if (!patch)
          throw new Error(
            `Invalid composition for ${stage.id}: use a Row root, exactly one allowed leaf per supplied decision, version v0.9.1, and exact IDs with no extra keys.`,
          )
        return patch
      })
    } catch (e) {
      if (attempt === 1) throw e
      feedback = e instanceof Error ? e.message : 'Invalid A2UI response'
    }
  }
  throw new Error('Presentation could not be composed')
}
