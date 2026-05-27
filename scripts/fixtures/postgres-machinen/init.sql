DROP DATABASE IF EXISTS machinen_pg;
CREATE DATABASE machinen_pg;
\connect machinen_pg
CREATE TABLE events (
  id serial PRIMARY KEY,
  payload text NOT NULL,
  value integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO events(payload, value) VALUES ('alpha', 10), ('beta', 20), ('gamma', 30);
