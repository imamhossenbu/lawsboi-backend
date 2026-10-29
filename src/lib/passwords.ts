import { randomInt } from "node:crypto";

export const MIN_PASSWORD = 8;

/** A temporary password for invitations: 12 characters without look-alikes, "k7Rm4pXw2Qn9". */
export function temporaryPassword(length = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join("");
}
