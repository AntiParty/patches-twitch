/*
 * Top navigation bar for public/marketing pages (landing, docs, legal, ...).
 * Mirrors the legacy `.topnav` from _theme.ejs. Auth-aware: swaps the login
 * button for a dashboard link when signed in.
 */
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import styles from './Navbar.module.css'

interface NavLinkDef {
  label: string
  to?: string
  href?: string
  hideOnMobile?: boolean
}

const DEFAULT_LINKS: NavLinkDef[] = [
  { label: 'Leaderboard', to: '/leaderboard', hideOnMobile: true },
  { label: 'Docs', href: '/docs', hideOnMobile: true },
  { label: 'Drops', to: '/twitch-drops', hideOnMobile: true },
]

export function Navbar({ links = DEFAULT_LINKS }: { links?: NavLinkDef[] }) {
  const { isAuthenticated, login } = useAuth()

  return (
    <nav className={styles.topnav}>
      <Link to="/" className={styles.brand}>
        <img src="/assets/logo.png" alt="FinalsRS" />
        <span className={styles.brandName}>FinalsRS</span>
      </Link>

      <div className={styles.links}>
        {links.map((l) =>
          l.to ? (
            <Link
              key={l.label}
              to={l.to}
              className={`${styles.navLink} ${l.hideOnMobile ? styles.hideSm : ''}`}
            >
              {l.label}
            </Link>
          ) : (
            <a
              key={l.label}
              href={l.href}
              className={`${styles.navLink} ${l.hideOnMobile ? styles.hideSm : ''}`}
            >
              {l.label}
            </a>
          ),
        )}

        {isAuthenticated ? (
          <Link to="/dashboard" className="btn btn-primary btn-sm">
            Dashboard
          </Link>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={login}>
            <i className="fa-brands fa-twitch" /> Log in with Twitch
          </button>
        )}
      </div>
    </nav>
  )
}
