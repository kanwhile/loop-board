import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ageOf, readTask, repoPath, scanTasks, updateNote, Conflict } from "./boards";
import { appendChangesRequested, formatValue, readFields, setField, titleOf } from "./frontmatter";
import { boardButtons, boardText, card, cb, parseCb } from "./messages";
import { diff, emptyState, idFor, rememberReply } from "./state";
import { loopStateFromTranscript, pickLoopPane, ranLoop, wakeLoop, type LoopPane } from "./wake";

const NOTE = `---
status: Ready to Test
order: 202610061646
pr: https://github.com/kanwhile/passadu-v2/pull/147
files_changed: 12
question:
answer:
status_since: 2026-10-06 22:52
done_date:
---

# หน้า health card

เนื้อของเจ้าของ
`;

describe("frontmatter", () => {
  test("อ่านค่าว่างและค่าปกติ", () => {
    const f = readFields(NOTE);
    expect(f.status).toBe("Ready to Test");
    expect(f.question).toBe("");
    expect(f.status_since).toBe("2026-10-06 22:52");
  });

  test("อ่าน quote และค่าหลายบรรทัด", () => {
    const f = readFields(`---\nquestion: "เลือก A: หรือ B?"\nb: 'it''s'\nc: |\n  บรรทัด 1\n  บรรทัด 2\nd: plain\n  ต่อ\n---\n`);
    expect(f.question).toBe("เลือก A: หรือ B?");
    expect(f.b).toBe("it's");
    expect(f.c).toBe("บรรทัด 1\nบรรทัด 2");
    expect(f.d).toBe("plain ต่อ");
  });

  test("setField แก้บรรทัดเดียว บรรทัดอื่นเหมือนเดิม", () => {
    const out = setField(NOTE, "status", "Testing");
    const a = NOTE.split("\n");
    const b = out.split("\n");
    expect(b.length).toBe(a.length);
    expect(a.filter((l, i) => l !== b[i])).toEqual(["status: Ready to Test"]);
    expect(readFields(out).status).toBe("Testing");
  });

  test("setField เขียนค่าที่ไม่ปลอดภัยเป็น quote แล้วอ่านกลับได้ตรง", () => {
    for (const v of ["ไม่ต้องนับ", "นับ: ไม่", "#1 ก่อน", "yes", "42", '"quoted"', "หลาย\nบรรทัด", "- list"]) {
      const out = setField(NOTE, "answer", v);
      expect(readFields(out).answer).toBe(v);
    }
    expect(formatValue("ไม่ต้องนับ")).toBe("ไม่ต้องนับ");
    expect(formatValue("2026-10-06 22:52")).toBe("2026-10-06 22:52");
  });

  test("setField ล้างค่าหลายบรรทัดเดิมออก และเพิ่ม key ที่ไม่มี", () => {
    const multi = `---\nanswer: |\n  เก่า\n  เก่า\nstatus: x\n---\nbody\n`;
    expect(setField(multi, "answer", "ใหม่")).toBe(`---\nanswer: ใหม่\nstatus: x\n---\nbody\n`);
    expect(setField(multi, "new_key", "v")).toContain("new_key: v\n---");
  });

  test("รักษา CRLF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    expect(setField(crlf, "status", "Testing")).toBe(crlf.replace("Ready to Test", "Testing"));
  });

  test("Changes requested ต่อท้ายไฟล์", () => {
    const out = appendChangesRequested(NOTE, "ปุ่มควรอยู่ขวา", "(ส่งจาก Telegram)");
    expect(out.endsWith("เนื้อของเจ้าของ\n\nChanges requested:\n\nปุ่มควรอยู่ขวา\n\n(ส่งจาก Telegram)\n")).toBe(true);
  });

  test("Changes requested วางเหนือ Review notes ของ loop", () => {
    const note = `${NOTE}\n## Review notes\n\n- bot บอกว่า x\n`;
    const out = appendChangesRequested(note, "แก้ y", "(f)");
    expect(out.indexOf("Changes requested:")).toBeLessThan(out.indexOf("## Review notes"));
    expect(out).toContain("เนื้อของเจ้าของ\n\nChanges requested:\n\nแก้ y\n\n(f)\n\n## Review notes");
  });

  test("ถ้ามีบล็อกเก่าใต้ Review notes ต่อท้ายไฟล์ ให้บล็อกใหม่เป็นอันล่างสุด", () => {
    const note = `${NOTE}\n## Review notes\n\n- x\n\nChanges requested:\n\nเก่า\n`;
    const out = appendChangesRequested(note, "ใหม่", "(f)");
    expect(out.lastIndexOf("Changes requested:")).toBeGreaterThan(out.indexOf("เก่า"));
    expect(out.trimEnd().endsWith("(f)")).toBe(true);
  });

  test("titleOf", () => {
    expect(titleOf(NOTE)).toBe("หน้า health card");
  });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "boards-"));
  mkdirSync(join(dir, "demo", "tasks"), { recursive: true });
  writeFileSync(
    join(dir, "demo", "setup.md"),
    "# Setup\n\n## Repositories\n\n| Short name | Path | Default branch |\n| --- | --- | --- |\n| `demo` | `~/code/demo` | `main` |\n\n## Next\n",
  );
  writeFileSync(join(dir, "demo", "tasks", "a.md"), NOTE);
  writeFileSync(join(dir, "demo", "tasks", ".hidden.md"), NOTE);
  return dir;
}

