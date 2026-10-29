import {
  defineTool,
  type ParameterSchemaSpec,
  type ToolDefinition,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import type { RecordValue, ToolName } from './types.ts'
const string = { type: 'string' } as const,
  number = { type: 'number' } as const,
  strings = { type: 'array', items: string } as const
const enumeration = (...values: string[]) => ({ type: 'string' as const, enum: values })
const match_id = {
  type: 'integer',
  required: true,
  description: 'Positive OpenDota match ID',
} as const
const filter = { query: string, hero: string, patch: string, tag: string, limit: number }
export const toolSpecs: Record<ToolName, { description: string; parameters: ParameterSchemaSpec }> =
  {
    dota_memory: {
      description:
        'Search local MemOS knowledge and candidate experience, inspect records, repair embeddings, or learn from a grounded review using the owning DSH model. Generated patterns remain candidates.',
      parameters: {
        action: {
          ...enumeration('search', 'get', 'status', 'reindex', 'learn', 'feedback'),
          required: true,
        },
        query: string,
        id: string,
        kind: enumeration('trace', 'episode', 'policy', 'skill', 'world-model'),
        record_id: string,
        trace_id: string,
        positive: { type: 'boolean' },
        body: string,
        offset: number,
        limit: number,
      },
    },
    dota_status: {
      description:
        'Inspect local coach configuration, storage, extractor and source tools. No network.',
      parameters: {},
    },
    dota_matches: {
      description: 'List recent OpenDota matches. Filter by hero, result and age.',
      parameters: {
        account: string,
        limit: number,
        hero: string,
        result: enumeration('win', 'loss'),
        since_days: number,
      },
    },
    dota_match: {
      description: 'Read one match with source, capture time, missing fields and evidence ID.',
      parameters: {
        match_id,
        sections: {
          type: 'array',
          items: enumeration(
            'overview',
            'players',
            'draft',
            'items',
            'fights',
            'objectives',
            'curves',
            'wards',
          ),
        },
        account: string,
      },
    },
    dota_timeline: {
      description:
        'Read a bounded review window; positions are omitted when time calibration fails.',
      parameters: {
        match_id,
        from: string,
        to: string,
        teams: { type: 'array', items: enumeration('radiant', 'dire') },
        limit: number,
      },
    },
    dota_hero: {
      description:
        'Read dated public hero statistics. Popularity does not establish causal coaching advice.',
      parameters: { hero: { ...string, required: true } },
    },
    dota_replay: {
      description:
        'Fetch, inspect, list or delete local replays. Unavailable downloads do not imply a fixed retention period.',
      parameters: { action: enumeration('fetch', 'inspect', 'list', 'delete'), match_id: number },
    },
    dota_parse: {
      description:
        'Extract summary, positions, deaths or ward lifecycle events. Entity distance does not establish visibility or death cause.',
      parameters: {
        action: enumeration('summary', 'deaths', 'positions', 'wards'),
        match_id,
        heroes: strings,
        from: string,
        to: string,
        step: number,
      },
    },
    dota_source: {
      description:
        'Fetch through an installed source tool, or import readable text with a locator. Import is available without video plugins.',
      parameters: {
        action: { ...enumeration('fetch', 'import', 'list', 'get'), required: true },
        id: string,
        source_id: string,
        title: string,
        body: string,
        locator: string,
        material_type: enumeration('transcript', 'article', 'user_notes', 'comment'),
        origin: enumeration('user_import', 'bilibili', 'youtube', 'forum', 'match'),
        tags: strings,
        provider_tool: enumeration('bili_subtitle', 'yt_subtitle', 'forum_fetch', 'reddit_json'),
        offset: number,
        max_chars: number,
        provider_args: { type: 'object', additionalProperties: true },
        ...filter,
      },
    },
    dota_coach_note: {
      description:
        'Append, search, read or flag knowledge for recheck. Requires a readable source_record_id. Principles, patch facts and counterexamples remain distinct.',
      parameters: {
        action: enumeration('append', 'list', 'search', 'get', 'recheck', 'revise'),
        kind: enumeration('principle', 'fact', 'counterexample'),
        id: string,
        source_record_id: string,
        source_id: string,
        stamp: string,
        title: string,
        body: string,
        match_id: number,
        tags: strings,
        current_patch: string,
        ...filter,
      },
    },
    dota_review: {
      description:
        'Save or read a review with evidence and learner explanation. Saving creates exactly one trigger → action → check training goal atomically.',
      parameters: {
        action: { ...enumeration('save', 'list', 'get'), required: true },
        id: string,
        match_id: number,
        from: number,
        to: number,
        title: string,
        body: string,
        learner_explanation: string,
        evidence_ids: strings,
        trigger: string,
        action_rule: string,
        check_method: string,
        session_id: string,
        limit: number,
      },
    },
    dota_training: {
      description:
        'Create/get the single goal from a saved review, list goals, update status or record a user-reported checkin. No inferred growth score.',
      parameters: {
        action: { ...enumeration('create', 'get', 'list', 'update', 'checkin'), required: true },
        id: string,
        review_id: string,
        status: enumeration('active', 'paused', 'completed'),
        match_id: number,
        body: string,
        completed: { type: 'boolean' },
        limit: number,
      },
    },
  }
export function makeTools(
  invoke: (name: ToolName, args: RecordValue, exec: ToolRunContext) => Promise<RecordValue>,
): ToolDefinition[] {
  return (Object.entries(toolSpecs) as [ToolName, (typeof toolSpecs)[ToolName]][]).map(
    ([name, spec]) =>
      defineTool({
        name,
        ...spec,
        timeoutMs: 300000,
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              ok: { type: 'boolean', required: true },
              reason: { type: 'string' },
              detail: { type: 'string' },
              evidence_id: { type: 'string' },
              source: { type: 'string' },
              captured_at: { type: 'string' },
            },
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          presentationMeta: (_args, value) => ({
            match_id: typeof value.match_id === 'number' ? value.match_id : null,
          }),
        },
        async execute(args, exec) {
          const result = await invoke(name, args as RecordValue, exec)
          if (typeof result.ok !== 'boolean') throw new Error('Tool returned no status')
          return { ...result, ok: result.ok }
        },
      }),
  )
}
