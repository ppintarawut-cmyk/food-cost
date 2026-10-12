// หน้าจอทั้งหมดของโปรแกรม: ภาพรวม, เมนู, ซื้อของ (รายวัน/ตาราง), วัตถุดิบ, ตั้งค่า
// วาดหน้าจอใหม่ทั้งหน้าเมื่อข้อมูลเปลี่ยน ยกเว้นตอนกำลังพิมพ์ จะอัปเดตเฉพาะตัวเลขที่คำนวณ เพื่อไม่ให้คีย์บอร์ดหลุด

import {
  BASE_UNITS,
  CHANNELS,
  INPUT_UNITS,
  baht,
  dailyTotals,
  displayUnitPrice,
  formatQty,
  inputUnitsFor,
  latestPurchase,
  lineCost,
  lowestProfits,
  menuCost,
  monthComparison,
  num,
  priceChanges,
  profitByChannel,
  purchaseRows,
  purchaseSummary,
  toCsv,
  topIngredients,
  unitPrice,
} from './calc.js';
import {
  backupFileName,
  backupOverdue,
  load,
  loadApiKey,
  makeBackup,
  parseBackup,
  save,
  saveApiKey,
  uid,
} from './store.js';
import {
  ReceiptError,
  commitReview,
  imageToBase64Jpeg,
  readReceipt,
  toReviewLines,
  validateReviewLines,
} from './receipt.js';

const storage = window.localStorage;
let state = load(storage);
let apiKey = loadApiKey(storage);

const TAB_TITLES = {
  dashboard: 'ภาพรวม',
  menus: 'เมนู',
  purchases: 'ซื้อของ',
  ingredients: 'วัตถุดิบ',
  settings: 'ตั้งค่า',
};

const ui = {
  tab: 'dashboard',
  screen: null, // { type: 'menu' | 'purchase' | 'review' | 'ingredient', ... }
  month: today().slice(0, 7),
  problems: {},
  purchaseView: 'days', // 'days' | 'table'
  tableQuery: '',
  tableAllMonths: false,
};

const view = document.getElementById('view');
const title = document.getElementById('title');
const backBtn = document.getElementById('back');

// ---------- เครื่องมือเล็ก ๆ ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function numberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ingredientById(id) {
  return state.ingredients.find((i) => i.id === id);
}

function sortedIngredients() {
  return [...state.ingredients].sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

/** ราคาต่อหน่วยแบบอ่านง่าย: กรัม/มล. แสดงต่อ กก./ลิตร */
function unitPriceLabel(ing) {
  const up = unitPrice(state.purchases, ing.id);
  if (up === null) return 'ยังไม่มีราคา';
  if (ing.unit === 'g') return `${baht(up * 1000)} บาท/กก.`;
  if (ing.unit === 'ml') return `${baht(up * 1000)} บาท/ลิตร`;
  return `${baht(up)} บาท/ชิ้น`;
}

/**
 * ส่งไฟล์ออกจากแอป: เปิดหน้าแชร์ของ iPhone (เช่น ส่งเข้า LINE) ถ้าทำไม่ได้ให้ดาวน์โหลดแทน
 * คืน true ถ้าส่งสำเร็จ, false ถ้าผู้ใช้ยกเลิกหรือส่งไม่ได้
 */
async function shareFile(file, title) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    return true;
  } catch (err) {
    if (err?.name !== 'AbortError') toast('ส่งไฟล์ไม่สำเร็จ', true); // AbortError = ผู้ใช้กดยกเลิกหน้าแชร์
    return false;
  }
}

function persist() {
  if (!save(storage, state)) toast('บันทึกไม่สำเร็จ! พื้นที่ในเครื่องอาจเต็ม', true);
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = isError ? 'toast show error' : 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), isError ? 5000 : 2500);
}

function isInstalled() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function unitOptions(base, selected) {
  return inputUnitsFor(base)
    .map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${INPUT_UNITS[id].label}</option>`)
    .join('');
}

function allUnitOptions(selected) {
  return Object.entries(INPUT_UNITS)
    .map(([id, u]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${u.label}</option>`)
    .join('');
}

function ingredientOptions(selectedId) {
  return sortedIngredients()
    .map((i) => `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.name)} (${BASE_UNITS[i.unit]})</option>`)
    .join('');
}

function profitClass(p) {
  if (!p.set) return 'muted';
  return p.profit < 0 ? 'loss' : 'gain';
}

// ---------- แถบเตือน ----------

function banners() {
  let html = '';
  if (!isInstalled()) {
    html += `<div class="banner warn">
      <b>ยังไม่ได้ติดตั้งบนหน้าจอโฮม</b><br>
      ถ้าใช้ผ่าน Safari แล้วไม่ได้เปิดนาน iPhone อาจลบข้อมูลทิ้ง<br>
      กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) → <b>เพิ่มไปยังหน้าจอโฮม</b> แล้วเปิดจากไอคอนนั้น
    </div>`;
  }
  if (backupOverdue(state)) {
    html += `<div class="banner">
      ${state.settings.lastBackupAt ? 'ไม่ได้สำรองข้อมูลเกิน 7 วันแล้ว' : 'ยังไม่เคยสำรองข้อมูล'}
      <button class="btn small" data-action="backup">สำรองเลย</button>
    </div>`;
  }
  return html;
}

// ---------- แท็บเมนู ----------

function renderMenus() {
  const cards = state.menus
    .map((m) => {
      const profits = profitByChannel(state, m);
      const cost = profits[0].cost;
      const chips = profits
        .map(
          (p) => `<div class="chip ${profitClass(p)}">
            <span>${p.label}</span>
            <b>${p.set ? (p.profit >= 0 ? '+' : '') + baht(p.profit) : 'ยังไม่ตั้งราคา'}</b>
          </div>`
        )
        .join('');
      return `<button class="card menu-card" data-action="open-menu" data-id="${m.id}">
        <div class="row"><b>${esc(m.name || 'เมนูไม่มีชื่อ')}</b><span>ต้นทุน ${baht(cost.total)} บาท</span></div>
        ${cost.missing.length ? `<div class="note warn-text">ยังไม่รู้ราคา: ${esc(cost.missing.join(', '))}</div>` : ''}
        <div class="chips">${chips}</div>
      </button>`;
    })
    .join('');

  return `${banners()}
    <button class="btn primary block" data-action="new-menu">+ เพิ่มเมนู</button>
    ${
      cards ||
      `<div class="empty">ยังไม่มีเมนู<br><br>
        แนะนำ: เริ่มจากบันทึกการซื้อวัตถุดิบในแท็บ <b>ซื้อของ</b> ก่อน
        แล้วค่อยมาสร้างเมนูและใส่สูตร</div>`
    }
    ${cards ? '<p class="note center">ตัวเลขในกรอบ = กำไรต่อจาน (บาท) หลังหัก GP</p>' : ''}`;
}

