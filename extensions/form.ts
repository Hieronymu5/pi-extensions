/**
 * Generic form extension that renders interactive forms from a JSON definition file.
 *
 * Usage (command):  /form <path-to-form.json>
 * Usage (LLM tool): form { "formFile": "path/to/form.json" }
 *
 * The JSON schema is documented in the FormDefinition interface below.
 * See spring-initializr-form.json for a complete example.
 */
import {
  DynamicBorder,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  Container,
  type Focusable,
  Input,
  SelectList,
  type SelectItem,
  Text,
  Key,
  matchesKey,
  type Theme,
} from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Form-definition types (the schema for the JSON file)
// ---------------------------------------------------------------------------

/** A single option inside a "select" field. */
interface FormOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * One field in the form.
 *  - type "text"   → free-text Input widget
 *  - type "select" → SelectList widget (options required)
 */
interface FormFieldDef {
  id: string;
  label: string;
  type: "text" | "select";
  /** Pre-filled / pre-selected value. */
  default?: string;
  /** Required when type === "select". */
  options?: FormOption[];
  /**
   * "identifier" — only lowercase [a-z.] characters are allowed.
   * Useful for groupId / artifactId style fields.
   */
  validation?: "identifier";
  /** Short hint shown below the label (text fields only). */
  hint?: string;
}

/**
 * A field whose value is derived from other fields after the user submits.
 * Exactly one of `from`, `value`, or `template` must be set.
 */
interface ComputedField {
  /** Target field id written into the result. */
  field: string;
  /** Copy the value of another field (by id). */
  from?: string;
  /** Hard-coded literal string. */
  value?: string;
  /**
   * Interpolate other field values using ${fieldId} placeholders.
   * Example: "${groupId}.${artifactId}"
   */
  template?: string;
  /** Documentation-only; ignored at runtime. */
  comment?: string;
}

/** Controls how the form result is presented after submission. */
interface SubmitConfig {
  /**
   * Base URL used to build a query-string URL from the collected values.
   * When set, the command handler prints the URL.
   */
  baseUrl?: string;
  /**
   * Ordered list of result field ids to include as query parameters.
   * If omitted, all non-computed fields are appended in definition order.
   */
  urlParams?: string[];
  /** Documentation-only; ignored at runtime. */
  comment?: string;
}

/**
 * Top-level shape of the form definition JSON file.
 *
 * Minimal example:
 * ```json
 * {
 *   "title": "My Form",
 *   "fields": [
 *     { "id": "name", "label": "Your name", "type": "text" },
 *     { "id": "lang", "label": "Language",  "type": "select",
 *       "default": "java",
 *       "options": [{"value":"java","label":"Java"},{"value":"kotlin","label":"Kotlin"}] }
 *   ]
 * }
 * ```
 */
interface FormDefinition {
  /** Displayed as the form heading. */
  title: string;
  /** Optional subtitle shown below the title. */
  description?: string;
  /** Overlay width. Accepts CSS-like values e.g. "70%" or "80". Default "60%". */
  overlayWidth?: string;
  /** Overlay max height. Default "80%". */
  overlayMaxHeight?: string;
  /**
   * Number of fields visible at one time before scrolling.
   * Default 4.
   */
  fieldsPerPage?: number;
  fields: FormFieldDef[];
  /** Fields derived from user input after submission. */
  computed?: ComputedField[];
  submit?: SubmitConfig;
}

/** The collected result — a plain map of field-id → string value. */
type FormResult = Record<string, string>;

// ---------------------------------------------------------------------------
// File loading helper
// ---------------------------------------------------------------------------

/**
 * Resolves and parses a form definition JSON file.
 * Tries the path as-is (absolute), then relative to cwd, then relative to
 * the directory where this extension lives.
 */
