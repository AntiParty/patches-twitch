/* Centered error-state message with optional retry. */
import { Button } from '@/components/buttons/Button'
import styles from './State.module.css'

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={styles.state}>
      <i className={`${styles.icon} ${styles.danger} fas fa-circle-exclamation`} />
      <h3 className={styles.title}>{title}</h3>
      {message && <p className={styles.description}>{message}</p>}
      {onRetry && (
        <div className={styles.action}>
          <Button variant="ghost" size="sm" icon="fas fa-rotate-right" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}
