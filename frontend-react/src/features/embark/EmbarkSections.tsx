import {
  embarkBuilder,
  embarkCapabilities,
  embarkComparison,
  embarkHowItWorks,
  embarkProposals,
} from './embarkBriefing'
import styles from './Embark.module.css'

export function EmbarkCapabilities() {
  return (
    <section className={styles.section} aria-labelledby="unlocks-title">
      <p className={styles.sectionLabel}>What exists</p>
      <h2 id="unlocks-title" className={styles.sectionTitle}>
        What FinalsRS does, and where to see it
      </h2>
      <ul className={styles.capabilities}>
        {embarkCapabilities.map((capability) => (
          <li key={capability.title}>
            <h3>{capability.title}</h3>
            <p>{capability.description}</p>
            {capability.href && (
              <a className={styles.seeLive} href={capability.href}>
                {capability.hrefLabel}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function EmbarkAsk() {
  return (
    <>
      <section className={styles.section} aria-labelledby="how-title">
        <p className={styles.sectionLabel}>How it works today</p>
        <h2 id="how-title" className={styles.sectionTitle}>
          Built on the public leaderboard, and what official data would change
        </h2>
        <p className={styles.lede}>{embarkHowItWorks}</p>
        <table className={styles.compare}>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Today</th>
              <th scope="col">With official data</th>
            </tr>
          </thead>
          <tbody>
            {embarkComparison.map((row) => (
              <tr key={row.topic}>
                <th scope="row">{row.topic}</th>
                <td data-label="Today">{row.today}</td>
                <td data-label="With official data">{row.withOfficialData}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.section} aria-labelledby="ask-title">
        <p className={styles.sectionLabel}>The ask</p>
        <h2 id="ask-title" className={styles.sectionTitle}>
          Three ways to work together
        </h2>
        <div className={styles.featureRow}>
          {embarkProposals.map((item) => (
            <div key={item.title} className={styles.feature}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
        <p className={styles.builder}>{embarkBuilder}</p>
      </section>
    </>
  )
}
