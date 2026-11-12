import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirstRunPane from "./FirstRunPane";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  prefsGet: vi.fn(),
  prefsSet: vi.fn(),
}));

import { prefsSet } from "../../lib/ipc";
const mockedPrefsSet = vi.mocked(prefsSet);

function setFirstRunCompleted(value: boolean | null) {
  useSspStore.setState({
    prefs: {
      pipPosition: null,
      pipShape: null,
      pipSize: null,
      prefsLoading: false,
      firstRunCompleted: value,
    },
  });
}

/* §6.4 First-run education — three education states + completion. */

describe("FirstRunPane (§6.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFirstRunCompleted(null);
  });

  it("renders all three education states on first run", () => {
    render(<FirstRunPane />);
    expect(screen.getByRole("heading", { name: "First run" })).toBeInTheDocument();
    expect(screen.getByText("Choose a capture source")).toBeInTheDocument();
    expect(screen.getByText("Test your microphone")).toBeInTheDocument();
    expect(screen.getByText("Check runtime capabilities")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I've reviewed these/ })).toBeInTheDocument();
    expect(screen.queryByText("First run complete")).not.toBeInTheDocument();
  });

  it("shows completed state after marking first run complete", async () => {
    setFirstRunCompleted(null);
    render(<FirstRunPane />);
    fireEvent.click(screen.getByRole("button", { name: /I've reviewed these/ }));
    await waitFor(() =>
      expect(mockedPrefsSet).toHaveBeenCalledWith("firstRunCompleted", true),
    );
    expect(screen.getByText("First run complete")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /First run complete/ }),
    ).toBeDisabled();
  });

  it("does not show education states when already completed", () => {
    setFirstRunCompleted(true);
    render(<FirstRunPane />);
    expect(screen.queryByText("Choose a capture source")).not.toBeInTheDocument();
    expect(screen.queryByText("Test your microphone")).not.toBeInTheDocument();
    expect(screen.queryByText("Check runtime capabilities")).not.toBeInTheDocument();
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
    setFirstRunCompleted(null);
    render(<FirstRunPane />);
    fireEvent.click(screen.getByRole("button", { name: /I've reviewed these/ }));
    await waitFor(() => expect(mockedPrefsSet).toHaveBeenCalled());
    // Should roll back - still showing education states
    expect(screen.getByText("Choose a capture source")).toBeInTheDocument();
  });
});