function renderMenuEdit(menu) {
  const hasSundries = menu.lines.some((l) => l.kind === 'sundries');
  const lines = menu.lines
    .map((l, idx) => {
      if (l.kind === 'sundries') {
        return `<div class="recipe-line">
          <div class="grow"><b>ค่าจุกจิก</b><div class="note">น้ำมัน ซอส เครื่องปรุง แก๊ส</div></div>
          <input type="number" step="any" inputmode="decimal" class="qty" value="${esc(l.amount)}"
            data-input="line-amount" data-idx="${idx}" aria-label="ค่าจุกจิก (บาท)">
          <span class="unit">บาท</span>
          <button class="icon-btn" data-action="remove-line" data-idx="${idx}" aria-label="ลบ">✕</button>
        </div>`;
      }
      const ing = ingredientById(l.ingredientId);
      const c = lineCost(state.purchases, l);
      return `<div class="recipe-line">
        <select class="grow" data-change="line-ingredient" data-idx="${idx}" aria-label="วัตถุดิบ">
          ${ing ? '' : '<option value="">เลือกวัตถุดิบ</option>'}
          ${ingredientOptions(l.ingredientId)}
        </select>
        <input type="number" step="any" inputmode="decimal" class="qty" value="${esc(l.qty)}"
          data-input="line-qty" data-idx="${idx}" aria-label="ปริมาณ">
        <span class="unit">${ing ? BASE_UNITS[ing.unit] : ''}</span>
        <button class="icon-btn" data-action="remove-line" data-idx="${idx}" aria-label="ลบ">✕</button>
        <div class="line-cost" data-live="line-cost-${idx}">${c === null ? 'ยังไม่มีราคา' : baht(c) + ' บาท'}</div>
      </div>`;
    })
    .join('');

  const prices = CHANNELS.map(
    (ch) => `<label class="field">
      <span>${ch.label}</span>
      <input type="number" step="any" inputmode="decimal" value="${esc(menu.prices[ch.id] ?? '')}"
        data-input="price" data-channel="${ch.id}" placeholder="ไม่ได้ขาย">
    </label>`
  ).join('');

  return `<label class="field">
      <span>ชื่อเมนู</span>
      <input type="text" value="${esc(menu.name)}" data-input="menu-name" placeholder="เช่น กะเพราหมูสับไข่ดาว">
    </label>

    <h2>สูตร (ต่อ 1 จาน)</h2>
    ${state.ingredients.length === 0 ? '<div class="banner">ยังไม่มีวัตถุดิบ บันทึกการซื้อในแท็บ <b>ซื้อของ</b> ก่อน หรือเพิ่มในแท็บ <b>วัตถุดิบ</b></div>' : ''}
    <div class="card">${lines || '<div class="note">ยังไม่มีอะไรในสูตร</div>'}</div>
    <div class="btn-row">
      <button class="btn" data-action="add-line" ${state.ingredients.length ? '' : 'disabled'}>+ วัตถุดิบ</button>
      ${hasSundries ? '' : '<button class="btn" data-action="add-sundries">+ ค่าจุกจิก</button>'}
    </div>

    <h2>ราคาขาย (บาท)</h2>
    <div class="card prices">${prices}</div>

    <h2>กำไรต่อจาน</h2>
    <div data-live="menu-summary">${renderMenuSummary(menu)}</div>

    <button class="btn danger block" data-action="delete-menu">ลบเมนูนี้</button>`;
}

