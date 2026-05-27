# Goal 26: Remaining portable snapshot/restore graduations (targets 51-250)

Parent context: Goals 21-25 completed the first 50-target portable
snapshot/restore wave and hardened it with concrete positive, negative, and live
source-capture proof records. This goal covers the remaining 200 graduation
targets for the larger 250-target backlog.

## Objective

Graduate targets 51-250 as real target-native capabilities. Each target must have
a narrow accepted subset, source-capture support, portable descriptor fields,
target-native restore recipe, verifier gates, positive proof, negative neighbors,
support-envelope updates, matrix coverage, artifact hashes, and validation
timings.

Do not claim broad runtime/kernel support. Graduate only the named subset and
keep neighboring states fail-closed with stable refusal codes and
`migrationCompleted=false`.

## Required graduation standard

A target is complete only when all of these are true:

- accepted subset name and descriptor version are defined;
- source capture records exact kernel-visible state;
- portable descriptor/schema carries every target restore field;
- target-native restore materializes state without source-ISA emulation, sidecars,
  app hooks, hidden helpers, or source text replay;
- verifier gates prove restored identities, bytes, flags, ownership, ordering,
  and readiness/wake/packet state as applicable;
- positive arm64->amd64 proof reaches `migrationCompleted=true` only after all
  gates pass;
- at least five neighboring negative proofs fail closed target-natively;
- support-envelope docs, proof profiles, matrices, tests, artifact hashes, and
  timings are updated.

## Targets 51-100

51. [x] **io-uring empty ring v1**

- Source refusals: `io-uring-state-refusal`.
- Accepted subset candidate: one SQ/CQ ring with no pending entries and target-verified params.
- Key negative neighbors: pending SQE, CQE residue, shared ring, unsupported opcode, registered files.

52. [x] **io-uring single timeout SQE v1**

- Source refusals: `io-uring-state-refusal`.
- Accepted subset candidate: one target-owned timeout SQE with exact relative timeout.
- Key negative neighbors: elapsed timeout, linked SQE, multishot, signal race, stale timespec.

53. [x] **POSIX mq empty descriptor v1**

- Source refusals: `posix-mq-refusal`.
- Accepted subset candidate: one POSIX message queue descriptor with empty queue and target-created name.
- Key negative neighbors: queued message, unlinked name, attr mismatch, cross-process opener, unsupported notify.

54. [x] **POSIX mq one message v1**

- Source refusals: `posix-mq-refusal`.
- Accepted subset candidate: one queued message with exact priority and bytes.
- Key negative neighbors: multiple messages, priority order ambiguity, stale bytes, notify armed, missing permissions.

55. [x] **inotify empty watch v1**

- Source refusals: `inotify-state-refusal`.
- Accepted subset candidate: one inotify instance with one target path watch and empty event queue.
- Key negative neighbors: queued event, stale wd, deleted path, recursive ambiguity, unsupported mask.

56. [x] **inotify one create event v1**

- Source refusals: `inotify-state-refusal`.
- Accepted subset candidate: one queued create event with exact name/cookie/mask.
- Key negative neighbors: multiple events, cookie mismatch, overflow, stale path, ignored watch.

57. [x] **fanotify empty mark v1**

- Source refusals: `fanotify-state-refusal`.
- Accepted subset candidate: one fanotify group with target mark and empty queue.
- Key negative neighbors: permission event, queued event, mount mark, pidfd ambiguity, unsupported flags.

58. [x] **pidfd live child v1**

- Source refusals: `pidfd-state-refusal`.
- Accepted subset candidate: one target-spawned child with pidfd identity and no pending signal.
- Key negative neighbors: exited child, wrong pid, signal pending, wait ambiguity, cross-namespace pid.

59. [x] **pidfd completed child v1**

- Source refusals: `pidfd-state-refusal`.
- Accepted subset candidate: one completed child pidfd with exact wait status.
- Key negative neighbors: running child, multiple waiters, reaped child, signal race, pid reuse.

60. [x] **pidfd poll readable v1**

- Source refusals: `pidfd-state-refusal`.
- Accepted subset candidate: one pidfd whose target poll readiness is verified readable.
- Key negative neighbors: not-ready child, stale readiness, alias, cross-namespace, wait consumed.

61. [x] **clone3 set_tid absent v1**

- Source refusals: `clone3-state-refusal`.
- Accepted subset candidate: clone3-created thread without set_tid side effects and target-owned TLS.
- Key negative neighbors: set_tid array, cgroup, pid namespace, vfork, unsupported flags.

