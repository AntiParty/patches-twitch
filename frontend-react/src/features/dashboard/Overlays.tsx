/*
 * Stream Overlays tab. Configure the OBS overlay (theme, accent color, layout,
 * field visibility), copy the token URL, regenerate the token. Ported from the
 * legacy overlays view + its inline JS. Config auto-saves on change.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { overlayApi, OVERLAY_THEMES, OVERLAY_LAYOUTS } from '@/api/overlay'
import type { OverlayConfigInput } from '@/types/overlay'
import styles from './Overlays.module.css'

const DEFAULT_CONFIG: OverlayConfigInput = {
  theme: 'minimal',
  primaryColor: '#e62038',
  layoutMode: 'compact',
  visibility: { hideName: false, hideRank: false, hideScore: false, hideSession: false },
}

export function Overlays() {
  const toast = useToast()
  const confirm = useConfirm()

  const [token, setToken] = useState('')
  const [config, setConfig] = useState<OverlayConfigInput>(DEFAULT_CONFIG)
  const [initialized, setInitialized] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  const tokenQuery = useQuery({ queryKey: ['overlay', 'token'], queryFn: overlayApi.getToken })
  useEffect(() => {
    if (tokenQuery.data?.token) setToken(tokenQuery.data.token)
  }, [tokenQuery.data])

  const configQuery = useQuery({
    queryKey: ['overlay', 'config', token],
    queryFn: () => overlayApi.getConfig(token),
    enabled: !!token,
  })

  // Hydrate the form once config loads.
  useEffect(() => {
    if (initialized || !configQuery.data) return
    const c = configQuery.data
    setConfig({
      theme: c.theme || 'minimal',
      primaryColor: c.primaryColor || '#e62038',
      layoutMode: c.layout?.mode || 'compact',
      visibility: {
        hideName: !!c.layout?.visibility?.hideName,
        hideRank: !!c.layout?.visibility?.hideRank,
        hideScore: !!c.layout?.visibility?.hideScore,
        hideSession: !!c.layout?.visibility?.hideSession,
      },
    })
    setInitialized(true)
  }, [initialized, configQuery.data])

  const save = useMutation({ mutationFn: overlayApi.saveConfig })

  // Persist on every change (matching the legacy onchange=saveOverlayConfig()).
  const persist = async (next: OverlayConfigInput) => {
    setConfig(next)
    setSaveStatus('Saving…')
    try {
      await save.mutateAsync(next)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2000)
    } catch (err) {
      setSaveStatus('')
      toast.error(err instanceof ApiError ? err.message : 'Failed to save overlay config')
    }
  }

  const regenerate = useMutation({ mutationFn: overlayApi.regenerateToken })
  const handleRegenerate = async () => {
    const ok = await confirm({
      title: 'Regenerate Token',
      body: 'Regenerating a new token will break your existing overlay links. Continue?',
      confirmLabel: 'Regenerate',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await regenerate.mutateAsync()
      setToken(res.token)
      toast.success('New overlay token generated!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to regenerate token')
    }
  }

  const overlayUrl = useMemo(() => {
    if (!token) return ''
    return `${window.location.origin}/overlays/${config.theme}.html?token=${token}`
  }, [token, config.theme])

  const previewUrl = overlayUrl ? `${overlayUrl}&preview=true` : 'about:blank'

  const copyUrl = async () => {
    if (!overlayUrl) return
    await navigator.clipboard.writeText(overlayUrl)
    toast.success('Overlay URL copied')
  }

  const setVisibility = (key: keyof OverlayConfigInput['visibility'], value: boolean) =>
    persist({ ...config, visibility: { ...config.visibility, [key]: value } })

  return (
    <>
      <PageHeader
        title="Stream Overlays"
        actions={
          <Button variant="ghost" icon="fas fa-sync" onClick={handleRegenerate} loading={regenerate.isPending}>
            Regenerate Token
          </Button>
        }
      />

      <Card title="Overlay Setup">
        {/* URL */}
        <div style={{ marginTop: 12 }}>
          <label className={styles.label}>Overlay URL</label>
          <div className={styles.urlRow}>
            <Input readOnly value={overlayUrl} placeholder={token ? '' : 'Loading token…'} style={{ flex: 1 }} />
            <Button icon="fas fa-copy" onClick={copyUrl} aria-label="Copy URL" />
            <Button
              variant="ghost"
              icon="fas fa-external-link-alt"
              onClick={() => overlayUrl && window.open(overlayUrl, '_blank')}
              aria-label="Open overlay"
            />
          </div>
        </div>

        {/* Preview */}
        <div style={{ marginTop: 16 }}>
          <div className={styles.previewHead}>
            <label className={styles.label} style={{ margin: 0 }}>
              Live Preview
            </label>
          </div>
          <div className={styles.previewBox}>
            <iframe title="Overlay preview" src={previewUrl} />
          </div>
          <p className={styles.previewNote}>Use 400x300 in OBS for best results</p>
        </div>

        <div className={styles.divider} />

        {/* Appearance */}
        <div className="card-title" style={{ marginBottom: 12, fontWeight: 800 }}>
          Appearance Settings
        </div>
        <div className={styles.settingsGrid}>
          <div>
            <label className={styles.label}>Theme</label>
            <Select value={config.theme} onChange={(e) => persist({ ...config, theme: e.target.value })}>
              {OVERLAY_THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className={styles.label}>Accent Color</label>
            <div className={styles.colorWrap}>
              <input
                type="color"
                className={styles.colorInput}
                value={config.primaryColor}
                onChange={(e) => persist({ ...config, primaryColor: e.target.value })}
              />
              <span className={styles.colorValue}>{config.primaryColor.toUpperCase()}</span>
            </div>
          </div>

          <div>
            <label className={styles.label}>Layout Mode</label>
            <Select value={config.layoutMode} onChange={(e) => persist({ ...config, layoutMode: e.target.value })}>
              {OVERLAY_LAYOUTS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Visibility */}
        <div style={{ marginTop: 16 }}>
          <label className={styles.label}>Visibility Options</label>
          <div className={styles.toggles}>
            {([
              ['hideName', 'Hide Name'],
              ['hideRank', 'Hide Rank'],
              ['hideScore', 'Hide Score'],
              ['hideSession', 'Hide Session'],
            ] as const).map(([key, label]) => (
              <label key={key} className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={!!config.visibility[key]}
                  onChange={(e) => setVisibility(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.saveStatus}>
          {saveStatus === 'saved' ? (
            <span className={styles.ok}>
              <i className="fas fa-check" /> Saved
            </span>
          ) : (
            saveStatus
          )}
        </div>

        <div className={styles.tip}>
          <h3>
            <i className="fas fa-magic" /> Pro Tip
          </h3>
          <p>Changes reflect instantly on your stream! No need to refresh OBS.</p>
        </div>
      </Card>
    </>
  )
}
