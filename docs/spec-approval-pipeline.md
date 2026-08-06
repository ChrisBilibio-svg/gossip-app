# Spec — Market Approval & Scheduling Pipeline (Phase 2)

Status: **design spec, not yet wired.** No live actions, no DDL applied. This
describes the approval queue, lifecycle, atomic publication contract and audit
model to be implemented in migration `0045` + `gossip-admin/admin.html` **after**
the Supabase migration ledger is repaired and verified. It is the human-review
layer on top of the deterministic screen (`scripts/screen.mjs`) and the existing
server-side fixed-market mechanism (`service_approve_fixed_market_probabilities`,
`validate_fixed_market_probabilities`, `request_fixed_prediction_quote`,
`place_fixed_prediction`).

## 1. Non-negotiables

- No candidate becomes public without **explicit human approval**.
- The client (`admin.html`) never holds `SUPABASE_SERVICE_ROLE_KEY`. All
  privileged actions go through a **curator-authorized SECURITY DEFINER RPC**
  (or a protected Edge Function), authenticated as the logged-in curator.
- `prediction_deadline` = **actual publication time + 7 days** — computed
  server-side at publish, never from article time or draft-creation time.
- Publication is **atomic**: rumor goes public only if the fixed-probability
  version + both outcomes are created and validated in the same transaction.
- `purchases_killed=true` is never touched by this pipeline.

## 2. Lifecycle states

A market moves through explicit states (new `market_state` column, additive):

| state | meaning | who sets |
|---|---|---|
| `draft` | ingested, not yet screened/reviewed | ingest |
| `needs_review` | screened, curator attention required | screen |
| `approved` | curator approved, awaiting publish (immediate) | curator |
| `scheduled` | approved with a future `scheduled_publish_at` | curator |
| `published` | live, `is_draft=false`, deadline set, fixed version created | publish RPC |
| `rejected` | curator or screen rejected | curator/screen |
| `publish_failed` | atomic publish rolled back; returned to queue | publish RPC |

`published` is the only state where `is_draft=false`. Scheduling never flips
`is_draft` on the client — the scheduler invokes the same publish RPC.

## 3. Reviewer view (per candidate)

The queue card shows, all read from the screening record + rumor:

- Proposed **question** (editable).
- **Context / article** copy (editable).
- **Category** (editable).
- All **source links + source labels** (from `rumor_evidence_sources`), with
  cluster/duplicate info (`duplicate_market_id`, `event_key`).
- **Safety decision** + `reason_codes`, `claim_type`, `sensitive_claim`.
- Explicit **"no minor materially involved"** confirmation checkbox (curator
  must affirm; screen's `minor_subject`/`age_unknown_possible_minor` shown).
- **Objective resolution rule** (editable; must be non-null to publish).
- Proposed **publication time** (editable; immediate or scheduled).
- **7-day resolve-by** preview, recomputed live from the chosen publish time.
- Suggested initial **Verdade/Mentira probability** (editable; must sum to 1,
  each within economy bounds 0.10–0.90).
- **Why suitable** for trading (screen `review_notes` + curator note).

Actions: **Reject**, **Request changes** (back to `needs_review` with note),
**Approve now**, **Schedule** (pick time). Every action writes an immutable
audit record (section 5).

## 4. Atomic publication RPC (contract only)

`publish_approved_market(p_rumor_id uuid, p_true_probability numeric,
p_false_probability numeric, p_publish_at timestamptz, p_approval_reference text,
p_idempotency_key text)` — SECURITY DEFINER, `search_path=public`. Steps, all in
one transaction:

1. **Authorize**: caller must be `is_curator(auth.uid())`; else raise.
2. **Lock + revalidate** the draft row `FOR UPDATE`; confirm it is `approved`
   or `scheduled` and not already `published` (idempotency via
   `p_idempotency_key` → return existing result if replayed).
3. **Verify deadline not already passed**: `p_publish_at + 7d > now()`; else
   raise (no expired-on-publish markets).
4. Set publication time = `p_publish_at` (default `now()`).
5. `prediction_deadline = p_publish_at + interval '7 days'`.
6. Create the canonical fixed **probability version** via
   `service_approve_fixed_market_probabilities(...)`.
7. Create **Verdade** and **Mentira** `prediction_outcomes`.
8. `validate_fixed_market_probabilities(...)` — probabilities sum to exactly 1;
   else raise.
9. Record the **approval/audit reference** (section 5).
10. Only if all above succeed: set `is_draft=false`, `status='speculated'`,
    `market_state='published'`.

**Rollback rule:** any failure (esp. probability init) rolls back the whole
transaction; the rumor stays unpublished and is moved to `publish_failed` (via a
separate, post-rollback status write by the caller) so it returns to the queue.
`request_fixed_prediction_quote` must succeed immediately after commit.
Odds are never computed or trusted client-side; 5% house edge + 45s server quote
unchanged.

## 5. Immutable approval/audit record

New additive table `market_approval_audit` (append-only; no update/delete policy):

- `id`, `rumor_id`, `actor_id` (curator), `action` (approve/schedule/reject/
  request_changes/publish/publish_failed), `at` timestamptz.
- `screening_snapshot jsonb` — the full `screenCandidate` result at decision time.
- `decision_fields jsonb` — final edited question/category/sources/resolution
  rule/publish time/true+false probability.
- `approval_reference text`, `idempotency_key text`.

### Obsidian export shape (DB-independent)

The record serializes to Markdown + YAML front-matter without any model change,
e.g.:

```yaml
---
rumor_id: <uuid>
action: publish
actor: "@curator"
at: 2026-07-23T15:00:00Z
category: Música
publish_at: 2026-07-23T15:00:00Z
prediction_deadline: 2026-07-30T15:00:00Z
true_probability: 0.40
false_probability: 0.60
safety_decision: approve_candidate
reason_codes: [no_future_event_signal_cleared]
sources:
  - {label: g1, url: https://g1.globo.com/...}
---
Question: <proposed_question>
Objective resolution rule: <rule>
Why suitable: <notes>
```

Export is a later sync step; the DB is the system of record.

## 6. Tests to accompany implementation (post-unblock)

migration apply/rollback, `log_product_event` fingerprint no-op, clean-schema
replay, authorization (non-curator rejected), atomic rollback when probability
init fails, idempotent republish, scheduled publish uses the RPC, deadline =
publish + 7d, probabilities sum to 1, `purchases_killed` unchanged.
