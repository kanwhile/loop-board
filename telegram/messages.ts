// ข้อความและปุ่มที่ส่งเข้า Telegram (parse_mode HTML)
import { ageOf, type Task } from "./boards";
import type { InlineButton, Keyboard } from "./telegram";
import type { WakeResult } from "./wake";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// สถานะที่ปุ่มคาดหวัง ใส่ไว้ใน callback_data เพื่อ compare-and-swap ตอนกด
// ปุ่มที่ค้างมาจากสถานะเก่าจะถูกปฏิเสธ ไม่เขียนทับของใหม่
export const CODE: Record<string, string> = {
  "Ready to Test": "RT",
  Testing: "TE",
  "Needs Input": "NI",
};
export const STATUS_OF: Record<string, string> = Object.fromEntries(Object.entries(CODE).map(([s, c]) => [c, s]));

export type Action = "test" | "merge" | "back" | "chg" | "card";

export function cb(id: string, action: Action, status: string): string {
  return `t:${id}:${action}:${CODE[status] ?? "--"}`;
}

export function parseCb(data: string): { id: string; action: Action; expected: string | null } | null {
  const m = data.match(/^t:([0-9a-z]+):(test|merge|back|chg|card):([A-Z-]{2})$/);
  if (!m) return null;
  return { id: m[1], action: m[2] as Action, expected: STATUS_OF[m[3]] ?? null };
}

function prLink(pr: string): string {
  if (!pr) return "ยังไม่มี PR";
  const n = pr.match(/\/pull\/(\d+)/)?.[1];
  return `<a href="${esc(pr)}">${n ? `PR #${n}` : "PR"}</a>`;
}

function head(label: string, t: Task): string {
  const lines = [`<b>${esc(label)}</b>  [${esc(t.board)}]`, `<code>${esc(t.task)}</code>`];
  if (t.title) lines.push(esc(clip(t.title, 200)));
  return lines.join("\n");
}

function meta(t: Task): string {
  const parts = [prLink(t.pr)];
  if (t.filesChanged) parts.push(`แก้ ${esc(t.filesChanged)} ไฟล์`);
  const age = ageOf(t.statusSince);
  if (age) parts.push(`ค้างมา ${age}`);
  return parts.join(", ");
}

export type Card = { text: string; markup?: Keyboard; replyTarget?: "answer" };

// การ์ดของงานตามสถานะปัจจุบัน
// Ready to Test มีแค่ "เริ่มทดสอบ" กับ "ขอแก้" ปุ่ม merge โผล่หลังกดเริ่มทดสอบแล้วเท่านั้น
// เพราะ Ready to Merge แปลว่า "ทดสอบแล้ว" (protocol.md)
export function card(t: Task, id: string): Card {
  const row = (...b: InlineButton[]) => b;
  switch (t.status) {
    case "Ready to Test":
      return {
        text: `${head("พร้อมตรวจ", t)}\n${meta(t)}`,
        markup: {
          inline_keyboard: [
            row(
              { text: "เริ่มทดสอบ", callback_data: cb(id, "test", t.status) },
              { text: "ขอแก้", callback_data: cb(id, "chg", t.status) },
            ),
          ],
        },
      };
    case "Testing":
      return {
        text: `${head("กำลังทดสอบ", t)}\n${meta(t)}\n\n<i>ทดสอบแล้วผ่าน กด Merge ได้ ถ้าไม่ผ่านกดขอแก้</i>`,
        markup: {
          inline_keyboard: [
            row(
              { text: "Merge ได้", callback_data: cb(id, "merge", t.status) },
              { text: "ขอแก้", callback_data: cb(id, "chg", t.status) },
            ),
            row({ text: "ยังไม่ทดสอบ (กลับไป Ready to Test)", callback_data: cb(id, "back", t.status) }),
          ],
        },
      };
    case "Needs Input":
      return {
        text: `${head("Agent ถามมา", t)}\n\n${esc(clip(t.question || "(ยังไม่มีคำถาม)", 2500))}\n\n<i>reply ข้อความนี้เพื่อตอบ</i>`,
        replyTarget: "answer",
      };
    default:
      return { text: `${head(t.status || "ไม่มี status", t)}\n${meta(t)}` };
  }
}

export function doneText(t: Task): string {
  return `<b>merge แล้ว</b>  [${esc(t.board)}] <code>${esc(t.task)}</code>\n${prLink(t.pr)}`;
}

export function changesPrompt(t: Task): string {
  return `พิมพ์สิ่งที่ต้องแก้ของ <code>${esc(t.task)}</code> [${esc(t.board)}] โดย reply ข้อความนี้\nบอทจะเขียนเป็นบล็อก "Changes requested:" ในโน้ต แล้วเปลี่ยนเป็น Needs Changes`;
}

export function wakeText(board: string, r: WakeResult, loopEnabled: boolean): string {
  if (!loopEnabled) return "ปิดการปลุก loop ไว้ (LOOP_WAKE=0) ต้องสั่ง /loop /babysit-prs เอง";
  const where = (p: { session: string; paneId: string }) => `pane ${p.paneId} ใน herdr session ${p.session}`;
  switch (r.kind) {
    case "woken":
      return `ปลุก loop ของ ${esc(board)} แล้ว (${esc(where(r.pane))})`;
    case "scheduled": {
      const d = new Date(r.dueAt);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return `loop ของ ${esc(board)} ตั้งปลุกไว้แล้ว จะหยิบงานนี้ราว ${hhmm}`;
    }
    case "running":
      return `loop ของ ${esc(board)} กำลังทำ pass อยู่ จะหยิบงานนี้ในรอบนี้หรือรอบถัดไป`;
    case "busy":
      return `loop ของ ${esc(board)} หยุดอยู่ แต่ session กำลังทำอย่างอื่น จะลองปลุกใหม่เรื่อย ๆ ไม่เกิน 30 นาที`;
    case "none":
      return `ไม่เจอ session loop ของ ${esc(board)} ใน herdr เปิดเองด้วย <code>board open ${esc(board)}</code> แล้วสั่ง <code>/loop /babysit-prs</code>`;
    case "error":
      return `ปลุก loop ไม่สำเร็จ: ${esc(r.message)}`;
  }
}

export const HELP = [
  "<b>loop-board bot</b>",
  "",
  "บอทเตือนเมื่อมีงานพร้อมตรวจ (Ready to Test) หรือ agent ติดคำถาม (Needs Input)",
  "",
  "งานพร้อมตรวจ: กด <b>เริ่มทดสอบ</b> ก่อน แล้วค่อยกด <b>Merge ได้</b> หรือ <b>ขอแก้</b>",
  "agent ถาม: reply ข้อความนั้นด้วยคำตอบ",
  "/board สรุปทุกบอร์ด และเปิดการ์ดของงานที่รอเรา",
  "",
  "หลังเขียนไฟล์ บอทจะปลุก loop ของบอร์ดนั้นใน herdr ให้ถ้ามันหยุดไปแล้ว",
].join("\n");
