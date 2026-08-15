/**
 * Rebuild both fork READMEs from upstream main's current content (LF) plus
 * ONLY the dsh-mcp-market entry. Fixes PR #513's dirty state caused by the
 * fork files being committed with CRLF line endings (whole-file diff).
 *
 *   GH_TOKEN=<token> node scripts/rebuild-pr-readmes.mjs
 */

const token = process.env.GH_TOKEN
const FORK = 'LKMeng2001/awesome-dsh-plugin'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const HEADERS = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'dsh-pr-fix',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

const MY_EN =
  '- [LKMeng2001/dsh-mcp-market](https://github.com/LKMeng2001/dsh-mcp-market) - MCP server marketplace for DSH: browse a curated, npm-verified catalog and install MCP servers into the current profile with one click, live without restart.'
const MY_ZH =
  '- [LKMeng2001/dsh-mcp-market](https://github.com/LKMeng2001/dsh-mcp-market) — DSH 的 MCP 服务器商场：浏览经过 npm 校验的精选目录，一键安装 MCP 服务器到当前 profile，免重启立即生效。'

const upstreamRaw = async (path) => {
  const res = await fetch(`https://raw.githubusercontent.com/${UPSTREAM}/main/${path}`)
  if (!res.ok) throw new Error(`raw ${path} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer()).toString('utf8')
}

const putFile = async (path, content) => {
  const get = await fetch(`https://api.github.com/repos/${FORK}/contents/${path}?ref=main`, { headers: HEADERS })
  if (get.status !== 200) throw new Error(`GET ${path} -> HTTP ${get.status}`)
  const meta = await get.json()
  const put = await fetch(`https://api.github.com/repos/${FORK}/contents/${path}`, {
    method: 'PUT',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'add dsh-mcp-market to Plugin Markets (rebuild from upstream, LF)',
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: meta.sha,
      branch: 'main',
    }),
  })
  const body = await put.json()
  console.log(`PUT ${path}:`, put.status, put.status === 200 ? `(sha ${body.commit?.sha?.slice(0, 7)})` : JSON.stringify(body).slice(0, 200))
  return put.status === 200
}

const addEntry = (text, headingRe, line) => {
  const lines = text.split('\n')
  let section = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) { section = i; break }
  }
  if (section === -1) throw new Error('section heading not found')
  let lastEntry = section
  for (let i = section + 1; i < lines.length && !/^### /.test(lines[i]); i++) {
    if (/^- \[/.test(lines[i])) lastEntry = i
  }
  lines.splice(lastEntry + 1, 0, line)
  return lines.join('\n')
}

// README.md (EN)
const en = await upstreamRaw('README.md')
if (en.includes('dsh-mcp-market')) console.log('EN: entry already present — skipping insert')
else await putFile('README.md', addEntry(en, /^### Plugin Markets & Managers/, MY_EN))

// README.zh.md (ZH)
const zh = await upstreamRaw('README.zh.md')
if (zh.includes('dsh-mcp-market')) console.log('ZH: entry already present — skipping insert')
else await putFile('README.zh.md', addEntry(zh, /^### .*插件市场与管理/, MY_ZH))

console.log('done — PR #513 diff should now be a single added line per file.')
