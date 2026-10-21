/* Drop durations arrive as free text from the admin form ("1 hours", "30 minutes"). */
export function formatWatchTime(duration: string): string {
  const text = duration.trim().replace(/^1 (hour|minute)s\b/i, '1 $1')
  return `Watch ${text}`
}
