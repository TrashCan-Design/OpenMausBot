import { describe, expect, it } from "vitest";
import { annotateSandboxInputResult, foregroundSandboxInput } from "./sandbox-desktop-input.ts";

const call = (name: string, args: Record<string, unknown>, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("sandbox desktop input", () => {
  it("sends keys, typing and pixel actions in the foreground and leaves element clicks unchanged", () => {
    const typed = JSON.parse(foregroundSandboxInput(call("type_text", { text: "World War 2 世界" })));
    expect(typed.params.arguments).toEqual({ text: "World War 2 世界", delivery_mode: "foreground" });
    const pressed = JSON.parse(foregroundSandboxInput(call("press_key", { key: "Enter", delivery_mode: "background" })));
    expect(pressed.params.arguments.delivery_mode).toBe("foreground");
    const pixel = JSON.parse(foregroundSandboxInput(call("click", { x: 4, y: 9 }, 11)));
    expect(pixel.params.arguments.delivery_mode).toBe("foreground");
    const element = JSON.parse(foregroundSandboxInput(call("click", { element_index: 3, pid: 4 }, 12)));
    expect(element.params.arguments).toEqual({ element_index: 3, pid: 4 });
    const seen = call("get_desktop_state", {});
    expect(foregroundSandboxInput(seen)).toBe(seen);
    const already = call("type_text", { text: "ok", delivery_mode: "foreground" });
    expect(foregroundSandboxInput(already)).toBe(already);
  });

  it("marks a confirmed miss as recoverable and a timeout as not to be repeated", () => {
    foregroundSandboxInput(call("type_text", { text: "hi" }, 2));
    foregroundSandboxInput(call("type_text", { text: "hi" }, 3));
    const missed = annotateSandboxInputResult(JSON.stringify({
      jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text", text: "The control is not accepting text." }] },
    }));
    expect(missed).toContain("get_window_state");
    expect(missed).toContain("Firefox's address bar");
    expect(missed).not.toContain("not accepting text. The control");
    const uncertain = annotateSandboxInputResult(JSON.stringify({
      jsonrpc: "2.0", id: 3, result: { isError: true, content: [{ type: "text", text: "type_text timed out" }] },
    }));
    expect(uncertain).toContain("Do not repeat");
    expect(uncertain).not.toContain("get_window_state");
    const fine = JSON.stringify({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "Typed 11 char(s)." }] } });
    expect(annotateSandboxInputResult(fine)).toBe(fine);
    const page = JSON.stringify({ jsonrpc: "2.0", id: 5, result: { content: [{ type: "text", text: "Window: Timeout (film) - Wikipedia" }] } });
    expect(annotateSandboxInputResult(page)).toBe(page);
  });
});