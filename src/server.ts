import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createBrowserManager } from "./core/browser-manager.js";
import { createElementRegistry } from "./core/element-registry.js";
import { createStateBuilder } from "./core/state-builder.js";
import { createStateDiffer } from "./core/state-differ.js";
import { createZoneManager } from "./core/zone-manager.js";
import { createProfileManager } from "./core/profile-manager.js";
import { createBatchExecutor } from "./core/batch-executor.js";
import { navigate } from "./tools/navigate.js";
import { readPage } from "./tools/read-page.js";
import { getState } from "./tools/get-state.js";
import { clickElement } from "./tools/click.js";
import { fillField } from "./tools/fill.js";
import { fillForm } from "./tools/fill-form.js";
import { selectOption } from "./tools/select-option.js";
import { setupPage } from "./tools/setup-page.js";
import { defineZones } from "./tools/define-zones.js";
import { saveProfile } from "./tools/save-profile.js";
import { listProfiles } from "./tools/list-profiles.js";
import { deleteProfile } from "./tools/delete-profile.js";
import { runBatch } from "./tools/run-batch.js";
import { readTable } from "./tools/read-table.js";
import { takeScreenshot } from "./tools/screenshot.js";
import { evaluate } from "./tools/evaluate.js";
import type { Services } from "./types.js";

