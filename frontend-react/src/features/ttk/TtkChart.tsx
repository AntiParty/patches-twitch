/* Horizontal bar chart of TTK. Bar colour follows the weapon's class, never rank. */
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Build } from '@/types/ttk'
import type { TtkPoint } from './ttkData'
import styles from './Ttk.module.css'

export const CLASS_COLORS: Record<Build, string> = {
  Light: 'var(--viz-light)',
  Medium: 'var(--viz-medium)',
  Heavy: 'var(--viz-heavy)',
}
const UNKNOWN_COLOR = 'var(--text-subtle)'
const ROW_PX = 28
const AXIS_PX = 32
const LABELLED = 3

const fmtSec = (s: number) => `${s.toFixed(3)} s`

export function useIsNarrow(maxWidth = 640) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= maxWidth)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= maxWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxWidth])
  return narrow
}

interface Datum extends TtkPoint {
  /** Plotted length; one-shot kills get a sliver so they stay visible. */
  plotted: number
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Datum }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className={styles.tip}>
      <div className={styles.tipValue}>
        {d.seconds === 0 ? 'One shot' : fmtSec(d.seconds ?? 0)}
        <span className={styles.tipShots}> · {d.shots} {d.shots === 1 ? 'shot' : 'shots'}</span>
      </div>
      <div className={styles.tipName}>{d.weapon}</div>
      <div className={styles.tipMeta}>
        <span className={styles.tipKey} style={{ background: d.cls ? CLASS_COLORS[d.cls] : UNKNOWN_COLOR }} />
        {d.cls ?? 'Unknown class'}
        {d.wtype ? ` · ${d.wtype}` : ''} · {d.mode}
      </div>
      {d.falloff && (
        <div className={styles.tipNote}>
          Falloff {d.falloff}
          {d.damageMult < 1 ? ` · ${Number((d.damageMult * 100).toFixed(1))}% damage at this range` : ""}
        </div>
      )}
      {d.noHeadshot && <div className={styles.tipNote}>No headshot bonus (body value shown)</div>}
      {d.notes.map((n) => (
        <div key={n} className={styles.tipNote}>{n}</div>
      ))}
    </div>
  )
}

export function TtkChart({ points, onPick }: { points: TtkPoint[]; onPick?: (key: string) => void }) {
  const narrow = useIsNarrow()
  const timed = points.filter((p) => p.seconds != null)
  const max = Math.max(0.1, ...timed.map((p) => p.seconds ?? 0))
  const data: Datum[] = timed.map((p) => ({ ...p, plotted: Math.max(p.seconds ?? 0, max * 0.015) }))
  const height = data.length * ROW_PX + AXIS_PX + 8

  return (
    <div className={styles.chartBox} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: narrow ? 52 : 64, bottom: 0, left: 0 }}
          barCategoryGap={ROW_PX - 18}
          accessibilityLayer
        >
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeWidth={1} />
          <XAxis
            type="number"
            domain={[0, max]}
            tickFormatter={(v: number) => `${Number(v.toFixed(2))}s`}
            tick={{ fill: 'var(--viz-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--viz-axis)' }}
            tickLine={false}
            tickCount={narrow ? 4 : 6}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={narrow ? 104 : 168}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--viz-axis)' }}
            tickLine={false}
            interval={0}
            tickFormatter={(v: string) => (v.length > (narrow ? 15 : 26) ? `${v.slice(0, narrow ? 14 : 25)}…` : v)}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--viz-hover)' }} isAnimationActive={false} />
          <Bar
            dataKey="plotted"
            maxBarSize={18}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            style={onPick ? { cursor: "pointer" } : undefined}
            onClick={(d: unknown) => onPick?.((d as Datum).key)}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.cls ? CLASS_COLORS[d.cls] : UNKNOWN_COLOR} />
            ))}
            <LabelList
              dataKey="plotted"
              position="right"
              content={(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
                const i = props.index ?? 0
                if (i >= LABELLED) return null
                const d = data[i]
                return (
                  <text
                    x={Number(props.x) + Number(props.width) + 6}
                    y={Number(props.y) + Number(props.height) / 2}
                    dy="0.35em"
                    fill="var(--text-main)"
                    fontSize={12}
                    fontWeight={600}
                  >
                    {d.seconds === 0 ? 'One shot' : fmtSec(d.seconds ?? 0)}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
