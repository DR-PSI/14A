# Ward 14A — ระบบตรวจวัดอุณหภูมิ/ความชื้น/PM2.5 (XY-MD02 + PR-3002-PM-N01 → Node-RED → n8n → Firebase → Web app)

## ไฟล์ในโปรเจกต์

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `Ward 14A Monitor.dc.html` | เว็บแอป (เปิดในเบราว์เซอร์ได้ตรง ๆ / ขึ้น Hosting ได้) |
| `node-red/ward14a-xymd02-flow.json` | Flow อ่าน XY-MD02 15 ตัว → POST ไป n8n |
| `node-red/ward14a-pm25-flow.json` | Flow อ่านเซ็นเซอร์ฝุ่น PR-3002-PM-N01 → POST ไป n8n |
| `n8n/ward14a-ingest-workflow.json` | Webhook `ward14a-ingest` → เทียบเกณฑ์ → Firestore → LINE |
| `firebase/ward14a-firestore.rules` | Security rules ที่ต้องเพิ่มในไฟล์ rules เดิมของ `inspection-asset` |

## 1. การต่อสาย RS485

```
[XY-MD02 1401] [1402] ... [1415]      ทุกตัวขนานกันบน bus เดียว
      A+ ─────── A+ ──── ... ─── A+ ──┐
      B- ─────── B- ──── ... ─── B- ──┼── USB-RS485 converter ── คอมพิวเตอร์ (Node-RED)
      + / −  ไฟเลี้ยง DC 5–30V (ขนานได้)
```

- สาย twisted pair แบบ shielded, ground shield ข้างเดียว
- ใส่ตัวต้านทาน **120 Ω** คร่อม A/B ที่ **ปลายสองข้างของ bus เท่านั้น** (ไม่ใช่ทุกตัว)
- ระยะรวมไม่เกิน ~1200 m
- ถ้าอ่านไม่ได้เลย ให้สลับ A/B ที่ปลายข้างหนึ่งก่อนเป็นอย่างแรก

## 2. ตั้ง Modbus address ที่เซ็นเซอร์ (ทำทีละตัว ก่อนเอาขึ้น bus)

XY-MD02 มาจากโรงงาน address = 1, 9600 8N1 ทุกตัว ต้องตั้งใหม่ให้ไม่ชนกัน

- Holding Register `0x0101` = address ใหม่ (ใช้ 1–15 ตามลำดับห้อง 1401–1415)
- Holding Register `0x0102` = baud rate code (`0` = 9600)
- ค่าที่อ่าน: Input Register (FC 04) `0x0001` = อุณหภูมิ ×10 (signed), `0x0002` = ความชื้น ×10

การ map ใน flow: unit id 1 → ห้อง 1401, 2 → 1402, … 15 → 1415 (แก้ได้ในฟังก์ชัน `สร้างคิวอ่าน 15 ห้อง`)

## 3. Node-RED

1. ติดตั้ง `node-red-contrib-modbus` (Manage palette)
2. Import `node-red/ward14a-xymd02-flow.json`
3. เปิด config node **RS485 Ward 14A** → แก้ `serialPort`
   - Windows: `COM3` (ดูใน Device Manager)
   - Linux: `/dev/ttyUSB0` (`ls /dev/tty*`)
4. Deploy → ดู debug "ค่าที่อ่านได้" ควรขึ้นทุก 30 วินาที ครบ 15 ห้อง

อ่านทีละตัวโดยหน่วง 400 ms กันชนกันบน bus (15 ตัวใช้เวลา ~6 วินาทีต่อรอบ)

## 4. n8n (n8n.jupetor-cmms.com)

1. Import `n8n/ward14a-ingest-workflow.json`
2. ผูก credential **"Google Firebase Cloud Firestore account"** ให้ทั้ง 4 node ที่ยิง `firestore.googleapis.com`
   (Authentication → Predefined Credential Type → Google Service Account API, scope `https://www.googleapis.com/auth/datastore`)
3. node **Push to LINE** → ใส่ LINE Channel Access Token แทน `REPLACE_WITH_LINE_CHANNEL_ACCESS_TOKEN`
   (group ID ใช้ตัวเดิมของ SubEye — เปลี่ยนได้ใน jsonBody ถ้าใช้กลุ่มอื่น)
4. กด Active

การแจ้งเตือนส่งเฉพาะ **ตอนสถานะเปลี่ยน** (ok → warn/alarm หรือกลับเป็นปกติ) ไม่สแปมทุกรอบการอ่าน

## 5. Firebase

Schema ที่ workflow เขียน:

```
wards/14A/rooms/{room}                 room, ward, sensorId, model, temp, humi,
                                       tempStatus, humiStatus, status, source, updatedAt
wards/14A/rooms/{room}/readings/{id}   temp, humi, status, ts
ward_alarms/{id}                       ward, room, status, temp, humi, message,
                                       timestamp, acknowledged, ackBy, ackAt
```

