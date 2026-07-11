/*
 * Infinite streamer marquee — featured channels with partner badges.
 * Contained width; edge fade; paused on hover; static under reduced motion.
 */
import type { CSSProperties } from 'react'
import styles from './Landing.module.css'

export type FeaturedStreamer = {
  login: string
  display: string
  partner?: boolean
}

/** Curated large channels that use FinalsRS. */
export const FEATURED_STREAMERS: FeaturedStreamer[] = [
  { login: 'ekazoko', display: 'Ekazoko', partner: true },
  { login: 'ks_rachel', display: 'ks_rachel', partner: false },
  { login: 'jukerfps', display: 'JukerFPS', partner: true },
  { login: 'ma5uke', display: 'ma5uke', partner: true },
  { login: 'doccboppo_', display: 'doccboppo_', partner: false },
]

function avatarUrl(login: string): string {
  return `https://unavatar.io/twitch/${encodeURIComponent(login)}`
}

function PartnerBadge() {
  return (
    <svg
      className={styles.partnerBadge}
      viewBox="0 0 16 16"
      width={16}
      height={16}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="8" fill="#9146FF" />
      <path
        d="M6.7 10.7 4.4 8.4l1.05-1.05L6.7 8.6l3.85-3.85L11.6 5.8 6.7 10.7z"
        fill="#fff"
      />
    </svg>
  )
}

function StreamerChip({ s }: { s: FeaturedStreamer }) {
  return (
    <a
      className={styles.streamerChip}
      href={`https://twitch.tv/${s.login}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={styles.streamerAvatarWrap}>
        <img
          className={styles.streamerAvatar}
          src={avatarUrl(s.login)}
          alt=""
          width={38}
          height={38}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.remove()
          }}
        />
        <span className={styles.streamerAvatarFallback} aria-hidden="true">
          {s.display.slice(0, 1).toUpperCase()}
        </span>
      </span>
      <span className={styles.streamerName}>
        {s.display}
        {s.partner ? (
          <span className={styles.partnerWrap} title="Twitch Partner">
            <PartnerBadge />
          </span>
        ) : null}
      </span>
    </a>
  )
}

function StreamerRow({
  streamers,
  prefix,
  ariaHidden,
}: {
  streamers: FeaturedStreamer[]
  prefix: string
  ariaHidden?: boolean
}) {
  return (
    <ul className={styles.marqueeGroup} aria-hidden={ariaHidden || undefined}>
      {streamers.map((s, i) => (
        <li key={`${prefix}-${s.login}-${i}`} className={styles.marqueeItem}>
          <StreamerChip s={s} />
        </li>
      ))}
    </ul>
  )
}

// Enough copies that the track always overflows the container, so the
// -1/COPIES loop shift lands seamlessly even with a short streamer list.
const COPIES = 6

export function StreamerMarquee({
  streamers = FEATURED_STREAMERS,
}: {
  streamers?: FeaturedStreamer[]
}) {
  // Speed scales with list length (same pace per chip as the original 36s/4).
  const durationSec = Math.max(18, streamers.length * 9)
  const shiftPct = 100 / COPIES

  return (
    <div className={styles.marqueeSection}>
      <p className={styles.marqueeLabel}>Trusted by streamers</p>
      <div
        className={styles.marquee}
        role="region"
        aria-label="Featured streamers using FinalsRS"
      >
        <div
          className={styles.marqueeTrack}
          style={
            {
              '--marquee-duration': `${durationSec}s`,
              '--marquee-shift': `-${shiftPct}%`,
            } as CSSProperties
          }
        >
          {Array.from({ length: COPIES }, (_, i) => (
            <StreamerRow
              key={`copy-${i}`}
              streamers={streamers}
              prefix={`copy-${i}`}
              ariaHidden={i > 0}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
