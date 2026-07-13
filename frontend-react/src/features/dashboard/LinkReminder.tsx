/*
 * Dismissible (per-session) reminder shown when the account isn't linked yet.
 * Covers the "skipped the wizard but still unlinked" case.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from './hooks'
import styles from './LinkReminder.module.css'

export function LinkReminder() {
  const { data: profile } = useProfile()
  const [dismissed, setDismissed] = useState(false)

  if (!profile || profile.playerId || dismissed) return null

  return (
    <div className={styles.bar} role="status">
      <i className="fas fa-link" />
      <span>Link your THE FINALS account to start tracking rank and enable chat commands.</span>
      <Link className="btn btn-primary btn-sm" to="/dashboard/settings">Link now</Link>
      <button className={`${styles.close} ${styles.spacer}`} aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <i className="fas fa-xmark" />
      </button>
    </div>
  )
}
