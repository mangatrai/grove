-- CR-109 Slice 5: allow member-scoped exports.
-- NULL = household-wide export (owner/admin); non-NULL = single-member export.
ALTER TABLE export_job
  ADD COLUMN person_profile_id TEXT REFERENCES person_profile(id);
