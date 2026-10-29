import type {
  Building,
  BuildingType,
  Client,
  ClientType,
  Contract,
  ContractStatus,
  ContractType,
  DataState,
  Installment,
  Maintenance,
  MaintenanceStatus,
  MaintenanceType,
  OwnerUnion,
  Payment,
  PaymentMethod,
  Reservation,
  ReservationStatus,
  Settings,
  Unit,
  UnitPurpose,
  UnitStatus,
  UnitType,
} from './lib'
import {
  addDays,
  addMonths,
  CONTRACT_PREFIX,
  formatId,
  installmentStatus,
  leaseEndDate,
  pad,
  rentSchedule,
  roundTo,
  toISO,
  type ISODate,
} from './lib/domain'

/** The app's fixed "today". Every seed date and status is computed relative to it. */
export const TODAY = new Date(2025, 5, 18)
export const TODAY_ISO: ISODate = toISO(TODAY)

/* ==================================================================
   Deterministic RNG (mulberry32) — the seed is identical on every reset
   ================================================================== */

function createRng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
      let r = next() * entries.reduce((sum, [, w]) => sum + w, 0)
      for (const [value, w] of entries) {
        r -= w
        if (r < 0) return value
      }
      return entries[entries.length - 1][0]
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    digits: (n: number) => Array.from({ length: n }, () => int(0, 9)).join(''),
  }
}

type Rng = ReturnType<typeof createRng>
type Gender = 'm' | 'f'

const repeat = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value)
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/* ==================================================================
   Reference data
   ================================================================== */

/** Owner clients (type مالك); buildings reference them by index through `owners`. */
const OWNER_PROFILES: Array<{ fullName: string; birthDate: ISODate; gender: Gender; address: string }> = [
  { fullName: 'عبد الرحمن فوزي الدمرداش', birthDate: '1958-03-12', gender: 'm', address: '22 شارع الخليفة المأمون، مصر الجديدة، القاهرة' },
  { fullName: 'سمير لطفي عبد الملك', birthDate: '1961-11-02', gender: 'm', address: '5 شارع قصر النيل، وسط البلد، القاهرة' },
  { fullName: 'نبيلة حسن الجندي', birthDate: '1966-07-21', gender: 'f', address: 'فيلا 14 شارع 9، المعادي، القاهرة' },
  { fullName: 'فاروق محمود الزيات', birthDate: '1955-01-30', gender: 'm', address: '3 ميدان الإسماعيلية، مصر الجديدة، القاهرة' },
  { fullName: 'هالة مصطفى البارودي', birthDate: '1970-09-08', gender: 'f', address: 'فيلا 88 الحي الأول، التجمع الخامس، القاهرة' },
  { fullName: 'عزة محمود الشاذلي', birthDate: '1968-04-17', gender: 'f', address: '17 شارع النادي، المعادي، القاهرة' },
  { fullName: 'رفعت سالم الغمراوي', birthDate: '1959-12-05', gender: 'm', address: '40 شارع الحجاز، مصر الجديدة، القاهرة' },
  { fullName: 'ثريا كامل منصور', birthDate: '1972-06-26', gender: 'f', address: 'فيلا 5 النرجس، التجمع الخامس، القاهرة' },
]

const BUILDING_PROFILES: Array<{
  name: string
  types: BuildingType[]
  district: string
  address: string
  floors: number
  units: number
  /** [index into OWNER_PROFILES, share %]; shares add up to 100. */
  owners: ReadonlyArray<readonly [number, number]>
  /** District price multiplier. */
  priceFactor: number
}> = [
  { name: 'برج ألفا', types: ['تجاري', 'إداري'], district: 'مدينة نصر', address: '45 شارع عباس العقاد', floors: 6, units: 15, owners: [[0, 100]], priceFactor: 1 },
  { name: 'برج بيتا', types: ['تجاري', 'إداري', 'مخزني'], district: 'وسط البلد', address: '12 شارع طلعت حرب', floors: 5, units: 15, owners: [[1, 100]], priceFactor: 1.1 },
  { name: 'عمارة النيل', types: ['سكني'], district: 'المعادي', address: '1120 كورنيش النيل', floors: 7, units: 18, owners: [[2, 40], [3, 40], [5, 20]], priceFactor: 1.25 },
  { name: 'عمارة الزهراء', types: ['سكني', 'تجاري'], district: 'مصر الجديدة', address: '8 شارع الميرغني', floors: 5, units: 16, owners: [[2, 50], [3, 30], [6, 20]], priceFactor: 0.95 },
  { name: 'مجمع القاهرة الجديدة', types: ['سكني', 'تجاري', 'إداري'], district: 'التجمع الخامس', address: 'شارع التسعين الشمالي', floors: 7, units: 16, owners: [[4, 70], [7, 30]], priceFactor: 1.15 },
]

