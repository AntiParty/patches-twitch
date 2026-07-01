/*
 * Toast provider. Renders a fixed bottom-right stack and exposes show/success/
 * error/warning/info via context. Replaces the legacy global showToast().
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ToastContext, type Toast, type ToastType, type ToastContextValue } from './toast-context'
import styles from './Toast.module.css'

const ICONS: Record<ToastType, string> = {
  success: 'fas fa-circle-check',
  danger: 'fas fa-circle-xmark',
  warning: 'fas fa-triangle-exclamation',
  info: 'fas fa-circle-info',
}

const DURATION = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++idRef.current
      setToasts((prev) => [...prev, { id, type, message }])
      setTimeout(() => remove(id), DURATION)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m) => show(m, 'success'),
      error: (m) => show(m, 'danger'),
      warning: (m) => show(m, 'warning'),
      info: (m) => show(m, 'info'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className={styles.container}>
          {toasts.map((t) => (
            <div key={t.id} className={`${styles.toast} ${styles[t.type]}`} role="alert">
              <i className={ICONS[t.type]} />
              <span className={styles.message}>{t.message}</span>
              <button className={styles.close} aria-label="Dismiss" onClick={() => remove(t.id)}>
                <i className="fas fa-xmark" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
