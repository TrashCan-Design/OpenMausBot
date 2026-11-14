// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedVpsStatusLine } from "./SharedVpsDesktopControls";
import { useComputerTakeover } from "./computer-takeover";
import { api } from "@/state/store";
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: state.api }));
let root: Root | undefined, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", async (path: string, init: RequestInit) => { await state.api(path, init); return new Response("{}"); }); });
afterEach(() => { if (root) act(() => { flushSync(() => root!.unmount()); }); root = undefined; container?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); state.api.mockReset(); });
function render() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const props = { active: true, ready: true, botId: "alpha", desktop: { mode: "shared" as const, controller: "person" as const }, refresh: vi.fn(async () => ({ ready: true })), onStatus: vi.fn() };
  function Panel() {
    const path = "/api/bots/alpha/computer/control";
    const request = (action: string, id?: string, signal?: AbortSignal) => api(path, { method: "POST", body: JSON.stringify({ action, controlLeaseId: id }), signal });
    const takeover = useComputerTakeover({ botId: "alpha", session: "test", held: true, shared: true, viewerClose: null, request, check: id => request("check", id) });
    return createElement(SharedVpsStatusLine, { ...props, control: { owned: takeover.here, pending: takeover.waiting, position: takeover.queuePosition, take: () => { void takeover.take(); }, release: () => { void takeover.handBack(); }, cancel: takeover.leave } });
  }
  const draw = () => act(() => { flushSync(() => root!.render(createElement(Panel))); });
  draw(); return { props, draw };
}
const click = (text: string) => { const button = [...container.querySelectorAll("button")].find(button => button.textContent === text); expect(button).toBeDefined(); act(() => { flushSync(() => button!.click()); }); };
const requests = (action: string) => state.api.mock.calls.filter(([, init]) => init?.body && JSON.parse(init.body).action === action);
describe("shared desktop control cancellation", () => {
  it("releases a grant that arrives after Cancel and never displays input authority", async () => {
    let grant!: (result: unknown) => void;
    state.api.mockImplementation(async (_path, init) => JSON.parse(init.body).action === "take" ? new Promise(resolve => { grant = resolve; }) : { held: false });
    render(); click("Request control");
    const take = requests("take")[0]![1];
    click("Cancel request"); expect(take.signal.aborted).toBe(true);
    grant({ held: true, owned: true });
    await vi.waitFor(() => expect(requests("release").length).toBeGreaterThan(0));
    expect(container.textContent).toContain("Input is off");
    expect(requests("release").every(([, init]) => JSON.parse(init.body).controlLeaseId === JSON.parse(take.body).controlLeaseId)).toBe(true);
  });
  it("aborts a queued request when the panel unmounts and releases its exact lease", async () => {
    state.api.mockImplementation(async (_path, init) => JSON.parse(init.body).action === "take" ? new Promise(() => {}) : { held: false });
    render(); click("Request control"); const take = requests("take")[0]![1];
    act(() => { flushSync(() => root!.unmount()); }); root = undefined;
    expect(take.signal.aborted).toBe(true);
    expect(JSON.parse(requests("release")[0]![1].body).controlLeaseId).toBe(JSON.parse(take.body).controlLeaseId);
  });
  it("removes input authority when the server says this lease expired", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation(async (_path, init) => JSON.parse(init.body).action === "take" ? { held: true, owned: true } : { held: false, owned: false });
    render(); click("Request control"); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(container.textContent).toContain("Input is on");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_001); });
    expect(container.textContent).toContain("Input is off");
    expect(container.textContent).not.toContain("You have control");
  });
  it("uses Observe without taking, checking or releasing control", async () => {
    state.api.mockResolvedValue({ png: "fixture", capturedAt: 1000, epoch: 4 });
    render(); click("Observe");
    await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(state.api.mock.calls.map(([path]) => path)).toEqual(["/api/bots/alpha/computer/screenshot"]);
  });
});