/** Buyers, tenants and prospects: [full name, gender]. */
const CLIENT_PROFILES: ReadonlyArray<readonly [string, Gender]> = [
  ['أحمد محمد السيد', 'm'],
  ['محمود عبد الله منصور', 'm'],
  ['منى إبراهيم فهمي', 'f'],
  ['كريم حسن الشافعي', 'm'],
  ['سارة عادل حجازي', 'f'],
  ['مصطفى علي النجار', 'm'],
  ['عمرو خالد سليمان', 'm'],
  ['ياسمين طارق الشريف', 'f'],
  ['هشام فؤاد رزق', 'm'],
  ['خالد سمير عوض', 'm'],
  ['نهى مصطفى جاد', 'f'],
  ['شريف أحمد البنا', 'm'],
  ['وليد محمد عيسى', 'm'],
  ['هبة سامي زكي', 'f'],
  ['طارق حسين حنفي', 'm'],
  ['ريهام أشرف شاكر', 'f'],
  ['ياسر عبد الحميد القاضي', 'm'],
  ['إسلام جمال مرسي', 'm'],
  ['مينا جرجس حبيب', 'm'],
  ['دينا مجدي صادق', 'f'],
  ['أيمن رضا توفيق', 'm'],
  ['حسام الدين محمود عثمان', 'm'],
  ['مريم نبيل غالي', 'f'],
  ['عادل فتحي المصري', 'm'],
  ['تامر يحيى عبد العزيز', 'm'],
  ['رانيا سعيد الجمال', 'f'],
  ['سامح كمال بدوي', 'm'],
  ['باسم عصام الشناوي', 'm'],
  ['شيماء ماهر الدسوقي', 'f'],
  ['رامي وجيه شنودة', 'm'],
  ['حازم ممدوح عبد الرحمن', 'm'],
  ['إيمان صلاح الدين البحيري', 'f'],
  ['علاء حمدي الصاوي', 'm'],
  ['يوسف أسامة الحسيني', 'm'],
  ['نورهان عاطف الليثي', 'f'],
  ['عمر هاني فاروق', 'm'],
  ['إبراهيم سعد الخولي', 'm'],
  ['سلمى وائل رشدي', 'f'],
  ['حسن عبد الفتاح زيدان', 'm'],
  ['نادر بهاء الشربيني', 'm'],
  ['مي حسام قنديل', 'f'],
  ['بيتر سمير عبد المسيح', 'm'],
  ['محمد رأفت العشري', 'm'],
  ['ندى شريف أبو زيد', 'f'],
  ['أشرف إسماعيل الطوخي', 'm'],
  ['جورج فايز ميخائيل', 'm'],
  ['ماريان عماد يوسف', 'f'],
  ['إسماعيل عبد الرازق النمر', 'm'],
  ['عبد الله رمضان الفقي', 'm'],
  ['هالة سمير الحداد', 'f'],
  ['محمد عبد الغني شلبي', 'm'],
  ['نيرة أحمد الكاشف', 'f'],
  ['أنس طارق بركات', 'm'],
  ['فادي نبيل إسكندر', 'm'],
  ['شادي عزت المليجي', 'm'],
  ['رحاب فتحي عبد السلام', 'f'],
  ['مروان سيد الأنصاري', 'm'],
  ['أمل رجب سليم', 'f'],
  ['زياد حمدي عبد المنعم', 'm'],
  ['فريدة أحمد شوقي', 'f'],
  ['عصام نصر الدين الفخراني', 'm'],
  ['لبنى ياسر الحلواني', 'f'],
  ['كمال عبد الهادي درويش', 'm'],
  ['سهى مدحت النحاس', 'f'],
]

const HOME_ADDRESSES = [
  '14 شارع مصطفى النحاس، مدينة نصر، القاهرة',
  '7 شارع التحرير، الدقي، الجيزة',
  '33 شارع جامعة الدول العربية، المهندسين، الجيزة',
  '18 شارع شبرا، شبرا، القاهرة',
  '9 شارع النزهة، مصر الجديدة، القاهرة',
  '41 شارع الهرم، الهرم، الجيزة',
  '120 شارع 9، المعادي، القاهرة',
  '6 شارع الطيران، مدينة نصر، القاهرة',
  '25 شارع رمسيس، العباسية، القاهرة',
  '11 شارع أحمد عرابي، المهندسين، الجيزة',
  'عمارة 12، الهضبة الوسطى، المقطم، القاهرة',
  '3 شارع النصر، حدائق الأهرام، الجيزة',
]

const CLIENT_NOTES = [
  '',
  '',
  '',
  '',
  'التواصل المفضل عبر واتساب',
  'السداد منتظم منذ التعاقد',
  'يفضل السداد بتحويل بنكي',
  'التواصل مساءً بعد الخامسة',
  'مهتم بوحدة إضافية في نفس المشروع',
]

const CONTRACT_NOTES = [
  '',
  '',
  '',
  'تسليم الوحدة بعد سداد 50% من الثمن',
  'الوحدة تسلم بتشطيب كامل',
  'جدول سداد مرن بالاتفاق مع العميل',
  'دفعة سنوية إضافية في شهر ديسمبر',
]

const NON_SELLABLE_REASONS = [
  'نزاع قضائي على الملكية',
  'الوحدة تحت التجديد الشامل',
  'مخصصة كمقر إداري للشركة',
  'في انتظار استخراج رخصة التشطيب',
  'مرهونة لصالح البنك',
  'مخصصة لحارس العقار',
]

const LEASE_NOTES = [
  '',
  '',
  'الإيجار يُسدد أول كل شهر',
  'التأمين يُرد عند تسليم الوحدة بحالتها',
  'استهلاك الكهرباء والمياه على المستأجر',
  'غير مسموح بالتأجير من الباطن',
]

/** Sale price per m², EGP. */
const UNIT_SPECS: Record<UnitType, { area: readonly [number, number]; rate: number }> = {
  شقة: { area: [95, 220], rate: 18_000 },
  استوديو: { area: [45, 70], rate: 22_000 },
  روف: { area: [80, 160], rate: 16_000 },
  محل: { area: [30, 120], rate: 32_000 },
  مكتب: { area: [60, 180], rate: 21_000 },
  ميزانين: { area: [40, 90], rate: 20_000 },
  مستودع: { area: [100, 250], rate: 9_000 },
  بدروم: { area: [80, 200], rate: 7_000 },
}

