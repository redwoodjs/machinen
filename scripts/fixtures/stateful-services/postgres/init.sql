DROP DATABASE IF EXISTS machinen_stateful_a;
DROP DATABASE IF EXISTS machinen_stateful_b;
CREATE DATABASE machinen_stateful_a;
CREATE DATABASE machinen_stateful_b;
\connect machinen_stateful_a
CREATE SCHEMA app;
CREATE TABLE app.accounts(id serial PRIMARY KEY, name text NOT NULL UNIQUE, balance integer NOT NULL CHECK(balance >= 0));
CREATE INDEX accounts_balance_idx ON app.accounts(balance);
CREATE VIEW app.account_names AS SELECT name FROM app.accounts;
INSERT INTO app.accounts(name, balance) SELECT 'acct-' || g, g * 3 FROM generate_series(1, 128) AS g;
\connect machinen_stateful_b
CREATE TABLE events(id serial PRIMARY KEY, payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO events(payload) SELECT 'event-' || g FROM generate_series(1, 64) AS g;
