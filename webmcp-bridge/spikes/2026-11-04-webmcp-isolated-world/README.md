# Spike: can an extension content script see and call WebMCP tools? (2026-11-04)

**Question (Stage 1, bullet 1 of `plans/main.md`):** can a Chrome extension discover the tools a page
registers through WebMCP, and call them?

**Method.** A Chrome extension content script runs in an *isolated world*: same DOM, separate JS
globals. The Chrome DevTools Protocol can create exactly such a world (`Page.createIsolatedWorld`),
so the spike drives the installed Chrome 156 over CDP instead of needing a packaged extension:

1. `index.html` registers three tools with the native API (`document.modelContext.registerTool`).
2. Chrome 156.0.8078.81 is launched with a throwaway profile and `--enable-features=WebMCP`
   (the command-line equivalent of `chrome://flags/#enable-webmcp-testing`).
3. `cdp.mjs` evaluates in the **main world** (what the page sees) and in a fresh **isolated world**
   (what a content script sees): `getTools()`, `executeTool()`, and a `toolchange` listener.

**Result (verbatim output of `cdp.mjs`):**

```json
{
  "chromeVersion": "Chrome/156.0.8078.81",
  "mainWorld": {
    "api": "document.modelContext",
    "typeofDocumentModelContext": "object",
    "typeofNavigatorModelContext": "undefined",
    "registered": "[\"get_state\",\"set_background_color\",\"set_sentence\"]",
    "registerError": null
  },
  "isolatedWorld": {
    "typeofDocumentModelContext": "object",
    "pageGlobalsVisible": "undefined",
    "tools": "[{\"name\":\"get_state\",\"description\":\"Returns the current background color and sentence.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}},\"annotations\":{\"consequentialHint\":false,\"debugging\":false,\"readOnlyHint\":true,\"untrustedContentHint\":false},\"origin\":\"http://localhost:8765\",\"sameWindow\":true},{\"name\":\"set_background_color\",\"description\":\"Sets the page background color.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"color\":{\"type\":\"string\",\"description\":\"CSS color\"}},\"required\":[\"color\"]},\"origin\":\"http://localhost:8765\",\"sameWindow\":true},{\"name\":\"set_sentence\",\"description\":\"Replaces the headline sentence.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}},\"required\":[\"text\"]},\"origin\":\"http://localhost:8765\",\"sameWindow\":true}]",
    "callSet": "{\"type\":\"string\",\"value\":\"{\\\"ok\\\":true,\\\"backgroundColor\\\":\\\"teal\\\"}\"}",
    "callGet": "{\"type\":\"string\",\"value\":\"{\\\"backgroundColor\\\":\\\"teal\\\",\\\"sentence\\\":\\\"Hello from the WebMCP spike page.\\\"}\"}",
    "callSentence": "{\"type\":\"string\",\"value\":\"ok: Changed from the isolated world\"}"
  },
  "mainWorldAfter": { "bg": "teal", "sentence": "Changed from the isolated world" },
  "toolchange": { "isolatedListenerFired": 1, "toolCountNow": 4 }
}
```

**Conclusions.**
- `document.modelContext` exists in Chrome 156 with the feature on; `navigator.modelContext` is gone.
- The isolated world sees the page's registry: names, descriptions, JSON-Schema `inputSchema`,
  `annotations` (only present on tools that declared them), `origin`, and `window`.
- `executeTool()` from the isolated world runs the page's `execute` and resolves with a **string**
  (the JSON-serialised return value), even when `execute` returned an object. The DOM changes landed.
- `toolchange` fires in the isolated world when the page registers a tool later.
- Page globals are invisible from the isolated world (`window.__registered` is `undefined`), so the
  registry is browser-owned, not page-JS-owned. This is the same mechanism Google's own
  "Model Context Tool Inspector" extension uses (a content script in the default world).

**Re-run.**

```bash
cd spikes/2026-11-04-webmcp-isolated-world
python3 -I -m http.server 8765 --bind 127.0.0.1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/webmcp-spike-profile --no-first-run --no-default-browser-check \
  --enable-features=WebMCP --remote-debugging-port=9333 http://localhost:8765/ &
node cdp.mjs
```
