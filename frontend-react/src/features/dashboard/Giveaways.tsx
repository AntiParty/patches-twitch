/*
 * Giveaways tab. Streamer creates a giveaway (chat/ticket type in Phase 1,
 * channel-point redeem added in Phase 2), watches entrants come in, and draws
 * a winner — announced in chat by the backend. Viewers enter with !enter.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
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
  const redeemScope = currentQuery.data?.redeemScope ?? false

  const [type, setType] = useState<'ticket' | 'redeem'>('ticket')
  const [prize, setPrize] = useState('')
  const [maxTickets, setMaxTickets] = useState(1)
  const [cost, setCost] = useState(500)
  const [rewardColor, setRewardColor] = useState('#9147ff')
  const [rewardPrompt, setRewardPrompt] = useState('')

  // Optional on-stream roll animation (streamer shows the dashboard). Persisted.
  const [showRoll, setShowRoll] = useState(() => localStorage.getItem('giveawayShowRoll') !== 'off')
  const [roll, setRoll] = useState<{ names: string[]; winner: string; slot: number; total: number } | null>(null)
  useEffect(() => {
    localStorage.setItem('giveawayShowRoll', showRoll ? 'on' : 'off')
  }, [showRoll])

  const invalidate = () => qc.invalidateQueries({ queryKey: CURRENT_KEY })

  const create = useMutation({ mutationFn: giveawaysApi.create, onSuccess: invalidate })
  const redeemStart = useMutation({ mutationFn: giveawaysApi.redeemStart, onSuccess: invalidate })
  const draw = useMutation({ mutationFn: giveawaysApi.draw, onSuccess: invalidate })
  const redraw = useMutation({ mutationFn: giveawaysApi.redraw, onSuccess: invalidate })
  const announce = useMutation({ mutationFn: giveawaysApi.announce })
  const close = useMutation({ mutationFn: giveawaysApi.close, onSuccess: invalidate })
  const redeemClose = useMutation({ mutationFn: giveawaysApi.redeemClose, onSuccess: invalidate })
  const pause = useMutation({ mutationFn: giveawaysApi.pause, onSuccess: invalidate })
  const resume = useMutation({ mutationFn: giveawaysApi.resume, onSuccess: invalidate })
  const reset = useMutation({ mutationFn: giveawaysApi.reset, onSuccess: invalidate })

  const namePool = perUser.map((p) => p.username)

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (type === 'redeem') {
        await redeemStart.mutateAsync({
          prize: prize.trim(),
          cost,
          prompt: rewardPrompt.trim(),
          backgroundColor: rewardColor,
        })
        toast.success('Channel-point giveaway started! The reward is now live.')
      } else {
        await create.mutateAsync({ prize: prize.trim(), maxTicketsPerUser: maxTickets })
        toast.success('Giveaway started! Viewers can now type !enter.')
      }
      setPrize('')
      setMaxTickets(1)
      setCost(500)
      setRewardPrompt('')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start giveaway.')
    }
  }

  // Post the winner to chat. Fired only after the roll animation finishes (or
  // immediately when the roll is off) so chat never spoils the reveal.
  const finishReveal = async (winner: { username: string; slot: number; total: number }) => {
    try {
      await announce.mutateAsync()
    } catch {
      /* announcement is best-effort; the winner is already recorded */
    }
    toast.success(`Winner: @${winner.username} (slot #${winner.slot} of ${winner.total})`)
  }

  const revealWinner = async (winner: { username: string; slot: number; total: number }) => {
    if (showRoll && namePool.length > 0) {
      setRoll({ names: namePool, winner: winner.username, slot: winner.slot, total: winner.total })
    } else {
      await finishReveal(winner)
    }
  }

  const handleDraw = async () => {
    const ok = await confirm({ title: 'Draw a winner', body: 'Pick a random winner now? This announces in chat.', confirmLabel: 'Draw' })
    if (!ok) return
    try {
      const res = await draw.mutateAsync()
      revealWinner(res.winner)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to draw a winner.')
    }
  }

  const handleRedraw = async () => {
    const ok = await confirm({ title: 'Redraw', body: 'Draw a new winner, excluding the previous one?', confirmLabel: 'Redraw' })
    if (!ok) return
    try {
      const res = await redraw.mutateAsync(true)
      revealWinner(res.winner)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to redraw.')
    }
  }

  const handlePauseToggle = async () => {
    try {
      if (giveaway?.status === 'paused') {
        await resume.mutateAsync()
        toast.success('Giveaway resumed — entries are open again.')
      } else {
        await pause.mutateAsync()
        toast.success('Giveaway paused — new entries are blocked.')
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update the giveaway.')
    }
  }

  const handleConfirmClear = async () => {
    const ok = await confirm({
      title: 'Confirm winner accepted',
      body: 'Clear all entries and start a fresh round? Do this once the winner has accepted their prize.',
      confirmLabel: 'Confirm & clear',
      danger: true,
    })
    if (!ok) return
    try {
      await reset.mutateAsync()
      toast.success('Entries cleared — the giveaway is open for another round.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to clear entries.')
    }
  }

  const handleClose = async () => {
    const ok = await confirm({ title: 'Close giveaway', body: 'Close this giveaway? Viewers can no longer enter.', confirmLabel: 'Close', danger: true })
    if (!ok) return
    try {
      if (giveaway?.type === 'redeem') {
        await redeemClose.mutateAsync()
      } else {
        await close.mutateAsync()
      }
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
                    { label: 'Channel points — viewers redeem', value: 'redeem' },
                  ]}
                />
              </Field>
              <Field label={type === 'redeem' ? 'Reward name / prize' : 'Prize'} hint={type === 'redeem' ? 'Shown on the channel-point button.' : undefined}>
                <Input value={prize} maxLength={type === 'redeem' ? 45 : 120} placeholder="e.g. Steam key" required onChange={(e) => setPrize(e.target.value)} />
              </Field>
              {type === 'ticket' ? (
                <Field label="Max tickets per viewer" hint="How many times each viewer can !enter.">
                  <Input type="number" min={1} max={1000} value={maxTickets} required onChange={(e) => setMaxTickets(Number(e.target.value))} />
                </Field>
              ) : (
                <Field label="Point cost per entry" hint="Viewers can redeem repeatedly to stack entries.">
                  <Input type="number" min={1} max={1000000} value={cost} required onChange={(e) => setCost(Number(e.target.value))} />
                </Field>
              )}
            </div>

            {type === 'redeem' && (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 12 }}>
                <Field label="Button color" hint="The reward's color on Twitch.">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="color"
                      value={rewardColor}
                      onChange={(e) => setRewardColor(e.target.value)}
                      style={{ width: 44, height: 38, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                      aria-label="Reward button color"
                    />
                    <span style={{ color: 'var(--text-muted, #888)', fontFamily: 'monospace' }}>{rewardColor}</span>
                  </div>
                </Field>
                <Field label="Prompt (optional)" hint="Description viewers see under the reward.">
                  <Input value={rewardPrompt} maxLength={200} placeholder="Redeem to enter the giveaway!" onChange={(e) => setRewardPrompt(e.target.value)} />
                </Field>
              </div>
            )}

            {type === 'redeem' && !redeemScope ? (
              <div
                style={{
                  marginTop: 16,
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: 'var(--warning-bg, rgba(234,179,8,0.12))',
                  border: '1px solid var(--warning-border, rgba(234,179,8,0.4))',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Reauthorization required</div>
                <div style={{ color: 'var(--text-muted, #888)', marginBottom: 10 }}>
                  Channel-point giveaways need permission to create and manage your reward. Approve it once to enable them.
                </div>
                <a className="btn btn-primary" href="/reauth">Reauthorize with Twitch</a>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <Button type="submit" icon="fas fa-gift" loading={create.isPending || redeemStart.isPending}>
                  Start giveaway
                </Button>
              </div>
            )}
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
                {giveaway.status === 'paused' && <strong style={{ color: 'var(--warning, #eab308)' }}>⏸️ Paused · </strong>}
                {giveaway.type === 'ticket'
                  ? `Viewers type !enter (up to ${giveaway.maxTicketsPerUser} ticket${giveaway.maxTicketsPerUser === 1 ? '' : 's'} each).`
                  : 'Viewers redeem the channel-point reward to enter.'}
                {' '}{total} entr{total === 1 ? 'y' : 'ies'} from {perUser.length} {perUser.length === 1 ? 'person' : 'people'}.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(giveaway.status === 'open' || giveaway.status === 'paused') && (
                <Button
                  variant="ghost"
                  icon={giveaway.status === 'paused' ? 'fas fa-play' : 'fas fa-pause'}
                  loading={pause.isPending || resume.isPending}
                  onClick={handlePauseToggle}
                >
                  {giveaway.status === 'paused' ? 'Resume' : 'Pause'}
                </Button>
              )}
              <Button icon="fas fa-dice" loading={draw.isPending} onClick={handleDraw} disabled={total === 0}>Draw winner</Button>
              {giveaway.status === 'drawn' && (
                <Button variant="ghost" icon="fas fa-rotate" loading={redraw.isPending} onClick={handleRedraw}>Redraw</Button>
              )}
              {giveaway.type === 'redeem' && giveaway.status === 'drawn' && (
                <Button icon="fas fa-check" loading={reset.isPending} onClick={handleConfirmClear}>Confirm & clear</Button>
              )}
              <Button variant="danger" icon="fas fa-xmark" loading={close.isPending || redeemClose.isPending} onClick={handleClose}>Close</Button>
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: 14 }}>
            <input type="checkbox" checked={showRoll} onChange={(e) => setShowRoll(e.target.checked)} />
            Show roll animation when drawing (for on-stream reveals)
          </label>

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

      {roll && (
        <RollModal
          names={roll.names}
          winner={roll.winner}
          slot={roll.slot}
          total={roll.total}
          onRevealed={() => finishReveal({ username: roll.winner, slot: roll.slot, total: roll.total })}
          onClose={() => setRoll(null)}
        />
      )}
    </>
  )
}

