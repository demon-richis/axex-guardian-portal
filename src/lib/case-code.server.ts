export const CASE_CODE_PATTERN = /^[1-9][0-9]{7}$/;

const CASE_CODE_UNIQUE_INDEX = "verify_tokens_guild_case_code_unique_idx";

export function isCaseCode(value: unknown): value is string {
  return typeof value === "string" && CASE_CODE_PATTERN.test(value);
}

export function isCaseCodeCollision(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const detail = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const fields = [detail.constraint, detail.constraint_name, detail.message];
    if (
      detail.code === "23505" &&
      fields.some((value) => typeof value === "string" && value.includes(CASE_CODE_UNIQUE_INDEX))
    ) {
      return true;
    }
    current = detail.cause;
  }
  return false;
}
