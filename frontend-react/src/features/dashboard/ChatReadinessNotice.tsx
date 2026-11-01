import type { ChatReadinessIssue } from '@/types/dashboard'
import styles from './ChatReadinessNotice.module.css'

interface ChatReadinessNoticeProps {
  issue: ChatReadinessIssue | null
  compact?: boolean
}

export function ChatReadinessNotice({ issue, compact = false }: ChatReadinessNoticeProps) {
  const blockedByFollowersOnly = issue?.code === 'followers_only_mode'

  // All clear: say nothing (the onboarding wizard shows its own mod/VIP tip).
  if (!issue) return null

  return (
    <div className={`${styles.notice} ${styles.blocked} ${compact ? styles.compact : ''}`} role="alert">
      <i className="fas fa-triangle-exclamation" aria-hidden="true" />
      <div>
        <strong>{blockedByFollowersOnly ? 'Followers-only chat is blocking the bot' : 'Twitch blocked a bot message'}</strong>
        <p>
          {blockedByFollowersOnly
            ? 'Make the bot a moderator or VIP, or turn off followers-only mode.'
            : issue.message || 'Check your Twitch chat settings and bot permissions.'}
        </p>
      </div>
    </div>
  )
}
