# Pi Extensions

A collection of [pi](https://github.com/earendil-works/pi-coding-agent) extensions that add interactive TUI overlays and productivity tools to your AI coding sessions.

## Extensions

| Extension | Command | Description |
|-----------|---------|-------------|
| [Form](docs/form-extension.md) | `/form <file.json>` | Render any interactive form from a JSON definition file |
| [Spring Initializr](docs/spring-initializr-extension.md) | `/spring-init` | Scaffold a full Spring Boot project with live metadata, dependency picker, and ZIP extraction |

---

## Quick Start

### Installation

This package follows the standard pi package layout. Add it to your pi configuration or install it as a local package:

```bash
npm install
```

The `package.json` declares both extensions under the `pi.extensions` key, so pi will auto-discover them from the `./extensions` directory.

---

## Form Extension

The **Form** extension lets you (or the LLM) display a fully interactive, scrollable form inside pi's TUI overlay — driven entirely by a plain JSON file. No code changes are needed to add a new form; just drop a `.json` file and point the command at it.

**Trigger it yourself:**
```
/form spring-initializr-form.json
```

**Or let the LLM trigger it:**
```
form { "formFile": "spring-initializr-form.json" }
```

→ [Full documentation](docs/form-extension.md)

---

## Spring Initializr Extension

The **Spring Initializr** extension is a complete, guided workflow for bootstrapping a new Spring Boot project directly from within pi. It fetches live project metadata from `https://start.spring.io`, walks you through a 4-screen wizard (project config → dependency picker → confirmation → extraction location), downloads the generated ZIP, and extracts it — all without leaving your terminal.

**Trigger it:**
```
/spring-init
```

→ [Full documentation](docs/spring-initializr-extension.md)

---

## Project Structure

```
extensions/
├── extensions/
│   ├── form.ts                   # Generic form extension
│   └── spring-initializer.ts     # Spring Initializr extension
├── docs/
│   ├── form-extension.md         # Form extension documentation
│   └── spring-initializr-extension.md  # Spring Initializr documentation
├── spring-initializr-form.json   # Example form definition for Spring Initializr
├── metadata.json                 # Offline fallback metadata from start.spring.io
├── package.json
└── README.md
```

---

## Requirements

| Peer dependency | Purpose |
|----------------|---------|
| `@earendil-works/pi-coding-agent` | Extension API, `BorderedLoader`, `DynamicBorder` |
| `@earendil-works/pi-tui` | TUI primitives (`Container`, `Input`, `SelectList`, `Text`, `Key`, …) |
| `@earendil-works/pi-ai` | AI integration layer |
| `typebox` | Runtime schema validation for tool parameters |

---

## License

See repository for license details.
