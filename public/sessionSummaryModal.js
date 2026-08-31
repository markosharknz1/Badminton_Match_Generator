// Shared "session finished" summary modal (Check-in + Rounds) - shows the
// same payment breakdown the old plain alert() did, plus a "Send summary"
// button wired to POST /api/sessions/:id/send-summary-email. Same shared-
// script idiom as sessionNotes.js/tonightSummary.js - does its own fetch,
// no dependency on the host page's own api()/$ helpers. Needs a
// #session-summary-modal-backdrop with the expected child ids in the host
// page's HTML (see checkin.html/manage.html).

function sessionSummaryEsc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function sessionSummaryDollars(cents) {
    const d = (cents ?? 0) / 100;
    return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

async function showSessionSummaryModal(sessionId) {
    const backdrop = document.querySelector('#session-summary-modal-backdrop');
    if (!backdrop) return;
    const titleEl = backdrop.querySelector('#session-summary-title');
    const bodyEl = backdrop.querySelector('#session-summary-body');
    const sendBtn = backdrop.querySelector('#session-summary-send');
    const sendResultEl = backdrop.querySelector('#session-summary-send-result');

    titleEl.textContent = 'Session finished';
    bodyEl.innerHTML = '<p class="muted">Loading...</p>';
    sendResultEl.textContent = '';
    backdrop.style.display = 'flex';

    let summary;
    try {
        const res = await fetch(`/api/sessions/${sessionId}/payment-summary`);
        summary = await res.json();
        if (!res.ok) throw new Error(summary?.error || 'Could not load the summary.');
    } catch (err) {
        bodyEl.innerHTML = `<p class="muted">${sessionSummaryEsc(err.message)}</p>`;
        return;
    }

    titleEl.textContent = `Session finished - ${sessionSummaryEsc(summary.session.label || 'Session')} (${sessionSummaryEsc(summary.session.date)})`;
    const rows = summary.payment_breakdown.length
        ? summary.payment_breakdown.map((c) => `<tr><td>${sessionSummaryEsc(c.category)}</td><td class="num">${c.count}</td><td class="num">${sessionSummaryDollars(c.amount_cents)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="muted">No payments recorded.</td></tr>';
    const notesHtml = summary.session.notes
        ? `<p><strong>Notes:</strong><br>${sessionSummaryEsc(summary.session.notes).replace(/\n/g, '<br>')}</p>`
        : '';
    bodyEl.innerHTML = `
        <table class="history-table">
            <thead><tr><th>Category</th><th class="num">Count</th><th class="num">Total</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p><strong>Total funds: ${sessionSummaryDollars(summary.total_funds_cents)}</strong></p>
        ${notesHtml}
    `;

    sendBtn.onclick = async () => {
        sendBtn.disabled = true;
        sendResultEl.textContent = 'Sending...';
        sendResultEl.className = 'muted';
        try {
            const res = await fetch(`/api/sessions/${sessionId}/send-summary-email`, { method: 'POST' });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.error || 'Send failed.');
            sendResultEl.textContent = `Sent to ${body.sent_to.join(', ')}`;
            sendResultEl.className = 'muted';
        } catch (err) {
            sendResultEl.textContent = err.message;
            sendResultEl.className = 'error-banner';
            sendResultEl.style.display = 'block';
        } finally {
            sendBtn.disabled = false;
        }
    };
}

function wireSessionSummaryModalClose() {
    const backdrop = document.querySelector('#session-summary-modal-backdrop');
    if (!backdrop) return;
    const closeBtn = backdrop.querySelector('#session-summary-close');
    const close = () => { backdrop.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', close);
    let mouseDownTarget = null;
    backdrop.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop && mouseDownTarget === backdrop) close();
    });
}

wireSessionSummaryModalClose();
