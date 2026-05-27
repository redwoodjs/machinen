BEGIN IMMEDIATE;
UPDATE accounts SET balance = balance + 25 WHERE name = 'ada';
UPDATE accounts SET balance = balance - 10 WHERE name = 'linus';
INSERT INTO ledger(account_id, delta, note) VALUES (1, 25, 'deposit'), (2, -10, 'withdrawal'), (3, 0, 'checkpoint');
COMMIT;
