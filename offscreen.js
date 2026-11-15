// صفحه نامرئی: کپی متن در کلیپ‌بورد
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
});
