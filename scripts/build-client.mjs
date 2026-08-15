/**
 * Client bundle build: bundle src/client/index.ts into the
 * window.__ModuleLoader__.load({ id, factory }) format the DSH web shell
 * serves for plugin client modules (same shape as dsh-market's client.js).
 *
 * The factory body is CommonJS; its `require` resolves react /
 * react/jsx-runtime / @deepseek-ai/dsh-client-ui-primitives from the host's
 * frozen module table, so those stay external.
 */

import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const OUT = 'client/client.js'
const LOAD_ID = 'dsh-mcp-market'

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  outfile: OUT,
  sourcemap: false,
  logLevel: 'info',
})

const body = readFileSync(OUT, 'utf8')
const wrapped =
`window.__ModuleLoader__.load({ id: "${LOAD_ID}", factory: (require) => {

var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
return module.exports;
}
});
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, wrapped, 'utf8')
console.log(`[build-client] wrote ${OUT} (${Buffer.byteLength(wrapped)} bytes)`)
