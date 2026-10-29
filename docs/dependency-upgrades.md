# Dependency upgrades

Reviewed on 2026-10-28. The upgrade was validated locally before publication.

## Toolchain and compatibility

- Node.js 24.22.2 and pnpm 12.16.1 are pinned. GitHub Actions use Node 24-compatible releases pinned to commit SHAs.
- pnpm lifecycle scripts use explicit, version-pinned `allowBuilds` entries. The removed `onlyBuiltDependencies` setting is no longer used; unreviewed dependency builds still fail installation.
- The `tsc` command uses TypeScript 7.0.2. The `typescript` package name points to the official TypeScript 6 compatibility API for Next.js and ESLint tooling; `@typescript/native` provides the native TypeScript 7 compiler, following Microsoft's supported side-by-side configuration.
- Prisma CLI, client and PostgreSQL adapter are pinned together at 7.3.0. Version 7.10.1 reproduced upstream migration regression [#30640](https://github.com/prisma/orm/issues/30640): historical PostgreSQL temporary tables using `ON COMMIT DROP` disappear between statements. The complete unchanged migration history and seed pass on 7.3.0. Prisma 8 release candidates were excluded. Configuration and seeding moved to `prisma.config.ts`; the generated client uses `generated/prisma`, which is ignored by Git. Existing migration SQL and database models are unchanged.
- PostgreSQL serialization/deadlock handling recognizes the legacy Prisma error format, the driver adapter's nested SQLSTATE fields, and direct adapter errors raised at transaction commit. Existing retry bounds and transaction isolation are unchanged.
- Database clients share a factory that preserves explicit connection limits, timeout parameters and schema from `DATABASE_URL`. Defaults use a bounded pool and a finite connection timeout.
- Cypress 16.2.1 uses installed Google Chrome. The public screenshot flag uses `Cypress.expose()`; no credentials are exposed through it.
- Node types stay on the Node 24 line. NextAuth stays on the existing v5 channel (5.0.0-beta.32); replacing it with the registry's v4 tag would be a downgrade.

## Upstream peer declarations

ESLint 10.13.0 runs the project lint successfully. Three transitive Next.js plugins still declare peer ranges ending at ESLint 9: `eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, and `eslint-plugin-react@7.37.5`. Their peer warnings have not been hidden or their rules disabled. Recheck those declarations when upgrading the Next.js lint configuration.

## Transitive security updates

Targeted overrides in `pnpm-workspace.yaml` update the vulnerable transitive packages without relaxing the existing supply-chain checks. The final npm audit reports zero advisories across all severities. The final lockfile also passes a frozen installation.

The PostgreSQL 8 driver can still emit its queued-query deprecation warning through Prisma transaction queries. Those transaction paths pass the integration suite; warnings are not suppressed.

## Direct dependencies

| Package | Before | Selected version/specification |
| --- | --- | --- |
| `@auth/prisma-adapter` | 2.11.3 | `^2.11.3` |
| `@jmondi/oauth2-server` | 5.0.0 | `5.0.0` |
| `@modelcontextprotocol/sdk` | 1.32.1 | `1.32.2` |
| `@prisma/adapter-pg` | Added | `7.3.0` |
| `@prisma/client` | 6.19.3 | `7.3.0` |
| `@radix-ui/react-slot` | 1.3.0 | `^1.5.0` |
| `bcryptjs` | 3.0.3 | `^3.0.3` |
| `class-variance-authority` | 0.7.1 | `^0.7.1` |
| `clsx` | 2.1.1 | `^2.1.1` |
| `date-fns` | 4.4.0 | `^4.4.0` |
| `decimal.js` | 10.6.0 | `^10.6.0` |
| `jose` | 6.1.3 | `6.2.13` |
| `leaflet` | 1.9.4 | `^1.9.4` |
| `lucide-react` | 0.536.0 | `^1.63.0` |
| `next` | 16.2.11 | `^16.4.3` |
| `next-auth` | 5.0.0-beta.32 | `5.0.0-beta.32` |
| `next-themes` | 0.4.6 | `^0.4.6` |
| `react` | 19.2.8 | `^19.3.1` |
| `react-dom` | 19.2.8 | `^19.3.1` |
| `react-leaflet` | 5.0.0 | `^5.0.0` |
| `read-excel-file` | 9.3.4 | `^9.3.13` |
| `recharts` | 3.10.0 | `^3.10.1` |
| `redis` | 6.1.0 | `^6.3.0` |
| `tailwind-merge` | 3.6.0 | `^3.7.0` |
| `yahoo-finance2` | 3.15.4 | `^4.0.5` |
| `zod` | 4.4.3 | `^4.6.7` |
| `@tailwindcss/postcss` | 4.3.3 | `^4.3.3` |
| `@types/leaflet` | 1.9.21 | `^1.9.22` |
| `@types/node` | 24.19.2 | `^24.19.2` |
| `@types/react` | 19.2.17 | `^19.3.0` |
| `@types/react-dom` | 19.2.3 | `^19.3.0` |
| `@typescript/native` | Added | `npm:typescript@7.0.2` |
| `@vitest/coverage-v8` | 3.2.7 | `^5.0.5` |
| `cypress` | 14.5.4 | `^16.2.1` |
| `eslint` | 9.39.5 | `^10.13.0` |
| `eslint-config-next` | 16.2.11 | `^16.4.3` |
| `prisma` | 6.19.3 | `7.3.0` |
| `tailwindcss` | 4.3.3 | `^4.3.3` |
| `tsx` | 4.23.1 | `^4.23.15` |
| `typescript` | 5.9.3 | `npm:@typescript/typescript6@6.0.2` |
| `vitest` | 3.2.7 | `^5.0.5` |

## Local validation

The final dependency set passed:

- Unit tests: 1,543 tests across 98 files.
- Integration tests: 290 tests across 39 files, with no skipped tests, using disposable PostgreSQL 18.4 and Redis 7.2.15 services.
- Browser tests: 73 tests across 24 specs, using Cypress 16.2.1 and headless Chrome.
- CI automation tests: 43 Python tests.
- TypeScript 7 typecheck, ESLint 10, production build, a fresh frozen dependency installation with empty dependency/build caches, and `git diff --check`.
- All existing database migrations and seed on a fresh disposable database; no migration SQL was changed.
- Dependency audit: zero advisories across all severities.

Calculator source, contribution UI and historical migration fingerprints remained unchanged during the dependency upgrade. Validation logs are kept locally in `work/dependency-upgrade-*.log` and `work/ci-driver-conflict-*.log`.

Local Docker cleanup reclaimed 15.74 GB of unused build cache and 659.3 MB from an unused image. Containers and persistent volumes were preserved.

## References

- [Prisma 7 migration guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [TypeScript 7 side-by-side compatibility](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0)
- [Cypress migration guide](https://docs.cypress.io/app/references/migration-guide)
- [Vitest migration guide](https://vitest.dev/guide/migration/)
