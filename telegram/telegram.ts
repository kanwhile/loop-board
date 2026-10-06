// Telegram Bot API แบบบางที่สุด ไม่มี dependency
// error ที่โยนออกไปไม่มี URL ติดไป เพราะ URL มี token อยู่

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type Keyboard = { inline_keyboard: InlineButton[][] } | { force_reply: true; input_field_placeholder?: string };

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
  ) {
    super(`${method}: ${code} ${description}`);
  }
}

export function telegram(token: string, base = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org") {
  async function call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new TelegramError(method, 0, (e as Error).name);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!body.ok) throw new TelegramError(method, body.error_code ?? res.status, body.description ?? "unknown");
    return body.result as T;
  }

  return {
    call,
    getUpdates: (offset: number, timeout = 50) =>
      call<any[]>("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }, (timeout + 15) * 1000),
    send: (chatId: number, text: string, markup?: Keyboard, replyTo?: number) =>
      call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup } : {}),
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      }),
    edit: (chatId: number, messageId: number, text: string, markup?: Keyboard) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: markup ?? { inline_keyboard: [] },
      }).catch((e) => {
        // แก้เป็นข้อความเดิมเป๊ะ Telegram ตอบ "message is not modified" ไม่ใช่ปัญหา
        if (e instanceof TelegramError && /not modified/.test(e.description)) return;
        throw e;
      }),
    answerCallback: (id: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => {}),
    setCommands: () =>
      call("setMyCommands", {
        commands: [
          { command: "board", description: "สรุปทุกบอร์ด และงานที่รอเรา" },
          { command: "help", description: "วิธีใช้" },
        ],
      }),
  };
}

export type Bot = ReturnType<typeof telegram>;
