# loop-board

A task board an agent can work on its own, and the rules that make it safe to leave running.

You put work on a board. A self-paced loop picks it up, hands each task to a worker in an isolated
git worktree, opens a PR, drives the checks green, iterates on review feedback, and parks the result
where you can test it. You test, and you say merge or say what's wrong. It never touches your
checkout, it can't set the statuses that mean "a human looked at this," and it stops by itself when
nothing can move without you.

This is the generalized form of a setup that ran ~100 tasks through it in about a week. Almost every
design decision in it is a *constraint* — something the agent is not allowed to do — and the
constraints are what make the throughput possible rather than what limits it.

## Install

Clone it, and install the onboarding skill so you can invoke it:

```bash
git clone https://github.com/<you>/loop-board ~/loop-board
mkdir -p ~/.claude/skills
cp -R ~/loop-board/skills/set-up-the-board ~/.claude/skills/
cp -R ~/loop-board/skills/review-pr ~/.claude/skills/   # optional: used by `board review --claude`
```

**Restart your agent session now.** The file watcher only covers directories that existed when the
session started, so a brand-new `skills` directory isn't picked up in the session you created it from.
If the skill seems not to exist, this is why.

Then, from inside the repo you want it to work on:

```
/set-up-the-board
```

It interviews you in four rounds and writes your `setup.md` from the answers, then puts the loop skill
and the worker where your repo expects them. Defaults are supplied for everything, so "defaults are
fine" is a complete answer. The round that matters most is the second one, which asks how *you* know a
change is ready to look at — checks green, a review too, a bot that posts a comment — because that
single answer decides what the loop waits for and what it's allowed to merge.

To do it by hand instead: copy `board/` to `~/board`, copy `agents/task-worker.md` to
`<your-repo>/.claude/agents/`, copy `skills/babysit-prs/` to `<your-repo>/.claude/skills/`, and edit
`board/setup.md`. Restart the session afterwards, for the same reason as above.

### Requirements

- An agent runner that supports **worktree-isolated subagents**, recent enough that a command
  resolving outside the worktree fails rather than running in your main checkout. The whole "never
  touch my checkout" guarantee rests on that check.
- A forge CLI, installed and authenticated (`gh` for GitHub).
- `.claude/worktrees/` in your repo's `.gitignore`.
- `git remote set-head origin -a`, so worktrees branch from the real default branch rather than a
  stale cached one.
- Optionally Obsidian, for a nicer view of the board. Not required — see
  [reference/viewing-the-board.md](reference/viewing-the-board.md).

## Running it

```bash
claude --add-dir ~/board
```

```
/loop /babysit-prs
```

No interval, on purpose: a fixed-interval loop is a cron job that can't end itself. Bare `/loop` is
self-paced and stops when the board says nothing can move. Watch the first pass before you background
it — the review gate is the part most likely to be subtly wrong.

Full details in [reference/running-it.md](reference/running-it.md).

## How it works

Three layers, each doing one thing:

| Layer | Does | Never does |
| --- | --- | --- |
| **Protocol** (`board/protocol.md`) | the rules | — |
| **Loop** (`skills/babysit-prs`) | reads the board, runs the forge CLI, writes frontmatter, dispatches | writes code, touches a working tree |
| **Worker** (`agents/task-worker.md`) | writes code in its own worktree, reports back | touches the board, talks to you |
| **Reviewer** (`skills/review-pr`) | reads a PR waiting in Ready to Test, writes a decision card for you | edits anything, comments on the PR, sets a status |

The board is a folder of markdown files, one per task, with `status` in the frontmatter. Ten statuses,
and each one names who's allowed to set it. Three are yours alone — `Testing`, `Needs Changes`,
`Ready to Merge` — and the loop cannot set them. That's what makes it safe to leave running: the
transitions meaning "a human looked at this" can't be manufactured by the thing being reviewed.

The loop also keeps a memory of what the process has learned, with hard caps per section. When an
entry describing something *broken* has been confirmed four times, it stops being a memory and becomes
a task to fix it at the source.

## What's here

```
board/
  protocol.md          the rules; shared, don't edit per-project
  setup.md             your answers; the only file that varies
  memory.md            what the process has learned (starts empty)
  board.base           optional Obsidian views
  templates/           new-task templates, with and without Templater
  tasks/               one note per task
skills/
  set-up-the-board/    the onboarding interview
  babysit-prs/         one pass of the protocol
  review-pr/           decision card for a PR, run by `board review --claude`
agents/
  task-worker.md       the worktree-isolated worker
reference/
  design-notes.md      why each piece is shaped this way
  running-it.md        starting, watching, stopping, notifications, gotchas
  viewing-the-board.md with Obsidian, or with grep
.worktreeinclude.example
```

`protocol.md` is meant to stay shared, so you can pull improvements. Everything project-specific goes
in `setup.md`, which is why the protocol points at it rather than guessing.

## What this is not

**It is not hands-off.** You groom the queue and you test the output, and in practice you'll be the
bottleneck at both ends long before the agent is. That's the honest shape of it: the loop closes the
gap between "the code is basically right" and "the work is actually merged," which is a real and
annoying gap, but it is not the whole job.

**It is not free.** Each pass is a real turn against your usage limits, and three workers doing real
work adds up faster than it looks. Watch the first day.

**It does not review its own work.** The merge gate is whatever your repo already has — your checks,
your reviewer. If your repo has no automated review, the loop hands changes to you on checks alone and
says so. It doesn't invent a quality bar, so make sure you have one of your own.

## Reading

- [reference/design-notes.md](reference/design-notes.md) — why one note per task, why the board lives
  outside the repo, why memory has caps, why entries graduate into work
- [Loop engineering: getting started with loops](https://claude.com/blog/getting-started-with-loops) —
  the four-rung model this sits on

## License

MIT
