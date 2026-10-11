// อ่านใบเสร็จด้วย AI (ดู docs/decisions/0002) แล้วเตรียมบรรทัดสำหรับหน้าจอตรวจ
// รูปถูกส่งไปให้ AI อ่านเท่านั้น ไม่ถูกเก็บไว้ในเครื่อง

import { INPUT_UNITS, matchKey } from './calc.js';
import { uid } from './store.js';

// รุ่นของ SDK ถูกล็อกไว้ เพื่อไม่ให้รุ่นใหม่ที่ยังไม่ได้ทดสอบเข้ามาเอง
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
const MODEL = 'claude-opus-5-5';
const MAX_IMAGE_EDGE = 2400;

const SYSTEM_PROMPT = `You read photos of Thai shop receipts (Makro, Lotus's, Big C, 7-Eleven and similar) for a small restaurant that tracks what its ingredients cost.

Return every purchased item line on the receipt. For each line:
- name: the item text exactly as printed, keeping Thai abbreviations and pack sizes such as "1KG".
- price: the final amount paid for this line in baht, after any discount printed directly under it. Never output discount, subtotal, VAT, total, payment, change or member-point lines as items.
- quantity and unit: the total amount bought on this line, in base units: "g" for weight, "ml" for volume, "pc" for countable things (eggs, boxes, bags, cutlery). Multiply pack size by count: "1KG x2" is 2000 g, "ไข่ไก่ 30ฟอง" is 30 pc, "น้ำมันพืช 1ลิตร x3" is 3000 ml. Use null when you cannot tell.
- suggestion: if the line is the same thing as one of the restaurant's existing ingredients listed by the user, kind "existing" with that ingredient's id. If it is a food ingredient or food packaging (boxes, bags, cutlery, sauce cups) that is not in the list, kind "new" with a short Thai name such as "หมูสับ". If it is not used to cook or pack food (cleaning products, personal items), kind "skip".

date: the receipt date as YYYY-MM-DD in the Gregorian calendar. Thai receipts often print the Buddhist year; subtract 543 from it. Use null when no date is printed.
store: the shop name as printed, or "".
If the photo is not a receipt, return an empty lines array.`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    date: nullable({ type: 'string' }),
    store: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          quantity: nullable({ type: 'number' }),
          unit: nullable({ type: 'string', enum: ['g', 'ml', 'pc'] }),
          suggestion: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['existing', 'new', 'skip'] },
              ingredient_id: nullable({ type: 'string' }),
              new_name: nullable({ type: 'string' }),
            },
            required: ['kind', 'ingredient_id', 'new_name'],
            additionalProperties: false,
          },
        },
        required: ['name', 'price', 'quantity', 'unit', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['date', 'store', 'lines'],
  additionalProperties: false,
};

/** ย่อรูปให้ด้านยาวไม่เกิน MAX_IMAGE_EDGE แล้วคืน base64 ของ JPEG (ลดขนาดและค่าใช้จ่าย) */
export async function imageToBase64Jpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export class ReceiptError extends Error {}

/** แปลงข้อผิดพลาดจาก SDK เป็นข้อความภาษาไทยที่บอกว่าต้องทำอะไรต่อ */
function explainError(sdk, err) {
  const A = sdk.default ?? sdk;
  if (A.AuthenticationError && err instanceof A.AuthenticationError) {
    return 'คีย์ AI ไม่ถูกต้อง ไปแก้ที่หน้า "ตั้งค่า"';
  }
  if (A.PermissionDeniedError && err instanceof A.PermissionDeniedError) {
    return 'คีย์ AI ไม่มีสิทธิ์ใช้งาน หรือเครดิตในบัญชี AI หมด';
  }
  if (A.RateLimitError && err instanceof A.RateLimitError) {
    return 'ส่งถี่เกินไป หรือถึงวงเงินที่ตั้งไว้ รอสักครู่แล้วลองใหม่';
  }
  if (A.APIConnectionError && err instanceof A.APIConnectionError) {
    return 'ต่ออินเทอร์เน็ตไม่ได้ ลองใหม่เมื่อมีสัญญาณ หรือพิมพ์เองแทน';
  }
  if (A.APIError && err instanceof A.APIError) {
    return `AI ตอบกลับผิดพลาด (${err.status ?? 'ไม่ทราบรหัส'}) ลองใหม่อีกครั้ง`;
  }
  return 'อ่านใบเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์เองแทน';
}

/**
 * ส่งรูปใบเสร็จให้ AI อ่าน คืน { date, store, lines }
 * loadSdk ใส่แทนได้ตอนทดสอบ
 */
