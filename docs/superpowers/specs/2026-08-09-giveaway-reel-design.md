# Giveaway Reel Design

## Goal

Replace the dashboard's circular giveaway reveal with a CS:GO-style horizontal reel without changing the persisted giveaway draw, eligibility rules, or delayed chat announcement.

## Experience

The reveal keeps its existing modal, headings, reduced-motion support, keyboard handling, and completion timing. The circular wheel is replaced with a masked, horizontal track of entrant cards that moves left beneath a fixed gold center marker. The predetermined winner always lands in the center position. Cards use a dark metallic treatment, show the entrant username and a circular avatar, and receive a gold treatment when they are the winning card.

The track is built from the existing representative, weighted entry snapshot. It is long enough to animate convincingly and includes the selected winner only at the landing position. The result card continues to show the winner after the animation finishes.

## Avatar policy

The frontend derives each card image as `https://unavatar.io/twitch/<encoded username>`. No Twitch API request, database field, or background job is added. The component deduplicates images through normal browser caching by using the same URL for repeated entries. If the image cannot load, it is hidden and the card shows the entrant's initial instead. Images are decorative; usernames remain visible text.

## Boundaries

- `giveawayDisplay.ts` owns deterministic reel-card construction and landing math.
- `GiveawayReveal.tsx` owns the animation, image fallback state, and accessible result messaging.
- `GiveawayReveal.module.css` owns the reel/card presentation and responsive layout.
- The API, route, giveaway service, database, and draw/announce flow remain unchanged.

## Verification

Unit tests cover winner placement, repeated weighted entries, fixed landing offsets, and the avatar URL/initial helpers. The React build and lint validate component and CSS integration.
