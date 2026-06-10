/**
 * Spring Initializer Extension
 *
 * Displays a form for configuring a Spring Boot project using the Spring Initializr API.
 * Use /spring-init to trigger it.
 *
 * Populates all dropdowns from metadata.json.
 * After the form, shows a dependency picker that fuzzy-searches the full
 * dependency catalogue and filters out entries whose versionRange does not
 * match the selected Spring Boot version.
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

// ─────────────────────────────────────────────────────────────────────────────
// Metadata loading
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Dependency types
// ─────────────────────────────────────────────────────────────────────────────

interface FlatDependency {
  id: string;
  name: string;
  description?: string;
  category: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring version comparison
//
// Version format: MAJOR.MINOR.PATCH.QUALIFIER
// Qualifier ordering (lowest → highest) for the same MAJOR.MINOR.PATCH:
//   M{n}  <  RC{n}  <  RELEASE  <  BUILD-SNAPSHOT
//
// BUILD-SNAPSHOT is treated as the ongoing dev build *after* the released
// version, so 4.1.0.BUILD-SNAPSHOT > 4.1.0.RELEASE.
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  qualOrder: number;
}

function parseSpringVersion(v: string): ParsedVersion {
  const parts = v.trim().split(".");
  const major = parseInt(parts[0] ?? "0", 10) || 0;
  const minor = parseInt(parts[1] ?? "0", 10) || 0;
  const patch = parseInt(parts[2] ?? "0", 10) || 0;
  const qualifier = parts.slice(3).join(".").toUpperCase();

  let qualOrder: number;
  if (qualifier === "" || qualifier === "RELEASE") {
    qualOrder = 2000;
  } else if (qualifier === "BUILD-SNAPSHOT" || qualifier === "SNAPSHOT") {
    qualOrder = 3000; // post-release dev build — highest for same version number
  } else if (qualifier.startsWith("M")) {
    qualOrder = parseInt(qualifier.slice(1), 10) || 1; // M1 = 1, M2 = 2 …
  } else if (qualifier.startsWith("RC")) {
    qualOrder = 1000 + (parseInt(qualifier.slice(2), 10) || 1); // RC1 = 1001 …
  } else {
    qualOrder = 2000; // unknown — treat as RELEASE
  }

  return { major, minor, patch, qualOrder };
}

function compareSpringVersions(a: string, b: string): number {
  const pa = parseSpringVersion(a);
  const pb = parseSpringVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  return pa.qualOrder - pb.qualOrder;
}

/**
 * Returns true when `version` satisfies the Spring Initializr versionRange.
 *
 * Supported formats:
 *   "4.0.0.RELEASE"              → version >= 4.0.0.RELEASE
 *   "[3.5.0.RELEASE,4.0.0.RELEASE)"  → 3.5.0 ≤ version < 4.0.0
 *   "[3.5.0.RELEASE,4.0.0.RELEASE]"  → 3.5.0 ≤ version ≤ 4.0.0
 *   "(3.5.0.RELEASE,4.0.0.RELEASE)"  → 3.5.0 < version < 4.0.0
 */
function isVersionInRange(version: string, range: string): boolean {
  const r = range.trim();

  // Simple minimum-version form (no leading bracket)
  if (!r.startsWith("[") && !r.startsWith("(")) {
    return compareSpringVersions(version, r) >= 0;
  }

  const inclusiveLower = r.startsWith("[");
  const inclusiveUpper = r.endsWith("]");
  const inner = r.slice(1, -1); // strip surrounding brackets
  const commaIdx = inner.indexOf(",");

  if (commaIdx === -1) {
    // Single version wrapped in brackets — treat as exact match
    return compareSpringVersions(version, inner.trim()) === 0;
  }

  const lower = inner.slice(0, commaIdx).trim();
  const upper = inner.slice(commaIdx + 1).trim();

  if (lower) {
    const cmp = compareSpringVersions(version, lower);
    if (inclusiveLower ? cmp < 0 : cmp <= 0) return false;
  }
  if (upper) {
    const cmp = compareSpringVersions(version, upper);
    if (inclusiveUpper ? cmp > 0 : cmp >= 0) return false;
  }

  return true;
}

/**
 * Flattens all dependency categories from metadata into a single array,
 * keeping only those whose versionRange (if set) is compatible with the
 * given full bootVersion ID (e.g. "4.0.6.RELEASE").
 */
