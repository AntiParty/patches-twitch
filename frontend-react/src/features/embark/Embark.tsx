import { useQuery } from '@tanstack/react-query'
import { publicApi } from '@/api/public'
import { embarkCapabilities, embarkContact, embarkGallery } from './embarkBriefing'
import styles from './Embark.module.css'

function formatMetric(value: number | undefined): string {
  return typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : '—'
}

export function Embark() {
  const { data: stats } = useQuery({
    queryKey: ['embark-stats'],
    queryFn: publicApi.getEmbarkStats,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const metrics = [
    { value: formatMetric(stats?.streamers), label: 'Streamers' },
    { value: formatMetric(stats?.commandsProcessed), label: 'Commands processed' },
    { value: formatMetric(stats?.predictionsCreated), label: 'Predictions created' },
    { value: formatMetric(stats?.apiRequests), label: 'API requests' },
  ]

  return (
    <article className={styles.root}>
      <section className={styles.hero} aria-labelledby="embark-title">
        <div className={styles.container}>
          <p className={styles.kicker}>Private briefing</p>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.eyebrow}>FinalsRS × Embark</p>
              <h1 id="embark-title">Creator infrastructure for THE FINALS.</h1>
            </div>
            <div className={styles.heroStatement}>
              <p>
                FinalsRS is an independently built Twitch and creator platform made specifically for
                THE FINALS—connecting ranked play, streams, and the communities around them.
              </p>
              <a className={styles.primaryLink} href={embarkContact.site}>
                View FinalsRS <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <dl className={styles.briefMeta}>
            <div><dt>Platform</dt><dd>FinalsRS</dd></div>
            <div><dt>Built by</dt><dd>AntiParty</dd></div>
            <div><dt>Conversation</dt><dd>Partnership / integration</dd></div>
          </dl>
        </div>
      </section>

      <div className={styles.container}>
        <section className={styles.section} aria-labelledby="what-it-does">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>What FinalsRS does</p>
            <h2 id="what-it-does">A practical layer between the match and the stream.</h2>
          </div>
          <ul className={styles.capabilities}>
            {embarkCapabilities.map((capability, index) => (
              <li key={capability}><span>{String(index + 1).padStart(2, '0')}</span>{capability}</li>
            ))}
          </ul>
        </section>

        <section className={styles.statement} aria-labelledby="why-it-exists">
          <p className={styles.eyebrow}>Why it exists</p>
          <h2 id="why-it-exists">
            Built from firsthand experience streaming and playing THE FINALS.
          </h2>
          <p>
            FinalsRS exists to make the relationship between the game, streamers, and their viewers
            feel more immediate. The platform gives a stream useful ranked context without asking
            creators to leave the match or viewers to leave chat.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="traction">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Traction</p>
            <h2 id="traction">A working platform, with live platform totals.</h2>
          </div>
          <div className={styles.metrics}>
            {metrics.map((metric) => (
              <div className={styles.metric} key={metric.label}>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="product">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Product</p>
            <h2 id="product">Designed for the stream, operated by the creator.</h2>
          </div>
          <div className={styles.gallery}>
            {embarkGallery.map((item, index) => (
              <figure className={styles.galleryItem} key={item.title}>
                <div className={`${styles.placeholder} ${index === 0 ? styles.placeholderWide : ''}`}>
                  <span>{item.label}</span>
                  <div className={styles.placeholderUi} aria-hidden="true">
                    <i /><i /><i /><i />
                  </div>
                  <em>Screenshot placeholder</em>
                </div>
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
          <h2 id="opportunity">Open to a conversation about what comes next.</h2>
          <ul>
            <li>Partnership or official integration</li>
            <li>Licensing or acquisition of FinalsRS and its technology</li>
            <li>Joining Embark to continue creator and community tooling work</li>
          </ul>
        </section>

        <section className={styles.contact} aria-labelledby="contact">
          <p className={styles.eyebrow}>Contact</p>
          <h2 id="contact">Built by AntiParty.</h2>
          <div className={styles.contactLinks}>
            <a href={embarkContact.site}>FinalsRS</a>
            <a href={embarkContact.twitch} target="_blank" rel="noreferrer">Twitch</a>
            <a href={`mailto:${embarkContact.email}`}>{embarkContact.email}</a>
          </div>
        </section>
      </div>
    </article>
  )
}
