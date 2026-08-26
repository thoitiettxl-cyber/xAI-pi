<!-- pi-continuity-work-document: {"schemaVersion":1,"kind":"execution-plan","workItemId":"7ca6ad6a-7fdb-4114-af5b-5be3902efcf4","templateVersion":1} -->

# Execution Plan: Commit and push onboarding open-work pointers

Date: 2026-08-26

## Status

Active

## Outcome

The confirmed AGENTS.md and docs/ARCHITECTURE.md onboarding pointers are committed on main and pushed to origin/main, without staging unrelated worktree files.

## Authority And Context

- User request after confirmed Shared Understanding: commit + push.
- In-scope product edits are only the three onboarding pointer strings in AGENTS.md and docs/ARCHITECTURE.md.
- Do not mix unrelated worktree paths: deleted docs/plans/active/agentrouter-vietnamese-language-adapter.md, untracked docs/plans/active/commit-push-xai-compact.md, untracked docs/plans/completed/.
- Remote origin is https://github.com/thoitiettxl-cyber/xAI-pi.git. Branch main is already ahead of origin/main by commit 80fa3e0 (feat adapter). A push of main publishes that commit plus this docs commit.
- No force push, rebase, amend, PR, /reload, or extension install.

## Scope

In scope:

- Stage AGENTS.md and docs/ARCHITECTURE.md pointer edits.
- Keep this execution plan as the durable work document for the commit and push.
- Create one Conventional Commit for those intended files.
- Push main to origin.
- Verify the new commit is on origin/main.

Out of scope:

- Staging or restoring the deleted adapter plan, commit-push-xai-compact.md, or docs/plans/completed/.
- Code, tests, host extension copy, /reload.
- Force push, history rewrite, PR, or GitHub release.
- Changing Status/Result in other plans or moving files out of docs/plans/active/.

## Constraints

- Conventional Commits subject; no sign-off; no breaking-change footer.
- Do not use git add on unrelated dirty or untracked paths.
- Do not print credentials.
- Preserve unrelated worktree files.

## Approach

- Bind this execution plan as durable work truth.
- Stage only AGENTS.md, docs/ARCHITECTURE.md, and this plan file.
- Commit with subject docs(agents): separate open work from specs in plans/active.
- Push main to origin (publishes 80fa3e0 plus this commit).
- Verify status/log against origin/main.

## Risks And Recovery

- Push publishes already-local 80fa3e0 as well as the docs commit. Recovery: git revert on main and push; do not force-push.
- Push failure leaves local commits intact; retry git push origin main.
- Accidental staging of unrelated files: unstage before commit; if committed, revert that commit.

## Progress

- [ ] Implement the approved outcome.
- [ ] Run behavior-appropriate and repository-required proof.
- [ ] Record the verified result before finalization.

## Decisions

- No task-local decision recorded yet.

Promote lasting product or architecture decisions into repository-owned decision documentation only after authority exists.

## Validation

- git diff --cached contains only intended paths before commit.
- git log -1 shows the new docs commit locally.
- After push, main is not ahead of origin/main for these commits.
- Unrelated dirty/untracked files remain unstaged.

## Result

Pending implementation and executable proof.
