/*
 * Predictions tab. Auth status banner, prediction preset CRUD + form, live
 * prediction (start/resolve/cancel), and the premium automation section.
 * Ported from the legacy predictions view + its inline JS.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { predictionsApi } from '@/api/predictions'
import type { PredictionAuthStatus } from '@/types/prediction'
import { PredictionAutomation } from './PredictionAutomation'
import styles from './predictions.module.css'

const STATUS_KEY = ['predictions', 'status'] as const
const PRESETS_KEY = ['predictions', 'presets'] as const
const CURRENT_KEY = ['predictions', 'current'] as const

export function Predictions() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const statusQuery = useQuery({ queryKey: STATUS_KEY, queryFn: predictionsApi.getStatus, retry: false })
  const presetsQuery = useQuery({ queryKey: PRESETS_KEY, queryFn: predictionsApi.listPresets })
  const currentQuery = useQuery({ queryKey: CURRENT_KEY, queryFn: predictionsApi.getCurrent, retry: false })

  const presets = presetsQuery.data?.presets ?? []
  const active = currentQuery.data?.prediction ?? null

  // Derive auth status, including the reauth_required error shape.
  const authStatus: PredictionAuthStatus = useMemo(() => {
    if (statusQuery.data) return statusQuery.data
    if (statusQuery.error instanceof ApiError) {
      const data = statusQuery.error.data as { state?: string; reauthUrl?: string } | undefined
      if (data?.state === 'reauth_required') return { state: 'reauth_required', reauthUrl: data.reauthUrl }
    }
    return { state: 'temporarily_unavailable' }
  }, [statusQuery.data, statusQuery.error])

  // Preset form state.
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null)
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(120)
  const [outcomes, setOutcomes] = useState<string[]>(['', ''])

  const resetForm = () => {
    setEditingAlias(null)
    setAlias('')
    setTitle('')
    setDuration(120)
    setOutcomes(['', ''])
  }

  const editPreset = (a: string) => {
    const p = presets.find((x) => x.alias === a)
    if (!p) return
    setEditingAlias(p.alias)
    setAlias(p.alias)
    setTitle(p.title)
    setDuration(p.durationSeconds)
    setOutcomes(p.outcomes.length ? p.outcomes : ['', ''])
  }

  const savePreset = useMutation({
    mutationFn: (payload: { alias: string; title: string; outcomes: string[]; durationSeconds: number }) =>
      editingAlias ? predictionsApi.updatePreset(editingAlias, payload) : predictionsApi.createPreset(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PRESETS_KEY }),
  })

  const handleSavePreset = async (e: FormEvent) => {
    e.preventDefault()
    const cleaned = outcomes.map((o) => o.trim()).filter(Boolean)
    if (cleaned.length < 2 || cleaned.length > 5) {
      toast.warning('Use between two and five outcomes.')
      return
    }
    const aliasValue = alias.trim()
    if (!editingAlias && presets.some((p) => p.alias === aliasValue)) {
      const ok = await confirm({
        title: 'Overwrite preset',
        body: `A preset named "${aliasValue}" already exists. Replace it?`,
      })
      if (!ok) return
    }
    try {
      await savePreset.mutateAsync({ alias: aliasValue, title: title.trim(), outcomes: cleaned, durationSeconds: duration })
      toast.success(editingAlias ? 'Preset updated.' : 'Preset saved.')
      setSelectedAlias(aliasValue.toLowerCase())
      resetForm()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save preset.')
    }
  }

  const deletePreset = useMutation({
    mutationFn: predictionsApi.deletePreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: PRESETS_KEY }),
  })
  const handleDeletePreset = async (a: string) => {
    const ok = await confirm({ title: 'Delete prediction preset', body: `Delete "${a}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await deletePreset.mutateAsync(a)
      if (selectedAlias === a) setSelectedAlias(null)
      if (editingAlias === a) resetForm()
      toast.success('Preset deleted.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete preset.')
    }
  }

  // Live prediction actions.
  const start = useMutation({
    mutationFn: predictionsApi.start,
    onSuccess: () => qc.invalidateQueries({ queryKey: CURRENT_KEY }),
  })
  const handleStart = async () => {
    if (!selectedAlias) {
      toast.warning('Select a preset first.')
      return
    }
    try {
      await start.mutateAsync(selectedAlias)
      toast.success('Prediction started on Twitch.')
    } catch (err) {
      if (err instanceof ApiError && (err.data as { state?: string })?.state === 'reauth_required') {
        qc.invalidateQueries({ queryKey: STATUS_KEY })
      }
      toast.error(err instanceof ApiError ? err.message : 'Failed to start prediction.')
    }
  }

  const resolve = useMutation({
    mutationFn: predictionsApi.resolve,
    onSuccess: () => qc.invalidateQueries({ queryKey: CURRENT_KEY }),
  })
  const handleResolve = async (selection: number, outcomeName: string) => {
    const ok = await confirm({ title: 'Resolve prediction', body: `Declare "${outcomeName}" as the winning outcome?`, confirmLabel: 'Resolve' })
    if (!ok) return
    try {
      await resolve.mutateAsync(selection)
      toast.success(`Prediction resolved with "${outcomeName}".`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to resolve prediction.')
    }
  }

  const cancel = useMutation({
    mutationFn: predictionsApi.cancel,
    onSuccess: () => qc.invalidateQueries({ queryKey: CURRENT_KEY }),
  })
  const handleCancel = async () => {
    const ok = await confirm({ title: 'Cancel prediction', body: 'Cancel this prediction and refund all Channel Points?', confirmLabel: 'Cancel & Refund', danger: true })
    if (!ok) return
    try {
      await cancel.mutateAsync()
      toast.success('Prediction canceled and Channel Points refunded.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel prediction.')
    }
  }

  const selectedPreset = presets.find((p) => p.alias === selectedAlias)

  return (
    <>
      <PageHeader
        title="Predictions"
        subtitle="Build reusable Channel Points predictions and run them without leaving the dashboard."
        actions={
          <Button variant="ghost" icon="fas fa-sync" onClick={() => qc.invalidateQueries({ queryKey: ['predictions'] })}>
            Refresh
          </Button>
        }
      />

      <AuthStatusBanner status={authStatus} />

      <div className={styles.layout}>
        {/* Presets */}
        <Card>
          <div className={styles.heading}>
            <div>
              <div className="card-title" style={{ fontWeight: 800 }}>Prediction Presets</div>
              <div className={styles.copy}>Save a question once, then start it instantly whenever you need it.</div>
            </div>
            <Button variant="ghost" size="sm" icon="fas fa-plus" onClick={resetForm}>New</Button>
          </div>

          <div className={styles.presetList}>
            {presets.length === 0 ? (
              <div className={styles.empty}>
                No presets yet. Create one below, then start it from this page whenever you go live.
              </div>
            ) : (
              presets.map((p) => (
                <div key={p.alias} className={`${styles.preset} ${p.alias === selectedAlias ? styles.presetSelected : ''}`}>
                  <div className={styles.presetTop}>
                    <div>
                      <div className={styles.presetTitle}>{p.title}</div>
                      <span className={styles.alias}>!p start {p.alias}</span>
                    </div>
                    <div className={styles.presetActions}>
                      <Button variant="ghost" size="sm" onClick={() => editPreset(p.alias)}>Edit</Button>
                      <Button size="sm" onClick={() => setSelectedAlias(p.alias)}>Select</Button>
                      <Button variant="danger" size="sm" onClick={() => handleDeletePreset(p.alias)}>Delete</Button>
                    </div>
                  </div>
                  <div className={styles.outcomeSummary}>
                    {p.outcomes.map((o, i) => (
                      <span key={i} className={styles.chip}>{i + 1}. {o}</span>
                    ))}
                  </div>
                  <div className={styles.presetMeta}>{p.durationSeconds}s voting window</div>
                </div>
              ))
            )}
          </div>

          {/* Form */}
          <form className={styles.form} onSubmit={handleSavePreset}>
            <div className="card-title" style={{ fontWeight: 800, marginBottom: 4 }}>
              {editingAlias ? `Edit ${editingAlias}` : 'Create Preset'}
            </div>
            <div className={styles.copy} style={{ marginBottom: 14 }}>Aliases are one word and can be used in chat too.</div>

            <div className={styles.formGrid}>
              <Field label="Alias">
                <Input value={alias} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,23}" placeholder="ranked" disabled={!!editingAlias} required onChange={(e) => setAlias(e.target.value)} />
              </Field>
              <Field label="Question">
                <Input value={title} maxLength={45} placeholder="How will this ranked session go?" required onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>

            <div style={{ marginTop: 12 }}>
              <Field label="Outcomes (2-5)">
                <div className={styles.outcomes}>
                  {outcomes.map((o, i) => (
                    <div key={i} className={styles.outcomeRow}>
                      <div className={styles.outcomeNumber}>{i + 1}</div>
                      <Input value={o} maxLength={25} placeholder={`Outcome ${i + 1}`} required onChange={(e) => setOutcomes((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} />
                      <Button
                        type="button"
                        variant="ghost"
                        icon="fas fa-xmark"
                        disabled={outcomes.length <= 2}
                        onClick={() => setOutcomes((arr) => arr.filter((_, idx) => idx !== i))}
                        aria-label="Remove outcome"
                      />
                    </div>
                  ))}
                </div>
                {outcomes.length < 5 && (
                  <Button type="button" variant="ghost" size="sm" icon="fas fa-plus" onClick={() => setOutcomes((arr) => [...arr, ''])}>
                    Add outcome
                  </Button>
                )}
              </Field>
            </div>

            <div style={{ marginTop: 12, maxWidth: 260 }}>
              <Field label="Voting window (seconds)" hint="Twitch allows 30-1,800 seconds.">
                <Input type="number" min={30} max={1800} value={duration} required onChange={(e) => setDuration(Number(e.target.value))} />
              </Field>
            </div>

            <div className={styles.formActions}>
              <Button type="button" variant="ghost" onClick={resetForm}>Clear</Button>
              <Button type="submit" icon="fas fa-save" loading={savePreset.isPending}>Save preset</Button>
            </div>
          </form>
        </Card>

        {/* Live */}
        <Card className={styles.live}>
          <div className={styles.heading}>
            <div>
              <div className="card-title" style={{ fontWeight: 800 }}>Live Prediction</div>
              <div className={styles.copy}>Start the selected preset, choose the winner, or cancel and refund.</div>
            </div>
          </div>

          <div className={styles.liveState}>
            {active ? (
              <>
                <div className={styles.liveTitle}>{active.title}</div>
                <span className={styles.liveBadge}>{active.status || 'ACTIVE'}</span>
                <div className={styles.liveOutcomes}>
                  {active.outcomes.map((o, i) => (
                    <Button key={o.id} variant="ghost" className={styles.resolveBtn} onClick={() => handleResolve(i + 1, o.title)}>
                      <span className={styles.outcomeNumber}>{i + 1}</span>
                      {o.title}
                    </Button>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button variant="danger" loading={cancel.isPending} onClick={handleCancel}>Cancel and refund</Button>
                </div>
              </>
            ) : (
              <div className={styles.liveEmpty}>
                <i className="fas fa-chart-simple" style={{ display: 'block', marginBottom: 10 }} />
                No active prediction. Select a preset below and start it.
              </div>
            )}
          </div>

          {!active && (
            <div style={{ marginTop: 16 }}>
              <div className={styles.copy} style={{ marginBottom: 10 }}>Selected preset</div>
              {selectedPreset ? (
                <div className={`${styles.preset} ${styles.presetSelected}`}>
                  <div className={styles.presetTitle}>{selectedPreset.title}</div>
                  <span className={styles.alias}>{selectedPreset.alias}</span>
                </div>
              ) : (
                <div className={styles.empty}>Select a preset from the list to start it.</div>
              )}
              <Button variant="primary" icon="fas fa-play" style={{ width: '100%', marginTop: 12 }} disabled={!selectedPreset} loading={start.isPending} onClick={handleStart}>
                Start selected preset
              </Button>
            </div>
          )}
        </Card>
      </div>

      <PredictionAutomation />
    </>
  )
}

function AuthStatusBanner({ status }: { status: PredictionAuthStatus }) {
  const map = {
    ready: { cls: styles.statusReady, icon: 'fas fa-check', title: 'Twitch predictions are ready', detail: 'FinalsRS can create and manage Channel Points predictions for your channel.' },
    reauth_required: { cls: styles.statusWarning, icon: 'fas fa-key', title: 'Twitch reauthorization required', detail: 'Approve prediction access before starting or managing predictions.' },
    unavailable: { cls: styles.statusWarning, icon: 'fas fa-circle-exclamation', title: 'Predictions are unavailable', detail: status.message || 'Channel Points Predictions require Twitch Affiliate or Partner status.' },
    temporarily_unavailable: { cls: styles.statusWarning, icon: 'fas fa-triangle-exclamation', title: 'Twitch is temporarily unavailable', detail: 'Your presets are safe. Refresh this page and try again shortly.' },
  } as const
  const m = map[status.state]
  return (
    <div className={`${styles.status} ${m.cls}`}>
      <div className={styles.statusCopy}>
        <div className={styles.statusIcon}>
          <i className={m.icon} />
        </div>
        <div>
          <div className={styles.statusTitle}>{m.title}</div>
          <div className={styles.statusDetail}>{m.detail}</div>
        </div>
      </div>
      {status.state === 'reauth_required' && (
        <a className="btn btn-primary" href={status.reauthUrl || '/reauth'}>
          Reauthorize with Twitch
        </a>
      )}
    </div>
  )
}
