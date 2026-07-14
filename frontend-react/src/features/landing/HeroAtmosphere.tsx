/*
 * Performant hero atmosphere: one canvas, rAF loop, paused off-screen.
 * Soft light bloom + dust particles + drifting mono glyphs.
 * Animates transform-like motion only; no CSS blur on many nodes.
 */
import { useEffect, useRef } from 'react'
import styles from './Landing.module.css'

type Particle = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  a: number
  da: number
}

type Glyph = {
  text: string
  x: number
  y: number
  vx: number
  vy: number
  a: number
  phase: number
  size: number
}

const GLYPH_POOL = [
  '!rank',
  '!record',
  '!peak',
  '!predict',
  'RS',
  'T500',
  'D3',
  '#100',
  '+145',
  '43.3k',
  'Diamond',
  'Ruby',
  '×',
  '+',
  '·',
  '#',
  '0',
  '1',
]

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function HeroAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduced = prefersReducedMotion()
    let raf = 0
    let running = false
    let w = 0
    let h = 0
    let dpr = 1
    let t0 = performance.now()

    const particles: Particle[] = []
    const glyphs: Glyph[] = []

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 1.75)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    const seed = () => {
      particles.length = 0
      glyphs.length = 0

      const dustCount = reduced ? 18 : Math.min(70, Math.floor((w * h) / 14000))
      for (let i = 0; i < dustCount; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.4,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.05 - Math.random() * 0.18,
          a: 0.08 + Math.random() * 0.22,
          da: (Math.random() - 0.5) * 0.004,
        })
      }

      const glyphCount = reduced ? 8 : 22
      for (let i = 0; i < glyphCount; i++) {
        glyphs.push({
          text: GLYPH_POOL[i % GLYPH_POOL.length],
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.06,
          a: 0.06 + Math.random() * 0.12,
          phase: Math.random() * Math.PI * 2,
          size: 10 + Math.random() * 6,
        })
      }
    }

    const drawBloom = (time: number) => {
      // Slow drift of the light center
      const driftX = Math.sin(time * 0.00018) * w * 0.04
      const driftY = Math.cos(time * 0.00014) * h * 0.03
      const cx = w * 0.5 + driftX
      const cy = h * 0.38 + driftY
      const pulse = reduced ? 1 : 0.92 + Math.sin(time * 0.0004) * 0.08

      // Outer cool haze — subtle depth, no bright white core behind the headline.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55)
      g.addColorStop(0, `rgba(170, 185, 210, ${0.07 * pulse})`)
      g.addColorStop(0.35, `rgba(140, 155, 180, ${0.035 * pulse})`)
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    const frame = (now: number) => {
      if (!running) return
      const t = now - t0

      ctx.clearRect(0, 0, w, h)
      drawBloom(now)

      // Dust
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx
          p.y += p.vy
          p.a += p.da
          if (p.a < 0.04 || p.a > 0.32) p.da *= -1
          if (p.y < -4) {
            p.y = h + 4
            p.x = Math.random() * w
          }
          if (p.x < -4) p.x = w + 4
          if (p.x > w + 4) p.x = -4
        }
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${p.a})`
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Glyphs
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const g of glyphs) {
        if (!reduced) {
          g.x += g.vx
          g.y += g.vy
          g.phase += 0.008
          if (g.x < -40) g.x = w + 40
          if (g.x > w + 40) g.x = -40
          if (g.y < -20) g.y = h + 20
          if (g.y > h + 20) g.y = -20
        }
        const flicker = reduced ? 1 : 0.75 + Math.sin(g.phase + t * 0.001) * 0.25
        ctx.font = `500 ${g.size}px "JetBrains Mono", ui-monospace, monospace`
        ctx.fillStyle = `rgba(220, 225, 235, ${g.a * flicker})`
        ctx.fillText(g.text, g.x, g.y)
      }

      // Soft vignette (cheap, no filter)
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.15, w * 0.5, h * 0.42, Math.max(w, h) * 0.72)
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      if (!reduced) {
        raf = requestAnimationFrame(frame)
      }
    }

    const start = () => {
      if (running) return
      running = true
      t0 = performance.now()
      if (reduced) {
        frame(t0)
      } else {
        raf = requestAnimationFrame(frame)
      }
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    resize()

    const ro = new ResizeObserver(() => {
      resize()
      if (reduced && running) frame(performance.now())
    })
    ro.observe(canvas.parentElement || canvas)

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) start()
        else stop()
      },
      { threshold: 0.05 },
    )
    io.observe(canvas)

    // Start if already visible
    start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className={styles.atmosphereCanvas} aria-hidden="true" />
}
