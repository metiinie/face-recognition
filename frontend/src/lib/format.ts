/**
 * Safe formatting helpers for UI rendering across live data feeds.
 */

/** Return up to two uppercase initials for a person's display name. */
export function getInitials(name?: string | null): string {
  if (!name) return "?";
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "?";
}

/** Extract the HH:MM time token from an "YYYY-MM-DD HH:MM..." string safely. */
export function extractEatTimeToken(timestamp?: string | null): string {
  if (!timestamp) return "—";
  const parts = timestamp.trim().split(/\s+/);
  return parts[1] ?? parts[0] ?? "—";
}