/** Monthly rent per m², EGP. */
const RENT_RATE: Record<UnitType, number> = {
  شقة: 60,
  استوديو: 90,
  روف: 55,
  محل: 130,
  مكتب: 75,
  ميزانين: 65,
  مستودع: 30,
  بدروم: 28,
}

/** The project name starts empty so the first launch asks for it. */
export const DEFAULT_SETTINGS: Settings = {
  projectName: '',
  companyName: 'شركة الأفق للتطوير العقاري',
  companyAddress: '90 شارع التسعين الشمالي، التجمع الخامس، القاهرة',
  companyPhone: '02-25550190',
  companyLogo: '',
  ourLogo: '',
  showCompanyLogo: true,
  showOurLogo: true,
}

const MAINTENANCE_CATALOG: Record<
  MaintenanceType,
  { cost: readonly [number, number]; vendors: string[]; issues: string[] }
> = {
  سباكة: {
    cost: [400, 3500],
    vendors: ['م. سامح فوزي — سباكة', 'ورشة الأمانة للسباكة'],
    issues: [
      'تسريب مياه أسفل حوض المطبخ',
      'انسداد في صرف الحمام الرئيسي',
      'تغيير الخلاطات وسخان المياه',
      'تسريب في مواسير الحمام يؤثر على سقف الدور السفلي',
    ],
  },
  كهرباء: {
    cost: [600, 8000],
    vendors: ['ورشة النور للكهرباء', 'م. هشام عادل — كهرباء'],
    issues: [
      'انقطاع متكرر في دائرة كهرباء المطبخ',
      'تغيير لوحة التوزيع وتأريض الوحدة',
      'إعادة تأسيس كهرباء الوحدة بالكامل',
    ],
  },
  تكييف: {
    cost: [500, 4000],
    vendors: ['كول تك للتكييف', 'م. رامز عزمي — تكييف'],
    issues: [
      'التكييف لا يبرد ويحتاج شحن فريون',
      'صيانة دورية لوحدات التكييف',
      'تسريب مياه من الوحدة الداخلية للتكييف',
    ],
  },
  دهانات: {
    cost: [3000, 18000],
    vendors: ['م. عاطف حلمي — دهانات وديكور'],
    issues: [
      'تجديد دهانات شامل بعد إخلاء الوحدة',
      'معالجة رطوبة وتقشر دهان في الحوائط',
      'دهان الأسقف والحوائط بعد إصلاح التسريب',
    ],
  },
  نجارة: {
    cost: [800, 9000],
    vendors: ['المعلم رجب عبد الحليم — نجارة'],
    issues: [
      'إصلاح باب الشرفة وضبط النوافذ',
      'تغيير كالون الباب الرئيسي وضبط الأبواب',
      'تركيب وحدات مطبخ جديدة',
    ],
  },
  مصاعد: {
    cost: [2500, 15000],
    vendors: ['الشرق لصيانة المصاعد'],
    issues: ['صيانة دورية للمصعد وتغيير كابلات الجر', 'إصلاح باب المصعد بالدور الثالث'],
  },
  عام: {
    cost: [1500, 12000],
    vendors: ['فريق الصيانة الداخلي'],
    issues: ['تنظيف وتعقيم خزانات المياه العلوية', 'عزل السطح ضد تسرب المياه', 'صيانة مولد الكهرباء الاحتياطي'],
  },
}

const UNION_PROFILES = [
  {
    name: 'اتحاد ملاك عمارة النيل',
    buildingId: 'b-03',
    monthlyFee: 350,
    meetingSchedule: 'أول جمعة من كل شهر — 7:00 مساءً',
    notes: 'يغطي الرسوم الأمن والنظافة وصيانة المصعد',
  },
  {
    name: 'اتحاد ملاك عمارة الزهراء',
    buildingId: 'b-04',
    monthlyFee: 300,
    meetingSchedule: 'كل ثلاثة أشهر — السبت الأخير من الشهر',
    notes: 'جارٍ التعاقد مع شركة أمن جديدة',
  },
  {
    name: 'اتحاد ملاك مجمع القاهرة الجديدة',
    buildingId: 'b-05',
    monthlyFee: 500,
    meetingSchedule: 'الخميس الثاني من كل شهر — 8:00 مساءً',
    notes: 'صيانة دورية للمصاعد ومولد الكهرباء وحديقة المجمع',
  },
]

/* ==================================================================
   Generators
   ================================================================== */

/** Egyptian mobile, `01x-xxxxxxxx`. */
function mobile(rng: Rng): string {
  const prefix = rng.weighted([
    ['010', 0.4],
    ['012', 0.3],
    ['011', 0.2],
    ['015', 0.1],
  ] as const)
  return `${prefix}-${rng.digits(8)}`
}

/**
 * Egyptian national ID: century (2 = 1900s, 3 = 2000s) + YYMMDD + governorate
 * + 3-digit serial + gender digit (odd = male) + check digit → 14 digits.
 */
