interface Issue {
  path: PropertyKey[];
  message: string;
}

/** Structural subset of a Zod schema so the web app need not depend on zod directly. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}

export type FieldErrors = Record<string, string>;
export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

const GENERIC_MESSAGE = 'Enter a valid value';
const TECHNICAL_MESSAGE = /^(Invalid input|Invalid (string|number))/;

export function validate<T>(schema: Schema<T>, values: unknown): ValidationResult<T> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.');
    if (!(key in errors)) errors[key] = TECHNICAL_MESSAGE.test(issue.message) ? GENERIC_MESSAGE : issue.message;
  }
  return { ok: false, errors };
}

/** Form inputs are strings; blank becomes undefined so optional schema fields work, malformed numbers become NaN. */
export function toOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

export function blankToUndefined(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
