/**
 * CSRF Protection Middleware
 * Provides CSRF token generation and validation for admin routes
 */
import csrf from 'csurf';
import express from 'express';

// CSRF protection middleware for admin routes
export const csrfProtection = csrf();

// Middleware for admin login routes: parse urlencoded and apply CSRF
export const adminLoginMiddleware = [
    express.urlencoded({ extended: false }),
    csrfProtection
];

/**
 * CSRF error handler for admin routes
 * Must be used after routes that use CSRF protection
 */
export function csrfErrorHandler(err: any, req: any, res: any, next: any) {
    if (err.code !== 'EBADCSRFTOKEN') {
        return next(err);
    }
    res.status(403).send('Forbidden: invalid CSRF token');
}