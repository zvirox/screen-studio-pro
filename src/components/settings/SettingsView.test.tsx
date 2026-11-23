import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { useSspStore } from "../../lib/store";

/* DESIGN.md v2.0 §6.4 / §6.0 — Settings shell law: a real 200px rail with
   all seven sections, one content scroll owner, no nested <main>, and the
   compact rail declared as a horizontal scroller. */

describe("SettingsView shell (§6.4 / §6.0)", () => {
  beforeEach(() => {
    useSspStore.setState({
      view: "settings",
      loadCaptureSettings: vi.fn().mockResolvedValue(undefined),
      loadFilesSettings: vi.fn().mockResolvedValue(undefined),
      loadShortcutsSettings: vi.fn().mockResolvedValue(undefined),
      loadFirstRunCompleted: vi.fn().mockResolvedValue(undefined),
    });
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

  it("links each tab to its panel and exposes only the active tab in the tab order", () => {
    render(<SettingsView />);
    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      const id = tab.getAttribute("id");
      expect(id).toMatch(/^settings-tab-/);
      expect(tab).toHaveAttribute(
        "aria-controls",
        `settings-panel-${id?.replace("settings-tab-", "")}`,
      );
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).not.toBeNull();
      expect(tab).toHaveAttribute(
        "tabindex",
        tab.getAttribute("aria-selected") === "true" ? "0" : "-1",
      );
    }
    const cameraTab = screen.getByRole("tab", { name: "Camera" });
    const panel = screen.getByRole("tabpanel", { name: "Camera" });
    expect(cameraTab).toHaveClass("border-subtle", "bg-surface-solid", "text-ink");
    expect(cameraTab).not.toHaveClass("bg-accent-muted", "text-accent");
    expect(panel).toHaveAttribute("id", "settings-panel-camera");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-camera");
  });

  it("moves selection and focus with arrow keys, Home and End", () => {
    render(<SettingsView />);
    const camera = screen.getByRole("tab", { name: "Camera" });
    camera.focus();

    fireEvent.keyDown(camera, { key: "ArrowRight" });
    const files = screen.getByRole("tab", { name: "Files" });
    expect(files).toHaveAttribute("aria-selected", "true");
    expect(files).toHaveFocus();

    fireEvent.keyDown(files, { key: "ArrowLeft" });
    expect(camera).toHaveAttribute("aria-selected", "true");
    expect(camera).toHaveFocus();

    fireEvent.keyDown(camera, { key: "ArrowDown" });
    expect(files).toHaveAttribute("aria-selected", "true");
    expect(files).toHaveFocus();

    fireEvent.keyDown(files, { key: "ArrowUp" });
    expect(camera).toHaveAttribute("aria-selected", "true");
    expect(camera).toHaveFocus();

    fireEvent.keyDown(camera, { key: "Home" });
    const firstRun = screen.getByRole("tab", { name: "First Run" });
    expect(firstRun).toHaveAttribute("aria-selected", "true");
    expect(firstRun).toHaveFocus();

    fireEvent.keyDown(firstRun, { key: "End" });
    const about = screen.getByRole("tab", { name: "About" });
    expect(about).toHaveAttribute("aria-selected", "true");
    expect(about).toHaveFocus();

    fireEvent.keyDown(about, { key: "ArrowRight" });
    expect(firstRun).toHaveAttribute("aria-selected", "true");
    expect(firstRun).toHaveFocus();
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
