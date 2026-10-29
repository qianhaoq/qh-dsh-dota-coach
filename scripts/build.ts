import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
const root = 'packages/coach'
await mkdir(root + '/lib', { recursive: true })
const pm = process.env.npm_execpath
if (!pm) throw new Error('Run with pnpm build')
execFileSync(process.execPath, [pm, 'exec', 'tsc', '-p', root + '/tsconfig.host.json'], {
  stdio: 'inherit',
})
execFileSync(
  process.execPath,
  [pm, 'exec', 'tsc', '-p', root + '/tsconfig.client.json', '--emitDeclarationOnly'],
  {
    stdio: 'inherit',
  },
)
await build({
  entryPoints: [root + '/src/index.ts', root + '/src/memory-worker.ts'],
  outdir: root + '/lib',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  jsx: 'automatic',
  packages: 'external',
  sourcemap: true,
})
await build({
  entryPoints: [root + '/src/client/index.ts'],
  outfile: root + '/lib/client.js',
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  bundle: true,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store'],
  loader: { '.css': 'text' },
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "@qianhaoq/dsh-dota-coach", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
})
