/** Build one platform archive with vendored runtime dependencies and its extractor. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile, cp } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { create as createTar } from 'tar'
const root = process.cwd(),
  plugin = join(root, 'packages/coach'),
  dist = join(root, 'dist')
const platform = process.platform === 'win32' ? 'windows' : process.platform,
  arch = process.arch
if (!['linux-x64', 'windows-x64', 'darwin-x64', 'darwin-arm64'].includes(`${platform}-${arch}`))
  throw new Error('Unsupported release platform')
const pm = process.env.npm_execpath
if (!pm) throw new Error('Run with pnpm pack:release')
const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'))
const bin = `dota-extract-${platform}-${arch}${platform === 'windows' ? '.exe' : ''}`
execFileSync(
  process.env.DOTA_GO_BIN || 'go',
  ['build', '-trimpath', '-ldflags=-s -w', '-o', join(plugin, 'bin', bin), '.'],
  {
    cwd: join(plugin, 'go'),
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' },
  },
)
await mkdir(dist, { recursive: true })
const temp = await mkdtemp(join(tmpdir(), 'dota-pack-')),
  stage = join(temp, 'package')
try {
  execFileSync(
    process.execPath,
    [
      pm,
      '--filter',
      '@qianhaoq/dsh-dota-coach',
      'deploy',
      '--prod',
      '--config.node-linker=hoisted',
      stage,
    ],
    { cwd: root, stdio: 'inherit' },
  )
  const staged = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'))
  const bundled: Record<string, string> = {}
  for (const item of await readdir(join(stage, 'node_modules'), { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue
    const names = item.name.startsWith('@')
      ? (await readdir(join(stage, 'node_modules', item.name))).map(
          (name) => `${item.name}/${name}`,
        )
      : [item.name]
    for (const name of names) {
      const dependency = JSON.parse(
        await readFile(join(stage, 'node_modules', name, 'package.json'), 'utf8'),
      )
      bundled[name] = dependency.version
    }
  }
  staged.dependencies = bundled
  staged.bundleDependencies = Object.keys(bundled)
  delete staged.peerDependencies
  await writeFile(join(stage, 'package.json'), JSON.stringify(staged, null, 2) + '\n')
  for (const file of await readdir(join(stage, 'bin')))
    if (file !== bin) await rm(join(stage, 'bin', file), { force: true })
  if (!bundled['@memtensor/memos-local-plugin'])
    throw new Error('Runtime memory engine was not bundled')
  const archive = `qh-dsh-dota-coach-${manifest.version}-${platform}-${arch}.tgz`
  // pnpm's content store hardlinks equal bytes across e.g. index.js/index.d.ts.
  // npm-compatible fetchers do not consistently materialize tar hardlink entries.
  // Copy the published tree first so every archive member owns its bytes.
  const portableRoot = join(temp, 'portable')
  const published = new Set([
    'package.json',
    'node_modules',
    ...manifest.files.map((p: string) => p.split('/')[0]),
  ])
  await cp(stage, join(portableRoot, 'package'), {
    recursive: true,
    filter: (path) =>
      path === stage || published.has(path.slice(stage.length + 1).split(/[\\/]/)[0]),
  })
  // A standard npm tarball, including the complete hoisted production tree.
  // npm pack's Arborist traversal drops pnpm peer links and can hang on cyclic SDK peers.
  createTar(
    {
      sync: true,
      gzip: true,
      portable: true,
      cwd: portableRoot,
      file: join(dist, archive),
      filter: (path) => !path.includes('/.pnpm') && !path.includes('/.bin'),
    },
    ['package'],
  )
  await copyFile(join(stage, 'bin', bin), join(dist, bin))
  const lines = []
  for (const name of [archive, bin])
    lines.push(
      `${createHash('sha256')
        .update(await readFile(join(dist, name)))
        .digest('hex')}  ${name}`,
    )
  await writeFile(join(dist, `SHA256SUMS-${platform}-${arch}`), lines.join('\n') + '\n')
  console.log(`Built ${archive} with ${Object.keys(bundled).length} locked runtime packages`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
