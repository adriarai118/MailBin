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
  frame.src = msg.url;
  reply(true);
});
