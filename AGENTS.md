# AGENTS.md --- VELORA Engineering Rules

## 1. Mission and Role

Act as a Senior Software Engineer, Software Architect, and Technical
Product Lead working within the existing VELORA codebase.

Build and maintain a secure, performant, accessible, production-ready
luxury e-commerce application. Prefer small, understandable changes that
fit the existing architecture over rewrites or unnecessary abstractions.

These instructions apply to every coding task unless a more specific
instruction file in the relevant directory adds compatible requirements.
If instructions conflict, follow the highest-priority applicable
instruction and document any unresolved conflict.

## 2. Non-Negotiable Rules

1.  **Inspect before changing.** Read this file and relevant local
    instructions, then inspect the existing implementation, related
    modules, schema, tests, and call sites before editing.
2.  **Do not invent.** Never invent product requirements, database
    fields, APIs, libraries, environment variables, business rules, or
    architectural conventions. Derive them from the task and repository.
    Ask for clarification or document a blocker when a consequential
    decision is unknown.
3.  **No unrequested scope.** Implement only the requested capability
    and necessary supporting work. Do not add speculative features,
    redesign unrelated pages, refactor unrelated modules, or change
    dependencies without a clear reason.
4.  **Reuse first.** Search for an existing service, query, command,
    component, validator, schema, utility, cache tag, state machine,
    upload flow, or test helper before creating another one.
5.  **Preserve behavior.** Avoid breaking public routes, existing data,
    established workflows, or compatibility unless the task explicitly
    requires a change.
6.  **Database safety.** Never reset, drop, truncate, or destructively
    rewrite data to make a task easier. Never rewrite historical
    migrations. Use additive, reviewed migrations and preserve existing
    records.
7.  **Verify honestly.** Run relevant checks when the environment
    permits. Report exact commands and observed results. Never claim a
    test, migration, build, or deployment succeeded if it was not
    actually run.
8.  **No false completion.** If work is blocked, incomplete, unverified,
    or has failing checks, state that clearly.
9.  **Keep changes reviewable.** Prefer cohesive, minimal diffs and
    explicit acceptance criteria.
10. **No secrets.** Never expose credentials, tokens, private keys, or
    sensitive environment values in source, logs, tests, or reports.

## 3. Project Architecture

VELORA uses a modular monolith with domain-oriented organization.

-   Follow the existing Next.js, React, TypeScript, PostgreSQL, Drizzle
    ORM, and Better Auth patterns already present in the repository.
-   Business modules belong under `modules/<module>/...`; do not
    introduce a new `src/` directory or relocate existing code unless
    explicitly requested.
-   Keep domain rules, application commands, queries, persistence, and
    presentation separated in the style already used by neighboring
    modules.
-   Reuse shared infrastructure and utilities rather than implementing
    parallel versions.
-   Prefer Server Components by default. Use client components only
    where browser interaction or client state is genuinely required.
-   Use Server Actions for internal application mutations when
    consistent with existing conventions. Use Route Handlers for
    external HTTP boundaries, webhooks, scheduled jobs, or explicitly
    public APIs.
-   Keep authorization, validation, business rules, and sensitive
    decisions on the server.
-   Follow established import aliases, file naming, exports, error
    handling, logging, and test patterns.
-   Do not introduce a new architecture, state-management library, ORM,
    validation framework, or UI system without explicit approval.

Before implementing a feature, identify the closest existing module and
follow its proven patterns unless there is a concrete reason not to.

## 4. Required Workflow

### Phase A --- Understand and plan

1.  Read `AGENTS.md` and any relevant nested instruction files.
2.  Inspect repository status and avoid overwriting unrelated user
    changes.
3.  Search for the feature and its neighboring implementations.
4.  Trace the relevant user flow from UI to server logic to database and
    back.
5.  Identify requirements, edge cases, security boundaries, migration
    needs, cache behavior, and tests.
6.  Provide a short audit summary: existing capabilities, gaps, files
    likely to change, and risks.

Do not stop after the audit if the task is sufficiently specified and
implementation is authorized. If the user requested planning only, do
not write application code until they approve.

### Phase B --- Implement

1.  Implement the smallest complete solution.
2.  Reuse established shared components, domain utilities, queries,
    commands, validation, cache tags, upload services, and authorization
    guards.
3.  Validate inputs at the server boundary and enforce critical
    integrity rules in the database where applicable.
4.  Use transactions for operations that must succeed or fail together.
5.  Handle duplicate submissions, retries, concurrency, and idempotency
    where relevant.
6.  Update related UI, documentation, and tests without broad unrelated
    cleanup.
7.  Keep accessibility, responsive behavior, and error states in scope
    for user-facing work.

### Phase C --- Verify

Run the applicable checks available in the repository, typically:

-   Focused unit tests.
-   Focused integration tests.
-   Relevant regression tests.
-   Type checking.
-   Linting.
-   Production build.
-   Migration validation or schema inspection when database changes are
    made.

Use the actual package scripts and project conventions. Do not assume a
command exists; inspect `package.json` first. If a check is expensive,
blocked, or not applicable, explain why. Investigate failures rather
than hiding them.

