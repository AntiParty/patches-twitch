/* Search input with a leading icon and optional clear button. */
import { type InputHTMLAttributes } from 'react'
import styles from './forms.module.css'

interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
}

export function SearchBar({ value, onChange, onClear, placeholder = 'Search…', ...rest }: SearchBarProps) {
  return (
    <div className={styles.searchWrap}>
      <i className={`fas fa-magnifying-glass ${styles.searchIcon}`} />
      <input
        type="search"
        className={`${styles.input} ${styles.search}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onClick={() => (onClear ? onClear() : onChange(''))}
        >
          <i className="fas fa-xmark" />
        </button>
      )}
    </div>
  )
}
