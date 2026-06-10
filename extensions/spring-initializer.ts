/**
 * Spring Initializer Extension
 *
 * Displays a form for configuring a Spring Boot project using the Spring Initializr API.
 * Use /spring-init to trigger it.
 *
 * Populates all dropdowns from metadata.json
 */
import {
  DynamicBorder,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Focusable,
  Input,
  SelectList,
  SelectItem,
  Text,
  Key,
  matchesKey,
  type Theme,
} from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

// Import metadata dynamically
let metadata: any = null;

function loadMetadata(cwd: string): any {
  if (metadata) return metadata;

  const metadataPath = path.join(cwd, "metadata.json");
  try {
    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath, "utf-8");
      metadata = JSON.parse(content);
      return metadata;
    }
  } catch (e) {
    console.error("Failed to load metadata.json:", e);
  }
  return null;
}

// Form field types
type FieldType = "select" | "text";

interface FormField {
  index: number;
  label: string;
  field: string;
  type: FieldType;
  options?: SelectItem[];
  defaultValue?: string;
}

interface SpringInitResult {
  type: string;
  language: string;
  bootVersion: string;
  groupId: string;
  artifactId: string;
  name: string;
  description: string;
  packageName: string;
  packaging: string;
  javaVersion: string;
}

const FIELDS_PER_PAGE = 4;

class SpringInitForm extends Container implements Focusable {
  private fields: FormField[];
  private inputs: Map<number, Input>;
  private selects: Map<number, SelectList>;
  private onDoneCallback: (result: SpringInitResult | null) => void;
  private theme: Theme;
  private metadata: any;

