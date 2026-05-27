\connect machinen_pg
UPDATE events SET value = value + 5 WHERE payload = 'beta';
INSERT INTO events(payload, value) VALUES ('delta', 40);
CHECKPOINT;
SELECT pg_switch_wal();
CHECKPOINT;
