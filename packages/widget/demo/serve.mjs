// A tiny static server for trying the widget on a plain HTML page:
//   npm run build -w @feedbackhub/widget
//   npm run demo -w @feedbackhub/widget
//   open http://localhost:5500/?key=pk_YOUR_PROJECT_KEY
//
// Query options:  key, api (default http://localhost:4000), color, position, label,
//                 widget=off (page without the widget), hostile=1 (nasty page CSS),
//                 csp=strict (serve the page with a strict Content-Security-Policy)
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5500);
const DEFAULT_API = process.env.API_URL ?? 'http://localhost:4000';
const KEY_PATTERN = /^pk_[A-Za-z0-9_-]{22}$/;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function safeOrigin(value, fallback) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

// Only these files are ever served. Nothing else on disk is reachable.
const FILES = {
  '/demo.css': ['demo.css', 'text/css; charset=utf-8'],
  '/hostile.css': ['hostile.css', 'text/css; charset=utf-8'],
  '/widget.js': ['../dist/widget.js', 'text/javascript; charset=utf-8'],
  '/widget.js.map': ['../dist/widget.js.map', 'application/json'],
};

const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/health') {
      res.writeHead(200, baseHeaders).end('ok');
      return;
    }

    if (url.pathname === '/') {
      const params = url.searchParams;
      const requestedKey = params.get('key') ?? '';
      const key = KEY_PATTERN.test(requestedKey) ? requestedKey : 'pk_REPLACE_ME';
      const api = safeOrigin(params.get('api'), DEFAULT_API);

      let attrs = `data-project-key="${escapeHtml(key)}" data-api-url="${escapeHtml(api)}"`;
      for (const name of ['color', 'position', 'label']) {
        const value = params.get(name);
        if (value) attrs += ` data-${name}="${escapeHtml(value)}"`;
      }
      const scriptTag = `<script src="/widget.js" ${attrs} defer></script>`;

      let html = await readFile(path.join(here, 'index.html'), 'utf8');
      html = html
        .replace(
          '__EXTRA_HEAD__',
          params.get('hostile') === '1' ? '<link rel="stylesheet" href="/hostile.css" />' : '',
        )
        .replace('__SNIPPET__', escapeHtml(scriptTag))
        .replace('__WIDGET_SCRIPT__', params.get('widget') === 'off' ? '' : scriptTag);

      const headers = { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' };
      if (params.get('csp') === 'strict') {
        headers['Content-Security-Policy'] =
          `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${api}; img-src 'self' data:`;
      }
      res.writeHead(200, headers).end(html);
      return;
    }

    const file = FILES[url.pathname];
    if (file) {
      const body = await readFile(path.join(here, file[0]));
      res.writeHead(200, { ...baseHeaders, 'Content-Type': file[1] }).end(body);
      return;
    }
    res.writeHead(404, baseHeaders).end('Not found');
  } catch (err) {
    const missingBuild = err && err.code === 'ENOENT';
    res
      .writeHead(missingBuild ? 404 : 500, baseHeaders)
      .end(
        missingBuild
          ? 'Build the widget first: npm run build -w @feedbackhub/widget'
          : 'Server error',
      );
  }
}).listen(PORT, () => {
  console.log(`Widget demo: http://localhost:${PORT}/?key=pk_YOUR_PROJECT_KEY`);
});
