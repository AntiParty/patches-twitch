/*
 * Landing / marketing page. Ported from frontend/views/index.html.
 * Self-contained (own nav + footer) because it has a distinct visual identity.
 * Auth-aware: the login CTA becomes "Go to Dashboard" when signed in.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Reveal } from '@/components/Reveal'
import styles from './Landing.module.css'

const LOGO = '/assets/logo.png'

export function Landing() {
  const { isAuthenticated } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const primaryCtaHref = isAuthenticated ? '/dashboard' : '/login'
  const primaryCtaLabel = isAuthenticated ? 'Go to Dashboard' : 'Add to Twitch'

  return (
    <div className={styles.page}>
      {/* Nav */}
      <nav className={styles.navbar}>
        <div className={styles.navContainer}>
          <a className={styles.logo} href="/" aria-label="FinalsRS home">
            <span className={styles.logoIcon}>
              <img src={LOGO} alt="" />
            </span>
            FinalsRS
          </a>
          <div className={`${styles.navLinks} ${menuOpen ? styles.isOpen : ''}`}>
            <Link to="/leaderboard">Leaderboard</Link>
            <a href="/twitch-drops">Drops</a>
            <a href="/docs">Docs</a>
            {isAuthenticated ? (
              <a href="/dashboard" className={styles.btnLogin}>
                Dashboard
              </a>
            ) : (
              <a href="/login" className={styles.btnLogin}>
                Log in
              </a>
            )}
          </div>
          <button
            className={styles.mobileMenuBtn}
            type="button"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className={`${styles.hero} ${styles.landingHero}`}>
          <div className={`${styles.container} ${styles.heroLayout}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Unofficial ranked utility for THE FINALS</p>
              <h1>A quiet bot for loud ranked nights.</h1>
              <p className={styles.subtitle}>
                FinalsRS lets Twitch chat check RS, peak rank, session changes, and T500
                predictions while you stay in the match.
              </p>
              <div className={styles.ctaGroup}>
                <a href={primaryCtaHref} className={styles.btnPrimary}>
                  {primaryCtaLabel}
                </a>
                <a href="/docs" className={styles.btnSecondary}>
                  View commands
                </a>
              </div>
              <div className={styles.heroFacts} aria-label="FinalsRS highlights">
                <div>
                  <span className={styles.factValue}>30 sec</span>
                  <span className={styles.factLabel}>typical setup</span>
                </div>
                <div>
                  <span className={styles.factValue}>Live</span>
                  <span className={styles.factLabel}>rank lookups</span>
                </div>
                <div>
                  <span className={styles.factValue}>Free</span>
                  <span className={styles.factLabel}>for channels</span>
                </div>
              </div>
            </div>

            <Reveal className={styles.consolePanel} aria-label="Example Twitch command output">
              <div className={styles.consoleTopbar}>
                <span>Stream chat</span>
                <span className={styles.statusPill}>Connected</span>
              </div>
              <div className={styles.consoleBody}>
                <div className={styles.chatLine}>
                  <span className={styles.timestamp}>12:01</span>
                  <span className={`${styles.username} ${styles.user1}`}>Viewer77:</span>
                  <span className={styles.message}>!rank</span>
                </div>
                <div className={styles.chatLine}>
                  <span className={styles.timestamp}>12:01</span>
                  <img src={LOGO} className={styles.botBadge} alt="" />
                  <span className={`${styles.username} ${styles.botName}`}>FinalsRS:</span>
                  <span className={styles.message}>
                    <span className={styles.mention}>@Viewer77</span> Diamond 3, 43,331 RS
                  </span>
                </div>
                <div className={styles.statsGrid} aria-label="Sample ranked stats">
                  <div className={styles.statTile}>
                    <span>RS</span>
                    <strong>43,331</strong>
                  </div>
                  <div className={`${styles.statTile} ${styles.positive}`}>
                    <span>Session</span>
                    <strong>+145</strong>
                  </div>
                </div>
                <div className={styles.chatLine}>
                  <span className={styles.timestamp}>12:08</span>
                  <span className={`${styles.username} ${styles.user2}`}>ModCheck:</span>
                  <span className={styles.message}>!predict</span>
                </div>
                <div className={styles.chatLine}>
                  <span className={styles.timestamp}>12:08</span>
                  <img src={LOGO} className={styles.botBadge} alt="" />
                  <span className={`${styles.username} ${styles.botName}`}>FinalsRS:</span>
                  <span className={styles.message}>
                    Current T500 pace: 43.7k RS. You are inside the line.
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Setup steps */}
        <section className={styles.setupStrip} aria-label="Setup steps">
          <div className={`${styles.container} ${styles.setupGrid}`}>
            <Reveal className={styles.setupStep}>
              <span>01</span>
              <h2>Connect Twitch</h2>
              <p>Sign in once and add FinalsRS to your channel.</p>
            </Reveal>
            <Reveal className={styles.setupStep}>
              <span>02</span>
              <h2>Link your IGN</h2>
              <p>
                Use <code>!link Name#1234</code> so the bot knows who to track.
              </p>
            </Reveal>
            <Reveal className={styles.setupStep}>
              <span>03</span>
              <h2>Let chat ask</h2>
              <p>Viewers use ranked commands without interrupting your queue.</p>
            </Reveal>
          </div>
        </section>

        {/* Commands */}
        <section id="features" className={styles.commandsSection}>
          <div className={`${styles.container} ${styles.sectionGrid}`}>
            <Reveal className={styles.sectionIntro}>
              <p className={styles.eyebrow}>Commands that answer real stream questions</p>
              <h2>Less dashboard theater. More useful chat output.</h2>
              <p>
                The bot is built around the moments viewers already ask about: current rank, peak
                rank, session movement, and whether the next game matters.
              </p>
            </Reveal>
            <Reveal className={styles.commandList}>
              {COMMANDS.map((c) => (
                <div className={styles.commandItem} key={c.cmd}>
                  <code>{c.cmd}</code>
                  <div>
                    <h3>{c.title}</h3>
                    <p>{c.desc}</p>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* Proof */}
        <section id="community" className={styles.proofSection}>
          <div className={`${styles.container} ${styles.proofLayout}`}>
            <Reveal className={styles.proofCard}>
              <p className={styles.quote}>
                "Finally a Twitch bot that is not bloated. It does exactly what it needs to do."
              </p>
              <div className={styles.proofAuthor}>
                <img
                  src="https://static-cdn.jtvnw.net/jtv_user_pictures/51a63b23-bb89-41be-ba7b-5a145a1a7bf6-profile_image-70x70.png"
                  alt="Antiparty"
                />
                <div>
                  <strong>Antiparty</strong>
                  <span>THE FINALS creator</span>
                </div>
              </div>
            </Reveal>
            <Reveal className={styles.proofCopy}>
              <p className={styles.eyebrow}>Built for the pace of ranked</p>
              <h2>Quiet when you do not need it. Fast when chat does.</h2>
              <p>
                FinalsRS stays out of the stream until someone asks. Then it gives a clean answer
                your viewers can read before the next fight starts.
              </p>
              <Link to="/leaderboard" className={styles.textLink}>
                Check the leaderboard
              </Link>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className={styles.ctaSection}>
          <Reveal className={`${styles.container} ${styles.ctaBox}`}>
            <div>
              <p className={styles.eyebrow}>Ready when your next queue pops</p>
              <h2>Add FinalsRS to your Twitch channel.</h2>
            </div>
            <a href={primaryCtaHref} className={`${styles.btnPrimary} ${styles.large}`}>
              {isAuthenticated ? 'Go to Dashboard' : 'Get started free'}
            </a>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div className={styles.footerCol}>
            <h3>FinalsRS</h3>
            <p>The unofficial Twitch companion bot for THE FINALS ranked stats.</p>
          </div>
          <div className={styles.footerCol}>
            <h4>Product</h4>
            <a href="/docs">Commands</a>
            <Link to="/leaderboard">Leaderboard</Link>
            <a href="/twitch-drops">Drops</a>
          </div>
          <div className={styles.footerCol}>
            <h4>Resources</h4>
            <a href="/docs">Documentation</a>
            <a href="https://discord.com/invite/2UKzvzSEqA" target="_blank" rel="noreferrer">
              Support
            </a>
          </div>
          <div className={styles.footerCol}>
            <h4>Legal</h4>
            <a href="/legal">Privacy</a>
            <a href="/legal#terms">Terms</a>
          </div>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <p>&copy; {new Date().getFullYear()} FinalsRS. Not affiliated with Embark Studios.</p>
        </div>
      </footer>
    </div>
  )
}

const COMMANDS = [
  { cmd: '!rank', title: 'Current ranked state', desc: 'RS and league in one compact response.' },
  { cmd: '!record', title: 'Stream session movement', desc: 'Track RS gained or lost since the stream started.' },
  { cmd: '!peak', title: 'Best season result', desc: 'Show peak rank and RS without opening another tab.' },
  { cmd: '!predict', title: 'T500 pressure check', desc: 'Estimate the cutoff and give chat a reason to care.' },
]
