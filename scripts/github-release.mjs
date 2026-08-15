/**
 * One-shot GitHub release helper: everything the two onboarding tasks need,
 * run in a single process so a short-lived token is used within its window.
 * Uses the REST API (Bearer) for all repo/file/PR operations and tries git
 * push first for our own repo (Contents API fallback).
 *
 *   GH_TOKEN=<token> node scripts/github-release.mjs
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const token = process.env.GH_TOKEN
if (!token) {
  console.error('GH_TOKEN not set')
  process.exit(2)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const awesomeDir = join(root, '..', '_awesome-tmp')
const OUR = 'LKMeng2001/dsh-mcp-market'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'

const api = async (method, path, body) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dsh-mcp-market-release',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  return { status: res.status, json }
}

const ok = (r, label) => {
  if (r.status >= 200 && r.status < 300) {
    console.log(`  ok  ${label}`)
    return true
  }
  console.log(`FAIL  ${label} (HTTP ${r.status}): ${JSON.stringify(r.json?.message ?? r.json)?.slice(0, 160)}`)
  return false
}

const main = async () => {
  // 1. verify token
  const me = await api('GET', '/user')
  if (!ok(me, 'token /user')) { console.log('Token invalid — stopping.'); process.exit(1) }
  console.log(`token OK: ${me.json.login}`)

  // 2. topics on our repo
  ok(await api('PUT', `/repos/${OUR}/topics`, { names: ['dsh-plugin', 'mcp'] }), 'add dsh-plugin topic')

  // 3. fork upstream (idempotent)
  let fork = await api('GET', `/repos/LKMeng2001/awesome-dsh-plugin`)
  if (fork.status === 404) {
    fork = await api('POST', `/repos/${UPSTREAM}/forks`, {})
    ok(fork, 'fork awesome-dsh-plugin')
  } else {
    console.log('  ok  fork already exists')
  }

  // 4. write both READMEs to the fork's main branch via Contents API
  const putFile = async (repo, path, branch, localPath) => {
    const existing = await api('GET', `/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`)
    const content = Buffer.from(readFileSync(localPath, 'utf8')).toString('base64')
    const body = { message: `Add dsh-mcp-market to Plugin Markets & Managers (${path})`, content, branch }
    if (existing.status === 200 && existing.json?.sha) body.sha = existing.json.sha
    return api('PUT', `/repos/${repo}/contents/${encodeURIComponent(path)}`, body)
  }
  ok(await putFile('LKMeng2001/awesome-dsh-plugin', 'README.md', 'main', join(awesomeDir, 'README.md')), 'fork README.md updated')
  ok(await putFile('LKMeng2001/awesome-dsh-plugin', 'README.zh.md', 'main', join(awesomeDir, 'README.zh.md')), 'fork README.zh.md updated')

  // 5. create the PR
  const pr = await api('POST', `/repos/${UPSTREAM}/pulls`, {
    title: 'Add dsh-mcp-market to Plugin Markets & Managers',
    head: 'LKMeng2001:main',
    base: 'main',
    body: [
      `Adds [LKMeng2001/dsh-mcp-market](https://github.com/LKMeng2001/dsh-mcp-market) to the **Plugin Markets & Managers** category.`,
      '',
      'MCP server marketplace for DeepSeek Harness: browse a curated, npm-verified catalog and install MCP servers into the current profile with one click, live without restart.',
      '',
      'Checklist:',
      '- Declares `dsh.bundle` manifest + `cordis.patch.yml`',
      '- Published to npm (`dsh-mcp-market@0.1.1`)',
      '- `dsh-plugin` topic added',
      '- Real, working code (host routes + client UI + tests + CI)',
    ].join('\n'),
  })
  if (ok(pr, 'create PR')) console.log(`PR: ${pr.json.html_url}`)

  // 6. push our repo's 0.1.1 changes — try git first, fall back to Contents API
  const gitPush = () => {
    try {
      execFileSync('git', ['-c', 'http.proxy=http://127.0.0.1:7890', '-c', 'https.proxy=http://127.0.0.1:7890',
        'push', `https://x-access-token:${token}@github.com/${OUR}.git`, 'main'], { cwd: root, stdio: 'pipe' })
      console.log('  ok  git push our repo (main)')
      return true
    } catch {
      console.log('  warn git push failed — falling back to Contents API')
      return false
    }
  }
  if (!gitPush()) {
    const files = [
      '.github/workflows/catalog-check.yml', 'README.md', 'README.zh.md',
      'data/registry-snapshot.json', 'docs/servers.json', 'package.json',
      'scripts/check-catalog.mjs', 'scripts/sync-catalog.mjs', 'src/registry.ts',
    ]
    for (const f of files) {
      ok(await putFile(OUR, f, 'main', join(root, f)), `push ${f}`)
    }
  }

  // 7. enable GitHub Pages (deploy from main, /docs)
  const pages = await api('PUT', `/repos/${OUR}/pages`, { source: { branch: 'main', path: '/docs' } })
  if (ok(pages, 'enable GitHub Pages')) console.log(`Pages: ${pages.json?.html_url ?? 'https://LKMeng2001.github.io/dsh-mcp-market/'}`)

  // 8. verify Pages serves servers.json
  try {
    const res = await fetch('https://LKMeng2001.github.io/dsh-mcp-market/servers.json', { signal: AbortSignal.timeout(10000) })
    console.log(`  ${res.ok ? 'ok' : 'warn'} Pages servers.json -> HTTP ${res.status}${res.ok ? ` (${(await res.text()).length} bytes)` : ' (first build may take a minute)'}`)
  } catch (error) {
    console.log(`  warn Pages not ready yet: ${error instanceof Error ? error.message : String(error)}`)
  }

  console.log('\nDone. PR + pages + push complete (or see FAIL lines above).')
}

main().catch((error) => {
  console.error('script error:', error)
  process.exit(1)
})
