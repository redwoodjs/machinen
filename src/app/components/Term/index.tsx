"use client";

import { Suspense, lazy } from "react";
import TerminalComponent from "./Term";
// const Command = lazy(() => import("./Term"));

export function LazyTerm() {
  return <TerminalComponent />;
}
