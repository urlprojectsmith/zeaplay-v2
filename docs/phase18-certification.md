# Phase 18.4 Main Certification

Status: Phase 18.4 MAIN RESULT PARTIAL. Core functional certification is PASS, the unpatched `braces` advisory is accepted as a temporary dev/tooling-only security exception with no production runtime reachability, and the local Windows root build remains environment-limited at Next.js standalone traced-file symlink creation. Final Phase 18.4 PASS still requires exact-commit Linux root build verification. Phase 18 live custom-domain infrastructure certification is DEFERRED UNTIL AFTER PHASE 22.

## Phase Status

- Phase 18.1: CERTIFIED.
- Phase 18.2: DEFERRED UNTIL AFTER PHASE 22 for live DNS/NPM/TLS checks; local custom-domain code paths are certified.
- Phase 18.3: CERTIFIED.
- Phase 18.4: CORE FUNCTIONAL CERTIFICATION PASS / DEV_TOOLING_SECURITY_EXCEPTION_ACCEPTED / LOCAL WINDOWS ROOT BUILD PARTIAL / LINUX_EXACT_COMMIT_VERIFICATION_REQUIRED.

Phase 18 overall is not called fully certified because live custom-domain infrastructure remains deferred.

## Certification Result

PHASE 18 CORE FUNCTIONAL CERTIFICATION: PASS.

PHASE 18 LIVE CUSTOM-DOMAIN INFRASTRUCTURE CERTIFICATION: DEFERRED.

Scope certified locally:

- white-label branding and inheritance
- branded login/auth pages
- public Docs branding
- public Forms branding
- transactional email branding
- public branding API
- locally testable custom-domain resolver, CORS, worker, cache, state, token, and hostname safety
- tenant isolation, RBAC, status propagation, theme, i18n, accessibility, responsive, performance, migration, and build-order checks

Deferred live scope:

- live DNS TXT verification
- live A/AAAA/CNAME routing verification
- live NPM proxy creation/removal
- live Let's Encrypt issuance/renewal
- live HTTPS routing
- live domain reassignment/takeover revalidation
- production custom-domain routing

## Evidence