function renderMenuSummary(menu) {
  const profits = profitByChannel(state, menu);
  const cost = profits[0].cost;
  const cell = (p, fn) => (p.set ? fn(p) : '-');
  const vatOn = state.settings.vatOnGp;
  return `<div class="card">
    ${cost.missing.length ? `<div class="note warn-text">ต้นทุนยังไม่ครบ ยังไม่รู้ราคา: ${esc(cost.missing.join(', '))}</div>` : ''}
    <table class="summary">
      <thead><tr><th></th>${profits.map((p) => `<th>${p.label}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td>ราคาขาย</td>${profits.map((p) => `<td>${cell(p, (x) => baht(x.price))}</td>`).join('')}</tr>
        <tr><td>หัก GP</td>${profits.map((p) => `<td>${cell(p, (x) => (x.gpFee ? '−' + baht(x.gpFee) : '0.00'))}</td>`).join('')}</tr>
        ${vatOn ? `<tr><td>หัก VAT ของ GP</td>${profits.map((p) => `<td>${cell(p, (x) => (x.vat ? '−' + baht(x.vat) : '0.00'))}</td>`).join('')}</tr>` : ''}
        <tr class="sub"><td>ร้านได้รับ</td>${profits.map((p) => `<td>${cell(p, (x) => baht(x.net))}</td>`).join('')}</tr>
        <tr><td>หักต้นทุน</td>${profits.map((p) => `<td>${cell(p, () => '−' + baht(cost.total))}</td>`).join('')}</tr>
        <tr class="total"><td>กำไร</td>${profits
          .map((p) => `<td class="${profitClass(p)}">${cell(p, (x) => baht(x.profit))}</td>`)
          .join('')}</tr>
      </tbody>
    </table>
    <div class="note">ต้นทุนต่อจาน ${baht(cost.total)} บาท · GP Grab ${num(state.settings.gpGrab)}% · LINE MAN ${num(state.settings.gpLineman)}%</div>
  </div>`;
}

// ---------- แท็บซื้อของ ----------

function renderPurchases() {
  const summary = purchaseSummary(state.purchases, ui.month);
  const days = summary.days
    .map(
      (d) => `<div class="day">
        <div class="day-head"><b>${dayLabel(d.date)}</b><span>${baht(d.total)} บาท</span></div>
        <div class="card">
          ${d.items
            .map((p) => {
              const ing = ingredientById(p.ingredientId);
              return `<button class="list-item" data-action="open-purchase" data-id="${p.id}">
                <span class="grow">${esc(ing ? ing.name : '(วัตถุดิบที่ถูกลบ)')}
                  <span class="note">${ing ? formatQty(p.qty, ing.unit) : ''}</span></span>
                <b>${baht(p.price)}</b>
              </button>`;
            })
            .join('')}
        </div>
      </div>`
    )
    .join('');

  return `${banners()}
    <div class="btn-row big">
      <button class="btn primary" data-action="scan">📷 ถ่ายใบเสร็จ</button>
      <button class="btn" data-action="new-purchase">✏️ พิมพ์เอง</button>
    </div>
    ${monthBar(`ค่าซื้อทั้งเดือน ${baht(summary.total)} บาท`)}
    <div class="segmented" role="tablist">
      <button role="tab" data-action="purchase-view" data-view="days" class="${ui.purchaseView === 'days' ? 'active' : ''}">รายวัน</button>
      <button role="tab" data-action="purchase-view" data-view="table" class="${ui.purchaseView === 'table' ? 'active' : ''}">ตาราง</button>
    </div>
    ${ui.purchaseView === 'table' ? renderPurchaseTable() : days || '<div class="empty">เดือนนี้ยังไม่มีรายการซื้อ</div>'}`;
}

function monthBar(subtitle) {
  return `<div class="month-bar">
      <button class="icon-btn" data-action="month" data-delta="-1" aria-label="เดือนก่อน">‹</button>
      <div class="center"><b>${monthLabel(ui.month)}</b><div class="note">${subtitle}</div></div>
      <button class="icon-btn" data-action="month" data-delta="1" aria-label="เดือนถัดไป">›</button>
    </div>`;
}

function tableRows() {
  return purchaseRows(state, ui.tableAllMonths ? '' : ui.month, ui.tableQuery);
}

function renderPurchaseTable() {
  return `<div class="table-tools">
      <input type="search" value="${esc(ui.tableQuery)}" data-input="table-query" placeholder="ค้นหาวัตถุดิบ" aria-label="ค้นหาวัตถุดิบ">
      <label class="toggle compact"><input type="checkbox" ${ui.tableAllMonths ? 'checked' : ''} data-change="table-all"><span>ทุกเดือน</span></label>
    </div>
    <div data-live="table">${renderTableBody(tableRows())}</div>
    <button class="btn block" data-action="export-csv">ส่งออกเป็นไฟล์ Excel (CSV)</button>
    <div class="note center">ส่งออกตามที่แสดงในตาราง · แตะแถวเพื่อแก้ไข</div>`;
}

function renderTableBody(rows) {
  if (!rows.length) return '<div class="empty">ไม่มีรายการ</div>';
  const total = rows.reduce((s, r) => s + r.price, 0);
  // หน้าจอมือถือแคบ: ใส่จำนวนไว้ใต้ชื่อ และราคาต่อหน่วยไว้ใต้ราคา แทนการแยกคอลัมน์
  return `<div class="table-wrap card">
    <table class="data">
      <thead><tr><th>วันที่</th><th>วัตถุดิบ · จำนวน</th><th class="num">ราคา (บาท)</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const up = displayUnitPrice(r.unitPrice, r.unit);
            return `<tr data-action="open-purchase" data-id="${r.id}">
              <td class="nowrap">${shortDate(r.date)}</td>
              <td>${esc(r.name)}<div class="note">${formatQty(r.qty, r.unit)}</div></td>
              <td class="num"><b>${baht(r.price)}</b>${up.value === null ? '' : `<div class="note nowrap">${baht(up.value)} ${up.label}</div>`}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
      <tfoot><tr><td colspan="2">รวม ${rows.length} รายการ</td><td class="num">${baht(total)}</td></tr></tfoot>
    </table>
  </div>`;
}

function shortDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: ui.tableAllMonths ? '2-digit' : undefined });
}

// ---------- แท็บภาพรวม ----------

function renderDashboard() {
  if (!state.purchases.length && !state.menus.length) {
    return `${banners()}<div class="empty">ยังไม่มีข้อมูล<br><br>
      เริ่มจากบันทึกการซื้อวัตถุดิบในแท็บ <b>ซื้อของ</b><br>แล้วสร้างเมนูในแท็บ <b>เมนู</b><br>
      หน้านี้จะสรุปให้เห็นภาพรวมเอง</div>`;
  }
  const cmp = monthComparison(state.purchases, ui.month, shiftMonth(ui.month, -1));
  let compare = 'เดือนก่อนไม่มีข้อมูลให้เทียบ';
  if (cmp.change !== null) {
    const pct = Math.round(Math.abs(cmp.change) * 100);
    compare = cmp.change === 0
      ? `เท่ากับเดือนก่อน (${baht(cmp.previous)} บาท)`
      : `${cmp.change > 0 ? '▲ มากกว่า' : '▼ น้อยกว่า'}เดือนก่อน ${pct}% (เดือนก่อน ${baht(cmp.previous)} บาท)`;
  }

  return `${banners()}
    ${monthBar('ภาพรวมของเดือน')}
    <div class="card kpi">
      <div class="note">ค่าซื้อวัตถุดิบเดือนนี้</div>
      <div class="kpi-value">${baht(cmp.current)} <span class="kpi-unit">บาท</span></div>
      <div class="note">${compare}</div>
    </div>

    <h2>ค่าซื้อรายวัน</h2>
    <div class="card">${renderDailyChart(dailyTotals(state.purchases, ui.month))}</div>

    <h2>วัตถุดิบที่จ่ายเยอะสุด</h2>
    <div class="card">${renderTopIngredients(topIngredients(state, ui.month))}</div>

    <h2>ราคาวัตถุดิบที่เปลี่ยน</h2>
    <div class="card">${renderPriceChanges(priceChanges(state))}</div>

    <h2>เมนูที่กำไรต่อจานน้อยสุด</h2>
    <div class="card">${renderLowestProfits(lowestProfits(state))}</div>`;
}

/** ปัดเพดานแกนให้เป็นเลขกลม ๆ เช่น 437 → 500, 1,820 → 2,000 */
function niceMax(v) {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag;
  return 10 * mag;
}

function compact(n) {
  return n >= 1000 ? `${num(n / 1000)}K` : num(n);
}