function nationalId(rng: Rng, birthDate: ISODate, gender: Gender): string {
  const [y, m, d] = birthDate.split('-')
  const century = Number(y) >= 2000 ? '3' : '2'
  const governorate = rng.weighted([
    ['01', 0.55],
    ['21', 0.15],
    ['02', 0.08],
    ['14', 0.07],
    ['12', 0.06],
    ['13', 0.05],
    ['16', 0.04],
  ] as const)
  const genderDigit = rng.pick(gender === 'm' ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8])
  return `${century}${y.slice(2)}${m}${d}${governorate}${rng.digits(3)}${genderDigit}${rng.digits(1)}`
}

const roomsLabel = (n: number) => (n === 1 ? 'غرفة واحدة' : n === 2 ? 'غرفتين' : `${n} غرف`)
const bathsLabel = (n: number) => (n === 1 ? 'حمام' : n === 2 ? 'حمامين' : `${n} حمامات`)

function describeUnit(rng: Rng, type: UnitType, rooms: number, bathrooms: number, onNile: boolean): string {
  switch (type) {
    case 'شقة': {
      const finish = rng.pick(['تشطيب سوبر لوكس', 'تشطيب لوكس', 'تشطيب ألترا سوبر لوكس'])
      const feature =
        onNile && rng.chance(0.5)
          ? 'إطلالة مباشرة على النيل'
          : rng.pick(['بلكونة واسعة', 'مطبخ مجهز', 'تكييفات سبليت', 'إطلالة على حديقة', 'قريبة من المترو', 'واجهة بحرية'])
      return `شقة ${roomsLabel(rooms)} و${bathsLabel(bathrooms)}، ${finish}، ${feature}`
    }
    case 'استوديو':
      return rng.pick([
        'استوديو مفروش بالكامل بمطبخ أمريكي',
        'استوديو بتشطيب حديث وإضاءة طبيعية',
        'استوديو مناسب للأفراد، قريب من الخدمات',
      ])
    case 'روف':
      return `روف ${roomsLabel(rooms)} بتراس خاص ${rng.pick(['مع إطلالة مفتوحة', 'مع جلسة خارجية', 'بتشطيب سوبر لوكس'])}`
    case 'محل':
      return rng.pick(['محل بواجهة زجاجية على الشارع الرئيسي', 'محل ناصية بواجهتين', 'محل بالدور الأول مع سندرة'])
    case 'مكتب':
      return `مكتب إداري ${roomsLabel(rooms)}، ${rng.pick(['مدخل مستقل', 'غرفة اجتماعات', 'مجهز بشبكة إنترنت', 'قريب من المصعد'])}`
    case 'ميزانين':
      return rng.pick(['ميزانين يطل على صالة المحلات', 'ميزانين بسلم داخلي مناسب لمعرض أو مكتب'])
    case 'مستودع':
      return rng.pick(['مستودع بمدخل للسيارات وارتفاع سقف 4 أمتار', 'مخزن جاف مجهز بأرفف معدنية'])
    case 'بدروم':
      return rng.pick(['بدروم بمدخل مستقل مناسب للتخزين', 'بدروم مجهز بتهوية وإضاءة صناعية'])
  }
}

/** Shops on the ground floor of commercial buildings, a mezzanine above them, a roof on top of residential ones. */
function unitTypeFor(rng: Rng, types: readonly BuildingType[], floor: number, floors: number, index: number, count: number): UnitType {
  const residential = types.includes('سكني')
  const shops = types.includes('تجاري')
  const last = index === count && count > 1
  if (floor === 1 && shops) {
    if (last) return types.includes('مخزني') || !residential ? 'مستودع' : 'بدروم'
    return 'محل'
  }
  if (floor === 2 && shops && index === 1) return 'ميزانين'
  if (!residential || (types.includes('إداري') && floor === 2)) return 'مكتب'
  if (floor === floors && last) return 'روف'
  return rng.chance(0.18) ? 'استوديو' : 'شقة'
}

function unitLayout(type: UnitType, area: number): { rooms: number; bathrooms: number } {
  switch (type) {
    case 'شقة':
    case 'روف': {
      const rooms = area < 125 ? 2 : area < 170 ? 3 : 4
      return { rooms, bathrooms: rooms === 4 ? 3 : rooms === 3 ? 2 : 1 }
    }
    case 'مكتب':
      return { rooms: clamp(Math.round(area / 40), 2, 5), bathrooms: area > 120 ? 2 : 1 }
    case 'مستودع':
    case 'بدروم':
      return { rooms: 0, bathrooms: 1 }
    default:
      return { rooms: 1, bathrooms: 1 }
  }
}

const pickMethod = (rng: Rng): PaymentMethod =>
  rng.weighted<PaymentMethod>([
    ['تحويل بنكي', 0.38],
    ['شيك', 0.24],
    ['نقدي', 0.18],
    ['إنستاباي', 0.12],
    ['فودافون كاش', 0.08],
  ])

/**
 * A free schedule: `count` installments with uneven gaps (3–10 weeks, plus occasional long pauses)
 * and uneven amounts (with occasional balloon payments) summing exactly to `financed`.
 */
function freeSchedule(rng: Rng, start: ISODate, financed: number, count: number) {
  const dates: ISODate[] = []
  let date = addDays(start, rng.int(20, 45))
  for (let i = 0; i < count; i++) {
    dates.push(date)
    date = addDays(date, rng.chance(0.08) ? rng.int(80, 120) : rng.int(21, 70))
  }
  const weights = dates.map(() => (rng.chance(0.1) ? 2.5 + rng.next() * 2 : 0.6 + rng.next() * 0.9))
  const total = weights.reduce((a, b) => a + b, 0)
  const amounts = weights.map((w) => roundTo((financed * w) / total, 1000))
  amounts[amounts.length - 1] += financed - amounts.reduce((a, b) => a + b, 0)
  return dates.map((dueDate, i) => ({ dueDate, amount: amounts[i] }))
}

