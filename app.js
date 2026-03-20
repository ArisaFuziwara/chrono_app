// ═══════════════════════════════════════════════════
//  CHRONO — app.js  (ES Module, Firebase 10)
// ═══════════════════════════════════════════════════

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, getDocs, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── STATE ────────────────────────────────────────
let currentUser = null;
let profile     = {};
let entries     = [];
let credits     = [];   // { firestoreId, year, month, extraMinutes }  (positive = credit, negative = deficit)
let timerInterval      = null;
let alarmCheckInterval = null;
let currentHistoryMonth = null;
let holidaysCache = {};  // { "2026": [...] }

const $ = id => document.getElementById(id);
const fmtHM = m => `${Math.floor(Math.abs(m)/60)}h ${String(Math.abs(m)%60).padStart(2,"0")}m`;
const fmtHH = h => `${h}h`;
const todayISO = () => new Date().toISOString().split("T")[0];
const monthLabel = (y,m) => `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][m-1]} ${y}`;
const formatDate = iso => { const [y,mo,d]=iso.split("-"); return `${d}/${mo}/${y}`; };
const yyyymm = (y,m) => y*100+m;

const defaultProfile = () => ({
  name: "Usuário", goalHours: 171, hoursPerDay: 8,
  resetOnNewYear: true, avatar: null,
  workDays: [1,2,3,4,5],   // Mon–Fri
  countHolidays: true,
  alarms: [
    { id:"a1", time:"12:00", message:"Agora é o horário do seu almoço! Gostaria de dar um pause? 🍽️", type:"pause" },
    { id:"a2", time:"13:00", message:"Tá na hora de voltar! Gostaria de dar um start? 💪",             type:"resume" },
  ],
  timer: { running:false, paused:false, startedAt:null, accumulated:0 },
  lastNotifiedAlarm: null,
});

// ─── SCREEN ───────────────────────────────────────
function showScreen(id) {
  ["screen-login","screen-loading","screen-app"].forEach(s => {
    $(s).classList.toggle("hidden", s!==id);
    $(s).classList.toggle("active", s===id);
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
  const e=$("login-email").value.trim(), p=$("login-pass").value;
  $("login-error").classList.add("hidden");
  try { await signInWithEmailAndPassword(auth,e,p); }
  catch(err){ showAuthErr("login-error", err.code); }
});

$("btn-register").addEventListener("click", async () => {
  const name=$("reg-name").value.trim(), email=$("reg-email").value.trim(), pass=$("reg-pass").value;
  $("reg-error").classList.add("hidden");
  if (!name){ showAuthErr("reg-error","no-name"); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth,email,pass);
    await updateProfile(cred.user,{ displayName:name });
    await setDoc(doc(db,"users",cred.user.uid), { ...defaultProfile(), name });
  } catch(err){ showAuthErr("reg-error",err.code); }
});

$("btn-forgot").addEventListener("click", async () => {
  const email=$("login-email").value.trim();
  if (!email){ showAuthErr("login-error","no-email"); return; }
  try {
    await sendPasswordResetEmail(auth,email);
    const el=$("login-error");
    el.style.color="var(--green-dark)"; el.textContent="E-mail enviado! ✅"; el.classList.remove("hidden");
  } catch(err){ showAuthErr("login-error",err.code); }
});

$("btn-logout").addEventListener("click", async () => {
  clearInterval(timerInterval); clearInterval(alarmCheckInterval);
  await signOut(auth);
});

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const t=tab.dataset.tab;
    document.querySelectorAll(".auth-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===t));
    $("form-login").classList.toggle("hidden",t!=="login");
    $("form-register").classList.toggle("hidden",t!=="register");
  });
});

function showAuthErr(elId, code) {
  const map = {
    "no-name":"Digite seu nome.",
    "no-email":"Digite seu e-mail primeiro.",
    "auth/invalid-email":"E-mail inválido.",
    "auth/user-not-found":"Usuário não encontrado.",
    "auth/wrong-password":"Senha incorreta.",
    "auth/email-already-in-use":"E-mail já em uso.",
    "auth/weak-password":"Senha fraca — mín. 6 caracteres.",
    "auth/too-many-requests":"Muitas tentativas. Tente depois.",
    "auth/invalid-credential":"E-mail ou senha incorretos.",
  };
  const el=$(elId);
  el.style.color=""; el.textContent=map[code]||"Erro inesperado."; el.classList.remove("hidden");
}

