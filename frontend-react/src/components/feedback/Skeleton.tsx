/* Shimmer placeholder for loading content. */
import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  /** Render N stacked lines. */
  lines?: number
  style?: CSSProperties
}

export function Skeleton({ width = '100%', height = 16, radius = 6, lines = 1, style }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className={styles.stack}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={styles.skeleton}
            style={{ width: i === lines - 1 ? '70%' : width, height, borderRadius: radius }}
          />
        ))}
      </div>
    )
  }
  return (
    <span className={styles.skeleton} style={{ width, height, borderRadius: radius, ...style }} />
  )
}