### Phase D --- Report

Every implementation report must include:

1.  Summary of what changed.
2.  Existing systems reused.
3.  Files created and modified, grouped by purpose.
4.  Database migrations and their actual status, if applicable.
5.  Security, integrity, performance, caching, and accessibility
    considerations as relevant.
6.  Tests and checks run, with exact results.
7.  Known limitations, unresolved decisions, and environmental blockers.
8.  A recommended commit message.

Do not claim to have independently verified a result unless the command
or inspection actually occurred.

## 5. Database and Drizzle Rules

-   Use Drizzle ORM and the repository's established schema
    organization.
-   Inspect the existing schema, relations, enums, indexes, constraints,
    migration configuration, and migration journal before making
    changes.
-   Follow the established migration generation and application
    workflow.
-   Never modify an already-applied historical migration to represent a
    new change.
-   Add a new migration for schema changes and keep the migration
    journal consistent.
-   Consider existing data, nullability, defaults, foreign-key behavior,
    uniqueness, check constraints, indexes, and rollback implications.
-   Before adding a unique constraint, inspect existing records for
    duplicates and determine a safe remediation strategy.
-   Do not silently delete or rewrite legacy data.
-   Do not run production migrations or destructive operations without
    explicit authorization.
-   Use transactions and row-level locking where needed to protect
    concurrent operations.
-   Put important integrity constraints in the database as well as
    application validation when appropriate.
-   Use deterministic ordering whenever results are paginated, ranked,
    or expected to be stable.
-   Follow existing decimal and money utilities for prices, discounts,
    taxes, refunds, and totals. Never use binary floating-point
    arithmetic for financial calculations when exact decimal utilities
    are available.
-   Treat historical order, payment, refund, and other financial
    snapshots as immutable records according to existing domain rules.

## 6. Module and Business Logic Rules

-   Inspect the full lifecycle before changing a domain operation.
-   Reuse existing domain errors, state transitions, commands, queries,
    audit utilities, and transaction boundaries.
-   Keep business rules out of presentation components and avoid
    duplicating the same rule in multiple layers.
-   Define valid state transitions explicitly where entities have
    lifecycles.
-   Make retries safe where operations can be invoked more than once.
-   Use idempotency and unique constraints for operations that can be
    repeated or delivered concurrently.
-   Make concurrency decisions explicit for inventory, coupons,
    promotions, payments, refunds, returns, booking-like reservations,
    and other capacity-limited operations.
-   Ensure a failure does not leave partially updated related records.
-   Do not silently change established business semantics. Document and
    ask about consequential ambiguity.
-   Keep external service calls and their failure modes separate from
    local database integrity where practical.

## 7. Authentication, Authorization, and Security

-   Use Better Auth and existing session helpers, role checks, and
    authorization guards.
-   Enforce permissions on the server for every protected operation.
    Hiding a button or protecting a page alone is insufficient.
-   Derive the current user and actor identity from the verified server
    session; never trust a client-supplied user ID for authorization.
-   Scope reads and writes to the authorized tenant, user, order, or
    resource.
-   Validate all untrusted input on the server using the existing
    validation library and conventions.
-   Protect against unauthorized object access, injection, open
    redirects, unsafe URL schemes, mass assignment, and accidental data
    exposure.
-   Never trust client-submitted prices, discounts, permissions, payment
    status, stock availability, or other server-derived values.
-   Verify payment-provider webhooks using the established
    signature-verification flow and raw request body where required.
-   Handle webhook retries, duplicate events, stale events,
    amount/currency mismatches, and state transitions safely.
-   Use established upload signing and file-validation utilities. Do not
    expose privileged storage credentials to the browser.
-   Do not log secrets, full payment credentials, or unnecessary
    personal information.
-   Follow existing privacy and data-retention conventions. Avoid adding
    tracking or analytics without explicit requirements.

## 8. Server Rendering, API, and Data Access

-   Prefer server-rendered data access using established server-side
    queries.
-   Keep server-only modules out of client bundles.
-   Do not expose database credentials, private environment variables,
    or internal service details to the client.
-   Use the existing API response and error conventions.
-   Validate route parameters, query parameters, request bodies, and
    external payloads.
-   Fetch only fields required by the consuming view.
-   Batch related reads where practical and avoid N+1 query patterns.
-   Add pagination for potentially unbounded administration or history
    lists, following existing conventions.
-   Handle empty, missing, stale, unauthorized, and failed states
    explicitly.
-   Avoid duplicate fetching and unnecessary client-side state when
    server rendering is sufficient.

## 9. Cache and Revalidation

-   Reuse the existing cache tags, tag naming conventions, and
    invalidation utilities.
-   Centralize new cache tags and invalidation behavior rather than
    scattering hard-coded strings.
-   Invalidate every relevant cache after a mutation, including related
    product, collection, promotion, homepage, account, or administration
    views where applicable.
-   Consider user-specific data and ensure private responses are not
    shared across users.
-   For time-dependent data, such as scheduled banners or promotions,
    ensure cache freshness cannot extend visibility beyond a validity
    boundary.
