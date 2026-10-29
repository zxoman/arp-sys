import { useMemo, type ReactNode } from 'react'
import { useData, egp, fmtDate, installmentRemaining, paymentLabel, type RentalContractTerms, type ScheduleItem } from '@/lib'
import { diffDays, installmentStatus } from '@/lib/domain'
import { TODAY_ISO } from '@/data'
import { Btn, GlassSurface, IconChevronNext, IconFile, IconWallet, SectionCard, StatusChip } from '@/kit'
import { Text } from '@/components/ui'
import { printDocument } from '@/kit/print'
import { ContractDoc } from './ContractDoc'
import { CONTRACT_TYPE_TONE, contractTypeLabel, goToReceipt, InfoPair, ProjectBadge, RETURN_PREFILL_KEY, unitLabelOf } from './shared'
import { CODE_LABEL } from '@/lib/codes'

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <GlassSurface padding="md" className="grid gap-1">
      <Text variant="label" className="text-fg-2">
        {label}
      </Text>
      <span className={`text-lg font-extrabold tabular-nums ${tone ?? 'text-fg'}`}>{value}</span>
    </GlassSurface>
  )
}

const TH = 'px-3 py-2.5 text-start font-bold'
const TH_END = 'px-3 py-2.5 text-end font-bold'

export default function ContractDetails({
  contractId,
  onBack,
  onRenew,
}: {
  contractId: string
  onBack: () => void
  onRenew: (contract: RentalContractTerms) => void
}) {
  const { contracts, clients, units, buildings, installments, payments, settings, contractSummary } = useData()
  const contract = contracts.find((c) => c.id === contractId)
  const summary = contractSummary(contractId)
  const unit = units.find((u) => u.id === contract?.unitId)
  const client = clients.find((c) => c.id === contract?.clientId)
  const building = buildings.find((b) => b.id === unit?.buildingId)

  const rows = useMemo(() => {
    const real = installments.filter((i) => i.contractId === contractId).sort((a, b) => a.seq - b.seq)
    return real.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      amount: i.amount,
      paid: i.paidAmount,
      remaining: installmentRemaining(i),
      status: installmentStatus(i.amount, i.paidAmount, i.dueDate, TODAY_ISO),
    }))
  }, [installments, contractId])
  const receipts = useMemo(
    () => payments.filter((p) => p.contractId === contractId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [payments, contractId],
  )
  const instSeq = useMemo(() => new Map(installments.map((i) => [i.id, i.seq])), [installments])

  if (!contract) {
    return (
      <div className="grid gap-4">
        <Btn variant="ghost" size="sm" className="justify-self-start" iconStart={<IconChevronNext size={16} />} onClick={onBack}>
          رجوع
        </Btn>
        <p className="t-caption">العقد غير موجود.</p>
      </div>
    )
  }

  const lease = contract.type === 'إيجار'
  const active = contract.status === 'نشط'
  const canReturn = active || (!lease && contract.status === 'مكتمل')
  const daysLeft = lease ? diffDays(contract.endDate, TODAY_ISO) : 0

  const schedule: ScheduleItem[] = rows.map((r) => ({ dueDate: r.dueDate, amount: r.amount }))
  const print = () =>
    void printDocument(
      <ContractDoc
        settings={settings}
        contract={contract}
        client={client ?? null}
        buildingName={building?.name ?? '—'}
        unitLabel={unitLabelOf(unit)}
        schedule={schedule}
      />,
      `${contractTypeLabel(contract.type)}-${contract.number}`,
    )

  const toReturns = () => {
    sessionStorage.setItem(RETURN_PREFILL_KEY, JSON.stringify({ contractId }))
    location.hash = '#/returns'
  }

  const pricePerMeter = unit && unit.area > 0 ? (lease ? contract.monthlyRent : contract.type === 'بيع' ? contract.unitPrice : 0) / unit.area : 0

  return (
    <div className="grid gap-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Btn variant="ghost" size="sm" iconStart={<IconChevronNext size={16} />} onClick={onBack}>
          رجوع
        </Btn>
        <ProjectBadge />
      </div>

      {/* Header */}
      <GlassSurface variant="strong" padding="md" className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="grid gap-1">
          <Text variant="caption">{CODE_LABEL.contract}</Text>
          <span className="text-2xl font-extrabold tabular-nums">{contract.number}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="grid gap-1">
            <Text variant="caption">النوع</Text>
            <StatusChip status={contract.type} tone={CONTRACT_TYPE_TONE[contract.type]} size="sm" />
          </div>
          <div className="grid gap-1">
            <Text variant="caption">الحالة</Text>
            <StatusChip status={contract.status} size="sm" />
          </div>
          <InfoPair label="المشروع" value={settings.projectName.trim() || 'غير محدد'} />
          <InfoPair label="التاريخ" value={fmtDate(contract.date)} />
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Btn variant="glass" iconStart={<IconFile size={16} />} onClick={print}>
            طباعة العقد
          </Btn>
          {active && (
            <Btn iconStart={<IconWallet size={16} />} onClick={() => goToReceipt(contract.id)}>
              تسجيل دفع
            </Btn>
          )}
          {canReturn && !lease && (
            <Btn variant="danger" onClick={toReturns}>
              إرجاع
            </Btn>
          )}
          {active && lease && (
            <>
              <Btn variant="success" onClick={() => onRenew(contract)}>
                تجديد
              </Btn>
              <Btn variant="danger" onClick={toReturns}>
                إنهاء
              </Btn>
            </>
          )}
        </div>
      </GlassSurface>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="العميل" description={lease ? 'المستأجر' : 'المشتري'}>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <InfoPair label="الاسم" value={client?.fullName ?? '—'} strong />
            <InfoPair label="النوع" value={client?.type ?? '—'} />
            <InfoPair label="العنوان" value={client?.address || '—'} />
          </div>
        </SectionCard>
        <SectionCard title="الوحدة">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <InfoPair label="المبنى" value={building?.name ?? '—'} strong />
            <InfoPair label="الوحدة" value={unitLabelOf(unit)} />
            <InfoPair label="النوع" value={unit?.type ?? '—'} />
            <InfoPair label="المساحة" value={unit ? `${unit.area} م²` : '—'} />
            <InfoPair label={lease ? 'إيجار المتر شهريًا' : 'سعر المتر'} value={egp(Math.round(pricePerMeter))} />
          </div>
        </SectionCard>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {contract.type === 'بيع' ? (
          <>
            <Stat label="سعر الوحدة" value={egp(contract.unitPrice + (contract.discount ?? 0))} />
            {!!contract.discount && <Stat label="الخصم" value={egp(contract.discount)} tone="text-success" />}
            {!!contract.discount && <Stat label="السعر بعد الخصم" value={egp(contract.unitPrice)} />}
            <Stat label="المقدم" value={egp(contract.downPayment)} />
            <Stat label="باقي المقدم" value={egp(summary?.downPaymentRemaining ?? 0)} tone="text-warning" />
            <Stat label="إجمالي الأقساط" value={egp(Math.max(0, contract.unitPrice - contract.downPayment))} />
          </>
        ) : (
          <>
            <Stat label="الإيجار الشهري" value={egp(contract.monthlyRent)} />
            <Stat label="التأمين" value={egp(contract.securityDeposit)} />
            <Stat label="المدة" value={`${contract.durationMonths} شهر`} />
            <Stat label="تاريخ البداية" value={fmtDate(contract.startDate)} />
            <Stat label="تاريخ النهاية" value={fmtDate(contract.endDate)} />
          </>
        )}
        <Stat label="المسدد" value={egp(summary?.totalPaid ?? 0)} tone="text-success" />
        <Stat label="المتبقي" value={egp(summary?.totalRemaining ?? 0)} tone="text-danger" />
      </div>

      {lease && active && (
        <div
          className={`rounded-ctl border px-4 py-3 text-sm font-semibold ${
            daysLeft < 0 ? 'border-danger/40 bg-danger-soft text-danger' : daysLeft <= 60 ? 'border-warning/40 bg-warning-soft text-warning' : 'border-hairline bg-neutral-soft text-fg-2'
          }`}
        >
          {daysLeft < 0 ? `انتهى العقد منذ ${-daysLeft} يوم` : daysLeft === 0 ? 'ينتهي العقد اليوم' : `متبقي ${daysLeft} يوم على الانتهاء`}
        </div>
      )}

      {/* Installments */}
      <SectionCard title="جدول الأقساط" description={`${rows.length} قسط`}>
        {rows.length === 0 ? (
          <div className="rounded-ctl border border-dashed border-hairline px-4 py-8 text-center text-fg-2">لا توجد أقساط (العقد لم يُرحَّل بعد).</div>
        ) : (
          <div className="kit-table-scroll max-h-[60vh]">
            <table className="kit-table min-w-[34rem]" data-plain>
              <thead>
                <tr>
                  <th className="w-12 px-3 py-2.5 text-center font-bold">#</th>
                  <th className={TH}>تاريخ الاستحقاق</th>
                  <th className={TH_END}>القيمة</th>
                  <th className={TH_END}>المسدد</th>
                  <th className={TH_END}>متبقي سداد القسط</th>
                  <th className={TH}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 text-center tabular-nums text-fg-2">{r.seq}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtDate(r.dueDate)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{egp(r.amount)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-success">{egp(r.paid)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{egp(r.remaining)}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip status={r.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Receipts */}
      <SectionCard title="إيصالات العقد" description={`${receipts.length} إيصال`}>
        {receipts.length === 0 ? (
          <div className="rounded-ctl border border-dashed border-hairline px-4 py-8 text-center text-fg-2">لا توجد إيصالات بعد.</div>
        ) : (
          <div className="kit-table-scroll max-h-[60vh]">
            <table className="kit-table min-w-[34rem]" data-plain>
              <thead>
                <tr>
                  <th className={TH}>{CODE_LABEL.receipt}</th>
                  <th className={TH}>التاريخ</th>
                  <th className={TH}>البند</th>
                  <th className={TH}>طريقة الدفع</th>
                  <th className={TH_END}>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{p.receiptNumber}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtDate(p.date)}</td>
                    <td className="px-3 py-2.5">{paymentLabel(contract.type, p.installmentId ? (instSeq.get(p.installmentId) ?? null) : null)}</td>
                    <td className="px-3 py-2.5">{p.method}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-success">{egp(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
