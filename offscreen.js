// صفحه نامرئی: جیمیل را در iframe باز می‌کند تا ایمیل خوانده‌شده شود
const frame = document.getElementById('g');
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'copy') {
    const ta = document.createElement('textarea');
    ta.value = msg.text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    reply(true);
    return;
  }
  if (msg.type !== 'gframe') return;
  // اگر جیمیل همین حساب قبلاً بارگذاری شده، فقط بخش # عوض می‌شود (بدون بارگذاری دوباره)
  const t0 = Date.now();
  let done = false;
  const finish = (loaded) => { if (done) return; done = true; reply({ loaded, ms: Date.now() - t0 }); };
  frame.addEventListener('load', () => finish(true), { once: true });
  setTimeout(() => finish(false), 20000);
  frame.src = msg.url;
  return true;
});
