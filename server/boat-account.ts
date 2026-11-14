import type { AppConfig } from "./config.ts";
import type { ServiceCredential } from "./included-services.ts";

export function boatAccount(cfg: AppConfig): ServiceCredential | null {
  // The managed Boat provider is retired in OpenBot. Existing keys stay in
  // saved configuration for recovery, but no request is made to Boat.
  void cfg;
  return null;
}

export function boatConfigured(cfg: AppConfig) {
  return Boolean(boatAccount(cfg));
}

export function usesIncludedBoat(cfg: AppConfig): boolean {
  return boatAccount(cfg)?.included === true;
}

/** Configured-or-not for Settings, never the token. */
export function describeBoatAccount(cfg: AppConfig): { configured: boolean; included?: true } {
  const account = boatAccount(cfg);
  return { configured: Boolean(account), ...(account?.included ? { included: true as const } : {}) };
}
