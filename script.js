// ==========================================
// 1. НАСТРОЙКИ SUPABASE
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

let state = { 
  y: new Date().getFullYear(), 
  m: new Date().getMonth(), 
  date: null, 
  bookings: [], 
  error: null 
};

function fmt(mins) { return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
function getKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function durationStr(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

// ==========================================
// 3. ЗАПРОСЫ К БАЗЕ
// ==========================================
async function loadData() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?select=*`, { headers: HEADERS });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ошибка сервера ${res.status}. Ответ: ${text}`);
    }
    state.bookings = await res.json();
    state.error = null;
  } catch (e) {
    console.error('ОШИБКА:', e);
    state.error = e.message;
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
// 4. ЭЛЕМЕНТЫ СТРАНИЦЫ
// ==========================================
const el = {
  days: document.getElementById('daysGrid'), title: document.getElementById('calendarTitle'),
  prev: document.getElementById('prevMonth'), next: document.getElementById('nextMonth'),
  dayTitle: document.getElementById('selectedDayTitle'), dayInfoWrap: document.getElementById('dayInfoWrap'),
  busyList: document.getElementById('busyList'), freeList: document.getElementById('freeList'),
  form: document.getElementById('bookingForm'), startSel: document.getElementById('startSelect'),
  durSel: document.getElementById('durationSelect'), name: document.getElementById('nameInput'),
  contact: document.getElementById('contactInput'), msg: document.getElementById('formMsg'),
  btn: document.getElementById('bookBtn'), codeBox: document.getElementById('codeBox'),
  codeVal: document.getElementById('codeValue'),
  modal: document.getElementById('cancelModal'), modalText: document.getElementById('cancelModalText'),
  modalInput: document.getElementById('cancelCodeInput'), modalMsg: document.getElementById('cancelMsg'),
  modalClose: document.getElementById('cancelModalClose'), modalConfirm: document.getElementById('cancelModalConfirm')
};

// ==========================================
// 5. ОТРИСОВКА КАЛЕНДАРЯ
// ==========================================
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
    if (isW && !isPast) div.onclick = () => { state.date = key; el.codeBox.style.display = 'none'; renderCalendar(); renderDay(); };
    el.days.appendChild(div);
  }
}