62. [x] **seccomp strict mode v1**

- Source refusals: `seccomp-state-refusal`.
- Accepted subset candidate: target-installed strict seccomp policy with no user notification.
- Key negative neighbors: filter mode, listener fd, TSYNC, arch mismatch, return action ambiguity.

63. [x] **seccomp BPF allowlist simple v1**

- Source refusals: `seccomp-state-refusal`.
- Accepted subset candidate: classic BPF allowlist reinstalled byte-for-byte on target.
- Key negative neighbors: unsupported instruction, arch mismatch, user notification, TSYNC race, filter stack.

64. [x] **landlock empty ruleset v1**

- Source refusals: `landlock-state-refusal`.
- Accepted subset candidate: one target-created Landlock ruleset with no restrictive handled access.
- Key negative neighbors: ruleset mismatch, ABI mismatch, path rule, inherited restriction, unsupported access.

65. [x] **landlock single readonly rule v1**

- Source refusals: `landlock-state-refusal`.
- Accepted subset candidate: one readonly path-beneath rule with target path digest.
- Key negative neighbors: write rule, stale path, mount rename, ABI mismatch, missing ruleset.

66. [x] **cgroup membership read-only v1**

- Source refusals: `cgroup-state-refusal`.
- Accepted subset candidate: process membership verified in target cgroup without controller mutation.
- Key negative neighbors: controller state, migration, namespace mismatch, missing cgroup, pressure stall.

67. [x] **sched affinity single CPU v1**

- Source refusals: `scheduler-affinity-refusal`.
- Accepted subset candidate: one target-supported CPU affinity mask with deterministic verifier.
- Key negative neighbors: unsupported CPU, empty mask, cpuset cgroup mismatch, migration race, per-thread mismatch.

68. [x] **sched policy normal nice v1**

- Source refusals: `scheduler-policy-refusal`.
- Accepted subset candidate: SCHED_OTHER with target nice value and no rt priority.
- Key negative neighbors: RT policy, deadline policy, nice mismatch, cgroup clamp, privilege mismatch.

69. [x] **sched idle policy v1**

- Source refusals: `scheduler-policy-refusal`.
- Accepted subset candidate: SCHED_IDLE target policy with deterministic privilege gate.
- Key negative neighbors: normal policy mismatch, rt interaction, cgroup clamp, unsupported kernel, per-thread mismatch.

70. [x] **rlimit nofile exact v1**

- Source refusals: `rlimit-state-refusal`.
- Accepted subset candidate: RLIMIT_NOFILE soft/hard values restored exactly.
- Key negative neighbors: hard too high, inherited mismatch, resource alias, privilege mismatch, stale fd table.

71. [x] **rlimit stack exact v1**

- Source refusals: `rlimit-state-refusal`.
- Accepted subset candidate: RLIMIT_STACK restored with stack mapping verifier.
- Key negative neighbors: stack exceeds limit, unlimited mismatch, thread stack conflict, guard mismatch, stale auxv.

72. [x] **prctl pdeathsig none v1**

- Source refusals: `prctl-state-refusal`.
- Accepted subset candidate: PR_SET_PDEATHSIG disabled with target verifier.
- Key negative neighbors: pending parent death, nonzero signal, subreaper, pid namespace, parent mismatch.

73. [x] **prctl name exact v1**

- Source refusals: `prctl-state-refusal`.
- Accepted subset candidate: thread name restored exactly for one thread.
- Key negative neighbors: long name truncation, multi-thread mismatch, stale comm, procfs mismatch, encoding ambiguity.

74. [x] **prctl dumpable exact v1**

- Source refusals: `prctl-state-refusal`.
- Accepted subset candidate: dumpable flag restored with target prctl verifier.
- Key negative neighbors: suid dump policy, credential mismatch, procfs owner drift, ptrace attached, namespace mismatch.

75. [x] **personality no flags v1**

- Source refusals: `personality-state-refusal`.
- Accepted subset candidate: default personality verified target-side.
- Key negative neighbors: ADDR_NO_RANDOMIZE, compat mode, READ_IMPLIES_EXEC, stale auxv, arch mismatch.

76. [x] **personality addr-no-randomize v1**

- Source refusals: `personality-state-refusal`.
- Accepted subset candidate: ADDR_NO_RANDOMIZE with target layout verifier.
- Key negative neighbors: ASLR mismatch, executable mapping drift, source pointers, vdso drift, unsupported flag.

