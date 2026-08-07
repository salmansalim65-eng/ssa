// JV Maintenance uses the exact same header + grid shape as the Journal Voucher.
export {
  journalLineSchema,
  journalVoucherSchema as jvMaintenanceVoucherSchema,
} from "../journal/schemas";
export type {
  JournalVoucherInput as JvMaintenanceVoucherInput,
  JournalVoucherFormValues as JvMaintenanceVoucherFormValues,
} from "../journal/schemas";
