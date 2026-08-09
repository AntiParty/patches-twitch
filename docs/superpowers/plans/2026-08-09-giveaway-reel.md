# Giveaway Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard giveaway's circular wheel with an animated CS:GO-style entrant reel with resilient Unavatar profile images.

**Architecture:** Keep the existing backend-selected winner and modal lifecycle. Extend the display helper with pure, testable card-strip and landing calculations, then make `GiveawayReveal` render and animate that strip beneath a static marker. Avatar URLs are generated in the frontend and never stored or fetched through Twitch.

**Tech Stack:** React 19, TypeScript, Motion, CSS Modules, Bun tests.

## Global Constraints

- Do not change giveaway API contracts, draw behavior, or chat-announcement timing.
- Do not make Twitch API calls or persist avatar data.
- Use `https://unavatar.io/twitch/<encoded username>` and render initials if an image fails.
- Preserve reduced-motion behavior, dialog semantics, Escape-to-close behavior, and the 4.6-second reveal duration.

---

### Task 1: Add deterministic reel display helpers

**Files:**
- Modify: `frontend-react/src/features/dashboard/giveawayDisplay.ts`
- Modify: `frontend-react/tests/giveawayDisplay.test.ts`

**Interfaces:**
- Consumes: `GiveawayEntrant[]`, saved winner username, and `WheelSegment`.
- Produces: `buildReelCards(entrants, winner, visibleCards, random): WheelSegment[]`, `reelLandingOffset(winnerIndex, cardWidth, cardGap, viewportWidth): number`, `twitchAvatarUrl(username): string`, and `avatarInitial(username): string`.

- [ ] **Step 1: Write failing helper tests**

```ts
test('places the saved winner in the landing card', () => {
  const cards = buildReelCards(entrants, 'Bravo', 5, () => 0)
  expect(cards[5]).toMatchObject({ username: 'Bravo', isWinner: true })
})

test('centers the winner card below the marker', () => {
  expect(reelLandingOffset(5, 132, 12, 660)).toBe(402)
})

test('encodes avatar usernames and derives an initial fallback', () => {
  expect(twitchAvatarUrl('A name')).toBe('https://unavatar.io/twitch/A%20name')
  expect(avatarInitial('@patches')).toBe('P')
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail because helpers are missing**

Run: `bun test frontend-react/tests/giveawayDisplay.test.ts`

- [ ] **Step 3: Implement only the helper behavior required by the failing tests**

```ts
export function reelLandingOffset(index: number, width: number, gap: number, viewport: number) {
  return index * (width + gap) - (viewport - width) / 2
}

export function twitchAvatarUrl(username: string) {
  return `https://unavatar.io/twitch/${encodeURIComponent(username.replace(/^@/, ''))}`
}
```

Build `buildReelCards` from the existing weighted `buildWheelSegments` snapshot: add five lead-in cards, one winner card, and enough trailing cards to fill the reel without marking another winner.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `bun test frontend-react/tests/giveawayDisplay.test.ts`

- [ ] **Step 5: Commit the tested helper change**

```bash
git add frontend-react/src/features/dashboard/giveawayDisplay.ts frontend-react/tests/giveawayDisplay.test.ts
git commit -m "feat: add giveaway reel display helpers"
```

### Task 2: Render and animate the entrant reel

**Files:**
- Modify: `frontend-react/src/features/dashboard/GiveawayReveal.tsx`
- Modify: `frontend-react/src/features/dashboard/GiveawayReveal.module.css`

**Interfaces:**
- Consumes: `buildReelCards`, `reelLandingOffset`, `twitchAvatarUrl`, `avatarInitial`, existing reveal props.
- Produces: A horizontal card reel whose saved winner finishes under the static center marker.

- [ ] **Step 1: Add a focused component-level assertion or render test for winner card content if the project test harness supports React rendering**

Otherwise, use the pure helper test from Task 1 as the behavior-level regression test and keep the component as a direct consumer of those helpers.

- [ ] **Step 2: Implement the reel markup**

Replace the `conic-gradient` wheel with a viewport wrapper, static marker, and a `motion.div` track. Render `reelCards`; each card has an `img` with `alt=""`, `referrerPolicy="no-referrer"`, an `onError` handler that hides only that image, a visible initial fallback, and the username text. Use the existing `done` state to style the winner and show the unchanged final result.

- [ ] **Step 3: Implement the reel styles**

Create a clipped horizontal viewport; use fixed-width responsive cards, a dark blue-metal palette, circular avatar frames, a gold vertical marker, and a gold winner glow. Ensure the marker and text remain readable on narrow screens and the track avoids animation under reduced motion.

- [ ] **Step 4: Verify the frontend integration**

Run: `npm --prefix frontend-react run build`

Run: `npm --prefix frontend-react run lint`

- [ ] **Step 5: Commit the reveal replacement**

```bash
git add frontend-react/src/features/dashboard/GiveawayReveal.tsx frontend-react/src/features/dashboard/GiveawayReveal.module.css
git commit -m "feat: replace giveaway wheel with entrant reel"
```

### Task 3: Verify the completed flow

**Files:**
- Verify: `frontend-react/tests/giveawayDisplay.test.ts`
- Verify: `frontend-react/src/features/dashboard/GiveawayReveal.tsx`

- [ ] **Step 1: Run focused reel tests**

Run: `bun test frontend-react/tests/giveawayDisplay.test.ts`

- [ ] **Step 2: Run production frontend checks**

Run: `npm --prefix frontend-react run build`

Run: `npm --prefix frontend-react run lint`

- [ ] **Step 3: Manually confirm reduced-motion and image-fallback behavior in the dashboard reveal**

Open a giveaway draw, block one Unavatar image in browser dev tools, and confirm the username and initial remain visible. Enable reduced motion and confirm the saved winner appears immediately without changing the delayed announcement behavior.

- [ ] **Step 4: Commit verification-only updates if any test changes were needed**

```bash
git add frontend-react/tests/giveawayDisplay.test.ts
git commit -m "test: cover giveaway reel behavior"
```
