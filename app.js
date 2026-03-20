// ═══════════════════════════════════════════════════
//  CHRONO — app.js  (ES Module, Firebase 10)
// ═══════════════════════════════════════════════════

import { auth, db, storage } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, getDocs, deleteDoc, query, where, orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref, uploadString, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── LOCAL STATE ──────────────────────────────────
let currentUser = null;   // Firebase user object
let profile     = {};     // Firestore /users/{uid}
let entries     = [];     // Firestore /users/{uid}/entries
let credits     = [];     // Firestore /users/{uid}/credits
let timerInterval       = null;
let alarmCheckInterval  = null;
let currentHistoryMonth = null;

const defaultProfile = () => ({
  name:          "Usuário",
  goalHours:     171,
  hoursPerDay:   8,
  resetOnNewYear: true,
  avatar:        null,
  alarms: [
    { id: "a1", time: "12:00", message: "Agora é o horário do seu almoço! Gostaria de dar um pause? 🍽️", type: "pause"  },
    { id: "a2", time: "13:00", message: "Tá na hora de voltar! Gostaria de dar um start? 💪",             type: "resume" },
  ],
  timer: { running: false, paused: false, startedAt: null, accumulated: 0 },
  lastNotifiedAlarm: null,
});

// ─── HELPERS ──────────────────────────────────────
const $  = id => document.getElementById(id);
const fmtHM = m => `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m`;
const fmtHH = h => `${h}h`;
const todayISO = () => new Date().toISOString().split("T")[0];
const monthLabel = (y,m) => {
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[m-1]} ${y}`;
};
const formatDate = iso => {
  const [y,mo,d] = iso.split("-");
  return `${d}/${mo}/${y}`;
};

function showScreen(id) {
  ["screen-login","screen-loading","screen-app"].forEach(s => {
    $(s).classList.toggle("hidden", s !== id);
    $(s).classList.toggle("active", s === id);
  });
}

// ─── AUTH ─────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    showScreen("screen-loading");
    await loadUserData();
    showScreen("screen-app");
    initApp();
  } else {
    currentUser = null;
    showScreen("screen-login");
  }
});

$("btn-login").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const pass  = $("login-pass").value;
  $("login-error").classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    $("login-error").textContent = friendlyAuthError(e.code);
    $("login-error").classList.remove("hidden");
  }
});

$("btn-register").addEventListener("click", async () => {
  const name  = $("reg-name").value.trim();
  const email = $("reg-email").value.trim();
  const pass  = $("reg-pass").value;
  $("reg-error").classList.add("hidden");
  if (!name) { showRegError("Digite seu nome."); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    const p = { ...defaultProfile(), name };
    await setDoc(doc(db,"users",cred.user.uid), p);
  } catch (e) {
    showRegError(friendlyAuthError(e.code));
  }
});

$("btn-forgot").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) { $("login-error").textContent = "Digite seu e-mail primeiro."; $("login-error").classList.remove("hidden"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    $("login-error").style.color = "var(--green-dark)";
    $("login-error").textContent = "E-mail de recuperação enviado! ✅";
    $("login-error").classList.remove("hidden");
  } catch (e) {
    $("login-error").style.color = "";
    $("login-error").textContent = friendlyAuthError(e.code);
    $("login-error").classList.remove("hidden");
  }
});

$("btn-logout").addEventListener("click", async () => {
  clearInterval(timerInterval);
  clearInterval(alarmCheckInterval);
  await signOut(auth);
});

// Auth tab switching
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const t = tab.dataset.tab;
    document.querySelectorAll(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
    $("form-login").classList.toggle("hidden",    t !== "login");
    $("form-register").classList.toggle("hidden", t !== "register");
  });
});

function showRegError(msg) {
  $("reg-error").textContent = msg;
  $("reg-error").classList.remove("hidden");
}

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email":           "E-mail inválido.",
    "auth/user-not-found":          "Usuário não encontrado.",
    "auth/wrong-password":          "Senha incorreta.",
    "auth/email-already-in-use":    "Este e-mail já está em uso.",
    "auth/weak-password":           "Senha fraca — mínimo 6 caracteres.",
    "auth/too-many-requests":       "Muitas tentativas. Tente novamente mais tarde.",
    "auth/invalid-credential":      "E-mail ou senha incorretos.",
  };
  return map[code] || "Erro inesperado. Tente novamente.";
}

// ─── FIRESTORE — LOAD ─────────────────────────────
async function loadUserData() {
  const uid = currentUser.uid;

  // Profile
  const snap = await getDoc(doc(db,"users",uid));
  if (snap.exists()) {
    profile = snap.data();
  } else {
    profile = { ...defaultProfile(), name: currentUser.displayName || "Usuário" };
    await setDoc(doc(db,"users",uid), profile);
  }

  // Entries
  const eSnap = await getDocs(collection(db,"users",uid,"entries"));
  entries = eSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

  // Credits
  const cSnap = await getDocs(collection(db,"users",uid,"credits"));
  credits = cSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}

// ─── FIRESTORE — SAVE ─────────────────────────────
async function saveProfile(partial) {
  Object.assign(profile, partial);
  await updateDoc(doc(db,"users",currentUser.uid), partial);
}

async function addEntry(data) {
  const ref = await addDoc(collection(db,"users",currentUser.uid,"entries"), {
    ...data,
    createdAt: serverTimestamp(),
  });
  const entry = { firestoreId: ref.id, ...data };
  entries.push(entry);
  return entry;
}

async function removeEntry(firestoreId) {
  await deleteDoc(doc(db,"users",currentUser.uid,"entries",firestoreId));
  entries = entries.filter(e => e.firestoreId !== firestoreId);
}

async function saveCredit(year, month, extraMinutes) {
  const uid = currentUser.uid;
  const existing = credits.find(c => c.year === year && c.month === month);
  if (existing) {
    await updateDoc(doc(db,"users",uid,"credits",existing.firestoreId), { extraMinutes });
    existing.extraMinutes = extraMinutes;
  } else {
    const ref = await addDoc(collection(db,"users",uid,"credits"), { year, month, extraMinutes });
    credits.push({ firestoreId: ref.id, year, month, extraMinutes });
  }
}

// ─── INIT ─────────────────────────────────────────
function initApp() {
  $("log-date").value = todayISO();
  bindNavButtons();
  bindPageButtons();
  renderHome();
  startAlarmChecker();
  if (profile.timer?.running && !profile.timer?.paused) resumeTimerInterval();
  // Recalcula créditos retroativos silenciosamente
  recalcAllCredits().then(() => renderHome());
}

function bindNavButtons() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => goTo(btn.dataset.page));
  });
}

function bindPageButtons() {
  // Home
  $("home-avatar-wrap").addEventListener("click",  () => goTo("settings"));
  $("home-settings-btn").addEventListener("click", () => goTo("settings"));
  $("qa-timer").addEventListener("click",   () => goTo("timer"));
  $("qa-log").addEventListener("click",     () => goTo("log"));
  $("qa-history").addEventListener("click", () => goTo("history"));
  $("home-view-all").addEventListener("click", () => goTo("history"));

  // Back buttons
  $("timer-back").addEventListener("click",   () => goTo("home"));
  $("log-back").addEventListener("click",     () => goTo("home"));
  $("history-back").addEventListener("click", () => goTo("home"));
  $("settings-back").addEventListener("click",() => goTo("home"));

  // Timer buttons
  $("btn-start").addEventListener("click",  startTimer);
  $("btn-pause").addEventListener("click",  pauseTimer);
  $("btn-resume").addEventListener("click", resumeTimer);
  $("btn-stop").addEventListener("click",   stopTimer);

  // Log
  $("btn-save-log").addEventListener("click", saveLogEntry);

  // Settings
  $("btn-save-settings").addEventListener("click", saveSettings);
  $("btn-add-alarm").addEventListener("click", addAlarm);
  $("avatar-upload-btn").addEventListener("click", () => $("avatar-file").click());
  $("avatar-file").addEventListener("change", uploadAvatar);

  // Modals
  $("btn-close-celebration").addEventListener("click", closeCelebration);
  $("alert-cancel").addEventListener("click",  closeAlert);
  $("notif-no").addEventListener("click",      dismissNotif);
}

// ─── NAVIGATION ───────────────────────────────────
function goTo(page) {
  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active");
    p.classList.add("hidden");
  });
  $(`page-${page}`).classList.remove("hidden");
  $(`page-${page}`).classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });

  if (page === "home")     renderHome();
  if (page === "history")  renderHistory();
  if (page === "settings") renderSettings();
  if (page === "timer")    renderTimerPage();
}

// ─── HOME ─────────────────────────────────────────
function renderHome() {
  const now  = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  $("home-greeting").textContent = `${greet}, ${(profile.name||"").split(" ")[0]}! 👋`;
  $("home-date").textContent = now.toLocaleDateString("pt-BR",{ weekday:"long", day:"numeric", month:"long" });

  renderAvatarElements();

  const { totalMin, weekMin } = getMonthAndWeekMinutes();
  const goalMin = (profile.goalHours || 171) * 60;

  $("home-total-h").textContent = fmtHM(totalMin);
  $("home-week-h").textContent  = `↑ +${fmtHM(Math.abs(weekMin))} esta semana`;

  drawDonut(totalMin, goalMin);

  const creditMin = credits.reduce((a,c) => a + c.extraMinutes, 0);
  $("legend-done").textContent   = `${fmtHM(totalMin)} feitas`;
  $("legend-left").textContent   = `${profile.goalHours || 171}h de meta`;
  $("legend-credit").textContent = `+${fmtHM(creditMin)} crédito`;

  const recent = [...entries].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  renderEntryList("recent-list", recent, false);
}

function renderAvatarElements() {
  ["home","settings"].forEach(prefix => {
    const img      = $(`${prefix}-avatar`);
    const fallback = $(`${prefix}-avatar-fallback`);
    if (!img || !fallback) return;
    if (profile.avatar) {
      img.src = profile.avatar;
      img.classList.remove("hidden");
      fallback.classList.add("hidden");
    } else {
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
    }
  });
}

function getMonthAndWeekMinutes() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = now.getMonth() + 1;
  const ws   = new Date(now); ws.setDate(now.getDate()-now.getDay()); ws.setHours(0,0,0,0);
  let totalMin=0, weekMin=0;
  entries.forEach(e => {
    const [ey,em] = e.date.split("-").map(Number);
    if (ey===y && em===m) {
      totalMin += e.minutes;
      if (new Date(e.date) >= ws) weekMin += e.minutes;
    }
  });
  return { totalMin, weekMin };
}

// ─── DONUT ────────────────────────────────────────
function drawDonut(doneMin, goalMin, canvasId="donut-chart", pctId="donut-pct", size=160) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const half = size/2;
  const r = half - 18, lw = size === 140 ? 18 : 22;
  ctx.clearRect(0,0,size,size);

  const pct = Math.min(doneMin/goalMin, 1);

  // Background ring
  ctx.beginPath();
  ctx.arc(half,half,r,0,Math.PI*2);
  ctx.strokeStyle="#e2e8f0"; ctx.lineWidth=lw; ctx.stroke();

  // Progress arc
  if (pct>0) {
    ctx.beginPath();
    ctx.arc(half,half,r,-Math.PI/2,-Math.PI/2+Math.PI*2*pct);
    ctx.strokeStyle = doneMin >= goalMin ? "#6dbf67" : "#5a9fd4";
    ctx.lineWidth=lw; ctx.lineCap="round"; ctx.stroke();
  }

  const pctEl = $(pctId);
  if (pctEl) pctEl.textContent = `${Math.round(pct*100)}%`;
}

// ─── TIMER ────────────────────────────────────────
function renderTimerPage() {
  updateTimerDisplay();
  updateTimerButtons();
  renderAlarmList();
}

function startTimer() {
  profile.timer = { running:true, paused:false, startedAt:Date.now(), accumulated:0 };
  saveProfile({ timer: profile.timer });
  resumeTimerInterval();
  updateTimerButtons();
  $("timer-started-at").textContent = `Iniciado às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`;
}

function pauseTimer() {
  const elapsed = Date.now() - profile.timer.startedAt;
  profile.timer.accumulated += elapsed;
  profile.timer.paused  = true;
  profile.timer.running = false;
  saveProfile({ timer: profile.timer });
  clearInterval(timerInterval); timerInterval=null;
  updateTimerButtons();
}

function resumeTimer() {
  profile.timer.startedAt = Date.now();
  profile.timer.running   = true;
  profile.timer.paused    = false;
  saveProfile({ timer: profile.timer });
  resumeTimerInterval();
  updateTimerButtons();
}

async function stopTimer() {
  const ms      = getCurrentTimerMs();
  const minutes = Math.round(ms/60000);
  clearInterval(timerInterval); timerInterval=null;

  if (minutes < 1) {
    showAlert("Tempo muito curto","Menos de 1 minuto registrado. Nenhum lançamento salvo.",null);
    profile.timer = defaultProfile().timer;
    await saveProfile({ timer: profile.timer });
    updateTimerButtons(); return;
  }

  const entry = await addEntry({ date: todayISO(), minutes, notes:"Via cronômetro", source:"timer" });
  profile.timer = defaultProfile().timer;
  await saveProfile({ timer: profile.timer });
  updateTimerButtons(); updateTimerDisplay();
  $("timer-started-at").textContent = `Encerrado — ${fmtHM(minutes)} registrados ✅`;
  await checkEndOfMonthCelebration(entry.date);
}

function resumeTimerInterval() {
  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function getCurrentTimerMs() {
  let ms = profile.timer?.accumulated || 0;
  if (profile.timer?.running && profile.timer?.startedAt) ms += Date.now() - profile.timer.startedAt;
  return ms;
}

function updateTimerDisplay() {
  const s = Math.floor(getCurrentTimerMs()/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  $("timer-display").textContent =
    `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function updateTimerButtons() {
  const { running, paused } = profile.timer || {};
  $("btn-start").classList.toggle("hidden",   running || paused);
  $("btn-pause").classList.toggle("hidden",  !running || paused);
  $("btn-resume").classList.toggle("hidden", !paused);
  $("btn-stop").classList.toggle("hidden",   !running && !paused);
}

