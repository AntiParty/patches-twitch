// Invisible characters chat clients append to bypass Twitch's duplicate-message filter
// (Chatterino: U+034F, 7TV: U+E0000, others: zero-width space/word joiner/BOM).
// ZWJ (U+200D) is left alone because emoji sequences depend on it.
const INVISIBLE_CHARS = /[͏​⁠﻿]|\u{E0000}/gu;

export function stripInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS, '').trim();
}
