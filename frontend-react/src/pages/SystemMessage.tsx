/* Generic full-page status/message screen. Ported from system-message.ejs.
 * Title/message/action come from router state or query params. */
import { useLocation, useSearchParams } from 'react-router-dom'
import styles from './Message.module.css'

interface MessageState {
  title?: string
  message?: string
  actionLabel?: string
  actionHref?: string
  variant?: 'default' | 'danger'
}

export function SystemMessage() {
  const [params] = useSearchParams()
  const state = (useLocation().state as MessageState | null) ?? {}

  const title = state.title ?? params.get('title') ?? 'Notice'
  const message = state.message ?? params.get('message') ?? ''
  const actionLabel = state.actionLabel ?? params.get('actionLabel') ?? 'Return to Home'
  const actionHref = state.actionHref ?? params.get('actionHref') ?? '/'

  return (
    <div className={`fx-bg ${styles.shell}`}>
      <div className={styles.card}>
        <h1 className={state.variant === 'danger' ? styles.danger : undefined}>{title}</h1>
        {message && <p>{message}</p>}
        <a className="btn btn-primary" href={actionHref}>{actionLabel}</a>
      </div>
    </div>
  )
}
