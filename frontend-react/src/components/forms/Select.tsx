/* Native select styled to match the legacy `select.input` (custom chevron). */
import { forwardRef, type SelectHTMLAttributes } from 'react'
import styles from './forms.module.css'

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[]
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, invalid = false, className = '', children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={`${styles.input} ${styles.select} ${invalid ? styles.invalid : ''} ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  )
})
