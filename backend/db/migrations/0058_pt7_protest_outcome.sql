-- PT-7: Protest status branching — outcome + informal offer amount
ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS outcome TEXT
    CHECK (outcome IN ('settled_informal', 'won_arb', 'lost_arb', 'withdrawn')),
  ADD COLUMN IF NOT EXISTS informal_offer_usd INTEGER;
