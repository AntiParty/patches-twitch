/*
 * Landing / marketing page — "Flat & Neutral" redesign.
 * Stats-forward hero + chat demo + feature grid + how-it-works + CTA.
 * Rendered under AppLayout (shared Navbar/Footer). Auth-aware CTAs.
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { publicApi } from '@/api/public'
import styles from './Landing.module.css'

const LOGO = '/assets/logo.png'

/** 1234 -> "1,234"; 2400000 -> "2.4M". */
function formatStat(n: number): string {
  if (n >= 10_000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  }
  return new Intl.NumberFormat('en').format(n)
}

export function Landing() {
  const { isAuthenticated } = useAuth()

  const { data: stats } = useQuery({
    queryKey: ['public-stats'],
    queryFn: publicApi.getStats,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const primaryCtaHref = isAuthenticated ? '/dashboard' : '/login'
  const primaryCtaLabel = isAuthenticated ? 'Go to Dashboard' : 'Add to my channel'

  // Show real usage numbers only once they're worth bragging about;
  // otherwise fall back to honest qualitative facts.
  const impressive = !!stats && stats.userCount >= 500 && stats.commandsProcessed >= 100_000
  const statCards = impressive
    ? [
        { value: formatStat(stats.userCount), label: 'Channels' },
        { value: formatStat(stats.commandsProcessed), label: 'Commands served' },
        { value: '10,000+', label: 'Players tracked' },
      ]
    : [
        { value: '30 sec', label: 'Typical setup' },
        { value: 'Live', label: 'Rank lookups' },
        { value: 'Free', label: 'For channels' },
      ]

  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <p className="section-eyebrow">Unofficial ranked utility for THE FINALS</p>
        <h1 className={styles.headline}>
          The FINALS rank bot
          <br />
          for your Twitch chat
        </h1>
        <p className={styles.lede}>
          Live rank, RS tracking, predictions and overlays for THE FINALS streamers. Free.
        </p>
        <div className={styles.ctaGroup}>
          <a href={primaryCtaHref} className="btn btn-primary btn-lg">
            {!isAuthenticated && <i className="fa-brands fa-twitch" />} {primaryCtaLabel}
          </a>
          <a href="/docs" className="btn btn-ghost btn-lg">
            View docs
          </a>
        </div>

        <div className={styles.statRow} aria-label="Usage stats">
          {statCards.map((s) => (
            <div className={styles.statCard} key={s.label}>
              <span className={styles.statValue}>{s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Chat demo */}
      <section className={styles.section} aria-label="Example Twitch command output">
        <div className={styles.chatPanel}>
          <div className={styles.chatTopbar}>
            <span className={styles.chatTitle}>Stream chat</span>
            <span className={styles.statusPill}>Connected</span>
          </div>
          <div className={styles.chatBody}>
            <div className={styles.chatLine}>
              <span className={styles.timestamp}>12:01</span>
              <span className={`${styles.username} ${styles.user1}`}>Viewer77:</span>
              <span className={styles.message}>
                <code>!rank</code>
              </span>
            </div>
            <div className={styles.chatLine}>
              <span className={styles.timestamp}>12:01</span>
              <img src={LOGO} className={styles.botBadge} alt="" />
              <span className={`${styles.username} ${styles.botName}`}>FinalsRS:</span>
              <span className={styles.message}>
                <span className={styles.mention}>@Viewer77</span> Diamond 3, 43,331 RS (+145 this
                stream)
              </span>
            </div>
            <div className={styles.chatLine}>
              <span className={styles.timestamp}>12:08</span>
              <span className={`${styles.username} ${styles.user2}`}>ModCheck:</span>
              <span className={styles.message}>
                <code>!predict</code>
              </span>
            </div>
            <div className={styles.chatLine}>
              <span className={styles.timestamp}>12:08</span>
              <img src={LOGO} className={styles.botBadge} alt="" />
              <span className={`${styles.username} ${styles.botName}`}>FinalsRS:</span>
              <span className={styles.message}>Current T500 pace: 43.7k RS. You are inside the line.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={styles.section} id="features">
        <p className="section-eyebrow">Features</p>
        <h2 className={styles.sectionTitle}>Everything the stream actually asks for</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div className={styles.featureCard} key={f.title}>
              <i className={`${f.icon} ${styles.featureIcon}`} />
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section} id="how-it-works">
        <p className="section-eyebrow">Setup</p>
        <h2 className={styles.sectionTitle}>Live in under a minute</h2>
        <div className={styles.stepGrid}>
          <div className={styles.step}>
            <span className={styles.stepNum}>01</span>
            <h3>Log in with Twitch</h3>
            <p>One click. The bot joins your channel automatically.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>02</span>
            <h3>Link your embark ID</h3>
            <p>
              Use <code>!link Name#1234</code> or the dashboard so the bot knows who to track.
            </p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>03</span>
            <h3>Let chat ask</h3>
            <p>Viewers use ranked commands while you stay in the match.</p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.ctaStrip}>
        <div>
          <h2 className={styles.ctaTitle}>Add FinalsRS to your Twitch channel</h2>
          <p className={styles.ctaSub}>Free for every channel. Ready before your next queue pops.</p>
        </div>
        <a href={primaryCtaHref} className="btn btn-primary btn-lg">
          {isAuthenticated ? 'Go to Dashboard' : 'Get started free'}
        </a>
      </section>
    </div>
  )
}

const FEATURES = [
  {
    icon: 'fas fa-ranking-star',
    title: 'Live rank command',
    desc: 'Chat types !rank and gets league, RS and session movement in one line.',
  },
  {
    icon: 'fas fa-terminal',
    title: 'Custom commands',
    desc: 'Edit every response, add variables, and keep your channel voice.',
  },
  {
    icon: 'fas fa-chart-line',
    title: 'Predictions',
    desc: 'Start Twitch predictions on rank outcomes — automated for premium channels.',
  },
  {
    icon: 'fas fa-display',
    title: 'OBS overlays',
    desc: 'Themeable rank overlay for your stream, updated live, token-secured.',
  },
  {
    icon: 'fas fa-trophy',
    title: 'Leaderboard',
    desc: 'Season leaderboard with league filters, search, and Ruby cutoff tracking.',
  },
  {
    icon: 'fas fa-robot',
    title: 'Custom bot identity',
    desc: 'Premium channels can send responses from their own bot account.',
  },
]
