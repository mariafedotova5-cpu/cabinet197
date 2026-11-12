/* ============================================================
   ПОДКЛЮЧЕНИЕ К SUPABASE
   Замените значения на свои из Supabase → Settings → API.
   ============================================================ */
const SUPABASE_URL = 'https://ВАШ_ПРОЕКТ.supabase.co';
const SUPABASE_KEY = 'ВАШ_ANON_PUBLIC_KEY';

// Заголовки для всех запросов к Supabase
function supabaseHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/* ============================================================
   КОНСТАНТЫ БИЗНЕС-ЛОГИКИ
   ============================================================ */
const DAY_START_MIN = 9 * 60;
const DAY_END_MIN   = 21 * 60;
const SLOT_MIN      = 15;
const MIN_DURATION  = 60;
const MAX_DURATION  = 8 * 60;
const BREAK_MIN     = 15;

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const state = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDateKey: null,
  selStart: null,
  selEnd: null,
  allBookings: [],
  apiAvailable: true,
};

/* ============================================================
   ВСПОМОГАТЕЛЬНЫЕ
   ============================================================ */
function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function nowMinutesForDate(dateObj) {
  const now = new Date();
  const isToday = now.getFullYear() === dateObj.getFullYear() &&
                  now.getMonth() === dateObj.getMonth() &&
                  now.getDate() === dateObj.getDate();
  if (!isToday) return -1;
  return now.getHours() * 60 + now.getMinutes();
}
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function samePerson(a, b) {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
         a.contact.trim().toLowerCase() === b.contact.trim().toLowerCase();
}
function isWeekend(dateObj) {
  const wd = dateObj.getDay();
  return wd === 0 || wd === 6;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
   СЛОЙ РАБОТЫ С SUPABASE (заменяет Apps Script)
   ============================================================ */

// GET: все брони
async function loadBookingsFromAPI() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?select=*`, {
    method: 'GET',
    headers: supabaseHeaders(),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Неверный формат ответа');
  return data;
}

// POST: создать бронь
async function saveBookingToAPI(booking) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      id: booking.id,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      name: booking.name,
      contact: booking.contact,
      code: booking.code,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Пустой ответ при создании брони');
  }
  return data[0];
}

// DELETE: отменить бронь по id и проверить код.
// Сначала GET по id — проверяем код, затем DELETE.
async function cancelBookingOnAPI(id, code) {
  // 1. Получаем бронь по id
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers: supabaseHeaders() }
  );
  if (!getRes.ok) throw new Error('HTTP ' + getRes.status);
  const rows = await getRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Бронь не найдена');
  }
  const stored = rows[0];
  if (String(stored.code).trim().toUpperCase() !== String(code).trim().toUpperCase()) {
    throw new Error('Неверный код');
  }

  // 2. Удаляем
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: supabaseHeaders() }
  );
  if (!delRes.ok) throw new Error('HTTP ' + delRes.status);
  return { success: true };
}

// Обновление кэша
async function refreshBookings() {
  try {
    const list = await loadBookingsFromAPI();
    state.allBookings = list;
    state.apiAvailable = true;
  } catch (e) {
    console.error('Supabase недоступен:', e);
    state.apiAvailable = false;
    state.allBookings = [];
  }
}

function bookingsForDate(key) {
  return state.allBookings
    .filter(b => b.date === key)
    .sort((a, b) => a.start - b.start);
}

/* ============================================================
   КАЛЕНДАРЬ
   ============================================================ */
const daysGrid = document.getElementById('daysGrid');
const calendarTitle = document.getElementById('calendarTitle');

function renderCalendar() {
  const { viewYear, viewMonth } = state;
  calendarTitle.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  daysGrid.innerHTML = '';

  const firstDay = new Date(viewYear, viewMonth, 1);
  let leading = firstDay.getDay() - 1;
  if (leading < 0) leading = 6;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const datesWithBookings = new Set(state.allBookings.map(b => b.date));
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  for (let i = 0; i < leading; i++) {
    const el = document.createElement('div');
    el.className = 'day empty';
    daysGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(viewYear, viewMonth, d, 12, 0, 0, 0);
    const key = dateKey(viewYear, viewMonth, d);
    const weekend = isWeekend(dateObj);
    const past = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const el = document.createElement('div');
    el.className = 'day';
    el.textContent = d;

    if (weekend && !past) el.classList.add('weekend');
    else el.classList.add('disabled');

    if (key === todayKey) el.classList.add('today');
    if (datesWithBookings.has(key)) el.classList.add('has-bookings');
    if (state.selectedDateKey === key) el.classList.add('selected');

    if (weekend && !past) el.addEventListener('click', () => selectDate(key));
    daysGrid.appendChild(el);
  }
}

document.getElementById('prevMonth').addEventListener('click', () => {
  state.viewMonth--;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  state.viewMonth++;
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
  renderCalendar();
});

function selectDate(key) {
  state.selectedDateKey = key;
  state.selStart = null;
  state.selEnd = null;
  renderCalendar();
  renderDayPanel();
}

/* ============================================================
   ПАНЕЛЬ ДНЯ
   ============================================================ */
const slotsWrap = document.getElementById('slotsWrap');
const selectedDayTitle = document.getElementById('selectedDayTitle');
const dayBadge = document.getElementById('dayBadge');
const bookingForm = document.getElementById('bookingForm');
const startSelect = document.getElementById('startSelect');
const durationSelect = document.getElementById('durationSelect');
const nameInput = document.getElementById('nameInput');
const contactInput = document.getElementById('contactInput');
const intervalHint = document.getElementById('intervalHint');
const formMsg = document.getElementById('formMsg');
const bookBtn = document.getElementById('bookBtn');
const codeBox = document.getElementById('codeBox');
const codeValue = document.getElementById('codeValue');
const bookingList = document.getElementById('bookingList');

function showFormMsg(text, type) {
  formMsg.textContent = text;
  formMsg.className = 'msg show ' + type;
}
function hideFormMsg() {
  formMsg.className = 'msg';
  formMsg.textContent = '';
}

function renderDayPanel() {
  if (!state.selectedDateKey) {
    slotsWrap.innerHTML = '<div class="empty-state">Выберите субботу или воскресенье в календаре.</div>';
    selectedDayTitle.textContent = 'Выберите день';
    dayBadge.textContent = '';
    bookingForm.style.display = 'none';
    renderBookingList();
    return;
  }

  const dateObj = parseDateKey(state.selectedDateKey);
  const wd = dateObj.getDay();
  const wdName = wd === 6 ? 'Суббота' : 'Воскресенье';
  selectedDayTitle.textContent = `${wdName}, ${dateObj.getDate()} ${MONTH_NAMES[dateObj.getMonth()].toLowerCase()} ${dateObj.getFullYear()}`;

  if (!state.apiAvailable) {
    slotsWrap.innerHTML = '<div class="msg error show">Не удалось загрузить брони. Проверьте подключение и обновите страницу.</div>';
    bookingForm.style.display = 'none';
    dayBadge.textContent = 'ошибка';
    renderBookingList();
    return;
  }

  const dayBookings = bookingsForDate(state.selectedDateKey);
  dayBadge.textContent = dayBookings.length ? `${dayBookings.length} бронь(и)` : 'свободно';
  renderSlotsGrid(dayBookings);
  renderBookingForm(dayBookings);
  renderBookingList();
}

/* ============================================================
   СЕТКА СЛОТОВ
   ============================================================ */
let slotMap = {};

function buildSlotMap(dayBookings) {
  const map = {};
  const nowMin = nowMinutesForDate(parseDateKey(state.selectedDateKey));
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
    map[m] = { type: 'free', booking: null };
  }
  for (const b of dayBookings) {
    for (let m = b.start; m < b.end; m += SLOT_MIN) {
      if (map[m]) map[m] = { type: 'busy', booking: b };
    }
  }
  for (const b of dayBookings) {
    for (let m = b.end; m < b.end + BREAK_MIN && m < DAY_END_MIN; m += SLOT_MIN) {
      if (map[m] && map[m].type === 'busy') continue;
      const nextBooking = dayBookings.find(x => x.start === m);
      if (nextBooking && samePerson(b, nextBooking)) continue;
      map[m] = { type: 'break', booking: b };
    }
  }
  if (nowMin >= 0) {
    for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
      if (m + SLOT_MIN <= nowMin) {
        if (map[m].type === 'free' || map[m].type === 'break') {
          map[m] = { type: 'past', booking: null };
        }
      }
    }
  }
  return map;
}

function renderSlotsGrid(dayBookings) {
  slotMap = buildSlotMap(dayBookings);
  slotsWrap.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'slots-grid';
  grid.id = 'slotsGrid';

  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
    const info = slotMap[m];
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.min = m;
    const timeLabel = `${fmtTime(m)}–${fmtTime(m + SLOT_MIN)}`;

    if (info.type === 'busy') {
      const b = info.booking;
      el.classList.add('busy');
      el.innerHTML = `
        <span>${timeLabel}</span>
        <span class="slot-name">${escapeHtml(b.name)}</span>
        <span class="tooltip">
          <strong>${escapeHtml(b.name)}</strong><br>
          ${escapeHtml(b.contact)}<br>
          ${fmtTime(b.start)}–${fmtTime(b.end)}
        </span>`;
      el.addEventListener('click', () => showFormMsg(`Слот ${timeLabel} занят (${b.name}).`, 'info'));
    } else if (info.type === 'break') {
      el.classList.add('break');
      el.textContent = timeLabel;
      el.addEventListener('click', () => showFormMsg('Здесь обязательный перерыв 15 минут.', 'error'));
    } else if (info.type === 'past') {
      el.classList.add('past');
      el.textContent = timeLabel;
      el.addEventListener('click', () => showFormMsg('Нельзя бронировать время в прошлом.', 'error'));
    } else {
      el.textContent = timeLabel;
      el.addEventListener('click', () => onSlotClick(m));
    }

    if (state.selStart != null && state.selEnd != null && m >= state.selStart && m < state.selEnd) {
      el.classList.add('selected');
    }
    grid.appendChild(el);
  }
  slotsWrap.appendChild(grid);
}

function onSlotClick(min) {
  hideFormMsg();
  codeBox.style.display = 'none';

  if (state.selStart == null) {
    state.selStart = min;
    state.selEnd = min + SLOT_MIN;
    updateSelectionUI();
    return;
  }
  if (min === state.selStart && state.selEnd === state.selStart + SLOT_MIN) {
    state.selStart = null;
    state.selEnd = null;
    updateSelectionUI();
    return;
  }
  if (min < state.selStart) {
    state.selStart = min;
    state.selEnd = min + SLOT_MIN;
    updateSelectionUI();
    return;
  }
  const newEnd = min + SLOT_MIN;
  const validation = validateRange(state.selStart, newEnd);
  if (!validation.ok) { showFormMsg(validation.message, 'error'); return; }
  state.selEnd = newEnd;
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('#slotsGrid .slot').forEach(el => {
    const m = Number(el.dataset.min);
    el.classList.remove('selected');
    if (state.selStart != null && state.selEnd != null && m >= state.selStart && m < state.selEnd) {
      el.classList.add('selected');
    }
  });
  if (state.selStart != null && state.selEnd != null) {
    const dur = state.selEnd - state.selStart;
    intervalHint.textContent = `Выбрано: ${fmtTime(state.selStart)}–${fmtTime(state.selEnd)} (${formatDuration(dur)})`;
  } else {
    intervalHint.textContent = 'Кликните по свободному слоту, чтобы начать выбор.';
  }
  syncFormWithSelection();
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

/* ============================================================
   ФОРМА
   ============================================================ */
function renderBookingForm(
