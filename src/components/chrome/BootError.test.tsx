import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BootError from "./BootError";

/* Boot-error screen (API §5.1): human copy only; both versions named. */

describe("BootError", () => {
  it("renders the message and both contract versions", () => {
    render(
      <BootError
        userMessage="This build of ScreenStudio Pro doesn't match its recording core."
        expected="1.0.0"
        actual="2.0.0"
      />,
    );
    expect(
      screen.getByText("This build of ScreenStudio Pro doesn't match its recording core."),
    ).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
  });

  it("says 'no answer' when the core never responded", () => {
    render(
      <BootError
        userMessage="ScreenStudio Pro could not reach its recording core."
        expected="1.0.0"
        actual={null}
      />,
    );
    expect(screen.getByText("no answer")).toBeInTheDocument();
  });
});
