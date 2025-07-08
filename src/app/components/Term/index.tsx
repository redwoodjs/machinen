"use client";

import { lazy, Suspense } from "react";

const Term = lazy(() => import("./Term"));

export function LazyTerm() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Term />
    </Suspense>
  );
}
