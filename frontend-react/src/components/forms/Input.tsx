/* Text input. Mirrors the legacy `.input`. forwardRef for React Hook Form. */
import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './forms.module.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`${styles.input} ${invalid ? styles.invalid : ''} ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
})
