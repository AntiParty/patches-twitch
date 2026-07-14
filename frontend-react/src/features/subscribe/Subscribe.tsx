/*
 * Premium / subscribe page. Status card, features grid, subscribe CTA + refresh.
 * Ported from subscribe.ejs. Auth-gated (route wrapped in ProtectedRoute).
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/buttons/Button'
import { useToast } from '@/hooks/useToast'
import { ApiError } from '@/api/errors'
import { subscriptionApi } from '@/api/subscription'
import styles from './Subscribe.module.css'

const FEATURES = [
  { icon: 'fas fa-robot', title: 'Custom Bot Account', desc: 'Use your own Twitch account as the bot for personalized branding.' },
  { icon: 'fas fa-chart-line', title: '!predict Command', desc: 'Forecast future T500 cutoffs using historical trend analysis.' },
  { icon: 'fas fa-headset', title: 'Priority Support', desc: 'Get help faster with priority Discord support.' },
  { icon: 'fas fa-flask', title: 'Early Access', desc: "Try new features before they're released to everyone." },
]

export function Subscribe() {
  const toast = useToast()
  const statusQuery = useQuery({ queryKey: ['subscription', 'status'], queryFn: subscriptionApi.getStatus })
  const sub = statusQuery.data
  const active = sub?.hasSubscription ?? false

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

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>FinalsRS Premium</h1>
      <p className={styles.lede}>
        Unlock a custom bot account, predictive T500 cutoffs, priority support, and early access —
        by subscribing to antiparty on Twitch.
      </p>

      <div className={`${styles.statusCard} ${active ? styles.statusCardActive : ''}`}>
        <div className={`${styles.statusIcon} ${active ? styles.statusIconActive : ''}`}>
          <i className={active ? 'fas fa-check' : 'fas fa-lock'} />
        </div>
        {active ? (
          <>
            <div className={styles.statusTitle}>Premium Active</div>
            {sub?.tierName && <div className={styles.statusTier}>{sub.tierName}</div>}
            <div className={styles.statusSub}>Thanks for supporting FinalsRS!</div>
          </>
        ) : (
          <>
            <div className={styles.statusTitle}>Not Subscribed</div>
            <div className={styles.statusSub}>Subscribe to antiparty on Twitch to unlock premium.</div>
          </>
        )}
      </div>

      <div className={styles.featuresGrid}>
        {FEATURES.map((f) => (
          <div className={styles.featureCard} key={f.title}>
            <div className={styles.featureIcon}><i className={f.icon} /></div>
            <div className={styles.featureTitle}>{f.title}</div>
            <div className={styles.featureDesc}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div className={styles.cta}>
        {!active && (
          <a
            className={`btn btn-lg ${styles.btnTwitch}`}
            href="https://www.twitch.tv/subs/antiparty"
            target="_blank"
            rel="noreferrer"
          >
            <i className="fa-brands fa-twitch" /> Subscribe on Twitch
          </a>
        )}
        <Button variant="ghost" icon="fas fa-sync" loading={refresh.isPending} onClick={handleRefresh}>
          Refresh Status
        </Button>
        <p className={styles.help}>
          Need help?{' '}
          <a href="https://discord.com/invite/2UKzvzSEqA" target="_blank" rel="noreferrer">
            Join our Discord
          </a>
        </p>
      </div>
    </div>
  )
}
