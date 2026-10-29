import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Btn } from './core'
import { IconAlert, IconTrash } from './icons'
import { Modal } from './overlay'

export type ConfirmOptions = {
  title: string
  description?: ReactNode
  /** Key facts shown in a list (client, unit, contract, amount…). */
  details?: readonly (readonly [string, ReactNode])[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning'
}

/** Promise-based confirmation dialog: `if (!(await confirm({...}))) return`. Render `dialog` once in the screen. */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }, [])

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setOpts(o)
      }),
    [],
  )

  const tone = opts?.tone ?? 'danger'
  const dialog = (
    <Modal
      open={opts !== null}
      onClose={() => close(false)}
      size="sm"
      tone={tone}
      icon={tone === 'danger' ? <IconTrash size={20} /> : <IconAlert size={20} />}
      title={opts?.title ?? ''}
      description={opts?.description}
      footer={
        <>
          <Btn variant="ghost" onClick={() => close(false)}>
            {opts?.cancelLabel ?? 'إلغاء'}
          </Btn>
          <Btn variant="danger" onClick={() => close(true)} autoFocus>
            {opts?.confirmLabel ?? 'تأكيد'}
          </Btn>
        </>
      }
    >
      {opts?.details && opts.details.length > 0 && (
        <dl className="m-0 grid gap-1.5 rounded-ctl border border-hairline bg-neutral-soft p-3 text-sm">
          {opts.details.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-3">{k}</dt>
              <dd className="m-0 font-semibold text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  )

  return { confirm, dialog }
}
