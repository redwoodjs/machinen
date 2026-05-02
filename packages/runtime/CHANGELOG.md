# @machinen/runtime

## 0.1.0

### Minor Changes

- 9e27b02: `vm.exec()` now accepts multi-line commands and a new `vm.writeFile(guestPath, contents, opts?)` helper lands the common "drop a config file from the host" case in one tested call (#112).
  - `vm.exec("cat > /etc/foo <<'EOF'\nline1\nEOF")` no longer trips `EXEC_CMD_INVALID`. The host switches to a length-prefixed `EXEC2` opcode when the cmd contains a newline; legacy `EXEC` is still used for newline-free cmds so older rootfs images keep working.
  - `vm.writeFile(path, contents, { mode?, recursive?, append? })` ships `Buffer | string` contents through a single base64 pipeline — no quoting/heredoc gymnastics, binary-safe. Compatible with all agents.
  - `EXEC_CMD_INVALID` was the only caller of the now-lifted check and has been removed from the error-code enum.
