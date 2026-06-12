import type { MoveDescriptor, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import { runMoveTargetDirectLoaderInVm } from "../move-rendezvous.ts";

const descriptor: MoveDescriptor = {
  formatVersion: 1,
  kind: "machinen.move.descriptor",
  rootPid: 71,
  scannedAt: "2026-06-08T00:00:00.000Z",
  nodes: [
    {
      pid: 71,
      ppid: 1,
      command: "ping",
      argv: ["ping", "google.com"],
      cwd: "/",
      exe: "/usr/bin/ping",
    },
  ],
  edges: [],
  translatedStateClasses: ["process-identity", "argv-env-cwd"],
  refusedStateClasses: [],
  target: "cross-isa-target-native-pid-translation",
  productSurface: "machinen move",
  resourcePlan: {
    kind: "machinen.move.resource-plan",
    source: "guest-procfs",
    resources: [],
    fdTableEntries: [],
    targetGuestResources: [],
    refusals: [],
    acceptedSubsets: [],
    capture: { pingState: { ntransmitted: 4, nreceived: 4, nerrors: 0, lastSequence: 4 } },
  },
};

const sleepDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 72,
  nodes: [
    {
      pid: 72,
      ppid: 1,
      command: "sleep",
      argv: ["sleep", "30"],
      cwd: "/",
      exe: "/bin/sleep",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: { sleepState: { originalMs: 30_000, elapsedMs: 7_100, remainingMs: 22_900 } },
  },
};

const tailDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 73,
  nodes: [
    {
      pid: 73,
      ppid: 1,
      command: "tail",
      argv: ["tail", "-f", "/tmp/source.log"],
      cwd: "/",
      exe: "/usr/bin/tail",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: {
      tailState: {
        path: "/tmp/source.log",
        offset: 128,
        followMode: "poll-or-inotify",
      },
    },
  },
};

const lessDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 74,
  nodes: [
    {
      pid: 74,
      ppid: 1,
      command: "less",
      argv: ["less", "+42", "/tmp/page.txt"],
      cwd: "/",
      exe: "/usr/bin/less",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: { lessState: { path: "/tmp/page.txt", line: 42, terminal: "script-pty" } },
  },
};

const viDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 75,
  nodes: [
    {
      pid: 75,
      ppid: 1,
      command: "vi",
      argv: ["vi", "+9", "/tmp/edit.txt"],
      cwd: "/",
      exe: "/usr/bin/vi",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: {
      viState: { path: "/tmp/edit.txt", line: 9, mode: "normal-read-only", terminal: "script-pty" },
    },
  },
};

const dirtyViDescriptor: MoveDescriptor = {
  ...viDescriptor,
  resourcePlan: {
    ...viDescriptor.resourcePlan!,
    capture: {
      viState: {
        path: "/tmp/edit.txt",
        line: 9,
        mode: "normal-dirty-buffer",
        terminal: "script-pty",
        dirtyText: "moved text",
        searchPattern: "needle",
      },
    },
  },
};

const readerDescriptor = moveDescriptorWithCapture(
  76,
  "cat",
  ["cat", "/tmp/cat.txt"],
  "/usr/bin/cat",
  {
    readerState: { command: "cat", path: "/tmp/cat.txt", offset: 131_072 },
  },
);

const grepDescriptor = moveDescriptorWithCapture(
  77,
  "grep",
  ["grep", "match", "/tmp/grep.txt"],
  "/usr/bin/grep",
  { grepState: { pattern: "match", path: "/tmp/grep.txt", offset: 294_912 } },
);

const watchDescriptor = moveDescriptorWithCapture(
  78,
  "watch",
  ["watch", "-n", "1", "date"],
  "/usr/bin/watch",
  { watchState: { intervalSeconds: 1, command: ["date"] } },
);

const shellDescriptor = moveDescriptorWithCapture(79, "sh", ["/bin/sh"], "/usr/bin/dash", {
  shellState: { shell: "dash", cwd: "/work", terminal: "script-pty" },
});

const httpDescriptor = moveDescriptorWithCapture(
  80,
  "python3",
  ["python3", "-m", "http.server", "8123"],
  "/usr/bin/python3.11",
  { httpState: { executable: "python3", port: 8123, cwd: "/tmp/web" } },
);

const goStaticHttpDescriptor = moveDescriptorWithCapture(
  88,
  "server",
  [
    "/tmp/go-static/server",
    "--machinen-move-envelope",
    "go-static-http-v1",
    "--port",
    "8145",
    "--health",
    "/health",
  ],
  "/tmp/go-static/server",
  {
    goStaticHttpState: {
      binaryPath: "/tmp/go-static/server",
      cwd: "/tmp/go-static",
      markerVersion: "go-static-http-v1",
      port: 8145,
      healthPath: "/health",
    },
  },
);

const rustStaticHttpDescriptor = moveDescriptorWithCapture(
  89,
  "server",
  [
    "/tmp/rust-static/server",
    "--machinen-move-envelope",
    "rust-static-http-v1",
    "--port",
    "8148",
    "--health",
    "/health",
  ],
  "/tmp/rust-static/server",
  {
    rustStaticHttpState: {
      binaryPath: "/tmp/rust-static/server",
      cwd: "/tmp/rust-static",
      markerVersion: "rust-static-http-v1",
      port: 8148,
      healthPath: "/health",
    },
  },
);

const pythonStaticRouteDescriptor = moveDescriptorWithCapture(
  87,
  "python3",
  ["python3", "/tmp/python-static/server.py"],
  "/usr/bin/python3",
  {
    pythonStaticRouteState: {
      executable: "python3",
      scriptPath: "/tmp/python-static/server.py",
      cwd: "/tmp/python-static",
      port: 8143,
      route: "/health",
      expectedBody: "python-static-ok",
    },
  },
);

const timeoutDescriptor = moveDescriptorWithCapture(
  85,
  "timeout",
  ["timeout", "30", "python3", "-m", "http.server", "--directory", "/tmp/timeout-web", "8138"],
  "/usr/bin/timeout",
  {
    timeoutState: {
      seconds: 30,
      child: "python-http-server",
      httpState: {
        executable: "python3",
        port: 8138,
        cwd: "/",
        directory: "/tmp/timeout-web",
      },
    },
  },
);

const ncDescriptor = moveDescriptorWithCapture(
  83,
  "nc",
  ["nc", "-l", "8135"],
  "/usr/bin/nc.openbsd",
  {
    ncState: {
      port: 8135,
    },
  },
);

const redisDescriptor = moveDescriptorWithCapture(
  87,
  "redis-server",
  ["redis-server", "--save", "", "--appendonly", "no", "--port", "8153"],
  "/usr/bin/redis-server",
  {
    redisIdleState: {
      port: 8153,
      argvContract: "redis-server-no-persistence-port",
      datasetState: "empty",
      clientState: "idle-no-external-clients",
      persistence: { save: "", appendonly: "no" },
      binaryPolicy: "proof-provisioned-target-native-redis",
    },
  },
);

const nginxDescriptor = moveDescriptorWithCapture(
  88,
  "nginx",
  ["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"],
  "/usr/sbin/nginx",
  {
    nginxStaticState: {
      configPath: "/tmp/nginx.conf",
      configSha256: "a".repeat(64),
      root: "/tmp/nginx-root",
      port: 8160,
      configContract: "nginx-static-root-local-listen-try-files-404",
      listenerState: "idle-single-listener",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 12,
        treeDigest: "b".repeat(64),
      },
      binaryPolicy: "proof-provisioned-target-native-nginx",
    },
  },
);

const caddyDescriptor = moveDescriptorWithCapture(
  89,
  "caddy",
  ["caddy", "file-server", "--listen", ":8165", "--root", "/tmp/caddy-root"],
  "/usr/bin/caddy",
  {
    caddyStaticState: {
      port: 8165,
      root: "/tmp/caddy-root",
      argvContract: "caddy-file-server-listen-root",
      listenerState: "idle-single-listener",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 12,
        treeDigest: "c".repeat(64),
      },
      binaryPolicy: "proof-provisioned-target-native-caddy",
    },
  },
);

const rubyDescriptor = moveDescriptorWithCapture(
  90,
  "ruby",
  ["ruby", "-run", "-e", "httpd", "/tmp/ruby-root", "-p", "8170"],
  "/usr/bin/ruby",
  {
    rubyHttpState: {
      port: 8170,
      root: "/tmp/ruby-root",
      argvContract: "ruby-run-httpd-root-port",
      listenerState: "idle-single-listener",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 12,
        treeDigest: "d".repeat(64),
      },
      binaryPolicy: "proof-provisioned-target-native-ruby",
    },
  },
);

const phpDescriptor = moveDescriptorWithCapture(
  91,
  "php",
  ["php", "-S", "127.0.0.1:8175", "-t", "/tmp/php-root"],
  "/usr/bin/php",
  {
    phpStaticState: {
      port: 8175,
      root: "/tmp/php-root",
      argvContract: "php-built-in-server-local-root",
      dynamicPolicy: "no-php-scripts",
      listenerState: "idle-single-listener",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 12,
        treeDigest: "e".repeat(64),
      },
      binaryPolicy: "proof-provisioned-target-native-php",
    },
  },
);

const rsyncDescriptor = moveDescriptorWithCapture(
  92,
  "rsync",
  ["rsync", "--daemon", "--no-detach", "--config", "/tmp/rsyncd.conf"],
  "/usr/bin/rsync",
  {
    rsyncDaemonState: {
      configPath: "/tmp/rsyncd.conf",
      configSha256: "f".repeat(64),
      moduleName: "proof",
      root: "/tmp/rsync-root",
      port: 8181,
      policy: "read-only-module-no-auth-hooks",
      listenerState: "idle-single-listener-no-active-clients",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 12,
        treeDigest: "a".repeat(64),
      },
      binaryPolicy: "proof-provisioned-target-native-rsync",
    },
  },
);

