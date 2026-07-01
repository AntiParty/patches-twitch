/*
 * Automatic Ranked Predictions (premium). Two modes:
 *  - stream_total: one prediction settled from total RS change at stream end
 *  - next_result: repeating, fixed Lose/Gain outcomes
 * Ported from the legacy automation section.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { Badge } from '@/components/data-display/Badge'
import { Spinner } from '@/components/feedback/Spinner'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import {
  predictionsApi,
  AUTOMATION_DELAYS,
  NEXT_RESULT_OUTCOMES,
  STREAM_TOTAL_OUTCOMES,
} from '@/api/predictions'
import type { AutomationMode, AutomationOutcome, AutomationLive } from '@/types/prediction'
import styles from './predictions.module.css'

const fmt = (n: number) => Number(n).toLocaleString()

export function PredictionAutomation() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const query = useQuery({
    queryKey: ['predictions', 'automation'],
    queryFn: predictionsApi.getAutomation,
    retry: false,
  })

  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<AutomationMode>('stream_total')
  const [delay, setDelay] = useState(600)
  const [window, setWindow] = useState(120)
  const [question, setQuestion] = useState('')
  const [outcomes, setOutcomes] = useState<AutomationOutcome[]>([])
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized || !query.data) return
    const c = query.data.config
    setEnabled(c.enabled)
    setMode(c.mode)
    setDelay(c.startDelaySeconds)
    setWindow(c.votingWindowSeconds)
    setQuestion(c.question || '')
    setOutcomes(c.outcomes?.length ? c.outcomes : STREAM_TOTAL_OUTCOMES)
    setInitialized(true)
  }, [initialized, query.data])

  // Subscription gating: the endpoint 403s with state subscription_required.
  const accessError =
    query.error instanceof ApiError &&
    (query.error.data as { state?: string } | undefined)?.state === 'subscription_required'
      ? query.error
      : null

  const applyMode = (next: AutomationMode) => {
    setMode(next)
    if (next === 'next_result') {
      setOutcomes(NEXT_RESULT_OUTCOMES)
      setQuestion('Will the next ranked result gain or lose RS?')
    } else {
      setOutcomes(STREAM_TOTAL_OUTCOMES)
      setQuestion('How much RS will I gain this stream?')
    }
  }

  const isNextResult = mode === 'next_result'

  const updateOutcome = (i: number, patch: Partial<AutomationOutcome>) =>
    setOutcomes((o) => o.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  const save = useMutation({
    mutationFn: predictionsApi.saveAutomation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions', 'automation'] }),
  })
  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await save.mutateAsync({
        enabled,
        mode,
        startDelaySeconds: delay,
        votingWindowSeconds: window,
        question: question.trim(),
        outcomes,
      })
      toast.success('Automatic prediction settings saved.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save automation settings.')
    }
  }

  const startNow = useMutation({
    mutationFn: predictionsApi.startAutomation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions', 'automation'] }),
  })
  const handleStartNow = async () => {
    try {
      await startNow.mutateAsync()
      toast.success('Automatic ranked prediction start requested.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Automatic prediction could not start.')
    }
  }

  const cancel = useMutation({
    mutationFn: predictionsApi.cancelAutomation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions', 'automation'] }),
  })
  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancel automatic prediction',
      body: 'Cancel the automatic prediction and refund all Channel Points?',
      confirmLabel: 'Cancel & Refund',
      danger: true,
    })
    if (!ok) return
    try {
      await cancel.mutateAsync()
      toast.success('Automatic prediction canceled and refunded.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel automatic prediction.')
    }
  }

  const header = (
    <div className={styles.heading}>
      <div>
        <div className="card-title" style={{ fontWeight: 800 }}>Automatic Ranked Predictions</div>
        <div className={styles.copy}>
          Open a ranked RS prediction while live in THE FINALS and settle it when the stream ends.
        </div>
      </div>
      <Badge variant="primary">Beta</Badge>
    </div>
  )

  if (accessError) {
    const data = accessError.data as { error?: string; subscribeUrl?: string }
    return (
      <Card style={{ marginTop: 18 }}>
        {header}
        <div className={styles.liveState}>
          <div className={styles.liveTitle}>Subscriber early access</div>
          <div className={styles.copy} style={{ marginTop: 6 }}>
            {data?.error || 'Automatic predictions are available to subscribers and test users.'}
          </div>
          <a
            className="btn btn-primary"
            style={{ marginTop: 14 }}
            href={data?.subscribeUrl || 'https://www.twitch.tv/subs/antiparty'}
            target="_blank"
            rel="noreferrer"
          >
            Subscribe for access
          </a>
        </div>
      </Card>
    )
  }

  if (query.isLoading) {
    return (
      <Card style={{ marginTop: 18 }}>
        {header}
        <div className={styles.liveState}>
          <Spinner /> Loading automatic prediction status…
        </div>
      </Card>
    )
  }

  const run = query.data?.run ?? null
  const live = query.data?.live ?? null

  return (
    <Card style={{ marginTop: 18 }}>
      {header}
      <div className={styles.layout}>
        <form className={styles.form} style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={handleSave}>
          <label className={styles.preset} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span>
              <strong>Enable Automatic Ranked Predictions</strong>
              <span className={styles.copy} style={{ display: 'block' }}>
                Disabled by default. Requires a linked ranked player and Twitch prediction permission.
              </span>
            </span>
          </label>

          <div style={{ marginTop: 14 }}>
            <Field label="Prediction type">
              <Select value={mode} onChange={(e) => applyMode(e.target.value as AutomationMode)}>
                <option value="stream_total">Whole stream RS change</option>
                <option value="next_result">Next ranked result (repeating)</option>
              </Select>
            </Field>
            <div className={styles.copy} style={{ marginTop: 8 }}>
              {isNextResult
                ? 'Repeats through the stream. Waits for a confirmed RS change, refunds after 30 minutes without one, then a 2-minute cooldown.'
                : 'Creates one prediction for the stream and settles it from total RS change when the stream ends.'}
            </div>
          </div>

          <div className={styles.formGrid} style={{ marginTop: 14 }}>
            <Field label="Start delay">
              <Select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                {AUTOMATION_DELAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Voting window (seconds)">
              <Input type="number" min={30} max={1800} value={window} onChange={(e) => setWindow(Number(e.target.value))} required />
            </Field>
          </div>

          <div style={{ marginTop: 12 }}>
            <Field label="Prediction question">
              <Input maxLength={45} value={question} onChange={(e) => setQuestion(e.target.value)} required />
            </Field>
          </div>

          <div style={{ marginTop: 12 }}>
            <Field label={isNextResult ? 'Fixed outcomes' : 'Outcome ranges (2-5)'}>
              <div className={styles.copy} style={{ marginBottom: 10 }}>
                {isNextResult
                  ? 'Zero RS change keeps the prediction waiting; only a confirmed gain or loss settles it.'
                  : 'Leave the first minimum and last maximum blank for full coverage.'}
              </div>
              <div className={styles.outcomes}>
                {outcomes.map((o, i) => (
                  <div key={i} className={`${styles.outcomeRow} ${styles.outcomeRowAuto}`}>
                    <Input
                      maxLength={25}
                      placeholder="Outcome label"
                      value={o.label}
                      disabled={isNextResult}
                      onChange={(e) => updateOutcome(i, { label: e.target.value })}
                    />
                    <Input
                      type="number"
                      placeholder="Min"
                      value={o.minDelta ?? ''}
                      disabled={isNextResult}
                      onChange={(e) => updateOutcome(i, { minDelta: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      value={o.maxDelta ?? ''}
                      disabled={isNextResult}
                      onChange={(e) => updateOutcome(i, { maxDelta: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      icon="fas fa-xmark"
                      disabled={isNextResult || outcomes.length <= 2}
                      onClick={() => setOutcomes((arr) => arr.filter((_, idx) => idx !== i))}
                      aria-label="Remove outcome"
                    />
                  </div>
                ))}
              </div>
              {!isNextResult && outcomes.length < 5 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="fas fa-plus"
                  onClick={() => setOutcomes((arr) => [...arr, { label: '', minDelta: null, maxDelta: null }])}
                >
                  Add range
                </Button>
              )}
            </Field>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" icon="fas fa-save" loading={save.isPending}>
              Save automation
            </Button>
          </div>
        </form>

        <div>
          <div className={styles.liveState}>
            <div className={styles.liveTitle}>
              {run ? String(run.status || 'unknown').replaceAll('_', ' ') : enabled ? 'Waiting for a stream' : 'Automation is disabled.'}
            </div>
            <div className={styles.copy} style={{ marginTop: 6 }}>
              {run?.failureReason
                ? `Reason: ${run.failureReason.replaceAll('_', ' ')}`
                : run?.mode === 'next_result'
                  ? `Cycle ${run.cycleIndex || 1} tracks the next confirmed RS gain or loss.`
                  : 'FinalsRS uses the session starting RS and settles only its stored Twitch prediction.'}
            </div>
            {live && <LiveMetrics live={live} />}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Button variant="primary" icon="fas fa-play" loading={startNow.isPending} onClick={handleStartNow}>
              Start Now
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={handleCancel}>
              Cancel &amp; Refund
            </Button>
          </div>
          <div className={styles.copy} style={{ marginTop: 12 }}>
            Start Now bypasses only the timer. Category, starting RS, OAuth, duplicate, and
            active-prediction checks still apply.
          </div>
        </div>
      </div>
    </Card>
  )
}

function LiveMetrics({ live }: { live: AutomationLive }) {
  const values: [string, string][] = [
    ['Stream', live.isLive ? live.category || 'Live' : 'Offline'],
    ['Starting RS', live.startingRs === null ? 'Waiting' : fmt(live.startingRs)],
    ['Latest RS', live.latestRs === null ? 'Unavailable' : fmt(live.latestRs)],
    ['Delta', live.delta === null ? 'Unavailable' : `${live.delta >= 0 ? '+' : ''}${fmt(live.delta)}`],
  ]
  if (live.secondsUntilStart !== null && live.secondsUntilStart > 0) {
    values.push(['Auto-start', `${Math.ceil(live.secondsUntilStart / 60)}m`])
  }
  return (
    <div className={styles.outcomeSummary}>
      {values.map(([label, value]) => (
        <span key={label} className={styles.chip}>
          {label}: {value}
        </span>
      ))}
    </div>
  )
}