function loadFormDefinition(
  filePath: string,
  cwd: string,
): FormDefinition | null {
  const candidates = [
    filePath,
    path.join(cwd, filePath),
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", filePath),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, "utf-8");
        return JSON.parse(content) as FormDefinition;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DynamicFormComponent — TUI component driven by a FormDefinition
// ---------------------------------------------------------------------------

const DEFAULT_FIELDS_PER_PAGE = 4;

class DynamicFormComponent extends Container implements Focusable {
  private readonly fieldDefs: FormFieldDef[];
  private readonly inputs = new Map<string, Input>();
  private readonly selects = new Map<string, SelectList>();
  private readonly onDoneCallback: (result: FormResult | null) => void;
  private readonly theme: Theme;
  private readonly definition: FormDefinition;
  private readonly fieldsPerPage: number;

  private _focused = false;
  private activeFieldIndex = 0;
  private windowStart = 0;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.updateFocus();
  }

  constructor(
    theme: Theme,
    definition: FormDefinition,
    onDone: (result: FormResult | null) => void,
  ) {
    super();
    this.theme = theme;
    this.definition = definition;
    this.fieldDefs = definition.fields;
    this.fieldsPerPage = definition.fieldsPerPage ?? DEFAULT_FIELDS_PER_PAGE;
    this.onDoneCallback = onDone;

    this.createWidgets();
    this.rebuildVisibleFields();
  }

  // ---- Widget creation ----

  private createWidgets(): void {
    for (const fieldDef of this.fieldDefs) {
      if (fieldDef.type === "text") {
        const input = new Input();
        input.setValue(fieldDef.default ?? "");
        this.inputs.set(fieldDef.id, input);
      } else if (fieldDef.type === "select" && fieldDef.options) {
        const items: SelectItem[] = fieldDef.options.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
        }));
        const maxVisible = Math.min(items.length, 5);
        const sel = new SelectList(items, maxVisible, {
          selectedPrefix: (s) => this.theme.fg("accent", s),
          selectedText: (s) => this.theme.fg("accent", s),
          description: (s) => this.theme.fg("muted", s),
          scrollInfo: (s) => this.theme.fg("dim", s),
          noMatch: (s) => this.theme.fg("warning", s),
        });

        if (fieldDef.default) {
          const idx = items.findIndex((o) => o.value === fieldDef.default);
          if (idx >= 0) sel.setSelectedIndex(idx);
        }

        // When the user confirms a selection, advance to the next field
        // (or submit if this is already the last one).
        sel.onSelect = () => {
          if (this.activeFieldIndex >= this.fieldDefs.length - 1) {
            this.onDoneCallback(this.collectResult());
          } else {
            this.activeFieldIndex++;
            this.updateWindowStart();
            this.rebuildVisibleFields();
            this.invalidate();
          }
        };

        this.selects.set(fieldDef.id, sel);
      }
    }
  }

  // ---- Window / scrolling ----

  private updateWindowStart(): void {
    if (this.activeFieldIndex < this.windowStart) {
      this.windowStart = this.activeFieldIndex;
    } else if (this.activeFieldIndex >= this.windowStart + this.fieldsPerPage) {
      this.windowStart = this.activeFieldIndex - this.fieldsPerPage + 1;
    }
  }

  // ---- Layout rebuild ----

  private rebuildVisibleFields(): void {
    this.clear();

    const visibleEnd = Math.min(
      this.windowStart + this.fieldsPerPage,
      this.fieldDefs.length,
    );
    const visible = this.fieldDefs.slice(this.windowStart, visibleEnd);

    // ── Header ──
    this.addChild(new DynamicBorder((s) => this.theme.fg("accent", s)));
    this.addChild(
      new Text(this.theme.fg("accent", this.theme.bold(this.definition.title))),
    );
    if (this.definition.description) {
      this.addChild(
        new Text(this.theme.fg("muted", this.definition.description)),
      );
    }
    this.addChild(new Text(""));

    // ── "More above" indicator ──
    if (this.windowStart > 0) {
      const n = this.windowStart;
      this.addChild(
        new Text(
          this.theme.fg("dim", `  ↑ ${n} more field${n > 1 ? "s" : ""} above`),
        ),
      );
      this.addChild(new Text(""));
    }

    // ── Visible fields ──
    for (const fieldDef of visible) {
      const globalIdx = this.fieldDefs.indexOf(fieldDef);
      const isActive = globalIdx === this.activeFieldIndex;

      const rawLabel = `${globalIdx + 1}. ${fieldDef.label}:`;
      const hintSuffix =
        fieldDef.hint && fieldDef.type === "text"
          ? "  " + this.theme.fg("dim", fieldDef.hint)
          : "";
      this.addChild(
        new Text(
          (isActive
            ? this.theme.fg("accent", this.theme.bold(rawLabel))
            : this.theme.fg("text", rawLabel)) + hintSuffix,
        ),
      );

      if (fieldDef.type === "text") {
        this.addChild(this.inputs.get(fieldDef.id)!);
      } else if (fieldDef.type === "select") {
        this.addChild(this.selects.get(fieldDef.id)!);
      }
      this.addChild(new Text(""));
    }

    // ── "More below" indicator ──
    const remaining = this.fieldDefs.length - visibleEnd;
    if (remaining > 0) {
      this.addChild(
        new Text(
          this.theme.fg(
            "dim",
            `  ↓ ${remaining} more field${remaining > 1 ? "s" : ""} below`,
          ),
        ),
      );
      this.addChild(new Text(""));
    }

    // ── Footer ──
    this.addChild(
      new Text(
        this.theme.fg(
          "muted",
          `  Field ${this.activeFieldIndex + 1} of ${this.fieldDefs.length}`,
        ),
      ),
    );
    this.addChild(
      new Text(
        this.theme.fg(
          "dim",
          "↑↓ navigate options • Tab/Shift+Tab switch fields • Enter confirm/submit • Esc cancel",
        ),
      ),
    );
    this.addChild(new DynamicBorder((s) => this.theme.fg("accent", s)));

    this.updateFocus();
  }

  // ---- Focus management ----

  private updateFocus(): void {
    for (const [id, input] of this.inputs) {
      const idx = this.fieldDefs.findIndex((f) => f.id === id);
      input.focused = this._focused && idx === this.activeFieldIndex;
    }
    for (const [id, sel] of this.selects) {
      const idx = this.fieldDefs.findIndex((f) => f.id === id);
      sel.focused = this._focused && idx === this.activeFieldIndex;
    }
  }

  // ---- Input routing ----

  handleInput(keyData: string): void {
    // Tab → next field
    if (matchesKey(keyData, Key.tab)) {
      this.activeFieldIndex =
        (this.activeFieldIndex + 1) % this.fieldDefs.length;
      this.updateWindowStart();
      this.rebuildVisibleFields();
      this.invalidate();
      return;
    }

    // Shift+Tab → previous field
    if (matchesKey(keyData, Key.shift("tab"))) {
      this.activeFieldIndex =
        (this.activeFieldIndex - 1 + this.fieldDefs.length) %
        this.fieldDefs.length;
      this.updateWindowStart();
      this.rebuildVisibleFields();
      this.invalidate();
      return;
    }

    // Esc → cancel
    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback(null);
      return;
    }

    const fieldDef = this.fieldDefs[this.activeFieldIndex];
    if (!fieldDef) return;

    if (fieldDef.type === "text") {
      const input = this.inputs.get(fieldDef.id);

      // Enter on a text field → advance or submit
      if (matchesKey(keyData, Key.enter)) {
        if (this.activeFieldIndex >= this.fieldDefs.length - 1) {
          this.onDoneCallback(this.collectResult());
        } else {
          this.activeFieldIndex++;
          this.updateWindowStart();
          this.rebuildVisibleFields();
          this.invalidate();
        }
        return;
      }

      // ↑ / ↓ on a text field → navigate between fields
      if (matchesKey(keyData, Key.up)) {
        this.activeFieldIndex =
          (this.activeFieldIndex - 1 + this.fieldDefs.length) %
          this.fieldDefs.length;
        this.updateWindowStart();
        this.rebuildVisibleFields();
        this.invalidate();
        return;
      }
      if (matchesKey(keyData, Key.down)) {
        this.activeFieldIndex =
          (this.activeFieldIndex + 1) % this.fieldDefs.length;
        this.updateWindowStart();
        this.rebuildVisibleFields();
        this.invalidate();
        return;
      }

      // Identifier validation: only lowercase [a-z.] allowed.
      // Allow non-printable keys (charCode < 32) AND DEL/backspace (charCode 127).
      if (
        fieldDef.validation === "identifier" &&
        keyData.length === 1 &&
        keyData.charCodeAt(0) >= 32 &&
        keyData.charCodeAt(0) !== 127 &&
        !/^[a-z.]$/.test(keyData)
      ) {
        return;
      }

      input?.handleInput(keyData);
    } else if (fieldDef.type === "select") {
      // SelectList handles ↑↓ navigation; Enter is handled via onSelect.
      const sel = this.selects.get(fieldDef.id);
      sel?.handleInput(keyData);
    }

    this.invalidate();
  }

  // ---- Result collection ----

  private collectResult(): FormResult {
    const result: FormResult = {};

    for (const fieldDef of this.fieldDefs) {
      if (fieldDef.type === "text") {
        const input = this.inputs.get(fieldDef.id);
        result[fieldDef.id] = input?.value || fieldDef.default || "";
      } else if (fieldDef.type === "select") {
        const sel = this.selects.get(fieldDef.id);
        result[fieldDef.id] =
          sel?.getSelectedItem()?.value || fieldDef.default || "";
      }
    }

    return result;
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuildVisibleFields();
  }
}

