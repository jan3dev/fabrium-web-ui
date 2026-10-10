import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a type-scale size next to a token text colour", () => {
    expect(cn("text-body2", "text-text-primary")).toBe("text-body2 text-text-primary");
  });

  it("lets a later size, radius or shadow win", () => {
    expect(cn("text-body2", "text-caption1")).toBe("text-caption1");
    expect(cn("rounded-utility", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-button", "shadow-modal")).toBe("shadow-modal");
  });
});
