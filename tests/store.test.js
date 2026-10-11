import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, load, save, makeBackup, parseBackup, backupOverdue, loadApiKey, saveApiKey } from '../js/store.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => m,
  };
}

test('บันทึกแล้วโหลดกลับได้เหมือนเดิม', () => {
  const st = memoryStorage();
  const s = emptyState();
  s.ingredients.push({ id: 'a', name: 'หมูสับ', unit: 'g' });
  assert.equal(save(st, s), true);
  assert.deepEqual(load(st), s);
});

test('ข้อมูลเสียหายแล้วเริ่มใหม่แทนที่จะพัง', () => {
  const st = memoryStorage();
  st.setItem('foodcost.data.v1', '{oops');
  assert.deepEqual(load(st), emptyState());
});

test('ไฟล์สำรองไม่มีคีย์ AI และกู้คืนได้ครบ', () => {
  const st = memoryStorage();
  saveApiKey(st, 'sk-ant-secret');
  const s = emptyState();
  s.menus.push({ id: 'm', name: 'กะเพรา', prices: { store: 50, grab: 70, lineman: 70 }, lines: [] });
  const text = makeBackup(s);
  assert.ok(!text.includes('sk-ant-secret'));
  assert.deepEqual(parseBackup(text), s);
  assert.equal(loadApiKey(st), 'sk-ant-secret');
});

test('ไฟล์ที่ไม่ใช่ไฟล์สำรองถูกปฏิเสธ', () => {
  assert.throws(() => parseBackup('hello'), /ไม่ใช่ไฟล์สำรอง/);
  assert.throws(() => parseBackup('{"a":1}'), /ไม่ใช่ไฟล์สำรอง/);
});

test('เตือนสำรองเมื่อมีข้อมูลและไม่ได้สำรองเกิน 7 วัน', () => {
  const s = emptyState();
  assert.equal(backupOverdue(s), false);
  s.purchases.push({ id: 'p' });
  assert.equal(backupOverdue(s), true);
  const now = Date.now();
  s.settings.lastBackupAt = now - 6 * 86400000;
  assert.equal(backupOverdue(s, now), false);
  s.settings.lastBackupAt = now - 8 * 86400000;
  assert.equal(backupOverdue(s, now), true);
});
