# Label Scheme Reference

This document defines all labels used by the AI workflow pipeline. Labels are workspace-level in Linear and can be created using `scripts/setup-labels.sh`.

## Workflow Labels (Top-Level)

| Label | Color | Meaning | Applied By |
|-------|-------|---------|------------|
| `ai-work` | `#4EA7FC` | Issue marked for AI agent processing | Human |
| `ai-triaged` | `#BB87FC` | Issue analyzed by AI triage against codebase | Triage skill |
| `ai-implementing` | `#F2994A` | Worker actively coding this issue | Implement skill |
| `ai-review-pending` | `#F2C94C` | Implementation complete, awaiting AI code review | Worker (on completion) |
| `ai-revision` | `#F2994A` | Review found issues, sent back for fixes | Review skill |
| `needs-human-review` | `#EB5757` | Max AI review cycles reached, human review required | Review / Revision skill |

## AI Review Severity Labels (Group: "AI Review")

| Label | Color | Meaning |
|-------|-------|---------|
| `ai-review:clean` | `#4CB782` | Code review found no issues |
| `ai-review:low` | `#4CB782` | Code review highest severity: Low |
| `ai-review:medium` | `#F2C94C` | Code review highest severity: Medium |
| `ai-review:high` | `#F2994A` | Code review highest severity: High |
| `ai-review:critical` | `#EB5757` | Code review highest severity: Critical |

## Error Labels

| Label | Color | Meaning |
|-------|-------|---------|
| `agent-failed` | `#e74c3c` | Worker failed (timeout, error, etc.) — created on demand |

## Repo Label Group

- **Group name**: Configurable via `REPO_LABEL_GROUP` env var (default: `Repo`)
- **Child labels**: One per repository
  - **Name**: Repository shortname (e.g., `my-app`)
  - **Description**: SSH Git URL (e.g., `git@github.com:org/my-app.git`)
- Added by humans in Linear workspace settings

## Label Flow

```
Human adds ai-work
  → Triage adds ai-triaged
    → Issue moved to In Progress
      → Implement adds ai-implementing
        → Worker completes, adds ai-review-pending, removes ai-implementing
          → Review adds ai-review:*, removes ai-review-pending
            → If clean/low: move to In Review (human)
            → If medium+: add ai-revision → Revision cycle
              → If max cycles: add needs-human-review
```

## Label Mutation Pattern

To add a label to an issue via the Linear API:

1. Fetch the label ID by name:
```graphql
{ issueLabels(filter: { name: { eq: "LABEL_NAME" } }) { nodes { id } } }
```

2. Fetch the issue's current labels:
```graphql
{ issue(id: "ISSUE_ID") { labels { nodes { id } } } }
```

3. Update the issue with the combined label IDs:
```graphql
mutation { issueUpdate(id: "ISSUE_ID", input: { labelIds: ["existing-id-1", "new-label-id"] }) { success } }
```

To remove a label: same pattern but exclude the label ID from the array.
