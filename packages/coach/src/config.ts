import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
export interface CoachConfig {
  memoryEnabled: boolean
  memoryEmbeddingModel: string
  memoryOffline: boolean
  memoryModelPath: string
  memorySearchTimeoutMs: number
  enabled: boolean
  accountId: number
  homeDir: string
  userAgent: string
  opendotaApiKey: string
  maxOutputBytes: number
  replayMaxBytes: number
  downloadMaxBytes: number
  decompressedMaxBytes: number
  extractBin: string
  parseTimeoutMs: number
  downloadTimeoutMs: number
  skillEnabled: boolean
  requestsPerMinute: number
  requestsPerDay: number
  calibrationMinAnchors: number
  calibrationMatchRatio: number
  calibrationResidualSeconds: number
}
/** Ordinary config fields: edits cause the Loader to recreate this plugin. */
export const Config: z<CoachConfig> = z.object({
  memoryEnabled: z.boolean().default(true),
  memoryEmbeddingModel: z.string().default('Xenova/paraphrase-multilingual-MiniLM-L12-v2'),
  memoryOffline: z.boolean().default(false),
  memoryModelPath: z.string().default(''),
  memorySearchTimeoutMs: z.natural().min(100).default(3000),
  enabled: z.boolean().default(true),
  accountId: z.natural().default(0),
  homeDir: z.string().default(''),
  userAgent: z
    .string()
    .default('dsh-dota-coach/0.1 (+https://github.com/qianhaoq/qh-dsh-dota-coach)'),
  opendotaApiKey: z.string().role('secret').default(''),
  maxOutputBytes: z.natural().min(2048).default(24576),
  replayMaxBytes: z.natural().min(1).default(8_000_000_000),
  downloadMaxBytes: z.natural().min(1).default(1_000_000_000),
  decompressedMaxBytes: z.natural().min(1).default(4_000_000_000),
  extractBin: z.string().default(''),
  parseTimeoutMs: z.natural().min(1).default(180_000),
  downloadTimeoutMs: z.natural().min(1).default(240_000),
  skillEnabled: z.boolean().default(true),
  requestsPerMinute: z.natural().min(1).default(45),
  requestsPerDay: z.natural().min(1).default(2000),
  calibrationMinAnchors: z.natural().min(3).default(3),
  calibrationMatchRatio: z.number().min(0.6).max(1).default(0.6),
  calibrationResidualSeconds: z.number().min(0.01).max(2).default(2),
})
export function dataHome(c: CoachConfig): string {
  return resolve(c.homeDir || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dota-coach'))
}
