/* Copyright (c) 2025 Hannah Subbaraman. All rights reserved. */
const controlsPane   = document.getElementById('controls-pane');
const timerPane      = document.getElementById('timer-pane');
const timerRemaining = document.getElementById('timer-remaining');
const customBox      = document.getElementById('custom-domains');
const meta           = document.getElementById('meta');

// Default state
controlsPane?.classList.remove('hidden');
timerPane?.classList.remove('active');
if (timerPane) timerPane.style.display = 'none';

/* Helpers */
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function localDayKey(d = new Date()){
  const x = new Date(d); x.setHours(0,0,0,0);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function minutesToMs(min){ return min * 60000; }

function showToast(msg){
  let el = document.getElementById('toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  
  el.style.left = 'auto';
  el.style.right = '12px';
  
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.hidden = true; }, 1400);
}

async function ensureInstalledDate(){
  const { installedDate } = await chrome.storage.local.get('installedDate');
  if (!installedDate){
    await chrome.storage.local.set({ installedDate: localDayKey() });
  }
}

/* AI Usage UI helpers */
function fmtMinFromSec(secs){
  if (secs > 0 && secs < 60) return "<1 min";
  return `${Math.floor(secs/60)} min`;
}

let currentPeriod = 'day';
const PERIOD_UI = {
  day:   { title: 'Today', avg: 'Avg/day',   note: 'Day' },
  week:  { title: 'Week',  avg: 'Avg/Week',  note: 'Week' },
  month: { title: 'Month', avg: 'Avg/Month', note: 'Month' },
  year:  { title: 'Year',  avg: 'Avg/Year',  note: 'Year' },
};

/* AI Usage render */
function renderUsage(){
  const elSummary = document.getElementById('usage-summary');
  const elNote    = document.getElementById('data-note');
  if (!elSummary) return;

  chrome.runtime.sendMessage({ type:'getUsageSummary', period: currentPeriod }, (resp) => {
    if (!resp || !resp.ok) return;

    const ui = PERIOD_UI[currentPeriod];

    const todayStr  = (typeof resp.todaySec  === 'number') ? fmtMinFromSec(resp.todaySec)   : `${resp.todayMin} min`;
    const periodStr = (typeof resp.periodSec === 'number') ? `${Math.floor(resp.periodSec/60)} min` : `${resp.periodMin} min`;

    let parts;
    if (currentPeriod === 'day') {
      parts = [`Today: ${todayStr}`];
    } else {
      parts = [`${ui.title}: ${periodStr}`, `${ui.avg}: ${resp.avgPerDayMin} min`];
    }
    elSummary.textContent = parts.join(' • ');

    if (currentPeriod !== 'day' && resp.notEnoughData) {
      elNote.textContent = `Not enough data for a full ${ui.note} yet`;
      elNote.style.display = 'inline';
    } else {
      elNote.style.display = 'none';
    }
  });
}

/* Usage buttons */
document.querySelectorAll('.usage-controls [data-period]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.usage-controls [data-period]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentPeriod = btn.dataset.period || 'day'; // 'day' | 'week' | 'month' | 'year'
    renderUsage();
  });
});

document.querySelector('.usage-controls [data-period="day"]')?.classList.add('selected');

/* Focus session */
document.querySelectorAll('.preset-buttons .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const minutes = Number(btn.dataset.min);
    const input = document.getElementById('focus-minutes');
    if (input) input.value = String(minutes);
    document.querySelectorAll('.preset-buttons .chip').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

document.getElementById('start')?.addEventListener('click', () => {
  const input = document.getElementById('focus-minutes');
  const minutes = Math.max(1, Number(input?.value || 25));
  const until = Date.now() + minutesToMs(minutes);
  chrome.storage.sync.set({ focusUntil: until });
  showToast(`Focus started (${minutes} min)`);
  renderTimer();
});

function applyTimerOverlay(active){
  if (active){
    Object.assign(timerPane.style, {
      display: 'block',
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      width: '100vw', height: '100vh', margin: '0', padding: '0',
      border: 'none', borderRadius: '0', zIndex: '9999',
      background: 'radial-gradient(120% 80% at 50% -20%, #1b2551 0%, transparent 60%), #0b1223'
    });

    Object.assign(timerRemaining.style, {
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)', margin: '0', textAlign: 'center',
      fontWeight: '900', fontSize: '64px', letterSpacing: '0.5px', color: '#6ea8ff'
    });
  } else {
    timerPane.removeAttribute('style');
    timerRemaining.removeAttribute('style');
    timerPane.style.display = 'none';
  }
}

