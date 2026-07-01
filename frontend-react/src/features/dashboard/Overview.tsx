/*
 * Dashboard Overview tab. Ported from the legacy overview view: status strip
 * with bot toggle, metric cards, latest updates + docs CTA.
 */
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Skeleton } from '@/components/feedback/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useToast } from '@/hooks/useToast'
import { ApiError } from '@/api/errors'
import { useProfile, useToggleBot } from './hooks'
import styles from './Overview.module.css'

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
      subtitle={`Manage the bot, ranked commands, overlays, and channel setup${profile ? ` for ${profile.username}` : ''}.`}
      actions={
        <a className="btn btn-ghost" href="/">
          <i className="fas fa-external-link-alt" /> Home Page
        </a>
      }
    />
  )

  if (isLoading) {
    return (
      <>
        {header}
        <Skeleton height={70} radius={8} />
        <div style={{ marginTop: 18 }}>
          <Skeleton height={132} lines={1} />
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

      {/* Status strip */}
      <section className={styles.strip} aria-label="Dashboard status overview">
        <div className={styles.stripMain}>
          <div className={`${styles.stripIcon} ${botOn ? '' : styles.offline}`}>
            <i className={`fas ${botOn ? 'fa-signal' : 'fa-pause'}`} />
          </div>
          <div>
            <h3 className={styles.stripTitle}>{botOn ? 'Bot is live' : 'Bot is offline'}</h3>
            <p className={styles.stripCopy}>
              {botOn
                ? `Rank commands are available in chat for ${profile.username}.`
                : 'Turn the bot on when you are ready for chat commands.'}
            </p>
          </div>
        </div>
        <div className={styles.stripActions}>
          <div className={`${styles.pill} ${botOn ? styles.good : styles.warning}`}>
            {botOn ? 'Connected' : 'Offline'} <strong>{botOn ? 'Live' : 'Off'}</strong>
          </div>
          <div className={`${styles.pill} ${profile.playerId ? styles.good : styles.warning}`}>
            IGN <strong>{profile.playerId ? 'Linked' : 'Needed'}</strong>
          </div>
          <Button
            variant={botOn ? 'danger' : 'primary'}
            size="sm"
            icon={botOn ? 'fas fa-power-off' : 'fas fa-play'}
            loading={toggle.isPending}
            onClick={handleToggle}
          >
            {botOn ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </section>

      {/* Metric cards */}
      <div className={styles.metrics}>
        <Card title="Bot Status" headerActions={<i className="fas fa-robot" style={{ color: 'var(--text-muted)' }} />}>
          <div className={styles.metricValue}>
            {botOn ? 'Active' : 'Inactive'}
            <span className={`${styles.indicator} ${botOn ? styles.indicatorOn : styles.indicatorOff}`} />
          </div>
          <p className="card-subtitle" style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            {botOn ? 'Connected to chat' : 'Bot is currently offline'}
          </p>
          <Button
            variant={botOn ? 'danger' : 'primary'}
            fullWidth
            loading={toggle.isPending}
            icon={botOn ? 'fas fa-power-off' : 'fas fa-play'}
            onClick={handleToggle}
            style={{ marginTop: 20 }}
          >
            {botOn ? 'Turn Off' : 'Turn On'}
          </Button>
        </Card>

        <Card title="Linked Account" headerActions={<i className="fas fa-link" style={{ color: 'var(--text-muted)' }} />}>
          {profile.playerId ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 600, wordBreak: 'break-all' }}>{profile.playerId}</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>Tracking stats</p>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: 10 }}>No Account Linked</div>
              <Link className="btn btn-primary btn-sm" to="/dashboard/settings">
                Link Now
              </Link>
            </>
          )}
        </Card>

        <Card title="Commands" headerActions={<i className="fas fa-terminal" style={{ color: 'var(--text-muted)' }} />}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            3 <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>active</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>Customizable responses</p>
        </Card>
      </div>

      {/* Updates + docs CTA */}
      <div className={styles.split}>
        <Card title="Latest Updates">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className={styles.updateItem}>
              <div className={styles.updateTag} style={{ color: 'var(--primary)' }}>NEW</div>
              <h3>Rank Tracker Beta</h3>
              <p>Set a goal and track your progress visually.</p>
            </div>
            <div className={styles.updateItem}>
              <div className={styles.updateTag} style={{ color: 'var(--text-muted)' }}>COMING SOON</div>
              <h3>Twitch Drops</h3>
              <p>Auto-post drop links in chat.</p>
            </div>
          </div>
        </Card>

        <Card className={styles.ctaCard}>
          <div className={styles.ctaIcon}>
            <i className="fas fa-rocket" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Want to change commands?</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 300, margin: 0 }}>
            Check out the documentation to learn about advanced commands and features.
          </p>
          <a className="btn btn-ghost" href="/docs" target="_blank" rel="noreferrer">
            View Documentation
          </a>
        </Card>
      </div>
    </>
  )
}
