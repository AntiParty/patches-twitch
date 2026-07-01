/* Site footer for public pages. Mirrors the legacy landing-page footer. */
import { Link } from 'react-router-dom'
import styles from './Footer.module.css'

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.grid}>
        <div className={styles.col}>
          <h3>FinalsRS</h3>
          <p>The unofficial Twitch companion bot for THE FINALS ranked stats.</p>
        </div>
        <div className={styles.col}>
          <h4>Product</h4>
          <a href="/docs">Commands</a>
          <Link to="/leaderboard">Leaderboard</Link>
          <a href="/twitch-drops">Drops</a>
        </div>
        <div className={styles.col}>
          <h4>Resources</h4>
          <a href="/docs">Documentation</a>
          <a href="https://discord.com/invite/2UKzvzSEqA" target="_blank" rel="noreferrer">
            Support
          </a>
        </div>
        <div className={styles.col}>
          <h4>Legal</h4>
          <a href="/legal">Privacy</a>
          <a href="/legal#terms">Terms</a>
        </div>
      </div>
      <div className={styles.bottom}>
        <p>&copy; {new Date().getFullYear()} FinalsRS. Not affiliated with Embark Studios.</p>
      </div>
    </footer>
  )
}