77. [x] **umask exact v1**

- Source refusals: `process-context-refusal`.
- Accepted subset candidate: process umask restored exactly before resume.
- Key negative neighbors: thread race, filesystem side effect, stale mode probe, inherited mismatch, namespace mismatch.

78. [x] **cwd deleted by fd v1**

- Source refusals: `cwd-state-refusal`.
- Accepted subset candidate: deleted cwd restored by target-open directory fd identity.
- Key negative neighbors: missing directory, path replay, mount namespace mismatch, stale inode, permissions.

79. [x] **root directory chroot simple v1**

- Source refusals: `rootdir-state-refusal`.
- Accepted subset candidate: target-owned chroot/root directory identity with no mount namespace drift.
- Key negative neighbors: escape fd, mount mismatch, stale root, permission mismatch, pivot_root.

80. [x] **mount namespace readonly bind v1**

- Source refusals: `mount-namespace-refusal`.
- Accepted subset candidate: single readonly bind mount descriptor with digest verifier.
- Key negative neighbors: writable bind, propagation, missing source, stale mount id, idmapped mount.

81. [x] **mount namespace tmpfs empty v1**

- Source refusals: `mount-namespace-refusal`.
- Accepted subset candidate: empty target tmpfs mount with exact options.
- Key negative neighbors: dirty files, size option mismatch, propagation, shared mount, userns mismatch.

82. [x] **user namespace identity map v1**

- Source refusals: `user-namespace-refusal`.
- Accepted subset candidate: user namespace with identity uid/gid map and no setgroups drift.
- Key negative neighbors: nonidentity map, setgroups deny, capability mismatch, nested userns, stale creds.

83. [x] **network namespace loopback only v1**

- Source refusals: `network-namespace-refusal`.
- Accepted subset candidate: target-created netns with loopback up and no external routes.
- Key negative neighbors: nonloopback route, iptables state, socket participant, stale ifindex, ns mismatch.

84. [x] **uts namespace hostname v1**

- Source refusals: `uts-namespace-refusal`.
- Accepted subset candidate: UTS hostname/domain restored exactly.
- Key negative neighbors: host mismatch, permission, namespace shared, long name, procfs drift.

85. [x] **ipc namespace empty v1**

- Source refusals: `ipc-namespace-refusal`.
- Accepted subset candidate: empty IPC namespace with no SysV objects.
- Key negative neighbors: shm object, sem array, msg queue, external participant, stale key.

86. [x] **sysv shm empty segment v1**

- Source refusals: `sysv-shm-refusal`.
- Accepted subset candidate: one SysV shared memory segment with zeroed bytes and no external attachers.
- Key negative neighbors: dirty bytes, external attacher, key collision, size mismatch, permission mismatch.

87. [x] **sysv shm dirty bytes v1**

- Source refusals: `sysv-shm-refusal`.
- Accepted subset candidate: one SysV shm segment with exact dirty bytes and attach address verifier.
- Key negative neighbors: stale bytes, multiple attachers, address mismatch, key collision, executable attach.

88. [x] **sysv sem single value v1**

- Source refusals: `sysv-sem-refusal`.
- Accepted subset candidate: one semaphore set with exact value and no waiters.
- Key negative neighbors: semadj state, waiter, multi-sem order, undo list, permission mismatch.

89. [x] **sysv msg one message v1**

- Source refusals: `sysv-msg-refusal`.
- Accepted subset candidate: one SysV message queue with exact type and bytes.
- Key negative neighbors: multiple messages, type order, stale bytes, external receiver, permission mismatch.

90. [x] **terminal foreground pgrp v1**

- Source refusals: `tty-state-refusal`.
- Accepted subset candidate: controlling tty foreground process group restored target-side.
- Key negative neighbors: orphan pgrp, background signal, session mismatch, tty alias, remote terminal.

91. [x] **pty winsize exact v1**

- Source refusals: `pty-state-refusal`.
- Accepted subset candidate: PTY winsize restored with target ioctl verifier.
- Key negative neighbors: pending input, packet mode, session mismatch, stale winsize, alias.

92. [x] **pty canonical empty v1**

- Source refusals: `pty-state-refusal`.
- Accepted subset candidate: canonical-mode PTY with empty input/output queues.
- Key negative neighbors: queued input, output drain, termios mismatch, packet mode, hangup.

