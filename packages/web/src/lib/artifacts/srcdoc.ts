// Derived from Hugging Face chat-ui (Apache-2.0). Modified.
import type { ArtifactKind } from "@/model/types";
import { FRAME_SIZE, type FrameKind, isFrameKind, MAX_FRAMES, NAV_KEYS, PASS_KEYS, SLIDE_SIZES, ZOOM_KEYS } from "./frames";
import { MXC_PATTERN } from "./assets";
import { editorRuntime } from "./editor-runtime";
import { MAX_PINS } from "./pins";
import { STYLE_PROPS } from "./styles";
import { TWEAK_NAME, TWEAK_VAR } from "./tweaks";

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
  "font-src data: blob:",
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

/**
 * The PDF export's frame only: `print()` inside a sandbox needs `allow-modals`, and the
 * parent cannot call it on an opaque origin. The frame lives until the dialog closes;
 * still no `allow-same-origin`, same CSP.
 */
export const PRINT_SANDBOX = "allow-scripts allow-modals";

/** Parent ↔ frame message types. Every message also carries `channel`. */
export const PreviewMessage = {
  ready: "fabrium.preview.ready",
  error: "fabrium.preview.error",
  openLink: "fabrium.preview.openLink",
  runtime: "fabrium.preview.runtime",
  pick: "fabrium.preview.pick",
  picked: "fabrium.preview.picked",
  style: "fabrium.preview.style",
  /** Parent → frame `{ index, zoom, transition? }`; `zoom: null` fits the frame to the stage. */
  frame: "fabrium.preview.frame",
  /** Frame → parent `{ key }`: a key from `FRAME_KEYS` pressed while the frame has focus. */
  key: "fabrium.preview.key",
  /** Print frame → parent: the print dialog closed. */
  printed: "fabrium.preview.printed",
  /** Parent → frame `{ mode }`: the canvas editor `off`, `inspect` (select only), `style` (html: style and text) or `full`. */
  editor: "fabrium.preview.editor",
  /** Parent → frame `{ ids }`: select these layers. */
  select: "fabrium.preview.select",
  /** Frame → parent: the selection, its boxes and the first one's computed styles (untrusted). */
  selection: "fabrium.preview.selection",
  /** Frame → parent `{ ops }`: gestures as ops (canvas.ts `readOp`); the parent validates and applies them. */
  op: "fabrium.preview.op",
  /** Parent → frame `{ patches, select?, edit? }`: what an applied op changed, by id (canvas.ts `Patch`). */
  patch: "fabrium.preview.patch",
  /** Frame → parent `{ key, shiftKey, metaKey, ctrlKey, altKey }`: a key for canvas.ts `editKeyOf`. */
  editKey: "fabrium.preview.editKey",
  /** Parent → frame `{ assets: [{ mxc, kind, blob }] }`: downloaded assets (spec §5.4); the frame makes its own object URLs. */
  assets: "fabrium.preview.assets",
  /** Frame → parent: files are dragged over the frame. The frame never takes the drop; the stage does. */
  drag: "fabrium.preview.drag",
  /** Parent → frame `{ pins: [{ id, selector }] }`: elements to follow (pins.ts); the frame only queries them. */
  pins: "fabrium.preview.pins",
  /** Frame → parent `{ boxes: [{ id, x, y, w, h }] }`: where the followed elements are now, sent when they move. */
  pinned: "fabrium.preview.pinned",
  /** Frame → parent `{ scale }`: the scale the open frame is drawn at, sent when it changes. */
  scale: "fabrium.preview.scale",
  /** Frame → parent `{ factor }`: Cmd/Ctrl+wheel or a pinch over the frame asks for that much more zoom. */
  zoom: "fabrium.preview.zoom",
  /** Parent → frame `{ vars, texts }`: tweak values (tweaks.ts `tweakMessage`), custom properties on `:root` and `[data-tweak]` text. */
  tweak: "fabrium.preview.tweak",
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
function hookScript(
  channel: string,
  needs: readonly RuntimeModule[],
  frames: FrameKind | null,
  print: boolean,
  canvas = false,
): string {
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
  var PROPS = ${JSON.stringify(STYLE_PROPS)};
  var picking = false, hovered = null, picked = null, saved = {}, style = null;
  /* Style edits are a draft on the picked element: they go when it is left, unless the parent keeps them. */
  function restore(){ if (picked) for (var p in saved) picked.style.setProperty(p, saved[p][0], saved[p][1]); saved = {}; }
  function mark(el, attr, on){ if (el && el.removeAttribute) { if (on) el.setAttribute(attr, ''); else el.removeAttribute(attr); } }
  function setPick(on){
    picking = on; restore(); mark(hovered, 'data-fab-hover', false); mark(picked, 'data-fab-picked', false); hovered = picked = null;
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
      var siblings = el.parentNode && el.parentNode.children;
      if (siblings) {
        var same = Array.prototype.filter.call(siblings, function(c){ return c.tagName === el.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = up(el);
    }
    return parts.join(' > ') || 'body';
  }
  function snippet(el){
    var clone = el.cloneNode(true);
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll ? clone.querySelectorAll('[data-fab-hover],[data-fab-picked]') : []))
      .forEach(function(n){ mark(n, 'data-fab-hover', false); mark(n, 'data-fab-picked', false); });
    return String(clone.outerHTML || '').slice(0, 1500);
  }
  /* The element under the pointer, also inside an open shadow root (design-system cards). */
  function targetOf(ev){ var t = ev.composedPath ? ev.composedPath()[0] : ev.target; return t && t.nodeType === 1 ? t : t && t.parentElement; }
  /* Focus is in a field: keys belong to it. */
  function typing(t){ var tag = t && t.tagName ? t.tagName.toLowerCase() : ''; return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(t && t.isContentEditable); }
  function up(node){ return node.parentElement || (node.parentNode && node.parentNode.host) || null; }
  document.addEventListener('mouseover', function(ev){
    var t = targetOf(ev);
    if (!picking || t === hovered) return;
    mark(hovered, 'data-fab-hover', false); hovered = t; mark(hovered, 'data-fab-hover', true);
  }, true);

  function nearestAnchor(node){ while (node && node.nodeType === 1) { if (node.tagName.toLowerCase() === 'a') return node; node = up(node); } return null; }
  function intercept(ev){
    /* The canvas editor owns clicks and keys while it is on. */
    if (editing) return;
    if (picking) {
      if (ev.type !== 'click') return;
      ev.preventDefault(); ev.stopPropagation();
      var el = targetOf(ev);
      if (!el) return;
      restore(); mark(picked, 'data-fab-picked', false); picked = el; mark(picked, 'data-fab-picked', true);
      var computed = window.getComputedStyle(el), styles = {};
      for (var i = 0; i < PROPS.length; i++) styles[PROPS[i]] = computed.getPropertyValue(PROPS[i]);
      send(M.picked, { selector: selectorOf(el), html: snippet(el), styles: styles, text: String(el.innerText || el.textContent || '').trim().slice(0, 1500) });
      return;
    }
    var anchor = nearestAnchor(targetOf(ev));
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

  var frameTo = null, editing = false, onEditor = null, onFrameChange = null;
  /* The canvas the editor works in: the body, or the open frame (framesRuntime). */
  var frameRoot = function(){ return document.body; };
${frames ? framesRuntime(frames, print) : ""}
${canvas && !print ? editorRuntime() : ""}
  /* Assets (spec §5.4): the parent posts the bytes of each mxc:// URI the document names; they
     become this frame's own object URLs on img, video and source, and in @font-face url(). */
  var ASSETS = {}, MXC = new RegExp(${JSON.stringify(MXC_PATTERN)}, 'g');
  function resolveAssets(){
    var els = document.querySelectorAll('img[src^="mxc://"],video[src^="mxc://"],source[src^="mxc://"]');
    for (var i = 0; i < els.length; i++) {
      var u = ASSETS[els[i].getAttribute('src')];
      if (!u) continue;
      els[i].setAttribute('src', u);
      if (els[i].parentElement && els[i].parentElement.tagName === 'VIDEO' && els[i].tagName === 'SOURCE') els[i].parentElement.load();
    }
    var sheets = document.querySelectorAll('style');
    for (var j = 0; j < sheets.length; j++) {
      var t = sheets[j].textContent;
      if (t.indexOf('mxc://') < 0) continue;
      var next = t.replace(MXC, function(m){ return ASSETS[m] || m; });
      if (next !== t) sheets[j].textContent = next;
    }
  }
  function addAssets(list){
    for (var i = 0; i < list.length && i < 100; i++) {
      var a = list[i] || {};
      if (typeof a.mxc !== 'string' || ASSETS[a.mxc] || !(a.blob instanceof Blob)) continue;
      try { ASSETS[a.mxc] = URL.createObjectURL(a.blob); } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolveAssets); else resolveAssets();
  }
  /* Dropped files are the user's: the drop goes to the stage outside this frame, never to agent code. */
  function hasFiles(ev){ return !!(ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0); }
  ['dragenter', 'dragover', 'drop'].forEach(function(type){
    window.addEventListener(type, function(ev){
      if (!hasFiles(ev)) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (type === 'dragenter') send(M.drag);
    }, true);
  });
  /* Tweaks (spec §6.7): the parent validated the values ("" removes a property); names are checked again before they reach a selector. */
  function applyTweaks(d){
    var vars = d.vars || {}, texts = d.texts || {}, root = document.documentElement, k, i;
    for (k in vars) if (/${TWEAK_VAR.source}/.test(k) && typeof vars[k] === 'string') root.style.setProperty(k, vars[k]);
    for (k in texts) {
      if (!/${TWEAK_NAME.source}/.test(k) || typeof texts[k] !== 'string') continue;
      var els = document.querySelectorAll('[data-tweak="' + k + '"]');
      for (i = 0; i < els.length; i++) if (els[i].textContent !== texts[k]) els[i].textContent = texts[k];
    }
  }
  /* Pins (spec §6.6, §6.8): comment markers and the agent cursor. The parent names elements by
     selector and draws its markers over the frame; here they are only queried and measured. */
  var PINS = [], pinTimer = null, pinLast = '';
  function measurePins(){
    var out = [];
    for (var i = 0; i < PINS.length; i++) {
      var el = null;
      try { el = document.querySelector(PINS[i].selector); } catch (e) {}
      if (!el || !el.getBoundingClientRect) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) out.push({ id: PINS[i].id, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    var key = JSON.stringify(out);
    if (key !== pinLast) { pinLast = key; send(M.pinned, { boxes: out }); }
  }
  function setPins(list){
    PINS = [];
    for (var i = 0; i < list.length && i < ${MAX_PINS}; i++) if (list[i] && typeof list[i].id === 'string' && typeof list[i].selector === 'string') PINS.push({ id: list[i].id, selector: list[i].selector });
    if (pinTimer) clearInterval(pinTimer);
    pinTimer = PINS.length ? setInterval(measurePins, 250) : null;
    pinLast = '';
    measurePins();
  }
  var pinFrame = 0;
  window.addEventListener('scroll', function(){
    if (PINS.length && !pinFrame) pinFrame = requestAnimationFrame(function(){ pinFrame = 0; measurePins(); });
  }, true);
  function inject(source){ var el = document.createElement('script'); el.textContent = source; (document.head || document.documentElement).appendChild(el); el.remove(); }
  window.addEventListener('message', function(ev){
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === M.pick) { setPick(!!(data.detail && data.detail.on)); return; }
    if (data.type === M.frame) { if (frameTo) frameTo(data.detail || {}); return; }
    if (data.type === M.editor || data.type === M.patch || data.type === M.select) { if (onEditor) onEditor(data.type, data.detail || {}); if (data.type === M.patch) resolveAssets(); return; }
    if (data.type === M.tweak) { applyTweaks(data.detail || {}); return; }
    if (data.type === M.pins) { setPins(Array.isArray(data.detail && data.detail.pins) ? data.detail.pins : []); return; }
    if (data.type === M.assets) { addAssets(Array.isArray(data.detail && data.detail.assets) ? data.detail.assets : []); return; }
    if (data.type === M.style) {
      var d = data.detail || {};
      if (d.reset) restore();
      else if (d.keep) saved = {};
      else if (picked && PROPS.indexOf(d.prop) >= 0) {
        if (!(d.prop in saved)) saved[d.prop] = [picked.style.getPropertyValue(d.prop), picked.style.getPropertyPriority(d.prop)];
        picked.style.setProperty(d.prop, String(d.value == null ? '' : d.value));
      }
      return;
    }
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

/**
 * Part of the hook script for slides and design: each `body > section` is a canvas
 * (slides 1920×1080, or the size `data-size` on `body` names; design `data-width`/`data-height`,
 * default 1440×900). Only the
 * active one shows, scaled to fit or at the parent's zoom, entered with the parent's
 * transition. Layout is one stylesheet keyed by `:nth-of-type`, so the agent's elements
 * stay untouched for pick mode. The parent lists the frames from the source (frames.ts).
 * In print mode every section but the skipped ones is a page at its canvas size, and
 * the frame opens the print dialog once loaded.
 */
function framesRuntime(kind: FrameKind, print: boolean): string {
  return `
  (function(){
    var SLIDES = ${kind === "slides"}, PRINT = ${print};
    /* The print frame has allow-modals (for print()): agent scripts get no alert, confirm or prompt over the app.
       This runs before any agent markup; a nested frame could still reach the originals, so it narrows, not closes. */
    if (PRINT) ['alert', 'confirm', 'prompt'].forEach(function(k){
      try { Object.defineProperty(window, k, { value: function(){ return k === 'confirm' ? false : k === 'prompt' ? null : undefined; }, writable: false, configurable: false }); } catch (e) {}
    });
    /* Navigation keys are kept from the frame; Present keys pass through, so a zoomed frame still scrolls. */
    var KEYS = ${JSON.stringify(NAV_KEYS)}, PASS = ${JSON.stringify(PASS_KEYS)};
    var ZOOM = ${JSON.stringify(ZOOM_KEYS)}, SIZE = ${JSON.stringify(FRAME_SIZE)}, DECK = ${JSON.stringify(SLIDE_SIZES)};
    var BOX = 'min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;';
    /* Speaker notes never show on a frame; a note for the builder shows as a note, but not in Present or the PDF. */
    var NOTES = 'body>section>aside[data-notes]{display:none!important}';
    var NOTE = ':where(body>section aside[data-note]){display:block;box-sizing:border-box;padding:16px;background:rgb(254,240,138);color:rgb(66,32,6);font:24px/1.35 system-ui,sans-serif;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)}';
    var NO_NOTE = 'aside[data-note]{display:none!important}';
    var ENTER = '@keyframes fab-fade{from{opacity:0}}@keyframes fab-from-right{from{translate:100vw 0}}@keyframes fab-from-left{from{translate:-100vw 0}}';
    var list = [], active = 0, zoom = null, sheet = null, want = null, enter = '', present = false;
    /* Design: every artboard in a row with its name above (spec §6.3), panned by scroll or Space-drag. */
    var row = false, labels = null, space = false, pan = null, GAP = 80, LABEL = 28;
    /* The scale last reported, where the pointer is in here, and the wheel zoom not yet sent. */
    var shown = 0, mouse = null, wheel = 1, wheelRaf = 0;
    function report(s){ s = Math.round(s * 100) / 100; if (s !== shown) { shown = s; send(M.scale, { scale: s }); } }
    /* A zoom keeps the point under the pointer where it is; with the pointer elsewhere, the middle of the stage. */
    function zoomed(run){
      var el = frameRoot(), root = document.documentElement, a = mouse || [root.clientWidth / 2, root.clientHeight / 2];
      if (!el) { run(); return; }
      var r = el.getBoundingClientRect(), u = (a[0] - r.left) / r.width, v = (a[1] - r.top) / r.height;
      run();
      r = el.getBoundingClientRect();
      window.scrollBy(r.left + u * r.width - a[0], r.top + v * r.height - a[1]);
    }
    frameRoot = function(){ return list.length ? document.querySelectorAll('body > section')[active] || null : null; };
    function size(v, d){ var n = parseFloat(v); return isFinite(n) ? Math.min(SIZE.max, Math.max(SIZE.min, n)) : d; }
    function name(el, i){
      var h = el && el.querySelector('h1,h2,h3,h4,h5,h6');
      return ((el && el.getAttribute('data-name')) || (h && h.textContent) || '').replace(/\\s+/g, ' ').trim().slice(0, 120) || 'Screen ' + (i + 1);
    }
    /* The names, in a closed shadow root the document's CSS cannot reach. */
    function drawLabels(at, s){
      if (!labels) {
        var host = document.createElement('fab-labels');
        host.setAttribute('style', 'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;display:block!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;pointer-events:none!important');
        document.documentElement.appendChild(host);
        labels = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      }
      while (labels.firstChild) labels.removeChild(labels.firstChild);
      var secs = document.querySelectorAll('body > section');
      for (var i = 0; i < at.length; i++) {
        var d = document.createElement('div');
        d.textContent = name(secs[i], i);
        d.setAttribute('style', 'position:absolute;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:' + (i === active ? '600' : '400') + ' 13px/20px system-ui,sans-serif;color:' + (i === active ? 'white' : 'rgb(190,190,190)') + ';left:' + at[i] + 'px;top:' + (at.top - LABEL + 2) + 'px;max-width:' + Math.max(40, list[i].width * s) + 'px');
        labels.appendChild(d);
      }
    }
    function rowLayout(){
      var f = list[active], root = document.documentElement, vw = root.clientWidth, vh = root.clientHeight, pad = 48;
      var s = zoom || Math.max(0.01, Math.min((vw - 2 * pad) / f.width, (vh - 2 * pad - LABEL) / f.height));
      /* Room at both ends and above, so the first and the last artboard can be centred too. */
      var last = list[list.length - 1], h = 0, css = '', at = [];
      for (var k = 0; k < list.length; k++) h = Math.max(h, list[k].height * s);
      var x = Math.max(pad, (vw - list[0].width * s) / 2);
      at.top = Math.max(pad + LABEL, (vh - h) / 2);
      for (var i = 0; i < list.length; i++) {
        at.push(x);
        css += 'body>section:nth-of-type(' + (i + 1) + '){' + BOX + 'position:absolute!important;left:' + x + 'px!important;top:' + at.top + 'px!important;width:' + list[i].width + 'px!important;height:' + list[i].height + 'px!important;transform:scale(' + s + ')!important;transform-origin:0 0!important}';
        x += list[i].width * s + GAP;
      }
      sheet.textContent =
        ':where(html){background:rgb(45,45,45)}:where(body>section){background-color:white;overflow:hidden;box-sizing:border-box}' +
        'html{overflow:auto!important}' +
        'body{' + BOX + 'padding:0!important;position:relative!important;overflow:visible!important;width:' + Math.max(vw, x - GAP + Math.max(pad, (vw - last.width * s) / 2)) + 'px!important;height:' + Math.max(vh, at.top + h + pad) + 'px!important}' +
        'body>:not(section),body>section:nth-of-type(n+' + (list.length + 1) + '){display:none!important}' + css +
        'body [data-fab-hover],body [data-fab-picked]{outline-width:' + 2 / s + 'px!important;outline-offset:' + 2 / s + 'px!important}' +
        NOTES + NOTE;
      drawLabels(at, s);
      report(s);
      return { x: at[active], y: at.top, w: f.width * s, h: f.height * s };
    }
    function center(){
      var b = rowLayout(), root = document.documentElement;
      window.scrollTo(b.x + b.w / 2 - root.clientWidth / 2, b.y + b.h / 2 - root.clientHeight / 2);
    }
    function layout(){
      if (!sheet) return;
      if (row) { rowLayout(); return; }
      var f = list[active], root = document.documentElement;
      var vw = root.clientWidth, vh = root.clientHeight, pad = SLIDES ? 0 : 24;
      var s = zoom || Math.max(0.01, Math.min((vw - 2 * pad) / f.width, (vh - 2 * pad) / f.height));
      var w = f.width * s, h = f.height * s;
      var left = Math.max(pad, (vw - w) / 2), top = Math.max(pad, (vh - h) / 2);
      var one = 'section:nth-of-type(' + (active + 1) + ')';
      sheet.textContent =
        ':where(html){background:rgb(45,45,45)}:where(body>section){background-color:white;overflow:hidden;box-sizing:border-box}' +
        'html{overflow:' + (zoom ? 'auto' : 'hidden') + '!important}' +
        'body{' + BOX + 'padding:0!important;position:relative!important;overflow:visible!important;width:' + Math.max(vw, w + 2 * left) + 'px!important;height:' + Math.max(vh, h + 2 * top) + 'px!important}' +
        'body>:not(' + one + '){display:none!important}' +
        'body>' + one + '{' + BOX + 'position:absolute!important;left:' + left + 'px!important;top:' + top + 'px!important;width:' + f.width + 'px!important;height:' + f.height + 'px!important;transform:scale(' + s + ')!important;transform-origin:0 0!important}' +
        /* Pick outlines stay 2px on screen whatever the scale. */
        'body [data-fab-hover],body [data-fab-picked]{outline-width:' + 2 / s + 'px!important;outline-offset:' + 2 / s + 'px!important}' +
        NOTES + (present ? NO_NOTE : NOTE) + ENTER +
        (enter ? '@media (prefers-reduced-motion:no-preference){body>' + one + '{animation:' + enter + ' .4s ease-out!important}}' : '');
      report(s);
    }
    function printLayout(){
      var css = '@page{margin:0}html,body{' + BOX + 'padding:0!important;background:none!important}body>:not(section){display:none!important}' +
        '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' + NOTES + NO_NOTE +
        'body>section:nth-of-type(n+${MAX_FRAMES + 1}){display:none!important}', first = true;
      for (var i = 0; i < list.length; i++) {
        var f = list[i], one = 'body>section:nth-of-type(' + (i + 1) + ')';
        if (f.skip) { css += one + '{display:none!important}'; continue; }
        css += '@page p' + i + '{size:' + f.width + 'px ' + f.height + 'px}' +
          one + '{' + BOX + 'page:p' + i + ';position:relative!important;overflow:hidden;box-sizing:border-box;width:' + f.width + 'px!important;height:' + f.height + 'px!important;transform:none!important' + (first ? '' : ';break-before:page') + '}';
        first = false;
      }
      sheet.textContent = css;
      /* After load and fonts, and a beat for scripts that draw on load. */
      function go(){ setTimeout(function(){ try { window.print(); } finally { send(M.printed); } }, 100); }
      function loaded(){ if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go); else go(); }
      if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded);
    }
    function scan(){
      var nodes = document.querySelectorAll('body > section');
      /* One size for the whole deck, as frames.ts reads it. */
      var ds = (document.body.getAttribute('data-size') || '').trim(), deck = DECK.hasOwnProperty(ds) ? DECK[ds] : SIZE.slides;
      for (var i = 0; i < nodes.length && i < ${MAX_FRAMES}; i++) list.push({
        width: SLIDES ? deck[0] : size(nodes[i].getAttribute('data-width'), SIZE.design[0]),
        height: SLIDES ? deck[1] : size(nodes[i].getAttribute('data-height'), SIZE.design[1]),
        skip: nodes[i].hasAttribute('data-skip')
      });
      if (!list.length) { if (PRINT) send(M.printed); return; }
      sheet = document.createElement('style');
      (document.head || document.documentElement).appendChild(sheet);
      if (PRINT) printLayout(); else if (want) frameTo(want); else layout();
    }
    frameTo = function(d){
      if (PRINT) return;
      /* Asked before the sections were parsed: applied by scan. */
      if (!list.length) { want = d; return; }
      var next = Math.max(0, Math.min(list.length - 1, Math.floor(Number(d.index)) || 0)), z = Number(d.zoom), changed = next !== active;
      present = !!d.present;
      var wasRow = row, oldZoom = zoom;
      row = !SLIDES && !present && !!d.canvas;
      if (labels && !row) while (labels.firstChild) labels.removeChild(labels.firstChild);
      if (row) {
        active = next;
        zoom = d.zoom != null && isFinite(z) && z > 0 ? Math.min(z, 10) : null;
        /* The screen list (or a zoom from the menu) centres the active artboard; a reload of the same view keeps the scroll. */
        if (changed || !wasRow || (zoom !== oldZoom && !mouse)) center(); else if (zoom !== oldZoom) zoomed(rowLayout); else rowLayout();
        if (onFrameChange) onFrameChange(changed);
        return;
      }
      if (changed) {
        /* A pick on another frame would be invisible: drop it. */
        if (picking) setPick(true);
        window.scrollTo(0, 0);
        enter = d.transition === 'fade' ? 'fab-fade' : d.transition === 'slide' ? (next > active ? 'fab-from-right' : 'fab-from-left') : '';
      }
      active = next;
      zoom = d.zoom != null && isFinite(z) && z > 0 ? Math.min(z, 10) : null;
      if (!changed && zoom !== oldZoom) zoomed(layout); else layout();
      if (onFrameChange) onFrameChange(changed);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
    if (!PRINT) window.addEventListener('resize', layout);
    window.addEventListener('mousemove', function(ev){ mouse = [ev.clientX, ev.clientY]; }, true);
    document.documentElement.addEventListener('mouseleave', function(){ mouse = null; });
    /* Cmd/Ctrl+wheel, which a trackpad pinch also sends, zooms instead of the browser. The parent holds
       the zoom: it gets the factor, once per painted frame. Not while presenting.
       ponytail: Safari sends a pinch as gesture events, not wheel; add them if pinch must work there. */
    window.addEventListener('wheel', function(ev){
      if (!(ev.ctrlKey || ev.metaKey) || !list.length || present) return;
      ev.preventDefault();
      mouse = [ev.clientX, ev.clientY];
      /* A wheel notch is about 100, a pinch step a few px: one event zooms by a third at most. */
      wheel *= Math.exp(-Math.max(-30, Math.min(30, ev.deltaMode ? ev.deltaY * 16 : ev.deltaY)) / 100);
      if (!wheelRaf) wheelRaf = requestAnimationFrame(function(){ wheelRaf = 0; send(M.zoom, { factor: wheel }); wheel = 1; });
    }, { capture: true, passive: false });
    /* Space-drag pans the row. Registered ahead of the canvas editor, so it takes the pointer first. */
    window.addEventListener('keydown', function(ev){ if (row && ev.key === ' ' && !typing(ev.target)) { space = true; ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
    window.addEventListener('keyup', function(ev){ if (ev.key === ' ') space = false; }, true);
    window.addEventListener('blur', function(){ space = false; pan = null; });
    window.addEventListener('pointerdown', function(ev){
      if (!row || !space) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      pan = { x: ev.clientX, y: ev.clientY };
      try { document.documentElement.setPointerCapture(ev.pointerId); } catch (e) {}
    }, true);
    window.addEventListener('pointermove', function(ev){
      if (!pan) return;
      ev.stopImmediatePropagation();
      window.scrollBy(pan.x - ev.clientX, pan.y - ev.clientY);
      pan = { x: ev.clientX, y: ev.clientY };
    }, true);
    window.addEventListener('pointerup', function(ev){ if (pan) { pan = null; ev.stopImmediatePropagation(); } }, true);
    /* Keys reach the parent while focus is in here; not while typing or picking. */
    window.addEventListener('keydown', function(ev){
      var t = ev.target;
      if (!list.length || picking || ev.altKey || typing(t)) return;
      if (ev.ctrlKey || ev.metaKey) {
        if (ZOOM[ev.key]) { ev.preventDefault(); send(M.key, { key: ZOOM[ev.key] }); }
        return;
      }
      var k = ev.key === ' ' ? 'Space' : ev.key === 'F' ? 'f' : ev.key;
      if (k === 'Space' && t && t.closest && t.closest('button, summary, a, [role=button]')) return;
      if (KEYS.indexOf(k) >= 0) { ev.preventDefault(); send(M.key, { key: k }); }
      else if (PASS.indexOf(k) >= 0) send(M.key, { key: k });
    });
  })();`;
}

function head(
  channel: string,
  needs: readonly RuntimeModule[],
  style = "",
  frames: FrameKind | null = null,
  print = false,
  canvas = false,
): string {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    style +
    hookScript(channel, needs, frames, print, canvas)
  );
}

const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i;

/** Agent HTML or SVG, with the hook injected inside its own `<head>` when it has one. */
function buildHtmlSrcdoc(
  content: string,
  channel: string,
  frames: FrameKind | null = null,
  print = false,
): string {
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
  return `${doctype}<head>${head(channel, [], "", frames, print, true)}</head>${content.slice(doctype.length)}`;
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

/**
 * Only previewable kinds reach here; markdown and code render in the page. `print`
 * (slides and design) builds the PDF export's document: one page per frame.
 */
export function buildArtifactSrcdoc(
  kind: ArtifactKind,
  content: string,
  channel: string,
  print = false,
): string {
  return kind === "react"
    ? buildReactSrcdoc(content, channel)
    : buildHtmlSrcdoc(content, channel, isFrameKind(kind) ? kind : null, print);
}
