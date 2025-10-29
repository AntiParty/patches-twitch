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


