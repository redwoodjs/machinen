SELECT json_object(
  'accountCount', (SELECT count(*) FROM accounts),
  'balanceSum', (SELECT sum(balance) FROM accounts),
  'ledgerCount', (SELECT count(*) FROM ledger),
  'names', (SELECT json_group_array(name) FROM (SELECT name FROM accounts ORDER BY id)),
  'balances', (SELECT json_group_array(balance) FROM (SELECT balance FROM accounts ORDER BY id))
);
