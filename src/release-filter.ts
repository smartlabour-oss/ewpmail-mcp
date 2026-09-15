// คัดเมลกรมของ "บัญชีที่ปล่อยแล้ว" ออกก่อน ingest — ตรรกะล้วน ไม่มี I/O
//
// คนงานที่ออกจากเราไปแล้ว บัญชี eWP ยังอยู่บนโดเมนเรา เมลกรมจึงยังส่งเข้ามาเรื่อย ๆ
// เราไม่ควรเก็บเนื้อเมลของคนที่ไม่ได้ดูแลแล้ว (เก็บข้อมูลส่วนบุคคลเกินจำเป็น)

/** ดึงเฉพาะที่อยู่อีเมลตัวเล็ก — รองรับทั้ง "addr" และ "Name <addr>" */
export function normalizeRecipient(raw: unknown): string {
  const s = String(raw ?? '');
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * ที่อยู่ผู้รับ "ทุกตัว" ของเมลฉบับหนึ่ง
 *
 * ของเดิม addr() คืนแค่ตัวแรกของ array — เมลที่ส่งถึงคนงานเราหลายคนพร้อมกันจะถูกตรวจ
 * แค่คนแรก · ที่นี่ต้องเห็นครบทุกคน ไม่งั้นตัดสินผิดได้ทั้งสองทาง
 */
export function recipientList(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (!x) return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (typeof x === 'object') {
      const a = (x as { address?: unknown }).address;
      if (a) out.push(normalizeRecipient(a));
      return;
    }
    // สตริงเดียวอาจมีหลายที่อยู่คั่นด้วย comma ("a@x.com, b@x.com")
    String(x)
      .split(',')
      .map(normalizeRecipient)
      .filter(Boolean)
      .forEach((s) => out.push(s));
  };
  walk(v);
  return [...new Set(out.filter(Boolean))];
}

/**
 * แยกเมลเป็น keep / drop ตามชุดบัญชีที่ปล่อยแล้ว
 *
 * ⚠️ ทิ้งเฉพาะเมลที่ผู้รับ **ทุกคน** ถูกปล่อยแล้ว — ถ้ามีคนที่เรายังดูแลอยู่ปนมาแม้คนเดียว
 * ต้องเก็บ เพราะเมลฉบับนั้นเป็นของเขาด้วย · ผิดพลาดฝั่ง "เก็บเกิน" ราคาถูกกว่า "ทิ้งของลูกค้า"
 * ไม่มีผู้รับเลย (แกะที่อยู่ไม่ออก) = เก็บไว้ ไม่เดา
 */
export function partitionByRelease<T>(
  msgs: T[],
  released: Set<string>,
  addrs: (m: T) => string[],
): { keep: T[]; drop: T[] } {
  const keep: T[] = [];
  const drop: T[] = [];
  for (const m of msgs) {
    const list = addrs(m);
    const allReleased = list.length > 0 && list.every((a) => released.has(a));
    (allReleased ? drop : keep).push(m);
  }
  return { keep, drop };
}
