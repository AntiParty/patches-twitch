/*
 * Button — wraps the design-system `.btn` classes with variants, sizes, an
 * optional leading icon, and a loading state. Builds on the global button
 * styles from global.css so it stays consistent with the legacy look.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from '@/components/feedback/Spinner'
import styles from './Button.module.css'

type Variant = 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Font Awesome icon class for a leading icon. */
  icon?: string
  loading?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: styles.danger,
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={16} /> : icon && <i className={icon} />}
      {children}
    </button>
  )
}