function renderAlarmList() {
  const el = $("alarm-list");
  const alarms = profile.alarms || [];
  if (!alarms.length) { el.innerHTML="<p style='color:var(--text-muted);font-size:14px'>Nenhum alarme configurado.</p>"; return; }
  el.innerHTML = alarms.map(a=>`
    <div class="alarm-item">
      <span class="alarm-icon">${a.type==="pause"?"🍽️":"⚡"}</span>
      <div class="alarm-info">
        <div class="alarm-time">${a.time}</div>
        <div class="alarm-msg">${a.message}</div>
      </div>
    </div>`).join("");
}

// ─── ALARMS ───────────────────────────────────────
function startAlarmChecker() {
  clearInterval(alarmCheckInterval);
  alarmCheckInterval = setInterval(checkAlarms, 30000);
  checkAlarms();
}

function checkAlarms() {
  const now  = new Date();
  const hh   = String(now.getHours()).padStart(2,"0");
  const mm   = String(now.getMinutes()).padStart(2,"0");
  const time = `${hh}:${mm}`;
  (profile.alarms||[]).forEach(alarm => {
    if (alarm.time===time && profile.lastNotifiedAlarm !== `${alarm.id}-${time}`) {
      profile.lastNotifiedAlarm = `${alarm.id}-${time}`;
      saveProfile({ lastNotifiedAlarm: profile.lastNotifiedAlarm });
      showAlarmNotif(alarm);
    }
  });
}

