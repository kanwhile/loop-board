// อ่านบอร์ดใต้ BOARDS_DIR และเขียนโน้ตงานแบบ atomic + compare-and-swap
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFields, titleOf } from "./frontmatter";

export const STATUSES = [
  "Backlog",
  "To Do",
  "In Progress",
  "Needs Input",
  "Agent Finished",
  "Ready to Test",
  "Testing",
  "Needs Changes",
  "Ready to Merge",
  "Done",
] as const;

export type Task = {
  key: string; // "<board>/<task>"
  board: string;
  task: string;
  path: string;
  status: string;
  pr: string;
  question: string;
  answer: string;
  statusSince: string;
  filesChanged: string;
  title: string;
};

export function listBoards(boardsDir: string): string[] {
  if (!existsSync(boardsDir)) return [];
  return readdirSync(boardsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(boardsDir, d.name, "setup.md")))
    .map((d) => d.name)
    .sort();
}

// แถวแรกของตาราง Repositories ใน setup.md: | `short` | `path` | `branch` |
// อ่านแบบเดียวกับ repo_path() ใน bin/board
export function repoPath(boardsDir: string, board: string): string | null {
  const file = join(boardsDir, board, "setup.md");
  if (!existsSync(file)) return null;
  let inTable = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^## Repositories/.test(line)) {
      inTable = true;
      continue;
    }
    if (/^## /.test(line)) inTable = false;
    if (inTable && line.startsWith("| `")) {
      const p = line.split("`")[3];
      return p ? p.replace(/^~(?=\/|$)/, homedir()) : null;
    }
  }
  return null;
}

export function readTask(boardsDir: string, board: string, task: string): Task | null {
  const path = join(boardsDir, board, "tasks", `${task}.md`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const f = readFields(text);
  return {
    key: `${board}/${task}`,
    board,
    task,
    path,
    status: f.status ?? "",
    pr: f.pr ?? "",
    question: f.question ?? "",
    answer: f.answer ?? "",
    statusSince: f.status_since ?? "",
    filesChanged: f.files_changed ?? "",
    title: titleOf(text),
  };
}

export function scanTasks(boardsDir: string): Task[] {
  const out: Task[] = [];
  for (const board of listBoards(boardsDir)) {
    const dir = join(boardsDir, board, "tasks");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md") || name.startsWith(".")) continue;
      const t = readTask(boardsDir, board, name.slice(0, -3));
      if (t) out.push(t);
    }
  }
  return out;
}

export class Conflict extends Error {}

// แก้โน้ตแบบ compare-and-swap: mutate() ตรวจค่าที่คาดไว้แล้วคืนข้อความใหม่ หรือ throw Conflict
// เขียนลงไฟล์ชั่วคราวข้าง ๆ แล้ว rename ทับ ถ้าไฟล์ถูกแตะระหว่างนั้น (loop, Obsidian) อ่านใหม่แล้วลองอีกรอบ
export function updateNote(path: string, mutate: (text: string) => string): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = statSync(path);
    const text = readFileSync(path, "utf8");
    const next = mutate(text);
    if (next === text) return;
    const tmp = join(dirname(path), `.${basename(path)}.tgbot-${process.pid}.tmp`);
    writeFileSync(tmp, next, "utf8");
    chmodSync(tmp, before.mode & 0o777);
    const now = statSync(path);
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
      unlinkSync(tmp);
      continue;
    }
    renameSync(tmp, path);
    return;
  }
  throw new Conflict("ไฟล์ถูกแก้ซ้อนอยู่ ลองใหม่อีกครั้ง");
}

export function nowStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// status_since ("2026-10-06 15:40") เป็นเวลาที่ค้างมา แบบเดียวกับ age() ใน bin/board
export function ageOf(since: string, now = Date.now()): string {
  const m = since.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return "";
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "เมื่อกี้";
  if (min < 60) return `${min} นาที`;
  if (min < 1440) return `${Math.floor(min / 60)} ชม.`;
  return `${Math.floor(min / 1440)} วัน`;
}
