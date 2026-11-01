import { invoke } from "@tauri-apps/api/core";
import {
  IPC_CONTRACT_VERSION,
  type Capabilities,
  type Hello,
  type IpcError,
  type PrefEntry,
  type PrefValue,
  type PrefsGetReply,
  type PrefsAllReply,
  type Settings,
  type SettingsPatch,
  type SettingsSection,
} from "../types/ipc";

/* Typed wrappers over invoke() — mirrors src-tauri/ipc (ARCHITECTURE §2).
   Every command call in the app goes through this file; raw invoke()
   elsewhere is a review failure. Commands are the `cmd://` verbs of API.md
   §2 minus the prefix. */

/** Normalize anything a failed invoke threw into the API.md §1 shape.
    Rust command errors already serialize as IpcError; anything else
    (capability rejection, unknown command) becomes the ipc fallback so
    consumers never branch on two shapes. */
export function asIpcError(err: unknown): IpcError {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "userMessage" in err
  ) {
    return err as IpcError;
  }
  // Non-§1 shape — keep the cause under details for the log, copy stays human.
  return {
    kind: "ipc",
    code: "ipc.unknown_command",
    retryable: false,
    userMessage: "ScreenStudio Pro could not reach its recording core.",
    details: { cause: String(err) },
  };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    // Omit the args bag entirely when a command takes no payload.
    return args === undefined ? await invoke<T>(cmd) : await invoke<T>(cmd, args);
  } catch (err) {
    throw asIpcError(err);
  }
}

/** `cmd://ipc_hello` — minimal handshake ping. */
export function ipcHello(): Promise<Hello> {
  return call<Hello>("ipc_hello");
}

/** `cmd://system_capabilities` — cold-start probe (API §2.5). */
export function systemCapabilities(): Promise<Capabilities> {
  return call<Capabilities>("system_capabilities");
}

/** `cmd://settings_get` — one TOML section as JSON (API §2.6). */
export function settingsGet<S extends SettingsSection>(section: S): Promise<Settings[S]> {
  return call<Settings[S]>("settings_get", { section });
}

/** `cmd://settings_set` — section-scoped partial merge; resolves with the
    full merged settings (API §2.6). */
export function settingsSet(patch: SettingsPatch): Promise<Settings> {
  return call<Settings>("settings_set", { patch });
}

/** `cmd://prefs_get` — one key, or all keys with an empty key (API §2.6). */
export function prefsGet(key: string): Promise<PrefsGetReply | PrefsAllReply> {
  return call<PrefsGetReply | PrefsAllReply>("prefs_get", { key });
}

/** `cmd://prefs_set` — validated upsert; echoes {key, value} (API §2.6).
    Rate law: batch drags to ≤60 Hz before calling. */
export function prefsSet(key: string, value: PrefValue): Promise<PrefEntry> {
  return call<PrefEntry>("prefs_set", { key, value });
}

/** API §5.1 boot gate: the webview pins the expected contract version. */
export function isContractMatch(actual: string): boolean {
  return actual === IPC_CONTRACT_VERSION;
}
