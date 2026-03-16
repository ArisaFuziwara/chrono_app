// === CHRONO — APP LOGIC ===

// ─── STATE ────────────────────────────────────────────────────
let state = loadState();
let timerInterval = null;
let alarmCheckInterval = null;
let currentHistoryMonth = null;

function defaultState() {
  return {
    user: { name: 'Admin', password: '1234', avatar: null },
    settings: {
      goalHours: 171,
      hoursPerDay: 8,
      resetOnNewYear: true,
    },
    alarms: [
      { id: 1, time: '12:00', message: 'Agora é o horário do seu almoço! Gostaria de dar um pause? 🍽️', type: 'pause' },
      { id: 2, time: '13:00', message: 'Tá na hora de voltar! Gostaria de dar um start? 💪', type: 'resume' },
    ],
    entries: [],      // { id, date, minutes, notes, source }
    credits: [],      // { year, month, extraMinutes }
    timer: { running: false, paused: false, startedAt: null, accumulated: 0 },
    lastNotifiedAlarm: null,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem('chrono_state');
    if (raw) {
      const s = JSON.parse(raw);
      // Merge with defaults for missing keys
      const def = defaultState();
      return {
        user: { ...def.user, ...s.user },
        settings: { ...def.settings, ...s.settings },
        alarms: s.alarms || def.alarms,
        entries: s.entries || [],
        credits: s.credits || [],
        timer: s.timer || def.timer,
        lastNotifiedAlarm: s.lastNotifiedAlarm || null,
      };
    }
  } catch (e) {}
  return defaultState();
}

function saveState() {
  localStorage.setItem('chrono_state', JSON.stringify(state));
}

// ─── AUTH ─────────────────────────────────────────────────────
function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  if (u === 'admin' && p === state.user.password) {
    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');
    initApp();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const login = document.getElementById('screen-login');
    if (!login.classList.contains('hidden')) doLogin();
  }
});

function doLogout() {
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
  if (timerInterval) clearInterval(timerInterval);
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);
}

// ─── NAVIGATION ───────────────────────────────────────────────
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const el = document.getElementById(`page-${page}`);
  el.classList.remove('hidden');
  el.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  if (page === 'home') renderHome();
  if (page === 'history') renderHistory();
  if (page === 'settings') renderSettings();
  if (page === 'timer') renderTimerPage();
}