export async function readReceipt({ apiKey, imageBase64, ingredients, loadSdk = () => import(SDK_URL) }) {
  if (!apiKey) throw new ReceiptError('ยังไม่ได้ใส่คีย์ AI ไปใส่ที่หน้า "ตั้งค่า" ก่อน');

  let sdk;
  try {
    sdk = await loadSdk();
  } catch {
    throw new ReceiptError('โหลดตัวอ่านใบเสร็จไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }
  const Anthropic = sdk.default ?? sdk.Anthropic;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const ingredientList = ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit }));

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            {
              type: 'text',
              text: `The restaurant's existing ingredients:\n${JSON.stringify(ingredientList)}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new ReceiptError(explainError(sdk, err));
  }

  if (response.stop_reason === 'refusal') {
    throw new ReceiptError('AI ไม่ยอมอ่านรูปนี้ ลองถ่ายใหม่ให้เห็นเฉพาะใบเสร็จ หรือพิมพ์เองแทน');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ReceiptError('ใบเสร็จยาวเกินไป ลองถ่ายทีละครึ่งใบ');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new ReceiptError('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง');
  }
}

/** เลือกหน่วยที่กรอกให้อ่านง่าย เช่น 2000 กรัม → 2 กก. */
function friendlyInput(qty, base) {
  if (qty === null || qty === undefined) {
    return { inputQty: '', inputUnit: base };
  }
  if (base === 'g' && qty >= 1000 && qty % 100 === 0) return { inputQty: qty / 1000, inputUnit: 'kg' };
  if (base === 'ml' && qty >= 1000 && qty % 100 === 0) return { inputQty: qty / 1000, inputUnit: 'l' };
  return { inputQty: qty, inputUnit: base };
}

/**
 * เตรียมบรรทัดสำหรับหน้าจอตรวจ
 * การจับคู่ที่เคยจำไว้มาก่อนคำแนะนำของ AI เสมอ
 */
export function toReviewLines(result, state) {
  const byId = new Map(state.ingredients.map((i) => [i.id, i]));
  return (result.lines || []).map((l) => {
    const line = {
      key: uid(),
      rawName: l.name,
      price: l.price,
      choice: 'new',
      ingredientId: '',
      newName: '',
      newUnit: l.unit || 'g',
      inputQty: '',
      inputUnit: l.unit || 'g',
      remembered: false,
    };
    const memory = state.matches[matchKey(l.name)];

    if (memory?.action === 'skip') {
      return { ...line, choice: 'skip', remembered: true };
    }
    if (memory?.action === 'ingredient' && byId.has(memory.ingredientId)) {
      const ing = byId.get(memory.ingredientId);
      return {
        ...line,
        choice: 'existing',
        ingredientId: ing.id,
        remembered: true,
        ...friendlyInput(memory.qty, ing.unit),
      };
    }

    const s = l.suggestion || {};
    if (s.kind === 'skip') return { ...line, choice: 'skip' };
    if (s.kind === 'existing' && byId.has(s.ingredient_id)) {
      const ing = byId.get(s.ingredient_id);
      // หน่วยไม่ตรงกับวัตถุดิบ (เช่น AI ว่าเป็น "ชิ้น" แต่วัตถุดิบเป็น "กรัม") ให้ผู้ใช้กรอกจำนวนเอง
      const qty = l.unit === ing.unit ? l.quantity : null;
      return { ...line, choice: 'existing', ingredientId: ing.id, ...friendlyInput(qty, ing.unit) };
    }
    return {
      ...line,
      choice: 'new',
      newName: s.new_name || l.name,
      ...friendlyInput(l.quantity, l.unit || 'g'),
    };
  });
}

/** ตรวจบรรทัดก่อนบันทึก คืนข้อความปัญหาของแต่ละบรรทัด (key → ข้อความ) */
export function validateReviewLines(lines, ingredients) {
  const problems = {};
  for (const l of lines) {
    if (l.choice === 'skip') continue;
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    if (l.choice === 'existing' && !ing) problems[l.key] = 'เลือกวัตถุดิบ';
    else if (l.choice === 'existing' && INPUT_UNITS[l.inputUnit]?.base !== ing.unit) {
      problems[l.key] = 'หน่วยไม่ตรงกับวัตถุดิบ';
    }
    else if (l.choice === 'new' && !String(l.newName).trim()) problems[l.key] = 'ตั้งชื่อวัตถุดิบ';
    else if (!(Number(l.price) > 0)) problems[l.key] = 'ใส่ราคา';
    else if (!(Number(l.inputQty) > 0)) problems[l.key] = 'ใส่จำนวน';
  }
  return problems;
}

/**
 * บันทึกบรรทัดที่ตรวจแล้ว: สร้างวัตถุดิบใหม่ เพิ่มรายการซื้อ และจำการจับคู่
 * แก้ state โดยตรง คืนจำนวนรายการซื้อที่เพิ่ม
 */
export function commitReview(state, lines, date, now = Date.now()) {
  const byName = new Map(state.ingredients.map((i) => [i.name.trim().toLowerCase(), i]));
  let added = 0;
  lines.forEach((l, index) => {
    const key = matchKey(l.rawName);
    if (l.choice === 'skip') {
      state.matches[key] = { action: 'skip' };
      return;
    }
    let ing;
    if (l.choice === 'existing') {
      ing = state.ingredients.find((i) => i.id === l.ingredientId);
    } else {
      const name = l.newName.trim();
      ing = byName.get(name.toLowerCase());
      if (!ing) {
        ing = { id: uid(), name, unit: INPUT_UNITS[l.inputUnit].base };
        state.ingredients.push(ing);
        byName.set(name.toLowerCase(), ing);
      }
    }
    const qty = Number(l.inputQty) * INPUT_UNITS[l.inputUnit].factor;
    state.purchases.push({
      id: uid(),
      date,
      ingredientId: ing.id,
      price: Number(l.price),
      qty,
      createdAt: now + index,
    });
    state.matches[key] = { action: 'ingredient', ingredientId: ing.id, qty };
    added += 1;
  });
  return added;
}