describe("boards", () => {
  test("repoPath อ่านตาราง Repositories และขยาย ~", () => {
    const dir = fixture();
    expect(repoPath(dir, "demo")).toBe(join(process.env.HOME!, "code/demo"));
  });

  test("scanTasks ข้ามไฟล์ซ่อน", () => {
    const tasks = scanTasks(fixture());
    expect(tasks.map((t) => t.key)).toEqual(["demo/a"]);
    expect(tasks[0].title).toBe("หน้า health card");
  });

  test("updateNote เขียนแบบ atomic ไม่ทิ้งไฟล์ชั่วคราว", () => {
    const dir = fixture();
    const t = readTask(dir, "demo", "a")!;
    updateNote(t.path, (s) => setField(s, "status", "Testing"));
    expect(readFields(readFileSync(t.path, "utf8")).status).toBe("Testing");
    expect(readdirSync(join(dir, "demo", "tasks")).sort()).toEqual([".hidden.md", "a.md"]);
  });

  test("updateNote ส่ง Conflict ออกมาโดยไม่แตะไฟล์", () => {
    const dir = fixture();
    const t = readTask(dir, "demo", "a")!;
    expect(() =>
      updateNote(t.path, () => {
        throw new Conflict("x");
      }),
    ).toThrow(Conflict);
    expect(readFileSync(t.path, "utf8")).toBe(NOTE);
  });

  test("ageOf", () => {
    const now = new Date(2026, 9, 6, 23, 52).getTime();
    expect(ageOf("2026-10-06 22:52", now)).toBe("1 ชม.");
    expect(ageOf("2026-10-06 23:52", now)).toBe("เมื่อกี้");
    expect(ageOf("", now)).toBe("");
  });
});

describe("state.diff", () => {
  const task = (status: string, question = "") => ({
    key: "b/t",
    board: "b",
    task: "t",
    path: "",
    status,
    pr: "",
    question,
    answer: "",
    statusSince: "",
    filesChanged: "",
    title: "",
  });

  test("รอบแรกจำอย่างเดียว ไม่ส่ง", () => {
    const s = emptyState();
    expect(diff(s, [task("Ready to Test")])).toEqual([]);
    expect(s.seeded).toBe(true);
    expect(diff(s, [task("Ready to Test")])).toEqual([]);
  });

  test("เข้า Ready to Test ส่งการ์ด", () => {
    const s = emptyState();
    diff(s, [task("Agent Finished")]);
    expect(diff(s, [task("Ready to Test")]).map((n) => n.kind)).toEqual(["card"]);
  });

  test("Needs Input ส่งเมื่อมีคำถาม และส่งใหม่เมื่อคำถามเปลี่ยน", () => {
    const s = emptyState();
    diff(s, [task("In Progress")]);
    expect(diff(s, [task("Needs Input")])).toEqual([]);
    expect(diff(s, [task("Needs Input", "ก?")]).length).toBe(1);
    expect(diff(s, [task("Needs Input", "ก?")]).length).toBe(0);
    expect(diff(s, [task("Needs Input", "ข?")]).length).toBe(1);
  });

  test("Done หลัง Ready to Merge ส่งข้อความ merge แล้ว", () => {
    const s = emptyState();
    diff(s, [task("Ready to Merge")]);
    expect(diff(s, [task("Done")]).map((n) => n.kind)).toEqual(["done"]);
  });

  test("ลบงานที่หายไปออกจาก state", () => {
    const s = emptyState();
    diff(s, [task("To Do")]);
    diff(s, []);
    expect(s.statuses).toEqual({});
  });

  test("id สั้นคงที่ต่อ key และ reply จำกัดจำนวน", () => {
    const s = emptyState();
    expect(idFor(s, "a/b")).toBe(idFor(s, "a/b"));
    expect(idFor(s, "a/c")).not.toBe(idFor(s, "a/b"));
    for (let i = 1; i <= 5; i++) rememberReply(s, i, { key: "k", kind: "answer", expected: "Needs Input" }, 3);
    expect(Object.keys(s.replies)).toEqual(["3", "4", "5"]);
  });
});

