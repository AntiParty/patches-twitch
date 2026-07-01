/* Account suspended page. Ported from banned.ejs. Reason can be passed via
 * ?reason= or router state; otherwise a generic message shows. */
import { useLocation, useSearchParams } from 'react-router-dom'
import styles from './Message.module.css'

export function Banned() {
  const [params] = useSearchParams()
  const location = useLocation()
  const reason =
    params.get('reason') || (location.state as { reason?: string } | null)?.reason || 'No reason provided.'

  return (
    <div className={`fx-bg ${styles.shell}`}>
      <div className={styles.card}>
        <h1 className={styles.danger}>Account Suspended</h1>
        <p>Your account has been suspended from accessing this service.</p>
        <div className={styles.reasonBox}>
          <span className={styles.reasonLabel}>Reason</span>
          <div className={styles.reasonText}>{reason}</div>
        </div>
        <p>If you believe this is a mistake, please contact support.</p>
        <a className={styles.link} href="/">Return to Home</a>
      </div>
    </div>
  )
}
