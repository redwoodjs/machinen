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
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-python-http-server-loader",
      targetPid: 806,
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
