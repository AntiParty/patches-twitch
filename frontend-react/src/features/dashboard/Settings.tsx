/*
 * Settings tab: link THE FINALS player id + danger-zone disconnect.
 * Ported from the legacy settings view + account-linking JS.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { dashboardApi } from '@/api/dashboard'
import { useProfile, PROFILE_KEY } from './hooks'
import styles from './Settings.module.css'

export function Settings() {
  const { data: profile } = useProfile()
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [playerId, setPlayerId] = useState('')
  useEffect(() => {
    if (profile?.playerId) setPlayerId(profile.playerId)
  }, [profile?.playerId])

  const link = useMutation({
    mutationFn: (id: string) => dashboardApi.linkAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })

  const disconnect = useMutation({ mutationFn: dashboardApi.disconnectBot })

  const handleLink = async () => {
    if (!playerId.trim()) return
    try {
      await link.mutateAsync(playerId.trim())
      toast.success('Account linked!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to link account')
    }
  }

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Bot',
      body: 'Are you sure? This will remove the bot from your channel, delete your custom commands, and cancel your session.',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    try {
      await disconnect.mutateAsync()
      toast.success('Disconnected successfully.')
      setTimeout(() => {
        window.location.href = '/'
      }, 1000)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to disconnect')
    }
  }

  return (
    <>
      <PageHeader title="Settings" />

      <div className={styles.grid}>
        <Card title="Game Account">
          <Field label="Player ID (Embark ID)">
            <div className={styles.inlineForm}>
              <Input
                value={playerId}
                placeholder="Name#1234"
                onChange={(e) => setPlayerId(e.target.value)}
              />
              <Button onClick={handleLink} loading={link.isPending}>
                Save
              </Button>
            </div>
          </Field>
          <div className={styles.why}>
            <h3>
              <i className="fas fa-info-circle" /> Why link?
            </h3>
            <p>
              Linking your account lets the bot fetch your real-time stats without you needing to
              type your name every time.
            </p>
          </div>
        </Card>

        <Card className={styles.danger}>
          <div className="card-title" style={{ marginBottom: 20 }}>
            <span className={styles.dangerTitle}>Danger Zone</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
            Disconnecting will remove the bot from your channel, delete your custom commands, and
            cancel your session.
          </p>
          <Button variant="danger" fullWidth loading={disconnect.isPending} onClick={handleDisconnect}>
            Disconnect Bot
          </Button>
        </Card>
      </div>
    </>
  )
}
