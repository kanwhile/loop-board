// สถานะของบอทที่ต้องรอดข้ามการ restart: offset ของ Telegram, status ล่าสุดที่เห็น, การ์ดที่รอ reply
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Task } from "./boards";

export type ReplyTarget = {
  key: string;
  kind: "answer" | "changes";
  expected: string; // status ที่ต้องเป็นอยู่ตอน reply มาถึง
  question?: string; // คำถามตอนส่งการ์ด ถ้า loop เปลี่ยน/ล้างไปแล้วจะไม่เขียนคำตอบลงไป
};

export type State = {
  offset: number;
  seeded: boolean;
  statuses: Record<string, string>;
  questions: Record<string, string>;
  ids: Record<string, string>; // id สั้นใน callback_data แทน "<board>/<task>" (callback_data จำกัด 64 byte)
  nextId: number;
  replies: Record<string, ReplyTarget>; // message_id ที่รอ reply
  wakes: Record<string, number>; // บอร์ดที่ยังปลุก loop ไม่ได้ และเริ่มลองตั้งแต่เมื่อไหร่
};

export function emptyState(): State {
  return { offset: 0, seeded: false, statuses: {}, questions: {}, ids: {}, nextId: 1, replies: {}, wakes: {} };
}

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, s: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export function idFor(s: State, key: string): string {
  for (const [id, k] of Object.entries(s.ids)) if (k === key) return id;
  const id = (s.nextId++).toString(36);
  s.ids[id] = key;
  return id;
}

export function rememberReply(s: State, messageId: number, target: ReplyTarget, keep = 300): void {
  s.replies[String(messageId)] = target;
  const ids = Object.keys(s.replies).map(Number).sort((a, b) => a - b);
  for (const old of ids.slice(0, Math.max(0, ids.length - keep))) delete s.replies[String(old)];
}

export type Note = { kind: "card" | "done"; task: Task };

// เทียบ status ที่เห็นรอบนี้กับรอบก่อน แล้วบอกว่าต้องส่งอะไร
// รอบแรก (seeded = false) จำอย่างเดียว ไม่ส่ง ไม่งั้นเปิดบอทครั้งแรกจะยิงทุกงานที่ค้างอยู่
export function diff(s: State, tasks: Task[]): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    seen.add(t.key);
    const prev = s.statuses[t.key];
    const cur = t.status;
    if (s.seeded) {
      if (cur === "Ready to Test" && prev !== cur) notes.push({ kind: "card", task: t });
      if (cur === "Needs Input" && t.question && s.questions[t.key] !== t.question) notes.push({ kind: "card", task: t });
      if (cur === "Done" && prev === "Ready to Merge") notes.push({ kind: "done", task: t });
    }
    if (cur === "Needs Input" && t.question) s.questions[t.key] = t.question;
    if (cur !== "Needs Input") delete s.questions[t.key];
    s.statuses[t.key] = cur;
  }
  for (const key of Object.keys(s.statuses)) {
    if (!seen.has(key)) {
      delete s.statuses[key];
      delete s.questions[key];
    }
  }
  s.seeded = true;
  return notes;
}
