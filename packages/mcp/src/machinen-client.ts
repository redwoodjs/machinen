import { spawn } from "node:child_process";
import { connect as connectSocket, type Socket } from "node:net";

export type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface MachinenResponse {
  type: "response";
  id: string | number;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: JsonObject;
  };
}

interface MachinenEvent {
  type: "event";
  seq: number;
  event: string;
  data: JsonObject;
}

interface OutputBuffer {
  data: Buffer;
  startCursor: number;
  endCursor: number;
}

export interface TerminalOutput {
  terminalId: string;
  startCursor: number;
  endCursor: number;
  truncated: boolean;
  text: string;
  dataBase64: string;
}

export interface TerminalWaitOptions {
  terminalId: string;
  contains?: string;
  processState?: string;
  timeoutMilliseconds?: number;
  afterCursor?: number;
}

const protocolVersion = 1;
const maximumBufferedOutputBytes = 256 * 1024;

function defaultSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return process.env.MACHINEN_API_SOCKET ?? `/tmp/machinen-${uid}/api-v1.sock`;
}

export class MachinenClient {
  readonly socketPath: string;

  private socket?: Socket;
  private connectPromise?: Promise<void>;
  private ready = false;
  private inputBuffer = "";
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private output = new Map<string, OutputBuffer>();
  private terminalStates = new Map<string, string>();
  private eventRevision = 0;
  private eventWaiters = new Set<() => void>();

  constructor(socketPath = defaultSocketPath()) {
    this.socketPath = socketPath;
  }

  async request(
    operation: string,
    params: JsonObject = {},
    idempotencyKey?: string,
  ): Promise<unknown> {
    await this.ensureConnected();
    return this.sendRequest(operation, params, idempotencyKey);
  }

  readTerminalOutput(terminalId: string, afterCursor?: number): TerminalOutput {
    const current = this.output.get(terminalId) ?? {
      data: Buffer.alloc(0),
      startCursor: 0,
      endCursor: 0,
    };
    const requestedCursor = afterCursor ?? current.startCursor;
    const effectiveCursor = Math.max(requestedCursor, current.startCursor);
    const offset = Math.min(current.data.length, effectiveCursor - current.startCursor);
    const selected = current.data.subarray(offset);
    return {
      terminalId,
      startCursor: effectiveCursor,
      endCursor: current.endCursor,
      truncated: requestedCursor < current.startCursor,
      text: selected.toString("utf8"),
      dataBase64: selected.toString("base64"),
    };
  }

  async waitForTerminal(options: TerminalWaitOptions): Promise<JsonObject> {
    this.validateWaitOptions(options);
    const timeout = Math.min(Math.max(options.timeoutMilliseconds ?? 30_000, 1), 300_000);
    const deadline = Date.now() + timeout;
    await this.refreshTerminalState(options.terminalId);

    while (true) {
      const revision = this.eventRevision;
      const match = this.matchTerminalWait(options);
      if (match) {
        return match;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw this.terminalWaitTimeout(options);
      }
      if (revision !== this.eventRevision) {
        continue;
      }
      await this.waitForEvent(remaining).catch(() => undefined);
    }
  }

  private validateWaitOptions(options: TerminalWaitOptions): void {
    if (!options.contains && !options.processState) {
      throw new Error("terminal_wait requires contains or processState");
    }
  }

  private async refreshTerminalState(terminalId: string): Promise<void> {
    const terminal = (await this.request("terminal.get", { terminalId })) as JsonObject;
    if (typeof terminal.processState === "string") {
      this.terminalStates.set(terminalId, terminal.processState);
    }
  }

  private matchTerminalWait(options: TerminalWaitOptions): JsonObject | undefined {
    const output = this.readTerminalOutput(options.terminalId, options.afterCursor);
    const processState = this.terminalStates.get(options.terminalId);
    const outputMatches = !options.contains || output.text.includes(options.contains);
    const stateMatches = !options.processState || processState === options.processState;
    if (!outputMatches || !stateMatches) {
      return undefined;
    }
    return {
      terminalId: options.terminalId,
      matched: true,
      processState: processState ?? null,
      output,
    };
  }

  private terminalWaitTimeout(options: TerminalWaitOptions): Error {
    const output = options.contains ? ` to output ${JSON.stringify(options.contains)}` : "";
    const state = options.processState ? ` to reach ${options.processState}` : "";
    return new Error(`Timed out waiting for terminal ${options.terminalId}${output}${state}`);
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
    this.connectPromise = undefined;
    this.ready = false;
    this.rejectPending(new Error("Machinen connection closed"));
  }