function renderDailyChart(days) {
  const total = days.reduce((s, d) => s + d.total, 0);
  if (total === 0) return '<div class="empty small">เดือนนี้ยังไม่มีรายการซื้อ</div>';
  const W = 320, H = 160, left = 34, right = 6, top = 10, bottom = 22;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = niceMax(Math.max(...days.map((d) => d.total)));
  const slot = plotW / days.length;
  const barW = Math.min(24, slot - 2);
  const y = (v) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const grid = ticks
    .map((t) => `<line x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
      <text x="${left - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${compact(t)}</text>`)
    .join('');
  const labelDays = new Set([1, 5, 10, 15, 20, 25, days.length]);
  const bars = days
    .map((d, i) => {
      const x = left + i * slot + (slot - barW) / 2;
      const h = (d.total / max) * plotH;
      const r = Math.min(4, barW / 2, h);
      const base = top + plotH;
      const bar = h > 0
        ? `<path class="bar" d="M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z"/>`
        : '';
      const label = labelDays.has(d.day) ? `<text x="${x + barW / 2}" y="${H - 6}" class="axis" text-anchor="middle">${d.day}</text>` : '';
      // พื้นที่แตะกว้างเต็มช่องและสูงเต็มกราฟ แตะง่ายกว่าตัวแท่ง
      return `<g class="day-col" data-day="${d.day}" data-total="${d.total}">
        <rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}"/>${bar}</g>${label}`;
    })
    .join('');
  const busiest = days.reduce((a, b) => (b.total > a.total ? b : a));
  return `<div class="chart-readout" data-live="chart-readout">${readout(busiest, true)}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟค่าซื้อรายวัน เดือน${monthLabel(ui.month)}">
      ${grid}${bars}
      <line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/>
    </svg>
    <div class="note">แตะแท่งกราฟเพื่อดูยอดของวันนั้น · ดูทุกรายการได้ที่ ซื้อของ → ตาราง</div>`;
}

function readout(d, isBusiest = false) {
  const [y, m] = ui.month.split('-').map(Number);
  const label = new Date(y, m - 1, d.day).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
  return `<b>${label}</b> ${baht(d.total)} บาท${isBusiest ? ' <span class="note">(วันที่ซื้อเยอะสุด)</span>' : ''}`;
}

function renderTopIngredients(items) {
  if (!items.length) return '<div class="empty small">เดือนนี้ยังไม่มีรายการซื้อ</div>';
  const maxShare = items[0].share;
  return items
    .map(
      (t) => `<div class="hbar">
        <div class="row"><span>${esc(t.ingredient.name)}</span><span><b>${baht(t.total)}</b> <span class="note">${Math.round(t.share * 100)}%</span></span></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(t.share / maxShare) * 100}%"></div></div>
      </div>`
    )
    .join('');
}

function renderPriceChanges(changes) {
  if (!changes.length) return '<div class="empty small">ยังไม่มีวัตถุดิบที่ราคาเปลี่ยน<br>(ต้องซื้อของเดิมอย่างน้อย 2 ครั้ง)</div>';
  return changes
    .slice(0, 8)
    .map((c) => {
      const before = displayUnitPrice(c.previous, c.ingredient.unit);
      const now = displayUnitPrice(c.current, c.ingredient.unit);
      const up = c.change > 0;
      return `<div class="list-item static">
        <span class="grow">${esc(c.ingredient.name)}
          <span class="note">${baht(before.value)} → ${baht(now.value)} ${now.label} · ซื้อล่าสุด ${dayLabel(c.date)}</span></span>
        <b class="nowrap ${up ? 'loss' : 'gain'}">${up ? '▲ ขึ้น' : '▼ ลง'} ${Math.round(Math.abs(c.change) * 100)}%</b>
      </div>`;
    })
    .join('');
}

function renderLowestProfits(rows) {
  if (!rows.length) return '<div class="empty small">ยังไม่มีเมนูที่ตั้งราคาขาย</div>';
  return rows
    .map(
      (r) => `<button class="list-item" data-action="open-menu" data-id="${r.menu.id}">
        <span class="grow">${esc(r.menu.name || 'เมนูไม่มีชื่อ')}
          <span class="note">${r.channel} · ขาย ${baht(r.price)} บาท${r.incomplete ? ' · ต้นทุนยังไม่ครบ' : ''}</span></span>
        <b class="nowrap ${r.profit < 0 ? 'loss' : ''}">${r.profit < 0 ? 'ขาดทุน ' : ''}${baht(r.profit)}</b>
      </button>`
    )
    .join('');
}

function renderPurchaseForm(form) {
  const ing = ingredientById(form.ingredientId);
  const isNew = form.ingredientId === '__new';
  const base = ing ? ing.unit : null;
  const unitSelect = base ? unitOptions(base, form.inputUnit) : allUnitOptions(form.inputUnit);
  return `<label class="field"><span>วันที่ซื้อ</span>
      <input type="date" value="${esc(form.date)}" data-input="pf-date"></label>
    <label class="field"><span>วัตถุดิบ</span>
      <select data-change="pf-ingredient">
        <option value="" ${!form.ingredientId ? 'selected' : ''} disabled>เลือกวัตถุดิบ</option>
        ${ingredientOptions(form.ingredientId)}
        <option value="__new" ${isNew ? 'selected' : ''}>+ วัตถุดิบใหม่</option>
      </select></label>
    ${isNew ? `<label class="field"><span>ชื่อวัตถุดิบใหม่</span>
      <input type="text" value="${esc(form.newName)}" data-input="pf-newname" placeholder="เช่น หมูสับ"></label>` : ''}
    <div class="field-row">
      <label class="field grow"><span>จำนวนที่ได้</span>
        <input type="number" step="any" inputmode="decimal" value="${esc(form.inputQty)}" data-input="pf-qty"></label>
      <label class="field"><span>หน่วย</span>
        <select data-change="pf-unit">${unitSelect}</select></label>
    </div>
    <label class="field"><span>ราคาที่จ่าย (บาท)</span>
      <input type="number" step="any" inputmode="decimal" value="${esc(form.price)}" data-input="pf-price"></label>
    <div class="note" data-live="pf-unitprice">${purchaseFormUnitPrice(form)}</div>
    <button class="btn primary block" data-action="save-purchase">บันทึก</button>
    ${form.id ? '<button class="btn danger block" data-action="delete-purchase">ลบรายการนี้</button>' : ''}`;
}

function purchaseFormUnitPrice(form) {
  const qty = numberOrNull(form.inputQty);
  const price = numberOrNull(form.price);
  if (!(qty > 0) || !(price > 0)) return '';
  const u = INPUT_UNITS[form.inputUnit];
  const perBase = price / (qty * u.factor);
  if (u.base === 'pc') return `= ${baht(perBase)} บาท/ชิ้น`;
  return `= ${baht(perBase * 1000)} บาท/${u.base === 'g' ? 'กก.' : 'ลิตร'}`;
}

// ---------- หน้าจอตรวจใบเสร็จ ----------

