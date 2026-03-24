export interface NormalizedRawPayload {
  txn_date: string;
  posting_date: string;
  description: string;
  amount: number;
  reference_id?: string;
  source_row: Record<string, string>;
}
