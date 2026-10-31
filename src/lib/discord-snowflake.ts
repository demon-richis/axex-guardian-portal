const DISCORD_EPOCH_MS = 1420070400000n;

/** Converts a Discord snowflake into its creation timestamp (ms), or null when the id is not a snowflake. */
export function snowflakeToTimestamp(id: unknown): number | null {
  if (typeof id !== "string" || !/^[0-9]{15,25}$/.test(id)) return null;
  const timestamp = Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}
