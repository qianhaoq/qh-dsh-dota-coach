import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import remoteInfo from '../../lib/typert.remote-client.js'
import { Panel } from './Panel.tsx'
import { ToolCard, NavIcon } from './Card.tsx'
import { zh, en, type Key } from './locales.ts'
import type { Selection, PanelInjected } from './api.ts'
import { toolNames } from '../types.ts'
import styles from './style.css'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dotaCoach: Key
  }
}
export const inject = [
  'slots',
  'locale',
  'remote',
  'layout',
  'uiWorkspace',
  'sessions',
  'conversation',
]
const panelId = 'dota-coach' as MainPanelId
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(remoteInfo)
  ctx.effect(() => unmount)
  ctx.effect(() => ctx.locale.register('dotaCoach', { zh, en }))
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dota-coach'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => tag.remove()
  })
  ctx.inject(['remote.dotaCoach'], (scope) => {
    const remote = scope.remote.dotaCoach,
      t = scope.locale.bind('dotaCoach')
    const selection = createSnapshotStore<Selection>({ matchId: null, revision: 0 })
    const select = (id: number, sessionId?: string) => {
      if (!Number.isSafeInteger(id) || id <= 0) return
      selection.set({
        matchId: id,
        revision: selection.getSnapshot().revision + 1,
        ...(sessionId ? { sessionId } : {}),
      })
      scope.layout.selectPanel(panelId)
    }
    const injected: PanelInjected = {
      hooks: { selection },
      call: async (tool, args) => {
        const result = await remote.invoke({ tool, args })
        if (!result.ok) throw new Error(result.error.message)
        return result.value.data
      },
      settings: async (accountId) => {
        const result = await remote.settings(accountId === undefined ? {} : { accountId })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      jobs: async () => {
        const result = await remote.jobs()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      cancel: async (id) => {
        const result = await remote.cancel({ id })
        if (!result.ok) throw new Error(result.error.message)
      },
      select: (id) => select(id, selection.getSnapshot().sessionId),
      draft: async (text) => {
        const sessionId = selection.getSnapshot().sessionId as SessionId | undefined
        if (sessionId) {
          const binding = scope.sessions.binding(sessionId)
          if (binding) {
            const result = scope.conversation.input.requestDraftInitialization(binding, {
              prompt: text,
              whenDraftExists: 'append',
            })
            if (result === 'blocked') throw new Error('Draft is busy')
            scope.uiWorkspace.openSession(sessionId)
            return
          }
        }
        scope.uiWorkspace.startSession(undefined, { prompt: text, whenDraftExists: 'append' })
      },
    }
    scope.slots.inject('main', () =>
      scope.slots.register(
        { name: 'main', key: panelId, locale: 'dotaCoach', inject: () => injected },
        Panel,
      ),
    )
    scope.slots.inject('sidebar.panellist', () =>
      scope.slots.register(
        {
          name: 'sidebar.panellist',
          id: panelId,
          order: 20,
          locale: 'dotaCoach',
          label: () => t('title'),
        },
        NavIcon,
      ),
    )
    for (const tool of toolNames)
      scope.slots.inject('tool.call.toolview', () =>
        scope.slots.register(
          {
            name: 'tool.call.toolview',
            key: tool,
            locale: 'dotaCoach',
            inject: (sessionId: string) => ({ open: (id: number) => select(id, sessionId) }),
          },
          ToolCard,
        ),
      )
  })
}
