/*
 * TTK over distance: up to 3 weapons as step lines (TTK changes in whole-shot steps).
 * Line colours are the page's first three categorical slots, assigned by selection order.
 */
import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MAX_RANGE_M, ttkOverDistance, type Hit, type TtkPoint } from './ttkData'
import styles from './Ttk.module.css'

export const SERIES_COLORS = ['var(--viz-s1)', 'var(--viz-s2)', 'var(--viz-s3)']
const HEIGHT = 280
const MARGIN_TOP = 12
const MARGIN_BOTTOM = 4
const AXIS_H = 28
const LABEL_MIN_GAP = 16

type Row = { d: number } & Record<string, number | null>

function TipBody({ active, payload, label, series }: {
  active?: boolean
  payload?: ReadonlyArray<unknown>
  label?: number | string
  series: TtkPoint[]
}) {
  const row = (payload?.[0] as { payload?: Row } | undefined)?.payload
  if (!active || !row) return null
  return (
    <div className={styles.tip}>
      <div className={styles.tipName}>at {label} m</div>
      {series.map((p, i) => {
        const sec = row[`s${i}`]
        const shots = row[`n${i}`]
        return (
          <div key={p.key} className={styles.tipRow}>
            <span className={styles.tipKey} style={{ background: SERIES_COLORS[i] }} />
            <span className={styles.tipRowValue}>
              {sec == null ? 'Out of range' : sec === 0 ? 'One shot' : `${sec.toFixed(3)} s`}
            </span>
            <span className={styles.tipRowName}>
              {p.label}
              {typeof shots === 'number' && Number.isFinite(shots) ? ` · ${shots} ${shots === 1 ? 'shot' : 'shots'}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function TtkRangeChart({ series, hp, hit, narrow }: { series: TtkPoint[]; hp: number; hit: Hit; narrow: boolean }) {
  const { rows, yMax, ends } = useMemo(() => {
    const samples = series.map((p) => ttkOverDistance(p, hp, hit))
    const rows: Row[] = []
    for (let d = 0; d <= MAX_RANGE_M; d++) {
      const r: Row = { d }
      samples.forEach((s, i) => {
        r[`s${i}`] = s[d].seconds
        r[`n${i}`] = Number.isFinite(s[d].shots) ? s[d].shots : null
        // Solid up to the falloff start, dashed (estimated) after; the dashed run starts on the last solid point so the line joins.
        const solid = s[d].confidence === 'solid'
        r[`a${i}`] = solid ? s[d].seconds : null
        r[`b${i}`] = !solid || (d < MAX_RANGE_M && s[d + 1].confidence !== 'solid') ? s[d].seconds : null
      })
      rows.push(r)
    }
    let max = 0
    for (const s of samples) for (const x of s) if (x.seconds != null && x.seconds > max) max = x.seconds
    const yMax = Math.max(0.1, max) * 1.08
    // Last in-range sample per line: where the direct label goes.
    const ends = samples.map((s) => {
      for (let d = s.length - 1; d >= 0; d--) if (s[d].seconds != null) return { d, v: s[d].seconds as number }
      return null
    })
    return { rows, yMax, ends }
  }, [series, hp, hit])

  // Direct labels only when they would not touch; otherwise the legend and tooltip carry the names.
  const plotH = HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - AXIS_H
  const ys = ends.map((e) => (e ? plotH * (1 - e.v / yMax) : null))
  const sorted = ys.filter((y): y is number => y != null).sort((a, b) => a - b)
  const labelsFit = !narrow && sorted.every((y, i) => i === 0 || y - sorted[i - 1] >= LABEL_MIN_GAP)

  return (
    <div className={styles.chartBox} style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: MARGIN_TOP, right: labelsFit ? 112 : 16, bottom: MARGIN_BOTTOM, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
          <XAxis
            dataKey="d"
            type="number"
            domain={[0, MAX_RANGE_M]}
            ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80]}
            tickFormatter={(v: number) => `${v} m`}
            tick={{ fill: 'var(--viz-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--viz-axis)' }}
            tickLine={false}
            height={AXIS_H}
          />
          <YAxis
            type="number"
            domain={[0, yMax]}
            width={44}
            tickFormatter={(v: number) => `${Number(v.toFixed(2))}s`}
            tick={{ fill: 'var(--viz-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickCount={5}
          />
          <Tooltip
            content={(p) => <TipBody active={p.active} payload={p.payload} label={p.label} series={series} />}
            cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {series.flatMap((p, i) => {
            const hasDashed = rows.some((r) => r[`b${i}`] != null)
            const lineProps = {
              type: 'stepAfter' as const,
              stroke: SERIES_COLORS[i],
              strokeWidth: 2,
              strokeLinecap: 'round' as const,
              strokeLinejoin: 'round' as const,
              dot: false,
              activeDot: { r: 4, stroke: 'var(--bg-card)', strokeWidth: 2, fill: SERIES_COLORS[i] },
              connectNulls: false,
              isAnimationActive: false,
            }
            const label =
              labelsFit
                ? (props: { x?: number | string; y?: number | string; index?: number }) =>
                    props.index === ends[i]?.d ? (
                      <text key={p.key} x={Number(props.x) + 8} y={Number(props.y)} dy="0.35em" fill="var(--text-muted)" fontSize={12}>
                        {p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}
                      </text>
                    ) : (
                      <g key={`${p.key}-${props.index}`} />
                    )
                : false
            return [
              <Line key={`${p.key}-a`} dataKey={`a${i}`} {...lineProps} label={hasDashed ? false : label} />,
              hasDashed ? (
                <Line key={`${p.key}-b`} dataKey={`b${i}`} {...lineProps} strokeDasharray="6 5" label={label} />
              ) : null,
            ]
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
