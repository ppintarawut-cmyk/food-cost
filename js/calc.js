// การคำนวณทั้งหมดของโปรแกรม ไม่แตะหน้าจอหรือที่เก็บข้อมูล จึงทดสอบได้ด้วย node --test
// คำศัพท์ตาม CONTEXT.md: วัตถุดิบ, รายการซื้อ, ราคาต่อหน่วย, สูตร, ต้นทุนต่อจาน, GP, กำไรต่อจาน

/** หน่วยพื้นฐานที่โปรแกรมใช้คิดเลข */
export const BASE_UNITS = {
  g: 'กรัม',
  ml: 'มล.',
  pc: 'ชิ้น',
};

/** หน่วยที่ให้เลือกตอนกรอกจำนวน แปลงเป็นหน่วยพื้นฐานด้วย factor */
export const INPUT_UNITS = {
  kg: { base: 'g', factor: 1000, label: 'กก.' },
  g: { base: 'g', factor: 1, label: 'กรัม' },
  l: { base: 'ml', factor: 1000, label: 'ลิตร' },
  ml: { base: 'ml', factor: 1, label: 'มล.' },
  pc: { base: 'pc', factor: 1, label: 'ชิ้น' },
};

export const CHANNELS = [
  { id: 'store', label: 'หน้าร้าน' },
  { id: 'grab', label: 'Grab' },
  { id: 'lineman', label: 'LINE MAN' },
];

export const VAT_RATE = 0.07;

/** หน่วยที่กรอกได้สำหรับวัตถุดิบที่มีหน่วยพื้นฐาน base */
export function inputUnitsFor(base) {
  return Object.entries(INPUT_UNITS)
    .filter(([, u]) => u.base === base)
    .map(([id]) => id);
}

/** แปลงจำนวนที่กรอกเป็นหน่วยพื้นฐาน เช่น (1.5, 'kg') → { qty: 1500, unit: 'g' } */
export function toBase(qty, inputUnit) {
  const u = INPUT_UNITS[inputUnit];
  if (!u) throw new Error(`ไม่รู้จักหน่วย ${inputUnit}`);
  return { qty: qty * u.factor, unit: u.base };
}

/** รายการซื้อครั้งล่าสุดของวัตถุดิบ (วันที่ล่าสุด ถ้าวันเดียวกันใช้อันที่บันทึกทีหลัง) */
export function latestPurchase(purchases, ingredientId) {
  let latest = null;
  for (const p of purchases) {
    if (p.ingredientId !== ingredientId) continue;
    if (
      !latest ||
      p.date > latest.date ||
      (p.date === latest.date && p.createdAt > latest.createdAt)
    ) {
      latest = p;
    }
  }
  return latest;
}

/** ราคาต่อหน่วยพื้นฐาน จากรายการซื้อครั้งล่าสุด หรือ null ถ้ายังไม่เคยซื้อ */
export function unitPrice(purchases, ingredientId) {
  const p = latestPurchase(purchases, ingredientId);
  if (!p || !(p.qty > 0)) return null;
  return p.price / p.qty;
}

/** ต้นทุนของบรรทัดหนึ่งในสูตร หรือ null ถ้ายังไม่รู้ราคา */
export function lineCost(purchases, line) {
  if (line.kind === 'sundries') return Number(line.amount) || 0;
  const up = unitPrice(purchases, line.ingredientId);
  if (up === null) return null;
  return up * (Number(line.qty) || 0);
}

/**
 * ต้นทุนต่อจาน = ผลรวมทุกบรรทัดในสูตร
 * missing = วัตถุดิบในสูตรที่ยังไม่มีรายการซื้อ (ต้นทุนจึงยังไม่ครบ)
 */
export function menuCost(state, menu) {
  let total = 0;
  const missing = [];
  for (const line of menu.lines) {
    const c = lineCost(state.purchases, line);
    if (c === null) {
      const ing = state.ingredients.find((i) => i.id === line.ingredientId);
      missing.push(ing ? ing.name : '(วัตถุดิบที่ถูกลบ)');
    } else {
      total += c;
    }
  }
  return { total, missing };
}

/** % GP ของช่องทางขาย หน้าร้านไม่มี GP */
export function gpPercent(channel, settings) {
  if (channel === 'grab') return Number(settings.gpGrab) || 0;
  if (channel === 'lineman') return Number(settings.gpLineman) || 0;
  return 0;
}

/** แยกยอดที่ร้านได้รับจากราคาขาย: หัก GP และ VAT ของค่า GP */
export function payout(price, channel, settings) {
  const gpFee = price * (gpPercent(channel, settings) / 100);
  const vat = settings.vatOnGp ? gpFee * VAT_RATE : 0;
  return { price, gpFee, vat, net: price - gpFee - vat };
}

/** กำไรต่อจานของทุกช่องทาง ช่องทางที่ยังไม่ได้ตั้งราคาขายจะได้ null */
export function profitByChannel(state, menu) {
  const cost = menuCost(state, menu);
  return CHANNELS.map((ch) => {
    const price = menu.prices?.[ch.id];
    if (price === null || price === undefined || price === '') {
      return { channel: ch.id, label: ch.label, set: false, cost };
    }
    const p = payout(Number(price), ch.id, state.settings);
    return { channel: ch.id, label: ch.label, set: true, cost, ...p, profit: p.net - cost.total };
  });
}

/** สรุปค่าซื้อของเดือน month ('YYYY-MM') แยกรายวัน วันล่าสุดอยู่บนสุด */
export function purchaseSummary(purchases, month) {
  const byDay = new Map();
  let total = 0;
  for (const p of purchases) {
    if (!p.date.startsWith(month)) continue;
    total += p.price;
    if (!byDay.has(p.date)) byDay.set(p.date, { date: p.date, total: 0, items: [] });
    const day = byDay.get(p.date);
    day.total += p.price;
    day.items.push(p);
  }
  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const d of days) d.items.sort((a, b) => b.createdAt - a.createdAt);
  return { total, days };
}

/** กุญแจสำหรับจำการจับคู่: ตัดช่องว่างซ้ำ ไม่สนตัวพิมพ์เล็กใหญ่ */
export function matchKey(receiptName) {
  return String(receiptName).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** แสดงเงินบาท 2 ตำแหน่ง เช่น 1234.5 → "1,234.50" */
export function baht(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** แสดงจำนวน ตัดศูนย์ท้ายทศนิยมทิ้ง เช่น 80 → "80", 0.5 → "0.5" */
export function num(n) {
  return Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/** แสดงจำนวนในหน่วยที่อ่านง่าย เช่น 1500 g → "1.5 กก." */
export function formatQty(qty, unit) {
  if (unit === 'g' && qty >= 1000) return `${num(qty / 1000)} กก.`;
  if (unit === 'ml' && qty >= 1000) return `${num(qty / 1000)} ลิตร`;
  return `${num(qty)} ${BASE_UNITS[unit] ?? ''}`.trim();
}
