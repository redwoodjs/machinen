\connect machinen_stateful_a
BEGIN;
UPDATE app.accounts SET balance = balance + 7 WHERE id % 17 = 0;
INSERT INTO app.accounts(name, balance) VALUES ('checkpoint-extra', 999);
COMMIT;
CHECKPOINT;
\connect machinen_stateful_b
INSERT INTO events(payload) VALUES ('checkpoint-ready');
CHECKPOINT;
