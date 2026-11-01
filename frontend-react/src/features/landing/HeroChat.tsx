/*
 * Hero product preview — a static Twitch chat panel where viewers run real
 * commands and the bot answers in its actual reply formats (see
 * src/commands/rank.ts, record.ts, predict.ts).
 *
 * Live data: !predict always uses /api/rs-prediction. Set FEATURED.ign and
 * !rank shows that streamer's real leaderboard line in their own chat;
 * until then (or if they drop off the board) the panel uses sample viewers.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/api'
import { leaderboardApi } from '@/api/leaderboard'
import styles from './Landing.module.css'

/** Featured channel for the hero chat. ign: exact leaderboard name, e.g. "Name#1234". */
const FEATURED = { login: 'ekazoko', display: 'Ekazoko', ign: 'EkaZo#5318' as string | null }

type Prediction = { safeRS?: number; dailyChange?: number; remainingDays?: number; model?: string }

type Part = string | { gain: string }
type Line =
  | { kind: 'viewer'; name: string; color: string; text: string }
  | { kind: 'bot'; parts: Part[] }

const n = (v: number) => v.toLocaleString('en-US')

function predictLine(p: Prediction | undefined): string {
  if (!p?.safeRS || !p.remainingDays) return 'T500 Cutoff (12d): ~43,500 RS | +180/day'
  const trend =
    p.model !== 'historical' && p.dailyChange
      ? ` | ${p.dailyChange > 0 ? '+' : ''}${n(p.dailyChange)}/day`
      : ''
  return `T500 Cutoff (${p.remainingDays}d): ~${n(p.safeRS)} RS${trend}`
}

export function HeroChat() {
  const { data: prediction } = useQuery({
    queryKey: ['rs-prediction'],
    queryFn: () => api.get<Prediction>('/api/rs-prediction'),
    staleTime: 10 * 60_000,
    retry: false,
  })

  const { data: board } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: leaderboardApi.get,
    enabled: FEATURED.ign != null,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const player = FEATURED.ign
    ? board?.data.find((e) => e.name.toLowerCase() === FEATURED.ign!.toLowerCase())
    : undefined

  // Extra live exchanges from the same leaderboard payload: a lookup of #1
  // and the !t500 cutoff (formats from rank.ts and top500.ts).
  const top = board?.data.find((e) => e.rank === 1)
  const cutoff = board?.data.find((e) => e.rank === 500)

  const lines: Line[] = player
    ? [
        { kind: 'viewer', name: 'kestrel_yt', color: '#ff7f50', text: '!rank' },
        {
          kind: 'bot',
          parts: [
            `@kestrel_yt, current rank is #${n(player.rank)} (${player.league}) - ${n(player.rankScore ?? 0)} RS`,
          ],
        },
        ...(top && top.name !== player.name
          ? ([
              { kind: 'viewer', name: 'mossbyte', color: '#2fbf8f', text: `!rank ${top.name}` },
              {
                kind: 'bot',
                parts: [`@mossbyte, ${top.name} is #1 (${top.league}) - ${n(top.rankScore ?? 0)} RS`],
              },
            ] satisfies Line[])
          : []),
        ...(cutoff?.rankScore
          ? ([
              { kind: 'viewer', name: 'pixelfern', color: '#daa520', text: '!t500' },
              {
                kind: 'bot',
                parts: [
                  `S${board!.season} Top 500 cutoff: #500 has ${n(cutoff.rankScore)} RS (${cutoff.name}) | Latest cached leaderboard; ties may affect placement.`,
                ],
              },
            ] satisfies Line[])
          : []),
        // Live chat only shows a real cutoff; skip the exchange while it's pending.
        ...(prediction?.safeRS
          ? ([
              { kind: 'viewer', name: 'lowtide', color: '#8a7cff', text: '!predict' },
              { kind: 'bot', parts: [predictLine(prediction)] },
            ] satisfies Line[])
          : []),
      ]
    : [
        { kind: 'viewer', name: 'kestrel_yt', color: '#ff7f50', text: '!rank' },
        {
          kind: 'bot',
          parts: ['@kestrel_yt, current rank is #212 (Diamond 1) - 41,870 RS. 1,630 RS away from Ruby'],
        },
        { kind: 'viewer', name: 'mossbyte', color: '#2fbf8f', text: '!record' },
        { kind: 'bot', parts: ['@mossbyte, session RS: ', { gain: '+1,245' }, ' (41,870 RS)'] },
        { kind: 'viewer', name: 'lowtide', color: '#8a7cff', text: '!predict' },
        { kind: 'bot', parts: [predictLine(prediction)] },
      ]

  return (
    <figure className={styles.chat} aria-label="Example Twitch chat with FinalsRS replies">
      <header className={styles.chatHeader}>
        {player ? (
          <span className={styles.chatChannel}>
            <img src={`https://unavatar.io/twitch/${FEATURED.login}`} alt="" width={20} height={20} />
            {FEATURED.display}
          </span>
        ) : (
          <span />
        )}
        <span>Stream chat</span>
        <span />
      </header>
      <ol className={styles.chatLines}>
        {lines.map((line, i) =>
          line.kind === 'viewer' ? (
            <li key={i} className={styles.chatLine}>
              <span className={styles.chatName} style={{ color: line.color }}>
                {line.name}
              </span>
              <span className={styles.chatColon}>: </span>
              <span>{line.text}</span>
            </li>
          ) : (
            <li key={i} className={styles.chatLine}>
              <BotBadge />
              <span className={styles.chatName} style={{ color: '#ef4b4b' }}>
                FinalsRS
              </span>
              <span className={styles.chatColon}>: </span>
              <span>
                {line.parts.map((p, j) =>
                  typeof p === 'string' ? p : <b key={j} className={styles.chatGain}>{p.gain}</b>,
                )}
              </span>
            </li>
          ),
        )}
      </ol>
      <div className={styles.chatComposer} aria-hidden="true">
        <span className={styles.chatInput}>Send a message</span>
        <span className={styles.chatSend}>Chat</span>
      </div>
    </figure>
  )
}

/** Moderator-style badge, the way bots usually appear in Twitch chat. */
function BotBadge() {
  return (
    <svg className={styles.chatBadge} viewBox="0 0 18 18" width={18} height={18} aria-label="Moderator">
      <rect width="18" height="18" rx="3" fill="#00ad03" />
      <path d="M12.6 3.6 14.4 5.4 8.7 11.1 9.6 12 8.4 13.2 7.5 12.3 5.4 14.4 3.6 12.6 5.7 10.5 4.8 9.6 6 8.4 6.9 9.3z" fill="#fff" />
    </svg>
  )
}
