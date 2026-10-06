---
name: set-up-the-board
description: Use when installing the loop board for the first time in a repository, when the board has no setup.md yet, or when the way a project signals "ready for review" has changed and the loop's gates no longer match it.
---

# Set up the board

Interview the owner, then write `board/setup.md` from their answers and put the pieces where the loop
expects them. `protocol.md` holds the rules and never changes per-person; `setup.md` holds everything
that does.

## First, find the source

You're copying files out of a `loop-board` clone. It's usually at `~/loop-board`, and the copy of this
skill you're reading came from its `skills/` directory. If you can't find it, ask for the path rather
than reconstructing the files from memory — a hand-written `protocol.md` will drift from the shared
one and stop getting improvements.

## The output

When you're done, all of these exist and the owner has seen them:

1. `<board>/setup.md` — their answers, in the section order of the shipped template
2. `<board>/protocol.md`, `<board>/board.base`, `<board>/memory.md`, `<board>/tasks/`,
   `<board>/templates/` — copied from this repo, memory empty. In `board.base`, rewrite
   `file.inFolder("tasks")` to `file.inFolder("<short name>/tasks")`: `~/boards` is opened as one
   Obsidian vault, so Bases paths start there.
3. `<repo>/.claude/agents/task-worker.md` and `<repo>/.claude/skills/babysit-prs/SKILL.md`
4. `<repo>/.worktreeinclude`, and `.claude/worktrees/` in `<repo>/.gitignore`
5. A one-screen summary of what you set and what they still have to do by hand

## Interview

Ask in four rounds, not one question at a time. Give the default with each question so "defaults are
fine" is a complete answer and they can skip to the parts they care about.

**Round 1 — the work**

| Ask | Default |
| --- | --- |
| Which repositories, where, and what's each default branch? | the current repo |
| Where should the board live? | `~/boards/<short name>` — the folder name is the repo's short name |
| Does a task's brief live in the note, or in an issue tracker you'd link to? | in the note |

**Round 2 — what "ready" means.** This round decides more of the loop's behavior than the other
three combined. Don't accept a one-word answer to the first question; the follow-ups depend on it.

| Ask | Default |
| --- | --- |
| **How do you know a change is ready for you to look at?** Checks green? A review too? Nothing but a PR? | checks green |
| If a review: does your forge record a formal approval, or does a bot post a comment? | none |
| If a bot comment: which account posts it, what exact phrase means yes, and does it skip draft PRs? | — |
| Do you test manually before merge, or is green enough? | test manually |
| Who merges, and by squash, merge, or rebase? | the loop, once you mark Ready to Merge; squash |

The bot-comment case is the one that goes wrong quietly. A comment carries no commit reference, so
ask how a comment can be tied back to a specific commit — usually a CI run link in the body. If there
is no way to tie them, say so plainly: the gate can only ever mean "some review passed at some point",
and they should prefer a formal review state if their forge offers one.

**Round 3 — limits**

| Ask | Default |
| --- | --- |
| How many tasks in flight at once? | 3 |
| What must the agent never touch? | your main checkout |
| Where should maintenance work land when a memory entry graduates? | `To Do` |
| Two small finished changes on the same surface — fold them into one review, under how many files? | 30 |

**Round 4 — running it**

| Ask | Default |
| --- | --- |
| Install, build, test, and lint commands? | read them from the repo and propose them |
| Can a worker start the app and look at a real UI? If so, how? | not reachable |
| Any gitignored files a fresh worktree needs? | `.env` |

Read the repo before asking Round 4 — its README, its package manifest, its CI workflow. Propose what
you found and ask them to correct it. Asking someone to type commands you could have read is the same
failure the protocol calls out for task questions.

"Can a worker look at the app" is worth pushing on. If the answer is no, workers verify with automated
checks alone and say so in `## Verified`, which is honest and fine. If the answer is yes but fiddly —
a port, an env var, a login — capture the actual steps, because a worker that half-knows how to start
the app will produce a confident verification of a page that never rendered.

## Writing setup.md

Fill the shipped template section by section, in its order. Replace the defaults with their answers;
keep any section they didn't change. Delete the commented-out alternatives for the review shapes they
didn't pick — leaving all three in place is how a later pass reads the wrong one.

Where an answer means a rule in `protocol.md` doesn't apply, say so in `setup.md` in one line rather
than editing `protocol.md`. Two examples: no automated review means `Agent Finished` judges on checks
alone; no manual testing means the loop sets `Ready to Merge` itself and `Testing` goes unused.

## Checks before you finish

Run these and report what failed rather than fixing it silently:

- The agent runner supports worktree isolation for subagents, and its version is recent enough that a
  command resolving outside the worktree fails instead of running in the main checkout. The whole
  "never touch my checkout" guarantee rests on that.
- The forge CLI is installed and authenticated.
- `.claude/worktrees/` is in the repo's `.gitignore`.
- `git remote set-head origin -a` has been run, so worktrees branch from the real default branch
  rather than a stale cached one.
- The board path is readable by the agent session — on Claude Code that means `--add-dir <board>` or
  `permissions.additionalDirectories`.
- `board check` (from `bin/board` in this repo) shows no `FAIL` line. It re-checks most of the above
  for every board under `~/boards`, so a FAIL on another board is worth reporting too.

## Finish

Show them: where the board is, what the review gate resolved to, what the loop will and won't do on
its own, and the command to start it: `board open <short name>`, then `/loop /babysit-prs`. Then
tell them the first pass is worth watching rather than backgrounding, because the review gate is the
part most likely to be subtly wrong and the first pass is where that shows.

Don't seed `memory.md`. It's worth something only because it was earned one task at a time, and
guesses about a codebase teach the loop to trust things nobody checked.
