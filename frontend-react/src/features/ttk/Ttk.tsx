/*
 * Public time-to-kill page: filters (kept in the URL), a bar chart, the same
 * data as a sortable table, recent applied balance changes, and the data credit.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/forms/Select'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ttkApi } from '@/api/ttk'
import type { Build } from '@/types/ttk'
import { Badge } from '@/components/data-display/Badge'
import { MAX_RANGE_M, bySeconds, selectPoints, type ClassFilter, type Hit, type TtkPoint } from './ttkData'
import { CLASS_COLORS, TtkChart, useIsNarrow } from './TtkChart'
import { SERIES_COLORS, TtkRangeChart } from './TtkRangeChart'
import styles from './Ttk.module.css'

const BUILDS: Build[] = ['Light', 'Medium', 'Heavy']
const CLASS_FILTERS: ClassFilter[] = ['All', ...BUILDS]

type SortKey = 'weapon' | 'cls' | 'wtype' | 'mode' | 'falloff' | 'shots' | 'seconds'

const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

const MAX_LINES = 3

const fmtNum = (n: number | null) => (n == null ? '—' : String(Number(n.toFixed(3))))
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null

export function Ttk() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['ttk'], queryFn: ttkApi.get })
  const [params, setParams] = useSearchParams()

  const target = pick<Build>(params.get('target'), BUILDS, 'Medium')
  const hit = pick<Hit>(params.get('hit'), ['body', 'head'], 'body')
  const cls = pick<ClassFilter>(params.get('class'), CLASS_FILTERS, 'All')
  const allModes = params.get('modes') === 'all'
  const rangeRaw = Number(params.get('range'))
  const range = Number.isFinite(rangeRaw) ? Math.min(MAX_RANGE_M, Math.max(0, Math.round(rangeRaw))) : 0
  const narrow = useIsNarrow()

  const setParam = (key: string, value: string, fallback: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const [sortKey, setSortKey] = useState<SortKey>('seconds')
  const [sortDir, setSortDir] = useState(1)

  const points = useMemo(
    () => (data?.health ? selectPoints(data.weapons, data.health, target, hit, cls, allModes, range).sort(bySeconds) : []),
    [data, target, hit, cls, allModes, range],
  )
  const outOfRange = points.filter((p) => p.outOfRange)
  const untimed = points.filter((p) => p.seconds == null && !p.outOfRange)

  // Weapons on the over-distance chart: explicit (URL) picks, else the 3 fastest at current settings.
  const linesParam = params.get('lines')
  const picked = useMemo(() => {
    const byKey = new Map(points.filter((p) => p.timed).map((p) => [p.key, p]))
    if (linesParam == null) {
      return points.filter((p) => p.seconds != null).slice(0, MAX_LINES)
    }
    return linesParam
      .split('~')
      .map((k) => byKey.get(k))
      .filter((p): p is TtkPoint => !!p)
      .slice(0, MAX_LINES)
  }, [points, linesParam])
  const setPicked = (keys: string[]) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('lines', keys.join('~'))
        return next
      },
      { replace: true },
    )
  const togglePick = (key: string) => {
    const keys = picked.map((p) => p.key)
    if (keys.includes(key)) setPicked(keys.filter((k) => k !== key))
    else if (points.find((p) => p.key === key)?.timed) setPicked([...keys, key].slice(-MAX_LINES))
  }

  const tableRows = useMemo(() => {
    const rows = [...points]
    const val = (p: TtkPoint) => (sortKey === 'cls' ? (p.cls ?? '') : (p[sortKey] ?? ''))
    rows.sort((a, b) => {
      // Unknown timing always sinks to the bottom regardless of direction.
      if (sortKey === 'seconds' && (a.seconds == null || b.seconds == null)) return bySeconds(a, b)
      const av = val(a)
      const bv = val(b)
      return (typeof av === 'string' ? av.localeCompare(String(bv)) : (av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1)) * sortDir
    })
    return rows
  }, [points, sortKey, sortDir])

  const setSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => d * -1)
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? '↑' : '↓') : '↕')
  const th = (key: SortKey, label: string, right = false) => (
    <th aria-sort={sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'} className={right ? styles.num : undefined}>
      <button type="button" className={styles.sortBtn} onClick={() => setSort(key)}>
        {label}
        <span className={styles.sortIcon}>{arrow(key)}</span>
      </button>
    </th>
  )

  const latestPatch = data?.recentChanges.find((c) => c.patchTitle)
  const updated = fmtDate(data?.lastUpdated ?? null)

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            Time to kill
            <Badge>Experimental</Badge>
          </span>
        }
        subtitle={
          <>
            <span className={styles.lede}>
              Theoretical TTK: every shot hits and there is no healing. Damage falls off with range using each weapon&rsquo;s wiki falloff values.
            </span>
            <span className={styles.experimental}>
              Experimental: numbers come from community data and our own math and may be off, so double-check in game.
            </span>
            {data && (updated || latestPatch) && (
              <span className={styles.updated}>
                {updated && <>Stats as of {updated}</>}
                {updated && latestPatch && ' · '}
                {latestPatch && (
                  <>
                    Latest patch:{' '}
                    {latestPatch.patchUrl ? (
                      <a href={latestPatch.patchUrl} target="_blank" rel="noopener noreferrer">{latestPatch.patchTitle}</a>
                    ) : (
                      latestPatch.patchTitle
                    )}
                  </>
                )}
              </span>
            )}
          </>
        }
      />

      {isLoading ? (
        <div className={styles.center}><Spinner /></div>
      ) : isError || !data ? (
        <ErrorState message="Failed to load TTK data." onRetry={() => refetch()} />
      ) : !data.health || data.weapons.length === 0 ? (
        <EmptyState icon="fas fa-crosshairs" title="No weapon stats yet" />
      ) : (
        <>
          <div className={styles.filters} role="group" aria-label="Filters">
            <label className={styles.field}>
              <span>Target</span>
              <Select
                value={target}
                onChange={(e) => setParam('target', e.target.value, 'Medium')}
                options={BUILDS.map((b) => ({ value: b, label: `${b} (${data.health![b]} HP)` }))}
              />
            </label>
            <label className={styles.field}>
              <span>Hit</span>
              <Select
                value={hit}
                onChange={(e) => setParam('hit', e.target.value, 'body')}
                options={[{ value: 'body', label: 'Body' }, { value: 'head', label: 'Head' }]}
              />
            </label>
            <label className={styles.field}>
              <span>Weapon class</span>
              <Select
                value={cls}
                onChange={(e) => setParam('class', e.target.value, 'All')}
                options={CLASS_FILTERS.map((c) => ({ value: c, label: c }))}
              />
            </label>
            <label className={styles.field}>
              <span>Mode</span>
              <Select
                value={allModes ? 'all' : 'primary'}
                onChange={(e) => setParam('modes', e.target.value, 'primary')}
                options={[{ value: 'primary', label: 'Primary only' }, { value: 'all', label: 'All modes' }]}
              />
            </label>
            <label className={`${styles.field} ${styles.rangeField}`}>
              <span>
                Range<span className={styles.rangeValue}>{range} m</span>
              </span>
              <input
                type="range"
                className={styles.range}
                min={0}
                max={MAX_RANGE_M}
                step={1}
                value={range}
                aria-label="Range in metres"
                onChange={(e) => setParam('range', e.target.value, '0')}
              />
            </label>
          </div>

          {points.length === 0 ? (
            <EmptyState icon="fas fa-crosshairs" title="No weapons match your filters" />
          ) : (
            <>
              <section className={styles.card} aria-label="TTK chart">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>
                    Seconds to kill a {target} ({data.health[target]} HP) · {hit === 'head' ? 'headshots' : 'body shots'}
                    {range > 0 && ` · at ${range} m`}
                  </h3>
                  <ul className={styles.legend} aria-label="Weapon class">
                    {BUILDS.map((b) => (
                      <li key={b}>
                        <span className={styles.swatch} style={{ background: CLASS_COLORS[b] }} />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {points.some((p) => p.seconds != null) && <TtkChart points={points} onPick={togglePick} />}
                {outOfRange.length > 0 && (
                  <p className={styles.untimed}>
                    Can't kill at this range: {outOfRange.map((p) => p.label).join(', ')}
                  </p>
                )}
                {untimed.length > 0 && (
                  <p className={styles.untimed}>
                    No timing data: {untimed.map((p) => p.label).join(', ')}
                  </p>
                )}
              </section>

              <section className={`${styles.card} ${styles.rangeCard}`} aria-label="TTK over distance">
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>
                    TTK over distance · {target} ({data.health[target]} HP) · {hit === 'head' ? 'headshots' : 'body shots'}
                  </h3>
                </div>
                <ul className={styles.picked} aria-label="Weapons on the chart">
                  {picked.map((p, i) => (
                    <li key={p.key} className={styles.pickedItem}>
                      <span className={styles.lineKey} style={{ background: SERIES_COLORS[i] }} />
                      {p.label}
                      <button type="button" className={styles.chipBtn} aria-label={`Remove ${p.label}`} onClick={() => togglePick(p.key)}>
                        &times;
                      </button>
                    </li>
                  ))}
                  {picked.length < MAX_LINES && (
                    <li>
                      <Select
                        className={styles.addSelect}
                        value=""
                        aria-label="Add a weapon to the chart"
                        onChange={(e) => e.target.value && togglePick(e.target.value)}
                        options={[
                          { value: '', label: 'Add weapon…' },
                          ...[...points]
                            .filter((p) => p.timed && !picked.some((x) => x.key === p.key))
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map((p) => ({ value: p.key, label: p.label })),
                        ]}
                      />
                    </li>
                  )}
                  {linesParam != null && (
                    <li>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() =>
                          setParams((prev) => {
                            const next = new URLSearchParams(prev)
                            next.delete('lines')
                            return next
                          }, { replace: true })
                        }
                      >
                        Reset to fastest
                      </button>
                    </li>
                  )}
                </ul>
                {picked.length > 0 ? (
                  <TtkRangeChart series={picked} hp={data.health[target]} hit={hit} narrow={narrow} />
                ) : (
                  <p className={styles.untimed}>Pick up to {MAX_LINES} weapons to compare. Click a table row or a bar to add one.</p>
                )}
                <p className={styles.assumption}>
                  Assumes damage falls off linearly from a weapon&rsquo;s falloff start to its falloff end, then stays at the end
                  multiplier. Headshot bonuses apply on top. Melee, explosives and weapons without falloff data aren&rsquo;t affected by range.
                </p>
              </section>

              <section className={styles.tableSection} aria-label="TTK table">
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {th('weapon', 'Weapon')}
                        {th('cls', 'Class')}
                        {th('wtype', 'Type')}
                        {th('mode', 'Mode')}
                        {th('falloff', 'Falloff')}
                        {th('shots', 'Shots', true)}
                        {th('seconds', 'Seconds', true)}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((p) => {
                        const pickIdx = picked.findIndex((x) => x.key === p.key)
                        return (
                        <tr
                          key={p.key}
                          className={p.timed ? styles.pickRow : undefined}
                          tabIndex={p.timed ? 0 : undefined}
                          aria-pressed={p.timed ? pickIdx >= 0 : undefined}
                          title={p.timed ? 'Click to add or remove from the distance chart' : undefined}
                          onClick={p.timed ? () => togglePick(p.key) : undefined}
                          onKeyDown={p.timed ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(p.key) } } : undefined}
                        >
                          <td style={pickIdx >= 0 ? { boxShadow: `inset 3px 0 0 ${SERIES_COLORS[pickIdx]}` } : undefined}>{p.weapon}</td>
                          <td>
                            <span className={styles.swatch} style={{ background: p.cls ? CLASS_COLORS[p.cls] : 'var(--text-subtle)' }} />
                            {p.cls ?? '—'}
                          </td>
                          <td>{p.wtype ?? '—'}</td>
                          <td>
                            {p.mode}
                            {p.noHeadshot && <span className={styles.flag}> no headshot bonus</span>}
                          </td>
                          <td className={styles.falloffCell}>{p.falloff ?? '—'}</td>
                          <td className={styles.num}>{p.outOfRange ? 'out of range' : p.shots}</td>
                          <td className={styles.num}>{p.outOfRange ? '—' : p.seconds == null ? 'no data' : fmtNum(p.seconds)}</td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {data.recentChanges.length > 0 && (
            <section className={styles.recent} aria-label="Recent balance changes">
              <h3 className={styles.sectionTitle}>Recent balance changes</h3>
              <ul className={styles.changes}>
                {data.recentChanges.map((c, i) => (
                  <li key={`${c.target}-${c.stat}-${c.decidedAt}-${i}`}>
                    <span className={styles.changeTarget}>{c.target}</span>
                    <span className={styles.changeStat}>{c.stat}</span>
                    <span className={styles.changeVals}>
                      {c.from == null ? '' : `${fmtNum(c.from)} → `}{fmtNum(c.to)}
                    </span>
                    <span className={styles.changePatch}>
                      {c.patchTitle ? (
                        c.patchUrl ? (
                          <a href={c.patchUrl} target="_blank" rel="noopener noreferrer">{c.patchTitle}</a>
                        ) : (
                          c.patchTitle
                        )
                      ) : (
                        fmtDate(c.decidedAt)
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className={styles.credit}>
            Weapon stats from{' '}
            <a href={data.attribution.url} target="_blank" rel="noopener noreferrer">{data.attribution.name}</a>, licensed{' '}
            <a href={data.attribution.licenseUrl} target="_blank" rel="noopener noreferrer">{data.attribution.license}</a>, kept
            current with Embark&rsquo;s official patch notes.
          </p>
        </>
      )}
    </div>
  )
}
