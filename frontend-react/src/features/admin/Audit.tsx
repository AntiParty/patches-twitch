/* Admin → Audit. Recent administrative actions, grouped by day. */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/data-display/Badge'
import { adminApi } from '@/api/admin'
import type { AuditEvent } from '@/types/admin'
import {
  auditOutcomeOf,
  auditTimestamp,
  filterAudit,
  groupAuditByDay,
  humanizeAction,
  type AuditOutcomeFilter,
} from './adminFormat'
import styles from './admin.module.css'

const OUTCOMES: { value: AuditOutcomeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
]

function timeOf(e: AuditEvent): string {
  const ts = auditTimestamp(e)
  return ts ? new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'
}

export function Audit() {
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState<AuditOutcomeFilter>('all')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => adminApi.getAudit(100),
  })

  const events = useMemo(() => data?.events ?? [], [data])
  const filtered = useMemo(() => filterAudit(events, search, outcome), [events, search, outcome])
  const groups = useMemo(() => groupAuditByDay(filtered), [filtered])

  return (
    <>
      <PageHeader title="Audit Activity" subtitle="Recent administrative actions (no raw request bodies)." />

      {isLoading ? (
        <div className={styles.centered}><Spinner /></div>
      ) : isError ? (
        <ErrorState message="Failed to load audit events." onRetry={() => refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon="fas fa-shield-halved" title="No audit events" />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <SearchBar value={search} onChange={setSearch} placeholder="Search action, target or actor…" />
            </div>
            <div className={styles.filterGroup} role="group" aria-label="Filter by outcome">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={outcome === o.value}
                  className={`${styles.filterChip} ${outcome === o.value ? styles.filterChipActive : ''}`}
                  onClick={() => setOutcome(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className={styles.count}>{filtered.length} of {events.length} events</span>
          </div>

          {groups.length === 0 ? (
            <EmptyState icon="fas fa-shield-halved" title="No events match" description="Try a different search or outcome." />
          ) : (
            groups.map((g) => (
              <section key={g.key}>
                <h3 className={styles.dayHeading}>{g.label}</h3>
                <div className={styles.auditList}>
                  {g.events.map((e, i) => {
                    const o = auditOutcomeOf(e)
                    const role = e.actorRole || e.role
                    return (
                      <div className={styles.auditItem} key={`${auditTimestamp(e) ?? 'x'}-${e.action}-${i}`}>
                        <span className={styles.auditTime}>{timeOf(e)}</span>
                        <span>
                          <span className={styles.auditAction}>{humanizeAction(e.action)}</span>
                          {e.target && <span className={styles.auditMeta}> → {e.target}</span>}
                          {(e.actor || role) && (
                            <span className={styles.auditMeta}> · by {e.actor || 'system'}{role ? ` (${role})` : ''}</span>
                          )}
                        </span>
                        {e.outcome && <Badge variant={o === 'success' ? 'success' : 'danger'}>{e.outcome}</Badge>}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </>
  )
}
