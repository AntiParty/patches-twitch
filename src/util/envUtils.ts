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
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    // Remove trailing comments (look for # preceded by a space)
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx).trim();
    }

    // Strip quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

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
  fs.writeFileSync(envPath, serialized, "utf8");
  return { wroteFile: true, filePath: envPath };
}

export function reloadEnv(): void {
  const envPath = getEnvFilePath();
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  const vars = parseEnv(content);
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}