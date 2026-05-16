-- F-9: Date of birth encrypted at rest
-- Key: SHA-256("household-finance:dob:" || JWT_SECRET) — instance-specific,
-- excluded from .hfb exports (must be re-entered after restore).
ALTER TABLE person_profile
  ADD COLUMN IF NOT EXISTS date_of_birth_encrypted TEXT;
