/* Click-to-open menu. Trigger + items; closes on outside click / Escape. */
import { useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import styles from './Dropdown.module.css'

export interface DropdownItem {
  label: string
  icon?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}

interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  align?: 'left' | 'right'
}

export function Dropdown({ trigger, items, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  return (
    <div className={styles.wrap} ref={ref}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`${styles.menu} ${align === 'left' ? styles.left : styles.right}`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`${styles.item} ${item.danger ? styles.danger : ''}`}
              onClick={() => {
                setOpen(false)
                item.onClick?.()
              }}
            >
              {item.icon && <i className={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
