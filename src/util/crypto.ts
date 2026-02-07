/**
 * Cryptographic Utilities for Secure Token Handling
 * Provides HMAC signing for OAuth state and AES encryption for tokens
 */

import crypto from 'crypto';
import logger from './logger';

// Use a dedicated secret for OAuth state signing (falls back to session secret)
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET;
// Use a dedicated secret for token encryption
const TOKEN_SECRET = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;

// Validate secrets exist and are strong enough
function validateSecrets(): void {
  const weakSecrets = ['change_this_secret', 'supersecret', 'secret', 'password'];

  if (!STATE_SECRET) {
    throw new Error('OAUTH_STATE_SECRET or SESSION_SECRET must be set');
  }

  if (!TOKEN_SECRET) {
    throw new Error('TOKEN_ENCRYPTION_KEY or SESSION_SECRET must be set');
  }

  if (weakSecrets.includes(STATE_SECRET.toLowerCase()) || STATE_SECRET.length < 32) {
    logger.warn('[Crypto] OAuth state secret is weak - use a 32+ character random string');
  }

  if (weakSecrets.includes(TOKEN_SECRET.toLowerCase()) || TOKEN_SECRET.length < 32) {
    logger.warn('[Crypto] Token encryption key is weak - use a 32+ character random string');
  }
}

// Validate on module load (except in test environment)
if (process.env.NODE_ENV !== 'test') {
  try {
    validateSecrets();
  } catch (err: any) {
    logger.error(`[Crypto] Secret validation failed: ${err.message}`);
  }
}

/**
 * Sign OAuth state with HMAC-SHA256
 * Prevents state parameter tampering in OAuth flows
 */
export function signOAuthState(payload: object): string {
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', STATE_SECRET!);
  hmac.update(data);
  const signature = hmac.digest('hex');

  // Combine data and signature
  const signed = {
    data: Buffer.from(data).toString('base64'),
    sig: signature,
  };

  return Buffer.from(JSON.stringify(signed)).toString('base64url');
}

/**
 * Verify and decode signed OAuth state
 * Returns null if signature is invalid or expired
 */
export function verifyOAuthState(signedState: string, maxAgeMs: number = 10 * 60 * 1000): object | null {
  try {
    const decoded = JSON.parse(Buffer.from(signedState, 'base64url').toString());
    const { data, sig } = decoded;

    if (!data || !sig) {
      logger.warn('[Crypto] Invalid OAuth state format - missing data or signature');
      return null;
    }

    // Verify signature
    const hmac = crypto.createHmac('sha256', STATE_SECRET!);
    const rawData = Buffer.from(data, 'base64').toString();
    hmac.update(rawData);
    const expectedSig = hmac.digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      logger.warn('[Crypto] OAuth state signature mismatch - possible tampering');
      return null;
    }

    const payload = JSON.parse(rawData);

    // Check timestamp if present
    if (payload.timestamp) {
      const age = Date.now() - payload.timestamp;
      if (age > maxAgeMs) {
        logger.warn(`[Crypto] OAuth state expired (age: ${age}ms, max: ${maxAgeMs}ms)`);
        return null;
      }
    }

    return payload;
  } catch (err) {
    logger.warn('[Crypto] Failed to verify OAuth state:', err);
    return null;
  }
}

/**
 * Encrypt sensitive tokens using AES-256-GCM
 * Returns encrypted data with IV and auth tag
 */
export function encryptToken(plaintext: string): string {
  // Derive a 32-byte key from the secret
  const key = crypto.scryptSync(TOKEN_SECRET!, 'salt', 32);

  // Generate random IV
  const iv = crypto.randomBytes(16);

  // Encrypt with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + encrypted data
  const combined = {
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    data: encrypted,
  };

  return Buffer.from(JSON.stringify(combined)).toString('base64');
}

/**
 * Decrypt encrypted tokens
 * Returns null if decryption fails
 */
export function decryptToken(encryptedData: string): string | null {
  try {
    const combined = JSON.parse(Buffer.from(encryptedData, 'base64').toString());
    const { iv, tag, data } = combined;

    if (!iv || !tag || !data) {
      logger.warn('[Crypto] Invalid encrypted token format');
      return null;
    }

    // Derive the same key
    const key = crypto.scryptSync(TOKEN_SECRET!, 'salt', 32);

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    logger.error('[Crypto] Failed to decrypt token:', err);
    return null;
  }
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a value with SHA-256 (for non-reversible storage)
 */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export default {
  signOAuthState,
  verifyOAuthState,
  encryptToken,
  decryptToken,
  generateSecureToken,
  hashValue,
};
