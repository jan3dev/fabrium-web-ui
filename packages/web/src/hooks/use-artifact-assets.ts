import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MatrixClientPeg } from "@/client/peg";
import { ASSET_LIMITS, type AssetKind, assetType, findAssets, isMxc, MAX_ASSETS, uploadKind } from "@/lib/artifacts/assets";
import { fetchAuthedMedia } from "@/lib/matrix/authed-media";

/**
 * One asset's bytes for the frame (spec §5.4): the frame makes its own object URL from them.
 * A Blob, so posting it to every frame shares the bytes instead of copying them.
 */
export interface FrameAsset {
  mxc: string;
  kind: AssetKind;
  blob: Blob;
}

// ponytail: kept for the session, never evicted; evict per artifact if memory matters.
const cache = new Map<string, Promise<FrameAsset | null>>();

/** Downloads through authenticated media once; null when it is too large or cannot be fetched. */
function load(mxc: string, kind: AssetKind): Promise<FrameAsset | null> {
  const key = `${kind} ${mxc}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const client = MatrixClientPeg.safeGet();
  if (!client) return Promise.resolve(null);
  const p = fetchAuthedMedia(client, mxc).then(
    (blob) => (blob.size > ASSET_LIMITS[kind] ? null : { mxc, kind, blob: blob.slice(0, blob.size, assetType(kind, blob.type)) }),
    () => {
      // A failed download is tried again by the next document that names it.
      cache.delete(key);
      return null;
    },
  );
  cache.set(key, p);
  return p;
}

/**
 * The assets `text` names, as they arrive; `named` counts them all, loaded or not. `find`
 * reads them from the text: markup by default, a whiteboard's nodes (`findBoardAssets`).
 */
export function useArtifactAssets(
  text: string | null,
  find: (text: string) => Map<string, AssetKind> = findAssets,
): { assets: FrameAsset[]; named: number } {
  const wanted = useMemo(() => (text === null ? new Map<string, AssetKind>() : find(text)), [text, find]);
  const key = [...wanted].map(([mxc, kind]) => `${kind} ${mxc}`).join("\n");
  const [loaded, setLoaded] = useState<ReadonlyMap<string, FrameAsset | null>>(new Map());
  useEffect(() => {
    let live = true;
    for (const [mxc, kind] of wanted)
      void load(mxc, kind).then((a) => {
        if (live) setLoaded((prev) => (prev.get(mxc) === a ? prev : new Map(prev).set(mxc, a)));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `wanted` by value
  }, [key]);
  const assets = useMemo(
    () => [...wanted.keys()].flatMap((mxc) => (loaded.get(mxc) ? [loaded.get(mxc)!] : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `wanted` by value
    [key, loaded],
  );
  return { assets, named: wanted.size };
}

/** Each asset as a `data:` URI, by its `mxc://` URI: for the download and the PDF. */
export async function assetDataUrls(assets: readonly FrameAsset[]): Promise<Map<string, string>> {
  const read = (a: FrameAsset) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(a.blob.type ? a.blob : a.blob.slice(0, a.blob.size, "application/octet-stream"));
    });
  return new Map(await Promise.all(assets.map(async (a) => [a.mxc, await read(a)] as const)));
}

/** An image's own size, or null. Decoded off the DOM. */
async function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * The user's image or video file, uploaded through authenticated media (spec §5.4), for an
 * artifact that already names `named` assets. Null, after telling the user, when the file is
 * no image or video, too large, one too many, or the upload failed.
 */
export async function uploadAsset(
  file: File,
  named: number,
): Promise<{ mxc: string; kind: "image" | "video"; size: { w: number; h: number } | null } | null> {
  const kind = uploadKind(file.type);
  if (!kind) {
    toast.error("Only images and videos can be dropped here.");
    return null;
  }
  if (file.size > ASSET_LIMITS[kind]) {
    toast.error(`This ${kind} is larger than ${ASSET_LIMITS[kind] / 1024 / 1024} MB.`);
    return null;
  }
  if (named >= MAX_ASSETS) {
    toast.error(`An artifact holds at most ${MAX_ASSETS} images, videos and fonts.`);
    return null;
  }
  const client = MatrixClientPeg.safeGet();
  if (!client) return null;
  const pending = toast.loading(`Uploading ${file.name}`);
  let mxc: string;
  try {
    mxc = (await client.uploadContent(file, { name: file.name, type: file.type })).content_uri;
  } catch {
    mxc = "";
  } finally {
    toast.dismiss(pending);
  }
  if (!isMxc(mxc)) {
    toast.error("Could not upload the file");
    return null;
  }
  return { mxc, kind, size: kind === "image" ? await imageSize(file) : null };
}
