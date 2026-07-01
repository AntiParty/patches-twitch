import { useContext } from 'react'
import { ConfirmContext, type ConfirmFn } from '@/components/modals/confirm-context'

/** Imperative confirm dialog. Must be used within <ConfirmProvider>. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
