import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageTimestamp } from "./message-timestamp";

describe("<MessageTimestamp>", () => {
  it("renders a relative time in a <time> element", () => {
    const ts = Date.now() - 5 * 60_000;
    render(<MessageTimestamp createdAt={ts} />);
    const el = screen.getByText("5m ago");
    expect(el.tagName.toLowerCase()).toBe("time");
    expect(el).toHaveAttribute("datetime", new Date(ts).toISOString());
  });

  it("drops the day period in the compact gutter clock", () => {
    const ts = new Date(2026, 5, 16, 21, 5).getTime();
    render(<MessageTimestamp createdAt={ts} compact />);
    expect(screen.getByText(/^\d{1,2}:05$/)).toBeInTheDocument();
  });
});
