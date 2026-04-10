-- One import-sourced balance per (financial_account, as_of_date); enables stable upsert on re-parse.
CREATE UNIQUE INDEX uq_account_balance_import_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'import';
