// ==========================================
// 1. НАСТРОЙКИ
// ==========================================
const SUPABASE_URL = 'https://wzsiyaiglwlmrjawzlfx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VG-dBW79sG160FL1BGtbzQ_7pnoZ7uV';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Content-Type': 'application/json'
};

// ==========================================
// 2. БАЗОВЫЕ ПЕРЕМЕННЫЕ
// ==========================================
const DAY_START = 9 * 60;
const DAY_END = 21 * 60;
const SLOT_STEP = 15;
const BREAK = 15;
const MIN_DUR = 60;
const MAX_DUR = 8 * 60;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

let state = { y: new Date().getFullYear(), m: new Date().getMonth(), date: null, start: null, end: null, bookings: [], error: null };

function fmt(mins) { return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
function getKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }

// ==========================================
// 3. ЗАПРОСЫ К БАЗЕ (С ОТЛАДКОЙ)
// ==========================================
async function loadData() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?select=*`, {
      headers: HEADERS
    });
    
    if (!res.ok) {
      // Если сервер вернул ошибку (401, 403, 404 и т.д.)
      const text = await res.text();
      throw new Error(`Ошибка сервера ${res.status}. Ответ: ${text}`);
    }
    
    state.bookings = await res.json();
    state.error = null; // Ошибок нет
  } catch (e) {
    console.error('ОШИБКА:', e);
    state.error = e.message; // Сохраняем текст ошибки для показа
    state.bookings = [];
  }
}

async function createBooking(b) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(b)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка ${res.status}: ${text}`);
  }
}

