# Comment Format Reference

All AI-generated comments on Linear issues should follow these templates for consistency.

## Triage Comment

```markdown
## 🔍 AI Triage Analysis

**Issue:** {IDENTIFIER} — {TITLE}

### Assessment
- **Size:** {Small | Medium | Large} ({N} files estimated)
- **Risk:** {Low | Medium | High}
- **Confidence:** {High | Medium | Low}

### Relevant Files
{List of files that will likely need changes, with brief notes}

- `src/components/Auth.tsx` — main auth component to modify
- `src/services/auth.service.ts` — backend auth logic
- `src/tests/auth.test.ts` — existing tests to update

### Approach
{1-3 sentences describing the recommended implementation approach}

### Potential Concerns
{Any risks, dependencies, or edge cases to watch for. Omit section if none.}

---
*AI triage complete. Move to **In Progress** to begin implementation.*
```

## Worker Status Comment

```markdown
🤖 Worker spawned.

**Branch:** `{BRANCH_NAME}`
**Container:** `{CONTAINER_ID}`
```

## Worker Completion Comment

```markdown
🤖 Worker completed successfully.

**Branch:** `{BRANCH_NAME}`
**PR:** {PR_URL}
```

## Worker Failure Comment

```markdown
🤖 Worker failed.

**Branch:** `{BRANCH_NAME}`
**Error:** {ERROR_MESSAGE}
```

## Worker Timeout Comment

```markdown
🤖 Worker timed out after {TIMEOUT}s.

**Branch:** `{BRANCH_NAME}`
```

## Review Comment

```markdown
## 🔎 AI Code Review

**PR:** {PR_URL}
**Severity:** {clean | low | medium | high | critical}

### Summary
{1-2 sentence overview of the changes and overall quality}

### Findings

{If clean: "No issues found. Code looks good to merge."}

{If issues found, list each:}

#### {Finding Title}
- **Severity:** {low | medium | high | critical}
- **File:** `{file_path}:{line}`
- **Issue:** {description of the problem}
- **Suggestion:** {how to fix it}

---

{If clean/low:}
*AI review complete — no blocking issues. Ready for human review.*

{If medium+:}
*AI review found issues. Sending back for revision ({N}/{MAX_REVIEW_CYCLES} cycles).*
```

## Revision Worker Comment

```markdown
🤖 Revision worker spawned to address review feedback.

**Branch:** `{BRANCH_NAME}`
**Review cycle:** {N}/{MAX_REVIEW_CYCLES}
```

## Escalation Comment

```markdown
🤖 Maximum AI review cycles ({MAX_REVIEW_CYCLES}) reached. Escalating to human review.

The following issues remain unresolved:
{List of remaining findings}
```

## @agent Response Comment

```markdown
🤖 {RESPONSE_BODY}
```

## Error Comment

```markdown
🤖 State machine error: {ERROR_DESCRIPTION}

**Skill:** {skill_name}
**Action:** {action attempted}

{Additional context if available}
```

## Queue Manager Comment

```markdown
🤖 Pulled from queue — starting implementation.

**Queue position:** was #{N}
**Priority:** {priority_label}
```

## Guidelines

- Always prefix AI comments with the 🤖 emoji
- Use markdown formatting for readability
- Include relevant identifiers (branch, container, PR URL) for traceability
- Keep comments concise — link to PRs/branches instead of duplicating content
- Error messages should be actionable — tell the user what to do next