  private async ensureConnected(): Promise<void> {
    if (this.ready && this.socket && !this.socket.destroyed) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.establishConnection().finally(() => {
        this.connectPromise = undefined;
      });
    }
    await this.connectPromise;
  }

  private async establishConnection(): Promise<void> {
    let socket: Socket;
    try {
      socket = await this.connectOnce();
    } catch (error) {
      if (!this.shouldTryLaunching(error)) {
        throw this.connectionError(error);
      }
      this.launchMachinen();
      socket = await this.waitForSocket();
    }
    this.attachSocket(socket);
    try {
      await this.sendRequest("system.hello", {
        client: { name: "machinen-mcp", version: "0.1.0" },
        protocol: { min: protocolVersion, max: protocolVersion },
      });
      const subscription = (await this.sendRequest("events.subscribe", {
        events: ["workspace.*", "tile.*", "terminal.*", "ui.changed"],
        includeOutput: true,
        includeSnapshot: true,
      })) as JsonObject;
      this.recordSnapshot(subscription.snapshot);
      this.ready = true;
    } catch (error) {
      if (this.socket === socket) {
        this.socket = undefined;
      }
      socket.destroy();
      throw error;
    }
  }

  private connectOnce(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connectSocket(this.socketPath);
      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    });
  }

  private async waitForSocket(): Promise<Socket> {
    const deadline = Date.now() + 8_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        return await this.connectOnce();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw this.connectionError(lastError);
  }

  private shouldTryLaunching(error: unknown): boolean {
    if (process.env.MACHINEN_MCP_NO_LAUNCH === "1" || process.platform !== "darwin") {
      return false;
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === "ENOENT" || code === "ECONNREFUSED";
  }

  private launchMachinen(): void {
    const appPath = process.env.MACHINEN_APP_PATH;
    const inheritedEnvironment = ["MACHINEN_API_SOCKET", "MACHINEN_STATE_DIR"].flatMap((name) =>
      process.env[name] ? ["--env", `${name}=${process.env[name]}`] : [],
    );
    const args = appPath
      ? [...inheritedEnvironment, appPath]
      : [...inheritedEnvironment, "-a", "Machinen"];
    const child = spawn("/usr/bin/open", args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private connectionError(error: unknown): Error {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return new Error(
      `Cannot connect to Machinen at ${this.socketPath}${detail}. ` +
        "Open Machinen Desktop or set MACHINEN_APP_PATH.",
    );
  }

  private attachSocket(socket: Socket): void {
    this.socket = socket;
    this.inputBuffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("error", (error) => this.handleDisconnect(socket, error));
    socket.on("close", () => this.handleDisconnect(socket, new Error("Machinen disconnected")));
  }

  private sendRequest(
    operation: string,
    params: JsonObject,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(this.connectionError(undefined));
    }
    const id = String(++this.requestCounter);
    const request: JsonObject = {
      v: protocolVersion,
      type: "request",
      id,
      op: operation,
      params,
    };
    if (idempotencyKey) {
      request.idempotencyKey = idempotencyKey;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) {
          return;
        }
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private receive(chunk: string): void {
    this.inputBuffer += chunk;
    while (true) {
      const newline = this.inputBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.inputBuffer.slice(0, newline);
      this.inputBuffer = this.inputBuffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.handleDisconnect(this.socket, new Error("Machinen sent invalid JSON"));
        return;
      }
      if (!message || typeof message !== "object") {
        continue;
      }
      const envelope = message as MachinenResponse | MachinenEvent;
      if (envelope.type === "response") {
        this.receiveResponse(envelope);
      }
      if (envelope.type === "event") {
        this.receiveEvent(envelope);
      }
    }
  }

  private receiveResponse(response: MachinenResponse): void {
    const pending = this.pending.get(String(response.id));
    if (!pending) {
      return;
    }
    this.pending.delete(String(response.id));
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }
    const code = response.error?.code ? `${response.error.code}: ` : "";
    pending.reject(new Error(`${code}${response.error?.message ?? "Machinen request failed"}`));
  }

  private receiveEvent(event: MachinenEvent): void {
    if (event.event === "terminal.output") {
      const terminalId = event.data.terminalId;
      const encoded = event.data.dataBase64;
      if (typeof terminalId === "string" && typeof encoded === "string") {
        this.appendOutput(terminalId, Buffer.from(encoded, "base64"));
      }
    }
    if (event.event === "terminal.stateChanged") {
      const terminalId = event.data.id ?? event.data.terminalId;
      const processState = event.data.processState;
      if (typeof terminalId === "string" && typeof processState === "string") {
        this.terminalStates.set(terminalId, processState);
      }
    }
    this.notifyEventWaiters();
  }

  private appendOutput(terminalId: string, addition: Buffer): void {
    const current = this.output.get(terminalId) ?? {
      data: Buffer.alloc(0),
      startCursor: 0,
      endCursor: 0,
    };
    current.data = Buffer.concat([current.data, addition]);
    current.endCursor += addition.length;
    if (current.data.length > maximumBufferedOutputBytes) {
      const remove = current.data.length - maximumBufferedOutputBytes;
      current.data = current.data.subarray(remove);
      current.startCursor += remove;
    }
    this.output.set(terminalId, current);
  }

  private recordSnapshot(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }
    const terminals = (value as JsonObject).terminals;
    if (!Array.isArray(terminals)) {
      return;
    }
    for (const terminal of terminals) {
      if (!terminal || typeof terminal !== "object") {
        continue;
      }
      const object = terminal as JsonObject;
      if (typeof object.id === "string" && typeof object.processState === "string") {
        this.terminalStates.set(object.id, object.processState);
      }
    }
  }

  private waitForEvent(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.eventWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(() => {
        this.eventWaiters.delete(done);
        reject(new Error("Timed out waiting for a Machinen event"));
      }, timeout);
      this.eventWaiters.add(done);
    });
  }

  private notifyEventWaiters(): void {
    this.eventRevision += 1;
    for (const waiter of this.eventWaiters) {
      waiter();
    }
  }

  private handleDisconnect(socket: Socket | undefined, error: Error): void {
    if (socket !== this.socket) {
      return;
    }
    this.socket = undefined;
    this.ready = false;
    socket?.destroy();
    this.rejectPending(error);
    this.notifyEventWaiters();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
