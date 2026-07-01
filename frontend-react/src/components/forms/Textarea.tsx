/* Multi-line text input. forwardRef for React Hook Form. */
import { forwardRef, type TextareaHTMLAttributes } from 'react'
import styles from './forms.module.css'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`${styles.input} ${styles.textarea} ${invalid ? styles.invalid : ''} ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
})
