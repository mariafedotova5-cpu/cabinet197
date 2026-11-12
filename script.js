/* ============================================================
   КОНСТАНТЫ
   ============================================================ */
// ВСТАВЬТЕ СЮДА URL ВАШЕГО ВЕБ-ПРИЛОЖЕНИЯ APPS SCRIPT
const API_URL = 'https://script.google.com/macros/s/ВАШ_ID/exec';

const DAY_START_MIN = 9 * 60;   // 09:00
const DAY_END_MIN   = 21 * 60;  // 21:00
const SLOT_MIN      = 15;       // шаг сетки
const MIN_DURATION  = 60;       // минимум 1 час
const MAX_DURATION  = 8 * 60;   // максимум 8 часов
const BREAK_MIN     = 15;       // перерыв между разными людьми

const WEEKDAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
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
  allBookings: [],      // кэш всех броней с сервера
  apiAvailable: true,   // флаг доступности API
  loading: false,
};

/* ============================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
   РАБОТА С API (Google Apps Script)
   ============================================================ */

// Загрузка всех броней с сервера
async function loadBookingsFromAPI() {
  if (!API_URL || API_URL.includes('ВАШ_ID')) {
    throw new Error('API_URL не настроен');
  }
  const res = await fetch(API_URL, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Неверный формат ответа');
  return data;
}

// Сохранение новой брони на сервере
async function saveBookingToAPI(booking) {
  const params = new URLSearchParams();
  params.append('action', 'create');
  params.append('date', booking.date);
  params.append('start', booking.start);
  params.append('end', booking.end);
  params.append('name', booking.name);
  params.append('contact', booking.contact);
  params.append('code', booking.code);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Ошибка сохранения');
  return data;
}

// Отмена брони на сервере (по id и коду)
async function cancelBookingOnAPI(id, code) {
  const params = new URLSearchParams();
  params.append('action', 'cancel');
  params.append('id', id);
  params.append('code', code);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Ошибка отмены');
  return data;
}

// Обновление кэша броней
async function refreshBookings() {
  try {
    const list = await loadBookingsFromAPI();
    state.allBookings = list;
    state.apiAvailable = true;
  } catch (e) {
    console.error('API недоступен:', e);
    state.apiAvailable = false;
    state.allBookings = []; // не показываем старые данные, чтобы не вводить в заблуждение
  }
}

// Получить брони на дату из кэша
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

    if (weekend && !past) {
      el.addEventListener('click', () => selectDate(key));
    }
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

  // Если API недоступен — показываем сообщение, но форму не прячем полностью
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
  if (!validation.ok) {
    showFormMsg(validation.message, 'error');
    return;
  }
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
function renderBookingForm(dayBookings) {
  bookingForm.style.display = 'block';
  startSelect.innerHTML = '';
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MIN) {
    const info = slotMap[m];
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = `${fmtTime(m)}–${fmtTime(m + SLOT_MIN)}`;
    if (info.type !== 'free') {
      opt.textContent += ' — ' + (info.type === 'busy' ? 'занято' : info.type === 'break' ? 'перерыв' : 'прошло');
    }
    startSelect.appendChild(opt);
  }
  durationSelect.innerHTML = '';
  const startVal = state.selStart != null ? state.selStart : DAY_START_MIN;
  const maxPossible = Math.min(MAX_DURATION, DAY_END_MIN - startVal);
  for (let d = MIN_DURATION; d <= maxPossible; d += SLOT_MIN) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = formatDuration(d);
    durationSelect.appendChild(opt);
  }
  syncFormWithSelection();
}

function syncFormWithSelection() {
  if (state.selStart != null) {
    const hasOption = [...startSelect.options].some(o => Number(o.value) === state.selStart);
    if (hasOption) startSelect.value = String(state.selStart);
  }

  const startVal = state.selStart != null ? state.selStart : Number(startSelect.value || DAY_START_MIN);
  const currentDuration = (state.selStart != null && state.selEnd != null) ? state.selEnd - state.selStart : MIN_DURATION;

  durationSelect.innerHTML = '';
  const maxPossible = Math.min(MAX_DURATION, DAY_END_MIN - startVal);
  for (let d = MIN_DURATION; d <= maxPossible; d += SLOT_MIN) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = formatDuration(d);
    durationSelect.appendChild(opt);
  }
  const target = Math.min(currentDuration, maxPossible);
  const rounded = Math.floor(target / SLOT_MIN) * SLOT_MIN;
  if ([...durationSelect.options].some(o => Number(o.value) === rounded)) {
    durationSelect.value = String(rounded);
  }
  updateFormHint();
  validateFormAndUpdateButton();
}

function updateFormHint() {
  const start = Number(startSelect.value);
  const dur = Number(durationSelect.value);
  if (!Number.isFinite(start) || !Number.isFinite(dur)) { intervalHint.textContent = '—'; return; }
  intervalHint.textContent = `Интервал: ${fmtTime(start)}–${fmtTime(start + dur)} (${formatDuration(dur)})`;
}

