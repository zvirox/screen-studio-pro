import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  systemCapabilities: vi.fn(),
  isContractMatch: (actual: string) => actual === "1.3.0",
  asIpcError: (err: unknown) => ({
    kind: "ipc",
    code: "ipc.unknown_command",
    retryable: false,
    userMessage: "wrapped",
    details: { cause: String(err) },
  }),
}));

import { boot } from "./boot";
import { systemCapabilities } from "./ipc";

const capsWith = (ipcContract: string) => ({
  encoders: [],
  portal: { screencast: true, globalShortcuts: "partial", compositor: "kde", windowCapture: true },
  version: { app: "0.0.1-alpha.1", ipcContract },
});

/* API §5.1: the boot gate decides between app shell and boot-error screen. */

describe("boot gate", () => {
  it("passes when the core reports the pinned contract", async () => {
    vi.mocked(systemCapabilities).mockResolvedValue(capsWith("1.3.0"));
    const result = await boot();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capabilities.version.ipcContract).toBe("1.3.0");
  });

  it("fails with ipc.contract_mismatch naming both versions", async () => {
    vi.mocked(systemCapabilities).mockResolvedValue(capsWith("2.0.0"));
    const result = await boot();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ipc.contract_mismatch");
      expect(result.expected).toBe("1.3.0");
      expect(result.actual).toBe("2.0.0");
    }
  });

  it("fails closed (actual: null) when the core never answers", async () => {
    vi.mocked(systemCapabilities).mockRejectedValue(new Error("invoke unavailable"));
    const result = await boot();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.actual).toBeNull();
      expect(result.error.userMessage).not.toContain("invoke unavailable");
    }
  });
});