// ---------------------------------------------------------------------------
// Helper: run the form UI and return the result
// ---------------------------------------------------------------------------
async function runForm(
  ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
  definition: FormDefinition,
): Promise<FormResult | null> {
  return ctx.ui.custom<FormResult | null>(
    (_tui, theme, _keybindings, done) => {
      let form: DynamicFormComponent | null = null;
      let wrapperFocused = true;

      const root = {
        get focused() {
          return wrapperFocused;
        },
        set focused(v: boolean) {
          wrapperFocused = v;
          if (form) form.focused = v;
        },
        render(width: number) {
          return form ? form.render(width) : [];
        },
        invalidate() {
          form?.invalidate();
        },
        handleInput(data: string) {
          form?.handleInput(data);
          _tui.requestRender();
        },
      };

      form = new DynamicFormComponent(theme, definition, done);
      return root;
    },
    {
      overlay: true,
      overlayOptions: {
        width: definition.overlayWidth ?? "60%",
        maxHeight: definition.overlayMaxHeight ?? "80%",
        anchor: "center",
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

export default function formExtension(pi: ExtensionAPI) {
  // ── Tool: callable by the LLM ─────────────────────────────────────────

  pi.registerTool({
    name: "form",
    label: "Form",
    description:
      "Display an interactive form defined by a JSON file and wait for the " +
      "user to fill it in. The form file path is resolved relative to the " +
      "current working directory. Returns all field values as a JSON object.",

    parameters: Type.Object({
      formFile: Type.String({
        description:
          "Path to the form definition JSON file, relative to the current " +
          'working directory.  Example: "spring-initializr-form.json"',
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const formFile = params.formFile;
      const definition = loadFormDefinition(formFile, ctx.cwd);

      if (!definition) {
        return {
          content: [
            {
              type: "text",
              text: `Error: form definition file not found: ${formFile}`,
            },
          ],
          details: { error: "file not found", formFile },
        };
      }

      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "Error: no UI available to display the form",
            },
          ],
          details: { error: "no UI", formFile },
        };
      }

      const result = await runForm(ctx, definition);

      if (!result) {
        return {
          content: [{ type: "text", text: "Form cancelled by user." }],
          details: { cancelled: true, formFile },
        };
      }

      // Build results
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        details: { formFile, result },
      };
    },

    renderCall(args, theme) {
      const file =
        typeof args.formFile === "string" ? args.formFile : "(unknown)";
      return new Text(
        theme.fg("toolTitle", theme.bold("form ")) + theme.fg("dim", file),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      if (result.isError) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }

      const details = result.details as
        | {
            formFile?: string;
            result?: FormResult;
            cancelled?: boolean;
          }
        | undefined;

      if (details?.cancelled) {
        return new Text(theme.fg("warning", "Form cancelled"), 0, 0);
      }

      if (!details?.result) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }

      const { result: values } = details;

      if (!expanded) {
        const pairs = Object.entries(values ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return new Text(pairs, 0, 0);
      }

      const lines: string[] = [];
      for (const [key, val] of Object.entries(values ?? {})) {
        lines.push(`${theme.fg("accent", key + ":")} ${val}`);
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  // ── Command: /form <path-to-form.json> ───────────────────────────────

  pi.registerCommand("form", {
    description:
      "Display an interactive form from a JSON definition file. " +
      "Usage: /form <path-to-form.json>",

    handler: async (args, ctx) => {
      const formFile = (args ?? "").trim();

      if (!formFile) {
        ctx.ui.notify(
          "Usage: /form <path-to-form.json>\n" +
            "Example: /form spring-initializr-form.json",
          "warning",
        );
        return;
      }

      if (!ctx.hasUI) {
        console.error("Error: no UI available for /form");
        return;
      }

      const definition = loadFormDefinition(formFile, ctx.cwd);

      if (!definition) {
        ctx.ui.notify(
          `Form definition file not found: ${formFile}\n` +
            `Searched relative to: ${ctx.cwd}`,
          "error",
        );
        return;
      }

      const result = await runForm(ctx, definition);

      if (!result) {
        ctx.ui.notify("Form cancelled.", "warning");
        return;
      }

      // Build and display the results
      ctx.ui.notify(
        `${definition.title}: ${JSON.stringify(result, null, 2)}`,
        "success",
      );
    },
  });
}