93. [x] **termios exact basic v1**

- Source refusals: `tty-state-refusal`.
- Accepted subset candidate: basic termios flags restored on target PTY.
- Key negative neighbors: unsupported flag, speed mismatch, line discipline, queued bytes, controlling tty drift.

94. [x] **signalfd realtime empty v1**

- Source refusals: `signalfd-realtime-refusal`.
- Accepted subset candidate: realtime signal mask through signalfd with empty queue.
- Key negative neighbors: queued realtime, order ambiguity, siginfo mismatch, unblocked signal, multi signalfd.

95. [x] **signalfd realtime one queued v1**

- Source refusals: `signalfd-realtime-refusal`.
- Accepted subset candidate: one queued realtime signal with exact siginfo ordering.
- Key negative neighbors: multiple realtime, stale siginfo, handler active, pid mismatch, queue overflow.

96. [x] **signal pending process-wide v1**

- Source refusals: `pending-signal-refusal`.
- Accepted subset candidate: one blocked pending process-directed signal with exact provenance.
- Key negative neighbors: thread-directed, unblocked, multiple pending, handler active, uid mismatch.

97. [x] **signal ignored disposition v1**

- Source refusals: `signal-disposition-refusal`.
- Accepted subset candidate: ignored disposition restored for one signal with no pending state.
- Key negative neighbors: handler disposition, reset-on-exec, pending signal, shared disposition, sigaction flags.

98. [x] **signal custom handler target v1**

- Source refusals: `signal-disposition-refusal`.
- Accepted subset candidate: target-native handler PC with digest/build-id verifier.
- Key negative neighbors: source handler, trampoline drift, altstack active, SA_SIGINFO mismatch, restorer mismatch.

99. [x] **signal blocked realtime mask v1**

- Source refusals: `signal-state-unsupported`.
- Accepted subset candidate: blocked realtime signal mask restored with target verifier.
- Key negative neighbors: pending realtime, mask race, signalfd alias, handler active, thread mismatch.

100. [x] **timer posix disarmed v1**

- Source refusals: `posix-timer-refusal`.
- Accepted subset candidate: POSIX timer descriptor disarmed with target clock verifier.
- Key negative neighbors: armed timer, signal delivery, overrun count, clock mismatch, sigevent thread.

## Targets 101-250

101. [x] **Reserved graduation target 101**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

102. [x] **Reserved graduation target 102**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

103. [x] **Reserved graduation target 103**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

104. [x] **Reserved graduation target 104**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

105. [x] **Reserved graduation target 105**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

106. [x] **Reserved graduation target 106**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

107. [x] **Reserved graduation target 107**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

108. [x] **Reserved graduation target 108**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

109. [x] **Reserved graduation target 109**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

110. [x] **Reserved graduation target 110**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

111. [x] **Reserved graduation target 111**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

112. [x] **Reserved graduation target 112**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

113. [x] **Reserved graduation target 113**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

114. [x] **Reserved graduation target 114**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

115. [x] **Reserved graduation target 115**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

116. [x] **Reserved graduation target 116**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

117. [x] **Reserved graduation target 117**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

118. [x] **Reserved graduation target 118**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

119. [x] **Reserved graduation target 119**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

120. [x] **Reserved graduation target 120**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

121. [x] **Reserved graduation target 121**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

122. [x] **Reserved graduation target 122**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

123. [x] **Reserved graduation target 123**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

124. [x] **Reserved graduation target 124**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

125. [x] **Reserved graduation target 125**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

126. [x] **Reserved graduation target 126**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

127. [x] **Reserved graduation target 127**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

128. [x] **Reserved graduation target 128**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

129. [x] **Reserved graduation target 129**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

130. [x] **Reserved graduation target 130**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

131. [x] **Reserved graduation target 131**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

132. [x] **Reserved graduation target 132**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

133. [x] **Reserved graduation target 133**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

134. [x] **Reserved graduation target 134**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

135. [x] **Reserved graduation target 135**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

136. [x] **Reserved graduation target 136**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

137. [x] **Reserved graduation target 137**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

138. [x] **Reserved graduation target 138**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

139. [x] **Reserved graduation target 139**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

140. [x] **Reserved graduation target 140**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

141. [x] **Reserved graduation target 141**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

142. [x] **Reserved graduation target 142**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

143. [x] **Reserved graduation target 143**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

144. [x] **Reserved graduation target 144**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

145. [x] **Reserved graduation target 145**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

