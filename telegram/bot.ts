#!/usr/bin/env bun
// loop-board Telegram bot: เตือนงานที่รอเรา, กดปุ่มเปลี่ยน status, reply เพื่อตอบคำถาม, ปลุก loop ใน herdr
//
//   bun telegram/bot.ts          รันบอท (long polling, ใช้กับ launchd)
//   bun telegram/bot.ts whoami   ดู Telegram user id ของคนที่ทักบอทมา (ใช้ตอนตั้งค่า)
//   bun telegram/bot.ts check    ดูว่าบอทเห็นบอร์ดอะไร และหา loop ของแต่ละบอร์ดใน herdr เจอไหม (ไม่ต่อ Telegram)
//
// ตั้งค่าใน ~/.config/loop-board-bot/env (chmod 600) ดู telegram/README.md
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Conflict, listBoards, nowStamp, readTask, repoPath, scanTasks, updateNote, type Task } from "./boards";
import { appendChangesRequested, readFields, setField } from "./frontmatter";
import { boardButtons, boardText, card, changesPrompt, doneText, esc, HELP, parseCb, wakeText } from "./messages";
import { diff, idFor, loadState, rememberReply, saveState, type ReplyTarget } from "./state";
import { telegram, TelegramError } from "./telegram";
import { herdrRunner, loopStateFromTranscript, findLoopPanes, pickLoopPane, readTail, wakeLoop, type WakeResult } from "./wake";

const HOME = homedir();
const expand = (p: string) => p.replace(/^~(?=\/|$)/, HOME);

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  if (statSync(path).mode & 0o077) console.warn(`[warn] ${path} อ่านได้จากคนอื่น ควร chmod 600`);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvFile(expand(process.env.ENV_FILE ?? "~/.config/loop-board-bot/env"));

const BOARDS_DIR = expand(process.env.BOARDS_DIR ?? "~/boards");
const STATE_FILE = expand(process.env.STATE_FILE ?? "~/.local/state/loop-board-bot/state.json");
const POLL_MS = Math.max(1, Number(process.env.POLL_SECONDS ?? 10)) * 1000;
const HERDR_BIN = process.env.HERDR_BIN ?? (existsSync(`${HOME}/.local/bin/herdr`) ? `${HOME}/.local/bin/herdr` : "herdr");
const LOOP_WAKE = process.env.LOOP_WAKE !== "0";
const WAKE_RETRY_MS = 30 * 60 * 1000;
const FLOOD = 8;

function tokenFromKeychain(): string | undefined {
  const r = Bun.spawnSync(["security", "find-generic-password", "-s", "loop-board-bot", "-a", "telegram", "-w"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return r.exitCode === 0 ? r.stdout.toString().trim() || undefined : undefined;
}

const herdr = herdrRunner(HERDR_BIN);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// ---------- check / whoami ----------

async function check(): Promise<void> {
  const boards = listBoards(BOARDS_DIR);
  console.log(`BOARDS_DIR ${BOARDS_DIR} (${boards.length} บอร์ด)`);
  const tasks = scanTasks(BOARDS_DIR);
  for (const b of boards) {
    const repo = repoPath(BOARDS_DIR, b);
    console.log(`\n${b}\n  repo   ${repo ?? "(อ่านจาก setup.md ไม่ได้)"}`);
    for (const t of tasks.filter((t) => t.board === b && ["Ready to Test", "Testing", "Needs Input"].includes(t.status))) {
      console.log(`  รอเรา  ${t.status}  ${t.task}`);
    }
    if (!repo) continue;
    try {
      const panes = await findLoopPanes(herdr, repo);
      for (const p of panes) console.log(`  pane   ${p.session} ${p.paneId} ${p.name || "-"} ${p.status}${p.isLoop ? " (loop)" : ""}`);
      const loop = pickLoopPane(panes);
      if (!loop) {
        console.log("  loop   ไม่เจอ");
        continue;
      }
      const st = loop.transcript ? loopStateFromTranscript(readTail(loop.transcript), Date.now()) : { kind: "unknown" };
      const due = st.kind === "scheduled" ? ` ปลุกตอน ${new Date((st as any).dueAt).toLocaleTimeString()}` : "";
      console.log(`  loop   ${loop.session} ${loop.paneId} สถานะ ${st.kind}${due}`);
    } catch (e) {
      console.log(`  herdr  ${(e as Error).message}`);
    }
  }
}

async function whoami(token: string): Promise<void> {
  const bot = telegram(token);
  const ups = await bot.call<any[]>("getUpdates", { timeout: 0 });
  if (!ups.length) {
    console.log("ยังไม่มีข้อความ ทัก bot ใน Telegram สักข้อความแล้วรันใหม่");
    return;
  }
  for (const u of ups) {
    const m = u.message ?? u.callback_query;
    if (m?.from) console.log(`user id ${m.from.id}  @${m.from.username ?? "-"}  ${m.from.first_name ?? ""}  chat ${m.chat?.id ?? m.message?.chat?.id}`);
  }
}

// ---------- bot ----------

function acquireLock(): void {
  const lock = join(dirname(STATE_FILE), "bot.pid");
  mkdirSync(dirname(lock), { recursive: true });
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try {
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        console.error(`บอทรันอยู่แล้ว (pid ${pid})`);
        process.exit(1);
      }
    } catch {
      // pid ตายไปแล้ว เอา lock ต่อได้
    }
  }
  writeFileSync(lock, String(process.pid));
  const release = () => {
    try {
      if (Number(readFileSync(lock, "utf8")) === process.pid) unlinkSync(lock);
    } catch {}
  };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
}

