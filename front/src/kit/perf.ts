/**
 * Low-performance mode: adds `.low-perf` to <html>, which drops backdrop blur and the animated
 * mesh (see index.css / kit.css). "auto" enables it on weak devices or data-saver connections.
 */
export type PerfMode = 'auto' | 'on' | 'off'

const KEY = 'ui:low-perf'

export function getPerfMode(): PerfMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function isWeakDevice(): boolean {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean }
  }
  return (
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) ||
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ||
    nav.connection?.saveData === true
  )
}

export function applyPerfMode(mode: PerfMode = getPerfMode()): boolean {
  const low = mode === 'on' || (mode === 'auto' && isWeakDevice())
  document.documentElement.classList.toggle('low-perf', low)
  return low
}

export function setPerfMode(mode: PerfMode): boolean {
  try {
    if (mode === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // Not persisted; still applied for this session.
  }
  return applyPerfMode(mode)
}
