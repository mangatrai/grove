-- RBAC CR-109: track which app_user created each category and custom institution
-- so members can edit/delete only their own rows.
-- financial_account already has owner_user_id for this purpose.
ALTER TABLE category
  ADD COLUMN created_by_user_id TEXT REFERENCES app_user(id);

ALTER TABLE household_custom_institution
  ADD COLUMN created_by_user_id TEXT REFERENCES app_user(id);
