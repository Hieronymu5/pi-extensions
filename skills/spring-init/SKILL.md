---
name: spring-init
description: Generate a new Spring Boot project via Spring Initializr. Defaults to Java 25, Maven, and always includes Spring Web, SpringDoc OpenAPI, and Spring Modulith when they are compatible with the chosen Boot version. Use when the user asks to create, scaffold, or initialise a Spring Boot project.
---

# Spring Initializr Skill

Scaffolds a new Spring Boot project by querying the live Spring Initializr API,
selecting compatible dependencies, and extracting the generated ZIP on disk.

## Defaults (apply when the user does not specify otherwise)

| Parameter | Default |
|-----------|---------|
| Project type | `maven-project` |
| Language | `java` |
| Java version | `25` (falls back to the highest available if 25 is not listed) |
| Spring Boot version | Latest stable release from the metadata |
| Group ID | `com.example` |
| Artifact ID | `demo` |
| Packaging | `jar` |
| Dependencies | `web`, `springdoc-openapi`, `modulith` — **included automatically** when compatible with the selected Boot version |

The mandatory dependencies (`web`, `springdoc-openapi`, `modulith`) are **always added**
to the dependency set. If any of them is incompatible with the chosen Spring Boot version
its version range, the script warns and skips it rather than failing.

---

## Workflow

Follow these steps every time this skill is invoked.

### 1. Collect parameters

Ask the user for the following information. Accept whatever they have provided
already; only ask about fields they have not mentioned.

- **Group ID** — reverse-domain package prefix (e.g. `com.acme`)
- **Artifact ID** — project/module name used for the directory and Maven artifact
- **Description** *(optional)* — short project description
- **Spring Boot version** *(optional)* — leave blank to use the latest stable
- **Java version** *(optional)* — leave blank to use Java 25 (or highest available)
- **Packaging** *(optional)* — `jar` (default) or `war`
- **Extra dependencies** *(optional)* — any additional Spring Initializr dependency
  IDs beyond the mandatory set (e.g. `data-jpa`, `actuator`, `validation`)
- **Output directory** *(optional)* — where to extract the project;
  defaults to `./<artifactId>` inside the current working directory

If the user has not specified a project type or language, use the defaults above
without asking — Maven and Java are the assumed baseline.

### 2. Check what is available (optional but recommended)

To show the user which dependencies are available for a given Boot version, run:

```bash
node <skill_dir>/scripts/generate.js --list-deps --boot-version <version>
```

This prints all compatible dependencies with `★` markers next to the mandatory
default ones. Use this if the user asks "what packages can I add?" or if you need
to validate a dependency ID before passing it.

### 3. Generate the project

Run the generator script with the collected parameters:

```bash
node <skill_dir>/scripts/generate.js \
  --group-id      <groupId>       \
  --artifact-id   <artifactId>    \
  --java-version  <javaVersion>   \
  --boot-version  <bootVersion>   \
  --packaging     <packaging>     \
  --language      <language>      \
  --type          <type>          \
  --dependencies  <extra,dep,ids> \
  --output-dir    <outputDir>
```

Replace `<skill_dir>` with the **absolute path** to this skill directory.
Omit any flag whose value is the default — the script resolves defaults
automatically from live Spring Initializr metadata.

**Example — minimal invocation** (all defaults):

```bash
node /path/to/skills/spring-init/scripts/generate.js
```

**Example — custom project**:

```bash
node /path/to/skills/spring-init/scripts/generate.js \
  --group-id     com.acme            \
  --artifact-id  order-service       \
  --description  "Order management"  \
  --java-version 21                  \
  --dependencies data-jpa,actuator
```

### 4. Verify the output

After the script exits successfully, confirm the directory structure looks correct:

```bash
ls -la <outputDir>
```

Show the user the extracted path and the `next steps` printed by the script
(e.g. `./mvnw spring-boot:run`).

---

## Script reference

The generator is at `scripts/generate.js` (relative to this skill directory).
It requires **Node.js** (no npm packages; only built-in modules are used).

### All flags

| Flag | Description |
|------|-------------|
| `--group-id <id>` | Maven group ID |
| `--artifact-id <id>` | Maven artifact ID / directory name |
| `--description <text>` | Project description |
| `--java-version <ver>` | Java version (e.g. `17`, `21`, `25`) |
| `--boot-version <ver>` | Full Spring Boot version ID, e.g. `4.0.6.RELEASE` |
| `--packaging <pkg>` | `jar` or `war` |
| `--language <lang>` | `java`, `kotlin`, or `groovy` |
| `--type <type>` | `maven-project`, `gradle-project`, `gradle-project-kotlin`, etc. |
| `--dependencies <ids>` | Comma-separated **extra** dependency IDs (mandatory ones always added) |
| `--output-dir <dir>` | Absolute or relative extraction directory |
| `--list-deps` | Print all dependencies compatible with `--boot-version` and exit |
| `--metadata-file <path>` | Path to a local `metadata.json` fallback if start.spring.io is unreachable |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (missing metadata, download failure, extraction failure) |

---

## Resolving the skill directory path

Pi sets no automatic `$SKILL_DIR` variable, so resolve the path at runtime.
The simplest approach: use the `read` tool to inspect this `SKILL.md` file and
derive the absolute directory from its path, then substitute it for `<skill_dir>`
in the commands above.

Alternatively, `find` can locate the script:

```bash
find ~/.agents ~/.pi ~/.claude -name "generate.js" -path "*/spring-init/*" 2>/dev/null | head -1
```

---

## Dependency version-range notes

The three mandatory dependencies carry version-range restrictions in the
Spring Initializr metadata:

| Dependency | ID | Typical range |
|------------|----|---------------|
| Spring Web | `web` | always available |
| SpringDoc OpenAPI | `springdoc-openapi` | `[3.5.0.RELEASE,4.1.0.M1)` |
| Spring Modulith | `modulith` | `[3.5.0.RELEASE,4.2.0.M1)` |

The script evaluates these ranges automatically and silently drops any dependency
that is out of range for the chosen Boot version, printing a warning instead.
The exact ranges change as new Spring Boot releases are published; the script
always reads the live metadata to stay accurate.
