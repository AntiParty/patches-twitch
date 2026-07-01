import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from '@/components/feedback/toast-context'

/** Fire toast notifications. Must be used within <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