/**
 * Full-screen slot-machine reveal. Cycles entrant names with easing deceleration,
 * then locks onto the winner. Meant to be shown on stream (streamer shares the tab).
 */
function RollModal({
  names,
  winner,
  slot,
  total,
  onRevealed,
  onClose,
}: {
  names: string[]
  winner: string
  slot: number
  total: number
  onRevealed: () => void
  onClose: () => void
}) {
  const [current, setCurrent] = useState(names[0] ?? winner)
  const [done, setDone] = useState(false)
  const timer = useRef<number | null>(null)
  const revealedRef = useRef(false)

  useEffect(() => {
    const pool = names.length > 1 ? names : [winner]
    let i = 0
    let delay = 60
    const totalMs = 3200
    const start = Date.now()

    const tick = () => {
      const elapsed = Date.now() - start
      if (elapsed >= totalMs) {
        setCurrent(winner)
        setDone(true)
        // Fire the chat announcement exactly once, when the reveal lands.
        if (!revealedRef.current) {
          revealedRef.current = true
          onRevealed()
        }
        return
      }
      i = (i + 1) % pool.length
      setCurrent(pool[i])
      // Ease-out: slow the cycling as we approach the end.
      delay = 60 + Math.pow(elapsed / totalMs, 3) * 320
      timer.current = window.setTimeout(tick, delay)
    }
    timer.current = window.setTimeout(tick, delay)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, winner])

  return (
    <div
      onClick={done ? onClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.72)',
        cursor: done ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '48px 64px',
          borderRadius: 20,
          background: 'var(--surface, #14100f)',
          border: `2px solid ${done ? 'var(--success-border, rgba(34,197,94,0.6))' : 'var(--border, #33302f)'}`,
          minWidth: 420,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ textTransform: 'uppercase', letterSpacing: 2, fontSize: 13, color: 'var(--text-muted, #888)', marginBottom: 16 }}>
          {done ? '🎉 Winner' : 'Drawing…'}
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 900,
            lineHeight: 1.1,
            color: done ? 'var(--success, #22c55e)' : 'var(--text, #fff)',
            transform: done ? 'scale(1.06)' : 'none',
            transition: 'transform 0.3s ease, color 0.3s ease',
            wordBreak: 'break-word',
          }}
        >
          @{current}
        </div>
        {done && (
          <div style={{ marginTop: 16, color: 'var(--text-muted, #888)' }}>
            slot #{slot} of {total} · click anywhere to close
          </div>
        )}
      </div>
    </div>
  )
}
