-- Rebuild FTS index from transaction_canonical (fixes empty/out-of-sync ledger_search_fts after manual SQL or failed triggers).
DELETE FROM ledger_search_fts;
INSERT INTO ledger_search_fts(rowid, body)
SELECT
  rowid,
  coalesce(merchant, '') || ' ' || coalesce(memo, '')
FROM transaction_canonical;
