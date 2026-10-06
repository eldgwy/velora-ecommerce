You are a Senior Staff Full-Stack Engineer working on the VELORA luxury e-commerce application.

Your task is to IMPLEMENT AND HARDEN:

FR-02 — Customer Profile & Address Book Management

IMPORTANT:

Do NOT rewrite the existing customer/profile/address implementation.

The repository already contains a partially implemented FR-02 vertical slice.

Your job is to:

1. Audit the existing implementation.
2. Preserve working behavior.
3. Implement missing SRS requirements.
4. Fix correctness, authorization, transaction, validation, and data-integrity gaps.
5. Add tests.
6. Do not perform unrelated architecture refactors.

==================================================

1. PROJECT CONTEXT
   \==================================================

Application:

VELORA luxury e-commerce.

Stack:

- Next.js 16
- React 19
- TypeScript strict
- PostgreSQL
- Drizzle ORM
- Drizzle Kit
- Better Auth
- Zod
- Nodemailer
- Tailwind CSS
- Zustand
- TanStack Query where already used

Architecture:

Modular Monolith + Domain-Oriented Clean Architecture.

Target layering:

Presentation
↓
Application
↓
Domain
↓
Infrastructure

Existing authentication source of truth:

shared/lib/auth.ts

Existing server authorization:

shared/lib/guards.ts

Existing customer-related implementation includes:

services/customer.service.ts
services/address.service.ts

and profile/address actions/pages already exist.

IMPORTANT:

Do NOT migrate all existing services into modules/ simply for architectural consistency.

FR-02 completion is the priority.

================================================== 2. SOURCE OF TRUTH
==================================================

Use the following as the source of truth:

1. FR-02 SRS requirements below
2. Existing repository implementation
3. Existing database schema
4. Existing migrations
5. Existing authentication/session guards

Do not silently invent requirements.

If an implementation detail is not specified by FR-02, preserve the current repository behavior unless it creates a security, integrity, or correctness problem.

================================================== 3. FR-02.01 — CUSTOMER PROFILE
==================================================

Priority:

P1 — High

Target Actor:

CUSTOMER

Database Entity:

customer_profile

Mutable fields:

firstName
middleName
lastName
phone
birthday
preferredLanguage

preferredLanguage must be:

'en'
or
'ar'

phone must use:

E.164 format

Example:

+201001234567

The authenticated user must only be able to inspect and update THEIR OWN customer profile.

The server must enforce:

authenticatedSession.user.id === customer_profile.userId

Never trust a client-provided userId.

================================================== 4. PROFILE IMMUTABILITY
==================================================

The following fields are immutable:

userId
id

A profile update must never allow the client to change:

id
userId

Even if a malicious request includes:

{
id: "...",
userId: "..."
}

those fields must be rejected or ignored according to the application's validation contract.

Prefer rejecting unexpected immutable fields rather than silently changing them.

The authenticated identity must come from the server session.

Do NOT accept userId as an authorization source.

Correct pattern:

session.user.id
↓
customer profile lookup
↓
verify profile.userId === session.user.id
↓
update allowed fields

================================================== 5. PROFILE VALIDATION
==================================================

Create or reuse a Zod validation schema.

Validate:

firstName
middleName
lastName
phone
birthday
preferredLanguage

Rules explicitly required by FR-02:

phone:

E.164 format

preferredLanguage:

'en' | 'ar'

Do not invent arbitrary maximum lengths unless they already exist in the schema/database or are required to prevent a clear database/security issue.

birthday must be validated consistently with the existing database representation.

Be careful about:

- timezone
- date-only semantics
- serialization between client/server
- database date representation

Do not silently convert a birthday into a timestamp if the database models it as a date.

================================================== 6. PROFILE INSPECTION
==================================================

A CUSTOMER must be able to inspect their own profile.

The read path must be authenticated.

Unauthenticated users must not access private customer profile data.

A customer must not be able to request another customer's profile simply by changing:

userId
customerId
profileId

in the request.

Authorization must derive from the authenticated session.

================================================== 7. PROFILE UPDATE
==================================================

Profile update must:

