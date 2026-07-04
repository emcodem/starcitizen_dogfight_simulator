// =====================================================================
// Startup notices — a tiny sequential modal queue, shown once per load.
// Two independent checks feed into it:
//   1. Browser compatibility (Chromium-based browsers only; the sim
//      leans on Chromium-specific behavior for gamepad vendor/product
//      parsing and the Keyboard Lock API).
//   2. A one-time explainer that Ctrl is disabled outside fullscreen —
//      dismissible permanently via localStorage, since this is a real
//      standalone page (not an embedded Claude artifact), so plain
//      localStorage is the right, durable place for that preference.
// =====================================================================

interface Notice {
  html: string;
  persistKey: string | null;
}

// navigator.userAgentData (User-Agent Client Hints) isn't in the lib.dom.d.ts types yet
// in all TS versions — declared narrowly here rather than widening the whole Navigator type.
interface NavigatorUAData {
  brands: Array<{ brand: string; version: string }>;
}

export function initStartupModal(): void {
  const overlay = document.getElementById('startup-modal-overlay') as HTMLElement;
  const textEl = document.getElementById('startup-modal-text') as HTMLElement;
  const checkboxWrap = document.getElementById('startup-modal-checkbox-wrap') as HTMLElement;
  const checkbox = document.getElementById('startup-modal-checkbox') as HTMLInputElement;
  const okBtn = document.getElementById('startup-modal-ok') as HTMLButtonElement;
  const queue: Notice[] = [];

  function showNext(): void {
    if (!queue.length) { overlay.style.display = 'none'; return; }
    const notice = queue[0];
    textEl.innerHTML = notice.html;
    checkboxWrap.style.display = notice.persistKey ? 'flex' : 'none';
    checkbox.checked = false;
    overlay.style.display = 'flex';
  }

  okBtn.addEventListener('click', () => {
    const notice = queue.shift();
    if (notice && notice.persistKey && checkbox.checked) {
      try { localStorage.setItem(notice.persistKey, '1'); }
      catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
    }
    showNext();
  });

  // ---- 1. Browser compatibility ----
  // navigator.userAgentData (User-Agent Client Hints) is currently only
  // implemented by Chromium-based browsers — Firefox and Safari don't have
  // it — so its presence plus a "Chromium" brand entry is a solid signal.
  // Brave and Edge both report a "Chromium" brand alongside their own, by
  // design, so this covers Chrome/Edge/Brave/Opera without singling any
  // one of them out. Falls back to UA sniffing for older Chromium.
  function isChromiumBased(): boolean {
    const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
    if (uaData && Array.isArray(uaData.brands)) {
      return uaData.brands.some(b => /Chromium/i.test(b.brand));
    }
    const ua = navigator.userAgent;
    const looksChromeFamily = /Chrome|Chromium|Edg|OPR|Brave/i.test(ua);
    const isFirefox = /Firefox/i.test(ua);
    const isSafariOnly = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
    return looksChromeFamily && !isFirefox && !isSafariOnly;
  }

  if (!isChromiumBased()) {
    queue.push({
      html: '⚠ <b>Unsupported browser detected.</b><br><br>' +
        'This sim relies on Chromium-specific behavior (gamepad vendor/product ' +
        'detection, the Keyboard Lock API) and is only tested in ' +
        '<b>Chrome, Edge, and Brave</b>. It may not work correctly here — for the ' +
        'full experience, please switch to one of those.',
      persistKey: null
    });
  }

  // ---- 2. Ctrl-disabled-outside-fullscreen notice ----
  let hideCtrlNotice = false;
  try { hideCtrlNotice = localStorage.getItem('vector_hide_ctrl_notice') === '1'; }
  catch { /* localStorage unavailable — just show the notice every time */ }

  if (!hideCtrlNotice) {
    queue.push({
      html: 'Your <b>Ctrl</b> key is disabled by default outside fullscreen.<br><br>' +
        'This prevents accidentally triggering <b>Ctrl+W</b> (close tab) or ' +
        '<b>Ctrl+Q</b> (quit) — shortcuts no webpage can block. Enter fullscreen ' +
        '(the ⛶ hint near the controls list) to re-enable Ctrl for its bound action.',
      persistKey: 'vector_hide_ctrl_notice'
    });
  }

  showNext();
}
