/*
 * Live countdown tile content for the bot's next leaderboard check. Embark doesn't
 * publish when standings change, so this is when we'll next look, not a promise of new data.
 */
import { useEffect, useState } from 'react'
import styles from './Leaderboard.module.css'

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${String(minutes).padStart(2, '0')}:${ss}`
}

const TITLE =
  "When we next check Embark for new standings — Embark doesn't publish update times, so new data isn't guaranteed"

interface NextCheckProps {
  nextCheckAt: string | null | undefined
  lastCheckedAt?: string | null
  /** Fixed clock for tests; omitted in the app so it ticks every second. */
  now?: number
}

function Digits({ text }: { text: string }) {
  const chars = text.split('')
  return (
    <span className={styles.digits} aria-label={text}>
      {chars.map((ch, i) => {
        const pos = chars.length - i // position from the right, stable when hours appear
        if (ch === ':') {
          return (
            <span key={`p${pos}`} className={styles.digitStatic} aria-hidden>
              {ch}
            </span>
          )
        }
        // Remounting on a new character replays the CSS roll-in; no exiting copy to overlap.
        return (
          <span key={`p${pos}`} className={styles.digitSlot} aria-hidden>
            <span key={ch} className={styles.digitRoll}>
              {ch}
            </span>
          </span>
        )
      })}
    </span>
  )
}

export function NextCheck({ nextCheckAt, lastCheckedAt, now }: NextCheckProps) {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    if (now !== undefined || !nextCheckAt) return
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [now, nextCheckAt])

  const target = nextCheckAt ? Date.parse(nextCheckAt) : NaN
  if (Number.isNaN(target)) {
    return (
      <div title={TITLE}>
        <div className={styles.statValue}>—</div>
        <div className={styles.statSub}>Schedule unavailable</div>
      </div>
    )
  }

  const current = now ?? tick
  const msLeft = target - current
  const start = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN
  const showBar = !Number.isNaN(start) && target > start
  const fraction = showBar ? Math.min(1, Math.max(0, (current - start) / (target - start))) : 0

  return (
    <div title={TITLE}>
      {msLeft > 0 ? (
        <>
          <div className={styles.statValue}>
            <Digits text={formatCountdown(msLeft)} />
          </div>
          <div className={styles.statSub}>until next Embark check</div>
        </>
      ) : (
        <>
          <div className={`${styles.statValue} ${styles.checking}`}>Checking…</div>
          <div className={styles.statSub}>Looking for new standings</div>
        </>
      )}
      {showBar && (
        <div className={styles.bar} aria-hidden>
          <div className={styles.barFill} style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  )
}
