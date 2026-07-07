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
  const redeemScope = currentQuery.data?.redeemScope ?? false

  const [type, setType] = useState<'ticket' | 'redeem'>('ticket')
  const [prize, setPrize] = useState('')
  const [cost, setCost] = useState(500)
  const [winnerCount, setWinnerCount] = useState(1)
  const [rewardColor, setRewardColor] = useState('#9147ff')
  const [rewardPrompt, setRewardPrompt] = useState('')

  // Inline edit of the live giveaway (prize; plus cost/prompt/color for redeem).
  const [editing, setEditing] = useState(false)
  const [editPrize, setEditPrize] = useState('')
  const [editCost, setEditCost] = useState(500)
  const [editWinnerCount, setEditWinnerCount] = useState(1)
  const [editPrompt, setEditPrompt] = useState('')
  const [editColor, setEditColor] = useState('#9147ff')
  const [editColorTouched, setEditColorTouched] = useState(false)

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
  const lock = useMutation({ mutationFn: giveawaysApi.lock, onSuccess: invalidate })
  const update = useMutation({ mutationFn: giveawaysApi.update, onSuccess: invalidate })

  // Winners already drawn this round, and the pool still eligible to win.
  const winners = giveaway?.winners ?? []
  const wonUserIds = new Set(winners.map((w) => w.userId))
  const target = giveaway?.targetWinnerCount ?? 0
  const eligiblePool = perUser.filter((p) => !wonUserIds.has(p.userId))
  const eligibleNames = eligiblePool.map((p) => p.username)
  // 0 = unlimited (chat); N>0 = fixed target (channel points).
  const canDrawMore = eligiblePool.length > 0 && (target === 0 || winners.length < target)
  // Chat giveaways must close entries before spinning; channel points can spin from the live pool.
  const canSpin =
    canDrawMore &&
    !!giveaway &&
    (giveaway.type === 'redeem'
      ? giveaway.status !== 'closed'
      : giveaway.status === 'locked' || giveaway.status === 'drawn')

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (type === 'redeem') {
        await redeemStart.mutateAsync({
          prize: prize.trim(),
          cost,
          winnerCount,
          prompt: rewardPrompt.trim(),
          backgroundColor: rewardColor,
        })
        toast.success('Channel-point giveaway started! The reward is now live.')
      } else {
        await create.mutateAsync({ prize: prize.trim() })
        toast.success('Giveaway started! Viewers can now type !enter.')
      }
      setPrize('')
      setCost(500)
      setWinnerCount(1)
      setRewardPrompt('')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start giveaway.')
    }
  }

  const openEdit = () => {
    if (!giveaway) return
    setEditPrize(giveaway.prize ?? '')
    setEditCost(giveaway.rewardCost ?? 500)
    setEditWinnerCount(giveaway.targetWinnerCount || 1)
    setEditPrompt('')
    setEditColorTouched(false)
    setEditing(true)
  }

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!giveaway) return
    try {
      await update.mutateAsync({
        prize: editPrize.trim(),
        ...(giveaway.type === 'redeem'
          ? {
              cost: editCost,
              winnerCount: editWinnerCount,
              // Blank prompt / untouched color mean "keep what the reward has".
              ...(editPrompt.trim() ? { prompt: editPrompt.trim() } : {}),
              ...(editColorTouched ? { backgroundColor: editColor } : {}),
            }
          : {}),
      })
      toast.success(giveaway.type === 'redeem' ? 'Reward updated on Twitch.' : 'Giveaway updated.')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update the giveaway.')
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

  // Spin the wheel over the still-eligible pool (prior winners excluded), then
  // announce once it lands. `pool` is captured before the draw so the wheel
  // matches the entrants who could still win.
  const revealWinner = async (winner: { username: string; slot: number; total: number }, pool: string[]) => {
    if (showRoll && pool.length > 0) {
      setRoll({ names: pool, winner: winner.username, slot: winner.slot, total: winner.total })
    } else {
      await finishReveal(winner)
    }
  }

  const handleDraw = async () => {
    const pool = eligibleNames
    try {
      const res = await draw.mutateAsync()
      await revealWinner(res.winner, pool)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to draw a winner.')
    }
  }

  const handleRedraw = async () => {
    const ok = await confirm({ title: 'Redraw last winner', body: "Replace the most recent winner (e.g. they didn't respond)? They won't be picked again.", confirmLabel: 'Redraw' })
    if (!ok) return
    // The eligible pool already excludes every current winner (including the one
    // being replaced), which is exactly who the redraw can land on.
    const pool = eligibleNames
    try {
      const res = await redraw.mutateAsync()
      await revealWinner(res.winner, pool)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to redraw.')
    }
  }

  const handleLock = async () => {
    const ok = await confirm({ title: 'Close entries', body: 'Stop new entries? You can still spin winners from everyone who entered.', confirmLabel: 'Close entries' })
    if (!ok) return
    try {
      await lock.mutateAsync()
      toast.success('Entries closed. Spin whenever you are ready.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to close entries.')
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
    const isRedeem = giveaway?.type === 'redeem'
    const ok = await confirm({
      title: 'End giveaway',
      body: isRedeem
        ? 'This ends the giveaway and removes the channel-point reward from your channel. Winners you already drew are kept.'
        : 'This ends the giveaway for good. Viewers can no longer enter.',
      confirmLabel: 'End giveaway',
      danger: true,
    })
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
    { key: 'count', header: 'Entries', align: 'right', accessor: (r) => r.count },
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
              <Field
                label={type === 'redeem' ? 'Reward name / prize' : 'Prize'}
                hint={type === 'redeem' ? 'Shown on the channel-point button.' : 'One entry per person — equal odds.'}
              >
                <Input value={prize} maxLength={type === 'redeem' ? 45 : 120} placeholder="e.g. Steam key" required onChange={(e) => setPrize(e.target.value)} />
              </Field>
              {type === 'redeem' && (
                <Field label="Point cost per entry" hint="Viewers can redeem repeatedly to stack entries.">
                  <Input type="number" min={1} max={1000000} value={cost} required onChange={(e) => setCost(Number(e.target.value))} />
                </Field>
              )}
            </div>

            {type === 'redeem' && (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 12 }}>
                <Field label="Number of winners" hint="Spin this many winners from the pool.">
                  <Input type="number" min={1} max={50} value={winnerCount} required onChange={(e) => setWinnerCount(Number(e.target.value))} />
                </Field>
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
                {giveaway.prize || 'Giveaway'}
              </div>
              <div style={{ color: 'var(--text-muted, #888)', marginTop: 4 }}>
                {giveaway.status === 'paused' && <strong style={{ color: 'var(--warning, #eab308)' }}>Paused. </strong>}
                {giveaway.status === 'locked' && <strong style={{ color: 'var(--text, #ddd)' }}>Entries closed. </strong>}
                {giveaway.type === 'ticket'
                  ? 'Viewers type !enter (one entry per person).'
                  : `Viewers redeem the channel-point reward.${target > 1 ? ` ${target} winners.` : ''}`}
                {' '}{perUser.length} entered.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" icon="fas fa-pen" onClick={() => (editing ? setEditing(false) : openEdit())}>
                {editing ? 'Cancel edit' : 'Edit'}
              </Button>
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
              {giveaway.type === 'ticket' && (giveaway.status === 'open' || giveaway.status === 'paused') && (
                <Button icon="fas fa-lock" loading={lock.isPending} onClick={handleLock} disabled={perUser.length === 0}>
                  Close Entries
                </Button>
              )}
              {canSpin && (
                <Button icon="fas fa-circle-notch" loading={draw.isPending} onClick={handleDraw}>
                  {winners.length === 0
                    ? 'Spin winner'
                    : target > 0
                      ? `Draw next (${winners.length + 1} of ${target})`
                      : 'Spin again'}
                </Button>
              )}
              {winners.length > 0 && (
                <Button variant="ghost" icon="fas fa-rotate" loading={redraw.isPending} onClick={handleRedraw}>Redraw last</Button>
              )}
              {giveaway.type === 'redeem' && winners.length > 0 && (
                <Button icon="fas fa-check" loading={reset.isPending} onClick={handleConfirmClear}>Confirm & clear</Button>
              )}
              <Button variant="danger" icon="fas fa-xmark" loading={close.isPending || redeemClose.isPending} onClick={handleClose}>
                {giveaway.type === 'redeem' ? 'End & remove reward' : 'End Giveaway'}
              </Button>
            </div>
          </div>

          {editing && (
            <form
              onSubmit={handleSaveEdit}
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 10,
                border: '1px solid var(--border, #33302f)',
              }}
            >
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Field label={giveaway.type === 'redeem' ? 'Reward name / prize' : 'Prize'}>
                  <Input value={editPrize} maxLength={giveaway.type === 'redeem' ? 45 : 120} required onChange={(e) => setEditPrize(e.target.value)} />
                </Field>
                {giveaway.type === 'redeem' && (
                  <>
                    <Field label="Point cost per entry">
                      <Input type="number" min={1} max={1000000} value={editCost} required onChange={(e) => setEditCost(Number(e.target.value))} />
                    </Field>
                    <Field
                      label="Number of winners"
                      hint={winners.length > 0 ? `Can't go below the ${winners.length} already drawn.` : 'Spin this many winners from the pool.'}
                    >
                      <Input
                        type="number"
                        min={Math.max(1, winners.length)}
                        max={50}
                        value={editWinnerCount}
                        required
                        onChange={(e) => setEditWinnerCount(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Button color" hint="Leave untouched to keep the current color.">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="color"
                          value={editColor}
                          onChange={(e) => {
                            setEditColor(e.target.value)
                            setEditColorTouched(true)
                          }}
                          style={{ width: 44, height: 38, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                          aria-label="Reward button color"
                        />
                        <span style={{ color: 'var(--text-muted, #888)', fontFamily: 'monospace' }}>
                          {editColorTouched ? editColor : 'unchanged'}
                        </span>
                      </div>
                    </Field>
                    <Field label="Prompt" hint="Leave blank to keep the current prompt.">
                      <Input value={editPrompt} maxLength={200} onChange={(e) => setEditPrompt(e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <Button type="submit" icon="fas fa-save" loading={update.isPending}>Save changes</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {winners.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted, #888)', fontSize: 13 }}>
                Winner{winners.length === 1 ? '' : 's'}{target > 1 ? ` (${winners.length} of ${target})` : ''}:
              </span>
              {winners.map((w, i) => (
                <span
                  key={`${w.userId}-${i}`}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontWeight: 700,
                    background: 'var(--success-bg, rgba(34,197,94,0.14))',
                    border: '1px solid var(--success-border, rgba(34,197,94,0.4))',
                  }}
                >
                  @{w.username}
                </span>
              ))}
              {target > 0 && !canDrawMore && eligiblePool.length === 0 && winners.length < target && (
                <span style={{ color: 'var(--warning, #eab308)', fontSize: 13 }}>Everyone eligible has already won.</span>
              )}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: 14 }}>
            <input type="checkbox" checked={showRoll} onChange={(e) => setShowRoll(e.target.checked)} />
            Show spinning wheel when drawing (for on-stream reveals)
          </label>

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

const WHEEL_MAX_SEGMENTS = 16

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180 // 0° points up (12 o'clock)
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function slicePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`
}

/**
 * Full-screen spinning prize wheel. Builds a segment per entrant (a representative
 * sample when there are many), spins with an ease-out deceleration, and lands the
 * pointer on the winner. Fires the chat announcement when the wheel stops.
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
  // Build the wheel's segments once. With many entrants, show a sample that still
  // includes the winner so the pointer lands on a real name.
  const { segments, winnerIndex } = useRef(
    (() => {
      const unique = Array.from(new Set(names.length ? names : [winner]))
      if (!unique.includes(winner)) unique.unshift(winner)
      if (unique.length <= WHEEL_MAX_SEGMENTS) {
        return { segments: unique, winnerIndex: unique.indexOf(winner) }
      }
      const others = unique.filter((n) => n !== winner).sort(() => Math.random() - 0.5).slice(0, WHEEL_MAX_SEGMENTS - 1)
      const insertAt = Math.floor(Math.random() * WHEEL_MAX_SEGMENTS)
      const sample = [...others]
      sample.splice(insertAt, 0, winner)
      return { segments: sample, winnerIndex: insertAt }
    })()
  ).current

  const n = segments.length
  const seg = 360 / n
  const [rotation, setRotation] = useState(0)
  const [done, setDone] = useState(false)
  const revealedRef = useRef(false)

  useEffect(() => {
    // Land the winner's segment center under the top pointer, after several turns.
    const spins = 6
    const target = 360 * spins - (winnerIndex + 0.5) * seg
    const raf = requestAnimationFrame(() => setRotation(target))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSpinEnd = () => {
    setDone(true)
    if (!revealedRef.current) {
      revealedRef.current = true
      onRevealed()
    }
  }

  const R = 150
  const showLabels = n <= 20

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
      <div style={{ textAlign: 'center' }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: 2, fontSize: 13, color: '#cfcfcf', marginBottom: 14 }}>
          {done ? 'Winner' : 'Spinning'}
        </div>

        <div style={{ position: 'relative', width: 340, height: 340, margin: '0 auto' }}>
          {/* Fixed pointer at the top */}
          <div
            style={{
              position: 'absolute',
              top: -6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '14px solid transparent',
              borderRight: '14px solid transparent',
              borderTop: '22px solid #fff',
              zIndex: 2,
              filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))',
            }}
          />
          <svg viewBox="0 0 300 300" width={340} height={340}>
            <g
              style={{
                transform: `rotate(${rotation}deg)`,
                transformBox: 'fill-box',
                transformOrigin: 'center',
                transition: 'transform 4.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onTransitionEnd={handleSpinEnd}
            >
              {segments.map((name, i) => {
                const start = i * seg
                const end = (i + 1) * seg
                const mid = start + seg / 2
                const hue = Math.round((i * 360) / n)
                const isWinner = done && i === winnerIndex
                const label = polar(150, 150, R * 0.62, mid)
                return (
                  <g key={i}>
                    <path
                      d={slicePath(150, 150, R, start, end)}
                      fill={`hsl(${hue}, 62%, ${isWinner ? 62 : 48}%)`}
                      stroke={isWinner ? '#fff' : 'rgba(0,0,0,0.25)'}
                      strokeWidth={isWinner ? 3 : 1}
                    />
                    {showLabels && (
                      <text
                        x={label.x}
                        y={label.y}
                        fill="#fff"
                        fontSize={n > 12 ? 8 : 10}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${mid} ${label.x} ${label.y})`}
                        style={{ pointerEvents: 'none' }}
                      >
                        {name.length > 12 ? name.slice(0, 11) + '...' : name}
                      </text>
                    )}
                  </g>
                )
              })}
              <circle cx={150} cy={150} r={20} fill="var(--surface, #14100f)" stroke="#fff" strokeWidth={2} />
            </g>
          </svg>
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 30,
            fontWeight: 900,
            color: done ? 'var(--success, #22c55e)' : '#fff',
            transition: 'color 0.3s ease',
          }}
        >
          {done ? `@${winner}` : ' '}
        </div>
        {done && (
          <div style={{ marginTop: 8, color: '#cfcfcf' }}>
            slot #{slot} of {total} — click anywhere to close
          </div>
        )}
      </div>
    </div>
  )
}
