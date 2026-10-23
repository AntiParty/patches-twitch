/*
 * Admin → Live Players (experimental). Ranked players whose RS moved recently,
 * read from the leaderboard history. "Live" trails real play by up to one board
 * refresh (~15 min). Consumes /admin/api/operations/live-players.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { StatCard } from '@/components/cards/StatCard'
import { Select } from '@/components/forms/Select'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import type { LivePlayersReport } from '@/types/admin'
import styles from './admin.module.css'

const WINDOWS = [
  { value: '15', label: 'Last 15 min' },
  { value: '30', label: 'Last 30 min' },
  { value: '60', label: 'Last hour' },
  { value: '180', label: 'Last 3 hours' },
]

const TOPS = [
  { value: '100', label: 'Top 100' },
  { value: '500', label: 'Top 500' },
  { value: '1000', label: 'Top 1,000' },
  { value: '10000', label: 'Top 10,000' },
]

const fmt = (n: number) => n.toLocaleString()

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ${min % 60}m ago`
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className={styles.subtle}>±0</span>
  return <span className={value > 0 ? styles.gain : styles.loss}>{value > 0 ? '+' : '−'}{fmt(Math.abs(value))}</span>
}

export function LivePlayers() {
  const [windowMinutes, setWindowMinutes] = useState('30')
  const [top, setTop] = useState('500')
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'live-players', windowMinutes, top],
    queryFn: () => adminApi.getLivePlayers(Number(windowMinutes), Number(top)),
    refetchInterval: 60_000,
  })

  return (
    <>
      <PageHeader
        title="Live Players"
        subtitle="Experimental. Ranked players whose RS changed recently. The board refreshes about every 15 minutes, so this trails real play and can't see a match in progress."
        actions={
          <div className={styles.liveFilters}>
            <div style={{ width: 150 }}>
              <Select value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} options={WINDOWS} />
            </div>
            <div style={{ width: 140 }}>
              <Select value={top} onChange={(e) => setTop(e.target.value)} options={TOPS} />
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spinner /></div>
      ) : isError || !data ? (
        <ErrorState message="Failed to load live players." onRetry={() => refetch()} />
      ) : (
        <LivePlayersView data={data} search={search} onSearch={setSearch} />
      )}
    </>
  )
}

function LivePlayersView({ data, search, onSearch }: { data: LivePlayersReport; search: string; onSearch: (v: string) => void }) {
  const now = new Date(data.generatedAt).getTime()
  const q = search.trim().toLowerCase()
  const players = q
    ? data.players.filter((p) => p.name.toLowerCase().includes(q) || p.clubTag.toLowerCase().includes(q))
    : data.players
  const windowLabel = WINDOWS.find((w) => w.value === String(data.windowMinutes))?.label.toLowerCase() ?? `last ${data.windowMinutes} min`

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Active (top 10k)" value={fmt(data.totals.active)} hint={windowLabel} icon="fas fa-signal" />
        <StatCard label="Active in top 500" value={fmt(data.totals.top500)} hint={windowLabel} icon="fas fa-ranking-star" />
        <StatCard label="Active in top 100" value={fmt(data.totals.top100)} hint={windowLabel} icon="fas fa-crown" />
        <StatCard
          label="Last board change"
          value={data.lastSnapshotAt ? ago(data.lastSnapshotAt, now) : '—'}
          hint={data.season ? `Season ${data.season}` : 'no history yet'}
          icon="fas fa-clock-rotate-left"
        />
      </div>

      <Card
        title={`Playing now · top ${fmt(data.top)}`}
        subtitle="RS change is since just before the window. Moves = board refreshes where their RS changed (each can hold several games)."
        headerActions={<div style={{ width: 220 }}><SearchBar value={search} onChange={onSearch} placeholder="Name or club…" /></div>}
      >
        {players.length === 0 ? (
          <EmptyState
            icon="fas fa-user-clock"
            title={q ? 'No matching players' : `No one in the top ${fmt(data.top)} moved in the ${windowLabel}`}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.num}>Rank</th>
                  <th>Player</th>
                  <th>League</th>
                  <th className={styles.num}>RS</th>
                  <th className={styles.num}>Change</th>
                  <th className={styles.num}>Moves</th>
                  <th>Last moved</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.name}>
                    <td className={styles.num}>{fmt(p.rank)}</td>
                    <td>
                      {p.name}
                      {p.clubTag && <span className={styles.subtle}> [{p.clubTag}]</span>}
                    </td>
                    <td className={styles.subtle}>{p.league}</td>
                    <td className={styles.num}>{fmt(p.rankScore)}</td>
                    <td className={styles.num}><Delta value={p.delta} /></td>
                    <td className={styles.num}>{p.moves}</td>
                    <td className={styles.subtle} title={new Date(p.lastMoveAt).toLocaleString()}>{ago(p.lastMoveAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
