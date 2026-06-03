BEGIN TRANSACTION;
CREATE TABLE items(id integer primary key, name text not null, qty integer not null);
INSERT INTO "items" VALUES(1,'alpha',11);
INSERT INTO "items" VALUES(2,'beta',13);
INSERT INTO "items" VALUES(3,'gamma',17);
COMMIT;
