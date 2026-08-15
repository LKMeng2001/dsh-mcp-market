/**
 * Re-align the fork's zh README zoahdev line with upstream's current fixed
 * version, so PR #513's diff contains ONLY the dsh-mcp-market entry (the
 * upstream corruption was already fixed by maintainers; our own fix of the
 * same line created a merge conflict / dirty PR).
 *
 *   GH_TOKEN=<token> node scripts/fix-pr-zh.mjs
 */

const token = process.env.GH_TOKEN
const FORK = 'LKMeng2001/awesome-dsh-plugin'
const HEADERS = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'dsh-pr-fix',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

// The line exactly as upstream main currently has it.
const upstreamLine =
  '- [zoahdev/dsh-subscribe#plugin](https://github.com/zoahdev/dsh-subscribe/tree/main/plugin) — Steam 风格的插件商店：在 DSH 里浏览插件注册表，一键安装、卸载与更新，另有零依赖 CLI 与可供 agent 调用的市场工具。'

// 1. fetch current fork zh README
const get = await fetch(`https://api.github.com/repos/${FORK}/contents/README.zh.md?ref=main`, { headers: HEADERS })
if (get.status !== 200) { console.error('GET failed:', get.status, await get.text()); process.exit(1) }
const meta = await get.json()
const current = Buffer.from(meta.content, 'base64').toString('utf8')

// 2. replace ANY zoahdev/dsh-subscribe list line with the upstream version
const bad = /^- \[zoahdev\/dsh-subscribe[^\n]*$/m
if (!bad.test(current)) { console.error('zoahdev line not found in fork — nothing to do'); process.exit(2) }
const updated = current.replace(bad, upstreamLine)
if (updated === current) { console.error('replacement produced no change — aborting'); process.exit(3) }

// 3. PUT back
const put = await fetch(`https://api.github.com/repos/${FORK}/contents/README.zh.md`, {
  method: 'PUT',
  headers: { ...HEADERS, 'content-type': 'application/json' },
  body: JSON.stringify({
    message: 'align zoahdev/dsh-subscribe zh line with upstream fix (drop conflicting edit)',
    content: Buffer.from(updated, 'utf8').toString('base64'),
    sha: meta.sha,
    branch: 'main',
  }),
})
const putBody = await put.json()
console.log('PUT status:', put.status, put.status === 200 ? `(new sha ${putBody.commit?.sha?.slice(0, 7)})` : JSON.stringify(putBody).slice(0, 300))
