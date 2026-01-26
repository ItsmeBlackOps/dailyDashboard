---
name: linear-ticketing
description: Rules for writing clean Linear Projects and Issues with PM-level clarity. Titles, descriptions, acceptance checks, labels, dates, links, PR tracking.
allowed-tools: Read, Write, Edit, Grep, Glob
version: 1.0
priority: CRITICAL
---

# Linear Ticketing

You write tickets that people can build without guessing.

## Title Rules

- Use a verb at the start
- Keep it short
- Put the user goal in the title

Good:
- "Add email OTP login"
- "Fix invoice total rounding"
- "Create audit log for role changes"

Bad:
- "Login updates"
- "Bug fixes"
- "Improve system"

## Description Template (Always Use)

You write these sections in this order:

- Context: Why this work exists
- Goal: What result the user wants
- Scope: What you will do
- Non-scope: What you will not do
- Dependencies: What blocks this work
- Risks: What can go wrong
- Acceptance checks: What must be true for done
- Links: URLs to docs, designs, PRs, related Issues

## Acceptance Checks Rules

- You write checks that someone can test
- You avoid vague words like "works well" or "better"
- You include edge cases when the user mentions them

Example:
- "System rejects invalid email format"
- "System locks account after 5 failed tries"
- "Admin can reset lock from the admin page"

## Priority Rules

You use:
- 1 Urgent: production broken, hard date today
- 2 High: blocks other work, near date
- 3 Medium: normal planned work
- 4 Low: nice to have, no date need

## Status Rules

- Backlog: missing key facts or not planned
- Todo: ready to start
- In Progress: work started
- In Review: review or QA started
- Done: acceptance checks pass

## Labels Rules

You use labels for:
- Area: backend, frontend, api, db, infra, mobile
- Type: feature, bug, tech-debt, chore
- Tracking: pr, tracking
- Product: billing, auth, search (only if the org uses them)

You keep label names short.

## Subtask Rules

You create subtasks when:
- Work has 3 or more clear steps
- Work has a setup step that blocks others
- Work needs different roles

You keep each subtask small and testable.

## Link Rules

You add links for:
- Main Issue → PR tracking Issue (always when code work exists)
- Issue → Issue when one blocks the other
- Issue → doc/design links

You use link types:
- relates_to
- blocks
- is_blocked_by
- duplicates

## PR Tracking Issue Rules

You create one PR tracking Issue per main Issue that needs code changes.

You set:
- Title: "PR Tracking: <main issue title>"
- Labels: ["pr","tracking"]
- Link: relates_to main Issue
- Description fields: repo, branch, PR URL, review needs, merge checks

You keep PR tracking separate from the main Issue so the main Issue stays about the user goal.