/** Which side of a reservation a unit with `purpose` is reserved for. */
function reservationPurpose(rng: Rng, purpose: UnitPurpose): ContractType {
  if (purpose === 'إيجار') return 'إيجار'
  if (purpose === 'بيع') return 'بيع'
  return rng.chance(0.7) ? 'بيع' : 'إيجار'
}

const clampDate = (d: ISODate, min: ISODate, max: ISODate) => (d < min ? min : d > max ? max : d)

/** A contract before ids and numbers are assigned, with how its seed payments behave. */
type Deal = {
  contract: Contract
  schedule: Array<{ dueDate: ISODate; amount: number }>
  /** Schedule rows from this index on were dropped (returned contracts). */
  keepRows: number
  /** Every kept row is paid in full (completed sales, finished leases). */
  payAll: boolean
}

export function createSeedData(): DataState {
  const rng = createRng(20250618)

  // ---------------------------------------------------------------- Units (80)
  const unitRate = new Map<string, { sale: number; rent: number }>()
  const units: Unit[] = []
  BUILDING_PROFILES.forEach((profile, bi) => {
    const buildingId = formatId('buildings', bi + 1)
    const base = Math.floor(profile.units / profile.floors)
    const extra = profile.units % profile.floors
    for (let floor = 1; floor <= profile.floors; floor++) {
      const count = base + (floor <= extra ? 1 : 0)
      for (let i = 1; i <= count; i++) {
        const type = unitTypeFor(rng, profile.types, floor, profile.floors, i, count)
        const spec = UNIT_SPECS[type]
        const area = rng.int(spec.area[0] / 5, spec.area[1] / 5) * 5
        const { rooms, bathrooms } = unitLayout(type, area)
        const basement = type === 'بدروم'
        const id = formatId('units', units.length + 1)
        // Higher floors sell for slightly more.
        const floorFactor = 1 + (floor - 1) * 0.015
        unitRate.set(id, {
          sale: roundTo(spec.rate * profile.priceFactor * floorFactor, 100),
          rent: clamp(roundTo(area * RENT_RATE[type] * profile.priceFactor, 50), 2_500, 15_000),
        })
        units.push({
          id,
          buildingId,
          number: basement ? `B${pad(i - count + 1)}` : `${floor}${pad(i)}`,
          floor: basement ? -1 : floor,
          type,
          area,
          rooms,
          bathrooms,
          purpose: 'بيع',
          pricePerMeter: 0,
          price: 0,
          priceManual: false,
          monthlyRent: 0,
          status: 'متاحة',
          nonSellableReason: '',
          description: describeUnit(rng, type, rooms, bathrooms, buildingId === 'b-03'),
        })
      }
    }
  })

  // 20 sold (25%) · 12 rented (15%) · 20 available (25%) · 12 reserved (15%) · 8 returned (10%) · 8 not for sale (10%)
  const statuses = rng.shuffle<UnitStatus>([
    ...repeat<UnitStatus>('مباعة', 20),
    ...repeat<UnitStatus>('مؤجرة', 12),
    ...repeat<UnitStatus>('متاحة', 20),
    ...repeat<UnitStatus>('محجوزة', 12),
    ...repeat<UnitStatus>('مرتجعة', 8),
    ...repeat<UnitStatus>('غير قابلة للبيع', 8),
  ])
  units.forEach((unit, i) => {
    unit.status = statuses[i]
    if (unit.status === 'غير قابلة للبيع') unit.nonSellableReason = rng.pick(NON_SELLABLE_REASONS)
  })
  const withStatus = (status: UnitStatus) => units.filter((u) => u.status === status)
  const soldUnits = withStatus('مباعة')
  const rentedUnits = withStatus('مؤجرة')
  const availableUnits = withStatus('متاحة')
  const reservedUnits = withStatus('محجوزة')
  const returnedUnits = withStatus('مرتجعة')
  // What happened to each group's units in the past.
  const returnedLease = returnedUnits.slice(0, 1)
  const returnedSale = returnedUnits.slice(1)
  const cancelledUnits = availableUnits.slice(0, 4) // a cancelled sale
  const endedUnits = availableUnits.slice(4, 5) // a finished lease
  const lapsedUnits = availableUnits.slice(5, 9) // an expired or cancelled reservation
  const resoldUnits = new Set(soldUnits.slice(0, 3)) // returned by an earlier buyer
  const completedUnits = new Set(soldUnits.slice(18)) // paid in full
  const renewedUnits = new Set(rentedUnits.slice(0, 2)) // the tenant renewed

  // Purposes follow each unit's history, then the prices follow the purpose.
  const saleSide = new Set([...soldUnits, ...returnedSale, ...cancelledUnits])
  const rentSide = new Set([...rentedUnits, ...returnedLease, ...endedUnits])
  for (const unit of units) {
    unit.purpose = saleSide.has(unit)
      ? rng.chance(0.75) ? 'بيع' : 'بيع وإيجار'
      : rentSide.has(unit)
        ? rng.chance(0.6) ? 'إيجار' : 'بيع وإيجار'
        : rng.weighted<UnitPurpose>([
            ['بيع', 0.55],
            ['إيجار', 0.2],
            ['بيع وإيجار', 0.25],
          ])
    const rate = unitRate.get(unit.id)!
    if (unit.purpose !== 'إيجار') {
      unit.pricePerMeter = rate.sale
      unit.priceManual = rng.chance(0.12)
      unit.price = unit.priceManual ? roundTo(unit.area * rate.sale * 0.97, 25_000) : unit.area * rate.sale
    }
    if (unit.purpose !== 'بيع') unit.monthlyRent = rate.rent
  }
  const reservedPurpose = reservedUnits.map((u) => reservationPurpose(rng, u.purpose))
  const lapsedPurpose = lapsedUnits.map((u) => reservationPurpose(rng, u.purpose))

  // ---------------------------------------------------------------- Clients (8 owners + 64)
  const clients: Client[] = []
  const addClient = (
    fullName: string,
    gender: Gender,
    type: ClientType,
    { birthDate, address, phone = true, id = true }: { birthDate?: ISODate; address?: string; phone?: boolean; id?: boolean } = {},
  ) => {
    const born = birthDate ?? `${rng.int(1960, 1998)}-${pad(rng.int(1, 12))}-${pad(rng.int(1, 28))}`
    const client: Client = {
      id: formatId('clients', clients.length + 1),
      fullName,
      type,
      phone: phone ? mobile(rng) : '',
      phone2: rng.chance(0.35) ? mobile(rng) : '',
      nationalId: id ? nationalId(rng, born, gender) : '',
      address: address ?? rng.pick(HOME_ADDRESSES),
      notes: rng.pick(CLIENT_NOTES),
    }
    clients.push(client)
    return client
  }
  const owners = OWNER_PROFILES.map((o) => addClient(o.fullName, o.gender, 'مالك', o))
  // Pool slots: 0–33 buyers · 34–47 tenants · 48–59 holders of today's reservations · 60–63 lapsed reservations.
  const typeOfSlot = (slot: number): ClientType => {
    if (slot < 34) return 'مشتري'
    if (slot < 48) return 'مستأجر'
    const purpose = slot < 60 ? reservedPurpose[slot - 48] : lapsedPurpose[slot - 60]
    return purpose === 'إيجار' ? 'مستأجر' : 'مشتري'
  }
  const pool = rng
    .shuffle(CLIENT_PROFILES)
    // A few prospects only left a name, or a name and a phone.
    .map(([name, gender], slot) => addClient(name, gender, typeOfSlot(slot), { id: ![50, 55, 61, 62].includes(slot), phone: slot !== 62 }))

  // ---------------------------------------------------------------- Buildings
  const buildings: Building[] = BUILDING_PROFILES.map((profile, i) => ({
    id: formatId('buildings', i + 1),
    name: profile.name,
    address: profile.address,
    district: profile.district,
    city: 'القاهرة',
    totalFloors: profile.floors,
    totalUnits: profile.units,
    types: profile.types,
    ownerShares: profile.owners.map(([owner, share]) => ({ clientId: owners[owner].id, share })),
    status: 'نشط',
  }))

  // ---------------------------------------------------------------- Contract plans
  const deals: Deal[] = []
  const saleDeal = (unit: Unit, clientId: string, date: ISODate, status: ContractStatus): Deal => {
    const unitPrice = roundTo(unit.price * (0.95 + rng.next() * 0.05), 5_000)
    const downPayment = roundTo(unitPrice * (0.1 + rng.next() * 0.2), 5_000)
    const count = status === 'مكتمل' ? rng.int(6, 14) : rng.int(12, 60)
    return {
      contract: { id: '', number: '', reservationId: '', type: 'بيع', unitId: unit.id, clientId, date, status, notes: rng.pick(CONTRACT_NOTES), unitPrice, downPayment },
      schedule: status === 'ملغي' ? [] : freeSchedule(rng, date, unitPrice - downPayment, count),
      // Returned contracts stopped paying 3–8 installments in.
      keepRows: status === 'مرتجع' ? rng.int(3, 8) : Infinity,
      payAll: status === 'مكتمل',
    }
  }
  const leaseDeal = (unit: Unit, clientId: string, startDate: ISODate, months: number, status: ContractStatus): Deal => {
    const monthlyRent = Math.max(2_500, roundTo(unit.monthlyRent * (0.95 + rng.next() * 0.05), 50))
    const annualIncreasePct = months > 12 && rng.chance(0.7) ? rng.pick([5, 7, 10]) : 0
    const date = addDays(startDate, -rng.int(0, 7))
    const terms = {
      monthlyRent,
      durationMonths: months,
      startDate,
      endDate: leaseEndDate(startDate, months),
      securityDeposit: monthlyRent * rng.pick([1, 2]),
      advanceMonths: rng.pick([0, 1, 1, 2]),
      annualIncreasePct,
      increaseFromYear: 2,
    }
    return {
      contract: { id: '', number: '', reservationId: '', type: 'إيجار', unitId: unit.id, clientId, date, status, notes: rng.pick(LEASE_NOTES), ...terms },
      schedule: rentSchedule(terms, date),
      // A returned lease was handed back after 3–5 months.
      keepRows: status === 'مرتجع' ? rng.int(3, 5) : Infinity,
      payAll: status === 'منتهي' || status === 'مجدد',
    }
  }

  // Sales: one active (or completed) contract per sold unit, signed 1–30 months ago; three of
  // these units were returned by an earlier buyer first.
  soldUnits.forEach((unit, i) => {
    const date = addDays(TODAY_ISO, -rng.int(30, 900))
    deals.push(saleDeal(unit, pool[i].id, date, completedUnits.has(unit) ? 'مكتمل' : 'نشط'))
    if (resoldUnits.has(unit)) deals.push(saleDeal(unit, pool[27 + i].id, addDays(date, -rng.int(420, 600)), 'مرتجع'))
  })
  returnedSale.forEach((unit, i) => deals.push(saleDeal(unit, pool[20 + i].id, addDays(TODAY_ISO, -rng.int(240, 720)), 'مرتجع')))
  cancelledUnits.forEach((unit, i) => deals.push(saleDeal(unit, pool[30 + i].id, addDays(TODAY_ISO, -rng.int(60, 300)), 'ملغي')))

  // Leases: one running lease per rented unit; two tenants renewed an earlier lease.
  const terms = rng.shuffle([24, 24, 24, 24, 12, 12, 12, 12, 6, 6, 6, 6])
  rentedUnits.forEach((unit, i) => {
    const months = terms[i % terms.length]
    const start = addDays(TODAY_ISO, -rng.int(15, Math.min(months, 18) * 30 - 20))
    deals.push(leaseDeal(unit, pool[34 + i].id, start, months, 'نشط'))
    if (renewedUnits.has(unit)) {
      const before = rng.pick([12, 24])
      deals.push(leaseDeal(unit, pool[34 + i].id, addMonths(start, -before), before, 'مجدد'))
    }
  })
  returnedLease.forEach((unit) => deals.push(leaseDeal(unit, pool[46].id, addDays(TODAY_ISO, -rng.int(150, 240)), 12, 'مرتجع')))
  endedUnits.forEach((unit) => {
    const months = 12
    deals.push(leaseDeal(unit, pool[47].id, addMonths(addDays(TODAY_ISO, -rng.int(20, 120)), -months), months, 'منتهي'))
  })

  // ---------------------------------------------------------------- Contracts, reservations, installments & receipts
  deals.sort((a, b) => a.contract.date.localeCompare(b.contract.date) || a.contract.unitId.localeCompare(b.contract.unitId))
  const unitById = new Map(units.map((u) => [u.id, u]))
  const contracts: Contract[] = []
  const reservations: Reservation[] = []
  const installments: Installment[] = []
  const payments: Payment[] = []
  const receipt = (p: Omit<Payment, 'id' | 'receiptNumber'>) => payments.push({ id: '', receiptNumber: '', ...p })
  const sequence: Record<ContractType, number> = { بيع: 0, إيجار: 0 }
  const reservationOf = new Map<Reservation, Contract>()

  const reserve = (unit: Unit, clientId: string, purpose: ContractType, date: ISODate, status: ReservationStatus): Reservation => {
    const deposit = purpose === 'إيجار' ? unit.monthlyRent : Math.max(5_000, roundTo(unit.price * 0.02, 5_000))
    const reservation: Reservation = { id: '', clientId, unitId: unit.id, purpose, date, expiryDate: addDays(date, 30), deposit, status }
    reservations.push(reservation)
    return reservation
  }

  deals.forEach(({ contract, schedule, keepRows, payAll }, ci) => {
    contract.id = formatId('contracts', ci + 1)
    contract.number = `${CONTRACT_PREFIX[contract.type]}-${contract.date.slice(0, 4)}-${pad(++sequence[contract.type], 3)}`
    contracts.push(contract)
    // Every contract comes from a reservation made 2–14 days before signing.
    reservationOf.set(
      reserve(unitById.get(contract.unitId)!, contract.clientId, contract.type, addDays(contract.date, -rng.int(2, 14)), 'محوّل لعقد'),
      contract,
    )
    if (contract.status === 'ملغي') return

    // Upfront: the sale's down payment (a few active buyers still owe part of it) or the lease's deposit.
    if (contract.type === 'بيع') {
      const short = contract.status === 'نشط' && rng.chance(0.1)
      const paid = short ? roundTo(contract.downPayment * (0.5 + rng.next() * 0.3), 5_000) : contract.downPayment
      receipt({ contractId: contract.id, installmentId: null, date: contract.date, amount: paid, method: pickMethod(rng), notes: 'دفعة مقدمة' })
      if (short) {
        receipt({
          contractId: contract.id,
          installmentId: null,
          date: addDays(contract.date, rng.int(10, 25)),
          amount: roundTo((contract.downPayment - paid) / 2, 1000),
          method: pickMethod(rng),
          notes: 'جزء من الدفعة المقدمة',
        })
      }
    } else {
      receipt({ contractId: contract.id, installmentId: null, date: contract.date, amount: contract.securityDeposit, method: pickMethod(rng), notes: 'تأمين الوحدة' })
    }

    schedule.forEach(({ dueDate, amount }, i) => {
      if (i >= keepRows) return // dropped on return
      let paidAmount = 0
      if (payAll || keepRows !== Infinity || dueDate === contract.date) paidAmount = amount
      else if (dueDate <= TODAY_ISO) {
        // ~72% of due rows paid in full, ~12% partially, the rest overdue.
        const roll = rng.next()
        paidAmount = roll < 0.72 ? amount : roll < 0.84 ? roundTo(amount * (0.25 + rng.next() * 0.5), 500) : 0
      }
      const installment: Installment = {
        id: formatId('installments', installments.length + 1),
        contractId: contract.id,
        seq: i + 1,
        dueDate,
        amount,
        paidAmount,
        remaining: amount - paidAmount,
        status: installmentStatus(amount, paidAmount, dueDate, TODAY_ISO),
      }
      installments.push(installment)
      if (paidAmount > 0) {
        const date = dueDate > TODAY_ISO ? addDays(TODAY_ISO, -rng.int(0, 30)) : addDays(dueDate, rng.int(-7, 12))
        receipt({
          contractId: contract.id,
          installmentId: installment.id,
          date: clampDate(date, contract.date, TODAY_ISO),
          amount: paidAmount,
          method: pickMethod(rng),
          notes: paidAmount < amount ? 'سداد جزئي' : '',
        })
      }
    })
  })

  // Receipt numbers and ids follow payment-date order.
  payments
    .sort((a, b) => a.date.localeCompare(b.date) || a.contractId.localeCompare(b.contractId))
    .forEach((p, i) => {
      p.id = formatId('payments', i + 1)
      p.receiptNumber = `R-${p.date.slice(0, 4)}-${pad(i + 1, 5)}`
    })

  // Open reservations: one per reserved unit, made in the last 20 days. Lapsed ones on available units.
  reservedUnits.forEach((unit, i) => reserve(unit, pool[48 + i].id, reservedPurpose[i], addDays(TODAY_ISO, -rng.int(1, 20)), 'نشط'))
  lapsedUnits.forEach((unit, i) =>
    reserve(unit, pool[60 + i].id, lapsedPurpose[i], addDays(TODAY_ISO, -(i < 2 ? rng.int(45, 120) : rng.int(10, 60))), i < 2 ? 'منتهي' : 'ملغي'),
  )
  reservations
    .sort((a, b) => a.date.localeCompare(b.date) || a.unitId.localeCompare(b.unitId))
    .forEach((r, i) => {
      r.id = formatId('reservations', i + 1)
      const contract = reservationOf.get(r)
      if (contract) contract.reservationId = r.id
    })

  // ---------------------------------------------------------------- Maintenance (20)
  type RequestPlan = { unit: Unit | null; buildingId: string; type: MaintenanceType; status: MaintenanceStatus }
  const unitWork: MaintenanceType[] = ['سباكة', 'كهرباء', 'تكييف', 'دهانات', 'نجارة']
  const plans: RequestPlan[] = []
  const occupied = units.filter((u) => u.status === 'مباعة' || u.status === 'مؤجرة')

  // Returned units are being refurbished before resale.
  const refurbishing = units.filter((u) => u.status === 'مرتجعة')
  const openStatuses = rng.shuffle<MaintenanceStatus>([...repeat<MaintenanceStatus>('جديد', 3), ...repeat<MaintenanceStatus>('جاري', 5)])
  refurbishing.forEach((unit, i) =>
    plans.push({ unit, buildingId: unit.buildingId, type: rng.pick(unitWork), status: openStatuses[i] }),
  )
  // Open requests from buyers and tenants.
  rng
    .shuffle(occupied)
    .slice(0, 3)
    .forEach((unit, i) =>
      plans.push({
        unit,
        buildingId: unit.buildingId,
        type: rng.pick<MaintenanceType>(['تكييف', 'سباكة', 'كهرباء']),
        status: i < 2 ? 'جديد' : 'جاري',
      }),
    )
  // Completed work.
  rng
    .shuffle(units.filter((u) => u.status !== 'مرتجعة'))
    .slice(0, 7)
    .forEach((unit) => plans.push({ unit, buildingId: unit.buildingId, type: rng.pick(unitWork), status: 'منتهي' }))
  plans.push(
    { unit: null, buildingId: 'b-03', type: 'مصاعد', status: 'منتهي' },
    { unit: null, buildingId: 'b-04', type: 'عام', status: 'منتهي' },
  )

  const maintenance: Maintenance[] = plans
    .map((plan) => {
      const spec = MAINTENANCE_CATALOG[plan.type]
      const estimatedCost = roundTo(rng.int(spec.cost[0], spec.cost[1]), 50)
      const requestDate =
        plan.status === 'جديد'
          ? addDays(TODAY_ISO, -rng.int(0, 6))
          : plan.status === 'جاري'
            ? addDays(TODAY_ISO, -rng.int(7, 35))
            : addDays(TODAY_ISO, -rng.int(20, 160))
      const done = plan.status === 'منتهي'
      return {
        unitId: plan.unit?.id ?? null,
        buildingId: plan.buildingId,
        type: plan.type,
        description: rng.pick(spec.issues),
        requestDate,
        assignedTo: plan.status === 'جديد' && rng.chance(0.5) ? '' : rng.pick(spec.vendors),
        estimatedCost,
        actualCost: done ? roundTo(estimatedCost * (0.85 + rng.next() * 0.35), 50) : null,
        status: plan.status,
        completionDate: done ? addDays(requestDate, rng.int(1, 12)) : null,
      }
    })
    .sort((a, b) => a.requestDate.localeCompare(b.requestDate))
    .map((request, i) => ({ id: formatId('maintenance', i + 1), ...request }))

  // ---------------------------------------------------------------- Owner unions (3): the building's owner clients
  const ownerUnions: OwnerUnion[] = UNION_PROFILES.map((profile, i) => ({
    id: formatId('ownerUnions', i + 1),
    ...profile,
    memberIds: buildings.find((b) => b.id === profile.buildingId)!.ownerShares.map((o) => o.clientId),
  }))

  return {
    buildings,
    units,
    clients,
    contracts,
    installments,
    payments,
    maintenance,
    reservations,
    ownerUnions,
    settings: { ...DEFAULT_SETTINGS },
  }
}
