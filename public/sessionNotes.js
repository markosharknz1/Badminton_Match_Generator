// Shared "session notes" popup (Check-in + Rounds) - a quick free-text note
// staff can jot down any time during a session (e.g. "sold 2 club shirts,
// $40 cash"), independent of check-in/payment. Feeds into the finish-session
// summary alert and the emailed end-of-night summary. Same shared-script
// idiom as tonightSummary.js/dateFormat.js - does its own fetch, no
// dependency on the host page's own api()/$ helpers, so it can be dropped
// into any page that has a #session-notes-btn + #session-notes-modal-backdrop.

// getSession() returns the host page's current session object (or null) -
// called fresh each time, since the host page may replace it wholesale
// (e.g. after an SSE refresh). onSaved(updatedSession) lets the host page
// update its own copy so it doesn't go stale until the next full refresh.
function wireSessionNotesButton(getSession, onSaved) {
    const btn = document.querySelector('#session-notes-btn');
    const backdrop = document.querySelector('#session-notes-modal-backdrop');
    if (!btn || !backdrop) return;
    const textarea = backdrop.querySelector('#session-notes-text');
    const saveBtn = backdrop.querySelector('#session-notes-save');
    const cancelBtn = backdrop.querySelector('#session-notes-cancel');
    const errorEl = backdrop.querySelector('#session-notes-error');

    function close() {
        backdrop.style.display = 'none';
    }

    btn.addEventListener('click', () => {
        const session = getSession();
        if (!session) return;
        textarea.value = session.notes || '';
        errorEl.style.display = 'none';
        backdrop.style.display = 'flex';
        textarea.focus();
    });

    cancelBtn.addEventListener('click', close);
    let mouseDownTarget = null;
    backdrop.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop && mouseDownTarget === backdrop) close();
    });

    saveBtn.addEventListener('click', async () => {
        const session = getSession();
        if (!session) return;
        try {
            const res = await fetch(`/api/sessions/${session.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: textarea.value.trim() || null }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
            close();
            if (onSaved) onSaved(body);
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = 'block';
        }
    });
}
