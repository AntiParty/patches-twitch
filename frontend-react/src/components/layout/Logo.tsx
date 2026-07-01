/* Brand lockup used in the dashboard/admin sidebars. */
import { Link } from 'react-router-dom'
import styles from './Logo.module.css'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className={styles.logo}>
      <img src="/assets/logo.png" alt="FinalsRS" />
      <h1>FinalsRS</h1>
    </Link>
  )
}