1. authenticate the user
2. obtain userId from the session
3. load the customer's profile
4. verify ownership
5. validate the mutable fields
6. update only allowed fields
7. preserve id
8. preserve userId

Do not perform:

UPDATE customer_profile
SET ...
WHERE id = clientProvidedId

without verifying ownership.

Prefer a scoped update such as:

WHERE id = profileId
AND userId = sessionUserId

or equivalent service-level ownership enforcement.

================================================== 8. FR-02.02 — ADDRESS BOOK
==================================================

Priority:

P0 — Blocker

Target Actor:

CUSTOMER

Database Entity:

addresses

Operations:

Create Address

Set Default Address

Update Address

Delete Address

Address fields:

country
city
state
postalCode
label
addressLine1
addressLine2
addressLine3
isDefault

A customer must only access addresses belonging to their own customerId.

Never trust client-provided customerId.

Resolve customer identity from:

authenticated session
↓
user
↓
customer_profile
↓
customerId

================================================== 9. ADDRESS CREATE
==================================================

Create Address accepts:

country
city
state
postalCode
label
addressLine1
addressLine2
addressLine3
isDefault

Validate the input with Zod.

Required/optional status should follow the existing database schema and current application behavior unless FR-02 explicitly defines otherwise.

Do not invent contradictory requirements.

When:

isDefault = false

create the address normally.

When:

isDefault = true

the new address must become the customer's default address.

This operation must be atomic.

================================================== 10. DEFAULT ADDRESS INVARIANT
==================================================

Critical requirement:

For a given customerId:

At most ONE address may have:

isDefault = true

When an address is created or updated with:

isDefault = true

all other addresses belonging to the same customer must become:

isDefault = false

This must happen atomically.

Example:

Customer A:

Address 1 → default = true
Address 2 → default = false
Address 3 → default = false

If Address 3 becomes default:

Address 1 → false
Address 2 → false
Address 3 → true

There must never be a committed database state where two addresses for the same customer are default.

================================================== 11. TRANSACTION REQUIREMENT
==================================================

Setting an address as default MUST use an atomic database transaction.

Required conceptual operation:

BEGIN TRANSACTION

1. Set all customer's addresses to isDefault = false
2. Set target/new address to isDefault = true

COMMIT

If any operation fails:

ROLLBACK

Do not implement:

update others
then
update target

as two unrelated database operations.

That creates a race condition and can leave inconsistent state.

================================================== 12. CONCURRENCY
==================================================

Think about concurrent requests.

Example:

Request A:
Address 1 → default

Request B:
Address 2 → default

Both requests may arrive simultaneously.

The implementation must preserve the invariant:

ONE customer
→ maximum ONE default address

Do not assume UI serialization is sufficient.

The database must help enforce the invariant where PostgreSQL supports it cleanly.

Inspect the current schema and determine whether a PostgreSQL partial unique index is appropriate:

UNIQUE WHERE isDefault = true

conceptually:

unique(customer_id)
WHERE is_default = true

If the existing schema/database architecture supports this, implement it.

If a migration is required:

1. update schema
2. generate migration
3. inspect SQL
4. apply/test migration
5. verify existing data does not violate the constraint

Do NOT blindly add a constraint before checking existing duplicate defaults.

================================================== 13. SET DEFAULT ADDRESS
==================================================

When setting an existing address as default:

1. authenticate customer
2. resolve customerId from session
3. verify target address belongs to that customer
4. execute atomic transaction
5. unset all other defaults
6. set target address default = true

A customer must not be able to set another customer's address as default.

Example malicious request:

{
addressId: "another-customer-address"
}

must fail.

Do not update it.

================================================== 14. UPDATE ADDRESS
==================================================

Address updates must enforce ownership.

Allowed mutable fields:

country
city
state
postalCode
label
addressLine1
addressLine2
addressLine3
isDefault

The following should never be changed through a normal update:

id
customerId
createdAt
historical order address references

If:

isDefault = true

the update must use the same atomic default-address logic.

If:

isDefault = false

be careful about the resulting state.

FR-02 does not explicitly require that every customer must always have a default address.

Therefore:

Do NOT invent a requirement that one address must always be default.

