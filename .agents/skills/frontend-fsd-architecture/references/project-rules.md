# Overseer client architecture rules

## Source of truth

Apply rules in this order:

1. Current user request and repository `AGENTS.md`
2. `DESIGN.md` for UI and interaction decisions
3. `docs/decisions/0006-client-fsd-lite.md`
4. `tests/client-architecture.test.ts`
5. This reference and existing slice conventions

The architecture test detects invalid imports; it does not decide semantic ownership. Use the rules below before relying on the test.

## Current topology

```text
src/client/
  app/
    entrypoint/
    styles/
    ui/
  pages/
    compose/
    containers/
    images/
    instances/
    networks/
    operations/
    settings/
    startup/
    volumes/
  shared/
    api/
    lib/
    routes/
    ui/
```

`src/shared` is outside this topology. It owns transport types, validation, and input contracts shared with the server.

## Placement table

| Owner                   | Put here                                                                                           | Do not put here                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app`                   | entrypoint, application shell, global route composition, providers, global styles                  | reusable page content, page-specific forms, resource tables    |
| `pages/<slice>`         | route-ready list/detail screens, slice-specific dialogs, API coordination, presentation and models | another page's internals, generic controls, app-wide providers |
| `shared/api`            | API client mechanics and domain-neutral request errors                                             | endpoint-specific business actions                             |
| `shared/routes`         | global route patterns, matching, path builders                                                     | page UI or mutations                                           |
| `shared/lib/<focus>`    | small business-neutral libraries with a named focus                                                | generic `utils`, product policy, one-page helpers              |
| `shared/ui/<component>` | reusable UI without product state or endpoint ownership                                            | page workflows, domain decisions, persistence logic            |

Keep one-page code inside its page slice even when it is large. File size alone does not justify `shared`.

## Slice and segment rules

- Similar list/detail routes may share one page slice when they evolve together, such as `instances` or `containers`.
- Use `ui`, `model`, `api`, `lib`, and `config` only when the segment clarifies responsibility. Do not add empty segments.
- The slice root `index.ts` is its public contract. Export explicit symbols only.
- Within a slice, import the full relative path. Never import the slice's own `index.ts`.

```ts
// app or another allowed higher layer
import { RuntimeInstancesPage } from "@/pages/instances";

// inside pages/instances
import { RuntimeInstanceActions } from "./runtime-instance-actions.tsx";
```

Never deep-import across a boundary:

```ts
import { RuntimeInstanceActions } from "@/pages/instances/ui/runtime-instance-actions.tsx";
```

## Shared extraction test

Move code to client `shared` only when all are true:

- at least two current consumers need the same contract;
- the code has no page, endpoint, runtime-instance, container, Compose, or other product policy;
- moving it downward does not require callbacks or flags that encode the original page;
- its purpose can be named more precisely than `helper`, `common`, `component`, or `utils`.

Small duplication is preferable when consumers are likely to diverge. Never duplicate validation or mutation semantics.

## Lazy-loading and public API

- A page public API should expose only modules used from outside the slice.
- A module imported lazily from inside a slice stays private unless an external consumer needs it.
- Avoid importing a slice `index.ts` both statically and dynamically from the same consumer; this collapses the intended chunk and produces ineffective dynamic-import warnings.
- Treat new build warnings as failures during an architecture migration.

## New layer promotion

The current contract has no `features`, `entities`, or `widgets` layer. Propose one only when current evidence shows:

- `features`: the same user-valued interaction is reused by multiple page slices;
- `entities`: the same domain model or visual representation is reused independently across pages;
- `widgets`: a large self-contained UI block is reused or independently composed.

Approval must name the layer, first slices, migration boundary, import changes, and rollback scope.

## CSS boundary

`app/styles/app.css` remains the existing global stylesheet. Do not combine its decomposition with an FSD move unless CSS ownership is the explicit task. New page styles should use the project's City DS and utility-first rules and avoid leaking selectors into unrelated slices.

## Verification

Run the narrowest relevant checks, then broaden for structural changes:

```bash
pnpm exec vitest run tests/client-architecture.test.ts
pnpm typecheck
pnpm check
```

Also inspect the production build for circular dependencies, unresolved aliases, ineffective dynamic imports, and changed chunk ownership. Browser-check at least one moved list page, one moved detail page, and one lazy dialog without performing destructive actions.