// ─── FIRESTORE ────────────────────────────────────
async function loadUserData() {
  const uid=currentUser.uid;
  const snap=await getDoc(doc(db,"users",uid));
  profile = snap.exists() ? { ...defaultProfile(), ...snap.data() } : { ...defaultProfile(), name:currentUser.displayName||"Usuário" };
  if (!snap.exists()) await setDoc(doc(db,"users",uid),profile);

  const [eSnap,cSnap] = await Promise.all([
    getDocs(collection(db,"users",uid,"entries")),
    getDocs(collection(db,"users",uid,"credits")),
  ]);
  entries = eSnap.docs.map(d=>({firestoreId:d.id,...d.data()}));
  credits = cSnap.docs.map(d=>({firestoreId:d.id,...d.data()}));
}

async function saveProfile(partial) {
  Object.assign(profile,partial);
  await updateDoc(doc(db,"users",currentUser.uid),partial);
}

async function addEntry(data) {
  const ref=await addDoc(collection(db,"users",currentUser.uid,"entries"),{...data,createdAt:serverTimestamp()});
  const entry={firestoreId:ref.id,...data};
  entries.push(entry);
  return entry;
}

async function removeEntry(firestoreId) {
  await deleteDoc(doc(db,"users",currentUser.uid,"entries",firestoreId));
  entries=entries.filter(e=>e.firestoreId!==firestoreId);
}

// Save credit OR deficit for a month (extraMinutes can be negative = deficit)
async function saveMonthBalance(year, month, balanceMinutes) {
  const uid=currentUser.uid;
  const existing=credits.find(c=>c.year===year&&c.month===month);
  if (existing) {
    await updateDoc(doc(db,"users",uid,"credits",existing.firestoreId),{extraMinutes:balanceMinutes});
    existing.extraMinutes=balanceMinutes;
  } else {
    const ref=await addDoc(collection(db,"users",uid,"credits"),{year,month,extraMinutes:balanceMinutes});
    credits.push({firestoreId:ref.id,year,month,extraMinutes:balanceMinutes});
  }
}

// ─── HOLIDAYS API ─────────────────────────────────
async function fetchHolidays(year) {
  if (holidaysCache[year]) return holidaysCache[year];
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    const data = await res.json();
    holidaysCache[year] = data.map(h=>h.date);  // "YYYY-MM-DD"
    return holidaysCache[year];
  } catch { return []; }
}

// ─── WORKDAYS CALC ────────────────────────────────
async function getRemainingWorkdays(year, month) {
  const workDays = profile.workDays || [1,2,3,4,5];
  const today = new Date();
  const lastDay = new Date(year, month, 0).getDate();
  let holidays = [];
  if (profile.countHolidays) holidays = await fetchHolidays(year);

  let count = 0;
  for (let d=today.getDate(); d<=lastDay; d++) {
    const date = new Date(year, month-1, d);
    const iso  = date.toISOString().split("T")[0];
    const dow  = date.getDay();
    if (workDays.includes(dow) && !holidays.includes(iso)) count++;
  }
  return count;
}

async function getTotalWorkdays(year, month) {
  const workDays = profile.workDays || [1,2,3,4,5];
  const lastDay = new Date(year, month, 0).getDate();
  let holidays = [];
  if (profile.countHolidays) holidays = await fetchHolidays(year);
  let count = 0;
  for (let d=1; d<=lastDay; d++) {
    const date = new Date(year, month-1, d);
    const iso  = date.toISOString().split("T")[0];
    const dow  = date.getDay();
    if (workDays.includes(dow) && !holidays.includes(iso)) count++;
  }
  return count;
}

// ─── INIT ─────────────────────────────────────────
function initApp() {
  $("log-date").value = todayISO();
  bindEvents();
  renderHome();
  startAlarmChecker();
  if (profile.timer?.running && !profile.timer?.paused) resumeTimerInterval();
  recalcAllCredits().then(()=>{ renderHome(); });
  updateTimerFab();
}