A customer may have zero default addresses unless existing application/database behavior explicitly requires otherwise.

================================================== 15. DELETE ADDRESS
==================================================

Delete Address:

Deletes the record from:

addresses

Deletion must only be allowed for the authenticated customer's own address.

Never trust:

customerId

from the client.

Resolve ownership from the session.

IMPORTANT:

Deletion does NOT cascade to historical order addresses stored in:

order_addresses

Historical order addresses must remain intact.

Do NOT delete or mutate:

order_addresses

when deleting:

addresses

This preserves historical order data.

================================================== 16. ORDER ADDRESS SAFETY
==================================================

Before implementing deletion, inspect:

addresses
order_addresses
foreign keys
relations
migration files

Determine whether the current database schema already correctly separates:

live customer addresses

from:

historical order addresses

The expected behavior is:

Customer address deleted
↓
addresses record removed
↓
order_addresses preserved

If the current FK configuration would cascade into order_addresses:

FIX IT.

Do not rely only on application code to prevent historical data loss.

================================================== 17. AUTHORIZATION MODEL
==================================================

Every customer profile/address operation must require an authenticated session.

Expected flow:

request
↓
requireSession()
↓
session.user.id
↓
customer lookup
↓
customer-owned resource
↓
operation

Never:

request
↓
client userId/customerId
↓
operation

The client is untrusted.

================================================== 18. CUSTOMER LOOKUP
==================================================

Inspect the current relationship:

user
↓
customer_profile

Determine the canonical way the project identifies:

customerId

Prefer a centralized service/helper rather than repeating user→customer lookup logic in every action.

However:

Do not perform a large refactor.

If a reusable helper already exists, use it.

If not, create the smallest appropriate abstraction.

Potential conceptual API:

getCustomerForAuthenticatedUser()

or equivalent.

It should:

- require authentication
- obtain session.user.id
- find customer profile
- return customer identity

It must not accept an arbitrary userId for authorization.

================================================== 19. ERROR HANDLING
==================================================

Use the application's existing error conventions.

Expected categories:

401
Unauthenticated

403
Authenticated but not authorized

404
Customer/profile/address does not exist

422
Validation failure

500
Internal server error

Do not leak:

- database errors
- SQL statements
- stack traces
- another customer's existence where inappropriate

For ownership-sensitive resources, consider whether returning 404 instead of 403 better prevents resource enumeration.

Follow the existing project error contract.

================================================== 20. SERVER ACTIONS
==================================================

Audit existing profile/address Server Actions.

Every mutation must:

- execute on the server
- validate input
- authenticate
- authorize ownership
- call the appropriate service
- return a safe result

Do not allow client components to directly mutate database state.

Do not trust hidden form fields for:

userId
customerId
ownership

================================================== 21. SERVICE LAYER
==================================================

Inspect:

services/customer.service.ts
services/address.service.ts

Preserve working logic.

Strengthen these services where needed.

The service layer should own important business invariants such as:

- customer ownership
- address ownership
- default address switching
- transactional updates

Do not duplicate default-address logic across:

UI
Server Actions
Services

Prefer:

Server Action
↓
Service
↓
Database transaction

================================================== 22. DATABASE TRANSACTION DESIGN
==================================================

Inspect the current Drizzle database instance.

Determine the project's transaction API.

Use the existing database infrastructure.

Do not create a second database connection.

Do not bypass:

AppDatabase
or
existing database configuration.

Transaction should conceptually be:

db.transaction(async (tx) => {
...
})

using the project's actual Drizzle setup.

================================================== 23. DATABASE MIGRATIONS
==================================================

Before modifying schema:

inspect:

infrastructure/database/schema/
infrastructure/database/migrations/

Do not edit old applied migrations casually.

If schema changes are required:

1. modify schema
2. generate migration
3. inspect generated SQL
4. verify migration safety
5. test migration

If adding a unique default-address constraint:

first check existing duplicate defaults.

Migration must not silently destroy customer data.

================================================== 24. PROFILE + ADDRESS DATA INTEGRITY
==================================================

Audit the following:

customer_profile.userId

addresses.customerId

addresses.isDefault

order_addresses

Foreign keys