  private _focused = false;
  private activeField = 0;
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
    metadata: any,
    onDone: (result: SpringInitResult | null) => void,
  ) {
    super();
    this.theme = theme;
    this.metadata = metadata;
    this.onDoneCallback = onDone as (result: SpringInitResult | null) => void;
    this.inputs = new Map();
    this.selects = new Map();

    // Define all form fields with index, label, and field
    this.fields = [
      {
        index: 0,
        label: "Project Type",
        field: "type",
        type: "select",
        options: this.getTypeOptions(),
        defaultValue: metadata?.type?.default,
      },
      {
        index: 1,
        label: "Language",
        field: "language",
        type: "select",
        options: this.getLanguageOptions(),
        defaultValue: metadata?.language?.default,
      },
      {
        index: 2,
        label: "Spring Boot Version",
        field: "bootVersion",
        type: "select",
        options: this.getBootVersionOptions(),
        defaultValue: metadata?.bootVersion?.default,
      },
      {
        index: 3,
        label: "Group ID",
        field: "groupId",
        type: "text",
        defaultValue: "com.example",
      },
      {
        index: 4,
        label: "Artifact ID",
        field: "artifactId",
        type: "text",
        defaultValue: "demo",
      },
      {
        index: 5,
        label: "Packaging",
        field: "packaging",
        type: "select",
        options: this.getPackagingOptions(),
        defaultValue: metadata?.packaging?.default,
      },
      {
        index: 6,
        label: "Java Version",
        field: "javaVersion",
        type: "select",
        options: this.getJavaVersionOptions(),
        defaultValue: metadata?.javaVersion?.default,
      },
    ];

    this.createComponents();
    this.rebuildVisibleFields();
  }

  private getTypeOptions(): SelectItem[] {
    if (!this.metadata?.type?.values) return [];
    return this.metadata.type.values
      .filter((v: any) => v.action === "/starter.zip")
      .map((v: any) => ({
        value: v.id,
        label: v.name,
        description: v.description,
      }));
  }

  private getLanguageOptions(): SelectItem[] {
    if (!this.metadata?.language?.values) return [];
    return this.metadata.language.values.map((v: any) => ({
      value: v.id,
      label: v.name,
    }));
  }

  private getBootVersionOptions(): SelectItem[] {
    if (!this.metadata?.bootVersion?.values) return [];
    return this.metadata.bootVersion.values.map((v: any) => ({
      value: v.id,
      label: v.name,
    }));
  }

  private getPackagingOptions(): SelectItem[] {
    if (!this.metadata?.packaging?.values) return [];
    return this.metadata.packaging.values.map((v: any) => ({
      value: v.id,
      label: v.name,
    }));
  }

  private getJavaVersionOptions(): SelectItem[] {
    if (!this.metadata?.javaVersion?.values) return [];
    return this.metadata.javaVersion.values.map((v: any) => ({
      value: v.id,
      label: v.name,
    }));
  }

  private createComponents(): void {
    for (const field of this.fields) {
      if (field.type === "text") {
        const input = new Input();
        input.setValue(field.defaultValue || "");
        this.inputs.set(field.index, input);
      } else if (field.type === "select" && field.options) {
        const maxVisible = Math.min(field.options.length, 5);
        const selectList = new SelectList(field.options, maxVisible, {
          selectedPrefix: (text) => this.theme.fg("accent", text),
          selectedText: (text) => this.theme.fg("accent", text),
          description: (text) => this.theme.fg("muted", text),
          scrollInfo: (text) => this.theme.fg("dim", text),
          noMatch: (text) => this.theme.fg("warning", text),
        });
        if (field.defaultValue) {
          const defaultIndex = field.options.findIndex(
            (opt) => opt.value === field.defaultValue,
          );
          if (defaultIndex >= 0) {
            selectList.setSelectedIndex(defaultIndex);
          }
        }
        // When the user confirms a selection (Enter), advance to the next
        // field (or submit if this is the last field).
        selectList.onSelect = () => {
          if (this.activeField >= this.fields.length - 1) {
            this.onDoneCallback(this.getResult());
          } else {
            this.activeField = this.activeField + 1;
            this.updateWindowStart();
            this.rebuildVisibleFields();
            this.invalidate();
          }
        };
        this.selects.set(field.index, selectList);
      }
    }
  }

  /** Slide windowStart so activeField stays within the visible page. */
  private updateWindowStart(): void {
    if (this.activeField < this.windowStart) {
      this.windowStart = this.activeField;
    } else if (this.activeField >= this.windowStart + FIELDS_PER_PAGE) {
      this.windowStart = this.activeField - FIELDS_PER_PAGE + 1;
    }
  }

  private rebuildVisibleFields(): void {
    this.clear();

    const visibleEnd = Math.min(
      this.windowStart + FIELDS_PER_PAGE,
      this.fields.length,
    );
    const visibleFields = this.fields.slice(this.windowStart, visibleEnd);

    // Header
    this.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));
    this.addChild(
      new Text(this.theme.fg("accent", this.theme.bold("Spring Initializer"))),
    );
    this.addChild(new Text(""));

    // "More above" indicator
    if (this.windowStart > 0) {
      this.addChild(
        new Text(
          this.theme.fg(
            "dim",
            `  ↑ ${this.windowStart} more field${
              this.windowStart > 1 ? "s" : ""
            } above`,
          ),
        ),
      );
      this.addChild(new Text(""));
    }

    // Visible fields
    for (const field of visibleFields) {
      const fieldLabel = `${field.index + 1}. ${field.label}:`;
      this.addChild(new Text(this.theme.fg("text", fieldLabel)));

      if (field.type === "text") {
        const input = this.inputs.get(field.index)!;
        this.addChild(input);
      } else if (field.type === "select") {
        const selectList = this.selects.get(field.index)!;
        this.addChild(selectList);
      }
      this.addChild(new Text(""));
    }

    // "More below" indicator
    const remaining = this.fields.length - visibleEnd;
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

    // Field counter
    this.addChild(
      new Text(
        this.theme.fg(
          "muted",
          `  Field ${this.activeField + 1} of ${this.fields.length}`,
        ),
      ),
    );

    // Help text
    this.addChild(
      new Text(
        this.theme.fg(
          "dim",
          "↑↓ navigate options • Tab/Shift+Tab switch fields • Enter confirm/submit • Esc cancel",
        ),
      ),
    );
    this.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));

    this.updateFocus();
  }

  private updateFocus(): void {
    for (let i = 0; i < this.fields.length; i++) {
      const input = this.inputs.get(i);
      const select = this.selects.get(i);
      if (input) {
        input.focused = this._focused && this.activeField === i;
      }
      if (select) {
        select.focused = this._focused && this.activeField === i;
      }
    }
  }

  handleInput(keyData: string): void {
    // Tab / Shift+Tab always switch between fields.
    if (matchesKey(keyData, Key.tab)) {
      this.activeField = (this.activeField + 1) % this.fields.length;
      this.updateWindowStart();
      this.rebuildVisibleFields();
      this.invalidate();
      return;
    }

    if (matchesKey(keyData, Key.shift("tab"))) {
      this.activeField =
        (this.activeField - 1 + this.fields.length) % this.fields.length;
      this.updateWindowStart();
      this.rebuildVisibleFields();
      this.invalidate();
      return;
    }

    // Escape cancels the form.
    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback(null);
      return;
    }

    // Route input to the active field.
    const field = this.fields[this.activeField];
    if (!field) return;

    if (field.type === "text") {
      const input = this.inputs.get(field.index);

      // Enter on a text field submits the form.
      if (matchesKey(keyData, Key.enter)) {
        this.onDoneCallback(this.getResult());
        return;
      }

      // Up/Down on text fields navigate between fields.
      if (matchesKey(keyData, Key.up)) {
        this.activeField =
          (this.activeField - 1 + this.fields.length) % this.fields.length;
        this.updateWindowStart();
        this.rebuildVisibleFields();
        this.invalidate();
        return;
      }
      if (matchesKey(keyData, Key.down)) {
        this.activeField = (this.activeField + 1) % this.fields.length;
        this.updateWindowStart();
        this.rebuildVisibleFields();
        this.invalidate();
        return;
      }

      // Only allow [a-z.] for identifier fields
      if (
        (field.field === "groupId" || field.field === "artifactId") &&
        !this.isAllowedIdChar(keyData)
      ) {
        return;
      }

      input?.handleInput(keyData);
    } else if (field.type === "select") {
      // Pass everything to SelectList — it handles ↑↓ for navigation
      // and Enter via onSelect (which advances to next field or submits).
      const select = this.selects.get(field.index);
      select?.handleInput(keyData);
    }

    this.invalidate();
  }

  /** Returns true if keyData is allowed to reach a groupId / artifactId Input. */
  private isAllowedIdChar(keyData: string): boolean {
    // Pass through non-printable keys (charCode < 32) and DEL/backspace (charCode 127).
    if (keyData.length !== 1 || keyData.charCodeAt(0) < 32 || keyData.charCodeAt(0) === 127) {
      return true;
    }
    // Only lowercase a-z and dot are permitted
    return /^[a-z.]$/.test(keyData);
  }

  private getResult(): SpringInitResult {
    const result: any = {};

    for (const field of this.fields) {
      if (field.type === "text") {
        const input = this.inputs.get(field.index);
        result[field.field] = input?.getValue() || "";
      } else if (field.type === "select") {
        const select = this.selects.get(field.index);
        result[field.field] =
          select?.getSelectedItem()?.value || field.defaultValue || "";
      }
    }

    // Derive hidden fields from visible ones
    const groupId = result.groupId || "com.example";
    const artifactId = result.artifactId || "demo";
    result.name = artifactId;
    result.description = "Demo project for Spring Boot";
    result.packageName = `${groupId}.${artifactId}`;

    return result as SpringInitResult;
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuildVisibleFields();
  }
}