function renderReview(r) {
  const included = r.lines.filter((l) => l.choice !== 'skip');
  const sum = included.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const lines = r.lines
    .map((l) => {
      const problem = ui.problems[l.key];
      const ing = ingredientById(l.ingredientId);
      const base = l.choice === 'existing' && ing ? ing.unit : null;
      const choiceValue = l.choice === 'existing' ? l.ingredientId : l.choice === 'new' ? '__new' : '__skip';
      return `<div class="card review-line ${l.choice === 'skip' ? 'skipped' : ''} ${problem ? 'has-problem' : ''}">
        <div class="raw">${esc(l.rawName)} ${l.remembered ? '<span class="badge">จำไว้แล้ว</span>' : ''}</div>
        <select data-change="rv-choice" data-key="${l.key}" aria-label="เป็นวัตถุดิบอะไร">
          ${choiceValue === '' ? '<option value="" selected disabled>เลือกวัตถุดิบ</option>' : ''}
          ${ingredientOptions(l.choice === 'existing' ? l.ingredientId : '')}
          <option value="__new" ${l.choice === 'new' ? 'selected' : ''}>+ วัตถุดิบใหม่</option>
          <option value="__skip" ${l.choice === 'skip' ? 'selected' : ''}>ข้าม (ไม่ใช่วัตถุดิบ)</option>
        </select>
        ${l.choice === 'new' ? `<input type="text" value="${esc(l.newName)}" data-input="rv-newname" data-key="${l.key}" placeholder="ชื่อวัตถุดิบ" aria-label="ชื่อวัตถุดิบใหม่">` : ''}
        ${
          l.choice === 'skip'
            ? ''
            : `<div class="field-row">
            <input type="number" step="any" inputmode="decimal" class="grow" value="${esc(l.inputQty)}"
              data-input="rv-qty" data-key="${l.key}" placeholder="จำนวน" aria-label="จำนวน">
            <select data-change="rv-unit" data-key="${l.key}" aria-label="หน่วย">
              ${base ? unitOptions(base, l.inputUnit) : allUnitOptions(l.inputUnit)}
            </select>
            <input type="number" step="any" inputmode="decimal" class="grow" value="${esc(l.price)}"
              data-input="rv-price" data-key="${l.key}" aria-label="ราคา (บาท)">
            <span class="unit">บาท</span>
          </div>`
        }
        ${problem ? `<div class="problem">⚠️ ${problem}</div>` : ''}
      </div>`;
    })
    .join('');

  return `<div class="banner">ตรวจให้ถูกก่อนบันทึก: AI อาจอ่านผิด โดยเฉพาะ<b>จำนวน</b>และ<b>หน่วย</b></div>
    <div class="field-row">
      <label class="field grow"><span>ร้าน</span><input type="text" value="${esc(r.store)}" data-input="rv-store"></label>
      <label class="field"><span>วันที่ซื้อ</span><input type="date" value="${esc(r.date)}" data-input="rv-date"></label>
    </div>
    ${lines || '<div class="empty">ไม่พบรายการในรูปนี้ ลองถ่ายใหม่ให้เห็นใบเสร็จชัด ๆ</div>'}
    <div class="sticky-actions">
      <div class="note center" data-live="rv-sum">รวม ${included.length} รายการ ${baht(sum)} บาท</div>
      <div class="btn-row">
        <button class="btn" data-action="cancel-review">ยกเลิก</button>
        <button class="btn primary grow" data-action="save-review" ${included.length || r.lines.length ? '' : 'disabled'}>บันทึก</button>
      </div>
    </div>`;
}

// ---------- แท็บวัตถุดิบ ----------

function renderIngredients() {
  const rows = sortedIngredients()
    .map((i) => {
      const last = latestPurchase(state.purchases, i.id);
      return `<button class="list-item" data-action="open-ingredient" data-id="${i.id}">
        <span class="grow">${esc(i.name)}
          <span class="note">${last ? `ซื้อล่าสุด ${formatQty(last.qty, i.unit)} ${baht(last.price)} บาท (${dayLabel(last.date)})` : 'ยังไม่เคยซื้อ'}</span></span>
        <b class="nowrap">${unitPriceLabel(i)}</b>
      </button>`;
    })
    .join('');
  return `<div class="card">
      <div class="field-row">
        <input type="text" class="grow" id="new-ing-name" placeholder="ชื่อวัตถุดิบ เช่น กล่องข้าว" aria-label="ชื่อวัตถุดิบ">
        <select id="new-ing-unit" aria-label="หน่วย">
          ${Object.entries(BASE_UNITS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
        </select>
        <button class="btn" data-action="add-ingredient">เพิ่ม</button>
      </div>
      <div class="note">ราคาจะมาจากการบันทึกซื้อครั้งล่าสุด</div>
    </div>
    ${rows ? `<div class="card">${rows}</div>` : '<div class="empty">ยังไม่มีวัตถุดิบ</div>'}`;
}

function renderIngredientDetail(ing) {
  const history = state.purchases
    .filter((p) => p.ingredientId === ing.id)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  const usedIn = state.menus.filter((m) => m.lines.some((l) => l.ingredientId === ing.id));
  return `<label class="field"><span>ชื่อ</span>
      <input type="text" value="${esc(ing.name)}" data-input="ing-name"></label>
    <div class="note">หน่วย: ${BASE_UNITS[ing.unit]} · ราคาตอนนี้ ${unitPriceLabel(ing)}</div>

    <h2>ใช้ในเมนู</h2>
    <div class="card">${usedIn.map((m) => `<div class="list-item">${esc(m.name || 'เมนูไม่มีชื่อ')}</div>`).join('') || '<div class="note">ยังไม่ได้ใช้ในเมนูไหน</div>'}</div>

    <h2>ประวัติการซื้อ</h2>
    <div class="card">${
      history
        .map((p) => `<div class="list-item"><span class="grow">${dayLabel(p.date)} <span class="note">${formatQty(p.qty, ing.unit)}</span></span><b>${baht(p.price)}</b></div>`)
        .join('') || '<div class="note">ยังไม่เคยซื้อ</div>'
    }</div>

    <button class="btn danger block" data-action="delete-ingredient" ${usedIn.length ? 'disabled' : ''}>ลบวัตถุดิบนี้</button>
    ${usedIn.length ? '<div class="note center">ลบไม่ได้ เพราะยังใช้อยู่ในเมนู</div>' : ''}`;
}

// ---------- แท็บตั้งค่า ----------

