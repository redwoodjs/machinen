# Cross-arch CLI next binaries ladder

This document is the product boundary for the next `machinen move` CLI
continuation ladder after the initial sleep/tail work. Product success means
**cross-ISA target-native semantic continuation from captured live state, or
refusal**.

The supported order is:

1. `cat`
2. `dd`
3. `wc -l`
4. `seq`
5. fixed-string `grep -F`

## Global rule

A product `machinen move` success must continue from captured state that changes
the target behavior. If required state is missing, the move must refuse and leave
no successful target process.

Hard bans:

- same-arch product success
- argv restart
- target execve from argv
- reexec
- static-root reconstruction
- output replay
- descriptor-only success
- descriptor-only equivalence
- app export/import
- source-ISA emulation
- source-fd teleportation
- metadata-only success
- runtime-profile shortcut
- arbitrary process restore
- any-binary movement

## `cat`

Supported subset: one regular-file input, or a modeled stdin regular file, with
a modeled stdout cursor and no terminal/session state.

Captured semantic state:

- executable identity for `cat`
- source ISA and target ISA, with target ISA different from source ISA
- input path or fd identity
- device/inode or stable identity digest
- file size and mtime at capture
- content hash window around the read offset
- read offset
- partial read buffer bytes
- stdout cursor and stderr cursor
- safe-point evidence
- target regular-file preflight
- evidence that no target process exists before eligibility

Target-native continuation step:

1. verify cross-ISA target
2. verify equivalent input identity and content hash window
3. open a target-native reader vessel without argv restart
4. seek to the captured read offset
5. install partial buffer and stdout cursor
6. emit only bytes after the captured cursor

Refuse when terminal, PTY/session, pipe, socket, multiple input, changed input
identity, invalid offset, dirty writable alias, missing split-read buffer,
same-arch product attempt, argv restart, target execve from argv, output replay,
or descriptor-only success is present.

Proof must show that the target emits the first byte after the captured cursor,
does not replay old bytes, and would differ from a fresh argv restart that emits
from byte zero.

## `dd`

Supported subset: regular-file input to regular-file output with simple block
copy and no unsafe flags.

Captured semantic state:

- executable identity for `dd`
- source ISA and target ISA, with target ISA different from source ISA
- input and output file identities
- block size
- input offset and output offset
- partial block bytes and length
- records-in and records-out counters
- bytes copied counter
- status output cursor
- safe conversion flag set
- target input/output file preflight
- dirty alias absence evidence

Target-native continuation step:

1. verify cross-ISA target
2. verify equivalent input and output identities
3. open a target-native copy vessel without argv restart
4. seek input and output to captured offsets
5. install partial block state and counters
6. copy only remaining blocks from captured state

Refuse devices, tapes, terminals, pipes, sockets, sparse mode, direct I/O,
unmodeled `conv=` flags, pending signal status, dirty writable aliases, changed
input/output identities, missing partial block state, same-arch product attempt,
argv restart, target execve from argv, output replay, and descriptor-only
success.

Proof must show that the target copies from the captured offsets, does not recopy
prior blocks, and continues counters from captured values.

## `wc -l`

Supported subset: line count for one regular-file input with modeled newline
boundary and stdout cursor.

Captured semantic state:

- executable identity for `wc`
- source ISA and target ISA, with target ISA different from source ISA
- input file identity
- byte offset
- line count so far
- partial newline state
- line decoder state
- locale assumptions
- stdout cursor and stderr cursor
- safe-point evidence
- target file preflight

Target-native continuation step:

1. verify cross-ISA target
2. verify equivalent input identity
3. open a target-native `wc -l` vessel without argv restart
4. seek to the captured byte offset
5. install line count and newline boundary state
6. count only remaining bytes and combine with the captured count

Refuse broad `wc` byte, char, and word modes; multiple inputs before a list
cursor exists; unmodeled locale or encoding; changed input identity; invalid
offset; terminal, pipe, or socket state; same-arch product attempt; argv
restart; target execve from argv; output replay; and descriptor-only success.

Proof must show that the final count is captured line count plus suffix count,
and that the target does not reread bytes before the captured offset.

## `seq`

Supported subset: integer sequence with modeled step, end, format, separator,
emitted item cursor, and stdout cursor.

Captured semantic state:

- executable identity for `seq`
- source ISA and target ISA, with target ISA different from source ISA
- first value
- current value
- next value
- end value
- step value
- format string
- separator
- emitted item cursor
- stdout cursor
- numeric precision assumptions
- safe-point evidence

Target-native continuation step:

1. verify cross-ISA target
2. open a target-native generator vessel without argv restart
3. install next value, end, step, format, separator, and output cursor
4. emit the captured next value and following values only

Refuse unsupported floating-point formats, unmodeled locale formatting, precision
differences across ISAs, missing partial formatted value state, missing stdout
cursor, same-arch product attempt, argv restart, target execve from argv, output
replay, and descriptor-only success.

Proof must show that the target emits the captured next value first and does not
restart at the first value.

## Fixed-string `grep -F`

Supported subset: fixed-string line matching for one regular-file input with
modeled selected flags.

Captured semantic state:

- executable identity for `grep`
- source ISA and target ISA, with target ISA different from source ISA
- pattern bytes
- selected safe flags
- input file identity
- byte offset
- partial line buffer
- line decoder state
- matcher state
- match count so far
- stdout cursor and stderr cursor
- safe-point evidence
- target file preflight

Target-native continuation step:

1. verify cross-ISA target
2. verify equivalent input identity
3. open a target-native fixed-string matcher vessel without argv restart
4. seek to the captured byte offset
5. install partial line, matcher state, match count, and output cursor
6. match only lines after the captured cursor

Refuse regex mode, PCRE mode, backrefs, locale-sensitive classes, context output,
color output, unmodeled binary-file mode, recursive input, multiple files before
a list cursor exists, changed input identity, missing partial line state,
same-arch product attempt, argv restart, target execve from argv, output replay,
and descriptor-only success.

Proof must show that the target matches only lines after the captured cursor,
does not rematch prior lines, and does not replay prior matched output.

## Global refusals and non-claims

The ladder refuses `less`, `vi`, broad grep, broad wc, unsafe dd modes, pipes,
sockets, terminal/session shapes, services, databases, shells, same-arch product
attempts, source-ISA emulation, source-fd teleportation, metadata-only success,
and every unmodeled shortcut.

This ladder does not claim arbitrary process restore, any-binary movement, broad
runtime support, service/database/shell movement, PTY/session movement, app
export/import, source-ISA emulation, or a runtime-profile shortcut.
