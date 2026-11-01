import { IPC_CONTRACT_VERSION, type Capabilities, type IpcError } from "../types/ipc";
import { asIpcError, isContractMatch, systemCapabilities } from "./ipc";

/* Boot gate (API §5.1) — probe the core and pin the contract version before
   App renders. Mismatch or unreachable core → boot-error screen naming both
   versions; nothing else in the app runs before this passes. */

export interface BootFailure {
  error: IpcError;
  expected: string;
  /** null = the core never answered at all. */
  actual: string | null;
}

export type BootResult =
  | { ok: true; capabilities: Capabilities }
  | ({ ok: false } & BootFailure);

export async function boot(): Promise<BootResult> {
  let capabilities: Capabilities;
  try {
    capabilities = await systemCapabilities();
  } catch (err) {
    return { ok: false, error: asIpcError(err), expected: IPC_CONTRACT_VERSION, actual: null };
  }

  const actual = capabilities.version.ipcContract;
  if (!isContractMatch(actual)) {
    return {
      ok: false,
      error: {
        kind: "ipc",
        code: "ipc.contract_mismatch",
        retryable: false,
        userMessage:
          "This build of ScreenStudio Pro doesn't match its recording core. Reinstall the app to fix the versions.",
        details: { expected: IPC_CONTRACT_VERSION, actual },
      },
      expected: IPC_CONTRACT_VERSION,
      actual,
    };
  }

  return { ok: true, capabilities };
}