Unique constraints

Indexes

Delete behavior

Update behavior

Make sure:

User
↓
Customer Profile
↓
Addresses

is correctly scoped.

And:

Order
↓
Order Address

is historical and independent from future customer address deletion.

================================================== 25. TESTING
==================================================

Create meaningful tests.

Do not leave FR-02 untested.

PROFILE TESTS

[ ] authenticated customer can read own profile
[ ] unauthenticated profile read rejected
[ ] customer can update own profile
[ ] customer cannot update another customer's profile
[ ] userId cannot be changed
[ ] id cannot be changed
[ ] valid E.164 phone accepted
[ ] invalid phone rejected
[ ] preferredLanguage=en accepted
[ ] preferredLanguage=ar accepted
[ ] invalid preferredLanguage rejected

ADDRESS CREATE

[ ] authenticated customer can create address
[ ] unauthenticated create rejected
[ ] address belongs to authenticated customer
[ ] malicious customerId cannot assign address to another customer
[ ] create non-default address
[ ] create default address

DEFAULT ADDRESS

[ ] only one default address exists
[ ] creating default unsets previous default
[ ] updating address to default unsets previous default
[ ] setting existing address default is atomic
[ ] customer cannot set another customer's address default
[ ] concurrent default updates preserve invariant if supported by DB constraint/transaction design

ADDRESS UPDATE

[ ] customer can update own address
[ ] customer cannot update another customer's address
[ ] customerId cannot be changed
[ ] id cannot be changed
[ ] updating isDefault=true changes default atomically

ADDRESS DELETE

[ ] customer can delete own address
[ ] customer cannot delete another customer's address
[ ] deleted address removed from addresses
[ ] historical order_addresses remain
[ ] deleting address does not delete historical order address
[ ] database FK behavior verified

================================================== 26. SECURITY TESTS
==================================================

Explicitly test IDOR scenarios.

IDOR:

Insecure Direct Object Reference.

Examples:

Customer A sends:

customerId = Customer B

or:

addressId = Address belonging to Customer B

or:

userId = User B

The server must ignore/reject unauthorized ownership attempts.

Test:

Customer A
→ attempts to read Customer B profile

Customer A
→ attempts to update Customer B profile

Customer A
→ attempts to read Customer B address

Customer A
→ attempts to update Customer B address

Customer A
→ attempts to delete Customer B address

Customer A
→ attempts to set Customer B address as default

All must fail.

================================================== 27. UI / PRESENTATION
==================================================

Do not unnecessarily redesign the UI.

Ensure the existing customer/account UI correctly reflects backend behavior.

Profile:

- load authenticated profile
- display current values
- submit updates
- show validation errors
- show safe server errors

Address book:

- list customer's addresses
- create
- update
- delete
- set default
- display default state

The UI must never determine authorization.

Backend remains authoritative.

================================================== 28. CACHE / REVALIDATION
==================================================

Inspect whether profile/address data is cached through:

Next.js
TanStack Query
Server Components
Server Actions

After mutations, invalidate/revalidate the correct data.

Do not leave stale:

profile
address list
default address

in the UI after a successful mutation.

Use the existing project caching strategy.

Do not introduce an unrelated state-management system.

================================================== 29. ARCHITECTURE RULE
==================================================

Do NOT perform a broad architectural migration.

Do not move:

services/customer.service.ts
services/address.service.ts

into new module structures unless required.

Do not rebuild the database layer.

Do not replace Drizzle.

Do not replace Better Auth.

Do not introduce another ORM.

Do not introduce another state manager.

Keep the implementation consistent with the existing repository.

================================================== 30. EXECUTION ORDER
==================================================

Execute in this order:

PHASE 0
Repository + FR-02 audit

↓

PHASE 1
Profile authorization + validation

↓

PHASE 2
Address ownership + CRUD

↓

PHASE 3
Atomic default-address behavior

↓

PHASE 4
Historical order-address deletion safety

↓

PHASE 5
Database constraints/indexes if required

↓

PHASE 6
Cache/revalidation + UI correctness

↓

PHASE 7
Tests + final verification

================================================== 31. PHASE 0 — AUDIT FIRST
==================================================

