import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { RoomIntro } from "./room-intro";

function renderIntro(props: Partial<Parameters<typeof RoomIntro>[0]> = {}) {
  render(
    <MemoryRouter>
      <RoomIntro name="general" glyph={null} {...props} />
    </MemoryRouter>,
  );
}

it("renders a channel name as a #-prefixed heading", () => {
  renderIntro();
  expect(screen.getByRole("heading", { name: "#general" })).toBeInTheDocument();
  expect(screen.getByText(/beginning of the channel/i)).toBeInTheDocument();
});

it("renders the topic", () => {
  renderIntro({ topic: "ship the daemon" });
  expect(screen.getByText("ship the daemon")).toBeInTheDocument();
});

it("names a DM without the # prefix", () => {
  renderIntro({ name: "Ada", isDm: true });
  expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
  expect(screen.getByText(/your conversation with/i)).toBeInTheDocument();
});
