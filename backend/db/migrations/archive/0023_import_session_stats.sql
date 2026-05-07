-- CR-118: store import summary counts for history and quick UI rendering.
ALTER TABLE import_session
ADD COLUMN IF NOT EXISTS stats_json jsonb;
