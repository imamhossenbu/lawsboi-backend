// Short names for the generated table and enum types, so modules read `ProfileRow` instead of `Tables<"profiles">`.
// Add an alias here when a module starts using a table; never edit database.ts (it is generated).

import type { Enums, Tables } from "./database.js";

// Generated columns come out nullable from `gen types`; a stored generated column always has a value.
type WithPublicId<T> = Omit<T, "public_id"> & { public_id: string };

export type Lang = Enums<"lang">;
export type BillingCycle = Enums<"billing_cycle">;
export type SubscriptionStatus = Enums<"subscription_status">;
export type PaymentMethod = Enums<"payment_method">;
export type PaymentStatus = Enums<"payment_status">;
export type RejectReason = Enums<"reject_reason">;
export type TeamRole = Enums<"team_role">;
export type TicketCategory = Enums<"ticket_category">;
export type TicketPriority = Enums<"ticket_priority">;
export type TicketStatus = Enums<"ticket_status">;
export type MessageKind = Enums<"message_kind">;
export type ActorKind = Enums<"actor_kind">;
export type TicketEventKind = Enums<"ticket_event_kind">;
export type OtpPurpose = Enums<"otp_purpose">;
export type ContentStatus = Enums<"content_status">;
export type AnnouncementStatus = Enums<"announcement_status">;
export type AnnouncementChannel = Enums<"announcement_channel">;
export type NotificationTopic = Enums<"notification_topic">;

export type PlanRow = Tables<"plans">;
export type ProfileRow = WithPublicId<Tables<"profiles">>;
export type TeamMemberRow = WithPublicId<Tables<"team_members">>;
export type EmailOtpRow = Tables<"email_otps">;
export type WalletAccountRow = Tables<"wallet_accounts">;
export type SubscriptionRow = WithPublicId<Tables<"subscriptions">>;
export type PaymentRow = WithPublicId<Tables<"payments">>;
export type TicketRow = WithPublicId<Tables<"tickets">>;
export type TicketMessageRow = Tables<"ticket_messages">;
export type TicketFileRow = Tables<"ticket_files">;
export type TicketEventRow = Tables<"ticket_events">;
export type AnnouncementRow = WithPublicId<Tables<"announcements">>;
export type HelpArticleRow = Tables<"help_articles">;
export type FaqRow = Tables<"faqs">;
export type SitePageRow = Tables<"site_pages">;
export type FeatureFlagRow = Tables<"feature_flags">;
export type SiteSettingRow = Tables<"site_settings">;
export type LawRow = Tables<"laws">;
export type LawPartRow = Tables<"law_parts">;
export type LawSectionRow = Tables<"law_sections">;
export type JudgmentRow = Tables<"judgments">;
export type JudgmentLawRow = Tables<"judgment_laws">;
export type AssistantQuestionRow = Tables<"assistant_questions">;
export type AuditLogRow = Tables<"audit_logs">;