function renderSettings() {
  const s = state.settings;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่เคย';
  return `${isInstalled() ? '' : banners()}
    <h2>GP และภาษี</h2>
    <div class="card">
      <label class="field"><span>GP ของ Grab (%)</span>
        <input type="number" step="any" inputmode="decimal" value="${esc(s.gpGrab)}" data-input="set-gpGrab"></label>
      <label class="field"><span>GP ของ LINE MAN (%)</span>
        <input type="number" step="any" inputmode="decimal" value="${esc(s.gpLineman)}" data-input="set-gpLineman"></label>
      <label class="toggle"><input type="checkbox" ${s.vatOnGp ? 'checked' : ''} data-change="set-vatOnGp">
        <span>คิด VAT 7% บนค่า GP</span></label>
      <label class="field"><span>ค่าจุกจิกเริ่มต้นของเมนูใหม่ (บาท/จาน)</span>
        <input type="number" step="any" inputmode="decimal" value="${esc(s.sundriesDefault)}" data-input="set-sundriesDefault"></label>
    </div>

    <h2>สำรองข้อมูล</h2>
    <div class="card">
      <div class="note">สำรองล่าสุด: ${last}</div>
      <button class="btn primary block" data-action="backup">ส่งไฟล์สำรอง (เช่น เข้า LINE ตัวเอง)</button>
      <button class="btn block" data-action="restore">กู้คืนจากไฟล์สำรอง</button>
      <div class="note">ไฟล์สำรองไม่มีคีย์ AI กู้คืนแล้วต้องใส่คีย์ใหม่</div>
    </div>

    <h2>คีย์ AI สำหรับอ่านใบเสร็จ</h2>
    <div class="card">
      <div class="note">${apiKey ? '✅ ใส่คีย์แล้ว' : 'ยังไม่ได้ใส่คีย์ (ยังพิมพ์รายการซื้อเองได้)'}</div>
      <input type="password" id="api-key" placeholder="${apiKey ? 'ใส่คีย์ใหม่เพื่อเปลี่ยน' : 'sk-ant-...'}" autocomplete="off" aria-label="คีย์ AI">
      <div class="btn-row">
        <button class="btn primary grow" data-action="save-key">บันทึกคีย์</button>
        ${apiKey ? '<button class="btn danger" data-action="clear-key">ลบคีย์</button>' : ''}
      </div>
      <div class="note">คีย์เก็บไว้ในเครื่องนี้เท่านั้น ค่าอ่านใบเสร็จประมาณ 1–3 บาทต่อใบ ควรตั้งวงเงินรายเดือนในบัญชี AI ไว้ด้วย</div>
    </div>

    <h2>ข้อมูลทั้งหมด</h2>
    <div class="card note">
      วัตถุดิบ ${state.ingredients.length} · เมนู ${state.menus.length} · รายการซื้อ ${state.purchases.length}
    </div>`;
}

// ---------- วาดหน้าจอ ----------

function render() {
  const s = ui.screen;
  let html;
  let heading = TAB_TITLES[ui.tab];
  if (s?.type === 'menu') {
    const menu = state.menus.find((m) => m.id === s.id);
    if (!menu) return closeScreen();
    heading = 'แก้ไขเมนู';
    html = renderMenuEdit(menu);
  } else if (s?.type === 'purchase') {
    heading = s.form.id ? 'แก้ไขรายการซื้อ' : 'บันทึกการซื้อ';
    html = renderPurchaseForm(s.form);
  } else if (s?.type === 'review') {
    heading = 'ตรวจใบเสร็จ';
    html = renderReview(s);
  } else if (s?.type === 'ingredient') {
    const ing = ingredientById(s.id);
    if (!ing) return closeScreen();
    heading = 'วัตถุดิบ';
    html = renderIngredientDetail(ing);
  } else {
    html = {
      dashboard: renderDashboard,
      menus: renderMenus,
      purchases: renderPurchases,
      ingredients: renderIngredients,
      settings: renderSettings,
    }[ui.tab]();
  }
  title.textContent = heading;
  backBtn.hidden = !s;
  view.innerHTML = html;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
}

function openScreen(screen) {
  ui.screen = screen;
  ui.problems = {};
  render();
  window.scrollTo(0, 0);
}

function closeScreen() {
  const s = ui.screen;
  // เมนูใหม่ที่ไม่ได้กรอกอะไรเลย ไม่ต้องเก็บไว้
  if (s?.type === 'menu') {
    const m = state.menus.find((x) => x.id === s.id);
    const untouched = m && !m.name.trim() && m.lines.every((l) => l.kind === 'sundries') && CHANNELS.every((c) => m.prices[c.id] === null);
    if (untouched) {
      state.menus = state.menus.filter((x) => x.id !== m.id);
      persist();
    }
  }
  ui.screen = null;
  ui.problems = {};
  render();
}

/** อัปเดตเฉพาะตัวเลขที่คำนวณ ระหว่างที่ผู้ใช้กำลังพิมพ์ */
function refreshLive() {
  const s = ui.screen;
  if (!s && ui.tab === 'purchases') {
    const el = view.querySelector('[data-live="table"]');
    if (el) el.innerHTML = renderTableBody(tableRows());
  } else if (s?.type === 'menu') {
    const menu = state.menus.find((m) => m.id === s.id);
    const summary = view.querySelector('[data-live="menu-summary"]');
    if (summary) summary.innerHTML = renderMenuSummary(menu);
    menu.lines.forEach((l, idx) => {
      const el = view.querySelector(`[data-live="line-cost-${idx}"]`);
      if (!el) return;
      const c = lineCost(state.purchases, l);
      el.textContent = c === null ? 'ยังไม่มีราคา' : `${baht(c)} บาท`;
    });
  } else if (s?.type === 'purchase') {
    const el = view.querySelector('[data-live="pf-unitprice"]');
    if (el) el.textContent = purchaseFormUnitPrice(s.form);
  } else if (s?.type === 'review') {
    const included = s.lines.filter((l) => l.choice !== 'skip');
    const sum = included.reduce((acc, l) => acc + (Number(l.price) || 0), 0);
    const el = view.querySelector('[data-live="rv-sum"]');
    if (el) el.textContent = `รวม ${included.length} รายการ ${baht(sum)} บาท`;
  }
}

// ---------- การกระทำ ----------

function currentMenu() {
  return state.menus.find((m) => m.id === ui.screen?.id);
}

function reviewLine(key) {
  return ui.screen.lines.find((l) => l.key === key);
}

