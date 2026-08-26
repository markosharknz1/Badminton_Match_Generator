// Shared across Check-in, Rounds, and History: a compact "tonight's totals"
// card - player count and payment-method counts/amounts for whichever
// session currently counts as "tonight" (the open one, or the most
// recently closed one - see GET /api/sessions/latest). One shared script
// (same idiom as events.js/branding.js) so the widget isn't built three
// slightly-different times.
//
// Deliberately separate from the History page's multi-session .xlsx export
// tool - this is a quick "how many players, how much of each payment type"
// glance at the most recent night only, not a trend report.

function tonightSummaryEsc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function tonightPaymentTable(title, entries, labelKey, totalCents) {
    if (!entries.length) return '';
    const rows = entries.map((p) => `
        <tr><td>${tonightSummaryEsc(p[labelKey])}</td><td class="num">${p.count}</td><td class="num">$${(p.amount_cents / 100).toFixed(2)}</td></tr>
    `).join('');
    const totalCount = entries.reduce((sum, p) => sum + p.count, 0);
    return `
        <div class="tonight-subheading">${title}</div>
        <table class="history-table tonight-payment-table">
            <thead><tr><th>${title}</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="tonight-total-row"><td>Total</td><td class="num">${totalCount}</td><td class="num">$${(totalCents / 100).toFixed(2)}</td></tr></tfoot>
        </table>
    `;
}

function tonightSummaryHtml(data) {
    if (!data) return '<p class="muted">No sessions yet.</p>';
    return `
        <div class="tonight-headline">
            <strong>${data.unique_players}</strong> player${data.unique_players === 1 ? '' : 's'}
            <span class="muted"> - ${tonightSummaryEsc(data.session.label || 'Session')} (${tonightSummaryEsc(data.session.date)})</span>
        </div>
        ${data.payment_breakdown.length ? `
            ${tonightPaymentTable('Member type', data.payment_breakdown, 'category', data.total_funds_cents)}
            ${tonightPaymentTable('Paid via', data.payment_method_breakdown || [], 'method', (data.payment_method_breakdown || []).reduce((sum, p) => sum + p.amount_cents, 0))}
        ` : '<p class="muted">No payments recorded yet.</p>'}
    `;
}

// sessionId is optional - omit it for "whichever session counts as
// tonight" (Check-in/Rounds/History's landing view), or pass a specific
// session's id to show that session's own breakdown instead (History's
// per-session detail view, so a past night's Member/Non-Member/etc.
// numbers are just as easy to pull up as tonight's).
async function mountTonightSummary(containerEl, sessionId) {
    if (!containerEl) return;
    try {
        let id = sessionId;
        if (!id) {
            const latestRes = await fetch('/api/sessions/latest');
            if (!latestRes.ok) {
                containerEl.innerHTML = '<p class="muted">No sessions yet.</p>';
                return;
            }
            id = (await latestRes.json()).id;
        }
        const res = await fetch(`/api/sessions/${id}/payment-summary`);
        containerEl.innerHTML = tonightSummaryHtml(res.ok ? await res.json() : null);
    } catch (err) {
        containerEl.innerHTML = '<p class="muted">Could not load totals.</p>';
    }
}
