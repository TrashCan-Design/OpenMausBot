import { useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface SharedDesktopState {
  mode: "shared" | "per-bot";
  controller?: "bot" | "person" | null;
  recovering?: boolean;
  activeBot?: { id: string; name: string } | null;
  waitingQueue?: Array<{ id: string; name: string }>;
}

export function SharedVpsStatusLine<T extends { ready: boolean; sharedDesktop?: SharedDesktopState; memoryBytes?: number }>(props: {
  active: boolean;
  ready: boolean;
  botId: string;
  desktop?: SharedDesktopState;
  memoryBytes?: number;
  memoryHostBytes?: number;
  memoryDeferred?: boolean;
  refresh: () => Promise<T>;
  onStatus: (status: T) => void;
  control: { owned: boolean; pending: boolean; position: number | null; take(): void; release(): void; cancel(): void };
}) {
  const [frame, setFrame] = useState<{ png: string; format: string; at: number; epoch?: number } | null>(null);
  const [note, setNote] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const revision = useRef(0);
  const frameRequest = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    const generation = ++revision.current;
    setFrame(null); setNote("");
    if (!props.active) return;
    let checking = false;
    const tick = async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await callbacks.current.refresh();
        if (revision.current !== generation) return;
        callbacks.current.onStatus(status);
      } catch (error) {
        if (revision.current === generation) { setNote(error instanceof Error ? error.message : "Could not confirm desktop ownership"); }
      } finally { checking = false; }
    };
    const interval = window.setInterval(() => void tick(), 2_000);
    return () => {
      ++revision.current; window.clearInterval(interval); frameRequest.current?.abort();
    };
  }, [props.active, props.botId]);
  const observe = () => {
    frameRequest.current?.abort();
    const controller = new AbortController(), generation = revision.current;
    frameRequest.current = controller; setNote("");
    void api(`/api/bots/${props.botId}/computer/screenshot`, { method: "POST", body: "{}", signal: controller.signal }).then((body: { png?: string; format?: string; capturedAt?: number; epoch?: number }) => {
      if (!controller.signal.aborted && revision.current === generation && body.png) setFrame({ png: body.png, format: body.format ?? "png", at: body.capturedAt ?? Date.now(), epoch: body.epoch });
    }).catch((error: unknown) => { if (!controller.signal.aborted && revision.current === generation) setNote(error instanceof Error ? error.message : "The screen is unavailable"); });
  };
  const recover = () => {
    if (!confirmStop || recovering) return;
    setRecovering(true); setNote("");
    void api(`/api/bots/${props.botId}/computer/recover`, { method: "POST", body: JSON.stringify({ confirmStop: true }) })
      .then(async () => { setConfirmStop(false); callbacks.current.onStatus(await callbacks.current.refresh()); })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "Recovery failed; writes remain blocked"))
      .finally(() => setRecovering(false));
  };
  if (!props.active) return null;
  const waiting = props.desktop?.waitingQueue ?? [];
  const waitingForControl = props.control.pending, position = props.control.position;
  const owns = props.control.owned && props.desktop?.controller === "person" && !props.desktop?.recovering;
  const availability = !props.ready ? "Offline" : props.desktop?.recovering ? "Recovery required" : owns ? "You have control" : props.desktop?.controller === "person" ? "A person has control" : props.desktop?.activeBot ? `${props.desktop.activeBot.name} is using it` : "Ready";
  return (
    <div className="mb-2 rounded-lg bg-card px-3 py-2 text-[12px] text-ink-secondary" aria-live="polite">
      <span className="font-medium text-ink">Shared VPS Desktop</span>
      {typeof props.memoryBytes === "number" && props.memoryBytes > 0 ? <span>{` · ${(props.memoryBytes / 1024 / 1024 / 1024).toFixed(props.memoryBytes % (1024 * 1024 * 1024) === 0 ? 0 : 1)} GiB RAM`}</span> : null}
      {props.memoryDeferred && typeof props.memoryBytes === "number" && typeof props.memoryHostBytes === "number" ? <div className="mt-1">{t("computer.shared.memoryDeferred", { current: (props.memoryBytes / 1024 / 1024 / 1024).toFixed(props.memoryBytes % (1024 ** 3) === 0 ? 0 : 1), host: (props.memoryHostBytes / 1024 / 1024 / 1024).toFixed(props.memoryHostBytes % (1024 ** 3) === 0 ? 0 : 1) })}</div> : null}
      <span className="ml-2">{availability}</span><span className="ml-2">{owns ? "Input is on" : "Input is off"}</span>
      {waitingForControl && <span className="ml-2">Queued for control{position ? `: position ${position}` : ""}</span>}
      {waiting.length > 0 && <div className="mt-1">Waiting: {waiting.map(entry => entry.name).join(", ")}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg bg-control px-3 py-2 text-ink" onClick={observe}>Observe</button>
        {!owns && !waitingForControl && !props.desktop?.recovering && <button type="button" className="rounded-lg bg-control px-3 py-2 text-ink" onClick={props.control.take}>Request control</button>}
        {waitingForControl && <button type="button" className="rounded-lg bg-control px-3 py-2 text-ink" onClick={props.control.cancel}>Cancel request</button>}
        {owns && <button type="button" className="rounded-lg bg-control px-3 py-2 text-ink" onClick={props.control.release}>Release control</button>}
      </div>
      {props.desktop?.recovering && <div className="mt-2"><label><input type="checkbox" checked={confirmStop} onChange={event => setConfirmStop(event.target.checked)} /> Stop running work and unsaved app state; keep the existing container and files.</label><button type="button" disabled={!confirmStop || recovering} onClick={recover}>Stop and reconnect desktop</button></div>}
      {frame && <><img className="mt-2 max-h-40 rounded-md" alt="Shared desktop, observed without control" src={`data:image/${frame.format};base64,${frame.png}`} /><div>Capture started at {new Date(frame.at).toLocaleTimeString()}. It may be stale. Epoch {frame.epoch ?? "unknown"}.</div></>}
      {note && <div className="mt-1">{note}</div>}
    </div>
  );
}

export function SharedVpsModePicker(props: {
  mode: "per-bot" | "shared";
  disabled: boolean;
  onChange: (mode: "per-bot" | "shared") => void;
}) {
  return (
    <div role="group" aria-label="VPS desktop mode" className="mt-3 flex flex-wrap gap-2 text-[12px]">
      {(["per-bot", "shared"] as const).map(mode => (
        <button key={mode} type="button" aria-pressed={props.mode === mode} disabled={props.disabled}
          onClick={() => props.onChange(mode)}
          className={cn("rounded-lg px-3 py-2 disabled:opacity-50", props.mode === mode ? "bg-accent text-white" : "bg-control text-ink hover:bg-raised-hover")}>
          {mode === "shared" ? "Shared VPS Desktop" : "Per-Bot VPS"}
        </button>
      ))}
      {props.mode === "shared" && <span className="w-full text-ink-secondary">Uses the default VPS SSH alias. All shared bots use this desktop and its files.</span>}
    </div>
  );
}
