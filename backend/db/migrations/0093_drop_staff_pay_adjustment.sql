-- Drop staff_pay_adjustment: bonuses/one-off pay are tracked via transactions
-- tagged to the Employee > Bonus category (transaction_canonical.owner_person_profile_id +
-- category_id), not as a separate manually-recorded adjustment.
DROP TABLE staff_pay_adjustment;
