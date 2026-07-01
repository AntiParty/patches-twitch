/*
 * Developer API documentation. Ported from developer-api.html — public v1 API
 * reference (leaderboard cutoff prediction + player stats). Under AppLayout.
 * Reuses the Docs layout/section styles.
 */
import docs from '@/features/docs/Docs.module.css'
import styles from './Developer.module.css'

const CUTOFF_EXAMPLE = `{
  "meta": { "generated_at": "2026-01-23T12:00:00.000Z", "api_version": "v1" },
  "data": {
    "current_cutoff_rs": 45100,
    "prediction": {
      "target_date_days": 55,
      "predicted_rs": 62500,
      "confidence_interval": { "min": 61200, "max": 63800 },
      "trend": { "daily_change": 320, "slope_standard_error": 15 },
      "season_rush": { "active": false, "multiplier": 1.0 }
    },
    "confidence_level": "High"
  }
}`

const PLAYER_EXAMPLE = `{
  "meta": { "generated_at": "2026-01-23T12:05:00.000Z" },
  "data": {
    "name": "EmbarkName#1234",
    "rank": 42,
    "league": "Diamond 1",
    "rank_score": 58200,
    "movement": { "rank_change": -2, "score_change": 150 },
    "updated_at": "2026-01-23T11:45:00.000Z"
  }
}`

const NAV = [
  ['overview', 'Overview'],
  ['ratelimits', 'Rate Limits'],
  ['prediction', 'Prediction'],
  ['player', 'Player Stats'],
  ['terms', 'Terms of Use'],
]

export function Developer() {
  return (
    <div className={docs.layout}>
      <aside className={docs.sidebar}>
        <nav>
          <div className={docs.navGroup}>
            <h4>Developer API</h4>
            <ul>
              {NAV.map(([id, label]) => (
                <li key={id}><a className={docs.navLink} href={`#${id}`}>{label}</a></li>
              ))}
            </ul>
          </div>
        </nav>
      </aside>

      <main>
        <header className={docs.header}>
          <div className={docs.breadcrumbs}>
            <span>Documentation</span>
            <span>›</span>
            <span style={{ color: 'var(--text-main)' }}>Developer API</span>
          </div>
          <h1 id="overview">Developer API (Beta)</h1>
          <p className={docs.subtitle}>
            Build community tools with FinalsRS public THE FINALS data endpoints. No API key required.
          </p>
        </header>

        <section id="ratelimits" className={docs.section}>
          <span className={docs.tag}>Getting Started</span>
          <h2>Rate Limits & CORS</h2>
          <p>The API is public and does not require a key. IP-based rate limiting keeps usage fair.</p>
          <ul style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <li><strong>Base URL:</strong> <code>https://finalsrs.com/api/v1</code></li>
            <li><strong>Rate limit:</strong> 60 requests per minute per IP.</li>
            <li><strong>CORS:</strong> Enabled for all endpoints.</li>
          </ul>
        </section>

        <section id="prediction" className={docs.section}>
          <span className={docs.tag}>Endpoints</span>
          <h2>Get Leaderboard Prediction</h2>
          <p>Returns the estimated Top 500 cutoff Rank Score for a future date, accounting for daily trends and end-of-season rushes.</p>
          <div className={styles.codeBlock}>
            <span className={`${styles.methodTag} ${styles.methodGet}`}>GET</span>
            <span className={styles.path}>/leaderboard/cutoff</span>
          </div>
          <h3>Query Parameters</h3>
          <div className={docs.tableWrapper}>
            <table className={docs.table}>
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>days</code></td><td>Integer</td><td>Optional. Days into the future to predict. Defaults to current season end.</td></tr>
              </tbody>
            </table>
          </div>
          <h3>Response Example</h3>
          <div className={styles.codeBlock}><pre className={styles.pre}>{CUTOFF_EXAMPLE}</pre></div>
        </section>

        <section id="player" className={docs.section}>
          <span className={docs.tag}>Endpoints</span>
          <h2>Get Player Stats</h2>
          <p>Retrieve real-time leaderboard statistics for a specific player. Supports exact name or name#tag.</p>
          <div className={styles.codeBlock}>
            <span className={`${styles.methodTag} ${styles.methodGet}`}>GET</span>
            <span className={styles.path}>/player/:name</span>
          </div>
          <h3>Path Parameters</h3>
          <div className={docs.tableWrapper}>
            <table className={docs.table}>
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>name</code></td><td>String</td><td>The Embark ID (Name#1234) or display name to search for.</td></tr>
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            <strong>Important:</strong> Player names with tags require URL encoding — replace <code>#</code> with <code>%23</code>.<br />
            <strong>Example:</strong> <code>https://finalsrs.com/api/v1/player/carnifex%237330</code>
          </p>
          <h3>Response Example</h3>
          <div className={styles.codeBlock}><pre className={styles.pre}>{PLAYER_EXAMPLE}</pre></div>
        </section>

        <section id="terms" className={docs.section}>
          <span className={docs.tag}>Important</span>
          <h2>Terms of Use</h2>
          <p>By using the FinalsRS Developer API, you agree to the following:</p>
          <ul style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <li><strong>Attribution:</strong> Credit "FinalsRS" with a link to finalsrs.com in public projects.</li>
            <li><strong>Caching:</strong> Cache responses for at least 30 minutes (data updates every ~45 minutes).</li>
            <li><strong>Abuse:</strong> Excessive scraping or abuse will result in a permanent IP ban.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
