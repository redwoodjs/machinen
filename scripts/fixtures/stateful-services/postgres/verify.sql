\connect machinen_stateful_a
SELECT json_build_object(
  'database', current_database(),
  'accountCount', count(*),
  'balanceSum', sum(balance),
  'firstNames', array_agg(name ORDER BY id) FILTER (WHERE id <= 3),
  'hasExtra', bool_or(name = 'checkpoint-extra')
)::text FROM app.accounts;
\connect machinen_stateful_b
SELECT json_build_object(
  'database', current_database(),
  'eventCount', count(*),
  'hasCheckpoint', bool_or(payload = 'checkpoint-ready')
)::text FROM events;