const actions = {
  'new-menu'() {
    const menu = {
      id: uid(),
      name: '',
      prices: { store: null, grab: null, lineman: null },
      lines: [{ kind: 'sundries', amount: Number(state.settings.sundriesDefault) || 0 }],
    };
    state.menus.push(menu);
    persist();
    openScreen({ type: 'menu', id: menu.id });
  },
  'open-menu'(el) {
    openScreen({ type: 'menu', id: el.dataset.id });
  },
  'add-line'() {
    currentMenu().lines.push({ kind: 'ingredient', ingredientId: '', qty: '' });
    persist();
    render();
  },
  'add-sundries'() {
    currentMenu().lines.push({ kind: 'sundries', amount: Number(state.settings.sundriesDefault) || 0 });
    persist();
    render();
  },
  'remove-line'(el) {
    currentMenu().lines.splice(Number(el.dataset.idx), 1);
    persist();
    render();
  },
  'delete-menu'() {
    const menu = currentMenu();
    if (!confirm(`ลบเมนู "${menu.name || 'เมนูไม่มีชื่อ'}"?`)) return;
    state.menus = state.menus.filter((m) => m.id !== menu.id);
    persist();
    ui.screen = null;
    render();
    toast('ลบเมนูแล้ว');
  },

  month(el) {
    ui.month = shiftMonth(ui.month, Number(el.dataset.delta));
    render();
  },
  'purchase-view'(el) {
    ui.purchaseView = el.dataset.view;
    render();
  },
  async 'export-csv'() {
    const rows = tableRows();
    if (!rows.length) return toast('ไม่มีรายการให้ส่งออก', true);
    const name = `food-cost-purchases-${ui.tableAllMonths ? 'all' : ui.month}.csv`;
    const file = new File([toCsv(rows)], name, { type: 'text/csv' });
    if (await shareFile(file, 'ตารางรายการซื้อ')) toast('ส่งออกแล้ว');
  },
  'new-purchase'() {
    openScreen({
      type: 'purchase',
      form: { id: null, date: today(), ingredientId: '', newName: '', inputQty: '', inputUnit: 'kg', price: '' },
    });
  },
  'open-purchase'(el) {
    const p = state.purchases.find((x) => x.id === el.dataset.id);
    const ing = ingredientById(p.ingredientId);
    const unit = ing ? ing.unit : 'g';
    openScreen({
      type: 'purchase',
      form: { id: p.id, date: p.date, ingredientId: p.ingredientId, newName: '', inputQty: p.qty, inputUnit: unit, price: p.price },
    });
  },
  'save-purchase'() {
    const f = ui.screen.form;
    const qty = numberOrNull(f.inputQty);
    const price = numberOrNull(f.price);
    if (!f.date) return toast('ใส่วันที่ซื้อ', true);
    if (!f.ingredientId) return toast('เลือกวัตถุดิบ', true);
    if (f.ingredientId === '__new' && !f.newName.trim()) return toast('ตั้งชื่อวัตถุดิบใหม่', true);
    if (!(qty > 0)) return toast('ใส่จำนวนที่ได้', true);
    if (!(price > 0)) return toast('ใส่ราคาที่จ่าย', true);

    const unit = INPUT_UNITS[f.inputUnit];
    let ingredientId = f.ingredientId;
    if (ingredientId === '__new') {
      const name = f.newName.trim();
      const existing = state.ingredients.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing && existing.unit !== unit.base) return toast(`มี "${existing.name}" อยู่แล้วแต่ใช้หน่วย${BASE_UNITS[existing.unit]}`, true);
      if (existing) ingredientId = existing.id;
      else {
        ingredientId = uid();
        state.ingredients.push({ id: ingredientId, name, unit: unit.base });
      }
    }
    const record = { date: f.date, ingredientId, price, qty: qty * unit.factor };
    if (f.id) {
      Object.assign(state.purchases.find((p) => p.id === f.id), record);
    } else {
      state.purchases.push({ id: uid(), createdAt: Date.now(), ...record });
    }
    persist();
    ui.month = f.date.slice(0, 7);
    closeScreen();
    toast('บันทึกแล้ว');
  },
  'delete-purchase'() {
    if (!confirm('ลบรายการซื้อนี้?')) return;
    state.purchases = state.purchases.filter((p) => p.id !== ui.screen.form.id);
    persist();
    closeScreen();
    toast('ลบแล้ว');
  },

  scan() {
    if (!apiKey) {
      toast('ยังไม่ได้ใส่คีย์ AI ไปที่แท็บ ตั้งค่า ก่อน', true);
      return;
    }
    const input = document.getElementById('receipt-input');
    input.value = '';
    input.click();
  },
  'cancel-review'() {
    if (!confirm('ยกเลิก? รายการจากใบเสร็จนี้จะไม่ถูกบันทึก')) return;
    closeScreen();
  },
  'save-review'() {
    const r = ui.screen;
    ui.problems = validateReviewLines(r.lines, state.ingredients);
    if (!r.date) return toast('ใส่วันที่ซื้อ', true);
    if (Object.keys(ui.problems).length) {
      render();
      view.querySelector('.has-problem')?.scrollIntoView({ block: 'center' });
      return toast('มีบางรายการยังไม่ครบ', true);
    }
    const added = commitReview(state, r.lines, r.date);
    persist();
    ui.month = r.date.slice(0, 7);
    closeScreen();
    toast(`บันทึก ${added} รายการแล้ว`);
  },

  'add-ingredient'() {
    const nameEl = document.getElementById('new-ing-name');
    const name = nameEl.value.trim();
    if (!name) return toast('ใส่ชื่อวัตถุดิบ', true);
    if (state.ingredients.some((i) => i.name.toLowerCase() === name.toLowerCase())) return toast('มีวัตถุดิบชื่อนี้แล้ว', true);
    state.ingredients.push({ id: uid(), name, unit: document.getElementById('new-ing-unit').value });
    persist();
    render();
    toast('เพิ่มแล้ว');
  },
  'open-ingredient'(el) {
    openScreen({ type: 'ingredient', id: el.dataset.id });
  },
  'delete-ingredient'() {
    const ing = ingredientById(ui.screen.id);
    const count = state.purchases.filter((p) => p.ingredientId === ing.id).length;
    const msg = count ? `ลบ "${ing.name}" และประวัติการซื้อ ${count} รายการ?` : `ลบ "${ing.name}"?`;
    if (!confirm(msg)) return;
    state.ingredients = state.ingredients.filter((i) => i.id !== ing.id);
    state.purchases = state.purchases.filter((p) => p.ingredientId !== ing.id);
    for (const [k, m] of Object.entries(state.matches)) if (m.ingredientId === ing.id) delete state.matches[k];
    persist();
    closeScreen();
    toast('ลบแล้ว');
  },

  async backup() {
    const now = new Date();
    const file = new File([makeBackup(state, now)], backupFileName(now), { type: 'application/json' });
    if (!(await shareFile(file, 'ไฟล์สำรอง food-cost'))) return;
    state.settings.lastBackupAt = now.getTime();
    persist();
    render();
    toast('สำรองข้อมูลแล้ว');
  },
  restore() {
    const input = document.getElementById('restore-input');
    input.value = '';
    input.click();
  },
  'save-key'() {
    const value = document.getElementById('api-key').value.trim();
    if (!value) return toast('ใส่คีย์ก่อน', true);
    if (!saveApiKey(storage, value)) return toast('บันทึกคีย์ไม่สำเร็จ', true);
    apiKey = value;
    render();
    toast('บันทึกคีย์แล้ว');
  },
  'clear-key'() {
    if (!confirm('ลบคีย์ AI ออกจากเครื่องนี้?')) return;
    saveApiKey(storage, '');
    apiKey = '';
    render();
  },
};

