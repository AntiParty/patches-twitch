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
            <h2>Live With Drops</h2>
            <span className={styles.liveBadge}>LIVE</span>
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
        <div className={styles.split}>
          <div>{data?.featuredImage && <img className={styles.featuredImg} src={data.featuredImage} alt="Featured drop" />}</div>
          <div>
            <div className={styles.sectionHead} style={{ justifyContent: 'space-between' }}>
              <h2>Available Drops</h2>
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
          <h2>How to Claim Twitch Drops</h2>
        </div>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div className={styles.step} key={s.title}>
              <div className={styles.stepNumber}>{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
