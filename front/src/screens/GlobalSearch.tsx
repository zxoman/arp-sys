import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarCheck,
  CalendarClock,
  CornerDownLeft,
  FileText,
  Handshake,
  LayoutGrid,
  ReceiptText,
  Search,
  SearchX,
  Undo2,
  UserCheck,
  UsersRound,
  Wrench,
  X,
  DoorOpen,
  BuildingComplex,
} from 'lucide-react'
import { Badge, Skeleton, type BadgeTone } from '@/components/ui'
import { egp, fmtDate, paymentLabel, useData } from '@/lib'
import { cn } from '@/lib/cn'
import { RecordPanel, matchesAll, normalizeSearch, type RecordView } from '@/kit'
import { IS_APPLE } from '@/kit/shortcuts'
import { RECEIPT_PREFILL_KEY } from './movement/shared'
import { useRecordViews } from './records'

/* ==================================================================
   Entity kinds
   ================================================================== */

export type RecordKind = 'client' | 'owner' | 'unit' | 'building' | 'reservation' | 'contract' | 'installment' | 'receipt' | 'return' | 'maintenance' | 'union'
type Kind = RecordKind | 'screen'
type Icon = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>

const KINDS: Record<Kind, { badge: string; plural: string; source: string; icon: Icon; tone: BadgeTone; tile: string; screen?: string }> = {
  client: { badge: 'عميل', plural: 'العملاء', source: 'من العملاء', icon: UsersRound, tone: 'indigo', tile: 'bg-primary-soft text-primary', screen: 'clients' },
  owner: { badge: 'مالك', plural: 'الملاك', source: 'من العملاء (الملاك)', icon: UserCheck, tone: 'yellow', tile: 'bg-warning-soft text-warning', screen: 'clients' },
  unit: { badge: 'وحدة', plural: 'الوحدات', source: 'من الوحدات', icon: DoorOpen, tone: 'sky', tile: 'bg-[color-mix(in_srgb,var(--primary-2)_16%,transparent)] text-primary-2', screen: 'units' },
  building: { badge: 'عقار', plural: 'العقارات', source: 'من المباني والعقارات', icon: BuildingComplex, tone: 'neutral', tile: 'bg-neutral-soft text-fg-2', screen: 'buildings' },
  reservation: { badge: 'حجز', plural: 'الحجوزات', source: 'من الحجوزات', icon: CalendarCheck, tone: 'sky', tile: 'bg-[color-mix(in_srgb,var(--primary-2)_16%,transparent)] text-primary-2', screen: 'reservations' },
  contract: { badge: 'عقد', plural: 'العقود', source: 'من العقود', icon: FileText, tone: 'indigo', tile: 'bg-primary-soft text-primary', screen: 'contracts' },
  installment: { badge: 'قسط', plural: 'الأقساط', source: 'من الأقساط', icon: CalendarClock, tone: 'yellow', tile: 'bg-warning-soft text-warning', screen: 'installments' },
  receipt: { badge: 'إيصال', plural: 'الإيصالات', source: 'من إيصالات القبض', icon: ReceiptText, tone: 'green', tile: 'bg-success-soft text-success', screen: 'receipts' },
  return: { badge: 'مرتجع', plural: 'المرتجعات', source: 'من المرتجعات', icon: Undo2, tone: 'red', tile: 'bg-danger-soft text-danger', screen: 'returns' },
  maintenance: { badge: 'صيانة', plural: 'الصيانة', source: 'من طلبات الصيانة', icon: Wrench, tone: 'yellow', tile: 'bg-warning-soft text-warning', screen: 'maintenance' },
  union: { badge: 'اتحاد', plural: 'اتحادات الملاك', source: 'من اتحادات الملاك', icon: Handshake, tone: 'neutral', tile: 'bg-neutral-soft text-fg-2', screen: 'owner-unions' },
  screen: { badge: 'شاشة', plural: 'الشاشات', source: 'من القائمة', icon: LayoutGrid, tone: 'neutral', tile: 'bg-neutral-soft text-fg-2' },
}
const ORDER: Kind[] = ['client', 'owner', 'unit', 'building', 'reservation', 'contract', 'installment', 'receipt', 'return', 'maintenance', 'union', 'screen']

