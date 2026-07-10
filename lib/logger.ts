/**
 * Minimal structured logger for server-side code.
 *
 * In development: logs full details (code + context) for easy debugging.
 * In production: logs only a structured error code and minimal context,
 * avoiding exposure of internal API structure, third-party service names,
 * or failure details that could aid an attacker.
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Structured log details. Keys should be short identifiers, values
 * should not contain sensitive information (API keys, user data, etc.).
 */
type LogDetails = Record<string, unknown>;

/** Key names redacted entirely from production logs, regardless of value. */
const SENSITIVE_KEY_PATTERN = /(key|token|secret|password|authorization)/i;

/** Max length for string values kept in production logs. */
const MAX_STRING_LOG_LENGTH = 200;

/**
 * Filters a details object down to what's safe to log in production:
 * numbers pass through as-is, strings are kept but truncated, and any
 * key matching SENSITIVE_KEY_PATTERN is dropped entirely. Objects and
 * other types are dropped (no JSON.stringify of unknown values).
 */
function sanitiseDetails(details?: LogDetails): LogDetails {
    const safeDetails: LogDetails = {};
    if (!details) return safeDetails;
    for (const [key, value] of Object.entries(details)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        if (typeof value === 'number') {
            safeDetails[key] = value;
        } else if (typeof value === 'string') {
            safeDetails[key] = value.slice(0, MAX_STRING_LOG_LENGTH);
        }
    }
    return safeDetails;
}

/**
 * Logs an error with a structured code and optional details.
 *
 * @param code - A short, uppercase error code (e.g. 'TMDB_FETCH_FAILED').
 * @param details - Optional context object. In production, sensitive keys
 *                  are redacted and strings are truncated (see sanitiseDetails).
 */
function error(code: string, details?: LogDetails): void {
    if (isDev) {
        // Development: full details for debugging
        console.error(`[ERROR] ${code}`, details ?? '');
    } else {
        console.error(
            JSON.stringify({ level: 'error', code, ...sanitiseDetails(details) })
        );
    }
}

/**
 * Logs a warning with a structured code and optional details.
 *
 * @param code - A short, uppercase warning code.
 * @param details - Optional context object. Same production filtering as error().
 */
function warn(code: string, details?: LogDetails): void {
    if (isDev) {
        console.warn(`[WARN] ${code}`, details ?? '');
    } else {
        console.warn(
            JSON.stringify({ level: 'warn', code, ...sanitiseDetails(details) })
        );
    }
}

/** Structured logger instance for server-side use. */
export const logger = { error, warn } as const;
