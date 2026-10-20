// Derived from Hugging Face chat-ui (Apache-2.0). Modified.
import type { ArtifactKind } from "@/model/types";

/**
 * The sandboxed document an artifact preview runs in. No network: a CSP meta
 * tag, a sandbox without `allow-same-origin`, and runtimes handed in over
 * postMessage instead of fetched. Everything the frame sends back is untrusted.
 */

/** Split so this file's own inline script cannot be ended by embedding it. */
const END_SCRIPT = "</scr" + "ipt>";

/** No `*` for images or fonts: a GET with data in its query string is exfiltration without script. */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  // CSP3; ignored where unsupported. WebRTC is otherwise outside the policy.
  "webrtc 'block'",
].join("; ");

/**
 * `allow-same-origin` must stay absent: with it, artifact code runs as the app.
 * `allow-modals` is withheld so a preview cannot block the tab with a dialog.
 */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-pointer-lock";

/** Parent ↔ frame message types. Every message also carries `channel`. */
export const PreviewMessage = {
  ready: "fabrium.preview.ready",
  error: "fabrium.preview.error",
  openLink: "fabrium.preview.openLink",
  runtime: "fabrium.preview.runtime",
  pick: "fabrium.preview.pick",
  picked: "fabrium.preview.picked",
} as const;

export type RuntimeModule = "tailwind" | "react" | "jsx";

/** Load order matters: Tailwind scans before paint, Babel after React is global. */
export function runtimesFor(kind: ArtifactKind): RuntimeModule[] {
  return kind === "react" ? ["tailwind", "react", "jsx"] : [];
}

/** JSON-encode for an inline script, escaping `</` so the parser cannot end it early. */
function embed(source: string): string {
  return JSON.stringify(source).replace(/<\//g, "<\\/");
}

/**
 * Runs before the artifact: forwards errors, routes link clicks to the parent,
 * receives runtimes, and in pick mode reports the clicked element for an
 * annotation. ES5, since it is concatenated into arbitrary agent HTML.
 */
function hookScript(channel: string, needs: readonly RuntimeModule[]): string {
  return `<script>
(function(){
  var CHANNEL = ${JSON.stringify(channel)};
  var NEEDS = ${JSON.stringify(needs)};
  var M = ${JSON.stringify(PreviewMessage)};
  function send(type, detail){ try { parent.postMessage({ type: type, channel: CHANNEL, detail: detail }, '*'); } catch (e) {} }
  function fail(message, stack){ send(M.error, { message: String(message), stack: stack }); }
  function boot(){ try { if (typeof window.__fabriumArtifactBoot === 'function') window.__fabriumArtifactBoot(); } catch (err) { fail(err && err.message ? err.message : String(err), err && err.stack); } }
  window.addEventListener('error', function(ev){ fail(ev && ev.message ? ev.message : 'Script error', ev && ev.error && ev.error.stack); });
  window.addEventListener('unhandledrejection', function(ev){ var r = ev && ev.reason; fail(typeof r === 'string' ? r : (r && r.message) ? r.message : 'Unhandled promise rejection', r && r.stack); });

  /* Pick mode: outline the hovered element, report the clicked one. */
  var picking = false, hovered = null, picked = null, style = null;
  function mark(el, attr, on){ if (el && el.removeAttribute) { if (on) el.setAttribute(attr, ''); else el.removeAttribute(attr); } }
  function setPick(on){
    picking = on; mark(hovered, 'data-fab-hover', false); mark(picked, 'data-fab-picked', false); hovered = picked = null;
    if (on && !style) {
      style = document.createElement('style');
      style.textContent = '[data-fab-hover]{outline:2px dashed rgb(59,130,246)!important;outline-offset:2px!important;cursor:crosshair!important}[data-fab-picked]{outline:2px solid rgb(37,99,235)!important;outline-offset:2px!important}';
      (document.head || document.documentElement).appendChild(style);
    }
  }
  function cssEscape(s){ return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); }
  function selectorOf(el){
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement && parts.length < 5) {
      var part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + cssEscape(el.id)); break; }
      var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(function(c){ return c && c.indexOf(':') < 0; }).slice(0, 2);
      if (cls.length) part += '.' + cls.map(cssEscape).join('.');
      var parent = el.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === el.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(' > ') || 'body';
  }
  function snippet(el){
    var clone = el.cloneNode(true);
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll ? clone.querySelectorAll('[data-fab-hover],[data-fab-picked]') : []))
      .forEach(function(n){ mark(n, 'data-fab-hover', false); mark(n, 'data-fab-picked', false); });
    return String(clone.outerHTML || '').slice(0, 1500);
  }
  document.addEventListener('mouseover', function(ev){
    if (!picking || ev.target === hovered) return;
    mark(hovered, 'data-fab-hover', false); hovered = ev.target; mark(hovered, 'data-fab-hover', true);
  }, true);

  function nearestAnchor(node){ while (node && node !== document) { if (node.tagName && node.tagName.toLowerCase() === 'a') return node; node = node.parentNode; } return null; }
  function intercept(ev){
    if (picking) {
      if (ev.type !== 'click') return;
      ev.preventDefault(); ev.stopPropagation();
      var el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
      if (!el) return;
      mark(picked, 'data-fab-picked', false); picked = el; mark(picked, 'data-fab-picked', true);
      send(M.picked, { selector: selectorOf(el), html: snippet(el), text: String(el.innerText || el.textContent || '').trim().slice(0, 1500) });
      return;
    }
    var anchor = nearestAnchor(ev.target);
    if (!anchor) return;
    ev.preventDefault(); ev.stopPropagation();
    var raw = anchor.getAttribute('href') || anchor.getAttribute('xlink:href') || '';
    if (raw.charAt(0) === '#') { var t = document.getElementById(raw.slice(1)); if (t && t.scrollIntoView) t.scrollIntoView(); return; }
    /* Only an absolute http(s) href may leave; a srcdoc inherits the app's base URL. */
    if (/^\\s*https?:/i.test(raw)) send(M.openLink, { href: String(anchor.href) });
  }
  window.addEventListener('click', intercept, true);
  window.addEventListener('auxclick', intercept, true);
  window.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') intercept(ev); }, true);

  function inject(source){ var el = document.createElement('script'); el.textContent = source; (document.head || document.documentElement).appendChild(el); el.remove(); }
  window.addEventListener('message', function(ev){
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === M.pick) { setPick(!!(data.detail && data.detail.on)); return; }
    if (data.type === M.runtime) {
      var modules = (data.detail && data.detail.modules) || [];
      try { for (var i = 0; i < modules.length; i++) if (modules[i] && typeof modules[i].source === 'string') inject(modules[i].source); }
      catch (err) { fail(err && err.message ? err.message : String(err), err && err.stack); return; }
      boot();
    }
  });
  send(M.ready);
  if (NEEDS.length === 0) boot();
})();
${END_SCRIPT}`;
}

function head(
  channel: string,
  needs: readonly RuntimeModule[],
  style = "",
): string {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    style +
    hookScript(channel, needs)
  );
}