// ─── INIT ─────────────────────────────────────────────────────
function initApp() {
  // Set today's date in log form
  document.getElementById('log-date').value = todayISO();
  renderHome();
  startAlarmChecker();
  if (state.timer.running && !state.timer.paused) resumeTimerInterval();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(y, m) {
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${months[m - 1]} ${y}`;
}

// ─── HOME ─────────────────────────────────────────────────────
function renderHome() {
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  document.getElementById('home-greeting').textContent = `${greet}, ${state.user.name.split(' ')[0]}! 👋`;
  document.getElementById('home-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Avatar
  renderAvatarElements();

  const { totalMin, weekMin } = getMonthAndWeekMinutes();
  const goalMin = state.settings.goalHours * 60;

  document.getElementById('home-total-h').textContent = fmtHM(totalMin);
  const sign = weekMin >= 0 ? '+' : '-';
  document.getElementById('home-week-h').textContent = `↑ ${sign}${fmtHM(Math.abs(weekMin))} esta semana`;

  drawDonut(totalMin, goalMin);

  const creditMin = getTotalCreditMinutes();
  document.getElementById('legend-done').textContent = `${fmtHM(totalMin)} feitas`;
  document.getElementById('legend-left').textContent = `${fmtHH(state.settings.goalHours)} de meta`;
  document.getElementById('legend-credit').textContent = `+${fmtHM(creditMin)} crédito`;

  // Recent entries (last 5)
  const recent = [...state.entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  renderEntryList('recent-list', recent, false);
}

function renderAvatarElements() {
  ['home', 'settings'].forEach(prefix => {
    const img = document.getElementById(`${prefix}-avatar`);
    const fallback = document.getElementById(`${prefix}-avatar-fallback`);
    if (!img || !fallback) return;
    if (state.user.avatar) {
      img.src = state.user.avatar;
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      fallback.classList.remove('hidden');
    }
  });
}

function getMonthAndWeekMinutes() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  let totalMin = 0;
  let weekMin = 0;

  state.entries.forEach(e => {
    const [ey, em] = e.date.split('-').map(Number);
    if (ey === y && em === m) {
      totalMin += e.minutes;
      const d = new Date(e.date);
      if (d >= weekStart) weekMin += e.minutes;
    }
  });

  return { totalMin, weekMin };
}

function getTotalCreditMinutes() {
  return state.credits.reduce((acc, c) => acc + c.extraMinutes, 0);
}

function fmtHM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtHH(hours) {
  return `${hours}h`;
}

// ─── DONUT CHART ──────────────────────────────────────────────
function drawDonut(doneMin, goalMin) {
  const canvas = document.getElementById('donut-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 160, H = 160;
  const cx = W / 2, cy = H / 2, r = 62, lw = 22;

  ctx.clearRect(0, 0, W, H);

  const pct = Math.min(doneMin / goalMin, 1);
  const extraPct = Math.max((doneMin - goalMin) / goalMin, 0);

  // Background ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = lw;
  ctx.stroke();

  // Done arc
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = '#6dbf67';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Extra (credit) arc
  if (extraPct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - lw / 2 - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(extraPct, 0.5));
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const pctLabel = Math.round(pct * 100);
  document.getElementById('donut-pct').textContent = `${pctLabel}%`;
}

// ─── TIMER ────────────────────────────────────────────────────
function renderTimerPage() {
  updateTimerDisplay();
  updateTimerButtons();
  renderAlarmList();
}

function startTimer() {
  state.timer = { running: true, paused: false, startedAt: Date.now(), accumulated: 0 };
  saveState();
  resumeTimerInterval();
  updateTimerButtons();
  document.getElementById('timer-started-at').textContent = `Iniciado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function pauseTimer() {
  if (!state.timer.running) return;
  const elapsed = Date.now() - state.timer.startedAt;
  state.timer.accumulated += elapsed;
  state.timer.paused = true;
  state.timer.running = false;
  saveState();
  clearInterval(timerInterval);
  timerInterval = null;
  updateTimerButtons();
}

function resumeTimer() {
  state.timer.startedAt = Date.now();
  state.timer.running = true;
  state.timer.paused = false;
  saveState();
  resumeTimerInterval();
  updateTimerButtons();
}

function stopTimer() {
  const total = getCurrentTimerMs();
  clearInterval(timerInterval);
  timerInterval = null;

  const minutes = Math.round(total / 60000);
  if (minutes < 1) {
    showAlert('Tempo muito curto', 'O cronômetro registrou menos de 1 minuto. Nenhum lançamento será salvo.', null);
    state.timer = { running: false, paused: false, startedAt: null, accumulated: 0 };
    saveState();
    updateTimerButtons();
    return;
  }

  const today = todayISO();
  saveEntry({ date: today, minutes, notes: 'Via cronômetro', source: 'timer' });

  state.timer = { running: false, paused: false, startedAt: null, accumulated: 0 };
  saveState();
  updateTimerButtons();
  updateTimerDisplay();

  document.getElementById('timer-started-at').textContent = `Encerrado — ${fmtHM(minutes)} registrados ✅`;
}

function resumeTimerInterval() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    updateTimerDisplay();
  }, 1000);
}

function getCurrentTimerMs() {
  let ms = state.timer.accumulated || 0;
  if (state.timer.running && state.timer.startedAt) {
    ms += Date.now() - state.timer.startedAt;
  }
  return ms;
}

function updateTimerDisplay() {
  const ms = getCurrentTimerMs();
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  document.getElementById('timer-display').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerButtons() {
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  const btnStop = document.getElementById('btn-stop');

  const { running, paused } = state.timer;

  btnStart.classList.toggle('hidden', running || paused);
  btnPause.classList.toggle('hidden', !running || paused);
  btnResume.classList.toggle('hidden', !paused);
  btnStop.classList.toggle('hidden', !running && !paused);
}

function renderAlarmList() {
  const el = document.getElementById('alarm-list');
  if (!state.alarms.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Nenhum alarme configurado.</p>';
    return;
  }
  el.innerHTML = state.alarms.map(a => `
    <div class="alarm-item">
      <span class="alarm-icon">${a.type === 'pause' ? '🍽️' : '⚡'}</span>
      <div class="alarm-info">
        <div class="alarm-time">${a.time}</div>
        <div class="alarm-msg">${a.message}</div>
      </div>
    </div>
  `).join('');
}

// ─── ALARM CHECKER ────────────────────────────────────────────
function startAlarmChecker() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);
  alarmCheckInterval = setInterval(checkAlarms, 30000);
  checkAlarms();
}