function bindEvents() {
  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>goTo(btn.dataset.page));
  });
  // Home
  $("home-avatar-wrap").addEventListener("click",()=>goTo("settings"));
  $("home-settings-btn").addEventListener("click",()=>goTo("settings"));
  $("qa-timer").addEventListener("click",()=>goTo("timer"));
  $("qa-log").addEventListener("click",()=>goTo("log"));
  $("qa-history").addEventListener("click",()=>goTo("history"));
  $("home-view-all").addEventListener("click",()=>goTo("history"));
  // Back btns
  ["timer","log","history","settings","credits"].forEach(p=>{
    $(`${p}-back`)?.addEventListener("click",()=>goTo("home"));
  });
  // Timer
  $("btn-start").addEventListener("click",startTimer);
  $("btn-pause").addEventListener("click",pauseTimer);
  $("btn-resume").addEventListener("click",resumeTimer);
  $("btn-stop").addEventListener("click",stopTimer);
  // Timer FAB
  $("timer-fab").addEventListener("click",()=>goTo("timer"));
  // Log
  $("btn-save-log").addEventListener("click",saveLogEntry);
  // Settings
  $("btn-save-settings").addEventListener("click",saveSettings);
  $("btn-add-alarm").addEventListener("click",addAlarm);
  $("avatar-upload-btn").addEventListener("click",()=>$("avatar-file").click());
  $("avatar-file").addEventListener("change",uploadAvatar);
  // Weekday picker
  $("weekday-picker").querySelectorAll(".wd-btn").forEach(btn=>{
    btn.addEventListener("click",()=>btn.classList.toggle("active"));
  });
  // Modals
  $("btn-close-celebration").addEventListener("click",closeCelebration);
  $("alert-cancel").addEventListener("click",closeAlert);
  $("notif-no").addEventListener("click",dismissNotif);
}

