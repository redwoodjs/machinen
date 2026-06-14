import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import { readMoveZipCreateStateInVm } from "../move-archive-envelope.ts";
import { readMoveBusyboxNcState } from "../move-busybox-nc-envelope.ts";
import { readMoveChecksumStateInVm } from "../move-checksum-envelope.ts";
import { readMoveDuStateInVm } from "../move-du-envelope.ts";
import {
  readMoveBase64StateInVm,
  readMoveGunzipStateInVm,
  readMoveGzipStateInVm,
  readMoveXzStateInVm,
  readMoveZstdStateInVm,
} from "../move-encoder-envelope.ts";
import {
  readMoveBusyboxHttpState,
  readMoveCpState,
  readMoveDdState,
  readMoveEnvStateInVm,
  readMoveFindStateInVm,
  readMoveGoStaticHttpState,
  readMoveHttpState,
  readMoveMvStateInVm,
  readMoveNcState,
  readMoveNodeStaticHttpStateInVm,
  readMovePythonStaticRouteStateInVm,
  readMoveReaderStateInVm,
  readMoveRustStaticHttpState,
  readMoveSha256StateInVm,
  readMoveSortStateInVm,
  readMoveWcStateInVm,
  readMoveTailGrepPipelineState,
  readMoveTarExtractStateInVm,
  readMoveTarState,
  readMoveTimeoutState,
} from "../move-envelope-capture.ts";
import {
  readMoveChmodStateInVm,
  readMoveChownStateInVm,
  readMoveLinkStateInVm,
  readMoveMkdirParentsStateInVm,
  readMoveMkdirStateInVm,
  readMoveTouchStateInVm,
} from "../move-filesystem-mutation-envelope.ts";
import { readMoveInstallStateInVm } from "../move-install-envelope.ts";
import { readMoveFindPredicateStateInVm } from "../move-find-predicate-envelope.ts";
import { readMoveLsLongStateInVm, readMoveLsStateInVm } from "../move-ls-envelope.ts";
import { readMoveMaxdepthFindStateInVm } from "../move-maxdepth-find-envelope.ts";
import {
  readCaddyStatic,
  readNginxStatic,
  readPhpStaticState,
  readRubyHttpState,
} from "../move-nginx-envelope.ts";
import { readMoveRmdirStateInVm } from "../move-rmdir-envelope.ts";
import { readRsyncDaemonState } from "../move-rsync-envelope.ts";
import { readMoveSocatFileResponderStateInVm } from "../move-socat-envelope.ts";
import { readMoveReadlinkStateInVm } from "../move-readlink-envelope.ts";
import { readMoveHttpStateInVm } from "../move-python-http-envelope.ts";
import { readMoveRealpathStateInVm } from "../move-realpath-envelope.ts";
import { readMoveRedisIdleStateInVm as readRedisIdle } from "../move-redis-envelope.ts";
import { readMoveRecursiveGrepStateInVm } from "../move-recursive-grep-envelope.ts";
import { readMoveRmStateInVm } from "../move-rm-envelope.ts";
import { readMoveStatStateInVm } from "../move-stat-envelope.ts";
import { readMoveSymlinkStateInVm } from "../move-symlink-envelope.ts";
import { readMoveTreeStateInVm } from "../move-tree-envelope.ts";
import {
  readMoveAwkFieldStateInVm,
  readMoveCommStateInVm,
  readMoveCutStateInVm,
  readMoveHeadStateInVm,
  readMoveJoinStateInVm,
  readMovePasteStateInVm,
  readMoveSedStateInVm,
  readMoveTailLinesStateInVm,
  readMoveUniqStateInVm,
} from "../move-file-utility-capture.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

const baseResourcePlan: MoveResourcePlan = {
  kind: "machinen.move.resource-plan",
  source: "guest-procfs",
  resources: [],
  fdTableEntries: [],
  targetGuestResources: [],
  refusals: [],
  acceptedSubsets: [],
};

