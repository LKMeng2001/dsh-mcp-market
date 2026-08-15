/**
 * Smoke test for the patch-layer persistence logic (src/profile.ts).
 * Runs against a throwaway DSH_HOME so your real profile is untouched:
 *
 *   node scripts/smoke.mjs
 *
 * Exit code 0 = all checks passed.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const home = mkdtempSync(join(tmpdir(), 'dsh-mcp-market-smoke-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'profiles', 'web'), { recursive: true })

const { profileDir, patchFilePath, readPatchText, writePatchText, parseMcpInstances, withManagedEntries, MCP_CLIENT_PACKAGE } =
  require('../lib/profile.js')

let failures = 0
function check(label, cond) {
  if (cond) console.log(`  ok  ${label}`)
  else { failures++; console.log(`FAIL  ${label}`) }
}

// --- 1. empty `[]` file: install github ------------------------------------
const file = patchFilePath('web')
writeFileSync(file, '[]\n', 'utf8')
let text = readPatchText('web')
let next = withManagedEntries(text, (entries) => {
  entries.push({ id: 'mcp-github', name: MCP_CLIENT_PACKAGE, config: { serverName: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }, disabled: false })
})
check('install on empty [] produces valid YAML', (() => { try { yaml.load(next); return true } catch { return false } })())
let instances = parseMcpInstances(next)
check('installed entry parsed (github, managed)', instances.length === 1 && instances[0].id === 'mcp-github' && instances[0].managed === true)

// --- 2. install a second server --------------------------------------------
next = withManagedEntries(next, (entries) => {
  entries.push({ id: 'mcp-fetch', name: MCP_CLIENT_PACKAGE, config: { serverName: 'fetch', transport: 'stdio', command: 'npx' }, disabled: false })
})
instances = parseMcpInstances(next)
check('two entries after second install', instances.length === 2)

// --- 3. toggle disable ------------------------------------------------------
next = withManagedEntries(next, (entries) => {
  const hit = entries.find((e) => e.id === 'mcp-github')
  if (hit) hit.disabled = true
})
instances = parseMcpInstances(next)
check('disabled flag persists after toggle', instances.find((i) => i.id === 'mcp-github')?.disabled === true)
check('disable row keeps YAML valid', (() => { try { yaml.load(next); return true } catch { return false } })())

// --- 4. remove one ----------------------------------------------------------
next = withManagedEntries(next, (entries) => {
  const index = entries.findIndex((e) => e.id === 'mcp-fetch')
  if (index !== -1) entries.splice(index, 1)
})
instances = parseMcpInstances(next)
check('remove leaves exactly one managed entry', instances.length === 1 && instances[0].id === 'mcp-github')

// --- 5. user content preserved ---------------------------------------------
const withUser = `# my own patch layer
- id: some-other-plugin
  disabled: true
`
next = withManagedEntries(withUser, (entries) => {
  entries.push({ id: 'mcp-time', name: MCP_CLIENT_PACKAGE, config: { serverName: 'time', transport: 'stdio', command: 'npx' }, disabled: false })
})
check('user comment preserved', next.includes('# my own patch layer'))
check('user entry preserved', next.includes('some-other-plugin'))
instances = parseMcpInstances(next)
check('manual plugin not counted as mcp', instances.length === 1 && instances[0].id === 'mcp-time')

// --- 6. hand-written mcp entry outside the managed block -------------------
const manual = `# hand-configured mcp server
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
- id: mcp-github
  disabled: true
`
instances = parseMcpInstances(manual)
check('manual entry detected, not managed, disabled', instances.length === 1 && instances[0].managed === false && instances[0].disabled === true)

// --- 7. install/remove round-trip against the real file shape --------------
next = withManagedEntries('[]\n', (entries) => {
  entries.push({ id: 'mcp-a', name: MCP_CLIENT_PACKAGE, config: { serverName: 'a', transport: 'stdio', command: 'npx' }, disabled: false })
})
next = withManagedEntries(next, (entries) => {
  const index = entries.findIndex((e) => e.id === 'mcp-a')
  if (index !== -1) entries.splice(index, 1)
})
check('remove last entry restores empty []', next.trim() === '[]')

// --- 8. regression: header comments + [] base (#empty-config bug) ----------
// A real profile patch is header comments + `[]`; the managed block must
// REPLACE the `[]` (not append after it), or the file becomes invalid YAML
// and configs silently stop round-tripping (empty edit forms).
const headerBase = `# my patch header
# more comment
[]
`
next = withManagedEntries(headerBase, (entries) => {
  entries.push({ id: 'mcp-git', name: MCP_CLIENT_PACKAGE, config: { serverName: 'git', transport: 'stdio', command: 'npx', args: ['-y', 'git-mcp'] }, disabled: false })
})
check('header+[] install keeps header, drops []', next.includes('# my patch header') && !next.includes('\n[]'))
check('header+[] install yields valid YAML', (() => { try { yaml.load(next); return true } catch { return false } })())
instances = parseMcpInstances(next)
check('config round-trips after header+[] install', instances.length === 1 && Object.keys(instances[0].config).length === 4)
next = withManagedEntries(next, (entries) => {
  const index = entries.findIndex((e) => e.id === 'mcp-git')
  if (index !== -1) entries.splice(index, 1)
})
check('remove restores header + []', next.trim() === '# my patch header\n# more comment\n[]')
// And with only comments (no []) the block still lands cleanly.
next = withManagedEntries('# only comments\n', (entries) => {
  entries.push({ id: 'mcp-x', name: MCP_CLIENT_PACKAGE, config: { serverName: 'x', transport: 'stdio', command: 'npx' }, disabled: false })
})
check('comments-only base install yields valid YAML', (() => { try { yaml.load(next); return true } catch { return false } })())

rmSync(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
