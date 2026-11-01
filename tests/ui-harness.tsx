import React, { useSyncExternalStore, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel as CoachPanel } from '../packages/coach/src/client/Panel.tsx'
import { GuidedPanel } from '../packages/coach/src/client/GuidedPanel.tsx'
import { LegacyPanel } from '../packages/coach/src/client/LegacyPanel.tsx'
const Panel = new URLSearchParams(location.search).has('legacy')
  ? LegacyPanel
  : new URLSearchParams(location.search).has('guided')
    ? GuidedPanel
    : CoachPanel
import { zh, en } from '../packages/coach/src/client/locales.ts'
import style from '../packages/coach/src/client/style.css'
import type { Selection } from '../packages/coach/src/client/api.ts'
const tag = document.createElement('style')
tag.textContent = style
document.head.appendChild(tag)
let selection: Selection = { matchId: null, revision: 0 }
const listeners = new Set<() => void>()
const update = (id: number) => {
  selection = { matchId: id, revision: selection.revision + 1 }
  for (const f of listeners) f()
}
const post = async (path: string, body: unknown) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await res.json()
  if (!res.ok) throw new Error(value.error)
  return value
}
const locale = new URLSearchParams(location.search).get('lang') === 'en' ? en : zh
function App() {
  const [draft, setDraft] = useState('')
  return (
    <>
      <Panel
        t={(key) => locale[key as keyof typeof locale]}
        useSelection={(selector) =>
          selector(
            useSyncExternalStore(
              (f) => {
                listeners.add(f)
                return () => listeners.delete(f)
              },
              () => selection,
            ),
          )
        }
        call={(tool, args) => post('/api/call', { tool, args })}
        settings={(accountId) => post('/api/settings', { accountId })}
        jobs={() => post('/api/jobs', {})}
        cancel={(id) => post('/api/cancel', { id })}
        select={update}
        draft={async (text) => setDraft(text)}
        {...{}}
      />
      {draft && (
        <aside aria-label="Conversation draft" data-testid="draft">
          {draft}
        </aside>
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
