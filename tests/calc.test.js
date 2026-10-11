import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toBase,
  unitPrice,
  menuCost,
  payout,
  profitByChannel,
  purchaseSummary,
  matchKey,
  formatQty,
  inputUnitsFor,
} from '../js/calc.js';
import { emptyState } from '../js/store.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

function shop() {
  const s = emptyState();
  s.ingredients = [
    { id: 'pork', name: 'หมูสับ', unit: 'g' },
    { id: 'egg', name: 'ไข่', unit: 'pc' },
    { id: 'box', name: 'กล่องข้าว', unit: 'pc' },
    { id: 'basil', name: 'ใบกะเพรา', unit: 'g' },
  ];
  s.purchases = [
    { id: 'p1', date: '2026-10-01', ingredientId: 'pork', price: 150, qty: 1000, createdAt: 1 },
    { id: 'p2', date: '2026-10-08', ingredientId: 'pork', price: 170, qty: 1000, createdAt: 2 },
    { id: 'p3', date: '2026-10-08', ingredientId: 'egg', price: 120, qty: 30, createdAt: 3 },
    { id: 'p4', date: '2026-09-20', ingredientId: 'box', price: 75, qty: 50, createdAt: 4 },
  ];
  return s;
}

test('แปลงหน่วยที่กรอกเป็นหน่วยพื้นฐาน', () => {
  assert.deepEqual(toBase(1.5, 'kg'), { qty: 1500, unit: 'g' });
  assert.deepEqual(toBase(2, 'l'), { qty: 2000, unit: 'ml' });
  assert.deepEqual(toBase(30, 'pc'), { qty: 30, unit: 'pc' });
  assert.deepEqual(inputUnitsFor('g'), ['kg', 'g']);
});

test('ราคาต่อหน่วยใช้รายการซื้อครั้งล่าสุด ไม่ใช่ราคาเฉลี่ย', () => {
  const s = shop();
  close(unitPrice(s.purchases, 'pork'), 0.17);
  close(unitPrice(s.purchases, 'egg'), 4);
  assert.equal(unitPrice(s.purchases, 'basil'), null);
});

test('วันเดียวกันซื้อสองครั้ง ใช้อันที่บันทึกทีหลัง', () => {
  const s = shop();
  s.purchases.push({ id: 'p5', date: '2026-10-08', ingredientId: 'pork', price: 180, qty: 1000, createdAt: 9 });
  close(unitPrice(s.purchases, 'pork'), 0.18);
});

test('ต้นทุนต่อจาน = วัตถุดิบ + บรรจุภัณฑ์ + ค่าจุกจิก', () => {
  const s = shop();
  const menu = {
    lines: [
      { kind: 'ingredient', ingredientId: 'pork', qty: 80 },
      { kind: 'ingredient', ingredientId: 'egg', qty: 1 },
      { kind: 'ingredient', ingredientId: 'box', qty: 1 },
      { kind: 'sundries', amount: 5 },
    ],
  };
  const c = menuCost(s, menu);
  close(c.total, 80 * 0.17 + 4 + 1.5 + 5); // 24.1
  assert.deepEqual(c.missing, []);
});

test('วัตถุดิบที่ยังไม่มีราคาถูกแจ้งว่าต้นทุนไม่ครบ', () => {
  const s = shop();
  const c = menuCost(s, { lines: [{ kind: 'ingredient', ingredientId: 'basil', qty: 10 }, { kind: 'sundries', amount: 5 }] });
  close(c.total, 5);
  assert.deepEqual(c.missing, ['ใบกะเพรา']);
});

test('ตัวอย่างจากการคุย: ขาย Grab 70 บาท GP 30% + VAT ของ GP ต้นทุน 32 บาท กำไร 15.53', () => {
  const settings = { gpGrab: 30, gpLineman: 30, vatOnGp: true };
  const p = payout(70, 'grab', settings);
  close(p.gpFee, 21);
  close(p.vat, 1.47);
  close(p.net, 47.53);
  close(p.net - 32, 15.53);
});

test('ปิด VAT ของ GP แล้วไม่หัก VAT', () => {
  const p = payout(70, 'lineman', { gpGrab: 30, gpLineman: 30, vatOnGp: false });
  close(p.net, 49);
  close(p.vat, 0);
});

test('หน้าร้านไม่มี GP', () => {
  const p = payout(50, 'store', { gpGrab: 30, gpLineman: 30, vatOnGp: true });
  close(p.net, 50);
});

test('กำไรแยกช่องทาง ช่องทางที่ไม่ได้ตั้งราคาไม่คิด ขาดทุนติดลบ', () => {
  const s = shop();
  const menu = {
    prices: { store: 50, grab: 30, lineman: null },
    lines: [{ kind: 'ingredient', ingredientId: 'pork', qty: 100 }, { kind: 'sundries', amount: 5 }],
  };
  const [store, grab, lineman] = profitByChannel(s, menu);
  close(store.profit, 50 - 22);
  assert.ok(grab.profit < 0);
  assert.equal(lineman.set, false);
});

test('สรุปค่าซื้อรายเดือนแยกรายวัน วันล่าสุดอยู่บน', () => {
  const s = shop();
  const sum = purchaseSummary(s.purchases, '2026-10');
  close(sum.total, 440);
  assert.deepEqual(sum.days.map((d) => d.date), ['2026-10-08', '2026-10-01']);
  close(sum.days[0].total, 290);
});

test('กุญแจจับคู่ไม่สนช่องว่างซ้ำและตัวพิมพ์', () => {
  assert.equal(matchKey('  หมูสับอนามัย   1KG '), 'หมูสับอนามัย 1kg');
});

test('แสดงจำนวนแบบอ่านง่าย', () => {
  assert.equal(formatQty(1500, 'g'), '1.5 กก.');
  assert.equal(formatQty(80, 'g'), '80 กรัม');
  assert.equal(formatQty(30, 'pc'), '30 ชิ้น');
});
