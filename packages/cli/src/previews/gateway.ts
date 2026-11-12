// Central side: serves preview origins by proxying through the tunnel (PREVIEWS_SPEC.md §5.3).
import { request, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { PreviewHub, Session } from './hub.js'
import type { PreviewKind } from './protocol.js'

const RESERVED = '/__fabrium/'
const BRIDGE_PATH = '/__fabrium/bridge.js'
const MAX_HTML_BYTES = 8 * 1024 * 1024
// Hop-by-hop headers, and the ones the gateway sets itself.
const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'accept-encoding', 'te', 'trailer'])
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'x-frame-options', 'referrer-policy'])

/** Reports the URL, title and errors to the parent; accepts back/forward/reload and pick mode (§5.3). */
export function bridgeScript(appOrigin: string): string {
  return `(() => {
  const target = ${JSON.stringify(appOrigin)};
  if (window.parent === window) return;
  const post = (m) => { try { parent.postMessage(Object.assign({ source: 'fabrium-preview' }, m), target); } catch {} };
  const where = () => post({ type: 'location', href: location.href, title: document.title });
  for (const k of ['pushState', 'replaceState']) {
    const f = history[k];
    history[k] = function (...a) { const r = f.apply(this, a); where(); return r; };
  }
  addEventListener('popstate', where); addEventListener('hashchange', where); addEventListener('load', where); where();
  const text = (v) => { try { return v instanceof Error ? (v.stack || v.message) : typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } };
  const report = (parts) => post({ type: 'console', level: 'error', message: parts.map(text).join(' ').slice(0, 2048) });
  const error = console.error;
  console.error = function (...a) { report(a); return error.apply(this, a); };
  addEventListener('error', (e) => report([e.error || e.message]));
  addEventListener('unhandledrejection', (e) => report(['Unhandled rejection:', e.reason]));
  // Pick mode (annotate): outline the hovered element, report the clicked one instead of acting on it.
  let picking = false, hovered = null, style = null;
  const mark = (el, on) => { if (el && el.toggleAttribute) el.toggleAttribute('data-fab-pick', on); };
  const setPick = (on) => {
    picking = on; mark(hovered, false); hovered = null;
    if (on && !style) {
      style = document.createElement('style');
      style.textContent = '[data-fab-pick]{outline:2px dashed rgb(59,130,246)!important;outline-offset:2px!important;cursor:crosshair!important}';
      document.documentElement.appendChild(style);
    }
  };
  const selectorOf = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement && parts.length < 5) {
      let part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + CSS.escape(el.id)); break; }
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter((c) => c && !c.includes(':')).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const p = el.parentElement;
      const same = p ? [...p.children].filter((c) => c.tagName === el.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      parts.unshift(part);
      el = p;
    }
    return parts.join(' > ') || 'body';
  };
  addEventListener('mouseover', (e) => {
    if (!picking || e.target === hovered) return;
    mark(hovered, false); hovered = e.target; mark(hovered, true);
  }, true);
  // The app must not act on a press in pick mode either (menus open on pointerdown).
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    addEventListener(t, (e) => { if (picking) { e.preventDefault(); e.stopPropagation(); } }, true);
  }
  addEventListener('click', (e) => {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!el) return;
    mark(hovered, false);
    const html = String(el.outerHTML || '').slice(0, 1500);
    mark(hovered, true);
    post({ type: 'picked', selector: selectorOf(el), html, text: String(el.innerText || el.textContent || '').trim().slice(0, 1500), href: location.href });
  }, true);
  addEventListener('message', (e) => {
    if (e.origin !== target || e.source !== parent || !e.data || e.data.source !== 'fabrium-preview-parent') return;
    if (e.data.command === 'back') history.back();
    else if (e.data.command === 'forward') history.forward();
    else if (e.data.command === 'reload') location.reload();
    else if (e.data.command === 'pick') setPick(!!e.data.on);
  });
})();
`
}

/**
 * Request headers for the app. Dev servers check Host (Vite `allowedHosts`), so it says localhost.
 * Expo keeps the public Host: Metro writes the manifest's bundle and asset URLs from it, and
 * Expo Go on the phone fetches those (§5.3, D8).
 */
export function upstreamHeaders(
  headers: IncomingHttpHeaders,
  publicHost: string,
  proto: string,
  kind: PreviewKind,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && !DROP_REQUEST.has(k)) out[k] = v
  }
  out.host = kind === 'expo' ? publicHost : 'localhost'
  out['x-forwarded-host'] = publicHost
  out['x-forwarded-proto'] = proto
  // Caddy compresses outward; plain bytes let the gateway insert the bridge into HTML.
  out['accept-encoding'] = 'identity'
  return out
}

/**
 * Only the web UI's origin may frame the preview; the app's other CSP rules stay. Node joins
 * repeated CSP headers with `,`: each policy is enforced, so each gets our frame-ancestors.
 */
export function frameAncestors(csp: string | string[] | undefined, appOrigin: string): string {
  const own = `frame-ancestors ${appOrigin}`
  const value = Array.isArray(csp) ? csp.join(', ') : csp
  if (!value) return own
  return value
    .split(',')
    .map((policy) => {
      const kept = policy
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^frame-ancestors\b/i.test(d))
      return [...kept, own].join('; ')
    })
    .join(', ')
}

