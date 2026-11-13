/* Admin → Channels. Read-only, searchable list of configured channels. */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import { channelSummary, filterChannels, type ChannelFilter } from './adminFormat'
import styles from './admin.module.css'

const FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Bot enabled' },
  { value: 'disabled', label: 'Bot disabled' },
  { value: 'banned', label: 'Banned' },
]

export function Channels() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ChannelFilter>('all')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'channels'],
    queryFn: adminApi.getChannels,
  })

  const all = useMemo(() => data?.channels ?? [], [data])
  const summary = useMemo(() => channelSummary(all), [all])
  const rows = useMemo(() => filterChannels(all, search, filter), [all, search, filter])

  return (
    <>
      <PageHeader
        title="Channels"
        subtitle={data ? `${summary.total} channels · ${summary.enabled} with bot enabled · ${summary.banned} banned` : 'Configured channels and their current state.'}
      />

      {isLoading ? (
        <div className={styles.centered}><Spinner /></div>
      ) : isError ? (
        <ErrorState message="Failed to load channels." onRetry={() => refetch()} />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <SearchBar value={search} onChange={setSearch} placeholder="Search channels…" />
            </div>
            <div className={styles.filterGroup} role="group" aria-label="Filter channels">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filter === f.value}
                  className={`${styles.filterChip} ${filter === f.value ? styles.filterChipActive : ''}`}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className={styles.count}>{rows.length} shown</span>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon="fas fa-tv" title="No channels match" description="Try a different search or filter." />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Role</th>
                    <th>Bot</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className={styles.username}>{c.username}</td>
                      <td>{c.role || 'Basic user'}</td>
                      <td>
                        <span className={`${styles.dot} ${c.botEnabled ? styles.dotOn : ''}`}>
                          {c.botEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td>
                        {c.banned ? (
                          <span className={`${styles.dot} ${styles.dotBan}`}>Banned</span>
                        ) : (
                          <span className={styles.statusActive}>Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
