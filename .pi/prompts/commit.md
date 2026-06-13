---
description: Craft and execute a git commit following the Conventional Commits specification
---

Craft and execute a git commit following the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Step 1 — Understand the current state

Run the following to see what has changed:

```bash
git status
git diff
git diff --staged
```

If nothing is staged, stage all relevant changes:

```bash
git add -A
```

## Step 2 — Analyse the changes

Read the diff carefully and determine:

- **What** changed (feature, bug fix, refactor, docs update, etc.)
- **Where** it changed (which module, package, or area of the codebase)
- **Why** it changed (if context is available)
- Whether any **breaking changes** are introduced

## Step 3 — Choose the commit type

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

Lowercase is strongly preferred.

## Step 4 — Determine the scope (optional)

A scope identifies the section of the codebase affected:

- Surrounded by parentheses: `fix(parser):`
- Must be a noun matching a recognisable module, package, or directory name
- Omit when the change is truly cross-cutting

## Step 5 — Flag breaking changes

**Option A — `!` suffix** (preferred for visibility):

```
feat(api)!: remove deprecated endpoints
```

**Option B — `BREAKING CHANGE` footer** (when extra explanation is needed):

```
BREAKING CHANGE: The /v1/users endpoint has been removed. Migrate to /v2/users.
```

Both may be combined. `BREAKING-CHANGE` is a valid synonym in footers.

## Step 6 — Compose the commit message

```
<type>[optional scope][optional !]: <description>
[blank line]
[optional body]
[blank line]
[optional footer(s)]
```

Rules:
- Description is a short imperative-mood summary (max ~72 chars), no trailing period
- Body (optional): separated by one blank line, explains *what* and *why*
- Footers (optional): `Token: value` or `Token #value`; token spaces replaced with `-`; `BREAKING CHANGE` must be uppercase

## Step 7 — Confirm, then commit

Show the full proposed commit message and ask for confirmation before running:

```bash
git commit -F /tmp/commit_msg.txt
```

## Step 8 — Verify

```bash
git log --oneline -1
```

Show the resulting log line so the user can verify the message looks correct.
