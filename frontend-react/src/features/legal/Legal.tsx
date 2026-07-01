/*
 * Legal page (Privacy / Terms). Ported from legal.html + legal.js — fetches the
 * markdown docs (/privacy.md, /terms.md, proxied to backend) and renders them.
 */
import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { useSearchParams } from 'react-router-dom'
import { Spinner } from '@/components/feedback/Spinner'
import styles from './Legal.module.css'

type Doc = 'privacy' | 'terms'

export function Legal() {
  const [params, setParams] = useSearchParams()
  const initial: Doc = (window.location.hash.replace('#', '') as Doc) === 'terms' || params.get('doc') === 'terms' ? 'terms' : 'privacy'
  const [doc, setDoc] = useState<Doc>(initial)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    fetch(doc === 'privacy' ? '/privacy.md' : '/terms.md')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.text()
      })
      .then((text) => {
        if (cancelled) return
        setHtml(marked.parse(text) as string)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  const select = (d: Doc) => {
    setDoc(d)
    setParams({ doc: d }, { replace: true })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Legal</h1>
        <p>Privacy policy and terms of service for FinalsRS.</p>
      </header>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${doc === 'privacy' ? styles.active : ''}`} onClick={() => select('privacy')}>
          Privacy Policy
        </button>
        <button className={`${styles.tab} ${doc === 'terms' ? styles.active : ''}`} onClick={() => select('terms')}>
          Terms of Service
        </button>
      </div>

      <div className={styles.content}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner /></div>
        ) : error ? (
          <div className={styles.error}>
            <h3>Error loading content</h3>
            <p>Could not load the requested document. Please try again later.</p>
          </div>
        ) : (
          <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  )
}
