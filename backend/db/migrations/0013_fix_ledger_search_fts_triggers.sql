-- FIX: FTS5 row removal must use DELETE FROM ledger_search_fts WHERE rowid = …
-- (INSERT … VALUES('delete', rowid) is not valid for this FTS5 configuration; caused SQL logic error on DELETE canonical rows.)

DROP TRIGGER IF EXISTS tr_transaction_canonical_au_ledger_search_fts;
DROP TRIGGER IF EXISTS tr_transaction_canonical_ad_ledger_search_fts;

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
