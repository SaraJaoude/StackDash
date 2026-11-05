
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "access_invites": {
                  Row: {
                    "email": string,"invited_at": string,"invited_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"invited_at"?: string,"invited_by": string
                  }
                  Update: {
                    "email"?: string,"invited_at"?: string,"invited_by"?: string
                  }
                  Relationships: [
                    
                  ]
                },"activity_events": {
                  Row: {
                    "body": string | null,"connection_id": string | null,"created_at": string,"dedupe_key": string,"external_account_id": string | null,"id": string,"occurred_at": string,"provider": Database["public"]['Enums']["provider_id"] | null,"severity": Database["public"]['Enums']["event_severity"],"title": string,"type_id": string,"url": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"connection_id"?: string | null,"created_at"?: string,"dedupe_key": string,"external_account_id"?: string | null,"id"?: string,"occurred_at": string,"provider"?: Database["public"]['Enums']["provider_id"] | null,"severity": Database["public"]['Enums']["event_severity"],"title": string,"type_id": string,"url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "body"?: string | null,"connection_id"?: string | null,"created_at"?: string,"dedupe_key"?: string,"external_account_id"?: string | null,"id"?: string,"occurred_at"?: string,"provider"?: Database["public"]['Enums']["provider_id"] | null,"severity"?: Database["public"]['Enums']["event_severity"],"title"?: string,"type_id"?: string,"url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_events_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "activity_events_external_account_fkey"
      columns: ["workspace_id","external_account_id"]
isOneToOne: false
      referencedRelation: "external_accounts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "activity_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"alert_rule_destinations": {
                  Row: {
                    "destination_id": string,"rule_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "destination_id": string,"rule_id": string,"workspace_id": string
                  }
                  Update: {
                    "destination_id"?: string,"rule_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_rule_destinations_destination_fkey"
      columns: ["workspace_id","destination_id"]
isOneToOne: false
      referencedRelation: "notification_destinations"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "alert_rule_destinations_rule_fkey"
      columns: ["workspace_id","rule_id"]
isOneToOne: false
      referencedRelation: "alert_rules"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"alert_rules": {
                  Row: {
                    "budget_id": string | null,"connection_id": string | null,"created_at": string,"created_by": string | null,"currency": string | null,"id": string,"kind": Database["public"]['Enums']["alert_rule_kind"],"metric_key": string | null,"paused": boolean,"project_id": string | null,"provider": Database["public"]['Enums']["provider_id"] | null,"scope": Database["public"]['Enums']["alert_scope"],"threshold_amount_minor": number | null,"threshold_percent": number | null,"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_id"?: string | null,"connection_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["alert_rule_kind"],"metric_key"?: string | null,"paused"?: boolean,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"scope": Database["public"]['Enums']["alert_scope"],"threshold_amount_minor"?: number | null,"threshold_percent"?: number | null,"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "budget_id"?: string | null,"connection_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["alert_rule_kind"],"metric_key"?: string | null,"paused"?: boolean,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"scope"?: Database["public"]['Enums']["alert_scope"],"threshold_amount_minor"?: number | null,"threshold_percent"?: number | null,"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_rules_budget_fkey"
      columns: ["workspace_id","budget_id"]
isOneToOne: false
      referencedRelation: "budgets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "alert_rules_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "alert_rules_project_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "alert_rules_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"budgets": {
                  Row: {
                    "amount_minor": number,"connection_id": string | null,"created_at": string,"created_by": string | null,"currency": string,"id": string,"name": string,"period": string,"project_id": string | null,"provider": Database["public"]['Enums']["provider_id"] | null,"scope": Database["public"]['Enums']["alert_scope"],"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"connection_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": string,"id"?: string,"name": string,"period"?: string,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"scope": Database["public"]['Enums']["alert_scope"],"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "amount_minor"?: number,"connection_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"name"?: string,"period"?: string,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"scope"?: Database["public"]['Enums']["alert_scope"],"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budgets_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "budgets_project_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "budgets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"connection_credentials": {
                  Row: {
                    "auth_tag": string,"ciphertext": string,"connection_id": string,"iv": string,"key_id": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_tag": string,"ciphertext": string,"connection_id": string,"iv": string,"key_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "auth_tag"?: string,"ciphertext"?: string,"connection_id"?: string,"iv"?: string,"key_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connection_credentials_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "connection_credentials_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"connections": {
                  Row: {
                    "authorized_account_label": string | null,"consecutive_failures": number,"created_at": string,"created_by": string | null,"display_name": string,"external_installation_id": string | null,"granted_scopes": (string)[],"id": string,"last_error_code": string | null,"last_error_reference": string | null,"last_sync_requested_at": string | null,"last_synced_at": string | null,"missing_scopes": (string)[],"next_sync_at": string | null,"poll_interval_seconds": number,"provider": Database["public"]['Enums']["provider_id"],"status": Database["public"]['Enums']["connection_status"],"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "authorized_account_label"?: string | null,"consecutive_failures"?: number,"created_at"?: string,"created_by"?: string | null,"display_name": string,"external_installation_id"?: string | null,"granted_scopes"?: (string)[],"id"?: string,"last_error_code"?: string | null,"last_error_reference"?: string | null,"last_sync_requested_at"?: string | null,"last_synced_at"?: string | null,"missing_scopes"?: (string)[],"next_sync_at"?: string | null,"poll_interval_seconds": number,"provider": Database["public"]['Enums']["provider_id"],"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "authorized_account_label"?: string | null,"consecutive_failures"?: number,"created_at"?: string,"created_by"?: string | null,"display_name"?: string,"external_installation_id"?: string | null,"granted_scopes"?: (string)[],"id"?: string,"last_error_code"?: string | null,"last_error_reference"?: string | null,"last_sync_requested_at"?: string | null,"last_synced_at"?: string | null,"missing_scopes"?: (string)[],"next_sync_at"?: string | null,"poll_interval_seconds"?: number,"provider"?: Database["public"]['Enums']["provider_id"],"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connections_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"external_accounts": {
                  Row: {
                    "connection_id": string,"created_at": string,"display_name": string,"external_id": string,"id": string,"included": boolean,"kind": string,"project_id": string | null,"sync_cursor": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"created_at"?: string,"display_name": string,"external_id": string,"id"?: string,"included"?: boolean,"kind": string,"project_id"?: string | null,"sync_cursor"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "connection_id"?: string,"created_at"?: string,"display_name"?: string,"external_id"?: string,"id"?: string,"included"?: boolean,"kind"?: string,"project_id"?: string | null,"sync_cursor"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "external_accounts_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "external_accounts_project_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "external_accounts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_deliveries": {
                  Row: {
                    "delivered_at": string,"destination_id": string | null,"id": string,"subject_key": string,"target_key": string,"triggered_alert_id": string | null,"user_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "delivered_at"?: string,"destination_id"?: string | null,"id"?: string,"subject_key": string,"target_key": string,"triggered_alert_id"?: string | null,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "delivered_at"?: string,"destination_id"?: string | null,"id"?: string,"subject_key"?: string,"target_key"?: string,"triggered_alert_id"?: string | null,"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_deliveries_destination_fkey"
      columns: ["workspace_id","destination_id"]
isOneToOne: false
      referencedRelation: "notification_destinations"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "notification_deliveries_triggered_alert_id_fkey"
      columns: ["triggered_alert_id"]
isOneToOne: false
      referencedRelation: "triggered_alerts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_deliveries_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_destination_secrets": {
                  Row: {
                    "auth_tag": string,"ciphertext": string,"destination_id": string,"iv": string,"key_id": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_tag": string,"ciphertext": string,"destination_id": string,"iv": string,"key_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "auth_tag"?: string,"ciphertext"?: string,"destination_id"?: string,"iv"?: string,"key_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_destination_secrets_destination_fkey"
      columns: ["workspace_id","destination_id"]
isOneToOne: false
      referencedRelation: "notification_destinations"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "notification_destination_secrets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_destinations": {
                  Row: {
                    "all_rules": boolean,"consecutive_failures": number,"created_at": string,"created_by": string | null,"digest": Database["public"]['Enums']["digest_frequency"],"id": string,"kind": Database["public"]['Enums']["destination_kind"],"last_delivered_at": string | null,"last_error_code": string | null,"last_error_reference": string | null,"name": string,"status": Database["public"]['Enums']["destination_status"],"updated_at": string,"updated_by": string | null,"url_host": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "all_rules"?: boolean,"consecutive_failures"?: number,"created_at"?: string,"created_by"?: string | null,"digest"?: Database["public"]['Enums']["digest_frequency"],"id"?: string,"kind": Database["public"]['Enums']["destination_kind"],"last_delivered_at"?: string | null,"last_error_code"?: string | null,"last_error_reference"?: string | null,"name": string,"status"?: Database["public"]['Enums']["destination_status"],"updated_at"?: string,"updated_by"?: string | null,"url_host": string,"workspace_id": string
                  }
                  Update: {
                    "all_rules"?: boolean,"consecutive_failures"?: number,"created_at"?: string,"created_by"?: string | null,"digest"?: Database["public"]['Enums']["digest_frequency"],"id"?: string,"kind"?: Database["public"]['Enums']["destination_kind"],"last_delivered_at"?: string | null,"last_error_code"?: string | null,"last_error_reference"?: string | null,"name"?: string,"status"?: Database["public"]['Enums']["destination_status"],"updated_at"?: string,"updated_by"?: string | null,"url_host"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_destinations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "email_frequency": Database["public"]['Enums']["email_frequency"],"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email_frequency": Database["public"]['Enums']["email_frequency"],"updated_at"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "email_frequency"?: Database["public"]['Enums']["email_frequency"],"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_member_fkey"
      columns: ["workspace_id","user_id"]
isOneToOne: true
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"oauth_states": {
                  Row: {
                    "code_verifier_ciphertext": string | null,"code_verifier_iv": string | null,"code_verifier_tag": string | null,"created_at": string,"expires_at": string,"key_id": string | null,"pending_installation_id": string | null,"provider": Database["public"]['Enums']["provider_id"],"reconnect_connection_id": string | null,"state": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code_verifier_ciphertext"?: string | null,"code_verifier_iv"?: string | null,"code_verifier_tag"?: string | null,"created_at"?: string,"expires_at": string,"key_id"?: string | null,"pending_installation_id"?: string | null,"provider": Database["public"]['Enums']["provider_id"],"reconnect_connection_id"?: string | null,"state": string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "code_verifier_ciphertext"?: string | null,"code_verifier_iv"?: string | null,"code_verifier_tag"?: string | null,"created_at"?: string,"expires_at"?: string,"key_id"?: string | null,"pending_installation_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"],"reconnect_connection_id"?: string | null,"state"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "oauth_states_reconnect_connection_fkey"
      columns: ["workspace_id","reconnect_connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "oauth_states_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"last_workspace_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_last_workspace_id_fkey"
      columns: ["last_workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"published_metrics": {
                  Row: {
                    "delay_days": number,"id": string,"metric_id": Database["public"]['Enums']["public_metric_id"] | null,"project_id": string,"published_at": string,"published_by": string,"revoked_at": string | null,"revoked_by": string | null,"rounding": Database["public"]['Enums']["published_metric_rounding"],"self_reported_label": string | null,"self_reported_unit": string | null,"self_reported_value": number | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "delay_days"?: number,"id"?: string,"metric_id"?: Database["public"]['Enums']["public_metric_id"] | null,"project_id": string,"published_at"?: string,"published_by": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"rounding"?: Database["public"]['Enums']["published_metric_rounding"],"self_reported_label"?: string | null,"self_reported_unit"?: string | null,"self_reported_value"?: number | null,"workspace_id": string
                  }
                  Update: {
                    "delay_days"?: number,"id"?: string,"metric_id"?: Database["public"]['Enums']["public_metric_id"] | null,"project_id"?: string,"published_at"?: string,"published_by"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"rounding"?: Database["public"]['Enums']["published_metric_rounding"],"self_reported_label"?: string | null,"self_reported_unit"?: string | null,"self_reported_value"?: number | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "published_metrics_project_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "published_metrics_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_jobs": {
                  Row: {
                    "attempts": number,"connection_id": string | null,"created_at": string,"dedupe_key": string | null,"error_code": string | null,"error_reference": string | null,"finished_at": string | null,"id": string,"kind": Database["public"]['Enums']["sync_job_kind"],"locked_until": string | null,"max_attempts": number,"run_after": string,"started_at": string | null,"status": Database["public"]['Enums']["sync_job_status"],"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"connection_id"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"error_code"?: string | null,"error_reference"?: string | null,"finished_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["sync_job_kind"],"locked_until"?: string | null,"max_attempts"?: number,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["sync_job_status"],"workspace_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"connection_id"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"error_code"?: string | null,"error_reference"?: string | null,"finished_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["sync_job_kind"],"locked_until"?: string | null,"max_attempts"?: number,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["sync_job_status"],"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_jobs_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "sync_jobs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"triggered_alerts": {
                  Row: {
                    "acknowledged_at": string | null,"acknowledged_by": string | null,"currency": string | null,"cycle_key": string,"dispatched_at": string | null,"id": string,"is_estimated": boolean,"message": string,"observed_amount_minor": number | null,"observed_value": number | null,"project_id": string | null,"provider": Database["public"]['Enums']["provider_id"] | null,"resets_at": string | null,"rule_id": string,"threshold_label": string,"title": string | null,"triggered_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"currency"?: string | null,"cycle_key": string,"dispatched_at"?: string | null,"id"?: string,"is_estimated": boolean,"message": string,"observed_amount_minor"?: number | null,"observed_value"?: number | null,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"resets_at"?: string | null,"rule_id": string,"threshold_label": string,"title"?: string | null,"triggered_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"currency"?: string | null,"cycle_key"?: string,"dispatched_at"?: string | null,"id"?: string,"is_estimated"?: boolean,"message"?: string,"observed_amount_minor"?: number | null,"observed_value"?: number | null,"project_id"?: string | null,"provider"?: Database["public"]['Enums']["provider_id"] | null,"resets_at"?: string | null,"rule_id"?: string,"threshold_label"?: string,"title"?: string | null,"triggered_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "triggered_alerts_project_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "triggered_alerts_rule_fkey"
      columns: ["workspace_id","rule_id"]
isOneToOne: false
      referencedRelation: "alert_rules"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "triggered_alerts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_snapshots": {
                  Row: {
                    "amount_minor": number | null,"connection_id": string,"created_at": string,"currency": string | null,"external_account_id": string,"id": string,"kind": Database["public"]['Enums']["metric_kind"],"label": string,"metric_key": string,"period_end": string | null,"period_start": string | null,"point_at": string | null,"pricing_source": string | null,"provenance_endpoint": string | null,"provenance_source": string,"resets_at": string | null,"retrieved_at": string,"snapshot_date": string,"unit": string | null,"updated_at": string,"value": number | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor"?: number | null,"connection_id": string,"created_at"?: string,"currency"?: string | null,"external_account_id": string,"id"?: string,"kind": Database["public"]['Enums']["metric_kind"],"label": string,"metric_key": string,"period_end"?: string | null,"period_start"?: string | null,"point_at"?: string | null,"pricing_source"?: string | null,"provenance_endpoint"?: string | null,"provenance_source": string,"resets_at"?: string | null,"retrieved_at": string,"snapshot_date": string,"unit"?: string | null,"updated_at"?: string,"value"?: number | null,"workspace_id": string
                  }
                  Update: {
                    "amount_minor"?: number | null,"connection_id"?: string,"created_at"?: string,"currency"?: string | null,"external_account_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["metric_kind"],"label"?: string,"metric_key"?: string,"period_end"?: string | null,"period_start"?: string | null,"point_at"?: string | null,"pricing_source"?: string | null,"provenance_endpoint"?: string | null,"provenance_source"?: string,"resets_at"?: string | null,"retrieved_at"?: string,"snapshot_date"?: string,"unit"?: string | null,"updated_at"?: string,"value"?: number | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_snapshots_connection_fkey"
      columns: ["workspace_id","connection_id"]
isOneToOne: false
      referencedRelation: "connections"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "usage_snapshots_external_account_fkey"
      columns: ["workspace_id","external_account_id"]
isOneToOne: false
      referencedRelation: "external_accounts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "usage_snapshots_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_personal": boolean,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_personal"?: boolean,"name": string,"slug"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_personal"?: boolean,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "claim_sync_jobs":
{ Args: { "p_lease_seconds": number,"p_limit": number }; Returns: {
              "attempts": number,
"connection_id": string | null,
"created_at": string,
"dedupe_key": string | null,
"error_code": string | null,
"error_reference": string | null,
"finished_at": string | null,
"id": string,
"kind": Database["public"]['Enums']["sync_job_kind"],
"locked_until": string | null,
"max_attempts": number,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["sync_job_status"],
"workspace_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "sync_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"create_notification_destination":
{ Args: { "p_all_rules": boolean,"p_auth_tag": string,"p_ciphertext": string,"p_created_by": string,"p_digest": Database["public"]['Enums']["digest_frequency"],"p_id": string,"p_iv": string,"p_key_id": string,"p_kind": Database["public"]['Enums']["destination_kind"],"p_name": string,"p_rule_ids": (string)[],"p_url_host": string,"p_workspace_id": string }; Returns: undefined
                           },
"create_workspace":
{ Args: { "p_is_personal": boolean,"p_name": string,"p_user_id": string }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"is_personal": boolean,
"name": string,
"slug": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "workspaces"
        isOneToOne: true
        isSetofReturn: false
      } },
"enqueue_alert_dispatches":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_daily_summaries":
{ Args: { "p_date": string }; Returns: number
                           },
"enqueue_digests":
{ Args: { "p_date": string }; Returns: number
                           },
"enqueue_due_syncs":
{ Args: { "p_limit": number }; Returns: number
                           },
"enqueue_sync_job":
{ Args: { "p_connection_id": string,"p_workspace_id": string }; Returns: boolean
                           },
"generate_workspace_slug":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"has_workspace_role":
{ Args: { "p_min_role": Database["public"]['Enums']["workspace_role"],"p_workspace_id": string }; Returns: boolean
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"latest_usage_resets":
{ Args: { "p_external_account_id": string,"p_workspace_id": string }; Returns: {
              "metric_key": string,"resets_at": string
            }[]
                           },
"notification_recipients":
{ Args: { "p_workspace_id": string }; Returns: {
              "email": string,"email_frequency": Database["public"]['Enums']["email_frequency"],"user_id": string
            }[]
                           },
"public_published_metrics":
{ Args: { "p_project_id": string }; Returns: {
              "delay_days": number,"id": string,"metric_id": Database["public"]['Enums']["public_metric_id"],"project_id": string,"published_at": string,"rounding": Database["public"]['Enums']["published_metric_rounding"],"self_reported_label": string,"self_reported_unit": string,"self_reported_value": number,"workspace_id": string
            }[]
                           },
"publish_metric":
{ Args: { "p_actor_id": string,"p_body": string,"p_delay_days": number,"p_metric_id": Database["public"]['Enums']["public_metric_id"],"p_project_id": string,"p_rounding": Database["public"]['Enums']["published_metric_rounding"],"p_title": string,"p_workspace_id": string }; Returns: string
                           },
"publish_self_reported_metric":
{ Args: { "p_actor_id": string,"p_body": string,"p_label": string,"p_project_id": string,"p_title": string,"p_unit": string,"p_value": number,"p_workspace_id": string }; Returns: string
                           },
"purge_activity_events":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"purge_notification_deliveries":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"purge_oauth_states":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"purge_sync_jobs":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"purge_usage_snapshots":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"record_publication_event":
{ Args: { "p_body": string,"p_dedupe_key": string,"p_title": string,"p_type_id": string,"p_workspace_id": string }; Returns: undefined
                           },
"request_manual_sync":
{ Args: { "p_connection_id": string,"p_cooldown_seconds": number,"p_workspace_id": string }; Returns: string
                           },
"require_published_metrics_admin":
{ Args: { "p_actor_id": string,"p_workspace_id": string }; Returns: undefined
                           },
"unpublish_all_metrics":
{ Args: { "p_actor_id": string,"p_workspace_id": string }; Returns: number
                           },
"unpublish_metric":
{ Args: { "p_actor_id": string,"p_published_metric_id": string,"p_title": string,"p_workspace_id": string }; Returns: string
                           },
"workspace_role_rank":
{ Args: { "p_role": Database["public"]['Enums']["workspace_role"] }; Returns: number
                           }
          }
          Enums: {
            "alert_rule_kind": "allowance_percent"|"spend_amount"|"budget_percent","alert_scope": "workspace"|"provider"|"project"|"connection","connection_status": "pending"|"active"|"needs_attention"|"revoked"|"failed","destination_kind": "discord"|"slack"|"webhook","destination_status": "active"|"needs_attention","digest_frequency": "off"|"daily"|"weekly","email_frequency": "immediate"|"daily"|"weekly"|"off","event_severity": "info"|"success"|"warning"|"critical","metric_kind": "verified_spend"|"estimated_spend"|"included_allowance"|"remaining_allowance"|"usage"|"credit_balance"|"revenue"|"recurring_revenue","provider_id": "vercel"|"github"|"resend"|"stripe"|"supabase"|"fake"|"digitalocean"|"posthog"|"polar"|"sentry"|"railway","public_metric_id": "github-stars"|"github-stars-gained-7d"|"github-stars-gained-30d"|"vercel-deployments-7d"|"vercel-deployments-30d"|"vercel-deployment-streak"|"supabase-signups-7d"|"supabase-signups-30d"|"resend-emails-month"|"resend-quota-percent-month"|"github-actions-minutes-month"|"stripe-customers-30d"|"stripe-payments-30d","published_metric_rounding": "exact"|"tens"|"hundreds"|"thousands","sync_job_kind": "sync"|"daily_summary"|"retention"|"alert_dispatch"|"digest","sync_job_status": "queued"|"running"|"succeeded"|"failed","workspace_role": "owner"|"admin"|"viewer"
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
            "alert_rule_kind": ["allowance_percent", "spend_amount", "budget_percent"],"alert_scope": ["workspace", "provider", "project", "connection"],"connection_status": ["pending", "active", "needs_attention", "revoked", "failed"],"destination_kind": ["discord", "slack", "webhook"],"destination_status": ["active", "needs_attention"],"digest_frequency": ["off", "daily", "weekly"],"email_frequency": ["immediate", "daily", "weekly", "off"],"event_severity": ["info", "success", "warning", "critical"],"metric_kind": ["verified_spend", "estimated_spend", "included_allowance", "remaining_allowance", "usage", "credit_balance", "revenue", "recurring_revenue"],"provider_id": ["vercel", "github", "resend", "stripe", "supabase", "fake", "digitalocean", "posthog", "polar", "sentry", "railway"],"public_metric_id": ["github-stars", "github-stars-gained-7d", "github-stars-gained-30d", "vercel-deployments-7d", "vercel-deployments-30d", "vercel-deployment-streak", "supabase-signups-7d", "supabase-signups-30d", "resend-emails-month", "resend-quota-percent-month", "github-actions-minutes-month", "stripe-customers-30d", "stripe-payments-30d"],"published_metric_rounding": ["exact", "tens", "hundreds", "thousands"],"sync_job_kind": ["sync", "daily_summary", "retention", "alert_dispatch", "digest"],"sync_job_status": ["queued", "running", "succeeded", "failed"],"workspace_role": ["owner", "admin", "viewer"]
          }
        }
} as const
