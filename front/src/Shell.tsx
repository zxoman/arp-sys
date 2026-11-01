/**
 * App shell: right-hand sidebar (desktop) or drawer (mobile), sticky glass header, hash routing
 * (`#/contracts`) and lazily loaded screens. Every screen renders a placeholder until its module is
 * registered in SCREEN_MODULES.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type LazyExoticComponent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  Ban,
  Bell,
  BellOff,
  Banknote,
  BellRing,
  BookUser,
  BuildingComplex,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChartColumn,
  ChartPie,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Contact,
  DoorOpen,
  Printer,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileX,
  Hammer,
  HandCoins,
  Handshake,
  KeyRound,
  Keyboard,
  LogOut,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Receipt,
  ReceiptText,
  Save,
  ScrollText,
  Settings,
  UserCog,
  History,
  Sun,
  TrendingUp,
  TriangleAlert,
  Undo2,
  UserPlus,
  UserRound,
  UsersRound,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { BrandLogo, BRAND_NAME } from '@/components/BrandLogo'
import { Badge, Button, GlassCard, MeshBackground, Skeleton, Text } from '@/components/ui'
import { Btn, IconBtn, Modal, TextInput, useToast } from '@/kit'
import { saveSettings } from '@/lib/api'
import { GlobalSearch, type ScreenItem } from '@/screens/GlobalSearch'
import { applyPerfMode } from '@/kit/perf'
import { SHORTCUT_LIST, runShortcutAction } from '@/kit/shortcuts'
import { egp, useApp, useData } from '@/lib'
import { cn } from '@/lib/cn'
import { useAuth } from '@/lib/auth'
import { fetchNotifications, hasToken } from '@/lib/api'
import { ProjectBadge } from '@/screens/movement/shared'

/* ==================================================================
   Navigation model
   ================================================================== */

type ModuleId = 'movement' | 'reports'

interface ScreenDef {
  id: string
  title: string
  icon: LucideIcon
  /** The header's primary button for this screen (also bound to Ctrl/⌘+N). */
  action: string
  actionIcon: LucideIcon
}

interface NavGroup {
  id: string
  label: string
  screens: ScreenDef[]
}

interface NavModule {
  id: ModuleId
  label: string
  icon: LucideIcon
  groups: NavGroup[]
}

interface ScreenMeta extends ScreenDef {
  module: NavModule
  group: NavGroup
}

const page = (id: string, title: string, icon: LucideIcon, action: string, actionIcon: LucideIcon = Plus): ScreenDef => ({
  id,
  title,
  icon,
  action,
  actionIcon,
})
const report = (id: string, title: string, icon: LucideIcon) => page(id, title, icon, 'طباعة التقرير', Printer)

