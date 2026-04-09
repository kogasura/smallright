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
import { clickElement } from "./tools/click.js";
import { fillForm } from "./tools/fill-form.js";
import { selectOption } from "./tools/select-option.js";
import { configureZones } from "./tools/configure-zones.js";
import { saveProfile } from "./tools/save-profile.js";
import { deleteProfile } from "./tools/delete-profile.js";
import { runBatch } from "./tools/run-batch.js";
import { readTable } from "./tools/read-table.js";
import { takeScreenshot } from "./tools/screenshot.js";
import { evaluate } from "./tools/evaluate.js";
import { uploadFile } from "./tools/upload-file.js";
import { downloadFile } from "./tools/download-file.js";
import { setViewport } from "./tools/set-viewport.js";
import { pressKey } from "./tools/press-key.js";
import { waitFor } from "./tools/wait-for.js";
import type { Services } from "./types.js";

export function createMcpServer(): { server: McpServer; services: Services } {
  const server = new McpServer(
    {
      name: "smallright",
      version: "0.3.0",
    },
    {
      instructions: `smallright — AI-Friendly Browser Automation

## Basic Flow
1. navigate(url) — open a page. Use navigate(back: true) to go back.
2. read_page() — inspect content and interactive elements. Use read_page(mode: "visual") for full DOM snapshot.
3. click(text) — click an element. Use click(text, action: "hover") to hover instead.
4. fill_form(fields) — fill one or more form fields by label. Example: fill_form({ "Email": "user@example.com" })
5. press_key(key) — send keyboard input (Tab, Enter, Escape, etc.)

## Targeting Elements
- By text: click(text: "Login")
- By label: fill_form(fields: { "Email": "user@example.com" })
- Do not use ref IDs or CSS selectors — always use text or label

## Ambiguous Match
If multiple elements match, a candidate list is returned. Re-call with the index parameter.

## Zones (token reduction)
- configure_zones() auto-detects zones. Pass zones parameter to set manually.
- read_page(zone: "main") fetches only the specified zone
- save_profile() persists zone definitions for auto-loading on next visit

## Waiting
- wait_for(text) or wait_for(selector) — wait for an element to appear

## File Operations
- upload_file(paths) — set files on input[type=file]
- download_file(text) — click to download, returns filename/size/preview

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
    "Navigate to a URL or go back in history. Returns ActionModeState with interactive elements.",
    {
      url: z.string().optional().describe("URL to navigate to"),
      back: z.boolean().optional().describe("Set to true to go back in history (mutually exclusive with url)"),
    },
    (params) => wrap(() => navigate(services, params))
  );

  // ── read_page ──
  server.tool(
    "read_page",
    "Retrieve interactive elements and content of the current page. Supports zone filtering and visual mode.",
    {
      zone: z.string().optional().describe("Zone name to fetch (e.g. main, header). Omit for full page."),
      mode: z.enum(["action", "visual"]).optional().describe("action (default): interactive elements. visual: full DOM snapshot."),
    },
    (params) => wrap(() => readPage(services, params))
  );

  // ── click ──
  server.tool(
    "click",
    "Click or hover an element identified by text. Returns StateDiff. Use action: 'hover' for tooltips/menus.",
    {
      text: z.string().describe("Text of the element"),
      action: z.enum(["click", "hover"]).optional().describe("Action to perform (default: click)"),
      role: z.string().optional().describe("Element role (e.g. button, link)"),
      zone: z.string().optional().describe("Zone to search in"),
      index: z.number().optional().describe("Disambiguation index for AmbiguousMatch"),
    },
    (params) => wrap(() => clickElement(services, params))
  );

  // ── fill_form ──
  server.tool(
    "fill_form",
    "Fill one or more form fields by label. Returns StateDiff and list of filled fields.",
    {
      fields: z.record(z.string(), z.string()).describe("Map of label to value (e.g. { \"Email\": \"user@example.com\" })"),
    },
    (params) => wrap(() => fillForm(services, params))
  );

  // ── select_option ──
  server.tool(
    "select_option",
    "Select a dropdown option by label. Returns StateDiff.",
    {
      label: z.string().describe("Label of the select field"),
      value: z.string().describe("Option value or text to select"),
    },
    (params) => wrap(() => selectOption(services, params))
  );

  // ── configure_zones ──
  server.tool(
    "configure_zones",
    "Auto-detect or manually set page zones for token reduction. Returns ZoneDefinition[]. Use save_profile() to persist.",
    {
      zones: z.array(
        z.object({
          name: z.string(),
          selector: z.string(),
          description: z.string().optional(),
        })
      ).optional().describe("Zone definitions to set. Omit to auto-detect."),
    },
    (params) => wrap(() => configureZones(services, params))
  );

  // ── save_profile ──
  server.tool(
    "save_profile",
    "Persist current zone definitions for the domain. Auto-loaded on next navigate.",
    {
      domain: z.string().optional().describe("Domain (defaults to current page hostname)"),
    },
    (params) => wrap(() => saveProfile(services, params))
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
            .enum(["click", "hover", "fill_form", "select", "navigate", "wait"])
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

  // ── upload_file ──
  server.tool(
    "upload_file",
    "Upload files to a file input element identified by label or selector.",
    {
      paths: z.array(z.string()).min(1).describe("Absolute file paths to upload"),
      label: z.string().optional().describe("Label text of the file input"),
      selector: z.string().optional().describe("CSS selector of the file input"),
    },
    (params) => wrap(() => uploadFile(services, params))
  );

  // ── download_file ──
  server.tool(
    "download_file",
    "Click an element to trigger a file download. Returns filename, size, and a text preview for supported formats.",
    {
      text: z.string().describe("Text of the element that triggers the download."),
      role: z.string().optional().describe("Element role for better matching."),
      index: z.number().optional().describe("Disambiguation index for AmbiguousMatch."),
      timeout: z.number().optional().describe("Max wait time for download in ms (default: 30000)."),
      save_path: z.string().optional().describe("Save the file to this path. If omitted, the temp file is deleted after inspection."),
    },
    (params) => wrap(() => downloadFile(services, params))
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

  // ── set_viewport ──
  server.tool(
    "set_viewport",
    "Change the browser viewport size using a preset or explicit dimensions. Returns ActionModeState after resize.",
    {
      width:  z.number().optional().describe("Viewport width in pixels"),
      height: z.number().optional().describe("Viewport height in pixels"),
      preset: z.enum(["mobile", "tablet", "desktop"]).optional()
        .describe("Preset: mobile(375x812), tablet(768x1024), desktop(1280x720)"),
    },
    (params) => wrap(() => setViewport(services, params))
  );

  // ── press_key ──
  server.tool(
    "press_key",
    "Send a keyboard key press to the current page. Returns a StateDiff of changed zones after the action.",
    {
      key: z.string().describe("Key to press (e.g. Tab, Enter, Escape, ArrowDown)"),
    },
    (params) => wrap(() => pressKey(services, params))
  );

  // ── wait_for ──
  server.tool(
    "wait_for",
    "Wait until the specified text or CSS selector becomes visible on the page. Returns ActionModeState after the element appears.",
    {
      text:     z.string().optional().describe("Text to wait for (visible on page)"),
      selector: z.string().optional().describe("CSS selector to wait for"),
      timeout:  z.number().optional().describe("Max wait time in ms (default: 10000)"),
    },
    (params) => wrap(() => waitFor(services, params))
  );

  return { server, services };
}