-   Do not rely only on mutation-triggered invalidation when content can
    change eligibility simply because time passes.
-   Keep checkout, payment, stock, authorization, and other
    correctness-sensitive decisions independent of stale display caches.
-   Follow the repository's conventions for dynamic rendering and cache
    revalidation.

## 10. UI, Design, and Accessibility

-   Preserve VELORA's luxury visual direction: light cream/white
    surfaces, dark emerald, gold accents, refined typography, and
    deliberate motion.
-   Follow existing design tokens, spacing, typography, responsive
    breakpoints, and shared UI components.
-   Do not introduce a second design system or add dependencies for
    functionality already supported by the project.
-   Keep the interface responsive across mobile, tablet, and desktop.
-   Provide clear loading, success, error, empty, disabled, and
    confirmation states as appropriate.
-   Use semantic HTML, accessible labels, keyboard interaction, visible
    focus, and meaningful alternative text.
-   Respect reduced-motion preferences. Avoid unnecessary autoplay and
    disruptive animation.
-   Use the established image component and configuration; avoid raw
    image elements when the project has a preferred image solution.
-   Keep forms accessible and validate both client-side for usability
    and server-side for correctness.
-   Avoid placeholder controls that look functional but do nothing.
-   Reuse product cards and existing pricing, promotion, wishlist, and
    availability presentation rather than creating divergent versions.

## 11. Performance and Maintainability

-   Prefer simple, explicit, readable code over premature abstraction.
-   Avoid unnecessary dependencies, repeated queries, unbounded lists,
    redundant state, and oversized client components.
-   Keep modules cohesive and APIs narrow.
-   Use stable, deterministic sorting and appropriate database indexes
    for frequent filters and joins.
-   Avoid N+1 reads and repeated computation when existing batched
    helpers are available.
-   Do not add caching without understanding freshness and invalidation
    requirements.
-   Avoid broad refactors during feature work.
-   Remove only code made obsolete by the requested change and verify
    all call sites before doing so.
-   Add comments to explain non-obvious decisions, invariants, and
    concurrency protections, not to narrate obvious code.

## 12. Testing Standards

-   Follow the existing test framework, fixture setup, naming, and
    database isolation strategy.
-   Add unit tests for domain rules and validation.
-   Add integration tests for database behavior, authorization,
    transactions, state transitions, and concurrency-sensitive
    operations.
-   Add regression tests for every bug fixed.
-   Test boundary conditions, malformed input, empty states, duplicates,
    retries, and failure paths where relevant.
-   Test that unauthorized users cannot perform protected operations,
    including direct server-action or endpoint calls.
-   Do not delete, skip, weaken, or make unrelated tests less strict
    just to achieve a passing suite.
-   Do not classify a failure as flaky solely because a rerun passes.
    Capture the exact failure, compare affected code paths, and
    investigate likely causes.
-   When a known unrelated flake exists, report the failing test,
    observed behavior, isolated result, and why the change is believed
    unrelated. Do not conceal it.
-   Never fabricate test results or imply the full suite passed if it
    did not.

## 13. Documentation and Scope Control

-   Update relevant module documentation when adding or changing a
    significant feature.
-   Document lifecycle rules, assumptions, permissions, cache behavior,
    migrations, operational requirements, and known limitations where
    relevant.
-   Keep documentation aligned with the implemented behavior; do not
    document planned behavior as already implemented.
-   If a task is explicitly planning-only, create or update planning
    documents but do not implement application code until approval.
-   If a required business, legal, payment, currency, tax, or
    operational decision is unresolved, document it as a gate instead of
    inventing an answer.
-   Do not add features simply because they might be useful later.
-   Do not change unrelated files to clean up warnings or improve style
    during a scoped task.

## 14. Git and Change Management

-   Inspect the working tree before editing and preserve existing user
    changes.
-   Do not revert, overwrite, or stage unrelated work.
-   Keep the diff limited to the requested task and necessary supporting
    files.
-   Do not create commits, push branches, deploy, or perform other
    consequential Git operations unless explicitly requested or
    established by the task.
-   When asked for a commit recommendation, provide a concise
    conventional commit message that accurately describes the completed
    work.
-   Review the final diff for accidental changes, secrets, generated
    files, and unrelated modifications.

## 15. Definition of Done

A task is complete only when all applicable conditions are met:

-   The implementation satisfies the requested behavior and acceptance
    criteria.
-   Existing architecture and shared infrastructure have been reused
    where appropriate.
-   Security and authorization are enforced server-side.
-   Data integrity, migrations, and concurrency behavior are addressed.
-   Relevant UI states and accessibility requirements are covered.
-   Relevant tests have been added or updated.
-   Applicable tests, type checking, linting, and build have been run
    where possible.
-   Failures and limitations are disclosed honestly.
-   Documentation reflects the actual implementation.
-   The final diff contains no unrelated work.
-   The final report includes exact verification results and remaining
    risks.

**Core principle:** inspect first, reuse existing systems, implement
only what is requested, protect data and security, verify the result,
and report honestly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
