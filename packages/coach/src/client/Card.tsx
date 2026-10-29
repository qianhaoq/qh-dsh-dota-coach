import type { PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
export interface CardInjected {
  open: (id: number) => void
}
export function ToolCard(
  p: ToolCallViewProps & InjectFace<CardInjected> & PropsLocale<'dotaCoach'>,
) {
  const block = p.block,
    head = 'kind' in block ? block.call : block
  let id: number | null = null
  try {
    if (head && 'argsRaw' in head) {
      const args: unknown = JSON.parse(head.argsRaw)
      if (
        args &&
        typeof args === 'object' &&
        'match_id' in args &&
        Number.isSafeInteger(Number(args.match_id))
      )
        id = Number(args.match_id)
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const content = 'content' in block ? block.content : []
  return (
    <div className="dota-tool-card">
      <strong>{p.toolName}</strong>
      {id !== null && (
        <button onClick={() => p.open(id!)}>
          #{id} · {p.t('open')}
        </button>
      )}
      <details>
        <summary>{p.t('details')}</summary>
        <pre>
          {content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') ||
            ('argsRaw' in (head || {})
              ? String(head && 'argsRaw' in head ? head.argsRaw : '')
              : '')}
        </pre>
      </details>
    </div>
  )
}
export function NavIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m4 4 16 16M4 20 20 4M6 2H2v4m16 16h4v-4M2 18v4h4M22 6V2h-4"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  )
}
