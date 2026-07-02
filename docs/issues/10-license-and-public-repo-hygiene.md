<!-- labels: meta, gsd, license, docs -->

# License (MIT) + public-repo hygiene

## User story

As a stranger landing on the Sidetrack repo, I can see at a glance
what it is, install it in 30 seconds, and confirm it's MIT-licensed
with no telemetry.

## Phase goal

Establish the public-repo baseline required by the brief from the
first commit onward.

## Scope

- Add an `MIT`-licensed `LICENSE` file at the repo root, matching the
  copyright style used in the brief (or a generic "Sidetrack
  contributors" line — pick one and document the choice in the
  Phase 0 report).
- Confirm there are no secrets, no API keys, no telemetry endpoints,
  and no build artifacts in the repo.
- Confirm `.gitignore` covers `dist/`, `node_modules/`, and any
  editor/OS junk.
- Confirm the `README.md` (or a `README.md` to-be-written in
  Phase 5) does not yet promise features we haven't shipped (per
  the brief: "the history will be read by strangers as a demo").
- Add a top-level `CODE_OF_CONDUCT.md` only if required by the
  showcase standard we set for ourselves; otherwise skip and
  document the decision.

## Out of scope

- Phase-specific docs. Those land in their own phase reports.
- The landing-page README, which is a Phase 5 deliverable. Until
  Phase 5, `README.md` is a small "what is this" stub.

## Acceptance criteria

- [x] `LICENSE` exists at the repo root and is the MIT license text. **Verified**: `LICENSE` at repo root begins with "MIT License" and contains the standard MIT text. Copyright line: `Copyright (c) 2024-2026 Sidetrack contributors` (rationale documented in `docs/reports/phase-0.md` → "Public-repo hygiene → LICENSE copyright style").
- [x] `.gitignore` covers `dist/`, `node_modules/`, `.DS_Store`, `*.log`, common editor swapfiles. **Verified**: `.gitignore` lines 2, 9, 17, 21 cover `node_modules/`, `.DS_Store`, `*.swp` / `*.swo`, `*.log`. `dist/` on line 9. Bonus: `.env*`, `*.pem`, `*.key`, `secrets.*`, `id_*` are also ignored as defense in depth.
- [x] `git log --stat` shows no committed `dist/`, `node_modules/`, or any file matching common secret patterns. **Verified**: `git log --all --diff-filter=A --name-only -- 'dist/' 'node_modules/' '*.pem' '*.key' 'id_rsa*' 'secrets.*' '.env*'` returns no rows. Repo is clean.
- [x] No outbound network calls in the runtime code. **Verified**: `grep -rE "fetch\(|XMLHttpRequest|axios|navigator\.send|http\.get|https?://|wss?://" src/` returns no hits. Runtime is `src/background/*` + `src/sidepanel/*` + `src/shared/*`. Confirmed in Phase 5 self-review (AC #7).

## Dependencies

- None. This is a first-commit concern.

## Definition of done

A reviewer can read the first ten commits of the repo and see a clean
public-showcase baseline.
