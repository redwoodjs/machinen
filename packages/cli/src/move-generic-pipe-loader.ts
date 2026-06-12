import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type GenericState = NonNullable<
  NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>["genericResourceGraphState"]
>;
type GenericPipeGraph = NonNullable<GenericState["pipeGraph"]>;

type GenericPipe = GenericPipeGraph["pipes"][number];

export function genericPipePreflightCommands(state: GenericState): string[] {
  const pipe = supportedPipe(state);
  return pipe ? pipeLifecyclePreflight(pipe) : [];
}

export function genericPipeLaunchCommand(state: GenericState): string | undefined {
  const pipe = supportedPipe(state);
  if (!pipe) {
    return undefined;
  }
  return pipe.lifecycle === "finite-replay"
    ? finitePipeReplayLaunchCommand(state, pipe)
    : longRunningPipePairLaunchCommand(state, pipe);
}

function supportedPipe(state: GenericState): GenericPipe | undefined {
  return state.pipeGraph?.pipes.find(
    (pipe) =>
      pipe.topology === "one-producer-one-consumer" &&
      pipe.lifecycle !== "refused" &&
      pipe.bufferedDataPolicy !== "refused-unknown",
  );
}

function pipeLifecyclePreflight(pipe: GenericPipe): string[] {
  return pipe.lifecycle === "finite-replay"
    ? finitePipeReplayPreflight(pipe)
    : longRunningPipePairPreflight(pipe);
}

function finitePipeReplayPreflight(pipe: GenericPipe): string[] {
  return pipe.capturedBytesBase64 ? [] : ["fail pipe-captured-bytes-missing"];
}

function longRunningPipePairPreflight(pipe: GenericPipe): string[] {
  const producer = pipe.writeFds[0]?.argv?.[0];
  return producer
    ? [`test -x ${shellQuote(producer)} || fail pipe-producer-missing`]
    : ["fail pipe-producer-missing"];
}

function finitePipeReplayLaunchCommand(state: GenericState, pipe: GenericPipe): string {
  const payload = pipe.capturedBytesBase64 ?? "";
  return `(printf %s ${shellQuote(payload)} | base64 -d | ${state.argv.map(shellQuote).join(" ")} >"$log" 2>&1) &
pid=$!`;
}

function longRunningPipePairLaunchCommand(state: GenericState, pipe: GenericPipe): string {
  const producerArgv = pipe.writeFds[0]?.argv ?? ["/bin/false"];
  return `(${producerArgv.map(shellQuote).join(" ")} 2>"$log.producer" | ${state.argv.map(shellQuote).join(" ")} >"$log" 2>&1) &
pid=$!`;
}
