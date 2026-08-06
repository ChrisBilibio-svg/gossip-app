---
title: 'Featured category news images'
type: 'feature'
created: '2026-08-05'
status: 'done'
baseline_commit: '28d5f238f5c19127fea30e1fd0c35516c6ca14f8'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/spec-a-coluna-native-ui.md'
  - '{project-root}/docs/spec-admin-automation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every poll currently reserves a large branded illustration panel, which makes the feed repetitive and gives real daily stories no editorial visual anchor.

**Approach:** Run a small server-side image assignment job after daily auto-curation to select the newest eligible poll in each category for the São Paulo calendar day, derive a neutral story-related descriptor, and search Pexels' free licensed API. Image-less polls become compact, text-first cards; the selected poll and its detail view show the stored image and attribution.

## Boundaries & Constraints

**Always:** Keep image selection server-side behind `PEXELS_API_KEY`; select only published, open, non-expired polls in the six canonical categories; derive a short neutral visual descriptor without celebrity names or alleged-event claims; use landscape `pt-BR` search; store the chosen CDN URL, safe alt text, photographer/Pexels attribution, photo page, provider ID, descriptor, and São Paulo feature date. Enforce one image-bearing poll per category/day transactionally, with a newer published poll replacing the earlier category image only after a valid replacement is ready. Treat stock art as thematic—not proof that a named person or rumored event is pictured. Missing keys, API/model errors, rate limits, malformed results, migration gaps, and image load failures must never affect publishing or leave a broken/empty image frame. Credit Pexels and the photographer wherever an image is displayed.

**Ask First:** Applying the new Supabase migration, adding the Pexels key to GitHub Actions, triggering the live workflow, changing providers, or using publisher-owned article photography.

