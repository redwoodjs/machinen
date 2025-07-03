import { Output } from "./Output";
import { RunCommand } from "./RunCommand";

import { CURRENT_PROCESS_ID } from "../../functions";

export function Command() {
  return (
    <div className="flex flex-col gap-2">
      <Output processId={CURRENT_PROCESS_ID} />
      <RunCommand isRunning={typeof CURRENT_PROCESS_ID === "string"} />
    </div>
  );
}
