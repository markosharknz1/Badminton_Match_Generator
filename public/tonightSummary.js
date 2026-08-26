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

// One row per category (Member, Non-Member, Member Concession, ...) with
// its payment-method split inline in the same row ("2 Cash, 1 Card"), one
// totals row at the end - not a separate table per dimension, which just
// repeated the same counts/amounts twice for no extra information.
function tonightSummaryHtml(data) {
    if (!data) return '<p class="muted">No sessions yet.</p>';
    const categories = data.payment_breakdown;
    const headline = `
        <div class="tonight-headline">
            <strong>${data.unique_players}</strong> player${data.unique_players === 1 ? '' : 's'}
            <span class="muted"> - ${tonightSummaryEsc(data.session.label || 'Session')} (${tonightSummaryEsc(data.session.date)})</span>
        </div>
    `;
    if (!categories.length) return `${headline}<p class="muted">No payments recorded yet.</p>`;

    const totalCount = categories.reduce((sum, c) => sum + c.count, 0);
    const rows = categories.map((c) => {
        const methods = (c.methods || []).map((m) => `${m.count} ${tonightSummaryEsc(m.method)}`).join(', ') || '<span class="muted">-</span>';
        return `<tr><td>${tonightSummaryEsc(c.category)}</td><td>${methods}</td><td class="num">${c.count}</td><td class="num">$${(c.amount_cents / 100).toFixed(2)}</td></tr>`;
    }).join('');

    return `
        ${headline}
        <table class="history-table tonight-payment-table">
            <thead><tr><th>Member type</th><th>Paid via</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="tonight-total-row"><td colspan="2">Total</td><td class="num">${totalCount}</td><td class="num">$${(data.total_funds_cents / 100).toFixed(2)}</td></tr></tfoot>
        </table>
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
