-- Audit column must not block app_user deletion (e.g. removed household member).
ALTER TABLE household_gdrive_config
  DROP CONSTRAINT IF EXISTS household_gdrive_config_connected_by_user_id_fkey;

ALTER TABLE household_gdrive_config
  ALTER COLUMN connected_by_user_id DROP NOT NULL;

ALTER TABLE household_gdrive_config
  ADD CONSTRAINT household_gdrive_config_connected_by_user_id_fkey
  FOREIGN KEY (connected_by_user_id) REFERENCES app_user(id) ON DELETE SET NULL;
