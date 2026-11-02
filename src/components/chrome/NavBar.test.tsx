import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NavBar from "./NavBar";
import { useSspStore } from "../../lib/store";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn().mockResolvedValue(undefined) }),
}));

/* §5.8 NavBar contract: segmented pill switches views · Stream permanently
   disabled with V2 badge · §7.3 arrow-key roving skips disabled pills. */

describe("NavBar (§5.8)", () => {
  beforeEach(() => {
    useSspStore.setState({ view: "record" });
  });

  it("renders the four segments with roles and labels", () => {
    render(<NavBar />);
    expect(screen.getByRole("tab", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks Record active by default and Stream never active", () => {
    render(<NavBar />);
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const stream = screen.getByRole("tab", { name: /Stream/ });
    expect(stream).toBeDisabled();
    expect(stream).toHaveAttribute("aria-selected", "false");
    expect(stream).toHaveAccessibleDescription("Streaming arrives in V2");
  });

  it("activates a view on click", () => {
    render(<NavBar />);
    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    expect(useSspStore.getState().view).toBe("library");
  });

  it("ignores clicks on the disabled Stream pill", () => {
    render(<NavBar />);
    fireEvent.click(screen.getByRole("tab", { name: /Stream/ }));
    expect(useSspStore.getState().view).toBe("record");
  });

  it("roves selection with ArrowRight, skipping the disabled pill (§7.3)", () => {
    render(<NavBar />);
    const record = screen.getByRole("tab", { name: "Record" });
    record.focus();
    fireEvent.keyDown(record, { key: "ArrowRight" });
    expect(useSspStore.getState().view).toBe("library");
  });

  it("wraps roving from the last enabled item back to Record", () => {
    useSspStore.setState({ view: "settings" });
    render(<NavBar />);
    const settings = screen.getByRole("tab", { name: "Settings" });
    settings.focus();
    fireEvent.keyDown(settings, { key: "ArrowRight" });
    expect(useSspStore.getState().view).toBe("record");
  });
});
