/* Toast context + types. Provider lives in ToastProvider.tsx; consume via useToast. */
import { createContext } from 'react'

export type ToastType = 'success' | 'danger' | 'warning' | 'info'

export interface Toast {
  id: number
  type: ToastType
  message: string
}

export interface ToastContextValue {
  show: (message: string, type?: ToastType) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
