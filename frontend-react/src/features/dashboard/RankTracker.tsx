/*
 * Rank Tracker tab. Set a target rank + current RS and track progress toward it.
 * Ported from the legacy rank-tracker view + its inline JS (Ruby uses the live
 * Top-500 cutoff from /api/ruby-status).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import {
  rankApi,
  RANK_NAMES,
  RANK_THRESHOLDS,
  RANK_OPTIONS,
  RANK_MILESTONES,
} from '@/api/rank'
import type { CurrentRank } from '@/types/rank'
import styles from './RankTracker.module.css'

const fmt = (n: number) => Number(n).toLocaleString()
const parseRS = (v: string | number | null | undefined): number => {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/[^0-9.-]+/g, ''))
  return isNaN(n) ? NaN : n
}

function hasRubyAchievement(rank: CurrentRank | null | undefined): boolean {
  if (!rank) return false
  const lb = parseRS(rank.rank ?? NaN)
  return String(rank.league ?? '').toLowerCase() === 'ruby' || (!isNaN(lb) && lb > 0 && lb <= 500)
}

function nextMilestone(currentRS: number) {
  if (isNaN(currentRS)) return null
  return (
    RANK_MILESTONES.find((m) => currentRS < m.threshold) ?? { rank: 6, label: 'Ruby', threshold: null }
  )
}

interface Display {
  label: string
  sub: string
  pct: number
  achieved: boolean
}

export function RankTracker() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const goalQuery = useQuery({ queryKey: ['rank', 'goal'], queryFn: rankApi.getGoal })
  const currentQuery = useQuery({
    queryKey: ['rank', 'current'],
    queryFn: rankApi.getCurrentRank,
    retry: false, // 404 when no IGN linked
  })
  const rubyQuery = useQuery({ queryKey: ['rank', 'ruby'], queryFn: rankApi.getRubyStatus })

  const [targetRank, setTargetRank] = useState(0)
  const [currentRS, setCurrentRS] = useState('')
  const [initialized, setInitialized] = useState(false)

  const liveRank = currentQuery.data
  const rubyThreshold = rubyQuery.data?.rubyRankThreshold?.threshold ?? null

  // Initialize form once goal + current-rank queries have settled.
  useEffect(() => {
    if (initialized) return
    if (goalQuery.isLoading || currentQuery.isLoading) return
    const goal = goalQuery.data?.goal
    const liveRS = liveRank?.rankScore
    if (goal) {
      setTargetRank(goal.targetRank)
      setCurrentRS(String(liveRS ?? goal.startingRankScore ?? ''))
    } else if (typeof liveRS === 'number') {
      setCurrentRS(String(liveRS))
      setTargetRank(nextMilestone(liveRS)?.rank ?? 0)
    }
    setInitialized(true)
  }, [initialized, goalQuery.isLoading, goalQuery.data, currentQuery.isLoading, liveRank])

  // Derived progress display.
  const display = useMemo<Display>(() => {
    const rs = parseRS(currentRS) || 0
    const effectiveTarget = targetRank
      ? targetRank === 6
        ? rubyThreshold
        : RANK_THRESHOLDS[targetRank]
      : nextMilestone(rs)?.threshold ?? null
    const label = targetRank ? RANK_NAMES[targetRank] : nextMilestone(rs)?.label ?? 'No Goal Set'

    if (!targetRank && isNaN(parseRS(currentRS))) {
      return { label: 'No Goal Set', sub: 'Set a goal to get started', pct: 0, achieved: false }
    }
    if (targetRank === 6 && hasRubyAchievement(liveRank)) {
      return { label, sub: 'Top 500 already achieved', pct: 100, achieved: true }
    }
    if (effectiveTarget == null || effectiveTarget <= 0) {
      return { label, sub: 'Target unavailable', pct: 0, achieved: false }
    }
    const diff = Math.max(0, Math.round(effectiveTarget - rs))
    if (diff <= 0) {
      return {
        label,
        sub: targetRank === 6 ? 'Top 500 already achieved' : 'Already achieved',
        pct: 100,
        achieved: true,
      }
    }
    return {
      label,
      sub: `${fmt(diff)} RS needed`,
      pct: Math.min(100, Math.max(0, (rs / effectiveTarget) * 100)),
      achieved: false,
    }
  }, [targetRank, currentRS, rubyThreshold, liveRank])

  // Current-rank status line.
  const statusLine = useMemo(() => {
    if (currentQuery.isLoading) return 'Checking latest leaderboard cache…'
    if (currentQuery.isError) {
      const err = currentQuery.error
      return err instanceof ApiError ? err.message : 'Current RS is unavailable.'
    }
    if (liveRank) {
      const bits = [
        `${fmt(liveRank.rankScore)} RS`,
        liveRank.league,
        liveRank.rank ? `rank #${fmt(liveRank.rank)}` : null,
      ].filter(Boolean)
      return `Loaded ${bits.join(' | ')} for ${liveRank.playerId}.`
    }
    return 'Link your THE FINALS account in Settings to auto-fill RS.'
  }, [currentQuery.isLoading, currentQuery.isError, currentQuery.error, liveRank])

  const refresh = async () => {
    const res = await currentQuery.refetch()
    if (res.data) setCurrentRS(String(res.data.rankScore ?? ''))
  }

  const save = useMutation({
    mutationFn: rankApi.saveGoal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rank', 'goal'] }),
  })

  const handleSave = async () => {
    if (!targetRank) {
      toast.warning('Please select a target rank.')
      return
    }
    let rs = parseRS(currentRS)
    if (isNaN(rs)) {
      const res = await currentQuery.refetch()
      rs = res.data?.rankScore ?? NaN
    }
    if (isNaN(rs) || rs < 0) {
      toast.warning('Current RS is unavailable. Link your account or enter RS manually.')
      return
    }
    let targetRankScore = RANK_THRESHOLDS[targetRank]
    if (targetRank === 6) {
      if (rubyThreshold == null) {
        toast.warning('Top 500 cutoff is unavailable right now.')
        return
      }
      targetRankScore = rubyThreshold
    }
    try {
      await save.mutateAsync({ targetRank, targetRankScore, currentRS: rs })
      toast.success('Rank goal updated!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update goal.')
    }
  }

  const remove = useMutation({
    mutationFn: rankApi.deleteGoal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rank', 'goal'] }),
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Goal',
      body: 'Are you sure you want to delete your rank goal?',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync()
      setTargetRank(0)
      setCurrentRS('')
      toast.success('Rank goal deleted successfully.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete goal.')
    }
  }

  const ruby = rubyQuery.data?.rubyRankThreshold

  return (
    <>
      <PageHeader title="Rank Tracker" />

      <div className={styles.grid}>
        <Card title="Set Your Goal" className={styles.goalCard}>
          <Field label="Target Rank">
            <Select value={targetRank || ''} onChange={(e) => setTargetRank(Number(e.target.value))}>
              <option value="">-- Select Target Rank --</option>
              {RANK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          {targetRank === 6 && (
            <div className={styles.rubyInfo}>
              <i className="fas fa-info-circle" style={{ color: '#ffc107' }} />{' '}
              {ruby?.threshold != null
                ? `Current Top 500 cutoff: ${fmt(ruby.threshold)} RS${ruby.unlocked ? ' — Ruby is live.' : '.'}`
                : 'Ruby requires being Top 500 on the global leaderboard. The RS cutoff changes dynamically.'}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Field label="Current RS">
              <div className={styles.rsRow}>
                <Input
                  type="number"
                  value={currentRS}
                  placeholder={liveRank ? 'Loading linked RS…' : 'Link an IGN first'}
                  onChange={(e) => setCurrentRS(e.target.value)}
                />
                <Button variant="ghost" icon="fas fa-rotate" onClick={refresh} loading={currentQuery.isFetching} />
              </div>
            </Field>
            <div className={styles.statusLine}>{statusLine}</div>
          </div>

          <div className={styles.actions} style={{ marginTop: 24 }}>
            <Button onClick={handleSave} loading={save.isPending}>
              Update Goal
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={remove.isPending}>
              Delete Goal
            </Button>
          </div>
        </Card>

        <Card className={styles.progressCard}>
          <div className={styles.container}>
            <div className={styles.circle}>
              <i className={`fas fa-trophy ${styles.icon}`} />
            </div>
            <div className={styles.label}>{display.label}</div>
            <div className={styles.sub}>{display.sub}</div>
            <div className={styles.track}>
              <div
                className={styles.fill}
                style={{
                  width: `${display.pct}%`,
                  background: display.achieved ? 'var(--success)' : 'var(--primary)',
                }}
              />
            </div>
            <div className={styles.legend}>
              <span>Current</span>
              <span>Target</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
