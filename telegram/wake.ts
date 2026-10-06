// หา session ของ loop ใน herdr แล้วปลุกด้วย /loop /babysit-prs เมื่อ loop หยุดไปแล้ว
// เหตุผล: loop ที่หยุดแล้วไม่เฝ้าบอร์ด (reference/running-it.md หัวข้อ "A stopped loop doesn't watch the board")
// บอทแก้ไฟล์อย่างเดียวงานจะไม่ขยับ
import { existsSync, openSync, readSync, closeSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOOP_PROMPT = "/loop /babysit-prs";

export type LoopState =
  | { kind: "stopped" } // เรียก ScheduleWakeup stop:true ครั้งล่าสุด หรือกำหนดปลุกเลยมานานแล้ว
  | { kind: "scheduled"; dueAt: number } // ตั้งปลุกไว้และยังไม่ถึงเวลา
  | { kind: "unknown" };

// เกินเวลาที่ตั้งปลุกไว้นานขนาดนี้แล้วยังไม่มีอะไรเกิดขึ้น ถือว่า wakeup หายไปแล้ว (เช่น session ถูก restart)
const OVERDUE_MS = 10 * 60 * 1000;

// อ่าน ScheduleWakeup ครั้งล่าสุดจากท้าย transcript ของ Claude Code (JSONL)
export function loopStateFromTranscript(tail: string, now: number): LoopState {
  let last: { input: Record<string, unknown>; ts: number } | null = null;
  for (const line of tail.split("\n")) {
    if (!line.includes('"ScheduleWakeup"')) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "tool_use" && c.name === "ScheduleWakeup") {
        last = { input: c.input ?? {}, ts: Date.parse(entry.timestamp) || 0 };
      }
    }
  }
  if (!last) return { kind: "unknown" };
  if (last.input.stop === true) return { kind: "stopped" };
  const delay = Number(last.input.delaySeconds);
  if (!Number.isFinite(delay)) return { kind: "unknown" };
  const dueAt = last.ts + delay * 1000;
  if (now > dueAt + OVERDUE_MS) return { kind: "stopped" };
  return { kind: "scheduled", dueAt };
}

export function transcriptPath(cwd: string, sessionId: string): string | null {
  const dir = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const p = join(homedir(), ".claude", "projects", dir, `${sessionId}.jsonl`);
  return existsSync(p) ? p : null;
}

export function readTail(path: string, bytes = 4 * 1024 * 1024): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf8");
  return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
}

type Run = (args: string[]) => Promise<{ code: number; out: string }>;

export function herdrRunner(bin: string, timeoutMs = 15000): Run {
  return async (args) => {
    const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    clearTimeout(timer);
    return { code, out };
  };
}

export type LoopPane = {
  session: string; // ชื่อ herdr session ("default" = ไม่ต้องใส่ --session)
  paneId: string;
  name: string;
  status: string; // agent_status ของ herdr: idle working blocked done unknown
  transcript: string | null;
  mtime: number;
  isLoop: boolean;
};

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p.replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

function sessionArgs(session: string): string[] {
  return session === "default" ? [] : ["--session", session];
}

// ไล่ทุก herdr session ที่รันอยู่ หา pane ที่มี claude อยู่ใน repo ของบอร์ด
export async function findLoopPanes(run: Run, repo: string): Promise<LoopPane[]> {
  const list = await run(["session", "list", "--json"]);
  if (list.code !== 0) throw new Error("herdr session list ไม่สำเร็จ");
  const sessions: { name: string; running: boolean }[] = JSON.parse(list.out).sessions ?? [];
  const panes: LoopPane[] = [];
  for (const s of sessions.filter((s) => s.running)) {
    const snap = await run([...sessionArgs(s.name), "api", "snapshot"]);
    if (snap.code !== 0) continue;
    let agents: any[] = [];
    try {
      agents = JSON.parse(snap.out).result?.snapshot?.agents ?? [];
    } catch {
      continue;
    }
    for (const a of agents) {
      if (a.agent !== "claude" || !a.cwd || !sameDir(a.cwd, repo)) continue;
      const sid = a.agent_session?.value;
      const transcript = sid ? transcriptPath(a.cwd, sid) : null;
      const tail = transcript ? readTail(transcript) : "";
      panes.push({
        session: s.name,
        paneId: a.pane_id,
        name: a.name ?? "",
        status: a.agent_status ?? "unknown",
        transcript,
        mtime: transcript ? statSync(transcript).mtimeMs : 0,
        isLoop: /^loop/i.test(a.name ?? "") || ranLoop(tail),
      });
    }
  }
  return panes;
}

// session นี้เคยสั่ง /loop /babysit-prs จริง ไม่ใช่แค่พูดถึง (เช่น session ที่รัน /set-up-the-board)
// ดูจากคำสั่ง /loop ที่คนพิมพ์ หรือ ScheduleWakeup ที่ loop ตั้งไว้ให้ตัวเอง
export function ranLoop(tail: string): boolean {
  return (
    /<command-name>\/loop<\/command-name>\\n<command-args>\/babysit-prs/.test(tail) ||
    /"prompt":"\/loop \/babysit-prs"/.test(tail)
  );
}

export type WakeResult =
  | { kind: "woken"; pane: LoopPane }
  | { kind: "scheduled"; pane: LoopPane; dueAt: number }
  | { kind: "running"; pane: LoopPane } // กำลังทำ pass อยู่ จะเห็นการเปลี่ยนในรอบนี้หรือรอบถัดไป
  | { kind: "busy"; pane: LoopPane } // loop หยุดแล้วแต่ session กำลังทำอย่างอื่น ต้องรอแล้วลองใหม่
  | { kind: "none" }
  | { kind: "error"; message: string };

export function pickLoopPane(panes: LoopPane[]): LoopPane | null {
  const loops = panes.filter((p) => p.isLoop).sort((a, b) => b.mtime - a.mtime);
  return loops[0] ?? null;
}

export async function wakeLoop(run: Run, repo: string, now = Date.now()): Promise<WakeResult> {
  let panes: LoopPane[];
  try {
    panes = await findLoopPanes(run, repo);
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  const pane = pickLoopPane(panes);
  if (!pane) return { kind: "none" };

  const state = pane.transcript ? loopStateFromTranscript(readTail(pane.transcript), now) : { kind: "unknown" as const };

  if (pane.status === "working") {
    // session ทำงานอยู่ ถ้าเป็น pass ของ loop เอง (ยังไม่หยุด) ไม่ต้องทำอะไร
    return state.kind === "stopped" ? { kind: "busy", pane } : { kind: "running", pane };
  }
  if (pane.status === "blocked") return { kind: "busy", pane };
  if (state.kind === "scheduled") return { kind: "scheduled", pane, dueAt: state.dueAt };

  const res = await run([...sessionArgs(pane.session), "agent", "prompt", pane.paneId, LOOP_PROMPT]);
  if (res.code !== 0) return { kind: "error", message: `herdr agent prompt ไม่สำเร็จ (exit ${res.code})` };
  return { kind: "woken", pane };
}
