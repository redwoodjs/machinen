import type { NativeProcessImageRefusalCode } from "./native-process-image.ts";

interface NativeAmbiguityClass {
  id: string;
  description: string;
  requiredMetadata: string[];
  translationRule?: string;
  refusalCode: NativeProcessImageRefusalCode;
}

export const nativeAmbiguityClasses: NativeAmbiguityClass[] = [
  {
    id: "pointer-vs-integer",
    description:
      "A pointer-shaped word may be an integer, stale pointer, packed data, or real pointer.",
    requiredMetadata: ["DWARF type", "sidecar layout", "explicit relocation policy"],
    translationRule: "Relocate only metadata-proven pointer/code/thread-pointer words.",
    refusalCode: "pointer-ambiguous",
  },
  {
    id: "return-address",
    description: "A stack word may be a return address only when unwind metadata proves the frame.",
    requiredMetadata: ["unwind info", "source code map", "target code map"],
    translationRule: "Map return addresses through NativeCodeLocationMapping.",
    refusalCode: "code-location-unknown",
  },
  {
    id: "unknown-frame",
    description:
      "Hand-written assembly, stripped frames, or corrupted stacks may lack frame boundaries.",
    requiredMetadata: ["DWARF CFI", "sidecar frame plan"],
    refusalCode: "mapping-ambiguous",
  },
  {
    id: "active-syscall",
    description:
      "A thread stopped inside a syscall may have kernel restart state not represented in user registers.",
    requiredMetadata: ["syscall restart state", "kernel ABI policy"],
    refusalCode: "active-syscall",
  },
  {
    id: "signal-frame",
    description: "Signal trampolines and alternate stacks contain kernel-shaped frames.",
    requiredMetadata: ["signal frame decoder", "alt-stack policy"],
    refusalCode: "signal-frame-active",
  },
  {
    id: "tls-rseq-futex",
    description: "TLS, rseq, and futex waiters embed thread/kernel state.",
    requiredMetadata: ["TLS model", "rseq state", "futex owner/waiter graph"],
    refusalCode: "rseq-state-unsupported",
  },
  {
    id: "target-build",
    description:
      "Source addresses are meaningless unless paired with the expected target executable/library build.",
    requiredMetadata: ["target build id", "source build id", "library identity"],
    translationRule: "Validate target build identity before mapping code or data addresses.",
    refusalCode: "target-build-mismatch",
  },
  {
    id: "kernel-resource",
    description:
      "fds, sockets, PTYs, timers, epoll, namespaces, credentials, and raw sockets need broker recipes.",
    requiredMetadata: ["fd table", "resource kind", "host broker capability"],
    translationRule:
      "Regular files can reopen/reseek; brokered resources require declared capability.",
    refusalCode: "resource-kind-unsupported",
  },
  {
    id: "vdso-vvar-special-mapping",
    description: "Kernel-provided mappings cannot be copied as normal source bytes.",
    requiredMetadata: ["mapping kind", "target kernel policy"],
    refusalCode: "vdso-policy-unsupported",
  },
  {
    id: "jit-or-self-modifying-code",
    description: "Anonymous executable or self-modifying code lacks stable source/target pairing.",
    requiredMetadata: ["JIT code cache metadata", "target compiler/runtime support"],
    refusalCode: "code-location-unknown",
  },
];

export function nativeSupportBoundaryChecklist(): string[] {
  return nativeAmbiguityClasses.map(
    (entry) =>
      `${entry.id}: ${entry.translationRule ?? "no translation rule yet"}; refusal=${entry.refusalCode}`,
  );
}
