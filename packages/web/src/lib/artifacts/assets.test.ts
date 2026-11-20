import { describe, expect, it } from "vitest";
import { assetType, findAssets, inlineAssets, isMxc, MAX_ASSETS, uploadKind } from "./assets";

const DOC = `<!doctype html><html><head><style>
@font-face { font-family: Brand; src: url("mxc://example.org/font1") format("woff2"); }
body { background: url(mxc://example.org/bg); }
</style></head><body><section>
<img src="mxc://example.org/img1" alt="">
<img src="mxc://example.org/img1">
<video src="mxc://example.org/vid1"></video>
<video><source src="mxc://example.org/vid2"></video>
<audio src="mxc://example.org/aud1"></audio>
<img src="https://example.org/x.png">
<img src="mxc://evil.org/a&quot; onerror=&quot;x">
<p>mxc://example.org/text</p>
</section></body></html>`;

describe("assets", () => {
  it("accepts only well-formed mxc URIs", () => {
    expect(isMxc("mxc://example.org/abc_D-1")).toBe(true);
    expect(isMxc("mxc://[::1]:8448/abc")).toBe(true);
    for (const bad of ["mxc://example.org/a b", 'mxc://x/a"', "mxc://x/a)", "mxc://x/", "https://x/a", "mxc://x/a/b", 1])
      expect(isMxc(bad)).toBe(false);
  });

  it("finds the images, videos and fonts a document names, once each", () => {
    expect([...findAssets(DOC)]).toEqual([
      ["mxc://example.org/img1", "image"],
      ["mxc://example.org/vid1", "video"],
      ["mxc://example.org/vid2", "video"],
      ["mxc://example.org/font1", "font"],
    ]);
    expect(findAssets("<p>no assets</p>").size).toBe(0);
  });

  it(`stops at ${MAX_ASSETS} distinct assets`, () => {
    const many = Array.from({ length: MAX_ASSETS + 20 }, (_, i) => `<img src="mxc://example.org/m${i}">`).join("");
    const found = findAssets(many);
    expect(found.size).toBe(MAX_ASSETS);
    expect(found.has(`mxc://example.org/m${MAX_ASSETS}`)).toBe(false);
  });

  it("types the bytes only by a type of the asset's own kind", () => {
    expect(assetType("image", "image/png")).toBe("image/png");
    expect(assetType("image", "image/svg+xml")).toBe("image/svg+xml");
    expect(assetType("image", "text/html")).toBe("");
    expect(assetType("video", "image/png")).toBe("");
    expect(assetType("font", "font/woff2")).toBe("font/woff2");
    expect(assetType("font", "application/javascript")).toBe("");
    expect(uploadKind("image/webp")).toBe("image");
    expect(uploadKind("video/mp4")).toBe("video");
    expect(uploadKind("application/pdf")).toBeNull();
    expect(uploadKind("")).toBeNull();
  });

  it("inlines loaded assets as data URIs where the document uses them, and leaves the rest", () => {
    const urls = new Map([
      ["mxc://example.org/img1", "data:image/png;base64,AAAA"],
      ["mxc://example.org/font1", "data:font/woff2;base64,BBBB"],
    ]);
    const out = inlineAssets(DOC, urls);
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="">\n<img src="data:image/png;base64,AAAA">');
    expect(out).toContain('src: url("data:font/woff2;base64,BBBB") format("woff2")');
    // Not loaded: left as it was. Text that only looks like an asset is not touched.
    expect(out).toContain('<video src="mxc://example.org/vid1">');
    expect(out).toContain("<p>mxc://example.org/text</p>");
    expect(inlineAssets(DOC, new Map())).toBe(DOC);
  });
});