async function run(token: string, owner: number): Promise<void> {
  acquireLock();
  const bot = telegram(token);
  const state = loadState(STATE_FILE);
  const save = () => saveState(STATE_FILE, state);

  const splitKey = (key: string) => {
    const i = key.indexOf("/");
    return [key.slice(0, i), key.slice(i + 1)] as const;
  };
  const taskOf = (key: string): Task | null => {
    const [b, t] = splitKey(key);
    return readTask(BOARDS_DIR, b, t);
  };

  async function sendCard(t: Task, replyTo?: number): Promise<void> {
    const id = idFor(state, t.key);
    const c = card(t, id);
    const msg = await bot.send(owner, c.text, c.markup, replyTo);
    if (c.replyTarget === "answer") {
      rememberReply(state, msg.message_id, { key: t.key, kind: "answer", expected: "Needs Input", question: t.question });
    }
    save();
  }

  async function refreshCard(messageId: number, t: Task): Promise<void> {
    const c = card(t, idFor(state, t.key));
    await bot.edit(owner, messageId, c.text, c.markup);
  }

  async function wake(board: string, replyTo?: number): Promise<void> {
    if (!LOOP_WAKE) {
      await bot.send(owner, wakeText(board, { kind: "none" }, false), undefined, replyTo);
      return;
    }
    const repo = repoPath(BOARDS_DIR, board);
    const r: WakeResult = repo ? await wakeLoop(herdr, repo) : { kind: "error", message: "อ่าน repo จาก setup.md ไม่ได้" };
    if (r.kind === "busy") state.wakes[board] ??= Date.now();
    else delete state.wakes[board];
    save();
    log("wake", board, r.kind);
    await bot.send(owner, wakeText(board, r, true), undefined, replyTo);
  }

  // เปลี่ยน status แบบ compare-and-swap: ถ้าไฟล์ไม่ได้อยู่ที่ expected แล้วจะไม่เขียน
  function setStatus(t: Task, expected: string, next: string, extra?: (text: string) => string): void {
    updateNote(t.path, (text) => {
      const cur = readFields(text).status ?? "";
      if (cur !== expected) throw new Conflict(`สถานะเปลี่ยนเป็น ${cur || "(ว่าง)"} แล้ว`);
      let n = extra ? extra(text) : text;
      n = setField(n, "status", next);
      return setField(n, "status_since", nowStamp());
    });
    state.statuses[t.key] = next;
    save();
  }

  const ALLOWED: Record<string, string[]> = {
    test: ["Ready to Test"],
    merge: ["Testing"],
    back: ["Testing"],
    chg: ["Ready to Test", "Testing"],
  };

  async function onCallback(q: any): Promise<void> {
    const p = parseCb(q.data ?? "");
    const messageId: number = q.message?.message_id;
    if (!p) return bot.answerCallback(q.id);
    const key = state.ids[p.id];
    const t = key ? taskOf(key) : null;
    if (!t) return bot.answerCallback(q.id, "ไม่เจองานนี้แล้ว");

    if (p.action === "card") {
      await bot.answerCallback(q.id);
      return sendCard(t);
    }
    if (!p.expected || t.status !== p.expected || !ALLOWED[p.action].includes(t.status)) {
      await bot.answerCallback(q.id, `ตอนนี้เป็น ${t.status} แล้ว ปุ่มนี้เก่าไป`);
      return refreshCard(messageId, t);
    }

    try {
      switch (p.action) {
        case "test":
          setStatus(t, p.expected, "Testing");
          await bot.answerCallback(q.id, "Testing แล้ว loop จะไม่แตะงานนี้");
          await refreshCard(messageId, readTask(BOARDS_DIR, t.board, t.task)!);
          return;
        case "back":
          setStatus(t, p.expected, "Ready to Test");
          await bot.answerCallback(q.id, "กลับไป Ready to Test แล้ว");
          await refreshCard(messageId, readTask(BOARDS_DIR, t.board, t.task)!);
          return;
        case "merge":
          setStatus(t, p.expected, "Ready to Merge");
          await bot.answerCallback(q.id, "Ready to Merge แล้ว");
          await bot.edit(owner, messageId, `<b>สั่ง merge แล้ว</b>  [${esc(t.board)}] <code>${esc(t.task)}</code>`);
          log("merge", t.key);
          await wake(t.board, messageId);
          return;
        case "chg": {
          await bot.answerCallback(q.id);
          const msg = await bot.send(owner, changesPrompt(t), { force_reply: true, input_field_placeholder: "ต้องแก้อะไร" });
          rememberReply(state, msg.message_id, { key: t.key, kind: "changes", expected: t.status });
          save();
          return;
        }
      }
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await bot.answerCallback(q.id, e.message);
      const now = readTask(BOARDS_DIR, t.board, t.task);
      if (now) await refreshCard(messageId, now);
    }
  }

  async function onReply(m: any, target: ReplyTarget): Promise<void> {
    const t = taskOf(target.key);
    const text: string = (m.text ?? "").trim();
    if (!t) return void (await bot.send(owner, "ไม่เจอไฟล์งานนี้แล้ว", undefined, m.message_id));
    if (!text) return void (await bot.send(owner, "ส่งเป็นข้อความเท่านั้น", undefined, m.message_id));

    try {
      if (target.kind === "answer") {
        updateNote(t.path, (note) => {
          const f = readFields(note);
          if (f.status !== "Needs Input") throw new Conflict(`งานนี้เป็น ${f.status || "(ว่าง)"} แล้ว ไม่ได้รอคำตอบ`);
          if ((f.question ?? "") !== (target.question ?? "")) throw new Conflict("คำถามเปลี่ยนไปแล้ว ดูการ์ดใหม่ด้วย /board");
          if (f.answer) throw new Conflict("มีคำตอบอยู่แล้ว");
          return setField(note, "answer", text);
        });
        delete state.replies[String(m.reply_to_message.message_id)];
        save();
        log("answer", t.key);
        await bot.send(owner, `บันทึกคำตอบลง <code>${esc(t.task)}</code> แล้ว`, undefined, m.message_id);
      } else {
        setStatus(t, target.expected, "Needs Changes", (note) =>
          appendChangesRequested(note, text, `(ส่งจาก Telegram ${nowStamp()})`),
        );
        delete state.replies[String(m.reply_to_message.message_id)];
        save();
        log("changes", t.key);
        await bot.send(owner, `เปลี่ยน <code>${esc(t.task)}</code> เป็น Needs Changes แล้ว`, undefined, m.message_id);
      }
      await wake(t.board, m.message_id);
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await bot.send(owner, `ไม่ได้เขียน: ${esc(e.message)}`, undefined, m.message_id);
    }
  }

  async function boardSummary(): Promise<void> {
    const boards = listBoards(BOARDS_DIR);
    const tasks = scanTasks(BOARDS_DIR);
    const rows = boardButtons(boards, tasks, (key) => idFor(state, key));
    save();
    await bot.send(owner, boardText(boards, tasks), rows.length ? { inline_keyboard: rows } : undefined);
  }

  async function onMessage(m: any): Promise<void> {
    const reply = m.reply_to_message?.message_id;
    const target = reply ? state.replies[String(reply)] : undefined;
    if (target) return onReply(m, target);
    const text: string = m.text ?? "";
    if (/^\/board\b/.test(text)) return boardSummary();
    if (/^\/(start|help)\b/.test(text)) return void (await bot.send(owner, HELP));
    await bot.send(owner, "reply ที่การ์ดคำถามหรือข้อความขอแก้ หรือพิมพ์ /board", undefined, m.message_id);
  }

  // รับเฉพาะเจ้าของ ในแชตส่วนตัว นอกนั้นเงียบ
  const fromOwner = (u: any) => {
    if (u.message) return u.message.from?.id === owner && u.message.chat?.id === owner && u.message.chat?.type === "private";
    if (u.callback_query) return u.callback_query.from?.id === owner && u.callback_query.message?.chat?.id === owner;
    return false;
  };

  async function tick(): Promise<void> {
    const notes = diff(state, scanTasks(BOARDS_DIR));
    save();
    if (notes.length > FLOOD) {
      await bot.send(owner, `มีงานเปลี่ยนสถานะพร้อมกัน ${notes.length} งาน ดูด้วย /board`);
    } else {
      for (const n of notes) {
        if (n.kind === "done") await bot.send(owner, doneText(n.task));
        else await sendCard(n.task);
        log("notify", n.kind, n.task.key, n.task.status);
      }
    }
    for (const [board, since] of Object.entries(state.wakes)) {
      if (Date.now() - since > WAKE_RETRY_MS) {
        delete state.wakes[board];
        save();
        await bot.send(owner, `ปลุก loop ของ ${esc(board)} ไม่สำเร็จใน 30 นาที session ยังไม่ว่าง สั่ง /loop /babysit-prs เองนะ`);
        continue;
      }
      const repo = repoPath(BOARDS_DIR, board);
      if (!repo) continue;
      const r = await wakeLoop(herdr, repo);
      if (r.kind === "busy") continue;
      delete state.wakes[board];
      save();
      log("wake-retry", board, r.kind);
      if (r.kind !== "running" && r.kind !== "scheduled") await bot.send(owner, wakeText(board, r, true));
    }
  }

  let ticking = false;
  const loopTick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tick();
    } catch (e) {
      log("tick error", (e as Error).message);
    } finally {
      ticking = false;
    }
  };

  await bot.setCommands().catch((e) => log("setMyCommands", e.message));
  await loopTick();
  setInterval(loopTick, POLL_MS);
  log(`เริ่มแล้ว: ${listBoards(BOARDS_DIR).join(", ")} (เช็กทุก ${POLL_MS / 1000} วินาที, ปลุก loop ${LOOP_WAKE ? "เปิด" : "ปิด"})`);

  for (;;) {
    let updates: any[];
    try {
      updates = await bot.getUpdates(state.offset);
    } catch (e) {
      if (e instanceof TelegramError && e.code === 409) log("token นี้มีบอทอีกตัวกำลัง poll อยู่");
      else if (e instanceof TelegramError && e.code === 401) {
        log("token ไม่ถูกต้อง");
        process.exit(1);
      } else log("getUpdates", (e as Error).message);
      await sleep(5000);
      continue;
    }
    for (const u of updates) {
      // ขยับ offset ก่อนทำ: ถ้าพังกลางทาง จะไม่ทำซ้ำ (เขียนไฟล์มี compare-and-swap กันอยู่แล้ว)
      state.offset = u.update_id + 1;
      save();
      if (!fromOwner(u)) continue;
      try {
        if (u.callback_query) await onCallback(u.callback_query);
        else if (u.message) await onMessage(u.message);
      } catch (e) {
        log("update error", (e as Error).message);
        await bot.send(owner, `เกิดข้อผิดพลาด: ${esc((e as Error).message)}`).catch(() => {});
      }
    }
  }
}

// ---------- main ----------

const mode = process.argv[2] ?? "run";
if (mode === "check") {
  await check();
} else {
  const token = process.env.TELEGRAM_BOT_TOKEN || tokenFromKeychain();
  if (!token) {
    console.error("ไม่มี TELEGRAM_BOT_TOKEN (ใส่ใน ~/.config/loop-board-bot/env หรือ Keychain) ดู telegram/README.md");
    process.exit(1);
  }
  if (mode === "whoami") {
    await whoami(token);
  } else {
    const owner = Number(process.env.TELEGRAM_OWNER_ID);
    if (!Number.isSafeInteger(owner) || owner <= 0) {
      console.error("ไม่มี TELEGRAM_OWNER_ID หา id ของตัวเองด้วย: bun telegram/bot.ts whoami");
      process.exit(1);
    }
    await run(token, owner);
  }
}
