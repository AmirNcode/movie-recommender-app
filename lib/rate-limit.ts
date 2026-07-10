/**
 * Database-backed sliding-window rate limiter for Server Actions.
 *
 * Uses the Supabase RPC `check_rate_limit` for atomic counters per IP+action,
 * which works correctly across multiple instances.
 */

/** Per-action rate limit configuration. */
interface RateLimitConfig {
    /** Maximum number of requests allowed within the window. */
    maxRequests: number;
    /** Window duration in milliseconds. */
    windowMs: number;
}

/** Result returned by checkRateLimit. */
export interface RateLimitResult {
    /** Whether the request is allowed to proceed. */
    allowed: boolean;
    /** Seconds until the client can retry, only set when allowed is false. */
    retryAfter?: number;
}

/**
 * Rate limit configurations per action name.
 * Add new actions here as needed.
 */
const ACTION_LIMITS: Record<string, RateLimitConfig> = {
    getMovieRecommendation: { maxRequests: 10, windowMs: 60_000 },
    getQueuedMovies: { maxRequests: 30, windowMs: 60_000 },
    refillQueuedMovies: { maxRequests: 10, windowMs: 60_000 },
    // Fast swiping is legitimate; 2/sec sustained is not.
    saveSwipe: { maxRequests: 120, windowMs: 60_000 },
    setWatchlistItem: { maxRequests: 30, windowMs: 60_000 },
};

import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Checks whether a request from the given IP for the given action
 * should be allowed under the configured rate limit.
 *
 * @param ip - The client's IP address (from Next.js headers).
 * @param action - The action name, must match a key in ACTION_LIMITS.
 * @returns An object indicating whether the request is allowed, and
 *          how many seconds until the client can retry if not.
 */
export async function checkRateLimit(
    ip: string,
    action: string,
    userId?: string
): Promise<RateLimitResult> {
    const config = ACTION_LIMITS[action];
    if (!config) {
        // Unknown action — fail-open, but log loudly so a typo can't silently
        // disable rate limiting for a real action.
        logger.error('RATE_LIMIT_UNCONFIGURED_ACTION', { action });
        return { allowed: true };
    }

    // When authenticated, key by user so a shared NAT IP can't exhaust one user's
    // budget (and vice versa). Anonymous callers fall back to IP-only.
    const key = userId ? `user:${userId}:${action}` : `ip:${ip}:${action}`;
    const supabase = createAdminClient();
    if (!supabase) {
        console.warn('[RateLimit] Missing Supabase environment variables. Bypassing rate limit.');
        return { allowed: true };
    }

    // Use string type for intervals in PostgreSQL (e.g., "60000 milliseconds")
    const intervalStr = `${config.windowMs} milliseconds`;

    const { data, error } = await supabase.rpc('check_rate_limit', {
        ip_action_key: key,
        max_reqs: config.maxRequests,
        window_interval: intervalStr,
    } as any);

    if (error) {
        console.error('[RateLimit] Supabase RPC error:', error);
        // Fail-open if the DB is unreachable to prevent breaking the app,
        // or fail-closed depending on security posture. Fail-open is standard for this.
        return { allowed: true };
    }

    // Parse the JSON result returned by the RPC
    const result = data as any;
    
    // In case string came back instead of parsed json (due to typed RPC mismatches)
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    if (parsed && parsed.allowed === false) {
        return {
            allowed: false,
            retryAfter: parsed.retryAfter || Math.ceil(config.windowMs / 1000),
        };
    }

    return { allowed: true };
}
