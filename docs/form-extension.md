# Form Extension

> **Source:** `extensions/form.ts`

The Form extension provides a fully interactive, scrollable form overlay for pi, driven entirely by a JSON definition file. It exposes both a slash command for manual use and an LLM-callable tool, making it equally useful when you trigger it yourself or when the AI needs to collect structured input from you during a task.

---

## Table of Contents

- [Usage](#usage)
  - [Slash Command](#slash-command)
  - [LLM Tool](#llm-tool)
- [Form Definition JSON](#form-definition-json)
  - [Top-level Properties](#top-level-properties)
  - [Fields](#fields)
    - [Text Field](#text-field)
    - [Select Field](#select-field)
  - [Computed Fields](#computed-fields)
  - [Submit Configuration](#submit-configuration)
- [Complete Example](#complete-example)
- [Keyboard Controls](#keyboard-controls)
- [Scrolling and Pagination](#scrolling-and-pagination)
- [Validation](#validation)
- [Return Value](#return-value)
- [File Resolution](#file-resolution)

---

## Usage

### Slash Command

```
/form <path-to-form.json>
```

Displays the form as a centred overlay. When the user submits, the collected values are shown in a success notification. Cancelling with **Esc** shows a warning notification.

**Examples:**
```
/form ./forms/spring-initializr-form.json
/form ~/projects/my-form.json
/form ./forms/deploy-config.json
```

### LLM Tool

The tool is registered under the name `form` and can be invoked by the AI during a conversation:

```json
{
  "name": "form",
  "parameters": {
    "formFile": "spring-initializr-form.json"
  }
}
```

The tool returns a JSON object containing all field values, or an error message if the file was not found or the UI is unavailable. The LLM receives the result as a text content block.

**Tool description exposed to the LLM:**
> Display an interactive form defined by a JSON file and wait for the user to fill it in. The form file path is resolved relative to the current working directory. Returns all field values as a JSON object.

---

## Form Definition JSON

A form definition file is a plain JSON object. The root schema is described below.

### Top-level Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `title` | `string` | ✅ | — | Heading shown at the top of the form overlay. Rendered in accent colour, bold. |
| `description` | `string` | ❌ | — | Optional subtitle shown below the title in muted colour. |
| `overlayWidth` | `string` | ❌ | `"60%"` | Width of the overlay. Accepts percentage strings (`"70%"`) or raw character counts (`"80"`). |
| `overlayMaxHeight` | `string` | ❌ | `"80%"` | Maximum height of the overlay. Same format as `overlayWidth`. |
| `fieldsPerPage` | `number` | ❌ | `4` | Number of fields visible at one time before the list scrolls. |
| `fields` | `FormFieldDef[]` | ✅ | — | Ordered array of field definitions. See [Fields](#fields). |
| `computed` | `ComputedField[]` | ❌ | — | Fields derived from user input after submission. See [Computed Fields](#computed-fields). |
| `submit` | `SubmitConfig` | ❌ | — | Controls how the result is presented. See [Submit Configuration](#submit-configuration). |

---

### Fields

Each element of the `fields` array defines one interactive widget in the form.

#### Common Field Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier; used as the key in the result object. |
| `label` | `string` | ✅ | Human-readable label displayed above the widget. |
| `type` | `"text" \| "select"` | ✅ | Widget type. |
| `default` | `string` | ❌ | Pre-filled value (text fields) or pre-selected option value (select fields). |

#### Text Field

```json
{
  "id": "groupId",
  "label": "Group ID",
  "type": "text",
  "default": "com.example",
  "validation": "identifier",
  "hint": "e.g. com.example  (lowercase letters and dots only)"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `hint` | `string` | Short hint shown inline to the right of the label. Rendered in dim colour. |
| `validation` | `"identifier"` | When set to `"identifier"`, only lowercase letters `[a-z]` and dots `.` are accepted. All other printable characters are silently dropped. Useful for Maven `groupId` / `artifactId` fields. |

#### Select Field

```json
{
  "id": "language",
  "label": "Language",
  "type": "select",
  "default": "java",
  "options": [
    { "value": "java",   "label": "Java" },
    { "value": "kotlin", "label": "Kotlin" },
    { "value": "groovy", "label": "Groovy", "description": "Dynamic JVM language" }
  ]
}
```

The `options` array is **required** for `type: "select"`.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `options` | `FormOption[]` | ✅ | List of choices rendered in a `SelectList` widget. |
| `options[].value` | `string` | ✅ | Machine value written to the result. |
| `options[].label` | `string` | ✅ | Display label shown in the list. |
| `options[].description` | `string` | ❌ | Optional secondary line shown below the label in muted colour. |

Up to 5 options are visible at a time inside the select list; additional options scroll.

Confirming a selection (pressing **Enter** or navigating away) automatically advances the focus to the next field, or submits the form if the selection is on the last field.

---

### Computed Fields

Computed fields are **not shown** to the user; they are derived from other field values at submit time and merged into the result object. Exactly one of `from`, `value`, or `template` must be set on each entry.

```json
"computed": [
  {
    "field": "packageName",
    "template": "${groupId}.${artifactId}",
    "comment": "Java package name derived from group + artifact"
  },
  {
    "field": "name",
    "from": "artifactId"
  },
  {
    "field": "description",
    "value": "Demo project for Spring Boot"
  }
]
```

| Property | Type | Description |
|----------|------|-------------|
| `field` | `string` | The result key to write the computed value into. |
| `from` | `string` | Copy the value of another field by its `id`. |
| `value` | `string` | Hard-coded literal string. |
| `template` | `string` | String with `${fieldId}` placeholders that are replaced with the corresponding field values at submit time. |
| `comment` | `string` | Documentation-only; ignored at runtime. |

---

### Submit Configuration

The optional `submit` block controls what happens with the collected values after the user confirms the form.

```json
"submit": {
  "baseUrl": "https://start.spring.io/starter.zip",
  "urlParams": ["type", "language", "bootVersion", "groupId", "artifactId"],
  "comment": "Build a query-string URL from the selected values"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `baseUrl` | `string` | When provided, the command handler builds a query-string URL from all collected values and prints it. |
| `urlParams` | `string[]` | Ordered list of field IDs to include as query parameters. If omitted, all non-computed fields are appended in definition order. |
| `comment` | `string` | Documentation-only; ignored at runtime. |

---

## Complete Example

The file `spring-initializr-form.json` at the repository root is a ready-to-use example that demonstrates all major features: select lists, text fields with identifier validation, hints, and default values.

```json
{
  "title": "Spring Initializr",
  "description": "Configure a new Spring Boot project",
  "overlayWidth": "70%",
  "overlayMaxHeight": "80%",
  "fieldsPerPage": 4,
  "fields": [
    {
      "id": "type",
      "label": "Project Type",
      "type": "select",
      "default": "gradle-project",
      "options": [
        { "value": "gradle-project",        "label": "Gradle - Groovy" },
        { "value": "gradle-project-kotlin", "label": "Gradle - Kotlin" },
        { "value": "maven-project",         "label": "Maven" }
      ]
    },
    {
      "id": "groupId",
      "label": "Group",
      "type": "text",
      "default": "com.example",
      "validation": "identifier",
      "hint": "e.g. com.example  (lowercase letters and dots only)"
    },
    {
      "id": "artifactId",
      "label": "Artifact",
      "type": "text",
      "default": "demo",
      "validation": "identifier",
      "hint": "e.g. demo  (lowercase letters and dots only)"
    }
  ]
}
```

Run it with:
```
/form spring-initializr-form.json
```

---

## Keyboard Controls

| Key | Action |
|-----|--------|
| **Tab** | Move focus to the next field (wraps around). |
| **Shift+Tab** | Move focus to the previous field (wraps around). |
| **↑ / ↓** | On a **text** field: move to the previous/next field. On a **select** field: scroll through options. |
| **Enter** | On a **text** field: confirm and advance to the next field, or submit if on the last field. On a **select** field: confirm the highlighted choice and advance (or submit). |
| **Esc** | Cancel the form. Returns `null`; the command shows a "Form cancelled" warning notification. |

---

## Scrolling and Pagination

When the form has more fields than `fieldsPerPage` (default `4`), the visible window scrolls to keep the active field in view:

- A **↑ N more fields above** indicator appears when fields are hidden above the viewport.
- A **↓ N more fields below** indicator appears when fields are hidden below the viewport.
- The status line at the bottom always shows **Field X of Y**.

The window scrolls automatically as you navigate with **Tab**, **Shift+Tab**, or the arrow keys.

---

## Validation

The only built-in validation rule is `"identifier"`, applicable to `type: "text"` fields. When active:

- Only lowercase ASCII letters `a–z` and the dot character `.` are accepted as input.
- All other printable characters (uppercase letters, digits, spaces, symbols) are silently dropped at the keystroke level — no error message is shown.
- Control characters and backspace/delete always pass through, so the user can still edit the field normally.

---

## Return Value

### Command (`/form`)

On success, a notification containing the JSON-serialised result is shown:

```
Spring Initializr: {
  "type": "gradle-project",
  "language": "java",
  "groupId": "com.example",
  "artifactId": "demo"
}
```

### LLM Tool (`form`)

The tool returns a standard pi tool result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"type\": \"gradle-project\",\n  \"language\": \"java\"\n}"
    }
  ],
  "details": {
    "formFile": "spring-initializr-form.json",
    "result": {
      "type": "gradle-project",
      "language": "java"
    }
  }
}
```

The `details.result` object is also used by the tool's `renderResult` renderer in the pi TUI:

- **Collapsed:** a compact `key=value, key=value` summary on a single line.
- **Expanded:** each key on its own line with the key in accent colour.

---

## File Resolution

The form definition file path is resolved in this order:

1. **Absolute path** — used as-is if it exists.
2. **Relative to `ctx.cwd`** — the working directory pi was started in.
3. **Relative to the extension directory** — one level up from where `form.ts` lives.

If the file is not found after all three attempts, an error is returned (or shown as a notification for the slash command).
