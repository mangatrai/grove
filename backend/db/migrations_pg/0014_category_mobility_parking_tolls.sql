-- Global default category: Mobility > Parking & Tolls
INSERT INTO category (id, household_id, parent_id, name, is_default)
VALUES (
  '30000000-0000-0000-0000-000000000166',
  NULL,
  '30000000-0000-0000-0000-000000000103',
  'Parking & Tolls',
  1
)
ON CONFLICT (id) DO NOTHING;
