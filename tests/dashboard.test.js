import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyTotals,
  monthComparison,
  topIngredients,
  priceChanges,
  lowestProfits,
  purchaseRows,
  displayUnitPrice,
  toCsv,
} from '../js/calc.js';
import { emptyState } from '../js/store.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

function shop() {
  const s = emptyState();
  s.ingredients = [
    { id: 'pork', name: 'หมูสับ', unit: 'g' },
    { id: 'egg', name: 'ไข่', unit: 'pc' },
    { id: 'oil', name: 'น้ำมันพืช', unit: 'ml' },
  ];
  s.purchases = [
    { id: 'a', date: '2026-09-28', ingredientId: 'pork', price: 150, qty: 1000, createdAt: 1 },
    { id: 'b', date: '2026-10-02', ingredientId: 'pork', price: 170, qty: 1000, createdAt: 2 },
    { id: 'c', date: '2026-10-02', ingredientId: 'egg', price: 120, qty: 30, createdAt: 3 },
    { id: 'd', date: '2026-10-09', ingredientId: 'egg', price: 108, qty: 30, createdAt: 4 },
    { id: 'e', date: '2026-10-09', ingredientId: 'oil', price: 55, qty: 1000, createdAt: 5 },
  ];
  s.menus = [
    { id: 'm1', name: 'กะเพรา', prices: { store: 50, grab: 40, lineman: null }, lines: [{ kind: 'ingredient', ingredientId: 'pork', qty: 100 }, { kind: 'sundries', amount: 5 }] },
    { id: 'm2', name: 'ไข่เจียว', prices: { store: 40, grab: null, lineman: null }, lines: [{ kind: 'ingredient', ingredientId: 'egg', qty: 2 }] },
  ];
  return s;
}

test('ค่าซื้อรายวันครบทุกวันของเดือน', () => {
  const d = dailyTotals(shop().purchases, '2026-10');
  assert.equal(d.length, 31);
  assert.equal(d[1].total, 290);
  assert.equal(d[8].total, 163);
  assert.equal(d[0].total, 0);
  assert.equal(dailyTotals([], '2026-02').length, 28);
});

test('เทียบค่าซื้อกับเดือนก่อน', () => {
  const c = monthComparison(shop().purchases, '2026-10', '2026-09');
  assert.equal(c.current, 453);
  assert.equal(c.previous, 150);
  close(c.change, (453 - 150) / 150);
  assert.equal(monthComparison(shop().purchases, '2026-09', '2026-08').change, null);
});

test('วัตถุดิบที่จ่ายเยอะสุด เรียงมากไปน้อย พร้อมสัดส่วน', () => {
  const top = topIngredients(shop(), '2026-10');
  assert.deepEqual(top.map((t) => [t.ingredient.name, t.total]), [['ไข่', 228], ['หมูสับ', 170], ['น้ำมันพืช', 55]]);
  close(top[0].share, 228 / 453);
});

test('ราคาที่เปลี่ยน เทียบครั้งล่าสุดกับครั้งก่อน ขึ้นราคาอยู่บนสุด', () => {
  const ch = priceChanges(shop());
  assert.deepEqual(ch.map((c) => c.ingredient.name), ['หมูสับ', 'ไข่']);
  close(ch[0].change, 20 / 150);
  close(ch[1].change, -0.1);
});

test('เมนูกำไรน้อยสุด รวมทุกช่องทางที่ตั้งราคา ขาดทุนอยู่บนสุด', () => {
  const rows = lowestProfits(shop());
  // กะเพรา ต้นทุน 0.17*100+5 = 22 → Grab 40: 40-12-0.84-22 = 5.16, หน้าร้าน 28 ; ไข่เจียว ต้นทุน 7.2 → หน้าร้าน 32.8
  assert.deepEqual(rows.map((r) => [r.menu.name, r.channel]), [['กะเพรา', 'Grab'], ['กะเพรา', 'หน้าร้าน'], ['ไข่เจียว', 'หน้าร้าน']]);
  close(rows[0].profit, 5.16);
});

test('แถวตาราง กรองเดือนและคำค้น เรียงล่าสุดก่อน', () => {
  const s = shop();
  assert.deepEqual(purchaseRows(s, '2026-10').map((r) => r.id), ['e', 'd', 'c', 'b']);
  assert.deepEqual(purchaseRows(s, '', 'หมู').map((r) => r.id), ['b', 'a']);
  close(purchaseRows(s, '2026-10')[0].unitPrice, 0.055);
});

test('ราคาต่อหน่วยแบบอ่านง่าย', () => {
  assert.deepEqual(displayUnitPrice(0.17, 'g'), { value: 170, label: 'บาท/กก.' });
  assert.deepEqual(displayUnitPrice(4, 'pc'), { value: 4, label: 'บาท/ชิ้น' });
  assert.deepEqual(displayUnitPrice(null, 'g'), { value: null, label: '' });
});

test('CSV มี BOM หัวตาราง และใส่เครื่องหมายคำพูดเมื่อจำเป็น', () => {
  const s = shop();
  s.ingredients[0].name = 'หมูสับ, อนามัย';
  const csv = toCsv(purchaseRows(s, '2026-10'));
  assert.ok(csv.startsWith('﻿วันที่,วัตถุดิบ'));
  assert.match(csv, /2026-10-02,"หมูสับ, อนามัย",1000,กรัม,170.00,170.00,บาท\/กก\./);
  assert.equal(csv.trim().split('\r\n').length, 5);
});
