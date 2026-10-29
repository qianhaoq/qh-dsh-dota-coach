import type { RecordValue, ToolName, TaskView } from '../types.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
export interface Selection {
  matchId: number | null
  sessionId?: string
  revision: number
}
export interface PanelInjected {
  hooks: { selection: HostObservable<Selection> }
  call: (tool: ToolName, args: RecordValue) => Promise<RecordValue>
  settings: (accountId?: number) => Promise<{ accountId: number }>
  jobs: () => Promise<TaskView[]>
  cancel: (id: string) => Promise<void>
  select: (id: number) => void
  draft: (text: string) => Promise<void>
}