- เพิ่ม rules จาก `firebase/ward14a-firestore.rules` เข้าไปในไฟล์ rules เดิม
- สร้าง index สำหรับ subcollection `readings`: Firestore → Indexes → Single field / Exemptions → Collection ID `readings`, field `ts`, เปิด **Collection group scope → Ascending**
- ข้อมูลย้อนหลัง 30 วัน × 15 ห้อง × ทุก 30 วิ ≈ 1,300,000 docs/เดือน — ถ้าเยอะเกินไป แนะนำให้ n8n เขียน `readings` ทุก 5 นาที (เขียนค่าล่าสุดทุกรอบเหมือนเดิม) แล้วตั้ง TTL policy ลบ readings เก่ากว่า 90 วัน

## 6. เว็บแอป

- เกณฑ์ ASHRAE 170 (Patient room): อุณหภูมิ 21–24 °C, ความชื้น 30–60 %RH
  - นอกช่วง OK แต่ยังอยู่ใน 20–26 °C / 20–65 % = เฝ้าระวัง (สีเหลือง), นอกนั้น = ผิดเกณฑ์ (สีแดง)
  - ปรับตัวเลขได้จากแผง Tweaks (tempOkMin/Max, humiOkMin/Max, offlineMinutes)
- ต้อง **เปิดผ่าน https** (Firebase Hosting / GitHub Pages) เพราะใช้ Google Sign-In แบบ popup
- ปุ่ม "ดูตัวอย่างข้อมูล (demo)" ใช้ดูหน้าจอด้วยค่าจำลอง ไม่แตะ Firestore
- ห้องที่ไม่มีค่าใหม่เกิน 15 นาที = ออฟไลน์ (สีเทา) — ตั้งไว้เผื่อ LoRa ที่ส่งทุก 5 นาที (พลาด 2 รอบจึงเตือน)
  ถ้าใช้ RS485 สายตรงที่ส่งทุก 30 วินาที ปรับ offlineMinutes ลงเหลือ 3 ได้

## 7. ตั้งค่าห้องและเซ็นเซอร์ (ปุ่ม "ตั้งค่า" ในเว็บแอป)

แท็บ **ตั้งค่า** บนหัวเว็บใช้จัดผังห้องได้เองโดยไม่ต้องแก้โค้ด:

- **เพิ่มห้อง** — สร้างเลขห้องถัดไปให้อัตโนมัติ แก้เลขห้องเองได้
- **แก้ไขชื่อห้อง** — ใส่ชื่อเรียก เช่น "ห้องแยกโรค" แสดงต่อท้ายเลขห้องบนการ์ดและในหน้ารายละเอียด
- **เพิ่มเซ็นเซอร์** — ต่อหนึ่งห้องใส่ได้หลายตัว เลือกชนิด temp/RH (XY-MD02) หรือ PM2.5 (PR-3002-PM-N01)
  พร้อมช่อง Modbus ID (ใช้กับสาย RS485) และ DevEUI (ใช้กับ Dragino RS485-LN)
- **ดาวน์โหลดผังเซ็นเซอร์ (CSV)** — เอาไปทำ mapping table ใน Node-RED / n8n decoder

เก็บค่าไว้ที่ Firestore `wards/14A` ฟิลด์ `roomConfig` (และสำรองใน localStorage ของเครื่องที่แก้)
เลข `room` ที่ตั้งไว้ต้องตรงกับ `room` ที่ Node-RED ส่งเข้ามา ไม่งั้นการ์ดจะขึ้นออฟไลน์

## 8. เซ็นเซอร์ PM2.5 (PR-3002-PM-N01)

- RS485 / Modbus RTU, ช่วงวัด 0–1000 µg/m³, ไฟเลี้ยง 10–30 VDC
- ต่อร่วมบัสเดียวกับ XY-MD02 ได้ แต่ **address ต้องไม่ชนกัน** — แนะนำ XY-MD02 = 1–15, PM2.5 = 21 ขึ้นไป
- Flow อ่านด้วย FC 03 เริ่มที่ register 0x0000 จำนวน 3 ตัว (PM2.5 / PM10 / PM1.0)
  *** ยืนยัน register กับดาต้าชีตของล็อตที่ได้มาก่อนใช้งานจริง — บางล็อตมาที่ baud 4800 ***
- อ่านทุก 60 วินาที (ฝุ่นเปลี่ยนช้ากว่าอุณหภูมิ) หน่วง 1 ตัว/วินาที กันชนบนบัส
- เกณฑ์ในเว็บแอป: ≤ 25 µg/m³ = ปกติ, 25–37.5 = เฝ้าระวัง, > 37.5 = ผิดเกณฑ์
  (25 = ค่าแนะนำ WHO 24 ชม. เดิม, 37.5 = ค่ามาตรฐานไทย 24 ชม.) ปรับได้ที่ Tweaks `pmOkMax` / `pmWarnMax`
- payload ที่ส่งเข้า n8n: `{ ward, room, sensorId, model, pm25, pm10, ts }` — ส่งเฉพาะฟิลด์ที่วัดได้
  workflow เขียนเฉพาะฟิลด์ที่ส่งมา (dynamic updateMask) จึงไม่ทับค่า temp/humi ของห้องเดียวกัน
