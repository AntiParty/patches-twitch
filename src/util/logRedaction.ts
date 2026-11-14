const SENSITIVE_PARAMS = new Set([
  'token',
  'code',
  'state',
  'key',
  'secret',
  'access_token',
  'refresh_token',
  'password',
  'signature',
]);

/**
 * Replace the values of sensitive query params with [redacted], keeping the
 * path and all other params intact. Never throws.
 */
export function redactUrl(url: string): string {
  try {
    const str = String(url);
    const qIndex = str.indexOf('?');
    if (qIndex === -1) return str;
    const hashIndex = str.indexOf('#', qIndex);
    const query = str.slice(qIndex + 1, hashIndex === -1 ? undefined : hashIndex);
    const hash = hashIndex === -1 ? '' : str.slice(hashIndex);
    const redacted = query
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1) return pair;
        let name = pair.slice(0, eq);
        try {
          name = decodeURIComponent(name);
        } catch {
          /* keep raw name */
        }
        return SENSITIVE_PARAMS.has(name.toLowerCase()) ? `${pair.slice(0, eq)}=[redacted]` : pair;
      })
      .join('&');
    return `${str.slice(0, qIndex)}?${redacted}${hash}`;
  } catch {
    return '[unparseable url]';
  }
}

/** Conservative redaction of obvious secrets in a log line. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\boauth:[A-Za-z0-9]+/gi, 'oauth:[redacted]')
    .replace(
      /(["']?\b(?:access_token|refresh_token|client_secret)\b["']?\s*[:=]\s*)(["'])(?:(?!\2).)*\2/gi,
      '$1$2[redacted]$2'
    )
    .replace(
      /(["']?\b(?:access_token|refresh_token|client_secret)\b["']?\s*[:=]\s*)(?![\["'])[^\s,&}"']+/gi,
      '$1[redacted]'
    );
}
