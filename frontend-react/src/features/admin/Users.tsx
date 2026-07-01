/*
 * Admin → Users. Search, change role, ban/unban, grant/revoke subscription.
 * Ported from the legacy admin users view. Admin-role gated (route guard).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { SearchBar } from '@/components/forms/SearchBar'
import { Button } from '@/components/buttons/Button'
import { Badge } from '@/components/data-display/Badge'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { adminApi } from '@/api/admin'
import { ADMIN_ROLES, type AdminUser } from '@/types/admin'
import styles from './admin.module.css'

const USERS_KEY = ['admin', 'users'] as const

export function Users() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => adminApi.getUsers(),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: USERS_KEY })
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Action failed')

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => adminApi.setRole(id, role),
    onSuccess: () => { toast.success('Role updated'); invalidate() },
    onError,
  })
  const ban = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => adminApi.banUser(id, reason),
    onSuccess: () => { toast.success('User banned'); invalidate() },
    onError,
  })
  const unban = useMutation({
    mutationFn: (id: number) => adminApi.unbanUser(id),
    onSuccess: () => { toast.success('User unbanned'); invalidate() },
    onError,
  })
  const grantSub = useMutation({
    mutationFn: (id: number) => adminApi.grantSubscription(id),
    onSuccess: () => { toast.success('Subscription granted'); invalidate() },
    onError,
  })
  const revokeSub = useMutation({
    mutationFn: (id: number) => adminApi.revokeSubscription(id),
    onSuccess: () => { toast.success('Subscription revoked'); invalidate() },
    onError,
  })

  const handleBan = async (u: AdminUser) => {
    const ok = await confirm({ title: `Ban ${u.username}`, body: 'This stops their bot and blocks access. Continue?', confirmLabel: 'Ban', danger: true })
    if (ok) ban.mutate({ id: u.id, reason: 'Banned by admin' })
  }

  const filtered = (data?.users ?? []).filter((u) => !search || u.username.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <PageHeader title="Users" subtitle="Manage roles, bans, and subscription access." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search username…" />
        </div>
        {data && <span className={styles.count}>{filtered.length} users</span>}
      </div>

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}><Spinner /></div>
      ) : isError ? (
        <ErrorState message="Failed to load users." onRetry={() => refetch()} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Premium</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className={styles.username}>{u.username}</td>
                  <td>
                    <select
                      className={styles.roleSelect}
                      value={ADMIN_ROLES.includes(u.role as never) ? u.role : 'Basic user'}
                      onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}
                    >
                      {ADMIN_ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {u.hasSubscription ? (
                      <Badge variant="warning" icon="fas fa-crown">{u.subscriptionTier || 'Premium'}</Badge>
                    ) : (
                      <span style={{ color: 'var(--text-subtle)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {u.banned ? (
                      <span className={`${styles.dot} ${styles.dotBan}`} title={u.banReason || ''}>Banned</span>
                    ) : (
                      <span className={`${styles.dot} ${u.botEnabled ? styles.dotOn : ''}`}>{u.botEnabled ? 'Bot on' : 'Bot off'}</span>
                    )}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {u.hasSubscription ? (
                        <Button variant="ghost" size="sm" onClick={() => revokeSub.mutate(u.id)}>Revoke sub</Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => grantSub.mutate(u.id)}>Grant sub</Button>
                      )}
                      {u.banned ? (
                        <Button size="sm" onClick={() => unban.mutate(u.id)}>Unban</Button>
                      ) : (
                        <Button variant="danger" size="sm" onClick={() => handleBan(u)}>Ban</Button>
                      )}
                    </div>
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
