/**
 * TEMPORARY data-layer debug page, served at /debug.html by the dev server.
 * Delete this file and debug.html once the real screens consume the data layer.
 */
import React, { useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { Badge, Button, GlassCard, MeshBackground, StatusBadge, Text } from '@/components/ui'
import { TODAY_ISO } from '@/data'
import { diffDays as diffDaysISO } from '@/lib/domain'
import { contractSummary, egp, fmtDate, installmentStatus, Providers, useData, type Collection, type DataState, type SaleContractTerms } from '@/lib'
import './index.css'

const COLLECTION_LABELS: Record<Collection, string> = {
  buildings: 'العمارات',
  units: 'الوحدات',
  clients: 'العملاء',
  contracts: 'العقود',
  installments: 'الأقساط',
  payments: 'الإيصالات',
  maintenance: 'طلبات الصيانة',
  reservations: 'الحجوزات',
  ownerUnions: 'اتحادات الملاك',
}

function tally<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

const count = <T,>(items: T[], bad: (item: T) => boolean) => items.filter(bad).length

/** Each check returns the number of violating records (0 = pass). */
function integrityChecks(s: DataState): { label: string; failures: number }[] {
  const ids = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id))
  const buildings = ids(s.buildings)
  const units = new Map(s.units.map((u) => [u.id, u]))
  const clients = ids(s.clients)
  const clientType = new Map(s.clients.map((c) => [c.id, c.type]))
  const contracts = new Map(s.contracts.map((c) => [c.id, c]))
  const reservations = new Map(s.reservations.map((r) => [r.id, r]))
  const installments = new Map(s.installments.map((i) => [i.id, i]))
  const active = s.contracts.filter((c) => c.status === 'نشط')
  const salesPerUnit = new Map(tally(s.contracts.filter((c) => c.type === 'بيع' && (c.status === 'نشط' || c.status === 'مكتمل')), (c) => c.unitId))
  const leasesPerUnit = new Map(tally(active.filter((c) => c.type === 'إيجار'), (c) => c.unitId))
  const receipts = s.payments.map((p) => p.receiptNumber)
  const paidOn = new Map<string, number>()
  for (const p of s.payments) if (p.installmentId) paidOn.set(p.installmentId, (paidOn.get(p.installmentId) ?? 0) + p.amount)

  return [
    { label: 'كل وحدة تتبع عمارة موجودة', failures: count(s.units, (u) => !buildings.has(u.buildingId)) },
    {
      label: 'كل عقد يشير إلى وحدة وعميل موجودين',
      failures: count(s.contracts, (c) => !units.has(c.unitId) || !clients.has(c.clientId)),
    },
    { label: 'كل قسط يتبع عقدًا موجودًا', failures: count(s.installments, (i) => !contracts.has(i.contractId)) },
    {
      label: 'كل إيصال يتبع عقدًا وقسطًا من نفس العقد',
      failures: count(
        s.payments,
        (p) =>
          !contracts.has(p.contractId) ||
          (p.installmentId !== null && installments.get(p.installmentId)?.contractId !== p.contractId),
      ),
    },
    { label: 'أرقام الإيصالات فريدة', failures: receipts.length - new Set(receipts).size },
    {
      label: 'المتبقي = القيمة − المسدد، والحالة متسقة',
      failures: count(
        s.installments,
        (i) =>
          i.remaining !== i.amount - i.paidAmount ||
          i.paidAmount < 0 ||
          i.status !== installmentStatus(i.amount, i.paidAmount, i.dueDate, TODAY_ISO),
      ),
    },
    {
      label: 'المسدد في كل قسط يساوي مجموع إيصالاته',
      failures: count(s.installments, (i) => (paidOn.get(i.id) ?? 0) !== i.paidAmount),
    },
    {
      label: 'كل عقد ناتج عن حجز محوّل لنفس العميل والوحدة والغرض',
      failures: count(s.contracts, (c) => {
        const r = reservations.get(c.reservationId)
        return !r || r.status !== 'محوّل لعقد' || r.clientId !== c.clientId || r.unitId !== c.unitId || r.purpose !== c.type
      }),
    },
    {
      label: 'مقدم + الأقساط = سعر الوحدة في عقد البيع',
      failures: count(
        s.contracts.filter((c): c is SaleContractTerms => c.type === 'بيع' && c.status === 'نشط'),
        (c) => {
          const total = s.installments.filter((i) => i.contractId === c.id).reduce((sum, i) => sum + i.amount, 0)
          return total + c.downPayment !== c.unitPrice
        },
      ),
    },
    {
      label: 'ترقيم الأقساط متسلسل ومرتب بالتاريخ',
      failures: count(s.contracts, (c) => {
        const rows = s.installments.filter((i) => i.contractId === c.id).sort((a, b) => a.seq - b.seq)
        return rows.some((r, k) => r.seq !== k + 1 || (k > 0 && r.dueDate < rows[k - 1].dueDate))
      }),
    },
    {
      label: 'وحدة كل عقد نشط مباعة (بيع) أو مؤجرة (إيجار)',
      failures: count(active, (c) => units.get(c.unitId)?.status !== (c.type === 'بيع' ? 'مباعة' : 'مؤجرة')),
    },
    {
      label: 'كل وحدة مباعة لها عقد بيع واحد نشط أو مكتمل',
      failures: count(s.units, (u) => u.status === 'مباعة' && salesPerUnit.get(u.id) !== 1),
    },
    {
      label: 'كل وحدة مؤجرة لها عقد إيجار نشط واحد',
      failures: count(s.units, (u) => u.status === 'مؤجرة' && leasesPerUnit.get(u.id) !== 1),
    },
    {
      label: 'سبب عدم البيع موجود فقط للوحدات غير القابلة للبيع',
      failures: count(s.units, (u) => (u.status === 'غير قابلة للبيع') !== (u.nonSellableReason !== '')),
    },
    {
      label: 'كل حجز نشط على وحدة محجوزة',
      failures: count(s.reservations, (r) => r.status === 'نشط' && units.get(r.unitId)?.status !== 'محجوزة'),
    },
    {
      label: 'حصص ملكية كل عمارة لعملاء ملاك ومجموعها لا يتجاوز 100%',
      failures: count(
        s.buildings,
        (b) => b.ownerShares.some((o) => clientType.get(o.clientId) !== 'مالك' || o.share <= 0) || b.ownerShares.reduce((sum, o) => sum + o.share, 0) > 100,
      ),
    },
    {
      label: 'اتحادات الملاك تشير إلى عمارة وعملاء ملاك موجودين',
      failures: count(
        s.ownerUnions,
        (u) => !buildings.has(u.buildingId) || u.memberIds.some((m) => !clients.has(m) || clientType.get(m) !== 'مالك'),
      ),
    },
  ]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassCard className="p-5">
      <Text variant="section" className="mb-4">
        {title}
      </Text>
      {children}
    </GlassCard>
  )
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="grid gap-2">
      <Text variant="label" className="text-fg-2">
        {title}
      </Text>
      <div className="flex flex-wrap gap-3">
        {rows.map(([status, n]) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <StatusBadge status={status} />
            <Text variant="label">{n}</Text>
          </span>
        ))}
      </div>
    </div>
  )
}

