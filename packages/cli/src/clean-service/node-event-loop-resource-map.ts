interface NodeEventLoopLevel4MappedResource {
  kind: "tcp-listener" | "pipe" | "eventfd" | "timerfd" | "unsupported";
  libuvHandle: string;
  genericProfile: string;
  decision: "mapped-to-generic-level4-descriptor" | "mapped-to-target-runtime-startup" | "refused";
  details: Record<string, unknown>;
}

interface NodeEventLoopLevel4ResourceRefusal {
  code: string;
  message: string;
  migrationCompleted: false;
  productSupport: "unsupported";
  implementationLevel: "level-0-fail-closed-discovery";
  genericProfile?: string;
}

export interface NodeEventLoopLevel4ResourceMap {
  kind: "machinen.node-event-loop-level4-resource-map";
  formatVersion: 1;
  sourceGoal: "008";
  evidenceStatus: "planning";
  productSupport: "not-yet-supported";
  implementationLevel: "not-implemented";
  graduationTargetLevel: "level-4-kernel-resource-reconstruction";
  genericResources: NodeEventLoopLevel4MappedResource[];
  refusals: NodeEventLoopLevel4ResourceRefusal[];
  summary: { mapped: number; refused: number };
}
