// Generated from the live schema by `npm run db:types` (supabase gen types). Do not edit by hand: change a
// migration, apply it, and regenerate. Row aliases the code uses live in rows.ts.


export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "announcement_reads": {
                  Row: {
                    "announcement_id": string,"read_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "announcement_id": string,"read_at"?: string,"user_id": string
                  }
                  Update: {
                    "announcement_id"?: string,"read_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_reads_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_reads_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "at": string,"banner_ended": boolean,"banner_until": string | null,"body": string,"body_bn": string,"channels": (Database["public"]['Enums']["announcement_channel"])[],"created_at": string,"created_by": string | null,"delivery": Json | null,"id": string,"link": string | null,"number": number,"plan_ids": (string)[],"public_id": string | null,"status": Database["public"]['Enums']["announcement_status"],"title": string,"title_bn": string,"topic": Database["public"]['Enums']["notification_topic"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"banner_ended"?: boolean,"banner_until"?: string | null,"body": string,"body_bn": string,"channels"?: (Database["public"]['Enums']["announcement_channel"])[],"created_at"?: string,"created_by"?: string | null,"delivery"?: Json | null,"id"?: string,"link"?: string | null,"number"?: never,"plan_ids"?: (string)[],"public_id"?: never,"status"?: Database["public"]['Enums']["announcement_status"],"title": string,"title_bn": string,"topic": Database["public"]['Enums']["notification_topic"],"updated_at"?: string
                  }
                  Update: {
                    "at"?: string,"banner_ended"?: boolean,"banner_until"?: string | null,"body"?: string,"body_bn"?: string,"channels"?: (Database["public"]['Enums']["announcement_channel"])[],"created_at"?: string,"created_by"?: string | null,"delivery"?: Json | null,"id"?: string,"link"?: string | null,"number"?: never,"plan_ids"?: (string)[],"public_id"?: never,"status"?: Database["public"]['Enums']["announcement_status"],"title"?: string,"title_bn"?: string,"topic"?: Database["public"]['Enums']["notification_topic"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"assistant_questions": {
                  Row: {
                    "answer": Json | null,"created_at": string,"flagged": boolean,"id": string,"lang": Database["public"]['Enums']["lang"],"question": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answer"?: Json | null,"created_at"?: string,"flagged"?: boolean,"id"?: string,"lang"?: Database["public"]['Enums']["lang"],"question": string,"user_id"?: string | null
                  }
                  Update: {
                    "answer"?: Json | null,"created_at"?: string,"flagged"?: boolean,"id"?: string,"lang"?: Database["public"]['Enums']["lang"],"question"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "assistant_questions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"at": string,"changes": NonNullable<Json>,"id": string,"ip": unknown,"sensitive": boolean,"target_id": string,"target_label": NonNullable<Json>,"target_type": string,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"at"?: string,"changes"?: NonNullable<Json>,"id"?: string,"ip"?: unknown,"sensitive"?: boolean,"target_id": string,"target_label"?: NonNullable<Json>,"target_type": string,"user_agent"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"at"?: string,"changes"?: NonNullable<Json>,"id"?: string,"ip"?: unknown,"sensitive"?: boolean,"target_id"?: string,"target_label"?: NonNullable<Json>,"target_type"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"email_otps": {
                  Row: {
                    "attempts": number,"code_hash": string,"consumed_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"purpose": Database["public"]['Enums']["otp_purpose"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"code_hash": string,"consumed_at"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"purpose": Database["public"]['Enums']["otp_purpose"]
                  }
                  Update: {
                    "attempts"?: number,"code_hash"?: string,"consumed_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"purpose"?: Database["public"]['Enums']["otp_purpose"]
                  }
                  Relationships: [
                    
                  ]
                },"faqs": {
                  Row: {
                    "answer": string,"answer_bn": string,"created_at": string,"id": string,"place": string,"question": string,"question_bn": string,"sort_order": number,"status": Database["public"]['Enums']["content_status"],"topic": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"answer_bn": string,"created_at"?: string,"id"?: string,"place": string,"question": string,"question_bn": string,"sort_order"?: number,"status"?: Database["public"]['Enums']["content_status"],"topic"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "answer"?: string,"answer_bn"?: string,"created_at"?: string,"id"?: string,"place"?: string,"question"?: string,"question_bn"?: string,"sort_order"?: number,"status"?: Database["public"]['Enums']["content_status"],"topic"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"feature_flag_events": {
                  Row: {
                    "actor_id": string | null,"change": NonNullable<Json>,"created_at": string,"flag_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"change": NonNullable<Json>,"created_at"?: string,"flag_id": string,"id"?: string
                  }
                  Update: {
                    "actor_id"?: string | null,"change"?: NonNullable<Json>,"created_at"?: string,"flag_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_flag_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_flag_events_flag_id_fkey"
      columns: ["flag_id"]
isOneToOne: false
      referencedRelation: "feature_flags"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_flags": {
                  Row: {
                    "access": NonNullable<Json>,"allowance": Json | null,"enabled": boolean,"group": string,"id": string,"pages": (string)[],"per": string | null,"rollout": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access"?: NonNullable<Json>,"allowance"?: Json | null,"enabled"?: boolean,"group": string,"id": string,"pages"?: (string)[],"per"?: string | null,"rollout"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "access"?: NonNullable<Json>,"allowance"?: Json | null,"enabled"?: boolean,"group"?: string,"id"?: string,"pages"?: (string)[],"per"?: string | null,"rollout"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"help_articles": {
                  Row: {
                    "created_at": string,"helpful_no": number,"helpful_yes": number,"icon": string,"reads": number,"slug": string,"sort_order": number,"status": Database["public"]['Enums']["content_status"],"steps": NonNullable<Json>,"summary": string,"summary_bn": string,"title": string,"title_bn": string,"try_href": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"helpful_no"?: number,"helpful_yes"?: number,"icon"?: string,"reads"?: number,"slug": string,"sort_order"?: number,"status"?: Database["public"]['Enums']["content_status"],"steps"?: NonNullable<Json>,"summary"?: string,"summary_bn"?: string,"title": string,"title_bn": string,"try_href"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"helpful_no"?: number,"helpful_yes"?: number,"icon"?: string,"reads"?: number,"slug"?: string,"sort_order"?: number,"status"?: Database["public"]['Enums']["content_status"],"steps"?: NonNullable<Json>,"summary"?: string,"summary_bn"?: string,"title"?: string,"title_bn"?: string,"try_href"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"judgment_laws": {
                  Row: {
                    "judgment_slug": string,"kind": string,"law_slug": string,"n": string
                  }
                  ComputedFields: never
                  Insert: {
                    "judgment_slug": string,"kind"?: string,"law_slug": string,"n": string
                  }
                  Update: {
                    "judgment_slug"?: string,"kind"?: string,"law_slug"?: string,"n"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "judgment_laws_judgment_slug_fkey"
      columns: ["judgment_slug"]
isOneToOne: false
      referencedRelation: "judgments"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "judgment_laws_law_slug_fkey"
      columns: ["law_slug"]
isOneToOne: false
      referencedRelation: "laws"
      referencedColumns: ["slug"]
    }
                  ]
                },"judgments": {
                  Row: {
                    "author": string | null,"case_no": string,"citation": string,"court": string,"created_at": string,"decided_on": string | null,"excerpt": string | null,"judges": (string)[],"keywords": (string)[],"language": Database["public"]['Enums']["lang"],"origin": string | null,"paragraphs": NonNullable<Json>,"parties": Json | null,"published": boolean,"search": unknown,"slug": string,"source": Json | null,"title": string,"title_tr": string | null,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"case_no"?: string,"citation": string,"court": string,"created_at"?: string,"decided_on"?: string | null,"excerpt"?: string | null,"judges"?: (string)[],"keywords"?: (string)[],"language"?: Database["public"]['Enums']["lang"],"origin"?: string | null,"paragraphs"?: NonNullable<Json>,"parties"?: Json | null,"published"?: boolean,"search"?: never,"slug": string,"source"?: Json | null,"title": string,"title_tr"?: string | null,"type"?: string,"updated_at"?: string
                  }
                  Update: {
                    "author"?: string | null,"case_no"?: string,"citation"?: string,"court"?: string,"created_at"?: string,"decided_on"?: string | null,"excerpt"?: string | null,"judges"?: (string)[],"keywords"?: (string)[],"language"?: Database["public"]['Enums']["lang"],"origin"?: string | null,"paragraphs"?: NonNullable<Json>,"parties"?: Json | null,"published"?: boolean,"search"?: never,"slug"?: string,"source"?: Json | null,"title"?: string,"title_tr"?: string | null,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"law_parts": {
                  Row: {
                    "banner": string | null,"id": string,"law_slug": string,"part_id": string,"range": string,"sort_order": number,"sub": string | null,"title": string,"title_tr": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "banner"?: string | null,"id"?: string,"law_slug": string,"part_id": string,"range"?: string,"sort_order": number,"sub"?: string | null,"title": string,"title_tr"?: string | null
                  }
                  Update: {
                    "banner"?: string | null,"id"?: string,"law_slug"?: string,"part_id"?: string,"range"?: string,"sort_order"?: number,"sub"?: string | null,"title"?: string,"title_tr"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "law_parts_law_slug_fkey"
      columns: ["law_slug"]
isOneToOne: false
      referencedRelation: "laws"
      referencedColumns: ["slug"]
    }
                  ]
                },"law_sections": {
                  Row: {
                    "body": NonNullable<Json>,"id": string,"law_slug": string,"n": string,"notes": NonNullable<Json>,"part_id": string | null,"sort_order": number,"title": string,"translation": Json | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: NonNullable<Json>,"id"?: string,"law_slug": string,"n": string,"notes"?: NonNullable<Json>,"part_id"?: string | null,"sort_order": number,"title": string,"translation"?: Json | null,"updated_at"?: string
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"id"?: string,"law_slug"?: string,"n"?: string,"notes"?: NonNullable<Json>,"part_id"?: string | null,"sort_order"?: number,"title"?: string,"translation"?: Json | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "law_sections_law_slug_fkey"
      columns: ["law_slug"]
isOneToOne: false
      referencedRelation: "laws"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "law_sections_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "law_parts"
      referencedColumns: ["id"]
    }
                  ]
                },"laws": {
                  Row: {
                    "act_no": string,"bdlaws_id": number | null,"created_at": string,"description": string,"enacted_on": string,"language": Database["public"]['Enums']["lang"],"long_title": string,"preamble": string,"published": boolean,"search": unknown,"section_count": number,"slug": string,"status": string,"subject": string,"title": string,"title_bn": string | null,"type": string,"unit": string,"updated_at": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "act_no"?: string,"bdlaws_id"?: number | null,"created_at"?: string,"description"?: string,"enacted_on"?: string,"language"?: Database["public"]['Enums']["lang"],"long_title"?: string,"preamble"?: string,"published"?: boolean,"search"?: never,"section_count"?: number,"slug": string,"status"?: string,"subject"?: string,"title": string,"title_bn"?: string | null,"type": string,"unit"?: string,"updated_at"?: string,"year": number
                  }
                  Update: {
                    "act_no"?: string,"bdlaws_id"?: number | null,"created_at"?: string,"description"?: string,"enacted_on"?: string,"language"?: Database["public"]['Enums']["lang"],"long_title"?: string,"preamble"?: string,"published"?: boolean,"search"?: never,"section_count"?: number,"slug"?: string,"status"?: string,"subject"?: string,"title"?: string,"title_bn"?: string | null,"type"?: string,"unit"?: string,"updated_at"?: string,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"created_at": string,"cycle": Database["public"]['Enums']["billing_cycle"],"id": string,"method": Database["public"]['Enums']["payment_method"],"number": number,"plan_id": string,"public_id": string | null,"reason": Database["public"]['Enums']["reject_reason"] | null,"refunded_at": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["payment_status"],"submitted_at": string,"subscription_id": string | null,"trx_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"cycle": Database["public"]['Enums']["billing_cycle"],"id"?: string,"method": Database["public"]['Enums']["payment_method"],"number"?: never,"plan_id": string,"public_id"?: never,"reason"?: Database["public"]['Enums']["reject_reason"] | null,"refunded_at"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"submitted_at"?: string,"subscription_id"?: string | null,"trx_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"cycle"?: Database["public"]['Enums']["billing_cycle"],"id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"number"?: never,"plan_id"?: string,"public_id"?: never,"reason"?: Database["public"]['Enums']["reject_reason"] | null,"refunded_at"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"submitted_at"?: string,"subscription_id"?: string | null,"trx_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "subscriptions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "active": boolean,"created_at": string,"description": string,"description_bn": string,"features": NonNullable<Json>,"icon": string,"id": string,"is_default": boolean,"name": string,"name_bn": string,"price_monthly": number,"price_yearly": number | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"description"?: string,"description_bn"?: string,"features"?: NonNullable<Json>,"icon"?: string,"id": string,"is_default"?: boolean,"name": string,"name_bn": string,"price_monthly"?: number,"price_yearly"?: number | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"description"?: string,"description_bn"?: string,"features"?: NonNullable<Json>,"icon"?: string,"id"?: string,"is_default"?: boolean,"name"?: string,"name_bn"?: string,"price_monthly"?: number,"price_yearly"?: number | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "active": boolean,"created_at": string,"cycle": Database["public"]['Enums']["billing_cycle"] | null,"email": string,"id": string,"joined_at": string,"lang": Database["public"]['Enums']["lang"],"last_active_at": string,"location": string,"name": string,"name_bn": string | null,"notifications": NonNullable<Json>,"organization": string,"phone": string,"photo_url": string | null,"plan_id": string,"preferences": NonNullable<Json>,"profession": string,"public_id": string | null,"reader_no": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"cycle"?: Database["public"]['Enums']["billing_cycle"] | null,"email": string,"id": string,"joined_at"?: string,"lang"?: Database["public"]['Enums']["lang"],"last_active_at"?: string,"location"?: string,"name": string,"name_bn"?: string | null,"notifications"?: NonNullable<Json>,"organization"?: string,"phone"?: string,"photo_url"?: string | null,"plan_id"?: string,"preferences"?: NonNullable<Json>,"profession"?: string,"public_id"?: never,"reader_no"?: never,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"cycle"?: Database["public"]['Enums']["billing_cycle"] | null,"email"?: string,"id"?: string,"joined_at"?: string,"lang"?: Database["public"]['Enums']["lang"],"last_active_at"?: string,"location"?: string,"name"?: string,"name_bn"?: string | null,"notifications"?: NonNullable<Json>,"organization"?: string,"phone"?: string,"photo_url"?: string | null,"plan_id"?: string,"preferences"?: NonNullable<Json>,"profession"?: string,"public_id"?: never,"reader_no"?: never,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"site_pages": {
                  Row: {
                    "fixed": boolean,"path": string,"sections": NonNullable<Json>,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "fixed"?: boolean,"path": string,"sections"?: NonNullable<Json>,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "fixed"?: boolean,"path"?: string,"sections"?: NonNullable<Json>,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"site_settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "amount": number,"auto_renew": boolean,"canceled_at": string | null,"created_at": string,"cycle": Database["public"]['Enums']["billing_cycle"],"id": string,"number": number,"plan_id": string,"public_id": string | null,"renews_at": string | null,"started_at": string,"status": Database["public"]['Enums']["subscription_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"auto_renew"?: boolean,"canceled_at"?: string | null,"created_at"?: string,"cycle": Database["public"]['Enums']["billing_cycle"],"id"?: string,"number"?: never,"plan_id": string,"public_id"?: never,"renews_at"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"auto_renew"?: boolean,"canceled_at"?: string | null,"created_at"?: string,"cycle"?: Database["public"]['Enums']["billing_cycle"],"id"?: string,"number"?: never,"plan_id"?: string,"public_id"?: never,"renews_at"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "accepted_at": string | null,"active": boolean,"created_at": string,"email": string,"id": string,"invited_at": string | null,"invited_by": string | null,"member_no": number,"must_change_password": boolean,"name": string,"name_bn": string | null,"permissions": (string)[],"phone": string,"photo_url": string | null,"public_id": string | null,"role": Database["public"]['Enums']["team_role"],"signature": string,"signature_bn": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"active"?: boolean,"created_at"?: string,"email": string,"id": string,"invited_at"?: string | null,"invited_by"?: string | null,"member_no"?: never,"must_change_password"?: boolean,"name": string,"name_bn"?: string | null,"permissions"?: (string)[],"phone"?: string,"photo_url"?: string | null,"public_id"?: never,"role"?: Database["public"]['Enums']["team_role"],"signature"?: string,"signature_bn"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"active"?: boolean,"created_at"?: string,"email"?: string,"id"?: string,"invited_at"?: string | null,"invited_by"?: string | null,"member_no"?: never,"must_change_password"?: boolean,"name"?: string,"name_bn"?: string | null,"permissions"?: (string)[],"phone"?: string,"photo_url"?: string | null,"public_id"?: never,"role"?: Database["public"]['Enums']["team_role"],"signature"?: string,"signature_bn"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_events": {
                  Row: {
                    "actor_id": string | null,"actor_kind": Database["public"]['Enums']["actor_kind"],"created_at": string,"from_value": string | null,"id": string,"kind": Database["public"]['Enums']["ticket_event_kind"],"ticket_id": string,"to_value": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": Database["public"]['Enums']["actor_kind"],"created_at"?: string,"from_value"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["ticket_event_kind"],"ticket_id": string,"to_value"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"created_at"?: string,"from_value"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["ticket_event_kind"],"ticket_id"?: string,"to_value"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_events_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_files": {
                  Row: {
                    "created_at": string,"id": string,"message_id": string,"mime": string,"name": string,"size": number,"storage_path": string,"ticket_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"message_id": string,"mime": string,"name": string,"size": number,"storage_path": string,"ticket_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"message_id"?: string,"mime"?: string,"name"?: string,"size"?: number,"storage_path"?: string,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_files_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "ticket_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_files_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_messages": {
                  Row: {
                    "author_id": string | null,"author_kind": Database["public"]['Enums']["actor_kind"],"body": string,"created_at": string,"id": string,"kind": Database["public"]['Enums']["message_kind"],"ticket_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"author_kind": Database["public"]['Enums']["actor_kind"],"body": string,"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["message_kind"],"ticket_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"author_kind"?: Database["public"]['Enums']["actor_kind"],"body"?: string,"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["message_kind"],"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_messages_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"tickets": {
                  Row: {
                    "assignee_id": string | null,"category": Database["public"]['Enums']["ticket_category"],"created_at": string,"id": string,"lang": Database["public"]['Enums']["lang"],"last_message_at": string,"number": number,"priority": Database["public"]['Enums']["ticket_priority"],"public_id": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["ticket_status"],"subject": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"category"?: Database["public"]['Enums']["ticket_category"],"created_at"?: string,"id"?: string,"lang"?: Database["public"]['Enums']["lang"],"last_message_at"?: string,"number"?: never,"priority"?: Database["public"]['Enums']["ticket_priority"],"public_id"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"subject": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "assignee_id"?: string | null,"category"?: Database["public"]['Enums']["ticket_category"],"created_at"?: string,"id"?: string,"lang"?: Database["public"]['Enums']["lang"],"last_message_at"?: string,"number"?: never,"priority"?: Database["public"]['Enums']["ticket_priority"],"public_id"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"subject"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"wallet_accounts": {
                  Row: {
                    "enabled": boolean,"method": Database["public"]['Enums']["payment_method"],"name": string,"number": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"method": Database["public"]['Enums']["payment_method"],"name"?: string,"number": string,"type"?: string,"updated_at"?: string
                  }
                  Update: {
                    "enabled"?: boolean,"method"?: Database["public"]['Enums']["payment_method"],"name"?: string,"number"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_owner":
{ Args: { "owner": string }; Returns: boolean
                           },
"join_words":
{ Args: { "words": (string)[] }; Returns: string
                           }
          }
          Enums: {
            "actor_kind": "reader"|"team"|"system","announcement_channel": "in_app"|"email"|"banner","announcement_status": "draft"|"scheduled"|"sent","billing_cycle": "monthly"|"yearly","content_status": "draft"|"published","lang": "en"|"bn","message_kind": "reader"|"reply"|"note","notification_topic": "legal"|"cases"|"saved"|"ai"|"billing"|"product","otp_purpose": "signup"|"reset","payment_method": "bkash"|"nagad","payment_status": "verified"|"awaiting"|"rejected"|"refunded","reject_reason": "not_found"|"amount"|"duplicate","subscription_status": "active"|"past_due"|"canceled","team_role": "admin"|"editor"|"support","ticket_category": "account"|"billing"|"content"|"ai"|"technical"|"other","ticket_event_kind": "created"|"assigned"|"unassigned"|"status"|"priority"|"category"|"reply"|"note","ticket_priority": "low"|"medium"|"high"|"urgent","ticket_status": "open"|"progress"|"waiting"|"resolved"|"closed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "actor_kind": ["reader", "team", "system"],"announcement_channel": ["in_app", "email", "banner"],"announcement_status": ["draft", "scheduled", "sent"],"billing_cycle": ["monthly", "yearly"],"content_status": ["draft", "published"],"lang": ["en", "bn"],"message_kind": ["reader", "reply", "note"],"notification_topic": ["legal", "cases", "saved", "ai", "billing", "product"],"otp_purpose": ["signup", "reset"],"payment_method": ["bkash", "nagad"],"payment_status": ["verified", "awaiting", "rejected", "refunded"],"reject_reason": ["not_found", "amount", "duplicate"],"subscription_status": ["active", "past_due", "canceled"],"team_role": ["admin", "editor", "support"],"ticket_category": ["account", "billing", "content", "ai", "technical", "other"],"ticket_event_kind": ["created", "assigned", "unassigned", "status", "priority", "category", "reply", "note"],"ticket_priority": ["low", "medium", "high", "urgent"],"ticket_status": ["open", "progress", "waiting", "resolved", "closed"]
          }
        }
} as const
