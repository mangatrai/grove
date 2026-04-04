PRAGMA foreign_keys = ON;

ALTER TABLE person_profile ADD COLUMN salary_deposit_financial_account_id TEXT;
ALTER TABLE person_profile ADD COLUMN employers_json TEXT;

UPDATE person_profile
SET salary_deposit_financial_account_id = (
      SELECT h.salary_deposit_financial_account_id
      FROM household h
      WHERE h.id = person_profile.household_id
    ),
    employers_json = (
      SELECT h.employers_json
      FROM household h
      WHERE h.id = person_profile.household_id
    )
WHERE linked_user_id = (
    SELECT h.owner_user_id
    FROM household h
    WHERE h.id = person_profile.household_id
  );
