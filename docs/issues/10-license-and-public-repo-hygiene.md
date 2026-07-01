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

- [ ] `LICENSE` exists at the repo root and is the MIT license text.
- [ ] `.gitignore` covers `dist/`, `node_modules/`, `.DS_Store`,
      `*.log`, common editor swapfiles.
- [ ] `git log --stat` shows no committed `dist/`, `node_modules/`,
      or any file matching common secret patterns
      (`*.pem`, `*.key`, `id_rsa`, `secrets.*`, `*.env`).
- [ ] No outbound network calls in the runtime code
      (`grep -R "fetch(" src/` returns no hits except ones we add
      deliberately in later phases and document).

## Dependencies

- None. This is a first-commit concern.

## Definition of done

A reviewer can read the first ten commits of the repo and see a clean
public-showcase baseline.
