# loop-board Telegram bot

บอท Telegram สำหรับบอร์ดหลายตัวใต้ `~/boards` เตือนเมื่อมีงานรอเรา ให้กดเปลี่ยน status และตอบคำถาม agent
จากมือถือได้ แล้วปลุก loop ใน herdr ให้ถ้ามันหยุดไปแล้ว

บอร์ดยังเป็น source of truth เหมือนเดิม บอทเป็นแค่มืออีกข้างของเจ้าของบอร์ด แก้เฉพาะ field ที่
`protocol.md` ให้เจ้าของแก้ และแก้ทีละ key ไม่เขียนทับทั้งโน้ต

## ทำอะไรได้

| เหตุการณ์ | บอทส่ง | กดได้ |
| --- | --- | --- |
| งานเข้า `Ready to Test` | การ์ด "พร้อมตรวจ" พร้อมลิงก์ PR | **เริ่มทดสอบ** (เป็น `Testing`), **ขอแก้** |
| กดเริ่มทดสอบแล้ว | การ์ดเปลี่ยนเป็น "กำลังทดสอบ" | **Merge ได้** (เป็น `Ready to Merge`), **ขอแก้**, **ยังไม่ทดสอบ** |
| งานเข้า `Needs Input` | คำถามของ agent | reply ข้อความนั้นด้วยคำตอบ (เขียนลง `answer`) |
| `Ready to Merge` กลายเป็น `Done` | "merge แล้ว" | |
| พิมพ์ `/board` | สรุปบอร์ดละบรรทัด และงานที่รอเราแยกตามบอร์ด | ปุ่มเปิดการ์ดของงานที่รอเรา |

**ขอแก้** บอทจะถามว่าต้องแก้อะไร พิมพ์ตอบโดย reply แล้วบอทเขียนบล็อก `Changes requested:` ลงโน้ต
พร้อมเปลี่ยนเป็น `Needs Changes` ในการเขียนครั้งเดียว ตามที่ protocol กำหนดว่าต้องมาคู่กัน
ถ้าโน้ตมี `## Review notes` (ส่วนที่ loop เขียน) บล็อกจะไปอยู่เหนือหัวข้อนั้น

**ไม่มีปุ่ม Merge บนการ์ด "พร้อมตรวจ"** ต้องกดเริ่มทดสอบก่อน เพราะ `Ready to Merge` แปลว่า "ทดสอบแล้ว"
ระหว่างนั้นงานอยู่ที่ `Testing` ซึ่ง loop ไม่แตะเลย

## ปลุก loop

loop ที่หยุดไปแล้วไม่เฝ้าบอร์ด (ดู `reference/running-it.md` หัวข้อ "A stopped loop doesn't watch the board")
หลังกด Merge ได้, ส่งขอแก้ หรือตอบคำถาม บอทจะ:

1. อ่าน path ของ repo จากตาราง Repositories ใน `setup.md` ของบอร์ด
2. ไล่ทุก herdr session ที่รันอยู่ หา pane ที่มี Claude อยู่ใน repo นั้น และเป็น loop
   (ชื่อ agent ขึ้นต้นด้วย `loop` หรือ transcript มี `babysit-prs`)
3. อ่าน `ScheduleWakeup` ครั้งล่าสุดใน transcript ของ pane นั้น
   - `stop: true` หรือเลยเวลาที่ตั้งปลุกมาเกิน 10 นาที: ถือว่าหยุด ส่ง `/loop /babysit-prs` เข้า pane
   - ตั้งปลุกไว้และยังไม่ถึงเวลา: ไม่ทำอะไร บอกเวลาที่ loop จะตื่น
   - pane กำลังทำงาน: ถ้าเป็น pass ของ loop เองก็ปล่อย ถ้า loop หยุดแล้วแต่ session ทำอย่างอื่นอยู่
     จะลองปลุกใหม่ทุกรอบที่เช็กบอร์ด ไม่เกิน 30 นาที
4. ถ้าไม่เจอ loop ของบอร์ดนั้นเลย บอกให้เปิดเองด้วย `board open <ชื่อบอร์ด>`

ปิดการปลุกได้ด้วย `LOOP_WAKE=0`

## ติดตั้ง

ต้องมี `bun` ส่วน herdr ใช้เฉพาะตอนปลุก loop

