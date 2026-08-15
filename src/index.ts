/**
 * dsh-mcp-market host entry: mounts the marketplace's HTTP routes once the
 * profile composes the webServer and loader services.
 */

import { mountMcpMarketRoutes, type HostContext, type McpMarketConfig } from './routes.js'

export const name = 'dsh-mcp-market'

/**
 * The profile this host process actually booted (`--profile <name>` on the
 * dsh CLI invocation). Without it the marketplace would default to `web` and
 * installs from a test/secondary profile would mutate the real one.
 */
function argvProfile(): string | undefined {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return undefined
}

interface BootContext {
  inject(services: string[], callback: (ctx: HostContext) => void): void
}

export function apply(ctx: BootContext, config?: Partial<McpMarketConfig>): void {
  const resolved: McpMarketConfig = {
    profile: config?.profile ?? argvProfile() ?? 'web',
    registryUrl: config?.registryUrl,
  }
  ctx.inject(['webServer', 'loader'], (hostCtx) => {
    hostCtx.effect(() => mountMcpMarketRoutes(hostCtx, resolved), 'dsh-mcp-market: http routes')
  })
}
