import { Icon } from './Icons.tsx'
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
      <strong>
        <Icon name="mark" size={17} />{' '}
        {(
          {
            dota_coach: p.t('title'),
            dota_matches: 'Dota 2 · Matches',
            dota_replay: 'Dota 2 · Replay',
            dota_memory: 'Dota 2 · Memory',
            dota_parse: 'Dota 2 · Analysis',
          } as Record<string, string>
        )[p.toolName] || p.toolName.replace(/^dota_/, 'Dota 2 · ')}
      </strong>
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
  return <Icon name="mark" size={size} />
}