describe("messages", () => {
  test("callback_data ไม่เกิน 64 byte และ parse กลับได้", () => {
    const data = cb("zz9", "merge", "Testing");
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseCb(data)).toEqual({ id: "zz9", action: "merge", expected: "Testing" });
    expect(parseCb("evil")).toBeNull();
  });

  const t = readTask(fixture(), "demo", "a")!;

  test("Ready to Test ไม่มีปุ่ม merge", () => {
    const c = card(t, "1");
    const actions = (c.markup as any).inline_keyboard.flat().map((b: any) => parseCb(b.callback_data)!.action);
    expect(actions).toEqual(["test", "chg"]);
  });

  test("Testing มีปุ่ม merge", () => {
    const c = card({ ...t, status: "Testing" }, "1");
    const actions = (c.markup as any).inline_keyboard.flat().map((b: any) => parseCb(b.callback_data)!.action);
    expect(actions).toEqual(["merge", "chg", "back"]);
  });

  test("escape HTML ในชื่อและคำถาม", () => {
    const c = card({ ...t, status: "Needs Input", question: "<b>x</b> & y" }, "1");
    expect(c.text).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(c.replyTarget).toBe("answer");
  });
});

describe("board summary", () => {
  const t = (board: string, task: string, status: string, extra: object = {}) => ({
    key: `${board}/${task}`,
    board,
    task,
    path: "",
    status,
    pr: "",
    question: "",
    answer: "",
    statusSince: "",
    filesChanged: "",
    title: "",
    ...extra,
  });
  const tasks = [
    t("alpha", "done-1", "Done"),
    t("alpha", "wip", "In Progress"),
    t("beta", "csv", "Ready to Test", { pr: "https://github.com/x/y/pull/7" }),
    t("beta", "ask", "Needs Input", { question: "นับลาป่วยไหม?" }),
    t("beta", "typo", "Readdy"),
    t("gamma", "next", "To Do"),
  ];

  test("บอร์ดละบรรทัด ไม่นับศูนย์ บอร์ดที่รอเราขึ้นก่อน", () => {
    const lines = boardText(["alpha", "beta", "gamma"], tasks).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "<b>บอร์ด</b>",
      "<b>beta</b>  รอเรา 2, status ผิด 1",
      "<b>alpha</b>  กำลังทำ 1, เสร็จ 1",
      "<b>gamma</b>  To Do 1",
    ]);
  });

  test("งานที่รอเรา จัดกลุ่มตามบอร์ด คำถามขึ้นก่อน ลิงก์ไป PR", () => {
    const text = boardText(["alpha", "beta", "gamma"], tasks);
    expect(text).toContain(
      '<b>รอเรา 2 งาน</b>\n\n<b>beta</b>\nถามมา  ask\n<i>นับลาป่วยไหม?</i>\nพร้อมตรวจ  <a href="https://github.com/x/y/pull/7">csv</a>',
    );
    expect(text).not.toContain("<pre>");
  });

  test("ปุ่มเรียงเหมือนข้อความ", () => {
    const rows = boardButtons(["alpha", "beta", "gamma"], tasks, (k) => k.length.toString(36));
    expect(rows.map((r) => r[0].text)).toEqual(["ถามมา: ask", "พร้อมตรวจ: csv"]);
  });

  test("ไม่มีงานรอเรา", () => {
    expect(boardText(["alpha"], [t("alpha", "x", "Done")])).toBe("<b>บอร์ด</b>\n<b>alpha</b>  เสร็จ 1\n\nไม่มีงานรอเรา");
  });
});

