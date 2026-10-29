/** Install the release through the supported DSH profile CLI, then exercise the shipped Host. */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Typert from '@deepseek-ai/dsh-typert-registry'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const manifestFile = require.resolve('@deepseek-ai/dsh/package.json')
const cli = join(dirname(manifestFile), JSON.parse(await readFile(manifestFile, 'utf8')).bin.dsh)
const archive = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass a release .tgz')
const home = await mkdtemp(join(tmpdir(), 'dota-installed-'))
let fiber: ReturnType<Context['plugin']> | undefined
try {
  execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', archive], {
    env: { ...process.env, DSH_HOME: home },
    stdio: 'inherit',
    maxBuffer: 20_000_000,
  })
  const profileRequire = createRequire(join(home, 'profiles/web/package.json'))
  const entry = profileRequire.resolve('@qianhaoq/dsh-dota-coach'),
    plugin = await import(pathToFileURL(entry).href)
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new Tools(ctx, {})
  new Typert(ctx)
  fiber = ctx.plugin(plugin, {
    homeDir: join(home, 'dota-coach'),
    memoryEnabled: true,
    memoryOffline: true,
    skillEnabled: false,
  })
  await fiber.inertia
  const result = await ctx.tools.execute({
    callId: 'installed-source' as never,
    name: 'dota_source',
    arguments: {
      action: 'import',
      source_id: 'user:installed-fixture',
      title: 'Installed plugin test',
      body: 'A synthetic readable source for the packaged installation test.',
      locator: 'paragraph 1',
    },
    signal: new AbortController().signal,
  })
  assert.equal(result.isError, false)
  assert.equal((result.value as { ok: boolean }).ok, true)
  const status = await ctx.tools.execute({
    callId: 'installed-status' as never,
    name: 'dota_memory',
    arguments: { action: 'status' },
    signal: new AbortController().signal,
  })
  assert.equal(status.isError, false)
  assert.match(JSON.stringify(status.value), /2.0.21/)
  await fiber.restart()
  assert.ok(ctx.tools.get('dota_status'))
  const bin = join(
    dirname(entry),
    '../bin',
    `dota-extract-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const output = execFileSync(
    bin,
    [resolve('packages/coach/fixtures/tiny.dem'), join(home, 'extract'), '--quiet'],
    { encoding: 'utf8' },
  )
  assert.equal(JSON.parse(output).ok, true)
  console.log('Clean DSH installation, shipped MemOS worker, reload and extractor parse passed')
  if (process.env.DOTA_KEEP_SMOKE_HOME) await writeFile(process.env.DOTA_KEEP_SMOKE_HOME, home)
} finally {
  await fiber?.dispose()
  if (!process.env.DOTA_KEEP_SMOKE_HOME) await rm(home, { recursive: true, force: true })
}
