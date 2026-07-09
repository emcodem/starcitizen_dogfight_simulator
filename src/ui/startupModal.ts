// =====================================================================
// Startup notices — a tiny sequential modal queue, shown once per load.
// Currently one check feeds into it: a one-time explainer that Ctrl is
// disabled outside fullscreen — dismissible permanently via localStorage,
// since this is a real standalone page (not an embedded Claude artifact),
// so plain localStorage is the right, durable place for that preference.
// =====================================================================

interface Notice {
  html: string;
  persistKey: string | null;
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

  // ---- Ctrl-disabled-outside-fullscreen notice ----
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
