# PostgreSQL Machinen fixture

Audited local fixture for Goal 43.

- `init.sql` creates the `machinen_pg` database and seed rows.
- `workload.sql` mutates the database, forces WAL/checkpoint boundaries, and
  prepares the clean quiesced snapshot point.
- `verify.sql` emits a single JSON value used by the source and restored target
  verifier.

The proof script copies these files into the guest image. It does not fetch SQL
or application code from the network during proof execution.
