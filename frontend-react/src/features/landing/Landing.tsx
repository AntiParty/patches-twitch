/*
 * Landing — cinematic centered hero with canvas atmosphere.
 * Clean sans type; product details below the fold.
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { publicApi } from '@/api/public'
import { HeroAtmosphere } from './HeroAtmosphere'
import { DitherAtmosphere } from './DitherAtmosphere'
import { StreamerMarquee } from './StreamerMarquee'
import styles from './Landing.module.css'

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

  const primaryHref = isAuthenticated ? '/dashboard' : '/login'
  const primaryLabel = isAuthenticated ? 'Open dashboard' : 'Add to Twitch'

  const metrics =
    stats && stats.userCount >= 500 && stats.commandsProcessed >= 100_000
      ? [
          { value: formatStat(stats.userCount), label: 'Channels' },
          { value: formatStat(stats.commandsProcessed), label: 'Commands' },
          { value: '10k+', label: 'Players' },
        ]
      : [
          { value: '30s', label: 'Setup' },
          { value: 'Live', label: 'Lookups' },
          { value: 'Free', label: 'Channels' },
        ]

  return (
    <div className={styles.root}>
      <section className={styles.hero} aria-labelledby="landing-h1">
        <div className={styles.atmosphere} aria-hidden="true">
          <DitherAtmosphere color="red" />
          <HeroAtmosphere />
          <div className={styles.heroFade} />
        </div>

        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Twitch bot for THE FINALS</p>
          <h1 id="landing-h1" className={styles.headline}>
            Ranked stats
            <br />
            before chat asks.
          </h1>
          <p className={styles.sub}>
            FinalsRS brings live RS, session tracking, and peak rank into Twitch
            chat — so you stay in the match.
          </p>
          <a href={primaryHref} className={styles.cta}>
            {primaryLabel}
          </a>
        </div>

        <StreamerMarquee />
      </section>

      <div className={styles.below}>
        <section className={styles.metrics} aria-label="Highlights">
          {metrics.map((m) => (
            <div key={m.label} className={styles.metric}>
              <span className={styles.metricValue}>{m.value}</span>
              <span className={styles.metricLabel}>{m.label}</span>
            </div>
          ))}
        </section>

        <section className={styles.section} id="commands">
          <p className={styles.sectionLabel}>Commands</p>
          <h2 className={styles.sectionTitle}>What chat can type</h2>
          <ul className={styles.cmdList}>
            {COMMANDS.map((c) => (
              <li key={c.cmd}>
                <code>{c.cmd}</code>
                <span>{c.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} id="more">
          <p className={styles.sectionLabel}>Also included</p>
          <h2 className={styles.sectionTitle}>Everything else ranked needs</h2>
          <div className={styles.featureRow}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.feature}>
                <h3>
                  {f.title}
                  {f.premium && <span className={styles.premiumTag}>Premium</span>}
                </h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section} id="setup">
          <p className={styles.sectionLabel}>Setup</p>
          <h2 className={styles.sectionTitle}>Three steps</h2>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <strong>Connect Twitch</strong>
                <p>The bot joins your channel.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Link your IGN</strong>
                <p>
                  <code>!link Name#1234</code>
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Let chat ask</strong>
                <p>You stay in queue.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className={styles.endCta}>
          <h2 className={styles.endTitle}>Add FinalsRS to your channel</h2>
          <p className={styles.endSub}>Free for streamers. Ready before the next queue.</p>
          <div className={styles.endActions}>
            <a href={primaryHref} className={styles.cta}>
              {isAuthenticated ? 'Open dashboard' : 'Get started free'}
            </a>
            <a href="/docs" className={styles.ghostLink}>
              View commands
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}

const COMMANDS = [
  { cmd: '!rank', desc: 'Current league and RS' },
  { cmd: '!record', desc: 'Session gain or loss' },
  { cmd: '!peak', desc: 'Best rank across seasons' },
  { cmd: '!predict', desc: 'T500 cutoff estimate' },
]

const FEATURES = [
  { title: 'OBS overlays', desc: 'Token-secured rank panels for your scene.' },
  { title: 'Custom responses', desc: 'Edit every command to match your channel.' },
  { title: 'Predictions', desc: 'Free presets, plus automated ranked runs.', premium: true },
  { title: 'Custom bot', desc: 'Reply from your own bot account.', premium: true },
]
