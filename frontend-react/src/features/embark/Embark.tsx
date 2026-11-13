/*
 * /embark — partnership briefing for Embark Studios. A pitch page, so it
 * follows the landing page's language: a centered hero over the dither field,
 * hairline-separated sections instead of card stacks, and one large product
 * showcase as the centerpiece.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { Tabs } from '@/components/data-display/Tabs'
import { DitherAtmosphere } from '@/features/landing/DitherAtmosphere'
import { embarkContact, embarkGallery } from './embarkBriefing'
import { EmbarkMetrics } from './EmbarkMetrics'
import { EmbarkAsk, EmbarkCapabilities } from './EmbarkSections'
import { EmbarkProductPreview, type EmbarkPreviewKind } from './EmbarkProductPreview'
import styles from './Embark.module.css'

const mailto = `mailto:${embarkContact.email}?subject=FinalsRS%20partnership%20conversation`

export function Embark() {
  const { data: stats, status, refetch } = useQuery({
    queryKey: ['embark-stats'],
    queryFn: publicApi.getEmbarkStats,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const [view, setView] = useState<EmbarkPreviewKind>('dashboard')
  const active = embarkGallery.find((item) => item.kind === view) ?? embarkGallery[0]

  return (
    <article className={styles.root}>
      <section className={styles.hero} aria-labelledby="embark-title">
        <div className={styles.atmosphere} aria-hidden="true">
          <DitherAtmosphere color="red" />
          <div className={styles.heroFade} />
        </div>
        <div className={styles.heroInner}>
          <p className={styles.kicker}>Partnership briefing for Embark Studios</p>
          <h1 id="embark-title" className={styles.headline}>
            Creator infrastructure for THE&nbsp;FINALS
          </h1>
          <p className={styles.sub}>
            FinalsRS is a Twitch bot and web toolset that answers ranked questions in chat, tracks each
            stream’s RS movement, and runs viewer predictions for THE FINALS creators. It runs live on
            Twitch today, and the totals below come straight from production.
          </p>
          <div className={styles.actions}>
            <a className={styles.cta} href={mailto}>Start a partnership conversation</a>
            <a className={styles.ghostLink} href="#product">See the product</a>
          </div>
        </div>
      </section>

      <div className={styles.below}>
        <section aria-label="Traction">
          <EmbarkMetrics status={status} stats={stats} onRetry={() => void refetch()} />
        </section>

        <section className={styles.section} id="product" aria-labelledby="product-title">
          <p className={styles.sectionLabel}>Product</p>
          <h2 id="product-title" className={styles.sectionTitle}>
            Designed for the stream, operated by the creator
          </h2>
          <figure className={styles.showcase}>
            <div className={styles.showcaseBar}>
              <Tabs
                tabs={embarkGallery.map((item) => ({ id: item.kind, label: item.title }))}
                active={view}
                onChange={(id) => setView(id as EmbarkPreviewKind)}
              />
            </div>
            <div className={styles.showcaseBody}>
              <EmbarkProductPreview kind={active.kind} />
            </div>
            <figcaption className={styles.showcaseCaption}>
              {active.detail}
              <span className={styles.showcaseNote}>Illustrative data: names and numbers are examples.</span>
            </figcaption>
          </figure>
        </section>

        <EmbarkCapabilities />

        <EmbarkAsk />

        <section className={styles.endCta} aria-labelledby="contact-title">
          <h2 id="contact-title" className={styles.endTitle}>Let’s talk</h2>
          <p className={styles.endSub}>
            <a href={mailto}>{embarkContact.email}</a>
          </p>
          <p className={styles.endNote}>
            Tell us what you would like to see. A short walkthrough of the dashboard and the live pages
            above is available on request.
          </p>
          <div className={styles.actions}>
            <a className={styles.cta} href={mailto}>Email AntiParty</a>
            <a className={styles.ghostLink} href={embarkContact.x} target="_blank" rel="noreferrer">
              Message on X
            </a>
            <a className={styles.ghostLink} href={embarkContact.site}>View FinalsRS</a>
          </div>
        </section>
      </div>
    </article>
  )
}
