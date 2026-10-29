import { useId, useMemo, useState } from 'react'
import { Text } from '@/components/ui'
import { useData, type Settings as AppSettings } from '@/lib'
import {
  FormFooter,
  IconBuilding,
  IconImage,
  IconLayers,
  IconPhone,
  ImageUpload,
  SectionCard,
  Select,
  TextInput,
  useToast,
  useUnsaved,
} from '@/kit'
import { getPerfMode, setPerfMode, type PerfMode } from '@/kit/perf'
import { PrintFields, PrintLayout, PrintSection, PrintTable } from '@/kit/print'
import { SHORTCUT_LIST, shortcutLabel, useShortcutAction } from '@/kit/shortcuts'
import { CODE_LABEL, codeLine } from '@/lib/codes'

type Errors = Partial<Record<'projectName' | 'companyName' | 'companyPhone', string>>

const PERF_OPTIONS: { value: PerfMode; label: string }[] = [
  { value: 'auto', label: 'تلقائي (حسب قدرة الجهاز)' },
  { value: 'on', label: 'مفعّل — بدون ضبابية أو خلفية متحركة' },
  { value: 'off', label: 'معطّل — كل المؤثرات' },
]

const same = (a: AppSettings, b: AppSettings) => (Object.keys(a) as (keyof AppSettings)[]).every((k) => a[k] === b[k])