function checkAlarms() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const timeNow = `${hh}:${mm}`;

  state.alarms.forEach(alarm => {
    if (alarm.time === timeNow && state.lastNotifiedAlarm !== `${alarm.id}-${timeNow}`) {
      state.lastNotifiedAlarm = `${alarm.id}-${timeNow}`;
      saveState();
      showAlarmNotif(alarm);
    }
  });
}

function showAlarmNotif(alarm) {
  const banner = document.getElementById('notif-banner');
  document.getElementById('notif-text').textContent = alarm.message;

  const yesBtn = document.getElementById('notif-yes');
  yesBtn.onclick = () => {
    if (alarm.type === 'pause' && state.timer.running) pauseTimer();
    if (alarm.type === 'resume' && state.timer.paused) resumeTimer();
    dismissNotif();
    goTo('timer');
  };

  banner.classList.remove('hidden');

  // Auto dismiss after 30s
  setTimeout(dismissNotif, 30000);

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Chrono ⏱', { body: alarm.message, icon: '' });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

function dismissNotif() {
  document.getElementById('notif-banner').classList.add('hidden');
}

// ─── LOG ENTRY ────────────────────────────────────────────────
function saveLogEntry() {
  const date = document.getElementById('log-date').value;
  const h = parseInt(document.getElementById('log-hours').value) || 0;
  const m = parseInt(document.getElementById('log-minutes').value) || 0;
  const notes = document.getElementById('log-notes').value.trim();
  const minutes = h * 60 + m;

  if (!date) { alert('Selecione uma data.'); return; }
  if (minutes <= 0) { alert('Insira um tempo válido.'); return; }

  // Check if date is from previous year
  const entryYear = parseInt(date.split('-')[0]);
  const thisYear = new Date().getFullYear();

  if (state.settings.resetOnNewYear && entryYear < thisYear) {
    showAlert(
      'Horas do ano anterior',
      `Deseja inserir horas do ano anterior? Elas não gerarão crédito.\n\nCaso deseje contabilizar horas do ano anterior como crédito, vá em Configurações > Resetar crédito ao virar o ano e desmarque a opção.`,
      () => {
        saveEntry({ date, minutes, notes: notes || 'Lançamento manual', source: 'manual' });
        clearLogForm();
        goTo('home');
      }
    );
    return;
  }

  saveEntry({ date, minutes, notes: notes || 'Lançamento manual', source: 'manual' });
  clearLogForm();
  goTo('home');
}

function saveEntry(entry) {
  const id = Date.now();
  state.entries.push({ id, ...entry });
  saveState();
  checkEndOfMonthCelebration(entry.date);
}

function deleteEntry(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  saveState();
  renderHome();
  renderHistory();
}

function clearLogForm() {
  document.getElementById('log-date').value = todayISO();
  document.getElementById('log-hours').value = '';
  document.getElementById('log-minutes').value = '';
  document.getElementById('log-notes').value = '';
}

// ─── END OF MONTH CELEBRATION ─────────────────────────────────
function checkEndOfMonthCelebration(dateISO) {
  const d = new Date(dateISO);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (d.getDate() !== lastDay) return;

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const goalMin = state.settings.goalHours * 60;

  const monthMin = state.entries
    .filter(e => {
      const [ey, em] = e.date.split('-').map(Number);
      return ey === y && em === m;
    })
    .reduce((acc, e) => acc + e.minutes, 0);

  if (monthMin >= goalMin) {
    const extra = monthMin - goalMin;
    // Save credit
    const existingIdx = state.credits.findIndex(c => c.year === y && c.month === m);
    if (existingIdx >= 0) {
      state.credits[existingIdx].extraMinutes = extra;
    } else {
      state.credits.push({ year: y, month: m, extraMinutes: extra });
    }
    saveState();
    showCelebration(y, m, monthMin, goalMin, extra);
  }
}

function showCelebration(y, m, doneMin, goalMin, extraMin) {
  document.getElementById('cel-month').textContent = `${monthLabel(y, m)} — Missão cumprida! 🎊`;
  const hpd = state.settings.hoursPerDay || 8;
  const creditDays = (extraMin / 60 / hpd).toFixed(1);

  document.getElementById('cel-stats').innerHTML = `
    <div class="cel-stat"><span>Meta do mês</span><span>${fmtHH(state.settings.goalHours)}</span></div>
    <div class="cel-stat"><span>Total trabalhado</span><span>${fmtHM(doneMin)}</span></div>
    <div class="cel-stat"><span>Crédito gerado</span><span>+${fmtHM(extraMin)}</span></div>
    <div class="cel-stat"><span>Em dias de trabalho</span><span>~${creditDays} dias</span></div>
  `;

  document.getElementById('modal-celebration').classList.remove('hidden');
  launchConfetti();
}

function closeCelebration() {
  document.getElementById('modal-celebration').classList.add('hidden');
  document.getElementById('confetti-layer').classList.add('hidden');
  document.getElementById('confetti-layer').innerHTML = '';
}

function launchConfetti() {
  const layer = document.getElementById('confetti-layer');
  layer.classList.remove('hidden');
  layer.innerHTML = '';
  const colors = ['#a8e6a3','#b3d4f5','#fde68a','#ddd6fe','#fb923c','#fca5a5'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left = Math.random() * 100 + '%';
    el.style.top = '-10px';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.width = (Math.random() * 10 + 6) + 'px';
    el.style.height = (Math.random() * 10 + 6) + 'px';
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.animationDuration = (Math.random() * 2 + 2) + 's';
    el.style.animationDelay = Math.random() * 1.5 + 's';
    layer.appendChild(el);
  }
  setTimeout(() => {
    layer.classList.add('hidden');
    layer.innerHTML = '';
  }, 5000);
}

// ─── HISTORY ──────────────────────────────────────────────────
function renderHistory() {
  const months = getAvailableMonths();
  if (!currentHistoryMonth || !months.find(m => m.key === currentHistoryMonth)) {
    const now = new Date();
    currentHistoryMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }

  const tabs = document.getElementById('month-tabs');
  tabs.innerHTML = months.map(m => `
    <button class="month-tab ${m.key === currentHistoryMonth ? 'active' : ''}" onclick="selectHistoryMonth('${m.key}')">
      ${m.label}
    </button>
  `).join('');

  const [y, mo] = currentHistoryMonth.split('-').map(Number);
  const entries = state.entries
    .filter(e => {
      const [ey, em] = e.date.split('-').map(Number);
      return ey === y && em === mo;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  renderEntryList('history-list', entries, true);

  // Credits list
  const creditsList = document.getElementById('credits-list');
  const hpd = state.settings.hoursPerDay || 8;
  if (!state.credits.length) {
    creditsList.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:8px 0">Nenhum crédito acumulado ainda.</p>';
  } else {
    creditsList.innerHTML = state.credits
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .map(c => {
        const days = (c.extraMinutes / 60 / hpd).toFixed(1);
        return `
          <div class="credit-item">
            <div>
              <div class="credit-month">${monthLabel(c.year, c.month)}</div>
              <div class="credit-days">~${days} dias de folga</div>
            </div>
            <div class="credit-hours">+${fmtHM(c.extraMinutes)}</div>
          </div>
        `;
      }).join('');
  }
}

function selectHistoryMonth(key) {
  currentHistoryMonth = key;
  renderHistory();
}

function getAvailableMonths() {
  const set = new Set();
  const now = new Date();
  set.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  state.entries.forEach(e => {
    const [y, m] = e.date.split('-');
    set.add(`${y}-${m}`);
  });
  return [...set]
    .sort((a, b) => b.localeCompare(a))
    .map(k => {
      const [y, m] = k.split('-').map(Number);
      return { key: k, label: monthLabel(y, m) };
    });
}

function renderEntryList(containerId, entries, showDelete) {
  const el = document.getElementById(containerId);
  if (!entries.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Nenhum lançamento aqui ainda.</p>
      </div>`;
    return;
  }
  el.innerHTML = entries.map(e => `
    <div class="entry-item">
      <div class="entry-icon">${e.source === 'timer' ? '⏱' : '✏️'}</div>
      <div class="entry-info">
        <div class="entry-date">${formatDate(e.date)}</div>
        <div class="entry-notes">${e.notes || ''}</div>
      </div>
      <span class="entry-hours">${fmtHM(e.minutes)}</span>
      ${showDelete ? `<button class="entry-delete" onclick="deleteEntry(${e.id})">🗑️</button>` : ''}
    </div>
  `).join('');
}

// ─── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('settings-name').value = state.user.name;
  document.getElementById('settings-pass').value = '';
  document.getElementById('settings-goal').value = state.settings.goalHours;
  document.getElementById('settings-hpd').value = state.settings.hoursPerDay;
  document.getElementById('settings-reset-year').checked = state.settings.resetOnNewYear;
  renderAvatarElements();
  renderAlarmsConfig();
}

function saveSettings() {
  const name = document.getElementById('settings-name').value.trim();
  const pass = document.getElementById('settings-pass').value;
  const goal = parseFloat(document.getElementById('settings-goal').value);
  const hpd = parseFloat(document.getElementById('settings-hpd').value);
  const reset = document.getElementById('settings-reset-year').checked;

  if (name) state.user.name = name;
  if (pass) state.user.password = pass;
  if (goal > 0) state.settings.goalHours = goal;
  if (hpd > 0) state.settings.hoursPerDay = hpd;
  state.settings.resetOnNewYear = reset;

  // Save alarms from config
  const items = document.querySelectorAll('.alarm-config-item');
  state.alarms = [...items].map((item, i) => ({
    id: i + 1,
    time: item.querySelector('.alarm-time-input').value,
    message: item.querySelector('.alarm-msg-input').value,
    type: item.querySelector('.alarm-type-sel').value,
  })).filter(a => a.time);

  saveState();

  // Show success feedback
  const btn = document.querySelector('#page-settings .btn-primary');
  btn.textContent = 'Salvo! ✅';
  setTimeout(() => { btn.textContent = 'Salvar configurações'; }, 2000);
}

function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.user.avatar = e.target.result;
    saveState();
    renderAvatarElements();
  };
  reader.readAsDataURL(file);
}

function renderAlarmsConfig() {
  const el = document.getElementById('alarms-config-list');
  el.innerHTML = state.alarms.map((a, i) => `
    <div class="alarm-config-item">
      <div class="alarm-config-row">
        <input type="time" class="alarm-time-input" value="${a.time}" />
        <select class="alarm-type-sel">
          <option value="pause" ${a.type === 'pause' ? 'selected' : ''}>⏸ Pausar</option>
          <option value="resume" ${a.type === 'resume' ? 'selected' : ''}>▶ Retomar</option>
          <option value="none" ${a.type === 'none' ? 'selected' : ''}>🔔 Só avisar</option>
        </select>
        <button class="remove-alarm" onclick="removeAlarm(${i})">✕</button>
      </div>
      <div class="alarm-config-row">
        <input type="text" class="alarm-msg-input" value="${a.message}" placeholder="Mensagem do alarme..." />
      </div>
    </div>
  `).join('');
}

function addAlarm() {
  state.alarms.push({
    id: Date.now(),
    time: '09:00',
    message: 'Lembre-se de registrar seu horário! ⏱',
    type: 'none',
  });
  renderAlarmsConfig();
}

function removeAlarm(index) {
  state.alarms.splice(index, 1);
  renderAlarmsConfig();
}

// ─── ALERT MODAL ──────────────────────────────────────────────
let alertCallback = null;

function showAlert(title, msg, onConfirm) {
  document.getElementById('alert-title').textContent = title;
  document.getElementById('alert-msg').textContent = msg;
  const cancelBtn = document.getElementById('alert-cancel');
  const confirmBtn = document.getElementById('alert-confirm');
  alertCallback = onConfirm;

  if (onConfirm) {
    cancelBtn.classList.remove('hidden');
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.onclick = () => { onConfirm(); closeAlert(); };
  } else {
    cancelBtn.classList.add('hidden');
    confirmBtn.textContent = 'Ok';
    confirmBtn.onclick = closeAlert;
  }

  document.getElementById('modal-alert').classList.remove('hidden');
}

function closeAlert() {
  document.getElementById('modal-alert').classList.add('hidden');
  alertCallback = null;
}

// ─── BOOT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Auto-login if we already have a session flag
  // (For demo: just show login screen)
  document.getElementById('login-user').value = 'admin';
});
