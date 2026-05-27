\connect machinen_pg
SELECT json_build_object(
  'database', current_database(),
  'rowCount', count(*),
  'valueSum', sum(value),
  'payloads', array_agg(payload ORDER BY id),
  'values', array_agg(value ORDER BY id)
)::text FROM events;
