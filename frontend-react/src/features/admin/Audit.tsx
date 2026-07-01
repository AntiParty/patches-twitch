/* Admin → Audit. Recent administrative actions. */
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/data-display/Badge'
import { adminApi } from '@/api/admin'
import type { AuditEvent } from '@/types/admin'
import styles from './admin.module.css'

function timeOf(e: AuditEvent): string {
  const ts = e.timestamp || e.createdAt
  return ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function Audit() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => adminApi.getAudit(100),
  })

  const events = data?.events ?? []

  return (
    <>
      <PageHeader title="Audit Activity" subtitle="Recent administrative actions (no raw request bodies)." />

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}><Spinner /></div>
      ) : isError ? (
        <ErrorState message="Failed to load audit events." onRetry={() => refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon="fas fa-shield-halved" title="No audit events" />
      ) : (
        <div className={styles.auditList}>
          {events.map((e, i) => (
            <div className={styles.auditItem} key={i}>
              <span className={styles.auditTime}>{timeOf(e)}</span>
              <span>
                <span className={styles.auditAction}>{e.action}</span>
                {e.target && <span className={styles.auditMeta}> → {e.target}</span>}
                {(e.actor || e.role || e.actorRole) && (
                  <span className={styles.auditMeta}> · by {e.actor || 'system'}{e.actorRole || e.role ? ` (${e.actorRole || e.role})` : ''}</span>
                )}
              </span>
              {e.outcome && (
                <Badge variant={e.outcome === 'success' ? 'success' : 'danger'}>{e.outcome}</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
