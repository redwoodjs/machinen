import type { StatusWidget } from "@machinen/desktop-sdk";

export interface StatusPublisher {
  status: {
    set(widget: StatusWidget): Promise<unknown>;
  };
}

export function reportServiceError(service: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${service}: ${message}`);
}