describe("move envelope capture helpers", () => {
  it("captures cat reader offset from the input file fd", async () => {
    const state = await readMoveReaderStateInVm(mockVm(), catNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/out", offset: 12 },
        { id: "input", fd: 6, kind: "file", state: "recipe", path: "/tmp/cat.txt", offset: 128 },
      ],
    });

    expect(state).toMatchObject({
      command: "cat",
      path: "/tmp/cat.txt",
      offset: 128,
      outputPath: "/tmp/out",
    });
  });

  it("captures go static http marker argv state", () => {
    expect(readMoveGoStaticHttpState(goStaticNode(), httpResourcePlan(1))).toMatchObject({
      binaryPath: "/tmp/go-static/server",
      cwd: "/tmp/go-static",
      markerVersion: "go-static-http-v1",
      port: 8145,
      healthPath: "/health",
    });
  });

  it("omits go static http state when extra sockets indicate goroutine or client activity", () => {
    expect(readMoveGoStaticHttpState(goStaticNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures rust static http marker argv state", () => {
    expect(readMoveRustStaticHttpState(rustStaticNode(), httpResourcePlan(1))).toMatchObject({
      binaryPath: "/tmp/rust-static/server",
      cwd: "/tmp/rust-static",
      markerVersion: "rust-static-http-v1",
      port: 8148,
      healthPath: "/health",
    });
  });

  it("omits python static route state without marker contract", async () => {
    await expect(
      readMovePythonStaticRouteStateInVm(
        mockVm('PORT = 8143\nROUTE = "/health"\nRESPONSE = "python-static-ok"\n'),
        pythonStaticRouteNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures marker-labeled python static route harness", async () => {
    const state = await readMovePythonStaticRouteStateInVm(
      mockVm(
        '# machinen-move-envelope: python-static-route-v1\nPORT = 8143\nROUTE = "/health"\nRESPONSE = "python-static-ok"\n',
      ),
      pythonStaticRouteNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      executable: "python3",
      scriptPath: "/tmp/python-static/server.py",
      cwd: "/tmp/python-static",
      port: 8143,
      route: "/health",
      expectedBody: "python-static-ok",
    });
  });

  it("omits node static argv state when extra sockets indicate active clients", async () => {
    await expect(
      readMoveNodeStaticHttpStateInVm(
        mockVm(`// machinen-move-envelope: static-http-argv-v1\nif (req.url === "/health") {}\n`),
        nodeStaticArgvNode(),
        httpResourcePlan(2),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures marked node static http argv contract state", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(`// machinen-move-envelope: static-http-argv-v1\nif (req.url === "/health") {}\n`),
      nodeStaticArgvNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      scriptPath: "/tmp/node-argv-static/server.mjs",
      cwd: "/tmp/node-argv-static",
      port: 8140,
      rootDir: "/tmp/node-argv-static/public",
      argvContract: "--port-root-static-http-v1",
      healthPath: "/health",
    });
  });

  it("captures narrow marked node static http server", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      scriptPath: "/tmp/node-static/server.mjs",
      cwd: "/tmp/node-static",
      port: 8130,
      healthPath: "/health",
    });
  });

  it("omits marked node static http state when timers are used", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nsetInterval(() => {}, 1000);\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits marked node static http state when worker threads are used", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nimport { Worker } from "node:worker_threads";\nconst PORT = 8130;\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits marked node static http state when native addon dlopen shapes are present", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nfunction loadNative() { process.dlopen(process, "./native-addon.node"); }\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits node static http state without the marker", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm("const PORT = 8130;\n"),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits timeout state for signal customization", () => {
    expect(
      readMoveTimeoutState(
        { ...timeoutNode(), argv: ["timeout", "-s", "KILL", "30", ...timeoutChildNode().argv] },
        [timeoutNode(), timeoutChildNode()],
        httpResourcePlan(1),
      ),
    ).toBeUndefined();
  });

  it("captures timeout around supported python http child", () => {
    expect(
      readMoveTimeoutState(timeoutNode(), [timeoutNode(), timeoutChildNode()], httpResourcePlan(1)),
    ).toMatchObject({
      seconds: 30,
      child: "python-http-server",
      httpState: {
        port: 8138,
        directory: "/tmp/timeout-web",
      },
    });
  });

  it("omits env proof variable for unsupported child shapes", async () => {
    await expect(
      readMoveEnvStateInVm(
        mockVm("wrapped-http\n"),
        { ...httpDirectoryNode(), argv: ["python3", "-c", "import time; time.sleep(20)"] },
        httpResourcePlan(0),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures explicit env proof variable for supported python http child", async () => {
    await expect(
      readMoveEnvStateInVm(mockVm("wrapped-http\n"), httpDirectoryNode(), httpResourcePlan(1)),
    ).resolves.toMatchObject({
      key: "MACHINEN_MOVE_ENV_PROOF",
      value: "wrapped-http",
      child: "python-http-server",
    });
  });

  it("captures idle python http server only with one listener socket", () => {
    expect(readMoveHttpState(httpNode(), httpResourcePlan(1))).toMatchObject({
      executable: "python3",
      port: 8123,
      cwd: "/tmp/web",
    });
  });

  it("captures idle nc listener with explicit port", () => {
    expect(readMoveNcState(ncNode(), httpResourcePlan(1))).toMatchObject({
      port: 8135,
    });
  });

  it("omits nc listener state when an active client adds socket state", () => {
    expect(readMoveNcState(ncNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures rsync daemon read-only module state", async () => {
    await expect(
      readRsyncDaemonState(
        mockVm(
          "RSYNC_DAEMON_OK\t8181\tproof\t/tmp/rsync-root\t" +
            "f".repeat(64) +
            "\t1\t1\t12\t" +
            "a".repeat(64) +
            "\n",
        ),
        rsyncNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits rsync daemon state for write/auth config or unsupported argv", async () => {
    await expect(
      readRsyncDaemonState(
        mockVm("PATCH\trsync-daemon\trefused\twrite-module\n", 2),
        rsyncNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readRsyncDaemonState(
        mockVm(""),
        { ...rsyncNode(), argv: ["rsync", "--daemon"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures PHP built-in static-only server state with root identity", async () => {
    await expect(
      readPhpStaticState(
        mockVm("CADDY_STATIC_OK\t8175\t/tmp/php-root\t1\t1\t12\t" + "e".repeat(64) + "\n"),
        phpStaticNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits PHP static state for dynamic scripts, unsupported argv, or failed preflight", async () => {
    await expect(
      readPhpStaticState(
        mockVm("PATCH\tphp-static\trefused\tdynamic-php-script\n", 2),
        phpStaticNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readPhpStaticState(
        mockVm(""),
        { ...phpStaticNode(), argv: ["php", "app.php"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures Ruby httpd static server state with root identity", async () => {
    await expect(
      readRubyHttpState(
        mockVm("CADDY_STATIC_OK\t8170\t/tmp/ruby-root\t1\t1\t12\t" + "d".repeat(64) + "\n"),
        rubyHttpNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits Ruby httpd state for app/framework argv or failed root preflight", async () => {
    await expect(
      readRubyHttpState(mockVm("", 2), rubyHttpNode(), httpResourcePlan(1)),
    ).resolves.toBeUndefined();
    await expect(
      readRubyHttpState(
        mockVm(""),
        { ...rubyHttpNode(), argv: ["ruby", "app.rb"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures Caddy static file-server state with root identity", async () => {
    await expect(
      readCaddyStatic(
        mockVm("CADDY_STATIC_OK\t8165\t/tmp/caddy-root\t1\t1\t12\t" + "c".repeat(64) + "\n"),
        caddyNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits Caddy static state for proxy/dynamic argv or failed root preflight", async () => {
    await expect(
      readCaddyStatic(mockVm("", 2), caddyNode(), httpResourcePlan(1)),
    ).resolves.toBeUndefined();
    await expect(
      readCaddyStatic(
        mockVm(""),
        { ...caddyNode(), argv: ["caddy", "reverse-proxy", "--to", "127.0.0.1:9"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures nginx static server state with config/root identity", async () => {
    await expect(
      readNginxStatic(
        mockVm(
          "NGINX_STATIC_OK\t8160\t/tmp/nginx-root\t" +
            "a".repeat(64) +
            "\t1\t1\t12\t" +
            "b".repeat(64) +
            "\n",
        ),
        nginxNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits nginx static state for unsafe argv or failed config preflight", async () => {
    await expect(
      readNginxStatic(mockVm("", 2), nginxNode(), httpResourcePlan(1)),
    ).resolves.toBeUndefined();
    await expect(
      readNginxStatic(
        mockVm(""),
        { ...nginxNode(), argv: ["nginx", "-c", "/tmp/nginx.conf"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures Redis idle empty no-persistence state", async () => {
    await expect(
      readRedisIdle(mockVm("REDIS_IDLE_OK\t8153\n"), redisNode(), httpResourcePlan(1)),
    ).resolves.toMatchObject({
      port: 8153,
      argvContract: "redis-server-no-persistence-port",
      datasetState: "empty",
      clientState: "idle-no-external-clients",
      persistence: { save: "", appendonly: "no" },
      binaryPolicy: "proof-provisioned-target-native-redis",
    });
  });

  it("omits Redis idle state for persistence, active clients, bad argv, or failed preflight", async () => {
    await expect(
      readRedisIdle(
        mockVm("PATCH\tredis-idle\trefused\tactive-clients\n", 2),
        redisNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readRedisIdle(
        mockVm(""),
        { ...redisNode(), argv: ["redis-server", "--appendonly", "no", "--port", "8153"] },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readRedisIdle(
        mockVm("PATCH\tredis-idle\trefused\tnon-empty-db\n", 2),
        redisNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures socat file responder with explicit file identity", async () => {
    await expect(
      readMoveSocatFileResponderStateInVm(
        mockVm("18\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n"),
        socatNode(),
        [socatNode()],
        httpResourcePlan(3),
      ),
    ).resolves.toMatchObject({
      port: 8147,
      filePath: "/tmp/socat-response.txt",
      fileIdentity: {
        size: 18,
        sha256: "5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6",
      },
      argvContract: "socat-tcp-listen-fork-reuseaddr-file",
      listenerState: "idle-single-listener",
      binaryPolicy: "proof-provisioned-target-native-socat",
    });
  });

  it("omits socat file responder for active children, bad expressions, unsafe files, or changed preflight", async () => {
    await expect(
      readMoveSocatFileResponderStateInVm(
        mockVm(""),
        socatNode(),
        [socatNode(), { ...socatNode(), pid: 99, ppid: 84 }],
        httpResourcePlan(3),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSocatFileResponderStateInVm(
        mockVm(""),
        {
          ...socatNode(),
          argv: ["socat", "TCP-LISTEN:8147,reuseaddr", "FILE:/tmp/socat-response.txt"],
        },
        [socatNode()],
        httpResourcePlan(3),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSocatFileResponderStateInVm(
        mockVm(""),
        { ...socatNode(), argv: ["socat", "TCP-LISTEN:8147,fork,reuseaddr", "FILE:/tmp/../bad"] },
        [socatNode()],
        httpResourcePlan(3),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSocatFileResponderStateInVm(
        mockVm("PATCH\tsocat-file-responder\trefused\tunsupported-file\n", 2),
        socatNode(),
        [socatNode()],
        httpResourcePlan(3),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures BusyBox nc listener with explicit -l -p argv contract", () => {
    expect(readMoveBusyboxNcState(busyboxNcNode(), httpResourcePlan(1))).toMatchObject({
      port: 8142,
      argvContract: "busybox-nc-listen-p",
      listenerState: "idle-single-listener",
    });
  });

  it("omits BusyBox nc state for active clients, non-BusyBox argv, or unsupported options", () => {
    expect(readMoveBusyboxNcState(busyboxNcNode(), httpResourcePlan(2))).toBeUndefined();
    expect(readMoveBusyboxNcState(ncNode(), httpResourcePlan(1))).toBeUndefined();
    expect(
      readMoveBusyboxNcState(
        { ...busyboxNcNode(), argv: ["busybox", "nc", "-l", "8142"] },
        httpResourcePlan(1),
      ),
    ).toBeUndefined();
  });

  it("captures busybox httpd with explicit port and root", () => {
    expect(readMoveBusyboxHttpState(busyboxHttpNode(), httpResourcePlan(1))).toMatchObject({
      port: 8134,
      root: "/tmp/busybox-web",
    });
  });

  it("captures busybox httpd with explicit loopback bind, port, and root", () => {
    expect(
      readMoveBusyboxHttpState(
        {
          ...busyboxHttpNode(),
          argv: ["busybox", "httpd", "-f", "-p", "127.0.0.1:8134", "-h", "/tmp/busybox-web"],
        },
        httpResourcePlan(1),
      ),
    ).toMatchObject({
      port: 8134,
      root: "/tmp/busybox-web",
      bindAddress: "127.0.0.1",
    });
  });

  it("captures python http server with explicit directory", () => {
    expect(readMoveHttpState(httpDirectoryNode(), httpResourcePlan(1))).toMatchObject({
      executable: "python3",
      port: 8128,
      cwd: "/",
      directory: "/tmp/web-directory",
    });
  });

  it("captures explicit-bind python http state with directory identity evidence", async () => {
    await expect(
      readMoveHttpStateInVm(
        mockVm("1\n1\n21\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n"),
        {
          ...httpDirectoryNode(),
          argv: [
            "python3",
            "-m",
            "http.server",
            "--bind",
            "127.0.0.1",
            "--directory",
            "/tmp/web-directory",
            "8128",
          ],
        },
        httpResourcePlan(1),
      ),
    ).resolves.toMatchObject({
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
    });
  });

  it("omits explicit-bind python http state for non-local bind, active client, unsafe directory, or symlink", async () => {
    await expect(
      readMoveHttpStateInVm(
        mockVm("1\n1\n21\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n"),
        {
          ...httpDirectoryNode(),
          argv: ["python3", "-m", "http.server", "--directory", "/tmp/web-directory", "8128"],
        },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveHttpStateInVm(mockVm(""), httpDirectoryNode(), httpResourcePlan(2)),
    ).resolves.toBeUndefined();
    await expect(
      readMoveHttpStateInVm(
        mockVm(""),
        {
          ...httpDirectoryNode(),
          argv: [
            "python3",
            "-m",
            "http.server",
            "--directory",
            "/tmp/../bad",
            "8128",
            "--bind",
            "127.0.0.1",
          ],
        },
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveHttpStateInVm(
        mockVm("PATCH\tpython-http-server\trefused\tsymlink-entry-unsupported\n", 2),
        httpDirectoryNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("omits python http state for cgi or unknown listener shapes", () => {
    expect(
      readMoveHttpState(
        { ...httpNode(), argv: ["python3", "-m", "http.server", "--cgi", "8129"] },
        httpResourcePlan(1),
      ),
    ).toBeUndefined();
  });

  it("omits python http state when extra sockets indicate active or unsafe connections", () => {
    expect(readMoveHttpState(httpNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures tar archive and source directory for the narrow create shape", () => {
    const state = readMoveTarState(tarNode());

    expect(state).toMatchObject({
      archivePath: "/tmp/archive.tar",
      sourceDir: "/tmp/tar-tree",
    });
  });

  it("omits tar state when the archive is inside the source directory", () => {
    expect(
      readMoveTarState({
        ...tarNode(),
        argv: ["tar", "-cf", "/tmp/tar-tree/archive.tar", "/tmp/tar-tree"],
      }),
    ).toBeUndefined();
  });

  it("captures mkdir state with parent identity and absent child policy", async () => {
    const state = await readMoveMkdirStateInVm(
      mockVm("41ed\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      mkdirNode(),
    );

    expect(state).toMatchObject({
      targetPath: "/tmp/mkdir-parent/newdir",
      parentPath: "/tmp/mkdir-parent",
      parentIdentity: { mode: "41ed" },
      policy: "absent-child-existing-parent",
    });
  });

  it("omits mkdir state for -p, root target, or unsafe parent preflight", async () => {
    await expect(
      readMoveMkdirStateInVm(mockVm(""), {
        ...mkdirNode(),
        argv: ["mkdir", "-p", "/tmp/mkdir-parent/newdir"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveMkdirStateInVm(mockVm(""), { ...mkdirNode(), argv: ["mkdir", "/"] }),
    ).resolves.toBeUndefined();
    await expect(readMoveMkdirStateInVm(mockVm("", 1), mkdirNode())).resolves.toBeUndefined();
  });

  it("captures mkdir -p state with path-chain identity and missing components", async () => {
    const state = await readMoveMkdirParentsStateInVm(
      mockVm(
        "/tmp/mkdirp-root\nnested/leaf\n41ed\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n",
      ),
      mkdirParentsNode(),
    );

    expect(state).toMatchObject({
      targetPath: "/tmp/mkdirp-root/nested/leaf",
      existingPrefix: "/tmp/mkdirp-root",
      missingComponents: ["nested", "leaf"],
      prefixIdentity: { mode: "41ed" },
      policy: "symlink-free-path-idempotent-or-create-missing",
    });
  });

  it("omits mkdir -p state for unsafe paths, non -p shapes, or preflight refusal", async () => {
    await expect(readMoveMkdirParentsStateInVm(mockVm(""), mkdirNode())).resolves.toBeUndefined();
    await expect(
      readMoveMkdirParentsStateInVm(mockVm(""), {
        ...mkdirParentsNode(),
        argv: ["mkdir", "-p", "/tmp/../bad"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveMkdirParentsStateInVm(mockVm("", 1), mkdirParentsNode()),
    ).resolves.toBeUndefined();
  });

  it("captures touch state with deterministic timestamp and parent identity", async () => {
    const state = await readMoveTouchStateInVm(
      mockVm(
        "41ed\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n1781094896\n",
      ),
      touchNode(),
    );

    expect(state).toMatchObject({
      path: "/tmp/touch-parent/new-file",
      parentPath: "/tmp/touch-parent",
      timestampSpec: "202606101234.56",
      expectedEpoch: 1781094896,
      parentIdentity: { mode: "41ed" },
      policy: "deterministic-timestamp-absent-file-create",
    });
  });

  it("omits touch state for default time, unsafe paths, or preflight refusal", async () => {
    await expect(readMoveTouchStateInVm(mockVm(""), touchDefaultNode())).resolves.toBeUndefined();
    await expect(
      readMoveTouchStateInVm(mockVm(""), {
        ...touchNode(),
        argv: ["touch", "-t", "202606101234.56", "/tmp/../bad"],
      }),
    ).resolves.toBeUndefined();
    await expect(readMoveTouchStateInVm(mockVm("", 1), touchNode())).resolves.toBeUndefined();
  });

  it("captures chmod state with expected mode, target mode, and file identity", async () => {
    const state = await readMoveChmodStateInVm(
      mockVm("644\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      chmodNode(),
    );

    expect(state).toMatchObject({
      path: "/tmp/chmod-target.txt",
      expectedMode: "644",
      targetMode: "600",
      fileIdentity: {
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      policy: "numeric-mode-regular-non-symlink",
    });
  });

  it("omits chmod state for recursive, symbolic, unsafe, or preflight-refused shapes", async () => {
    await expect(
      readMoveChmodStateInVm(mockVm(""), {
        ...chmodNode(),
        argv: ["chmod", "-R", "600", "/tmp/x"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveChmodStateInVm(mockVm(""), { ...chmodNode(), argv: ["chmod", "u+x", "/tmp/x"] }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveChmodStateInVm(mockVm(""), { ...chmodNode(), argv: ["chmod", "600", "/tmp/../bad"] }),
    ).resolves.toBeUndefined();
    await expect(readMoveChmodStateInVm(mockVm("", 1), chmodNode())).resolves.toBeUndefined();
  });

  it("captures chown state with uid/gid mapping, expected owner, and file identity", async () => {
    const state = await readMoveChownStateInVm(
      mockVm(
        "65534\n65534\n0\n0\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n",
      ),
      chownNode(),
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits chown state for recursive, unknown/unsafe spec, symbolic path, or preflight refusal", async () => {
    await expect(
      readMoveChownStateInVm(mockVm(""), {
        ...chownNode(),
        argv: ["chown", "-R", "nobody:nogroup", "/tmp/x"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveChownStateInVm(mockVm(""), {
        ...chownNode(),
        argv: ["chown", "missing-user", "/tmp/x"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveChownStateInVm(mockVm(""), {
        ...chownNode(),
        argv: ["chown", "nobody:nogroup", "/tmp/../bad"],
      }),
    ).resolves.toBeUndefined();
    await expect(readMoveChownStateInVm(mockVm("", 1), chownNode())).resolves.toBeUndefined();
  });

  it("captures hardlink state with source and destination-parent identities", async () => {
    const state = await readMoveLinkStateInVm(
      mockVm(
        "123\n456\n81a4\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n123\n41ed\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
      ),
      linkNode(),
    );

    expect(state).toMatchObject({
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
      destinationParentIdentity: { dev: "123", mode: "41ed" },
      policy: "hardlink-regular-source-absent-destination-same-filesystem",
    });
  });

  it("omits hardlink state for options, unsafe paths, cross-device preflight, or refusal", async () => {
    await expect(
      readMoveLinkStateInVm(mockVm(""), { ...linkNode(), argv: ["ln", "-s", "/tmp/a", "/tmp/b"] }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLinkStateInVm(mockVm(""), { ...linkNode(), argv: ["ln", "/tmp/../bad", "/tmp/b"] }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLinkStateInVm(
        mockVm(
          "123\n456\n81a4\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n999\n41ed\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
        ),
        linkNode(),
      ),
    ).resolves.toBeUndefined();
    await expect(readMoveLinkStateInVm(mockVm("", 1), linkNode())).resolves.toBeUndefined();
  });

  it("captures symlink state with literal target and parent identity", async () => {
    const state = await readMoveSymlinkStateInVm(
      mockVm("123\n41ed\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      symlinkNode(),
    );

    expect(state).toMatchObject({
      targetLiteral: "/tmp/symlink-target.txt",
      linkPath: "/tmp/symlink-parent/link.txt",
      parentPath: "/tmp/symlink-parent",
      parentIdentity: { dev: "123", mode: "41ed" },
      policy: "literal-target-absent-link-safe-parent",
    });
  });

  it("omits symlink state for unsupported options, unsafe paths, or parent preflight refusal", async () => {
    await expect(
      readMoveSymlinkStateInVm(mockVm(""), {
        ...symlinkNode(),
        argv: ["ln", "-sf", "/tmp/a", "/tmp/b"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSymlinkStateInVm(mockVm(""), {
        ...symlinkNode(),
        argv: ["ln", "-s", "/tmp/a", "/tmp/../bad"],
      }),
    ).resolves.toBeUndefined();
    await expect(readMoveSymlinkStateInVm(mockVm("", 1), symlinkNode())).resolves.toBeUndefined();
  });

  it("captures rm state with file and parent identities", async () => {
    const state = await readMoveRmStateInVm(
      mockVm(
        "81a4\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n123\n41ed\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
      ),
      rmNode(),
    );

    expect(state).toMatchObject({
      path: "/tmp/rm-parent/victim.txt",
      parentPath: "/tmp/rm-parent",
      fileIdentity: {
        mode: "81a4",
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      parentIdentity: { dev: "123", mode: "41ed" },
      policy: "regular-non-symlink-pre-unlink",
    });
  });

  it("omits rm state for recursive, multi-path, unsafe path, or preflight refusal", async () => {
    await expect(
      readMoveRmStateInVm(mockVm(""), { ...rmNode(), argv: ["rm", "-r", "/tmp/rm-parent"] }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRmStateInVm(mockVm(""), { ...rmNode(), argv: ["rm", "/tmp/a", "/tmp/b"] }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRmStateInVm(mockVm(""), { ...rmNode(), argv: ["rm", "/tmp/../bad"] }),
    ).resolves.toBeUndefined();
    await expect(readMoveRmStateInVm(mockVm("", 1), rmNode())).resolves.toBeUndefined();
  });

  it("captures rmdir state with empty directory and parent identities", async () => {
    const state = await readMoveRmdirStateInVm(
      mockVm(
        "123\n456\n41ed\n123\n41ed\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
      ),
      rmdirNode(),
    );

    expect(state).toMatchObject({
      path: "/tmp/rmdir-parent/empty",
      parentPath: "/tmp/rmdir-parent",
      directoryIdentity: { dev: "123", inode: "456", mode: "41ed" },
      parentIdentity: { dev: "123", mode: "41ed" },
      policy: "empty-directory-non-symlink-pre-remove",
    });
  });

  it("omits rmdir state for options, unsafe path, or preflight refusal", async () => {
    await expect(
      readMoveRmdirStateInVm(mockVm(""), {
        ...rmdirNode(),
        argv: ["rmdir", "--ignore-fail-on-non-empty", "/tmp/x"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRmdirStateInVm(mockVm(""), { ...rmdirNode(), argv: ["rmdir", "/tmp/../bad"] }),
    ).resolves.toBeUndefined();
    await expect(readMoveRmdirStateInVm(mockVm("", 1), rmdirNode())).resolves.toBeUndefined();
  });

  it("captures ls state with directory identity and deterministic ordering policy", async () => {
    const state = await readMoveLsStateInVm(
      mockVm(
        "65024\n9001\n41ed\n3\n09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e\n4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe\n",
      ),
      lsNode(),
      {
        ...baseResourcePlan,
        resources: [{ id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/ls.out" }],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("captures tree state with proof-provisioned target-native binary policy", async () => {
    const state = await readMoveTreeStateInVm(
      mockVm(
        "2\n2\n42\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
      ),
      treeNode(),
      {
        ...baseResourcePlan,
        resources: [{ id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/tree.out" }],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits tree state for unsupported options, missing binary, unsafe paths, or symlinks", async () => {
    await expect(
      readMoveTreeStateInVm(
        mockVm(""),
        { ...treeNode(), argv: ["tree", "-a", "/tmp/tree-proof-root"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveTreeStateInVm(
        mockVm(""),
        { ...treeNode(), argv: ["tree", "relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveTreeStateInVm(
        mockVm("PATCH\ttree\trefused\ttree-binary-missing\n", 2),
        treeNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveTreeStateInVm(
        mockVm("PATCH\ttree\trefused\tsymlink-entry-unsupported\n", 2),
        treeNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures find predicate state with bounded -size or -mtime AST", async () => {
    const state = await readMoveFindPredicateStateInVm(
      mockVm(
        "2\n2\n42\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
      ),
      findPredicateNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find-pred.out" },
        ],
      },
    );

    expect(state).toMatchObject({
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
    });

    await expect(
      readMoveFindPredicateStateInVm(
        mockVm(
          "1\n1\n7\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
        ),
        {
          ...findPredicateNode(),
          argv: ["find", "/tmp/find-predicate-tree", "-mtime", "-1", "-type", "f", "-print"],
        },
        baseResourcePlan,
      ),
    ).resolves.toMatchObject({ predicate: { kind: "mtime", value: "-1" } });
  });

  it("omits find predicate state for -exec, -delete, expression trees, unsafe paths, or symlinks", async () => {
    await expect(
      readMoveFindPredicateStateInVm(
        mockVm(""),
        {
          ...findPredicateNode(),
          argv: ["find", "/tmp/find-predicate-tree", "-size", "+4c", "-exec", "rm", "{}", ";"],
        },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveFindPredicateStateInVm(
        mockVm(""),
        { ...findPredicateNode(), argv: ["find", "/tmp/find-predicate-tree", "-delete"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveFindPredicateStateInVm(
        mockVm(""),
        {
          ...findPredicateNode(),
          argv: ["find", "../relative", "-size", "+4c", "-type", "f", "-print"],
        },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveFindPredicateStateInVm(
        mockVm("PATCH\tfind-predicate\trefused\tsymlink-entry-unsupported\n", 2),
        findPredicateNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures maxdepth find state with stable tree and output identity", async () => {
    const state = await readMoveMaxdepthFindStateInVm(
      mockVm(
        "2\n2\n42\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
      ),
      maxdepthFindNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find-max.out" },
        ],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits maxdepth find state for unsupported predicates, unsafe paths, symlinks, or changed preflight", async () => {
    await expect(
      readMoveMaxdepthFindStateInVm(
        mockVm(""),
        { ...maxdepthFindNode(), argv: ["find", "/tmp/find-tree", "-type", "f", "-print"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveMaxdepthFindStateInVm(
        mockVm(""),
        {
          ...maxdepthFindNode(),
          argv: ["find", "/tmp/find-tree", "-maxdepth", "2", "-name", "*.txt", "-print"],
        },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveMaxdepthFindStateInVm(
        mockVm(""),
        {
          ...maxdepthFindNode(),
          argv: ["find", "../relative", "-maxdepth", "2", "-type", "f", "-print"],
        },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveMaxdepthFindStateInVm(
        mockVm("PATCH\tmaxdepth-find\trefused\tsymlink-entry-unsupported\n", 2),
        maxdepthFindNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures recursive grep state with literal pattern and stable text tree identity", async () => {
    const state = await readMoveRecursiveGrepStateInVm(
      mockVm(
        "2\n2\n42\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
      ),
      recursiveGrepNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/grep-r.out" },
        ],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits recursive grep state for complex options, unsafe pattern/path, binary, or changed preflight", async () => {
    await expect(
      readMoveRecursiveGrepStateInVm(
        mockVm(""),
        { ...recursiveGrepNode(), argv: ["grep", "-R", "needle", "/tmp/grep-tree"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRecursiveGrepStateInVm(
        mockVm(""),
        { ...recursiveGrepNode(), argv: ["grep", "-r", "n.*", "/tmp/grep-tree"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRecursiveGrepStateInVm(
        mockVm(""),
        { ...recursiveGrepNode(), argv: ["grep", "-r", "needle", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRecursiveGrepStateInVm(
        mockVm("PATCH\trecursive-grep\trefused\tbinary-file-unsupported\n", 2),
        recursiveGrepNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures realpath state with resolved path and symlink-chain identity", async () => {
    const state = await readMoveRealpathStateInVm(
      mockVm(
        "/tmp/realpath-dir/target.txt\n4\n1\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n24a913c38af0cc79508020fba78843450f499f04429c48e04d5f425f5a583658\n",
      ),
      realpathNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/realpath.out" },
        ],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits realpath state for missing paths, unsafe paths, unsupported options, or unresolved chains", async () => {
    await expect(
      readMoveRealpathStateInVm(
        mockVm(""),
        { ...realpathNode(), argv: ["realpath", "-m", "/tmp/realpath-link"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRealpathStateInVm(
        mockVm(""),
        { ...realpathNode(), argv: ["realpath", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveRealpathStateInVm(mockVm("realpath: missing\n", 1), realpathNode(), baseResourcePlan),
    ).resolves.toBeUndefined();
  });

  it("captures readlink state with direct literal symlink target", async () => {
    const state = await readMoveReadlinkStateInVm(
      mockVm(
        "target.txt\na1ff\n199b3badd968634ea14e351d1134ada738894a90a2efa66983101ece99a33572\n",
      ),
      readlinkNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/readlink.out" },
        ],
      },
    );

    expect(state).toMatchObject({
      linkPath: "/tmp/readlink-link",
      targetLiteral: "target.txt",
      linkIdentity: {
        mode: "a1ff",
        targetDigest: "199b3badd968634ea14e351d1134ada738894a90a2efa66983101ece99a33572",
      },
      options: [],
      policy: "direct-symlink-literal-target",
      outputPath: "/tmp/readlink.out",
    });
  });

  it("omits readlink state for canonicalization, unsafe paths, non-symlinks, or unsafe targets", async () => {
    await expect(
      readMoveReadlinkStateInVm(
        mockVm(""),
        { ...readlinkNode(), argv: ["readlink", "-f", "/tmp/readlink-link"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveReadlinkStateInVm(
        mockVm(""),
        { ...readlinkNode(), argv: ["readlink", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveReadlinkStateInVm(
        mockVm("PATCH\treadlink-direct\trefused\tunsafe-target-literal\n", 2),
        readlinkNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures stat state with default format and file identity", async () => {
    const state = await readMoveStatStateInVm(
      mockVm(
        "regular file\n81a4\n644\n12\n0\n0\n1770000000\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n",
      ),
      statNode(),
      {
        ...baseResourcePlan,
        resources: [{ id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/stat.out" }],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits stat state for custom formats, unsafe paths, symlinks, or preflight refusal", async () => {
    await expect(
      readMoveStatStateInVm(
        mockVm(""),
        { ...statNode(), argv: ["stat", "-c", "%s", "/tmp/stat-file.txt"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveStatStateInVm(
        mockVm(""),
        { ...statNode(), argv: ["stat", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveStatStateInVm(
        mockVm("PATCH\tstat-file\trefused\tunsupported-file-type\n", 2),
        statNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures du -sb state with tree identity and no-mount/symlink policy", async () => {
    const state = await readMoveDuStateInVm(
      mockVm(
        "65024\n4\n2\n2\n8266\n09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e\n4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe\n",
      ),
      duNode(),
      {
        ...baseResourcePlan,
        resources: [{ id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/du.out" }],
      },
    );

    expect(state).toMatchObject({
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
    });
  });

  it("omits du state for unsupported options, unsafe paths, symlinks, mount crossing, or changed preflight", async () => {
    await expect(
      readMoveDuStateInVm(
        mockVm(""),
        { ...duNode(), argv: ["du", "-sh", "/tmp/du-tree"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveDuStateInVm(
        mockVm(""),
        { ...duNode(), argv: ["du", "-sb", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveDuStateInVm(
        mockVm("PATCH\tdu-sb-dir\trefused\tsymlink-entry-unsupported\n", 2),
        duNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveDuStateInVm(
        mockVm("PATCH\tdu-sb-dir\trefused\tmount-crossing-unsupported\n", 2),
        duNode(),
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures ls -l state with explicit entries and owner/group mapping", async () => {
    const state = await readMoveLsLongStateInVm(
      mockVm(
        "65024\n9001\n41ed\n2\n09b3e1e1d395b9b90dc02ad53b5446094a7152c756ce328cf5423652ac68033e\n4783e784b4fa2fba9e4d6502dbc64f8f7e495b36b4b8992723f89cbf733a90fe\nalpha.txt\tfile\t81a4\t644\t5\t0\t0\troot\troot\t1770000000\nsubdir\tdirectory\t41ed\t755\t40\t0\t0\troot\troot\t1770000001\n",
      ),
      { ...lsNode(), argv: ["ls", "-l", "/tmp/ls-dir"] },
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      directoryPath: "/tmp/ls-dir",
      directoryIdentity: { entryCount: 2 },
      entries: [
        {
          name: "alpha.txt",
          kind: "file",
          permissions: "644",
          uid: 0,
          gid: 0,
          owner: "root",
          group: "root",
        },
        {
          name: "subdir",
          kind: "directory",
          permissions: "755",
          uid: 0,
          gid: 0,
          owner: "root",
          group: "root",
        },
      ],
      ordering: "LC_ALL=C-name-ascending",
      statPolicy: "regular-or-directory-no-symlinks-owner-group-mapped",
      options: ["-l"],
      policy: "ascii-names-non-recursive-long-listing",
    });
  });

  it("omits ls -l state for unsupported options, symlinks, unsafe paths, or mapping preflight refusal", async () => {
    await expect(
      readMoveLsLongStateInVm(
        mockVm(""),
        { ...lsNode(), argv: ["ls", "-la", "/tmp/ls-dir"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLsLongStateInVm(
        mockVm(""),
        { ...lsNode(), argv: ["ls", "-l", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLsLongStateInVm(
        mockVm("PATCH\tls-long-dir\trefused\tsymlink-entry-unsupported\n", 2),
        { ...lsNode(), argv: ["ls", "-l", "/tmp/ls-dir"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("omits ls state for color, recursive, unsafe paths, or locale-sensitive preflight refusal", async () => {
    await expect(
      readMoveLsStateInVm(
        mockVm(""),
        { ...lsNode(), argv: ["ls", "--color=always", "/tmp/ls-dir"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLsStateInVm(
        mockVm(""),
        { ...lsNode(), argv: ["ls", "-R", "/tmp/ls-dir"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLsStateInVm(
        mockVm(""),
        { ...lsNode(), argv: ["ls", "../relative"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveLsStateInVm(mockVm("", 2), lsNode(), baseResourcePlan),
    ).resolves.toBeUndefined();
  });

  it("captures install state with source identity, destination parent, and mode", async () => {
    const state = await readMoveInstallStateInVm(
      mockVm(
        "81a4\n12\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n123\n41ed\n5abfbed72420c5593885fd3777f3640645a5f1f274802c96896af5996407caa6\n",
      ),
      installNode(),
    );

    expect(state).toMatchObject({
      sourcePath: "/tmp/install-src.txt",
      destinationPath: "/tmp/install-parent/dest.txt",
      mode: "755",
      sourceIdentity: {
        mode: "81a4",
        size: 12,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      destinationParent: "/tmp/install-parent",
      destinationParentIdentity: { dev: "123", mode: "41ed" },
      policy: "copy-mode-absent-destination",
    });
  });

  it("omits install state for unsupported ownership/directory/options, unsafe paths, or preflight refusal", async () => {
    await expect(
      readMoveInstallStateInVm(mockVm(""), {
        ...installNode(),
        argv: ["install", "-o", "root", "-m", "755", "/tmp/a", "/tmp/b"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveInstallStateInVm(mockVm(""), {
        ...installNode(),
        argv: ["install", "-d", "/tmp/dir"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveInstallStateInVm(mockVm(""), {
        ...installNode(),
        argv: ["install", "-m", "u+x", "/tmp/a", "/tmp/b"],
      }),
    ).resolves.toBeUndefined();
    await expect(readMoveInstallStateInVm(mockVm("", 1), installNode())).resolves.toBeUndefined();
  });

  it("captures zip create state with source tree identity and absent archive policy", async () => {
    const state = await readMoveZipCreateStateInVm(
      mockVm("2\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      zipCreateNode(),
    );

    expect(state).toMatchObject({
      archivePath: "/tmp/archive.zip",
      sourceDir: "/tmp/zip-tree",
      sourceIdentity: { fileCount: 2 },
      policy: "safe-relative-regular-no-symlinks-absent-archive",
    });
  });

  it("omits zip create state for unsupported options or unsafe source preflight", async () => {
    await expect(
      readMoveZipCreateStateInVm(mockVm(""), {
        ...zipCreateNode(),
        argv: ["zip", "-9", "-r", "/tmp/archive.zip", "/tmp/zip-tree"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveZipCreateStateInVm(mockVm("", 1), zipCreateNode()),
    ).resolves.toBeUndefined();
  });

  it("captures tar extract state with safe archive identity and empty target policy", async () => {
    const state = await readMoveTarExtractStateInVm(
      mockVm("123\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n4\n"),
      tarExtractNode(),
    );

    expect(state).toMatchObject({
      archivePath: "/tmp/archive.tar",
      targetDir: "/tmp/extract",
      archiveIdentity: { size: 123 },
      entryCount: 4,
      policy: "safe-relative-regular-empty-target",
    });
  });

  it("omits tar extract state for unsupported options or unsafe archive preflight", async () => {
    await expect(
      readMoveTarExtractStateInVm(mockVm(""), {
        ...tarExtractNode(),
        argv: ["tar", "-xpf", "/tmp/archive.tar", "-C", "/tmp/extract"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      readMoveTarExtractStateInVm(mockVm("", 1), tarExtractNode()),
    ).resolves.toBeUndefined();
  });

  it("captures find root and last emitted path for the narrow supported shape", async () => {
    const state = await readMoveFindStateInVm(mockVm("/tmp/tree/file-010\n"), findNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find.out", offset: 190 },
      ],
    });

    expect(state).toMatchObject({
      rootPath: "/tmp/tree",
      outputPath: "/tmp/find.out",
      lastPath: "/tmp/tree/file-010",
    });
  });

  it("omits find state for complex predicates outside the narrow envelope", async () => {
    const state = await readMoveFindStateInVm(mockVm("/tmp/tree/file-010\n"), complexFindNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find.out", offset: 190 },
      ],
    });

    expect(state).toBeUndefined();
  });

  it("captures head line-count file shape with file identity", async () => {
    const state = await readMoveHeadStateInVm(
      mockVm("24\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      headNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/head.out", offset: 0 },
        ],
      },
    );

    expect(state).toMatchObject({
      path: "/tmp/head.in",
      lines: 3,
      fileIdentity: {
        size: 24,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/head.out",
    });
  });

  it("omits head state for stdin or unsupported argv shapes", async () => {
    await expect(
      readMoveHeadStateInVm(
        mockVm(""),
        { ...headNode(), argv: ["head", "-n", "3"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveHeadStateInVm(
        mockVm(""),
        { ...headNode(), argv: ["head", "-c", "3", "/tmp/head.in"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures tail non-follow line-count file shape with file identity", async () => {
    const state = await readMoveTailLinesStateInVm(
      mockVm("30\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      tailLinesNode(),
      {
        ...baseResourcePlan,
        resources: [
          {
            id: "stdout",
            fd: 1,
            kind: "file",
            state: "recipe",
            path: "/tmp/tail-lines.out",
            offset: 0,
          },
        ],
      },
    );

    expect(state).toMatchObject({
      path: "/tmp/tail-lines.in",
      lines: 2,
      fileIdentity: {
        size: 30,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      outputPath: "/tmp/tail-lines.out",
    });
  });

  it("omits tail non-follow state for follow or unsupported argv shapes", async () => {
    await expect(
      readMoveTailLinesStateInVm(
        mockVm(""),
        { ...tailLinesNode(), argv: ["tail", "-f", "/tmp/tail-lines.in"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveTailLinesStateInVm(
        mockVm(""),
        { ...tailLinesNode(), argv: ["tail", "-n", "2"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures awk field projection with default whitespace splitting and file identity", async () => {
    const state = await readMoveAwkFieldStateInVm(
      mockVm("42\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      awkFieldNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/awk-field.in",
      fieldIndex: 2,
      fs: "default-whitespace",
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits awk field state for arbitrary programs or field separators", async () => {
    for (const argv of [
      ["awk", '{print $2; system("id")}', "/tmp/awk-field.in"],
      ["awk", "-F,", "{print $2}", "/tmp/awk-field.in"],
      ["awk", "{print $0}", "/tmp/awk-field.in"],
      ["awk", "{print $2}"],
    ]) {
      await expect(
        readMoveAwkFieldStateInVm(mockVm(""), { ...awkFieldNode(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures cut delimiter and fields with file identity", async () => {
    const state = await readMoveCutStateInVm(
      mockVm("42\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      cutNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/cut.in",
      delimiter: ":",
      fields: "2",
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits cut state for stdin, missing delimiter, or unsafe fields", async () => {
    for (const argv of [
      ["cut", "-f", "2", "/tmp/cut.in"],
      ["cut", "-d", ":", "-f", "2"],
      ["cut", "-d", "::", "-f", "2", "/tmp/cut.in"],
      ["cut", "-d", ":", "-f", "2 --output-delimiter=,", "/tmp/cut.in"],
    ]) {
      await expect(
        readMoveCutStateInVm(mockVm(""), { ...cutNode(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures paste exactly two files with both file identities", async () => {
    const state = await readMovePasteStateInVm(
      mockVm("11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      pasteNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      leftPath: "/tmp/paste.left",
      rightPath: "/tmp/paste.right",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
      rightIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits paste state for stdin or unsupported arity", async () => {
    for (const argv of [
      ["paste", "/tmp/paste.left"],
      ["paste", "-", "/tmp/paste.right"],
      ["paste", "/tmp/paste.left", "/tmp/paste.right", "/tmp/paste.extra"],
    ]) {
      await expect(
        readMovePasteStateInVm(mockVm(""), { ...pasteNode(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures uniq file shape with count mode and file identity", async () => {
    const state = await readMoveUniqStateInVm(
      mockVm("42\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      uniqCountNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/uniq.in",
      count: true,
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits uniq state for stdin, unsupported flags, and multiple files", async () => {
    for (const argv of [
      ["uniq"],
      ["uniq", "-d", "/tmp/uniq.in"],
      ["uniq", "/tmp/uniq.in", "/tmp/uniq.extra"],
    ]) {
      await expect(
        readMoveUniqStateInVm(mockVm(""), { ...uniqCountNode(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures comm two sorted files with pinned collation and identities", async () => {
    const state = await readMoveCommStateInVm(
      mockVm("11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      commNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      leftPath: "/tmp/comm.left",
      rightPath: "/tmp/comm.right",
      collation: "C",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits comm state for unsupported arity", async () => {
    await expect(
      readMoveCommStateInVm(
        mockVm(""),
        { ...commNode(), argv: ["comm", "/tmp/comm.left"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures join default-key two sorted files with pinned collation and identities", async () => {
    const state = await readMoveJoinStateInVm(
      mockVm("11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      joinNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      leftPath: "/tmp/join.left",
      rightPath: "/tmp/join.right",
      key: "default-first-field",
      collation: "C",
      leftIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits join state for custom options or unsupported arity", async () => {
    for (const argv of [
      ["join", "-1", "2", "/tmp/join.left", "/tmp/join.right"],
      ["join", "/tmp/join.left"],
    ]) {
      await expect(
        readMoveJoinStateInVm(mockVm(""), { ...joinNode(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures sed print-range file shape with file identity", async () => {
    const state = await readMoveSedStateInVm(
      mockVm("42\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      sedPrintRangeNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/sed-range.in",
      scriptKind: "print-range",
      startLine: 2,
      endLine: 4,
      fileIdentity: {
        size: 42,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("captures sed literal-substitution file shape with file identity", async () => {
    const state = await readMoveSedStateInVm(
      mockVm("42\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      sedLiteralSubstitutionNode(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/sed-sub.in",
      scriptKind: "literal-substitution",
      pattern: "alpha",
      replacement: "omega",
    });
  });

  it("omits sed state for arbitrary scripts, regex flags, backrefs, and in-place mutation", async () => {
    for (const argv of [
      ["sed", "-i", "s/alpha/omega/", "/tmp/sed-sub.in"],
      ["sed", "s/a.*/omega/", "/tmp/sed-sub.in"],
      ["sed", "s/alpha/&-omega/", "/tmp/sed-sub.in"],
      ["sed", "s/alpha/omega/g", "/tmp/sed-sub.in"],
      ["sed", "-n", "4,2p", "/tmp/sed-range.in"],
    ]) {
      await expect(
        readMoveSedStateInVm(
          mockVm(""),
          { ...sedLiteralSubstitutionNode(), argv },
          baseResourcePlan,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("captures base64 file shape with fixed wrap policy and file identity", async () => {
    const state = await readMoveBase64StateInVm(
      mockVm("11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      base64Node(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      path: "/tmp/base64.in",
      wrap: 76,
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits base64 state for stdin or explicit wrap ambiguity", async () => {
    for (const argv of [["base64"], ["base64", "--wrap=0", "/tmp/base64.in"]]) {
      await expect(
        readMoveBase64StateInVm(mockVm(""), { ...base64Node(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("captures gzip -c file shape with stdout output path and atomic output policy", async () => {
    const state = await readMoveGzipStateInVm(
      mockVm("11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      gzipNode(),
      {
        ...baseResourcePlan,
        resources: [
          { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/gzip.out", offset: 0 },
        ],
      },
    );

    expect(state).toMatchObject({
      inputPath: "/tmp/gzip.in",
      outputPath: "/tmp/gzip.out",
      outputPolicy: "atomic-temp-rename",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits gzip state without -c file and stdout file path", async () => {
    await expect(
      readMoveGzipStateInVm(
        mockVm(""),
        { ...gzipNode(), argv: ["gzip", "/tmp/gzip.in"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveGzipStateInVm(mockVm(""), gzipNode(), baseResourcePlan),
    ).resolves.toBeUndefined();
  });

  it("captures gunzip, xz, and zstd -c file shapes with stdout output paths", async () => {
    const identity = "11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n";
    await expect(
      readMoveGunzipStateInVm(
        mockVm(identity),
        gunzipNode(),
        stdoutResourcePlan("/tmp/gunzip.out"),
      ),
    ).resolves.toMatchObject({
      inputPath: "/tmp/gunzip.in.gz",
      outputPath: "/tmp/gunzip.out",
      outputPolicy: "atomic-temp-rename",
      fileIdentity: { size: 11 },
    });
    await expect(
      readMoveXzStateInVm(mockVm(identity), xzNode(), stdoutResourcePlan("/tmp/xz.out")),
    ).resolves.toMatchObject({
      inputPath: "/tmp/xz.in",
      outputPath: "/tmp/xz.out",
      outputPolicy: "atomic-temp-rename",
      fileIdentity: { size: 11 },
    });
    await expect(
      readMoveZstdStateInVm(mockVm(identity), zstdNode(), stdoutResourcePlan("/tmp/zstd.out")),
    ).resolves.toMatchObject({
      inputPath: "/tmp/zstd.in",
      outputPath: "/tmp/zstd.out",
      outputPolicy: "atomic-temp-rename",
      fileIdentity: { size: 11 },
    });
  });

  it("omits gunzip, xz, and zstd state for unsupported options or missing stdout path", async () => {
    await expect(
      readMoveGunzipStateInVm(
        mockVm(""),
        { ...gunzipNode(), argv: ["gunzip", "-f", "-c", "/tmp/gunzip.in.gz"] },
        stdoutResourcePlan("/tmp/gunzip.out"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveXzStateInVm(mockVm(""), xzNode(), baseResourcePlan),
    ).resolves.toBeUndefined();
    await expect(
      readMoveZstdStateInVm(
        mockVm(""),
        { ...zstdNode(), argv: ["zstd", "-19", "-c", "/tmp/zstd.in"] },
        stdoutResourcePlan("/tmp/zstd.out"),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures generic checksum state for md5sum file shape", async () => {
    const state = await readMoveChecksumStateInVm(
      mockVmSequence([
        "900150983cd24fb0d6963f7d28e17f72\n",
        "11\nffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n",
      ]),
      md5Node(),
      baseResourcePlan,
    );

    expect(state).toMatchObject({
      algorithm: "md5",
      path: "/tmp/md5.in",
      expectedDigest: "900150983cd24fb0d6963f7d28e17f72",
      fileIdentity: {
        size: 11,
        sha256: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      },
    });
  });

  it("omits generic checksum state for stdin or multiple files", async () => {
    for (const argv of [["md5sum"], ["md5sum", "/tmp/md5.in", "/tmp/extra.in"]]) {
      await expect(
        readMoveChecksumStateInVm(mockVm(""), { ...md5Node(), argv }, baseResourcePlan),
      ).resolves.toBeUndefined();
    }
  });

  it("omits sha256sum state without exactly one explicit file path", async () => {
    await expect(
      readMoveSha256StateInVm(
        mockVm(""),
        { ...sha256Node(), argv: ["sha256sum"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSha256StateInVm(
        mockVm(""),
        { ...sha256Node(), argv: ["sha256sum", "/tmp/sha256.in", "/tmp/sha256.extra"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures sha256sum file shape", async () => {
    const state = await readMoveSha256StateInVm(
      mockVm("ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      sha256Node(),
      {
        ...baseResourcePlan,
        resources: [
          {
            id: "stdout",
            fd: 1,
            kind: "file",
            state: "recipe",
            path: "/tmp/sha256.out",
            offset: 0,
          },
        ],
      },
    );

    expect(state).toMatchObject({
      path: "/tmp/sha256.in",
      expectedDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      outputPath: "/tmp/sha256.out",
    });
  });

  it("omits wc state without an explicit file path", async () => {
    await expect(
      readMoveWcStateInVm(mockVm(""), { ...wcNode(), argv: ["wc", "-l"] }, baseResourcePlan),
    ).resolves.toBeUndefined();
  });

  it("captures wc line-count file shape", async () => {
    const state = await readMoveWcStateInVm(mockVm(""), wcNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/wc.out", offset: 0 },
      ],
    });

    expect(state).toMatchObject({
      path: "/tmp/wc.in",
      mode: "lines",
      outputPath: "/tmp/wc.out",
    });
  });

  it("omits sort state for output-same-as-input mutation shape", async () => {
    await expect(
      readMoveSortStateInVm(
        mockVm(""),
        { ...sortNode(), argv: ["sort", "-o", "/tmp/sort.in", "/tmp/sort.in"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures sort input and output path for the narrow deterministic file shape", async () => {
    const state = await readMoveSortStateInVm(mockVm(""), sortNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/sort.out", offset: 0 },
      ],
    });

    expect(state).toMatchObject({
      path: "/tmp/sort.in",
      outputPath: "/tmp/sort.out",
    });
  });

  it("captures mv source and destination for the narrow same-fs preflight shape", async () => {
    const state = await readMoveMvStateInVm(mockVm(""), mvNode());

    expect(state).toMatchObject({
      sourcePath: "/tmp/mv.in",
      destinationPath: "/tmp/mv.out",
    });
  });

  it("omits mv state when filesystem preflight fails", async () => {
    await expect(readMoveMvStateInVm(mockVm("", 1), mvNode())).resolves.toBeUndefined();
  });

  it("omits cp state for recursive copies outside the narrow envelope", () => {
    expect(
      readMoveCpState(
        { ...cpNode(), argv: ["cp", "-r", "/tmp/cp-dir", "/tmp/cp-out"] },
        baseResourcePlan,
      ),
    ).toBeUndefined();
  });

  it("captures cp source and destination offsets for the narrow supported shape", () => {
    const state = readMoveCpState(cpNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "src", fd: 4, kind: "file", state: "recipe", path: "/tmp/cp.in", offset: 8192 },
        { id: "dst", fd: 5, kind: "file", state: "recipe", path: "/tmp/cp.out", offset: 4096 },
      ],
    });

    expect(state).toMatchObject({
      sourcePath: "/tmp/cp.in",
      destinationPath: "/tmp/cp.out",
      sourceOffset: 8192,
      destinationOffset: 4096,
    });
  });

  it("captures dd read and write offsets for the narrow supported shape", () => {
    const state = readMoveDdState(ddNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "input", fd: 6, kind: "file", state: "recipe", path: "/tmp/dd.in", offset: 4096 },
        { id: "output", fd: 7, kind: "file", state: "recipe", path: "/tmp/dd.out", offset: 4096 },
      ],
    });

    expect(state).toMatchObject({
      inputPath: "/tmp/dd.in",
      outputPath: "/tmp/dd.out",
      blockSize: 1,
      inputOffset: 4096,
      outputOffset: 4096,
    });
  });

  it("captures the supported tail grep pipeline state", () => {
    const state = readMoveTailGrepPipelineState([shNode(), tailNode(), grepNode()], {
      ...baseResourcePlan,
      resources: [
        {
          id: "tail-file",
          fd: 6,
          kind: "file",
          state: "recipe",
          path: "/tmp/pipeline.txt",
          offset: 35,
        },
      ],
    });

    expect(state).toMatchObject({
      tailPath: "/tmp/pipeline.txt",
      offset: 35,
      pattern: "match",
      lineBuffered: true,
    });
  });

  it("refuses unsupported pipe graph shapes by omitting pipeline state", () => {
    const state = readMoveTailGrepPipelineState(
      [shNode(), tailNode(), grepNode(), extraGrepNode()],
      {
        ...baseResourcePlan,
        resources: [
          {
            id: "tail-file",
            fd: 6,
            kind: "file",
            state: "recipe",
            path: "/tmp/pipeline.txt",
            offset: 35,
          },
        ],
      },
    );

    expect(state).toBeUndefined();
  });
});

function mockVm(stdout = "12\n", exitCode = 0): VmHandle {
  return {
    execRaw: async () => ({ exitCode, stdout, stderr: "" }),
  } as unknown as VmHandle;
}

function mockVmSequence(stdout: string[], exitCode = 0): VmHandle {
  let index = 0;
  return {
    execRaw: async () => ({ exitCode, stdout: stdout[index++] ?? "", stderr: "" }),
  } as unknown as VmHandle;
}

function goStaticNode(): MovePidGraphNode {
  return {
    pid: 33,
    ppid: 1,
    command: "server",
    argv: [
      "/tmp/go-static/server",
      "--machinen-move-envelope",
      "go-static-http-v1",
      "--port",
      "8145",
      "--health",
      "/health",
    ],
    cwd: "/tmp/go-static",
    exe: "/tmp/go-static/server",
  };
}

function rustStaticNode(): MovePidGraphNode {
  return {
    pid: 34,
    ppid: 1,
    command: "server",
    argv: [
      "/tmp/rust-static/server",
      "--machinen-move-envelope",
      "rust-static-http-v1",
      "--port",
      "8148",
      "--health",
      "/health",
    ],
    cwd: "/tmp/rust-static",
    exe: "/tmp/rust-static/server",
  };
}

function pythonStaticRouteNode(): MovePidGraphNode {
  return {
    pid: 32,
    ppid: 1,
    command: "python3",
    argv: ["python3", "/tmp/python-static/server.py"],
    cwd: "/tmp/python-static",
    exe: "/usr/bin/python3",
  };
}

function nodeStaticArgvNode(): MovePidGraphNode {
  return {
    pid: 31,
    ppid: 1,
    command: "node",
    argv: [
      "node",
      "/tmp/node-argv-static/server.mjs",
      "--port",
      "8140",
      "--root",
      "/tmp/node-argv-static/public",
    ],
    cwd: "/tmp/node-argv-static",
    exe: "/usr/bin/node",
  };
}

function nodeStaticNode(): MovePidGraphNode {
  return {
    pid: 20,
    ppid: 1,
    command: "node",
    argv: ["node", "/tmp/node-static/server.mjs"],
    cwd: "/tmp/node-static",
    exe: "/usr/bin/node",
  };
}

function httpResourcePlan(socketCount: number): MoveResourcePlan {
  return {
    ...baseResourcePlan,
    resources: Array.from({ length: socketCount }, (_, index) => ({
      id: `socket-${index}`,
      fd: 4 + index,
      kind: "socket" as const,
      state: "captured" as const,
      path: `socket:[${index}]`,
    })),
  };
}

function timeoutNode(): MovePidGraphNode {
  return {
    pid: 29,
    ppid: 1,
    command: "timeout",
    argv: [
      "timeout",
      "30",
      "python3",
      "-m",
      "http.server",
      "--directory",
      "/tmp/timeout-web",
      "8138",
      "--bind",
      "127.0.0.1",
    ],
    cwd: "/",
    exe: "/usr/bin/timeout",
  };
}

function timeoutChildNode(): MovePidGraphNode {
  return {
    pid: 30,
    ppid: 29,
    command: "python3",
    argv: [
      "python3",
      "-m",
      "http.server",
      "--directory",
      "/tmp/timeout-web",
      "8138",
      "--bind",
      "127.0.0.1",
    ],
    cwd: "/",
    exe: "/usr/bin/python3",
  };
}

function ncNode(): MovePidGraphNode {
  return {
    pid: 28,
    ppid: 1,
    command: "nc",
    argv: ["nc", "-l", "8135"],
    cwd: "/",
    exe: "/usr/bin/nc.openbsd",
  };
}

function rsyncNode(): MovePidGraphNode {
  return {
    pid: 8181,
    ppid: 1,
    command: "rsync",
    argv: ["rsync", "--daemon", "--no-detach", "--config", "/tmp/rsyncd.conf"],
    cwd: "/",
    exe: "/usr/bin/rsync",
  };
}

function phpStaticNode(): MovePidGraphNode {
  return {
    pid: 8175,
    ppid: 1,
    command: "php",
    argv: ["php", "-S", "127.0.0.1:8175", "-t", "/tmp/php-root"],
    cwd: "/",
    exe: "/usr/bin/php",
  };
}

function rubyHttpNode(): MovePidGraphNode {
  return {
    pid: 8170,
    ppid: 1,
    command: "ruby",
    argv: ["ruby", "-run", "-e", "httpd", "/tmp/ruby-root", "-p", "8170"],
    cwd: "/",
    exe: "/usr/bin/ruby",
  };
}

function caddyNode(): MovePidGraphNode {
  return {
    pid: 8165,
    ppid: 1,
    command: "caddy",
    argv: ["caddy", "file-server", "--listen", ":8165", "--root", "/tmp/caddy-root"],
    cwd: "/",
    exe: "/usr/bin/caddy",
  };
}

function nginxNode(): MovePidGraphNode {
  return {
    pid: 8160,
    ppid: 1,
    command: "nginx",
    argv: ["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"],
    cwd: "/",
    exe: "/usr/sbin/nginx",
  };
}

function redisNode(): MovePidGraphNode {
  return {
    pid: 87,
    ppid: 1,
    command: "redis-server",
    argv: ["redis-server", "--save", "", "--appendonly", "no", "--port", "8153"],
    cwd: "/",
    exe: "/usr/bin/redis-server",
  };
}

function socatNode(): MovePidGraphNode {
  return {
    pid: 84,
    ppid: 1,
    command: "socat",
    argv: ["socat", "TCP-LISTEN:8147,fork,reuseaddr", "FILE:/tmp/socat-response.txt"],
    cwd: "/",
    exe: "/usr/bin/socat",
  };
}

function busyboxNcNode(): MovePidGraphNode {
  return {
    pid: 83,
    ppid: 1,
    command: "busybox",
    argv: ["busybox", "nc", "-l", "-p", "8142"],
    cwd: "/",
    exe: "/usr/bin/busybox",
  };
}

function busyboxHttpNode(): MovePidGraphNode {
  return {
    pid: 27,
    ppid: 1,
    command: "busybox",
    argv: ["busybox", "httpd", "-f", "-p", "8134", "-h", "/tmp/busybox-web"],
    cwd: "/",
    exe: "/usr/bin/busybox",
  };
}

function httpDirectoryNode(): MovePidGraphNode {
  return {
    pid: 26,
    ppid: 1,
    command: "python3",
    argv: ["python3", "-m", "http.server", "--directory", "/tmp/web-directory", "8128"],
    cwd: "/",
    exe: "/usr/bin/python3",
  };
}

function httpNode(): MovePidGraphNode {
  return {
    pid: 19,
    ppid: 1,
    command: "python3",
    argv: ["python3", "-m", "http.server", "8123", "--bind", "127.0.0.1"],
    cwd: "/tmp/web",
    exe: "/usr/bin/python3",
  };
}

function awkFieldNode(): MovePidGraphNode {
  return {
    pid: 31,
    ppid: 1,
    command: "awk",
    argv: ["awk", "{print $2}", "/tmp/awk-field.in"],
    cwd: "/",
    exe: "/usr/bin/awk",
  };
}

function cutNode(): MovePidGraphNode {
  return {
    pid: 30,
    ppid: 1,
    command: "cut",
    argv: ["cut", "-d", ":", "-f", "2", "/tmp/cut.in"],
    cwd: "/",
    exe: "/usr/bin/cut",
  };
}

function commNode(): MovePidGraphNode {
  return {
    pid: 35,
    ppid: 1,
    command: "comm",
    argv: ["comm", "/tmp/comm.left", "/tmp/comm.right"],
    cwd: "/",
    exe: "/usr/bin/comm",
  };
}

function joinNode(): MovePidGraphNode {
  return {
    pid: 34,
    ppid: 1,
    command: "join",
    argv: ["join", "/tmp/join.left", "/tmp/join.right"],
    cwd: "/",
    exe: "/usr/bin/join",
  };
}

function pasteNode(): MovePidGraphNode {
  return {
    pid: 33,
    ppid: 1,
    command: "paste",
    argv: ["paste", "/tmp/paste.left", "/tmp/paste.right"],
    cwd: "/",
    exe: "/usr/bin/paste",
  };
}

function uniqCountNode(): MovePidGraphNode {
  return {
    pid: 32,
    ppid: 1,
    command: "uniq",
    argv: ["uniq", "-c", "/tmp/uniq.in"],
    cwd: "/",
    exe: "/usr/bin/uniq",
  };
}

function sedPrintRangeNode(): MovePidGraphNode {
  return {
    pid: 29,
    ppid: 1,
    command: "sed",
    argv: ["sed", "-n", "2,4p", "/tmp/sed-range.in"],
    cwd: "/",
    exe: "/usr/bin/sed",
  };
}

function sedLiteralSubstitutionNode(): MovePidGraphNode {
  return {
    pid: 28,
    ppid: 1,
    command: "sed",
    argv: ["sed", "s/alpha/omega/", "/tmp/sed-sub.in"],
    cwd: "/",
    exe: "/usr/bin/sed",
  };
}

function headNode(): MovePidGraphNode {
  return {
    pid: 27,
    ppid: 1,
    command: "head",
    argv: ["head", "-n", "3", "/tmp/head.in"],
    cwd: "/",
    exe: "/usr/bin/head",
  };
}

function tailLinesNode(): MovePidGraphNode {
  return {
    pid: 26,
    ppid: 1,
    command: "tail",
    argv: ["tail", "-n", "2", "/tmp/tail-lines.in"],
    cwd: "/",
    exe: "/usr/bin/tail",
  };
}

function base64Node(): MovePidGraphNode {
  return {
    pid: 30,
    ppid: 1,
    command: "base64",
    argv: ["base64", "/tmp/base64.in"],
    cwd: "/",
    exe: "/usr/bin/base64",
  };
}

function gzipNode(): MovePidGraphNode {
  return {
    pid: 29,
    ppid: 1,
    command: "gzip",
    argv: ["gzip", "-c", "/tmp/gzip.in"],
    cwd: "/",
    exe: "/usr/bin/gzip",
  };
}

function gunzipNode(): MovePidGraphNode {
  return {
    pid: 31,
    ppid: 1,
    command: "gunzip",
    argv: ["gunzip", "-c", "/tmp/gunzip.in.gz"],
    cwd: "/",
    exe: "/usr/bin/gunzip",
  };
}

function xzNode(): MovePidGraphNode {
  return {
    pid: 32,
    ppid: 1,
    command: "xz",
    argv: ["xz", "-c", "/tmp/xz.in"],
    cwd: "/",
    exe: "/usr/bin/xz",
  };
}

function zstdNode(): MovePidGraphNode {
  return {
    pid: 33,
    ppid: 1,
    command: "zstd",
    argv: ["zstd", "-c", "/tmp/zstd.in"],
    cwd: "/",
    exe: "/usr/bin/zstd",
  };
}

function stdoutResourcePlan(path: string): MoveResourcePlan {
  return {
    ...baseResourcePlan,
    resources: [{ id: "stdout", fd: 1, kind: "file", state: "recipe", path, offset: 0 }],
  };
}

function md5Node(): MovePidGraphNode {
  return {
    pid: 28,
    ppid: 1,
    command: "md5sum",
    argv: ["md5sum", "/tmp/md5.in"],
    cwd: "/",
    exe: "/usr/bin/md5sum",
  };
}

function sha256Node(): MovePidGraphNode {
  return {
    pid: 25,
    ppid: 1,
    command: "sha256sum",
    argv: ["sha256sum", "/tmp/sha256.in"],
    cwd: "/",
    exe: "/usr/bin/sha256sum",
  };
}

function wcNode(): MovePidGraphNode {
  return {
    pid: 24,
    ppid: 1,
    command: "wc",
    argv: ["wc", "-l", "/tmp/wc.in"],
    cwd: "/",
    exe: "/usr/bin/wc",
  };
}

function sortNode(): MovePidGraphNode {
  return {
    pid: 23,
    ppid: 1,
    command: "sort",
    argv: ["sort", "/tmp/sort.in"],
    cwd: "/",
    exe: "/usr/bin/sort",
  };
}

function mvNode(): MovePidGraphNode {
  return {
    pid: 22,
    ppid: 1,
    command: "mv",
    argv: ["mv", "/tmp/mv.in", "/tmp/mv.out"],
    cwd: "/",
    exe: "/usr/bin/mv",
  };
}

function cpNode(): MovePidGraphNode {
  return {
    pid: 21,
    ppid: 1,
    command: "cp",
    argv: ["cp", "/tmp/cp.in", "/tmp/cp.out"],
    cwd: "/",
    exe: "/usr/bin/cp",
  };
}

function tarNode(): MovePidGraphNode {
  return {
    pid: 18,
    ppid: 1,
    command: "tar",
    argv: ["tar", "-cf", "/tmp/archive.tar", "/tmp/tar-tree"],
    cwd: "/",
    exe: "/usr/bin/tar",
  };
}

function tarExtractNode(): MovePidGraphNode {
  return {
    pid: 19,
    ppid: 1,
    command: "tar",
    argv: ["tar", "-xf", "/tmp/archive.tar", "-C", "/tmp/extract"],
    cwd: "/",
    exe: "/usr/bin/tar",
  };
}

function zipCreateNode(): MovePidGraphNode {
  return {
    pid: 20,
    ppid: 1,
    command: "zip",
    argv: ["zip", "-r", "/tmp/archive.zip", "/tmp/zip-tree"],
    cwd: "/",
    exe: "/usr/bin/zip",
  };
}

function mkdirNode(): MovePidGraphNode {
  return {
    pid: 24,
    ppid: 1,
    command: "mkdir",
    argv: ["mkdir", "/tmp/mkdir-parent/newdir"],
    cwd: "/",
    exe: "/usr/bin/mkdir",
  };
}

function mkdirParentsNode(): MovePidGraphNode {
  return {
    pid: 25,
    ppid: 1,
    command: "mkdir",
    argv: ["mkdir", "-p", "/tmp/mkdirp-root/nested/leaf"],
    cwd: "/",
    exe: "/usr/bin/mkdir",
  };
}

function touchNode(): MovePidGraphNode {
  return {
    pid: 26,
    ppid: 1,
    command: "touch",
    argv: ["touch", "-t", "202606101234.56", "/tmp/touch-parent/new-file"],
    cwd: "/",
    exe: "/usr/bin/touch",
  };
}

function touchDefaultNode(): MovePidGraphNode {
  return {
    ...touchNode(),
    argv: ["touch", "/tmp/touch-parent/new-file"],
  };
}

function chmodNode(): MovePidGraphNode {
  return {
    pid: 27,
    ppid: 1,
    command: "chmod",
    argv: ["chmod", "600", "/tmp/chmod-target.txt"],
    cwd: "/",
    exe: "/usr/bin/chmod",
  };
}

function chownNode(): MovePidGraphNode {
  return {
    pid: 28,
    ppid: 1,
    command: "chown",
    argv: ["chown", "nobody:nogroup", "/tmp/chown-target.txt"],
    cwd: "/",
    exe: "/usr/bin/chown",
  };
}

function linkNode(): MovePidGraphNode {
  return {
    pid: 29,
    ppid: 1,
    command: "ln",
    argv: ["ln", "/tmp/link-source.txt", "/tmp/link-dest.txt"],
    cwd: "/",
    exe: "/usr/bin/ln",
  };
}

function symlinkNode(): MovePidGraphNode {
  return {
    pid: 30,
    ppid: 1,
    command: "ln",
    argv: ["ln", "-s", "/tmp/symlink-target.txt", "/tmp/symlink-parent/link.txt"],
    cwd: "/",
    exe: "/usr/bin/ln",
  };
}

function rmNode(): MovePidGraphNode {
  return {
    pid: 31,
    ppid: 1,
    command: "rm",
    argv: ["rm", "/tmp/rm-parent/victim.txt"],
    cwd: "/",
    exe: "/usr/bin/rm",
  };
}

function rmdirNode(): MovePidGraphNode {
  return {
    pid: 32,
    ppid: 1,
    command: "rmdir",
    argv: ["rmdir", "/tmp/rmdir-parent/empty"],
    cwd: "/",
    exe: "/usr/bin/rmdir",
  };
}

function treeNode(): MovePidGraphNode {
  return {
    pid: 42,
    ppid: 1,
    command: "tree",
    argv: ["tree", "/tmp/tree-proof-root"],
    cwd: "/",
    exe: "/usr/bin/tree",
  };
}

function findPredicateNode(): MovePidGraphNode {
  return {
    pid: 41,
    ppid: 1,
    command: "find",
    argv: ["find", "/tmp/find-predicate-tree", "-size", "+4c", "-type", "f", "-print"],
    cwd: "/",
    exe: "/usr/bin/find",
  };
}

function maxdepthFindNode(): MovePidGraphNode {
  return {
    pid: 40,
    ppid: 1,
    command: "find",
    argv: ["find", "/tmp/find-tree", "-maxdepth", "2", "-type", "f", "-print"],
    cwd: "/",
    exe: "/usr/bin/find",
  };
}

function recursiveGrepNode(): MovePidGraphNode {
  return {
    pid: 39,
    ppid: 1,
    command: "grep",
    argv: ["grep", "-r", "needle", "/tmp/grep-tree"],
    cwd: "/",
    exe: "/usr/bin/grep",
  };
}

function realpathNode(): MovePidGraphNode {
  return {
    pid: 38,
    ppid: 1,
    command: "realpath",
    argv: ["realpath", "/tmp/realpath-link"],
    cwd: "/work",
    exe: "/usr/bin/realpath",
  };
}

function readlinkNode(): MovePidGraphNode {
  return {
    pid: 37,
    ppid: 1,
    command: "readlink",
    argv: ["readlink", "/tmp/readlink-link"],
    cwd: "/",
    exe: "/usr/bin/readlink",
  };
}

function statNode(): MovePidGraphNode {
  return {
    pid: 36,
    ppid: 1,
    command: "stat",
    argv: ["stat", "/tmp/stat-file.txt"],
    cwd: "/",
    exe: "/usr/bin/stat",
  };
}

function duNode(): MovePidGraphNode {
  return {
    pid: 35,
    ppid: 1,
    command: "du",
    argv: ["du", "-sb", "/tmp/du-tree"],
    cwd: "/",
    exe: "/usr/bin/du",
  };
}

function lsNode(): MovePidGraphNode {
  return {
    pid: 34,
    ppid: 1,
    command: "ls",
    argv: ["ls", "/tmp/ls-dir"],
    cwd: "/",
    exe: "/usr/bin/ls",
  };
}

function installNode(): MovePidGraphNode {
  return {
    pid: 33,
    ppid: 1,
    command: "install",
    argv: ["install", "-m", "755", "/tmp/install-src.txt", "/tmp/install-parent/dest.txt"],
    cwd: "/",
    exe: "/usr/bin/install",
  };
}

function findNode(): MovePidGraphNode {
  return {
    pid: 16,
    ppid: 1,
    command: "find",
    argv: ["find", "/tmp/tree", "-type", "f", "-print"],
    cwd: "/",
    exe: "/usr/bin/find",
  };
}

function complexFindNode(): MovePidGraphNode {
  return {
    ...findNode(),
    argv: ["find", "/tmp/tree", "-type", "f", "-name", "*.txt", "-print"],
  };
}

function shNode(): MovePidGraphNode {
  return {
    pid: 10,
    ppid: 1,
    command: "sh",
    argv: ["sh", "-c", "tail -f /tmp/pipeline.txt | grep --line-buffered match"],
    cwd: "/",
    exe: "/usr/bin/dash",
  };
}

function catNode(): MovePidGraphNode {
  return {
    pid: 11,
    ppid: 1,
    command: "cat",
    argv: ["cat", "/tmp/cat.txt"],
    cwd: "/",
    exe: "/usr/bin/cat",
  };
}

function ddNode(): MovePidGraphNode {
  return {
    pid: 15,
    ppid: 1,
    command: "dd",
    argv: ["dd", "if=/tmp/dd.in", "of=/tmp/dd.out", "bs=1"],
    cwd: "/",
    exe: "/usr/bin/dd",
  };
}

function tailNode(): MovePidGraphNode {
  return {
    pid: 12,
    ppid: 10,
    command: "tail",
    argv: ["tail", "-n", "+1", "-f", "/tmp/pipeline.txt"],
    cwd: "/",
    exe: "/usr/bin/tail",
  };
}

function grepNode(): MovePidGraphNode {
  return {
    pid: 13,
    ppid: 10,
    command: "grep",
    argv: ["grep", "--line-buffered", "match"],
    cwd: "/",
    exe: "/usr/bin/grep",
  };
}

function extraGrepNode(): MovePidGraphNode {
  return {
    pid: 14,
    ppid: 10,
    command: "grep",
    argv: ["grep", "line"],
    cwd: "/",
    exe: "/usr/bin/grep",
  };
}
