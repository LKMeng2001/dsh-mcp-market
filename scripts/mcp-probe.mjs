/**
 * MCP handshake probe: spawn an npx MCP server, perform initialize +
 * tools/list over stdio, print the outcome. Used to prove a catalog entry
 * is actually usable end-to-end.
 *
 *   node scripts/mcp-probe.mjs [package] [args...]
 *   e.g. node scripts/mcp-probe.mjs @modelcontextprotocol/server-everything
 */

import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'

const pkg = process.argv[2] ?? '@modelcontextprotocol/server-everything'
const extraArgs = process.argv.slice(3)

// npx is a .cmd shim on Windows; spawn it through node + npm's npx-cli.js so
// this probe works cross-platform without a shell.
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
const child = spawn(process.execPath, [npxCli, '-y', pkg, ...extraArgs], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
const replies = new Map()

child.stdout.on('data', (d) => {
  stdout += d
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if (msg.id !== undefined) replies.set(String(msg.id), msg)
    } catch { /* partial line */ }
  }
})
child.stderr.on('data', (d) => { stderr += d })

const send = (id, method, params) => {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
}

const timer = setTimeout(() => {
  console.log('TIMEOUT — server did not respond in time')
  console.log('--- stderr (tail) ---')
  console.log(stderr.slice(-600))
  child.kill()
  process.exit(3)
}, 90_000)

send(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'dsh-mcp-market-probe', version: '0.0.1' },
})

const started = Date.now()
const poll = setInterval(() => {
  const init = replies.get('1')
  if (!init) return
  clearInterval(timer)
  clearInterval(poll)
  const serverInfo = init.result?.serverInfo
  console.log(`initialize OK (${Date.now() - started}ms)`)
  console.log('serverInfo:', JSON.stringify(serverInfo))
  send(2, 'tools/list', {})
  const pollTools = setInterval(() => {
    const tools = replies.get('2')
    if (!tools) return
    clearInterval(pollTools)
    const names = (tools.result?.tools ?? []).map((t) => t.name)
    console.log(`tools/list OK — ${names.length} tools`)
    console.log('--- all tools ---')
    console.log(names.join('\n'))
    child.kill()
    console.log('\nPROBE PASSED — entry is usable')
    process.exit(0)
  }, 300)
}, 300)