- Migration inventory: PASS, 90 migrations, latest `0090_phase18_2_custom_domains`.
- Migration compatibility: PASS, 90 migrations through `0090_phase18_2_custom_domains`, clean install, legacy upgrade, populated Phase 15/16/17 cutoff upgrades, seed twice, pg_trgm, and zero/one/many edge cases.
- Migration immutability check: PASS with caveat. `0090_phase18_2_custom_domains` is present in existing git history, and the original committed permission insert referenced nonexistent `permissions.name` and `permissions.updated_at` columns. The migration was corrected in place before verified persistent application because a later 0091 migration cannot repair a fresh install when 0090 fails first.
- Shared database status: READ-ONLY CHECKED. `pnpm prisma:migrate:status:prod` against shared `zea_play` reported `0081` through `0090` pending on 2026-10-03, so shared dev had not applied the original 0090. Staging/production application was not verified from this session.
- New migration: NONE. No `0091` was created because the required fix must be inside 0090 for clean scratch installs.
- Focused config tests: PASS, 1 file / 6 tests.
- Focused API Phase 18/custom-domain tests: PASS, `custom-domains.service.spec.ts`, 1 suite / 7 tests.
- Focused API branding/auth/docs/forms/email tests: PASS, 5 suites / 33 tests.
- Focused worker custom-domain tests: PASS, 1 suite / 2 tests.
- Focused web Phase 18 public/branding/custom-domain run: PASS, 33 files / 243 tests.
- Full root tests: PASS, 17 tasks; API 75 suites / 678 tests, worker 12 suites / 37 tests, web 33 files / 243 tests.
- Integration tests: PASS, 8 tasks; API 12 suites / 131 tests, worker 12 suites / 37 tests.
- E2E: PASS, 21 tests.
- Prisma generate/validate: PASS.
- Format, lint, typecheck, production high audit, and diff check: PASS.
- Full dev dependency high audit: FAIL WITH DOCUMENTED DEV-ONLY EXCEPTION. `pnpm audit --audit-level high --json` reports GHSA-vfj7-8cjw-p6xm for transitive `braces@3.0.3`, severity high, `dev: true`, vulnerable `<=3.0.3`, patched `>=3.0.4`, and no `fixAvailable` field in the pnpm JSON output.
- Braces runtime reachability: NONE VERIFIED. `pnpm --filter @zea-play/api why braces --prod`, `pnpm --filter @zea-play/web why braces --prod`, and `pnpm --filter @zea-play/worker why braces --prod` returned no production `braces` path. Generated `apps/api/dist`, `apps/worker/dist`, and `apps/web/.next/standalone` had no `braces`, `micromatch`, or `fast-glob` hits.
- Braces dependency paths: DEV/TEST/BUILD TOOLING ONLY. Paths are Jest/ts-jest/@types/jest for API and worker tests, Tailwind/fast-glob/chokidar for web/UI build styling, root `lint-staged`, and root `@next/eslint-plugin-next`.
- Safe parent upgrade check: NO SAFE COMPATIBLE UPGRADE AVAILABLE. Current compatible lines are already latest for `micromatch@4` (`4.0.8`), `fast-glob@3` (`3.3.3`), `chokidar@3` (`3.6.0`), `tailwindcss@3` (`3.4.19`), `jest@29` (`29.7.0`), and `lint-staged@15` (`15.5.2`). Available removals require broad major-version upgrades such as `chokidar@5`, `tailwindcss@4`, `jest@30`, `lint-staged@17`, or Next ESLint plugin major updates, which are outside Phase 18.4 certification scope.
- Security treatment: TEMPORARY ACCEPTED DEV-TOOLING SECURITY EXCEPTION. This is not marked fixed; review is required when a new `braces` release appears, parent tooling removes the path, before the next production security certification, or if `braces` becomes production-runtime reachable.
- Root clean build on Windows: PARTIAL. API and worker build passed, web compiled, typechecked, and generated 73 static pages, then Next.js standalone traced-file copy failed on Windows `EPERM` symlink creation.
- Security matrix: `docs/phase18-security-matrix.md`, 35 PASS / 8 DEFERRED / 0 FAIL.
- Integration matrix: `docs/phase18-integration-matrix.md`, 18 PASS / 1 DEFERRED / 0 FAIL.

## Build Reproducibility

Root Turbo build order is configured with `build.dependsOn: ["^build"]`. API and worker packages depend on `@zea-play/config`, so root build order rebuilds `@zea-play/config` before API and worker consumers.

Phase 18.3 Linux baseline recorded by the Phase 18.4 prompt:

- Web Linux build: PASS.
- API Linux build: PASS.
- API Linux typecheck: PASS.
- The stale `@zea-play/config` dist declaration issue was resolved by rebuilding `pnpm --filter @zea-play/config build`.

Phase 18.4 additionally hardens `@zea-play/config` NPM upstream validation so clean builds do not rely on stale generated declarations.

Clean generated-output check:

- Removed generated `dist` outputs for packages/API/worker and `.next` for web after path verification.
- Root `pnpm build` proved Turbo invokes `@zea-play/config` before API and worker consumers.
- The build did not reproduce the stale config declaration defect.
- The remaining failure was Windows symlink permission for Next standalone traced files, after successful compile/typecheck/static generation.

## Deferred Warnings

- Live DNS/NPM/TLS/provider checks are not certified without live credentials and customer domains.
- No production PM2, Docker, NPM, DNS, firewall, or VPS changes were made.
- Shared development database is not a destructive verification target and must remain read-only unless explicitly authorized.
- Linux final build of the exact Phase 18.4 tree was not run from this Windows session. Linux final certification requires a Linux root `pnpm build` PASS on the same source state.
- Full dev dependency audit remains nonzero by command result, but is accepted for Phase 18.4 only as a documented dev/tooling-only exception with production runtime exposure verified absent.

Phase 19 was not started.
