# smallright

AI-friendly browser automation MCP server that reduces token consumption by zone-based partial DOM retrieval.

## Features

- **Zone-based DOM retrieval** — split pages into zones (header/main/sidebar/footer) and fetch only what you need
- **Text/label element resolution** — interact with elements by text, label, or role; no CSS selectors or ref IDs needed
- **Batch execution** — run multiple actions in one call to reduce MCP round-trips
- **Site profiles** — persist zone definitions per domain so detection only happens once

## Installation

```bash
npm install
npm run build
npx playwright install chromium
```

## MCP Configuration

Add the following to your `.mcp.json`:

```json
{
  "mcpServers": {
    "smallright": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/smallright/dist/index.js"]
    }
  }
}
```

## Quick Start

```
# 1. Navigate to a page
navigate(url: "https://example.com/login")

# 2. Read the page to see available elements
read_page()

# 3. Interact using text/label — no selectors needed
fill(label: "Email", value: "user@example.com")
fill(label: "Password", value: "secret")
click(text: "Login")

# 4. Read only the relevant zone after the action
read_page(zone: "main")
```

## Tools

### High-level (9 tools)

| Tool | Description |
|---|---|
| `navigate` | Navigate to a URL and return the list of interactive elements |
| `read_page` | Get interactive elements and content of the current page; supports zone filtering |
| `click` | Click an element identified by text; returns StateDiff of changed zones |
| `fill` | Fill a field identified by label; returns StateDiff of changed zones |
| `fill_form` | Fill multiple fields at once using a label→value map |
| `select_option` | Select a dropdown option identified by label |
| `read_table` | Return the first matching table as a JSON array |
| `run_batch` | Execute multiple steps in one call and return the final StateDiff |
| `screenshot` | Capture the current page or a specific zone as a Base64 image |

### Mid-level (5 tools)

| Tool | Description |
|---|---|
| `setup_page` | Auto-detect zones on the current page |
| `define_zones` | Manually define zones for the current session |
| `save_profile` | Save the current zone definitions as a site profile for a domain |
| `list_profiles` | List all saved site profiles |
| `delete_profile` | Delete the site profile for a domain |

### Low-level (2 tools)

| Tool | Description |
|---|---|
| `get_state` | Fallback tool to retrieve raw page state; `action` mode or `visual` (full DOM) mode |
| `evaluate` | Execute arbitrary JavaScript in the browser and return the result as JSON |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SMALLRIGHT_HEADLESS` | `true` | Set to `false` to run the browser in headed (visible) mode |

## Security

- **`evaluate` tool**: Executes arbitrary JavaScript in the browser. Only pass trusted, validated input. Never forward unsanitized user input to this tool.
- **`data-smallright-ref` attributes**: smallright adds temporary `data-smallright-ref` attributes to DOM elements during element scanning for internal tracking. These are cleaned up after each operation but may be visible in live DOM inspection.

## License

MIT
