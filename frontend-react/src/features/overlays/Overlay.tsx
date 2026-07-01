/*
 * OBS stream overlay (React). Lightweight, transparent, token-polling — mirrors
 * the legacy /overlays/*.html widgets. Reads ?token= and the theme from the
 * route; polls /api/overlay/data/:token (5s) and /api/overlay/config/:token (15s).
 *
 * The legacy static .html overlays remain on the backend for OBS URL
 * compatibility; these React routes live at /overlay/:theme.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import styles from './Overlay.module.css'

interface OverlayData {
  playerName: string
  rank: number | string
  league: string
  rankScore: number
  sessionChange: number
}

interface OverlayConfig {
  primaryColor?: string
  layout?: { mode?: string; visibility?: Record<string, boolean> }
}

const THEME_CLASS: Record<string, string> = {
  minimal: styles.minimal,
  dark: styles.dark,
  'dark-slim': styles.darkSlim,
  neon: styles.neon,
  glass: styles.glass,
  terminal: styles.terminal,
  card: styles.minimal,
  'rank-focus': styles.minimal,
}

const fmt = (n: number) => Number(n).toLocaleString()

export function Overlay() {
  const { theme = 'minimal' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [data, setData] = useState<OverlayData | null>(null)
  const [config, setConfig] = useState<OverlayConfig | null>(null)
  const dataRef = useRef<HTMLDivElement>(null)

  // Transparent background for OBS browser source.
  useEffect(() => {
    const prevBody = document.body.style.background
    const prevRoot = (document.getElementById('root') as HTMLElement | null)?.style.background
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
    return () => {
      document.body.style.background = prevBody
      if (root) root.style.background = prevRoot ?? ''
    }
  }, [])

  // Poll data + config.
  useEffect(() => {
    if (!token) return
    let alive = true
    const loadData = () =>
      fetch(`/api/overlay/data/${token}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d))
        .catch(() => {})
    const loadConfig = () =>
      fetch(`/api/overlay/config/${token}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => alive && c && setConfig(c))
        .catch(() => {})
    loadData()
    loadConfig()
    const dataTimer = setInterval(loadData, 5000)
    const configTimer = setInterval(loadConfig, 15000)
    return () => {
      alive = false
      clearInterval(dataTimer)
      clearInterval(configTimer)
    }
  }, [token])

  if (!token) {
    return <div style={{ color: '#fff', fontFamily: 'sans-serif', padding: 16 }}>Missing ?token= in overlay URL.</div>
  }

  const accent = config?.primaryColor || '#e62038'
  const vis = config?.layout?.visibility ?? {}
  const wide = config?.layout?.mode === 'wide'
  const change = data?.sessionChange ?? 0

  return (
    <div ref={dataRef} className={`${styles.root} ${THEME_CLASS[theme] ?? styles.minimal}`} style={{ ['--accent' as string]: accent }}>
      <div className={`${styles.card} ${wide ? styles.wide : ''}`}>
        <span className={styles.accentBar} />

        {!vis.hideName && (
          <div className={styles.block}>
            <span className={styles.label}>Player</span>
            <span className={styles.name}>{data?.playerName ?? '—'}</span>
          </div>
        )}

        {!vis.hideRank && (
          <>
            {!vis.hideName && <span className={styles.divider} />}
            <div className={styles.block}>
              <span className={styles.label}>League</span>
              <span className={`${styles.value} ${styles.league}`}>{data?.league ?? '—'}</span>
            </div>
          </>
        )}

        {!vis.hideScore && (
          <>
            <span className={styles.divider} />
            <div className={styles.block}>
              <span className={styles.label}>RS</span>
              <span className={`${styles.value} ${theme === 'rank-focus' ? styles.rankFocusScore : ''}`}>
                {data ? fmt(data.rankScore) : '—'}
              </span>
            </div>
          </>
        )}

        {!vis.hideSession && (
          <>
            <span className={styles.divider} />
            <div className={styles.block}>
              <span className={styles.label}>Session</span>
              <span className={`${styles.value} ${styles.session} ${change >= 0 ? styles.up : styles.down}`}>
                {change >= 0 ? '+' : ''}{fmt(change)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
