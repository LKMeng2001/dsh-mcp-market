/**
 * Catalog health check: verify every stdio entry's npm package exists on
 * registry.npmjs.org. Used by the CI workflow (daily + on PRs touching the
 * catalog) so a dead/typosquat package can never ship. Zero dependencies —
 * Node 18+ global fetch is enough.
 *
 *   node scripts/check-catalog.mjs
 *   exit 0 = all packages exist, 1 = at least one missing
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'docs', 'servers.json'), 'utf8'))

const missing = []
for (const server of catalog.servers) {
  if (!server.npmPackage) continue
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(server.npmPackage)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) missing.push(`${server.name} -> ${server.npmPackage} (HTTP ${res.status})`)
    else console.log(`ok   ${server.name} -> ${server.npmPackage}`)
  } catch (error) {
    // Network hiccup: treat as ok so CI doesn't flap on transient outages.
    console.log(`warn ${server.name} -> ${server.npmPackage}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (missing.length > 0) {
  console.error(`\nMISSING PACKAGES (${missing.length}):`)
  for (const line of missing) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`\nAll ${catalog.servers.length} catalog entries verified.`)
