import { z } from 'zod'
import type { CoachEvidence, ReportDecision } from './coaching-types.ts'

// Pinned A2UI v0.9.1 envelope; a deliberately small, application-owned catalog.
export const CATALOG = 'github.com/qianhaoq/qh-dsh-dota-coach:review-v1'
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const leaf = { id, decisionId: id }
export const componentSchema = z.discriminatedUnion('component', [
  z
    .object({ id, component: z.enum(['Column', 'Row']), children: z.array(id).min(1).max(8) })
    .strict(),
  z.object({ ...leaf, component: z.literal('DecisionCard') }).strict(),
  z.object({ ...leaf, component: z.literal('ReplayClip') }).strict(),
  z.object({ ...leaf, component: z.literal('ResourceSnapshot') }).strict(),
  z
    .object({
      id,
      component: z.literal('EvidenceList'),
      evidenceIds: z.array(z.string().max(100)).min(1).max(5),
    })
    .strict(),
  z.object({ id, component: z.literal('MatchOverview') }).strict(),
])
export const patchSchema = z
  .object({
    version: z.literal('v0.9.1'),
    updateComponents: z
      .object({ surfaceId: id, components: z.array(componentSchema).min(2).max(14) })
      .strict(),
  })
  .strict()
export type UiComponent = z.infer<typeof componentSchema>
export type UiPatch = z.infer<typeof patchSchema>
export type UiMessage =
  | UiPatch
  | { version: 'v0.9.1'; createSurface: { surfaceId: string; catalogId: string } }
  | { version: 'v0.9.1'; updateDataModel: { surfaceId: string; path?: string; value?: unknown } }
  | { version: 'v0.9.1'; deleteSurface: { surfaceId: string } }
