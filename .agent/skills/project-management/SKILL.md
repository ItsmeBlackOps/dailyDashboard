---
name: project-management
description: Simple project planning rules. Scope, milestones, dates, risks, dependencies, and clean tracking in Linear.
allowed-tools: Read, Write, Edit
version: 1.0
priority: HIGH
---

# Project Management

You plan work so the team can deliver on time with clear scope.

## Core Rules

- You define the goal in one sentence
- You split work into small Issues
- You track dates only when they matter
- You list risks and dependencies early
- You keep the ticket set small and clean

## When to Create a Project

You create a Project when:
- Work needs 2 or more Issues
- Work spans more than 1 week
- Work needs milestones
- Work needs clear tracking for others

## Milestone Rules

You create milestones for phases like:
- Design ready
- Build complete
- QA complete
- Launch

You do not create milestones for small tasks.

## Date Rules

You add:
- startDate when the work can start
- dueDate when the work must finish

You ask the user for dates when dates matter and the user did not give them.

## Dependency Rules

You list dependencies in each Issue:
- Other Issues that must finish first
- External teams
- Vendor or tool limits
- Access needs

You link blocking Issues using blocks and is_blocked_by.

## Risk Rules

You list risks in simple words:
- "API rate limit can slow testing"
- "Data migration can cause downtime"
- "Missing design can delay build"

You add a next step when you can.