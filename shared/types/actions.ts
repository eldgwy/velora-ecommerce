// ============================================
// Shared server-action result envelope
// ============================================

/**
 * Every server action in the app resolves to this discriminated union so
 * client forms can branch on `result.ok` without try/catch noise. Actions
 * return `{ ok: false, error }` for validation and persistence failures;
 * auth redirects from `requireSession` are allowed to propagate untouched.
 */
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
