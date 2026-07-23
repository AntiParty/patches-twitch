/*
 * Giveaways tab. Streamer creates a giveaway (chat/ticket type in Phase 1,
 * channel-point redeem added in Phase 2), watches entrants come in, and draws
 * a winner — announced in chat by the backend. Viewers enter with !enter.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { Table, type Column } from '@/components/tables/Table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { giveawaysApi } from '@/api/giveaways'
import type { GiveawayEntrant } from '@/types/giveaway'
import { GiveawayReveal } from './GiveawayReveal'
import { filterGiveawayEntrants } from './giveawayDisplay'
import styles from './Giveaways.module.css'

const CURRENT_KEY = ['giveaways', 'current'] as const

// Optional limit fields use string state; blank or <1 means "no limit".
const parseLimitInput = (s: string): number | undefined => {
  if (!s.trim()) return undefined
  const n = Math.floor(Number(s))
  return Number.isFinite(n) && n >= 1 ? n : undefined
}

export function Giveaways() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const currentQuery = useQuery({
    queryKey: CURRENT_KEY,
    queryFn: giveawaysApi.getCurrent,
    refetchInterval: (query) => (query.state.data?.giveaway ? 3000 : false),
    refetchIntervalInBackground: false,
  })
  const giveaway = currentQuery.data?.giveaway ?? null
  const perUser = currentQuery.data?.perUser ?? []
  const totalEntries = currentQuery.data?.total ?? 0
  const redeemScope = currentQuery.data?.redeemScope ?? false

  const [type, setType] = useState<'ticket' | 'redeem'>('ticket')
  const [prize, setPrize] = useState('')
  const [cost, setCost] = useState(500)
  const [winnerCount, setWinnerCount] = useState(1)
  const [rewardColor, setRewardColor] = useState('#9147ff')
  const [rewardPrompt, setRewardPrompt] = useState('')
  const [maxPerUser, setMaxPerUser] = useState('')
  const [maxPerStreamTotal, setMaxPerStreamTotal] = useState('')
  const [cooldown, setCooldown] = useState('')

  // Inline edit of the live giveaway (prize; plus cost/prompt/color for redeem).
  const [editing, setEditing] = useState(false)
  const [editPrize, setEditPrize] = useState('')
  const [editCost, setEditCost] = useState(500)
  const [editWinnerCount, setEditWinnerCount] = useState(1)
  const [editPrompt, setEditPrompt] = useState('')
  const [editColor, setEditColor] = useState('#9147ff')
  const [editColorTouched, setEditColorTouched] = useState(false)
  const [editMaxPerUser, setEditMaxPerUser] = useState('')
  const [editMaxPerStream, setEditMaxPerStream] = useState('')
  const [editCooldown, setEditCooldown] = useState('')

  // Optional on-stream roll animation (streamer shows the dashboard). Persisted.
  const [showRoll, setShowRoll] = useState(() => localStorage.getItem('giveawayShowRoll') !== 'off')
  const [entrantSearch, setEntrantSearch] = useState('')
  useEffect(() => {
    setEntrantSearch('')
  }, [giveaway?.id])
  const [roll, setRoll] = useState<{
    entrants: GiveawayEntrant[]
    winner: string
    slot: number
    total: number
  } | null>(null)
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
  const visibleEntrants = filterGiveawayEntrants(perUser, entrantSearch)
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
          maxPerUserPerStream: parseLimitInput(maxPerUser),
          maxPerStream: parseLimitInput(maxPerStreamTotal),
          cooldownSeconds: parseLimitInput(cooldown),
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
      setMaxPerUser('')
      setMaxPerStreamTotal('')
      setCooldown('')
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
    setEditMaxPerUser(giveaway.maxPerUserPerStream != null ? String(giveaway.maxPerUserPerStream) : '')
    setEditMaxPerStream(giveaway.maxPerStream != null ? String(giveaway.maxPerStream) : '')
    setEditCooldown(giveaway.cooldownSeconds != null ? String(giveaway.cooldownSeconds) : '')
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
              // Limits are always sent: blank clears the limit (0 = off server-side).
              maxPerUserPerStream: parseLimitInput(editMaxPerUser) ?? 0,
              maxPerStream: parseLimitInput(editMaxPerStream) ?? 0,
              cooldownSeconds: parseLimitInput(editCooldown) ?? 0,
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
      toast.success(`Winner: @${winner.username} (entry #${winner.slot} of ${winner.total})`)
    } catch {
      toast.error(`@${winner.username} won, but the chat announcement failed. Use “Announce winner” to retry.`)
    }
  }

  // Spin the wheel over the still-eligible pool (prior winners excluded), then
  // announce once it lands. `pool` is captured before the draw so the wheel
  // matches the entrants who could still win.
  const revealWinner = async (
    winner: { username: string; slot: number; total: number },
    pool: GiveawayEntrant[],
  ) => {
    if (showRoll && pool.length > 0) {
      setRoll({ entrants: pool, winner: winner.username, slot: winner.slot, total: winner.total })
    } else {
      await finishReveal(winner)
    }
  }

  const handleDraw = async () => {
    const pool = eligiblePool
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
    const pool = eligiblePool
    try {
      const res = await redraw.mutateAsync()
      await revealWinner(res.winner, pool)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to redraw.')
    }
  }

  const handleAnnounceWinner = async () => {
    try {
      await announce.mutateAsync()
      toast.success('Winner announced in chat.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Winner is saved, but the chat announcement failed.')
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
      body: 'Clear all entries and reopen the Twitch reward for a fresh round? Do this once the winner has accepted their prize.',
      confirmLabel: 'Start next round',
      danger: true,
    })
    if (!ok) return
    try {
      await reset.mutateAsync()
      setEntrantSearch('')
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

  const statusLabel = giveaway
    ? {
        open: 'Live',
        paused: 'Paused',
        locked: 'Entries closed',
        drawn: 'Drawing',
        closed: 'Closed',
      }[giveaway.status]
    : ''
  const lastUpdated = currentQuery.dataUpdatedAt
    ? new Date(currentQuery.dataUpdatedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
    : ''

  return (
    <div className={styles.page}>
      <PageHeader
        title="Giveaways"
        subtitle={
          giveaway
            ? `${statusLabel} · Live entry counts${lastUpdated ? ` · Synced ${lastUpdated}` : ''}`
            : 'Run a chat or channel-point giveaway and draw a random winner without leaving the dashboard.'
        }
        actions={
          <Button variant="ghost" icon="fas fa-sync" loading={currentQuery.isFetching} onClick={invalidate}>
            Refresh
          </Button>
        }
      />

      {currentQuery.isLoading ? (
        <Card>
          <div className={styles.loadingCard}>
            <Skeleton height={28} width="38%" />
            <Skeleton height={72} />
            <Skeleton height={240} />
          </div>
        </Card>
      ) : currentQuery.isError ? (
        <ErrorState
          title="Giveaway status unavailable"
          message="We couldn't load the current giveaway. Your active giveaway has not been changed."
          onRetry={() => currentQuery.refetch()}
        />
      ) : !giveaway ? (
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
                <Field
                  label="Point cost per entry"
                  hint={
                    parseLimitInput(maxPerUser) === 1
                      ? 'One redemption per viewer per stream.'
                      : 'Viewers can redeem repeatedly to stack entries.'
                  }
                >
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
                <Field label="Max entries per viewer each round" hint="Set 1 for one entry each round. Starting the next round gives everyone a fresh entry. Blank = unlimited.">
                  <Input type="number" min={1} value={maxPerUser} placeholder="No limit" onChange={(e) => setMaxPerUser(e.target.value)} />
                </Field>
                <Field label="Max total entries per stream" hint="Cap on all redemptions per stream. Blank = unlimited.">
                  <Input type="number" min={1} value={maxPerStreamTotal} placeholder="No limit" onChange={(e) => setMaxPerStreamTotal(e.target.value)} />
                </Field>
                <Field label="Cooldown between entries (seconds)" hint="Wait time between redemptions. Blank = none.">
                  <Input type="number" min={1} value={cooldown} placeholder="None" onChange={(e) => setCooldown(e.target.value)} />
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
                    ? 'Draw winner'
                    : target > 0
                      ? `Draw next (${winners.length + 1} of ${target})`
                      : 'Draw again'}
                </Button>
              )}
              {winners.length > 0 && (
                <Button variant="ghost" icon="fas fa-rotate" loading={redraw.isPending} onClick={handleRedraw}>Redraw last</Button>
              )}
              {winners.length > 0 && (
                <Button variant="ghost" icon="fas fa-bullhorn" loading={announce.isPending} onClick={handleAnnounceWinner}>
                  Announce winner
                </Button>
              )}
              {giveaway.type === 'redeem' && winners.length > 0 && (
                <Button icon="fas fa-check" loading={reset.isPending} onClick={handleConfirmClear}>
                  Confirm winner & start next round
                </Button>
              )}
              <Button variant="danger" icon="fas fa-xmark" loading={close.isPending || redeemClose.isPending} onClick={handleClose}>
                {giveaway.type === 'redeem' ? 'End & remove reward' : 'End Giveaway'}
              </Button>
            </div>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Viewers</span>
              <strong className={styles.statValue}>{perUser.length.toLocaleString()}</strong>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Entries</span>
              <strong className={styles.statValue}>{totalEntries.toLocaleString()}</strong>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Winners</span>
              <strong className={styles.statValue}>
                {winners.length.toLocaleString()}
                {target > 0 ? ` / ${target.toLocaleString()}` : ''}
              </strong>
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
                    <Field label="Max entries per viewer each round" hint="Starting the next round resets this limit. Blank = unlimited.">
                      <Input type="number" min={1} value={editMaxPerUser} placeholder="No limit" onChange={(e) => setEditMaxPerUser(e.target.value)} />
                    </Field>
                    <Field label="Max total entries per stream" hint="Blank = unlimited.">
                      <Input type="number" min={1} value={editMaxPerStream} placeholder="No limit" onChange={(e) => setEditMaxPerStream(e.target.value)} />
                    </Field>
                    <Field label="Cooldown between entries (seconds)" hint="Blank = none.">
                      <Input type="number" min={1} value={editCooldown} placeholder="None" onChange={(e) => setEditCooldown(e.target.value)} />
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

          <label className={styles.toggle}>
            <input type="checkbox" checked={showRoll} onChange={(e) => setShowRoll(e.target.checked)} />
            <span>
              <strong>Show on-stream reveal</strong>
              <br />
              The secure draw happens first; the reel only reveals the saved winner.
            </span>
          </label>

          <div style={{ marginTop: 20 }}>
            {perUser.length === 0 ? (
              <EmptyState icon="fas fa-ticket" title="No entries yet" description="Entries appear here as viewers join." />
            ) : (
              <>
                <div className={styles.entryToolbar}>
                  <div className={styles.searchField}>
                    <i className="fas fa-search" aria-hidden="true" />
                    <Input
                      type="search"
                      value={entrantSearch}
                      onChange={(event) => setEntrantSearch(event.target.value)}
                      placeholder="Search viewers"
                      aria-label="Search giveaway viewers"
                    />
                  </div>
                  <span className={styles.searchCount} aria-live="polite">
                    {entrantSearch.trim()
                      ? `${visibleEntrants.length.toLocaleString()} of ${perUser.length.toLocaleString()} viewers`
                      : `${perUser.length.toLocaleString()} viewers`}
                  </span>
                </div>
                {visibleEntrants.length === 0 ? (
                  <EmptyState
                    icon="fas fa-search"
                    title="No matching viewers"
                    description={`No giveaway entrants match “${entrantSearch.trim()}”.`}
                  />
                ) : (
                  <div className={styles.tableViewport}>
                    <Table columns={entrantColumns} data={visibleEntrants} rowKey={(r) => r.userId} emptyMessage="No entries yet" />
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      <AnimatePresence>
        {roll && (
          <GiveawayReveal
            entrants={roll.entrants}
            winner={roll.winner}
            slot={roll.slot}
            total={roll.total}
            onRevealed={() => finishReveal({ username: roll.winner, slot: roll.slot, total: roll.total })}
            onClose={() => setRoll(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
