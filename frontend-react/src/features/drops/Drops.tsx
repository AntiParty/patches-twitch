/*
 * Public Twitch Drops page. Ported from drops.html — featured image + drops
 * list from /drops.json, plus live streamers from /api/active-streamers.
 * Rendered under AppLayout.
 */
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { Spinner } from '@/components/feedback/Spinner'
import { EmptyState } from '@/components/feedback/EmptyState'
import styles from './Drops.module.css'

const STEPS = [
  { title: 'Link your Twitch', body: 'Connect the Twitch account you watch streams with to Embark / THE FINALS.' },
  { title: 'Watch a participating stream', body: 'Watch any THE FINALS stream with Drops enabled for the required time.' },
  { title: 'Claim your reward', body: 'Claim the drop from your Twitch inventory — it appears in-game automatically.' },
]

export function Drops() {
  const dropsQuery = useQuery({ queryKey: ['drops', 'public'], queryFn: publicApi.getDrops })
  const streamersQuery = useQuery({ queryKey: ['drops', 'streamers'], queryFn: publicApi.getActiveStreamers, retry: false })

  const data = dropsQuery.data
  const streamers = (streamersQuery.data ?? []).filter(
    (s, i, arr) => arr.findIndex((x) => x.channel === s.channel) === i,
  )

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}><span /> THE FINALS / TWITCH DROPS</p>
        <h1>
          Twitch <span className={styles.gradient}>Drops</span>
        </h1>
        <p className={styles.subtitle}>
          Track active THE FINALS Twitch drops and the channels currently streaming with them enabled.
        </p>
      </header>

      {/* Live streamers */}
      {streamers.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>Watch now</p>
              <h2>Live with Drops</h2>
            </div>
            <span className={styles.liveBadge}><span /> LIVE</span>
          </div>
          <div className={styles.streamersGrid}>
            {streamers.map((s) => (
              <a
                key={s.channel}
                className={styles.streamerCard}
                href={`https://twitch.tv/${s.channel}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className={styles.thumb}
                  loading="lazy"
                  alt={s.channel}
                  src={s.thumbnail_url || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.channel.toLowerCase()}-320x180.jpg`}
                />
                <div className={styles.streamerInfo}>
                  <div className={styles.streamerName}>{s.channel}</div>
                  <div className={styles.streamStatus}>
                    <span className={styles.statusDot} /> Playing THE FINALS
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Featured + drops list */}
      <section className={styles.section}>
        <div className={styles.dropsPanel}>
          <div className={styles.featuredMedia}>
            {data?.featuredImage ? (
              <img className={styles.featuredImg} src={data.featuredImage} alt="Featured Twitch drop" />
            ) : (
              <div className={styles.featuredFallback} aria-hidden="true">
                <div className={styles.fallbackGrid} />
                <i className="fas fa-gift" />
                <span>DROP SIGNAL</span>
              </div>
            )}
          </div>
          <div className={styles.dropsContent}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionLabel}>Current campaign</p>
                <h2>Available Drops</h2>
              </div>
              {data?.lastUpdated && <span className={styles.lastUpdated}>Last updated: {data.lastUpdated}</span>}
            </div>

            {dropsQuery.isLoading ? (
              <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner /></div>
            ) : dropsQuery.isError ? (
              <EmptyState icon="fas fa-gift" title="Failed to load drops" description="Please try again later." />
            ) : !data?.drops.length ? (
              <EmptyState icon="fas fa-gift" title="No active drops right now" />
            ) : (
              <ul className={styles.dropsList}>
                {data.drops.map((d, i) => (
                  <li className={styles.dropItem} key={i}>
                    <div>
                      <div className={styles.dropName}>{d.name}</div>
                      {d.category && <div className={styles.dropCategory}>{d.category}</div>}
                    </div>
                    {d.duration && (
                      <span className={styles.dropTime}>
                        <i className="fas fa-clock" /> {d.duration}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* How to claim */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionLabel}>The route to rewards</p>
            <h2>How to claim Drops</h2>
          </div>
        </div>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div className={styles.step} key={s.title}>
              <div className={styles.stepRail}><div className={styles.stepNumber}>{String(i + 1).padStart(2, '0')}</div></div>
              <div><h3>{s.title}</h3><p>{s.body}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
