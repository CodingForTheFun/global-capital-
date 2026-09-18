---
description: Working on Oblige Props code that another agent (ChatGPT or a prior Claude session) may also be actively developing, or deciding whether to change, replace, or remove existing ingestion, persistence, or provider code.
applies: Modifying, deleting, or rewriting ingestion, persistence, provider, or scheduler code that already exists and works in production.
does_not_apply: Adding a genuinely new, isolated module that nothing else depends on or conflicts with.
---
ChatGPT and Claude collaborate on this same production application. Treat all
Oblige Props chats, branches, commits, deployments, and prior agent work as one
continuous project.

- Do not compete with, undo, overwrite, or rebuild work completed correctly by
  another agent. If another agent is actively working on an area (check recent
  commits and open branches), build on that work instead of starting a
  competing implementation.
- Preserve working production behavior, APIs, authentication, customer data,
  environment variables, provider contracts, and deployment configuration
  unless a change is specifically requested and understood.
- Reconcile overlapping work instead of creating duplicate implementations of
  the same feature.
- Never fabricate data, weaken authentication or security, expose secrets, or
  make destructive production or database changes without explicit
  authorization from the user.
- When in doubt about whether an area is "owned" by another agent's in-flight
  work, write a handoff doc (see docs/) rather than silently changing it.