/**
 * Host-only cookies: a `Domain` attribute would share the cookie with every other preview
 * session under the preview domain. (Cookies set from page script do not pass here.)
 */
export function hostOnlyCookies(cookies: string[]): string[] {
  return cookies.map((c) => c.replace(/;\s*domain=[^;]*/gi, ''))
}

/** Insert the bridge as the first script of the document. */
export function injectBridge(html: string): string {
  const tag = `<script src="${BRIDGE_PATH}"></script>`
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html
}

function page(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Preview</title>` +
      `<body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#666">${message}`,
  )
}

const EXPIRED = 'This preview link expired. Open the preview again in Fabrium.'

export function createGateway(hub: PreviewHub): {
  handleRequest(req: IncomingMessage, res: ServerResponse): void
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  return {
    handleRequest(req, res) {
      hub.access(req.headers.host).then(
        (session) => {
          if (session === 'expired') page(res, 404, EXPIRED)
          else if (session === 'not running') page(res, 503, 'The app is not running.')
          else proxy(req, res, session)
        },
        () => page(res, 503, 'Fabrium cannot check your access right now. Reload to try again.'),
      )
    },

    // WebSocket and other upgrades (HMR): replay the request head, then pipe bytes both ways.
    handleUpgrade(req, socket, head) {
      socket.on('error', () => {})
      hub.track(socket)
      hub.access(req.headers.host).then(
        (session) => {
          if (typeof session === 'string') return void socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
          hub.track(socket, session)
          upgrade(req, socket, head, session)
        },
        () => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'),
      )
    },
  }

  function headersFor(req: IncomingMessage, session: Session): Record<string, string | string[]> {
    const kind = hub.get(session.agentId, session.name)?.kind ?? 'web'
    return upstreamHeaders(req.headers, req.headers.host ?? '', hub.proto, kind)
  }

  function proxy(req: IncomingMessage, res: ServerResponse, session: Session): void {
    const path = (req.url ?? '').split('?')[0]!
    if (path === BRIDGE_PATH) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(bridgeScript(session.appOrigin))
    }
    if (path.startsWith(RESERVED)) return page(res, 404, 'Not found.')
    // A browser that goes away (navigation, closed SSE) frees the tunnel stream and the app socket.
    let upstream: ClientRequest | undefined
    let gone = false
    res.once('close', () => {
      gone = true
      if (!res.writableFinished) upstream?.destroy()
    })
    hub.openStream(session.agentId, session.name).then(
      (stream) => {
        if (gone) return void stream.destroy()
        // ponytail: one tunnel stream per request (no keep-alive pool); pool streams if VM latency hurts.
        upstream = request({
          createConnection: () => stream as never,
          method: req.method,
          path: req.url,
          headers: { ...headersFor(req, session), connection: 'close' },
        })
        upstream.on('error', () => {
          if (!res.headersSent) page(res, 502, 'The app did not answer.')
          else res.destroy()
        })
        upstream.once('response', (up) => {
          const headers: Record<string, string | string[]> = {}
          for (const [k, v] of Object.entries(up.headers)) {
            if (v !== undefined && !DROP_RESPONSE.has(k)) headers[k] = v
          }
          headers['content-security-policy'] = frameAncestors(up.headers['content-security-policy'], session.appOrigin)
          headers['referrer-policy'] = 'no-referrer'
          if (up.headers['set-cookie']) headers['set-cookie'] = hostOnlyCookies(up.headers['set-cookie'])
          const html = /^text\/html\b/i.test(String(up.headers['content-type'] ?? ''))
          // Only a plain HTML body takes the bridge: an app may compress despite `accept-encoding`.
          const encoded = (up.headers['content-encoding'] ?? 'identity') !== 'identity'
          const empty = req.method === 'HEAD' || up.statusCode === 204 || up.statusCode === 304
          if (!html || encoded || empty) {
            res.writeHead(up.statusCode ?? 502, headers)
            up.pipe(res)
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          up.on('data', (c: Buffer) => {
            size += c.length
            if (size <= MAX_HTML_BYTES) return void chunks.push(c)
            // destroy() without an error emits no 'end': answer here, or the frame waits forever.
            up.removeAllListeners('data')
            up.destroy()
            if (!res.headersSent) page(res, 502, 'This page is too large to preview.')
          })
          up.once('end', () => {
            const body = Buffer.from(injectBridge(Buffer.concat(chunks).toString('utf8')))
            delete headers['content-length']
            res.writeHead(up.statusCode ?? 200, { ...headers, 'content-length': String(body.length) })
            res.end(body)
          })
          up.on('error', () => res.destroy())
        })
        req.pipe(upstream)
      },
      () => page(res, 502, 'The app did not answer.'),
    )
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, session: Session): void {
    hub.openStream(session.agentId, session.name).then(
      (stream) => {
        const headers = headersFor(req, session)
        delete headers['accept-encoding']
        const lines = [`${req.method} ${req.url} HTTP/1.1`, 'connection: Upgrade']
        for (const [k, v] of Object.entries(headers)) {
          for (const value of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${value}`)
        }
        stream.write(lines.join('\r\n') + '\r\n\r\n')
        if (head.length > 0) stream.write(head)
        stream.pipe(socket).pipe(stream)
        const end = () => {
          stream.destroy()
          socket.destroy()
        }
        stream.once('error', end).once('close', end)
        socket.once('close', end)
      },
      () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'),
    )
  }
}
