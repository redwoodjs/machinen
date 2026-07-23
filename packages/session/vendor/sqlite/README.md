# SQLite amalgamation

- Version: 3.51.0
- Source: <https://www.sqlite.org/2025/sqlite-amalgamation-3510000.zip>
- Archive SHA-256: `1caf7116f2910600d04473ad69d37ec538fa62fa36adccd37b5e0e43647c98be`
- `sqlite3.c` SHA-256: `dc58f0b5b74e8416cc29b49163a00d6b8bf08a24dd4127652beaaae307bd1839`
- `sqlite3.h` SHA-256: `05c48cbf0a0d7bda2b6d0145ac4f2d3a5e9e1cb98b5d4fa9d88ef620e1940046`
- Dedication: SQLite is in the public domain. See <https://www.sqlite.org/copyright.html>.

Only the library amalgamation is vendored. The SQLite command-line shell is not
included. Machinen compiles the library with runtime extension loading disabled.
