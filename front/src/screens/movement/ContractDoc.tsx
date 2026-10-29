import { egp, fmtDate, type Client, type Contract, type ScheduleItem } from '@/lib'
import { PrintFields, PrintLayout, PrintSection, PrintSignatures, PrintTable, type PrintBrand } from '@/kit/print'
import { codeLine } from '@/lib/codes'

type ContractDocProps = {
  settings: PrintBrand
  contract: Contract
  client: Client | null
  buildingName: string
  unitLabel: string
  schedule: readonly ScheduleItem[]
}

export function ContractDoc({ settings, contract: c, client, buildingName, unitLabel, schedule }: ContractDocProps) {
  const lease = c.type === 'إيجار'
  const scheduleTotal = schedule.reduce((s, r) => s + r.amount, 0)
  return (
    <PrintLayout
      settings={settings}
      title={lease ? 'عقد إيجار وحدة' : schedule.length ? 'عقد بيع وحدة بالتقسيط' : 'عقد بيع وحدة'}
      subtitle={`${codeLine('contract', c.number)} · التاريخ: ${fmtDate(c.date)}`}
    >
      <PrintSection title={lease ? 'الطرف الثاني (المستأجر)' : 'الطرف الثاني (المشتري)'}>
        <PrintFields
          items={[
            ['الاسم', client?.fullName ?? '—'],
            ['العنوان', client?.address || '—'],
          ]}
        />
      </PrintSection>
      <PrintSection title="الوحدة">
        <PrintFields
          items={[
            ['المبنى', buildingName],
            ['الوحدة', unitLabel],
          ]}
        />
      </PrintSection>
      <PrintSection title={lease ? 'شروط الإيجار' : 'الشروط المالية'}>
        <PrintFields
          items={
            c.type === 'إيجار'
              ? [
                  ['الإيجار الشهري', egp(c.monthlyRent)],
                  ['المدة', `${c.durationMonths} شهر`],
                  ['من', fmtDate(c.startDate)],
                  ['إلى', fmtDate(c.endDate)],
                  ['التأمين', egp(c.securityDeposit)],
                  ['أشهر مقدمة', String(c.advanceMonths)],
                  ['الزيادة السنوية', c.annualIncreasePct ? `${c.annualIncreasePct}٪ من السنة ${c.increaseFromYear}` : 'بدون'],
                  ['إجمالي العقد', egp(scheduleTotal)],
                ]
              : [
                  ['سعر الوحدة', egp(c.unitPrice + (c.discount ?? 0))],
                  ...(c.discount ? ([['الخصم', egp(c.discount) + (c.discountReason ? ` (${c.discountReason})` : '')], ['السعر بعد الخصم', egp(c.unitPrice)]] as [string, string][]) : []),
                  ['المقدم', egp(c.downPayment)],
                  ['إجمالي الأقساط', egp(Math.max(0, c.unitPrice - c.downPayment))],
                  ['عدد الأقساط', String(schedule.length)],
                ]
          }
        />
      </PrintSection>
      <PrintSection title="جدول الأقساط">
        <PrintTable
          headers={['#', 'تاريخ الاستحقاق', 'المبلغ']}
          rows={schedule.map((r, i) => [i + 1, fmtDate(r.dueDate || null), egp(r.amount)])}
          empty="لا توجد أقساط."
        />
      </PrintSection>
      {c.notes.trim() && (
        <PrintSection title="ملاحظات">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.notes}</p>
        </PrintSection>
      )}
      <PrintSignatures labels={lease ? ['الطرف الأول (المؤجر)', 'الطرف الثاني (المستأجر)'] : ['الطرف الأول (البائع)', 'الطرف الثاني (المشتري)']} />
    </PrintLayout>
  )
}
