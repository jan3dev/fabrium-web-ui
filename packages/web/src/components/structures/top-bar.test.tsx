import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { setGlobalSearchEnabled } from "../../client/feature-flags";
import { TopBar } from "./top-bar";

function renderTopBar() {
  render(
    <MemoryRouter>
      <SidebarProvider>
        <TopBar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("<TopBar>", () => {
  afterEach(() => setGlobalSearchEnabled(true));

  it("links to the search page, not a text input", () => {
    setGlobalSearchEnabled(true);
    renderTopBar();
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute(
      "href",
      "/search",
    );
    expect(
      screen.queryByRole("textbox", { name: /search/i }),
    ).not.toBeInTheDocument();
  });

  it("hides search entirely when global search is off", () => {
    setGlobalSearchEnabled(false);
    renderTopBar();
    expect(
      screen.queryByRole("link", { name: /search/i }),
    ).not.toBeInTheDocument();
  });

  it("always offers the sidebar toggle", () => {
    renderTopBar();
    expect(
      screen.getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
  });
});
