-- Epic 8.3 / D-010: FTS5 for merchant+memo search, rowid-aligned with transaction_canonical.
-- Requires implicit rowid on transaction_canonical (NOT WITHOUT ROWID). Fails migration if pragma_table_list shows wr!=0.
SELECT 1 / (
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM pragma_table_list
    WHERE name = 'transaction_canonical' AND type = 'table' AND ifnull(wr, 0) != 0
  ) THEN 0 ELSE 1 END
) AS pragma_check_transaction_canonical_not_without_rowid;

CREATE VIRTUAL TABLE IF NOT EXISTS ledger_search_fts USING fts5(
  body,
  tokenize = 'porter unicode61'
);

INSERT INTO ledger_search_fts(rowid, body)
SELECT
  rowid,
  coalesce(merchant, '') || ' ' || coalesce(memo, '')
FROM transaction_canonical;

CREATE TRIGGER IF NOT EXISTS tr_transaction_canonical_ai_ledger_search_fts
AFTER INSERT ON transaction_canonical
BEGIN
  INSERT INTO ledger_search_fts(rowid, body) VALUES (
    NEW.rowid,
    coalesce(NEW.merchant, '') || ' ' || coalesce(NEW.memo, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS tr_transaction_canonical_au_ledger_search_fts
AFTER UPDATE OF merchant, memo ON transaction_canonical
BEGIN
  DELETE FROM ledger_search_fts WHERE rowid = OLD.rowid;
  INSERT INTO ledger_search_fts(rowid, body) VALUES (
    NEW.rowid,
    coalesce(NEW.merchant, '') || ' ' || coalesce(NEW.memo, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS tr_transaction_canonical_ad_ledger_search_fts
AFTER DELETE ON transaction_canonical
BEGIN
  DELETE FROM ledger_search_fts WHERE rowid = OLD.rowid;
END;