const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i;

/** Agent HTML or SVG, with the hook injected inside its own `<head>` when it has one. */
function buildHtmlSrcdoc(content: string, channel: string): string {
  const trimmed = content.trimStart();
  if (SVG_ROOT.test(trimmed)) {
    const svg = trimmed
      .replace(/^(<\?xml[^>]*>\s*)/i, "")
      .replace(/^(<!doctype[^>]*>\s*)/i, "");
    const style =
      "<style>html,body{margin:0;background:white}body{display:flex;justify-content:center;padding:16px}svg{max-width:100%;height:auto}</style>";
    return `<!doctype html><html><head>${head(channel, [], style)}</head><body>${svg}</body></html>`;
  }
  // The policy goes first, before any agent markup, never at a matched tag:
  // a `<head` inside a comment, string or `<header>` would let a script above
  // it run unrestricted. Only a leading doctype stays ahead (no quirks mode);
  // the parser folds this implied head into the artifact's own.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content)?.[0] ?? "";
  return `${doctype}<head>${head(channel, [])}</head>${content.slice(doctype.length)}`;
}

/** Hooks as bare globals, since the tool description says they need no import. */
const REACT_PRELUDE = [
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useReducer",
  "useContext",
  "useLayoutEffect",
  "useId",
  "useTransition",
  "useDeferredValue",
  "Fragment",
  "createContext",
  "memo",
  "forwardRef",
]
  .map((n) => `var ${n} = React.${n};`)
  .join(" ");

/** One React component, compiled in the frame by Babel; imports are stripped (no module graph). */
function buildReactSrcdoc(code: string, channel: string): string {
  return `<!doctype html>
<html>
<head>${head(channel, runtimesFor("react"), "<style>html,body{margin:0;min-height:100%;background:white}</style>")}</head>
<body>
<div id="artifact-root"></div>
<script>
window.__fabriumArtifactBoot = function () {
  var source = ${embed(code)};
  function showError(message) {
    var el = document.getElementById("artifact-root");
    var pre = document.createElement("pre");
    pre.style.cssText = "color:crimson;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:16px;margin:0";
    pre.textContent = message;
    el.innerHTML = "";
    el.appendChild(pre);
    setTimeout(function () { throw new Error(message); }, 0);
  }
  try {
    var prepared = source
      .replace(/^[ \\t]*import\\s+(?:[\\w$*{}\\s,]+\\s+from\\s*)?["'][^"'\\n]+["'];?/gm, "")
      .replace(/^[ \\t]*export\\s+\\{[^}]*\\}\\s*;?[ \\t]*$/gm, "")
      .replace(/\\bexport\\s+default\\s+/, "window.__artifactDefault = ")
      .replace(/^([ \\t]*)export\\s+(const|let|var|function|class)/gm, "$1$2");
    // Babel 8: TSX is inferred from the filename, and the classic runtime emits no import.
    var compiled = Babel.transform(prepared, {
      filename: "artifact.tsx",
      presets: [["react", { runtime: "classic" }], "typescript"]
    }).code;
    (0, eval)(${embed(REACT_PRELUDE)} + "\\n" + compiled);
    var Component = window.__artifactDefault;
    if (!Component) { showError("No default export found. The artifact must use export default for its component."); return; }
    ReactDOM.createRoot(document.getElementById("artifact-root")).render(React.createElement(Component));
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
};
${END_SCRIPT}
</body>
</html>`;
}

/** Only previewable kinds reach here; markdown and code render in the page. */
export function buildArtifactSrcdoc(
  kind: ArtifactKind,
  content: string,
  channel: string,
): string {
  return kind === "react"
    ? buildReactSrcdoc(content, channel)
    : buildHtmlSrcdoc(content, channel);
}
