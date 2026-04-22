import fs from "fs";
import path from "path";

function getEnvFilePath(): string {
  const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
  // Match server.ts resolution
  return path.resolve(__dirname, "..", "..", envFile);
}

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (key) result[key] = value;
  }
  return result;
}

function stringifyEnv(vars: Record<string, string>, original: string): string {
  const seen = new Set<string>();
  const lines = original.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1 || /^\s*#/.test(line) || !line.trim()) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      out.push(`${key}=${vars[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(vars)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  return out.join("\n");
}

/**
 * Get the base URL for the application based on environment
 * Uses BASE_URL env var, or falls back to environment-based default
 */
export function getBaseUrl(): string {
  return process.env.BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://finalsrs.com'
      : 'http://localhost:3000');
}

/**
 * Get the Twitch OAuth redirect URI based on environment
 */
export function getTwitchRedirectUri(): string {
  return process.env.TWITCH_REDIRECT_URI ||
    (process.env.NODE_ENV === 'production'
      ? 'https://finalsrs.com/callback'
      : 'http://localhost:3000/callback');
}

/**
 * Check if we're running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Check if we're running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function updateEnvVariables(updates: Record<string, string>): { wroteFile: boolean; filePath: string } {
  // Update process.env immediately
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }

  const envPath = getEnvFilePath();
  let original = "";
  try {
    original = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  } catch {
    original = "";
  }
  const current = parseEnv(original);
  const next = { ...current, ...updates };
  const serialized = stringifyEnv(next, original);

  // SAFETY: do NOT write .env if the serialized output is suspiciously small
  // compared to the original. A partial/truncated write that drops keys like
  // TOKEN_ENCRYPTION_KEY or SESSION_SECRET causes a cascading catastrophe:
  // every stored encrypted token becomes undecryptable on the next boot, and
  // our refresh path used to (incorrectly) forward ciphertext to Twitch — which
  // returned 400 and marked every user as "revoked" simultaneously.
  if (original && serialized.length < original.length / 2) {
    throw new Error(
      `[envUtils] Refusing to write .env: serialized output (${serialized.length}B) is <50% of original (${original.length}B). Aborting to prevent corruption.`
    );
  }

  // Atomic write: write to a sibling tmp file, fsync, then rename.
  // rename() is atomic on POSIX and on NTFS, so a crash mid-write can never
  // leave a half-written .env on disk.
  const tmpPath = `${envPath}.tmp`;
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, serialized, 0, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, envPath);

  return { wroteFile: true, filePath: envPath };
}