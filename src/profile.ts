/**
 * Profile patch-layer filesystem access: everything the marketplace learns
 * about configured MCP servers comes from the profile's `cordis.patch.yml`,
 * and every install/remove/toggle persists back into it inside a
 * marketplace-managed comment block (so user edits elsewhere are preserved).
 *
 * The managed block is plain YAML: a top-level array of loader patch entries —
 * `insert` rows for each MCP server (name @deepseek-ai/dsh-mcp-client) plus an
 * optional `id: ... / disabled: true` override row. It is regenerated on every
 * change, which keeps round-tripping lossless for the data we own.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { McpInstance } from './types.js'

export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
const MANAGED_HEAD = '# --- dsh-mcp-market managed (auto-generated; do not edit) ---'
const MANAGED_TAIL = '# --- end dsh-mcp-market managed ---'

/** Resolve a profile name to its directory under DSH_HOME (default ~/.dsh). */
export function profileDir(profile: string): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', profile)
}

export function patchFilePath(profile: string): string {
  return join(profileDir(profile), 'cordis.patch.yml')
}

export function readPatchText(profile: string): string {
  try {
    return readFileSync(patchFilePath(profile), 'utf8')
  } catch {
    return ''
  }
}

export function writePatchText(profile: string, text: string): void {
  writeFileSync(patchFilePath(profile), text, 'utf8')
}

/** One MCP server row owned by the managed block. */
export interface ManagedEntry {
  id: string
  name: string
  config: Record<string, unknown>
  disabled: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The managed comment block of the patch text, or '' when absent. */
function extractManagedBlock(text: string): string {
  const re = new RegExp(`${escapeRegExp(MANAGED_HEAD)}[\\s\\S]*?${escapeRegExp(MANAGED_TAIL)}`)
  const match = text.match(re)
  return match ? match[0] : ''
}

/** Patch text with the managed block removed (blank lines collapsed). */
function stripManagedBlock(text: string): string {
  const block = extractManagedBlock(text)
  if (!block) return text
  return text.replace(block, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
}

/** Parse the marketplace-managed entries out of a patch text. */
export function parseManagedEntries(text: string): ManagedEntry[] {
  const entries: ManagedEntry[] = []
  const block = extractManagedBlock(text)
  if (!block) return entries
  try {
    const root = yaml.load(block) as unknown
    if (!Array.isArray(root)) return entries
    for (const node of root) {
      if (!node || typeof node !== 'object') continue
      const n = node as Record<string, unknown>
      if (Array.isArray(n.insert)) {
        for (const ins of n.insert as Array<Record<string, unknown>>) {
          if (ins && typeof ins.id === 'string' && typeof ins.name === 'string') {
            entries.push({
              id: ins.id,
              name: ins.name,
              config: (ins.config as Record<string, unknown>) ?? {},
              disabled: false,
            })
          }
        }
      } else if (typeof n.id === 'string' && n.disabled === true) {
        const hit = entries.find((entry) => entry.id === n.id)
        if (hit) hit.disabled = true
      }
    }
  } catch {
    // Generated blocks always parse; treat a malformed block as empty.
  }
  return entries
}

/** Render the managed block from its entries (as YAML array rows). */
function renderManagedBlock(entries: ManagedEntry[]): string {
  const lines: string[] = []
  lines.push('', MANAGED_HEAD)
  for (const entry of entries) {
    lines.push(yaml.dump([{ insert: [{ id: entry.id, name: entry.name, config: entry.config }] }], {
      lineWidth: 160,
      noRefs: true,
    }).trimEnd())
    if (entry.disabled) {
      lines.push(yaml.dump([{ id: entry.id, disabled: true }], { noRefs: true }).trimEnd())
    }
  }
  lines.push(MANAGED_TAIL, '')
  return lines.join('\n')
}

/**
 * Return a new patch text with the managed entries mutated by `mutate`.
 * Non-managed user content is preserved verbatim. When the file is empty or
 * a bare `[]`, the managed block becomes the whole document.
 */
export function withManagedEntries(text: string, mutate: (entries: ManagedEntry[]) => void): string {
  const entries = parseManagedEntries(text)
  mutate(entries)
  const rest = stripManagedBlock(text).trimEnd().replace(/\n+$/, '')
  const emptyBase = rest === '' || rest === '[]' || rest === '---'
  if (emptyBase) {
    if (entries.length === 0) return '[]\n'
    return renderManagedBlock(entries).replace(/^\n/, '')
  }
  return rest + renderManagedBlock(entries)
}

/**
 * All MCP server instances declared anywhere in the patch layer — including
 * servers the user configured by hand outside the managed block.
 */
export function parseMcpInstances(text: string): McpInstance[] {
  const managed = new Map(parseManagedEntries(text).map((entry) => [entry.id, entry]))
  const instances: McpInstance[] = []

  // Full YAML parse; falls back to a line scan when the file contains
  // !!js expressions or other constructs this package cannot parse.
  let parsed: unknown = null
  try {
    parsed = yaml.load(text)
  } catch {
    parsed = null
  }
  if (Array.isArray(parsed)) {
    const disabledIds = new Set<string>()
    const found: McpInstance[] = []
    for (const node of parsed) {
      if (!node || typeof node !== 'object') continue
      const n = node as Record<string, unknown>
      // An id-targeted `disabled: true` override may appear anywhere in the
      // document (usually after the insert row), so apply it in a second pass.
      if (typeof n.id === 'string' && n.disabled === true) disabledIds.add(n.id)
      if (!Array.isArray(n.insert)) continue
      for (const ins of n.insert as Array<Record<string, unknown>>) {
        if (ins && ins.name === MCP_CLIENT_PACKAGE && typeof ins.id === 'string') {
          found.push({
            id: ins.id,
            config: (ins.config as Record<string, unknown>) ?? {},
            disabled: ins.disabled === true,
            managed: managed.has(ins.id),
          })
        }
      }
    }
    for (const instance of found) {
      if (disabledIds.has(instance.id)) instance.disabled = true
    }
    return found
  }

  // Fallback scan: `- id: X` rows followed by a matching mcp-client name line.
  const lines = text.split('\n')
  let pendingId: string | null = null
  for (const line of lines) {
    const idMatch = /^\s*-\s*id:\s*([A-Za-z0-9_.-]+)\s*$/.exec(line)
    if (idMatch) {
      pendingId = idMatch[1]
      continue
    }
    if (pendingId !== null) {
      if (line.includes(`name: '${MCP_CLIENT_PACKAGE}'`)) {
        instances.push({ id: pendingId, config: {}, disabled: false, managed: managed.has(pendingId) })
        pendingId = null
      } else if (/^\s*-\s/.test(line) && !/^\s*-\s*id:/.test(line)) {
        pendingId = null
      }
    }
  }
  return instances
}