type Entry = { key: string; kind: Kind; id: string; title: string; sub: string; hay: string; head: string; icon?: Icon; run?: () => void }

export type ScreenItem = { id: string; title: string; sub: string; icon: Icon }

/* ==================================================================
   Open-record host: one side panel for the whole app
   ================================================================== */

type Ref = { kind: RecordKind; id: string }
const HostContext = createContext<{ open: (ref: Ref, list?: Ref[]) => void } | null>(null)
export const useRecordHost = () => {
  const ctx = useContext(HostContext)
  if (!ctx) throw new Error('useRecordHost needs <RecordHostProvider>')
  return ctx
}

const goTo = (screen: string) => {
  window.location.hash = `/${screen}`
}

export function RecordHostProvider({ children }: { children: ReactNode }) {
  const { clients, units, buildings, contracts, installments, payments, maintenance, reservations, ownerUnions } = useData()
  const views = useRecordViews()
  const [state, setState] = useState<{ ref: Ref; list: Ref[] } | null>(null)
  const open = useCallback((ref: Ref, list?: Ref[]) => setState({ ref, list: list?.length ? list : [ref] }), [])

  const build = (ref: Ref): RecordView | null => {
    const kind = ref.kind
    const open = () => goTo(KINDS[kind].screen!)
    let view: RecordView | null = null
    if (kind === 'client' || kind === 'owner') {
      const c = clients.find((x) => x.id === ref.id)
      view = c ? views.client(c, open) : null
    } else if (kind === 'unit') {
      const u = units.find((x) => x.id === ref.id)
      view = u ? views.unit(u, open) : null
    } else if (kind === 'building') {
      const b = buildings.find((x) => x.id === ref.id)
      view = b ? views.building(b, open) : null
    } else if (kind === 'reservation') {
      const r = reservations.find((x) => x.id === ref.id)
      view = r ? views.reservation(r, open) : null
    } else if (kind === 'contract' || kind === 'return') {
      const c = contracts.find((x) => x.id === ref.id)
      view = c ? views.contract(c, open) : null
    } else if (kind === 'installment') {
      const i = installments.find((x) => x.id === ref.id)
      view = i
        ? views.installment(i, () => {
            sessionStorage.setItem(RECEIPT_PREFILL_KEY, JSON.stringify({ contractId: i.contractId, installmentId: i.id }))
            goTo('receipts')
          })
        : null
    } else if (kind === 'receipt') {
      const p = payments.find((x) => x.id === ref.id)
      view = p ? views.receipt(p, open) : null
    } else if (kind === 'maintenance') {
      const m = maintenance.find((x) => x.id === ref.id)
      view = m ? views.maintenance(m, open) : null
    } else {
      const u = ownerUnions.find((x) => x.id === ref.id)
      view = u ? views.union(u, open) : null
    }
    return view && kind !== 'installment' ? { ...view, editLabel: 'فتح الشاشة' } : view
  }

  const index = state ? state.list.findIndex((r) => r.kind === state.ref.kind && r.id === state.ref.id) : -1
  const view = state ? build(state.ref) : null
  const step = (d: number) => state && state.list[index + d] && setState({ ...state, ref: state.list[index + d] })

  return (
    <HostContext.Provider value={{ open }}>
      {children}
      <RecordPanel view={view} index={index} total={state?.list.length ?? 0} onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setState(null)} />
    </HostContext.Provider>
  )
}

/* ==================================================================
   Index + matching
   ================================================================== */

