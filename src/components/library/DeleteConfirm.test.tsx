import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeleteConfirm from "./DeleteConfirm";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  libraryDelete: vi.fn(),
}));

import { libraryDelete } from "../../lib/ipc";
const mockLibraryDelete = vi.mocked(libraryDelete);

/* §5.1 Buttons: danger (destructive only — delete recording; `error`
   border + text on hover fills `error.muted`). §5.7 Modal & Drawer:
   centered `<dialog>` portaled to document.body (overlaps escape clipping
   containers), Modal recipe (`surface.glass-strong`, `blur(32px)`,
   `border.subtle` 1px, `elev.2`, `r.lg`, max-width 480px), scrim
   `rgba(0,0,0,0.4)` + `blur(4px)`, Esc closes, mandatory focus trap via
   native `<dialog>` semantics, restore focus on close. */
describe("DeleteConfirm (§5.1 / §5.7 / §5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders confirmation copy", () => {
    render(<DeleteConfirm open={true} recordingName="screen-2026-11-01.mp4" recordingId={17} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText('Delete “screen-2026-11-01.mp4”?')).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    const { container } = render(<DeleteConfirm open={false} recordingName="test.mp4" recordingId={17} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(container.querySelector("[role=dialog]")).not.toBeInTheDocument();
  });

  it("calls onConfirm with recording id and closes on Confirm", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<DeleteConfirm open={true} recordingName="test.mp4" recordingId={17} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(17));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel without confirming", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<DeleteConfirm open={true} recordingName="test.mp4" recordingId={17} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("danger button has error styling", () => {
    render(<DeleteConfirm open={true} recordingName="test.mp4" recordingId={17} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const danger = screen.getByRole("button", { name: /Delete/ });
    expect(danger).toHaveClass("border-error");
    expect(danger).toHaveClass("text-error");
  });

  it("calls deleteRecording and closes when confirming from LibraryGrid flow", async () => {
    mockLibraryDelete.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(<DeleteConfirm open={true} recordingName="screen-2026-11-01.mp4" recordingId={17} onConfirm={(id) => { void useSspStore.getState().deleteRecording(id); onClose(); }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(mockLibraryDelete).toHaveBeenCalledWith(17));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
