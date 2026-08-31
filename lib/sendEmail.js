// Thin wrapper around SMTP2Go's HTTP API (https://api.smtp2go.com/v3/email/send) -
// an HTTP API email service, not raw SMTP, so no client library/new npm
// dependency is needed: Node's built-in fetch is sufficient. Deliberately
// decoupled from session/report logic (see lib/sessionSummaryEmail.js) so
// it's independently usable for both a real summary send and the Settings
// "Send test email" button.
//
// SMTP2Go's response is 200 OK even when it accepted the request but some
// recipients failed - data.succeeded/data.failed tells the real story, not
// just the HTTP status. A structurally failed request (bad api key, bad
// payload) can come back as a non-2xx with a data.error message instead.
async function sendEmail({ apiKey, senderEmail, senderName, to, subject, htmlBody, textBody }) {
    if (!apiKey) throw new Error('No SMTP2Go API key configured - add one on the Club Settings page.');
    if (!senderEmail) throw new Error('No sender email configured - add one on the Club Settings page.');
    if (!to || to.length === 0) throw new Error('No recipient email addresses.');

    const sender = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
    const res = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': apiKey },
        body: JSON.stringify({ sender, to, subject, html_body: htmlBody, text_body: textBody }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(body?.data?.error || body?.error || `SMTP2Go request failed (${res.status})`);
    }
    if (!body?.data || body.data.succeeded === 0) {
        const failureDetail = body?.data?.failures?.[0]?.error;
        throw new Error(failureDetail || 'SMTP2Go accepted the request but sent to nobody - check the recipient addresses.');
    }
    return { succeeded: body.data.succeeded, failed: body.data.failed, email_id: body.data.email_id };
}

// "a@b.com, c@d.com\nreef@club.org" -> ["a@b.com","c@d.com","reef@club.org"] -
// comma or newline separated, matching how the Settings textarea is filled in.
function parseRecipientList(raw) {
    return (raw || '')
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

module.exports = { sendEmail, parseRecipientList };
