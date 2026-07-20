/**
 * Discriminated-union result type for data server actions.
 *
 * Server actions must NOT throw `Error` for expected failures: in production
 * builds Next.js replaces thrown error messages with an opaque digest string,
 * which breaks user-facing error UX and any message-based control flow on the
 * client. Actions return an {@link ActionResult} instead so callers can branch
 * on a stable `code` and display a safe `message`.
 */

/** A failed action outcome with a machine-readable code and safe message. */
export type ActionFailure = {
  ok: false;
  code:
    | 'unauthorized'
    | 'rate_limited'
    | 'validation'
    | 'save_failed'
    | 'load_failed'
    | 'no_taste_profile'
    | 'quota_exceeded'
    | 'pro_required';
  /** Safe, user-displayable message. */
  message: string;
  /** Seconds until the caller may retry — only set for `rate_limited`. */
  retryAfter?: number;
};

/** A successful action outcome carrying its payload, or a typed failure. */
export type ActionResult<T> = { ok: true; data: T } | ActionFailure;
