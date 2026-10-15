export const passwordRequirement = "Use at least 8 characters, including an uppercase letter, a lowercase letter and a digit.";

export function validPassword(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 1024 &&
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
