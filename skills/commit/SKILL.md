---
name: commit
description: Craft and execute git commits following the Conventional Commits specification. Use when you need to stage files, write a properly formatted commit message (feat, fix, docs, chore, etc.), handle breaking changes, and commit code changes.
---

# Conventional Commits Skill

Helps you compose and execute git commits that conform to the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Workflow

Follow these steps every time this skill is invoked:

### 1. Understand the Current State

Run the following to see what has changed:

```bash
git status
git diff
git diff --staged
```

If nothing is staged, ask the user which files to stage or stage all relevant files:

```bash
git add <files>   # specific files
git add -A        # all tracked + untracked changes
```

### 2. Analyse the Changes

Read the diff carefully and determine:

- **What** changed (feature, bug fix, refactor, docs update, etc.)
- **Where** it changed (which module, package, or area of the codebase)
- **Why** it changed (if context is available from the user's request)
- Whether any **breaking changes** are introduced

### 3. Choose the Commit Type

Select the single most appropriate type from the table below:

| Type       | When to use |
|------------|-------------|
| `feat`     | A new feature is added to the application or library |
| `fix`      | A bug fix for the application |
| `docs`     | Documentation-only changes |
| `style`    | Formatting, whitespace, missing semicolons — no logic change |
| `refactor` | Code restructure that neither fixes a bug nor adds a feature |
| `perf`     | A change that improves performance |
| `test`     | Adding or correcting tests |
| `build`    | Changes to the build system or external dependencies |
| `ci`       | Changes to CI/CD configuration or scripts |
| `chore`    | Maintenance tasks that don't modify src or test files |
| `revert`   | Reverts a previous commit |

Types are case-insensitive, but **lowercase is strongly preferred**.

### 4. Determine the Scope (Optional)

A scope identifies the section of the codebase affected. It:

- Is surrounded by parentheses: `fix(parser):`
- Must be a **noun** (e.g., `auth`, `api`, `parser`, `ui`, `config`)
- Should match a recognisable module, package, or directory name
- Is **omitted** when the change is truly cross-cutting

### 5. Flag Breaking Changes

A breaking change must be signalled in **one** (or both) of these ways:

**Option A — `!` in the type/scope prefix** (preferred for visibility):

```
feat(api)!: remove deprecated endpoints
```

**Option B — `BREAKING CHANGE` footer** (required when extra explanation is needed):

```
BREAKING CHANGE: The /v1/users endpoint has been removed. Migrate to /v2/users.
```

Both options may be combined. `BREAKING-CHANGE` is a valid synonym for `BREAKING CHANGE` in footers.

### 6. Compose the Commit Message

Follow this exact structure:

```
<type>[optional scope][optional !]: <description>
[blank line]
[optional body]
[blank line]
[optional footer(s)]
```

#### Rules

- **Header** (`type[(scope)][!]: description`)
  - The description MUST immediately follow the `": "` separator.
  - The description is a short, imperative-mood summary (max ~72 chars).
  - Do **not** end the description with a period.

- **Body** (optional)
  - Separated from the header by exactly **one blank line**.
  - Free-form paragraphs; explain *what* and *why*, not *how*.
  - Each paragraph is separated by a newline.

- **Footer(s)** (optional)
  - Separated from the body (or header, if no body) by exactly **one blank line**.
  - Format: `Token: value` or `Token #value`
  - Token whitespace MUST use `-` (e.g., `Reviewed-by`, `Closes`, `Co-authored-by`).
  - Exception: `BREAKING CHANGE` (with a space) is also a valid token and MUST be uppercase.
  - Footer parsing stops when the next valid `Token: ` or `Token #` pair is detected.

#### Examples

Minimal:
```
fix: correct off-by-one error in pagination
```

With scope:
```
feat(auth): add OAuth2 PKCE support
```

With body:
```
refactor(parser): simplify token stream handling

Replace the hand-rolled state machine with a table-driven approach.
This reduces cyclomatic complexity and makes adding new token types
straightforward.
```

With breaking change via `!` and footer:
```
feat(api)!: replace REST endpoints with GraphQL

Migrate all existing REST clients to the new GraphQL schema at /graphql.

BREAKING CHANGE: All /v1/* REST endpoints are removed. See migration guide
in docs/migration.md.
Reviewed-by: Alice <alice@example.com>
```

With issue reference footer:
```
fix(ui): prevent crash when modal closes before animation ends

Closes #482
```

### 7. Confirm and Commit

Before running `git commit`, **show the full proposed commit message** to the user and ask for confirmation (or ask if they want any changes).

Once confirmed, execute:

```bash
git commit -m "<header>" -m "<body paragraph>" -m "<footer(s)>"
```

For multi-line messages it is cleaner to write to a temp file and use `-F`:

```bash
git commit -F /tmp/commit_msg.txt
```

Or use the heredoc approach:

```bash
git commit -m $'<header>\n\n<body>\n\n<footer>'
```

### 8. Verify

After committing, confirm success:

```bash
git log --oneline -1
```

Show the user the resulting log line so they can verify the message looks correct.

---

## Quick Reference — Conventional Commits Grammar

```
commit        = header LF LF? body? LF LF? footer*
header        = type "(" scope ")" "!"? ": " description
              | type "!"? ": " description
type          = "feat" | "fix" | "docs" | "style" | "refactor"
              | "perf" | "test" | "build" | "ci" | "chore" | "revert" | <noun>
scope         = 1*( ALPHA / DIGIT / "-" / "_" / "." )
description   = 1*( not LF )
body          = *( paragraph LF )
footer        = token ( ": " / " #" ) value
token         = "BREAKING CHANGE" / "BREAKING-CHANGE" / word-token
word-token    = 1*( ALPHA / DIGIT / "-" )   ; whitespace replaced by "-"
```

## Important Constraints

- `feat` and `fix` have **fixed, mandatory meanings** — do not use them for other purposes.
- `BREAKING CHANGE` in a footer **MUST be uppercase**.
- The `: ` (colon + space) separator after the type/scope is **required**.
- One blank line between header → body and body → footers is **required** when those sections are present.
- Case-insensitivity applies to all type/scope tokens **except** `BREAKING CHANGE`.