**Never:** Expose the Pexels key in Expo/client code; scrape or hotlink publisher images; search from a user's device; fabricate a photo of the alleged event; use logos, text-heavy images, crime/medical imagery, or misleading identified-person claims; show the existing camera/category illustration panel on image-less cards.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Daily category winner | Scheduled job finds the newest eligible poll and a valid Pexels result | Poll receives stored landscape media and attribution; any earlier image for that category/day is cleared | Transaction prevents two category/day winners |
| Later same-category poll | Another poll in that category publishes later that UTC day | Newer poll becomes the sole image-bearing poll | If search/RPC fails, keep the existing winner |
| No usable image | Key absent, API non-2xx/429, empty/unsafe response, or DB migration missing | Publishing succeeds and poll renders text-first | Log a concise non-secret reason; do not retry aggressively |
| Client image failure | Stored URL fails to load | Image region collapses and the complete poll remains usable | No broken icon or category-art fallback |
| Attribution | Stored Pexels image renders | Photographer/Pexels credit is visible; detail credit opens the Pexels photo page | Invalid attribution URL is non-interactive |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0064_featured_category_editorial_images.sql` — bounded media columns, one-per-category/day invariant, and service-role assignment RPC.
- `scripts/editorial-images.mjs` — target selection, neutral descriptor validation, Pexels request/response normalization, and trusted-host checks.
- `scripts/assign-daily-images.mjs` — dry-run-default orchestration that assigns at most six category winners after publication.
- `.github/workflows/assign-daily-images.yml` — serialized post-curation job with server-only API secrets.
- `src/lib/rumors.ts`, `src/lib/feedSearch.ts` — optional media enrichment and typed `editorialImage` mapping without breaking pre-migration feeds.
- `src/components/EditorialArtwork.tsx`, `MarketCard.tsx`, `RumorDetail.tsx` — real photo, credit, accessibility, load-error collapse, and text-first fallback.
- `tests/**`, `tests-ui/**` — API, migration, mapping, rendering, attribution, and fallback regressions.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0064_featured_category_editorial_images.sql` — add safe metadata and a transactional, service-only assignment function that replaces the prior same-category/day winner only after a valid new image is available.
- [x] `scripts/editorial-images.mjs`, `scripts/assign-daily-images.mjs`, `.github/workflows/assign-daily-images.yml` — choose the newest eligible poll per canonical category, generate a neutral story-related descriptor, search Pexels at most once per winner, preserve attribution, default to dry-run, and fail open without leaking credentials.
- [x] `src/lib/rumors.ts`, `src/lib/feedSearch.ts` — expose complete media as `editorialImage` and map missing/partial metadata to `null`; tolerate unapplied migration columns.
- [x] `src/components/EditorialArtwork.tsx`, `MarketCard.tsx`, `RumorDetail.tsx` — render cover imagery only when complete media exists, keep non-image cards compact, reset failures when URLs change, and provide accessible attribution.
- [x] `tests/editorial-images.test.mjs`, `tests/auto-curate.test.mjs`, `tests/security-migrations.test.mjs`, `tests-ui/**` — cover quotas/failures, one-per-category invariant, media mapping, clean fallback, and credit behavior.

**Acceptance Criteria:**
- Given multiple eligible polls in one category on the same São Paulo day, when the image job finishes, then only the newest successfully illustrated poll retains editorial media.
- Given six categories with eligible polls, when the feed renders, then each category can have at most one photo card while all other polls remain clean and text-first.
- Given a rendered stock image, when a user reads its credit, then the photographer and Pexels are identified without implying the image depicts the reported event.
- Given Pexels or the new schema is unavailable, when auto-curation runs, then market publication and the existing feed continue successfully.

## Spec Change Log

## Design Notes

Photo cards retain the current 168px featured/220px detail hierarchy. Regular image cards use a restrained 128px crop. Category stays as a small uppercase text kicker; image-less cards begin directly with metadata/headline and never reserve decorative blank space.

## Verification

**Commands:**
- `npm run typecheck` — app TypeScript passes.
- `npm run typecheck:ui` — UI-test TypeScript passes.
- `npm test` — API, migration, assignment, workflow, and contract tests pass.
- `npm run test:ui -- --runInBand` — photo and text-first component regressions pass.
- `npm run web -- --port 8123` — photo winner, attribution, and clean non-image cards render in both themes.

## Suggested Review Order

**Automation and selection**

- Start here: daily orchestration selects winners, deduplicates reconciliation, and fails open.
  [`assign-daily-images.mjs:143`](../scripts/assign-daily-images.mjs#L143)

- Metadata screening rejects unsafe Pexels subjects before storing any image.
  [`editorial-images.mjs:77`](../scripts/editorial-images.mjs#L77)

- Production-only scheduling follows curation and revisits later same-day publications.
  [`assign-daily-images.yml:3`](../.github/workflows/assign-daily-images.yml#L3)

**Database invariants**

- Service-only RPC validates complete metadata before touching the prior winner.
  [`0064_featured_category_editorial_images.sql:62`](../supabase/migrations/0064_featured_category_editorial_images.sql#L62)

- Category-day locking serializes overlapping assignments without race-selected winners.
  [`0064_featured_category_editorial_images.sql:115`](../supabase/migrations/0064_featured_category_editorial_images.sql#L115)

- Database-side newest-winner verification rejects stale job snapshots transactionally.
  [`0064_featured_category_editorial_images.sql:137`](../supabase/migrations/0064_featured_category_editorial_images.sql#L137)

**Client data contract**

- Optional enrichment tolerates unapplied schema and keeps existing feeds available.
  [`rumors.ts:340`](../src/lib/rumors.ts#L340)

- Complete trusted metadata maps to one nullable client image contract.
  [`rumors.ts:377`](../src/lib/rumors.ts#L377)

**Presentation**

- Shared artwork owns attribution, accessibility, and exact-URL failure collapse.
  [`EditorialArtwork.tsx:19`](../src/components/EditorialArtwork.tsx#L19)

- Cards render photos selectively while image-less polls stay compact and text-first.
  [`MarketCard.tsx:41`](../src/components/MarketCard.tsx#L41)

**Verification**

- Backend regressions cover reconciliation, rate limits, safety, and assignment behavior.
  [`editorial-images.test.mjs:159`](../tests/editorial-images.test.mjs#L159)

- UI regression proves stale failures cannot hide a replacement image.
  [`EditorialArtwork.test.tsx:35`](../tests-ui/components/EditorialArtwork.test.tsx#L35)