const socatDescriptor = moveDescriptorWithCapture(
  86,
  "socat",
  ["socat", "TCP-LISTEN:8147,fork,reuseaddr", "FILE:/tmp/socat-response.txt"],
  "/usr/bin/socat",
  {
    socatFileResponderState: {
      port: 8147,
      filePath: "/tmp/socat-response.txt",
      fileIdentity: {
        size: 18,
        sha256: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      argvContract: "socat-tcp-listen-fork-reuseaddr-file",
      listenerState: "idle-single-listener",
      binaryPolicy: "proof-provisioned-target-native-socat",
    },
  },
);

const busyboxNcDescriptor = moveDescriptorWithCapture(
  85,
  "busybox",
  ["busybox", "nc", "-l", "-p", "8142"],
  "/usr/bin/busybox",
  {
    busyboxNcState: {
      port: 8142,
      argvContract: "busybox-nc-listen-p",
      listenerState: "idle-single-listener",
    },
  },
);

const busyboxHttpDescriptor = moveDescriptorWithCapture(
  82,
  "busybox",
  ["busybox", "httpd", "-f", "-p", "8134", "-h", "/tmp/busybox-web"],
  "/usr/bin/busybox",
  {
    busyboxHttpState: {
      port: 8134,
      root: "/tmp/busybox-web",
    },
  },
);

const envHttpDirectoryDescriptor = moveDescriptorWithCapture(
  84,
  "python3",
  ["python3", "-m", "http.server", "--directory", "/tmp/env-web", "8137"],
  "/usr/bin/python3.11",
  {
    httpState: {
      executable: "python3",
      port: 8137,
      cwd: "/",
      directory: "/tmp/env-web",
    },
    envState: {
      key: "MACHINEN_MOVE_ENV_PROOF",
      value: "wrapped-http",
      child: "python-http-server",
    },
  },
);

const httpDirectoryDescriptor = moveDescriptorWithCapture(
  81,
  "python3",
  ["python3", "-m", "http.server", "--directory", "/tmp/web-directory", "8128"],
  "/usr/bin/python3.11",
  {
    httpState: {
      executable: "python3",
      port: 8128,
      cwd: "/",
      directory: "/tmp/web-directory",
      bindAddress: "127.0.0.1",
      mode: "explicit-bind-directory",
      listenerState: "idle-single-listener",
      directoryIdentity: {
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 21,
        treeDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
    },
  },
);

const commDescriptor = moveDescriptorWithCapture(
  100,
  "comm",
  ["comm", "/tmp/comm.left", "/tmp/comm.right"],
  "/usr/bin/comm",
  {
    commState: {
      leftPath: "/tmp/comm.left",
      rightPath: "/tmp/comm.right",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      rightIdentity: {
        size: 12,
        sha256: "d6950de392580783e7773dcef61702e51720cf7d4f882a60f4994251bfaff2db",
      },
      collation: "C",
      outputPath: "/tmp/comm.out",
    },
  },
);

const joinDescriptor = moveDescriptorWithCapture(
  99,
  "join",
  ["join", "/tmp/join.left", "/tmp/join.right"],
  "/usr/bin/join",
  {
    joinState: {
      leftPath: "/tmp/join.left",
      rightPath: "/tmp/join.right",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      rightIdentity: {
        size: 12,
        sha256: "d6950de392580783e7773dcef61702e51720cf7d4f882a60f4994251bfaff2db",
      },
      key: "default-first-field",
      collation: "C",
      outputPath: "/tmp/join.out",
    },
  },
);

const pasteDescriptor = moveDescriptorWithCapture(
  98,
  "paste",
  ["paste", "/tmp/paste.left", "/tmp/paste.right"],
  "/usr/bin/paste",
  {
    pasteState: {
      leftPath: "/tmp/paste.left",
      rightPath: "/tmp/paste.right",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      rightIdentity: {
        size: 12,
        sha256: "d6950de392580783e7773dcef61702e51720cf7d4f882a60f4994251bfaff2db",
      },
      outputPath: "/tmp/paste.out",
    },
  },
);

const uniqDescriptor = moveDescriptorWithCapture(
  97,
  "uniq",
  ["uniq", "-c", "/tmp/uniq.in"],
  "/usr/bin/uniq",
  {
    uniqState: {
      path: "/tmp/uniq.in",
      count: true,
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/uniq.out",
    },
  },
);

const awkFieldDescriptor = moveDescriptorWithCapture(
  96,
  "awk",
  ["awk", "{print $2}", "/tmp/awk-field.in"],
  "/usr/bin/awk",
  {
    awkFieldState: {
      path: "/tmp/awk-field.in",
      fieldIndex: 2,
      fs: "default-whitespace",
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/awk-field.out",
    },
  },
);

const cutDescriptor = moveDescriptorWithCapture(
  95,
  "cut",
  ["cut", "-d", ":", "-f", "2", "/tmp/cut.in"],
  "/usr/bin/cut",
  {
    cutState: {
      path: "/tmp/cut.in",
      delimiter: ":",
      fields: "2",
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/cut.out",
    },
  },
);

const sedPrintRangeDescriptor = moveDescriptorWithCapture(
  94,
  "sed",
  ["sed", "-n", "2,4p", "/tmp/sed-range.in"],
  "/usr/bin/sed",
  {
    sedState: {
      path: "/tmp/sed-range.in",
      scriptKind: "print-range",
      startLine: 2,
      endLine: 4,
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/sed-range.out",
    },
  },
);

const sedLiteralSubstitutionDescriptor = moveDescriptorWithCapture(
  93,
  "sed",
  ["sed", "s/alpha/omega/", "/tmp/sed-sub.in"],
  "/usr/bin/sed",
  {
    sedState: {
      path: "/tmp/sed-sub.in",
      scriptKind: "literal-substitution",
      pattern: "alpha",
      replacement: "omega",
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/sed-sub.out",
    },
  },
);

const headDescriptor = moveDescriptorWithCapture(
  92,
  "head",
  ["head", "-n", "3", "/tmp/head.in"],
  "/usr/bin/head",
  {
    headState: {
      path: "/tmp/head.in",
      lines: 3,
      fileIdentity: {
        size: 24,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/head.out",
    },
  },
);

const tailLinesDescriptor = moveDescriptorWithCapture(
  91,
  "tail",
  ["tail", "-n", "2", "/tmp/tail-lines.in"],
  "/usr/bin/tail",
  {
    tailLinesState: {
      path: "/tmp/tail-lines.in",
      lines: 2,
      fileIdentity: {
        size: 30,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/tail-lines.out",
    },
  },
);

const base64Descriptor = moveDescriptorWithCapture(
  103,
  "base64",
  ["base64", "/tmp/base64.in"],
  "/usr/bin/base64",
  {
    base64State: {
      path: "/tmp/base64.in",
      wrap: 76,
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/base64.out",
    },
  },
);

const gzipDescriptor = moveDescriptorWithCapture(
  102,
  "gzip",
  ["gzip", "-c", "/tmp/gzip.in"],
  "/usr/bin/gzip",
  {
    gzipState: {
      inputPath: "/tmp/gzip.in",
      outputPath: "/tmp/gzip.out",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPolicy: "atomic-temp-rename",
    },
  },
);

const gunzipDescriptor = moveDescriptorWithCapture(
  104,
  "gunzip",
  ["gunzip", "-c", "/tmp/gunzip.in.gz"],
  "/usr/bin/gunzip",
  {
    gunzipState: {
      inputPath: "/tmp/gunzip.in.gz",
      outputPath: "/tmp/gunzip.out",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPolicy: "atomic-temp-rename",
    },
  },
);

const xzDescriptor = moveDescriptorWithCapture(
  105,
  "xz",
  ["xz", "-c", "/tmp/xz.in"],
  "/usr/bin/xz",
  {
    xzState: {
      inputPath: "/tmp/xz.in",
      outputPath: "/tmp/xz.out",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPolicy: "atomic-temp-rename",
    },
  },
);

const zstdDescriptor = moveDescriptorWithCapture(
  106,
  "zstd",
  ["zstd", "-c", "/tmp/zstd.in"],
  "/usr/bin/zstd",
  {
    zstdState: {
      inputPath: "/tmp/zstd.in",
      outputPath: "/tmp/zstd.out",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPolicy: "atomic-temp-rename",
    },
  },
);

const checksumDescriptor = moveDescriptorWithCapture(
  101,
  "md5sum",
  ["md5sum", "/tmp/md5.in"],
  "/usr/bin/md5sum",
  {
    checksumState: {
      algorithm: "md5",
      path: "/tmp/md5.in",
      expectedDigest: "900150983cd24fb0d6963f7d28e17f72",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/md5.out",
    },
  },
);

const sha256Descriptor = moveDescriptorWithCapture(
  90,
  "sha256sum",
  ["sha256sum", "/tmp/sha256.in"],
  "/usr/bin/sha256sum",
  {
    sha256State: {
      path: "/tmp/sha256.in",
      expectedDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      outputPath: "/tmp/sha256.out",
    },
  },
);

const wcDescriptor = moveDescriptorWithCapture(
  89,
  "wc",
  ["wc", "-l", "/tmp/wc.in"],
  "/usr/bin/wc",
  {
    wcState: {
      path: "/tmp/wc.in",
      mode: "lines",
      outputPath: "/tmp/wc.out",
    },
  },
);

const sortDescriptor = moveDescriptorWithCapture(
  88,
  "sort",
  ["sort", "/tmp/sort.in"],
  "/usr/bin/sort",
  {
    sortState: {
      path: "/tmp/sort.in",
      outputPath: "/tmp/sort.out",
    },
  },
);

const mvDescriptor = moveDescriptorWithCapture(
  87,
  "mv",
  ["mv", "/tmp/mv.in", "/tmp/mv.out"],
  "/usr/bin/mv",
  {
    mvState: {
      sourcePath: "/tmp/mv.in",
      destinationPath: "/tmp/mv.out",
    },
  },
);

const cpDescriptor = moveDescriptorWithCapture(
  86,
  "cp",
  ["cp", "/tmp/cp.in", "/tmp/cp.out"],
  "/usr/bin/cp",
  {
    cpState: {
      sourcePath: "/tmp/cp.in",
      destinationPath: "/tmp/cp.out",
      sourceOffset: 8192,
      destinationOffset: 4096,
    },
  },
);

const nodeStaticDescriptor = moveDescriptorWithCapture(
  85,
  "node",
  ["node", "/tmp/node-static/server.mjs"],
  "/usr/bin/node",
  {
    nodeStaticHttpState: {
      scriptPath: "/tmp/node-static/server.mjs",
      cwd: "/tmp/node-static",
      port: 8130,
      healthPath: "/health",
    },
  },
);

const nodeStaticArgvDescriptor = moveDescriptorWithCapture(
  86,
  "node",
  [
    "node",
    "/tmp/node-argv-static/server.mjs",
    "--port",
    "8140",
    "--root",
    "/tmp/node-argv-static/public",
  ],
  "/usr/bin/node",
  {
    nodeStaticHttpState: {
      scriptPath: "/tmp/node-argv-static/server.mjs",
      cwd: "/tmp/node-argv-static",
      port: 8140,
      healthPath: "/health",
      rootDir: "/tmp/node-argv-static/public",
      argvContract: "--port-root-static-http-v1",
    },
  },
);

const tarDescriptor = moveDescriptorWithCapture(
  84,
  "tar",
  ["tar", "-cf", "/tmp/archive.tar", "/tmp/tar-tree"],
  "/usr/bin/tar",
  {
    tarState: {
      archivePath: "/tmp/archive.tar",
      sourceDir: "/tmp/tar-tree",
    },
  },
);

const tarExtractDescriptor = moveDescriptorWithCapture(
  85,
  "tar",
  ["tar", "-xf", "/tmp/archive.tar", "-C", "/tmp/extract"],
  "/usr/bin/tar",
  {
    tarExtractState: {
      archivePath: "/tmp/archive.tar",
      targetDir: "/tmp/extract",
      archiveIdentity: {
        size: 123,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      entryCount: 3,
      policy: "safe-relative-regular-empty-target",
    },
  },
);

const zipCreateDescriptor = moveDescriptorWithCapture(
  86,
  "zip",
  ["zip", "-r", "/tmp/archive.zip", "/tmp/zip-tree"],
  "/usr/bin/zip",
  {
    zipCreateState: {
      archivePath: "/tmp/archive.zip",
      sourceDir: "/tmp/zip-tree",
      sourceIdentity: {
        fileCount: 2,
        treeDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "safe-relative-regular-no-symlinks-absent-archive",
    },
  },
);

const mkdirDescriptor = moveDescriptorWithCapture(
  87,
  "mkdir",
  ["mkdir", "/tmp/mkdir-parent/newdir"],
  "/usr/bin/mkdir",
  {
    mkdirState: {
      targetPath: "/tmp/mkdir-parent/newdir",
      parentPath: "/tmp/mkdir-parent",
      parentIdentity: {
        mode: "41ed",
        entriesDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "absent-child-existing-parent",
    },
  },
);

const mkdirParentsDescriptor = moveDescriptorWithCapture(
  88,
  "mkdir",
  ["mkdir", "-p", "/tmp/mkdirp-root/nested/leaf"],
  "/usr/bin/mkdir",
  {
    mkdirParentsState: {
      targetPath: "/tmp/mkdirp-root/nested/leaf",
      existingPrefix: "/tmp/mkdirp-root",
      missingComponents: ["nested", "leaf"],
      prefixIdentity: {
        mode: "41ed",
        entriesDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "symlink-free-path-idempotent-or-create-missing",
    },
  },
);

const touchDescriptor = moveDescriptorWithCapture(
  89,
  "touch",
  ["touch", "-t", "202606101234.56", "/tmp/touch-parent/new-file"],
  "/usr/bin/touch",
  {
    touchState: {
      path: "/tmp/touch-parent/new-file",
      parentPath: "/tmp/touch-parent",
      timestampSpec: "202606101234.56",
      expectedEpoch: 1781094896,
      parentIdentity: {
        mode: "41ed",
        entriesDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "deterministic-timestamp-absent-file-create",
    },
  },
);

const chmodDescriptor = moveDescriptorWithCapture(
  90,
  "chmod",
  ["chmod", "600", "/tmp/chmod-target.txt"],
  "/usr/bin/chmod",
  {
    chmodState: {
      path: "/tmp/chmod-target.txt",
      expectedMode: "644",
      targetMode: "600",
      fileIdentity: {
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "numeric-mode-regular-non-symlink",
    },
  },
);

const chownDescriptor = moveDescriptorWithCapture(
  91,
  "chown",
  ["chown", "nobody:nogroup", "/tmp/chown-target.txt"],
  "/usr/bin/chown",
  {
    chownState: {
      path: "/tmp/chown-target.txt",
      owner: "nobody",
      group: "nogroup",
      targetUid: 65534,
      targetGid: 65534,
      expectedUid: 0,
      expectedGid: 0,
      fileIdentity: {
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "same-base-uid-gid-regular-non-symlink",
    },
  },
);

const linkDescriptor = moveDescriptorWithCapture(
  92,
  "ln",
  ["ln", "/tmp/link-source.txt", "/tmp/link-dest.txt"],
  "/usr/bin/ln",
  {
    linkState: {
      sourcePath: "/tmp/link-source.txt",
      destinationPath: "/tmp/link-dest.txt",
      sourceIdentity: {
        dev: "123",
        inode: "456",
        mode: "81a4",
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      destinationParent: "/tmp",
      destinationParentIdentity: {
        dev: "123",
        mode: "41ed",
        entriesDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      policy: "hardlink-regular-source-absent-destination-same-filesystem",
    },
  },
);

const symlinkDescriptor = moveDescriptorWithCapture(
  93,
  "ln",
  ["ln", "-s", "/tmp/symlink-target.txt", "/tmp/symlink-parent/link.txt"],
  "/usr/bin/ln",
  {
    symlinkState: {
      targetLiteral: "/tmp/symlink-target.txt",
      linkPath: "/tmp/symlink-parent/link.txt",
      parentPath: "/tmp/symlink-parent",
      parentIdentity: {
        dev: "123",
        mode: "41ed",
        entriesDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "literal-target-absent-link-safe-parent",
    },
  },
);

const rmDescriptor = moveDescriptorWithCapture(
  94,
  "rm",
  ["rm", "/tmp/rm-parent/victim.txt"],
  "/usr/bin/rm",
  {
    rmState: {
      path: "/tmp/rm-parent/victim.txt",
      parentPath: "/tmp/rm-parent",
      fileIdentity: {
        mode: "81a4",
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      parentIdentity: {
        dev: "123",
        mode: "41ed",
        entriesDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      policy: "regular-non-symlink-pre-unlink",
    },
  },
);

const rmdirDescriptor = moveDescriptorWithCapture(
  95,
  "rmdir",
  ["rmdir", "/tmp/rmdir-parent/empty"],
  "/usr/bin/rmdir",
  {
    rmdirState: {
      path: "/tmp/rmdir-parent/empty",
      parentPath: "/tmp/rmdir-parent",
      directoryIdentity: { dev: "123", inode: "456", mode: "41ed" },
      parentIdentity: {
        dev: "123",
        mode: "41ed",
        entriesDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      policy: "empty-directory-non-symlink-pre-remove",
    },
  },
);

const installDescriptor = moveDescriptorWithCapture(
  96,
  "install",
  ["install", "-m", "755", "/tmp/install-src.txt", "/tmp/install-parent/dest.txt"],
  "/usr/bin/install",
  {
    installState: {
      sourcePath: "/tmp/install-src.txt",
      destinationPath: "/tmp/install-parent/dest.txt",
      mode: "755",
      sourceIdentity: {
        mode: "81a4",
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      destinationParent: "/tmp/install-parent",
      destinationParentIdentity: {
        dev: "123",
        mode: "41ed",
        entriesDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      policy: "copy-mode-absent-destination",
    },
  },
);

const lsDescriptor = moveDescriptorWithCapture(97, "ls", ["ls", "/tmp/ls-dir"], "/usr/bin/ls", {
  lsState: {
    directoryPath: "/tmp/ls-dir",
    directoryIdentity: {
      dev: "65024",
      inode: "9001",
      mode: "41ed",
      entryCount: 3,
      entriesDigest: "09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e",
      outputDigest: "4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe",
    },
    ordering: "LC_ALL=C-name-ascending",
    options: ["-1"],
    outputPath: "/tmp/ls.out",
    policy: "ascii-names-non-recursive-directory-listing",
  },
});

const treeDescriptor = moveDescriptorWithCapture(
  106,
  "tree",
  ["tree", "/tmp/tree-proof-root"],
  "/usr/bin/tree",
  {
    treeState: {
      rootPath: "/tmp/tree-proof-root",
      options: [],
      treeIdentity: {
        fileCount: 2,
        directoryCount: 2,
        totalBytes: 42,
        treeDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
        outputDigest: "24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658",
      },
      symlinkPolicy: "no-symlinks",
      binaryPolicy: "proof-provisioned-target-native-tree",
      outputPath: "/tmp/tree.out",
    },
  },
);

const findPredicateDescriptor = moveDescriptorWithCapture(
  105,
  "find",
  ["find", "/tmp/find-predicate-tree", "-size", "+4c", "-type", "f", "-print"],
  "/usr/bin/find",
  {
    findPredicateState: {
      rootPath: "/tmp/find-predicate-tree",
      predicate: { kind: "size", value: "+4c" },
      treeIdentity: {
        fileCount: 2,
        directoryCount: 2,
        totalBytes: 42,
        treeDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
        outputDigest: "24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658",
      },
      options: ["predicate", "-type", "-print"],
      symlinkPolicy: "no-symlinks",
      policy: "bounded-simple-find-predicate",
      outputPath: "/tmp/find-pred.out",
    },
  },
);

const maxdepthFindDescriptor = moveDescriptorWithCapture(
  104,
  "find",
  ["find", "/tmp/find-tree", "-maxdepth", "2", "-type", "f", "-print"],
  "/usr/bin/find",
  {
    maxdepthFindState: {
      rootPath: "/tmp/find-tree",
      maxdepth: 2,
      treeIdentity: {
        fileCount: 2,
        directoryCount: 2,
        totalBytes: 42,
        treeDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
        outputDigest: "24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658",
      },
      options: ["-maxdepth", "-type", "-print"],
      symlinkPolicy: "no-symlinks",
      outputPath: "/tmp/find-max.out",
    },
  },
);

const recursiveGrepDescriptor = moveDescriptorWithCapture(
  103,
  "grep",
  ["grep", "-r", "needle", "/tmp/grep-tree"],
  "/usr/bin/grep",
  {
    recursiveGrepState: {
      rootPath: "/tmp/grep-tree",
      pattern: "needle",
      patternPolicy: "literal-safe-basic-regexp",
      treeIdentity: {
        fileCount: 2,
        directoryCount: 2,
        totalBytes: 42,
        treeDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
        outputDigest: "24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658",
      },
      options: ["-r"],
      binaryPolicy: "text-files-only",
      symlinkPolicy: "no-symlinks",
      outputPath: "/tmp/grep-r.out",
    },
  },
);

const realpathDescriptor = moveDescriptorWithCapture(
  102,
  "realpath",
  ["realpath", "/tmp/realpath-link"],
  "/usr/bin/realpath",
  {
    realpathState: {
      cwd: "/work",
      inputPath: "/tmp/realpath-link",
      resolvedPath: "/tmp/realpath-dir/target.txt",
      chainIdentity: {
        componentCount: 4,
        symlinkCount: 1,
        chainDigest: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      outputDigest: "24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658",
      options: [],
      policy: "absolute-existing-path-safe-chain",
      outputPath: "/tmp/realpath.out",
    },
  },
);

const readlinkDescriptor = moveDescriptorWithCapture(
  101,
  "readlink",
  ["readlink", "/tmp/readlink-link"],
  "/usr/bin/readlink",
  {
    readlinkState: {
      linkPath: "/tmp/readlink-link",
      targetLiteral: "target.txt",
      linkIdentity: {
        mode: "a1ff",
        targetDigest: "199b3badd968634ea14e351d1134ada738894a90a2efa66983101ece99a33572",
      },
      options: [],
      policy: "direct-symlink-literal-target",
      outputPath: "/tmp/readlink.out",
    },
  },
);

const statDescriptor = moveDescriptorWithCapture(
  100,
  "stat",
  ["stat", "/tmp/stat-file.txt"],
  "/usr/bin/stat",
  {
    statState: {
      path: "/tmp/stat-file.txt",
      format: "default",
      options: [],
      fileIdentity: {
        fileType: "regular file",
        mode: "81a4",
        permissions: "644",
        size: 12,
        uid: 0,
        gid: 0,
        mtimeEpoch: 1770000000,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/stat.out",
      symlinkPolicy: "no-symlinks",
    },
  },
);

const duDescriptor = moveDescriptorWithCapture(
  99,
  "du",
  ["du", "-sb", "/tmp/du-tree"],
  "/usr/bin/du",
  {
    duState: {
      directoryPath: "/tmp/du-tree",
      rootDevice: "65024",
      treeIdentity: {
        entryCount: 4,
        fileCount: 2,
        directoryCount: 2,
        totalBytes: 8266,
        treeDigest: "09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e",
        outputDigest: "4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe",
      },
      options: ["-s", "-b"],
      symlinkPolicy: "no-symlinks",
      mountPolicy: "single-device-no-mount-crossing",
      outputPath: "/tmp/du.out",
    },
  },
);

const lsLongDescriptor = moveDescriptorWithCapture(
  98,
  "ls",
  ["ls", "-l", "/tmp/ls-dir"],
  "/usr/bin/ls",
  {
    lsLongState: {
      directoryPath: "/tmp/ls-dir",
      directoryIdentity: {
        dev: "65024",
        inode: "9001",
        mode: "41ed",
        entryCount: 2,
        entriesDigest: "09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e",
        outputDigest: "4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe",
      },
      entries: [
        {
          name: "alpha.txt",
          kind: "file",
          mode: "81a4",
          permissions: "644",
          size: 5,
          uid: 0,
          gid: 0,
          owner: "root",
          group: "root",
          mtimeEpoch: 1770000000,
        },
        {
          name: "subdir",
          kind: "directory",
          mode: "41ed",
          permissions: "755",
          size: 40,
          uid: 0,
          gid: 0,
          owner: "root",
          group: "root",
          mtimeEpoch: 1770000001,
        },
      ],
      ordering: "LC_ALL=C-name-ascending",
      statPolicy: "regular-or-directory-no-symlinks-owner-group-mapped",
      options: ["-l"],
      outputPath: "/tmp/ls-long.out",
      policy: "ascii-names-non-recursive-long-listing",
    },
  },
);

const findDescriptor = moveDescriptorWithCapture(
  83,
  "find",
  ["find", "/tmp/tree", "-type", "f", "-print"],
  "/usr/bin/find",
  {
    findState: {
      rootPath: "/tmp/tree",
      outputPath: "/tmp/find.out",
      lastPath: "/tmp/tree/file-010",
    },
  },
);

const ddDescriptor = moveDescriptorWithCapture(
  82,
  "dd",
  ["dd", "if=/tmp/dd.in", "of=/tmp/dd.out", "bs=1"],
  "/usr/bin/dd",
  {
    ddState: {
      inputPath: "/tmp/dd.in",
      outputPath: "/tmp/dd.out",
      blockSize: 1,
      inputOffset: 4096,
      outputOffset: 4096,
    },
  },
);

const tailGrepPipelineDescriptor = moveDescriptorWithCapture(
  81,
  "sh",
  ["sh", "-c", "tail -f /tmp/pipeline.txt | grep --line-buffered match"],
  "/usr/bin/dash",
  {
    tailGrepPipelineState: {
      tailPath: "/tmp/pipeline.txt",
      offset: 35,
      pattern: "match",
      lineBuffered: true,
    },
  },
);

describe("move target direct loader", () => {
  it("launches the generic resource graph loader only after preflight gates pass", async () => {
    const commands: string[] = [];
    const loader = await runMoveTargetDirectLoaderInVm(
      mockVm(
        commands,
        "LOAD_PID\t4243\nLOAD_LOG\t/tmp/generic.log\nSAFE_BOUNDARY\tgeneric-resource-graph\ttarget-native-reexec-started\nPATCH\tgeneric-resource-graph\tready\t4243\n",
      ),
      moveDescriptorWithCapture(
        4242,
        "unknown-daemon",
        ["unknown-daemon", "--serve"],
        "/usr/bin/unknown-daemon",
        {
          genericResourceGraphState: {
            policy: "generic-resource-graph-target-native-reexec-v1",
            executableIdentity: { path: "/usr/bin/unknown-daemon", sha256: "a".repeat(64) },
            argv: ["unknown-daemon", "--serve"],
            env: { policy: "target-default" },
            cwd: { path: "/srv/app" },
            root: { path: "/" },
            ports: [
              {
                protocol: "tcp",
                port: 8080,
                bindAddress: "127.0.0.1",
                state: "idle-loopback-listener",
                noActiveClients: true,
              },
            ],
            regularFiles: [
              {
                path: "/srv/app/config.json",
                access: "read-only",
                identity: {
                  dev: 2049,
                  inode: 9001,
                  size: 12,
                  mtimeEpochSeconds: 1780000000,
                  sha256: "b".repeat(64),
                },
              },
            ],
            dataDirs: [
              {
                path: "/srv/app",
                access: "write-validated",
                identity: {
                  fileCount: 1,
                  directoryCount: 1,
                  totalBytes: 12,
                  treeDigest: "c".repeat(64),
                },
              },
            ],
            fileOffsets: [],
            stdioPolicy: "stdio-dev-null-or-closed",
            healthProbe: { kind: "tcp-connect", host: "127.0.0.1", port: 8080 },
            resourceClasses: [],
            refusalClasses: [],
          },
        },
      ),
    );

    expect(commands[0]).toContain("test -x '/usr/bin/unknown-daemon'");
    expect(commands[0]).toContain("sha256sum '/usr/bin/unknown-daemon'");
    expect(commands[0]).toContain("test -d '/srv/app'");
    expect(commands[0]).toContain("stat -c %s '/srv/app/config.json'");
    expect(commands[0]).toContain("data-dir-identity-mismatch");
    expect(commands[0]).toContain("python3 - '127.0.0.1' '8080'");
    expect(commands[0].indexOf("fail() {")).toBeLessThan(
      commands[0].indexOf("unknown-daemon' '--serve'"),
    );
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-generic-resource-graph-reexec-loader",
      targetPid: 4243,
      logPath: "/tmp/generic.log",
    });
  });

  it("keeps wave-1 bespoke envelope loaders higher priority than generic-equivalent state by default", async () => {
    const cases = [
      {
        name: "python-http",
        descriptor: httpDescriptor,
        stdout:
          "LOAD_PID\t805\nLOAD_LOG\t/tmp/http.log\nPATCH\tpython-http-server\tready\t/tmp/web\t8123\n",
        strategy: "target-original-python-http-server-loader",
      },
      {
        name: "python-http-directory",
        descriptor: httpDirectoryDescriptor,
        stdout:
          "LOAD_PID\t806\nLOAD_LOG\t/tmp/http-directory.log\nPATCH\tpython-http-server\tready\t/\t8128\t/tmp/web-directory\n",
        strategy: "target-original-python-http-server-loader",
      },
      {
        name: "nc-listener",
        descriptor: ncDescriptor,
        stdout: "LOAD_PID\t808\nLOAD_LOG\t/tmp/nc.log\nPATCH\tnc-listener\tready\t8135\n",
        strategy: "target-original-nc-listener-loader",
      },
      {
        name: "reader-cat",
        descriptor: readerDescriptor,
        stdout:
          "LOAD_PID\t801\nLOAD_LOG\t/tmp/cat.log\nPATCH\treader-offset\tready\t/tmp/cat.txt\t131072\n",
        strategy: "target-original-cat-offset-loader",
      },
      {
        name: "grep",
        descriptor: grepDescriptor,
        stdout:
          "LOAD_PID\t802\nLOAD_LOG\t/tmp/grep.log\nPATCH\tgrep-offset\tready\t/tmp/grep.txt\t294912\n",
        strategy: "target-original-grep-offset-loader",
      },
      {
        name: "tail",
        descriptor: tailDescriptor,
        stdout: [
          "LOAD_PID\t777",
          "LOAD_LOG\t/tmp/machinen-move-loader.log",
          "SAFE_BOUNDARY\tsleep-timer\ttarget-tail-follow-started",
          "PATCH\ttail-offset\tready\t/tmp/source.log\t128",
        ].join("\n"),
        strategy: "target-original-tail-offset-loader",
      },
    ];

    await Promise.all(
      cases.map(async (item) => {
        const commands: string[] = [];
        const loader = await runMoveTargetDirectLoaderInVm(
          mockVm(commands, item.stdout),
          withGenericEquivalentState(item.descriptor),
        );

        expect(loader.strategy, item.name).toBe(item.strategy);
        expect(loader.strategy, item.name).not.toBe(
          "target-native-generic-resource-graph-reexec-loader",
        );
        expect(commands[0], item.name).not.toContain("generic-resource-graph");
      }),
    );
  });

  it("uses generic-primary migration loader only for explicit proven candidate states", async () => {
    const cases = [
      { name: "python-http-directory", descriptor: httpDirectoryDescriptor },
      { name: "nc-listener", descriptor: ncDescriptor },
    ];

    await Promise.all(
      cases.map(async (item) => {
        const commands: string[] = [];
        const loader = await runMoveTargetDirectLoaderInVm(
          mockVm(
            commands,
            "LOAD_PID\t909\nLOAD_LOG\t/tmp/generic-primary.log\nSAFE_BOUNDARY\tgeneric-resource-graph\ttarget-native-reexec-started\nPATCH\tgeneric-resource-graph\tready\t909\n",
          ),
          withGenericPrimaryState(item.descriptor, item.name),
        );

        expect(loader.strategy, item.name).toBe(
          "target-native-generic-resource-graph-reexec-loader",
        );
        expect(commands[0], item.name).toContain("generic-resource-graph");
      }),
    );
  });

  it("refuses generic load with no target pid when health probe fails", async () => {
    const commands: string[] = [];
    const loader = await runMoveTargetDirectLoaderInVm(
      mockVm(commands, "PATCH\tgeneric-resource-graph\trefused\thealth-tcp-connect-failed\n"),
      moveDescriptorWithCapture(
        4244,
        "unknown-daemon",
        ["unknown-daemon"],
        "/usr/bin/unknown-daemon",
        {
          genericResourceGraphState: {
            policy: "generic-resource-graph-target-native-reexec-v1",
            executableIdentity: { path: "/usr/bin/unknown-daemon" },
            argv: ["unknown-daemon"],
            env: { policy: "target-default" },
            cwd: { path: "/" },
            root: { path: "/" },
            ports: [],
            regularFiles: [],
            dataDirs: [],
            fileOffsets: [],
            stdioPolicy: "stdio-dev-null-or-closed",
            healthProbe: { kind: "tcp-connect", host: "127.0.0.1", port: 8080 },
            resourceClasses: [],
            refusalClasses: [],
          },
        },
      ),
    );

    expect(commands[0]).toContain("probe_fail health-tcp-connect-failed");
    expect(commands[0].indexOf("health-tcp-connect-failed")).toBeLessThan(
      commands[0].indexOf("LOAD_PID"),
    );
    expect(loader).toMatchObject({
      state: "refused",
      strategy: "target-native-generic-resource-graph-reexec-loader",
      targetPid: undefined,
    });
    expect(loader.refusals[0]?.detail).toMatchObject({ reason: "health-tcp-connect-failed" });
  });

  it("launches original target sleep with only the remaining duration", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t654",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-sleep-started",
        "PATCH\tsleep-remaining\tready\t23",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sleepDescriptor);

    expect(commands[0]).toContain("'/bin/sleep' '23'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sleep-remaining-loader",
      executable: "/bin/sleep",
      argv: ["/bin/sleep", "23"],
      targetPid: 654,
      refusals: [],
    });
  });

  it("launches original target tail from the captured file offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t777",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-tail-follow-started",
        "PATCH\ttail-offset\tready\t/tmp/source.log\t128",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tailDescriptor);

    expect(commands[0]).toContain("'/usr/bin/tail' -c '+129' -f -- '/tmp/source.log'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tail-offset-loader",
      executable: "/usr/bin/tail",
      argv: ["/usr/bin/tail", "-c", "+129", "-f", "/tmp/source.log"],
      targetPid: 777,
      refusals: [],
    });
  });

  it("launches original target less under a script PTY at the captured line", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t778",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-less-script-pty-started",
        "PATCH\tless-script-pty\tready\t/tmp/page.txt\t42\t779",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, lessDescriptor);

    expect(commands[0]).toContain("/usr/bin/less");
    expect(commands[0]).toContain("+42 --");
    expect(commands[0]).toContain("/tmp/page.txt");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-less-script-pty-loader",
      executable: "/usr/bin/less",
      argv: ["/usr/bin/less", "+42", "/tmp/page.txt"],
      targetPid: 778,
      refusals: [],
    });
  });

  it("launches original target vi under a script PTY at the captured line", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t780",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-vi-script-pty-started",
        "PATCH\tvi-script-pty\tready\t/tmp/edit.txt\t9\t781",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, viDescriptor);

    expect(commands[0]).toContain("/usr/bin/vi");
    expect(commands[0]).toContain("+9 --");
    expect(commands[0]).toContain("/tmp/edit.txt");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-vi-readonly-script-pty-loader",
      executable: "/usr/bin/vi",
      argv: ["/usr/bin/vi", "+9", "/tmp/edit.txt"],
      targetPid: 780,
      refusals: [],
    });
  });

  it("launches original target vi with captured dirty text and search state", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t782",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-vi-script-pty-started",
        "PATCH\tvi-script-pty\tready\t/tmp/edit.txt\t9\t783",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, dirtyViDescriptor);

    expect(commands[0]).toContain("+/needle");
    expect(commands[0]).toContain("+normal! Go");
    expect(commands[0]).toContain("moved text");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-vi-readonly-script-pty-loader",
      executable: "/usr/bin/vi",
      targetPid: 782,
      refusals: [],
    });
  });

  it("launches original target cat from the captured regular-file offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t801\nLOAD_LOG\t/tmp/cat.log\nPATCH\treader-offset\tready\t/tmp/cat.txt\t131072\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, readerDescriptor);

    expect(commands[0]).toContain("dd bs=1 count=131072");
    expect(commands[0]).toContain("'/usr/bin/cat' <&3");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-cat-offset-loader",
      targetPid: 801,
      refusals: [],
    });
  });

  it("launches original target grep from the captured regular-file offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t802\nLOAD_LOG\t/tmp/grep.log\nPATCH\tgrep-offset\tready\t/tmp/grep.txt\t294912\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, grepDescriptor);

    expect(commands[0]).toContain("dd bs=1 count=294912");
    expect(commands[0]).toContain("'/usr/bin/grep' -- 'match' <&3");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-grep-offset-loader",
      targetPid: 802,
      refusals: [],
    });
  });

  it("launches original target watch under a script PTY", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t803\nLOAD_LOG\t/tmp/watch.typescript\nPATCH\twatch-loop\tready\t1\tdate\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, watchDescriptor);

    expect(commands[0]).toContain("/usr/bin/watch");
    expect(commands[0]).toContain("date");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-watch-loop-loader",
      targetPid: 803,
      refusals: [],
    });
  });

  it("launches original target shell under a script PTY in the captured cwd", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t804\nLOAD_LOG\t/tmp/sh.typescript\nPATCH\tsh-script-pty\tready\t/work\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, shellDescriptor);

    expect(commands[0]).toContain("/work");
    expect(commands[0]).toContain("/usr/bin/dash");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sh-script-pty-loader",
      targetPid: 804,
      refusals: [],
    });
  });

  it("launches original target Python HTTP server in the captured cwd and port", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t805\nLOAD_LOG\t/tmp/http.log\nPATCH\tpython-http-server\tready\t/tmp/web\t8123\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, httpDescriptor);

    expect(commands[0]).toContain("cd '/tmp/web'");
    expect(commands[0]).toContain("'/usr/bin/python3.11' -m http.server 8123 --bind 127.0.0.1");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-python-http-server-loader",
      targetPid: 805,
      refusals: [],
    });
  });

  it("launches target-native go static HTTP binary", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t812\nLOAD_LOG\t/tmp/go-static.log\nPATCH\tgo-static-http\tready\t/tmp/go-static/server\t8145\t/health\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, goStaticHttpDescriptor);

    expect(commands[0]).toContain("setsid sh -c");
    expect(commands[0]).toContain("/tmp/go-static/server");
    expect(commands[0]).toContain("go-static-http-v1");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-go-static-http-loader",
      targetPid: 812,
      refusals: [],
    });
  });

  it("launches target-native rust static HTTP binary", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t813\nLOAD_LOG\t/tmp/rust-static.log\nPATCH\trust-static-http\tready\t/tmp/rust-static/server\t8148\t/health\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, rustStaticHttpDescriptor);

    expect(commands[0]).toContain("setsid sh -c");
    expect(commands[0]).toContain("/tmp/rust-static/server");
    expect(commands[0]).toContain("rust-static-http-v1");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-rust-static-http-loader",
      targetPid: 813,
      refusals: [],
    });
  });

  it("launches original target python static route harness", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t811\nLOAD_LOG\t/tmp/python-static.log\nPATCH\tpython-static-route\tready\t/tmp/python-static/server.py\t8143\t/health\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, pythonStaticRouteDescriptor);

    expect(commands[0]).toContain("'/usr/bin/python3' '/tmp/python-static/server.py'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-python-static-route-loader",
      targetPid: 811,
      refusals: [],
    });
  });

  it("launches original target timeout around Python HTTP server", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t810\nLOAD_LOG\t/tmp/timeout-http.log\nPATCH\ttimeout-python-http-server\tready\t30\t8138\t/tmp/timeout-web\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, timeoutDescriptor);

    expect(commands[0]).toContain("'/usr/bin/timeout' 30 /usr/bin/python3 -m http.server 8138");
    expect(commands[0]).toContain("--directory '/tmp/timeout-web'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-timeout-python-http-server-loader",
      targetPid: 810,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native rsync read-only daemon", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t822\nLOAD_LOG\t/tmp/rsync.log\nPATCH\trsync-daemon\tready\t8181\tproof\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, rsyncDescriptor);

    expect(commands[0]).toContain("missing-rsync");
    expect(commands[0]).toContain("auth-or-hook-config");
    expect(commands[0]).toContain("port-in-use");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-rsync-daemon-loader",
      targetPid: 822,
      refusals: [],
    });
  });

  it("keeps rsync service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t822\nLOAD_LOG\t/tmp/rsync.log\nPATCH\trsync-daemon\tready\t8181\tproof\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(rsyncDescriptor),
    );

    expect(commands[0]).toContain("PATCH\trsync-daemon");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-rsync-daemon-loader",
      targetPid: 822,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native PHP static server", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t821\nLOAD_LOG\t/tmp/php.log\nPATCH\tphp-static\tready\t8175\t/tmp/php-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, phpDescriptor);

    expect(commands[0]).toContain("missing-php");
    expect(commands[0]).toContain("dynamic-php-script");
    expect(commands[0]).toContain("port-in-use");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-php-static-loader",
      targetPid: 821,
      refusals: [],
    });
  });

  it("keeps PHP service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t821\nLOAD_LOG\t/tmp/php.log\nPATCH\tphp-static\tready\t8175\t/tmp/php-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(phpDescriptor),
    );

    expect(commands[0]).toContain("PATCH\tphp-static");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-php-static-loader",
      targetPid: 821,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native Ruby httpd static server", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t820\nLOAD_LOG\t/tmp/ruby.log\nPATCH\truby-http\tready\t8170\t/tmp/ruby-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, rubyDescriptor);

    expect(commands[0]).toContain("missing-ruby");
    expect(commands[0]).toContain("port-in-use");
    expect(commands[0]).toContain("changed-root-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-ruby-httpd-loader",
      targetPid: 820,
      refusals: [],
    });
  });

  it("keeps Ruby service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t820\nLOAD_LOG\t/tmp/ruby.log\nPATCH\truby-http\tready\t8170\t/tmp/ruby-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(rubyDescriptor),
    );

    expect(commands[0]).toContain("PATCH\truby-http");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-ruby-httpd-loader",
      targetPid: 820,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native Caddy static server", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t819\nLOAD_LOG\t/tmp/caddy.log\nPATCH\tcaddy-static\tready\t8165\t/tmp/caddy-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, caddyDescriptor);

    expect(commands[0]).toContain("missing-caddy");
    expect(commands[0]).toContain("port-in-use");
    expect(commands[0]).toContain("changed-root-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-caddy-static-loader",
      targetPid: 819,
      refusals: [],
    });
  });

  it("keeps Caddy service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t819\nLOAD_LOG\t/tmp/caddy.log\nPATCH\tcaddy-static\tready\t8165\t/tmp/caddy-root\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(caddyDescriptor),
    );

    expect(commands[0]).toContain("PATCH\tcaddy-static");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-caddy-static-loader",
      targetPid: 819,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native nginx static server", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t818\nLOAD_LOG\t/tmp/nginx.log\nPATCH\tnginx-static\tready\t8160\t" +
        "a".repeat(64) +
        "\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, nginxDescriptor);

    expect(commands[0]).toContain("missing-nginx");
    expect(commands[0]).toContain("dynamic-or-proxy-config");
    expect(commands[0]).toContain("port-in-use");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-nginx-static-loader",
      targetPid: 818,
      refusals: [],
    });
  });

  it("keeps nginx service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t818\nLOAD_LOG\t/tmp/nginx.log\nPATCH\tnginx-static\tready\t8160\t" +
        "a".repeat(64) +
        "\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(nginxDescriptor),
    );

    expect(commands[0]).toContain("PATCH\tnginx-static");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-nginx-static-loader",
      targetPid: 818,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native Redis idle instance", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t817\nLOAD_LOG\t/tmp/redis.log\nPATCH\tredis-idle\tready\t8153\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, redisDescriptor);

    expect(commands[0]).toContain("--appendonly no --port 8153");
    expect(commands[0]).toContain("missing-redis-server");
    expect(commands[0]).toContain("port-in-use");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-redis-idle-loader",
      targetPid: 817,
      refusals: [],
    });
  });

  it("keeps Redis service consolidation behind explicit envelope fallback", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t817\nLOAD_LOG\t/tmp/redis.log\nPATCH\tredis-idle\tready\t8153\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(
      vm,
      withGenericEquivalentState(redisDescriptor),
    );

    expect(commands[0]).toContain("PATCH\tredis-idle");
    expect(commands[0]).not.toContain("PATCH\tgeneric-resource-graph");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-redis-idle-loader",
      targetPid: 817,
      refusals: [],
    });
  });

  it("launches proof-provisioned target-native socat file responder", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t816\nLOAD_LOG\t/tmp/socat.log\nPATCH\tsocat-file-responder\tready\t8147\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, socatDescriptor);

    expect(commands[0]).toContain("TCP-LISTEN:8147,fork,reuseaddr");
    expect(commands[0]).toContain("changed-file-identity");
    expect(commands[0]).toContain("missing-socat");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-native-socat-file-responder-loader",
      targetPid: 816,
      refusals: [],
    });
  });

  it("launches original target BusyBox nc idle listener", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t815\nLOAD_LOG\t/tmp/busybox-nc.log\nPATCH\tbusybox-nc\tready\t8142\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, busyboxNcDescriptor);

    expect(commands[0]).toContain("'/usr/bin/busybox' nc -l -p 8142");
    expect(commands[0]).toContain("missing-busybox");
    expect(commands[0]).toContain("port-in-use");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-busybox-nc-listener-loader",
      targetPid: 815,
      refusals: [],
    });
  });

  it("launches original target nc idle listener", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t808\nLOAD_LOG\t/tmp/nc.log\nPATCH\tnc-listener\tready\t8135\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, ncDescriptor);

    expect(commands[0]).toContain("'/usr/bin/nc.openbsd' -l 8135");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-nc-listener-loader",
      targetPid: 808,
      refusals: [],
    });
  });

  it("launches original target busybox httpd with explicit root", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t807\nLOAD_LOG\t/tmp/busybox-httpd.log\nPATCH\tbusybox-httpd\tready\t/tmp/busybox-web\t8134\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, busyboxHttpDescriptor);

    expect(commands[0]).toContain("'/usr/bin/busybox' httpd -f");
    expect(commands[0]).toContain("-h '/tmp/busybox-web'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-busybox-httpd-loader",
      targetPid: 807,
      refusals: [],
    });
  });

  it("launches original target Python HTTP server with explicit env", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t809\nLOAD_LOG\t/tmp/env-http.log\nPATCH\tpython-http-server\tready\t/\t8137\t/tmp/env-web\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, envHttpDirectoryDescriptor);

    expect(commands[0]).toContain("env 'MACHINEN_MOVE_ENV_PROOF=wrapped-http'");
    expect(commands[0]).toContain("exec env");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-python-http-server-loader",
      targetPid: 809,
      refusals: [],
    });
  });

  it("launches original target Python HTTP server with explicit directory", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t806\nLOAD_LOG\t/tmp/http-directory.log\nPATCH\tpython-http-server\tready\t/\t8128\t/tmp/web-directory\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, httpDirectoryDescriptor);

    expect(commands[0]).toContain("--directory '/tmp/web-directory'");
    expect(commands[0]).toContain("changed-directory-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-python-http-server-loader",
      targetPid: 806,
      refusals: [],
    });
  });

  it("launches original target comm for sorted files with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1016\nLOAD_LOG\t/tmp/comm.log\nPATCH\tcomm-files\tready\t/tmp/comm.left\t/tmp/comm.right\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, commDescriptor);

    expect(commands[0]).toContain("LC_ALL=C '/usr/bin/comm' '/tmp/comm.left' '/tmp/comm.right'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-comm-files-loader",
      targetPid: 1016,
      refusals: [],
    });
  });

  it("launches original target join default-key mode with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1015\nLOAD_LOG\t/tmp/join.log\nPATCH\tjoin-files\tready\t/tmp/join.left\t/tmp/join.right\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, joinDescriptor);

    expect(commands[0]).toContain("LC_ALL=C '/usr/bin/join' '/tmp/join.left' '/tmp/join.right'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-join-files-loader",
      targetPid: 1015,
      refusals: [],
    });
  });

  it("launches original target paste for exactly two files with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1014\nLOAD_LOG\t/tmp/paste.log\nPATCH\tpaste-files\tready\t/tmp/paste.left\t/tmp/paste.right\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, pasteDescriptor);

    expect(commands[0]).toContain("'/usr/bin/paste' '/tmp/paste.left' '/tmp/paste.right'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-paste-files-loader",
      targetPid: 1014,
      refusals: [],
    });
  });

  it("launches original target uniq count mode with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1013\nLOAD_LOG\t/tmp/uniq.log\nPATCH\tuniq-file\tready\t/tmp/uniq.in\ttrue\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, uniqDescriptor);

    expect(commands[0]).toContain("'/usr/bin/uniq' -c '/tmp/uniq.in'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-uniq-file-loader",
      targetPid: 1013,
      refusals: [],
    });
  });

  it("launches original target awk field projection with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1012\nLOAD_LOG\t/tmp/awk.log\nPATCH\tawk-field\tready\t/tmp/awk-field.in\t2\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, awkFieldDescriptor);

    expect(commands[0]).toContain("'/usr/bin/awk' '{print $2}'");
    expect(commands[0]).toContain("/tmp/awk-field.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-awk-field-loader",
      targetPid: 1012,
      refusals: [],
    });
  });

  it("launches original target cut field selection with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1011\nLOAD_LOG\t/tmp/cut.log\nPATCH\tcut-fields\tready\t/tmp/cut.in\t:\t2\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, cutDescriptor);

    expect(commands[0]).toContain("'/usr/bin/cut' -d ':' -f '2'");
    expect(commands[0]).toContain("/tmp/cut.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-cut-fields-loader",
      targetPid: 1011,
      refusals: [],
    });
  });

  it("launches original target sed print-range recompute with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1010\nLOAD_LOG\t/tmp/sed-range.log\nPATCH\tsed-file\tready\t/tmp/sed-range.in\tprint-range\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sedPrintRangeDescriptor);

    expect(commands[0]).toContain("'/usr/bin/sed' -n '2,4p'");
    expect(commands[0]).toContain("/tmp/sed-range.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sed-file-loader",
      targetPid: 1010,
      refusals: [],
    });
  });

  it("launches original target sed literal substitution recompute with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1009\nLOAD_LOG\t/tmp/sed-sub.log\nPATCH\tsed-file\tready\t/tmp/sed-sub.in\tliteral-substitution\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sedLiteralSubstitutionDescriptor);

    expect(commands[0]).toContain("'/usr/bin/sed' 's/alpha/omega/'");
    expect(commands[0]).toContain("/tmp/sed-sub.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sed-file-loader",
      targetPid: 1009,
      refusals: [],
    });
  });

  it("launches original target head file recompute with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1008\nLOAD_LOG\t/tmp/head.log\nPATCH\thead-file\tready\t/tmp/head.in\t3\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, headDescriptor);

    expect(commands[0]).toContain("'/usr/bin/head' '-n' '3'");
    expect(commands[0]).toContain("/tmp/head.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-head-file-loader",
      targetPid: 1008,
      refusals: [],
    });
  });

  it("launches original target tail non-follow file recompute with identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1007\nLOAD_LOG\t/tmp/tail-lines.log\nPATCH\ttail-lines\tready\t/tmp/tail-lines.in\t2\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tailLinesDescriptor);

    expect(commands[0]).toContain("'/usr/bin/tail' '-n' '2'");
    expect(commands[0]).toContain("/tmp/tail-lines.in");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tail-lines-loader",
      targetPid: 1007,
      refusals: [],
    });
  });

  it("launches original target base64 file recompute with fixed wrap", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1019\nLOAD_LOG\t/tmp/base64.log\nPATCH\tbase64-file\tready\t/tmp/base64.in\t76\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, base64Descriptor);

    expect(commands[0]).toContain("'/usr/bin/base64' --wrap=76 '/tmp/base64.in'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-base64-file-loader",
      targetPid: 1019,
      refusals: [],
    });
  });

  it("runs original target gzip through atomic output policy", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/gzip.log\nPATCH\tgzip-atomic\tready\t/tmp/gzip.in\t/tmp/gzip.out\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, gzipDescriptor);

    expect(commands[0]).toContain("'/usr/bin/gzip' -c '/tmp/gzip.in'");
    expect(commands[0]).toContain(".machinen-move-$$");
    expect(commands[0]).toContain("mv -f");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-gzip-atomic-loader",
      refusals: [],
    });
  });

  it("runs original target gunzip, xz, and zstd through atomic output policy", async () => {
    for (const [descriptor, command, strategy, patch, input, output] of [
      [
        gunzipDescriptor,
        "gunzip",
        "target-original-gunzip-atomic-loader",
        "gunzip-atomic",
        "/tmp/gunzip.in.gz",
        "/tmp/gunzip.out",
      ],
      [
        xzDescriptor,
        "xz",
        "target-original-xz-atomic-loader",
        "xz-atomic",
        "/tmp/xz.in",
        "/tmp/xz.out",
      ],
      [
        zstdDescriptor,
        "zstd",
        "target-original-zstd-atomic-loader",
        "zstd-atomic",
        "/tmp/zstd.in",
        "/tmp/zstd.out",
      ],
    ] as const) {
      const commands: string[] = [];
      const vm = mockVm(
        commands,
        `LOAD_LOG\t/tmp/${command}.log\nPATCH\t${patch}\tready\t${input}\t${output}\n`,
      );
      const loader = await runMoveTargetDirectLoaderInVm(vm, descriptor);

      expect(commands[0]).toContain(`'/usr/bin/${command}' -c '${input}'`);
      expect(commands[0]).toContain(".machinen-move-$$");
      expect(commands[0]).toContain("mv -f");
      expect(loader).toMatchObject({ state: "ready", strategy, refusals: [] });
    }
  });

  it("launches original target generic checksum file recompute", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1017\nLOAD_LOG\t/tmp/md5.log\nPATCH\tchecksum-file\tready\tmd5\t/tmp/md5.in\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, checksumDescriptor);

    expect(commands[0]).toContain("'/usr/bin/md5sum' '/tmp/md5.in'");
    expect(commands[0]).toContain("sha256sum");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-checksum-file-loader",
      targetPid: 1017,
      refusals: [],
    });
  });

  it("launches original target sha256sum file recompute", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1006\nLOAD_LOG\t/tmp/sha256.log\nPATCH\tsha256sum-file\tready\t/tmp/sha256.in\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sha256Descriptor);

    expect(commands[0]).toContain("'/usr/bin/sha256sum'");
    expect(commands[0]).toContain("/tmp/sha256.in");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sha256sum-file-loader",
      targetPid: 1006,
      refusals: [],
    });
  });

  it("launches original target wc line-count recompute", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1005\nLOAD_LOG\t/tmp/wc.log\nPATCH\twc-line\tready\t/tmp/wc.in\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, wcDescriptor);

    expect(commands[0]).toContain("'/usr/bin/wc' -l");
    expect(commands[0]).toContain("/tmp/wc.in");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-wc-line-loader",
      targetPid: 1005,
      refusals: [],
    });
  });

  it("launches original target sort file recompute", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1004\nLOAD_LOG\t/tmp/sort.log\nPATCH\tsort-file\tready\t/tmp/sort.in\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sortDescriptor);

    expect(commands[0]).toContain("'/usr/bin/sort'");
    expect(commands[0]).toContain("/tmp/sort.in");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sort-file-loader",
      targetPid: 1004,
      refusals: [],
    });
  });

  it("launches original target mv rename with preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1003\nLOAD_LOG\t/tmp/mv.log\nPATCH\tmv-rename\tready\t/tmp/mv.in\t/tmp/mv.out\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, mvDescriptor);

    expect(commands[0]).toContain("'/usr/bin/mv'");
    expect(commands[0]).toContain("/tmp/mv.in");
    expect(commands[0]).toContain("/tmp/mv.out");
    expect(commands[0]).toContain("stat -c %d");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-mv-rename-loader",
      targetPid: 1003,
      refusals: [],
    });
  });

  it("launches original target cp continuation from the committed destination offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1002\nLOAD_LOG\t/tmp/cp.log\nPATCH\tcp-offset\tready\t/tmp/cp.in\t/tmp/cp.out\t4096\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, cpDescriptor);

    expect(commands[0]).toContain("'/usr/bin/cp' --version");
    expect(commands[0]).toContain("tail -c +$(( 4096 + 1 ))");
    expect(commands[0]).toContain("/tmp/cp.in");
    expect(commands[0]).toContain("/tmp/cp.out");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-cp-offset-loader",
      targetPid: 1002,
      refusals: [],
    });
  });

  it("launches original target node static http server with argv contract", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1011\nLOAD_LOG\t/tmp/node-argv.log\nPATCH\tnode-static-http\tready\t/tmp/node-argv-static/server.mjs\t8140\t/tmp/node-argv-static/public\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, nodeStaticArgvDescriptor);

    expect(commands[0]).toContain("'/usr/bin/node' '/tmp/node-argv-static/server.mjs'");
    expect(commands[0]).toContain("--port 8140 --root '/tmp/node-argv-static/public'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-node-static-http-loader",
      targetPid: 1011,
      refusals: [],
    });
  });

  it("launches original target node static http server after health readiness", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t1001\nLOAD_LOG\t/tmp/node.log\nPATCH\tnode-static-http\tready\t/tmp/node-static/server.mjs\t8130\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, nodeStaticDescriptor);

    expect(commands[0]).toContain("/usr/bin/node");
    expect(commands[0]).toContain("/tmp/node-static/server.mjs");
    expect(commands[0]).toContain("/health");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-node-static-http-loader",
      targetPid: 1001,
      refusals: [],
    });
  });

  it("launches original target tar to create the archive", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t909\nLOAD_LOG\t/tmp/tar.log\nPATCH\ttar-create\tready\t/tmp/archive.tar\t/tmp/tar-tree\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tarDescriptor);

    expect(commands[0]).toContain("/usr/bin/tar");
    expect(commands[0]).toContain("-cf");
    expect(commands[0]).toContain("/tmp/archive.tar");
    expect(commands[0]).toContain("/tmp/tar-tree");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tar-create-loader",
      targetPid: 909,
      refusals: [],
    });
  });

  it("runs original target tar extract with safe archive preflights", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/tar-extract.log\nPATCH\ttar-extract\tready\t/tmp/archive.tar\t/tmp/extract\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tarExtractDescriptor);

    expect(commands[0]).toContain("/usr/bin/tar");
    expect(commands[0]).toContain("-xf");
    expect(commands[0]).toContain("changed-archive-identity");
    expect(commands[0]).toContain("unsafe-member-path");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tar-extract-loader",
      refusals: [],
    });
  });

  it("runs original target zip create with source tree preflights", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/zip.log\nPATCH\tzip-create\tready\t/tmp/archive.zip\t/tmp/zip-tree\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, zipCreateDescriptor);

    expect(commands[0]).toContain("/usr/bin/zip");
    expect(commands[0]).toContain("-r");
    expect(commands[0]).toContain("changed-source-identity");
    expect(commands[0]).toContain('find "$root" -type l');
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-zip-create-loader",
      refusals: [],
    });
  });

  it("runs original target mkdir with parent identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/mkdir.log\nPATCH\tmkdir-dir\tready\t/tmp/mkdir-parent/newdir\t/tmp/mkdir-parent\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, mkdirDescriptor);

    expect(commands[0]).toContain("/usr/bin/mkdir");
    expect(commands[0]).toContain("/tmp/mkdir-parent/newdir");
    expect(commands[0]).toContain("changed-parent-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-mkdir-dir-loader",
      refusals: [],
    });
  });

  it("runs original target mkdir -p with path-chain preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/mkdirp.log\nPATCH\tmkdir-parents\tready\t/tmp/mkdirp-root/nested/leaf\t/tmp/mkdirp-root\tnested/leaf\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, mkdirParentsDescriptor);

    expect(commands[0]).toContain("/usr/bin/mkdir");
    expect(commands[0]).toContain("-p");
    expect(commands[0]).toContain("changed-path-chain");
    expect(commands[0]).toContain("changed-prefix-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-mkdir-parents-loader",
      refusals: [],
    });
  });

  it("runs original target touch with deterministic timestamp preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/touch.log\nPATCH\ttouch-file\tready\t/tmp/touch-parent/new-file\t1781094896\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, touchDescriptor);

    expect(commands[0]).toContain("/usr/bin/touch");
    expect(commands[0]).toContain("-t");
    expect(commands[0]).toContain("changed-parent-identity");
    expect(commands[0]).toContain("unexpected-created-timestamp");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-touch-file-loader",
      refusals: [],
    });
  });

  it("runs original target chmod with mode and identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/chmod.log\nPATCH\tchmod-file\tready\t/tmp/chmod-target.txt\t644\t600\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, chmodDescriptor);

    expect(commands[0]).toContain("/usr/bin/chmod");
    expect(commands[0]).toContain("600");
    expect(commands[0]).toContain("changed-input-mode");
    expect(commands[0]).toContain("unexpected-target-mode");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-chmod-file-loader",
      refusals: [],
    });
  });

  it("runs original target chown with uid/gid mapping and identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/chown.log\nPATCH\tchown-file\tready\t/tmp/chown-target.txt\t65534\t65534\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, chownDescriptor);

    expect(commands[0]).toContain("/usr/bin/chown");
    expect(commands[0]).toContain("nobody:nogroup");
    expect(commands[0]).toContain("changed-uid-gid-mapping");
    expect(commands[0]).toContain("changed-input-owner");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-chown-file-loader",
      refusals: [],
    });
  });

  it("runs original target ln with source and destination-parent preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/link.log\nPATCH\tlink-file\tready\t/tmp/link-source.txt\t/tmp/link-dest.txt\t456\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, linkDescriptor);

    expect(commands[0]).toContain("/usr/bin/ln");
    expect(commands[0]).toContain("/tmp/link-source.txt");
    expect(commands[0]).toContain("changed-source-identity");
    expect(commands[0]).toContain("not-hardlink-after-link");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-link-file-loader",
      refusals: [],
    });
  });

  it("runs original target ln -s with literal target and parent preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/symlink.log\nPATCH\tsymlink-file\tready\t/tmp/symlink-target.txt\t/tmp/symlink-parent/link.txt\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, symlinkDescriptor);

    expect(commands[0]).toContain("/usr/bin/ln");
    expect(commands[0]).toContain("-s");
    expect(commands[0]).toContain("changed-parent-identity");
    expect(commands[0]).toContain("changed-created-target");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-symlink-file-loader",
      refusals: [],
    });
  });

  it("runs original target rm with file and parent identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/rm.log\nPATCH\trm-file\tready\t/tmp/rm-parent/victim.txt\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, rmDescriptor);

    expect(commands[0]).toContain("/usr/bin/rm");
    expect(commands[0]).toContain("/tmp/rm-parent/victim.txt");
    expect(commands[0]).toContain("changed-file-identity");
    expect(commands[0]).toContain("path-still-present-after-rm");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-rm-file-loader",
      refusals: [],
    });
  });

  it("runs original target rmdir with empty directory and parent preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/rmdir.log\nPATCH\trmdir-dir\tready\t/tmp/rmdir-parent/empty\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, rmdirDescriptor);

    expect(commands[0]).toContain("/usr/bin/rmdir");
    expect(commands[0]).toContain("/tmp/rmdir-parent/empty");
    expect(commands[0]).toContain("changed-directory-identity");
    expect(commands[0]).toContain("path-still-present-after-rmdir");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-rmdir-dir-loader",
      refusals: [],
    });
  });

  it("runs proof-provisioned target-native tree with stable traversal preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/tree.log\nPATCH\ttree\tready\t/tmp/tree-proof-root\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, treeDescriptor);

    expect(commands[0]).toContain("/usr/bin/tree");
    expect(commands[0]).toContain("tree-binary-missing");
    expect(commands[0]).toContain("changed-tree-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tree-loader",
      refusals: [],
    });
  });

  it("runs original target find with bounded predicate and stable tree preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/find-pred.log\nPATCH\tfind-predicate\tready\t/tmp/find-predicate-tree\tsize\t+4c\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, findPredicateDescriptor);

    expect(commands[0]).toContain("/usr/bin/find");
    expect(commands[0]).toContain("-size");
    expect(commands[0]).toContain("changed-tree-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-find-predicate-loader",
      refusals: [],
    });
  });

  it("runs original target find -maxdepth with stable tree preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/find-max.log\nPATCH\tmaxdepth-find\tready\t/tmp/find-tree\t2\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, maxdepthFindDescriptor);

    expect(commands[0]).toContain("/usr/bin/find");
    expect(commands[0]).toContain("-maxdepth");
    expect(commands[0]).toContain("changed-tree-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-maxdepth-find-loader",
      refusals: [],
    });
  });

  it("runs original target recursive grep with stable text tree preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/grep-r.log\nPATCH\trecursive-grep\tready\t/tmp/grep-tree\tneedle\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, recursiveGrepDescriptor);

    expect(commands[0]).toContain("/usr/bin/grep");
    expect(commands[0]).toContain("binary-file-unsupported");
    expect(commands[0]).toContain("changed-tree-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-recursive-grep-loader",
      refusals: [],
    });
  });

  it("runs original target realpath with symlink-chain identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/realpath.log\nPATCH\trealpath-path\tready\t/tmp/realpath-link\t/tmp/realpath-dir/target.txt\t5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, realpathDescriptor);

    expect(commands[0]).toContain("/usr/bin/realpath");
    expect(commands[0]).toContain("unsafe-resolved-path");
    expect(commands[0]).toContain("changed-realpath-chain");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-realpath-path-loader",
      refusals: [],
    });
  });

  it("runs original target readlink with direct literal target preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/readlink.log\nPATCH\treadlink-direct\tready\t/tmp/readlink-link\ttarget.txt\t199b3badd968634ea14e351d1134ada738894a90a2efa66983101ece99a33572\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, readlinkDescriptor);

    expect(commands[0]).toContain("/usr/bin/readlink");
    expect(commands[0]).toContain("unsafe-target-literal");
    expect(commands[0]).toContain("changed-link-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-readlink-direct-loader",
      refusals: [],
    });
  });

  it("runs original target stat with default-format file identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/stat.log\nPATCH\tstat-file\tready\t/tmp/stat-file.txt\t12\tffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, statDescriptor);

    expect(commands[0]).toContain("/usr/bin/stat");
    expect(commands[0]).toContain("unsupported-file-type");
    expect(commands[0]).toContain("changed-file-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-stat-file-loader",
      refusals: [],
    });
  });

  it("runs original target du -sb with no-symlink/no-mount tree identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/du.log\nPATCH\tdu-sb-dir\tready\t/tmp/du-tree\t8266\t09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, duDescriptor);

    expect(commands[0]).toContain("/usr/bin/du");
    expect(commands[0]).toContain("-sb --");
    expect(commands[0]).toContain("mount-crossing-unsupported");
    expect(commands[0]).toContain("changed-tree-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-du-sb-dir-loader",
      refusals: [],
    });
  });

  it("runs original target ls -l with entries and owner/group mapping preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/ls-long.log\nPATCH\tls-long-dir\tready\t/tmp/ls-dir\t2\t4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, lsLongDescriptor);

    expect(commands[0]).toContain("LC_ALL=C");
    expect(commands[0]).toContain("-l --");
    expect(commands[0]).toContain("getent passwd");
    expect(commands[0]).toContain("changed-directory-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-ls-long-dir-loader",
      refusals: [],
    });
  });

  it("runs original target ls with C-locale directory identity preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/ls.log\nPATCH\tls-dir\tready\t/tmp/ls-dir\t3\t4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, lsDescriptor);

    expect(commands[0]).toContain("LC_ALL=C");
    expect(commands[0]).toContain("-1 --");
    expect(commands[0]).toContain("changed-directory-identity");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-ls-dir-loader",
      refusals: [],
    });
  });

  it("runs original target install with source and destination-parent preflight", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_LOG\t/tmp/install.log\nPATCH\tinstall-file\tready\t/tmp/install-src.txt\t/tmp/install-parent/dest.txt\t755\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, installDescriptor);

    expect(commands[0]).toContain("/usr/bin/install");
    expect(commands[0]).toContain("-m");
    expect(commands[0]).toContain("changed-source-identity");
    expect(commands[0]).toContain("unexpected-destination-mode");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-install-file-loader",
      refusals: [],
    });
  });

  it("launches original target find after the captured last emitted path", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t808\nLOAD_LOG\t/tmp/find.log\nPATCH\tfind-cursor\tready\t/tmp/tree\t/tmp/tree/file-010\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, findDescriptor);

    expect(commands[0]).toContain("/usr/bin/find");
    expect(commands[0]).toContain("/tmp/tree");
    expect(commands[0]).toContain("awk");
    expect(commands[0]).toContain("/tmp/tree/file-010");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-find-cursor-loader",
      targetPid: 808,
      refusals: [],
    });
  });

  it("launches original target dd from captured read and write offsets", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t807\nLOAD_LOG\t/tmp/dd.log\nPATCH\tdd-offset\tready\t/tmp/dd.in\t/tmp/dd.out\t4096\t4096\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, ddDescriptor);

    expect(commands[0]).toContain("/usr/bin/dd");
    expect(commands[0]).toContain("skip='4096'");
    expect(commands[0]).toContain("seek='4096'");
    expect(commands[0]).toContain("iflag=skip_bytes");
    expect(commands[0]).toContain("oflag=seek_bytes");
    expect(commands[0]).toContain("conv=notrunc");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-dd-offset-loader",
      targetPid: 807,
      refusals: [],
    });
  });

  it("launches original target tail and grep as a pipeline from the captured offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      "LOAD_PID\t806\nLOAD_LOG\t/tmp/pipeline.log\nPATCH\ttail-grep-pipeline\tready\t/tmp/pipeline.txt\t35\tmatch\n",
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tailGrepPipelineDescriptor);

    expect(commands[0]).toContain("tail");
    expect(commands[0]).toContain("+36");
    expect(commands[0]).toContain("grep");
    expect(commands[0]).toContain("--line-buffered");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tail-grep-pipeline-loader",
      targetPid: 806,
      refusals: [],
    });
  });

  it("launches original target ping and accepts a frozen pre-send capture", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t321",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "UNAME\tx86_64",
        "SAFE_BOUNDARY\tpre-send-icmp\tsendto",
        "FREEZE\tptrace-attached\tstatus:4991",
        "REG_AMD64\t0x1\t0x2\t0x3\t0x4\t0x5\t0x6\t0x7\t0x8\t0x9\t0xa\t0xb\t0xc\t0xd\t0xe\t0xf\t0x10\t0x11\t0x12\t0x13\t0x14",
        "PATCH\tping-rts\t0x1000\t4\t4\t0",
        "PATCH\tping-send-buffer\tready\t0x2000\t64\t5",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, descriptor);

    expect(commands[0]).toContain("--load-ping-state 4 4 0");
    expect(commands[0]).toContain("/usr/bin/ping");
    expect(commands[0]).toContain("google.com");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-ping-direct-loader",
      targetPid: 321,
      refusals: [],
    });
  });

  it("refuses when target ping does not reach the direct-loader boundary", async () => {
    const vm = mockVm([], "LOAD_PID\t321\nSAFE_BOUNDARY\trefused\ttimeout\n");

    const loader = await runMoveTargetDirectLoaderInVm(vm, descriptor);

    expect(loader.refusals).toContainEqual(expect.objectContaining({ code: "active-syscall" }));
  });
});

