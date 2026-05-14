-- I-3: Fix builtin mobility rules misrouted to Public Transit (Mobility > 30000000-0000-0000-0000-000000000005)
-- Gas stations → Mobility > Fuel (154); parking/toll → Mobility > Parking & Tolls (166)

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000154',
      rule_key    = 'fuel_0_shell'
WHERE id = 'b0010000-0000-4000-8000-000000000065';

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000154',
      rule_key    = 'fuel_1_exxon'
WHERE id = 'b0010000-0000-4000-8000-000000000066';

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000154',
      rule_key    = 'fuel_2_chevron'
WHERE id = 'b0010000-0000-4000-8000-000000000067';

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000154',
      rule_key    = 'fuel_3_bp'
WHERE id = 'b0010000-0000-4000-8000-000000000068';

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000166',
      rule_key    = 'parking_0_parking'
WHERE id = 'b0010000-0000-4000-8000-000000000069';

UPDATE category_rule_global
  SET category_id = '30000000-0000-0000-0000-000000000166',
      rule_key    = 'parking_1_toll'
WHERE id = 'b0010000-0000-4000-8000-000000000072';
