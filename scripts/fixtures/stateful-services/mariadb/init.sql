DROP DATABASE IF EXISTS machinen_stateful;
CREATE DATABASE machinen_stateful;
USE machinen_stateful;
CREATE TABLE accounts(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE, balance INT NOT NULL, CHECK(balance >= 0)) ENGINE=InnoDB;
CREATE TABLE ledger(id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, delta_value INT NOT NULL, note VARCHAR(128) NOT NULL, INDEX ledger_account_idx(account_id), FOREIGN KEY(account_id) REFERENCES accounts(id)) ENGINE=InnoDB;
INSERT INTO accounts(name, balance) VALUES ('ada', 100), ('linus', 70), ('grace', 50);
