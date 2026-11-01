/*
 * Dashboard Overview tab — "Control room". One status strip owns the bot
 * toggle; below it the Rank now panel (live RS, league, goal progress, Top 500
 * cutoff) is the one rich element, next to a narrow column of channel facts.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/buttons/Button'
import { Skeleton } from '@/components/feedback/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useToast } from '@/hooks/useToast'
import { ApiError } from '@/api/errors'
import { rankApi, RANK_MILESTONES, RANK_NAMES, RANK_THRESHOLDS } from '@/api/rank'
import type { CurrentRank, RankGoal } from '@/types/rank'
import { useCommands, useProfile, useToggleBot } from './hooks'
import { ChatReadinessNotice } from './ChatReadinessNotice'
import styles from './Overview.module.css'

const fmt = (n: number) => n.toLocaleString('en-US')

export function Overview() {
  const { data: profile, isLoading, isError, refetch } = useProfile()
  const toggle = useToggleBot()
  const toast = useToast()

  const handleToggle = async () => {
    try {
      const res = await toggle.mutateAsync()
      toast.success(res.bot_enabled ? 'Bot is now live' : 'Bot turned off')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to toggle bot')
    }
  }

  const header = (
    <PageHeader
      title="Control room"
      subtitle={`Bot, ranked commands, overlays and channel setup${profile ? ` for ${profile.username}` : ''}`}
      actions={
        <a className="btn btn-ghost" href="/">
          Home page
        </a>
      }
    />
  )

  if (isLoading) {
    return (
      <>
        {header}
        <Skeleton height={72} radius={12} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={240} lines={1} />
        </div>
      </>
    )
  }

  if (isError || !profile) {
    return (
      <>
        {header}
        <ErrorState message="Couldn't load your dashboard." onRetry={() => refetch()} />
      </>
    )
  }

  const botOn = profile.botEnabled

  return (
    <>
      {header}

      <section className={styles.strip} aria-label="Bot status">
        <div className={styles.stripMain}>
          <span className={`${styles.dot} ${botOn ? styles.dotOn : ''}`} aria-hidden="true" />
          <div>
            <h3 className={styles.stripTitle}>{botOn ? 'Bot is live' : 'Bot is offline'}</h3>
            <p className={styles.stripCopy}>
              {botOn
                ? `Rank commands are answering in ${profile.username}'s chat`
                : 'Turn the bot on when you are ready for chat commands'}
            </p>
          </div>
        </div>
        <Button
          variant={botOn ? 'ghost' : 'primary'}
          size="sm"
          loading={toggle.isPending}
          onClick={handleToggle}
        >
          {botOn ? 'Turn off' : 'Turn on'}
        </Button>
      </section>

      <ChatReadinessNotice issue={profile.chatReadiness} />

      <div className={styles.grid}>
        <RankNow linked={Boolean(profile.playerId)} />

        <aside className={styles.facts} aria-label="Channel">
          <div className={styles.fact}>
            <span className={styles.factLabel}>In-game name</span>
            {profile.playerId ? (
              <code className={styles.factMono}>{profile.playerId}</code>
            ) : (
              <span className={styles.factMuted}>Not linked</span>
            )}
          </div>
          <CommandsFact />
          <div className={styles.fact}>
            <span className={styles.factLabel}>Command reference</span>
            <a href="/docs" target="_blank" rel="noreferrer" className={styles.factLink}>
              Open docs
            </a>
          </div>
        </aside>
      </div>
    </>
  )
}

function CommandsFact() {
  const { data } = useCommands()
  const count = data?.commands.length
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>Custom responses</span>
      <span className={styles.factValue}>
        {count == null ? '—' : count}
        <Link to="/dashboard/commands" className={styles.factLink}>
          Edit
        </Link>
      </span>
    </div>
  )
}

/** Goal target in RS: an explicit chat target, a dashboard tier, or the next league. */
function resolveGoal(goal: RankGoal | null | undefined, rs: number, rubyRS: number | null) {
  if (goal) {
    const target =
      goal.targetRankScore ??
      (goal.targetRank === 6 ? rubyRS : RANK_THRESHOLDS[goal.targetRank] ?? null)
    return {
      label: goal.label ?? RANK_NAMES[goal.targetRank] ?? 'Goal',
      target,
      achieved: goal.achieved,
      explicit: true,
    }
  }
  const next = RANK_MILESTONES.find((m) => rs < m.threshold)
  return next
    ? { label: next.label, target: next.threshold, achieved: false, explicit: false }
    : null
}

function RankNow({ linked }: { linked: boolean }) {
  const current = useQuery({
    queryKey: ['rank', 'current'],
    queryFn: rankApi.getCurrentRank,
    retry: false, // 404 when no IGN linked
    enabled: linked,
  })
  const goalQuery = useQuery({ queryKey: ['rank', 'goal'], queryFn: rankApi.getGoal, enabled: linked })
  const ruby = useQuery({ queryKey: ['rank', 'ruby'], queryFn: rankApi.getRubyStatus })

  const cutoff = ruby.data?.rubyRankThreshold?.threshold ?? null

  if (!linked) {
    return (
      <section className={`${styles.rank} ${styles.rankEmpty}`}>
        <p className={styles.rankLabel}>Rank now</p>
        <p className={styles.emptyCopy}>Link your in-game name to see your live RS and goal here</p>
        <Link className="btn btn-primary btn-sm" to="/dashboard/settings">
          Link IGN
        </Link>
      </section>
    )
  }

  if (current.isLoading) {
    return <Skeleton height={240} lines={1} />
  }

  const data: CurrentRank | undefined = current.data
  if (!data) {
    return (
      <section className={`${styles.rank} ${styles.rankEmpty}`}>
        <p className={styles.rankLabel}>Rank now</p>
        <p className={styles.emptyCopy}>
          {current.error instanceof ApiError
            ? current.error.message
            : 'Not on the ranked leaderboard yet (top 10,000 only)'}
        </p>
      </section>
    )
  }

  const goal = resolveGoal(goalQuery.data?.goal, data.rankScore, cutoff)
  const toGo = goal?.target != null ? Math.max(0, goal.target - data.rankScore) : null
  const pct =
    goal?.achieved || toGo === 0
      ? 100
      : goal?.target
        ? Math.min(100, Math.max(0, (data.rankScore / goal.target) * 100))
        : 0

  return (
    <section className={styles.rank} aria-label="Rank now">
      <div className={styles.rankHead}>
        <p className={styles.rankLabel}>Rank now</p>
        <Link to="/dashboard/rank-tracker" className={styles.factLink}>
          Rank tracker
        </Link>
      </div>

      <p className={styles.rankFigure}>
        {fmt(data.rankScore)}
        <span>RS</span>
      </p>
      <p className={styles.rankMeta}>
        {data.rank != null ? `#${fmt(data.rank)}` : 'Unranked'}
        {data.league ? ` · ${data.league}` : ''}
      </p>

      {goal && (
        <div className={styles.goal}>
          <div className={styles.goalRow}>
            <span>
              {goal.explicit ? 'Goal' : 'Next league'} <strong>{goal.label}</strong>
            </span>
            <span className={styles.goalToGo}>
              {goal.achieved || toGo === 0
                ? 'Reached'
                : toGo != null
                  ? `${fmt(toGo)} RS to go`
                  : 'Target unavailable'}
            </span>
          </div>
          <div
            className={styles.bar}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to ${goal.label}`}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {cutoff != null && (
        <p className={styles.cutoff}>
          Top 500 cutoff <span>{fmt(cutoff)} RS</span>
        </p>
      )}
    </section>
  )
}
