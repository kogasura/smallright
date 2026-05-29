# smallright

**Browser automation for AI agents — without burning your token budget.**

smallright is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets an LLM drive a real browser. It is built on top of [Playwright](https://playwright.dev), but it solves a problem Playwright was never designed for: **keeping the conversation between the model and the browser small enough to be practical.**

---

## The problem

When you ask an LLM to operate a web page, the model needs to *see* the page before it can act. The naive way to do that is to hand the model the page's HTML or a full accessibility snapshot. That approach breaks down fast:

- **A single modern page is enormous.** One real-world page can serialize to tens of thousands of tokens of DOM. The model has to read all of it just to find one button.
- **Every action makes it worse.** Click a button, and you re-read the whole page to see what changed. A 10-step task can re-send the same header, sidebar, and footer ten times over.
- **Selectors are brittle.** Asking the model to generate CSS selectors or XPath produces fragile automation that breaks the moment a class name changes.

The result is slow, expensive, and unreliable automation — you spend most of your token budget describing unchanged pixels instead of doing work.

## What smallright does

smallright sits between the model and Playwright and acts as a **translator that speaks to the LLM in the fewest tokens possible.** Instead of dumping the DOM, it sends only what the model needs to make its next decision. Four ideas do the heavy lifting:

### 1. Send actions, not markup

Rather than raw HTML, smallright returns a clean list of **what you can actually do**: the clickable elements (buttons, links) and the fillable fields (inputs, selects). Each element is stripped down to just the attributes a model needs to identify and use it — no wrapper divs, no styling, no internal tracking IDs. The model reads a short, structured menu of options instead of parsing a document.

### 2. Read the page by zone, not all at once

smallright automatically splits a page into semantic zones — `header`, `nav`, `main`, `aside`, `footer` — by detecting semantic HTML, ARIA landmarks, and common layout patterns. You can then read **just the zone you care about**:

```
read_page(zone: "main")
```

No more shipping a 2,000-token navigation menu to the model when all it needs is the article body.

### 3. Return the diff, not the whole page (the key idea)

This is what makes smallright fundamentally different from pointing an LLM at raw browser automation.

After every `click` or `fill_form`, smallright fingerprints each zone and compares it to the state before the action. It returns **only the zones that changed**, plus a one-line note listing the zones that didn't:

> *main changed → here's the new content. header, nav, footer: unchanged.*

So a login click costs you the new main panel — not a fresh copy of the entire page. Across a multi-step task, this is the difference between linear token growth and a flat line.

### 4. Collapse the repetitive stuff

A search results page with 100 near-identical rows doesn't teach the model anything after the first few. smallright detects groups of 10+ similar elements and summarizes them (`...and 97 more similar elements`), skips off-screen and hidden elements, and caps element scans — so a giant list never blows up your context window.

## Bonus: no selectors for everyday actions

For the actions a model takes most — clicking, filling, and selecting — smallright resolves elements by **visible text, label, or role**, so the model interacts the way a human would:

```
fill_form(fields: { "Email": "user@example.com", "Password": "secret" })
click(text: "Sign in")
```

No CSS selectors, no XPath, no fragile `ref` IDs to track for everyday interaction — the model points at what it can see, and smallright finds it. (A few tools such as `read_table`, `upload_file`, and `wait_for` still accept an optional CSS selector for the cases where you want to target something precisely.)

---

## smallright vs. Playwright — which do I want?

They are not competitors; smallright *runs on* Playwright. The question is who's driving:

| | **Playwright** | **smallright** |
|---|---|---|
| Driver | A human writing scripts | An LLM acting in real time |
| Optimized for | Browser power & precision | Minimal token cost per step |
| You write | Explicit selectors & assertions | Plain text / labels |
| Page state | You query what you need | Returned as diffs automatically |

**Use Playwright directly** when you're a developer authoring deterministic test scripts. **Use smallright** when an AI agent needs to operate a browser turn-by-turn and every token counts.

---

## Quick start

smallright is published on npm and runs straight from `npx` — no clone, no build. It requires **Node.js 20 or later**. Add it to your MCP client's config (e.g. `.mcp.json`):

```json
{
  "mcpServers": {
    "smallright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "smallright"]
    }
  }
}
```

smallright drives a real Chromium browser via Playwright, so install the browser binary once:

```bash
npx playwright install chromium
```

That's it — your MCP client will launch smallright on demand.

A typical interaction:

```
navigate(url: "https://example.com/login")                               # go to the page, get its actions
fill_form(fields: { "Email": "user@example.com", "Password": "secret" })
click(text: "Sign in")                                                   # returns only the zones that changed
read_page(zone: "main")                                                  # read just the part you care about
```

---

## Tools

smallright exposes 19 tools, grouped by what they do.

### Acting on the page

| Tool | Description |
|---|---|
| `navigate` | Navigate to a URL (or go back in history) and return the interactive elements |
| `click` | Click — or hover — an element identified by text; returns a StateDiff of changed zones |
| `fill_form` | Fill one or more fields at once using a label→value map; returns a StateDiff |
| `select_option` | Select a dropdown option identified by label; returns a StateDiff |
| `press_key` | Send a keyboard key press (Tab, Enter, Escape, …); returns a StateDiff |
| `run_batch` | Execute multiple steps in one call and return the final StateDiff — fewer round-trips |

### Reading the page

| Tool | Description |
|---|---|
| `read_page` | Get interactive elements and content of the current page; supports zone filtering and a `visual` (full-DOM) mode |
| `read_table` | Return a table as a JSON array; narrow it by zone or CSS selector |
| `screenshot` | Capture the page or a specific zone as a Base64 image (PNG or JPEG) |

### Files

| Tool | Description |
|---|---|
| `upload_file` | Upload files to a file input identified by label or selector |
| `download_file` | Click an element to trigger a download; returns filename, size, and a text preview |

### Zones & profiles

| Tool | Description |
|---|---|
| `configure_zones` | Auto-detect zones, or set them manually for the current session |
| `save_profile` | Persist the current zone definitions (and optionally session cookies) for a domain; auto-loaded on next navigate |
| `delete_profile` | Delete the saved site profile for a domain |

> **Site profiles** persist zone definitions per domain, so zone detection only has to happen once per site. Pass `save_session: true` to `save_profile` to also preserve login cookies across restarts.

### Page control

| Tool | Description |
|---|---|
| `set_viewport` | Change the viewport size by preset (mobile/tablet/desktop) or explicit dimensions |
| `wait_for` | Wait until a given text or CSS selector becomes visible |

### Debugging

| Tool | Description |
|---|---|
| `read_console_messages` | Retrieve browser console output; filter by level, regex, or timestamp (buffer holds up to 500 messages, FIFO) |
| `read_network_requests` | Retrieve HTTP requests issued by the page; filter by URL regex, status, method, or resource type (buffer holds up to 200 requests, FIFO) |

### Low-level escape hatch

| Tool | Description |
|---|---|
| `evaluate` | Execute arbitrary JavaScript in the browser and return the result as JSON — prefer the other tools when possible |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SMALLRIGHT_HEADLESS` | `true` | Set to `false` to run the browser in headed (visible) mode |

You can also run headed via CLI flags: `--no-headless` or `--headless=false`.

## Security

- **`evaluate` tool** executes arbitrary JavaScript in the browser. Only pass trusted, validated input — never forward unsanitized user input to it.
- **Element resolution does not mutate the page.** smallright identifies elements by generating CSS selectors from the live DOM; it does not inject tracking attributes or otherwise modify the page you are automating.

## License

MIT
