/*
 * Animated ordered-dither aurora, built on the vendored dither-kit primitives
 * (Bayer threshold matrix, palette seeds, bloom presets). A purple dither
 * field rises from the bottom of the hero and breathes: two slow density
 * waves drift through the ramp, and a sparse set of cells wink like the
 * charts' sparkles. Tuned restrained — low opacity, slow motion — so it
 * reads as atmosphere, not a light show. Mirrors the footer wash so the page
 * opens and closes on the same texture.
 *
 * Perf, same discipline as HeroAtmosphere:
 * - Low-res backing store (one cell per dither pixel, ~15k cells on phones,
 *   capped at ~110k on desktop) written through a reused ImageData buffer —
 *   one putImageData per frame, zero allocations in the loop.
 * - Throttled to ~12fps; the chunky dither reads better at low fps and rAF
 *   pauses in background tabs for free.
 * - Paused off-screen via IntersectionObserver.
 * - prefers-reduced-motion: paints a single static frame, no loop.
 */
import { useEffect, useRef } from 'react'
import {
  BAYER4,
  clamp01,
  pixelBloomStyle,
  pixelPrefersReducedMotion,
  type PixelBloom,
} from '@/components/dither-kit/pixel'
import { PALETTE, type DitherColor } from '@/components/dither-kit/palette'
import styles from './Landing.module.css'

const CELL = 4 // css px per dither cell
const MAX_COLS = 420
const MAX_ROWS = 260
const FRAME_MS = 1000 / 12
const STAR_POOL = 0.008 // fraction of cells that ever twinkle

export function DitherAtmosphere({
  color = 'purple',
  opacity = 0.4,
  bloom = 'low',
}: {
  color?: DitherColor
  opacity?: number
  bloom?: PixelBloom
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)
  const bloomStyle = pixelBloomStyle(bloom)

  useEffect(() => {
    const canvas = canvasRef.current
    const bloomCanvas = bloomRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const bloomCtx = bloomCanvas?.getContext('2d') ?? null

    const reduced = pixelPrefersReducedMotion()
    const { fill, star } = PALETTE[color]

    let raf = 0
    let running = false
    let lastPaint = 0
    let cols = 0
    let rows = 0
    let buf: ImageData | null = null
    let phases: Float32Array | null = null

    const paint = (tSec: number) => {
      if (!buf || !phases) return
      const d = buf.data
      const breath = 0.92 + 0.08 * Math.sin(tSec * 0.25)
      let i = 0
      let p = 0
      for (let y = 0; y < rows; y++) {
        const base = (y + 0.5) / rows // 0 at top → 1 at bottom edge
        const ramp = base * base // ease in so the glow hugs the bottom
        const bayerRow = BAYER4[y & 3]
        for (let x = 0; x < cols; x++, i += 4, p++) {
          const wave =
            0.18 * Math.sin(x * 0.045 + tSec * 0.32 + base * 2.2) +
            0.1 * Math.sin(x * 0.021 - tSec * 0.2 + y * 0.04)
          const density = clamp01(ramp * (0.72 + wave) * breath)
          const lit = density > bayerRow[x & 3]
          let a = 0
          if (lit) {
            a = (0.26 + 0.55 * density) * opacity * 255
          } else if (density > 0.02) {
            // faint tint on off cells so the falloff reads smooth (kit style)
            a = 0.09 * density * opacity * 255
          }
          let r = fill[0]
          let g = fill[1]
          let b = fill[2]
          // rare winking sparkles, only in the sparse falloff band
          const ph = phases[p]
          if (ph < STAR_POOL && density > 0.03 && density < 0.45) {
            const tw = Math.sin(tSec * 1.4 + ph * 2600)
            if (tw > 0.97) {
              const k = (tw - 0.97) / 0.03
              r = star[0]
              g = star[1]
              b = star[2]
              a = Math.max(a, 200 * k * opacity)
            }
          }
          d[i] = r
          d[i + 1] = g
          d[i + 2] = b
          d[i + 3] = a
        }
      }
      ctx.putImageData(buf, 0, 0)
      if (bloomCanvas && bloomCtx) {
        bloomCtx.clearRect(0, 0, cols, rows)
        bloomCtx.drawImage(canvas, 0, 0)
      }
    }

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      cols = Math.max(4, Math.min(MAX_COLS, Math.round(rect.width / CELL)))
      rows = Math.max(4, Math.min(MAX_ROWS, Math.round(rect.height / CELL)))
      canvas.width = cols
      canvas.height = rows
      if (bloomCanvas) {
        bloomCanvas.width = cols
        bloomCanvas.height = rows
      }
      buf = ctx.createImageData(cols, rows)
      phases = new Float32Array(cols * rows)
      for (let j = 0; j < phases.length; j++) phases[j] = Math.random()
      if (reduced) paint(0)
    }

    const frame = (now: number) => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      if (now - lastPaint < FRAME_MS) return
      lastPaint = now
      paint(now / 1000)
    }

    const start = () => {
      if (running || reduced) return
      running = true
      raf = requestAnimationFrame(frame)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    resize()
    if (reduced) paint(0)

    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement || canvas)

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) start()
        else stop()
      },
      { threshold: 0.05 },
    )
    io.observe(canvas)

    start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
    }
  }, [color, opacity, bloom])

  return (
    <>
      <canvas ref={canvasRef} className={styles.ditherLayer} aria-hidden="true" />
      {bloomStyle && (
        <canvas
          ref={bloomRef}
          className={styles.ditherLayer}
          style={bloomStyle}
          aria-hidden="true"
        />
      )}
    </>
  )
}
