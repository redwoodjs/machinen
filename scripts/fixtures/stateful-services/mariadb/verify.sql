USE machinen_stateful;
SELECT JSON_OBJECT(
  'accountCount', (SELECT COUNT(*) FROM accounts),
  'balanceSum', (SELECT SUM(balance) FROM accounts),
  'ledgerCount', (SELECT COUNT(*) FROM ledger),
  'names', (SELECT JSON_ARRAYAGG(name ORDER BY id) FROM accounts),
  'balances', (SELECT JSON_ARRAYAGG(balance ORDER BY id) FROM accounts)
);
