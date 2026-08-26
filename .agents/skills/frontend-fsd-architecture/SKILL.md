---
name: frontend-fsd-architecture
description: Apply and review Overseer's frontend FSD-lite architecture whenever work creates, moves, splits, imports, or refactors code under src/client. Use for client pages, dialogs, API modules, routes, shared UI, dependency boundaries, and frontend architecture reviews; do not use for backend-only work or visual-only edits that do not change module ownership. Overseer FSD, frontend architecture, src/client, app pages shared, page slice, public API, import boundary
---

# Frontend FSD Architecture

Keep Overseer's `src/client` ownership, dependency direction, and public APIs consistent while preserving product behavior.

## Skill boundary

This skill owns client module placement, slice boundaries, imports, public APIs, and structural verification.

It does not own UI hierarchy or styling rules, backend architecture, product scope, API behavior, or permission to add speculative abstractions. Follow `DESIGN.md` for UI decisions and preserve `src/shared` as the server-client transport contract source.

## Required project context

Before changing client structure or imports, read [references/project-rules.md](references/project-rules.md). Also inspect the target slice, its `index.ts`, callers, tests, and `docs/decisions/0006-client-fsd-lite.md`.

## Rules

1. Use only `app`, `pages`, and `shared` under `src/client` unless the user explicitly approves another FSD layer.
2. Dependencies flow `app → pages → shared`. Never import upward.
3. Page slices do not import other page slices.
4. Cross-boundary imports use the target `index.ts` public API and `@/` alias. Slice-internal imports use explicit relative paths.
5. `@contracts/*` is the only exception: it references the external `src/shared` transport-contract boundary.
6. Export only current consumers' required symbols. Do not use wildcard barrels.
7. Do not statically and dynamically import the same slice public API. Keep lazy-only internals private and use relative imports inside the slice.
8. Structural refactors preserve URLs, API payloads, operations, startup redirects, lazy-loading behavior, and Tauri boundaries.

## Workflow

1. Map the changed code to an owner using the placement table in the project reference.
2. Inspect consumers before moving or exposing a symbol.
3. Prefer the existing slice. Add a shared module only for business-neutral code with multiple real consumers.
4. Update the narrow public API; keep internal modules private.
5. Make the smallest behavior-preserving move. Do not mix product changes or CSS redesign into an architecture refactor.
6. Run the boundary test, affected tests, typecheck, and a production build. For a repository-wide move, run `pnpm check` and inspect build warnings.

## Stop conditions

Stop and request direction before:

- adding `features`, `entities`, `widgets`, or another layer;
- moving or renaming `src/shared` transport contracts;
- introducing page-to-page imports or a compatibility barrel;
- changing route, API, persistence, operation, or runtime behavior to make a move easier.

## Completion evidence

Report the chosen owner, moved public API, preserved behavior, boundary-test result, focused/full checks, and any remaining legacy ownership.
