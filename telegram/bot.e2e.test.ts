// รันบอทจริงคู่กับ Telegram ปลอม แล้วไล่ flow ทั้งหมดบนบอร์ดชั่วคราว
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFields } from "./frontmatter";

const OWNER = 4242;
const STRANGER = 666;

type Sent = { method: string; params: any; message_id: number };
const sent: Sent[] = [];
const queue: any[] = [];
let nextUpdate = 1;
let nextMessage = 100;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const method = new URL(req.url).pathname.split("/").pop()!;
    const params: any = await req.json().catch(() => ({}));
    if (method === "getUpdates") {
      const ups = queue.filter((u) => u.update_id >= (params.offset ?? 0));
      if (!ups.length) await Bun.sleep(100);
      return Response.json({ ok: true, result: ups });
    }
    const message_id = nextMessage++;
    sent.push({ method, params, message_id });
    return Response.json({ ok: true, result: method === "sendMessage" ? { message_id } : true });
  },
});

const dir = mkdtempSync(join(tmpdir(), "tgbot-e2e-"));
const boards = join(dir, "boards");
const tasks = join(boards, "demo", "tasks");
mkdirSync(tasks, { recursive: true });
writeFileSync(join(boards, "demo", "setup.md"), "## Repositories\n\n| `demo` | `/nowhere` | `main` |\n");

const note = (status: string, extra = "") =>
  `---\nstatus: ${status}\norder: 1\npr: https://github.com/x/y/pull/7\nfiles_changed: 3\nquestion:${extra}\nanswer:\nstatus_since: 2026-10-06 10:00\ndone_date:\n---\n\nเพิ่มปุ่ม Export CSV\n`;
const file = (name: string) => join(tasks, `${name}.md`);
writeFileSync(file("csv"), note("Agent Finished"));
writeFileSync(file("ask"), note("In Progress"));

let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(["bun", join(import.meta.dir, "bot.ts")], {
    env: {
      ...process.env,
      TELEGRAM_API_BASE: `http://127.0.0.1:${server.port}`,
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_OWNER_ID: String(OWNER),
      BOARDS_DIR: boards,
      STATE_FILE: join(dir, "state", "state.json"),
      ENV_FILE: join(dir, "no-env"),
      POLL_SECONDS: "1",
      LOOP_WAKE: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await Bun.sleep(1500); // รอบแรกจำสถานะ ไม่ส่งอะไร
});

afterAll(() => {
  proc?.kill();
  server.stop(true);
});

const until = async <T>(fn: () => T | undefined, ms = 5000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(50);
  }
};
const messages = () => sent.filter((s) => s.method === "sendMessage");
const lastSentIndex = () => sent.length;
const push = (u: object) => queue.push({ update_id: nextUpdate++, ...u });
const tap = (data: string, messageId: number, from = OWNER) =>
  push({ callback_query: { id: `cq${nextUpdate}`, from: { id: from }, data, message: { message_id: messageId, chat: { id: from } } } });
