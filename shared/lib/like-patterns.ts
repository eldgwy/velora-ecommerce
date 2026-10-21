/**
 * Builds a literal ILIKE pattern fragment: escapes the LIKE wildcards
 * (`%`, `_`) and the escape character (`\`) itself so user input is matched
 * as plain text. The pattern must be bounded with `%…%` where wanted.
 */
export function escapeILike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
