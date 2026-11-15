const DEFAULTS = { interval: 1, notify: true, maxAccounts: 5, label: '', scope: 'inbox', markOnOpen: true, otpAutofill: true, otpCopy: true };
const ids = Object.keys(DEFAULTS);

chrome.storage.sync.get('settings').then(({ settings }) => {
  const s = { ...DEFAULTS, ...(settings || {}) };
  for (const k of ids) {
    const n = document.getElementById(k);
    if (n.type === 'checkbox') n.checked = !!s[k];
    else n.value = s[k];
    n.addEventListener('change', save);
  }
});

let t;
async function save() {
  const s = {};
  for (const k of ids) {
    const n = document.getElementById(k);
    s[k] = n.type === 'checkbox' ? n.checked : n.type === 'number' ? Math.min(10, Math.max(1, Number(n.value) || 5)) : n.id === 'interval' ? Number(n.value) : n.value.trim();
    if (k === 'scope' || k === 'label') await chrome.storage.local.remove('knownIds');
  }
  await chrome.storage.sync.set({ settings: s });
  const el = document.getElementById('saved');
  el.textContent = 'ذخیره شد ✓';
  clearTimeout(t);
  t = setTimeout(() => (el.textContent = ''), 1500);
}
