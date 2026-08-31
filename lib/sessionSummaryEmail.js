// Builds the end-of-night summary email's subject/body from the exact same
// data GET /api/sessions/:id/payment-summary already computes
// (lib/sessionReport.js's paymentBreakdown/uniquePlayerCount) - mostly
// wiring, no new report logic, so the emailed figures can never drift from
// what the finish-session alert and Tonight's totals already show.
const { paymentBreakdown, uniquePlayerCount } = require('./sessionReport');

function dollars(cents) {
    const d = (cents ?? 0) / 100;
    return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// session: {id, label, date, notes}
function buildSessionSummaryEmail(db, session) {
    const summary = paymentBreakdown(db, session.id);
    const uniquePlayers = uniquePlayerCount(db, session.id);
    const title = `${session.label || 'Session'} - ${session.date}`;

    const rows = summary.payment_breakdown.length
        ? summary.payment_breakdown.map((c) => `<tr><td>${esc(c.category)}</td><td style="text-align:right;">${c.count}</td><td style="text-align:right;">${dollars(c.amount_cents)}</td></tr>`).join('')
        : '<tr><td colspan="3">No payments recorded.</td></tr>';
    const textRows = summary.payment_breakdown.length
        ? summary.payment_breakdown.map((c) => `${c.category}: ${c.count} - ${dollars(c.amount_cents)}`).join('\n')
        : 'No payments recorded.';

    const notesHtml = session.notes
        ? `<p><strong>Notes:</strong><br>${esc(session.notes).replace(/\n/g, '<br>')}</p>`
        : '';
    const notesText = session.notes ? `\nNotes:\n${session.notes}\n` : '';

    const subject = `Game Scheduler summary - ${title}`;
    const htmlBody = `
        <h2>${esc(title)}</h2>
        <p>${uniquePlayers} player${uniquePlayers === 1 ? '' : 's'} checked in.</p>
        <table cellpadding="6" style="border-collapse:collapse;">
            <thead><tr><th style="text-align:left;">Category</th><th style="text-align:right;">Count</th><th style="text-align:right;">Total</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p><strong>Total funds: ${dollars(summary.total_funds_cents)}</strong></p>
        ${notesHtml}
    `;
    const textBody = `${title}\n\n${uniquePlayers} player${uniquePlayers === 1 ? '' : 's'} checked in.\n\n${textRows}\n\nTotal funds: ${dollars(summary.total_funds_cents)}\n${notesText}`;

    return { subject, htmlBody, textBody };
}

module.exports = { buildSessionSummaryEmail };
