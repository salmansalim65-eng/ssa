// Hand-authored to match supabase/migrations/0001_foundation.sql.
// Once a live Supabase project is provisioned, regenerate with:
//   supabase gen types typescript --project-id <id> --schema core,audit > types/database.types.ts
// and reconcile any drift against the migrations, which remain the source of truth.

export type AccountType = "asset" | "liability" | "income" | "expense" | "equity";

export const VOUCHER_TYPES = [
  "purchase_voucher",
  "receipt_voucher",
  "payment_voucher",
  "pdc_payment_voucher",
  "pdc_receipt_voucher",
  "cheque_return_voucher",
  "journal_voucher",
  "jv_maintenance_voucher",
  "opening_balance_voucher",
  "uae_rent_invoice",
  "pk_rent_invoice",
  "asset_sales",
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export type JournalEntryStatus = "draft" | "pending" | "approved" | "posted" | "rejected" | "sent_back";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "sent_back";
export type ApprovalAction = "submit" | "approve" | "reject" | "send_back";

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
      countries: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["countries"]["Row"]> & {
          company_id: string;
          code: string;
          name: string;
        };
        Update: Partial<Database["core"]["Tables"]["countries"]["Row"]>;
      };
      user_profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          username: string | null;
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
      user_permissions: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          module_key: string;
          action: PermissionAction;
          allowed: boolean;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["core"]["Tables"]["user_permissions"]["Row"]> & {
          user_id: string;
          company_id: string;
          module_key: string;
          action: PermissionAction;
        };
        Update: Partial<Database["core"]["Tables"]["user_permissions"]["Row"]>;
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
      fn_username_to_email: {
        Args: { p_username: string };
        Returns: string | null;
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
      fn_next_document_number: {
        Args: { p_company_id: string; p_voucher_type: VoucherType };
        Returns: string;
      };
      fn_next_master_code: {
        Args: {
          p_company_id: string;
          p_module_key: string;
          p_default_prefix: string;
          p_default_padding?: number;
        };
        Returns: string;
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
  accounting: {
    Tables: {
      chart_of_accounts: {
        Row: {
          id: string;
          company_id: string;
          account_code: string;
          account_name: string;
          parent_id: string | null;
          account_type: AccountType;
          currency_id: string | null;
          opening_balance: number;
          opening_balance_currency_id: string | null;
          is_group: boolean;
          is_active: boolean;
          is_cash: boolean;
          is_bank: boolean;
          is_tenant_group: boolean;
          linked_asset_id: string | null;
          sort_order: number;
          id_number: string | null;
          contact_person: string | null;
          phone: string | null;
          email: string | null;
          country: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["chart_of_accounts"]["Row"]> & {
          company_id: string;
          account_code: string;
          account_name: string;
          account_type: AccountType;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["chart_of_accounts"]["Row"]>;
      };
      cost_centers: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          is_group: boolean;
          parent_id: string | null;
          asset_id: string | null;
          country: string | null;
          city: string | null;
          property_type: string | null;
          building: string | null;
          plot_number: string | null;
          owner: string | null;
          rental_status: "vacant" | "occupied" | "under_maintenance" | "not_applicable";
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["cost_centers"]["Row"]> & {
          company_id: string;
          code: string;
          name: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["cost_centers"]["Row"]>;
      };
      journal_entries: {
        Row: {
          id: string;
          company_id: string;
          entry_date: string;
          voucher_type: VoucherType;
          voucher_id: string;
          currency_id: string;
          exchange_rate: number;
          narration: string | null;
          status: JournalEntryStatus;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          approved_by: string | null;
          approved_at: string | null;
          posted_by: string | null;
          posted_at: string | null;
          reversal_of: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["journal_entries"]["Row"]> & {
          company_id: string;
          entry_date: string;
          voucher_type: VoucherType;
          voucher_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["journal_entries"]["Row"]>;
      };
      journal_entry_lines: {
        Row: {
          id: string;
          journal_entry_id: string;
          line_no: number;
          account_id: string;
          cost_center_id: string | null;
          debit_amount: number;
          credit_amount: number;
          currency_id: string;
          exchange_rate: number;
          base_debit_amount: number;
          base_credit_amount: number;
          description: string | null;
          reference: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["journal_entry_lines"]["Row"]> & {
          journal_entry_id: string;
          line_no: number;
          account_id: string;
          currency_id: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["journal_entry_lines"]["Row"]>;
      };
      posting_templates: {
        Row: {
          id: string;
          company_id: string;
          voucher_type: VoucherType;
          account_role: string;
          debit_or_credit: "debit" | "credit";
          account_id: string;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["posting_templates"]["Row"]> & {
          company_id: string;
          voucher_type: VoucherType;
          account_role: string;
          debit_or_credit: "debit" | "credit";
          account_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["posting_templates"]["Row"]>;
      };
      approval_workflows: {
        Row: {
          id: string;
          company_id: string;
          voucher_type: VoucherType;
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["approval_workflows"]["Row"]> & {
          company_id: string;
          voucher_type: VoucherType;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["approval_workflows"]["Row"]>;
      };
      approval_workflow_steps: {
        Row: {
          id: string;
          workflow_id: string;
          step_order: number;
          approver_role_id: string;
          min_amount: number | null;
          max_amount: number | null;
        };
        Insert: Partial<Database["accounting"]["Tables"]["approval_workflow_steps"]["Row"]> & {
          workflow_id: string;
          step_order: number;
          approver_role_id: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["approval_workflow_steps"]["Row"]>;
      };
      voucher_approvals: {
        Row: {
          id: string;
          company_id: string;
          voucher_type: string;
          voucher_id: string;
          workflow_id: string | null;
          amount: number;
          current_step: number | null;
          status: ApprovalStatus;
          created_at: string;
          updated_at: string | null;
        };
        Insert: never;
        Update: never;
      };
      voucher_approval_actions: {
        Row: {
          id: string;
          voucher_approval_id: string;
          step_order: number | null;
          action: ApprovalAction;
          actor_id: string;
          comment: string | null;
          acted_at: string;
        };
        Insert: never;
        Update: never;
      };
      receipt_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          receipt_date: string;
          due_date: string | null;
          received_from: string | null;
          debit_account_id: string;
          credit_account_id: string | null;
          cost_center_id: string | null;
          currency_id: string;
          exchange_rate: number;
          amount: number | null;
          total_amount: number;
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["receipt_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          receipt_date: string;
          debit_account_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["receipt_vouchers"]["Row"]>;
      };
      receipt_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
          rent_month: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["receipt_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["receipt_voucher_lines"]["Row"]>;
      };
      payment_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          payment_date: string;
          due_date: string | null;
          paid_to: string | null;
          debit_account_id: string | null;
          credit_account_id: string;
          cost_center_id: string | null;
          currency_id: string;
          exchange_rate: number;
          amount: number | null;
          total_amount: number;
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["payment_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          payment_date: string;
          credit_account_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["payment_vouchers"]["Row"]>;
      };
      payment_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
          rent_month: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["payment_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["payment_voucher_lines"]["Row"]>;
      };
      pdc_payment_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          cheque_no: string;
          cheque_date: string;
          due_date: string | null;
          payee: string;
          debit_account_id: string | null;
          credit_account_id: string;
          cost_center_id: string | null;
          currency_id: string;
          exchange_rate: number;
          amount: number | null;
          total_amount: number;
          pdc_status: "pending" | "cleared" | "returned" | "cancelled";
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["pdc_payment_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          cheque_no: string;
          cheque_date: string;
          payee: string;
          credit_account_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["pdc_payment_vouchers"]["Row"]>;
      };
      pdc_payment_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
          rent_month: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["pdc_payment_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["pdc_payment_voucher_lines"]["Row"]>;
      };
      pdc_receipt_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          cheque_no: string;
          cheque_date: string;
          due_date: string | null;
          payer: string;
          debit_account_id: string;
          credit_account_id: string | null;
          cost_center_id: string | null;
          currency_id: string;
          exchange_rate: number;
          amount: number | null;
          total_amount: number;
          pdc_status: "pending" | "cleared" | "returned" | "cancelled";
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["pdc_receipt_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          cheque_no: string;
          cheque_date: string;
          payer: string;
          debit_account_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["pdc_receipt_vouchers"]["Row"]>;
      };
      pdc_receipt_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
          rent_month: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["pdc_receipt_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["pdc_receipt_voucher_lines"]["Row"]>;
      };
      cheque_return_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          original_pdc_type: "pdc_payment_voucher" | "pdc_receipt_voucher";
          original_pdc_id: string;
          return_date: string;
          return_reason: string;
          penalty_amount: number;
          penalty_account_id: string | null;
          currency_id: string;
          exchange_rate: number;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["cheque_return_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          original_pdc_type: "pdc_payment_voucher" | "pdc_receipt_voucher";
          original_pdc_id: string;
          return_date: string;
          return_reason: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["cheque_return_vouchers"]["Row"]>;
      };
      journal_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          entry_date: string;
          due_date: string | null;
          ref_no: string | null;
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["journal_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          entry_date: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["journal_vouchers"]["Row"]>;
      };
      jv_maintenance_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          original_jv_id: string | null;
          adjustment_reason: string | null;
          entry_date: string;
          due_date: string | null;
          period_from: string | null;
          period_till: string | null;
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["jv_maintenance_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          entry_date: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["jv_maintenance_vouchers"]["Row"]>;
      };
      jv_maintenance_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          cost_center_id: string | null;
          debit_account_id: string;
          credit_account_id: string;
          amount: number;
          period_from: string | null;
          period_till: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["jv_maintenance_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          debit_account_id: string;
          credit_account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["jv_maintenance_voucher_lines"]["Row"]>;
      };
      journal_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          cost_center_id: string | null;
          debit_account_id: string;
          credit_account_id: string;
          amount: number;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["journal_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          debit_account_id: string;
          credit_account_id: string;
          amount: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["journal_voucher_lines"]["Row"]>;
      };
      opening_balance_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          as_of_date: string;
          due_date: string | null;
          account_id: string | null;
          contra_account_id: string;
          cost_center_id: string | null;
          currency_id: string;
          exchange_rate: number;
          debit_amount: number | null;
          credit_amount: number | null;
          total_amount: number;
          narration: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["opening_balance_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          as_of_date: string;
          contra_account_id: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["opening_balance_vouchers"]["Row"]>;
      };
      opening_balance_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          account_id: string;
          debit: number;
          credit: number;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["opening_balance_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          account_id: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["opening_balance_voucher_lines"]["Row"]>;
      };
      purchase_vouchers: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          supplier_id: string | null;
          vendor_account_id: string | null;
          purchase_date: string;
          currency_id: string;
          exchange_rate: number;
          narration: string | null;
          payment_terms: string | null;
          share_percentage: number;
          total_value: number;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["purchase_vouchers"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          supplier_id: string;
          purchase_date: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["accounting"]["Tables"]["purchase_vouchers"]["Row"]>;
      };
      purchase_voucher_lines: {
        Row: {
          id: string;
          voucher_id: string;
          line_no: number;
          asset_id: string | null;
          cost_center_id: string | null;
          fixed_asset_account_id: string;
          gross: number;
          tax: number;
          commission: number;
          due_date: string | null;
          installment_month: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["accounting"]["Tables"]["purchase_voucher_lines"]["Row"]> & {
          voucher_id: string;
          line_no: number;
          fixed_asset_account_id: string;
          gross: number;
        };
        Update: Partial<Database["accounting"]["Tables"]["purchase_voucher_lines"]["Row"]>;
      };
    };
    Views: {
      v_voucher_register: {
        Row: {
          company_id: string;
          voucher_type: VoucherType;
          voucher_id: string;
          entry_date: string;
          voucher_no: string | null;
          currency_id: string;
          status: JournalEntryStatus;
          narration: string | null;
          created_by: string;
          created_at: string;
          posted_by: string | null;
          posted_at: string | null;
          amount: number;
        };
      };
    };
    Functions: {
      fn_delete_draft_purchase_voucher: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_get_posting_account: {
        Args: { p_company_id: string; p_voucher_type: VoucherType; p_account_role: string };
        Returns: string | null;
      };
      fn_start_approval: {
        Args: {
          p_company_id: string;
          p_voucher_type: VoucherType;
          p_voucher_id: string;
          p_amount: number;
        };
        Returns: Database["accounting"]["Tables"]["voucher_approvals"]["Row"];
      };
      fn_approval_action: {
        Args: {
          p_voucher_approval_id: string;
          p_action: "approve" | "reject" | "send_back";
          p_comment?: string;
        };
        Returns: Database["accounting"]["Tables"]["voucher_approvals"]["Row"];
      };
      fn_admin_reverse_voucher: {
        Args: { p_journal_entry_id: string };
        Returns: string;
      };
      fn_admin_delete_posted_voucher: {
        Args: { p_voucher_type: string; p_id: string };
        Returns: undefined;
      };
    };
  };
  assets: {
    Tables: {
      assets: {
        Row: {
          id: string;
          company_id: string;
          asset_code: string;
          asset_name: string;
          property_type: string;
          country: string;
          city: string | null;
          area: string | null;
          area_sqft: number | null;
          area_unit: string | null;
          address: string | null;
          purchase_date: string | null;
          purchase_value: number | null;
          current_value: number | null;
          currency_id: string | null;
          service_charges_rate: number | null;
          service_charges_amount: number | null;
          property_tax: number;
          title_deed_value: number | null;
          other_charges: number | null;
          total_property_value: number | null;
          estimated_rent: number | null;
          status: "active" | "sold" | "inactive";
          owner: string | null;
          official_owner: string | null;
          cost_center_mode: "new" | "none" | "existing";
          group_cost_center_id: string | null;
          title_deed_attachment_id: string | null;
          is_rental: boolean;
          notes: string | null;
          account_id: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["assets"]["Tables"]["assets"]["Row"]> & {
          company_id: string;
          asset_code: string;
          asset_name: string;
          property_type: string;
          country: string;
          created_by: string;
        };
        Update: Partial<Database["assets"]["Tables"]["assets"]["Row"]>;
      };
      asset_value_history: {
        Row: {
          id: string;
          company_id: string;
          asset_id: string;
          effective_date: string;
          previous_value: number | null;
          new_value: number;
          changed_by: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["assets"]["Tables"]["asset_value_history"]["Row"]> & {
          company_id: string;
          asset_id: string;
          effective_date: string;
          new_value: number;
        };
        Update: Partial<Database["assets"]["Tables"]["asset_value_history"]["Row"]>;
      };
      asset_images: {
        Row: {
          id: string;
          asset_id: string;
          attachment_id: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Partial<Database["assets"]["Tables"]["asset_images"]["Row"]> & {
          asset_id: string;
          attachment_id: string;
        };
        Update: Partial<Database["assets"]["Tables"]["asset_images"]["Row"]>;
      };
      suppliers: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          contact_person: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          is_active: boolean;
          account_id: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["assets"]["Tables"]["suppliers"]["Row"]> & {
          company_id: string;
          name: string;
          created_by: string;
        };
        Update: Partial<Database["assets"]["Tables"]["suppliers"]["Row"]>;
      };
      asset_valuations: {
        Row: {
          id: string;
          company_id: string;
          asset_id: string;
          valuation_date: string;
          market_value: number;
          valuer: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["assets"]["Tables"]["asset_valuations"]["Row"]> & {
          company_id: string;
          asset_id: string;
          valuation_date: string;
          market_value: number;
          created_by: string;
        };
        Update: Partial<Database["assets"]["Tables"]["asset_valuations"]["Row"]>;
      };
      asset_sales: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          asset_id: string | null;
          customer_account_id: string | null;
          sale_date: string;
          payment_terms: string | null;
          due_date: string | null;
          currency_id: string;
          exchange_rate: number;
          pak_exch: number;
          narration: string | null;
          total_value: number;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["assets"]["Tables"]["asset_sales"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          sale_date: string;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["assets"]["Tables"]["asset_sales"]["Row"]>;
      };
      asset_sale_lines: {
        Row: {
          id: string;
          sale_id: string;
          line_no: number;
          cost_center_id: string | null;
          fixed_asset_account_id: string;
          gross: number;
          remarks: string | null;
          created_at: string;
        };
        Insert: Partial<Database["assets"]["Tables"]["asset_sale_lines"]["Row"]> & {
          sale_id: string;
          line_no: number;
          fixed_asset_account_id: string;
          gross: number;
        };
        Update: Partial<Database["assets"]["Tables"]["asset_sale_lines"]["Row"]>;
      };
    };
    Views: {
      v_asset_valuation: {
        Row: {
          asset_id: string;
          company_id: string;
          asset_code: string;
          asset_name: string;
          property_type: string;
          country: "PK" | "AE";
          city: string | null;
          purchase_value: number | null;
          current_value: number | null;
          variance: number | null;
          latest_valuation_date: string | null;
          latest_valuer: string | null;
        };
      };
    };
    Functions: {
      fn_delete_draft_asset_sale: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_soft_delete_asset: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_soft_delete_supplier: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_admin_delete_posted_asset_sale: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_log_value_change: {
        Args: {
          p_asset_id: string;
          p_previous: number | null;
          p_new: number;
          p_effective_date: string | null;
          p_remarks: string | null;
        };
        Returns: undefined;
      };
      fn_recompute_current_value: {
        Args: { p_asset_id: string };
        Returns: undefined;
      };
      fn_delete_value_history: {
        Args: { p_id: string };
        Returns: undefined;
      };
    };
  };
  rental: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          id_number: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          is_active: boolean;
          account_id: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["rental"]["Tables"]["tenants"]["Row"]> & {
          company_id: string;
          name: string;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["tenants"]["Row"]>;
      };
      uae_leases: {
        Row: {
          id: string;
          company_id: string;
          asset_id: string;
          tenant_id: string;
          lease_start: string;
          lease_end: string;
          rental_amount: number;
          rent_cycle: "monthly" | "yearly";
          security_deposit: number;
          currency_id: string;
          status: "active" | "expired" | "terminated";
          due_date: string | null;
          rent_month: string | null;
          remarks: string | null;
          document_no: string | null;
          document_date: string | null;
          lease_type: "standard" | "hh";
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["rental"]["Tables"]["uae_leases"]["Row"]> & {
          company_id: string;
          asset_id: string;
          tenant_id: string;
          lease_start: string;
          lease_end: string;
          rental_amount: number;
          rent_cycle: "monthly" | "yearly";
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["uae_leases"]["Row"]>;
      };
      uae_payment_schedules: {
        Row: {
          id: string;
          lease_id: string;
          due_date: string;
          amount: number;
          status: "pending" | "invoiced" | "paid" | "overdue";
          created_at: string;
        };
        Insert: never;
        Update: Partial<Database["rental"]["Tables"]["uae_payment_schedules"]["Row"]>;
      };
      uae_rent_invoices: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          lease_id: string;
          schedule_id: string | null;
          invoice_date: string;
          due_date: string;
          period_start: string;
          period_end: string;
          amount: number;
          currency_id: string;
          exchange_rate: number;
          outstanding_balance: number;
          invoice_type: "UAE" | "HH";
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["rental"]["Tables"]["uae_rent_invoices"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          lease_id: string;
          invoice_date: string;
          due_date: string;
          period_start: string;
          period_end: string;
          amount: number;
          currency_id: string;
          outstanding_balance: number;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["uae_rent_invoices"]["Row"]>;
      };
      uae_rent_payments: {
        Row: {
          id: string;
          company_id: string;
          invoice_id: string;
          journal_entry_id: string;
          payment_date: string;
          amount: number;
          cash_bank_account_id: string;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["rental"]["Tables"]["uae_rent_payments"]["Row"]> & {
          company_id: string;
          invoice_id: string;
          journal_entry_id: string;
          payment_date: string;
          amount: number;
          cash_bank_account_id: string;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["uae_rent_payments"]["Row"]>;
      };
      pk_leases: {
        Row: {
          id: string;
          company_id: string;
          asset_id: string;
          tenant_id: string;
          lease_start: string;
          lease_end: string;
          monthly_rent: number;
          advance_rent: number;
          security_deposit: number;
          currency_id: string;
          status: "active" | "expired" | "terminated";
          due_date: string | null;
          rent_month: string | null;
          created_by: string;
          created_at: string;
          updated_by: string | null;
          updated_at: string | null;
          deleted_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database["rental"]["Tables"]["pk_leases"]["Row"]> & {
          company_id: string;
          asset_id: string;
          tenant_id: string;
          lease_start: string;
          lease_end: string;
          monthly_rent: number;
          currency_id: string;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["pk_leases"]["Row"]>;
      };
      pk_payment_schedules: {
        Row: {
          id: string;
          lease_id: string;
          due_date: string;
          amount: number;
          status: "pending" | "invoiced" | "paid" | "overdue";
          created_at: string;
        };
        Insert: never;
        Update: Partial<Database["rental"]["Tables"]["pk_payment_schedules"]["Row"]>;
      };
      pk_rent_invoices: {
        Row: {
          id: string;
          company_id: string;
          journal_entry_id: string;
          voucher_no: string | null;
          lease_id: string;
          schedule_id: string | null;
          invoice_date: string;
          due_date: string;
          rent_amount: number;
          utility_charges: number;
          advance_adjusted: number;
          total_amount: number;
          currency_id: string;
          exchange_rate: number;
          outstanding_amount: number;
          invoice_type: "PK";
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["rental"]["Tables"]["pk_rent_invoices"]["Row"]> & {
          company_id: string;
          journal_entry_id: string;
          lease_id: string;
          invoice_date: string;
          due_date: string;
          rent_amount: number;
          currency_id: string;
          outstanding_amount: number;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["pk_rent_invoices"]["Row"]>;
      };
      pk_utility_charges: {
        Row: {
          id: string;
          invoice_id: string;
          utility_type: "electricity" | "gas" | "water" | "other";
          amount: number;
          description: string | null;
          created_at: string;
        };
        Insert: Partial<Database["rental"]["Tables"]["pk_utility_charges"]["Row"]> & {
          invoice_id: string;
          utility_type: "electricity" | "gas" | "water" | "other";
          amount: number;
        };
        Update: Partial<Database["rental"]["Tables"]["pk_utility_charges"]["Row"]>;
      };
      pk_rent_payments: {
        Row: {
          id: string;
          company_id: string;
          invoice_id: string;
          journal_entry_id: string;
          payment_date: string;
          amount: number;
          cash_bank_account_id: string;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["rental"]["Tables"]["pk_rent_payments"]["Row"]> & {
          company_id: string;
          invoice_id: string;
          journal_entry_id: string;
          payment_date: string;
          amount: number;
          cash_bank_account_id: string;
          created_by: string;
        };
        Update: Partial<Database["rental"]["Tables"]["pk_rent_payments"]["Row"]>;
      };
    };
    Views: {
      v_rent_invoices: {
        Row: {
          invoice_id: string;
          company_id: string;
          invoice_type: "PK" | "HH" | "UAE";
          source: "uae" | "pk";
          voucher_no: string | null;
          lease_id: string;
          tenant_id: string;
          asset_id: string;
          tenant_name: string;
          asset_code: string;
          asset_name: string;
          invoice_date: string;
          due_date: string;
          period_start: string | null;
          period_end: string | null;
          rent_amount: number;
          other_charges: number;
          total_amount: number;
          outstanding_amount: number;
          currency_id: string;
          currency_code: string;
          currency_symbol: string | null;
          status: JournalEntryStatus;
          created_at: string;
        };
      };
    };
    Functions: {
      fn_next_hh_lease_no: {
        Args: { p_company_id: string };
        Returns: string;
      };
      fn_delete_uae_lease: {
        Args: { p_lease_id: string };
        Returns: undefined;
      };
      fn_delete_pk_lease: {
        Args: { p_lease_id: string };
        Returns: undefined;
      };
      fn_soft_delete_tenant: {
        Args: { p_id: string };
        Returns: undefined;
      };
      fn_admin_delete_rent_invoice: {
        Args: { p_invoice_id: string; p_country: string };
        Returns: undefined;
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
  reporting: {
    Tables: Record<string, never>;
    Views: {
      v_ledger_entries: {
        Row: {
          company_id: string;
          journal_entry_id: string;
          line_no: number;
          entry_date: string;
          account_id: string;
          account_code: string;
          account_name: string;
          account_type: AccountType;
          is_cash: boolean;
          is_bank: boolean;
          cost_center_id: string | null;
          voucher_type: VoucherType;
          voucher_id: string;
          voucher_no: string | null;
          debit_amount: number;
          credit_amount: number;
          description: string | null;
          narration: string | null;
          status: JournalEntryStatus;
          due_date: string | null;
          cost_center_country: string | null;
        };
      };
      v_asset_register: {
        Row: {
          asset_id: string;
          company_id: string;
          asset_code: string;
          asset_name: string;
          property_type: string;
          country: "PK" | "AE";
          city: string | null;
          area: string | null;
          owner: string | null;
          status: "active" | "sold" | "inactive";
          purchase_date: string | null;
          purchase_value: number | null;
          current_value: number | null;
          cost_center_code: string | null;
          cost_center_name: string | null;
        };
      };
      v_purchase_report: {
        Row: {
          company_id: string;
          purchase_voucher_id: string;
          voucher_no: string | null;
          purchase_date: string;
          account_name: string;
          gross: number;
          currency_code: string;
          status: JournalEntryStatus;
        };
      };
      v_sale_report: {
        Row: {
          company_id: string;
          sale_id: string;
          voucher_no: string | null;
          sale_date: string;
          asset_code: string;
          asset_name: string;
          gross: number;
          currency_code: string;
          status: JournalEntryStatus;
        };
      };
      v_rental_income: {
        Row: {
          company_id: string;
          country: "UAE" | "PK";
          invoice_id: string;
          voucher_no: string | null;
          asset_code: string;
          asset_name: string;
          tenant_name: string;
          invoice_date: string;
          due_date: string;
          amount: number;
          outstanding_balance: number;
          currency_code: string;
          status: JournalEntryStatus;
          exchange_rate: number;
          lease_type: string | null;
          agent_share: number;
          net_amount: number;
          net_outstanding: number;
        };
      };
      v_outstanding_rent: {
        Row: {
          company_id: string;
          country: "UAE" | "PK";
          invoice_id: string;
          voucher_no: string | null;
          asset_code: string;
          asset_name: string;
          tenant_name: string;
          invoice_date: string;
          due_date: string;
          amount: number;
          outstanding_balance: number;
          currency_code: string;
          status: JournalEntryStatus;
          exchange_rate: number;
          days_overdue: number;
        };
      };
      v_currency_exchange_history: {
        Row: {
          company_id: string;
          currency_code: string;
          currency_name: string;
          rate_date: string;
          rate_to_base: number;
          source: "manual" | "api";
          created_by: string;
          created_at: string;
        };
      };
    };
    Functions: Record<string, never>;
  };
}
