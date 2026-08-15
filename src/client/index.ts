/**
 * dsh-mcp-market client entry: registers an "MCP Market" settings section
 * rendering the marketplace UI. Built by scripts/build-client.mjs into the
 * __ModuleLoader__ factory bundle at client/client.js; the only externals are
 * the loader module table's react entries and the ui-primitives platform
 * module.
 */

import { createElement as h } from 'react'
import { en, zh } from './locales.ts'
import { McpMarket } from './McpMarket.tsx'
import type { Translate } from './McpMarket.tsx'

const NS = 'dsh-mcp-market'

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The client cordis context shape this plugin relies on (structural typing:
 * the host provides the real Context; typing the touched surface keeps this
 * external package free of monorepo-internal type dependencies). */
interface MarketClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-mcp-market'
export const inject = ['slots', 'locale', 'theme']
export function apply(ctx: MarketClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-market: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-market',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(McpMarket, { t })))
}
