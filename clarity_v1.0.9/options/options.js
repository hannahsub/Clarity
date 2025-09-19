const pinEl = document.getElementById("pin");
const allowlistEl = document.getElementById("allowlist");
const rosterFile = document.getElementById("rosterFile");
const rosterStatus = document.getElementById("rosterStatus");
const tracklistEl = document.getElementById("tracklist");

chrome.storage.local.get(["pin","allowlist","roster","tracklist"], ({pin="", allowlist=[], roster=[], tracklist=[]}) => {
  pinEl.value = pin;
  allowlistEl.value = (allowlist || []).join("\n");
  tracklistEl.value = (tracklist || []).join("\n");
  if (roster && roster.length) rosterStatus.textContent = `Loaded ${roster.length} roster entries.`;
});

document.getElementById("save").addEventListener("click", () => {
  const pin = pinEl.value.trim();
  const allowlist = allowlistEl.value.split("\n").map(s => s.trim()).filter(Boolean);
  chrome.storage.local.set({ pin, allowlist }, () => alert("Saved"));
});

document.getElementById("saveTracklist").addEventListener("click", () => {
  const lines = tracklistEl.value.split("\n").map(s=>s.trim()).filter(Boolean);
  chrome.storage.local.set({ tracklist: lines }, ()=> alert("Tracking list saved"));
});

rosterFile.addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();

  const rows = text.split(/\r?\n/).map(r=>r.trim()).filter(Boolean);
  const header = rows.shift(); const cols = header.split(",").map(s=>s.trim().toLowerCase());
  const nameIdx = cols.indexOf("name"); const emailIdx = cols.indexOf("email"); const groupIdx = cols.indexOf("group");
  const parsed = rows.map(line => { const p = line.split(",").map(s=>s.trim());
    return { name: p[nameIdx]||"", email: p[emailIdx]||"", group: p[groupIdx]||"" }; });
  chrome.storage.local.set({ roster: parsed }, () => { rosterStatus.textContent = `Imported ${parsed.length} roster entries.`; });
});
