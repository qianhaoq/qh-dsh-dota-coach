/** Reflect published SDK declarations without depending on a local DSH source checkout. */
import {
  WorkspaceAnalyzer,
  FaceModelEmitter,
  writePackageArtifacts,
} from '@deepseek-ai/dsh-typert-generator'
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = process.cwd(),
  sdk = join(root, 'packages/.reflection-sdk'),
  generated = join(root, '.generated')
await mkdir(sdk, { recursive: true })
await mkdir(generated, { recursive: true })
const protocol = dirname(
  fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-typert-protocol/package.json')),
)
await cp(join(protocol, 'lib/types'), join(sdk, 'src'), { recursive: true })
await writeFile(
  join(sdk, 'package.json'),
  JSON.stringify({
    name: '@deepseek-ai/dsh-typert-protocol',
    type: 'module',
    exports: {
      '.': { types: './src/index.d.ts' },
      './remote-info': { types: './src/remote-info.d.ts' },
    },
  }),
)
await writeFile(
  join(sdk, 'tsconfig.host.json'),
  JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src/**/*.d.ts'] }),
)
await writeFile(
  join(generated, 'tsconfig.host.json'),
  JSON.stringify({
    extends: '../tsconfig.host.json',
    compilerOptions: {
      baseUrl: '..',
      paths: {
        '@deepseek-ai/dsh-typert-protocol': ['packages/.reflection-sdk/src/index.d.ts'],
        '@deepseek-ai/dsh-typert-protocol/*': ['packages/.reflection-sdk/src/*.d.ts'],
      },
    },
    files: [],
    references: [
      { path: '../packages/coach/tsconfig.host.json' },
      { path: '../packages/.reflection-sdk/tsconfig.host.json' },
    ],
  }),
)
const model = new WorkspaceAnalyzer({
  root,
  hostConfig: '.generated/tsconfig.host.json',
  faces: ['host'],
  packages: ['@qianhaoq/dsh-dota-coach'],
  checkDiagnostics: false,
}).analyze()
const face = model.faces[0]
if (!face) throw new Error('Host reflection missing')
const artifact = new FaceModelEmitter(face).emit('@qianhaoq/dsh-dota-coach')
if (!artifact.remote) throw new Error('Remote methods were not generated')
writePackageArtifacts(join(root, 'packages/coach'), [artifact])
console.log('Generated Host and Remote from published DSH SDK declarations')
