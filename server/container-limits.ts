/** Firefox alone runs about 430 threads with seven tabs open (Debian 12, Oct 2026): under a 512 cap its next tab, and
 * every `docker exec` into the desktop, fail to fork. The cap still stops a fork bomb. */
export const PIDS_LIMIT = 4096;
/** The cap desktops were made with before. Any other value is someone's choice and stays. */
const PREVIOUS_PIDS_LIMIT = 512;

const raised = new Set<string>();
const raisedMemory = new Set<string>();
const deferredMemory = new Map<string, number>();
const infoRetryAt = new Map<string, number>();
const INFO_RETRY_MS = 60_000;

export const PER_BOT_VPS_MEMORY = "4g";
export const SHARED_DESKTOP_MEMORY = "6g";
export const SHARED_DESKTOP_MEMORY_BYTES = 6 * 1024 * 1024 * 1024;
/** Linux, Docker and SSH stay on the host. 6 GiB is applied only when this much remains. */
export const SHARED_DESKTOP_HEADROOM_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);

/** Per-bot desktops stay at 4 GiB. The one shared desktop asks for 6 GiB and the same swap cap. */
export function vpsContainerMemory(botId: string): string {
  return botId.startsWith("openbot-shared-desktop:") ? SHARED_DESKTOP_MEMORY : PER_BOT_VPS_MEMORY;
}

/** A new shared container gets 6 GiB only when the host can spare it. A missing measurement stays at 4 GiB. */
export async function sharedProvisionMemory(
  botId: string,
  docker: (args: string[], timeoutMs?: number) => Promise<{ stdout?: string }>,
): Promise<string> {
  const asked = vpsContainerMemory(botId);
  if (asked !== SHARED_DESKTOP_MEMORY) return asked;
  try {
    const reported = Number((await docker(["info", "--format", "{{.MemTotal}}"], 10_000)).stdout?.trim());
    const host = Number.isFinite(reported) && reported > 0 ? reported : null;
    return sharedDesktopMemoryPlan(4 * 1024 * 1024 * 1024, host) === "raise" ? SHARED_DESKTOP_MEMORY : PER_BOT_VPS_MEMORY;
  } catch {
    return PER_BOT_VPS_MEMORY;
  }
}

/** Docker and Podman change an existing container's cap in place, running or stopped, so a desktop made under the old cap
 * needs no recreate. Tried once per container per run: an engine without `update --pids-limit` keeps the old cap. */
export function raisePidsLimit(
  container: string,
  current: number | null | undefined,
  docker: (args: string[], timeoutMs?: number) => Promise<unknown>,
): void {
  if (current !== PREVIOUS_PIDS_LIMIT || raised.has(container)) return;
  raised.add(container);
  void Promise.resolve().then(() => docker(["update", "--pids-limit", String(PIDS_LIMIT), container], 15_000)).catch(() => {});
}

/** `keep` leaves a higher cap, including Docker's 0. `defer` means 6 GiB would not leave the headroom. */
export function sharedDesktopMemoryPlan(current: number | null | undefined, hostBytes: number | null): "keep" | "raise" | "defer" | "unmeasured" {
  if (typeof current !== "number" || current <= 0 || current >= SHARED_DESKTOP_MEMORY_BYTES) return "keep";
  if (hostBytes === null || !Number.isFinite(hostBytes) || hostBytes <= 0) return "unmeasured";
  if (hostBytes < SHARED_DESKTOP_MEMORY_BYTES + SHARED_DESKTOP_HEADROOM_BYTES) return "defer";
  return "raise";
}

/** Reads the host total, then updates one shared desktop in place. A lost reply clears the latch. */
export async function considerSharedDesktopMemory(
  status: { container_id: string | null; memoryBytes?: number; memoryHostBytes?: number; memoryDeferred?: boolean },
  docker: (args: string[], timeoutMs?: number) => Promise<{ stdout?: string }>,
): Promise<void> {
  if (!status.container_id) return;
  const current = status.memoryBytes;
  const deferredHost = deferredMemory.get(status.container_id);
  if (deferredHost !== undefined) {
    status.memoryDeferred = true;
    status.memoryHostBytes = deferredHost;
    return;
  }
  if (typeof current !== "number" || current <= 0 || current >= SHARED_DESKTOP_MEMORY_BYTES || raisedMemory.has(status.container_id)) return;
  if ((infoRetryAt.get(status.container_id) ?? 0) > Date.now()) return;
  let host: number | null = null;
  try {
    const reported = Number((await docker(["info", "--format", "{{.MemTotal}}"], 10_000)).stdout?.trim());
    host = Number.isFinite(reported) && reported > 0 ? reported : null;
  } catch {
    infoRetryAt.set(status.container_id, Date.now() + INFO_RETRY_MS);
    return;
  }
  infoRetryAt.delete(status.container_id);
  status.memoryHostBytes = host ?? undefined;
  const plan = sharedDesktopMemoryPlan(current, host);
  if (plan === "defer" && host !== null) {
    deferredMemory.set(status.container_id, host);
    status.memoryDeferred = true;
    return;
  }
  if (plan !== "raise" || host === null) {
    if (host === null) infoRetryAt.set(status.container_id, Date.now() + INFO_RETRY_MS);
    return;
  }
  raisedMemory.add(status.container_id);
  try {
    await docker(["update", "--memory", SHARED_DESKTOP_MEMORY, "--memory-swap", SHARED_DESKTOP_MEMORY, status.container_id], 15_000);
  } catch {
    raisedMemory.delete(status.container_id);
  }
}
