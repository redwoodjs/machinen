---
"@machinen/cli": minor
"@machinen/runtime": minor
"@machinen/native-arm64-darwin": minor
---

Add opt-in macOS guests. `boot({ guestOS: "macos" })` and
`machinen boot --guest-os macos` boot a prepared VM bundle through a signed
Swift Virtualization.framework runner and drive it over key-only SSH/SFTP.

Linux remains the default and its boot path is unchanged. A macOS guest
dispatches before kernel, DTB, initramfs, rootdisk, gvproxy, and vsock setup,
so none of that work runs for it.

macOS guests refuse snapshot, fork, restore, memory stats, and persistent
sessions with `PROVIDER_UNSUPPORTED_OPERATION`. Apple saved state is encrypted
to the originating host, and an SSH PTY is not a reconnectable session.
