/*
 * Custom Bot / Subscription tab. Premium status + refresh, custom-bot link/
 * unlink/copy-auth-url, setup guide. Ported from the legacy custom-bot view.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/api/errors'
import { subscriptionApi } from '@/api/subscription'
import styles from './CustomBot.module.css'

export function CustomBot() {
  const { role, hasRoleBypass } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()

  const statusQuery = useQuery({ queryKey: ['subscription', 'status'], queryFn: subscriptionApi.getStatus })
  const sub = statusQuery.data
  const hasSubscription = sub?.hasSubscription ?? false
  const hasTwitchSub = hasSubscription && !hasRoleBypass

  const refresh = useMutation({ mutationFn: subscriptionApi.refresh })
  const handleRefresh = async () => {
    try {
      const data = await refresh.mutateAsync()
      if (data.needsReauth) {
        toast.info('Re-authorizing with Twitch…')
        window.location.href = data.reauthUrl || '/reauth'
        return
      }
      toast.success(data.message || 'Status refreshed')
      statusQuery.refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to refresh status')
    }
  }

  const copyAuthUrl = async () => {
    try {
      const { url } = await subscriptionApi.getCustomBotAuthUrl()
      await navigator.clipboard.writeText(url)
      toast.success('Link copied! Open it where your bot account is logged in.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to get link')
    }
  }

  const unlink = useMutation({ mutationFn: subscriptionApi.unlinkBot })
  const handleUnlink = async () => {
    const ok = await confirm({
      title: 'Unlink custom bot',
      body: 'The bot will revert to using the default account. Continue?',
      confirmLabel: 'Unlink',
      danger: true,
    })
    if (!ok) return
    try {
      await unlink.mutateAsync()
      toast.success('Custom bot unlinked.')
      statusQuery.refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to unlink bot')
    }
  }

  const customBot = sub?.customBot

  return (
    <>
      <PageHeader title="Custom Bot" />

      <div className={styles.grid}>
        {/* Premium status */}
        <Card title="Premium Status">
          {hasSubscription ? (
            <>
              <div className={styles.statusInfo}>
                <div className={styles.statusItem}>
                  <span className="label">Status:</span>
                  <span style={{ color: 'var(--success)' }}>Active</span>
                </div>
                {hasTwitchSub ? (
                  <>
                    <div className={styles.statusItem}>
                      <span className="label">Source:</span>
                      <span style={{ color: '#9146ff' }}>Twitch Subscription</span>
                    </div>
                    <div className={styles.statusItem}>
                      <span className="label">Tier:</span>
                      <span>{sub?.tierName ?? '—'}</span>
                    </div>
                  </>
                ) : (
                  <div className={styles.statusItem}>
                    <span className="label">Source:</span>
                    <span style={{ color: 'var(--warning)' }}>Role Access ({role})</span>
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                icon="fas fa-sync"
                style={{ marginTop: 16 }}
                loading={refresh.isPending}
                onClick={handleRefresh}
              >
                Refresh Status
              </Button>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)' }}>No active premium access.</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                Subscribe to antiparty on Twitch to unlock premium features!
              </p>
              <a className="btn btn-primary" style={{ marginTop: 16 }} href="/subscribe">
                Get Premium
              </a>
            </>
          )}
        </Card>

        {/* Custom bot */}
        <Card title="Custom Bot Account">
          {customBot ? (
            <>
              <div className={styles.botInfo}>
                <div className={styles.botAvatar}>🤖</div>
                <div className={styles.botDetails}>
                  <h3>{customBot.username}</h3>
                  <p className={styles.botStatus}>
                    <span className={`${styles.dot} ${customBot.isActive ? styles.dotActive : styles.dotInactive}`} />
                    {customBot.isActive ? 'Active' : 'Inactive'}
                  </p>
                </div>
              </div>
              <div className={styles.botActions}>
                <Button variant="danger" loading={unlink.isPending} onClick={handleUnlink}>
                  Unlink Bot
                </Button>
                <a href="/link-custom-bot" className="btn btn-primary">
                  Link Different Bot
                </a>
              </div>
            </>
          ) : hasSubscription ? (
            <>
              <p style={{ color: 'var(--text-muted)' }}>No custom bot linked yet.</p>
              <div className={styles.linkRow}>
                <a href="/link-custom-bot" className="btn btn-primary">
                  Link Custom Bot
                </a>
                <Button variant="ghost" icon="fas fa-copy" onClick={copyAuthUrl} title="Copy auth link" />
              </div>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)' }}>No custom bot linked yet.</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                Subscribe to antiparty on Twitch to link a custom bot.
              </p>
              <a href="/subscribe" className="btn btn-primary" style={{ marginTop: 8 }}>
                Get Premium
              </a>
            </>
          )}
        </Card>
      </div>

      {/* Setup guide */}
      <Card title="How to Set Up Your Custom Bot" style={{ marginTop: 18 }}>
        <ol className={styles.steps}>
          <li>
            <strong>Create a Twitch Account</strong>
            <p>Create a new Twitch account with your desired bot name (e.g. "YourNameBot").</p>
          </li>
          <li>
            <strong>Link Your Bot</strong>
            <p>
              Click "Link Custom Bot" above. Tip: use the copy button if you need to open the link
              in an incognito window or another browser where your bot account is logged in.
            </p>
          </li>
          <li>
            <strong>You're Done!</strong>
            <p>Your bot will now respond in your chat using your custom account.</p>
          </li>
        </ol>
      </Card>
    </>
  )
}