function showAlarmNotif(alarm) {
  $("notif-text").textContent = alarm.message;
  const yesBtn = $("notif-yes");
  yesBtn.onclick = () => {
    if (alarm.type==="pause"  && profile.timer?.running) pauseTimer();
    if (alarm.type==="resume" && profile.timer?.paused)  resumeTimer();
    dismissNotif(); goTo("timer");
  };
  $("notif-banner").classList.remove("hidden");
  setTimeout(dismissNotif, 30000);
  if ("Notification" in window && Notification.permission==="granted") {
    new Notification("Chrono ⏱",{ body: alarm.message });
  } else if ("Notification" in window && Notification.permission!=="denied") {
    Notification.requestPermission();
  }
}

function dismissNotif() { $("notif-banner").classList.add("hidden"); }

// ─── LOG ENTRY ────────────────────────────────────
async function saveLogEntry() {
  const date    = $("log-date").value;
  const h       = parseInt($("log-hours").value)   || 0;
  const m       = parseInt($("log-minutes").value) || 0;
  const notes   = $("log-notes").value.trim();
  const minutes = h*60+m;

  if (!date)      { alert("Selecione uma data."); return; }
  if (minutes<=0) { alert("Insira um tempo válido."); return; }

  const entryYear = parseInt(date.split("-")[0]);
  const thisYear  = new Date().getFullYear();

  if (profile.resetOnNewYear && entryYear < thisYear) {
    showAlert(
      "Horas do ano anterior",
      "Deseja inserir horas do ano anterior? Elas não gerarão crédito.\n\nPara contabilizar como crédito, vá em Configurações e desmarque «Resetar crédito ao virar o ano».",
      async () => {
        await addEntry({ date, minutes, notes: notes||"Lançamento manual", source:"manual" });
        clearLogForm(); goTo("home");
      }
    );
    return;
  }

  const entry = await addEntry({ date, minutes, notes: notes||"Lançamento manual", source:"manual" });
  clearLogForm();
  await checkEndOfMonthCelebration(entry.date);
  goTo("home");
}

