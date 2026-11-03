import { invoke } from "@tauri-apps/api/core";
import {
  IPC_CONTRACT_VERSION,
  type AudioListDevicesReply,
  type AudioSetChannelInput,
  type Capabilities,
  type Hello,
  type IpcError,
  type PrefEntry,
  type PrefValue,
  type PrefsGetReply,
  type PrefsAllReply,
  type RecordingPhaseReply,
  type RecordingStartInput,
  type RecordingStartReply,
  type RecordingStopReply,
  type Settings,
  type SettingsPatch,
  type SettingsSection,
  type SourceKind,
  type SourceSelected,
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

/** `cmd://source_select` — begin a portal capture session for a source
    kind (API §2.1). Long-running by design: resolves only after the user
    answers the compositor consent dialog. `target` is a hint only in 1.1
    (the portal picker owns output choice until M2+ restore tokens). */
export function sourceSelect(kind: SourceKind, target?: string): Promise<SourceSelected> {
  return call<SourceSelected>("source_select", { kind, target: target ?? null });
}

/** `cmd://source_release` — end the active capture session (API §2.1).
    Idempotent for an unknown or already-released source id. */
export function sourceRelease(sourceId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>("source_release", { sourceId });
}

/** `cmd://audio_list_devices` — cpal mics + PipeWire sinks with defaults
    marked (API §2.2). A snapshot: re-list after device changes. */
export function audioListDevices(): Promise<AudioListDevicesReply> {
  return call<AudioListDevicesReply>("audio_list_devices", {});
}

/** `cmd://audio_set_channel` — enable/mute a channel, pick a device, set
    level 0–100 (API §2.2). Persists through the settings store. */
export function audioSetChannel(input: AudioSetChannelInput): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>("audio_set_channel", { ...input });
}

/** `cmd://recording_start` — wire source→encode→mux and open the MKV
    (API §2.3). Task 1.3 scope: video-only monitor recording — the Audio/
    camera/preset fields ride in the body at their neutral values (the
    Rust side accepts but does not honor them yet); `outputDir` null
    selects the default Videos dir. */
export function recordingStart(input: RecordingStartInput): Promise<RecordingStartReply> {
  return call<RecordingStartReply>("recording_start", { ...input });
}

/** `cmd://recording_stop` — flush + trailer + join (API §2.3). Resolves
    with the take's path/duration/size; the row id/thumb joins in PLAN 1.6. */
export function recordingStop(recordingId: string): Promise<RecordingStopReply> {
  return call<RecordingStopReply>("recording_stop", { recordingId });
}

/** `cmd://recording_pause` / `cmd://recording_resume` (API §2.3) — the
    take's phase flips on the Rust side; `recording/tick` carries it at the
    next beat. `ipc.bad_state` when not recording / not paused. */
export function recordingPause(recordingId: string): Promise<RecordingPhaseReply> {
  return call<RecordingPhaseReply>("recording_pause", { recordingId });
}

export function recordingResume(recordingId: string): Promise<RecordingPhaseReply> {
  return call<RecordingPhaseReply>("recording_resume", { recordingId });
}

/** API §5.1 boot gate: the webview pins the expected contract version. */
export function isContractMatch(actual: string): boolean {
  return actual === IPC_CONTRACT_VERSION;
}
