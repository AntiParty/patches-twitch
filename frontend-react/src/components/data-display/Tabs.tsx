/* Controlled in-page tab bar. (Route-level nav uses the Sidebar/NavLink.) */
import styles from './Tabs.module.css'

export interface TabItem {
  id: string
  label: string
  icon?: string
}

interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`${styles.tab} ${t.id === active ? styles.active : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <i className={t.icon} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}