function clearLogForm() {
  $("log-date").value    = todayISO();
  $("log-hours").value   = "";
  $("log-minutes").value = "";
  $("log-notes").value   = "";
}

// ─── END OF MONTH ─────────────────────────────────
async function checkEndOfMonthCelebration(dateISO) {
  const d       = new Date(dateISO);
  const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  if (d.getDate() !== lastDay) return;

  const y = d.getFullYear(), m = d.getMonth()+1;
  const goalMin = (profile.goalHours||171)*60;
  const monthMin = entries
    .filter(e=>{ const [ey,em]=e.date.split("-").map(Number); return ey===y&&em===m; })
    .reduce((a,e)=>a+e.minutes,0);

  if (monthMin >= goalMin) {
    const extra = monthMin - goalMin;
    await saveCredit(y, m, extra);
    showCelebration(y, m, monthMin, goalMin, extra);
  }
}

// Recalcula créditos de TODOS os meses com entradas (retroativo)
async function recalcAllCredits() {
  const goalMin = (profile.goalHours||171)*60;

  // Agrupa entradas por ano-mês
  const byMonth = {};
  entries.forEach(e => {
    const [y,m] = e.date.split("-").map(Number);
    const key = `${y}-${m}`;
    byMonth[key] = (byMonth[key] || 0) + e.minutes;
  });

  const now = new Date();

  for (const key of Object.keys(byMonth)) {
    const [y, m] = key.split("-").map(Number);

    // Só meses já encerrados (não o mês atual)
    const isCurrentMonth = (y === now.getFullYear() && m === now.getMonth()+1);
    if (isCurrentMonth) continue;

    // Se reset anual ativo, ignora anos anteriores
    if (profile.resetOnNewYear && y < now.getFullYear()) continue;

    const monthMin = byMonth[key];
    if (monthMin >= goalMin) {
      const extra = monthMin - goalMin;
      await saveCredit(y, m, extra);
    }
  }
}

