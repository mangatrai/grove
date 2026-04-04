PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS person_profile (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  linked_user_id TEXT UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone_number TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (linked_user_id) REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS household_membership (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  person_profile_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('head', 'member')),
  relationship TEXT NOT NULL CHECK (
    relationship IN ('self', 'spouse', 'child', 'dependent', 'other')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (person_profile_id) REFERENCES person_profile(id),
  UNIQUE (household_id, person_profile_id)
);

INSERT OR IGNORE INTO person_profile (
  id,
  household_id,
  linked_user_id,
  full_name,
  email
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))),
  u.household_id,
  u.id,
  '',
  u.email
FROM app_user u
WHERE u.household_id IS NOT NULL;

INSERT OR IGNORE INTO household_membership (
  id,
  household_id,
  person_profile_id,
  role,
  relationship
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))),
  p.household_id,
  p.id,
  CASE WHEN u.role = 'owner' THEN 'head' ELSE 'member' END,
  CASE WHEN u.role = 'owner' THEN 'self' ELSE 'other' END
FROM person_profile p
JOIN app_user u ON u.id = p.linked_user_id;
