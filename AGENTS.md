# openwapp

Open source matching engine and collector for Wappalyzer fingerprints, built on
the community maintained
[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) data.

## Tooling

- Use pnpm for JS/TS packages.
- Use Turborepo to run tasks across the monorepo.
- Common scripts: `format`, `lint` (includes type checking), `build`, `test`.
- Releases use Changesets. A change to a published package comes with a
  changeset from `pnpm changeset`. Merging to `master` opens a "Version
  Packages" PR, and merging that PR publishes to npm.

## Licensing

`packages/fingerprints` is GPL-3.0-only because it carries the upstream data.
Everything else is MIT. MIT packages must never copy, bundle or depend on
fingerprint data, so `@openwapp/fingerprints` may only appear in their
`devDependencies`. The matcher takes a catalog as input and leaves loading the
data to the user.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `k3dom/openwapp`, managed via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

## Vendored Repositories

This project vendors external repositories of key libraries as git subtrees
under `.agents/repos/`. Use vendored repositories as read-only reference
material when working with related libraries to explore APIs, find usage
examples, and understand implementation details.

- Effect-TS (`.agents/repos/effect/`)

## Rules

Do not read git stashes unless explicitly instructed.

## Code style

### Comments

**Default to zero comments.** Write one only when the information is essential
and cannot be inferred from the code itself. If unsure, it is not needed.

**Public exports are the exception.** Everything reachable from a package's
`src/index.ts` gets a JSDoc, since it ships in the published `.d.ts` and is all
an editor shows. Say what it does, what it fails, throws or rejects with, and
what a caller cannot see from the types. Add an `@example` only to entry points.

### Functions

**Default to inlining logic.** Reading straight down and having logic be
co-located beats jumping between definitions. Keep logic inline when a function
would only name a few lines used once or twice.

### Modules

**The file is the namespace.** Export services, layers, helpers, and types at
the top level and import the module as a whole:
`import * as Catalog from '#/catalog.ts'`, then `Catalog.load`, `Catalog.layer`,
`Catalog.Catalog`. Do not hang layers or helpers off a service class as statics.
Name the module after its primary service when it has one
(`KeyValueStore.KeyValueStore`).

### Effect and plain APIs

**Users should not need to know Effect.** Keep core logic in plain functions.
Every exported function that returns an `Effect` gets a plain counterpart: a
`Sync` variant that throws the typed error when it does no I/O, or a `Promise`
variant that rejects with it when it does. For example, `Catalog.decodeSync`
sits next to `Catalog.decode`. Usage examples in READMEs always show both.

### Prose

**Never use semicolons or em dashes to structure sentences.** This applies to
all prose, whether in documentation, comments or strings.