function showCelebration(y,m,doneMin,goalMin,extraMin) {
  $("cel-month").textContent = `${monthLabel(y,m)} — Missão cumprida! 🎊`;
  const hpd        = profile.hoursPerDay || 8;
  const creditDays = (extraMin/60/hpd).toFixed(1);
  $("cel-stats").innerHTML = `
    <div class="cel-stat"><span>Meta do mês</span><span>${profile.goalHours||171}h</span></div>
    <div class="cel-stat"><span>Total trabalhado</span><span>${fmtHM(doneMin)}</span></div>
    <div class="cel-stat"><span>Crédito gerado</span><span>+${fmtHM(extraMin)}</span></div>
    <div class="cel-stat"><span>Em dias de trabalho</span><span>~${creditDays} dias</span></div>`;
  $("modal-celebration").classList.remove("hidden");
  launchConfetti();
}

function closeCelebration() {
  $("modal-celebration").classList.add("hidden");
  $("confetti-layer").classList.add("hidden");
  $("confetti-layer").innerHTML = "";
}

function launchConfetti() {
  const layer  = $("confetti-layer");
  layer.classList.remove("hidden"); layer.innerHTML="";
  const colors = ["#a8e6a3","#b3d4f5","#fde68a","#ddd6fe","#fb923c","#fca5a5"];
  for (let i=0;i<80;i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = `left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};
      width:${Math.random()*10+6}px;height:${Math.random()*10+6}px;
      border-radius:${Math.random()>.5?"50%":"2px"};
      animation-duration:${Math.random()*2+2}s;animation-delay:${Math.random()*1.5}s`;
    layer.appendChild(el);
  }
  setTimeout(()=>{ layer.classList.add("hidden"); layer.innerHTML=""; },5000);
}

