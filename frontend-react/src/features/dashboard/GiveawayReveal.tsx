import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/buttons/Button'
import type { GiveawayEntrant } from '@/types/giveaway'
import {
  buildWheelSegments,
  wheelLandingRotation,
} from './giveawayDisplay'
import styles from './GiveawayReveal.module.css'

const MAX_VISIBLE_SEGMENTS = 24
const REVEAL_SECONDS = 4.6

interface GiveawayRevealProps {
  entrants: GiveawayEntrant[]
  winner: string
  slot: number
  total: number
  onRevealed: () => void
  onClose: () => void
}

export function GiveawayReveal({
  entrants,
  winner,
  slot,
  total,
  onRevealed,
  onClose,
}: GiveawayRevealProps) {
  const reduceMotion = useReducedMotion()
  const [done, setDone] = useState(false)
  const revealedRef = useRef(false)
  const segments = useMemo(
    () => buildWheelSegments(entrants, winner, MAX_VISIBLE_SEGMENTS),
    [entrants, winner],
  )
  const winnerIndex = segments.length - 1
  const rotation = wheelLandingRotation(winnerIndex, segments.length)
  const showLabels = segments.length <= 12
  const sliceDegrees = 360 / segments.length
  const gradient = segments
    .map((_, index) => {
      const start = index * sliceDegrees
      const end = (index + 1) * sliceDegrees
      const hue = Math.round((index * 320) / Math.max(1, segments.length - 1))
      return `hsl(${hue} 68% 48%) ${start}deg ${end}deg`
    })
    .join(', ')

  const completeReveal = useCallback(() => {
    setDone(true)
    if (revealedRef.current) return
    revealedRef.current = true
    onRevealed()
  }, [onRevealed])

  useEffect(() => {
    const timeout = window.setTimeout(
      completeReveal,
      reduceMotion ? 50 : REVEAL_SECONDS * 1000 + 250,
    )
    return () => window.clearTimeout(timeout)
  }, [completeReveal, reduceMotion])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && done) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [done, onClose])

  return (
    <motion.div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="giveaway-reveal-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.section
        className={styles.panel}
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
      >
        <div className={styles.eyebrow}>Secure draw complete</div>
        <h2 id="giveaway-reveal-title" className={styles.title}>
          {done ? 'Winner selected' : 'Spinning for the winner'}
        </h2>
        <p className={styles.explainer}>
          Entry counts affected the secure draw. The wheel reveals the saved result.
        </p>

        <div className={styles.wheelStage}>
          <div className={styles.pointer} aria-hidden="true" />
          <motion.div
            className={styles.wheel}
            style={{ background: `conic-gradient(${gradient})` }}
            initial={{ rotate: 0 }}
            animate={{ rotate: reduceMotion ? rotation % 360 : rotation }}
            transition={{
              duration: reduceMotion ? 0.01 : REVEAL_SECONDS,
              ease: [0.12, 0.74, 0.16, 1],
            }}
            onAnimationComplete={completeReveal}
          >
            {showLabels &&
              segments.map((segment, index) => {
                const angle = (index + 0.5) * sliceDegrees
                return (
                  <span
                    className={styles.wheelLabel}
                    key={`${segment.entryNumber}-${index}`}
                    style={{ transform: `rotate(${angle}deg) translateY(-42%)` }}
                  >
                    <span style={{ transform: `rotate(${-angle}deg)` }}>
                      @{segment.username}
                    </span>
                  </span>
                )
              })}
          </motion.div>

          <div className={styles.hub}>
            <AnimatePresence initial={false} mode="wait">
              {done ? (
                <motion.div
                  key="winner"
                  className={styles.hubWinner}
                  initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                  aria-live="polite"
                >
                  <span>Winner</span>
                  <strong>@{winner}</strong>
                </motion.div>
              ) : (
                <motion.div
                  key="count"
                  className={styles.hubCount}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <strong>{total.toLocaleString()}</strong>
                  <span>entries</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className={styles.resultLine}>
          {done ? (
            <>
              Entry <b>#{slot.toLocaleString()}</b> of {total.toLocaleString()}
            </>
          ) : segments.length < total ? (
            `${segments.length} representative wheel slices · all ${total.toLocaleString()} entries were eligible`
          ) : (
            `${total.toLocaleString()} entries on the wheel`
          )}
        </div>

        <div className={styles.actions}>
          {done ? (
            <Button icon="fas fa-check" onClick={onClose}>
              Return to giveaway
            </Button>
          ) : (
            <Button variant="ghost" onClick={completeReveal}>
              Reveal now
            </Button>
          )}
        </div>
      </motion.section>
    </motion.div>
  )
}
