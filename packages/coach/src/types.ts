/** JSON records shared by Host tools and the browser Remote. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type RecordValue = { [key: string]: Json }
export const toolNames = [
  'dota_coach',
  'dota_status',
  'dota_matches',
  'dota_match',
  'dota_timeline',
  'dota_hero',
  'dota_replay',
  'dota_parse',
  'dota_kb',
  'dota_coach_note',
  'dota_source',
  'dota_review',
  'dota_training',
  'dota_memory',
] as const
export type ToolName = (typeof toolNames)[number]
export interface CoachRequest {
  tool: ToolName
  args: RecordValue
}
export interface CoachReply {
  ok: boolean
  data: RecordValue
}
export interface TaskView {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  result?: RecordValue
}