// ─── HISTORY ──────────────────────────────────────
function renderHistory() {
  const months = getAvailableMonths();
  if (!currentHistoryMonth || !months.find(m=>m.key===currentHistoryMonth)) {
    const n = new Date();
    currentHistoryMonth = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
  }

  $("month-tabs").innerHTML = months.map(m=>`
    <button class="month-tab ${m.key===currentHistoryMonth?"active":""}" data-month="${m.key}">${m.label}</button>`).join("");
  document.querySelectorAll(".month-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{ currentHistoryMonth=btn.dataset.month; renderHistory(); });
  });

  const [y,mo] = currentHistoryMonth.split("-").map(Number);

  // Entradas do mês selecionado
  const filtered = entries
    .filter(e=>{ const [ey,em]=e.date.split("-").map(Number); return ey===y&&em===mo; })
    .sort((a,b)=>b.date.localeCompare(a.date));
  renderEntryList("history-list", filtered, true);

  // Resumo do mês: total trabalhado + status de meta
  const monthMin  = filtered.reduce((a,e)=>a+e.minutes,0);
  const goalMin   = (profile.goalHours||171)*60;
  const hpd       = profile.hoursPerDay||8;
  const metAtGoal = monthMin >= goalMin;
  const extraMin  = Math.max(monthMin - goalMin, 0);
  const missingMin= Math.max(goalMin - monthMin, 0);

  // Crédito acumulado ATÉ este mês (soma todos os meses até y-mo inclusive)
  const accumulatedMin = credits
    .filter(c => (c.year * 100 + c.month) <= (y * 100 + mo))
    .reduce((a,c) => a+c.extraMinutes, 0);
  
  // Crédito APENAS deste mês (do array credits, não do cálculo local)
  const thisMonthCredit = credits.find(c => c.year === y && c.month === mo);

  const creditsList = $("credits-list");
  const isCurrentMonth = (y === new Date().getFullYear() && mo === new Date().getMonth()+1);

  // Draw history donut — defer so canvas is visible in DOM first
  $("history-donut-title").textContent = monthLabel(y, mo);
  requestAnimationFrame(() => {
    drawDonut(monthMin, goalMin, "history-donut", "history-donut-pct", 140);
  });
  $("history-donut-legend").innerHTML = `
    <div class="legend-item"><span class="dot ${metAtGoal?"green":"blue"}"></span><span>${fmtHM(monthMin)} trabalhadas</span></div>
    <div class="legend-item"><span class="dot gray"></span><span>${fmtHH(profile.goalHours||171)} de meta</span></div>
    ${extraMin > 0 ? `<div class="legend-item"><span class="dot orange"></span><span>+${fmtHM(extraMin)} crédito</span></div>` : ""}
  `;

  creditsList.innerHTML = `
    <div class="month-summary-card">
      <div class="ms-row">
        <span class="ms-label">Total trabalhado</span>
        <span class="ms-value">${fmtHM(monthMin)}</span>
      </div>
      <div class="ms-row">
        <span class="ms-label">Meta do mês</span>
        <span class="ms-value">${fmtHH(profile.goalHours||171)}</span>
      </div>
      <div class="ms-row">
        <span class="ms-label">Status</span>
        <span class="ms-badge ${metAtGoal?"badge-ok":"badge-pending"}">
          ${metAtGoal ? "✅ Meta atingida" : isCurrentMonth ? `⏳ Faltam ${fmtHM(missingMin)}` : `❌ Faltaram ${fmtHM(missingMin)}`}
        </span>
      </div>
      ${extraMin > 0 ? `
      <div class="ms-row">
        <span class="ms-label">Crédito gerado este mês</span>
        <span class="ms-value credit-val">+${fmtHM(extraMin)} (~${(extraMin/60/hpd).toFixed(1)} dias)</span>
      </div>` : ""}
      ${accumulatedMin > 0 ? `
      <div class="ms-row ms-row-total">
        <span class="ms-label">Crédito acumulado até aqui</span>
        <span class="ms-value credit-val">+${fmtHM(accumulatedMin)}</span>
      </div>` : ""}
    </div>`;
}


