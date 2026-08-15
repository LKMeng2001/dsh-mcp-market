/**
 * MCP marketplace UI: a settings section that browses the server catalog and
 * manages installed MCP servers through the /mcp-market/* host routes.
 *
 * Styling uses inline styles on purpose: the client bundle must stay free of
 * CSS-asset plumbing so the build script stays a single esbuild call.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'

export type Translate = (key: string) => string

interface RegistryServer {
  name: string
  category?: string
  description?: { en?: string; zh?: string }
  homepage?: string
  tags?: string[]
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  npmPackage?: string
  npmOk?: boolean
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  envHint?: string[]
  placeholder?: boolean
  added?: string
}

interface Registry {
  name?: string
  url?: string
  updated?: string
  count?: number
  categories?: Record<string, { en: string; zh: string }>
  servers: RegistryServer[]
}

interface McpInstance {
  id: string
  config: Record<string, unknown>
  disabled: boolean
  managed: boolean
}

interface NewServerPayload {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  npmPackage?: string
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

const styles = {
  root: { padding: '4px 2px 24px' } as const,
  head: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' as const },
  title: { margin: 0, fontSize: 18, fontWeight: 600 } as const,
  sub: { margin: '4px 0 12px', color: 'var(--text2, #8a8f98)', fontSize: 13 } as const,
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' as const },
  search: { flex: '1 1 220px', minWidth: 180 } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 } as const,
  card: {
    border: '1px solid var(--border2, #2b2d31)',
    borderRadius: 10,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  cardName: { margin: 0, fontSize: 15, fontWeight: 600, fontFamily: 'monospace' } as const,
  cardDesc: { margin: 0, fontSize: 13, color: 'var(--text2, #8a8f98)', minHeight: 34 } as const,
  cardMeta: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 6 } as const,
  badge: {
    fontSize: 11,
    padding: '1px 7px',
    borderRadius: 999,
    border: '1px solid var(--border2, #2b2d31)',
    color: 'var(--text2, #8a8f98)',
  } as const,
  badgePlaceholder: { borderColor: '#b8860b', color: '#b8860b' } as const,
  badgeMissing: { borderColor: '#e5484d', color: '#e5484d' } as const,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    border: '1px solid var(--border2, #2b2d31)',
    borderRadius: 10,
    marginBottom: 6,
    flexWrap: 'wrap' as const,
  },
  rowMain: { flex: '1 1 240px', minWidth: 0 } as const,
  rowId: { fontFamily: 'monospace', fontSize: 13, margin: 0 } as const,
  rowSub: { fontSize: 12, color: 'var(--text2, #8a8f98)', margin: '2px 0 0' } as const,
  form: { display: 'flex', flexDirection: 'column' as const, gap: 10 } as const,
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 } as const,
  label: { fontSize: 12, color: 'var(--text2, #8a8f98)' } as const,
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '6px 9px',
    borderRadius: 8,
    border: '1px solid var(--border2, #2b2d31)',
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  textarea: { minHeight: 52, resize: 'vertical' as const, fontFamily: 'monospace' as const },
  hint: { fontSize: 11, color: '#b8860b', margin: 0 } as const,
  err: { fontSize: 12, color: '#e5484d', margin: 0 } as const,
  empty: { color: 'var(--text2, #8a8f98)', padding: '24px 0', textAlign: 'center' as const },
  toast: {
    position: 'fixed' as const,
    bottom: 18,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--bg2, #222)',
    border: '1px solid var(--border2, #2b2d31)',
    borderRadius: 10,
    padding: '8px 16px',
    fontSize: 13,
    zIndex: 9999,
    boxShadow: '0 6px 24px rgba(0,0,0,.35)',
  },
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

interface InstallModalProps {
  t: Translate
  server?: RegistryServer
  editing?: { id: string; config: Record<string, unknown> }
  busy: boolean
  error: string
  onConfirm: (payload: NewServerPayload) => void
  onClose: () => void
}

function InstallModal({ t, server, editing, busy, error, onConfirm, onClose }: InstallModalProps) {
  const initial = server ?? ({} as RegistryServer)
  const [serverName, setServerName] = useState(editing ? String(editing.config.serverName ?? '') : (initial.name ?? ''))
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>(
    editing ? (editing.config.transport === 'streamable-http' ? 'streamable-http' : 'stdio') : (initial.transport ?? 'stdio'),
  )
  const [command, setCommand] = useState(editing ? String(editing.config.command ?? '') : (initial.command ?? ''))
  const [argsText, setArgsText] = useState(
    editing
      ? (Array.isArray(editing.config.args) ? (editing.config.args as string[]).join(' ') : '')
      : (initial.args ?? []).join(' '),
  )
  const [envText, setEnvText] = useState(
    editing ? JSON.stringify(editing.config.env ?? {}, null, 2) : JSON.stringify(initial.env ?? {}, null, 2),
  )
  const [url, setUrl] = useState(editing ? String(editing.config.url ?? '') : (initial.url ?? ''))
  const [headersText, setHeadersText] = useState(
    editing ? JSON.stringify(editing.config.headers ?? {}, null, 2) : JSON.stringify(initial.headers ?? {}, null, 2),
  )
  const [cwd, setCwd] = useState(editing ? String(editing.config.cwd ?? '') : '')
  const [localError, setLocalError] = useState('')

  const envHint = server?.envHint ?? []

  const confirm = () => {
    let env: Record<string, string> | undefined
    let headers: Record<string, string> | undefined
    try {
      env = envText.trim() === '' ? undefined : JSON.parse(envText)
      headers = headersText.trim() === '' ? undefined : JSON.parse(headersText)
    } catch {
      setLocalError(t('fail') + ': JSON')
      return
    }
    if (transport === 'stdio' && command.trim() === '') {
      setLocalError(t('fail'))
      return
    }
    const args = argsText.trim() === '' ? undefined : argsText.trim().split(/\s+/)
    onConfirm({
      serverName: serverName.trim(),
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args,
      npmPackage: server?.npmPackage,
      env,
      cwd: cwd.trim() === '' ? undefined : cwd.trim(),
      url: transport === 'streamable-http' ? url.trim() : undefined,
      headers,
    })
  }

  const isHttp = transport === 'streamable-http'

  return (
    <Modal open onClose={onClose} title={t('addTitle')} description={t('addWarn')} footer={
      <>
        <Button variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={confirm}>
          {busy ? t('installing') : (editing ? t('confirmUpdate') : t('confirm'))}
        </Button>
      </>
    }>
      <div style={styles.form}>
        {!editing && envHint.length > 0 && (
          <p style={styles.hint}>{t('envHint')} {envHint.join(', ')}</p>
        )}
        <div style={styles.field}>
          <label style={styles.label}>{t('serverName')}</label>
          <input style={styles.input} value={serverName} onChange={(e) => setServerName(e.target.value)} spellCheck={false} />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>{t('transport')}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Pill active={!isHttp} onClick={() => setTransport('stdio')}>{t('transportStdio')}</Pill>
            <Pill active={isHttp} onClick={() => setTransport('streamable-http')}>{t('transportHttp')}</Pill>
          </div>
        </div>
        {isHttp ? (
          <>
            <div style={styles.field}>
              <label style={styles.label}>{t('url')}</label>
              <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('headers')}</label>
              <textarea style={{ ...styles.input, ...styles.textarea }} value={headersText} onChange={(e) => setHeadersText(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div style={styles.field}>
              <label style={styles.label}>{t('command')}</label>
              <input style={styles.input} value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('args')}</label>
              <input style={styles.input} value={argsText} onChange={(e) => setArgsText(e.target.value)} spellCheck={false} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('env')}</label>
              <textarea style={{ ...styles.input, ...styles.textarea }} value={envText} onChange={(e) => setEnvText(e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('cwd')}</label>
              <input style={styles.input} value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
            </div>
          </>
        )}
        {(localError || error) && <p style={styles.err}>{localError || error}</p>}
      </div>
    </Modal>
  )
}

export function McpMarket({ t }: { t: Translate }) {
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [source, setSource] = useState('')
  const [installed, setInstalled] = useState<McpInstance[]>([])
  const [present, setPresent] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<'discover' | 'installed'>('discover')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ server?: RegistryServer; editing?: { id: string; config: Record<string, unknown> } } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    fetchJson<{ registry: Registry; source: string }>('/mcp-market/registry')
      .then((body) => { setRegistry(body.registry); setSource(body.source) })
      .catch(() => setError(t('loadFail')))
    fetchJson<{ servers: McpInstance[]; present: Record<string, boolean> }>('/mcp-market/installed')
      .then((body) => { setInstalled(body.servers ?? []); setPresent(body.present ?? {}) })
      .catch(() => {})
  }, [t])

  useEffect(() => { refresh() }, [refresh])

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3000)
  }, [])

  const installedIds = useMemo(() => new Set(installed.map((item) => item.id)), [installed])

  const post = useCallback(async (path: string, payload: unknown, okMessage: string) => {
    try {
      const body = await fetchJson<{ ok: boolean; reason?: string }>(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!body.ok) throw new Error(body.reason ?? 'failed')
      flash(okMessage)
      refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [flash, refresh])

  const run = useCallback(async (id: string, task: () => Promise<boolean>) => {
    setBusyId(id)
    const ok = await task()
    setBusyId(null)
    return ok
  }, [])

  const doInstall = useCallback(async (payload: NewServerPayload) => {
    setModal(null)
    await run(payload.serverName, () => post('/mcp-market/install', payload, t('toastInstalled')))
  }, [post, run, t])

  const doRemove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmRemove').replace('{name}', id))) return
    await run(id, () => post('/mcp-market/remove', { id }, t('toastRemoved')))
  }, [post, run, t])

  const doToggle = useCallback(async (id: string, disabled: boolean) => {
    await run(id, () => post('/mcp-market/toggle', { id, disabled }, t('toastToggled')))
  }, [post, run, t])

  const doUpdate = useCallback(async (id: string, payload: NewServerPayload) => {
    setModal(null)
    await run(id, () => post('/mcp-market/update', { id, config: payload }, t('toastUpdated')))
  }, [post, run, t])

  const lang = (document.documentElement.lang === 'zh' ? 'zh' : 'en') as 'zh' | 'en'

  const categories = registry?.categories ?? {}
  const filtered = useMemo(() => {
    const list = registry?.servers ?? []
    const q = query.trim().toLowerCase()
    return list.filter((server) => {
      if (category !== 'all' && server.category !== category) return false
      if (q === '') return true
      const hay = `${server.name} ${server.tags?.join(' ')} ${server.description?.en ?? ''} ${server.description?.zh ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [registry, query, category])

  const desc = (server: RegistryServer) => server.description?.[lang] ?? server.description?.en ?? t('noDesc')

  return (
    <div style={styles.root}>
      <div style={styles.head}>
        <h2 style={styles.title}>{t('nav')}</h2>
        <Button variant="ghost" size="sm" onClick={refresh}>{t('refresh')}</Button>
      </div>
      <p style={styles.sub}>{t('subtitle')} · {t('source')}: {source}</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <Pill active={tab === 'discover'} onClick={() => setTab('discover')}>{t('tabDiscover')}</Pill>
        <Pill active={tab === 'installed'} onClick={() => setTab('installed')}>{t('tabInstalled')}</Pill>
      </div>

      {error && <p style={styles.err}>{error}</p>}

      {tab === 'discover' ? (
        <>
          <div style={styles.toolbar}>
            <div style={styles.search}>
              <Input
                placeholder={t('searchPh')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div style={styles.toolbar}>
            <Pill active={category === 'all'} onClick={() => setCategory('all')}>{t('all')}</Pill>
            {Object.entries(categories).map(([key, meta]) => (
              <Pill key={key} active={category === key} onClick={() => setCategory(key)}>
                {meta[lang] ?? meta.en}
              </Pill>
            ))}
          </div>
          {registry === null ? (
            <p style={styles.empty}>{t('loading')}</p>
          ) : filtered.length === 0 ? (
            <p style={styles.empty}>{t('empty')}</p>
          ) : (
            <div style={styles.grid}>
              {filtered.map((server) => {
                const id = `mcp-${server.name}`
                const installedFlag = installedIds.has(id)
                const missing = server.npmOk === false
                return (
                  <div key={server.name} style={styles.card}>
                    <p style={styles.cardName}>{server.name}</p>
                    <p style={styles.cardDesc}>{desc(server)}</p>
                    <div style={styles.cardMeta}>
                      <span style={{ ...styles.badge, ...(server.placeholder ? styles.badgePlaceholder : {}) }}>
                        {server.transport}
                      </span>
                      {server.placeholder && <span style={{ ...styles.badge, ...styles.badgePlaceholder }}>{t('placeholderBadge')}</span>}
                      {missing && <span style={{ ...styles.badge, ...styles.badgeMissing }}>{t('pkgMissing')}</span>}
                      {(server.envHint ?? []).length > 0 && <span style={styles.badge}>{server.envHint!.join(',')}</span>}
                      {server.tags?.slice(0, 3).map((tag) => <span key={tag} style={styles.badge}>{tag}</span>)}
                    </div>
                    {missing && <p style={styles.err}>{t('pkgMissingHint')}</p>}
                    <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                      {installedFlag ? (
                        <Button variant="ghost" size="sm" disabled>{t('installedBadge')}</Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busyId !== null || missing}
                          onClick={() => setModal({ server })}
                        >
                          {busyId === server.name ? t('installing') : t('install')}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => setModal({})}>{t('addManual')}</Button>
          </div>
        </>
      ) : (
        <>
          {installed.length === 0 ? (
            <p style={styles.empty}>{t('installedEmpty')}</p>
          ) : (
            installed.map((item) => {
              const id = item.id
              const config = item.config
              const transportValue = config.transport === 'streamable-http' ? String(config.url ?? 'streamable-http') : `${String(config.command ?? '?')} ${Array.isArray(config.args) ? (config.args as string[]).join(' ') : ''}`
              return (
                <div key={id} style={styles.row}>
                  <div style={styles.rowMain}>
                    <p style={styles.rowId}>{id}</p>
                    <p style={styles.rowSub}>
                      {transportValue}
                      {item.disabled && ` · ${t('disabledBadge')}`}
                      {present[id] !== undefined && ` · ${present[id] ? t('presentBadge') : t('absentBadge')}`}
                    </p>
                  </div>
                  <span style={styles.badge}>{item.managed ? t('managedBadge') : t('manualBadge')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => doToggle(id, !item.disabled)}
                  >
                    {item.disabled ? t('enable') : t('disable')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setModal({ editing: { id, config } })}>
                    {t('edit')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={busyId !== null} onClick={() => doRemove(id)}>
                    {busyId === id ? t('removing') : t('remove')}
                  </Button>
                </div>
              )
            })
          )}
        </>
      )}

      {modal && (
        <InstallModal
          t={t}
          server={modal.server}
          editing={modal.editing}
          busy={busyId !== null}
          error=""
          onConfirm={(payload) => {
            if (modal.editing) void doUpdate(modal.editing.id, payload)
            else void doInstall(payload)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  )
}
