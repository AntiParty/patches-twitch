/*
 * Top navigation. On the landing page: floating centered pill cluster
 * over the cinematic hero. Elsewhere: standard sticky bar. Below 720px the
 * page links collapse into a menu button.
 */
import { useCallback, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useClickOutside } from '@/hooks/useClickOutside'
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
  const { pathname } = useLocation()
  const isLanding = pathname === '/'
  const navRef = useRef<HTMLElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useClickOutside(navRef, closeMenu, menuOpen)

  return (
    <nav ref={navRef} className={`${styles.topnav} ${isLanding ? styles.landing : ''}`}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} onClick={closeMenu}>
          <img src="/assets/logo.png" alt="" />
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
            <Link
              to="/dashboard"
              className={isLanding ? styles.pillCta : 'btn btn-primary btn-sm'}
            >
              Dashboard
            </Link>
          ) : (
            <button
              type="button"
              className={isLanding ? styles.pillCta : 'btn btn-primary btn-sm'}
              onClick={login}
            >
              <i className="fa-brands fa-twitch" aria-hidden="true" /> Log in
            </button>
          )}

          <button
            type="button"
            className={styles.menuBtn}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <i className={`fa-solid ${menuOpen ? 'fa-xmark' : 'fa-bars'}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="site-menu" className={styles.menu}>
          {links.map((l) =>
            l.to ? (
              <Link key={l.label} to={l.to} className={styles.menuLink} onClick={closeMenu}>
                {l.label}
              </Link>
            ) : (
              <a key={l.label} href={l.href} className={styles.menuLink} onClick={closeMenu}>
                {l.label}
              </a>
            ),
          )}
        </div>
      )}
    </nav>
  )
}
