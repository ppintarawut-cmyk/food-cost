import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReceipt, toReviewLines, validateReviewLines, commitReview, ReceiptError } from '../js/receipt.js';
import { emptyState } from '../js/store.js';
import { matchKey } from '../js/calc.js';

function shop() {
  const s = emptyState();
  s.ingredients = [
    { id: 'pork', name: 'หมูสับ', unit: 'g' },
    { id: 'egg', name: 'ไข่', unit: 'pc' },
  ];
  return s;
}

const aiResult = {
  date: '2026-10-11',
  store: 'Makro',
  lines: [
    { name: 'หมูสับอนามัย 1KG', price: 159, quantity: 1000, unit: 'g', suggestion: { kind: 'existing', ingredient_id: 'pork', new_name: null } },
    { name: 'ไข่ไก่เบอร์2 30ฟ', price: 120, quantity: 30, unit: 'pc', suggestion: { kind: 'existing', ingredient_id: 'egg', new_name: null } },
    { name: 'ARO กล่องข้าว 50ใบ', price: 85, quantity: 50, unit: 'pc', suggestion: { kind: 'new', ingredient_id: null, new_name: 'กล่องข้าว' } },
    { name: 'น้ำยาล้างจาน 500มล', price: 39, quantity: 500, unit: 'ml', suggestion: { kind: 'skip', ingredient_id: null, new_name: null } },
  ],
};

test('เตรียมบรรทัดตามคำแนะนำของ AI และแปลง 1000 กรัมเป็น 1 กก.', () => {
  const lines = toReviewLines(aiResult, shop());
  assert.deepEqual(
    lines.map((l) => [l.choice, l.ingredientId, l.newName, l.inputQty, l.inputUnit]),
    [
      ['existing', 'pork', '', 1, 'kg'],
      ['existing', 'egg', '', 30, 'pc'],
      ['new', '', 'กล่องข้าว', 50, 'pc'],
      ['skip', '', '', '', 'ml'],
    ]
  );
});

test('AI ให้หน่วยไม่ตรงกับวัตถุดิบ ต้องให้ผู้ใช้กรอกจำนวนเอง', () => {
  const r = { lines: [{ name: 'หมูสับ แพ็ค', price: 80, quantity: 1, unit: 'pc', suggestion: { kind: 'existing', ingredient_id: 'pork', new_name: null } }] };
  const [line] = toReviewLines(r, shop());
  assert.equal(line.inputQty, '');
  assert.equal(line.inputUnit, 'g');
});

test('บันทึกแล้วสร้างรายการซื้อ วัตถุดิบใหม่ และจำการจับคู่ ครั้งหน้าเลือกให้เอง', () => {
  const s = shop();
  const lines = toReviewLines(aiResult, s);
  assert.deepEqual(validateReviewLines(lines, s.ingredients), {});
  const added = commitReview(s, lines, '2026-10-11', 1000);
  assert.equal(added, 3);
  assert.equal(s.purchases.length, 3);
  const box = s.ingredients.find((i) => i.name === 'กล่องข้าว');
  assert.equal(box.unit, 'pc');
  assert.equal(s.purchases.find((p) => p.ingredientId === 'pork').qty, 1000);
  assert.deepEqual(s.matches[matchKey('น้ำยาล้างจาน 500มล')], { action: 'skip' });

  // ใบเสร็จถัดไป AI เดาผิดหมด แต่การจับคู่ที่จำไว้ต้องชนะ
  const wrong = {
    lines: aiResult.lines.map((l) => ({ ...l, suggestion: { kind: 'new', ingredient_id: null, new_name: 'ผิด' } })),
  };
  const again = toReviewLines(wrong, s);
  assert.deepEqual(
    again.map((l) => [l.choice, l.ingredientId, l.remembered]),
    [
      ['existing', 'pork', true],
      ['existing', 'egg', true],
      ['existing', box.id, true],
      ['skip', '', true],
    ]
  );
});

test('บรรทัดไม่ครบถูกแจ้ง', () => {
  const s = shop();
  const lines = [
    { key: 'a', choice: 'new', newName: '', price: 10, inputQty: 1, inputUnit: 'kg' },
    { key: 'b', choice: 'existing', ingredientId: 'pork', price: 10, inputQty: '', inputUnit: 'kg' },
    { key: 'c', choice: 'existing', ingredientId: 'pork', price: 10, inputQty: 2, inputUnit: 'pc' },
    { key: 'd', choice: 'existing', ingredientId: 'egg', price: '', inputQty: 2, inputUnit: 'pc' },
    { key: 'e', choice: 'skip' },
  ];
  assert.deepEqual(validateReviewLines(lines, s.ingredients), {
    a: 'ตั้งชื่อวัตถุดิบ',
    b: 'ใส่จำนวน',
    c: 'หน่วยไม่ตรงกับวัตถุดิบ',
    d: 'ใส่ราคา',
  });
});

test('ส่งคำขอถึง AI ถูกรูปแบบ และอ่านผลกลับมาได้', async () => {
  let sent;
  class FakeAnthropic {
    constructor(opts) {
      assert.equal(opts.apiKey, 'sk-test');
      assert.equal(opts.dangerouslyAllowBrowser, true);
      this.beta = { messages: { create: async (body) => ((sent = body), { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(aiResult) }] }) } };
    }
  }
  const out = await readReceipt({ apiKey: 'sk-test', imageBase64: 'AAAA', ingredients: shop().ingredients, loadSdk: async () => ({ default: FakeAnthropic }) });
  assert.deepEqual(out, aiResult);
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.messages[0].content[0].source.data, 'AAAA');
  assert.match(sent.messages[0].content[1].text, /หมูสับ/);
});

test('ไม่มีคีย์ หรือ AI ปฏิเสธ ได้ข้อความภาษาไทย', async () => {
  await assert.rejects(readReceipt({ apiKey: '', imageBase64: '', ingredients: [] }), ReceiptError);
  class Refuse {
    constructor() {
      this.beta = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } };
    }
  }
  await assert.rejects(
    readReceipt({ apiKey: 'k', imageBase64: '', ingredients: [], loadSdk: async () => ({ default: Refuse }) }),
    /ไม่ยอมอ่าน/
  );
});