function getCompatibleDependencies(
  meta: any,
  bootVersion: string,
): FlatDependency[] {
  const result: FlatDependency[] = [];
  if (!meta?.dependencies?.values) return result;

  for (const category of meta.dependencies.values) {
    for (const dep of category.values ?? []) {
      if (dep.versionRange && !isVersionInRange(bootVersion, dep.versionRange)) {
        continue; // incompatible with selected Boot version
      }
      result.push({
        id: dep.id,
        name: dep.name,
        description: dep.description,
        category: category.name,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scores how well `query` matches `target`.
 * Returns 0 when there is no match at all.
 */
function scoreMatch(query: string, target: string): number {
  if (target === query) return 1000;
  if (target.startsWith(query)) return 800;
  if (target.includes(query)) return 600;

  // Fuzzy: every character of query must appear in order within target
  let qi = 0;
  let consecutive = 0;
  let score = 0;
  let lastPos = -1;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      consecutive = lastPos === ti - 1 ? consecutive + 1 : 0;
      score += 10 + consecutive * 5; // bonus for consecutive chars
      lastPos = ti;
      qi++;
    }
  }

  if (qi < query.length) return 0; // not all chars matched
  // Prefer shorter targets (tighter matches)
  return (score * query.length) / target.length;
}

function fuzzySearchDeps(query: string, deps: FlatDependency[]): FlatDependency[] {
  if (!query.trim()) return deps;

  const q = query.toLowerCase().trim();

  return deps
    .map((dep) => ({
      dep,
      score: Math.max(
        scoreMatch(q, dep.name.toLowerCase()),
        scoreMatch(q, dep.id.toLowerCase()) * 0.8,
        dep.description ? scoreMatch(q, dep.description.toLowerCase()) * 0.4 : 0,
        scoreMatch(q, dep.category.toLowerCase()) * 0.3,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.dep);
}

// ─────────────────────────────────────────────────────────────────────────────
// DependencyPickerComponent
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DEPS_VISIBLE = 7;

class DependencyPickerComponent extends Container implements Focusable {
  private readonly theme: Theme;
  private readonly allCompatibleDeps: FlatDependency[];
  private readonly onDoneCallback: (selectedIds: string[]) => void;
  private readonly searchInput: Input;

  private _focused = false;
  private filteredDeps: FlatDependency[];
  private highlightedIndex = 0;
  private listWindowStart = 0;
  private readonly selectedIds = new Set<string>();

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    // Propagate to the embedded Input so the hardware cursor is positioned
    // correctly for IME input.
    this.searchInput.focused = value;
  }

  constructor(
    theme: Theme,
    meta: any,
    bootVersion: string,
    onDone: (selectedIds: string[]) => void,
  ) {
    super();
    this.theme = theme;
    this.onDoneCallback = onDone;
    this.allCompatibleDeps = getCompatibleDependencies(meta, bootVersion);
    this.filteredDeps = [...this.allCompatibleDeps];
    this.searchInput = new Input();
    this.searchInput.setValue("");
    this.rebuild();
  }

  // ── Window / scrolling ───────────────────────────────────────────────────

  private updateListWindow(): void {
    if (this.highlightedIndex < this.listWindowStart) {
      this.listWindowStart = this.highlightedIndex;
    } else if (this.highlightedIndex >= this.listWindowStart + MAX_DEPS_VISIBLE) {
      this.listWindowStart = this.highlightedIndex - MAX_DEPS_VISIBLE + 1;
    }
  }

  // ── Layout rebuild ───────────────────────────────────────────────────────

  private rebuild(): void {
    this.clear();
    const t = this.theme;
    const query = this.searchInput.getValue();

    // ── Header ──
    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));
    this.addChild(
      new Text(t.fg("accent", t.bold("Add Dependencies")), 1, 0),
    );
    this.addChild(
      new Text(
        t.fg(
          "muted",
          `${this.allCompatibleDeps.length} compatible with the selected Boot version`,
        ),
        1,
        0,
      ),
    );
    this.addChild(new Text(""));

    // ── Search input ──
    this.addChild(new Text(t.fg("text", "Search:"), 1, 0));
    this.addChild(this.searchInput);
    this.addChild(new Text(""));

    // ── Results list ──
    const total = this.filteredDeps.length;
    const resultLabel = query
      ? `Results (${total} of ${this.allCompatibleDeps.length}):`
      : `All dependencies (${total}):`;
    this.addChild(new Text(t.fg("text", resultLabel), 1, 0));

    if (total === 0) {
      this.addChild(
        new Text(t.fg("warning", "  No matching dependencies"), 0, 0),
      );
    } else {
      const visibleEnd = Math.min(this.listWindowStart + MAX_DEPS_VISIBLE, total);

      // "More above" indicator
      if (this.listWindowStart > 0) {
        this.addChild(
          new Text(
            t.fg("dim", `  ↑ ${this.listWindowStart} more above`),
            0,
            0,
          ),
        );
      }

      for (let i = this.listWindowStart; i < visibleEnd; i++) {
        const dep = this.filteredDeps[i]!;
        const isHighlighted = i === this.highlightedIndex;
        const isSelected = this.selectedIds.has(dep.id);
        const checkbox = isSelected ? "[✓]" : "[ ]";
        const pointer = isHighlighted ? "▶" : " ";
        const truncName =
          dep.name.length > 38 ? dep.name.slice(0, 37) + "…" : dep.name;
        const label = `${pointer} ${checkbox} ${truncName}`;

        let styledLabel: string;
        if (isHighlighted && isSelected) {
          styledLabel = t.fg("accent", t.bold(label));
        } else if (isHighlighted) {
          styledLabel = t.fg("accent", label);
        } else if (isSelected) {
          styledLabel = t.fg("success", label);
        } else {
          styledLabel = t.fg("text", label);
        }

        this.addChild(new Text(styledLabel, 0, 0));

        // Show category + description only for the highlighted item to keep
        // the list compact.
        if (isHighlighted) {
          const rawDesc = dep.description ?? "";
          const truncDesc =
            rawDesc.length > 52 ? rawDesc.slice(0, 51) + "…" : rawDesc;
          const descLine = `      ${dep.category}${truncDesc ? " · " + truncDesc : ""}`;
          this.addChild(new Text(t.fg("dim", descLine), 0, 0));
        }
      }

      // "More below" indicator
      const remaining = total - visibleEnd;
      if (remaining > 0) {
        this.addChild(
          new Text(t.fg("dim", `  ↓ ${remaining} more below`), 0, 0),
        );
      }
    }

    this.addChild(new Text(""));

    // ── Selected summary ──
    const selCount = this.selectedIds.size;
    if (selCount === 0) {
      this.addChild(
        new Text(t.fg("dim", "No dependencies selected yet"), 1, 0),
      );
    } else {
      const ids = [...this.selectedIds];
      const names = ids.map(
        (id) => this.allCompatibleDeps.find((d) => d.id === id)?.name ?? id,
      );
      const maxShow = 4;
      const displayed = names.slice(0, maxShow).join(", ");
      const extra = names.length - maxShow;
      const selText = extra > 0 ? `${displayed}, +${extra} more` : displayed;
      this.addChild(
        new Text(
          t.fg("success", t.bold(`Selected (${selCount}): `)) +
            t.fg("muted", selText),
          1,
          0,
        ),
      );
    }

    this.addChild(new Text(""));

    // ── Footer ──
    this.addChild(
      new Text(
        t.fg(
          "dim",
          "↑↓ navigate • Space/Enter toggle • Esc confirm selection",
        ),
        1,
        0,
      ),
    );
    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));

    // Re-apply focus to the embedded Input
    this.searchInput.focused = this._focused;
  }

  // ── Input routing ────────────────────────────────────────────────────────

  handleInput(keyData: string): void {
    // Escape → done, return current selection
    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback([...this.selectedIds]);
      return;
    }

    // ↑ → move highlight up
    if (matchesKey(keyData, Key.up)) {
      if (this.filteredDeps.length > 0 && this.highlightedIndex > 0) {
        this.highlightedIndex--;
        this.updateListWindow();
      }
      this.invalidate();
      return;
    }

    // ↓ → move highlight down
    if (matchesKey(keyData, Key.down)) {
      if (
        this.filteredDeps.length > 0 &&
        this.highlightedIndex < this.filteredDeps.length - 1
      ) {
        this.highlightedIndex++;
        this.updateListWindow();
      }
      this.invalidate();
      return;
    }

    // Space / Enter → toggle the highlighted dependency
    if (matchesKey(keyData, Key.space) || matchesKey(keyData, Key.enter)) {
      if (this.filteredDeps.length > 0) {
        const dep = this.filteredDeps[this.highlightedIndex];
        if (dep) {
          if (this.selectedIds.has(dep.id)) {
            this.selectedIds.delete(dep.id);
          } else {
            this.selectedIds.add(dep.id);
          }
        }
      }
      this.invalidate();
      return;
    }

    // Everything else → feed into the search Input, then re-filter
    this.searchInput.handleInput(keyData);
    const newQuery = this.searchInput.getValue();
    this.filteredDeps = fuzzySearchDeps(newQuery, this.allCompatibleDeps);
    this.highlightedIndex = 0;
    this.listWindowStart = 0;
    this.invalidate();
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main form types + SpringInitForm
// ─────────────────────────────────────────────────────────────────────────────

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
  dependencies: string[];
}

const FIELDS_PER_PAGE = 4;

class SpringInitForm extends Container implements Focusable {
  private fields: FormField[];
  private inputs: Map<number, Input>;
  private selects: Map<number, SelectList>;
  private onDoneCallback: (result: Omit<SpringInitResult, "dependencies"> | null) => void;
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
    onDone: (result: Omit<SpringInitResult, "dependencies"> | null) => void,
  ) {
    super();
    this.theme = theme;
    this.metadata = metadata;
    this.onDoneCallback = onDone;
    this.inputs = new Map();
    this.selects = new Map();

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

    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback(null);
      return;
    }

    const field = this.fields[this.activeField];
    if (!field) return;

    if (field.type === "text") {
      const input = this.inputs.get(field.index);

      if (matchesKey(keyData, Key.enter)) {
        if (this.activeField >= this.fields.length - 1) {
          this.onDoneCallback(this.getResult());
        } else {
          this.activeField++;
          this.updateWindowStart();
          this.rebuildVisibleFields();
          this.invalidate();
        }
        return;
      }

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

      if (
        (field.field === "groupId" || field.field === "artifactId") &&
        !this.isAllowedIdChar(keyData)
      ) {
        return;
      }

      input?.handleInput(keyData);
    } else if (field.type === "select") {
      const select = this.selects.get(field.index);
      select?.handleInput(keyData);
    }

    this.invalidate();
  }

  private isAllowedIdChar(keyData: string): boolean {
    if (
      keyData.length !== 1 ||
      keyData.charCodeAt(0) < 32 ||
      keyData.charCodeAt(0) === 127
    ) {
      return true;
    }
    return /^[a-z.]$/.test(keyData);
  }

  private getResult(): Omit<SpringInitResult, "dependencies"> {
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

    const groupId = result.groupId || "com.example";
    const artifactId = result.artifactId || "demo";
    result.name = artifactId;
    result.description = "Demo project for Spring Boot";
    result.packageName = `${groupId}.${artifactId}`;

    return result as Omit<SpringInitResult, "dependencies">;
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuildVisibleFields();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: run a TUI overlay and return the result
// ─────────────────────────────────────────────────────────────────────────────

function makeRootWrapper(
  tui: { requestRender(): void },
  createComponent: () => {
    focused: boolean;
    render(width: number): string[];
    invalidate(): void;
    handleInput(data: string): void;
  },
) {
  const component = createComponent();
  let wrapperFocused = true;

  return {
    get focused() {
      return wrapperFocused;
    },
    set focused(value: boolean) {
      wrapperFocused = value;
      component.focused = value;
    },
    render(width: number) {
      return component.render(width);
    },
    invalidate() {
      component.invalidate();
    },
    handleInput(data: string) {
      component.handleInput(data);
      tui.requestRender();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension registration
// ─────────────────────────────────────────────────────────────────────────────

export default function springInitializer(pi: ExtensionAPI) {
  pi.registerCommand("spring-init", {
    description:
      "Open Spring Initializer form to configure a new Spring Boot project",
    handler: async (args, ctx) => {
      const meta = loadMetadata(ctx.cwd);

      if (!ctx.hasUI) {
        console.log("Error: No UI available for Spring Initializer");
        return;
      }

      if (!meta) {
        ctx.ui.notify(
          "Error: metadata.json not found in current directory",
          "error",
        );
        return;
      }

      // ── Step 1: Project configuration form ────────────────────────────────
      const formResult = await ctx.ui.custom<
        Omit<SpringInitResult, "dependencies"> | null
      >(
        (tui, theme, _keybindings, done) =>
          makeRootWrapper(tui, () =>
            new SpringInitForm(
              theme,
              meta,
              (result) => done(result),
            ),
          ),
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "80%", anchor: "center" },
        },
      );

      if (!formResult) {
        ctx.ui.notify("Spring Initializer cancelled.", "warning");
        return;
      }

      // ── Step 2: Dependency picker ──────────────────────────────────────────
      // The bootVersion value from the form is the FULL version ID (e.g.
      // "4.0.6.RELEASE"), which is exactly what versionRange filtering needs.
      const selectedDeps = await ctx.ui.custom<string[]>(
        (tui, theme, _keybindings, done) =>
          makeRootWrapper(tui, () =>
            new DependencyPickerComponent(
              theme,
              meta,
              formResult.bootVersion,
              (ids) => done(ids),
            ),
          ),
        {
          overlay: true,
          overlayOptions: { width: "70%", maxHeight: "85%", anchor: "center" },
        },
      );

      // ── Combine and output ─────────────────────────────────────────────────
      const finalResult: SpringInitResult = {
        ...formResult,
        dependencies: selectedDeps,
      };

      const json = JSON.stringify(finalResult, null, 2);
      console.log(json);

      const depCount = finalResult.dependencies.length;
      ctx.ui.notify(
        `Spring project configured${
          depCount > 0
            ? ` with ${depCount} dependenc${depCount === 1 ? "y" : "ies"}`
            : " (no dependencies)"
        }!`,
        "success",
      );
    },
  });
}
