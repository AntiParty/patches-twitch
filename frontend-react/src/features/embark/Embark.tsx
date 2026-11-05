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
import { embarkCapabilities, embarkContact, embarkGallery } from './embarkBriefing'
import { EmbarkMetrics } from './EmbarkMetrics'
import { EmbarkProductPreview, type EmbarkPreviewKind } from './EmbarkProductPreview'
import styles from './Embark.module.css'

const mailto = `mailto:${embarkContact.email}?subject=FinalsRS%20partnership%20conversation`

const OPPORTUNITIES = [
  { title: 'Reliable game context', desc: 'Bring official data to every creator experience.' },
  { title: 'Creator initiatives', desc: 'Explore how FinalsRS can support community programs.' },
  { title: 'Next steps', desc: 'Discuss licensing, acquisition, or continued product work.' },
]

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
          <p className={styles.kicker}>Partnership briefing · FinalsRS × Embark</p>
          <h1 id="embark-title" className={styles.headline}>
            Creator infrastructure for THE&nbsp;FINALS
          </h1>
          <p className={styles.sub}>
            FinalsRS gives THE FINALS creators live ranked context, chat-native tools, and community
            moments without pulling anyone away from the match.
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
            <figcaption className={styles.showcaseCaption}>{active.detail}</figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="unlocks-title">
          <p className={styles.sectionLabel}>What it unlocks</p>
          <h2 id="unlocks-title" className={styles.sectionTitle}>
            A practical layer between the match, the stream, and its community
          </h2>
          <ul className={styles.capabilities}>
            {embarkCapabilities.map((capability, index) => (
              <li key={capability}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {capability}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.statement} aria-labelledby="why-title">
          <p className={styles.sectionLabel}>Why it matters to Embark</p>
          <h2 id="why-title" className={styles.statementTitle}>
            A stronger creator loop around the game, not another destination to maintain
          </h2>
          <p>
            Official data and integrations could make the product more reliable, grow engagement around
            live play, and give creators a single place to run the community moments that keep viewers
            involved.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="opportunity-title">
          <p className={styles.sectionLabel}>Opportunity</p>
          <h2 id="opportunity-title" className={styles.sectionTitle}>
            Explore an official FinalsRS integration
          </h2>
          <div className={styles.featureRow}>
            {OPPORTUNITIES.map((item) => (
              <div key={item.title} className={styles.feature}>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
          <p className={styles.builder}>
            Designed, built, deployed, and operated independently by AntiParty: frontend and backend,
            Twitch integrations, APIs, databases, infrastructure, and product design, integrated into one
            focused creator experience.
          </p>
        </section>

        <section className={styles.endCta} aria-labelledby="contact-title">
          <h2 id="contact-title" className={styles.endTitle}>Let’s talk</h2>
          <p className={styles.endSub}>
            <a href={mailto}>{embarkContact.email}</a>
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
