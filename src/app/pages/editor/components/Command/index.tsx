import { Output } from "./Output";
import { RunCommand } from "./RunCommand";

import { CURRENT_PROCESS_ID } from "../../functions";

export function Command() {
  return (
    <div className="flex flex-col gap-2 bg-red-400 h-full">
      <RunCommand isRunning={false} />
      <Output processId={CURRENT_PROCESS_ID} />
    </div>
  );
}
