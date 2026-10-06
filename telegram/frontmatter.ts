// อ่าน/แก้ frontmatter ของโน้ตงานแบบ "ทีละ key" ตาม protocol.md
// ไม่ parse YAML ทั้งก้อนแล้วเขียนกลับ เพราะจะไปจัดรูปบรรทัดอื่นที่ไม่ใช่ของเรา

const FENCE = /^---\s*$/;
const KEY = /^([A-Za-z_][\w-]*):(.*)$/;

type Range = { open: number; close: number };

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function range(lines: string[]): Range | null {
  if (!FENCE.test(lines[0] ?? "")) return null;
  for (let i = 1; i < lines.length; i++) if (FENCE.test(lines[i])) return { open: 0, close: i };
  return null;
}

// บรรทัดต่อของค่าหลายบรรทัด = บรรทัดที่ขึ้นต้นด้วยช่องว่าง (block scalar หรือ plain ที่พับบรรทัด)
function valueEnd(lines: string[], keyLine: number, close: number): number {
  let i = keyLine + 1;
  while (i < close && /^[ \t]/.test(lines[i])) i++;
  return i;
}

function parseValue(first: string, rest: string[]): string {
  const raw = first.trim();
  if (raw === "|" || raw === "|-" || raw === ">" || raw === ">-") {
    const indent = Math.min(...rest.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length));
    const body = rest.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
    return (raw.startsWith("|") ? body.join("\n") : body.join(" ")).trim();
  }
  const joined = [raw, ...rest.map((l) => l.trim())].join(" ").trim();
  if (joined.startsWith('"')) {
    try {
      return JSON.parse(joined);
    } catch {
      return joined.replace(/^"|"$/g, "");
    }
  }
  if (joined.startsWith("'") && joined.endsWith("'") && joined.length >= 2) {
    return joined.slice(1, -1).replace(/''/g, "'");
  }
  return joined;
}

export function readFields(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const r = range(lines);
  const out: Record<string, string> = {};
  if (!r) return out;
  for (let i = r.open + 1; i < r.close; i++) {
    const m = lines[i].match(KEY);
    if (!m) continue;
    const end = valueEnd(lines, i, r.close);
    out[m[1]] = parseValue(m[2], lines.slice(i + 1, end));
    i = end - 1;
  }
  return out;
}

// ค่าที่ปลอดภัยพอจะเขียนแบบ plain ให้หน้าตาเหมือนที่ loop กับคนเขียนอยู่แล้ว
// นอกนั้นเขียนเป็น JSON string ซึ่งเป็น YAML double-quoted ที่ถูกต้อง
export function formatValue(v: string): string {
  if (v === "") return "";
  const plain =
    !/[\r\n]/.test(v) &&
    /^[^\s"'`{}\[\]&*!|>%@#,?:~-]/.test(v) &&
    !/\s$/.test(v) &&
    !v.includes(": ") &&
    !v.includes(" #") &&
    !v.endsWith(":") &&
    !/^(true|false|null|yes|no|on|off)$/i.test(v) &&
    !/^[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?$/.test(v);
  return plain ? v : JSON.stringify(v);
}

export function setField(text: string, key: string, value: string): string {
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  const r = range(lines);
  if (!r) throw new Error("โน้ตไม่มี frontmatter");
  const line = value === "" ? `${key}:` : `${key}: ${formatValue(value)}`;
  for (let i = r.open + 1; i < r.close; i++) {
    const m = lines[i].match(KEY);
    if (m && m[1] === key) {
      const end = valueEnd(lines, i, r.close);
      lines.splice(i, end - i, line);
      return lines.join(eol);
    }
  }
  lines.splice(r.close, 0, line);
  return lines.join(eol);
}

const CHANGES = /^\s*(#+\s*)?(\*\*)?changes requested/i;
const REVIEW_NOTES = /^#+\s*review notes\s*$/i;

// ต่อท้ายบล็อก "Changes requested:" ตาม protocol.md หัวข้อ Needs Changes
// ถ้ามี "## Review notes" (ส่วนที่ loop เขียน) วางบล็อกไว้เหนือหัวข้อนั้น
// เว้นแต่มีบล็อกเก่าอยู่ใต้ Review notes แล้ว ก็ต่อท้ายไฟล์เพื่อให้บล็อกใหม่ยังเป็นอันล่างสุด
export function appendChangesRequested(text: string, request: string, footer: string): string {
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  const r = range(lines);
  const bodyStart = r ? r.close + 1 : 0;
  const block = ["Changes requested:", "", ...request.trim().split(/\r?\n/), "", footer];

  let notes = -1;
  let lastChange = -1;
  for (let i = bodyStart; i < lines.length; i++) {
    if (REVIEW_NOTES.test(lines[i])) notes = i;
    if (CHANGES.test(lines[i])) lastChange = i;
  }

  if (notes !== -1 && lastChange < notes) {
    let at = notes;
    while (at > bodyStart && lines[at - 1].trim() === "") at--;
    lines.splice(at, notes - at, "", ...block, "");
    return lines.join(eol);
  }

  while (lines.length > bodyStart && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("", ...block, "");
  return lines.join(eol);
}

// บรรทัดแรกของเนื้อโน้ตที่ไม่ว่าง ใช้เป็นชื่อเรื่องในการ์ด
export function titleOf(text: string, max = 140): string {
  const lines = text.split(/\r?\n/);
  const r = range(lines);
  for (let i = r ? r.close + 1 : 0; i < lines.length; i++) {
    const t = lines[i].replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (t) return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  return "";
}
