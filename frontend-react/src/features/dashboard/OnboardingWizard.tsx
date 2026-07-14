/*
 * First-run wizard: single step to link a THE FINALS account with a live
 * "found you" preview. Gated on profile.onboardingCompleted === false.
 * "Link & finish" links the account then marks onboarding done; "Skip for now"
 * just marks it done (permanent dismissal).
 */
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { useToast } from '@/hooks/useToast'
import { ApiError } from '@/api/errors'
import { onboardingApi, type IgnLookup } from '@/api/onboarding'
import { dashboardApi } from '@/api/dashboard'
import { useProfile, useCompleteOnboarding } from './hooks'
import styles from './OnboardingWizard.module.css'

export function OnboardingWizard() {
  const { data: profile } = useProfile()
  const complete = useCompleteOnboarding()
  const toast = useToast()

  const [ign, setIgn] = useState('')
  const [lookup, setLookup] = useState<IgnLookup | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced live lookup.
  useEffect(() => {
    const q = ign.trim()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 3) { setLookup(null); setLookupError(null); setChecking(false); return }
    setChecking(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await onboardingApi.lookup(q)
        setLookup(res)
        setLookupError(null)
      } catch (err) {
        // Surface a 400 (bad ID format) inline; treat anything else as a
        // transient lookup failure that shouldn't block linking.
        setLookup(null)
        setLookupError(err instanceof ApiError && err.status === 400 ? err.message : null)
      } finally {
        setChecking(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [ign])

  if (!profile || profile.onboardingCompleted) return null

  const finish = async () => {
    const q = ign.trim()
    if (!q) return
    setSubmitting(true)
    try {
      await dashboardApi.linkAccount(q)
      await complete.mutateAsync()
      toast.success('Account linked — you are all set!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not link your account')
    } finally {
      setSubmitting(false)
    }
  }

  const skip = async () => {
    setSubmitting(true)
    try {
      await complete.mutateAsync()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={() => { /* not dismissable — must finish or skip */ }}
      dismissable={false}
      title="Welcome — let's link your account"
      footer={
        <div className={styles.footerRow}>
          <Button variant="ghost" size="sm" className={styles.skip} onClick={skip} disabled={submitting}>
            Skip for now
          </Button>
          <Button variant="primary" onClick={finish} loading={submitting} disabled={!ign.trim()}>
            Link &amp; finish
          </Button>
        </div>
      }
    >
      <p className={styles.intro}>
        Link your THE FINALS account so the bot can track your rank and power chat commands.
      </p>
      <Field label="Embark ID">
        <Input
          value={ign}
          onChange={(e) => setIgn(e.target.value)}
          placeholder="Name#1234"
          autoFocus
        />
      </Field>
      <div className={styles.result}>
        {checking && 'Checking…'}
        {!checking && lookupError && <span className={styles.missing}>{lookupError}</span>}
        {!checking && lookup?.found && (
          <span className={styles.found}>
            ✓ Found you — #{lookup.rank?.toLocaleString()} · {lookup.rankScore?.toLocaleString()} RS
          </span>
        )}
        {!checking && lookup && !lookup.found && ign.trim().length >= 3 && (
          <span className={styles.missing}>
            Couldn't find that Embark ID — check the spelling (include #1234). You can still link it.
          </span>
        )}
      </div>
    </Dialog>
  )
}
