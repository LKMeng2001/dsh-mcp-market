/**
 * Shared host-side types for the MCP marketplace.
 */

/** A catalog entry from the registry (remote JSON or bundled snapshot). */
export interface RegistryServer {
  name: string
  category?: string
  description?: { en?: string; zh?: string }
  homepage?: string
  tags?: string[]
  /** 'stdio' spawns a child process; 'streamable-http' connects to a URL. */
  transport: 'stdio' | 'streamable-http'
  /** stdio: command to spawn. */
  command?: string
  /** stdio: arguments. */
  args?: string[]
  /** The npm package this stdio server runs (`npx -y <npmPackage>`); used for
   * existence verification so dead entries are surfaced, not installed. */
  npmPackage?: string
  /** stdio: extra environment variables. */
  env?: Record<string, string>
  /** streamable-http: server URL. */
  url?: string
  /** streamable-http: extra headers (e.g. auth). */
  headers?: Record<string, string>
  /** Required env keys the user should fill in before installing. */
  envHint?: string[]
  /** True when the entry is a placeholder that needs user-provided values. */
  placeholder?: boolean
  /** Set by the host after verification: false = npm package does not exist. */
  npmOk?: boolean
  added?: string
}

export interface Registry {
  name?: string
  url?: string
  updated?: string
  count?: number
  categories?: Record<string, { en: string; zh: string }>
  servers: RegistryServer[]
}

/** A configured MCP server instance found in the profile's patch layer. */
export interface McpInstance {
  /** Loader entry id (e.g. `mcp-github`). */
  id: string
  /** Config passed to @deepseek-ai/dsh-mcp-client. */
  config: Record<string, unknown>
  /** An id-targeted `disabled: true` override is present. */
  disabled: boolean
  /** Managed by this marketplace (lives in the managed block). */
  managed: boolean
}

/** New-server payload accepted by the install / update routes. */
export interface NewServer {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  /** Optional npm package name; when present, the install route verifies it
   * exists on the registry before activating. */
  npmPackage?: string
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}
