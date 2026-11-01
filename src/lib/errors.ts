import type { IpcError } from "../types/ipc";

/* CoreError → human response mapping (ARCHITECTURE §4.2 layer 3).
   userMessage already carries the human copy (DESIGN §7.9); this file adds
   the presentation decision: where the error shows and whether a Retry
   action is offered — API §1 severity law: non-retryable disk errors and
   portal.denied become persistent toasts (§5.6); everything else renders
   inline (§5.2) or lets the pipeline auto-fallback (§6.1). */

export type ErrorPresentation = "toast" | "inline";

export function presentationFor(err: IpcError): ErrorPresentation {
  if (!err.retryable && (err.kind === "disk" || err.code === "portal.denied")) {
    return "toast";
  }
  return "inline";
}

/** Fallback for codes this build doesn't know yet (API §1: codes are only
    ever added) — never renders the raw backend string. */
export function fallbackCopy(err: IpcError): string {
  return err.userMessage || "Something went wrong. Details are in the log.";
}
