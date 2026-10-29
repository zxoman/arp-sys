import { useMemo, useState } from 'react'
import { useData, egp, newId, type OwnerUnion } from '@/lib'
import { Btn, DataTable, Drawer, Field, IconBtn, IconPencil, IconPlus, IconTrash, IconUsers, Modal, NumericInput, Select, TextInput, Textarea, useToast, type Column } from '@/kit'
import { codeOf, fmtNum, REQUIRED, ToggleChips, useNewShortcut, useShake, type Errors } from './shared'

type Row = OwnerUnion & { buildingName: string; members: string[] }

type Draft = { name: string; buildingId: string; memberIds: string[]; monthlyFee: number | null; meetingSchedule: string; notes: string }
type Key = keyof Draft
const EMPTY: Draft = { name: '', buildingId: '', memberIds: [], monthlyFee: null, meetingSchedule: '', notes: '' }

export default function OwnerUnions() {
  const { ownerUnions, clients, buildings, dispatch } = useData()
  const toast = useToast()
  const [editing, setEditing] = useState<OwnerUnion | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [toDelete, setToDelete] = useState<Row | null>(null)
  const [formRef, shake] = useShake<HTMLFormElement>()

  const openNew = () => {
    setEditing(null)
    setDraft(EMPTY)
    setErrors({})
    setOpen(true)
  }
  useNewShortcut(openNew)

  const bName = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.fullName])), [clients])
  const owners = useMemo(() => clients.filter((c) => c.type === 'مالك'), [clients])
  /** Owner client ids holding a share of the building. */
  const shareholders = (buildingId: string) => buildings.find((b) => b.id === buildingId)?.ownerShares.map((s) => s.clientId) ?? []

  const rows = useMemo<Row[]>(
    () =>
      ownerUnions.map((u) => ({
        ...u,
        buildingName: bName.get(u.buildingId) ?? '—',
        members: u.memberIds.map((id) => clientName.get(id) ?? id),
      })),
    [ownerUnions, bName, clientName],
  )

  /** Owners of the chosen building first; members who are no longer owners stay listed so they can be removed. */
  const memberChoices = useMemo(() => {
    const mine = new Set(buildings.find((b) => b.id === draft.buildingId)?.ownerShares.map((s) => s.clientId) ?? [])
    const item = (id: string) => ({ value: id, label: clientName.get(id) ?? id })
    const stale = draft.memberIds.filter((id) => !mine.has(id) && !owners.some((o) => o.id === id))
    return {
      mine: [...mine].map(item),
      others: [...owners.filter((o) => !mine.has(o.id)).map((o) => o.id), ...stale].map(item),
    }
  }, [buildings, owners, clientName, draft.buildingId, draft.memberIds])

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as Key]
      return next
    })
  }
  const toggle = (id: string) => update({ memberIds: draft.memberIds.includes(id) ? draft.memberIds.filter((m) => m !== id) : [...draft.memberIds, id] })

  const openEdit = (u: OwnerUnion) => {
    setEditing(u)
    setDraft({ name: u.name, buildingId: u.buildingId, memberIds: u.memberIds, monthlyFee: u.monthlyFee, meetingSchedule: u.meetingSchedule, notes: u.notes })
    setErrors({})
    setOpen(true)
  }

  const save = () => {
    const e: Errors<Key> = {}
    if (!draft.name.trim()) e.name = REQUIRED
    if (!draft.buildingId) e.buildingId = REQUIRED
    else if (ownerUnions.some((u) => u.buildingId === draft.buildingId && u.id !== editing?.id)) e.buildingId = 'يوجد اتحاد ملاك لهذا المبنى بالفعل'
    if (!draft.memberIds.length) e.memberIds = 'اختر عضوًا واحدًا على الأقل'
    setErrors(e)
    if (Object.keys(e).length) return shake()
    const record: OwnerUnion = {
      id: editing?.id ?? newId('ownerUnions', ownerUnions),
      name: draft.name.trim(),
      buildingId: draft.buildingId,
      memberIds: draft.memberIds,
      monthlyFee: draft.monthlyFee ?? 0,
      meetingSchedule: draft.meetingSchedule.trim(),
      notes: draft.notes.trim(),
    }
    dispatch(editing ? { type: 'UPDATE_OWNER_UNION', payload: record } : { type: 'ADD_OWNER_UNION', payload: record })
    toast.success(editing ? 'تم تحديث الاتحاد' : 'تمت إضافة اتحاد الملاك', `${record.name} — ${fmtNum(record.memberIds.length)} عضو`)
    setOpen(false)
  }

  const columns: Column<Row>[] = [
    { key: 'id', header: 'الكود', value: (u) => codeOf(u.id), cell: (u) => <span className="tabular-nums text-fg-2">{codeOf(u.id)}</span> },
    { key: 'name', header: 'اسم الاتحاد', cell: (u) => <span className="font-semibold text-fg">{u.name}</span> },
    { key: 'buildingName', header: 'المبنى' },
    {
      key: 'members',
      header: 'الأعضاء',
      value: (u) => u.members.join('، '),
      cell: (u) => (
        <span className="line-clamp-1 max-w-[16rem]" title={u.members.join('، ')}>
          <span className="tabular-nums font-semibold">{fmtNum(u.members.length)}</span>
          {u.members.length > 0 && (
            <span className="text-fg-2">
              {' '}
              — {u.members.slice(0, 2).join('، ')}
              {u.members.length > 2 ? '…' : ''}
            </span>
          )}
        </span>
      ),
    },
    { key: 'monthlyFee', header: 'الاشتراك الشهري', align: 'end', cell: (u) => <span className="tabular-nums">{egp(u.monthlyFee)}</span> },
    { key: 'meetingSchedule', header: 'موعد الاجتماعات', value: (u) => u.meetingSchedule || '—' },
  ]

  return (
    <div className="grid gap-4">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(u) => u.id}
        caption="اتحادات الملاك"
        title={
          <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
            اتحاد ملاك جديد
          </Btn>
        }
        searchPlaceholder="ابحث باسم الاتحاد أو المبنى أو العضو…"
        exportName="اتحادات-الملاك"
        actionsWidth="6rem"
        onRowClick={(u) => openEdit(u)}
        actions={(u) => (
          <div className="flex gap-0.5">
            <IconBtn size="sm" icon={<IconPencil size={16} />} label="تعديل" onClick={() => openEdit(u)} />
            <IconBtn size="sm" icon={<IconTrash size={16} />} label="حذف" className="text-danger" onClick={() => setToDelete(u)} />
          </div>
        )}
        emptyText="لا توجد اتحادات ملاك."
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        icon={<IconUsers size={20} />}
        title={editing ? 'تعديل اتحاد الملاك' : 'اتحاد ملاك جديد'}
        description={editing ? `الكود ${codeOf(editing.id)}` : 'الحقول المعلَّمة بـ * مطلوبة'}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Btn>
            <Btn type="submit" form="union-form">
              حفظ
            </Btn>
          </>
        }
      >
        <form id="union-form" ref={formRef} noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save())}>
          <TextInput containerClassName="sm:col-span-2" label="اسم الاتحاد" required value={draft.name} error={errors.name} onChange={(e) => update({ name: e.target.value })} />
          <Select
            containerClassName="sm:col-span-2"
            label="المبنى"
            required
            placeholder="اختر المبنى"
            options={buildings.map((b) => ({ value: b.id, label: b.name }))}
            value={draft.buildingId}
            error={errors.buildingId}
            onChange={(e) => {
              const id = e.target.value
              // Pre-select the building's shareholders when nobody is chosen yet.
              update({ buildingId: id, memberIds: draft.memberIds.length ? draft.memberIds : shareholders(id) })
            }}
          />
          <Field className="sm:col-span-2" label="الأعضاء" required error={errors.memberIds} hint={`${fmtNum(draft.memberIds.length)} عضو محدد — الأعضاء عملاء من نوع «مالك»`}>
            <div className="grid gap-2">
              {memberChoices.mine.length > 0 && (
                <>
                  <span className="t-caption">ملاك هذا المبنى</span>
                  <ToggleChips items={memberChoices.mine} selected={draft.memberIds} onToggle={toggle} />
                </>
              )}
              {memberChoices.others.length > 0 && (
                <>
                  <span className="t-caption">{draft.buildingId ? 'ملاك آخرون' : 'الملاك'}</span>
                  <ToggleChips items={memberChoices.others} selected={draft.memberIds} onToggle={toggle} />
                </>
              )}
              {owners.length === 0 && <span className="t-caption">لا يوجد عملاء من نوع «مالك». أضفهم من شاشة العملاء.</span>}
            </div>
          </Field>
          <NumericInput label="الاشتراك الشهري" suffix="ج.م" min={0} value={draft.monthlyFee} onChange={(v) => update({ monthlyFee: v })} />
          <TextInput label="موعد الاجتماعات" placeholder="مثال: أول خميس من كل شهر" value={draft.meetingSchedule} onChange={(e) => update({ meetingSchedule: e.target.value })} />
          <Textarea containerClassName="sm:col-span-2" label="ملاحظات" rows={3} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </form>
      </Drawer>

      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="حذف اتحاد الملاك؟"
        description={toDelete && `سيتم حذف «${toDelete.name}». لا يمكن التراجع عن هذا الإجراء.`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToDelete(null)}>
              إلغاء
            </Btn>
            <Btn
              variant="danger"
              onClick={() => {
                dispatch({ type: 'DELETE_OWNER_UNION', payload: { id: toDelete!.id } })
                toast.success('تم حذف الاتحاد', toDelete!.name)
                setToDelete(null)
              }}
            >
              حذف
            </Btn>
          </>
        }
      />
    </div>
  )
}
