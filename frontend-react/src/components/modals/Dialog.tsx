/*
 * Modal dialog rendered in a portal. Closes on overlay click / Escape.
 * Mirrors the legacy `.confirm-overlay` / `.confirm-modal` look.
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Dialog.module.css'

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Disable closing via overlay click / Escape (e.g. during a submit). */
  dismissable?: boolean
  width?: number
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
  width = 440,
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, dismissable, onClose])

  if (!open) return null

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.modal} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {title && (
          <div className={styles.header}>
            <h3 className={styles.title}>{title}</h3>
            {dismissable && (
              <button className={styles.close} aria-label="Close" onClick={onClose}>
                <i className="fas fa-xmark" />
              </button>
            )}
          </div>
        )}
        {children && <div className={styles.body}>{children}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