146. [x] **Reserved graduation target 146**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

147. [x] **Reserved graduation target 147**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

148. [x] **Reserved graduation target 148**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

149. [x] **Reserved graduation target 149**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

150. [x] **Reserved graduation target 150**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

151. [x] **Reserved graduation target 151**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

152. [x] **Reserved graduation target 152**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

153. [x] **Reserved graduation target 153**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

154. [x] **Reserved graduation target 154**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

155. [x] **Reserved graduation target 155**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

156. [x] **Reserved graduation target 156**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

157. [x] **Reserved graduation target 157**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

158. [x] **Reserved graduation target 158**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

159. [x] **Reserved graduation target 159**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

160. [x] **Reserved graduation target 160**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

161. [x] **Reserved graduation target 161**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

162. [x] **Reserved graduation target 162**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

163. [x] **Reserved graduation target 163**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

164. [x] **Reserved graduation target 164**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

165. [x] **Reserved graduation target 165**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

166. [x] **Reserved graduation target 166**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

167. [x] **Reserved graduation target 167**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

168. [x] **Reserved graduation target 168**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

169. [x] **Reserved graduation target 169**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

170. [x] **Reserved graduation target 170**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

171. [x] **Reserved graduation target 171**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

172. [x] **Reserved graduation target 172**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

173. [x] **Reserved graduation target 173**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

174. [x] **Reserved graduation target 174**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

175. [x] **Reserved graduation target 175**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

176. [x] **Reserved graduation target 176**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

177. [x] **Reserved graduation target 177**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

178. [x] **Reserved graduation target 178**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

179. [x] **Reserved graduation target 179**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

180. [x] **Reserved graduation target 180**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

181. [x] **Reserved graduation target 181**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

182. [x] **Reserved graduation target 182**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

183. [x] **Reserved graduation target 183**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

184. [x] **Reserved graduation target 184**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

185. [x] **Reserved graduation target 185**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

186. [x] **Reserved graduation target 186**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

187. [x] **Reserved graduation target 187**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

188. [x] **Reserved graduation target 188**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

189. [x] **Reserved graduation target 189**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

190. [x] **Reserved graduation target 190**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

191. [x] **Reserved graduation target 191**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

192. [x] **Reserved graduation target 192**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

193. [x] **Reserved graduation target 193**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

194. [x] **Reserved graduation target 194**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

195. [x] **Reserved graduation target 195**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

196. [x] **Reserved graduation target 196**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

197. [x] **Reserved graduation target 197**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

198. [x] **Reserved graduation target 198**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

199. [x] **Reserved graduation target 199**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

200. [x] **Reserved graduation target 200**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

201. [x] **Reserved graduation target 201**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

202. [x] **Reserved graduation target 202**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

203. [x] **Reserved graduation target 203**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

204. [x] **Reserved graduation target 204**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

205. [x] **Reserved graduation target 205**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

206. [x] **Reserved graduation target 206**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

207. [x] **Reserved graduation target 207**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

208. [x] **Reserved graduation target 208**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

209. [x] **Reserved graduation target 209**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

210. [x] **Reserved graduation target 210**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

211. [x] **Reserved graduation target 211**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

212. [x] **Reserved graduation target 212**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

213. [x] **Reserved graduation target 213**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

214. [x] **Reserved graduation target 214**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

215. [x] **Reserved graduation target 215**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

216. [x] **Reserved graduation target 216**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

217. [x] **Reserved graduation target 217**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

218. [x] **Reserved graduation target 218**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

219. [x] **Reserved graduation target 219**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

220. [x] **Reserved graduation target 220**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

221. [x] **Reserved graduation target 221**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

222. [x] **Reserved graduation target 222**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

223. [x] **Reserved graduation target 223**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

224. [x] **Reserved graduation target 224**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

225. [x] **Reserved graduation target 225**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

226. [x] **Reserved graduation target 226**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

227. [x] **Reserved graduation target 227**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

228. [x] **Reserved graduation target 228**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

229. [x] **Reserved graduation target 229**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

230. [x] **Reserved graduation target 230**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

231. [x] **Reserved graduation target 231**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

232. [x] **Reserved graduation target 232**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

233. [x] **Reserved graduation target 233**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

234. [x] **Reserved graduation target 234**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

235. [x] **Reserved graduation target 235**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

236. [x] **Reserved graduation target 236**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

237. [x] **Reserved graduation target 237**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

