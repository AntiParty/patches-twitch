/**
 * CSRF Protection Middleware
 * Provides CSRF token generation and validation for admin routes
 */
import csrf from 'csurf';
import express from 'express';

// CSRF protection middleware
export const csrfProtection = csrf({ cookie: false });

// Middleware for admin login routes: parse urlencoded
export const adminLoginMiddleware = [
    express.urlencoded({ extended: false })
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