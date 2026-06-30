import { type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

type RuntimeCommandErrorFactory = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
) => Error;

type RuntimeCommandFailureMapper = (error: {
  code: string;
  message: string;
}) => { errorCode?: ErrorCode; message?: string } | undefined;

interface RuntimeCommandOptions<TResponse, TOutput> {
  command: string;
  errorCode: ErrorCode;
  isData: (value: unknown) => value is TResponse;
  output?: (response: TResponse) => TOutput;
  makeError?: RuntimeCommandErrorFactory;
  mapFailure?: RuntimeCommandFailureMapper;
}

export function defineRuntimeCommand<TInput, TResponse, TOutput = TResponse>(
  opts: RuntimeCommandOptions<TResponse, TOutput> & {
    data?: (input: TInput) => unknown;
  },
): (input: TInput) => TOutput {
  return (input) => callDefinedRuntimeCommand(opts, opts.data ? opts.data(input) : input);
}

export function defineRuntimeCommandWithArgs<
  TArgs extends unknown[],
  TResponse,
  TOutput = TResponse,
>(
  opts: RuntimeCommandOptions<TResponse, TOutput> & {
    data: (...args: TArgs) => unknown;
  },
): (...args: TArgs) => TOutput {
  return (...args) => callDefinedRuntimeCommand(opts, opts.data(...args));
}

function callDefinedRuntimeCommand<TResponse, TOutput>(
  opts: RuntimeCommandOptions<TResponse, TOutput>,
  data: unknown,
): TOutput {
  const response = callRuntimeHelper({
    command: opts.command,
    data,
    errorCode: opts.errorCode,
    makeError: opts.makeError,
    mapFailure: opts.mapFailure,
    isData: opts.isData,
  });
  return opts.output ? opts.output(response) : (response as unknown as TOutput);
}