1. **สร้างบอท** คุยกับ [@BotFather](https://t.me/BotFather) สั่ง `/newbot` แล้วเก็บ token ไว้
2. **ใส่ token** ใน `~/.config/loop-board-bot/env`

   ```bash
   mkdir -p ~/.config/loop-board-bot
   printf 'TELEGRAM_BOT_TOKEN=%s\n' '<token>' > ~/.config/loop-board-bot/env
   chmod 600 ~/.config/loop-board-bot/env
   ```

   หรือเก็บใน Keychain แทน: `security add-generic-password -s loop-board-bot -a telegram -w '<token>'`
3. **หา user id ของตัวเอง** ทักบอทใน Telegram สักข้อความ แล้วรัน

   ```bash
   bun telegram/bot.ts whoami
   ```

   เอาเลข `user id` ไปใส่ในไฟล์เดิม: `TELEGRAM_OWNER_ID=<เลข>`
4. **เช็กก่อนรันจริง** ดูว่าบอทเห็นบอร์ดไหนบ้าง และหา loop ของแต่ละบอร์ดใน herdr เจอไหม (ไม่ต่อ Telegram)

   ```bash
   bun telegram/bot.ts check
   ```

5. **ติดตั้งเป็น launchd agent** ให้รันตลอดและเปิดเองหลังรีสตาร์ตเครื่อง

   ```bash
   telegram/install.sh            # ถอน: telegram/install.sh uninstall
   tail -f ~/Library/Logs/loop-board-bot.log
   ```

   รอบแรกบอทจะจำสถานะที่มีอยู่เฉย ๆ ไม่ส่งอะไร เริ่มเตือนตั้งแต่มีงานเปลี่ยนสถานะครั้งถัดไป
   ใช้ `/board` ดูของที่ค้างอยู่ก่อนหน้านั้น

## ตั้งค่า

ใส่ใน `~/.config/loop-board-bot/env` หรือเป็น environment variable

| ตัวแปร | ค่าเริ่มต้น | |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Keychain `loop-board-bot` / `telegram` | |
| `TELEGRAM_OWNER_ID` | (ต้องใส่) | user id เดียวที่บอทรับคำสั่ง |
| `BOARDS_DIR` | `~/boards` | |
| `POLL_SECONDS` | `10` | เช็กบอร์ดทุกกี่วินาที |
| `LOOP_WAKE` | `1` | `0` = ไม่ปลุก loop |
| `HERDR_BIN` | `~/.local/bin/herdr` | |
| `STATE_FILE` | `~/.local/state/loop-board-bot/state.json` | offset ของ Telegram, status ล่าสุดที่เห็น, การ์ดที่รอ reply |

## ความปลอดภัย

- รับเฉพาะข้อความและปุ่มจาก `TELEGRAM_OWNER_ID` ในแชตส่วนตัว (เช็กทั้ง `from.id` และ `chat.id`)
  นอกนั้นเงียบ ไม่ตอบ
- ทุกปุ่มพกสถานะที่คาดไว้ไปด้วย ก่อนเขียนบอทอ่านไฟล์ใหม่แล้วเทียบ ถ้าสถานะเปลี่ยนไปแล้ว (ปุ่มค้างมาหลายวัน,
  loop ขยับงานไปแล้ว) จะไม่เขียน คำตอบก็เหมือนกัน ถ้า loop ล้างหรือเปลี่ยนคำถามไปแล้วจะไม่เขียนลง `answer`
- เขียนไฟล์ผ่านไฟล์ชั่วคราวแล้ว rename ถ้าไฟล์ถูกแก้ระหว่างนั้นจะอ่านใหม่แล้วลองอีกรอบ
- token อยู่นอก repo และนอก worktree แต่ worker มี shell ในเครื่องเดียวกัน อ่านไฟล์ของ user นี้ได้ทุกไฟล์อยู่แล้ว
  token จึงไม่ใช่กำแพงกั้น worker (worker แก้ไฟล์บอร์ดตรง ๆ ได้อยู่แล้วตั้งแต่ก่อนมีบอท) สิ่งที่ token กันคือคนนอกเครื่อง
  ถึงได้ token ไป ก็ปลอม `from.id` ของเจ้าของไม่ได้ เพราะ Telegram เป็นคนใส่ค่านี้
- เนื้อหาที่ส่งเข้า Telegram: ชื่องาน, บรรทัดแรกของโน้ต, คำถามของ agent, ลิงก์ PR ไม่ส่งโค้ดหรือ diff

## รันเทสต์

```bash
cd telegram && bun test
```

`bot.e2e.test.ts` รันบอทจริงคู่กับ Telegram ปลอมบนบอร์ดชั่วคราว ไม่ต่อเน็ต ไม่แตะ `~/boards`