// การพิมพ์: แก้ข้อมูลแล้วอัปเดตเฉพาะตัวเลข
const inputs = {
  'table-query'(el) {
    ui.tableQuery = el.value;
  },
  'menu-name'(el) {
    currentMenu().name = el.value;
  },
  'line-qty'(el) {
    currentMenu().lines[Number(el.dataset.idx)].qty = numberOrNull(el.value) ?? '';
  },
  'line-amount'(el) {
    currentMenu().lines[Number(el.dataset.idx)].amount = numberOrNull(el.value) ?? 0;
  },
  price(el) {
    currentMenu().prices[el.dataset.channel] = numberOrNull(el.value);
  },
  'pf-date'(el) {
    ui.screen.form.date = el.value;
  },
  'pf-newname'(el) {
    ui.screen.form.newName = el.value;
  },
  'pf-qty'(el) {
    ui.screen.form.inputQty = el.value;
  },
  'pf-price'(el) {
    ui.screen.form.price = el.value;
  },
  'rv-store'(el) {
    ui.screen.store = el.value;
  },
  'rv-date'(el) {
    ui.screen.date = el.value;
  },
  'rv-newname'(el) {
    reviewLine(el.dataset.key).newName = el.value;
  },
  'rv-qty'(el) {
    reviewLine(el.dataset.key).inputQty = el.value;
  },
  'rv-price'(el) {
    reviewLine(el.dataset.key).price = el.value;
  },
  'ing-name'(el) {
    const name = el.value.trim();
    if (name) ingredientById(ui.screen.id).name = name;
  },
};

// ข้อมูลที่เก็บถาวร (ไม่ใช่ฟอร์มชั่วคราว) ต้องบันทึกทุกครั้งที่พิมพ์
const persistentInputs = new Set(['menu-name', 'line-qty', 'line-amount', 'price', 'ing-name']);
const settingInputs = { 'set-gpGrab': 'gpGrab', 'set-gpLineman': 'gpLineman', 'set-sundriesDefault': 'sundriesDefault' };

// การเลือกจากรายการ: เปลี่ยนรูปหน้าจอ จึงวาดใหม่ทั้งหน้า
const changes = {
  'table-all'(el) {
    ui.tableAllMonths = el.checked;
  },
  'line-ingredient'(el) {
    currentMenu().lines[Number(el.dataset.idx)].ingredientId = el.value;
    persist();
  },
  'pf-ingredient'(el) {
    const f = ui.screen.form;
    f.ingredientId = el.value;
    const ing = ingredientById(el.value);
    if (ing && INPUT_UNITS[f.inputUnit].base !== ing.unit) f.inputUnit = ing.unit === 'g' ? 'kg' : ing.unit;
  },
  'pf-unit'(el) {
    ui.screen.form.inputUnit = el.value;
  },
  'rv-choice'(el) {
    const l = reviewLine(el.dataset.key);
    if (el.value === '__skip') l.choice = 'skip';
    else if (el.value === '__new') l.choice = 'new';
    else {
      l.choice = 'existing';
      l.ingredientId = el.value;
      const ing = ingredientById(el.value);
      if (INPUT_UNITS[l.inputUnit].base !== ing.unit) l.inputUnit = ing.unit;
    }
    delete ui.problems[l.key];
  },
  'rv-unit'(el) {
    reviewLine(el.dataset.key).inputUnit = el.value;
  },
  'set-vatOnGp'(el) {
    state.settings.vatOnGp = el.checked;
    persist();
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    ui.tab = tab.dataset.tab;
    ui.screen = null;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (e.target.closest('#back')) return closeScreen();
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

// กราฟค่าซื้อรายวัน: แตะหรือชี้ที่แท่ง แสดงยอดของวันนั้น
function showDay(e) {
  const col = e.target.closest?.('.day-col');
  const out = view.querySelector('[data-live="chart-readout"]');
  if (!col || !out) return;
  view.querySelectorAll('.day-col.active').forEach((c) => c.classList.remove('active'));
  col.classList.add('active');
  out.innerHTML = readout({ day: Number(col.dataset.day), total: Number(col.dataset.total) });
}
view.addEventListener('pointerover', showDay);
view.addEventListener('click', showDay);

view.addEventListener('input', (e) => {
  const key = e.target.dataset.input;
  if (!key) return;
  if (settingInputs[key]) {
    state.settings[settingInputs[key]] = numberOrNull(e.target.value) ?? 0;
    persist();
    return;
  }
  if (!inputs[key]) return;
  inputs[key](e.target);
  if (persistentInputs.has(key)) persist();
  refreshLive();
});

view.addEventListener('change', (e) => {
  const key = e.target.dataset.change;
  if (!key || !changes[key]) return;
  changes[key](e.target);
  render();
});

document.getElementById('receipt-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const loading = document.getElementById('loading');
  loading.hidden = false;
  try {
    const imageBase64 = await imageToBase64Jpeg(file);
    const result = await readReceipt({ apiKey, imageBase64, ingredients: state.ingredients });
    ui.tab = 'purchases';
    openScreen({
      type: 'review',
      store: result.store || '',
      date: result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : today(),
      lines: toReviewLines(result, state),
    });
  } catch (err) {
    toast(err instanceof ReceiptError ? err.message : 'อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้ง', true);
  } finally {
    loading.hidden = true;
  }
});

document.getElementById('restore-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const restored = parseBackup(await file.text());
    const summary = `วัตถุดิบ ${restored.ingredients.length} · เมนู ${restored.menus.length} · รายการซื้อ ${restored.purchases.length}`;
    if (!confirm(`กู้คืนข้อมูลจากไฟล์นี้?\n${summary}\n\nข้อมูลที่อยู่ในเครื่องตอนนี้จะถูกแทนที่ทั้งหมด`)) return;
    state = restored;
    persist();
    ui.screen = null;
    render();
    toast('กู้คืนข้อมูลแล้ว');
  } catch (err) {
    toast(err.message, true);
  }
});

// ขอให้เบราว์เซอร์ไม่ลบข้อมูลของแอปนี้ (ได้ผลเมื่อติดตั้งบนหน้าจอโฮม)
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
