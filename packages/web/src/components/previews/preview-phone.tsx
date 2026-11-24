import { useMemo } from "react";
import { encode } from "uqr";
import { QrCodeIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copyToClipboard } from "@/lib/browser-actions";
import type { PreviewSession } from "@/model/types";

/** The link Expo Go opens: the preview session URL with Expo's scheme for https (spec §3.8). */
function expoGoUrl(sessionUrl: string): string | null {
  return sessionUrl.startsWith("https://") ? `exps://${sessionUrl.slice("https://".length)}` : null;
}

/** One path, a unit square per dark module, with the 4-module quiet zone scanners need. */
function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { border: 4 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, size: qr.size };
  }, [text]);
  // Scanners need dark on light: light-theme tokens in both themes.
  return (
    <div data-theme="light" className="mx-auto w-fit rounded-utility bg-surface-primary text-text-primary">
      <svg viewBox={`0 0 ${size} ${size}`} className="size-48" shapeRendering="crispEdges" role="img" aria-label="QR code of the link">
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * Open on phone: the QR code that opens an Expo preview in Expo Go. Whoever has the link can use the app
 * until it expires. Renders nothing without an https preview origin (`zooid dev`): Expo Go needs one.
 */
export function PreviewPhone({ session }: { session: PreviewSession }) {
  const url = expoGoUrl(session.url);
  if (!url) return null;
  const expires = new Date(session.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="utility" size="xs" data-testid="preview-phone">
          <QrCodeIcon />
          Open on phone
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-2" data-testid="preview-phone-popover">
        <QrCode text={url} />
        <p className="text-center text-body2 font-medium">Scan with Expo Go</p>
        <p className="truncate font-mono text-caption1 text-text-tertiary" title={url}>
          {url}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="xs" onClick={() => copyToClipboard(url, "Link copied. It works until it expires.")}>
            Copy link
          </Button>
          <span className="text-caption1 text-text-tertiary">Expires {expires}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