export interface UiAction {
  version: 'v0.9.1'
  action: {
    surfaceId: string
    sourceComponentId: string
    timestamp: string
    name: 'open_replay' | 'open_analysis' | 'open_evidence' | 'open_match' | 'ask_coach'
    context: { decisionId?: string; evidenceId?: string }
  }
}
export interface UiSurface {
  surfaceId: string
  components: Map<string, UiComponent>
  data: unknown
}
type References = {
  decisions: ReportDecision[]
  evidence: CoachEvidence[]
  surfaceId: string
  requireCoverage?: boolean
}
/** Cosmetic generation never invalidates verified coaching. Only known records may be referenced. */
export function validateUi(value: unknown, refs: References): UiPatch | undefined {
  const parsed = patchSchema.safeParse(value)
  if (!parsed.success) return
  const patch = parsed.data,
    { components, surfaceId } = patch.updateComponents
  if (surfaceId !== refs.surfaceId) return
  const index = new Map(components.map((c) => [c.id, c]))
  if (index.size !== components.length || !index.has('root')) return
  const visited = new Set<string>(),
    stack = new Set<string>(),
    decisions = new Set<string>()
  const visit = (key: string, depth = 0): boolean => {
    const c = index.get(key)
    if (!c || depth > 4 || stack.has(key) || visited.has(key)) return false
    visited.add(key)
    stack.add(key)
    if ('children' in c) {
      if (!c.children.every((k) => visit(k, depth + 1))) return false
    } else if ('decisionId' in c) {
      if (!refs.decisions.some((d) => d.id === c.decisionId)) return false
      decisions.add(c.decisionId)
    } else if (
      'evidenceIds' in c &&
      c.evidenceIds.some((k) => !refs.evidence.some((e) => e.id === k))
    )
      return false
    stack.delete(key)
    return true
  }
  if (!visit('root') || visited.size !== index.size) return
  if (refs.requireCoverage && refs.decisions.some((d) => !decisions.has(d.id))) return
  return patch
}
export function fallbackUi(surfaceId: string, decisions: ReportDecision[]): UiPatch {
  return {
    version: 'v0.9.1',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Row', children: decisions.map((_, i) => `moment-${i}`) },
        ...decisions.map(
          (d, i): UiComponent => ({
            id: `moment-${i}`,
            component: 'DecisionCard',
            decisionId: d.id,
          }),
        ),
      ],
    },
  }
}
export function surfaceMessages(patch: UiPatch, data: unknown): UiMessage[] {
  const surfaceId = patch.updateComponents.surfaceId
  return [
    { version: 'v0.9.1', createSurface: { surfaceId, catalogId: CATALOG } },
    { version: 'v0.9.1', updateDataModel: { surfaceId, path: '/', value: data } },
    patch,
  ]
}
/** Pure ordered message processor. No scripts, arbitrary HTML, URLs or network actions. */
export function reduceMessages(messages: UiMessage[]): Map<string, UiSurface> {
  const surfaces = new Map<string, UiSurface>()
  for (const m of messages) {
    if (m.version !== 'v0.9.1') throw new Error('Unsupported A2UI version')
    if ('createSurface' in m) {
      const p = m.createSurface
      if (p.catalogId !== CATALOG || surfaces.has(p.surfaceId))
        throw new Error('Invalid A2UI surface')
      surfaces.set(p.surfaceId, { surfaceId: p.surfaceId, components: new Map(), data: {} })
      continue
    }
    const p =
      'updateComponents' in m
        ? m.updateComponents
        : 'updateDataModel' in m
          ? m.updateDataModel
          : m.deleteSurface
    const s = surfaces.get(p.surfaceId)
    if (!s) throw new Error('A2UI surface has not been created')
    if ('deleteSurface' in m) surfaces.delete(p.surfaceId)
    else if ('updateComponents' in m)
      for (const c of m.updateComponents.components) s.components.set(c.id, c)
    else if ('updateDataModel' in m) {
      const update = m.updateDataModel
      if (!update.path || update.path === '/') s.data = structuredClone(update.value ?? {})
      else {
        if (!update.path.startsWith('/')) throw new Error('Invalid JSON Pointer')
        const keys = update.path
          .slice(1)
          .split('/')
          .map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'))
        if (keys.some((k) => ['__proto__', 'prototype', 'constructor'].includes(k)))
          throw new Error('Invalid data path')
        let target = s.data as Record<string, unknown>
        for (const k of keys.slice(0, -1)) {
          if (!target[k] || typeof target[k] !== 'object') target[k] = {}
          target = target[k] as Record<string, unknown>
        }
        const key = keys.at(-1)!
        if (Object.hasOwn(update, 'value')) target[key] = update.value
        else delete target[key]
      }
    }
  }
  return surfaces
}
/** Revalidate returned actions against the issuing component, not just a client-supplied ID. */
export function resolveUiAction(event: UiAction, patch: UiPatch, refs: References) {
  if (event.version !== 'v0.9.1' || event.action.surfaceId !== patch.updateComponents.surfaceId)
    return
  const { name, context, sourceComponentId } = event.action
  const c = patch.updateComponents.components.find((c) => c.id === sourceComponentId)
  if (!c || 'children' in c) return
  const allowed =
    c.component === 'MatchOverview'
      ? ['open_match']
      : c.component === 'EvidenceList'
        ? ['open_evidence']
        : ['open_replay', 'open_analysis', 'open_evidence', 'ask_coach']
  if (!allowed.includes(name)) return
  if (
    'decisionId' in c &&
    (context.decisionId !== c.decisionId || !refs.decisions.some((d) => d.id === c.decisionId))
  )
    return
  if ('evidenceIds' in c && (!context.evidenceId || !c.evidenceIds.includes(context.evidenceId)))
    return
  if (context.evidenceId && !refs.evidence.some((e) => e.id === context.evidenceId)) return
  return {
    name,
    decisionId: 'decisionId' in c ? c.decisionId : undefined,
    evidenceId: context.evidenceId,
  }
}
export const UI_PROMPT = `Also return ui, an A2UI v0.9.1 updateComponents message using the supplied a2ui catalog, surfaceId and record IDs. The root must be Column or Row with children referencing component IDs. Choose components and their order to answer this specific question: ReplayClip for a concrete time window, ResourceSnapshot for resource/castability questions, DecisionCard for comparing choices, EvidenceList for supporting records, MatchOverview for match details. Do not put prose or invented data in components: use only decisionId/evidenceIds bindings; trusted report data is supplied by the host. No HTML, code, URL or unsupported component. Up to 8 visible leaves. For a stage report, cover every supplied decision. Example ui: {"version":"v0.9.1","updateComponents":{"surfaceId":"SUPPLIED","components":[{"id":"root","component":"Row","children":["clip","state"]},{"id":"clip","component":"ReplayClip","decisionId":"SUPPLIED"},{"id":"state","component":"ResourceSnapshot","decisionId":"SUPPLIED"}]}}. Use relevant evidence IDs, never the example placeholders.`
export const UI_CATALOG = {
  catalogId: CATALOG,
  components: [
    'Column(children)',
    'Row(children)',
    'DecisionCard(decisionId)',
    'ReplayClip(decisionId)',
    'ResourceSnapshot(decisionId)',
    'EvidenceList(evidenceIds)',
    'MatchOverview()',
  ],
}
