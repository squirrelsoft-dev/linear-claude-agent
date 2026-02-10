# Guard Rules Reference

These rules MUST be checked before taking certain actions. They prevent runaway costs, infinite loops, and resource exhaustion.

## WIP Limit

- **Rule:** Never exceed `MAX_WIP` concurrent workers (default: 3)
- **Check:** `docker ps --filter "name=worker-" --format "{{.Names}}" | wc -l`
- **Action if exceeded:** Post comment on issue, do NOT spawn worker, leave issue in current state

## Review Cycle Limit

- **Rule:** Never exceed `MAX_REVIEW_CYCLES` review iterations (default: 3)
- **Check:** Count comments containing "AI Code Review" or "Review Findings" on the issue
- **Action if exceeded:** Remove `ai-revision` label, add `needs-human-review` label, post escalation comment

## Bounce-Back Prevention

- **Rule:** Ignore "In Progress" webhooks that are bounce-backs from GitHub integration
- **Check:** Look for worker completion comment in last 2 minutes
- **Action if detected:** Move issue back to "In Review", do NOT spawn worker

## Duplicate Worker Prevention

- **Rule:** Never spawn two workers for the same issue
- **Check:** `docker ps --filter "name=worker-${IDENTIFIER,,}-" --format "{{.Names}}" | wc -l`
- **Action if detected:** Post comment noting existing worker, do NOT spawn another

## Worker Timeout

- **Rule:** Workers have a maximum runtime of `WORKER_TIMEOUT` seconds (default: 1800 = 30min)
- **Enforcement:** The worker-entrypoint.sh handles this internally via a watchdog process
- **Note:** The PM Agent doesn't need to enforce this — the worker self-terminates

## Rate Limiting

- **Rule:** Don't process the same webhook event twice
- **Check:** Before acting, verify the issue's current state via API (not just from webhook data)
- **Action if stale:** Log "Stale webhook — issue state has changed" and STOP

## Label Consistency

- **Rule:** An issue should only have ONE of these labels at a time:
  - `ai-implementing`
  - `ai-review-pending`
  - `ai-revision`
- **Check:** Before adding any of these, remove the others
- **Exception:** `ai-work` and `ai-triaged` can coexist with any workflow label

## Error Budget

- **Rule:** If 3 consecutive workers fail for the same issue, stop retrying
- **Check:** Count recent comments containing "Worker failed" for this issue
- **Action if exceeded:** Add `needs-human-review` label, post comment: "Multiple worker failures. Manual intervention required."

## Summary of Limits

| Guard | Default | Env Var | Scope |
|-------|---------|---------|-------|
| Max concurrent workers | 3 | `MAX_WIP` | Global |
| Max review cycles | 3 | `MAX_REVIEW_CYCLES` | Per issue |
| Worker timeout | 1800s | `WORKER_TIMEOUT` | Per worker |
| Bounce-back window | 120s | — | Per issue |
| Max consecutive failures | 3 | — | Per issue |
