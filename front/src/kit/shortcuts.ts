/**
 * Keyboard-shortcut registry. Screens register handlers for the active document
 * (`useShortcutAction('print', handler)`); the shell's single global keydown listener
 * dispatches to the most recently mounted handler for each action.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'

export type ShortcutAction = 'new' | 'save' | 'print' | 'primary'

type Entry = { run: () => void }
const stacks: Record<ShortcutAction, Entry[]> = {
  new: [],
  save: [],
  print: [],
  primary: [],
}

/** Registers `handler` for `action` while mounted. Pass null/undefined/false to unregister. */
export function useShortcutAction(action: ShortcutAction, handler: (() => void) | null | undefined | false) {
  const ref = useRef(handler)
  useLayoutEffect(() => {
    ref.current = handler
  })
  const enabled = Boolean(handler)
  useEffect(() => {
    if (!enabled) return
    const entry: Entry = { run: () => ref.current && ref.current() }
    stacks[action].push(entry)
    return () => {
      const list = stacks[action]
      const index = list.lastIndexOf(entry)
      if (index >= 0) list.splice(index, 1)
    }
  }, [action, enabled])
}

/** Runs the top handler for `action`; false when none is registered. */
export function runShortcutAction(action: ShortcutAction): boolean {
  const top = stacks[action].at(-1)
  if (!top) return false
  top.run()
  return true
}

export const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD_KEY = IS_APPLE ? '⌘' : 'Ctrl'
export const ALT_KEY = IS_APPLE ? '⌥' : 'Alt'

/** Display label, e.g. `shortcutLabel('S')` → "Ctrl+S". */
export const shortcutLabel = (key: string, modifier: string = MOD_KEY) => `${modifier}+${key}`

export const SHORTCUT_LIST: readonly { keys: string; label: string }[] = [
  { keys: shortcutLabel('N'), label: 'إضافة سجل جديد' },
  { keys: shortcutLabel('S'), label: 'حفظ النموذج المفتوح' },
  { keys: shortcutLabel('P'), label: 'طباعة المستند أو التقرير' },
  { keys: shortcutLabel('K'), label: 'البحث الشامل في كل بيانات النظام' },
  { keys: shortcutLabel('F'), label: 'البحث في الشاشة' },
  { keys: 'Esc', label: 'إغلاق النافذة أو القائمة' },
  { keys: shortcutLabel('1', ALT_KEY), label: 'الانتقال إلى الحركة' },
  { keys: shortcutLabel('2', ALT_KEY), label: 'الانتقال إلى التقارير' },
]
