/*
 * Dismissible (per-session) reminder shown when the account isn't linked yet.
 * Covers the "skipped the wizard but still unlinked" case. Hidden on the
 * Overview, where the Rank now panel already asks for the IGN.
 */
import { useState } from 'react'
import { Link, useMatch } from 'react-router-dom'
import { useProfile } from './hooks'
import styles from './LinkReminder.module.css'

export function LinkReminder() {
  const { data: profile } = useProfile()
  const [dismissed, setDismissed] = useState(false)
  const onOverview = useMatch({ path: '/dashboard', end: true })

  if (!profile || profile.playerId || dismissed || onOverview) return null

  return (
    <div className={styles.bar} role="status">
      <span>Link your THE FINALS account to track rank and enable chat commands</span>
      <Link className="btn btn-primary btn-sm" to="/dashboard/settings">Link now</Link>
      <button className={`${styles.close} ${styles.spacer}`} aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <i className="fas fa-xmark" />
      </button>
    </div>
  )
}
