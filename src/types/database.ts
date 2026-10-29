// The tables the API touches, typed by hand to match supabase/migrations. Regenerate from the live schema with
// `npm run db:types` once the Supabase CLI is signed in; the shapes below are what that command produces.
// Rows are type aliases, not interfaces: supabase-js needs the implicit index signature only aliases have.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Lang = "en" | "bn";
export type BillingCycle = "monthly" | "yearly";
export type TeamRole = "admin" | "editor" | "support";
export type TicketCategory = "account" | "billing" | "content" | "ai" | "technical" | "other";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "progress" | "waiting" | "resolved" | "closed";
export type MessageKind = "reader" | "reply" | "note";
export type ActorKind = "reader" | "team" | "system";
export type TicketEventKind = "created" | "assigned" | "unassigned" | "status" | "priority" | "category" | "reply" | "note";
export type OtpPurpose = "signup" | "reset";

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type PlanRow = {
  id: string;
  name: string;
  name_bn: string;
  description: string;
  description_bn: string;
  price_monthly: number;
  price_yearly: number | null;
  features: Json;
  active: boolean;
  is_default: boolean;
  icon: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProfileRow = {
  id: string;
  reader_no: number;
  public_id: string;
  name: string;
  name_bn: string | null;
  email: string;
  lang: Lang;
  phone: string;
  profession: string;
  organization: string;
  location: string;
  photo_url: string | null;
  plan_id: string;
  cycle: BillingCycle | null;
  active: boolean;
  preferences: Json;
  notifications: Json;
  joined_at: string;
  last_active_at: string;
  created_at: string;
  updated_at: string;
}

export type TeamMemberRow = {
  id: string;
  member_no: number;
  public_id: string;
  name: string;
  name_bn: string | null;
  email: string;
  role: TeamRole;
  permissions: string[];
  active: boolean;
  phone: string;
  photo_url: string | null;
  signature: string;
  signature_bn: string;
  invited_by: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export type EmailOtpRow = {
  id: string;
  email: string;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export type TicketRow = {
  id: string;
  number: number;
  public_id: string;
  user_id: string;
  subject: string;
  lang: Lang;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  resolved_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export type TicketMessageRow = {
  id: string;
  ticket_id: string;
  kind: MessageKind;
  author_kind: ActorKind;
  author_id: string | null;
  body: string;
  created_at: string;
}

export type TicketFileRow = {
  id: string;
  ticket_id: string;
  message_id: string;
  name: string;
  size: number;
  mime: string;
  storage_path: string;
  created_at: string;
}

export type TicketEventRow = {
  id: string;
  ticket_id: string;
  kind: TicketEventKind;
  actor_kind: ActorKind;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

export type AuditLogRow = {
  id: string;
  at: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_label: Json;
  changes: Json;
  sensitive: boolean;
  ip: string | null;
  user_agent: string | null;
}

export interface Database {
  public: {
    Tables: {
      plans: Table<PlanRow>;
      profiles: Table<ProfileRow>;
      team_members: Table<TeamMemberRow>;
      email_otps: Table<EmailOtpRow>;
      tickets: Table<TicketRow>;
      ticket_messages: Table<TicketMessageRow>;
      ticket_files: Table<TicketFileRow>;
      ticket_events: Table<TicketEventRow>;
      audit_logs: Table<AuditLogRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      lang: Lang;
      billing_cycle: BillingCycle;
      team_role: TeamRole;
      ticket_category: TicketCategory;
      ticket_priority: TicketPriority;
      ticket_status: TicketStatus;
      message_kind: MessageKind;
      actor_kind: ActorKind;
      ticket_event_kind: TicketEventKind;
      otp_purpose: OtpPurpose;
    };
    CompositeTypes: Record<string, never>;
  };
}
