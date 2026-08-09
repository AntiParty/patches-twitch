import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/buttons/Button'
import type { GiveawayEntrant } from '@/types/giveaway'
import {
  avatarInitial,
  buildReelCards,
  reelLandingOffset,
  twitchAvatarUrl,
} from './giveawayDisplay'
import styles from './GiveawayReveal.module.css'

const REVEAL_SECONDS = 4.6
const ANNOUNCEMENT_DELAY_MS = 1800
const REEL_LEAD_IN_CARDS = 8
const REEL_TRAILING_CARDS = 10
const REEL_CARD_WIDTH = 132
const REEL_CARD_GAP = 12
const DEFAULT_REEL_VIEWPORT_WIDTH = 660

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
  const announcementTimeoutRef = useRef<number | null>(null)
  const reelViewportRef = useRef<HTMLDivElement | null>(null)
  const [reelViewportWidth, setReelViewportWidth] = useState(DEFAULT_REEL_VIEWPORT_WIDTH)
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(() => new Set())
  const reelCards = useMemo(
    () => buildReelCards(entrants, winner, REEL_LEAD_IN_CARDS, REEL_TRAILING_CARDS),
    [entrants, winner],
  )
  const winnerIndex = Math.max(0, reelCards.findIndex((card) => card.isWinner))
  const landingOffset = reelLandingOffset(
    winnerIndex,
    REEL_CARD_WIDTH,
    REEL_CARD_GAP,
    reelViewportWidth,
  )

  useEffect(() => {
    const viewport = reelViewportRef.current
    if (!viewport) return
    const updateWidth = () => setReelViewportWidth(viewport.clientWidth || DEFAULT_REEL_VIEWPORT_WIDTH)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const completeReveal = useCallback(() => {
    setDone(true)
    if (revealedRef.current) return
    revealedRef.current = true
    announcementTimeoutRef.current = window.setTimeout(onRevealed, ANNOUNCEMENT_DELAY_MS)
  }, [onRevealed])

  useEffect(() => {
    const timeout = window.setTimeout(
      completeReveal,
      reduceMotion ? 50 : REVEAL_SECONDS * 1000 + 250,
    )
    return () => window.clearTimeout(timeout)
  }, [completeReveal, reduceMotion])

  useEffect(
    () => () => {
      if (announcementTimeoutRef.current !== null) {
        window.clearTimeout(announcementTimeoutRef.current)
      }
    },
    [],
  )

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
          {done
            ? 'The secure result is locked in. Chat will announce it in a moment.'
            : 'Every eligible entry was included in the secure draw.'}
        </p>

        <div className={styles.reelStage}>
          <div
            className={`${styles.reelMarker} ${done ? styles.reelMarkerLocked : ''}`}
            aria-hidden="true"
          />
          <div className={styles.reelViewport} ref={reelViewportRef}>
            <motion.div
              className={styles.reelTrack}
              initial={{ x: 0 }}
              animate={{ x: -landingOffset }}
              transition={{
                duration: reduceMotion ? 0.01 : REVEAL_SECONDS,
                ease: [0.08, 0.76, 0.14, 1],
              }}
              onAnimationComplete={completeReveal}
            >
              {reelCards.map((card, index) => {
                const avatarUrl = twitchAvatarUrl(card.username)
                const avatarFailed = failedAvatars.has(avatarUrl)
                return (
                  <article
                    className={`${styles.reelCard} ${card.isWinner ? styles.reelCardWinner : ''}`}
                    key={`${card.entryNumber}-${index}`}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {!avatarFailed && (
                        <img
                          src={avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={() => setFailedAvatars((current) => new Set(current).add(avatarUrl))}
                        />
                      )}
                      <span className={styles.avatarFallback}>{avatarInitial(card.username)}</span>
                    </span>
                    <strong>@{card.username}</strong>
                    <span>Entry #{card.entryNumber.toLocaleString()}</span>
                  </article>
                )
              })}
            </motion.div>
          </div>
        </div>

        <AnimatePresence initial={false} mode="wait">
          {done ? (
            <motion.div
              key="winner"
              className={styles.reelWinner}
              initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              aria-live="polite"
            >
              <span>Winner</span>
              <strong>@{winner}</strong>
            </motion.div>
          ) : (
            <div className={styles.reelCount}>
              <strong>{total.toLocaleString()}</strong>
              <span>eligible entries</span>
            </div>
          )}
        </AnimatePresence>

        <div className={styles.resultLine}>
          {done ? (
            <>
              Entry <b>#{slot.toLocaleString()}</b> of {total.toLocaleString()}
            </>
          ) : entrants.length < total ? (
            `${reelCards.length} representative cards · all ${total.toLocaleString()} entries were eligible`
          ) : (
            `${total.toLocaleString()} entries in the reel`
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
