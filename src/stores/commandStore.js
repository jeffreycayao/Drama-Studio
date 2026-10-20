import { create } from 'zustand'

/**
 * Command registry behind the command palette (Ctrl+Shift+P) and the
 * Inspector's quick actions.
 *
 * Components that own an action register a *provider*: a function that
 * returns the commands it can run right now, reading its latest handlers
 * from a ref. Providers are called when the palette opens or the selection
 * changes, so commands are always current without re-registering.
 *
 * A command:
 *   { id, title, group, keywords?, icon? (a lucide component), shortcut?, where?,
 *     clipTypes?,              // quick action for these selected clip types
 *     available?(ctx) -> true | 'reason it is not available',
 *     run(ctx) }
 * `where` says where the action normally lives ("Right-click a video clip"),
 * so the palette also teaches the menus.
 */

const providers = new Map()

export function registerCommandProvider(id, provider) {
  providers.set(id, provider)
  useCommandStore.getState().bump()
  return () => {
    if (providers.get(id) === provider) {
      providers.delete(id)
      useCommandStore.getState().bump()
    }
  }
}

export function collectCommands(context = {}) {
  const seen = new Set()
  const out = []
  for (const provider of providers.values()) {
    let list = []
    try {
      list = provider(context) || []
    } catch (error) {
      console.warn('[commands] provider failed', error)
    }
    for (const command of list) {
      if (!command?.id || seen.has(command.id) || typeof command.run !== 'function') continue
      seen.add(command.id)
      out.push(command)
    }
  }
  return out
}

/** true, or a short reason the command cannot run in this context. */
export function commandAvailability(command, context = {}) {
  if (typeof command?.available !== 'function') return true
  try {
    const result = command.available(context)
    return result === true || result === undefined ? true : (result || 'Not available right now.')
  } catch {
    return 'Not available right now.'
  }
}

export function runCommandById(id, context = {}) {
  const command = collectCommands(context).find((item) => item.id === id)
  if (!command) return false
  if (commandAvailability(command, context) !== true) return false
  command.run(context)
  return true
}

const useCommandStore = create((set) => ({
  open: false,
  // Bumped when providers change so subscribers (Inspector quick actions) re-read.
  version: 0,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((state) => ({ open: !state.open })),
  bump: () => set((state) => ({ version: state.version + 1 })),
}))

export default useCommandStore
