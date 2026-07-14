/* Two-tier site footer for public pages: brand + product links over a
 * hairline legal strip. */
import { Link } from 'react-router-dom'
import styles from './Footer.module.css'

export function Footer({ variant = 'default' }: { variant?: 'default' | 'cinematic' }) {
  return (
    <footer className={`${styles.footer} ${variant === 'cinematic' ? styles.cinematic : ''}`}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Link to="/" className={styles.lockup}>
              <img src="/assets/logo.png" alt="" />
              <span>FinalsRS</span>
            </Link>
            <p className={styles.tagline}>
              Rank tracking and chat commands for THE FINALS streamers.
            </p>
          </div>
          <nav className={styles.links} aria-label="Footer">
            <Link to="/leaderboard">Leaderboard</Link>
            <a href="/docs">Docs</a>
            <Link to="/twitch-drops">Drops</Link>
            <a href="https://discord.com/invite/2UKzvzSEqA" target="_blank" rel="noreferrer">
              Discord
            </a>
          </nav>
        </div>
        <div className={styles.bottom}>
          <p className={styles.copy}>
            &copy; {new Date().getFullYear()} FinalsRS · Not affiliated with Embark Studios.
          </p>
          <nav className={styles.legal} aria-label="Legal">
            <a href="/legal">Privacy</a>
            <a href="/legal#terms">Terms</a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
