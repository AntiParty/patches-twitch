/*
 * Imperative confirm dialog. `const confirm = useConfirm()` then
 * `if (await confirm({ title, body, danger: true })) { ... }`.
 * Replaces the legacy promise-based showConfirm().
 */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { Button } from '@/components/buttons/Button'
import { ConfirmContext, type ConfirmOptions } from './confirm-context'

interface State extends ConfirmOptions {
  open: boolean
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ open: false, title: '' })
  const resolver = useRef<(value: boolean) => void>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    setState({ ...options, open: true })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setState((s) => ({ ...s, open: false }))
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={state.open}
        onClose={() => settle(false)}
        title={state.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => settle(false)}>
              {state.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {state.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {state.body}
      </Dialog>
    </ConfirmContext.Provider>
  )
}
