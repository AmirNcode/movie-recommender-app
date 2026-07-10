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
    /**
     * Behaviour when the rate-limit backend is unreachable.
     * 'open' (default): allow the request (availability over cost control).
     * 'closed': deny the request (cost control over availability) — use for
     * actions that hit a paid third-party API.
     */
    failMode?: 'open' | 'closed';
}

/** Result returned by checkRateLimit. */
export interface RateLimitResult {
    /** Whether the request is allowed to proceed. */
    allowed: boolean;
    /** Seconds until the client can retry, only set when allowed is false. */
    retryAfter?: number;
}

/**
 * Parses the raw `check_rate_limit` RPC response into a {@link RateLimitResult}.
 *
 * The RPC's return type is untyped Json; the function body always returns a
 * JSON object, but the Supabase client may hand it back as a string in some
 * code paths, so both shapes are handled defensively. Falls back to the
 * configured window when the backend omits `retryAfter` on a denial.
 */
export function parseRateLimitResult(data: unknown, windowMs: number): RateLimitResult {
    const parsed: { allowed: boolean; retryAfter?: number } | null =
        typeof data === 'string' ? JSON.parse(data) : (data as { allowed: boolean; retryAfter?: number } | null);

    if (parsed && parsed.allowed === false) {
        return {
            allowed: false,
            retryAfter: parsed.retryAfter || Math.ceil(windowMs / 1000),
        };
    }

    return { allowed: true };
}

/**
 * Rate limit configurations per action name.
 * Add new actions here as needed.
 */
const ACTION_LIMITS: Record<string, RateLimitConfig> = {
    // Paid Gemini call — fail closed so a DB hiccup can't disable cost control.
    getMovieRecommendation: { maxRequests: 10, windowMs: 60_000, failMode: 'closed' },
    getQueuedMovies: { maxRequests: 30, windowMs: 60_000 },
    refillQueuedMovies: { maxRequests: 10, windowMs: 60_000 },
    getOnboardingMovies: { maxRequests: 10, windowMs: 60_000 },
    // Fast swiping is legitimate; 2/sec sustained is not.
    saveSwipe: { maxRequests: 120, windowMs: 60_000 },
    setWatchlistItem: { maxRequests: 30, windowMs: 60_000 },
    getWatchProviders: { maxRequests: 30, windowMs: 60_000 },
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
        logger.error('RATE_LIMIT_BACKEND_DOWN', { action, reason: 'missing_admin_client' });
        return { allowed: config.failMode !== 'closed' };
    }

    // Use string type for intervals in PostgreSQL (e.g., "60000 milliseconds")
    const intervalStr = `${config.windowMs} milliseconds`;

    const { data, error } = await supabase.rpc('check_rate_limit', {
        ip_action_key: key,
        max_reqs: config.maxRequests,
        window_interval: intervalStr,
    });

    if (error) {
        logger.error('RATE_LIMIT_BACKEND_DOWN', { action });
        return { allowed: config.failMode !== 'closed' };
    }

    return parseRateLimitResult(data, config.windowMs);
}
