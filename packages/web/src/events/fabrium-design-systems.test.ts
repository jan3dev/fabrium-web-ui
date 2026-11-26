import { describe, expect, it } from "vitest";
import {
  activeDesignSystem,
  decodeDesignSystemPrefs,
  decodeDesignSystems,
  designSystemChoice,
  encodeDesignSystemPrefs,
  encodeDesignSystems,
  MAX_DESIGN_SYSTEMS,
  mergeDesignSystems,
} from "./fabrium-design-systems";

const entry = (identifier: string, extra: Record<string, unknown> = {}) => ({
  room_id: "!room:example.org",
  thread_id: "$thread",
  identifier,
  name: identifier.toUpperCase(),
  ...extra,
});

describe("decodeDesignSystems", () => {
  it("keeps well-formed entries and drops the rest", () => {
    const systems = decodeDesignSystems({
      systems: [
        entry("brand", { default: true, for: ["slides", "motion", "whiteboard", 3] }),
        entry("brand"), // duplicate
        entry("no thread", {}),
        { ...entry("x"), room_id: "room" },
        { ...entry("y"), thread_id: undefined },
        entry("plain", { name: "  ‮Evil\nname  ", default: "yes" }),
        "junk",
      ],
    });
    expect(systems).toEqual([
      { roomId: "!room:example.org", threadId: "$thread", identifier: "brand", name: "BRAND", isDefault: true, for: ["slides", "motion"] },
      { roomId: "!room:example.org", threadId: "$thread", identifier: "plain", name: "Evil name", isDefault: false },
    ]);
  });

  it("falls back to the identifier for a missing name and caps the list", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...entry(`s${i}`), name: undefined }));
    const systems = decodeDesignSystems({ systems: many });
    expect(systems).toHaveLength(MAX_DESIGN_SYSTEMS);
    expect(systems[0]!.name).toBe("s0");
    expect(decodeDesignSystems(null)).toEqual([]);
    expect(decodeDesignSystems({ systems: "x" })).toEqual([]);
  });

  it("round-trips through encode", () => {
    const content = { systems: [entry("brand", { default: true, for: ["slides"] }), entry("other")] };
    expect(encodeDesignSystems(decodeDesignSystems(content))).toEqual(content);
  });
});

describe("prefs", () => {
  it("decodes and encodes the account data", () => {
    expect(decodeDesignSystemPrefs(undefined)).toEqual({ off: false });
    expect(decodeDesignSystemPrefs({ off: 1, default: { room_id: "!r", identifier: "bad id" } })).toEqual({ off: false });
    const prefs = decodeDesignSystemPrefs({ off: true, default: { room_id: "!r", identifier: "brand" } });
    expect(prefs).toEqual({ off: true, default: { roomId: "!r", identifier: "brand" } });
    expect(encodeDesignSystemPrefs(prefs)).toEqual({ off: true, default: { room_id: "!r", identifier: "brand" } });
  });
});

describe("activeDesignSystem", () => {
  const project = decodeDesignSystems({ systems: [entry("deck", { default: true, for: ["slides"] })] });
  const workspace = decodeDesignSystems({ systems: [entry("brand", { default: true }), entry("deck"), entry("alt")] });
  const all = mergeDesignSystems(project, workspace);

  it("merges project first and drops the workspace copy", () => {
    expect(all.map((s) => s.identifier)).toEqual(["deck", "brand", "alt"]);
  });

  it("picks the default for the kind", () => {
    expect(activeDesignSystem(all, { off: false }, "slides")?.identifier).toBe("deck");
    expect(activeDesignSystem(all, { off: false }, "design")?.identifier).toBe("brand");
    expect(activeDesignSystem(all, { off: false })?.identifier).toBe("brand");
    expect(activeDesignSystem(project, { off: false })?.identifier).toBe("deck");
    expect(activeDesignSystem([], { off: false })).toBeNull();
  });

  it("honors the user's own default and off", () => {
    const mine = { off: false, default: { roomId: "!room:example.org", identifier: "alt" } };
    expect(activeDesignSystem(all, mine, "slides")?.identifier).toBe("alt");
    expect(designSystemChoice(mine, activeDesignSystem(all, mine))).toEqual({ room_id: "!room:example.org", identifier: "alt" });
    // No longer listed: the workspace default, and nothing personal on the message.
    const gone = { off: false, default: { roomId: "!room:example.org", identifier: "gone" } };
    expect(activeDesignSystem(all, gone)?.identifier).toBe("brand");
    expect(designSystemChoice(gone, activeDesignSystem(all, gone))).toBeNull();
    expect(activeDesignSystem(all, { off: true })).toBeNull();
    expect(designSystemChoice({ off: true }, null)).toEqual({ off: true });
  });
});
