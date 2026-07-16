/**
 * Environment Variable Validation
 * Validates required environment variables at application startup
 * Fails fast with clear error messages if configuration is missing or weak
 */

import logger from '@/util/logger';

interface EnvRequirement {
  name: string;
  required: boolean;
  minLength?: number;
  production?: boolean; // Only required in production
  validate?: (value: string) => boolean;
  message?: string;
}

const WEAK_SECRETS = ['change_this_secret', 'supersecret', 'secret', 'password', 'test', 'dev', 'development'];

const ENV_REQUIREMENTS: EnvRequirement[] = [
  // Database
  { name: 'DATABASE_URL', required: false, production: true, message: 'Database connection URL' },
  { name: 'DB_HOST', required: false, message: 'Database host (if not using DATABASE_URL)' },

  // Session Security
  {
    name: 'SESSION_SECRET',
    required: true,
    minLength: 32,
    validate: (v) => !WEAK_SECRETS.includes(v.toLowerCase()),
    message: 'Session secret must be a strong random string (64+ chars recommended). Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  },

  // OAuth State Signing
  {
    name: 'OAUTH_STATE_SECRET',
    required: false,
    minLength: 32,
    validate: (v) => !WEAK_SECRETS.includes(v.toLowerCase()),
    message: 'OAuth state signing secret. Falls back to SESSION_SECRET if not set.'
  },

  // Token Encryption
  {
    name: 'TOKEN_ENCRYPTION_KEY',
    required: false,
    minLength: 32,
    validate: (v) => !WEAK_SECRETS.includes(v.toLowerCase()),
    message: 'Token encryption key for database storage. Falls back to SESSION_SECRET if not set.'
  },

  // Twitch OAuth
  { name: 'TWITCH_CLIENT_ID', required: true, message: 'Twitch application client ID' },
  { name: 'TWITCH_CLIENT_SECRET', required: true, minLength: 20, message: 'Twitch application client secret' },
  {
    name: 'BOT_CONTROL_SECRET',
    required: false,
    production: true,
    minLength: 32,
    validate: (v) => !WEAK_SECRETS.includes(v.toLowerCase()),
    message: 'Shared secret used to authenticate web-server calls to the local bot control API'
  },

  // Deployment
  {
    name: 'DEPLOY_SECRET',
    required: false,
    production: true,
    minLength: 32,
    validate: (v) => !WEAK_SECRETS.includes(v.toLowerCase()),
    message: 'Secret for triggering deployments'
  },

  // Stripe (required for payment processing)
  { name: 'STRIPE_SECRET_KEY', required: false, production: true, message: 'Stripe API secret key for payment processing' },
  { name: 'STRIPE_PUBLISHABLE_KEY', required: false, production: true, message: 'Stripe publishable key for frontend' },
  { name: 'STRIPE_WEBHOOK_SECRET', required: false, production: true, message: 'Stripe webhook signing secret' },
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnvironment(): ValidationResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of ENV_REQUIREMENTS) {
    const value = process.env[req.name];

    // Check if required
    const isRequired = req.required || (req.production && isProduction);
    if (isRequired && !value) {
      errors.push(`Missing required environment variable: ${req.name}. ${req.message || ''}`);
      continue;
    }

    // Skip further validation if not set
    if (!value) continue;

    // Check minimum length
    if (req.minLength && value.length < req.minLength) {
      const msg = `${req.name} is too short (${value.length} chars, min ${req.minLength}). ${req.message || ''}`;
      if (isProduction) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }

    // Run custom validator
    if (req.validate && !req.validate(value)) {
      const msg = `${req.name} failed validation. ${req.message || ''}`;
      if (isProduction) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateAndLog(): void {
  const result = validateEnvironment();

  // Log warnings
  for (const warning of result.warnings) {
    logger.warn(`[EnvValidation] ${warning}`);
  }

  // Log and throw on errors
  if (!result.valid) {
    for (const error of result.errors) {
      logger.error(`[EnvValidation] ${error}`);
    }
    throw new Error(`Environment validation failed with ${result.errors.length} error(s). Check logs above.`);
  }

  logger.info('[EnvValidation] All environment variables validated successfully');
}

export default validateAndLog;
