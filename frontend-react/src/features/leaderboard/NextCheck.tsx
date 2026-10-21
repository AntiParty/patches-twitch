/*
 * Live countdown to the bot's next leaderboard check. Embark doesn't publish when
 * standings change, so this is when we'll next look — not a promise of new data.
 */
import { useEffect, useState } from 'react'

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

interface NextCheckProps {
  nextCheckAt: string | null | undefined
  className?: string
  /** Fixed clock for tests; omitted in the app so it ticks every second. */
  now?: number
}

export function NextCheck({ nextCheckAt, className, now }: NextCheckProps) {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    if (now !== undefined || !nextCheckAt) return
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [now, nextCheckAt])

  if (!nextCheckAt) return null
  const target = Date.parse(nextCheckAt)
  if (Number.isNaN(target)) return null

  const msLeft = target - (now ?? tick)
  return (
    <span className={className} title="When we next check Embark for new standings">
      {msLeft > 0 ? `Next check in ${formatCountdown(msLeft)}` : 'Checking for new standings…'}
    </span>
  )
}
