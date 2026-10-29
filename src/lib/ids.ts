// The ids people see: "TKT-001245", "USR-10047", "AGT-01". The database generates them; these only check their shape.

export const TICKET_ID = /^TKT-\d{6}$/;
export const USER_ID = /^USR-\d+$/;
export const AGENT_ID = /^AGT-\d+$/;

/** Readers get "You"; team ids pass through; null is unassigned. Lets the admin panel's "me" alias map to a real member. */
export const isAgentId = (value: string | null | undefined): value is string => !!value && AGENT_ID.test(value);
