export const usernameRequirement = "Use 3 to 40 letters, digits, underscores or hyphens, starting with a letter or digit.";

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,39}$/.test(name) ? name : null;
}
