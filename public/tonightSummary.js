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

function tonightSummaryHtml(data) {
    if (!data) return '<p class="muted">No sessions yet.</p>';
    const rows = data.payment_breakdown.map((p) => `
        <tr><td>${tonightSummaryEsc(p.category)}</td><td class="num">${p.count}</td><td class="num">$${(p.amount_cents / 100).toFixed(2)}</td></tr>
    `).join('');
    const totalCount = data.payment_breakdown.reduce((sum, p) => sum + p.count, 0);
    return `
        <div class="tonight-headline">
            <strong>${data.unique_players}</strong> player${data.unique_players === 1 ? '' : 's'}
            <span class="muted"> - ${tonightSummaryEsc(data.session.label || 'Session')} (${tonightSummaryEsc(data.session.date)})</span>
        </div>
        ${data.payment_breakdown.length ? `
            <table class="history-table tonight-payment-table">
                <thead><tr><th>Payment</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr class="tonight-total-row"><td>Total</td><td class="num">${totalCount}</td><td class="num">$${(data.total_funds_cents / 100).toFixed(2)}</td></tr></tfoot>
            </table>
        ` : '<p class="muted">No payments recorded yet.</p>'}
    `;
}

async function mountTonightSummary(containerEl) {
    if (!containerEl) return;
    try {
        const latestRes = await fetch('/api/sessions/latest');
        if (!latestRes.ok) {
            containerEl.innerHTML = '<p class="muted">No sessions yet.</p>';
            return;
        }
        const latest = await latestRes.json();
        const res = await fetch(`/api/sessions/${latest.id}/payment-summary`);
        containerEl.innerHTML = tonightSummaryHtml(res.ok ? await res.json() : null);
    } catch (err) {
        containerEl.innerHTML = '<p class="muted">Could not load tonight\'s totals.</p>';
    }
}