function DebugPage() {
  const data = useData()
  const { dispatch } = data

  const checks = useMemo(() => integrityChecks(data), [data])
  const due = data.installments.filter((i) => i.dueDate <= TODAY_ISO)
  const lateBy = (i: (typeof due)[number]) => (i.remaining > 0 ? Math.max(0, diffDaysISO(TODAY_ISO, i.dueDate)) : 0)
  const buckets = [
    { label: 'مسدد بالكامل', n: due.filter((i) => i.status === 'مدفوع').length, bar: 'bg-success' },
    { label: 'سداد جزئي', n: due.filter((i) => i.status === 'جزئي').length, bar: 'bg-warning' },
    { label: 'متأخر حتى 60 يومًا', n: due.filter((i) => i.status === 'متأخر' && lateBy(i) <= 60).length, bar: 'bg-danger' },
    { label: 'متأخر أكثر من 60 يومًا', n: due.filter((i) => i.status === 'متأخر' && lateBy(i) > 60).length, bar: 'bg-danger' },
  ]
  const collected = data.payments.reduce((sum, p) => sum + p.amount, 0)
  const outstanding = due.reduce((sum, i) => sum + i.remaining, 0)
  const firstOverdue = data.installments.find(
    (i) => i.remaining > 0 && i.dueDate < TODAY_ISO && data.contracts.find((c) => c.id === i.contractId)?.status === 'نشط',
  )
  const sizeKb = Math.round(JSON.stringify(data).length / 1024) // `dispatch` is dropped by JSON

  const units = new Map(data.units.map((u) => [u.id, u]))
  const buildings = new Map(data.buildings.map((b) => [b.id, b]))
  const clients = new Map(data.clients.map((c) => [c.id, c]))
  const sample = data.contracts
    .filter((c): c is SaleContractTerms => c.type === 'بيع' && c.status === 'نشط')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)

  return (
    <>
      <MeshBackground />
      <main className="relative z-[1] mx-auto grid max-w-6xl gap-5 p-6">
        <GlassCard variant="strong" className="rise-in flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Text variant="page">فحص طبقة البيانات</Text>
              <Badge tone="yellow">صفحة مؤقتة</Badge>
            </div>
            <Text variant="caption">
              تاريخ اليوم الثابت {fmtDate(TODAY_ISO)} · حجم البيانات المحفوظة ≈ {sizeKb} ك.ب
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="success"
              size="sm"
              disabled={!firstOverdue}
              onClick={() =>
                firstOverdue &&
                dispatch({
                  type: 'RECORD_PAYMENT',
                  payload: {
                    contractId: firstOverdue.contractId,
                    installmentId: firstOverdue.id,
                    amount: firstOverdue.remaining,
                    method: 'نقدي',
                  },
                })
              }
            >
              سداد أول قسط متأخر
            </Button>
            <Button variant="danger" size="sm" onClick={() => dispatch({ type: 'RESET_DATA' })}>
              إعادة تعيين البيانات
            </Button>
          </div>
        </GlassCard>

        <Section title="عدد السجلات">
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-10">
            {(Object.keys(COLLECTION_LABELS) as Collection[]).map((key) => (
              <div key={key} className="grid gap-1 rounded-ctl border border-hairline p-3">
                <Text variant="kpi">{data[key].length}</Text>
                <Text variant="caption">{COLLECTION_LABELS[key]}</Text>
              </div>
            ))}
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="توزيع الحالات">
            <div className="grid gap-4">
              <Breakdown title="الوحدات" rows={tally(data.units, (u) => u.status)} />
              <Breakdown title="العقود" rows={tally(data.contracts, (c) => c.status)} />
              <Breakdown title="الأقساط" rows={tally(data.installments, (i) => i.status)} />
              <Breakdown title="الصيانة" rows={tally(data.maintenance, (m) => m.status)} />
              <Breakdown title="الحجوزات" rows={tally(data.reservations, (r) => r.status)} />
            </div>
          </Section>

          <Section title="انتظام السداد (الأقساط المستحقة)">
            <div className="grid gap-3">
              {buckets.map((b) => {
                const pct = due.length ? (b.n / due.length) * 100 : 0
                return (
                  <div key={b.label} className="grid gap-1">
                    <div className="flex justify-between">
                      <Text variant="label">{b.label}</Text>
                      <Text variant="caption">
                        {b.n} · {pct.toFixed(1)}%
                      </Text>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-soft">
                      <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="grid gap-1 rounded-ctl border border-hairline p-3">
                  <Text variant="caption">المحصّل</Text>
                  <Text variant="section" as="span" className="text-success">
                    {egp(collected)}
                  </Text>
                </div>
                <div className="grid gap-1 rounded-ctl border border-hairline p-3">
                  <Text variant="caption">المستحق غير المسدد</Text>
                  <Text variant="section" as="span" className="text-danger">
                    {egp(outstanding)}
                  </Text>
                </div>
              </div>
            </div>
          </Section>
        </div>

        <Section title={`فحوص السلامة المرجعية (${checks.filter((c) => c.failures === 0).length}/${checks.length})`}>
          <div className="grid gap-2 md:grid-cols-2">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-center justify-between gap-3 rounded-ctl border border-hairline px-3 py-2"
              >
                <Text variant="body">{check.label}</Text>
                {check.failures === 0 ? (
                  <Badge tone="green">ناجح</Badge>
                ) : (
                  <Badge tone="red">{check.failures} مخالفة</Badge>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="أحدث عقود البيع النشطة">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-start">رقم العقد</th>
                  <th className="text-start">العميل</th>
                  <th className="text-start">الوحدة</th>
                  <th className="text-start">سعر البيع</th>
                  <th className="text-start">المقدم</th>
                  <th className="text-start">الأقساط المسددة</th>
                  <th className="text-start">القسط القادم</th>
                  <th className="text-start">إجمالي المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((c) => {
                  const unit = units.get(c.unitId)
                  const summary = contractSummary(data, c.id)!
                  return (
                    <tr key={c.id} className="border-t border-hairline">
                      <td>
                        {c.number}
                        <div className="t-caption">{fmtDate(c.date)}</div>
                      </td>
                      <td>{clients.get(c.clientId)?.fullName ?? '—'}</td>
                      <td>
                        {unit ? `${buildings.get(unit.buildingId)?.name ?? ''} · ${unit.type} ${unit.number}` : '—'}
                      </td>
                      <td>{egp(summary.unitPrice)}</td>
                      <td>
                        {egp(c.downPayment)}
                        {summary.downPaymentRemaining > 0 && (
                          <div className="t-caption text-danger">متبقٍ {egp(summary.downPaymentRemaining)}</div>
                        )}
                      </td>
                      <td>
                        {summary.paidInstallmentsCount}/{summary.totalInstallments}
                        <div className="t-caption">{egp(summary.paidInstallmentsTotal)}</div>
                      </td>
                      <td>
                        {summary.nextDueInstallment ? (
                          <>
                            {egp(summary.currentInstallmentRemaining)}
                            <div className="t-caption">{fmtDate(summary.nextDueInstallment.dueDate)}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{egp(summary.totalRemaining)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <DebugPage />
    </Providers>
  </React.StrictMode>,
)
