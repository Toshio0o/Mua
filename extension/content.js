/* Mua 账号绑定 —— content script
 *
 * 只在平台的 /bind/<code> 页面上工作：把这个一次性 code 交给 background，
 * background 读完 muse.ai 的 cookie 后回传结果，页面据此更新 UI。
 */

(() => {
  const match = location.pathname.match(/^\/bind\/([A-Za-z0-9_-]{8,})/);
  if (!match) return;
  const code = match[1];
  const api = location.origin;

  // 让页面知道扩展已就位
  document.documentElement.setAttribute('data-museapi-video-ext', '1');

  const post = (payload) => {
    window.postMessage({ source: 'museapi-video-ext', ...payload }, location.origin);
  };

  const submitFromPage = (payload) => new Promise((resolve) => {
    const id = `muse-bind-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMsg = (event) => {
      if (event.source !== window || !event.data || event.data.source !== 'muse-page-bind' || event.data.id !== id) return;
      window.removeEventListener('message', onMsg);
      resolve(event.data);
    };
    window.addEventListener('message', onMsg);
    const script = document.createElement('script');
    const body = JSON.stringify(payload).replace(/</g, '\\u003c');
    script.textContent = `
      (async () => {
        const id = ${JSON.stringify(id)};
        try {
          const res = await fetch('/api/accounts/bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: ${body},
          });
          const data = await res.json().catch(() => ({}));
          window.postMessage({ source: 'muse-page-bind', id, ok: res.ok, status: res.status, data }, location.origin);
        } catch (error) {
          window.postMessage({ source: 'muse-page-bind', id, ok: false, error: String(error && error.message || error) }, location.origin);
        }
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  });

  chrome.runtime.sendMessage({ type: 'MUSE_READ' }, async (read) => {
    if (chrome.runtime.lastError || !read) {
      post({ type: 'error', message: chrome.runtime.lastError?.message || '扩展没有响应，试试重新打开这个页面' });
      return;
    }
    if (!read.ok) {
      post({ type: 'error', message: read.message || '绑定失败', reason: read.error || '' });
      return;
    }
    const submitted = await submitFromPage({ code, cookie: read.cookie, label: '' });
    if (submitted.ok) {
      post({
        type: 'done',
        label: submitted.data?.account?.label || '',
        warning: submitted.data?.warning || '',
        cookieCount: read.cookieCount || 0,
      });
    } else {
      post({ type: 'error', message: submitted.data?.error || submitted.error || '绑定失败' });
    }
  });
})();
