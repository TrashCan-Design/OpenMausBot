import { isDeepStrictEqual } from "node:util";

export function changedInstanceIds(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((id) => !isDeepStrictEqual(before[id], after[id]));
}