// ─── NAVIGATION ───────────────────────────────────
function goTo(page) {
  document.querySelectorAll(".page").forEach(p=>{ p.classList.remove("active"); p.classList.add("hidden"); });
  $(`page-${page}`).classList.remove("hidden");
  $(`page-${page}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  if (page==="home")    renderHome();
  if (page==="history") renderHistory();
  if (page==="settings")renderSettings();
  if (page==="timer")   renderTimerPage();
  if (page==="credits") renderCreditsPage();
  // Show FAB only when not on timer page
  updateTimerFab(page);
}

function updateTimerFab(page) {
  const fab=$("timer-fab");
  const currentPage=page||document.querySelector(".page.active")?.id?.replace("page-","");
  const isRunning=profile.timer?.running||profile.timer?.paused;
  if (isRunning && currentPage!=="timer") {
    fab.classList.remove("hidden");
    fab.textContent = profile.timer?.running ? "⏱🟢" : "⏱⏸";
  } else {
    fab.classList.add("hidden");
  }
}

// ─── HOME ─────────────────────────────────────────
async function renderHome() {
  const now=new Date(), h=now.getHours();
  $("home-greeting").textContent=`${h<12?"Bom dia":h<18?"Boa tarde":"Boa noite"}, ${(profile.name||"").split(" ")[0]}! 👋`;
  $("home-date").textContent=now.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
  renderAvatarElements();

  const y=now.getFullYear(), m=now.getMonth()+1;
  const {totalMin,weekMin}=getMonthAndWeekMinutes();
  const goalMin=(profile.goalHours||171)*60;

  $("home-total-h").textContent=fmtHM(totalMin);
  $("home-week-h").textContent=`↑ +${fmtHM(weekMin)} esta semana`;
  drawDonut(totalMin,goalMin);

  // Net credit (credits minus deficits)
  const netMin=credits.reduce((a,c)=>a+c.extraMinutes,0);
  $("legend-done").textContent=`${fmtHM(totalMin)} feitas`;
  $("legend-left").textContent=`${profile.goalHours||171}h de meta`;
  $("legend-credit").textContent=`${netMin>=0?"+":""}${fmtHM(netMin)} saldo`;

  // Workdays card
  renderWorkdaysCard(y, m, totalMin, goalMin);

  const recent=[...entries].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  renderEntryList("recent-list",recent,false);
}

async function renderWorkdaysCard(y, m, totalMin, goalMin) {
  const card=$("workdays-card");
  const remaining = await getRemainingWorkdays(y, m);
  const hpd=(profile.hoursPerDay||8)*60;
  const missingMin=Math.max(goalMin-totalMin,0);
  const hpdNeeded = remaining>0 ? Math.round(missingMin/remaining) : 0;
  const isCurrentMonth=true;

  if (missingMin<=0) {
    card.classList.add("hidden"); return;
  }
  card.classList.remove("hidden");
  card.innerHTML=`
    <div class="wd-row"><span class="wd-icon">📅</span><div class="wd-info">
      <p class="wd-title">Dias úteis restantes: <strong>${remaining}</strong></p>
      <p class="wd-sub">Faltam <strong>${fmtHM(missingMin)}</strong> para bater a meta</p>
      <p class="wd-sub">Média necessária: <strong>~${fmtHM(hpdNeeded)}/dia</strong> nos próximos dias</p>
    </div></div>`;
}

function renderAvatarElements() {
  ["home","settings"].forEach(prefix=>{
    const img=$(`${prefix}-avatar`), fb=$(`${prefix}-avatar-fallback`);
    if (!img||!fb) return;
    if (profile.avatar){ img.src=profile.avatar; img.classList.remove("hidden"); fb.classList.add("hidden"); }
    else { img.classList.add("hidden"); fb.classList.remove("hidden"); }
  });
}

function getMonthAndWeekMinutes() {
  const now=new Date(), y=now.getFullYear(), m=now.getMonth()+1;
  const ws=new Date(now); ws.setDate(now.getDate()-now.getDay()); ws.setHours(0,0,0,0);
  let totalMin=0,weekMin=0;
  entries.forEach(e=>{
    const [ey,em]=e.date.split("-").map(Number);
    if (ey===y&&em===m){ totalMin+=e.minutes; if(new Date(e.date)>=ws) weekMin+=e.minutes; }
  });
  return {totalMin,weekMin};
}

// ─── DONUT ────────────────────────────────────────
function drawDonut(doneMin, goalMin, canvasId="donut-chart", pctId="donut-pct", size=160) {
  const canvas=$(canvasId); if (!canvas) return;
  const ctx=canvas.getContext("2d");
  const half=size/2, lw=size<=140?18:22, r=half-lw/2-2;
  ctx.clearRect(0,0,size,size);
  const pct=Math.min(doneMin/goalMin,1);
  ctx.beginPath(); ctx.arc(half,half,r,0,Math.PI*2);
  ctx.strokeStyle="#e2e8f0"; ctx.lineWidth=lw; ctx.stroke();
  if (pct>0){
    ctx.beginPath(); ctx.arc(half,half,r,-Math.PI/2,-Math.PI/2+Math.PI*2*pct);
    ctx.strokeStyle=doneMin>=goalMin?"#6dbf67":"#5a9fd4";
    ctx.lineWidth=lw; ctx.lineCap="round"; ctx.stroke();
  }
  const el=$(pctId); if(el) el.textContent=`${Math.round(pct*100)}%`;
}

// ─── TIMER ────────────────────────────────────────
function renderTimerPage() { updateTimerDisplay(); updateTimerButtons(); renderAlarmList(); }

function startTimer() {
  profile.timer={running:true,paused:false,startedAt:Date.now(),accumulated:0};
  saveProfile({timer:profile.timer}); resumeTimerInterval(); updateTimerButtons(); updateTimerFab();
  $("timer-started-at").textContent=`Iniciado às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`;
}
function pauseTimer() {
  profile.timer.accumulated+=Date.now()-profile.timer.startedAt;
  profile.timer.paused=true; profile.timer.running=false;
  saveProfile({timer:profile.timer}); clearInterval(timerInterval); timerInterval=null;
  updateTimerButtons(); updateTimerFab();
}
function resumeTimer() {
  profile.timer.startedAt=Date.now(); profile.timer.running=true; profile.timer.paused=false;
  saveProfile({timer:profile.timer}); resumeTimerInterval(); updateTimerButtons(); updateTimerFab();
}
async function stopTimer() {
  const ms=getCurrentTimerMs(), minutes=Math.round(ms/60000);
  clearInterval(timerInterval); timerInterval=null;
  if (minutes<1){
    showAlert("Tempo muito curto","Menos de 1 minuto. Nada foi salvo.",null);
    profile.timer=defaultProfile().timer; await saveProfile({timer:profile.timer});
    updateTimerButtons(); updateTimerFab(); return;
  }
  const entry=await addEntry({date:todayISO(),minutes,notes:"Via cronômetro",source:"timer"});
  profile.timer=defaultProfile().timer; await saveProfile({timer:profile.timer});
  updateTimerButtons(); updateTimerDisplay(); updateTimerFab();
  $("timer-started-at").textContent=`Encerrado — ${fmtHM(minutes)} registrados ✅`;
  await checkEndOfMonthCelebration(entry.date);
  renderHome();
}
function resumeTimerInterval(){ clearInterval(timerInterval); timerInterval=setInterval(updateTimerDisplay,1000); }
function getCurrentTimerMs(){
  let ms=profile.timer?.accumulated||0;
  if(profile.timer?.running&&profile.timer?.startedAt) ms+=Date.now()-profile.timer.startedAt;
  return ms;
}
function updateTimerDisplay(){
  const s=Math.floor(getCurrentTimerMs()/1000);
  $("timer-display").textContent=`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
function updateTimerButtons(){
  const {running,paused}=profile.timer||{};
  $("btn-start").classList.toggle("hidden",running||paused);
  $("btn-pause").classList.toggle("hidden",!running||paused);
  $("btn-resume").classList.toggle("hidden",!paused);
  $("btn-stop").classList.toggle("hidden",!running&&!paused);
}
function renderAlarmList(){
  const el=$("alarm-list"), alarms=profile.alarms||[];
  if(!alarms.length){el.innerHTML="<p style='color:var(--text-muted);font-size:14px'>Nenhum alarme configurado.</p>";return;}
  el.innerHTML=alarms.map(a=>`<div class="alarm-item"><span class="alarm-icon">${a.type==="pause"?"🍽️":"⚡"}</span><div class="alarm-info"><div class="alarm-time">${a.time}</div><div class="alarm-msg">${a.message}</div></div></div>`).join("");
}

// ─── ALARMS ───────────────────────────────────────
function startAlarmChecker(){
  clearInterval(alarmCheckInterval);
  alarmCheckInterval=setInterval(checkAlarms,30000); checkAlarms();
}
function checkAlarms(){
  const now=new Date();
  const time=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  (profile.alarms||[]).forEach(alarm=>{
    if(alarm.time===time&&profile.lastNotifiedAlarm!==`${alarm.id}-${time}`){
      profile.lastNotifiedAlarm=`${alarm.id}-${time}`;
      saveProfile({lastNotifiedAlarm:profile.lastNotifiedAlarm});
      showAlarmNotif(alarm);
    }
  });
}
function showAlarmNotif(alarm){
  $("notif-text").textContent=alarm.message;
  $("notif-yes").onclick=()=>{
    if(alarm.type==="pause"&&profile.timer?.running) pauseTimer();
    if(alarm.type==="resume"&&profile.timer?.paused) resumeTimer();
    dismissNotif(); goTo("timer");
  };
  $("notif-banner").classList.remove("hidden");
  setTimeout(dismissNotif,30000);
  if("Notification"in window&&Notification.permission==="granted")
    new Notification("Chrono ⏱",{body:alarm.message});
  else if("Notification"in window&&Notification.permission!=="denied")
    Notification.requestPermission();
}
function dismissNotif(){ $("notif-banner").classList.add("hidden"); }

// ─── LOG ENTRY ────────────────────────────────────
async function saveLogEntry(){
  const date=$("log-date").value;
  const minutes=(parseInt($("log-hours").value)||0)*60+(parseInt($("log-minutes").value)||0);
  const notes=$("log-notes").value.trim();
  if(!date){alert("Selecione uma data.");return;}
  if(minutes<=0){alert("Insira um tempo válido.");return;}
  const entryYear=parseInt(date.split("-")[0]), thisYear=new Date().getFullYear();
  if(profile.resetOnNewYear&&entryYear<thisYear){
    showAlert("Horas do ano anterior",
      "Deseja inserir horas do ano anterior? Elas não gerarão crédito.\n\nPara contabilizar como crédito, vá em Configurações e desmarque «Resetar crédito ao virar o ano».",
      async()=>{ await addEntry({date,minutes,notes:notes||"Lançamento manual",source:"manual"}); clearLogForm(); goTo("home"); });
    return;
  }
  const entry=await addEntry({date,minutes,notes:notes||"Lançamento manual",source:"manual"});
  clearLogForm();
  await checkEndOfMonthCelebration(entry.date);
  renderHome(); goTo("home");
}
function clearLogForm(){
  $("log-date").value=todayISO(); $("log-hours").value=""; $("log-minutes").value=""; $("log-notes").value="";
}

// ─── END OF MONTH ─────────────────────────────────
async function checkEndOfMonthCelebration(dateISO){
  const d=new Date(dateISO);
  if(d.getDate()!==new Date(d.getFullYear(),d.getMonth()+1,0).getDate()) return;
  const y=d.getFullYear(), m=d.getMonth()+1;
  const goalMin=(profile.goalHours||171)*60;
  const monthMin=entries.filter(e=>{const[ey,em]=e.date.split("-").map(Number);return ey===y&&em===m;}).reduce((a,e)=>a+e.minutes,0);
  const balance=monthMin-goalMin;
  await saveMonthBalance(y,m,balance);
  if(balance>=0) showCelebration(y,m,monthMin,goalMin,balance);
}

// Recalc all past months (credit AND deficit)
async function recalcAllCredits(){
  const goalMin=(profile.goalHours||171)*60;
  const byMonth={};
  entries.forEach(e=>{
    const[y,m]=e.date.split("-").map(Number);
    const key=`${y}-${m}`;
    byMonth[key]=(byMonth[key]||0)+e.minutes;
  });
  const now=new Date();
  for(const key of Object.keys(byMonth)){
    const[y,m]=key.split("-").map(Number);
    const isCurrent=(y===now.getFullYear()&&m===now.getMonth()+1);
    if(isCurrent) continue;
    if(profile.resetOnNewYear&&y<now.getFullYear()) continue;
    const balance=byMonth[key]-goalMin;
    await saveMonthBalance(y,m,balance);
  }
}

function showCelebration(y,m,doneMin,goalMin,extraMin){
  $("cel-month").textContent=`${monthLabel(y,m)} — Missão cumprida! 🎊`;
  const days=(extraMin/60/(profile.hoursPerDay||8)).toFixed(1);
  $("cel-stats").innerHTML=`
    <div class="cel-stat"><span>Meta do mês</span><span>${profile.goalHours||171}h</span></div>
    <div class="cel-stat"><span>Total trabalhado</span><span>${fmtHM(doneMin)}</span></div>
    <div class="cel-stat"><span>Crédito gerado</span><span>+${fmtHM(extraMin)}</span></div>
    <div class="cel-stat"><span>Em dias de folga</span><span>~${days} dias</span></div>`;
  $("modal-celebration").classList.remove("hidden");
  launchConfetti();
}
function closeCelebration(){ $("modal-celebration").classList.add("hidden"); $("confetti-layer").classList.add("hidden"); $("confetti-layer").innerHTML=""; }
function launchConfetti(){
  const layer=$("confetti-layer"); layer.classList.remove("hidden"); layer.innerHTML="";
  const colors=["#a8e6a3","#b3d4f5","#fde68a","#ddd6fe","#fb923c","#fca5a5"];
  for(let i=0;i<80;i++){
    const el=document.createElement("div"); el.className="confetti-piece";
    el.style.cssText=`left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};width:${Math.random()*10+6}px;height:${Math.random()*10+6}px;border-radius:${Math.random()>.5?"50%":"2px"};animation-duration:${Math.random()*2+2}s;animation-delay:${Math.random()*1.5}s`;
    layer.appendChild(el);
  }
  setTimeout(()=>{ layer.classList.add("hidden"); layer.innerHTML=""; },5000);
}

// ─── HISTORY ──────────────────────────────────────
function renderHistory(){
  const months=getAvailableMonths();
  if(!currentHistoryMonth||!months.find(m=>m.key===currentHistoryMonth)){
    const n=new Date();
    currentHistoryMonth=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
  }
  $("month-tabs").innerHTML=months.map(m=>`<button class="month-tab ${m.key===currentHistoryMonth?"active":""}" data-month="${m.key}">${m.label}</button>`).join("");
  document.querySelectorAll(".month-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{ currentHistoryMonth=btn.dataset.month; renderHistory(); });
  });

  const[y,mo]=currentHistoryMonth.split("-").map(Number);
  const filtered=entries.filter(e=>{const[ey,em]=e.date.split("-").map(Number);return ey===y&&em===mo;}).sort((a,b)=>b.date.localeCompare(a.date));
  renderEntryList("history-list",filtered,true);

  const monthMin=filtered.reduce((a,e)=>a+e.minutes,0);
  const goalMin=(profile.goalHours||171)*60;
  const hpd=profile.hoursPerDay||8;
  const balance=monthMin-goalMin;
  const metAtGoal=balance>=0;
  const isCurrentMonth=(y===new Date().getFullYear()&&mo===new Date().getMonth()+1);

  // Net accumulated up to this month
  const netAccumMin=credits.filter(c=>yyyymm(c.year,c.month)<=yyyymm(y,mo)).reduce((a,c)=>a+c.extraMinutes,0);

  $("history-donut-title").textContent=monthLabel(y,mo);
  requestAnimationFrame(()=>drawDonut(monthMin,goalMin,"history-donut","history-donut-pct",140));
  $("history-donut-legend").innerHTML=`
    <div class="legend-item"><span class="dot ${metAtGoal?"green":"blue"}"></span><span>${fmtHM(monthMin)} trabalhadas</span></div>
    <div class="legend-item"><span class="dot gray"></span><span>${fmtHH(profile.goalHours||171)} de meta</span></div>
    ${metAtGoal?`<div class="legend-item"><span class="dot orange"></span><span>+${fmtHM(balance)} crédito</span></div>`
               :`<div class="legend-item"><span class="dot red-dot"></span><span>-${fmtHM(Math.abs(balance))} déficit</span></div>`}`;

  $("credits-list").innerHTML=`
    <div class="month-summary-card">
      <div class="ms-row"><span class="ms-label">Total trabalhado</span><span class="ms-value">${fmtHM(monthMin)}</span></div>
      <div class="ms-row"><span class="ms-label">Meta do mês</span><span class="ms-value">${fmtHH(profile.goalHours||171)}</span></div>
      <div class="ms-row"><span class="ms-label">Status</span>
        <span class="ms-badge ${metAtGoal?"badge-ok":"badge-deficit"}">
          ${metAtGoal?"✅ Meta atingida":isCurrentMonth?`⏳ Faltam ${fmtHM(Math.abs(balance))}`:`❌ Déficit de ${fmtHM(Math.abs(balance))}`}
        </span>
      </div>
      ${metAtGoal?`<div class="ms-row"><span class="ms-label">Crédito gerado</span><span class="ms-value credit-val">+${fmtHM(balance)} (~${(balance/60/hpd).toFixed(1)} dias)</span></div>`
                 :`<div class="ms-row"><span class="ms-label">Déficit</span><span class="ms-value deficit-val">-${fmtHM(Math.abs(balance))}</span></div>`}
      ${netAccumMin!==0?`<div class="ms-row ms-row-total"><span class="ms-label">Saldo acumulado até aqui</span><span class="ms-value ${netAccumMin>=0?"credit-val":"deficit-val"}">${netAccumMin>=0?"+":""}${fmtHM(netAccumMin)}</span></div>`:""}
    </div>`;
}

function getAvailableMonths(){
  const set=new Set();
  const now=new Date();
  set.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  entries.forEach(e=>{const[y,m]=e.date.split("-");set.add(`${y}-${m}`);});
  return [...set].sort((a,b)=>b.localeCompare(a)).map(k=>{const[y,m]=k.split("-").map(Number);return{key:k,label:monthLabel(y,m)};});
}

function renderEntryList(containerId,list,showDelete){
  const el=$(containerId);
  if(!list.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhum lançamento aqui ainda.</p></div>`;return;}
  el.innerHTML=list.map(e=>`
    <div class="entry-item">
      <div class="entry-icon">${e.source==="timer"?"⏱":"✏️"}</div>
      <div class="entry-info"><div class="entry-date">${formatDate(e.date)}</div><div class="entry-notes">${e.notes||""}</div></div>
      <span class="entry-hours">${fmtHM(e.minutes)}</span>
      ${showDelete?`<button class="entry-delete" data-fid="${e.firestoreId}">🗑️</button>`:""}
    </div>`).join("");
  if(showDelete){
    el.querySelectorAll(".entry-delete").forEach(btn=>{
      btn.addEventListener("click",async()=>{ await removeEntry(btn.dataset.fid); await recalcAllCredits(); renderHome(); renderHistory(); });
    });
  }
}

// ─── CREDITS PAGE ─────────────────────────────────
function renderCreditsPage(){
  const hpd=profile.hoursPerDay||8;
  const goalMin=(profile.goalHours||171)*60;

  // Build full month list from entries
  const byMonth={};
  entries.forEach(e=>{
    const[y,m]=e.date.split("-").map(Number);
    const k=yyyymm(y,m);
    byMonth[k]=(byMonth[k]||{y,m,min:0});
    byMonth[k].min+=e.minutes;
  });

  // Sort months descending
  const monthKeys=Object.keys(byMonth).map(Number).sort((a,b)=>b-a);

  // Net balance
  let netMin=0;
  monthKeys.forEach(k=>{
    const{y,m,min}=byMonth[k];
    const isCurrent=(y===new Date().getFullYear()&&m===new Date().getMonth()+1);
    if(!isCurrent) netMin+=min-goalMin;
  });

  // Saldo card
  $("net-balance-card").innerHTML=`
    <div class="net-balance-inner ${netMin>=0?"net-positive":"net-negative"}">
      <p class="net-label">Saldo líquido acumulado</p>
      <p class="net-value">${netMin>=0?"+":""}${fmtHM(netMin)}</p>
      <p class="net-days">≈ ${(Math.abs(netMin)/60/hpd).toFixed(1)} dias de trabalho ${netMin>=0?"de folga":"de dívida"}</p>
    </div>`;

  // Per-month list
  const list=$("credits-detail-list");
  if(!monthKeys.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>Nenhum dado ainda.</p></div>`;return;}

  let running=0;
  const rows=monthKeys.map(k=>{
    const{y,m,min}=byMonth[k];
    const isCurrent=(y===new Date().getFullYear()&&m===new Date().getMonth()+1);
    const balance=min-goalMin;
    if(!isCurrent) running+=balance;
    const isCredit=balance>=0;
    return `
      <div class="credit-detail-item">
        <div class="cdi-left">
          <p class="cdi-month">${monthLabel(y,m)}${isCurrent?" <span class='cdi-tag'>atual</span>":""}</p>
          <p class="cdi-worked">${fmtHM(min)} trabalhadas</p>
        </div>
        <div class="cdi-right">
          <p class="cdi-balance ${isCurrent?"cdi-neutral":isCredit?"cdi-credit":"cdi-deficit"}">
            ${isCurrent?"em andamento":isCredit?`+${fmtHM(balance)}`:`-${fmtHM(Math.abs(balance))}`}
          </p>
          ${!isCurrent?`<p class="cdi-days">${isCredit?"+":"-"}${(Math.abs(balance)/60/hpd).toFixed(1)} dias</p>`:""}
        </div>
      </div>`;
  });
  list.innerHTML=rows.join("");
}

// ─── SETTINGS ─────────────────────────────────────
function renderSettings(){
  $("settings-name").value=profile.name||"";
  $("settings-email").value=currentUser?.email||"";
  $("settings-goal").value=profile.goalHours||171;
  $("settings-hpd").value=profile.hoursPerDay||8;
  $("settings-reset-year").checked=!!profile.resetOnNewYear;
  $("settings-holidays").checked=!!profile.countHolidays;
  // Weekday picker
  const wd=profile.workDays||[1,2,3,4,5];
  $("weekday-picker").querySelectorAll(".wd-btn").forEach(btn=>{
    btn.classList.toggle("active",wd.includes(parseInt(btn.dataset.day)));
  });
  renderAvatarElements();
  renderAlarmsConfig();
}

async function saveSettings(){
  const workDays=[...$("weekday-picker").querySelectorAll(".wd-btn.active")].map(b=>parseInt(b.dataset.day));
  const partial={
    name:$("settings-name").value.trim()||profile.name,
    goalHours:parseFloat($("settings-goal").value)||profile.goalHours,
    hoursPerDay:parseFloat($("settings-hpd").value)||profile.hoursPerDay,
    resetOnNewYear:$("settings-reset-year").checked,
    countHolidays:$("settings-holidays").checked,
    workDays,
    alarms:collectAlarmsFromDOM(),
  };
  await saveProfile(partial);
  const btn=$("btn-save-settings");
  btn.textContent="Salvo! ✅"; setTimeout(()=>{btn.textContent="Salvar configurações";},2000);
}

function collectAlarmsFromDOM(){
  return [...document.querySelectorAll(".alarm-config-item")].map((item,i)=>({
    id:`a${i+1}`,time:item.querySelector(".alarm-time-input").value,
    message:item.querySelector(".alarm-msg-input").value,
    type:item.querySelector(".alarm-type-sel").value,
  })).filter(a=>a.time);
}

async function uploadAvatar(event){
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{ await saveProfile({avatar:e.target.result}); renderAvatarElements(); };
  reader.readAsDataURL(file);
}

function renderAlarmsConfig(){
  const el=$("alarms-config-list");
  el.innerHTML=(profile.alarms||[]).map((a,i)=>`
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
      <div class="alarm-config-row"><input type="text" class="alarm-msg-input" value="${a.message}" placeholder="Mensagem do alarme..." /></div>
    </div>`).join("");
  el.querySelectorAll(".remove-alarm").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const alarms=collectAlarmsFromDOM(); alarms.splice(parseInt(btn.dataset.index),1);
      profile.alarms=alarms; renderAlarmsConfig();
    });
  });
}

function addAlarm(){
  const alarms=collectAlarmsFromDOM();
  alarms.push({id:`a${Date.now()}`,time:"09:00",message:"Lembre-se de registrar seu horário! ⏱",type:"none"});
  profile.alarms=alarms; renderAlarmsConfig();
}

// ─── ALERT MODAL ──────────────────────────────────
let alertCallback=null;
function showAlert(title,msg,onConfirm){
  $("alert-title").textContent=title; $("alert-msg").textContent=msg; alertCallback=onConfirm;
  if(onConfirm){ $("alert-cancel").classList.remove("hidden"); $("alert-confirm").textContent="Confirmar"; $("alert-confirm").onclick=()=>{onConfirm();closeAlert();}; }
  else{ $("alert-cancel").classList.add("hidden"); $("alert-confirm").textContent="Ok"; $("alert-confirm").onclick=closeAlert; }
  $("modal-alert").classList.remove("hidden");
}
function closeAlert(){ $("modal-alert").classList.add("hidden"); alertCallback=null; }
