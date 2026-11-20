import { ID, INLINE, MAX_RUNS, MAX_TEXT, NOT_TEXT, SKIP } from "./canvas";

/** A tag set as the runtime's `{ TAG: 1 }` lookup. */
const tags = (set: ReadonlySet<string>) => JSON.stringify(Object.fromEntries([...set].map((t) => [t.toUpperCase(), 1])));

/**
 * The canvas editor inside the sandboxed frame (spec §6.4), part of the hook script in
 * srcdoc.ts. It draws the selection, handles, snap guides and the 12-column layout guides
 * in a closed shadow root, and turns pointer and key gestures into ops for the parent:
 * `move`, `resize`, `reorder` and `text` (runs of plain text, never markup). It changes the
 * document only for live feedback during a gesture; the parent applies every op to its own
 * copy and posts patches back. Elements without `data-fab-id` (made by a script) and
 * anything under `data-lock` cannot be selected.
 *
 * ES5, concatenated into the hook script: it uses `send`, `M`, `PROPS`, `targetOf`,
 * `editing`, `typing`, `frameRoot` and `onFrameChange` from there. The tag tables and the id
 * pattern come from canvas.ts, so the frame and the app agree on what is a layer.
 */
export function editorRuntime(): string {
  return `
  (function(){
    var MODE = 'off', sel = [], hover = null, textEl = null, textBefore = '', guides = false, drag = null;
    var host = null, shadow = null, raf = 0;
    var BLUE = 'rgb(37,99,235)', PINK = 'rgb(236,72,153)';
    var INLINE = ${tags(INLINE)}, NOT_TEXT = ${tags(NOT_TEXT)}, SKIP = ${tags(SKIP)};
    var ID = new RegExp(${JSON.stringify(ID.source)});
    var DIRS = { nw: 'nwse', n: 'ns', ne: 'nesw', e: 'ew', se: 'nwse', s: 'ns', sw: 'nesw', w: 'ew' };

    function tag(el){ return String(el.tagName || '').toUpperCase(); }
    function idOf(el){ return el && el.getAttribute ? el.getAttribute('data-fab-id') : null; }
    function byId(id){ return typeof id === 'string' && ID.test(id) ? document.querySelector('[data-fab-id="' + id + '"]') : null; }
    function free(el){ return el.hasAttribute('data-free'); }
    function n(v){ var x = parseFloat(v); return isFinite(x) ? x : 0; }
    function inline(e){ if (!INLINE[tag(e)]) return false; for (var i = 0; i < e.children.length; i++) if (!inline(e.children[i])) return false; return true; }
    function textLeaf(el){ if (NOT_TEXT[tag(el)]) return false; for (var i = 0; i < el.children.length; i++) if (!inline(el.children[i])) return false; return true; }
    function selectable(el){
      var r = frameRoot();
      if (!el || el.nodeType !== 1 || !r || el === r || !r.contains(el) || !idOf(el) || el.closest('[data-lock]')) return false;
      for (var p = el; p && p !== r; p = p.parentElement) {
        var t = tag(p);
        if (SKIP[t] || (t === 'ASIDE' && p.hasAttribute('data-notes')) || (p !== el && t === 'SVG')) return false;
      }
      return true;
    }
    function inSel(el){ return sel.indexOf(el) >= 0; }
    function holdsSel(el){ for (var i = 0; i < sel.length; i++) if (el.contains(sel[i])) return true; return false; }
    /* The deepest selectable element; formatting inside a text box selects the box. */
    function candidate(t){
      var el = t;
      while (el && el.nodeType === 1 && !selectable(el)) el = el.parentElement;
      if (!el || el.nodeType !== 1) return null;
      while (INLINE[tag(el)] && selectable(el.parentElement)) el = el.parentElement;
      return el;
    }
    /* A free layer moves as one: its outermost free ancestor first, then what is inside. */
    function pickAt(t){
      var el = candidate(t), outer = null;
      if (!el || MODE !== 'full') return el;
      for (var p = el; p && p !== frameRoot(); p = p.parentElement) if (selectable(p) && free(p)) outer = p;
      return outer && outer !== el && !inSel(outer) && !holdsSel(outer) ? outer : el;
    }
    function siblings(el){ return el.parentElement ? kids(el.parentElement) : []; }
    function kids(el){ var out = []; for (var i = 0; i < el.children.length; i++) if (selectable(el.children[i])) out.push(el.children[i]); return out; }
    function scale(){ var r = frameRoot(); return r && r.offsetWidth ? r.getBoundingClientRect().width / r.offsetWidth : 1; }
    /* Position and size in canvas px: computed left/top for a free layer, its offset otherwise. */
    function boxOf(el){
      var c = getComputedStyle(el), f = free(el);
      return { x: f ? n(c.left) : el.offsetLeft, y: f ? n(c.top) : el.offsetTop, w: n(c.width) || el.offsetWidth, h: n(c.height) || el.offsetHeight };
    }
    /* A flow layer moves by its CSS \`translate\` offset, so its siblings keep their places. */
    function offsetOf(el){
      var t = getComputedStyle(el).translate;
      if (!t || t === 'none') return { x: 0, y: 0 };
      var p = t.split(/\\s+/);
      return { x: n(p[0]), y: n(p[1]) };
    }
    /* Where a move starts: left/top for a free layer, the offset for a flow layer. */
    function posOf(el){ if (free(el)) { var b = boxOf(el); return { x: b.x, y: b.y }; } return offsetOf(el); }

    /* ── Drawing ── */
    function overlay(){
      if (host && host.isConnected) return;
      host = document.createElement('fab-overlay');
      host.setAttribute('style', 'position:fixed!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:2147483647!important;margin:0!important;padding:0!important;border:0!important;background:none!important;transform:none!important');
      shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      document.documentElement.appendChild(host);
    }
    function div(r, css){
      var d = document.createElement('div');
      d.setAttribute('style', 'position:fixed;box-sizing:border-box;pointer-events:none;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' + css);
      shadow.appendChild(d);
      return d;
    }
    function draw(){
      raf = 0;
      if (!shadow) return;
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
      var root = frameRoot();
      if (MODE === 'off' || !root) return;
      var rr = root.getBoundingClientRect();
      if (guides) for (var c = 0; c < 12; c++)
        div({ left: rr.left + rr.width * (c + 0.1) / 12, top: rr.top, width: rr.width * 0.8 / 12, height: rr.height }, 'background:rgba(236,72,153,0.08);border-left:1px solid rgba(236,72,153,0.35);border-right:1px solid rgba(236,72,153,0.35)');
      if (hover && !inSel(hover) && hover.isConnected) div(hover.getBoundingClientRect(), 'outline:1px dashed ' + BLUE);
      for (var i = 0; i < sel.length; i++) div(sel[i].getBoundingClientRect(), 'border:' + (textEl ? 2 : 1.5) + 'px solid ' + BLUE);
      if (drag && drag.lines) for (var j = 0; j < drag.lines.length; j++) {
        var l = drag.lines[j];
        div(l.x != null ? { left: l.x, top: rr.top, width: 1, height: rr.height } : { left: rr.left, top: l.y, width: rr.width, height: 1 }, 'background:' + PINK);
      }
      if (drag && drag.line) div(drag.line, 'background:' + BLUE);
      if (MODE === 'full' && sel.length === 1 && !textEl && !(drag && drag.moved)) handles(sel[0]);
    }
    function redraw(){ if (!raf) raf = requestAnimationFrame(draw); }
    /* Every edge resizes along its axis (an invisible strip over the border); the four corners
       resize diagonally. Corners are drawn last so they win where they overlap the strips. */
    function handles(el){
      var r = el.getBoundingClientRect(), tx = Math.min(8, r.width / 4), ty = Math.min(8, r.height / 4);
      var edges = { n: { left: r.left, top: r.top - ty / 2, width: r.width, height: ty }, s: { left: r.left, top: r.bottom - ty / 2, width: r.width, height: ty },
        w: { left: r.left - tx / 2, top: r.top, width: tx, height: r.height }, e: { left: r.right - tx / 2, top: r.top, width: tx, height: r.height } };
      for (var e in edges) div(edges[e], 'pointer-events:auto;cursor:' + DIRS[e] + '-resize').addEventListener('pointerdown', startResize(el, e));
      ['nw', 'ne', 'sw', 'se'].forEach(function(d){
        var x = d.indexOf('w') >= 0 ? r.left : r.right, y = d.indexOf('n') >= 0 ? r.top : r.bottom;
        div({ left: x - 5, top: y - 5, width: 10, height: 10 }, 'pointer-events:auto;background:white;border:1.5px solid ' + BLUE + ';cursor:' + DIRS[d] + '-resize')
          .addEventListener('pointerdown', startResize(el, d));
      });
    }

    /* ── Selection and reports ── */
    function bgOf(el){
      for (var p = el; p && p.nodeType === 1; p = p.parentElement) {
        var c = getComputedStyle(p).backgroundColor;
        if (c && c !== 'transparent' && !/^rgba\\(.*,\\s*0\\)$/.test(c) && !/\\/\\s*0\\)$/.test(c)) return c;
      }
      return 'rgb(255, 255, 255)';
    }
    function report(){
      var primary = sel[0] || frameRoot(), styles = {}, rect = null;
      if (!primary) return;
      var cs = getComputedStyle(primary);
      for (var i = 0; i < PROPS.length; i++) styles[PROPS[i]] = cs.getPropertyValue(PROPS[i]);
      var fr = frameRoot(), fb = fr && fr.getBoundingClientRect(), k = scale();
      var items = sel.map(function(el){
        var b = boxOf(el), r = el.getBoundingClientRect();
        var view = fb ? { x: (r.left - fb.left) / k - fr.clientLeft, y: (r.top - fb.top) / k - fr.clientTop, w: r.width / k, h: r.height / k } : null;
        rect = rect ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        return { id: idOf(el), x: b.x, y: b.y, w: b.w, h: b.h, view: view, pos: posOf(el) };
      });
      /* Where the canvas is in the viewport and its scale: the stage maps a dropped file's point with it. */
      send(M.selection, { ids: items.map(function(it){ return it.id; }), items: items, styles: styles, background: bgOf(primary.parentElement || primary), rect: rect && { x: rect.left, y: rect.top, w: rect.right - rect.left, h: rect.bottom - rect.top }, editing: !!textEl,
        origin: fb ? { x: fb.left, y: fb.top, s: k } : null });
    }
    function select(list){
      if (textEl && list.indexOf(textEl) < 0) endText();
      sel = list.filter(function(el, i){ return el && selectable(el) && list.indexOf(el) === i; });
      if (MODE !== 'full') sel = sel.slice(0, 1);
      redraw(); report();
    }

    /* ── Text ── */
    /* The text as runs, neighbours with the same formatting merged; null past the parent's limits
       (it would drop the op), so a long text is never saved cut short. */
    function runsOf(el){
      var out = [], total = 0;
      function add(t, b, i, u){
        var last = out[out.length - 1];
        total += t.length;
        if (last && last.b === b && last.i === i && last.u === u) last.t += t;
        else out.push({ t: t, b: b, i: i, u: u });
      }
      (function walk(node, b, i, u){
        for (var c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) add(c.data, b, i, u);
          else if (c.nodeType === 1) {
            var t = tag(c);
            if (t === 'BR') { add('\\n', b, i, u); continue; }
            if ((t === 'DIV' || t === 'P') && out.length) add('\\n', b, i, u);
            walk(c, b || t === 'B' || t === 'STRONG', i || t === 'I' || t === 'EM', u || t === 'U');
          }
        }
      })(el, false, false, false);
      return out.length > ${MAX_RUNS} || total > ${MAX_TEXT} ? null : out;
    }
    /* While typing, the text goes to the parent as it settles (the parent takes ops only around a
       real gesture, and Esc after a pause is none); Esc or leaving sends the rest. */
    var textTimer = 0, heldInner = null;
    function sendText(){
      clearTimeout(textTimer); textTimer = 0;
      var el = textEl;
      if (!el || el.innerHTML === textBefore) return;
      var runs = runsOf(el);
      /* Too long to save: the baseline stays, so the text goes out once it fits again. */
      if (!runs) return;
      textBefore = el.innerHTML;
      heldInner = null;
      send(M.op, { ops: [{ kind: 'text', id: idOf(el), runs: runs }] });
    }
    document.addEventListener('input', function(ev){ if (textEl && textEl.contains(ev.target)) { clearTimeout(textTimer); textTimer = setTimeout(sendText, 400); } }, true);
    /* Decks often set user-select: none; the box being typed in needs it back for a caret and a selection. */
    var textSelect = null;
    function startText(el, x, y){
      if (MODE === 'inspect' || !el || !textLeaf(el)) return;
      sel = [el]; textEl = el; textBefore = el.innerHTML;
      textSelect = [el.style.getPropertyValue('user-select'), el.style.getPropertyValue('-webkit-user-select')];
      el.style.setProperty('user-select', 'text'); el.style.setProperty('-webkit-user-select', 'text');
      el.setAttribute('contenteditable', 'true');
      try { window.focus(); } catch (e) {}
      el.focus();
      /* The caret goes where the pointer is; from the keyboard, all the text is selected. */
      var range = x != null && document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (!range || !el.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(el); }
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      redraw(); report();
    }
    function endText(){
      var el = textEl;
      if (!el) return;
      var sent = el.innerHTML !== textBefore;
      sendText();
      textEl = null;
      /* Nothing new went out: the parent's copy of what was sent replaces the typed markup. */
      if (!sent && heldInner && heldInner.el === el) el.innerHTML = heldInner.html;
      heldInner = null;
      el.style.setProperty('user-select', textSelect[0]); el.style.setProperty('-webkit-user-select', textSelect[1]);
      if (!el.getAttribute('style')) el.removeAttribute('style');
      el.removeAttribute('contenteditable');
      try { window.getSelection().removeAllRanges(); } catch (e) {}
      redraw();
    }
    document.addEventListener('focusout', function(ev){ if (textEl && ev.target === textEl) { endText(); report(); } }, true);

    /* ── Pointer ── */
    function eat(ev){ ev.preventDefault(); ev.stopPropagation(); }
    function startResize(el, dir){
      return function(ev){
        eat(ev);
        try { document.documentElement.setPointerCapture(ev.pointerId); } catch (e) {}
        var b = boxOf(el);
        drag = { kind: 'resize', el: el, dir: dir, sx: ev.clientX, sy: ev.clientY, b: b, p: posOf(el), s: scale(), moved: false, styles: stylesOf([el]) };
      };
    }
    function snapTargets(el){
      var op = el.offsetParent || frameRoot(), xs = [0, op.clientWidth / 2, op.clientWidth], ys = [0, op.clientHeight / 2, op.clientHeight];
      var sib = siblings(el);
      for (var i = 0; i < sib.length; i++) {
        var c = sib[i];
        if (inSel(c) || c.offsetParent !== el.offsetParent) continue;
        xs.push(c.offsetLeft, c.offsetLeft + c.offsetWidth / 2, c.offsetLeft + c.offsetWidth);
        ys.push(c.offsetTop, c.offsetTop + c.offsetHeight / 2, c.offsetTop + c.offsetHeight);
      }
      return { op: op, xs: xs, ys: ys };
    }
    /* The smallest shift (canvas px) that puts one of edges on a target, within 6 screen px. */
    function snap(edges, targets, limit){
      var best = null;
      for (var i = 0; i < edges.length; i++) for (var j = 0; j < targets.length; j++) {
        var d = targets[j] - edges[i];
        if (Math.abs(d) <= limit && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: targets[j] };
      }
      return best;
    }
    function moveDrag(ev){
      var s = drag.s, dx = (ev.clientX - drag.sx) / s, dy = (ev.clientY - drag.sy) / s;
      if (!drag.moved && Math.abs(ev.clientX - drag.sx) < 3 && Math.abs(ev.clientY - drag.sy) < 3) return;
      drag.moved = true;
      if (drag.kind === 'resize') return resizeDrag(ev, dx, dy);
      var lead = drag.items[0];
      if (drag.swap) return flowDrag(ev);
      /* Snap the lead's visual box: a flow layer's box is its flow place plus its offset. */
      var t = drag.targets, b = lead.b, bx = free(lead.el) ? b.x : b.x + lead.p.x, by = free(lead.el) ? b.y : b.y + lead.p.y, lines = [];
      if (!ev.altKey) {
        var sx = snap([bx + dx, bx + dx + b.w / 2, bx + dx + b.w], t.xs, 6 / s), sy = snap([by + dy, by + dy + b.h / 2, by + dy + b.h], t.ys, 6 / s);
        var or = t.op.getBoundingClientRect();
        if (sx) { dx += sx.d; lines.push({ x: or.left + (sx.at + t.op.clientLeft) * s }); }
        if (sy) { dy += sy.d; lines.push({ y: or.top + (sy.at + t.op.clientTop) * s }); }
      }
      drag.lines = lines;
      for (var i = 0; i < drag.items.length; i++) {
        var it = drag.items[i];
        it.x = Math.round(it.p.x + dx); it.y = Math.round(it.p.y + dy);
        if (free(it.el)) { it.el.style.left = it.x + 'px'; it.el.style.top = it.y + 'px'; }
        else it.el.style.translate = it.x + 'px ' + it.y + 'px';
      }
      redraw();
    }
    /* Cmd/Ctrl-drag of a flow layer swaps it with its siblings: the insertion line shows where it lands. */
    function flowDrag(ev){
      var el = drag.items[0].el, parent = el.parentElement, sib = siblings(el).filter(function(c){ return c !== el; });
      var cs = getComputedStyle(parent), row = /grid/.test(cs.display) || (/flex/.test(cs.display) && !/column/.test(cs.flexDirection));
      var best = null, bestD = Infinity;
      for (var i = 0; i < sib.length; i++) {
        var r = sib[i].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var d = Math.abs(ev.clientX - cx) + Math.abs(ev.clientY - cy);
        if (d < bestD) { bestD = d; best = { el: sib[i], r: r, after: row ? ev.clientX > cx : ev.clientY > cy }; }
      }
      if (!best) return;
      var r0 = best.r;
      drag.line = row
        ? { left: (best.after ? r0.right : r0.left) - 1, top: r0.top, width: 2, height: r0.height }
        : { left: r0.left, top: (best.after ? r0.bottom : r0.top) - 1, width: r0.width, height: 2 };
      var next = best.after ? best.el.nextElementSibling : best.el;
      while (next && (next === el || !selectable(next))) next = next.nextElementSibling;
      drag.before = next ? idOf(next) : null;
      drag.target = true;
      redraw();
    }
    /* x/y are left/top for a free layer and the translate offset for a flow layer: pulling the
       top or left edge shifts the layer so the opposite edge stays where it was. */
    function resizeDrag(ev, dx, dy){
      var b = { x: drag.p.x, y: drag.p.y, w: drag.b.w, h: drag.b.h }, d = drag.dir, x = b.x, y = b.y, w = b.w, h = b.h;
      if (d.indexOf('e') >= 0) w = b.w + dx;
      if (d.indexOf('w') >= 0) w = b.w - dx;
      if (d.indexOf('s') >= 0) h = b.h + dy;
      if (d.indexOf('n') >= 0) h = b.h - dy;
      if (ev.shiftKey && b.w > 0 && b.h > 0) {
        var k = d.length === 2 ? Math.max(w / b.w, h / b.h) : (d === 'e' || d === 'w') ? w / b.w : h / b.h;
        w = b.w * k; h = b.h * k;
      }
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      if (d.indexOf('w') >= 0) x = Math.round(b.x + b.w - w);
      if (d.indexOf('n') >= 0) y = Math.round(b.y + b.h - h);
      drag.out = { x: x, y: y, w: w, h: h };
      var st = drag.el.style;
      if (free(drag.el)) { st.left = x + 'px'; st.top = y + 'px'; }
      else st.translate = x + 'px ' + y + 'px';
      st.width = w + 'px'; st.height = h + 'px';
      redraw();
    }
    function endDrag(){
      var g = drag;
      drag = null;
      if (!g || !g.moved) return redraw();
      var ops = [];
      if (g.kind === 'resize') {
        if (g.out) ops.push({ kind: 'resize', id: idOf(g.el), x: g.out.x, y: g.out.y, w: g.out.w, h: g.out.h });
        /* A flow layer's resize writes only its size; a shift from the top or left edge is a move. */
        if (g.out && !free(g.el) && (g.out.x !== g.p.x || g.out.y !== g.p.y)) ops.push({ kind: 'move', id: idOf(g.el), x: g.out.x, y: g.out.y });
      }
      else if (!g.swap) {
        for (var i = 0; i < g.items.length; i++) if (g.items[i].x != null) ops.push({ kind: 'move', id: idOf(g.items[i].el), x: g.items[i].x, y: g.items[i].y });
      } else if (g.target) ops.push({ kind: 'reorder', id: idOf(g.items[0].el), before: g.before });
      if (ops.length) send(M.op, { ops: ops });
      redraw(); report();
    }

    function onDown(ev){
      if (MODE === 'off' || ev.target === host) return;
      if (textEl && textEl.contains(ev.target)) return;
      if (textEl) endText();
      /* No preventDefault: the press must focus the frame, or text editing gets no caret.
         selectstart below keeps a drag from selecting text instead. */
      ev.stopPropagation();
      try { window.focus(); } catch (e) {}
      if (ev.button !== 0) return;
      var el = pickAt(targetOf(ev));
      if (!el) { select([]); return; }
      if (ev.shiftKey && MODE === 'full') { select(inSel(el) ? sel.filter(function(s){ return s !== el; }) : sel.concat([el])); return; }
      if (!inSel(el)) select([el]);
      if (MODE !== 'full') return;
      try { document.documentElement.setPointerCapture(ev.pointerId); } catch (e) {}
      drag = { kind: 'move', sx: ev.clientX, sy: ev.clientY, s: scale(), moved: false, targets: snapTargets(sel[0]),
        swap: (ev.metaKey || ev.ctrlKey) && !free(sel[0]),
        items: sel.map(function(s){ return { el: s, b: boxOf(s), p: posOf(s) }; }), styles: stylesOf(sel) };
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', function(ev){
      if (MODE === 'off') return;
      if (drag) { eat(ev); moveDrag(ev); return; }
      if (textEl) return;
      var h = ev.target === host ? hover : candidate(targetOf(ev));
      if (h !== hover) { hover = h; redraw(); }
    }, true);
    window.addEventListener('pointerup', function(ev){ if (MODE !== 'off' && drag) { eat(ev); endDrag(); } }, true);
    /* A cancelled drag sends nothing, so the live feedback goes back to where it started. */
    function stylesOf(list){ return list.map(function(el){ return [el, el.getAttribute('style')]; }); }
    window.addEventListener('pointercancel', function(){
      if (!drag) return;
      drag.styles.forEach(function(p){ if (p[1] === null) p[0].removeAttribute('style'); else p[0].setAttribute('style', p[1]); });
      drag = null; redraw(); report();
    }, true);
    ['mouseup', 'click', 'auxclick', 'dragstart', 'selectstart'].forEach(function(type){
      window.addEventListener(type, function(ev){ if (MODE !== 'off' && ev.target !== host && !(textEl && textEl.contains(ev.target))) eat(ev); }, true);
    });
    /* mousedown is hidden from the page's scripts but keeps its default, which focuses the frame. */
    window.addEventListener('mousedown', function(ev){ if (MODE !== 'off' && ev.target !== host && !(textEl && textEl.contains(ev.target))) ev.stopPropagation(); }, true);
    window.addEventListener('dblclick', function(ev){
      if (MODE === 'off' || (textEl && textEl.contains(ev.target))) return;
      eat(ev);
      /* The press took pointer capture on the document, so the browser aims dblclick at <html>:
         find the element under the pointer instead. */
      var at = document.elementFromPoint(ev.clientX, ev.clientY);
      startText(candidate(at && at !== host ? at : targetOf(ev)), ev.clientX, ev.clientY);
    }, true);

    /* ── Keys ── */
    function step(by){
      var list = siblings(sel[0]), i = list.indexOf(sel[0]);
      var j = by === -Infinity ? 0 : by === Infinity ? list.length - 1 : (i + by + list.length) % list.length;
      if (list[j]) select([list[j]]);
    }
    /* Arrows move the selected layers: free ones by left/top, flow ones by their offset. */
    function nudge(key, px){
      var dx = key === 'ArrowLeft' ? -px : key === 'ArrowRight' ? px : 0, dy = key === 'ArrowUp' ? -px : key === 'ArrowDown' ? px : 0, ops = [];
      for (var i = 0; i < sel.length; i++) { var b = posOf(sel[i]); ops.push({ kind: 'move', id: idOf(sel[i]), x: Math.round(b.x + dx), y: Math.round(b.y + dy) }); }
      if (ops.length) send(M.op, { ops: ops });
      return ops.length > 0;
    }
    /* Keys the panel maps (canvas.ts editKeyOf): forwarded, their browser defaults kept from the frame. */
    function forwarded(ev){
      if (ev.altKey) return false;
      if (ev.metaKey || ev.ctrlKey) return /^[cdgvxyz\\\\]$/i.test(ev.key);
      return ev.key === 'Delete' || ev.key === 'Backspace' || ev.key === '[' || ev.key === ']' || /^[a-z]$/i.test(ev.key);
    }
    window.addEventListener('keydown', function(ev){
      if (MODE === 'off') return;
      var k = ev.key, mod = ev.metaKey || ev.ctrlKey;
      if (textEl) {
        if (k === 'Escape') { eat(ev); var el = textEl; endText(); select([el]); }
        else if (k === 'Tab' && /^T[DH]$/.test(tag(textEl))) {
          var cells = Array.prototype.slice.call(textEl.closest('table').querySelectorAll('td,th')).filter(selectable);
          var next = cells[cells.indexOf(textEl) + (ev.shiftKey ? -1 : 1)];
          eat(ev); endText(); if (next) startText(next); else select([]);
        }
        return;
      }
      if (typing(ev.target)) return;
      if (k === 'Escape') { if (sel.length) { eat(ev); select([]); } return; }
      if (mod && !ev.shiftKey && !ev.altKey && (k === 'a' || k === 'A')) { eat(ev); if (MODE === 'full') select(kids(frameRoot())); return; }
      if (ev.shiftKey && !mod && !ev.altKey && (k === 'G' || k === 'g')) { eat(ev); guides = !guides; redraw(); return; }
      if (sel.length && !mod && !ev.altKey) {
        if (k === 'Tab') { eat(ev); step(ev.shiftKey ? -1 : 1); return; }
        if (k === 'Home' || k === 'End') { eat(ev); step(k === 'Home' ? -Infinity : Infinity); return; }
        if (k === 'Enter') {
          eat(ev);
          if (ev.shiftKey) { var p = sel[0].parentElement; select(selectable(p) ? [p] : []); }
          else if (textLeaf(sel[0])) startText(sel[0]);
          else { var first = kids(sel[0])[0]; if (first) select([first]); }
          return;
        }
        if (MODE === 'full' && k.indexOf('Arrow') === 0 && nudge(k, ev.shiftKey ? 10 : 1)) { eat(ev); return; }
      } else if (!sel.length && k === 'Enter' && !mod && !ev.shiftKey) {
        var top = kids(frameRoot())[0];
        if (top) { eat(ev); select([top]); }
        return;
      }
      if (MODE !== 'inspect' && forwarded(ev)) {
        eat(ev);
        send(M.editKey, { key: k, shiftKey: ev.shiftKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey });
      }
    }, true);
    /* Scroll and resize fire per pointermove while panning: one report per animation frame. */
    var later = 0;
    function moved(){ if (MODE === 'off') return; redraw(); if (!later) later = requestAnimationFrame(function(){ later = 0; if (MODE !== 'off') report(); }); }
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);

    /* ── From the parent ── */
    function refIn(parent, id){ var r = byId(id); return r && r.parentNode === parent ? r : null; }
    function patch(list){
      for (var i = 0; i < list.length && i < 2000; i++) {
        var p = list[i] || {}, el = byId(p.id), parent = byId(p.parent);
        if (p.t === 'attrs' && el && p.attrs) for (var k in p.attrs) { if (p.attrs[k] === null) el.removeAttribute(k); else el.setAttribute(k, String(p.attrs[k])); }
        else if (p.t === 'add' && parent) {
          var tpl = document.createElement('template'); tpl.innerHTML = String(p.html || '');
          if (tpl.content.firstElementChild) parent.insertBefore(tpl.content.firstElementChild, refIn(parent, p.before));
        }
        else if (p.t === 'place' && el && parent) parent.insertBefore(el, refIn(parent, p.before));
        else if (p.t === 'remove' && el) el.remove();
        /* The box being typed in keeps what is typed; the parent's copy of it is the same text. */
        else if (p.t === 'inner' && el) { if (el === textEl) heldInner = { el: el, html: String(p.html || '') }; else el.innerHTML = String(p.html || ''); }
      }
    }
    onEditor = function(type, d){
      if (type === M.editor) {
        var next = ['inspect', 'style', 'full'].indexOf(d.mode) >= 0 ? d.mode : 'off';
        if (next === MODE) return;
        if (textEl) endText();
        MODE = next; editing = MODE !== 'off'; sel = []; hover = null; drag = null;
        if (editing) { overlay(); report(); }
        redraw();
        return;
      }
      if (MODE === 'off') return;
      if (type === M.patch) {
        patch(Array.isArray(d.patches) ? d.patches : []);
        var keep = sel.filter(function(el){ return el.isConnected; });
        if (Array.isArray(d.select)) keep = d.select.map(byId);
        select(keep);
        if (d.edit && sel[0]) startText(sel[0]);
      } else if (type === M.select) select((Array.isArray(d.ids) ? d.ids : []).map(byId));
    };
    /* Another frame drops the selection; a new zoom only moves it. */
    onFrameChange = function(changed){
      if (!changed) { redraw(); if (MODE !== 'off') report(); return; }
      if (textEl) endText();
      sel = []; hover = null; drag = null; redraw();
      if (MODE !== 'off') report();
    };
  })();`;
}