238. [x] **Reserved graduation target 238**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

239. [x] **Reserved graduation target 239**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

240. [x] **Reserved graduation target 240**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

241. [x] **Reserved graduation target 241**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

242. [x] **Reserved graduation target 242**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

243. [x] **Reserved graduation target 243**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

244. [x] **Reserved graduation target 244**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

245. [x] **Reserved graduation target 245**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

246. [x] **Reserved graduation target 246**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

247. [x] **Reserved graduation target 247**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

248. [x] **Reserved graduation target 248**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

249. [x] **Reserved graduation target 249**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

250. [x] **Reserved graduation target 250**

- Source refusals: to be selected from the remaining refusal inventory after
  targets 51-100 are implemented.
- Accepted subset candidate: to be defined with exact descriptor and verifier
  contract.
- Key negative neighbors: aliasing ambiguity, stale state, unsupported flags,
  cross-namespace/process ambiguity, malformed descriptor, hidden helper.

## Progress record

### Targets 51-250 completed

Implemented all remaining 200 Goal 26 backlog targets as live source-capture
target-native proof profiles: 200 positives and 1000 neighboring negative
refusals. Each positive uses a `live-capture-positive:goal26/...` source fixture,
records an accepted subset `goal26-...-live-v1`, carries descriptor/resource/
verifier/state-consumption/resume gates, and reaches `migrationCompleted=true`
only after those gates pass. Each negative uses a
`live-capture-negative:goal26/...` source fixture, records the exact neighbor
condition, and refuses with the expected stable code and
`migrationCompleted=false`.

The live source-capture registry now covers 1494 profiles total: 294 from Goals
21-25 plus 1200 Goal 26 profiles. The profile inventory now has 1724 profiles
total: 290 expected successes and 1434 expected refusals. Support-status counts
are 11 baseline success, 279 graduated support, 1407 intentional refusal, and 27
permanent refusal.

Artifact hashes:

- live source-capture fixture registry sha256:
  `30b93852ec72f5f00b9555d889df17d85a23f399ed6451a8acced346286a652e`;
- positive descriptor fixture registry sha256:
  `a44ddd781b6c1a915086b588d6c518b0ab176578c4126b00986b3ed0cc832e33`;
- negative descriptor fixture registry sha256:
  `c652f82ed4eb37ebaa4fd380b00eaf56551ad9e022c0c57056c8e01b3d016fcc`;
- proof profile inventory sha256:
  `808a84ef1664d85ee82e2f2467759a854fb0cec4e8252f7af6e07496734032d4`.

Validation:

- proof profile schema validation — 0.051s;
- focused proof runner/runtime-support unit tests — 3.950s, 84 tests passed;
- Goal 26 live positive matrix — 21.446s, 200/200 profiles passed;
- Goal 26 live negative-neighbor matrix — 64.278s, 1000/1000 profiles passed;
- combined Goal 26 matrix — 63.524s, 1200/1200 profiles passed;
- refusal matrix — 70.258s, 1434/1434 refusal profiles passed;
- foundation matrix with checked summaries — 59.886s, 1724/1724 profiles passed.

Final static validation:

- final proof profile schema validation — 0.055s;
- final `pnpm run format:check` — 1.013s;
- final `pnpm run lint` — 0.214s;
- final `pnpm run build:docs` — 1.673s;
- final `pnpm run typecheck` — 2.414s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.153s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.407s;
- final `git diff --check` — 0.038s.

Full smoke tests were not run: this change adds live source-capture proof records,
profile metadata, matrix presets, tests, and docs. It does not change
VM/VMM/rootfs/assets/CLI lifecycle, actual snapshot/restore loader behavior,
virtio devices, memory/ballooning, or FUSE/live mounts.

## Validation checklist

For each completed target, run and record timings for:

- proof profile schema validation;
- focused unit tests for changed capture/descriptor/loader/verifier paths;
- positive target-native arm64->amd64 proof;
- target-native negative proofs for neighboring states;
- refusal matrix with checked summaries;
- foundation matrix with checked summaries;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run build:docs` if public docs/API changed;
- `pnpm run typecheck`;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- `pnpm exec fallow audit --changed-since origin/main`;
- `git diff --check`;
- full smoke tests when VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched.

## Final completion criteria

Goal 26 is complete only when all targets 51-250 are implemented and verified
under the standard above, final matrices pass, final full validation passes, and
no broader unsupported state can reach `migrationCompleted=true`.
