import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirstRunPane from "./FirstRunPane";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  prefsGet: vi.fn().mockResolvedValue({ key: "firstRunCompleted", value: null }),
  prefsSet: vi.fn(),
}));

import { prefsSet } from "../../lib/ipc";
const mockedPrefsSet = vi.mocked(prefsSet);

describe("FirstRunPane (§6.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      prefs: {
        pipPosition: null,
        pipShape: null,
        pipSize: null,
        prefsLoading: false,
        firstRunCompleted: null,
      },
    });
  });

  it("renders all three education states on first run", () => {
    render(<FirstRunPane />);
    expect(screen.getByRole("heading", { name: "First run" })).toBeInTheDocument();
    expect(screen.getByTestId("edu-source")).toBeInTheDocument();
    expect(screen.getByTestId("edu-mic")).toBeInTheDocument();
    expect(screen.getByTestId("edu-capabilities")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I've reviewed these/ })).toBeInTheDocument();
    expect(screen.queryByText("First run complete")).not.toBeInTheDocument();
  });

  it("shows completed state after marking first run complete", async () => {
    render(<FirstRunPane />);
    fireEvent.click(screen.getByRole("button", { name: /I've reviewed these/ }));
    await waitFor(() =>
      expect(mockedPrefsSet).toHaveBeenCalledWith("firstRunCompleted", true),
    );
    expect(screen.getByText("First run complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /First run complete/ })).toBeDisabled();
  });

  it("does not show education states when already completed", () => {
    useSspStore.setState({
      prefs: {
        pipPosition: null,
        pipShape: null,
        pipSize: null,
        prefsLoading: false,
        firstRunCompleted: true,
      },
    });
    render(<FirstRunPane />);
    expect(screen.queryByTestId("edu-source")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edu-mic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edu-capabilities")).not.toBeInTheDocument();
    expect(screen.getByText("First run complete")).toBeInTheDocument();
  });

  it("rolls back on prefsSet rejection", async () => {
    mockedPrefsSet.mockRejectedValue({
      kind: "settings",
      code: "settings.invalid_value",
      userMessage: "Bad value.",
      details: null,
      retryable: false,
    });
    useSspStore.setState({
      prefs: {
        pipPosition: null,
        pipShape: null,
        pipSize: null,
        prefsLoading: false,
        firstRunCompleted: null,
      },
    });
    render(<FirstRunPane />);
    fireEvent.click(screen.getByRole("button", { name: /I've reviewed these/ }));
    await waitFor(() => expect(mockedPrefsSet).toHaveBeenCalled());
    // Should roll back - still showing education states
    expect(screen.getByText("Choose a capture source")).toBeInTheDocument();
  });
});
