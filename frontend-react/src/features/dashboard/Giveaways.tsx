/*
 * Giveaways tab. Streamer creates a giveaway (chat/ticket type in Phase 1,
 * channel-point redeem added in Phase 2), watches entrants come in, and draws
 * a winner — announced in chat by the backend. Viewers enter with !enter.
 */
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { Table, type Column } from '@/components/tables/Table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { giveawaysApi } from '@/api/giveaways'
import type { GiveawayEntrant } from '@/types/giveaway'

const CURRENT_KEY = ['giveaways', 'current'] as const

export function Giveaways() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const currentQuery = useQuery({ queryKey: CURRENT_KEY, queryFn: giveawaysApi.getCurrent })
  const giveaway = currentQuery.data?.giveaway ?? null
  const perUser = currentQuery.data?.perUser ?? []
  const total = currentQuery.data?.total ?? 0

  const [type, setType] = useState<'ticket' | 'redeem'>('ticket')
  const [prize, setPrize] = useState('')
  const [maxTickets, setMaxTickets] = useState(1)

  const invalidate = () => qc.invalidateQueries({ queryKey: CURRENT_KEY })

  const create = useMutation({ mutationFn: giveawaysApi.create, onSuccess: invalidate })
  const draw = useMutation({ mutationFn: giveawaysApi.draw, onSuccess: invalidate })
  const redraw = useMutation({ mutationFn: giveawaysApi.redraw, onSuccess: invalidate })
  const close = useMutation({ mutationFn: giveawaysApi.close, onSuccess: invalidate })

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await create.mutateAsync({ prize: prize.trim(), maxTicketsPerUser: maxTickets })
      toast.success('Giveaway started! Viewers can now type !enter.')
      setPrize('')
      setMaxTickets(1)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start giveaway.')
    }
  }

  const handleDraw = async () => {
    const ok = await confirm({ title: 'Draw a winner', body: 'Pick a random winner now? This announces in chat.', confirmLabel: 'Draw' })
    if (!ok) return
    try {
      const res = await draw.mutateAsync()
      toast.success(`Winner: @${res.winner.username} (slot #${res.winner.slot} of ${res.winner.total})`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to draw a winner.')
    }
  }

  const handleRedraw = async () => {
    const ok = await confirm({ title: 'Redraw', body: 'Draw a new winner, excluding the previous one?', confirmLabel: 'Redraw' })
    if (!ok) return
    try {
      const res = await redraw.mutateAsync(true)
      toast.success(`New winner: @${res.winner.username} (slot #${res.winner.slot} of ${res.winner.total})`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to redraw.')
    }
  }

  const handleClose = async () => {
    const ok = await confirm({ title: 'Close giveaway', body: 'Close this giveaway? Viewers can no longer enter.', confirmLabel: 'Close', danger: true })
    if (!ok) return
    try {
      await close.mutateAsync()
      toast.success('Giveaway closed.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to close giveaway.')
    }
  }

  const entrantColumns: Column<GiveawayEntrant>[] = [
    { key: 'username', header: 'Viewer', accessor: (r) => r.username },
    { key: 'count', header: 'Tickets', align: 'right', accessor: (r) => r.count },
  ]

  return (
    <>
      <PageHeader
        title="Giveaways"
        subtitle="Run a chat or channel-point giveaway and draw a random winner without leaving the dashboard."
        actions={
          <Button variant="ghost" icon="fas fa-sync" onClick={invalidate}>
            Refresh
          </Button>
        }
      />

      {!giveaway ? (
        <Card>
          <div className="card-title" style={{ fontWeight: 800, marginBottom: 4 }}>Start a giveaway</div>
          <div style={{ color: 'var(--text-muted, #888)', marginBottom: 16 }}>
            Pick the entry method, then draw a random winner whenever you're ready.
          </div>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="Entry method">
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'ticket' | 'redeem')}
                  options={[
                    { label: 'Chat — viewers type !enter', value: 'ticket' },
                    { label: 'Channel points (coming soon)', value: 'redeem', disabled: true },
                  ]}
                />
              </Field>
              <Field label="Prize">
                <Input value={prize} maxLength={120} placeholder="e.g. Steam key" required onChange={(e) => setPrize(e.target.value)} />
              </Field>
              <Field label="Max tickets per viewer" hint="How many times each viewer can !enter.">
                <Input type="number" min={1} max={1000} value={maxTickets} required onChange={(e) => setMaxTickets(Number(e.target.value))} />
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>
              <Button type="submit" icon="fas fa-gift" loading={create.isPending}>Start giveaway</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="card-title" style={{ fontWeight: 800 }}>
                {giveaway.prize ? `🎁 ${giveaway.prize}` : 'Giveaway'}
              </div>
              <div style={{ color: 'var(--text-muted, #888)', marginTop: 4 }}>
                {giveaway.type === 'ticket'
                  ? `Viewers type !enter (up to ${giveaway.maxTicketsPerUser} ticket${giveaway.maxTicketsPerUser === 1 ? '' : 's'} each).`
                  : 'Viewers redeem the channel-point reward to enter.'}
                {' '}{total} entr{total === 1 ? 'y' : 'ies'} from {perUser.length} {perUser.length === 1 ? 'person' : 'people'}.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button icon="fas fa-dice" loading={draw.isPending} onClick={handleDraw} disabled={total === 0}>Draw winner</Button>
              {giveaway.status === 'drawn' && (
                <Button variant="ghost" icon="fas fa-rotate" loading={redraw.isPending} onClick={handleRedraw}>Redraw</Button>
              )}
              <Button variant="danger" icon="fas fa-xmark" loading={close.isPending} onClick={handleClose}>Close</Button>
            </div>
          </div>

          {giveaway.status === 'drawn' && giveaway.winnerUsername && (
            <div
              style={{
                marginTop: 16,
                padding: '14px 16px',
                borderRadius: 10,
                background: 'var(--success-bg, rgba(34,197,94,0.12))',
                border: '1px solid var(--success-border, rgba(34,197,94,0.4))',
                fontWeight: 700,
              }}
            >
              🎉 Winner: @{giveaway.winnerUsername}
              {giveaway.winnerSlot != null && ` — slot #${giveaway.winnerSlot} of ${total}`}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            {perUser.length === 0 ? (
              <EmptyState icon="fas fa-ticket" title="No entries yet" description="Entries appear here as viewers join." />
            ) : (
              <Table columns={entrantColumns} data={perUser} rowKey={(r) => r.userId} emptyMessage="No entries yet" />
            )}
          </div>
        </Card>
      )}
    </>
  )
}
