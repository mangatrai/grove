-- dev_0009_seed_family_planner.sql
-- Family Planner dev seed: household location, member profiles, nanny schedule, family events, PA deadlines.
-- All names and institution names are fictional test data (no real school/business names).
-- Deadlines use CURRENT_DATE offsets so they are always in the future on re-seed.

-- ─── Household location ───────────────────────────────────────────────────────
UPDATE household
SET city = 'Dallas', state = 'TX'
WHERE id = '10000000-0000-0000-0000-000000000001';

-- ─── Person profiles ──────────────────────────────────────────────────────────
-- Patch existing owner + spouse (seeded in dev_0004) to add age, interests, notes.
INSERT INTO person_profile (id, household_id, linked_user_id, full_name, email, age, interests_json, notes, created_at)
VALUES
  (
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'Alex Owner',
    'owner@example.com',
    37,
    '["music","movies","beer","food","travel","technology"]',
    'Dad. Likes music, movies, and travel. Enjoys trying new cuisines.',
    CURRENT_TIMESTAMP
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    'Sam Spouse',
    'spouse@example.com',
    35,
    '["music","food","indian"]',
    'Mom. Likes music and trying different cuisines — favorites are Indian, Thai, and Italian.',
    CURRENT_TIMESTAMP
  )
ON CONFLICT (id) DO UPDATE SET
  age            = EXCLUDED.age,
  interests_json = EXCLUDED.interests_json,
  notes          = EXCLUDED.notes;

-- New household members: two kids + nanny.
INSERT INTO person_profile (id, household_id, linked_user_id, full_name, email, age, interests_json, notes, created_at)
VALUES
  (
    '70000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    'Kid One',
    NULL,
    5,
    '["music","movies","dance","swim","karate","disney","books"]',
    '5 year old attending Northfield Academy in Frisco, TX. Starting 1st Grade in August 2026. Loves to swim, dance, listen to music, and watch TV. Getting into early chapter books.',
    CURRENT_TIMESTAMP
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    'Kid Two',
    NULL,
    0,
    '["infant"]',
    'Infant, home with nanny on weekdays. Pediatric checkups on schedule.',
    CURRENT_TIMESTAMP
  ),
  (
    '70000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    'Nanny Helper',
    'nanny@example.com',
    30,
    '[]',
    'Nanny. Regular weekday schedule Mon–Fri 8am–4pm. Covers both kids.',
    CURRENT_TIMESTAMP
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Household membership ─────────────────────────────────────────────────────
INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship, created_at)
VALUES
  ('80000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003', 'member', 'child', CURRENT_TIMESTAMP),
  ('80000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000004', 'member', 'child', CURRENT_TIMESTAMP),
  ('80000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000005', 'member', 'other',  CURRENT_TIMESTAMP)
ON CONFLICT (household_id, person_profile_id) DO NOTHING;

-- ─── Household help availability ──────────────────────────────────────────────
-- Nanny: regular Mon–Fri (days_of_week = "1,2,3,4,5"), 08:00–16:00.
INSERT INTO household_help_availability
  (id, household_id, person_profile_id, slot_type, service_type, days_of_week, start_time, end_time, label, is_active, created_at)
VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000005',
    'regular',
    'nanny',
    '1,2,3,4,5',
    '08:00',
    '16:00',
    'Regular weekday coverage',
    TRUE,
    CURRENT_TIMESTAMP
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Family events (recurring activities) ────────────────────────────────────
-- start_at anchored to current week's day at activity time (UTC).
-- Recurrence rule drives the forward schedule; start_at is just the anchor.
-- Thursday = DATE_TRUNC('week', CURRENT_DATE) + 3 days (Postgres ISO week starts Monday)
-- Tuesday  = DATE_TRUNC('week', CURRENT_DATE) + 1 day
INSERT INTO family_events
  (id, household_id, record_type, source, title, description, start_at, end_at, location, is_recurring, recurrence_rule, all_day, is_active, created_at, updated_at)
