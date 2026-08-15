/**
 * Install orchestration: validate the incoming server definition, activate it
 * live through the loader service (no restart), then persist it into the
 * profile's patch layer. Live-first ordering keeps the durable file in sync
 * with what the running host actually does.
 */

import type { NewServer } from './types.js'
import {
  MCP_CLIENT_PACKAGE,
  parseMcpInstances,
  readPatchText,
  withManagedEntries,
  writePatchText,
} from './profile.js'
import { checkNpmPackage } from './npm.js'

/** The subset of the loader service this plugin touches
 * (@cordisjs/plugin-loader; see its README for the full API). */
export interface LoaderLike {
  create(options: { id?: string; name: string; config?: Record<string, unknown>; disabled?: boolean }): unknown
  update(id: string, options: { config?: Record<string, unknown>; disabled?: boolean }): unknown
  remove(id: string): unknown
  /** Resolve an entry by id, including nested `a:b` ids. */
  resolve(id: string): unknown
}

export interface ManageResult {
  ok: boolean
  id?: string
  reason?: string
}

const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/** The loader entry id used for a server name (e.g. `mcp-github`). */
export function entryIdFor(serverName: string): string {
  return `mcp-${serverName}`
}

export function validateNewServer(input: NewServer): { error?: string } {
  if (!input || typeof input !== 'object') return { error: 'invalid payload' }
  if (typeof input.serverName !== 'string' || !SERVER_NAME_RE.test(input.serverName)) {
    return { error: 'serverName must match [A-Za-z0-9_-]{1,32}' }
  }
  if (input.transport === 'stdio') {
    if (typeof input.command !== 'string' || input.command === '') {
      return { error: 'stdio servers need a command' }
    }
  } else if (input.transport === 'streamable-http') {
    if (typeof input.url !== 'string' || !/^https?:\/\//.test(input.url)) {
      return { error: 'streamable-http servers need a valid http(s) url' }
    }
  } else {
    return { error: `unknown transport: ${String(input.transport)}` }
  }
  return {}
}

/** Build the @deepseek-ai/dsh-mcp-client config for a server definition. */
export function buildMcpConfig(input: NewServer): Record<string, unknown> {
  const base: Record<string, unknown> = { serverName: input.serverName }
  if (input.toolCallTimeoutMs !== undefined) base.toolCallTimeoutMs = input.toolCallTimeoutMs
  if (input.transport === 'streamable-http') {
    base.transport = 'streamable-http'
    base.url = input.url
    if (input.headers && Object.keys(input.headers).length > 0) base.headers = input.headers
  } else {
    base.transport = 'stdio'
    base.command = input.command
    if (input.args && input.args.length > 0) base.args = input.args
    if (input.env && Object.keys(input.env).length > 0) base.env = input.env
    if (input.cwd) base.cwd = input.cwd
  }
  return base
}

/** Install a server: validate → verify npm package → activate live → persist. */
export async function installServer(
  loader: LoaderLike,
  profile: string,
  input: NewServer,
): Promise<ManageResult> {
  const validation = validateNewServer(input)
  if (validation.error) return { ok: false, reason: validation.error }

  // Belt-and-suspenders: catalog entries carry npmPackage; the UI disables
  // missing packages, but a stale client could still POST one.
  if (input.npmPackage && !(await checkNpmPackage(input.npmPackage))) {
    return { ok: false, reason: `npm package does not exist: ${input.npmPackage}` }
  }

  const id = entryIdFor(input.serverName)
  const config = buildMcpConfig(input)
  const text = readPatchText(profile)
  if (parseMcpInstances(text).some((entry) => entry.id === id)) {
    return { ok: false, reason: `already installed: ${id}` }
  }

  // Live first: activation must succeed before anything is written to disk.
  try {
    await loader.create({ id, name: MCP_CLIENT_PACKAGE, config })
  } catch (error) {
    return { ok: false, reason: `activation failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  try {
    writePatchText(profile, withManagedEntries(text, (entries) => {
      entries.push({ id, name: MCP_CLIENT_PACKAGE, config, disabled: false })
    }))
  } catch (error) {
    try { await loader.remove(id) } catch { /* best-effort rollback */ }
    return { ok: false, reason: `persist failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, id }
}

/** Remove a server: deactivate live, then drop it from the managed block. */
export async function removeServer(loader: LoaderLike, profile: string, id: string): Promise<ManageResult> {
  const text = readPatchText(profile)
  if (!parseMcpInstances(text).some((entry) => entry.id === id)) {
    return { ok: false, reason: `not installed: ${id}` }
  }
  try {
    await loader.remove(id)
  } catch (error) {
    return { ok: false, reason: `deactivation failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  try {
    writePatchText(profile, withManagedEntries(text, (entries) => {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index !== -1) entries.splice(index, 1)
    }))
  } catch (error) {
    return { ok: false, reason: `persist failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, id }
}

/** Enable/disable a server (id-targeted override row + loader update). */
export async function toggleServer(
  loader: LoaderLike,
  profile: string,
  id: string,
  disabled: boolean,
): Promise<ManageResult> {
  const text = readPatchText(profile)
  if (!parseMcpInstances(text).some((entry) => entry.id === id)) {
    return { ok: false, reason: `not installed: ${id}` }
  }
  try {
    await loader.update(id, { disabled })
  } catch (error) {
    return { ok: false, reason: `toggle failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  writePatchText(profile, withManagedEntries(text, (entries) => {
    const hit = entries.find((entry) => entry.id === id)
    if (hit) hit.disabled = disabled
  }))
  return { ok: true, id }
}

/** Replace a server's config (the mcp-client HMR reconnects on update). */
export async function updateServerConfig(
  loader: LoaderLike,
  profile: string,
  id: string,
  input: NewServer,
): Promise<ManageResult> {
  const validation = validateNewServer(input)
  if (validation.error) return { ok: false, reason: validation.error }
  const text = readPatchText(profile)
  if (!parseMcpInstances(text).some((entry) => entry.id === id)) {
    return { ok: false, reason: `not installed: ${id}` }
  }
  const config = buildMcpConfig(input)
  try {
    await loader.update(id, { config })
  } catch (error) {
    return { ok: false, reason: `update failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  writePatchText(profile, withManagedEntries(text, (entries) => {
    const hit = entries.find((entry) => entry.id === id)
    if (hit) hit.config = config
  }))
  return { ok: true, id }
}