function validateRange(start, end) {
  if (start == null || end == null) return { ok: false, message: 'Выберите диапазон.' };
  if (start < DAY_START_MIN || end > DAY_END_MIN) return { ok: false, message: 'Время должно быть в интервале 09:00–21:00.' };
  if (start % SLOT_MIN !== 0 || end % SLOT_MIN !== 0) return { ok: false, message: 'Шаг выбора — 15 минут.' };
  const dur = end - start;
  if (dur < MIN_DURATION) return { ok: false, message: 'Минимум 1 час.' };
  if (dur > MAX_DURATION) return { ok: false, message: 'Максимум 8 часов.' };

  const dateObj = parseDateKey(state.selectedDateKey);
  const nowMin = nowMinutesForDate(dateObj);
  if (nowMin >= 0 && start < nowMin) return { ok: false, message: 'Нельзя бронировать время в прошлом.' };

  for (let m = start; m < end; m += SLOT_MIN) {
    const info = slotMap[m];
    if (!info) continue;
    if (info.type === 'busy') return { ok: false, message: `Интервал ${fmtTime(m)}–${fmtTime(m + SLOT_MIN)} уже занят.` };
    if (info.type === 'break') return { ok: false, message: 'Между бронями нужен перерыв 15 минут.' };
    if (info.type === 'past') return { ok: false, message: 'Нельзя бронировать время в прошлом.' };
  }
  return { ok: true, message: '' };
}

function validateFormAndUpdateButton() {
  const start = Number(startSelect.value);
  const dur = Number(durationSelect.value);
  const name = nameInput.value.trim();
  const contact = contactInput.value.trim();
  let ok = true;
  if (!state.selectedDateKey || !state.apiAvailable) ok = false;
  if (!Number.isFinite(start) || !Number.isFinite(dur)) ok = false;
  if (ok) {
    const rangeCheck = validateRange(start, start + dur);
    if (!rangeCheck.ok) ok = false;
  }
  if (name.length < 2 || contact.length < 2) ok = false;
  bookBtn.disabled = !ok;
}

startSelect.addEventListener('change', () => {
  hideFormMsg(); codeBox.style.display = 'none';
  const start = Number(startSelect.value);
  state.selStart = start;
  let dur = Number(durationSelect.value);
  if (!Number.isFinite(dur) || dur < MIN_DURATION) dur = MIN_DURATION;
  dur = Math.min(dur, MAX_DURATION, DAY_END_MIN - start);
  dur = Math.floor(dur / SLOT_MIN) * SLOT_MIN;
  if (dur < MIN_DURATION) dur = MIN_DURATION;
  state.selEnd = start + dur;
  updateSelectionUI();
});

durationSelect.addEventListener('change', () => {
  hideFormMsg(); codeBox.style.display = 'none';
  const start = Number(startSelect.value);
  const dur = Number(durationSelect.value);
  state.selStart = start;
  state.selEnd = start + dur;
  updateSelectionUI();
});

nameInput.addEventListener('input', () => { hideFormMsg(); validateFormAndUpdateButton(); });
contactInput.addEventListener('input', () => { hideFormMsg(); validateFormAndUpdateButton(); });

/* ============================================================
   ОТПРАВКА БРОНИ
   ============================================================ */
bookBtn.addEventListener('click', async () => {
  hideFormMsg();
  codeBox.style.display = 'none';

  const start = Number(startSelect.value);
  const dur = Number(durationSelect.value);
  const end = start + dur;
  const name = nameInput.value.trim();
  const contact = contactInput.value.trim();

  if (name.length < 2) { showFormMsg('Укажите имя (минимум 2 символа).', 'error'); return; }
  if (contact.length < 2) { showFormMsg('Укажите контакт (минимум 2 символа).', 'error'); return; }

  const rangeCheck = validateRange(start, end);
  if (!rangeCheck.ok) { showFormMsg(rangeCheck.message, 'error'); return; }

  // Дополнительная проверка на свежих данных с сервера (на случай гонок)
  await refreshBookings();
  if (!state.apiAvailable) {
    showFormMsg('Не удалось проверить занятость. Попробуйте позже.', 'error');
    return;
  }

  const fresh = bookingsForDate(state.selectedDateKey);
  for (const b of fresh) {
    if (start < b.end && end > b.start) {
      showFormMsg('Диапазон пересекается с существующей бронью.', 'error');
      renderDayPanel();
      return;
    }
  }
  const candidate = { name, contact };
  for (const b of fresh) {
    if (samePerson(b, candidate)) continue;
    if (start >= b.end && start < b.end + BREAK_MIN) { showFormMsg('Между бронями нужен перерыв 15 минут.', 'error'); return; }
    if (end <= b.start && end + BREAK_MIN > b.start) { showFormMsg('Между бронями нужен перерыв 15 минут.', 'error'); return; }
  }

  const code = generateCode();
  const newBooking = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    date: state.selectedDateKey,
    start, end, name, contact, code,
  };

  bookBtn.disabled = true;
  bookBtn.textContent = 'Отправка...';

  try {
    await saveBookingToAPI(newBooking);
    await refreshBookings();

    codeValue.textContent = code;
    codeBox.style.display = 'block';
    showFormMsg('Бронь создана! Сохраните код для отмены.', 'success');

    state.selStart = null;
    state.selEnd = null;
    renderCalendar();
    renderDayPanel();
  } catch (e) {
    console.error(e);
    showFormMsg('Не удалось сохранить бронь. Проверьте подключение и попробуйте ещё раз.', 'error');
  } finally {
    bookBtn.disabled = false;
    bookBtn.textContent = 'Забронировать';
  }
});

