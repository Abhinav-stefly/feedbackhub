# FeedbackHub widget

A small feedback button for any website. One `<script>` tag, no dependencies, about 8 KB gzipped.

## Install

Paste this just before the closing `</body>` tag of your site:

```html
<script
  src="https://YOUR-WIDGET-HOST/widget.js"
  data-project-key="PUBLIC_PROJECT_KEY"
  data-api-url="https://YOUR-API-HOST"
  defer
></script>
```

Find your **public project key** (it starts with `pk_`) in your FeedbackHub project settings.
It is safe to put in your page: it can only submit feedback and read what you chose to publish.

## Options

All options are `data-*` attributes on the script tag.

| Attribute          | Required | Default                   | Meaning                                         |
| ------------------ | -------- | ------------------------- | ----------------------------------------------- |
| `data-project-key` | yes      | none                      | Your public project key (`pk_...`)              |
| `data-api-url`     | no       | the server of `widget.js` | Where the FeedbackHub API lives                 |
| `data-position`    | no       | `bottom-right`            | `bottom-right` or `bottom-left`                 |
| `data-color`       | no       | `#4f46e5`                 | Accent colour as `#rrggbb` (text colour adapts) |
| `data-label`       | no       | `Feedback`                | Button text, up to 24 characters                |

Invalid optional values fall back to the default. A missing or invalid project key stops the
widget and prints a message to the browser console. It never breaks your page.

## JavaScript API

```js
FeedbackHub.open(); // open the panel (for example from your own "Give feedback" link)
FeedbackHub.close();
FeedbackHub.destroy(); // remove the widget completely
FeedbackHub.version;
```

## What visitors can do

- Send a bug report, feature request, or other feedback (title and details).
- If you switched the public board on: vote for ideas you published.

## Privacy

- No name, email, or account is asked for.
- Votes use a random ID stored in the visitor's browser (`localStorage`); the server stores only a
  fingerprint of it.
- Requests send **no cookies** and **no referrer**.

## If your site uses a Content-Security-Policy

Allow these in your policy:

- `script-src`: the host that serves `widget.js`
- `connect-src`: your FeedbackHub API host

No `style-src` exception is needed: the widget styles itself with constructable stylesheets
(browsers without them use an inline style, which needs `style-src 'unsafe-inline'`).

## Accessibility

Keyboard operable (Tab, Shift+Tab, Enter, Escape, arrow keys on the tabs), focus is kept inside the
open dialog and returned to the button on close, errors are announced to screen readers, and the
widget follows the visitor's light or dark preference and reduced-motion setting.

## Try it on a plain HTML page

```bash
npm run build -w @feedbackhub/widget
npm run demo -w @feedbackhub/widget
# open http://localhost:5500/?key=pk_YOUR_KEY&api=http://localhost:4000
```

Extra query options: `color`, `position`, `label`, `widget=off`, `hostile=1`, `csp=strict`.

## Limits and honest notes

- The ideas list shows the 20 most-voted public ideas (no "load more" yet).
- If the API runs on a free host that sleeps, the first message can take up to a minute. The
  widget says so after 6 seconds and gives up after 45.
- Anonymous voting deters casual double-voting; it is not fraud-proof.
- Shadow DOM mode is `open`, so scripts on your own page can inspect the widget.
