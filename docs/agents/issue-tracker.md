# Issue Tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues at `Karikatun/anomaly-detector`. Use the `gh` CLI for issue operations after it is installed and authenticated.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`.
- Read an issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open` with appropriate filters.
- Comment: `gh issue comment <number> --body "..."`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Infer the repository from `origin`. When a skill says to publish to the issue tracker, create a GitHub Issue. When it says to fetch a ticket, use `gh issue view <number> --comments`.

## Pull Requests As A Triage Surface

External pull requests are not a request surface. Triage only GitHub Issues. Pull requests remain the delivery mechanism for already agreed work.