function getAvailableMonths() {
  const set = new Set();
  const now = new Date();
  set.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  entries.forEach(e=>{ const [y,m]=e.date.split("-"); set.add(`${y}-${m}`); });
  return [...set].sort((a,b)=>b.localeCompare(a)).map(k=>{
    const [y,m] = k.split("-").map(Number);
    return { key:k, label:monthLabel(y,m) };
  });
}

function renderEntryList(containerId, list, showDelete) {
  const el = $(containerId);
  if (!list.length) {
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhum lançamento aqui ainda.</p></div>`;
    return;
  }
  el.innerHTML = list.map(e=>`
    <div class="entry-item">
      <div class="entry-icon">${e.source==="timer"?"⏱":"✏️"}</div>
      <div class="entry-info">
        <div class="entry-date">${formatDate(e.date)}</div>
        <div class="entry-notes">${e.notes||""}</div>
      </div>
      <span class="entry-hours">${fmtHM(e.minutes)}</span>
      ${showDelete?`<button class="entry-delete" data-fid="${e.firestoreId}">🗑️</button>`:""}
    </div>`).join("");

  if (showDelete) {
    el.querySelectorAll(".entry-delete").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        await removeEntry(btn.dataset.fid);
        renderHome(); renderHistory();
      });
    });
  }
}

// ─── SETTINGS ─────────────────────────────────────
function renderSettings() {
  $("settings-name").value        = profile.name  || "";
  $("settings-email").value       = currentUser?.email || "";
  $("settings-goal").value        = profile.goalHours  || 171;
  $("settings-hpd").value         = profile.hoursPerDay|| 8;
  $("settings-reset-year").checked= !!profile.resetOnNewYear;
  renderAvatarElements();
  renderAlarmsConfig();
}

async function saveSettings() {
  const partial = {
    name:           $("settings-name").value.trim() || profile.name,
    goalHours:      parseFloat($("settings-goal").value) || profile.goalHours,
    hoursPerDay:    parseFloat($("settings-hpd").value)  || profile.hoursPerDay,
    resetOnNewYear: $("settings-reset-year").checked,
    alarms:         collectAlarmsFromDOM(),
  };
  await saveProfile(partial);
  const btn = $("btn-save-settings");
  btn.textContent = "Salvo! ✅";
  setTimeout(()=>{ btn.textContent="Salvar configurações"; },2000);
}

function collectAlarmsFromDOM() {
  return [...document.querySelectorAll(".alarm-config-item")].map((item,i)=>({
    id:      `a${i+1}`,
    time:    item.querySelector(".alarm-time-input").value,
    message: item.querySelector(".alarm-msg-input").value,
    type:    item.querySelector(".alarm-type-sel").value,
  })).filter(a=>a.time);
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl = e.target.result;
    // Save as base64 directly in profile (small images only)
    // For production, use Firebase Storage with uploadString + getDownloadURL
    await saveProfile({ avatar: dataUrl });
    renderAvatarElements();
  };
  reader.readAsDataURL(file);
}

function renderAlarmsConfig() {
  const el = $("alarms-config-list");
  el.innerHTML = (profile.alarms||[]).map((a,i)=>`
    <div class="alarm-config-item">
      <div class="alarm-config-row">
        <input type="time" class="alarm-time-input" value="${a.time}" />
        <select class="alarm-type-sel">
          <option value="pause"  ${a.type==="pause" ?"selected":""}>⏸ Pausar</option>
          <option value="resume" ${a.type==="resume"?"selected":""}>▶ Retomar</option>
          <option value="none"   ${a.type==="none"  ?"selected":""}>🔔 Só avisar</option>
        </select>
        <button class="remove-alarm" data-index="${i}">✕</button>
      </div>
      <div class="alarm-config-row">
        <input type="text" class="alarm-msg-input" value="${a.message}" placeholder="Mensagem do alarme..." />
      </div>
    </div>`).join("");

  el.querySelectorAll(".remove-alarm").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const alarms = collectAlarmsFromDOM();
      alarms.splice(parseInt(btn.dataset.index),1);
      profile.alarms = alarms;
      renderAlarmsConfig();
    });
  });
}

function addAlarm() {
  const alarms = collectAlarmsFromDOM();
  alarms.push({ id:`a${Date.now()}`, time:"09:00", message:"Lembre-se de registrar seu horário! ⏱", type:"none" });
  profile.alarms = alarms;
  renderAlarmsConfig();
}

// ─── ALERT MODAL ──────────────────────────────────
let alertCallback = null;
function showAlert(title, msg, onConfirm) {
  $("alert-title").textContent = title;
  $("alert-msg").textContent   = msg;
  alertCallback = onConfirm;
  if (onConfirm) {
    $("alert-cancel").classList.remove("hidden");
    $("alert-confirm").textContent = "Confirmar";
    $("alert-confirm").onclick = ()=>{ onConfirm(); closeAlert(); };
  } else {
    $("alert-cancel").classList.add("hidden");
    $("alert-confirm").textContent = "Ok";
    $("alert-confirm").onclick = closeAlert;
  }
  $("modal-alert").classList.remove("hidden");
}
function closeAlert() { $("modal-alert").classList.add("hidden"); alertCallback=null; }
