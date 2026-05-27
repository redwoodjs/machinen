CREATE TABLE accounts(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, balance INTEGER NOT NULL CHECK(balance >= 0));
CREATE TABLE ledger(id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), delta INTEGER NOT NULL, note TEXT NOT NULL);
CREATE INDEX ledger_account_idx ON ledger(account_id);
INSERT INTO accounts(name, balance) VALUES ('ada', 100), ('linus', 70), ('grace', 50);
