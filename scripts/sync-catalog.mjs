/**
 * Sync the canonical catalog (docs/servers.json, hosted on GitHub Pages as the
 * live registry) into the npm package's offline fallback
 * (data/registry-snapshot.json). Run as part of `npm run build` so every
 * published tarball carries the same catalog the live URL serves.
 *
 *   node scripts/sync-catalog.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'docs', 'servers.json')
const target = join(root, 'data', 'registry-snapshot.json')

const catalog = JSON.parse(readFileSync(source, 'utf8'))
if (!Array.isArray(catalog.servers)) throw new Error('docs/servers.json: missing servers array')

// Keep the metadata in sync so the snapshot never lies.
catalog.count = catalog.servers.length
catalog.updated = new Date().toISOString().slice(0, 10)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`[sync-catalog] ${source} -> ${target} (${catalog.servers.length} servers)`)
