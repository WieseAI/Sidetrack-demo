# Sidetrack — GSD Plan

> Derived from [`sidetrack-brief.md`](../../sidetrack-brief.md). This document is
> the GSD (Get Stuff Done) plan for Sidetrack. Issues that implement each phase
> live in [`docs/issues/`](../issues/). The brief is the source of truth for
> scope; this plan only sequences and decomposes it.

## How to read this plan

- **Phases** are the major blocks of work (0–5, matching the brief). Each phase
  has its own issue (`docs/issues/NN-*.md`) and a status.
- **Decisions** are the architectural / product decisions we have to make early.
  They are tracked separately in [`01-decisions.md`](01-decisions.md) so future
  agents don't re-litigate them.
- **Risks** are tracked in [`02-risks.md`](02-risks.md) and reviewed at the end
  of every phase.
- **Acceptance** is the brief's acceptance criteria verbatim, plus the per-phase
  pass/fail we run before moving on.

## Sequencing rationale

The brief orders phases 0 → 5, and we are not changing that order. The
dependency graph between phases is roughly:

```
Phase 0 (research + skeleton)
   └── Phase 1 (data + kanban)
         └── Phase 2 (timers)
               └── Phase 3 (idle protection)
                     └── Phase 4 (capture + reports)
                           └── Phase 5 (polish + release)
```

Phase 0 is special: its output is mostly decisions and a loadable skeleton,
not user-visible features. We cannot start Phase 1 without Phase 0's decisions,
and we cannot start Phase 2 without Phase 1's data model.

Phases 3 and 4 are largely independent of each other (both depend on Phase 2
but not on each other) and could be parallelized across two agent branches.
Phase 5 waits on everything.

## Status snapshot

| Phase | Title | Issue | Status |
| ----- | ----- | ----- | ------ |
| 0 | Research & foundation | [issue 00](../issues/00-phase-0-research-and-foundation.md) | open |
| 1 | Data layer & kanban core | [issue 01](../issues/01-phase-1-data-layer-and-kanban.md) | open |
| 2 | Time tracking | [issue 02](../issues/02-phase-2-time-tracking.md) | open |
| 3 | Idle protection & notifications | [issue 03](../issues/03-phase-3-idle-protection.md) | open |
| 4 | Capture & reports | [issue 04](../issues/04-phase-4-capture-and-reports.md) | open |
| 5 | Polish & release quality | [issue 05](../issues/05-phase-5-polish-and-release.md) | open |

Plus cross-cutting issues:

- [License (MIT) + public-repo hygiene](../issues/10-license-and-public-repo-hygiene.md)
- [Accessibility & keyboard pass](../issues/11-accessibility-and-keyboard.md)

## Definition of done for the whole project

We are done when every numbered acceptance criterion in `sidetrack-brief.md`
("Acceptance criteria (the ones I will personally test)") passes, the README is
a real landing page, and the extension is loadable unpacked in a clean Chrome
profile. The final self-review checklist is enforced by Phase 5.