async function deleteBooking(id, code) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}&select=*`, { headers: HEADERS });
  if (!res.ok) throw new Error('Ошибка проверки кода');
  const data = await res.json();
  if (!data.length || data[0].code !== code) throw new Error('Неверный код брони');
  
  const delRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  if (!delRes.ok) throw new Error('Ошибка удаления');
}

// ==========================================
// 4. ОТРИСОВКА
// ==========================================
const el = {
  days: document.getElementById('daysGrid'), title: document.getElementById('calendarTitle'),
  prev: document.getElementById('prevMonth'), next: document.getElementById('nextMonth'),
  slotsWrap: document.getElementById('slotsWrap'), dayTitle: document.getElementById('selectedDayTitle'),
  badge: document.getElementById('dayBadge'), form: document.getElementById('bookingForm'),
  startSel: document.getElementById('startSelect'), durSel: document.getElementById('durationSelect'),
  name: document.getElementById('nameInput'), contact: document.getElementById('contactInput'),
  hint: document.getElementById('intervalHint'), msg: document.getElementById('formMsg'),
  btn: document.getElementById('bookBtn'), codeBox: document.getElementById('codeBox'),
  codeVal: document.getElementById('codeValue'), list: document.getElementById('bookingList'),
  modal: document.getElementById('cancelModal'), modalText: document.getElementById('cancelModalText'),
  modalInput: document.getElementById('cancelCodeInput'), modalMsg: document.getElementById('cancelMsg'),
  modalClose: document.getElementById('cancelModalClose'), modalConfirm: document.getElementById('cancelModalConfirm')
};

function renderCalendar() {
  el.title.textContent = `${MONTHS[state.m]} ${state.y}`;
  el.days.innerHTML = '';
  const first = new Date(state.y, state.m, 1);
  let lead = first.getDay() - 1; if (lead < 0) lead = 6;
  const total = new Date(state.y, state.m + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  for (let i = 0; i < lead; i++) el.days.innerHTML += `<div class="day empty"></div>`;
  const bookedDates = new Set(state.bookings.map(b => b.date));

  for (let d = 1; d <= total; d++) {
    const dateObj = new Date(state.y, state.m, d);
    const key = getKey(state.y, state.m, d);
    const isW = isWeekend(dateObj), isPast = dateObj < today;
    let cls = 'day';
    if (!isW || isPast) cls += ' disabled'; else cls += ' weekend';
    if (key === getKey(today.getFullYear(), today.getMonth(), today.getDate())) cls += ' today';
    if (bookedDates.has(key)) cls += ' has-bookings';
    if (state.date === key) cls += ' selected';

    const div = document.createElement('div');
    div.className = cls; div.textContent = d;
    if (isW && !isPast) div.onclick = () => { state.date = key; state.start = null; state.end = null; el.codeBox.style.display = 'none'; renderCalendar(); renderDay(); };
    el.days.appendChild(div);
  }
}

function renderDay() {
  if (!state.date) return;
  const dObj = new Date(state.date);
  el.dayTitle.textContent = `${dObj.getDay() === 6 ? 'Суббота' : 'Воскресенье'}, ${dObj.getDate()} ${MONTHS[dObj.getMonth()].toLowerCase()} ${dObj.getFullYear()}`;

  // ВЫВОДИМ ОШИБКУ НА ЭКРАН, ЕСЛИ ОНА ЕСТЬ
  if (state.error) {
    el.slotsWrap.innerHTML = `<div class="msg error show" style="word-break: break-all; font-family: monospace; font-size: 12px; line-height: 1.4;">
      <b>Ошибка связи с базой:</b><br>${state.error}<br><br>
      <i>Проверьте вкладку Network (Сеть) в консоли (F12).</i>
    </div>`;
    el.form.style.display = 'none';
    return;
  }

  const dayBookings = state.bookings.filter(b => b.date === state.date).sort((a,b) => a.start - b.start);
  el.badge.textContent = dayBookings.length ? `${dayBookings.length} бронь(и)` : 'свободно';
  renderSlots(dayBookings); renderForm(dayBookings); renderList(dayBookings);
}

function renderSlots(dayBookings) {
  el.slotsWrap.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'slots-grid'; grid.id = 'slotsGrid';
  const now = new Date();
  const nowMins = (now.getHours() * 60 + now.getMinutes());
  const isToday = state.date === getKey(now.getFullYear(), now.getMonth(), now.getDate());

  for (let m = DAY_START; m < DAY_END; m += SLOT_STEP) {
    const div = document.createElement('div'); div.className = 'slot'; div.dataset.min = m;
    div.textContent = `${fmt(m)}–${fmt(m+15)}`;
    let type = 'free', booking = null;

    for (const b of dayBookings) { if (m >= b.start && m < b.end) { type = 'busy'; booking = b; break; } }
    if (type === 'free') {
      for (const b of dayBookings) {
        if (m >= b.end && m < b.end + BREAK) {
          const nextB = dayBookings.find(x => x.start === m);
          if (nextB && nextB.name === b.name && nextB.contact === b.contact) continue;
          type = 'break'; break;
        }
      }
    }
    if (isToday && m + SLOT_STEP <= nowMins) type = 'past';

    if (type === 'busy') {
      div.classList.add('busy');
      div.innerHTML = `<span>${fmt(m)}–${fmt(m+15)}</span><span class="slot-name">${booking.name}</span><div class="tooltip"><b>${booking.name}</b><br>${booking.contact}</div>`;
    } else if (type === 'break') {
      div.classList.add('break'); div.onclick = () => showMsg('Между бронями нужен перерыв 15 минут.', 'error');
    } else if (type === 'past') {
      div.classList.add('past'); div.onclick = () => showMsg('Это время уже прошло.', 'error');
    } else {
      div.onclick = () => clickSlot(m);
    }

    if (state.start !== null && state.end !== null && m >= state.start && m < state.end) div.classList.add('selected');
    grid.appendChild(div);
  }
  el.slotsWrap.appendChild(grid);
}

function clickSlot(m) {
  hideMsg(); el.codeBox.style.display = 'none';
  if (state.start === null) { state.start = m; state.end = m + SLOT_STEP; }
  else if (m === state.start && state.end === state.start + SLOT_STEP) { state.start = null; state.end = null; }
  else if (m < state.start) { state.start = m; state.end = m + SLOT_STEP; }
  else {
    if (m + SLOT_STEP - state.start > MAX_DUR) { showMsg('Максимум 8 часов.', 'error'); return; }
    state.end = m + SLOT_STEP;
  }
  updateUI();
}

function updateUI() {
  document.querySelectorAll('.slot').forEach(el => {
    const m = Number(el.dataset.min);
    el.classList.toggle('selected', state.start !== null && state.end !== null && m >= state.start && m < state.end);
  });
  if (state.start !== null && state.end !== null) el.hint.textContent = `Выбрано: ${fmt(state.start)}–${fmt(state.end)} (${(state.end - state.start) / 60} ч)`;
  else el.hint.textContent = 'Кликните по свободному слоту.';
  syncForm();
}

function renderForm(dayBookings) {
  el.form.style.display = 'block';
  el.startSel.innerHTML = '';
  for (let m = DAY_START; m < DAY_END; m += SLOT_STEP) {
    const opt = document.createElement('option'); opt.value = m; opt.textContent = `${fmt(m)}–${fmt(m+15)}`; el.startSel.appendChild(opt);
  }
  el.startSel.onchange = () => { state.start = Number(el.startSel.value); state.end = state.start + Number(el.durSel.value || MIN_DUR); updateUI(); };
  el.durSel.onchange = () => { if (state.start !== null) { state.end = state.start + Number(el.durSel.value); updateUI(); } };
  [el.name, el.contact].forEach(input => {
    input.oninput = () => { hideMsg(); el.btn.disabled = !(state.start !== null && state.end !== null && el.name.value.length > 1 && el.contact.value.length > 1); };
  });
  syncForm();
}

function syncForm() {
  if (state.start !== null) {
    el.startSel.value = state.start;
    const maxDur = Math.min(MAX_DUR, DAY_END - state.start);
    el.durSel.innerHTML = '';
    for (let d = MIN_DUR; d <= maxDur; d += SLOT_STEP) {
      const opt = document.createElement('option'); opt.value = d; opt.textContent = `${d / 60} ч`; el.durSel.appendChild(opt);
    }
    if (state.end !== null) el.durSel.value = Math.min(state.end - state.start, maxDur);
  }
  el.btn.disabled = !(state.start !== null && state.end !== null && el.name.value.length > 1 && el.contact.value.length > 1);
}

el.btn.onclick = async () => {
  hideMsg();
  const b = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    date: state.date, start: state.start, end: state.end,
    name: el.name.value.trim(), contact: el.contact.value.trim(),
    code: Math.random().toString(36).substring(2, 8).toUpperCase()
  };
  el.btn.textContent = 'Отправка...'; el.btn.disabled = true;

  try {
    await createBooking(b);
    await loadData();
    el.codeVal.textContent = b.code; el.codeBox.style.display = 'block';
    showMsg('Бронь создана! Сохраните код.', 'success');
    state.start = null; state.end = null;
    renderCalendar(); renderDay();
  } catch (e) {
    showMsg('Ошибка при сохранении: ' + e.message, 'error');
  } finally {
    el.btn.textContent = 'Забронировать';
  }
};

function renderList(dayBookings) {
  el.list.innerHTML = '';
  if (!dayBookings.length) { el.list.innerHTML = '<div class="empty-state">Броней нет.</div>'; return; }
  dayBookings.forEach(b => {
    const div = document.createElement('div'); div.className = 'booking-item';
    div.innerHTML = `<div class="b-time">${fmt(b.start)}–${fmt(b.end)}</div><div><b>${b.name}</b></div><div class="b-meta">${b.contact}</div><div class="b-actions"><button class="btn btn-danger" onclick="openModal('${b.id}', '${b.name}')">Отменить</button></div>`;
    el.list.appendChild(div);
  });
}

// ==========================================
// 5. МОДАЛКА
// ==========================================
let cancelId = null;
window.openModal = (id, name) => { cancelId = id; el.modalText.textContent = `Отмена брони (${name}). Введите код:`; el.modalInput.value = ''; el.modalMsg.className = 'msg error'; el.modal.classList.add('show'); };
el.modalClose.onclick = () => el.modal.classList.remove('show');
el.modal.onclick = (e) => { if (e.target === el.modal) el.modal.classList.remove('show'); };
el.modalConfirm.onclick = async () => {
  const code = el.modalInput.value.trim().toUpperCase();
  if (!code) { el.modalMsg.textContent = 'Введите код.'; el.modalMsg.className = 'msg error show'; return; }
  el.modalConfirm.textContent = '...'; el.modalConfirm.disabled = true;
  try {
    await deleteBooking(cancelId, code); await loadData();
    el.modal.classList.remove('show'); renderCalendar(); renderDay();
  } catch (e) {
    el.modalMsg.textContent = e.message; el.modalMsg.className = 'msg error show';
  } finally {
    el.modalConfirm.textContent = 'Отменить бронь'; el.modalConfirm.disabled = false;
  }
};

function showMsg(text, type) { el.msg.textContent = text; el.msg.className = 'msg show ' + type; }
function hideMsg() { el.msg.className = 'msg'; }

// ==========================================
// 6. ЗАПУСК
// ==========================================
el.prev.onclick = () => { state.m--; if (state.m < 0) { state.m = 11; state.y--; } renderCalendar(); };
el.next.onclick = () => { state.m++; if (state.m > 11) { state.m = 0; state.y++; } renderCalendar(); };

(async () => {
  renderCalendar();
  el.slotsWrap.innerHTML = '<div class="empty-state">Загрузка...</div>';
  await loadData();
  if (!state.date) {
    const now = new Date();
    for(let i=0; i<7; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i); if (isWeekend(d)) { state.date = getKey(d.getFullYear(), d.getMonth(), d.getDate()); break; } }
  }
  renderCalendar(); renderDay();
})();