export default function Settings() {
  const { settings, dispatch } = useData()
  const toast = useToast()
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [errors, setErrors] = useState<Errors>({})
  const [perf, setPerf] = useState<PerfMode>(getPerfMode)
  const dirty = !same(draft, settings)
  const { prompt } = useUnsaved(dirty)

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const validate = () => {
    const e: Errors = {}
    if (!draft.projectName.trim()) e.projectName = 'اسم المشروع مطلوب'
    if (!draft.companyName.trim()) e.companyName = 'اسم الشركة مطلوب'
    if (draft.companyPhone.trim() && !/^[\d\s()+-]{6,}$/.test(draft.companyPhone.trim())) e.companyPhone = 'رقم هاتف غير صالح'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = () => {
    if (!dirty) return toast.info('لا توجد تغييرات للحفظ')
    if (!validate()) return toast.error('تحقق من الحقول المعلَّمة')
    const payload: AppSettings = {
      ...draft,
      projectName: draft.projectName.trim(),
      companyName: draft.companyName.trim(),
      companyAddress: draft.companyAddress.trim(),
      companyPhone: draft.companyPhone.trim(),
      developerUrl: (draft.developerUrl ?? '').trim(),
    }
    dispatch({ type: 'UPDATE_SETTINGS', payload })
    setDraft(payload)
    toast.success('تم حفظ الإعدادات', 'ستظهر التغييرات في كل المستندات المطبوعة.')
  }

  useShortcutAction('save', save)
  useShortcutAction('primary', save)

  const changePerf = (mode: PerfMode) => {
    setPerf(mode)
    const low = setPerfMode(mode)
    toast.info(low ? 'وضع الأداء المنخفض مفعّل' : 'وضع الأداء المنخفض غير مفعّل')
  }

  const printedAt = useMemo(() => new Date(), [])

  return (
    <div className="grid gap-4 pb-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid min-w-0 gap-4">
          <SectionCard title="بيانات المشروع والشركة" description="تظهر في الترويسة وفي رأس كل مستند مطبوع" icon={<IconBuilding size={20} />} columns={2}>
            <TextInput
              label="اسم المشروع"
              required
              value={draft.projectName}
              error={errors.projectName}
              onChange={(e) => set('projectName', e.target.value)}
              containerClassName="md:col-span-2"
            />
            <TextInput
              label="اسم الشركة"
              required
              value={draft.companyName}
              error={errors.companyName}
              onChange={(e) => set('companyName', e.target.value)}
              containerClassName="md:col-span-2"
            />
            <TextInput
              label="العنوان"
              value={draft.companyAddress}
              onChange={(e) => set('companyAddress', e.target.value)}
              containerClassName="md:col-span-2"
            />
            <TextInput
              label="رابط صفحة الشركة المطورة (رمز QR)"
              dir="ltr"
              inputMode="url"
              placeholder="https://example.com/developer"
              hint="يُطبع كرمز QR في أسفل يسار كل مستند"
              value={draft.developerUrl ?? ''}
              onChange={(e) => set('developerUrl', e.target.value)}
              containerClassName="md:col-span-2"
            />
            <TextInput
              label="الهاتف"
              dir="ltr"
              inputMode="tel"
              leading={<IconPhone size={16} />}
              value={draft.companyPhone}
              error={errors.companyPhone}
              onChange={(e) => set('companyPhone', e.target.value)}
            />
          </SectionCard>

          <SectionCard title="الشعارات" description="PNG أو JPG أو SVG حتى 500 كيلوبايت" icon={<IconImage size={20} />} columns={2}>
            <LogoField
              label="لوجو الشركة"
              hint="يظهر يمين رأس المستند"
              value={draft.companyLogo}
              onChange={(v) => set('companyLogo', v)}
              shown={draft.showCompanyLogo}
              onShownChange={(v) => set('showCompanyLogo', v)}
            />
            <LogoField
              label="لوجو المشروع"
              hint="يظهر يسار رأس المستند وبجوار رمز QR في التذييل"
              value={draft.ourLogo}
              onChange={(v) => set('ourLogo', v)}
              shown={draft.showOurLogo}
              onShownChange={(v) => set('showOurLogo', v)}
            />
          </SectionCard>

          <SectionCard title="الأداء والاختصارات" icon={<IconLayers size={20} />} columns={2}>
            <Select
              label="وضع الأداء المنخفض"
              hint="يُطبَّق فورًا على هذا الجهاز"
              options={PERF_OPTIONS}
              value={perf}
              onChange={(e) => changePerf(e.target.value as PerfMode)}
            />
            <div className="grid content-start gap-1.5">
              <Text variant="label" className="text-fg-2">
                اختصارات لوحة المفاتيح
              </Text>
              <ul className="m-0 grid list-none gap-1 p-0">
                {SHORTCUT_LIST.map((s) => (
                  <li key={s.keys} className="flex items-center justify-between gap-3 text-[13px] text-fg-2">
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
            </div>
          </SectionCard>
        </div>

        <section aria-label="معاينة رأس الطباعة" className="grid gap-2 xl:sticky xl:top-28">
          <div className="flex items-center justify-between gap-2 px-1">
            <Text variant="label" className="text-fg">
              معاينة المطبوعات
            </Text>
            <Text variant="caption">A4 · مباشرة</Text>
          </div>
          <PrintLayout preview settings={draft} title="عقد بيع وحدة بالتقسيط" subtitle={codeLine('contract', 'S-2025-001')} printedAt={printedAt}>
            <PrintSection title="بيانات العميل">
              <PrintFields
                items={[
                  ['الاسم', 'أحمد محمد علي'],
                  ['الهاتف', <bdi dir="ltr">0100-000-0000</bdi>],
                  ['الوحدة', 'شقة رقم 12 — الدور 3'],
                  ['المبنى', 'برج النخيل'],
                ]}
              />
            </PrintSection>
            <PrintTable
              headers={['#', 'تاريخ الاستحقاق', 'المبلغ']}
              rows={[
                [1, '01/01/2026', '25,000 ج.م'],
                [2, '01/02/2026', '25,000 ج.م'],
                [3, '01/03/2026', '25,000 ج.م'],
              ]}
            />
          </PrintLayout>

          <ExcelMockup />
        </section>
      </div>

      <FormFooter
        dirty={dirty}
        onSave={save}
        saveLabel="حفظ الإعدادات"
        onCancel={dirty ? () => (setDraft(settings), setErrors({})) : undefined}
        cancelLabel="تراجع"
      >
        <kbd
          dir="ltr"
          className="hidden rounded-md border border-hairline bg-neutral-soft px-1.5 py-1 font-sans text-[11px] font-bold leading-none text-fg-2 sm:inline"
        >
          {shortcutLabel('S')}
        </kbd>
      </FormFooter>
      {prompt}
    </div>
  )
}

/* ==================================================================
   Logo upload + visibility switch
   ================================================================== */

function LogoField({
  label,
  hint,
  value,
  onChange,
  shown,
  onShownChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  shown: boolean
  onShownChange: (v: boolean) => void
}) {
  return (
    <div className="grid content-start gap-3">
      <ImageUpload label={label} hint={hint} value={value} onChange={onChange} previewAlt={label} />
      <Switch
        checked={shown}
        onChange={onShownChange}
        label="إظهار في المطبوعات"
        description={value ? (shown ? 'يظهر في رأس المستندات' : 'مخفي من المستندات') : 'ارفع الشعار أولًا ليظهر'}
      />
    </div>
  )
}

function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 rounded-ctl border border-hairline px-3 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="t-label block cursor-pointer text-fg">
          {label}
        </label>
        {description && (
          <span id={`${id}-d`} className="t-caption block">
            {description}
          </span>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
          checked ? 'border-transparent bg-[var(--primary)]' : 'border-hairline bg-neutral-soft'
        }`}
      >
        <span
          aria-hidden
          className="absolute top-0.5 start-0.5 size-[18px] rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(-20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

const XL_ROWS: { n: string; client: string; unit: string; due: string; amount: string; days: number; late: boolean }[] = [
  { n: 'S-2025-014', client: 'أحمد محمد علي', unit: 'شقة 12', due: '01/08/2026', amount: '25,000', days: 86, late: true },
  { n: 'S-2025-021', client: 'منى حسن سالم', unit: 'شقة 7', due: '15/08/2026', amount: '18,500', days: 72, late: true },
  { n: 'R-2026-003', client: 'خالد إبراهيم', unit: 'محل 2', due: '01/11/2026', amount: '9,000', days: 0, late: false },
  { n: 'S-2025-030', client: 'سارة عادل', unit: 'شقة 21', due: '10/11/2026', amount: '30,000', days: 0, late: false },
]

function ExcelMockup() {
  const heads = ['#', CODE_LABEL.contract, 'العميل', 'الوحدة', 'الاستحقاق', 'المبلغ', 'أيام التأخر']
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <Text variant="label" className="text-fg">
          معاينة ملف Excel
        </Text>
        <Text variant="caption">الأقساط المتأخرة · صف الترويسة مثبّت</Text>
      </div>
      <div className="overflow-hidden rounded-xl border border-hairline bg-white text-[11px] text-slate-900 shadow-soft" dir="rtl">
        <div className="py-2 text-center text-[15px] font-extrabold text-[#1F3A5F]">الأقساط المستحقة والمتأخرة</div>
        <table className="w-full border-collapse text-center">
          <thead>
            <tr>
              {heads.map((h) => (
                <th key={h} className="border border-[#CBD5E1] border-b-2 border-b-[#1F3A5F] bg-[#1F3A5F] px-1.5 py-1.5 font-bold text-white">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {XL_ROWS.map((r, i) => (
              <tr key={r.n} className={r.late ? 'bg-[#FEE2E2] font-bold text-[#991B1B] outline outline-2 -outline-offset-2 outline-[#DC2626]' : i % 2 ? 'bg-[#F8FAFC]' : ''}>
                {[i + 1, r.n, r.client, r.unit, r.due, r.amount, r.days || '—'].map((v, j) => (
                  <td key={j} className="border border-[#CBD5E1] px-1.5 py-1.5">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Text variant="caption" className="px-1">
        العملاء المتأخرون يظهرون بخلفية وإطار أحمر · أرقام الصفوف وعرض الأعمدة تلقائيان.
      </Text>
    </div>
  )
}