function moveDescriptorWithCapture(
  pid: number,
  command: string,
  argv: string[],
  exe: string,
  capture: NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>,
): MoveDescriptor {
  return {
    ...descriptor,
    rootPid: pid,
    nodes: [{ pid, ppid: 1, command, argv, cwd: "/", exe }],
    resourcePlan: { ...descriptor.resourcePlan!, capture },
  };
}

function withGenericEquivalentState(source: MoveDescriptor): MoveDescriptor {
  return withGenericMigrationState(source);
}

function withGenericPrimaryState(source: MoveDescriptor, sourceProofName: string): MoveDescriptor {
  return withGenericMigrationState(source, {
    mode: "generic-primary",
    sourceProofName,
    genericProofName:
      sourceProofName === "python-http-directory"
        ? "generic-static-http-daemon"
        : "generic-interpreted-server",
    fallbackPolicy: "bespoke fallback remains available for out-of-contract shapes",
    boundary: "unit-test exact generic-primary migration boundary",
  });
}

function withGenericMigrationState(
  source: MoveDescriptor,
  migration?: NonNullable<
    NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>["genericResourceGraphState"]
  >["migration"],
): MoveDescriptor {
  const node = source.nodes[0]!;
  return {
    ...source,
    resourcePlan: {
      ...source.resourcePlan!,
      capture: {
        ...source.resourcePlan!.capture!,
        genericResourceGraphState: {
          policy: "generic-resource-graph-target-native-reexec-v1",
          migration,
          executableIdentity: { path: node.exe ?? node.argv[0] ?? "/bin/false" },
          argv: node.argv,
          env: { policy: "target-default" },
          cwd: { path: node.cwd ?? "/" },
          ports: [],
          regularFiles: [],
          dataDirs: [],
          fileOffsets: [],
          stdioPolicy: "stdio-dev-null-or-closed",
          healthProbe: { kind: "process-alive" },
          resourceClasses: [],
          refusalClasses: [],
        },
      },
    },
  };
}

function mockVm(commands: string[], stdout: string): VmHandle {
  return {
    pid: 200,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    wait: undefined,
    kill: undefined,
    detach: undefined,
    output: undefined,
    errorOutput: undefined,
    exec: undefined,
    execRaw: async (cmd: string) => {
      commands.push(cmd);
      return { exitCode: 0, stdout, stderr: "" };
    },
    execPty: undefined,
    writeFile: undefined,
    snapshot: undefined,
    memory: undefined,
  } as unknown as VmHandle;
}
