/*
 * /embark — partnership briefing for Embark Studios. Uses the site's shared
 * page header, cards, and stat cards so it reads like the rest of FinalsRS.
 */
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Badge } from '@/components/data-display/Badge'
import { embarkCapabilities, embarkContact, embarkGallery } from './embarkBriefing'
import { EmbarkMetrics } from './EmbarkMetrics'
import { EmbarkProductPreview } from './EmbarkProductPreview'
import styles from './Embark.module.css'

const mailto = `mailto:${embarkContact.email}?subject=FinalsRS%20partnership%20conversation`

export function Embark() {
  const { data: stats, status, refetch } = useQuery({
    queryKey: ['embark-stats'],
    queryFn: publicApi.getEmbarkStats,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  return (
    <article className={styles.page}>
      <div className={styles.kicker}>
        <Badge variant="primary">Partnership briefing</Badge>
        <span>FinalsRS × Embark</span>
      </div>
      <PageHeader
        title="Creator infrastructure for THE FINALS"
        subtitle={
          <p className={styles.lede}>
            FinalsRS gives THE FINALS creators live ranked context, chat-native tools, and community
            moments without pulling anyone away from the match.
          </p>
        }
        actions={
          <a className={styles.primaryAction} href={mailto}>
            Start a conversation
            <i className="fas fa-arrow-right" aria-hidden="true" />
          </a>
        }
      />

      <dl className={styles.meta}>
        <div><dt>Platform</dt><dd>FinalsRS</dd></div>
        <div><dt>Built by</dt><dd>AntiParty</dd></div>
        <div><dt>Conversation</dt><dd>Official integration</dd></div>
      </dl>

      <section className={styles.section} aria-labelledby="traction">
        <SectionHead
          id="traction"
          title="Traction"
          description="A working platform, measured in lifetime totals."
        />
        <EmbarkMetrics status={status} stats={stats} onRetry={() => void refetch()} />
      </section>

      <section className={styles.splitSection}>
        <Card
          title="What it unlocks"
          subtitle="A practical layer between the match, the stream, and its community."
        >
          <ul className={styles.capabilities}>
            {embarkCapabilities.map((capability, index) => (
              <li key={capability}>
                <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                {capability}
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Why it matters to Embark"
          subtitle="A stronger creator loop around the game, not another destination to maintain."
        >
          <p className={styles.body}>
            Official data and integrations could make the product more reliable, grow engagement around
            live play, and give creators a single place to run the community moments that keep viewers
            involved.
          </p>
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="product">
        <SectionHead
          id="product"
          title="Product"
          description="Designed for the stream, operated by the creator."
        />
        <div className={styles.gallery}>
          {embarkGallery.map((item) => (
            <figure className={styles.galleryItem} key={item.title}>
              <EmbarkProductPreview kind={item.kind} />
              <figcaption>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <Card title="Built independently" subtitle="Designed, built, deployed, and operated by AntiParty.">
          <p className={styles.body}>
            FinalsRS is the result of independent product work across frontend and backend development,
            Twitch integrations, APIs, databases, infrastructure, and product design. The technical
            pieces are deliberately integrated into one focused creator experience.
          </p>
        </Card>
        <Card title="Opportunity" subtitle="Explore an official FinalsRS integration.">
          <ul className={styles.opportunities}>
            <li>Bring more reliable game context to every creator experience.</li>
            <li>Explore how FinalsRS can support creator and community initiatives.</li>
            <li>Discuss licensing, acquisition, or continued product work.</li>
          </ul>
        </Card>
      </section>

      <section className={styles.contact} aria-labelledby="contact">
        <div>
          <h2 id="contact">Let’s talk</h2>
          <p>
            Reach out at <a href={mailto}>{embarkContact.email}</a>.
          </p>
        </div>
        <div className={styles.contactLinks}>
          <a className={styles.primaryAction} href={mailto}>Email AntiParty</a>
          <a className={styles.secondaryAction} href={embarkContact.x} target="_blank" rel="noreferrer">
            Message on X
          </a>
          <a className={styles.secondaryAction} href={embarkContact.site}>View FinalsRS</a>
        </div>
      </section>
    </article>
  )
}

function SectionHead({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
