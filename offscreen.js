// صفحه نامرئی: جیمیل را در iframe باز می‌کند تا ایمیل خوانده‌شده شود
const frame = document.getElementById('g');
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== 'offscreen' || msg.type !== 'gframe') return;
  // اگر جیمیل همین حساب قبلاً بارگذاری شده، فقط بخش # عوض می‌شود (بدون بارگذاری دوباره)
  frame.src = msg.url;
  reply(true);
});