const NAV: NavModule[] = [
  {
    id: 'movement',
    label: 'الحركة العقارية',
    icon: ArrowLeftRight,
    groups: [
      {
        id: 'assets',
        label: 'الأصول العقارية',
        screens: [
          page('buildings', 'المباني والعقارات', BuildingComplex, 'إضافة مبنى'),
          page('units', 'الوحدات', DoorOpen, 'إضافة وحدة'),
        ],
      },
      {
        id: 'deals',
        label: 'العملاء والحجوزات',
        screens: [
          page('clients', 'العملاء', UsersRound, 'إضافة عميل', UserPlus),
          page('reservations', 'الحجوزات', CalendarCheck, 'حجز جديد', CalendarPlus),
        ],
      },
      {
        id: 'sales',
        label: 'العقود والتحصيل',
        screens: [
          page('contracts', 'العقود', FileText, 'عقد جديد', FilePlus),
          page('installments', 'الأقساط والإيجارات المستحقة', CalendarClock, 'تسجيل سداد', Wallet),
          page('receipts', 'إيصالات القبض', Receipt, 'إيصال قبض جديد', ReceiptText),
          page('returns', 'المرتجعات وإنهاء العقود', Undo2, 'تسجيل مرتجع', FileX),
        ],
      },
      {
        id: 'services',
        label: 'الخدمات',
        screens: [
          page('maintenance', 'طلبات الصيانة', Wrench, 'طلب صيانة جديد'),
          page('owner-unions', 'اتحادات الملاك', Handshake, 'إضافة اتحاد ملاك'),
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'التقارير',
    icon: ChartColumn,
    groups: [
      {
        id: 'installment-reports',
        label: 'تقارير الأقساط والإيجارات',
        screens: [
          report('report-installments-summary', 'ملخص الأقساط والعقود', FileSpreadsheet),
          report('report-leases', 'عقود الإيجار', FileText),
          report('report-due-overdue', 'المستحقات والمتأخرات', CircleAlert),
          report('report-income-statement', 'كشف الدخل', Banknote),
          report('report-monthly-revenue', 'الإيرادات الشهرية', TrendingUp),
          report('report-daily-collection', 'التحصيل اليومي', CalendarDays),
        ],
      },
      {
        id: 'client-reports',
        label: 'تقارير العملاء',
        screens: [report('report-client-statement', 'كشف حساب عميل', ScrollText)],
      },
      {
        id: 'unit-reports',
        label: 'تقارير الوحدات',
        screens: [
          report('report-available-units', 'الوحدات المتاحة', DoorOpen),
          report('report-reserved-units', 'الوحدات المحجوزة', CalendarCheck),
          report('report-sold-units', 'الوحدات المباعة', KeyRound),
          report('report-rented-units', 'الوحدات المؤجرة', KeyRound),
          report('report-returned-units', 'الوحدات المرتجعة', Undo2),
          report('report-non-sellable-units', 'الوحدات غير القابلة للبيع', Ban),
          report('report-unit-status', 'حالة الوحدات', ChartPie),
        ],
      },
      {
        id: 'other-reports',
        label: 'تقارير أخرى',
        screens: [
          report('report-maintenance', 'الصيانة', Hammer),
          report('report-owner-units', 'الملاك ووحداتهم', Contact),
          report('report-revenue-distribution', 'توزيع الإيرادات', HandCoins),
          report('report-owner-statement', 'كشف حساب مالك', BookUser),
          report('report-building-statement', 'كشف عقار', BuildingComplex),
          report('report-unit-statement', 'كشف وحدة', DoorOpen),
        ],
      },
    ],
  },
]

/** Pinned to the bottom of the sidebar in both tabs, outside the scrolling groups. */
const SETTINGS_GROUP: NavGroup = {
  id: 'settings',
  label: 'الإعدادات',
  screens: [
    page('settings', 'الإعدادات', Settings, 'حفظ الإعدادات', Save),
    page('users', 'المستخدمون', UserCog, 'مستخدم جديد', UserPlus),
    page('logs', 'سجل العمليات', History, 'طباعة السجل', Printer),
  ],
}
const SETTINGS_SCREEN_ID = SETTINGS_GROUP.screens[0].id

const SCREENS = new Map<string, ScreenMeta>([
  ...NAV.flatMap((module) =>
    module.groups.flatMap((group) => group.screens.map((s): [string, ScreenMeta] => [s.id, { ...s, module, group }])),
  ),
  ...SETTINGS_GROUP.screens.map(
    (s): [string, ScreenMeta] => [s.id, { ...s, module: NAV[0], group: SETTINGS_GROUP }],
  ),
])

/** There is no dashboard; the app opens on the buildings list. */
const DEFAULT_SCREEN = SCREENS.get('buildings')!
const APP_NAME = 'Codex Control'
const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
const SHORTCUT_LABEL = IS_APPLE ? '⌘N' : 'Ctrl+N'
const SHORTCUT_PRINT_LABEL = IS_APPLE ? '⌘P' : 'Ctrl+P'
const COLLAPSED_KEY = 'shell:sidebar-collapsed'
const SEEN_KEY = 'shell:seen-notices'
const DESKTOP_NOTICES_KEY = 'shell:desktop-notices'
/** «لاحقًا» on the project setup dialog; lasts for the browser session only. */
const SETUP_SKIPPED_KEY = 'shell:setup-skipped'
/** Routes renamed when owners became clients; old bookmarks keep working. */
const ROUTE_ALIASES: Record<string, string> = { owners: 'clients' }

const hrefFor = (id: string) => `#/${id}`

/* ==================================================================
   Screens — lazily loaded, one component per screen id
   ================================================================== */

type ScreenProps = { screen: ScreenMeta }
type ScreenModule = { default: ComponentType<ScreenProps> }

/** Real screens plug in here as they're built, e.g. `contracts: () => import('./screens/Contracts')`. */
const SCREEN_MODULES: Partial<Record<string, () => Promise<ScreenModule>>> = {
  settings: () => import('./screens/Settings'),
  users: () => import('./screens/Users'),
  logs: () => import('./screens/Logs'),
  buildings: () => import('./screens/movement/Buildings'),
  units: () => import('./screens/movement/Units'),
  clients: () => import('./screens/movement/Clients'),
  contracts: () => import('./screens/movement/Contracts'),
  installments: () => import('./screens/movement/RentDue'),
  receipts: () => import('./screens/movement/Receipts'),
  reservations: () => import('./screens/movement/Reservations'),
  returns: () => import('./screens/movement/ContractEnd'),
  maintenance: () => import('./screens/movement/Maintenance'),
  'owner-unions': () => import('./screens/movement/OwnerUnions'),
  'report-installments-summary': () => import('./screens/reports/ReportInstallments'),
  'report-leases': () => import('./screens/reports/ReportInstallments'),
  'report-due-overdue': () => import('./screens/reports/ReportInstallments'),
  'report-monthly-revenue': () => import('./screens/reports/ReportInstallments'),
  'report-daily-collection': () => import('./screens/reports/ReportInstallments'),
  'report-client-statement': () => import('./screens/reports/ReportClientStatement'),
  'report-available-units': () => import('./screens/reports/ReportUnits'),
  'report-reserved-units': () => import('./screens/reports/ReportUnits'),
  'report-sold-units': () => import('./screens/reports/ReportUnits'),
  'report-rented-units': () => import('./screens/reports/ReportUnits'),
  'report-returned-units': () => import('./screens/reports/ReportUnits'),
  'report-non-sellable-units': () => import('./screens/reports/ReportUnits'),
  'report-unit-status': () => import('./screens/reports/ReportUnits'),
  'report-maintenance': () => import('./screens/reports/ReportMaintenance'),
  'report-owner-units': () => import('./screens/reports/ReportOwners'),
  'report-revenue-distribution': () => import('./screens/reports/ReportOwners'),
  'report-owner-statement': () => import('./screens/reports/ReportOwners'),
  'report-income-statement': () => import('./screens/reports/ReportIncome'),
  'report-building-statement': () => import('./screens/reports/ReportStatements'),
  'report-unit-statement': () => import('./screens/reports/ReportStatements'),
}

const loadPlaceholder = (): Promise<ScreenModule> => Promise.resolve({ default: PlaceholderScreen })

const SCREEN_VIEWS = new Map<string, LazyExoticComponent<ComponentType<ScreenProps>>>(
  [...SCREENS.keys()].map((id) => [id, lazy(SCREEN_MODULES[id] ?? loadPlaceholder)]),
)

function PlaceholderScreen({ screen }: ScreenProps) {
  const Icon = screen.icon
  return (
    <GlassCard className="rise-in relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--primary-soft),transparent)]"
      />
      <span className="mx-auto grid size-16 place-items-center rounded-card bg-linear-135 from-primary to-primary-2 text-white shadow-raised">
        <Icon size={28} aria-hidden="true" />
      </span>
      <div className="mt-6">
        <Badge tone="indigo">قيد الإنشاء</Badge>
      </div>
      <Text variant="section" as="h2" className="mt-3 text-[22px]">
        {screen.title}
      </Text>
      <Text variant="body" className="mx-auto mt-2 max-w-md text-fg-2">
        نعمل على تجهيز هذه الشاشة ضمن «{screen.group.label}». ستظهر هنا بياناتها وأدواتها قريبًا.
      </Text>
    </GlassCard>
  )
}

function ScreenSkeleton() {
  return (
    <div role="status" aria-label="جارٍ تحميل الشاشة" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-full max-w-xs" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="ms-auto h-10 w-32" />
      </div>
      <GlassCard className="overflow-hidden">
        <div className="flex items-center gap-6 border-b border-hairline px-5 py-4">
          {[26, 18, 14, 16, 10].map((width, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: `${width}%` }} />
          ))}
        </div>
        {Array.from({ length: 7 }, (_, row) => (
          <div key={row} className="flex items-center gap-6 border-b border-hairline px-5 py-4 last:border-b-0">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            {[22, 16, 12, 14].map((width, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${width}%` }} />
            ))}
            <Skeleton className="ms-auto h-6 w-16 rounded-full" />
          </div>
        ))}
      </GlassCard>
    </div>
  )
}

/* ==================================================================
   Small hooks
   ================================================================== */

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

function useStoredFlag(key: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // Storage unavailable (private mode): the flag just won't persist.
    }
  }, [key, value])
  return [value, setValue] as const
}

function readScreen(): ScreenMeta | undefined {
  const { hash } = window.location
  if (!hash.startsWith('#/')) return undefined
  const id = decodeURIComponent(hash.slice(2))
  return SCREENS.get(ROUTE_ALIASES[id] ?? id)
}

/** Current screen from `location.hash`; unknown or empty routes resolve to the default screen. */
function useHashRoute(): ScreenMeta {
  const [screen, setScreen] = useState(() => readScreen() ?? DEFAULT_SCREEN)

  useEffect(() => {
    const sync = () => {
      const { hash } = window.location
      if (hash && !hash.startsWith('#/')) return // an in-page anchor, not a route
      const next = readScreen()
      if (!next || hash !== hrefFor(next.id)) history.replaceState(history.state, '', hrefFor((next ?? DEFAULT_SCREEN).id))
      setScreen(next ?? DEFAULT_SCREEN)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return screen
}

const searchScreenItems: ScreenItem[] = [...SCREENS.values()].map((s) => ({ id: s.id, title: s.title, sub: `${s.module.label} · ${s.group.label}`, icon: s.icon }))

function navigateTo(id: string) {
  window.location.hash = `/${id}`
}

/* ==================================================================
   Shell
   ================================================================== */

export function Shell() {
  const screen = useHashRoute()
  const toast = useToast()
  const { settings } = useData()
  const [collapsed, setCollapsed] = useStoredFlag(COLLAPSED_KEY)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const previousId = useRef(screen.id)
  const drawerId = useId()

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    document.title = `${screen.title} · ${APP_NAME}`
    if (previousId.current === screen.id) return
    previousId.current = screen.id
    window.scrollTo({ top: 0 })
    setAnnouncement(`صفحة ${screen.title}`)
    setDrawerOpen(false)
  }, [screen])

  // The drawer only exists below the lg breakpoint; release it (and its scroll lock) when widening.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const onChange = () => desktop.matches && setDrawerOpen(false)
    desktop.addEventListener('change', onChange)
    return () => desktop.removeEventListener('change', onChange)
  }, [])

  const runPrimary = useCallback(() => {
    if (screen.module.id === 'reports') {
      if (!runShortcutAction('print')) window.print()
      return
    }
    if (runShortcutAction('primary') || runShortcutAction('new')) return
    toast.info(`قريبًا: ${screen.action}`, `ستتوفر هذه العملية مع اكتمال شاشة «${screen.title}».`)
  }, [toast, screen])
  const runPrimaryRef = useLatest(runPrimary)
  const toastRef = useLatest(toast)

  useEffect(() => {
    applyPerfMode()
  }, [])

  // Global shortcuts. `code` keeps them working on Arabic layouts. Some browsers reserve Ctrl+N
  // for a new window and never deliver it to the page.
  //   Ctrl+N new · Ctrl+S save (open dialog's submit, else the screen's form) · Ctrl+P print
  //   Ctrl+F focus search · Alt+1 movement · Alt+2 reports. Escape is handled by each overlay.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]:not([inert])')
      const dialog = dialogs.length ? dialogs[dialogs.length - 1] : null

      if (mod && event.code === 'KeyN') {
        event.preventDefault()
        if (event.repeat || dialog) return
        if (!runShortcutAction('new')) runPrimaryRef.current()
      } else if (mod && event.code === 'KeyS') {
        event.preventDefault()
        if (event.repeat) return
        if (dialog) {
          dialog.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')?.click()
          return
        }
        if (!runShortcutAction('save')) toastRef.current.info('لا يوجد نموذج مفتوح للحفظ', 'استخدم Ctrl+S داخل نماذج الإضافة والتعديل.')
      } else if (mod && event.code === 'KeyP') {
        event.preventDefault()
        if (event.repeat) return
        if (!runShortcutAction('print')) window.print()
      } else if (mod && event.code === 'KeyF') {
        const scope = dialog ?? mainRef.current
        const boxes = scope ? Array.from(scope.querySelectorAll<HTMLInputElement>('input[role="searchbox"]')) : []
        const box =
          boxes.find((el) => el.offsetParent !== null && !el.disabled) ?? null
        if (!box) return // fall back to the browser's find bar
        event.preventDefault()
        box.focus()
        box.select()
      } else if (alt && (event.code === 'Digit1' || event.code === 'Digit2')) {
        event.preventDefault()
        if (event.repeat || dialog) return
        const moduleId = event.code === 'Digit1' ? 'movement' : 'reports'
        const target = [...SCREENS.values()].find((s) => s.module.id === moduleId)
        if (target) navigateTo(target.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runPrimaryRef, toastRef])

  const skipToMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    mainRef.current?.focus()
  }

  const View = SCREEN_VIEWS.get(screen.id)!

  return (
    <>
      <MeshBackground />
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-[100] focus:rounded-ctl focus:bg-primary focus:px-4 focus:py-2.5 focus:text-[14px] focus:font-semibold focus:text-white"
      >
        تخطَّ إلى المحتوى
      </a>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="relative z-[1] flex min-h-dvh">
        {/* Width switches instantly; only the pill and icons animate. */}
        <aside
          aria-label="الشريط الجانبي"
          className={cn(
            'glass-strong sticky top-0 z-20 hidden h-dvh shrink-0 self-start rounded-none border-y-0 border-s-0 lg:flex',
            collapsed ? 'w-[72px]' : 'w-[220px]',
          )}
        >
          <SidebarContent screen={screen} rail={collapsed} onToggleRail={() => setCollapsed((value) => !value)} />
        </aside>

        <MobileDrawer id={drawerId} open={drawerOpen} onClose={closeDrawer} returnFocusRef={menuButtonRef}>
          <SidebarContent screen={screen} rail={false} onClose={closeDrawer} onNavigate={closeDrawer} />
        </MobileDrawer>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            screen={screen}
            drawerId={drawerId}
            drawerOpen={drawerOpen}
            menuButtonRef={menuButtonRef}
            onOpenDrawer={() => setDrawerOpen(true)}
            onPrimary={runPrimary}
          />
          <main
            id="main"
            ref={mainRef}
            tabIndex={-1}
            aria-labelledby="page-title"
            className="w-full flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8"
          >
            <div key={screen.id} className="fade mx-auto w-full max-w-[1400px]">
              <Suspense fallback={<ScreenSkeleton />}>
                <View screen={screen} />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
      <ProjectSetup />
    </>
  )
}

/* ==================================================================
   First-launch project setup
   ================================================================== */

function readSkipped() {
  try {
    return sessionStorage.getItem(SETUP_SKIPPED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Asks for the project name while none is configured (first launch, or after a reset). «لاحقًا»
 * hides it for this session; it can also be set any time from الإعدادات.
 */
function ProjectSetup() {
  const { settings, dispatch } = useData()
  const toast = useToast()
  const [skipped, setSkipped] = useState(readSkipped)
  const [projectName, setProjectName] = useState('')
  const [companyName, setCompanyName] = useState(settings.companyName)
  const [error, setError] = useState<string>()
  const open = !settings.projectName.trim() && !skipped

  const skip = () => {
    try {
      sessionStorage.setItem(SETUP_SKIPPED_KEY, '1')
    } catch {
      // storage disabled: skip for this render tree only
    }
    setSkipped(true)
  }

  const save = async () => {
    const name = projectName.trim()
    if (!name) return setError('اسم المشروع مطلوب')
    const nextCompany = companyName.trim() || settings.companyName
    try {
      // Stored in the API so the name shows on every device, not just this browser.
      const saved = await saveSettings({ project_name: name, company_name: nextCompany })
      dispatch({ type: 'HYDRATE_SETTINGS', payload: { projectName: saved.project_name, companyName: saved.company_name } })
      toast.success('تم إعداد المشروع', `«${name}» يظهر الآن في الترويسة والمطبوعات.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حفظ اسم المشروع')
    }
  }

  return (
    <Modal
      open={open}
      onClose={skip}
      closeOnBackdrop={false}
      size="sm"
      icon={<BuildingComplex size={20} aria-hidden="true" />}
      title="إعداد المشروع"
      description="اسم المشروع يظهر في الترويسة وفي النماذج وكل المستندات المطبوعة، ويمكن تعديله لاحقًا من الإعدادات."
      footer={
        <>
          <Btn variant="ghost" onClick={skip}>
            لاحقًا
          </Btn>
          <Btn type="submit" form="project-setup-form">
            بدء العمل
          </Btn>
        </>
      }
    >
      <form
        id="project-setup-form"
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextInput
          label="اسم المشروع"
          required
          placeholder="مثال: كمبوند الأفق"
          value={projectName}
          error={error}
          data-autofocus=""
          onChange={(event) => {
            setProjectName(event.target.value)
            setError(undefined)
          }}
        />
        <TextInput
          label="اسم الشركة"
          hint="اختياري؛ يظهر في رأس المطبوعات."
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
        />
      </form>
    </Modal>
  )
}

/* ==================================================================
   Sidebar (shared by the desktop rail and the mobile drawer)
   ================================================================== */

type SidebarProps = {
  screen: ScreenMeta
  /** Icon-only collapsed rail (desktop). */
  rail: boolean
  onToggleRail?: () => void
  /** Shows a close button (mobile drawer). */
  onClose?: () => void
  /** Called after a nav link is followed. */
  onNavigate?: () => void
}

type Tip = { label: string; rect: DOMRect }

function SidebarContent({ screen, rail, onToggleRail, onClose, onNavigate }: SidebarProps) {
  const idBase = useId()
  const { settings } = useData()
  const [tab, setTab] = useState<ModuleId>(screen.module.id)
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [trackedScreen, setTrackedScreen] = useState(screen)
  const [tip, setTip] = useState<Tip | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const pillPlaced = useRef(false)

  // However the screen changed (link, search, back button), show its tab and open its group.
  if (trackedScreen !== screen) {
    setTrackedScreen(screen)
    setTab(screen.module.id)
    if (closedGroups.has(screen.group.id)) {
      const next = new Set(closedGroups)
      next.delete(screen.group.id)
      setClosedGroups(next)
    }
  }

  const module = NAV.find((m) => m.id === tab) ?? NAV[0]
  const tabId = (id: ModuleId) => `${idBase}-tab-${id}`
  const panelId = `${idBase}-panel`

  /** Moves the liquid pill onto the active link (or its collapsed group). The first placement is instant. */
  const placePill = useCallback(() => {
    const list = listRef.current
    const pill = pillRef.current
    if (!list || !pill) return
    if (list.getClientRects().length === 0) {
      // Hidden (display: none) at this breakpoint; re-place without animating once visible.
      pillPlaced.current = false
      pill.style.opacity = '0'
      return
    }
    const target =
      list.querySelector<HTMLElement>(`[data-screen="${screen.id}"]`) ??
      list.querySelector<HTMLElement>(`[data-group="${screen.group.id}"]`)
    if (!target) {
      pill.style.opacity = '0' // the active screen lives in the other tab
      return
    }
    const box = target.getBoundingClientRect()
    const top = box.top - list.getBoundingClientRect().top
    const instant = !pillPlaced.current
    if (instant) pill.style.transition = 'none'
    pill.style.height = `${box.height}px`
    pill.style.transform = `translate3d(0, ${top}px, 0)`
    pill.style.opacity = '1'
    if (instant) {
      void pill.offsetWidth // commit the jump before re-enabling the spring
      pill.style.transition = ''
    }
    pillPlaced.current = true
  }, [screen])

  useLayoutEffect(() => {
    placePill()
  }, [placePill, tab, closedGroups, rail])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(() => placePill())
    observer.observe(list)
    window.addEventListener('resize', placePill)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', placePill)
    }
  }, [placePill])

  const toggleGroup = (id: string) =>
    setClosedGroups((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = NAV.findIndex((m) => m.id === tab)
    let next = -1
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = NAV.length - 1
    // RTL: left moves forward. In the vertical rail, down moves forward.
    else if (event.key === (rail ? 'ArrowDown' : 'ArrowLeft')) next = (index + 1) % NAV.length
    else if (event.key === (rail ? 'ArrowUp' : 'ArrowRight')) next = (index - 1 + NAV.length) % NAV.length
    if (next < 0) return
    event.preventDefault()
    setTab(NAV[next].id)
    document.getElementById(tabId(NAV[next].id))?.focus()
  }

  /** Rail tooltips: the collapsed rail has no visible text, so hover/focus shows the label. */
  const tipFor = (label: string) =>
    rail
      ? {
          onPointerEnter: (event: { currentTarget: Element; pointerType: string }) => {
            if (event.pointerType !== 'touch') setTip({ label, rect: event.currentTarget.getBoundingClientRect() })
          },
          onPointerLeave: () => setTip(null),
          onFocus: (event: { currentTarget: Element }) =>
            setTip({ label, rect: event.currentTarget.getBoundingClientRect() }),
          onBlur: () => setTip(null),
        }
      : {}

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Brand */}
      <div className={cn('flex h-[72px] shrink-0 items-center gap-3', rail ? 'justify-center' : 'px-4')}>
        <BrandLogo className="size-10" />
        {!rail && (
          <div className="min-w-0 flex-1">
            <p dir="ltr" className="truncate text-start text-[15px] font-black uppercase leading-tight tracking-[0.12em] text-fg">{BRAND_NAME}</p>
            <p className="truncate text-[11.5px] leading-tight text-fg-3" title={settings.projectName || undefined}>
              {settings.projectName.trim() || settings.companyName || 'بيع وتأجير الوحدات'}
            </p>
          </div>
        )}
        {onClose && (
          <IconBtn icon={<X size={18} />} label="إغلاق القائمة" size="sm" onClick={onClose} data-autofocus="" />
        )}
      </div>

      {/* Module tabs */}
      <div
        role="tablist"
        aria-label="أقسام النظام"
        aria-orientation={rail ? 'vertical' : 'horizontal'}
        onKeyDown={onTabKeyDown}
        className={cn('shrink-0', rail ? 'grid gap-1 px-3' : 'mx-3 grid grid-cols-2 gap-1 rounded-ctl bg-fg/5 p-1')}
      >
        {NAV.map((m) => {
          const selected = m.id === tab
          const Icon = m.icon
          return (
            <button
              key={m.id}
              id={tabId(m.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              aria-label={rail ? m.label : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(m.id)}
              {...tipFor(m.label)}
              className={cn(
                'flex items-center justify-center rounded-[10px] font-bold',
                rail ? 'h-10 w-full' : 'h-[50px] flex-col gap-0.5 px-1 text-[11.5px]',
                selected
                  ? 'bg-[var(--glass-strong)] text-primary shadow-soft dark:text-indigo-300'
                  : 'text-fg-3 hover:bg-fg/5 hover:text-fg',
              )}
            >
              <Icon size={rail ? 18 : 16} aria-hidden="true" />
              {!rail && <span className="whitespace-nowrap">{m.label}</span>}
            </button>
          )
        })}
      </div>

      {rail && <div role="separator" className="mx-auto mt-3 h-px w-8 shrink-0 bg-hairline" />}

      {/* Links */}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(tab)}
        onScroll={() => setTip(null)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2 [scrollbar-width:thin]"
      >
        <nav aria-label={module.label}>
          <div ref={listRef} className="relative">
            <span
              ref={pillRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 rounded-ctl bg-primary-soft opacity-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)] transition-[transform,opacity] duration-500 ease-spring will-change-transform"
            >
              <span className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-linear-to-b from-primary to-primary-2" />
            </span>

            {module.groups.map((group, index) => {
              const open = rail || !closedGroups.has(group.id)
              const listId = `${idBase}-group-${group.id}`
              const holdsActive = group.id === screen.group.id
              return (
                <div key={group.id}>
                  {rail ? (
                    index > 0 && <div role="separator" className="mx-auto my-2 h-px w-8 bg-hairline" />
                  ) : (
                    <button
                      type="button"
                      data-group={group.id}
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => toggleGroup(group.id)}
                      className={cn(
                        'relative z-[1] flex h-8 w-full items-center gap-2 rounded-ctl px-3 text-start text-[11.5px] font-bold hover:text-fg-2',
                        index > 0 && 'mt-2',
                        holdsActive && !open ? 'text-primary dark:text-indigo-300' : 'text-fg-3',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={cn('shrink-0 transition-transform duration-300 ease-spring', !open && 'rotate-90')}
                      />
                    </button>
                  )}
                  {open && (
                    <ul id={listId} aria-label={rail ? group.label : undefined} className="grid gap-0.5">
                      {group.screens.map((item) => {
                        const active = item.id === screen.id
                        const Icon = item.icon
                        return (
                          <li key={item.id}>
                            <a
                              href={hrefFor(item.id)}
                              data-screen={item.id}
                              aria-current={active ? 'page' : undefined}
                              aria-label={rail ? item.title : undefined}
                              onClick={() => onNavigate?.()}
                              {...tipFor(item.title)}
                              className={cn(
                                'relative z-[1] flex h-10 items-center gap-2.5 rounded-ctl text-[13px]',
                                rail ? 'justify-center' : 'px-3',
                                active
                                  ? 'font-bold text-primary dark:text-indigo-300'
                                  : 'font-semibold text-fg-2 hover:bg-fg/5 hover:text-fg',
                              )}
                            >
                              <Icon size={18} strokeWidth={active ? 2.25 : 1.9} aria-hidden="true" className="shrink-0" />
                              {!rail && <span className="min-w-0 truncate">{item.title}</span>}
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </nav>
      </div>

      {/* Pinned: settings */}
      <div className="shrink-0 border-t border-hairline px-3 py-2">
        {SETTINGS_GROUP.screens.map((item) => {
          const active = item.id === screen.id
          const Icon = item.icon
          return (
            <a
              key={item.id}
              href={hrefFor(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={rail ? item.title : undefined}
              onClick={() => onNavigate?.()}
              {...tipFor(item.title)}
              className={cn(
                'relative flex h-10 items-center gap-2.5 rounded-ctl text-[13px]',
                rail ? 'justify-center' : 'px-3',
                active
                  ? 'bg-primary-soft font-bold text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)] dark:text-indigo-300'
                  : 'font-semibold text-fg-2 hover:bg-fg/5 hover:text-fg',
              )}
            >
              {active && (
                <span aria-hidden="true" className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-linear-to-b from-primary to-primary-2" />
              )}
              <Icon size={18} strokeWidth={active ? 2.25 : 1.9} aria-hidden="true" className="shrink-0" />
              {!rail && <span className="min-w-0 truncate">{item.title}</span>}
            </a>
          )
        })}
      </div>

      {onToggleRail && (
        <div className="shrink-0 border-t border-hairline p-3">
          <button
            type="button"
            onClick={() => {
              setTip(null)
              onToggleRail()
            }}
            aria-label={rail ? 'توسيع الشريط الجانبي' : undefined}
            aria-expanded={!rail}
            {...tipFor('توسيع الشريط الجانبي')}
            className={cn(
              'flex h-10 w-full items-center gap-2.5 rounded-ctl text-[13px] font-semibold text-fg-3 hover:bg-fg/5 hover:text-fg',
              rail ? 'justify-center' : 'px-3',
            )}
          >
            {rail ? <PanelRightOpen size={18} aria-hidden="true" /> : <PanelRightClose size={18} aria-hidden="true" />}
            {!rail && <span>طي الشريط الجانبي</span>}
          </button>
        </div>
      )}

      {rail &&
        tip &&
        createPortal(
          // Left of the rail (the rail sits on the right in RTL).
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[90]"
            style={{
              top: tip.rect.top + tip.rect.height / 2,
              left: tip.rect.left - 10,
              transform: 'translate(-100%, -50%)',
            }}
          >
            <div className="glass-float pop whitespace-nowrap rounded-ctl px-2.5 py-1.5 text-[12.5px] font-semibold text-fg">
              {tip.label}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/* ==================================================================
   Mobile drawer — slides in from the right
   ================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

function MobileDrawer({
  id,
  open,
  onClose,
  returnFocusRef,
  children,
}: {
  id: string
  open: boolean
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useLatest(onClose)

  useEffect(() => {
    if (!open) return
    const { body } = document
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      ;(panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel)?.focus({ preventScroll: true })
    })
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = previousOverflow
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open, onCloseRef, returnFocusRef])

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    )
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="lg:hidden">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'backdrop z-40 transition-[opacity,visibility] duration-200',
          open ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="القائمة الرئيسية"
        tabIndex={-1}
        inert={!open}
        onKeyDown={trapFocus}
        className={cn(
          'glass-float fixed inset-y-0 right-0 z-50 flex w-[min(300px,86vw)] rounded-r-none outline-none',
          'transition-[transform,visibility] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          open ? 'visible translate-x-0' : 'invisible translate-x-full',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/* ==================================================================
   Header
   ================================================================== */

function Header({
  screen,
  drawerId,
  drawerOpen,
  menuButtonRef,
  onOpenDrawer,
  onPrimary,
}: {
  screen: ScreenMeta
  drawerId: string
  drawerOpen: boolean
  menuButtonRef: RefObject<HTMLButtonElement | null>
  onOpenDrawer: () => void
  onPrimary: () => void
}) {
  const ActionIcon = screen.actionIcon
  const isReport = screen.module.id === 'reports'
  const shortcut = isReport ? SHORTCUT_PRINT_LABEL : SHORTCUT_LABEL
  const { settings } = useData()
  return (
    <header className="glass sticky top-0 z-20 rounded-none border-x-0 border-t-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
        <Button
          ref={menuButtonRef}
          variant="glass"
          aria-label="فتح القائمة"
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          onClick={onOpenDrawer}
          iconStart={<Menu size={20} aria-hidden="true" />}
          className="lg:hidden"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <nav aria-label="مسار التنقل" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1 text-[12px] font-semibold text-fg-3">
                <li className="truncate">{screen.module.label}</li>
                <li className="flex min-w-0 items-center gap-1">
                  <ChevronLeft size={13} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{screen.group.label}</span>
                </li>
              </ol>
            </nav>
            {settings.projectName.trim() && <ProjectBadge className="max-w-[16rem] py-0.5 text-[11.5px]" />}
          </div>
          <Text
            variant="page"
            as="h1"
            id="page-title"
            className="mt-0.5 truncate text-[20px] leading-tight sm:text-[24px] xl:text-[28px]"
          >
            {screen.title}
          </Text>
        </div>

        <div className="order-last flex w-full items-center gap-2 md:order-none md:w-auto">
          <GlobalSearch className="min-w-0 flex-1 md:w-52 md:flex-none xl:w-64" screens={searchScreenItems} />
          <Button
            onClick={onPrimary}
            iconStart={<ActionIcon size={18} aria-hidden="true" />}
            aria-label={screen.action}
            aria-keyshortcuts={isReport ? 'Control+P Meta+P' : 'Control+N Meta+N'}
            title={`${screen.action} (${shortcut})`}
            className="shrink-0 max-lg:aspect-square max-lg:px-0"
          >
            <span className="hidden lg:inline">{screen.action}</span>
            <kbd
              dir="ltr"
              className="hidden rounded-md bg-white/20 px-1.5 py-1 font-sans text-[11px] font-bold leading-none xl:inline"
            >
              {shortcut}
            </kbd>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <ShortcutsMenu />
          <NotificationsMenu />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

function ThemeToggle() {
  const { dark, setDark } = useApp()
  return (
    <IconBtn
      icon={
        <span key={dark ? 'sun' : 'moon'} className="pop grid place-items-center">
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </span>
      }
      label={dark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
      onClick={() => setDark(!dark)}
    />
  )
}

/* ==================================================================
   Popover — portaled, fixed below its anchor, dismissed by outside press or Escape
   ================================================================== */

type CloseReason = 'escape' | 'outside'

type PopoverProps = Omit<ComponentProps<'div'>, 'ref'> & {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: (reason: CloseReason) => void
  /** Never narrower than this (px); defaults to the anchor's width. */
  minWidth?: number
}

function Popover({ anchorRef, open, onClose, minWidth = 0, className, style, children, ...props }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<CSSProperties | null>(null)
  const onCloseRef = useLatest(onClose)

  useLayoutEffect(() => {
    if (!open) return
    const place = (event?: Event) => {
      if (event?.target instanceof Node && ref.current?.contains(event.target)) return // scrolling inside
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const viewport = document.documentElement.clientWidth
      const width = Math.min(Math.max(anchor.width, minWidth), viewport - 16)
      const top = anchor.bottom + 8
      // Start-aligned (right edge in RTL), clamped into the viewport.
      const left = Math.min(Math.max(8, anchor.right - width), viewport - width - 8)
      setBox({ top, left, width, maxHeight: Math.max(180, window.innerHeight - top - 12) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, minWidth])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onCloseRef.current('outside')
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseRef.current('escape')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchorRef, onCloseRef])

  if (!open || !box) return null
  return createPortal(
    <div ref={ref} {...props} className={cn('kit-popover glass-float rounded-card', className)} style={{ ...box, ...style }}>
      {children}
    </div>,
    document.body,
  )
}


/* ==================================================================
   Notifications — derived from live data
   ================================================================== */

type NoticeTone = 'danger' | 'warning' | 'primary'

interface Notice {
  key: string
  title: string
  detail: string
  meta: string
}

interface NoticeGroup {
  id: string
  label: string
  icon: LucideIcon
  tone: NoticeTone
  /** Where "show all" and each notice lead. */
  screenId: string
  /** Full count from the server; `items` is capped for the popover. */
  total: number
  items: Notice[]
}

const TONE_TILE: Record<NoticeTone, string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  primary: 'bg-primary-soft text-primary dark:text-indigo-300',
}

const NOTICES_PER_GROUP = 3

/** `dayCount(1)` → `يوم`, `(2)` → `يومين`, `(5)` → `5 أيام`, `(12)` → `12 يومًا` */
function dayCount(n: number): string {
  if (n === 1) return 'يوم'
  if (n === 2) return 'يومين'
  if (n >= 3 && n <= 10) return `${n} أيام`
  return `${n} يومًا`
}

function useNotices(): NoticeGroup[] {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [groups, setGroups] = useState<NoticeGroup[]>([])

  useEffect(() => {
    let alive = true
    const load = () => {
      if (!userId || !hasToken()) {
        if (alive) setGroups([])
        return
      }
      fetchNotifications()
        .then(({ groups: incoming }) => {
          if (!alive) return
          setGroups(
            incoming
              .filter((group) => group.items.length > 0)
              .map((group) => ({
                id: group.id,
                label: group.label,
                icon: group.id === 'overdue' ? TriangleAlert : CalendarClock,
                tone: group.tone,
                screenId: group.screen,
                total: group.total,
                items: group.items.map((item) => ({
                  key: item.key,
                  title: item.client_name || 'عميل',
                  detail:
                    group.id === 'overdue'
                      ? `القسط ${item.sequence_number} · متبقي ${egp(Number(item.remaining))} · متأخر ${dayCount(item.days_overdue)}`
                      : `القسط ${item.sequence_number} · ${egp(Number(item.remaining))} يستحق اليوم`,
                  meta: [item.unit_name && `وحدة ${item.unit_name}`, item.building_name].filter(Boolean).join(' · '),
                })),
              })),
          )
        })
        .catch(() => {
          // The bell is not critical: keep the last list and retry on the next tick.
        })
    }

    load()
    const timer = window.setInterval(load, 120_000)
    const refresh = () => load()
    window.addEventListener('focus', refresh)
    window.addEventListener('hashchange', refresh)
    window.addEventListener('aqar:token-changed', refresh)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('hashchange', refresh)
      window.removeEventListener('aqar:token-changed', refresh)
    }
  }, [userId])

  return groups
}

function readSeen(): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Header popover listing the global keyboard shortcuts. */
function ShortcutsMenu() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const close = useCallback((reason?: CloseReason) => {
    setOpen(false)
    if (reason === 'escape') triggerRef.current?.focus()
  }, [])
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-label="اختصارات لوحة المفاتيح"
        title="اختصارات لوحة المفاتيح"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        iconStart={<Keyboard size={19} aria-hidden="true" />}
        className="max-sm:hidden"
      />
      <Popover anchorRef={triggerRef} open={open} onClose={close} minWidth={300} role="dialog" aria-labelledby={titleId} className="p-0">
        <div className="border-b border-hairline px-4 py-3">
          <Text variant="section" as="h2" id={titleId} className="text-[15px]">
            اختصارات لوحة المفاتيح
          </Text>
        </div>
        <ul className="m-0 grid list-none gap-0.5 p-2">
          {SHORTCUT_LIST.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 rounded-ctl px-2.5 py-2 text-[13px] text-fg-2">
              <span>{s.label}</span>
              <kbd
                dir="ltr"
                className="rounded-md border border-hairline bg-neutral-soft px-1.5 py-0.5 font-sans text-[11px] font-bold text-fg"
              >
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  )
}

const canNotify = () => typeof Notification !== 'undefined'

function NotificationsMenu() {
  const groups = useNotices()
  const toast = useToast()
  const [desktop, setDesktop] = useState(() => {
    try {
      return canNotify() && Notification.permission === 'granted' && localStorage.getItem(DESKTOP_NOTICES_KEY) === '1'
    } catch {
      return false
    }
  })
  /** Keys already announced this session, so each alert pops up once. */
  const announced = useRef<Set<string> | null>(null)
  const [seen, setSeen] = useState(readSeen)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  const keys = groups.flatMap((group) => group.items.map((item) => item.key))
  const unread = keys.filter((key) => !seen.has(key))
  const total = keys.length

  const close = useCallback((reason?: CloseReason) => {
    setOpen(false)
    if (reason === 'escape') triggerRef.current?.focus()
  }, [])

  // On entering the app: one toast summarising what needs attention. Afterwards: a toast and, when
  // enabled, a desktop notification for each alert that appears while the app is open.
  const unreadKey = unread.join('|')
  useEffect(() => {
    const first = announced.current === null
    const known = (announced.current ??= new Set())
    const fresh = unread.filter((key) => !known.has(key))
    fresh.forEach((key) => known.add(key))
    if (fresh.length === 0) return
    const urgent = groups.find((g) => g.id === 'overdue')?.total ?? 0
    const title = first
      ? `لديك ${fresh.length} ${fresh.length === 1 ? 'تنبيه جديد' : 'تنبيهات جديدة'}`
      : `${fresh.length} ${fresh.length === 1 ? 'تنبيه جديد' : 'تنبيهات جديدة'}`
    const body = urgent > 0 && first ? `${urgent} قسط/إيجار متأخر يحتاج متابعة` : 'افتح قائمة الإشعارات للاطلاع عليها'
    toast[urgent > 0 && first ? 'warning' : 'info'](title, body)
    if (desktop && canNotify() && document.visibilityState !== 'visible') {
      try {
        new Notification(`${APP_NAME} — ${title}`, { body, tag: 'codex-control-notices', lang: 'ar', dir: 'rtl' })
      } catch {
        // Desktop notifications are unavailable in this context.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey, desktop])

  const toggleDesktop = async () => {
    if (!canNotify()) return toast.error('غير مدعوم', 'المتصفح لا يدعم إشعارات سطح المكتب.')
    if (desktop) {
      setDesktop(false)
      localStorage.setItem(DESKTOP_NOTICES_KEY, '0')
      return toast.info('تم إيقاف إشعارات سطح المكتب')
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return toast.error('الإذن مرفوض', 'اسمح بالإشعارات من إعدادات المتصفح ثم أعد المحاولة.')
    setDesktop(true)
    localStorage.setItem(DESKTOP_NOTICES_KEY, '1')
    toast.success('تم تفعيل إشعارات سطح المكتب', 'ستصلك التنبيهات الجديدة حتى والتطبيق في الخلفية.')
    try {
      new Notification(APP_NAME, { body: 'إشعارات سطح المكتب تعمل الآن.', lang: 'ar', dir: 'rtl' })
    } catch {
      // Ignore; the toast above already confirmed.
    }
  }

  const toggle = () => {
    if (open) return close()
    // Opening marks everything as seen; the "new" dots stay for this viewing.
    const nextSeen = new Set(keys)
    setFresh(new Set(unread))
    setSeen(nextSeen)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...nextSeen]))
    } catch {
      // Not persisted; the badge simply returns after a reload.
    }
    setOpen(true)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-label={unread.length > 0 ? `الإشعارات: ${unread.length} جديدة` : 'الإشعارات'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        iconStart={
          <>
            <Bell size={19} aria-hidden="true" />
            {unread.length > 0 && (
              <span
                dir="ltr"
                aria-hidden="true"
                className="pop absolute end-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg"
              >
                {unread.length > 9 ? '9+' : unread.length}
              </span>
            )}
          </>
        }
      />
      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        minWidth={380}
        role="dialog"
        aria-labelledby={titleId}
        className="p-0"
      >
        <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-hairline bg-[var(--glass-strong)] px-4 py-3">
          <Text variant="section" as="h2" id={titleId} className="flex-1 text-[15px]">
            الإشعارات
          </Text>
          {total > 0 && <Badge tone="neutral">{total}</Badge>}
        </div>

        {total === 0 ? (
          <div className="grid place-items-center gap-2 px-6 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
              <BellRing size={22} aria-hidden="true" />
            </span>
            <p className="text-[13.5px] font-semibold text-fg">لا توجد تنبيهات</p>
            <p className="text-[12px] text-fg-3">لا أقساط متأخرة ولا أقساط أو إيجارات تستحق اليوم.</p>
          </div>
        ) : (
          <div className="grid gap-1 p-2">
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => {
                const Icon = group.icon
                return (
                  <section key={group.id} aria-label={group.label} className="py-1">
                    <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
                      <h3 className="flex-1 text-[12px] font-bold text-fg-3">
                        {group.label} <span className="font-semibold">({group.total})</span>
                      </h3>
                      {group.total > NOTICES_PER_GROUP && (
                        <a
                          href={hrefFor(group.screenId)}
                          onClick={() => close()}
                          className="text-[12px] font-semibold text-primary hover:underline dark:text-indigo-300"
                        >
                          عرض الكل
                        </a>
                      )}
                    </div>
                    <ul className="grid gap-0.5">
                      {group.items.slice(0, NOTICES_PER_GROUP).map((item) => (
                        <li key={item.key}>
                          <a
                            href={hrefFor(group.screenId)}
                            onClick={() => close()}
                            className="flex gap-3 rounded-[12px] px-2.5 py-2 hover:bg-fg/5"
                          >
                            <span
                              className={cn(
                                'mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px]',
                                TONE_TILE[group.tone],
                              )}
                            >
                              <Icon size={16} aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-bold text-fg">{item.title}</span>
                                {fresh.has(item.key) && (
                                  <span className="size-1.5 shrink-0 rounded-full bg-primary">
                                    <span className="sr-only">جديد</span>
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-[12.5px] text-fg-2">{item.detail}</span>
                              {item.meta && <span className="block truncate text-[11.5px] text-fg-3">{item.meta}</span>}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
          <button
            type="button"
            role="switch"
            aria-checked={desktop}
            onClick={() => void toggleDesktop()}
            className="flex flex-1 items-center gap-2 rounded-ctl px-2 py-1.5 text-start text-[12.5px] font-semibold text-fg-2 hover:bg-fg/5"
          >
            {desktop ? <BellRing size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
            <span className="flex-1">إشعارات سطح المكتب</span>
            <Badge tone={desktop ? 'green' : 'neutral'}>{desktop ? 'مفعّلة' : 'متوقفة'}</Badge>
          </button>
        </div>
      </Popover>
    </>
  )
}

/* ==================================================================
   User menu
   ================================================================== */

const USER_MENU = [
  { label: 'الملف الشخصي', icon: UserRound },
  { label: 'الإعدادات', icon: Settings },
  { label: 'تسجيل الخروج', icon: LogOut, danger: true },
] as const

function Avatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-linear-135 from-primary to-primary-2 text-white',
        className,
      )}
    >
      <UserRound size={17} />
    </span>
  )
}

function UserMenu() {
  const toast = useToast()
  const { user, logout } = useAuth()
  const name = user?.username ?? 'مدير النظام'
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((reason?: CloseReason | 'select') => {
    setOpen(false)
    if (reason === 'escape' || reason === 'select') triggerRef.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`حساب ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="ms-1 flex h-10 items-center gap-2 rounded-full p-1 hover:bg-fg/5 2xl:pe-3"
      >
        <Avatar />
        <span className="hidden text-start 2xl:block">
          <span className="block max-w-[10rem] truncate text-[13px] font-bold leading-tight text-fg">{name}</span>
          <span className="block text-[11px] leading-tight text-fg-3">صلاحيات كاملة</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" className="hidden text-fg-3 2xl:block" />
      </button>
      <Popover anchorRef={triggerRef} open={open} onClose={close} minWidth={248} className="p-1.5">
        <UserMenuList
          id={menuId}
          name={name}
          email={user?.email ?? ''}
          onClose={close}
          onSelect={(label) => {
            if (label === 'الإعدادات') navigateTo(SETTINGS_SCREEN_ID)
            else if (label === 'تسجيل الخروج') logout()
            else toast.info(name, user?.email)
          }}
        />
      </Popover>
    </>
  )
}

function UserMenuList({
  id,
  name,
  email,
  onClose,
  onSelect,
}: {
  id: string
  name: string
  email: string
  onClose: (reason: CloseReason | 'select') => void
  onSelect: (label: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      onClose('escape')
      return
    }
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next < 0) return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div ref={ref} id={id} role="menu" aria-label={`حساب ${name}`} onKeyDown={onKeyDown}>
      <div role="none" className="flex items-center gap-3 px-2.5 pb-3 pt-2">
        <Avatar className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-fg">{name}</p>
          <p dir="ltr" className="truncate text-start text-[12px] text-fg-3">{email || 'صلاحيات كاملة على النظام'}</p>
        </div>
      </div>
      {USER_MENU.map((item) => {
        const Icon = item.icon
        const danger = 'danger' in item && item.danger
        return (
          <div key={item.label} role="none">
            {danger && <div role="separator" className="mx-2 my-1.5 h-px bg-hairline" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                onClose('select')
                onSelect(item.label)
              }}
              className={cn(
                'kit-option w-full text-start text-[13.5px] font-semibold hover:bg-fg/5 focus:bg-primary-soft',
                danger && 'text-danger',
              )}
            >
              <Icon size={17} aria-hidden="true" className="shrink-0" />
              {item.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
