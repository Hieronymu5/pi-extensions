# Spring Initializr Extension

> **Source:** `extensions/spring-initializer.ts`

The Spring Initializr extension is a complete, guided project-scaffolding workflow built into pi's TUI. A single command walks you through a multi-screen wizard — project configuration, dependency picking, confirmation, and extraction location — then downloads the generated ZIP from `https://start.spring.io` and extracts it into your filesystem, all without leaving the terminal.

---

## Table of Contents

- [Usage](#usage)
- [Workflow Overview](#workflow-overview)
- [Step 1 — Project Configuration Form](#step-1--project-configuration-form)
- [Step 2 — Dependency Picker](#step-2--dependency-picker)
- [Step 3 — Confirmation Screen](#step-3--confirmation-screen)
- [Step 4 — Extraction Location](#step-4--extraction-location)
- [Step 5 — Download](#step-5--download)
- [Step 6 — ZIP Extraction](#step-6--zip-extraction)
- [Metadata Loading](#metadata-loading)
- [Spring Version Handling](#spring-version-handling)
  - [Version Parsing and Comparison](#version-parsing-and-comparison)
  - [Version Range Filtering](#version-range-filtering)
  - [Boot Version Cleaning for Maven](#boot-version-cleaning-for-maven)
- [Fuzzy Dependency Search](#fuzzy-dependency-search)
- [Download URL Construction](#download-url-construction)
- [ZIP Extraction Details](#zip-extraction-details)
- [Keyboard Controls](#keyboard-controls)

---

## Usage

```
/spring-init
```

No arguments are required. The command fetches live metadata from Spring Initializr and guides you through the full wizard.

---

## Workflow Overview

```
/spring-init
     │
     ▼
① Load metadata ──── live: https://start.spring.io
     │                fallback: ./metadata.json
     ▼
② Project config form  (type, language, boot version, group, artifact, packaging, java)
     │
     ▼
③ Dependency picker  (fuzzy search + version-range filtering)
     │
     ▼
④ Confirmation screen  (review all selections)
     │
     ▼
⑤ Extraction location  (new project folder  vs.  current folder)
     │
     ▼
⑥ Download  starter.zip  from start.spring.io
     │
     ▼
⑦ Extract ZIP  →  filesystem  (unix perms preserved)
```

---

## Step 1 — Project Configuration Form

A `SpringInitForm` overlay collects the seven core project settings. All option lists are populated directly from the live (or cached) Spring Initializr metadata, so they always reflect the currently supported versions and languages.

| # | Field | Type | Default |
|---|-------|------|---------|
| 1 | Project Type | Select | From metadata (`type.default`) |
| 2 | Language | Select | From metadata (`language.default`) |
| 3 | Spring Boot Version | Select | From metadata (`bootVersion.default`) |
| 4 | Group ID | Text | `com.example` |
| 5 | Artifact ID | Text | `demo` |
| 6 | Packaging | Select | From metadata (`packaging.default`) |
| 7 | Java Version | Select | From metadata (`javaVersion.default`) |

**Project Type** is filtered to only include entries whose `action` field equals `/starter.zip`, which are the downloadable starter project types (e.g. Gradle-Groovy, Gradle-Kotlin, Maven).

**Group ID** and **Artifact ID** text fields enforce identifier validation: only lowercase letters `a–z` and dots `.` are accepted as input.

Four fields are visible at a time; scrolling indicators (`↑ N more above` / `↓ N more below`) appear when the list overflows.

Two derived fields are automatically added to the result at submit time:
- `name` — copied from `artifactId`
- `packageName` — interpolated as `${groupId}.${artifactId}`
- `description` — set to `"Demo project for Spring Boot"`

---

## Step 2 — Dependency Picker

After the project form is submitted, a `DependencyPickerComponent` overlay displays the full Spring Initializr dependency catalogue, pre-filtered to only include dependencies compatible with the selected Spring Boot version.

### Features

- **Live search** — Type any text to fuzzy-search across dependency names, IDs, descriptions, and categories simultaneously.
- **Version-range filtering** — Dependencies whose `versionRange` is incompatible with the selected Boot version are excluded before the picker opens. The header shows the compatible count.
- **Multi-select** — Toggle individual dependencies on/off with **Space** or **Enter**. Selected items are shown with a `[✓]` checkbox in green; the current highlight is shown in accent colour.
- **Scrolling list** — Up to 7 results are visible at once; `↑ N more above` / `↓ N more below` indicators appear when the filtered list overflows.
- **Detail line** — The highlighted dependency shows its category and description in a compact secondary line below the item.
- **Selection summary** — The bottom of the overlay always shows the count and names of currently selected dependencies (up to 4 names, then `+N more`).

Press **Esc** to confirm your selection (including zero dependencies) and advance to the next step.

---

## Step 3 — Confirmation Screen

A `ConfirmationComponent` overlay shows a summary of all selections before any network request is made.

The summary displays human-readable display names (looked up from metadata) for all enum-style fields, plus a bulleted list of selected dependency names. If no dependencies were selected, a "No dependencies selected" message is shown instead.

| Key | Action |
|-----|--------|
| **Enter** or **Y** | Confirm and proceed to extraction location |
| **Esc** or **N** | Cancel — no download is performed |

---

## Step 4 — Extraction Location

An `ExtractionLocationComponent` overlay asks where the project files should land:

| Option | Path |
|--------|------|
| **New project folder** | `./<artifactId>/` (created if it does not exist) |
| **Current folder** | `./` (files extracted directly into `ctx.cwd`) |

Press **Enter** on the highlighted option to confirm, or **Esc** to cancel.

---

## Step 5 — Download

A `BorderedLoader` overlay is shown while the `starter.zip` is downloaded from the URL constructed by the extension (see [Download URL Construction](#download-url-construction)).

- The loader displays a spinner and the filename being downloaded.
- Pressing the abort key cancels the in-flight request via `AbortSignal`.
- HTTP errors (non-2xx status codes) surface as an error notification.

---

## Step 6 — ZIP Extraction

Once the ZIP buffer is in memory it is extracted entirely in Node.js with no external dependencies (see [ZIP Extraction Details](#zip-extraction-details)).

On success, a notification reports where the project was extracted and how many dependencies were included:

```
✓ Project extracted to /Users/you/projects/demo (5 dependencies)
```

---

## Metadata Loading

Metadata is fetched once per session and cached in a module-level variable for all subsequent invocations.

**Resolution order:**

1. **Live endpoint** — `GET https://start.spring.io` with `Accept: application/json`. A 10-second timeout is applied via `AbortSignal.timeout`. On success the response JSON is used as-is.
2. **Local fallback** — `metadata.json` in `ctx.cwd`. This file ships with the repository and mirrors the structure returned by the live endpoint, providing an offline experience or a stable snapshot for testing.

If neither source is available the command exits with an error notification.

---

## Spring Version Handling

### Version Parsing and Comparison

Spring Initializr uses a four-part version scheme:

```
MAJOR.MINOR.PATCH.QUALIFIER
```

Supported qualifiers and their ordering (ascending):

| Qualifier | Example | Numeric order |
|-----------|---------|---------------|
| `M{n}` | `4.1.0.M2` | `n` (1, 2, …) — lowest |
| `RC{n}` | `4.1.0.RC1` | `1000 + n` |
| `RELEASE` | `4.0.6.RELEASE` | `2000` |
| `BUILD-SNAPSHOT` / `SNAPSHOT` | `4.0.7.BUILD-SNAPSHOT` | `3000` — highest for same base version |

`BUILD-SNAPSHOT` is treated as the ongoing development build *after* the released version, so `4.1.0.BUILD-SNAPSHOT > 4.1.0.RELEASE`.

### Version Range Filtering

Each dependency in the metadata may carry an optional `versionRange` string. The extension evaluates these ranges against the selected Boot version and excludes incompatible dependencies from the picker entirely.

Supported range formats:

| Format | Semantics |
|--------|-----------|
| `"4.0.0.RELEASE"` | `version >= 4.0.0.RELEASE` (simple lower bound) |
| `"[3.5.0.RELEASE,4.0.0.RELEASE)"` | `3.5.0 ≤ version < 4.0.0` |
| `"[3.5.0.RELEASE,4.0.0.RELEASE]"` | `3.5.0 ≤ version ≤ 4.0.0` |
| `"(3.5.0.RELEASE,4.0.0.RELEASE)"` | `3.5.0 < version < 4.0.0` |

The opening bracket `[` / `(` controls inclusivity of the lower bound; the closing bracket `]` / `)` controls inclusivity of the upper bound.

### Boot Version Cleaning for Maven

The full version ID (e.g. `4.0.6.RELEASE`) is used internally for version-range comparisons, but the download URL must use the Maven-compatible form that resolves from Maven Central and Spring repositories. The conversion rules are:

| Internal ID | URL parameter |
|------------|---------------|
| `4.0.6.RELEASE` | `4.0.6` (`.RELEASE` stripped) |
| `4.0.7.BUILD-SNAPSHOT` | `4.0.7-SNAPSHOT` (`BUILD-` stripped, dot → hyphen) |
| `4.1.0.RC1` | `4.1.0-RC1` (dot before qualifier → hyphen) |
| `4.1.0.M2` | `4.1.0-M2` (dot before qualifier → hyphen) |

---

## Fuzzy Dependency Search

The dependency picker's search box feeds into a fuzzy scoring function that ranks results by relevance. For each dependency, the query is scored against four fields with different weights:

| Field | Weight |
|-------|--------|
| `name` | 1.0× |
| `id` | 0.8× |
| `description` | 0.4× |
| `category` | 0.3× |

The per-field scoring algorithm:

1. **Exact match** → 1000 points
2. **Prefix match** → 800 points
3. **Substring match** → 600 points
4. **Fuzzy match** — all query characters must appear in order within the target. Consecutive matching characters earn a bonus (`+5` per additional consecutive character). The raw score is then scaled by `queryLength / targetLength` to prefer tighter (shorter) matches.
5. **No match** → 0 (the dependency is excluded from results)

The final score for a dependency is the maximum across all four fields. Results are sorted descending by score.

---

## Download URL Construction

The extension builds the `starter.zip` download URL from the `_links` section of the metadata, which contains per-project-type href templates such as:

```
https://start.spring.io/starter.zip{?type,language,bootVersion,...}
```

The RFC-6570 template suffix (`{?…}` or `{&…}`) is stripped, then query parameters are appended manually:

```
language=java
&bootVersion=4.0.6          ← cleaned form (see above)
&groupId=com.example
&artifactId=demo
&name=demo
&description=Demo+project+for+Spring+Boot
&packageName=com.example.demo
&packaging=jar
&javaVersion=17
&dependencies=web,data-jpa,lombok   ← comma-separated, each ID percent-encoded
```

If no `_links` entry matches the selected project type, a safe fallback URL (`https://start.spring.io/starter.zip?type=<type>`) is used.

---

## ZIP Extraction Details

The ZIP is extracted entirely in pure Node.js using the `zlib` built-in module — no `unzip` binary or third-party library is required.

**Why a custom parser?** Spring Initializr ZIPs use *data descriptors* (flag bit 3), which means the compressed and uncompressed sizes stored in the local file headers are zero. The extension therefore:

1. Scans backwards through the buffer to find the **End of Central Directory** record (`0x06054b50`).
2. Reads all entry metadata (sizes, offsets, file names, Unix modes) from the **Central Directory**.
3. For each entry, seeks to the **local file header** to calculate the exact data offset, then reads the compressed bytes using the size from the Central Directory.
4. Decompresses with `zlib.inflateRawSync` (method 8 = DEFLATE) or copies as-is (method 0 = stored).
5. Writes each file with `fs.writeFileSync`, creating parent directories as needed.
6. Restores Unix permissions (`chmod`) from the external file attributes — critical for `mvnw` and `gradlew` wrapper scripts to remain executable.

**Security:** Entry filenames are sanitised before extraction — leading slashes are stripped and `..` path components are filtered out to prevent path-traversal attacks.

---

## Keyboard Controls

### Project Configuration Form

| Key | Action |
|-----|--------|
| **Tab** | Move to the next field (wraps around) |
| **Shift+Tab** | Move to the previous field (wraps around) |
| **↑ / ↓** | On select fields: scroll options. On text fields: move between fields. |
| **Enter** | Advance to next field (or submit on last field) |
| **Esc** | Cancel the wizard |

### Dependency Picker

| Key | Action |
|-----|--------|
| **↑ / ↓** | Move highlight up/down the results list |
| **Space** or **Enter** | Toggle the highlighted dependency on/off |
| **Any other key** | Append to / edit the search query |
| **Backspace** | Delete last character from search query |
| **Esc** | Confirm selection (including zero dependencies) and proceed |

### Confirmation Screen

| Key | Action |
|-----|--------|
| **Enter** or **Y** | Confirm and proceed |
| **Esc** or **N** | Cancel |

### Extraction Location

| Key | Action |
|-----|--------|
| **↑ / ↓** | Navigate between options |
| **Enter** | Select the highlighted option |
| **Esc** | Cancel |
