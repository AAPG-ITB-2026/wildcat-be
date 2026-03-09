import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/index.js';

export const logger = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const start = Date.now();
    
    await next();
    
    const duration = Date.now() - start;
    const status = c.res.status;
    const method = c.req.method;
    const path = c.req.path;
    
    // Use console for Wrangler - it will appear in wrangler tail
    console.log(`[${method}] ${path} - ${status} (${duration}ms)`);
});

export function logInfo(prefix: string, message: string, data?: unknown) {
    if (data) {
        console.log(`[${prefix}] ${message}`, data);
    } else {
        console.log(`[${prefix}] ${message}`);
    }
}

export function logError(prefix: string, message: string, error?: unknown) {
    if (error) {
        console.error(`[${prefix}] ${message}`, error);
    } else {
        console.error(`[${prefix}] ${message}`);
    }
}
