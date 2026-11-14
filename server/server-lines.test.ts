import { describe, expect, it } from "vitest";

import "./server-line-packs.ts";
import { serverLine } from "./server-lines.ts";

describe("serverLine", () => {
  it("writes the line in the language given, with its values filled in", () => {
    expect(serverLine("de", "server.runs.didNotFinishWhy", { detail: "x" })).toBe("Diese Ausführung wurde nicht beendet: x");
    expect(serverLine(undefined, "server.runs.didNotFinishWhy", { detail: "x" })).toBe("This run didn't finish: x");
  });

  it("reads a regional tag as its language, and a language it has no words for as English", () => {
    expect(serverLine("pt", "server.runs.didNotFinishWhy", { detail: "x" })).toBe(serverLine("pt-br", "server.runs.didNotFinishWhy", { detail: "x" }));
    expect(serverLine("zh-Hant", "server.runs.didNotFinishWhy", { detail: "x" })).toBe(serverLine("zh-tw", "server.runs.didNotFinishWhy", { detail: "x" }));
    expect(serverLine("nl", "server.runs.didNotFinishWhy", { detail: "x" })).toBe("This run didn't finish: x");
  });

  it("leaves a {name} it was given no value for as it is", () => {
    expect(serverLine("en", "server.runs.didNotFinishWhy", {})).toBe("This run didn't finish: {detail}");
  });
});
