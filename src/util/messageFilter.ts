import fs from 'fs';
import path from 'path';

let wordsList: string[] = [];
let phrasesList: string[] = [];
let wordsRegexp: RegExp | null = null;
let phrasesRegexp: RegExp | null = null;
let blockRegexp: RegExp | null = null;

// ...existing code... (keep only the first definition of loadListFromEnvOrFile)

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// FUNCTION THAT CONTAINS A LIST OF LINKS THAT ARE ALLOWED TO BE SENT
function allowedLinks(text: string): boolean {
  const allowedLinksList = ['https://discord.gg/2UKzvzSEqA', 'https://finalsRS.com', 'https://finalsrs.com/'];
  return allowedLinksList.some(link => text.includes(link));
}

function buildWordsRegexp(list: string[]): RegExp | null {
  if (!list || list.length === 0) return null;
  const escaped = list.map(w => escapeForRegex(w));
  try {
    return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'iu');
  } catch (e) {
    return null;
  }
}

function buildPhrasesRegexp(list: string[]): RegExp | null {
  if (!list || list.length === 0) return null;
  const escaped = list.map(p => escapeForRegex(p));
  try {
    return new RegExp('(' + escaped.join('|') + ')', 'iu');
  } catch (e) {
    return null;
  }
}

function ensureLoaded() {
  if (wordsRegexp && phrasesRegexp && blockRegexp !== undefined) return;

  // Load base lists from environment or plaintext files
  wordsList = loadListFromEnvOrFile('BLOCKED_WORDS', path.join('config', 'blocked_words.txt'));
  phrasesList = loadListFromEnvOrFile('BLOCKED_PHRASES', path.join('config', 'blocked_phrases.txt'));

  // Try loading JSON config and merge
  try {
    const jsonPath = path.resolve(process.cwd(), 'config', 'blocked.json');
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.words)) {
        wordsList = Array.from(new Set([...wordsList, ...parsed.words.map((s: any) => String(s).trim()).filter(Boolean)]));
      }
      if (Array.isArray(parsed.phrases)) {
        phrasesList = Array.from(new Set([...phrasesList, ...parsed.phrases.map((s: any) => String(s).trim()).filter(Boolean)]));
      }

      // Support regex as string or array in JSON; merge with env var if present
      if (parsed.regex) {
        let jsonRegexStr = '';
        if (Array.isArray(parsed.regex)) {
          const joined = parsed.regex.map((r: any) => String(r)).filter(Boolean).map((r: string) => `(?:${r})`).join('|');
          jsonRegexStr = joined;
        } else if (typeof parsed.regex === 'string') {
          jsonRegexStr = parsed.regex;
        }
        if (jsonRegexStr) {
          if (process.env.BLOCKED_REGEX && process.env.BLOCKED_REGEX.trim()) {
            process.env.BLOCKED_REGEX = `(?:${process.env.BLOCKED_REGEX})|(?:${jsonRegexStr})`;
          } else {
            process.env.BLOCKED_REGEX = jsonRegexStr;
          }
        }
      }

      // Apply exemptions (remove from lists)
      if (Array.isArray(parsed.exemptions) && parsed.exemptions.length > 0) {
        const exSet = new Set(parsed.exemptions.map((s: any) => String(s).trim().toLowerCase()));
        wordsList = wordsList.filter(w => !exSet.has(String(w).toLowerCase()));
        phrasesList = phrasesList.filter(p => !exSet.has(String(p).toLowerCase()));
      }
    }
  } catch (e) {
    // ignore malformed JSON or read errors
  }

  const regexStr = process.env.BLOCKED_REGEX || '';

  wordsRegexp = buildWordsRegexp(wordsList);
  phrasesRegexp = buildPhrasesRegexp(phrasesList);
  try {
    blockRegexp = regexStr ? new RegExp(regexStr, 'iu') : null;
  } catch (e) {
    blockRegexp = null;
  }
}

export function containsBlockedWord(text?: string | null): boolean {
  if (!text) return false;
  ensureLoaded();
  return !!(wordsRegexp && wordsRegexp.test(text));
}

export function containsBlockedPhrase(text?: string | null): boolean {
  if (!text) return false;
  ensureLoaded();
  return !!(phrasesRegexp && phrasesRegexp.test(text));
}

export function matchesBlockRegex(text?: string | null): boolean {
  if (!text) return false;
  ensureLoaded();
  if (allowedLinks(text)) {
    return false;
  }
  // Strip player name patterns (e.g., digcron.ttv#3309, player.twitch#1234)
  // before running the URL/regex check so branded suffixes in player names don't trigger it
  const sanitizedForRegex = text.replace(/\S+#\d{1,6}/g, 'PLAYER');
  return !!(blockRegexp && blockRegexp.test(sanitizedForRegex));
}

export function sanitizeMessage(text?: string | null, replacement = '[redacted]'): string {
  if (!text) return '';
  ensureLoaded();
  let out = text;
  if (wordsRegexp) {
    out = out.replace(wordsRegexp, replacement);
  }
  if (phrasesRegexp) {
    out = out.replace(phrasesRegexp, replacement);
  }
  return out;
}

export function getBlockedWords(): { words: string[]; phrases: string[]; regex?: string | null } {
  ensureLoaded();
  return { words: wordsList.slice(), phrases: phrasesList.slice(), regex: process.env.BLOCKED_REGEX || null };
}

function loadListFromEnvOrFile(envKey: string, fallbackFile: string): string[] {
  const envVal = process.env[envKey] || '';
  if (envVal.trim()) {
    return envVal.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }

  const filePath = process.env[envKey + '_FILE'] || path.resolve(process.cwd(), fallbackFile);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
  } catch (e) {
    // ignore and return empty
  }
  return [];
}