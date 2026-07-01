/*
 * Public leaderboard. Ported from leaderboard.html: league filter, search,
 * sortable columns, pagination, stats strip. Ranked mode (the API serves the
 * latest ranked season).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { leaderboardApi, LEAGUE_FILTERS } from '@/api/leaderboard'
import type { LeaderboardEntry } from '@/types/leaderboard'
import styles from './Leaderboard.module.css'

type SortKey = 'rank' | 'name' | 'league' | 'rankScore'

const LEAGUE_COLORS: Record<string, string> = {
  Ruby: '#c0392b',
  'Diamond 1': '#0077b6',
  'Diamond 2': '#0096c7',
  'Diamond 3': '#00b4d8',
  'Diamond 4': '#48cae4',
  'Platinum 1': '#7b8fa1',
  'Platinum 2': '#5c677d',
}

const fmt = (n: number) => Number(n).toLocaleString()

export function Leaderboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: leaderboardApi.get,
  })

  const [league, setLeague] = useState('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState(1)

  const all = data?.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = all.filter((p) => {
      if (league !== 'All' && p.league !== league) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return typeof av === 'string' ? av.localeCompare(String(bv)) * sortDir : ((av as number) - (bv as number)) * sortDir
      })
    }
    return rows
  }, [all, league, search, sortKey, sortDir])

  const stats = useMemo(() => {
    const top = all[0]
    return {
      total: all.length,
      topScore: top ? fmt(top.rankScore ?? 0) : '—',
      topPlayer: top ? top.name.split('#')[0] : '—',
      ruby: all.filter((p) => p.league === 'Ruby').length,
    }
  }, [all])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * perPage
  const slice = filtered.slice(start, start + perPage)

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d * -1)
    else {
      setSortKey(key)
      setSortDir(key === 'rank' ? 1 : -1)
    }
    setPage(1)
  }

  const sortIcon = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? '↑' : '↓') : '↕')

  return (
    <div className={styles.page}>
      <PageHeader
        title="Leaderboard"
        subtitle={
          <>
            {data && <span className={styles.subtitle}>Season {data.season} · Ranked</span>}
            {data?.updated && (
              <span className={styles.updated} style={{ display: 'block' }}>
                Last updated: {new Date(data.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </>
        }
      />

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Total Players</div>
          <div className={styles.statValue}>{fmt(stats.total)}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Top RS</div>
          <div className={styles.statValue}>{stats.topScore}</div>
          <div className={styles.statSub}>{stats.topPlayer}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Ruby Players</div>
          <div className={styles.statValue}>{fmt(stats.ruby)}</div>
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.filters}>
          {LEAGUE_FILTERS.map((l) => (
            <button
              key={l}
              className={`${styles.filter} ${league === l ? styles.filterActive : ''}`}
              onClick={() => {
                setLeague(l)
                setPage(1)
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className={styles.search}>
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search player…" />
        </div>
        <div className={styles.perPage}>
          <span>Show</span>
          <select
            className="lb-select"
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
            style={{ background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px' }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}>
          <Spinner />
        </div>
      ) : isError ? (
        <ErrorState message="Failed to load leaderboard data." onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="fas fa-trophy" title="No players match your filters" />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th onClick={() => setSort('rank')}>#<span className={styles.sortIcon}>{sortIcon('rank')}</span></th>
                  <th>±</th>
                  <th onClick={() => setSort('name')}>Player<span className={styles.sortIcon}>{sortIcon('name')}</span></th>
                  <th onClick={() => setSort('league')}>League<span className={styles.sortIcon}>{sortIcon('league')}</span></th>
                  <th onClick={() => setSort('rankScore')}>Rank Score<span className={styles.sortIcon}>{sortIcon('rankScore')}</span></th>
                  <th>Club</th>
                  <th>Platforms</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((p) => (
                  <Row key={`${p.rank}-${p.name}`} p={p} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className={styles.pagination}>
            <div className={styles.pageInfo}>
              Showing {fmt(start + 1)}–{fmt(Math.min(start + perPage, filtered.length))} of {fmt(filtered.length)} players
            </div>
            <div className={styles.pageBtns}>
              <button className={styles.pageBtn} disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>‹</button>
              {buildPageList(safePage, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--text-subtle)' }}>…</span>
                ) : (
                  <button
                    key={p}
                    className={`${styles.pageBtn} ${p === safePage ? styles.pageCurrent : ''}`}
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button className={styles.pageBtn} disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>›</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ p }: { p: LeaderboardEntry }) {
  const [namePart, tagPart] = p.name.includes('#') ? p.name.split('#') : [p.name, '']
  const rankClass = p.rank === 1 ? styles.rank1 : p.rank === 2 ? styles.rank2 : p.rank === 3 ? styles.rank3 : ''
  const badgeColor = LEAGUE_COLORS[p.league]

  return (
    <tr>
      <td>
        <span className={`${styles.rankNum} ${rankClass}`}>#{fmt(p.rank)}</span>
      </td>
      <td>
        {p.change !== undefined && (
          <span className={`${styles.change} ${p.change > 0 ? styles.up : p.change < 0 ? styles.down : styles.same}`}>
            {p.change > 0 ? `▲${p.change}` : p.change < 0 ? `▼${Math.abs(p.change)}` : '—'}
          </span>
        )}
      </td>
      <td>
        {namePart}
        {tagPart && <span className={styles.playerTag}>#{tagPart}</span>}
      </td>
      <td>
        <span className={styles.leagueBadge} style={badgeColor ? { background: badgeColor } : undefined}>
          {p.league}
        </span>
      </td>
      <td className={styles.score}>{fmt(p.rankScore ?? 0)} RS</td>
      <td>{p.clubTag && <span className={styles.clubTag}>{p.clubTag}</span>}</td>
      <td>
        <div className={styles.platforms}>
          {p.steamName && <img className={styles.platformIcon} src="https://cdn.simpleicons.org/steam/a1a1aa" alt="Steam" title={p.steamName} />}
          {p.psnName && <img className={styles.platformIcon} src="https://cdn.simpleicons.org/playstation/a1a1aa" alt="PlayStation" title={p.psnName} />}
          {p.xboxName && <img className={styles.platformIcon} src="https://cdn.simpleicons.org/xbox/a1a1aa" alt="Xbox" title={p.xboxName} />}
        </div>
      </td>
    </tr>
  )
}

function buildPageList(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (cur <= 4) return [1, 2, 3, 4, 5, '…', total]
  if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total]
  return [1, '…', cur - 1, cur, cur + 1, '…', total]
}
