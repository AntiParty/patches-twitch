/* Minimal single-row site footer for public pages. */
import { Link } from 'react-router-dom'
import styles from './Footer.module.css'

export function Footer({ variant = 'default' }: { variant?: 'default' | 'cinematic' }) {
  return (
    <footer className={`${styles.footer} ${variant === 'cinematic' ? styles.cinematic : ''}`}>
      <div className={styles.row}>
        <p className={styles.copy}>
          &copy; {new Date().getFullYear()} FinalsRS. Not affiliated with Embark Studios.
        </p>
        <nav className={styles.links}>
          <a href="/docs">Docs</a>
          <Link to="/leaderboard">Leaderboard</Link>
          <a href="/twitch-drops">Drops</a>
          <a href="https://discord.com/invite/2UKzvzSEqA" target="_blank" rel="noreferrer">
            Support
          </a>
          <a href="/legal">Privacy</a>
          <a href="/legal#terms">Terms</a>
        </nav>
      </div>
    </footer>
  )
}
