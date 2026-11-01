/*
 * Below-the-fold product view — the streamer dashboard drawn in code with
 * sample data: bot status, the rank tracker goal and this stream's RS moves.
 * Mirrors the real Control room and Rank Tracker tabs, not a mock feature.
 */
import styles from './Landing.module.css'

const NAV = ['Overview', 'Commands', 'Rank tracker', 'Overlays', 'Predictions', 'Giveaways', 'Settings']

const MOVES = [
  { time: '21:42', delta: '+310' },
  { time: '21:18', delta: '-95' },
  { time: '20:51', delta: '+420' },
  { time: '20:20', delta: '+610' },
]

export function DashboardShowcase() {
  return (
    <figure className={styles.showcase} aria-label="FinalsRS dashboard with sample data">
      <div className={styles.showcaseBar}>
        <span className={styles.showcaseUrl}>finalsrs.com/dashboard</span>
      </div>
      <div className={styles.showcaseBody}>
        <nav className={styles.showcaseNav} aria-hidden="true">
          <span className={styles.showcaseBrand}>FinalsRS</span>
          {NAV.map((item) => (
            <span key={item} className={item === 'Rank tracker' ? styles.showcaseNavActive : undefined}>
              {item}
            </span>
          ))}
        </nav>

        <div className={styles.showcaseMain}>
          <div className={styles.showcaseHead}>
            <h3>Rank tracker</h3>
            <span className={styles.showcaseStatus}>Bot is live</span>
          </div>

          <div className={styles.showcaseGrid}>
            <section className={styles.goalCard}>
              <p className={styles.cardLabel}>Goal</p>
              <p className={styles.goalTitle}>Ruby</p>
              <p className={styles.goalFigure}>
                41,870 <span>RS</span>
              </p>
              <div className={styles.goalBar} role="img" aria-label="96% of the way to Ruby">
                <span style={{ width: '96%' }} />
              </div>
              <div className={styles.goalMeta}>
                <span>#212 · Diamond 1</span>
                <span>1,630 RS to go</span>
              </div>
            </section>

            <section className={styles.sessionCard}>
              <p className={styles.cardLabel}>This stream</p>
              <p className={styles.sessionFigure}>+1,245 RS</p>
              <p className={styles.sessionSub}>since 19:58 · 184 commands answered</p>
              <ul className={styles.moves}>
                {MOVES.map((m) => (
                  <li key={m.time}>
                    <span>{m.time}</span>
                    <span className={m.delta.startsWith('-') ? styles.moveDown : styles.moveUp}>
                      {m.delta}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </figure>
  )
}
