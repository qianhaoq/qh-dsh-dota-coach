import type { RecordValue } from './types.ts'
import type { UiPatch } from './a2ui.ts'
/** Shared serializable contract: no host implementation or credentials cross this boundary. */
export interface PracticeGoal {
  title: string
  trigger: string
  action: string
  check: string
  basis: 'user_report' | 'replay'
  metric?: 'deaths_after_20'
}
export interface CoachEvidence {
  id: string
  label: string
  time: number
  source: 'opendota' | 'replay' | 'material'
  scope: 'team' | 'postmatch' | 'user'
  facts: string[]
}
export interface CoachMoment {
  id: string
  time: number
  from: number
  to: number
  kind: 'death' | 'fight' | 'item' | 'objective'
  title: string
  facts: CoachEvidence[]
  question?: string
  choices?: string[]
  choice_codes?: string[]
  pending_answer?: string
  answer?: string
  explanation?: {
    observation: string
    reasoning: string
    alternative: string
    uncertainty: string
    evidence_ids: string[]
    goal: PracticeGoal
  }
}
export interface CoachPlayer {
  slot: number
  account_id: number | null
  hero_id: number
  hero: string
  npc: string
  name: string
  team: number
  role: number
  role_inferred: boolean
}
export interface ReviewSession {
  id: string
  match_id: number
  account_id: number
  locale: 'zh' | 'en'
  role: number
  patch: string
  mode: string
  rank: string
  phase:
    | 'preparing'
    | 'question'
    | 'explanation'
    | 'practice'
    | 'complete'
    | 'failed'
    | 'cancelled'
    | 'report'
  stage: string
  revision: number
  created_at: string
  updated_at: string
  player?: CoachPlayer
  players: CoachPlayer[]
  moments: CoachMoment[]
  current: number
  warnings: string[]
  error?: string
  goal?: PracticeGoal
  review_id?: string
  training_id?: string
  followup?: { title: string; basis: string; summary: string }
  model?: string
  format?: 'report' | 'guided'
  preferences?: ReviewPreferences
  discussion?: CoachDiscussion[]
  presentation?: { status: 'pending' | 'ready' | 'failed'; surfaces?: UiPatch[] }
  report?: MatchReport
}

export interface ReviewPreferences {
  focus: Array<'laning' | 'farm' | 'fight' | 'items' | 'objectives' | 'support'>
  style: 'balanced' | 'tempo' | 'safe'
  detail: 'standard' | 'detailed'
  intention: string
}
export interface ReportDecision {
  decision_time?: number
  state?: RecordValue
  id: string
  time: number
  from: number
  to: number
  kind: string
  actual: string[]
  impact: string[]
  evidence_ids: string[]
  context: string
  recommendation?: string
  healing_sources?: string[]
  conditions?: string[]
  tradeoff?: string
  uncertainty?: string
}
export interface ReportStage {
  ui?: UiPatch
  id: string
  title: string
  from: number
  to: number
  status: 'pending' | 'ready' | 'failed'
  summary?: string
  error?: string
  diagnostic?: { code: string; detail: string }
  metrics: string[]
  decisions: ReportDecision[]
}
export interface MatchReport {
  version: 1 | 2 | 3 | 4
  duration: number
  preferences: ReviewPreferences
  stages: ReportStage[]
  evidence: CoachEvidence[]
  generated_at?: string
  goal?: PracticeGoal
}

export interface CoachDiscussion {
  ui?: UiPatch
  id: string
  question: string
  answer?: string
  brief?: { conclusion: string; steps: string[]; caveat?: string }
  citations?: string[]
  status: 'pending' | 'ready' | 'failed' | 'cancelled'
  stage_id?: string
  decision_id?: string
  extra_evidence?: CoachEvidence[]
  error?: string
  attempts: number
  created_at: string
}