const say = (text: string, replyTo?: number, from = OWNER) =>
  push({
    message: {
      message_id: 1000 + nextUpdate,
      from: { id: from },
      chat: { id: from, type: "private" },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  });
const buttons = (s: Sent) => (s.params.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => [b.text, b.callback_data]);
const statusOf = (name: string) => readFields(readFileSync(file(name), "utf8")).status;

test("รอบแรกไม่ยิงแจ้งเตือนของที่ค้างอยู่", () => {
  expect(messages().length).toBe(0);
});

test("Ready to Test ส่งการ์ดที่มีแค่ เริ่มทดสอบ กับ ขอแก้", async () => {
  writeFileSync(file("csv"), note("Ready to Test"));
  const c = await until(() => messages().find((m) => m.params.text.includes("พร้อมตรวจ")));
  expect(c.params.chat_id).toBe(OWNER);
  expect(c.params.text).toContain("PR #7");
  expect(buttons(c).map((b: string[]) => b[0])).toEqual(["เริ่มทดสอบ", "ขอแก้"]);
});

test("คนอื่นกดปุ่มไม่มีผล", async () => {
  const c = messages().find((m) => m.params.text.includes("พร้อมตรวจ"))!;
  const before = lastSentIndex();
  tap(buttons(c)[0][1], c.message_id, STRANGER);
  say("/board", undefined, STRANGER);
  await Bun.sleep(800);
  expect(statusOf("csv")).toBe("Ready to Test");
  expect(sent.length).toBe(before);
});

test("เริ่มทดสอบ แล้วการ์ดเปลี่ยนเป็นมีปุ่ม Merge", async () => {
  const c = messages().find((m) => m.params.text.includes("พร้อมตรวจ"))!;
  tap(buttons(c)[0][1], c.message_id);
  const edit = await until(() => sent.find((s) => s.method === "editMessageText" && s.params.text.includes("กำลังทดสอบ")));
  expect(statusOf("csv")).toBe("Testing");
  expect(readFields(readFileSync(file("csv"), "utf8")).status_since).not.toBe("2026-10-06 10:00");
  expect(buttons(edit).map((b: string[]) => b[0])).toEqual(["Merge ได้", "ขอแก้", "ยังไม่ทดสอบ (กลับไป Ready to Test)"]);
});

test("ปุ่มเก่า (เริ่มทดสอบ) กดซ้ำถูกปฏิเสธ", async () => {
  const c = messages().find((m) => m.params.text.includes("พร้อมตรวจ"))!;
  tap(buttons(c)[0][1], c.message_id);
  const ans = await until(() => sent.find((s) => s.method === "answerCallbackQuery" && /เก่าไป/.test(s.params.text ?? "")));
  expect(ans).toBeTruthy();
  expect(statusOf("csv")).toBe("Testing");
});

test("ขอแก้: ถาม แล้ว reply เขียนบล็อก Changes requested และเปลี่ยนเป็น Needs Changes", async () => {
  const edit = sent.find((s) => s.method === "editMessageText" && s.params.text.includes("กำลังทดสอบ"))!;
  tap(buttons(edit)[1][1], edit.message_id);
  const prompt = await until(() => messages().find((m) => m.params.reply_markup?.force_reply));
  say("ปุ่มควรอยู่ขวาบน", prompt.message_id);
  await until(() => (statusOf("csv") === "Needs Changes" ? true : undefined));
  const text = readFileSync(file("csv"), "utf8");
  expect(text).toMatch(/\nChanges requested:\n\nปุ่มควรอยู่ขวาบน\n\n\(ส่งจาก Telegram \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\n$/);
  expect(text.startsWith("---\nstatus: Needs Changes\norder: 1\n")).toBe(true);
  await until(() => messages().find((m) => /ปิดการปลุก loop/.test(m.params.text)));
});

test("Testing แล้ว Merge ได้ เปลี่ยนเป็น Ready to Merge และพอ Done ส่งข้อความ merge แล้ว", async () => {
  writeFileSync(file("csv"), note("Ready to Test"));
  const c = await until(() => messages().filter((m) => m.params.text.includes("พร้อมตรวจ"))[1]);
  tap(buttons(c)[0][1], c.message_id);
  const edit = await until(() =>
    sent.find((s) => s.method === "editMessageText" && s.message_id > c.message_id && s.params.text.includes("กำลังทดสอบ")),
  );
  tap(buttons(edit)[0][1], c.message_id);
  await until(() => (statusOf("csv") === "Ready to Merge" ? true : undefined));
  writeFileSync(file("csv"), note("Done"));
  await until(() => messages().find((m) => m.params.text.includes("merge แล้ว")));
});

test("Needs Input: reply การ์ดเขียน answer และไม่แตะ status", async () => {
  writeFileSync(file("ask"), note("Needs Input", ' "ลาป่วยนับรวมไหม: นับ หรือ ไม่นับ?"'));
  const c = await until(() => messages().find((m) => m.params.text.includes("Agent ถามมา")));
  expect(c.params.text).toContain("ลาป่วยนับรวมไหม: นับ หรือ ไม่นับ?");
  say("ไม่ต้องนับ", c.message_id);
  await until(() => (readFields(readFileSync(file("ask"), "utf8")).answer === "ไม่ต้องนับ" ? true : undefined));
  expect(statusOf("ask")).toBe("Needs Input");
});

test("reply การ์ดคำถามที่ loop ล้างไปแล้วไม่เขียนทับ", async () => {
  writeFileSync(file("ask"), note("Needs Input", " คำถามที่สอง"));
  const c = await until(() => messages().find((m) => m.params.text.includes("คำถามที่สอง")));
  writeFileSync(file("ask"), note("In Progress"));
  say("ตอบช้าไป", c.message_id);
  const r = await until(() => messages().find((m) => m.params.text.startsWith("ไม่ได้เขียน")));
  expect(r.params.text).toContain("In Progress");
  expect(readFields(readFileSync(file("ask"), "utf8")).answer).toBe("");
});

test("/board ส่งสรุปพร้อมปุ่มเปิดการ์ด", async () => {
  writeFileSync(file("ask"), note("Needs Input", " คำถามใหม่"));
  await Bun.sleep(1500);
  const before = lastSentIndex();
  say("/board");
  const s = await until(() => sent.slice(before).find((m) => m.method === "sendMessage" && m.params.text.startsWith("<pre>")));
  expect(buttons(s).some((b: string[]) => b[0].includes("demo/ask"))).toBe(true);
});
