// Hand-authored to match supabase/migrations/0001_foundation.sql.
// Once a live Supabase project is provisioned, regenerate with:
//   supabase gen types typescript --project-id <id> --schema core,audit > types/database.types.ts
// and reconcile any drift against the migrations, which remain the source of truth.

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "print"
  | "export"
  | "approve"
  | "reject"
  | "post";

export interface Database {
  core: {
    Tables: {
      companies: {
        Row: {
          id: string;
          code: string;
          name: string;
          country: string | null;
          address: string | null;
          logo_path: string | null;
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["companies"]["Row"]> & {
          code: string;
          name: string;
          created_by: string;
        };
        Update: Partial<Database["core"]["Tables"]["companies"]["Row"]>;
      };
      user_profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          avatar_path: string | null;
          is_active: boolean;
          default_company_id: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["user_profiles"]["Row"]> & {
          id: string;
          full_name: string;
          email: string;
        };
        Update: Partial<Database["core"]["Tables"]["user_profiles"]["Row"]>;
      };
      user_companies: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          is_default: boolean;
          created_at: string;
        };
        Insert: Partial<Database["core"]["Tables"]["user_companies"]["Row"]> & {
          user_id: string;
          company_id: string;
        };
        Update: Partial<Database["core"]["Tables"]["user_companies"]["Row"]>;
      };
      roles: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          description: string | null;
          is_system_role: boolean;
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["roles"]["Row"]> & {
          company_id: string;
          name: string;
          created_by: string;
        };
        Update: Partial<Database["core"]["Tables"]["roles"]["Row"]>;
      };
      permissions: {
        Row: {
          id: string;
          module_key: string;
          action: PermissionAction;
          label: string;
        };
        Insert: Database["core"]["Tables"]["permissions"]["Row"];
        Update: Partial<Database["core"]["Tables"]["permissions"]["Row"]>;
      };
      role_permissions: {
        Row: {
          id: string;
          role_id: string;
          permission_id: string;
          allowed: boolean;
        };
        Insert: Partial<Database["core"]["Tables"]["role_permissions"]["Row"]> & {
          role_id: string;
          permission_id: string;
        };
        Update: Partial<Database["core"]["Tables"]["role_permissions"]["Row"]>;
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          company_id: string;
          created_at: string;
        };
        Insert: Partial<Database["core"]["Tables"]["user_roles"]["Row"]> & {
          user_id: string;
          role_id: string;
          company_id: string;
        };
        Update: Partial<Database["core"]["Tables"]["user_roles"]["Row"]>;
      };
      document_sequences: {
        Row: {
          id: string;
          company_id: string;
          voucher_type: string;
          prefix: string;
          padding: number;
          next_number: number;
          reset_policy: "never" | "yearly" | "monthly";
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["document_sequences"]["Row"]> & {
          company_id: string;
          voucher_type: string;
          prefix: string;
        };
        Update: Partial<Database["core"]["Tables"]["document_sequences"]["Row"]>;
      };
      attachments: {
        Row: {
          id: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          bucket: string;
          path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string;
          uploaded_at: string;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["attachments"]["Row"]> & {
          company_id: string;
          entity_type: string;
          entity_id: string;
          bucket: string;
          path: string;
          file_name: string;
          uploaded_by: string;
        };
        Update: Partial<Database["core"]["Tables"]["attachments"]["Row"]>;
      };
      system_settings: {
        Row: {
          id: string;
          company_id: string;
          key: string;
          value: Record<string, unknown>;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["core"]["Tables"]["system_settings"]["Row"]> & {
          company_id: string;
          key: string;
        };
        Update: Partial<Database["core"]["Tables"]["system_settings"]["Row"]>;
      };
      currencies: {
        Row: {
          id: string;
          code: string;
          name: string;
          symbol: string;
          decimal_places: number;
          is_active: boolean;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["currencies"]["Row"]> & {
          code: string;
          name: string;
          symbol: string;
        };
        Update: Partial<Database["core"]["Tables"]["currencies"]["Row"]>;
      };
      company_currencies: {
        Row: {
          id: string;
          company_id: string;
          currency_id: string;
          is_base_currency: boolean;
          is_active: boolean;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["company_currencies"]["Row"]> & {
          company_id: string;
          currency_id: string;
        };
        Update: Partial<Database["core"]["Tables"]["company_currencies"]["Row"]>;
      };
      exchange_rates: {
        Row: {
          id: string;
          company_id: string;
          currency_id: string;
          rate_date: string;
          rate_to_base: number;
          source: "manual" | "api";
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["exchange_rates"]["Row"]> & {
          company_id: string;
          currency_id: string;
          rate_date: string;
          rate_to_base: number;
          created_by: string;
        };
        Update: Partial<Database["core"]["Tables"]["exchange_rates"]["Row"]>;
      };
    };
    Functions: {
      current_company_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      user_has_permission: {
        Args: { p_module_key: string; p_action: PermissionAction };
        Returns: boolean;
      };
      fn_bootstrap_company: {
        Args: { p_company_name: string; p_company_code: string; p_country: string };
        Returns: Database["core"]["Tables"]["companies"]["Row"];
      };
      fn_set_base_currency: {
        Args: { p_company_id: string; p_currency_id: string };
        Returns: undefined;
      };
      fn_exchange_rate_to_base: {
        Args: { p_company_id: string; p_currency_id: string; p_as_of_date?: string };
        Returns: number;
      };
      fn_convert_to_base: {
        Args: {
          p_company_id: string;
          p_currency_id: string;
          p_amount: number;
          p_as_of_date?: string;
        };
        Returns: number;
      };
      fn_upsert_exchange_rate: {
        Args: {
          p_company_id: string;
          p_currency_id: string;
          p_rate_date: string;
          p_rate_to_base: number;
        };
        Returns: Database["core"]["Tables"]["exchange_rates"]["Row"];
      };
    };
  };
  audit: {
    Tables: {
      audit_logs: {
        Row: {
          id: string;
          company_id: string | null;
          table_name: string;
          row_id: string;
          action: "INSERT" | "UPDATE" | "DELETE";
          old_data: Record<string, unknown> | null;
          new_data: Record<string, unknown> | null;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: never;
        Update: never;
      };
    };
    Functions: Record<string, never>;
  };
}