function useIndex(): Entry[] {
  const { clients, units, buildings, contracts, installments, payments, maintenance, reservations, ownerUnions } = useData()
  return useMemo(() => {
    const client = new Map(clients.map((c) => [c.id, c]))
    const unitById = new Map(units.map((u) => [u.id, u]))
    const building = new Map(buildings.map((b) => [b.id, b]))
    const contractById = new Map(contracts.map((c) => [c.id, c]))
    const cName = (id: string) => client.get(id)?.fullName ?? '—'
    const uName = (id: string | null) => {
      const u = id ? unitById.get(id) : undefined
      return u ? `${building.get(u.buildingId)?.name ?? ''} · ${u.number}` : '—'
    }
    const out: Entry[] = []
    const add = (kind: Kind, id: string, title: string, sub: string, extra = '') =>
      out.push({ key: `${kind}:${id}`, kind, id, title, sub, head: normalizeSearch(title), hay: normalizeSearch(`${title} ${sub} ${extra}`) })

    for (const c of clients) add(c.type === 'مالك' ? 'owner' : 'client', c.id, c.fullName, [c.type, c.phone].filter(Boolean).join(' · '), `${c.phone2} ${c.nationalId} ${c.address} ${c.id}`)
    for (const u of units) {
      const b = building.get(u.buildingId)?.name ?? ''
      add('unit', u.id, `وحدة ${u.number}`, `${b} · ${u.type} · ${u.status}`, `${u.purpose} ${u.id}`)
    }
    for (const b of buildings) add('building', b.id, b.name, [b.district, b.city].filter(Boolean).join(' — '), `${b.address} ${b.types.join(' ')}`)
    for (const r of reservations) add('reservation', r.id, `حجز ${uName(r.unitId)}`, `${cName(r.clientId)} · ${r.status}`, `${r.purpose} ${fmtDate(r.date)}`)
    for (const c of contracts) {
      if (c.status === 'مرتجع') add('return', c.id, `مرتجع عقد ${c.number}`, `${cName(c.clientId)} · ${uName(c.unitId)}`, `${c.number} ${fmtDate(c.date)}`)
      else add('contract', c.id, `عقد ${c.number}`, `${cName(c.clientId)} · ${c.type} · ${c.status}`, `${c.number} ${uName(c.unitId)} ${fmtDate(c.date)}`)
    }
    for (const i of installments) {
      const c = contractById.get(i.contractId)
      if (!c) continue
      const label = paymentLabel(c.type, i.seq)
      add('installment', i.id, `${c.number} — ${label}`, `${cName(c.clientId)} · استحقاق ${fmtDate(i.dueDate)} · ${i.status}`, `${egp(i.amount)} ${fmtDate(i.dueDate)}`)
    }
    for (const p of payments) {
      const c = contractById.get(p.contractId)
      add('receipt', p.id, `إيصال ${p.receiptNumber}`, `${c ? cName(c.clientId) : '—'} · ${egp(p.amount)}`, `${p.method} ${p.notes} ${c?.number ?? ''} ${fmtDate(p.date)}`)
    }
    for (const m of maintenance) add('maintenance', m.id, `${m.type} — ${m.unitId ? uName(m.unitId) : 'المبنى'}`, `${m.description} · ${m.status}`, `${m.assignedTo} ${m.requestDate}`)
    for (const u of ownerUnions) add('union', u.id, u.name, building.get(u.buildingId)?.name ?? '', u.notes)
    return out
  }, [clients, units, buildings, contracts, installments, payments, maintenance, reservations, ownerUnions])
}

const VARIANT: Record<string, string> = { ا: '[اأإآٱ]', ي: '[يى]', ى: '[يى]', ه: '[هة]', ة: '[هة]', و: '[وؤ]', ؤ: '[وؤ]' }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function termPattern(term: string): string {
  return [...term].map((ch) => (/[0-9]/.test(ch) ? `[${ch}${String.fromCharCode(0x660 + +ch)}${String.fromCharCode(0x6f0 + +ch)}]` : (VARIANT[ch] ?? esc(ch))) + '[\\u064B-\\u065F\\u0670\\u0640]*').join('')
}

