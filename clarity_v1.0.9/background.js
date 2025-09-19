/* Copyright (c) 2025 Hannah Subbaraman. All rights reserved. */

/* Request types */
const RT = { main:"main_frame", sub:"sub_frame", xhr:"xmlhttprequest", script:"script", other:"other" };

/* Default AI domains (block & track) */
const AI_DOMAINS_DEFAULT = [
  "chat.openai.com","chatgpt.com","platform.openai.com","api.openai.com",
  "gemini.google.com","bard.google.com","ai.google.dev","generativeai.googleapis.com",
  "claude.ai","api.anthropic.com",
  "copilot.microsoft.com","www.bing.com","perplexity.ai",
  "poe.com","pi.ai","huggingface.co","meta.ai",
  "grok.x.ai","deepseek.com","qwenlm.ai","tongyi.aliyun.com","mistral.ai",
];

/* Utilities */
function pad2(n){ return n<10?("0"+n):""+n; }
function localDayKey(d=new Date()){ const x=new Date(d); x.setHours(0,0,0,0); return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`; }
function matchesList(domain, list){ if(!domain) return false; for(const d of list){ if(domain===d || domain.endsWith("."+d)) return true; } return false; }
function blog(...a){ try{ console.debug("[Clarity:bg]", ...a); }catch{} }

function toHost(p){
  try {
    if (/^https?:\/\//i.test(p)) return new URL(p).hostname.toLowerCase();
  } catch {}
  return String(p || "").toLowerCase();
}

const RULESET_ID = (() => {
  try {
    const rr = chrome.runtime.getManifest()?.declarative_net_request?.rule_resources || [];
    const preferred = rr.find(r => r.id === "static_rules") || rr[0];
    return preferred?.id || null;
  } catch { return null; }
})();

/*  Custom domains cache */
let customDomainsCache = [];
async function refreshCustomDomainsCache(){
  const { customDomains = [] } = await chrome.storage.sync.get("customDomains");
  customDomainsCache = (customDomains || []).filter(Boolean);
}
function isTrackedDomain(domain){
  return matchesList(domain, AI_DOMAINS_DEFAULT) || matchesList(domain, customDomainsCache);
}

/* DNR dynamic rules (focus/class) */
let nextDynamicId = 1000;
async function addBlockRule(urlFilter, resourceTypes=[RT.main,RT.sub]){
  const rule = { id: nextDynamicId++, priority: 1, action:{type:"block"}, condition:{ urlFilter, resourceTypes } };
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules:[rule] });
}
async function clearDynamicRules(){
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  if(rules.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map(r=>r.id) });
}
async function setStaticEnabled(enabled){
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  if (enabled) await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  if (!RULESET_ID){ blog("setStaticEnabled: no RULESET_ID; skipping"); return; }
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds:  enabled ? [RULESET_ID] : [],
      disableRulesetIds: enabled ? [] : [RULESET_ID]
    });
  } catch (e) {
    blog("updateEnabledRulesets failed:", e?.message || e);
  }
}
async function enforceDynamicBlocks(){
  await clearDynamicRules();

  const { focusUntil = 0, classUntil = 0 } =
    await chrome.storage.sync.get(["focusUntil","classUntil"]);

  const now = Date.now();
  const timeWindowActive =
    (focusUntil && now < focusUntil) || (classUntil && now < classUntil);

  await setStaticEnabled(timeWindowActive);
  if (!timeWindowActive) return;

  // Defaults
  for (const dom of AI_DOMAINS_DEFAULT){
    await addBlockRule("||" + dom, [RT.main, RT.sub, RT.xhr, RT.script, RT.other]);
  }

  // Customs — normalise in case the user pasted a full URL
  for (const raw of customDomainsCache){
    const host = toHost(raw);
    if (!host) continue;
    await addBlockRule("||" + host, [RT.main, RT.sub, RT.xhr, RT.script, RT.other]);
  }
}

/* Programmatic pinger registration */
async function ensurePingerRegistered(){
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["pinger"] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: "pinger",
      js: ["visible_pinger.js"],
      matches: ["http://*/*", "https://*/*"],
      runAt: "document_idle",
      persistAcrossSessions: true,
      world: "ISOLATED"
    }]);
    blog("pinger registered");
  } catch (e) {
    blog("registerContentScripts failed:", e?.message || e);
  }
}

/*  Visible counting  */
// Sessions keyed by tabId, long-lived port + 1 min sweeper
const visibleSessions = new Map();

/* Split usage across midnight so tracks correct days and streaks */
function splitByMidnight(startMs, endMs){
  const out = [];
  let cursor = new Date(startMs);
  while (cursor.getTime() < endMs){
    const dayEnd = new Date(cursor); dayEnd.setHours(24,0,0,0);
    const sliceEnd = Math.min(dayEnd.getTime(), endMs);
    const secs = Math.max(0, Math.round((sliceEnd - cursor.getTime())/1000));
    if (secs > 0) out.push({ dayKey: localDayKey(cursor), seconds: secs });
    cursor = new Date(sliceEnd);
  }
  return out;
}

/* Usage seconds per-day, per-domain */
function addUsage(domain, startMs, endMs){
  if (!domain || !isTrackedDomain(domain)) return;
  const slices = splitByMidnight(startMs, endMs);
  if (!slices.length) return;
  blog("credit", { domain, slices });
  chrome.storage.local.get(["usage"], ({ usage = {} }) => {
    for (const { dayKey, seconds } of slices){
      if (seconds <= 0) continue;
      if (!usage[dayKey]) usage[dayKey] = {};
      usage[dayKey][domain] = (usage[dayKey][domain] || 0) + seconds;
    }
    chrome.storage.local.set({ usage });
  });
}

/* Session handlers */
function handleVisibleStart(tabId, domain, ts){
  const s = visibleSessions.get(tabId);
  if (s?.visible){ s.lastTs = ts; return; }
  blog("start", { tabId, domain, ts });
  visibleSessions.set(tabId, { domain, lastTs: ts, visible: true });
}
function handleVisibleTick(tabId, domain, ts){
  const s = visibleSessions.get(tabId);
  if (!s || !s.visible){
    blog("tick->start", { tabId, domain, ts });
    handleVisibleStart(tabId, domain, ts);
    return;
  }
  if (s.domain !== domain){
    blog("nav flush", { tabId, from: s.domain, to: domain });
    if (s.lastTs) addUsage(s.domain, s.lastTs, ts);
    s.domain = domain; s.lastTs = ts; return;
  }
  if (s.lastTs && ts > s.lastTs) addUsage(s.domain, s.lastTs, ts);
  s.lastTs = ts;
}
function handleVisibleStop(tabId, domain, ts){
  const s = visibleSessions.get(tabId);
  if (!s) return;
  blog("stop", { tabId, domain: s.domain, ts });
  if (s.visible && s.lastTs) addUsage(s.domain, s.lastTs, ts);
  visibleSessions.delete(tabId);
}

/* Keeps SW awake while visible. can change to when active but keep it at when visible for now*/
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "visible") return;
  const tabId = port.sender?.tab?.id;
  const initialDomain = (() => { try { return new URL(port.sender?.tab?.url || "").hostname; } catch { return null; } })();
  blog("onConnect", { tabId, initialDomain });
  if (!tabId) return;

  port.onMessage.addListener((msg) => {
    const ts = Number(msg?.ts) || Date.now();
    const domain = msg?.domain || initialDomain;
    if (!domain || !isTrackedDomain(domain)) { blog("ignore (untracked)", { tabId, domain }); return; }
    if (msg?.type === "start") handleVisibleStart(tabId, domain, ts);
    else if (msg?.type === "tick") handleVisibleTick(tabId, domain, ts);
    else if (msg?.type === "stop") handleVisibleStop(tabId, domain, ts);
  });

  port.onDisconnect.addListener(() => {
    blog("onDisconnect", { tabId });
    const s = visibleSessions.get(tabId);
    if (s) handleVisibleStop(tabId, s.domain, Date.now());
  });
});

/* Safety hooks */
chrome.tabs.onRemoved.addListener((tabId) => {
  const s = visibleSessions.get(tabId);
  if (s) handleVisibleStop(tabId, s.domain, Date.now());
});
chrome.windows.onRemoved.addListener(() => {
  const now = Date.now();
  for (const [tabId, s] of visibleSessions) handleVisibleStop(tabId, s.domain, now);
});

/* Pause only when OS is locked, quiet reading still counts */
if (chrome.idle && chrome.idle.onStateChanged){
  chrome.idle.setDetectionInterval(300);
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === "locked"){
      const now = Date.now();
      for (const [tabId, s] of visibleSessions) handleVisibleStop(tabId, s.domain, now);
    }
  });
}

/* Alarms */
function setupAlarms(){
  chrome.alarms.create("enforceBlocks", { periodInMinutes: 1 });
  chrome.alarms.create("visibleSweep", { periodInMinutes: 1 });
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "enforceBlocks") await enforceDynamicBlocks();
  if (a.name === "visibleSweep"){
    const now = Date.now();
    for (const [tabId, s] of visibleSessions){
      if (!s.visible || !s.lastTs) continue;
      if (now > s.lastTs){
        blog("sweep credit", { tabId, domain: s.domain, secs: Math.round((now - s.lastTs)/1000) });
        addUsage(s.domain, s.lastTs, now);
        s.lastTs = now;
      }
    }
  }
});

/* Install / Startup */
chrome.runtime.onInstalled.addListener(async () => {
  const { installedDate } = await chrome.storage.local.get("installedDate");
  if (!installedDate) await chrome.storage.local.set({ installedDate: localDayKey() });
  await refreshCustomDomainsCache();
  await enforceDynamicBlocks();
  await ensurePingerRegistered();
  setupAlarms();
});
chrome.runtime.onStartup.addListener(async () => {
  await refreshCustomDomainsCache();
  await enforceDynamicBlocks();
  await ensurePingerRegistered();
  setupAlarms();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync') {
    if (changes.customDomains) {
      await refreshCustomDomainsCache();
      await enforceDynamicBlocks();
    }
    if (changes.focusUntil || changes.classUntil) {
      await enforceDynamicBlocks();
    }
  }
});

/* Popup message APIs */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "getUsageSummary"){
    const PERIODS = { day:1, week:7, month:30, year:365 };
    const daysReq = PERIODS[msg?.period] || 1;

    Promise.all([
      new Promise(res => chrome.storage.local.get(["usage"], x => res(x.usage || {}))),
      new Promise(res => chrome.storage.local.get(["installedDate"], x => res(x.installedDate || localDayKey())))
    ]).then(([usage, installedDate]) => {
      const sumSecs = (m={}) => Object.values(m).reduce((a,b)=>a+b,0);
      const todayKey = localDayKey();
      const todaySec = sumSecs(usage[todayKey] || {});

      const end = new Date(); end.setHours(0,0,0,0);
      let periodSec = 0;
      for (let i = 0; i < daysReq; i++){
        const d = new Date(end.getTime() - i*86400000);
        periodSec += sumSecs(usage[localDayKey(d)] || {});
      }

      // coverage: days since install for streaks
      const start = new Date((installedDate || todayKey) + "T00:00:00");
      const today = new Date(); today.setHours(0,0,0,0);
      const coverageDays = Math.max(1, Math.round((today - start) / 86400000) + 1);

      // totals in minutes
      const todayMin  = Math.floor(todaySec / 60);
      const periodMin = Math.floor(periodSec / 60);

      // averages
      const denomDays = daysReq;
      const avgPerDayMin =
        (daysReq === 1)
          ? Math.floor((periodSec / denomDays) / 60)
          : Math.round((periodSec / denomDays) / 60);

      const periodLabel = msg?.period === "day"   ? "Today"
                          : msg?.period === "week"  ? "7 days"
                          : msg?.period === "month" ? "30 days"
                          : msg?.period === "year"  ? "365 days" : "Today";
      const avgLabel = msg?.period === "day"   ? "Avg/day"
                       : msg?.period === "week"  ? "Avg/7d"
                       : msg?.period === "month" ? "Avg/30d"
                       : msg?.period === "year"  ? "Avg/365d" : "Avg/day";

      sendResponse({
        ok: true,
        todaySec, periodSec,
        todayMin, periodMin, avgPerDayMin,
        avgDenomDays: denomDays,
        periodLabel, avgLabel,
        coverageDays, periodDays: daysReq,
        notEnoughData: coverageDays < daysReq
      });
    });
    return true;
  }
});