let tickHandle = null;
async function renderTimer(){
  const { focusUntil = 0 } = await chrome.storage.sync.get('focusUntil');
  const active = focusUntil && Date.now() < focusUntil;

  if (tickHandle){ clearInterval(tickHandle); tickHandle = null; }

  if (active){
    document.body.classList.add('session-active');
    document.querySelectorAll('#controls-pane button, #controls-pane input, #controls-pane textarea')
      .forEach(el => el.disabled = true);

    applyTimerOverlay(true);

    const update = () => {
      const rem = Math.max(0, focusUntil - Date.now());
      const hh = String(Math.floor(rem / 3600000)).padStart(2,'0');
      const mm = String(Math.floor((rem % 3600000) / 60000)).padStart(2,'0');
      const ss = String(Math.floor((rem % 60000) / 1000)).padStart(2,'0');
      timerRemaining.textContent = `${hh}:${mm}:${ss}`;
      if (rem <= 0){
        clearInterval(tickHandle);
        tickHandle = null;
        document.body.classList.remove('session-active');
        document.querySelectorAll('#controls-pane button, #controls-pane input, #controls-pane textarea')
          .forEach(el => el.disabled = false);
        applyTimerOverlay(false);
      }
    };
    update();
    tickHandle = setInterval(update, 1000);
  } else {
    document.body.classList.remove('session-active');
    document.querySelectorAll('#controls-pane button, #controls-pane input, #controls-pane textarea')
      .forEach(el => el.disabled = false);
    applyTimerOverlay(false);
  }
}

/* Custom domains */
document.getElementById('save')?.addEventListener('click', async () => {
  const domains = (customBox.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  await chrome.storage.sync.set({ customDomains: domains });
  showToast('Custom domains saved');
});

document.getElementById('reset-custom')?.addEventListener('click', async () => {
  await chrome.storage.sync.set({ customDomains: [] });
  customBox.value = '';
  showToast('Custom domains cleared');
});

/* Streaks */
async function renderFooter(){
  const [{ installedDate }] = await Promise.all([
    chrome.storage.local.get('installedDate')
  ]);
  const metaEl = document.getElementById('meta');
  if (!metaEl) return;

  const todayKey = localDayKey();
  const installKey = installedDate || todayKey;
  const install = new Date(installKey + 'T00:00:00');

  const today = new Date(); today.setHours(0,0,0,0);
  const daysSince = Math.max(1, Math.round((today - install) / 86400000) + 1);

  const daysWord = daysSince === 1 ? 'day' : 'days';
  metaEl.textContent = `Streak: ${daysSince} ${daysWord}`;
}

/* Init */
(async () => {
  await ensureInstalledDate();

  const { customDomains = [] } = await chrome.storage.sync.get('customDomains');
  customBox.value = customDomains.join('\n');
  
  await renderFooter();
  await renderTimer();
  renderUsage();
  
  (function initInfoTipClamping(){
  const gutter = 8;
  const desiredW = 230;

  document.querySelectorAll('.info-wrap').forEach(detailsEl => {
    const tip = detailsEl.querySelector('.info-tip');
    const btn = detailsEl.querySelector('summary.info-btn');

    if (!tip || !btn) return;

    detailsEl.addEventListener('toggle', () => {
      if (!detailsEl.open) {
        tip.style.position = '';
        tip.style.top = '';
        tip.style.left = '';
        tip.style.right = '';
        tip.style.width = '';
        tip.style.maxWidth = '';
        tip.style.transform = '';
        return;
      }

      requestAnimationFrame(() => {
        const vw = document.documentElement.clientWidth;
        const b  = btn.getBoundingClientRect();
        const width = Math.min(desiredW, vw - gutter*2);

        let left = b.right - width;
        let top  = b.bottom + 6;

        if (left < gutter) left = gutter;
        if (left + width > vw - gutter) left = vw - gutter - width;

        Object.assign(tip.style, {
          position: 'fixed',
          top:      `${top}px`,
          left:     `${left}px`,
          right:    'auto',
          width:    `${width}px`,
          maxWidth: `${width}px`,
          transform: 'none'
        });
      });
    });
  });
})();

  if (window.__uiTimer) clearInterval(window.__uiTimer);

  function tickUI(){
    if (document.visibilityState !== 'visible') return;
    renderUsage();
    renderFooter();
  }

  tickUI();
  window.__uiTimer = setInterval(tickUI, 15000);

  window.addEventListener('unload', () => {
    if (window.__uiTimer) clearInterval(window.__uiTimer);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync'  && ('focusUntil' in changes)) renderTimer();
    if (area === 'local' && ('usage' in changes))      renderUsage();
    if (area === 'local' && ('installedDate' in changes)) renderFooter();
  });
})();