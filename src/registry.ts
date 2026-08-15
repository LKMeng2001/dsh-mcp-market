/**
 * Registry access: fetch the curated MCP server catalog from a remote URL
 * with an in-memory cache, falling back to the bundled snapshot when offline.
 * The URL can be overridden per profile through the plugin config
 * (`registryUrl`).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkNpmPackage } from './npm.js'
import type { Registry } from './types.js'

/** Default catalog endpoint: the live servers.json hosted on GitHub Pages
 * (kept in sync with the bundled snapshot by scripts/sync-catalog.mjs). */
export const DEFAULT_REGISTRY_URL = 'https://LKMeng2001.github.io/dsh-mcp-market/servers.json'
const TTL_MS = 60 * 60 * 1000

let cache: { at: number; data: Registry } | null = null

function snapshot(): Registry {
  const path = fileURLToPath(new URL('../data/registry-snapshot.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as Registry
}

/**
 * Verify every stdio entry's npm package exists (concurrency 4). Results land
 * in `server.npmOk`; the client disables entries verified as missing, and the
 * install route re-checks before activating.
 */
async function enrichRegistry(registry: Registry): Promise<void> {
  const targets = registry.servers.filter((server) => server.npmPackage !== undefined)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const server = targets[next++]
      server.npmOk = await checkNpmPackage(server.npmPackage!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker))
}

export async function loadRegistry(
  url = DEFAULT_REGISTRY_URL,
): Promise<{ registry: Registry; source: 'live' | 'cache' | 'snapshot' }> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { registry: cache.data, source: 'cache' }
  }
  let data: Registry
  let source: 'live' | 'cache' | 'snapshot'
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = (await res.json()) as Registry
    if (!Array.isArray(data.servers) || data.servers.length === 0) throw new Error('empty registry')
    source = 'live'
  } catch {
    if (cache) {
      data = cache.data
      source = 'cache'
    } else {
      data = snapshot()
      source = 'snapshot'
    }
  }
  // Re-verification is cheap: checkNpmPackage keeps its own cache.
  await enrichRegistry(data)
  if (source === 'live') cache = { at: Date.now(), data }
  return { registry: data, source }
}
