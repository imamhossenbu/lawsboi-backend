import type { ProfileRow } from "../../types/database.js";

/** The reader as the reader site sees themselves. */
export function profileOf(p: ProfileRow) {
  return {
    id: p.public_id,
    name: p.name,
    email: p.email,
    lang: p.lang,
    plan: p.plan_id,
    cycle: p.cycle,
    profile: { phone: p.phone, profession: p.profession, organization: p.organization, location: p.location, photo: p.photo_url },
    preferences: p.preferences,
    notifications: p.notifications,
    joinedAt: p.joined_at,
  };
}