function Hl({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  const parts = text.split(new RegExp(`(${terms.map(termPattern).join('|')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  )
}

const RECENT_KEY = 'aqar.search.recent'
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

/* ==================================================================
   Trigger + modal
   ================================================================== */

export function GlobalSearch({ className, screens }: { className?: string; screens: ScreenItem[] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault()
        if (!e.repeat) setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="بحث شامل في النظام"
        data-screen-search=""
        className={cn('field cursor-pointer text-start', className)}
      >
        <span className="field-adornment" aria-hidden="true">
          <Search size={17} />
        </span>
        <span className="field-control flex min-w-0 items-center truncate text-fg-3">ابحث في كل النظام…</span>
        <kbd dir="ltr" className="field-adornment me-2 hidden rounded-md border border-hairline bg-neutral-soft px-1.5 py-0.5 font-sans text-[11px] font-bold leading-none text-fg-2 xl:inline">
          {IS_APPLE ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
      {open && <SearchModal screens={screens} onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchModal({ screens, onClose }: { screens: ScreenItem[]; onClose: () => void }) {
  const host = useRecordHost()
  const base = useIndex()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  const [filter, setFilter] = useState<Kind | 'all'>('all')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>(readRecent)

  const entries = useMemo<Entry[]>(
    () => [
      ...base,
      ...screens.map<Entry>((s) => ({ key: `screen:${s.id}`, kind: 'screen', id: s.id, title: s.title, sub: s.sub, head: normalizeSearch(s.title), hay: normalizeSearch(`${s.title} ${s.sub}`), icon: s.icon, run: () => goTo(s.id) })),
    ],
    [base, screens],
  )
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries])

  useEffect(() => {
    inputRef.current?.focus()
    const prev = document.activeElement
    return () => (prev instanceof HTMLElement ? prev.focus({ preventScroll: true }) : undefined)
  }, [])
  useEffect(() => {
    const { body } = document
    const saved = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = saved
    }
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(query), 160)
    return () => window.clearTimeout(t)
  }, [query])

  const typing = query.trim() !== settled.trim()
  const q = normalizeSearch(settled)
  const terms = q ? q.split(' ') : []

  const matches = useMemo(() => {
    if (!q) return []
    const out: (Entry & { rank: number })[] = []
    for (const e of entries) {
      if (!matchesAll(e.hay, q)) continue
      out.push({ ...e, rank: e.head.startsWith(q) ? 0 : e.head.includes(q) ? 1 : matchesAll(e.head, q) ? 2 : 3 })
    }
    return out.sort((a, b) => a.rank - b.rank)
  }, [entries, q])

  const counts = useMemo(() => {
    const m = new Map<Kind, number>()
    for (const e of matches) m.set(e.kind, (m.get(e.kind) ?? 0) + 1)
    return m
  }, [matches])

  const groups = useMemo(() => {
    const cap = filter === 'all' ? 4 : 60
    return ORDER.filter((k) => filter === 'all' || filter === k)
      .map((kind) => ({ kind, total: counts.get(kind) ?? 0, items: matches.filter((e) => e.kind === kind).slice(0, cap) }))
      .filter((g) => g.items.length)
  }, [matches, counts, filter])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => setActive(0), [settled, filter])
  useEffect(() => {
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, flat])

  const choose = (e: Entry) => {
    const next = [e.key, ...recent.filter((k) => k !== e.key)].slice(0, 6)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable
    }
    onClose()
    if (e.kind === 'screen') return e.run?.()
    const list = flat.filter((x) => x.kind !== 'screen' && x.kind === e.kind).map((x) => ({ kind: x.kind as RecordKind, id: x.id }))
    host.open({ kind: e.kind, id: e.id }, list.length ? list : undefined)
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      if (query) setQuery('')
      else onClose()
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!flat.length) return
      ev.preventDefault()
      setActive((i) => (i + (ev.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length)
    } else if (ev.key === 'Enter' && flat[active] && !typing) {
      ev.preventDefault()
      choose(flat[active])
    }
  }

  const recents = recent.map((k) => byKey.get(k)).filter((e): e is Entry => Boolean(e))
  const chipKinds = ORDER.filter((k) => (q ? counts.has(k) : k !== 'screen'))
  const state: 'empty' | 'typing' | 'results' | 'none' = !query.trim() ? 'empty' : typing ? 'typing' : flat.length ? 'results' : 'none'
  let n = -1

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-start justify-items-center px-4 pt-[8vh]" onKeyDown={onKeyDown}>
      <div className="backdrop fade absolute inset-0" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="البحث الشامل"
        className="glass-float pop relative flex max-h-[80vh] w-[min(48rem,100%)] flex-col overflow-hidden rounded-card border border-[var(--menu-border)] bg-[var(--surface-overlay)] outline-none"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <Search size={22} className="shrink-0 text-primary" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={state === 'results' ? `${listId}-${active}` : undefined}
            aria-label="ابحث في العملاء والوحدات والعقود والأقساط والإيصالات وغيرها"
            placeholder="ابحث عن عميل، وحدة، عقد، قسط، إيصال، مرتجع…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="t-body min-w-0 flex-1 bg-transparent py-1 text-[17px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-fg-3"
          />
          {typing && <span className="spinner size-4 shrink-0" aria-hidden="true" />}
          {query && !typing && (
            <button type="button" aria-label="مسح" onClick={() => (setQuery(''), inputRef.current?.focus())} className="grid size-7 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-fg/5 hover:text-fg">
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <kbd dir="ltr" className="hidden shrink-0 rounded-md border border-hairline bg-neutral-soft px-1.5 py-1 font-sans text-[11px] font-bold leading-none text-fg-2 sm:inline">
            Esc
          </kbd>
        </div>

        <div className="flex gap-1.5 overflow-x-auto border-b border-hairline px-5 py-3" role="radiogroup" aria-label="تصفية حسب النوع">
          {(['all', ...chipKinds] as const).map((k) => {
            const on = filter === k
            const count = k === 'all' ? matches.length : counts.get(k)
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => (setFilter(k), inputRef.current?.focus())}
                className={cn(
                  't-caption shrink-0 rounded-full border px-3 py-1.5 font-semibold transition-colors',
                  on ? 'border-transparent bg-[var(--primary)] text-white' : 'border-[var(--hairline)] bg-[var(--field-bg)] text-fg-2 hover:text-fg',
                )}
              >
                {k === 'all' ? 'الكل' : KINDS[k].plural}
                {q && count != null && <span className="ms-1 tabular-nums opacity-75">({count})</span>}
              </button>
            )
          })}
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="نتائج البحث" className="min-h-[16rem] flex-1 overflow-y-auto overscroll-contain p-2">
          {state === 'empty' && (
            <div className="grid gap-5 p-3">
              {recents.length > 0 && (
                <div className="grid gap-1">
                  <p className="t-caption px-2 font-bold">بحث سابق</p>
                  {recents.map((e) => (
                    <ResultRow key={e.key} entry={e} terms={[]} onChoose={() => choose(e)} />
                  ))}
                </div>
              )}
              <div className="grid gap-2">
                <p className="t-caption px-2 font-bold">ابحث في</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ORDER.filter((k) => k !== 'screen').map((k) => {
                    const Ic = KINDS[k].icon
                    return (
                      <button key={k} type="button" onClick={() => (setFilter(k), inputRef.current?.focus())} className="kit-option glass justify-start rounded-ctl">
                        <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px]', KINDS[k].tile)}>
                          <Ic size={16} aria-hidden />
                        </span>
                        <span className="t-label truncate">{KINDS[k].plural}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="t-caption px-2">جرّب اسم عميل، رقم عقد (S-2025-061)، رقم وحدة، رقم إيصال أو مبلغ. البحث يتجاوز اختلاف الهمزات والتاء المربوطة.</p>
              </div>
            </div>
          )}

          {state === 'typing' && (
            <div className="grid gap-1 p-1" aria-busy="true" aria-label="جارٍ البحث">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-ctl px-3 py-2.5">
                  <Skeleton className="size-9 rounded-[10px]" />
                  <div className="grid flex-1 gap-1.5">
                    <Skeleton className="h-3.5" style={{ width: `${[48, 62, 40, 55, 36][i]}%` }} />
                    <Skeleton className="h-3" style={{ width: `${[30, 38, 26, 34, 24][i]}%` }} />
                  </div>
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {state === 'none' && (
            <div role="status" className="grid place-items-center gap-2 px-6 py-12 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-neutral-soft text-fg-3">
                <SearchX size={26} aria-hidden="true" />
              </span>
              <p className="t-section">لا توجد نتائج لـ «{settled.trim()}»</p>
              <p className="t-caption max-w-sm">تأكد من الإملاء أو جرّب كلمة أقصر أو رقم العقد/الوحدة فقط{filter !== 'all' ? '، أو ابحث في كل الأنواع.' : '.'}</p>
              {filter !== 'all' && (
                <button type="button" onClick={() => setFilter('all')} className="t-label mt-1 rounded-full border border-hairline px-4 py-1.5 text-primary hover:bg-primary-soft">
                  البحث في الكل
                </button>
              )}
            </div>
          )}

          {state === 'results' &&
            groups.map((g) => {
              const K = KINDS[g.kind]
              const Ic = K.icon
              return (
                <section key={g.kind} aria-label={K.plural} className="mb-1">
                  <header className="sticky top-0 z-[1] flex items-center gap-2 bg-[var(--surface-overlay)] px-3 py-2">
                    <Ic size={14} className="text-fg-3" aria-hidden />
                    <h3 className="t-caption font-bold text-fg-2">{K.plural}</h3>
                    <span className="t-caption tabular-nums">{g.total}</span>
                    {filter === 'all' && g.total > g.items.length && (
                      <button type="button" onClick={() => setFilter(g.kind)} className="t-caption ms-auto font-semibold text-primary hover:underline">
                        عرض الكل ({g.total})
                      </button>
                    )}
                  </header>
                  {g.items.map((e) => {
                    n++
                    const idx = n
                    return <ResultRow key={e.key} id={`${listId}-${idx}`} entry={e} terms={terms} current={idx === active} onHover={() => setActive(idx)} onChoose={() => choose(e)} />
                  })}
                </section>
              )
            })}
        </div>

        <footer className="t-caption flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-5 py-2.5">
          <span className="inline-flex items-center gap-1">
            <kbd dir="ltr" className="rounded border border-hairline px-1 font-sans">↑↓</kbd> تنقل
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={12} aria-hidden="true" /> فتح التفاصيل
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd dir="ltr" className="rounded border border-hairline px-1 font-sans">Esc</kbd> إغلاق
          </span>
          {state === 'results' && <span className="ms-auto tabular-nums">{matches.length} نتيجة</span>}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function ResultRow({ entry, terms, current, id, onHover, onChoose }: { entry: Entry; terms: string[]; current?: boolean; id?: string; onHover?: () => void; onChoose: () => void }) {
  const K = KINDS[entry.kind]
  const Ic = entry.icon ?? K.icon
  return (
    <div
      id={id}
      role="option"
      aria-selected={current ?? false}
      data-current={current}
      data-active={current}
      onPointerMove={onHover}
      onClick={onChoose}
      className="kit-option min-h-14 gap-3 px-3 py-2"
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-[10px]', K.tile)}>
        <Ic size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-body block truncate font-semibold">
          <Hl text={entry.title} terms={terms} />
        </span>
        <span className="t-caption block truncate font-normal">
          {K.source}
          {entry.sub && (
            <>
              {' · '}
              <Hl text={entry.sub} terms={terms} />
            </>
          )}
        </span>
      </span>
      <Badge tone={K.tone} className="shrink-0">
        {K.badge}
      </Badge>
    </div>
  )
}
