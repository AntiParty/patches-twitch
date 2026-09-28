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
          <p className={styles.eyebrow}>Twitch tools for THE FINALS</p>
          <h1 id="landing-h1" className={styles.headline}>
            Make every ranked moment
            <br />
            part of the stream.
          </h1>
          <p className={styles.sub}>
            Live RS, session movement, and viewer predictions—ready in chat while you stay in the match.
          </p>
          <a href={primaryHref} className={styles.cta}>
            {isAuthenticated ? primaryLabel : 'Add FinalsRS to Twitch'}
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
          <p className={styles.sectionLabel}>Live product</p>
          <h2 className={styles.sectionTitle}>What FinalsRS does while you stream</h2>
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
          <p className={styles.sectionLabel}>Run the channel</p>
          <h2 className={styles.sectionTitle}>Everything else your stream needs</h2>
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
          <h2 className={styles.sectionTitle}>Live in three steps</h2>
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
  { cmd: 'Chat asks', desc: 'Viewers get the ranked context they want without leaving the stream.' },
  { cmd: 'Your session moves', desc: 'Every live gain and loss becomes a clear story for chat to follow.' },
  { cmd: 'Predictions open', desc: 'Turn the next ranked milestone into a shared viewer moment.' },
  { cmd: 'You keep playing', desc: 'FinalsRS handles the context while you stay focused on the match.' },
]

const FEATURES = [
  { title: 'OBS overlays', desc: 'Token-secured rank panels for your scene.' },
  { title: 'Custom responses', desc: 'Edit every command to match your channel.' },
  { title: 'Predictions', desc: 'Free presets, plus automated ranked runs.', premium: true },
  { title: 'Custom bot', desc: 'Reply from your own bot account.', premium: true },
]
