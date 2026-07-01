/* Admin → Channels. Read-only list of configured channels. */
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { adminApi } from '@/api/admin'
import styles from './admin.module.css'

export function Channels() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'channels'],
    queryFn: adminApi.getChannels,
  })

  return (
    <>
      <PageHeader title="Channels" subtitle="Configured channels and their current state." />

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}><Spinner /></div>
      ) : isError ? (
        <ErrorState message="Failed to load channels." onRetry={() => refetch()} />
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
              {(data?.channels ?? []).map((c) => (
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
                      <span style={{ color: 'var(--text-subtle)' }}>Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
