/*
 * Bot documentation page. Ported from docs.html — sidebar nav + command
 * reference (account management, custom commands, variable references,
 * predictions, utility commands). Public, rendered under AppLayout.
 */
import type { ReactNode } from 'react'
import styles from './Docs.module.css'

const NAV = [
  { group: 'Getting Started', links: [['overview', 'Overview'], ['linking', 'Account Management']] },
  { group: 'Configuration', links: [['customizing', 'Customizing Commands']] },
  {
    group: 'Command Reference',
    links: [
      ['rank-vars', '!rank'],
      ['record-vars', '!record'],
      ['peak-vars', '!peak'],
      ['drops-cmd', '!drops'],
      ['goals', '!goal'],
      ['predict', '!predict'],
      ['predictions', 'Predictions'],
    ],
  },
  { group: 'General', links: [['general', 'Utility Commands']] },
]

const DISCORD = 'https://discord.com/invite/2UKzvzSEqA'

export function Docs() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <nav>
          {NAV.map((g) => (
            <div className={styles.navGroup} key={g.group}>
              <h4>{g.group}</h4>
              <ul>
                {g.links.map(([id, label]) => (
                  <li key={id}>
                    <a className={styles.navLink} href={`#${id}`}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className={styles.navGroup}>
            <h4>Support</h4>
            <ul>
              <li><a className={styles.navLink} href={DISCORD} target="_blank" rel="noreferrer">Discord Support</a></li>
            </ul>
          </div>
        </nav>
      </aside>

      <main>
        <header className={styles.header}>
          <div className={styles.breadcrumbs}>
            <span>Documentation</span>
            <span>›</span>
            <span style={{ color: 'var(--text-main)' }}>Bot Commands</span>
          </div>
          <h1 id="overview">Bot Documentation</h1>
          <p className={styles.subtitle}>
            Comprehensive guide to managing and customizing your FinalsRS Twitch bot experience.
          </p>
        </header>

        <Section id="linking" tag="Essentials" title="Account Management">
          <p>
            To start tracking your stats, you must link your <strong>THE FINALS</strong> account.
            Your Twitch account is linked automatically when you log in to the dashboard.
          </p>
          <CmdTable
            rows={[
              [<code>!link &lt;FinalsName#1234&gt;</code>, 'Links your THE FINALS account to the bot.'],
              [<code>!unlink</code>, 'Removes the link to your account.'],
            ]}
          />
        </Section>

        <Section id="customizing" tag="Advanced" title="Customizing Commands">
          <p>
            FinalsRS lets you fully customize how the bot responds to commands like <code>!rank</code>,{' '}
            <code>!record</code>, and <code>!peak</code>. Variables wrapped in curly braces (e.g.{' '}
            <code>{'{rank}'}</code>) are replaced with real player data.
          </p>
          <h3>The !editcmd Command</h3>
          <p>Use <code>!editcmd</code> followed by the command name and your new message template.</p>
          <CodeExample
            lines={[
              { comment: '// Set a custom rank message with flavor text' },
              { cmd: '!editcmd rank', rest: " Currently grinding at #{rank} with {rankScore} RS! Let's get it! 🔥" },
            ]}
          />
          <p>
            To reset a command to its default behavior, type <code>!editcmd &lt;command&gt;</code>{' '}
            without a message.
          </p>
        </Section>

        <Section id="rank-vars" tag="Reference" title="!rank Command">
          <p>Displays current ranked leaderboard rank, league, and Rank Score.</p>
          <VarGrid
            vars={[
              ['{username}', 'The Twitch user who called the command.'],
              ['{rank}', 'Current leaderboard rank (e.g. #450).'],
              ['{league}', 'Current league (e.g. Diamond 3).'],
              ['{rankScore}', 'Current Rank Score (RS) value.'],
            ]}
          />
        </Section>

        <Section id="record-vars" tag="Reference" title="!record Command">
          <p>Tracks session progress (RS gained/lost) since you went live.</p>
          <VarGrid
            vars={[
              ['{sessionRS}', 'RS gained or lost this session (e.g. +120).'],
              ['{currentRS}', 'Your total current RS.'],
              ['{startRS}', 'Your RS at the start of the stream.'],
            ]}
          />
        </Section>

        <Section id="peak-vars" tag="Reference" title="!peak Command">
          <p>Displays all-time highest achievements recorded by the system.</p>
          <VarGrid
            vars={[
              ['{rank}', 'Highest rank ever achieved.'],
              ['{league}', 'League of peak rank (e.g. Diamond 1).'],
              ['{rankScore}', 'Peak Rank Score (RS) value.'],
              ['{season}', 'The season the peak was achieved.'],
            ]}
          />
        </Section>

        <Section id="drops-cmd" tag="Information" title="!drops Command">
          <p>Stay updated with active Twitch drops for THE FINALS.</p>
          <VarGrid
            vars={[
              ['!drops', 'Lists current active drops and their durations.'],
              ['!drop', 'Alias for the drops command.'],
            ]}
          />
        </Section>

        <Section id="goals" tag="Utility" title="Rank Goals">
          <p>The <code>!goal</code> system helps you track progress toward a specific leaderboard position.</p>
          <CmdTable
            rows={[
              [<code>!goal &lt;rank&gt;</code>, <>Set a target rank (e.g. <code>!goal 100</code>)</>],
              [<code>!goal</code>, 'Display current goal progress & percentage.'],
              [<code>!goal remove</code>, 'Clear your current active goal.'],
            ]}
          />
        </Section>

        <Section id="predict" tag="Premium / Tester" premium title="Predict Cutoff">
          <p>The <code>!predict</code> command uses historical T500 trends to forecast future leaderboard cutoffs.</p>
          <CodeExample lines={[{ comment: '// Forecast the cutoff in 30 days' }, { cmd: '!predict 30' }]} />
        </Section>

        <Section id="predictions" tag="Twitch Affiliate / Partner" title="Channel Points Predictions">
          <p>
            Create reusable Twitch Channel Points prediction presets and operate them from the{' '}
            <strong>Predictions</strong> dashboard page or directly from Twitch chat. The broadcaster
            must reauthorize FinalsRS with <code>channel:manage:predictions</code> first.
          </p>

          <h3>Manual Prediction Presets</h3>
          <p>
            The broadcaster manages presets. The broadcaster or a Twitch moderator may start, resolve,
            or cancel a prediction.
          </p>
          <CodeExample
            lines={[
              { comment: '// Create or overwrite a preset' },
              { cmd: '!preset p add ranked | How will ranked go? | Down | Even | Up | 600' },
              { spacer: true },
              { comment: '// List, inspect, or delete presets' },
              { cmd: '!preset p list' },
              { cmd: '!preset p show ranked' },
              { cmd: '!preset p delete ranked' },
              { spacer: true },
              { comment: '// Operate the prediction' },
              { cmd: '!start p ranked' },
              { cmd: '!end p 2' },
              { cmd: '!end p Even' },
              { cmd: '!cancel p' },
            ]}
          />
          <CmdTable
            head={['Limit', 'Requirement']}
            rows={[
              ['Alias', <>One word using letters, numbers, <code>_</code>, or <code>-</code>.</>],
              ['Question', '1-45 characters.'],
              ['Outcomes', '2-5 unique outcomes, up to 25 characters each.'],
              ['Voting window', '30-1,800 seconds.'],
            ]}
          />
          <p>Questions and outcomes are checked against FinalsRS content filters. Canceling refunds participating viewers.</p>

          <h3>Automatic Ranked Predictions</h3>
          <span className={`${styles.tag} ${styles.tagPremium}`}>Subscribers and test users</span>
          <p style={{ marginTop: 12 }}>
            Automatic ranked predictions are an early-access beta for active subscribers and approved
            test roles. Configure them below the manual controls on the dashboard Predictions page.
          </p>
          <p>
            Choose <strong>Whole stream RS change</strong> for one prediction settled when the stream
            ends, or <strong>Next ranked result</strong> for repeating <strong>Gain RS</strong> /{' '}
            <strong>Lose RS</strong> predictions. Both modes wait for the configured delay and require
            the stream to be live in <strong>THE FINALS</strong>.
          </p>
          <CodeExample
            lines={[
              { comment: '// Bypass only the configured timer' },
              { cmd: '!rankpred start' },
              { spacer: true },
              { comment: '// Check the current automation state' },
              { cmd: '!rankpred status' },
              { spacer: true },
              { comment: '// Cancel and refund the automatic prediction' },
              { cmd: '!rankpred cancel' },
            ]}
          />
        </Section>

        <Section id="general" tag="Utility" title="Utility Commands">
          <p>Standard commands for interacting with the bot and discovering available features.</p>
          <CmdTable
            rows={[
              [<code>!commands</code>, 'Lists all available commands for the channel.'],
              [<code>!help [command]</code>, 'Get detailed usage info for a specific command.'],
              [<code>!ping</code>, 'Check if the bot is responsive and view latency.'],
            ]}
          />
        </Section>

        <footer className={styles.footerCta}>
          <h2>Still have questions?</h2>
          <p>Join our developer and streamer community on Discord.</p>
          <a className="btn btn-primary" href={DISCORD} target="_blank" rel="noreferrer">
            <i className="fa-brands fa-discord" /> Join Discord Server
          </a>
        </footer>
      </main>
    </div>
  )
}

function Section({ id, tag, premium, title, children }: { id: string; tag: string; premium?: boolean; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section}>
      <span className={`${styles.tag} ${premium ? styles.tagPremium : ''}`}>{tag}</span>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function CmdTable({ head = ['Command', 'Description'], rows }: { head?: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{head[0]}</th>
            <th>{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VarGrid({ vars }: { vars: [string, string][] }) {
  return (
    <div className={styles.varGrid}>
      {vars.map(([code, desc]) => (
        <div className={styles.varCard} key={code}>
          <span className={styles.varCode}>{code}</span>
          <span className={styles.varDesc}>{desc}</span>
        </div>
      ))}
    </div>
  )
}

interface CodeLine {
  comment?: string
  cmd?: string
  rest?: string
  spacer?: boolean
}
function CodeExample({ lines }: { lines: CodeLine[] }) {
  return (
    <div className={styles.codeExample}>
      {lines.map((l, i) =>
        l.spacer ? (
          <br key={i} />
        ) : (
          <div key={i}>
            {l.comment && <span className={styles.comment}>{l.comment}</span>}
            {l.cmd && <span className={styles.cmd}>{l.cmd}</span>}
            {l.rest && <span>{l.rest}</span>}
          </div>
        ),
      )}
    </div>
  )
}