export function createMcpServer(): { server: McpServer; services: Services } {
  const server = new McpServer(
    {
      name: "smallright",
      version: "0.1.0",
    },
    {
      instructions: `smallright — AI-Friendly Browser Automation

## Basic Flow
1. navigate(url) — open a page, returns ActionModeState
2. read_page() — inspect content and interactive elements
3. click(text) / fill(label, value) / fill_form(fields) — interact with elements

## Targeting Elements
- By text: click(text: "Login")
- By label: fill(label: "Email", value: "user@example.com")
- Do not use ref IDs or CSS selectors — always use text or label

## Ambiguous Match
If multiple elements match, a candidate list is returned. Re-call with the index parameter to select the intended element.

## Zones (token reduction)
- setup_page() auto-detects zones on the page (header/main/sidebar, etc.)
- read_page(zone: "main") fetches only the specified zone
- save_profile() persists zone definitions and auto-applies them on the next visit

## Batch Execution
run_batch(steps) executes multiple actions in a single call.`,
    }
  );

  const services: Services = {
    browser: createBrowserManager(),
    elements: createElementRegistry(),
    state: createStateBuilder(),
    zones: createZoneManager(),
    differ: createStateDiffer(),
    profiles: createProfileManager(),
    batch: createBatchExecutor(),
  };

  // Common error handling wrapper
  function wrap(fn: () => Promise<string>) {
    return fn()
      .then((text) => ({
        content: [{ type: "text" as const, text }],
      }))
      .catch((err: unknown) => ({
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true as const,
      }));
  }

  // ── navigate ──
  server.tool(
    "navigate",
    "Navigate to the specified URL and return a list of interactive elements.",
    {
      url: z.string().describe("URL to navigate to (e.g. https://example.com)"),
    },
    (params) => wrap(() => navigate(services, params))
  );

  // ── read_page ──
  server.tool(
    "read_page",
    "Retrieve interactive elements and content of the current page. Use after navigate or any action to check the current state. Supports zone filtering to reduce token usage.",
    {
      zone: z
        .string()
        .optional()
        .describe(
          "Zone name to fetch (e.g. main, header). Omit to retrieve the full page."
        ),
    },
    (params) => wrap(() => readPage(services, params))
  );

  // ── get_state ──
  server.tool(
    "get_state",
    "Fallback tool to retrieve the raw page state. mode: action returns a list of interactive elements; mode: visual returns the full DOM. Prefer navigate / read_page for normal use.",
    {
      mode: z
        .enum(["action", "visual"])
        .describe(
          "action: interactive element list (token-efficient), visual: full DOM (for detailed inspection)"
        ),
    },
    (params) => wrap(() => getState(services, params))
  );

  // ── click ──
  server.tool(
    "click",
    "Click an element identified by text. Returns a StateDiff of changed zones after the action. If multiple elements match, returns AmbiguousMatch — check candidates and re-call with the index parameter.",
    {
      text: z.string().describe("Text of the element to click (button label, link text, etc.)"),
      role: z.string().optional().describe("Element role (e.g. button, link). Improves match accuracy when specified."),
      zone: z.string().optional().describe("Zone name to search in. Omit to search all zones."),
      index: z.number().optional().describe("Index to select a specific candidate from AmbiguousMatch (0-based)."),
    },
    (params) => wrap(() => clickElement(services, params))
  );

  // ── fill ──
  server.tool(
    "fill",
    "Fill a field identified by label. Returns a StateDiff of changed zones after the action. Returns AmbiguousMatch if multiple fields match.",
    {
      label: z.string().describe("Label text of the input field (<label>, aria-label, placeholder, etc.)"),
      value: z.string().describe("Value to enter"),
    },
    (params) => wrap(() => fillField(services, params))
  );

  // ── fill_form ──
  server.tool(
    "fill_form",
    "Fill multiple form fields at once using a label-to-value map. Returns a StateDiff after all fields are filled. If a field cannot be matched, returns the filled fields so far along with error details.",
    {
      fields: z.record(z.string(), z.string()).describe("Map of label to value (e.g. { \"Email\": \"user@example.com\", \"Password\": \"secret\" })"),
    },
    (params) => wrap(() => fillForm(services, params))
  );

  // ── select_option ──
  server.tool(
    "select_option",
    "Select an option in a dropdown identified by label. Returns a StateDiff of changed zones after the action.",
    {
      label: z.string().describe("Label text of the select field"),
      value: z.string().describe("Option value attribute or display text to select"),
    },
    (params) => wrap(() => selectOption(services, params))
  );

  // ── setup_page ──
  server.tool(
    "setup_page",
    "Auto-detect zones on the current page and return ZoneDefinition[]. Run this on the first visit or before save_profile. Review or adjust the results with define_zones before saving, or pass them directly to save_profile.",
    {},
    (_params) => wrap(() => setupPage(services, _params as Record<string, never>))
  );

  // ── define_zones ──
  server.tool(
    "define_zones",
    "Manually specify zone definitions and apply them to the current session. Use this to adjust setup_page results or to explicitly configure site-specific zones.",
    {
      zones: z.array(
        z.object({
          name: z.string().describe("Zone name (e.g. header, main, sidebar, footer)"),
          selector: z.string().describe("CSS selector (e.g. #main, .content, main)"),
          description: z.string().optional().describe("Optional description of the zone"),
        })
      ).describe("Array of zone definitions"),
    },
    (params) => wrap(() => defineZones(services, params))
  );

  // ── save_profile ──
  server.tool(
    "save_profile",
    "Save the current zone definitions to a file associated with the domain. Run after finalizing zones with setup_page or define_zones. The profile is auto-loaded on the next navigate.",
    {
      domain: z.string().optional().describe("Domain to save to (e.g. example.com). Defaults to the current page hostname."),
    },
    (params) => wrap(() => saveProfile(services, params))
  );

  // ── list_profiles ──
  server.tool(
    "list_profiles",
    "Return a list of saved site profiles.",
    {},
    (_params) => wrap(() => listProfiles(services, _params as Record<string, never>))
  );

  // ── delete_profile ──
  server.tool(
    "delete_profile",
    "Delete the site profile for the specified domain.",
    {
      domain: z.string().describe("Domain of the profile to delete (e.g. example.com)"),
    },
    (params) => wrap(() => deleteProfile(services, params))
  );

  // ── run_batch ──
  server.tool(
    "run_batch",
    "Execute multiple action steps in a single call and return the final StateDiff. Reduces MCP round-trips. On error, returns the step index and state at the point of failure. Ambiguous matches also cause the batch to stop.",
    {
      steps: z.array(
        z.object({
          action: z
            .enum(["click", "fill", "fill_form", "select", "navigate", "wait"])
            .describe("Type of action to perform"),
          text: z.string().optional().describe("click: text of the element to click"),
          label: z
            .string()
            .optional()
            .describe("fill / select: label text of the field"),
          value: z
            .string()
            .optional()
            .describe("fill / select: value to enter or option to select"),
          fields: z
            .record(z.string(), z.string())
            .optional()
            .describe("fill_form: map of label to value"),
          url: z.string().optional().describe("navigate: URL to navigate to"),
          ms: z
            .number()
            .optional()
            .describe("wait: milliseconds to wait (default 1000)"),
        })
      ).describe("Array of steps to execute"),
    },
    (params) => wrap(() => runBatch(services, params))
  );

  // ── read_table ──
  server.tool(
    "read_table",
    "Return a table on the page as a JSON array. Narrow the target with zone or selector. If neither is specified, the first table on the page is used.",
    {
      zone: z
        .string()
        .optional()
        .describe("Zone name containing the table. Targets the first table within the zone."),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to directly target the table (e.g. #data-table, .results table)"),
    },
    (params) => wrap(() => readTable(services, params))
  );

  // ── screenshot ──
  server.tool(
    "screenshot",
    "Capture a screenshot of the current page or a specified zone. Returns a Base64-encoded image as JSON.",
    {
      zone: z
        .string()
        .optional()
        .describe("Zone name to capture. Omit for a full-page screenshot."),
      full_page: z
        .boolean()
        .optional()
        .describe("Set to true to capture the full scrollable page (only applies when zone is omitted)."),
      format: z
        .enum(["png", "jpeg"])
        .optional()
        .describe("Image format. Default: png. Use jpeg with quality to reduce token consumption."),
      quality: z
        .number()
        .optional()
        .describe("JPEG quality (1-100). Default: 50. Only effective when format is jpeg."),
    },
    (params) => wrap(() => takeScreenshot(services, params))
  );

  // ── evaluate ──
  server.tool(
    "evaluate",
    "Execute custom JavaScript in the browser and return the result as JSON. Low-level fallback tool — prefer other tools when possible.",
    {
      script: z
        .string()
        .describe(
          "JavaScript to execute (function body, e.g. \"return document.title\")"
        ),
    },
    (params) => wrap(() => evaluate(services, params))
  );

  return { server, services };
}
