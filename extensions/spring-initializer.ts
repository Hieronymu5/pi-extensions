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
  BorderedLoader,
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
import * as zlib from "node:zlib";

// ─────────────────────────────────────────────────────────────────────────────
// Metadata loading
// Primary:  GET https://start.spring.io  (Accept: application/json)
// Fallback: metadata.json in the current working directory
// ─────────────────────────────────────────────────────────────────────────────

const SPRING_INITIALIZR_URL = "https://start.spring.io";
const FETCH_TIMEOUT_MS = 10_000;

/** Resolved once and cached for the lifetime of the session. */
let metadataCache: any = null;

async function loadMetadata(cwd: string): Promise<any> {
  if (metadataCache !== null) return metadataCache;

  // ── 1. Try the live Spring Initializr endpoint ───────────────────────────
  try {
    const res = await fetch(SPRING_INITIALIZR_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      metadataCache = await res.json();
      return metadataCache;
    }
    console.error(
      `start.spring.io returned ${res.status} ${res.statusText} — falling back to metadata.json`,
    );
  } catch (e) {
    console.error(
      "Failed to fetch metadata from start.spring.io — falling back to metadata.json:",
      e,
    );
  }

  // ── 2. Fall back to the local metadata.json file ─────────────────────────
  const metadataPath = path.join(cwd, "metadata.json");
  try {
    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath, "utf-8");
      metadataCache = JSON.parse(content);
      return metadataCache;
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
  private readonly onDoneCallback: (selectedIds: string[] | null) => void;
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
    onDone: (selectedIds: string[] | null) => void,
    initialSelectedIds?: string[],
  ) {
    super();
    this.theme = theme;
    this.onDoneCallback = onDone;
    this.allCompatibleDeps = getCompatibleDependencies(meta, bootVersion);
    this.filteredDeps = [...this.allCompatibleDeps];
    this.searchInput = new Input();
    this.searchInput.setValue("");
    // Pre-populate selected IDs from a previous edit (only compatible ones)
    if (initialSelectedIds) {
      for (const id of initialSelectedIds) {
        if (this.allCompatibleDeps.some((d) => d.id === id)) {
          this.selectedIds.add(id);
        }
      }
    }
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
          "↑↓ navigate • Space toggle • Enter confirm • Esc cancel",
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
    // Enter → confirm selection
    if (matchesKey(keyData, Key.enter)) {
      this.onDoneCallback([...this.selectedIds]);
      return;
    }

    // Escape → cancel the entire initializer
    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback(null);
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

    // Space → toggle the highlighted dependency
    if (matchesKey(keyData, Key.space)) {
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
    initialValues?: Partial<Omit<SpringInitResult, "dependencies">>,
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

    // Override field defaults with values from a previous edit if provided
    if (initialValues) {
      for (const field of this.fields) {
        const override = (initialValues as Record<string, string>)[field.field];
        if (override !== undefined) {
          field.defaultValue = override;
        }
      }
    }

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
          this.onDoneCallback(this.getResult());
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
      const isActive = field.index === this.activeField;
      const fieldLabel = `${field.index + 1}. ${field.label}:`;
      this.addChild(
        new Text(
          isActive
            ? this.theme.fg("accent", this.theme.bold(fieldLabel))
            : this.theme.fg("text", fieldLabel),
        ),
      );

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
          "↑↓ navigate options • Tab next field • Shift+Tab prev field • Enter submit • Esc cancel",
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
        this.onDoneCallback(this.getResult());
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
// Download URL builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the starter.zip download URL from the metadata _links entry that
 * corresponds to the selected project type, then appends all form values as
 * query parameters.  The URI template suffix `{&…}` is stripped first.
 */
/**
 * Converts a Spring Initializr metadata version ID into the Maven-compatible
 * version string required by the download URL so that the generated pom.xml
 * resolves correctly from Maven Central / Spring repos.
 *
 *   4.0.6.RELEASE       → 4.0.6          (.RELEASE stripped)
 *   4.0.7.BUILD-SNAPSHOT → 4.0.7-SNAPSHOT  (BUILD- stripped, dot → hyphen)
 *   4.1.0.RC1           → 4.1.0-RC1       (dot → hyphen before qualifier)
 *   4.1.0.M2            → 4.1.0-M2        (dot → hyphen before qualifier)
 *
 * The full ID (e.g. "4.0.6.RELEASE") is still used for versionRange filtering
 * — only the URL bootVersion parameter uses this cleaned form.
 */
function cleanBootVersion(version: string): string {
  if (version.endsWith(".RELEASE")) {
    return version.slice(0, -".RELEASE".length);
  }
  if (version.endsWith(".BUILD-SNAPSHOT")) {
    return version.slice(0, -".BUILD-SNAPSHOT".length) + "-SNAPSHOT";
  }
  // RC1, RC2, M1, M2, …  — replace the last dot before the qualifier with a hyphen
  return version.replace(/\.((?:RC|M)\d+)$/, "-$1");
}

function buildDownloadUrl(meta: any, result: SpringInitResult): string {
  const linkHref: string =
    meta?._links?.[result.type]?.href ??
    `https://start.spring.io/starter.zip?type=${result.type}`;

  // Strip the RFC-6570 template part at the end, e.g. "{&dependencies,…}"
  const baseUrl = linkHref.replace(/\{[^}]*\}$/, "");

  // Build individual key=value pairs; dependency IDs are comma-separated
  // without percent-encoding the comma (the API accepts either form).
  const pairs: string[] = [
    `language=${encodeURIComponent(result.language)}`,
    `bootVersion=${encodeURIComponent(cleanBootVersion(result.bootVersion))}`,
    `groupId=${encodeURIComponent(result.groupId)}`,
    `artifactId=${encodeURIComponent(result.artifactId)}`,
    `name=${encodeURIComponent(result.name)}`,
    `description=${encodeURIComponent(result.description)}`,
    `packageName=${encodeURIComponent(result.packageName)}`,
    `packaging=${encodeURIComponent(result.packaging)}`,
    `javaVersion=${encodeURIComponent(result.javaVersion)}`,
  ];

  if (result.dependencies.length > 0) {
    pairs.push(
      `dependencies=${result.dependencies.map(encodeURIComponent).join(",")}`,
    );
  }

  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${pairs.join("&")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP extractor (pure Node.js, no external dependencies)
//
// Spring Initializr ZIPs always use data descriptors (flag bit 3), so the
// compressed/uncompressed sizes in the local file headers are zero.  We
// therefore read all sizes from the Central Directory at the end of the
// archive, then seek back to the local file header to find the data offset.
// ─────────────────────────────────────────────────────────────────────────────

interface ZipEntry {
  filename: string;
  compression: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  unixMode: number; // upper 16 bits of external file attributes
}

function parseZipCentralDirectory(buf: Buffer): ZipEntry[] {
  // Scan backwards for the End of Central Directory signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: EOCD not found");

  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`Invalid ZIP: bad central-directory signature at ${pos}`);
    }
    const compression = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const filenameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttr = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const filename = buf
      .subarray(pos + 46, pos + 46 + filenameLen)
      .toString("utf-8");
    const unixMode = (externalAttr >>> 16) & 0xffff;

    entries.push({
      filename,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      unixMode,
    });
    pos += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Extracts a ZIP buffer into `targetDir`, creating subdirectories and
 * preserving Unix execute bits (needed for mvnw / gradlew).
 */
function extractZip(zipBuffer: Buffer, targetDir: string): void {
  const entries = parseZipCentralDirectory(zipBuffer);

  for (const entry of entries) {
    // Sanitise the path: strip leading slashes and reject ".." components
    const parts = entry.filename
      .split("/")
      .filter((p) => p !== "" && p !== "..");
    if (parts.length === 0) continue;

    const fullPath = path.join(targetDir, ...parts);

    if (entry.filename.endsWith("/")) {
      // Directory entry — just ensure it exists
      fs.mkdirSync(fullPath, { recursive: true });
      continue;
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Locate file data via the local file header
    const lfh = entry.localHeaderOffset;
    const lfhFilenameLen = zipBuffer.readUInt16LE(lfh + 26);
    const lfhExtraLen = zipBuffer.readUInt16LE(lfh + 28);
    const dataOffset = lfh + 30 + lfhFilenameLen + lfhExtraLen;

    const compressed = zipBuffer.subarray(
      dataOffset,
      dataOffset + entry.compressedSize,
    );

    let fileData: Buffer;
    if (entry.compression === 0) {
      fileData = Buffer.from(compressed); // stored
    } else if (entry.compression === 8) {
      fileData = zlib.inflateRawSync(compressed); // deflate
    } else {
      throw new Error(
        `Unsupported compression method ${entry.compression} for "${entry.filename}"`,
      );
    }

    fs.writeFileSync(fullPath, fileData);

    // Restore Unix permissions (important for mvnw / gradlew)
    if (entry.unixMode !== 0) {
      try {
        fs.chmodSync(fullPath, entry.unixMode & 0o777);
      } catch {
        // chmod may not be supported on all platforms — non-fatal
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmationComponent
// ─────────────────────────────────────────────────────────────────────────────

class ConfirmationComponent extends Container {
  /** Satisfies the focused-property contract; no input widgets need IME. */
  focused = false;

  private readonly onConfirm: (action: "confirm" | "cancel" | "edit" | "deps") => void;

  constructor(
    theme: Theme,
    result: SpringInitResult,
    meta: any,
    onConfirm: (action: "confirm" | "cancel" | "edit" | "deps") => void,
  ) {
    super();
    this.onConfirm = onConfirm;
    this.build(theme, result, meta);
  }

  private build(theme: Theme, result: SpringInitResult, meta: any): void {
    const t = theme;

    // ── Look up human-readable display names from metadata ──
    const label = (values: any[], id: string) =>
      values?.find((v: any) => v.id === id)?.name ?? id;

    const typeName = label(meta?.type?.values ?? [], result.type);
    const languageName = label(meta?.language?.values ?? [], result.language);
    const bootName = label(
      meta?.bootVersion?.values ?? [],
      result.bootVersion,
    );
    const packagingName = label(
      meta?.packaging?.values ?? [],
      result.packaging,
    );
    const javaName = label(
      meta?.javaVersion?.values ?? [],
      result.javaVersion,
    );

    const depNames = result.dependencies.map((id) => {
      for (const cat of meta?.dependencies?.values ?? []) {
        const dep = (cat.values ?? []).find((d: any) => d.id === id);
        if (dep) return dep.name as string;
      }
      return id;
    });

    // ── Render ──
    const LW = 16; // label column width
    const row = (lbl: string, val: string) =>
      new Text(
        `  ${t.fg("muted", lbl.padEnd(LW))}  ${t.fg("text", val)}`,
        0,
        0,
      );

    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));
    this.addChild(
      new Text(t.fg("accent", t.bold("Confirm Project Generation")), 1, 0),
    );
    this.addChild(new Text(""));

    this.addChild(row("Project Type", typeName));
    this.addChild(row("Language", languageName));
    this.addChild(row("Spring Boot", bootName));
    this.addChild(row("Group ID", result.groupId));
    this.addChild(row("Artifact ID", result.artifactId));
    this.addChild(row("Packaging", packagingName));
    this.addChild(row("Java Version", javaName));

    this.addChild(new Text(""));

    if (depNames.length === 0) {
      this.addChild(
        new Text(t.fg("dim", "  No dependencies selected"), 0, 0),
      );
    } else {
      this.addChild(
        new Text(
          t.fg("muted", `  Dependencies (${depNames.length}):`),
          0,
          0,
        ),
      );
      for (const name of depNames) {
        this.addChild(
          new Text(t.fg("text", `    ● ${name}`), 0, 0),
        );
      }
    }

    this.addChild(new Text(""));
    this.addChild(
      new Text(
        t.fg("dim", "  Enter/Y generate   E edit settings   D dependencies   Esc/N cancel"),
        0,
        0,
      ),
    );
    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    if (matchesKey(keyData, Key.enter) || keyData === "y" || keyData === "Y") {
      this.onConfirm("confirm");
    } else if (keyData === "e" || keyData === "E") {
      this.onConfirm("edit");
    } else if (keyData === "d" || keyData === "D") {
      this.onConfirm("deps");
    } else if (
      matchesKey(keyData, Key.escape) ||
      keyData === "n" ||
      keyData === "N"
    ) {
      this.onConfirm("cancel");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExtractionLocationComponent
// ─────────────────────────────────────────────────────────────────────────────

class ExtractionLocationComponent extends Container implements Focusable {
  private readonly theme: Theme;
  private readonly selectList: SelectList;
  private readonly onChooseCallback: (useProjectFolder: boolean | null) => void;

  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.selectList.focused = value;
  }

  constructor(
    theme: Theme,
    artifactId: string,
    onChoose: (useProjectFolder: boolean | null) => void,
  ) {
    super();
    this.theme = theme;
    this.onChooseCallback = onChoose;

    this.selectList = new SelectList(
      [
        {
          value: "project",
          label: "New project folder",
          description: `./${artifactId}/`,
        },
        {
          value: "current",
          label: "Current folder",
          description: "./",
        },
      ],
      2,
      {
        selectedPrefix: (s) => theme.fg("accent", s),
        selectedText: (s) => theme.fg("accent", s),
        description: (s) => theme.fg("muted", s),
        scrollInfo: (s) => theme.fg("dim", s),
        noMatch: (s) => theme.fg("warning", s),
      },
    );

    this.selectList.onSelect = () => {
      const val = this.selectList.getSelectedItem()?.value;
      onChoose(val === "project");
    };

    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    const t = this.theme;

    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));
    this.addChild(
      new Text(t.fg("accent", t.bold("Extraction Location")), 1, 0),
    );
    this.addChild(
      new Text(
        t.fg("muted", "Where should the project files be extracted?"),
        1,
        0,
      ),
    );
    this.addChild(new Text(""));
    this.addChild(this.selectList);
    this.addChild(new Text(""));
    this.addChild(
      new Text(
        t.fg("dim", "↑↓ navigate • Enter confirm • Esc cancel"),
        1,
        0,
      ),
    );
    this.addChild(new DynamicBorder((s: string) => t.fg("accent", s)));

    this.selectList.focused = this._focused;
  }

  handleInput(keyData: string): void {
    if (matchesKey(keyData, Key.escape)) {
      this.onChooseCallback(null);
      return;
    }
    this.selectList.handleInput(keyData);
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
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
// Arg parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the slash-command argument string and returns field overrides and a
 * list of dependency IDs to pre-select.
 *
 * Token recognition rules (case-insensitive):
 *  • java / kotlin / groovy              → language
 *  • maven                               → type = maven-project
 *  • gradle                              → type = gradle-project
 *  • plain integer (e.g. 17, 21, 11, 8) → javaVersion (matched against
 *                                          known values in metadata)
 *  • anything else                       → dependency ID (exact, then fuzzy)
 */
function parseSpringInitArgs(
  argsStr: string,
  meta: any,
): {
  overrides: Partial<Omit<SpringInitResult, "dependencies">>;
  depIds: string[];
} {
  const tokens = (argsStr ?? "").trim().split(/\s+/).filter(Boolean);
  const overrides: Partial<Omit<SpringInitResult, "dependencies">> = {};
  const depIds: string[] = [];

  if (tokens.length === 0) return { overrides, depIds };

  const validLanguages = new Set<string>(
    (meta?.language?.values ?? []).map((v: any) => (v.id as string).toLowerCase()),
  );
  const validJavaVersions: string[] = (meta?.javaVersion?.values ?? []).map(
    (v: any) => v.id as string,
  );

  // Use the metadata default boot version for dep compatibility filtering.
  const defaultBootVersion: string = meta?.bootVersion?.default ?? "";
  const allDeps = getCompatibleDependencies(meta, defaultBootVersion);

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // Language
    if (validLanguages.has(lower)) {
      overrides.language = lower;
      continue;
    }

    // Build tool
    if (lower === "maven") {
      overrides.type = "maven-project";
      continue;
    }
    if (lower === "gradle") {
      overrides.type = "gradle-project";
      continue;
    }

    // Java version — plain integer token ("17", "21", "11", "8", …)
    if (/^\d+$/.test(token)) {
      const match = validJavaVersions.find((v) => v === token);
      if (match) {
        overrides.javaVersion = match;
        continue;
      }
    }

    // Dependency — exact ID match first, then fuzzy
    const exactDep = allDeps.find((d) => d.id.toLowerCase() === lower);
    if (exactDep) {
      if (!depIds.includes(exactDep.id)) depIds.push(exactDep.id);
      continue;
    }
    const fuzzy = fuzzySearchDeps(lower, allDeps);
    if (fuzzy.length > 0 && fuzzy[0] && !depIds.includes(fuzzy[0].id)) {
      depIds.push(fuzzy[0].id);
    }
  }

  return { overrides, depIds };
}

/**
 * Builds a complete SpringInitResult from metadata defaults, with the parsed
 * overrides and pre-selected dependency IDs applied on top.
 */
function buildDefaultResult(
  meta: any,
  overrides: Partial<Omit<SpringInitResult, "dependencies">>,
  depIds: string[],
): SpringInitResult {
  const groupId = overrides.groupId ?? "com.example";
  const artifactId = overrides.artifactId ?? "demo";

  return {
    type:
      overrides.type ??
      (meta?.type?.default as string | undefined) ??
      "maven-project",
    language:
      overrides.language ??
      (meta?.language?.default as string | undefined) ??
      "java",
    bootVersion:
      overrides.bootVersion ??
      (meta?.bootVersion?.default as string | undefined) ??
      "",
    groupId,
    artifactId,
    name: artifactId,
    description: "Demo project for Spring Boot",
    packageName: `${groupId}.${artifactId}`,
    packaging:
      overrides.packaging ??
      (meta?.packaging?.default as string | undefined) ??
      "jar",
    javaVersion:
      overrides.javaVersion ??
      (meta?.javaVersion?.default as string | undefined) ??
      "17",
    dependencies: depIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension registration
// ─────────────────────────────────────────────────────────────────────────────

export default function springInitializer(pi: ExtensionAPI) {
  pi.registerCommand("spring-init", {
    description:
      "Open Spring Initializer form to configure a new Spring Boot project. " +
      "Optional args override defaults — e.g. '/spring-init maven 17 web' sets " +
      "build tool=Maven, JDK=17 and pre-selects the Spring Web dependency. " +
      "Recognises: language (java/kotlin/groovy), build tool (maven/gradle), " +
      "JDK version (integer e.g. 17), and dependency IDs/names (e.g. web, actuator).",
    handler: async (args, ctx) => {
      const meta = await loadMetadata(ctx.cwd);

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

      // ── Parse args → build initial result with defaults + overrides ─────────
      const { overrides, depIds } = parseSpringInitArgs(args ?? "", meta);
      let currentResult: SpringInitResult = buildDefaultResult(
        meta,
        overrides,
        depIds,
      );

      // ── Main loop: Confirmation first, then optional Edit ─────────────────
      let finalResult!: SpringInitResult;

      while (true) {
        // ── Step 1: Confirmation (shown first with defaults pre-populated) ────
        const confirmAction = await ctx.ui.custom<"confirm" | "cancel" | "edit" | "deps">(
          (tui, theme, _kb, done) => {
            const comp = new ConfirmationComponent(
              theme,
              currentResult,
              meta,
              done,
            );
            return {
              focused: false,
              render: (w: number) => comp.render(w),
              invalidate: () => comp.invalidate(),
              handleInput: (data: string) => {
                comp.handleInput(data);
                tui.requestRender();
              },
            };
          },
          {
            overlay: true,
            overlayOptions: { width: "60%", maxHeight: "80%", anchor: "center" },
          },
        );

        if (confirmAction === "cancel") {
          ctx.ui.notify("Project generation cancelled.", "warning");
          return;
        }

        if (confirmAction === "confirm") {
          finalResult = currentResult;
          break;
        }

        // ── Step 2a (deps path): Dependency picker launched directly from summary ──
        if (confirmAction === "deps") {
          const selectedDeps = await ctx.ui.custom<string[] | null>(
            (tui, theme, _keybindings, done) =>
              makeRootWrapper(tui, () =>
                new DependencyPickerComponent(
                  theme,
                  meta,
                  currentResult.bootVersion,
                  (ids) => done(ids),
                  currentResult.dependencies,
                ),
              ),
            {
              overlay: true,
              overlayOptions: { width: "70%", maxHeight: "85%", anchor: "center" },
            },
          );
          // Esc in the picker returns null — go back to summary without changes.
          if (selectedDeps !== null) {
            currentResult = { ...currentResult, dependencies: selectedDeps };
          }
          continue;
        }

        // ── Step 2 (edit path): Project configuration form ───────────────────
        // Spread currentResult so the form receives the latest field values.
        const { dependencies: _prevDeps, ...formInitialValues } = currentResult;
        const formResult = await ctx.ui.custom<
          Omit<SpringInitResult, "dependencies"> | null
        >(
          (tui, theme, _keybindings, done) =>
            makeRootWrapper(tui, () =>
              new SpringInitForm(
                theme,
                meta,
                (result) => done(result),
                formInitialValues,
              ),
            ),
          {
            overlay: true,
            overlayOptions: { width: "60%", maxHeight: "80%", anchor: "center" },
          },
        );

        if (!formResult) {
          // User cancelled the edit form — loop back to confirmation unchanged.
          continue;
        }

        // ── Step 3 (edit path): Dependency picker ────────────────────────────
        // The bootVersion value from the form is the FULL version ID (e.g.
        // "4.0.6.RELEASE"), which is exactly what versionRange filtering needs.
        const selectedDeps = await ctx.ui.custom<string[] | null>(
          (tui, theme, _keybindings, done) =>
            makeRootWrapper(tui, () =>
              new DependencyPickerComponent(
                theme,
                meta,
                formResult.bootVersion,
                (ids) => done(ids),
                currentResult.dependencies,
              ),
            ),
          {
            overlay: true,
            overlayOptions: { width: "70%", maxHeight: "85%", anchor: "center" },
          },
        );

        // Esc in the dependency picker goes back to summary without changes.
        if (selectedDeps === null) {
          continue;
        }

        // Update current result and loop back to show confirmation.
        currentResult = { ...formResult, dependencies: selectedDeps };
      }

      // ── Step 4: Extraction location ────────────────────────────────────────
      const useProjectFolder = await ctx.ui.custom<boolean | null>(
        (tui, theme, _kb, done) =>
          makeRootWrapper(tui, () =>
            new ExtractionLocationComponent(
              theme,
              finalResult.artifactId,
              (choice) => done(choice),
            ),
          ),
        {
          overlay: true,
          overlayOptions: {
            width: "55%",
            maxHeight: "35%",
            anchor: "center",
          },
        },
      );

      if (useProjectFolder === null) {
        ctx.ui.notify("Project generation cancelled.", "warning");
        return;
      }

      // ── Step 5: Download ───────────────────────────────────────────────────
      const downloadUrl = buildDownloadUrl(meta, finalResult);

      type DownloadResult =
        | { ok: true; buffer: ArrayBuffer }
        | { ok: false; error: string }
        | null;

      const dlResult = await ctx.ui.custom<DownloadResult>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            `Downloading ${finalResult.artifactId}.zip…`,
          );
          loader.onAbort = () => done(null);

          fetch(downloadUrl, { signal: loader.signal })
            .then(async (res) => {
              if (!res.ok) {
                done({
                  ok: false,
                  error: `HTTP ${res.status}: ${res.statusText}`,
                });
                return;
              }
              const buffer = await res.arrayBuffer();
              done({ ok: true, buffer });
            })
            .catch((err: unknown) => {
              if ((err as { name?: string }).name !== "AbortError") {
                done({ ok: false, error: String(err) });
              }
            });

          return loader;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "50%",
            maxHeight: "20%",
            anchor: "center",
          },
        },
      );

      // ── Step 6: Extract or report error ───────────────────────────────────
      if (dlResult === null) {
        ctx.ui.notify("Download cancelled.", "warning");
        return;
      }

      if (!dlResult.ok) {
        ctx.ui.notify(
          `Download failed \u2014 ${dlResult.error}`,
          "error",
        );
        return;
      }

      try {
        const zipBuffer = Buffer.from(dlResult.buffer);
        const targetDir = useProjectFolder
          ? path.join(ctx.cwd, finalResult.artifactId)
          : ctx.cwd;

        if (useProjectFolder) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        extractZip(zipBuffer, targetDir);

        const depCount = finalResult.dependencies.length;
        ctx.ui.notify(
          `✓ Project extracted to ${targetDir}` +
            (depCount > 0
              ? ` (${depCount} dependenc${depCount === 1 ? "y" : "ies"})`
              : ""),
          "success",
        );
      } catch (err: unknown) {
        ctx.ui.notify(
          `Extraction failed \u2014 ${String(err)}`,
          "error",
        );
      }
    },
  });
}