describe("wake", () => {
  const line = (input: object, ts: string) =>
    JSON.stringify({ timestamp: ts, message: { content: [{ type: "tool_use", name: "ScheduleWakeup", input }] } });
  const now = Date.parse("2026-10-06T17:00:00Z");

  test("stop:true ล่าสุด = หยุด", () => {
    const tail = [line({ delaySeconds: 60 }, "2026-10-06T16:00:00Z"), line({ stop: true }, "2026-10-06T16:30:00Z")].join("\n");
    expect(loopStateFromTranscript(tail, now)).toEqual({ kind: "stopped" });
  });

  test("ตั้งปลุกไว้และยังไม่ถึง = scheduled", () => {
    const tail = line({ delaySeconds: 1800, prompt: "/loop /babysit-prs" }, "2026-10-06T16:50:00Z");
    expect(loopStateFromTranscript(tail, now)).toEqual({ kind: "scheduled", dueAt: Date.parse("2026-10-06T17:20:00Z") });
  });

  test("เลยเวลาปลุกมานาน = ถือว่าหยุด", () => {
    const tail = line({ delaySeconds: 60 }, "2026-10-06T16:00:00Z");
    expect(loopStateFromTranscript(tail, now)).toEqual({ kind: "stopped" });
  });

  test("ไม่มี ScheduleWakeup = unknown, บรรทัดเสียไม่พัง", () => {
    expect(loopStateFromTranscript('{"x":1}\nnot json "ScheduleWakeup"', now)).toEqual({ kind: "unknown" });
  });

  test("นับเป็น loop เฉพาะ session ที่สั่ง /loop /babysit-prs จริง", () => {
    const human = JSON.stringify({ message: { content: "<command-name>/loop</command-name>\n<command-args>/babysit-prs</command-args>" } });
    const wakeup = line({ delaySeconds: 60, prompt: "/loop /babysit-prs" }, "2026-10-06T16:00:00Z");
    const setup = JSON.stringify({ message: { content: "<command-name>/set-up-the-board</command-name> copy skills/babysit-prs/SKILL.md" } });
    expect(ranLoop(human)).toBe(true);
    expect(ranLoop(wakeup)).toBe(true);
    expect(ranLoop(setup)).toBe(false);
  });

  test("เลือก pane ที่เป็น loop และล่าสุด", () => {
    const p = (paneId: string, isLoop: boolean, mtime: number): LoopPane => ({
      session: "s",
      paneId,
      name: "",
      status: "idle",
      transcript: null,
      mtime,
      isLoop,
    });
    expect(pickLoopPane([p("a", false, 9), p("b", true, 1), p("c", true, 5)])!.paneId).toBe("c");
    expect(pickLoopPane([p("a", false, 9)])).toBeNull();
  });

  // จำลอง herdr: session เดียว มี claude อยู่ใน repo
  function fakeHerdr(status: string, name = "loopdemo") {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "session") return { code: 0, out: JSON.stringify({ sessions: [{ name: "demo", running: true }] }) };
      if (args.includes("snapshot"))
        return {
          code: 0,
          out: JSON.stringify({
            result: { snapshot: { agents: [{ agent: "claude", cwd: "/no/such/repo", pane_id: "w1:p1", name, agent_status: status }] } },
          }),
        };
      return { code: 0, out: "" };
    };
    return { run, calls };
  }

  test("loop idle และไม่มี transcript ส่ง /loop /babysit-prs เข้า pane", async () => {
    const h = fakeHerdr("idle");
    const r = await wakeLoop(h.run, "/no/such/repo");
    expect(r.kind).toBe("woken");
    expect(h.calls.at(-1)).toEqual(["--session", "demo", "agent", "prompt", "w1:p1", "/loop /babysit-prs"]);
  });

  test("loop กำลังทำงาน ไม่ส่งอะไร", async () => {
    const h = fakeHerdr("working");
    expect((await wakeLoop(h.run, "/no/such/repo")).kind).toBe("running");
    expect(h.calls.some((c) => c.includes("prompt"))).toBe(false);
  });

  test("ไม่มี pane ที่เป็น loop", async () => {
    const h = fakeHerdr("idle", "other");
    expect((await wakeLoop(h.run, "/no/such/repo")).kind).toBe("none");
  });
});