Before modifying anything:

Run:

git status
git diff --stat
git diff

Inspect:

package.json
tsconfig.json
database configuration
customer schema
address schema
order_addresses schema
relations
migrations
customer.service.ts
address.service.ts
profile actions
address actions
profile pages
address pages
authentication guards

Do not destroy uncommitted work.

Do not reset git.

Do not overwrite existing changes.

First identify:

WHAT ALREADY WORKS

WHAT IS MISSING

WHAT IS INCORRECT

WHAT MUST CHANGE

================================================== 32. REQUIRED VERIFICATION
==================================================

Run:

npm run typecheck
npm run lint
npm test
npm run build

If the project uses different scripts, inspect package.json and use the correct commands.

Verify database migrations.

Verify existing FR-01 authentication tests still pass.

FR-02 changes must not break:

registration
login
logout
session
password reset
RBAC

================================================== 33. FINAL DEFINITION OF DONE
==================================================

FR-02 is DONE only when:

PROFILE

[ ] Customer can inspect own profile
[ ] Customer can update own profile
[ ] Ownership enforced server-side
[ ] userId immutable
[ ] id immutable
[ ] E.164 phone validation
[ ] preferredLanguage limited to en/ar

ADDRESS BOOK

[ ] Create address
[ ] Read/list own addresses
[ ] Update address
[ ] Delete address
[ ] Set default address
[ ] Ownership enforced
[ ] customerId cannot be spoofed

DEFAULT ADDRESS

[ ] Setting default unsets all others
[ ] Operation is atomic
[ ] Concurrency considered
[ ] Database uniqueness enforced where appropriate

HISTORICAL DATA

[ ] addresses deletion does not cascade to order_addresses
[ ] Historical order addresses remain intact

SECURITY

[ ] No IDOR
[ ] No client-controlled authorization
[ ] All mutations authenticated
[ ] All ownership checks server-side
[ ] Safe errors

QUALITY

[ ] Tests added
[ ] Tests pass
[ ] TypeScript passes
[ ] Lint passes
[ ] Build passes
[ ] Database migration verified

================================================== 34. REPORTING FORMAT
==================================================

After each phase report:

### Phase X — <name>

Status:
PASS / PARTIAL / BLOCKED

Implemented:

- ...

Files changed:

- ...

Database changes:

- ...

Security changes:

- ...

Tests:

- ...

Verification:

- ...

Remaining:

- ...

Do not claim a requirement is complete unless it was actually verified.

================================================== 35. FINAL REPORT
==================================================

At the end provide:

# FR-02 IMPLEMENTATION REPORT

## 1. Completed Requirements

List every FR-02 requirement completed.

## 2. Existing Code Reused

Explain what existing implementation was preserved.

## 3. Files Changed

List important files.

## 4. Database Changes

List schema/index/migration changes.

## 5. Security Improvements

Especially:

- ownership
- IDOR protection
- immutable fields
- transaction safety

## 6. Default Address Strategy

Explain exactly how the one-default-address invariant is enforced.

## 7. Historical Order Address Safety

Explain how order_addresses remains preserved.

## 8. Tests

List tests created and results.

## 9. Commands Executed

List verification commands.

## 10. Remaining Issues

Only real remaining issues.

## 11. Git Commit Recommendation

Recommend clean commits.

Do NOT create commits unless explicitly instructed.

==================================================
FINAL PRINCIPLE
==================================================

The objective is NOT to make the architecture theoretically perfect.

The objective is to make FR-02:

SECURE
CORRECT
ATOMIC
TESTED
PRODUCTION-READY

while preserving the existing working implementation.

Prioritize:

1. Authorization
2. Data ownership
3. Atomic default-address behavior
4. Historical order-address preservation
5. Validation
6. Database integrity
7. Tests

Avoid:

- unnecessary rewrites
- broad refactors
- duplicate services
- duplicate database access layers
- client-side authorization
- assumptions not supported by the SRS or repository

START BY AUDITING THE CURRENT REPOSITORY.

DO NOT MODIFY FILES UNTIL YOU HAVE INSPECTED THE EXISTING FR-02 IMPLEMENTATION.
