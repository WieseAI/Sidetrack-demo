# Sidetrack — Issue Backlog

> This directory is the GSD issue backlog. It is the **source of truth** for
> what work the project is decomposed into. Each file is a single
> ready-to-import GitHub issue.

## How this maps to GitHub

The WieseOS worker cannot create issues on github.com directly (no `gh` CLI
in the container, no GitHub remote on this repo, and the outbound HTTP
allowlist is empty — see [R-07 in the risk register](../gsd/02-risks.md)).
So issues are committed as Markdown files in this directory and can be
imported to GitHub with a one-shot operator loop:

```bash
# From the repo root, after pushing to GitHub:
for f in docs/issues/[0-9]*.md; do
  title=$(awk '/^# /{sub(/^# /,""); print; exit}' "$f")
  gh issue create --title "$title" --body-file "$f" --label "gsd"
done
```

(That loop is illustrative; the operator can adjust labels, milestones,
and project assignment at import time.)

The `body` of every issue is the entire file. The `title` is the first `# `
heading of the file. Labels are suggested at the top of each file under a
`<!-- labels: ... -->` HTML comment, which `gh issue create` will ignore
unless the operator uses a more elaborate script.

## Index

| # | Title | Phase | Depends on |
| - | ----- | ----- | ---------- |
| [00](00-phase-0-research-and-foundation.md) | Phase 0 — Research & foundation | 0 | — |
| [01](01-phase-1-data-layer-and-kanban.md) | Phase 1 — Data layer & kanban core | 1 | 00 |
| [02](02-phase-2-time-tracking.md) | Phase 2 — Time tracking | 2 | 01 |
| [03](03-phase-3-idle-protection.md) | Phase 3 — Idle protection & notifications | 3 | 02 |
| [04](04-phase-4-capture-and-reports.md) | Phase 4 — Capture & reports | 4 | 02 |
| [05](05-phase-5-polish-and-release.md) | Phase 5 — Polish & release quality | 5 | 01,02,03,04 |
| [10](10-license-and-public-repo-hygiene.md) | License (MIT) + public-repo hygiene | cross-cutting | — |
| [11](11-accessibility-and-keyboard.md) | Accessibility & keyboard pass | cross-cutting | 05 |

Numbering: `00–05` are the brief's phases. `10+` are cross-cutting issues
that any phase may pull in. New issues get the next free two-digit number
in their band.
