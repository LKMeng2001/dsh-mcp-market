/**
 * npm package existence checks against registry.npmjs.org, with an in-memory
 * cache. Used to keep dead catalog entries from being installed: the catalog
 * snapshot is hand-curated and can go stale (the official servers repo
 * unpublished several packages), so every stdio entry is verified before the
 * UI offers an install button and again at install time.
 */

const TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; exists: boolean }>()

/**
 * Whether an npm package exists. Network failures resolve to `true` so a
 * transient outage never blocks installs; a definitive 404 resolves `false`.
 */
export async function checkNpmPackage(pkg: string): Promise<boolean> {
  const hit = cache.get(pkg)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.exists
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
      signal: AbortSignal.timeout(5000),
    })
    const exists = res.ok
    cache.set(pkg, { at: Date.now(), exists })
    return exists
  } catch {
    return true
  }
}
