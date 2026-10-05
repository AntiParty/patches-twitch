import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { Spinner } from '@/components/feedback/Spinner'
import { EmptyState } from '@/components/feedback/EmptyState'
import styles from './Drops.module.css'

const STEPS = [
  { title: 'Link your Twitch', body: 'Connect your Twitch account to your Embark account.', href: 'https://id.embark.games/id/connected-platforms', link: 'Link accounts' },
  { title: 'Watch THE FINALS', body: 'Choose a participating stream and check that Drops are enabled. Watch for the required time.', href: 'https://www.twitch.tv/directory/category/the-finals', link: 'Find a stream' },
  { title: 'Claim your rewards', body: 'Open your Twitch inventory to track your progress and claim each reward.', href: 'https://www.twitch.tv/drops/inventory', link: 'Open inventory' },
]

export function Drops() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const dropsQuery = useQuery({ queryKey: ['drops', 'public'], queryFn: publicApi.getDrops, refetchInterval: 60_000 })
  const streamersQuery = useQuery({ queryKey: ['drops', 'streamers'], queryFn: publicApi.getActiveStreamers, retry: false, refetchInterval: 60_000 })
  const data = dropsQuery.data
  const endsAt = data?.endsAt ? Date.parse(data.endsAt) : NaN
  const hasEndDate = Number.isFinite(endsAt)
  const campaignExpired = hasEndDate && now >= endsAt
  const featuredImage = campaignExpired ? '' : data?.featuredImage
  const activeDrops = campaignExpired ? [] : (data?.drops ?? [])
  const streamers = streamersQuery.isError ? [] : (streamersQuery.data ?? [])
  const endLabel = hasEndDate ? new Intl.DateTimeFormat(undefined, {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(endsAt) : ''

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.gameLabel}>THE FINALS</p>
          <h1>Twitch Drops</h1>
          <p className={styles.subtitle}>Watch the action. Take the rewards into the arena.</p>
        </div>
        <a className={styles.action} href="https://www.twitch.tv/drops/inventory" target="_blank" rel="noreferrer">
          <i className="fas fa-gift" aria-hidden="true" /> My Drops inventory
        </a>
      </header>

      <section className={styles.campaign} aria-labelledby="campaign-title">
        {featuredImage && !dropsQuery.isError && (
          <div className={styles.featuredMedia}>
            <img className={styles.featuredImg} src={featuredImage} alt="THE FINALS campaign rewards" />
          </div>
        )}
        <div className={styles.campaignBody}>
          <div className={styles.campaignHeader}>
            <div>
              <p className={styles.campaignStatus}>{campaignExpired ? 'Campaign ended' : activeDrops.length ? 'Available now' : 'Twitch rewards'}</p>
              <h2 id="campaign-title">{campaignExpired ? 'Catch the next drop' : 'Watch. Earn. Equip.'}</h2>
            </div>
            {data && !dropsQuery.isError && (
              <div className={styles.deadline}>
                <i className="far fa-clock" aria-hidden="true" />
                <div>
                  <span>{campaignExpired ? 'Ended' : 'Campaign ends'}</span>
                  {hasEndDate ? <time dateTime={data.endsAt}>{endLabel}</time> : <strong>End date not announced</strong>}
                </div>
              </div>
            )}
          </div>
          {dropsQuery.isLoading ? (
            <div className={styles.loading} role="status" aria-label="Loading drops"><Spinner /></div>
          ) : dropsQuery.isError ? (
            <EmptyState icon="fas fa-gift" title="Couldn’t load drops" description="Please try again shortly." />
          ) : !activeDrops.length ? (
            <EmptyState icon="fas fa-gift" title="No active drops right now" description="Check back for the next THE FINALS campaign." />
          ) : (
            <ul className={styles.dropsList} aria-label="Available rewards">
              {activeDrops.map((drop, i) => (
                <li className={styles.dropItem} key={i}>
                  <div className={styles.rewardIcon}><i className="fas fa-gift" aria-hidden="true" /></div>
                  <div className={styles.rewardInfo}>
                    <div className={styles.dropName}>{drop.name}</div>
                    {drop.category && <div className={styles.dropCategory}>{drop.category}</div>}
                  </div>
                  {drop.duration && <span className={styles.dropTime}><i className="far fa-clock" aria-hidden="true" /> Watch {drop.duration}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="streams-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="streams-title">Live in THE FINALS</h2>
            <p>Channels using FinalsRS. Check the stream for Drops eligibility before watching.</p>
          </div>
          {streamers.length > 0 && <span className={styles.liveBadge}><span /> {streamers.length} live</span>}
        </div>
        {streamersQuery.isLoading ? (
          <div className={styles.loading} role="status" aria-label="Loading live channels"><Spinner /></div>
        ) : streamersQuery.isError ? (
          <p className={styles.notice}>Live channels are temporarily unavailable. <a href="https://www.twitch.tv/directory/category/the-finals" target="_blank" rel="noreferrer">Browse THE FINALS on Twitch</a></p>
        ) : !streamers.length ? (
          <p className={styles.notice}>No FinalsRS channels are playing THE FINALS right now. <a href="https://www.twitch.tv/directory/category/the-finals" target="_blank" rel="noreferrer">Browse THE FINALS on Twitch</a></p>
        ) : (
          <div className={styles.streamersGrid}>
            {streamers.map(streamer => (
              <a key={streamer.channel} className={styles.streamerCard} href={`https://twitch.tv/${streamer.channel}`} target="_blank" rel="noreferrer">
                <div className={styles.preview}>
                  <img className={styles.thumb} loading="lazy" alt="" src={streamer.thumbnail_url || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.channel}-320x180.jpg`} />
                  <span className={styles.onAir}>Live</span>
                </div>
                <div className={styles.streamerInfo}>
                  <strong>{streamer.channel}</strong>
                  <span>THE FINALS <i className="fas fa-arrow-up-right-from-square" aria-hidden="true" /></span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="claim-title">
        <div className={styles.sectionHead}><h2 id="claim-title">Three steps to your next reward</h2></div>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li className={styles.step} key={step.title}>
              <span className={styles.stepNumber}>{i + 1}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p><a href={step.href} target="_blank" rel="noreferrer">{step.link}</a></div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