VALUES
  (
    'c0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'event', 'manual',
    'Kid One — swim lesson',
    'Kid One level 4 swim lessons, weekly.',
    DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days' + INTERVAL '22 hours',
    DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '3 days' + INTERVAL '22 hours 30 minutes',
    'Frisco Aquatics Center',
    TRUE, 'RRULE:FREQ=WEEKLY;BYDAY=TH', FALSE, TRUE,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'event', 'manual',
    'Kid One — karate class',
    'Kid One weekly karate sessions.',
    DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day' + INTERVAL '21 hours',
    DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 day' + INTERVAL '21 hours 45 minutes',
    'Frisco Martial Arts Academy',
    TRUE, 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', FALSE, TRUE,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Family deadlines (PA-relevant, always future) ───────────────────────────
-- due_date is TEXT (ISO YYYY-MM-DD). Offsets from CURRENT_DATE keep these relevant on every re-seed.
INSERT INTO family_events
  (id, household_id, record_type, source, title, description, due_date, all_day, is_active, created_at, updated_at)
VALUES
  (
    'c0000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Nanny schedule — school-year hours review',
    'Confirm nanny hours and backup coverage plan before Kid One starts 1st Grade in August.',
    (CURRENT_DATE + INTERVAL '3 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Swim lesson — fall session registration',
    'Register Kid One for fall swim lessons before session fills. Check Frisco Aquatics Center schedule.',
    (CURRENT_DATE + INTERVAL '7 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Karate — fall session enrollment',
    'Confirm fall enrollment for Kid One karate and check upcoming belt test requirements.',
    (CURRENT_DATE + INTERVAL '10 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    '1st Grade school supplies — order window',
    'Order supplies from Northfield Academy school list before orientation week.',
    (CURRENT_DATE + INTERVAL '14 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000014',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Kid One — annual well-child visit (age 5)',
    'Schedule 5-year well-child visit with pediatrician. Vision and hearing screening at this age.',
    (CURRENT_DATE + INTERVAL '20 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000015',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    '1st Grade new parent orientation',
    'Northfield Academy orientation for incoming 1st Grade families. Confirm date with school.',
    (CURRENT_DATE + INTERVAL '21 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000016',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Kid Two — 6-month pediatric checkup',
    'Schedule 6-month well visit for Kid Two. Includes routine vaccinations.',
    (CURRENT_DATE + INTERVAL '30 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'c0000000-0000-0000-0000-000000000017',
    '10000000-0000-0000-0000-000000000001',
    'deadline', 'manual',
    'Annual family dental checkups',
    'Schedule annual cleanings for both parents and Kid One. Kid Two first dental visit due around 12 months.',
    (CURRENT_DATE + INTERVAL '45 days')::text,
    TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Family agent alerts (PA1 dev-seed gap #3) ──────────────────────────────
-- Without any prior alert rows, buildAlreadySuggestedText()/dedup and buildCalibrationBlock()
-- (FIX #216 / FIX #208) are never exercised on a fresh dev seed — the "already suggested" and
-- "deprioritize/avoid" prompt blocks are always empty. Seed:
--   f1..01-02: open (unresolved) 'suggestion' alerts — one plain, one email-sourced (source_quote +
--              create_gcal_event action_payload) — for buildAlreadySuggestedText + dedup.
--   f1..03-05: resolved 'not_relevant' x3 tagged [KARATE] — crosses NOT_RELEVANT_AVOID_THRESHOLD
--              (=3) so buildCalibrationBlock() emits a "Deprioritize/avoid" line.
--   f1..06-07: resolved 'useful' x2 tagged [MUSIC] — exercises the "Keep prioritizing" branch.
INSERT INTO family_agent_alerts
  (id, household_id, alert_type, reason, affected_date, copy_paste_text, recipient_hint,
   is_resolved, resolved_at, resolution_kind, source_quote, action_type, action_payload, detected_at)
VALUES
  (
    'f1000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[SWIM] Register Kid One for the winter swim session before it fills.',
    (CURRENT_DATE + INTERVAL '12 days')::text,
    'Reminder: winter swim session registration opens soon — register Kid One before spots fill.',
    'Self',
    FALSE, NULL, NULL, NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '2 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[SCHOOL] Order Northfield Academy 1st grade school supply list before orientation week.',
    (CURRENT_DATE + INTERVAL '9 days')::text,
    'Order the Northfield Academy 1st grade supply list before orientation week.',
    'Self',
    FALSE, NULL, NULL,
    'Please have all school supplies ordered from the linked list by orientation on the 14th.',
    'create_gcal_event',
    jsonb_build_object(
      'title', 'Order Northfield Academy school supplies',
      'date', (CURRENT_DATE + INTERVAL '9 days')::text,
      'description', 'Order the 1st grade supply list before orientation week.'
    ),
    CURRENT_TIMESTAMP - INTERVAL '1 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[KARATE] Enroll Kid One in the spring karate session before early registration closes.',
    (CURRENT_DATE - INTERVAL '40 days')::text,
    'Enroll Kid One in the spring karate session before early registration closes.',
    'Self',
    TRUE, CURRENT_TIMESTAMP - INTERVAL '35 days', 'not_relevant', NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '42 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[KARATE] Renew Kid One karate belt-test registration before the cutoff.',
    (CURRENT_DATE - INTERVAL '30 days')::text,
    'Renew Kid One karate belt-test registration before the cutoff.',
    'Self',
    TRUE, CURRENT_TIMESTAMP - INTERVAL '25 days', 'not_relevant', NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '32 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[KARATE] Sign Kid One up for the karate summer camp before it fills.',
    (CURRENT_DATE - INTERVAL '20 days')::text,
    'Sign Kid One up for the karate summer camp before it fills.',
    'Self',
    TRUE, CURRENT_TIMESTAMP - INTERVAL '15 days', 'not_relevant', NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '22 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[MUSIC] Register Kid One for the spring piano recital before the sign-up deadline.',
    (CURRENT_DATE - INTERVAL '18 days')::text,
    'Register Kid One for the spring piano recital before the sign-up deadline.',
    'Self',
    TRUE, CURRENT_TIMESTAMP - INTERVAL '20 days', 'useful', NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '22 days'
  ),
  (
    'f1000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'suggestion',
    '[MUSIC] Confirm Kid One piano lesson schedule change before the new term starts.',
    (CURRENT_DATE - INTERVAL '8 days')::text,
    'Confirm Kid One piano lesson schedule change before the new term starts.',
    'Self',
    TRUE, CURRENT_TIMESTAMP - INTERVAL '10 days', 'useful', NULL, NULL, NULL,
    CURRENT_TIMESTAMP - INTERVAL '12 days'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Household inbox email ingestion log (PA1 dev-seed gap #4, FIX #215) ────
-- Empty on a fresh dev seed, so the inbox → alert flow (email-ingest.service.ts) could only be
-- observed by sending a real email through IMAP. Seed one 'processed' row (matches the
-- email-sourced alert f1..02 above) and one 'ignored' row (promotional, no actionable item) so
-- both branches of markLogStatus() are visible without a live mailbox.
INSERT INTO email_ingest_log
  (id, household_id, message_id, from_addr, subject, received_at, excerpt, items_json, status, created_at)
VALUES
  (
    'f2000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'dev-seed-msg-001@example.com',
    'Northfield Academy Front Office <frontoffice@example-school.org>',
    '1st Grade Supply List — Order by Orientation',
    CURRENT_TIMESTAMP - INTERVAL '1 days',
    'Please have all school supplies ordered from the linked list by orientation on the 14th.',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'deadline',
        'title', 'Order Northfield Academy school supplies',
        'date', (CURRENT_DATE + INTERVAL '9 days')::text,
        'who', 'Kid One',
        'actionRequired', 'Order the 1st grade supply list before orientation week.',
        'sourceQuote', 'Please have all school supplies ordered from the linked list by orientation on the 14th.'
      )
    ),
    'processed',
    CURRENT_TIMESTAMP - INTERVAL '1 days'
  ),
  (
    'f2000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'dev-seed-msg-002@example.com',
    'Frisco Aquatics Center <newsletter@example-aquatics.org>',
    '20% Off Swim Gear This Weekend Only!',
    CURRENT_TIMESTAMP - INTERVAL '3 days',
    'Stock up on goggles, caps, and swim bags — 20% off this weekend only, no code needed.',
    '[]'::jsonb,
    'ignored',
    CURRENT_TIMESTAMP - INTERVAL '3 days'
  )
ON CONFLICT (household_id, message_id) DO NOTHING;
