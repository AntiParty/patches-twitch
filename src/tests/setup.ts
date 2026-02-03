/**
 * Test Setup and Utilities
 * Common test helpers and mock factories for subscription testing
 */

/// <reference path="../types/session.d.ts" />

import { Request, Response, NextFunction } from 'express';

// Mock session data factory
export function createMockSession(overrides: Partial<{
  isUser: boolean;
  hasSubscription: boolean;
  subscriptionTier: string | null;
  role: string;
  twitchUsername: string;
  channelId: number;
}> = {}) {
  return {
    isUser: false,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'Basic user',
    twitchUsername: 'testuser',
    channelId: 1,
    ...overrides,
  };
}

// Mock request factory
export function createMockRequest(sessionOverrides: Parameters<typeof createMockSession>[0] = {}): Partial<Request> {
  return {
    session: createMockSession(sessionOverrides) as any,
    query: {},
    params: {},
    body: {},
  };
}

// Mock response factory
export function createMockResponse(): Partial<Response> & {
  statusCode: number;
  redirectUrl: string | null;
  jsonData: any;
} {
  const res: any = {
    statusCode: 200,
    redirectUrl: null,
    jsonData: null,
  };

  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };

  res.json = (data: any) => {
    res.jsonData = data;
    return res;
  };

  res.redirect = (url: string) => {
    res.redirectUrl = url;
    return res;
  };

  res.send = (data: any) => {
    res.jsonData = data;
    return res;
  };

  return res;
}

// Mock next function
export function createMockNext(): NextFunction & { called: boolean } {
  const next: any = () => {
    next.called = true;
  };
  next.called = false;
  return next;
}

// Test user scenarios
export const TestScenarios = {
  // Free user without subscription
  freeUser: {
    isUser: true,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'Basic user',
    twitchUsername: 'freeuser',
    channelId: 1,
  },

  // Paid subscriber
  subscriber: {
    isUser: true,
    hasSubscription: true,
    subscriptionTier: 'custom_bot',
    role: 'Basic user',
    twitchUsername: 'subscriber',
    channelId: 2,
  },

  // Tester role (bypass subscription)
  tester: {
    isUser: true,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'tester',
    twitchUsername: 'testeruser',
    channelId: 3,
  },

  // Staff role (bypass subscription)
  staff: {
    isUser: true,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'Staff',
    twitchUsername: 'staffuser',
    channelId: 4,
  },

  // Admin role (bypass subscription)
  admin: {
    isUser: true,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'admin',
    twitchUsername: 'adminuser',
    channelId: 5,
  },

  // Not logged in
  anonymous: {
    isUser: false,
    hasSubscription: false,
    subscriptionTier: null,
    role: 'Basic user',
    twitchUsername: '',
    channelId: 0,
  },

  // Expired subscriber (had subscription, now inactive)
  expiredSubscriber: {
    isUser: true,
    hasSubscription: false,
    subscriptionTier: 'custom_bot', // tier remains but hasSubscription is false
    role: 'Basic user',
    twitchUsername: 'expireduser',
    channelId: 6,
  },
};

// Helper to run middleware and capture result
export async function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => any,
  sessionOverrides: Parameters<typeof createMockSession>[0] = {}
): Promise<{
  req: ReturnType<typeof createMockRequest>;
  res: ReturnType<typeof createMockResponse>;
  next: ReturnType<typeof createMockNext>;
}> {
  const req = createMockRequest(sessionOverrides);
  const res = createMockResponse();
  const next = createMockNext();

  await Promise.resolve(middleware(req as Request, res as Response, next));

  return { req, res, next };
}

// Console colors for test output
export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// Simple assertion helpers
export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTrue(value: boolean, message: string): void {
  if (!value) {
    throw new Error(`${message}: expected true, got false`);
  }
}

export function assertFalse(value: boolean, message: string): void {
  if (value) {
    throw new Error(`${message}: expected false, got true`);
  }
}
