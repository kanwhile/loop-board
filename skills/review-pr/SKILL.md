---
name: review-pr
description: "Review a PR or task from loop-board or GitHub. Audits Spec alignment, Standards & Smells, Blast Radius, and Honest Verification evidence. Outputs a human-friendly Decision Card with a clear verdict (LGTM / Smoke Test / Changes Requested)."
---

Review a pull request (from loop-board or GitHub) to protect human reviewer time and catch defects before merging.

Instead of requiring the human to manually read every line of a 20-file diff or replicate complex multi-step test instructions, this skill audits the change across 4 distinct axes and synthesizes a **Human Review Decision Card**.

## Read-only — the reviewer never acts on the human's behalf

This skill is run by whichever CLI the human picked (`board review … --claude|--grok|--codex|--agy`). The rules and the output format are the same for all of them.

- Do not edit, commit, push, or check out branches in the repo. Reading files and running read-only checks (`gh pr diff`, `gh pr view`, tests against a local DB, `git log`) is fine; leave the working tree exactly as you found it.
- Do not post comments, reviews, or approvals on the PR, and never merge. The card is the only output.
- Do not change any task file under `~/boards/`. `Ready to Merge` and `Needs Changes` are set by the human (see `board/protocol.md`); tell them what to set, don't set it.
- Never touch remote infrastructure (remote D1, deployed Workers, production env). If a claim can only be verified remotely, say so and leave it to the human.

## Input

Accept any of:
- A PR number or URL (e.g. `165`, `#165`, or `https://github.com/kanwhile/passadu-v2/pull/165`)
- A loop-board task name or file path (e.g. `160-org-picker-plan-labels` or `~/boards/passadu-v2/tasks/160-org-picker-plan-labels.md`)
- If run without arguments, inspect the current branch / git status, or check `gh pr list` for open PRs associated with the current branch.

## Process

### 1. Resolve PR, Repo, and Task Brief

1. Identify the repo and PR number:
   - Use `gh pr view <PR> --json number,title,body,url,headRefName,baseRefName,files,reviews,author,additions,deletions`
2. Identify the originating task or issue:
   - Look for linked issues in the PR title or body (e.g. `Closes #160`, `#160`).
   - If found, fetch issue details: `gh issue view <issue> --json title,body,labels,comments`
   - If this repo belongs to a loop-board (`~/boards/<board-name>`), search for the corresponding task file in `~/boards/<board-name>/tasks/*.md` matching the PR URL or issue number. Read the brief from the task file.
3. Fetch the full diff:
   - Run `gh pr diff <PR>` (or `git diff <base>...<head>` if local checkout is available).
   - If diff is too large, inspect `gh pr diff <PR> --stat` and view key changed files.

### 2. Inspect Codebase Standards & Rules

Check if the repo has:
- `CLAUDE.md` / `AGENTS.md` (check for architecture guidelines, port restrictions, verification commands)
- `CODING_STANDARDS.md` / `CONTRIBUTING.md` / ADRs in `docs/adr/`

### 3. Evaluate Across 4 Axes

Audit the change against these 4 specific axes:

#### Axis 1: Spec Alignment & Scope Creep
- Does the implementation faithfully deliver what the issue/task asked for?
- Did the worker add speculative generality, unrelated refactorings, or modify files outside the brief?
- Did the worker note any deliberate compromises or deviations in the PR body?

#### Axis 2: Code Quality & Baseline Smells
- Check for classic Fowler smells:
  - *Mysterious Name*: unclear functions or variables.
  - *Duplicated Code*: copy-pasting logic across multiple endpoints/components.
  - *Primitive Obsession*: using raw strings/numbers where typed constants/enums are standard.
  - *Speculative Generality*: unused parameters, premature abstractions.
- Security & Secrets: Are any API keys, tokens, hardcoded production URLs, or sensitive data committed?
- Typing & Error Handling: Are edge cases handled? Are null/undefined checks safe?

#### Axis 3: Blast Radius & Merge Danger
- **Door type**: Is this a **two-way door** (easy to revert, isolated UI/text change) or a **one-way door** (database migration, destructive schema change, remote production worker config)?
- **Blast Radius**: What else could break?
  - DB migrations: Do they run safely? Are they backwards compatible?
  - Shared state / APIs: Does it change contract schemas?
  - Environment / Ports: Does it alter runtime environment variables or hardcoded ports?

#### Axis 4: Honest Verification Audit
- Does the PR include a `## Verified` section?
- **Verify credibility**:
  - Did the worker actually run test commands (`npm test`, `npm run verify`, `vitest`, etc.) and provide exit codes/pass counts?
  - Are screenshots or artifacts attached for visual changes? Check whether referenced image files actually exist.
  - Did the worker document what *could not* be verified and why (honest failure)?
  - Are there signs of hallucinated verification (e.g. claiming a page was verified when the server wasn't running)?

---

### 4. Synthesize the Human Review Decision Card

Output the final review in this structured, actionable markdown format:

````markdown
# 📋 Review Decision Card: PR #<number> — <Title>
**Repo:** `<owner/repo>` · **PR:** [<number>](<url>) · **Branch:** `<head>` → `<base>`

---

## 🎯 Verdict: <🟢 LGTM (Ready to Merge) | 🟡 Needs Quick Smoke Test | 🔴 Changes Requested>

> **Summary:** <1-2 clear sentences summarizing the verdict and whether the human should test or merge directly.>

---

### 🔍 4-Axis Audit Summary

| Axis | Status | Key Finding |
|---|---|---|
| **1. Spec & Scope** | <✅ Pass / ⚠️ Deviation / ❌ Mismatch> | <Brief finding> |
| **2. Code Quality** | <✅ Clean / ⚠️ Smells / ❌ Defect> | <Brief finding> |
| **3. Blast Radius** | <🟢 Two-way door / 🔴 One-way door> | <Scope & blast radius> |
| **4. Honest Verification**| <🛡️ Strong Evidence / ⚠️ Partial / ❌ Dishonest> | <Test count, screenshot proof, or gaps> |

---

### 💡 High-Risk Lines / Gotchas (if any)
- `<file:line>`: <Explanation of subtle risk, edge case, or gotcha>
*(If none, state: "None identified — changes are tightly scoped.")*

---

### ⚡ Fastest Route for Human Verification (≤ 1 minute)
<Specific advice on how Gun can verify this with minimal effort. E.g.:>
- *"No need to boot dev stack: inspect screenshot before/after at `docs/shots/...` in PR body."*
- OR *"Run: `curl ...` / open `http://localhost:.../path` to verify [X]."*

---

### 🎬 Next Step / Action
<Choose the appropriate action block:>

<!-- If 🟢 LGTM: -->
**Mark Ready to Merge** (only you can set this; the loop re-verifies and merges on its next pass):
```bash
board approve <board> <task>
```

<!-- If 🟡 Smoke Test: -->
**After the smoke test passes:** `board approve <board> <task>` · if it fails, use the reject command below with what you saw.

<!-- If 🔴 Changes Requested: -->
**Request Changes** (sets `Needs Changes` and appends the block the loop acts on):
```bash
board reject <board> <task> "- <Exact feedback item 1>
- <Exact feedback item 2>"
```
````

The commands above are for the human to run. You never run `board approve` or `board reject` yourself.

Keep the report concise, objective, and focused on making the human decision effortless.
