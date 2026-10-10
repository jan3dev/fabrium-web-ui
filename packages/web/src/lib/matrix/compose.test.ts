// @vitest-environment jsdom
// happy-dom keeps `javascript:` hrefs DOMPurify strips elsewhere; see formatted-message-body.test.tsx.
import { describe, expect, it } from "vitest";
import { composeText } from "./compose";

const coder = { label: "Coder · Payments", target: "@coder:h.example" };
const alice = { label: "Alice", target: "@alice:h.example" };

describe("composeText", () => {
  it("sends plain text without formatted_body", () => {
    expect(composeText("hello\nworld")).toEqual({
      body: "hello\nworld",
      mentionUserIds: [],
    });
  });

  it("renders Markdown into formatted_body and keeps the Markdown as body", () => {
    const out = composeText("**bold** and `code`");
    expect(out.body).toBe("**bold** and `code`");
    expect(out.formattedBody).toBe(
      "<p><strong>bold</strong> and <code>code</code></p>",
    );
  });

  it("turns a picked mention into the user ID in body and a matrix.to pill in HTML", () => {
    const out = composeText("@Coder · Payments please **fix** it", {
      mentions: [coder],
    });
    expect(out.body).toBe("@coder:h.example please **fix** it");
    expect(out.mentionUserIds).toEqual(["@coder:h.example"]);
    expect(out.formattedBody).toContain(
      '<a href="https://matrix.to/#/@coder:h.example">Coder · Payments</a>',
    );
  });

  it("only lists mentions still in the text", () => {
    const out = composeText("hi @Alice", { mentions: [coder, alice] });
    expect(out.mentionUserIds).toEqual(["@alice:h.example"]);
    expect(out.body).toBe("hi @alice:h.example");
  });

  it("resolves a hand-typed @localpart against members", () => {
    const out = composeText("@bob ping", {
      members: [{ userId: "@bob:h.example" }],
    });
    expect(out).toEqual({
      body: "@bob:h.example ping",
      mentionUserIds: ["@bob:h.example"],
    });
  });

  it("links a picked room", () => {
    const out = composeText("see #general", {
      rooms: [{ label: "general", target: "!g:h.example" }],
    });
    expect(out.body).toBe("see https://matrix.to/#/!g:h.example");
    expect(out.formattedBody).toContain(
      '<a href="https://matrix.to/#/!g:h.example">#general</a>',
    );
  });

  it("keeps a hostile display name from planting its own link", () => {
    const evil = { label: "x](https://evil.example) [y", target: "@eve:h.example" };
    const html = composeText("hi @x](https://evil.example) [y", { mentions: [evil] }).formattedBody ?? "";
    expect(html).not.toContain("evil.example\"");
    expect(html).toContain('<a href="https://matrix.to/#/@eve:h.example">x](https://evil.example) [y</a>');
  });

  it("strips unsafe HTML", () => {
    expect(
      composeText("[x](javascript:alert(1))").formattedBody ?? "",
    ).not.toContain("javascript:");
  });
});
