import { ZodError } from 'zod'
import type { RecordValue } from './types.ts'
export class CoachError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: RecordValue = {},
  ) {
    super(message)
  }
}
export function failure(error: unknown): RecordValue {
  if (error instanceof CoachError)
    return { ok: false, reason: error.code, detail: error.message, ...error.details }
  if (error instanceof ZodError)
    return {
      ok: false,
      reason: 'invalid_arguments',
      detail: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return {
      ok: false,
      reason: error.name === 'TimeoutError' ? 'timeout' : 'cancelled',
      detail: error.message,
    }
  return {
    ok: false,
    reason: 'internal_error',
    detail: error instanceof Error ? error.message : String(error),
  }
}
export function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new CoachError('invalid_arguments', `${field} is required`)
  return value.trim()
}
