const REFERENCE_UNIQUE_INDEX = "verify_tokens_reference_id_unique_idx";

export function isReferenceIdCollision(error: unknown): boolean {
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
      fields.some((value) => typeof value === "string" && value.includes(REFERENCE_UNIQUE_INDEX))
    ) {
      return true;
    }
    current = detail.cause;
  }
  return false;
}
