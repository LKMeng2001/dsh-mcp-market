/**
 * HTTP routes bridging the browser market UI to the host. This layer only
 * parses requests, calls the service modules, and serializes responses —
 * loader orchestration lives in manage.ts, profile access in profile.ts,
 * catalog fetching in registry.ts.
 *
 * Security: every mutating route accepts only same-origin POSTs.
 */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_REGISTRY_URL, loadRegistry } from './registry.js'
import { parseMcpInstances, readPatchText } from './profile.js'
import {
  installServer,
  removeServer,
  toggleServer,
  updateServerConfig,
  type LoaderLike,
} from './manage.js'
import { readJsonBody, sameOrigin, sendJson } from './http.js'
import type { NewServer } from './types.js'

export interface McpMarketConfig {
  /** The profile this host process booted; installs target it. */
  profile: string
  /** Optional catalog endpoint override (default DEFAULT_REGISTRY_URL). */
  registryUrl?: string
}

interface WebServerService {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** The host context surface this plugin consumes (structural typing). */
export interface HostContext {
  effect(callback: () => unknown, label?: string): void
  webServer: WebServerService
  loader: LoaderLike
}

function route(
  host: HostContext,
  path: string,
  method: 'GET' | 'POST',
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  guardOrigin = false,
): () => void {
  return host.webServer.register({
    kind: 'exact',
    path,
    handler: async (request, response) => {
      if (request.method !== method) {
        response.writeHead(405, { allow: method })
        response.end()
        return
      }
      if (guardOrigin && !sameOrigin(request)) {
        sendJson(response, 403, { error: 'untrusted origin' })
        return
      }
      try {
        await handler(request, response)
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

/**
 * Register the marketplace's HTTP routes.
 * @param host - Acquired webServer + loader services.
 * @param config - Resolved marketplace configuration.
 * @returns Disposer removing every registered route.
 */
export function mountMcpMarketRoutes(host: HostContext, config: McpMarketConfig): () => void {
  const registryUrl = config.registryUrl ?? DEFAULT_REGISTRY_URL
  const disposers: Array<() => void> = []

  // GET /mcp-market/registry — the curated server catalog.
  disposers.push(route(host, '/mcp-market/registry', 'GET', async (_request, response) => {
    const { registry, source } = await loadRegistry(registryUrl)
    sendJson(response, 200, { source, registry })
  }))

  // GET /mcp-market/installed — every mcp-client instance in the patch layer,
  // plus whether the loader currently resolves each entry.
  disposers.push(route(host, '/mcp-market/installed', 'GET', (_request, response) => {
    const servers = parseMcpInstances(readPatchText(config.profile))
    const present: Record<string, boolean> = {}
    for (const server of servers) {
      try {
        present[server.id] = host.loader.resolve(server.id) !== undefined
      } catch {
        present[server.id] = false
      }
    }
    sendJson(response, 200, { profile: config.profile, servers, present })
  }))

  // GET /mcp-market/status — small boot/environment snapshot for the UI footer.
  disposers.push(route(host, '/mcp-market/status', 'GET', (_request, response) => {
    let version = 'unknown'
    try {
      version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? version
    } catch { /* version line is cosmetic */ }
    sendJson(response, 200, {
      profile: config.profile,
      version,
      registryUrl,
      servers: parseMcpInstances(readPatchText(config.profile)).length,
    })
  }))

  // POST /mcp-market/install — activate a server live and persist it.
  disposers.push(route(host, '/mcp-market/install', 'POST', async (request, response) => {
    const body = (await readJsonBody(request)) as NewServer
    const result = await installServer(host.loader, config.profile, body)
    sendJson(response, result.ok ? 200 : 400, result)
  }, true))

  // POST /mcp-market/remove — deactivate and unpersist.
  disposers.push(route(host, '/mcp-market/remove', 'POST', async (request, response) => {
    const body = (await readJsonBody(request)) as { id?: string }
    if (typeof body.id !== 'string' || body.id === '') {
      sendJson(response, 400, { ok: false, reason: 'missing id' })
      return
    }
    const result = await removeServer(host.loader, config.profile, body.id)
    sendJson(response, result.ok ? 200 : 400, result)
  }, true))

  // POST /mcp-market/toggle — enable/disable without uninstalling.
  disposers.push(route(host, '/mcp-market/toggle', 'POST', async (request, response) => {
    const body = (await readJsonBody(request)) as { id?: string; disabled?: boolean }
    if (typeof body.id !== 'string' || body.id === '') {
      sendJson(response, 400, { ok: false, reason: 'missing id' })
      return
    }
    const result = await toggleServer(host.loader, config.profile, body.id, body.disabled === true)
    sendJson(response, result.ok ? 200 : 400, result)
  }, true))

  // POST /mcp-market/update — replace a server's config (live reconnect via HMR).
  disposers.push(route(host, '/mcp-market/update', 'POST', async (request, response) => {
    const body = (await readJsonBody(request)) as { id?: string; config?: NewServer }
    if (typeof body.id !== 'string' || body.id === '' || !body.config) {
      sendJson(response, 400, { ok: false, reason: 'missing id or config' })
      return
    }
    const result = await updateServerConfig(host.loader, config.profile, body.id, body.config)
    sendJson(response, result.ok ? 200 : 400, result)
  }, true))

  return () => {
    for (const dispose of disposers) dispose()
  }
}
