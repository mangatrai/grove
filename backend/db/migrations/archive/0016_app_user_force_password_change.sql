-- Force password change flag: set on newly created member login accounts.
-- Cleared by auth.service when the user successfully changes their password.
ALTER TABLE app_user ADD COLUMN force_password_change BOOLEAN NOT NULL DEFAULT false;