/* ============================================================
   СПИСОК БРОНЕЙ
   ============================================================ */
function renderBookingList() {
  bookingList.innerHTML = '';
  if (!state.selectedDateKey) {
    bookingList.innerHTML = '<div class="empty-state">—</div>';
    return;
  }
  if (!state.apiAvailable) {
    bookingList.innerHTML = '<div class="empty-state">Нет данных (API недоступен).</div>';
    return;
  }
  const list = bookingsForDate(state.selectedDateKey);
  if (list.length === 0) {
    bookingList.innerHTML = '<div class="empty-state">На этот день броней пока нет.</div>';
    return;
  }
  for (const b of list) {
    const item = document.createElement('div');
    item.className = 'booking-item';
    item.innerHTML = `
      <div class="b-time">${fmtTime(b.start)}–${fmtTime(b.end)} <span style="font-weight:400;color:var(--muted);">(${formatDuration(b.end - b.start)})</span></div>
      <div><strong>${escapeHtml(b.name)}</strong></div>
      <div class="b-meta">${escapeHtml(b.contact)}</div>
      <div class="b-actions"><button class="btn btn-danger" data-cancel-id="${b.id}">Отменить</button></div>`;
    bookingList.appendChild(item);
  }
  bookingList.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', () => openCancelModal(btn.dataset.cancelId));
  });
}

/* ============================================================
   ОТМЕНА
   ============================================================ */
const cancelModal = document.getElementById('cancelModal');
const cancelModalText = document.getElementById('cancelModalText');
const cancelCodeInput = document.getElementById('cancelCodeInput');
const cancelMsg = document.getElementById('cancelMsg');
const cancelModalClose = document.getElementById('cancelModalClose');
const cancelModalConfirm = document.getElementById('cancelModalConfirm');
let cancelTargetId = null;

function openCancelModal(bookingId) {
  const b = state.allBookings.find(x => x.id === bookingId);
  if (!b) return;
  cancelTargetId = bookingId;
  cancelModalText.textContent = `Отмена брони ${fmtTime(b.start)}–${fmtTime(b.end)} (${b.name}). Введите код брони.`;
  cancelCodeInput.value = '';
  cancelMsg.className = 'msg error';
  cancelMsg.textContent = '';
  cancelModal.classList.add('show');
  setTimeout(() => cancelCodeInput.focus(), 50);
}

function closeCancelModal() {
  cancelModal.classList.remove('show');
  cancelTargetId = null;
}

cancelModalClose.addEventListener('click', closeCancelModal);
cancelModal.addEventListener('click', (e) => { if (e.target === cancelModal) closeCancelModal(); });

cancelModalConfirm.addEventListener('click', async () => {
  const entered = cancelCodeInput.value.trim().toUpperCase();
  if (!entered) {
    cancelMsg.textContent = 'Введите код брони.';
    cancelMsg.className = 'msg error show';
    return;
  }

  cancelModalConfirm.disabled = true;
  cancelModalConfirm.textContent = 'Отмена...';

  try {
    await cancelBookingOnAPI(cancelTargetId, entered);
    await refreshBookings();
    closeCancelModal();
    renderCalendar();
    renderDayPanel();
    showFormMsg('Бронь отменена.', 'info');
  } catch (e) {
    console.error(e);
    cancelMsg.textContent = e.message.includes('Неверный код') ? 'Неверный код брони.' : 'Не удалось отменить бронь. Попробуйте позже.';
    cancelMsg.className = 'msg error show';
  } finally {
    cancelModalConfirm.disabled = false;
    cancelModalConfirm.textContent = 'Отменить бронь';
  }
});

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
(async function init() {
  const now = new Date();
  state.viewYear = now.getFullYear();
  state.viewMonth = now.getMonth();

  // Автовыбор ближайшего выходного
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 60; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12, 0, 0, 0);
    if (isWeekend(d)) {
      state.selectedDateKey = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
      break;
    }
  }

  renderCalendar();
  slotsWrap.innerHTML = '<div class="empty-state">Загрузка броней...</div>';

  await refreshBookings();
  renderCalendar();
  renderDayPanel();

  if (!state.apiAvailable) {
    showFormMsg('Не удалось подключиться к серверу. Проверьте API_URL и доступ к веб-приложению Apps Script.', 'error');
  }
})();
