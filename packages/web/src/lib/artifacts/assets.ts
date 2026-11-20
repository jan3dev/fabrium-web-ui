/**
 * Assets in slides, design and html documents (spec §5.4): the document names an uploaded
 * file by `mxc://` URI in `src` on `img`, `video` and `video > source`, and in `url()`
 * inside `@font-face`. The frame has no network, so the app downloads each through
 * authenticated media and posts the bytes in; the frame makes its own object URL. Bytes and
 * types are untrusted either way: sizes are capped and the type is only a hint.
 */

export type AssetKind = "image" | "video" | "font";

/** Bytes, at least the daemon's caps (decimal 10 MB, 50 MB, 2 MB). */
export const ASSET_LIMITS: Record<AssetKind, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  font: 2 * 1024 * 1024,
};
/** Distinct `mxc://` URIs per artifact. */
export const MAX_ASSETS = 100;

/**
 * An `mxc://` URI as a RegExp source (the frame runtime uses it too): the Matrix server name
 * and media ID grammar, so nothing that can end an attribute or a `url()`.
 */
export const MXC_PATTERN = "mxc://[A-Za-z0-9.:\\[\\]-]{1,255}/[A-Za-z0-9_-]{1,255}";
const MXC = new RegExp(`^${MXC_PATTERN}$`);
export const isMxc = (v: unknown): v is string => typeof v === "string" && MXC.test(v);

/** What a file is as an asset the user may upload, or null (the drop and the Image and Video tools). */
export function uploadKind(type: string): "image" | "video" | null {
  return /^image\/[a-z0-9.+-]+$/i.test(type) ? "image" : /^video\/[a-z0-9.+-]+$/i.test(type) ? "video" : null;
}

/** The type the frame gives the bytes: the server's, if it is one of this kind's, else none (the browser sniffs). */
export function assetType(kind: AssetKind, type: string): string {
  const t = type.split(";")[0]!.trim().toLowerCase();
  const ok =
    kind === "font"
      ? /^(font\/[a-z0-9.+-]+|application\/(font-woff2?|x-font-(ttf|otf)))$/.test(t)
      : new RegExp(`^${kind}/[a-z0-9.+-]+$`).test(t);
  return ok ? t : "";
}

/** The assets a parsed document names, by URI, first come first; at most `MAX_ASSETS`. */
export function assetsIn(doc: Document): Map<string, AssetKind> {
  const out = new Map<string, AssetKind>();
  const add = (mxc: string | null, kind: AssetKind) => {
    if (isMxc(mxc) && !out.has(mxc) && out.size < MAX_ASSETS) out.set(mxc, kind);
  };
  for (const el of doc.querySelectorAll("img[src], video[src], video > source[src]"))
    add(el.getAttribute("src"), el.localName === "img" ? "image" : "video");
  const url = new RegExp(`url\\(\\s*["']?(${MXC_PATTERN})`, "g");
  for (const style of doc.querySelectorAll("style"))
    for (const face of (style.textContent ?? "").matchAll(/@font-face\s*\{[^}]*\}/gi))
      for (const m of face[0].matchAll(url)) add(m[1]!, "font");
  return out;
}

/** `assetsIn` of a source, parsed inert. */
export function findAssets(html: string): Map<string, AssetKind> {
  return html.includes("mxc://") ? assetsIn(new DOMParser().parseFromString(html, "text/html")) : new Map();
}

/**
 * The source with each asset in `urls` (by URI) as its `data:` URI, where the document uses
 * it: `src=` and `url(`. The download and the PDF are then whole files without network.
 */
export function inlineAssets(html: string, urls: ReadonlyMap<string, string>): string {
  if (urls.size === 0) return html;
  const at = new RegExp(`(\\bsrc\\s*=\\s*["']?|url\\(\\s*["']?)(${MXC_PATTERN})`, "g");
  return html.replace(at, (all, lead: string, mxc: string) => {
    const url = urls.get(mxc);
    return url ? lead + url : all;
  });
}
