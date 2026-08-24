import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { embarkCapabilities, embarkContact, embarkGallery } from './embarkBriefing'
import { EmbarkMetrics } from './EmbarkMetrics'
import { EmbarkProductPreview } from './EmbarkProductPreview'
import styles from './Embark.module.css'

export function Embark() {
  const { data: stats, status } = useQuery({
    queryKey: ['embark-stats'],
    queryFn: publicApi.getEmbarkStats,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  return (
    <article className={styles.root}>
      <section className={styles.hero} aria-labelledby="embark-title">
        <div className={styles.container}>
          <p className={styles.kicker}>Partnership briefing</p>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.eyebrow}>FinalsRS × Embark</p>
              <h1 id="embark-title">Creator infrastructure for THE FINALS.</h1>
            </div>
            <div className={styles.heroStatement}>
              <p>
                FinalsRS gives THE FINALS creators live ranked context, chat-native tools, and
                community moments without pulling anyone away from the match.
              </p>
              <a
                className={styles.primaryLink}
                href={`mailto:${embarkContact.email}?subject=FinalsRS%20partnership%20conversation`}
              >
                Start a partnership conversation <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <dl className={styles.briefMeta}>
            <div><dt>Platform</dt><dd>FinalsRS</dd></div>
            <div><dt>Built by</dt><dd>AntiParty</dd></div>
            <div><dt>Conversation</dt><dd>Official integration</dd></div>
          </dl>
        </div>
      </section>

      <div className={styles.container}>
        <section className={styles.section} aria-labelledby="what-it-does">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>What it unlocks</p>
            <h2 id="what-it-does">A practical layer between the match, the stream, and its community.</h2>
          </div>
          <ul className={styles.capabilities}>
            {embarkCapabilities.map((capability, index) => (
              <li key={capability}><span>{String(index + 1).padStart(2, '0')}</span>{capability}</li>
            ))}
          </ul>
        </section>

        <section className={styles.statement} aria-labelledby="why-it-exists">
          <p className={styles.eyebrow}>Why it matters to Embark</p>
          <h2 id="why-it-exists">
            A stronger creator loop around the game, not another destination to maintain.
          </h2>
          <p>
            Official data and integrations could make the product more reliable, grow engagement around
            live play, and give creators a single place to run the community moments that keep viewers
            involved.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="traction">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Traction</p>
            <h2 id="traction">A working platform, measured in lifetime totals.</h2>
          </div>
          <p className={styles.metricContext}>Lifetime platform totals</p>
          <EmbarkMetrics status={status} stats={stats} />
        </section>

        <section className={styles.section} aria-labelledby="product">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Product</p>
            <h2 id="product">Designed for the stream, operated by the creator.</h2>
          </div>
          <div className={styles.gallery}>
            {embarkGallery.map((item) => (
              <figure className={styles.galleryItem} key={item.title}>
                <EmbarkProductPreview kind={item.kind} />
                <figcaption><strong>{item.title}</strong><span>{item.detail}</span></figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className={styles.twoColumn}>
          <div>
            <p className={styles.eyebrow}>Built independently</p>
            <h2>Designed, built, deployed, and operated by AntiParty.</h2>
          </div>
          <p>
            FinalsRS is the result of independent product work across frontend and backend development,
            Twitch integrations, APIs, databases, infrastructure, and product design. The technical
            pieces are deliberately integrated into one focused creator experience.
          </p>
        </section>

        <section className={styles.opportunity} aria-labelledby="opportunity">
          <p className={styles.eyebrow}>Opportunity</p>
          <h2 id="opportunity">Explore an official FinalsRS integration.</h2>
          <ul>
            <li>Bring more reliable game context to every creator experience.</li>
            <li>Explore how FinalsRS can support creator and community initiatives.</li>
            <li>Discuss licensing, acquisition, or continued product work.</li>
          </ul>
        </section>

        <section className={styles.contact} aria-labelledby="contact">
          <p className={styles.eyebrow}>Contact</p>
          <h2 id="contact">Let’s talk.</h2>
          <div className={styles.contactLinks}>
            <a href={`mailto:${embarkContact.email}?subject=FinalsRS%20partnership%20conversation`}>
              {embarkContact.email}
            </a>
            <a href={embarkContact.site}>View FinalsRS</a>
            <a href={embarkContact.x} target="_blank" rel="noreferrer">Message on X</a>
          </div>
        </section>
      </div>
    </article>
  )
}