// ==========================================
// 6. ОТРИСОВКА ДНЯ (СПИСКИ И ФОРМА)
// ==========================================
function renderDay() {
  if (!state.date) return;
  const dObj = new Date(state.date);
  el.dayTitle.textContent = `${dObj.getDay() === 6 ? 'Суббота' : 'Воскресенье'}, ${dObj.getDate()} ${MONTHS[dObj.getMonth()].toLowerCase()} ${dObj.getFullYear()}`;

  if (state.error) {
    el.dayInfoWrap.style.display = 'none';
    document.getElementById('slotsWrap').innerHTML = `<div class="msg error show" style="word-break: break-all; font-family: monospace; font-size: 12px; line-height: 1.4;"><b>Ошибка связи с базой:</b><br>${state.error}</div>`;
    return;
  }

  el.dayInfoWrap.style.display = 'block';
  const dayBookings = state.bookings.filter(b => b.date === state.date).sort((a,b) => a.start - b.start);

  // 1. Заполняем список ЗАНЯТО
  el.busyList.innerHTML = '';
  if (!dayBookings.length) {
    el.busyList.innerHTML = '<div class="empty-state">Нет броней. Весь день свободен.</div>';
  } else {
    dayBookings.forEach(b => {
      const div = document.createElement('div'); div.className = 'list-item busy-item';
      div.innerHTML = `<div><div class="b-name">${fmt(b.start)}–${fmt(b.end)} (${b.name})</div><div class="b-meta">${b.contact}</div></div><button class="btn btn-danger" style="width:auto; padding: 6px 10px; font-size: 12px;" onclick="openModal('${b.id}', '${b.name}')">Отменить</button>`;
      el.busyList.appendChild(div);
    });
  }

  // 2. Заполняем список СВОБОДНО
  el.freeList.innerHTML = '';
  const now = new Date();
  const isToday = state.date === getKey(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let currentStart = DAY_START;
  let hasFree = false;

  dayBookings.forEach(b => {
    if (b.start > currentStart) {
      let end = b.start;
      // Учитываем перерыв (следующая бронь не может начаться за 15 минут до этой)
      let prevEnd = (currentStart > DAY_START) ? currentStart : DAY_START; 
      
      // Если это не первая бронь, вычитаем 15 минут перерыва у предыдущей
      let actualEnd = b.start;
      if (b.start > currentStart) {
         actualEnd = b.start - BREAK; 
      }
      
      if (actualEnd > currentStart) {
         hasFree = true;
         const div = document.createElement('div'); div.className = 'list-item free-item';
         div.innerHTML = `<div><div class="b-name">${fmt(currentStart)}–${fmt(actualEnd)}</div></div>`;
         el.freeList.appendChild(div);
      }
    }
    currentStart = b.end + BREAK; // Следующее окно может начаться только через 15 минут
  });

  // Остаток дня
  if (currentStart < DAY_END) {
    hasFree = true;
    const div = document.createElement('div'); div.className = 'list-item free-item';
    div.innerHTML = `<div><div class="b-name">${fmt(currentStart)}–${fmt(DAY_END)}</div></div>`;
    el.freeList.appendChild(div);
  }

  if (!hasFree) el.freeList.innerHTML = '<div class="empty-state">Свободных окон нет.</div>';

  // 3. Настраиваем форму
  renderForm();
}

// ==========================================
// 7. ФОРМА И ЕЁ ПРОВЕРКА
// ==========================================
function renderForm() {
  el.startSel.innerHTML = '';
  for (let m = DAY_START; m < DAY_END; m += SLOT_STEP) {
    const opt = document.createElement('option'); opt.value = m; opt.textContent = fmt(m); el.startSel.appendChild(opt);
  }
  
  el.durSel.innerHTML = '';
  for (let d = MIN_DUR; d <= MAX_DUR; d += SLOT_STEP) {
    const opt = document.createElement('option'); opt.value = d; opt.textContent = durationStr(d); el.durSel.appendChild(opt);
  }

  el.name.oninput = () => checkForm();
  el.contact.oninput = () => checkForm();
  el.startSel.onchange = () => checkForm();
  el.durSel.onchange = () => checkForm();

  checkForm();
}

function checkForm() {
  el.msg.className = 'msg'; el.msg.textContent = '';
  el.btn.disabled = true;

  const start = Number(el.startSel.value);
  const dur = Number(el.durSel.value);
  const end = start + dur;
  const name = el.name.value.trim();
  const contact = el.contact.value.trim();

  if (!name || !contact) return;
  if (end > DAY_END) { el.msg.textContent = 'Бронь выходит за пределы рабочего дня (до 21:00).'; el.msg.className = 'msg error show'; return; }

  const now = new Date();
  const isToday = state.date === getKey(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (isToday && start < nowMins) { el.msg.textContent = 'Нельзя бронировать время в прошлом.'; el.msg.className = 'msg error show'; return; }

  const dayBookings = state.bookings.filter(b => b.date === state.date);
  
  for (const b of dayBookings) {
    // Пересечение
    if (start < b.end && end > b.start) {
      el.msg.textContent = `Пересечение с бронью ${fmt(b.start)}–${fmt(b.end)} (${b.name}).`;
      el.msg.className = 'msg error show'; return;
    }
    // Тот же человек?
    const same = b.name.trim().toLowerCase() === name.toLowerCase() && b.contact.trim().toLowerCase() === contact.toLowerCase();
    if (same) continue;

    // Перерыв
    if (start >= b.end && start < b.end + BREAK) {
      el.msg.textContent = `Нужен перерыв 15 минут после брони ${fmt(b.start)}–${fmt(b.end)}.`;
      el.msg.className = 'msg error show'; return;
    }
    if (end <= b.start && end + BREAK > b.start) {
      el.msg.textContent = `Нужен перерыв 15 минут до брони ${fmt(b.start)}–${fmt(b.end)}.`;
      el.msg.className = 'msg error show'; return;
    }
  }

  el.btn.disabled = false;
}

el.btn.onclick = async () => {
  const b = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    date: state.date, start: Number(el.startSel.value), end: Number(el.startSel.value) + Number(el.durSel.value),
    name: el.name.value.trim(), contact: el.contact.value.trim(),
    code: Math.random().toString(36).substring(2, 8).toUpperCase()
  };
  el.btn.textContent = 'Отправка...'; el.btn.disabled = true;

  try {
    await createBooking(b);
    await loadData();
    el.codeVal.textContent = b.code; el.codeBox.style.display = 'block';
    el.msg.textContent = 'Бронь создана! Сохраните код.'; el.msg.className = 'msg success show';
    renderCalendar(); renderDay();
  } catch (e) {
    el.msg.textContent = 'Ошибка при сохранении: ' + e.message; el.msg.className = 'msg error show';
  } finally {
    el.btn.textContent = 'Забронировать';
  }
};

// ==========================================
// 8. МОДАЛКА ОТМЕНЫ
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

// ==========================================
// 9. ЗАПУСК
// ==========================================
el.prev.onclick = () => { state.m--; if (state.m < 0) { state.m = 11; state.y--; } renderCalendar(); };
el.next.onclick = () => { state.m++; if (state.m > 11) { state.m = 0; state.y++; } renderCalendar(); };

(async () => {
  renderCalendar();
  await loadData();
  if (!state.date) {
    const now = new Date();
    for(let i=0; i<7; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i); if (isWeekend(d)) { state.date = getKey(d.getFullYear(), d.getMonth(), d.getDate()); break; } }
  }
  renderCalendar(); renderDay();
})();