export default function springInitializer(pi: ExtensionAPI) {
  // No tools needed - just a command

  pi.registerCommand("spring-init", {
    description:
      "Open Spring Initializer form to configure a new Spring Boot project",
    handler: async (args, ctx) => {
      const metadata = loadMetadata(ctx.cwd);

      if (!ctx.hasUI) {
        console.log("Error: No UI available for Spring Initializer");
        return;
      }

      if (!metadata) {
        ctx.ui.notify(
          "Error: metadata.json not found in current directory",
          "error",
        );
        return;
      }

      const result = await ctx.ui.custom<SpringInitResult | null>(
        (tui, theme, keybindings, done) => {
          let form: SpringInitForm | null = null;

          let wrapperFocused = true;

          const rootComponent = {
            get focused() {
              return wrapperFocused;
            },
            set focused(value: boolean) {
              wrapperFocused = value;
              if (form) {
                form.focused = value;
              }
            },
            render(width: number) {
              return form ? form.render(width) : [];
            },
            invalidate() {
              form?.invalidate();
            },
            handleInput(data: string) {
              form?.handleInput?.(data);
              tui.requestRender();
            },
          };

          form = new SpringInitForm(
            theme,
            metadata,
            (result: SpringInitResult | null) => {
              done(result);
            },
          );

          return rootComponent;
        },
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "80%", anchor: "center" },
        },
      );

      if (result) {
        const json = JSON.stringify(result, null, 2);
        console.log(json);
        ctx.ui.notify("Spring project configured!", "success");
      }
    },
  });
}
