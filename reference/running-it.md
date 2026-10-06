# Running it

## Starting

From the repo root, with the board readable by the session:

```bash
claude --add-dir ~/board
```

To make that permanent, put the absolute path in `permissions.additionalDirectories` in
`.claude/settings.json`. `~` may not expand there, so use the full path.

Then:

```
/loop /babysit-prs
```

**No interval, on purpose.** Supplying one turns it into a cron job that runs until you stop it or it
expires, and a cron loop can't end itself. Bare `/loop` is self-paced: the model picks the delay after
each pass — short while a PR is active, longer once things go quiet — and it can end the loop by
calling `ScheduleWakeup` with `stop: true` once the board says nothing can move without you.

If a pass ever ends without rescheduling or stopping, you get one fallback wakeup about 20 minutes
later, and the loop ends if that pass doesn't reschedule either. A missed stop costs one extra pass,
not a runaway.

**Watch the first pass** rather than backgrounding it. The review gate is the part most likely to be
subtly wrong, and the first pass is where that shows.

Then background it: press `←` on an empty prompt, or run `/bg`. Pick the permission mode before you
background it — the loop inherits the session's mode, and `auto` and `bypassPermissions` are refused
for background sessions until you've accepted that mode once interactively.

## Watching

```bash
claude agents
```

A sleeping loop shows as `✢` with its run count and a countdown. Any PR it opens gets a `PR #N` label
colored by status: yellow for waiting on checks or review, green for passed and unblocked, red for
changes requested, gray for draft. Gray means the un-draft step didn't run.

## Stopping

| | |
|---|---|
| `Esc` while it's waiting | clears the pending wakeup, ends the loop |
| `claude stop <id>` | from the shell |
| `Ctrl+X` twice in agent view | deletes the session **and its worktree**, discarding uncommitted work in it |
| `CLAUDE_CODE_DISABLE_CRON=1` | turns the scheduler off entirely |

## Daily use

Set `status: Testing` on something before you start testing it. That makes it immune to the combine
rule and to everything else, so you can work through the queue without the loop reshuffling what you
haven't reached yet.

Then `Ready to Merge` if it's good, or `Needs Changes` with a `Changes requested:` block in the body
if it isn't. Those two and `Testing` are the only statuses you set.

## Getting told when you're needed

The board is the source of truth: a blocked task gets `status: Needs Input` and a `question`, and
answering means filling in the `answer` cell. That works with nothing else set up and it can't
silently fail. Anything below is a nudge on top of it.

Channels are two-way, so the nudge and the answer can be the same message. Telegram, Discord, and
iMessage ship as plugins. Each is a Bun script, so `bun --version` needs to work first.

```
/plugin install telegram@claude-plugins-official
/telegram:configure <bot-token>
```

```bash
claude --add-dir ~/board --channels plugin:telegram@claude-plugins-official
```

```
/telegram:access pair <code>
/telegram:access policy allowlist
```

That last line locks the channel to your account. Only sender IDs you've paired can push messages in;
everyone else is dropped silently. **That matters more than usual here**, because anyone who can
message the bot can put text in front of a session authorized to push code and merge PRs.

Then add a line to `babysit-prs/SKILL.md`: after any pass that sets a task to `Needs Input`, send the
question through the channel.

Test with fakechat first (`/plugin install fakechat@claude-plugins-official`, chat UI on localhost,
nothing to authenticate). Channel events only arrive while the session is open, so whether a channel
survives `/bg` is worth checking for yourself; if it doesn't, run the session in tmux instead. Telegram
also has no message history, so anything sent while the session is down is gone. The board doesn't have
that problem, which is why the board is the source of truth.

### Several boards, one bot

A channel lives inside one session, so it covers one board and goes quiet whenever that session is
down. `telegram/` is a standalone bot for running several boards under `~/boards` instead. It
watches every board's frontmatter, pushes `Ready to Test` and `Needs Input`, sets `Testing`,
`Ready to Merge`, and `Needs Changes` (with its `Changes requested:` block) from buttons, writes
`answer` from a reply, and then restarts the board's loop in herdr if it had stopped. Setup is in
[telegram/README.md](../telegram/README.md).

## Things that will bite

**A stopped loop doesn't watch the board.** If it stopped because everything was at `Needs Input` and
you answer by filling in `answer`, nothing happens until you run `/loop /babysit-prs` again. Answering
through a channel avoids this, since the session is still alive and the reply arrives as an event.

**Loops only fire while the agent is running and idle.** There's no catch-up for fires missed during a
long request.

**Recurring scheduled tasks expire.** If you use `/schedule` rather than `/loop`, check its expiry —
the task fires one final time, then deletes itself.

**Each pass is a real turn against your usage limits.** Three workers doing real work adds up faster
than it looks. Self-paced mode helps by stretching the gaps when the board is quiet, but watch the
first day with `/cost`.

**A worktree can be cut from a stale base.** `origin/HEAD` is only as fresh as your last fetch. Run
`git remote set-head origin -a` once at setup, and expect the occasional branch that doesn't contain a
PR that merged minutes ago.
