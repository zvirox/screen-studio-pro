import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import SettingsView from "./SettingsView";
import { useSspStore } from "../../lib/store";

/* DESIGN.md v2.0 §6.4 / §6.0 — Settings shell law: a real 200px rail with
   all seven sections, one content scroll owner, no nested <main>, and the
   compact rail declared as a horizontal scroller. */

describe("SettingsView shell (§6.4 / §6.0)", () => {
  beforeEach(() => {
    useSspStore.setState({ view: "settings" });
  });

  it("renders all seven sections with First Run first and Camera active", () => {
    render(<SettingsView />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(tabs[0]).toHaveTextContent("First Run");
    expect(screen.getByRole("tab", { name: "Camera" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Camera" })).toBeInTheDocument();
  });

  it("switches panes and keeps the active tab in sync", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Audio" }));
    expect(screen.getByRole("heading", { name: "Audio" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Audio" })).toHaveAttribute("aria-selected", "true");
  });

  it("owns exactly one vertical scroll container and no nested main", () => {
    const { container } = render(<SettingsView />);
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Settings sections" })).toHaveClass(
      "min-[720px]:flex-col",
    );
  });
});
