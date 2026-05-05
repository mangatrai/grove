-- CR-109 Slice 3: track which user created each import session
-- so members can only access/manage their own sessions.
ALTER TABLE import_session
  ADD COLUMN created_by_user_id TEXT REFERENCES app_user(id);
