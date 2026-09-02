// Sends the end-of-night summary/test email via whichever provider the
// club has configured (club_settings.email_provider) - SMTP2Go and Mailgun
// are both plain HTTP APIs (no new dependency, just Node's built-in
// fetch); Gmail has no simple HTTP send API, so it goes over real SMTP via
// nodemailer (the one new, pure-JS, zero-transitive-dependency package
// this needed - see package.json).
//
// Every provider function takes { ..providerConfig, to, subject, htmlBody,
// textBody } and returns { succeeded, failed } on success, or throws with
// a message safe to show the user directly.
const nodemailer = require('nodemailer');

async function sendViaSmtp2go({ apiKey, senderEmail, senderName, to, subject, htmlBody, textBody }) {
    if (!apiKey) throw new Error('No SMTP2Go API key configured - add one on the Club Settings page.');
    if (!senderEmail) throw new Error('No sender email configured - add one on the Club Settings page.');

    const sender = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
    const res = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': apiKey },
        body: JSON.stringify({ sender, to, subject, html_body: htmlBody, text_body: textBody }),
    });
    // SMTP2Go's response is 200 OK even when some recipients failed -
    // data.succeeded/data.failed tells the real story, not just the HTTP
    // status. A structurally failed request (bad key, bad payload) comes
    // back as a non-2xx with a data.error message instead.
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(body?.data?.error || body?.error || `SMTP2Go request failed (${res.status})`);
    }
    if (!body?.data || body.data.succeeded === 0) {
        throw new Error(body?.data?.failures?.[0]?.error || 'SMTP2Go accepted the request but sent to nobody - check the recipient addresses.');
    }
    return { succeeded: body.data.succeeded, failed: body.data.failed };
}

async function sendViaMailgun({ apiKey, domain, senderEmail, senderName, to, subject, htmlBody, textBody }) {
    if (!apiKey) throw new Error('No Mailgun API key configured - add one on the Club Settings page.');
    if (!domain) throw new Error('No Mailgun sending domain configured - add one on the Club Settings page.');
    if (!senderEmail) throw new Error('No sender email configured - add one on the Club Settings page.');

    const sender = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
    const form = new URLSearchParams();
    form.set('from', sender);
    form.set('to', to.join(','));
    form.set('subject', subject);
    if (htmlBody) form.set('html', htmlBody);
    if (textBody) form.set('text', textBody);

    const res = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        },
        body: form,
    });
    if (!res.ok) {
        // A bad API key (401) comes back as plain text ("Forbidden"), not
        // JSON - fall back to the raw text so the error still says something.
        const text = await res.text().catch(() => '');
        let message;
        try { message = JSON.parse(text)?.message; } catch { /* not JSON */ }
        throw new Error(message || text || `Mailgun request failed (${res.status})`);
    }
    return { succeeded: to.length, failed: 0 };
}

async function sendViaGmail({ user, appPassword, to, subject, htmlBody, textBody }) {
    if (!user) throw new Error('No Gmail address configured - add one on the Club Settings page.');
    if (!appPassword) throw new Error('No Gmail app password configured - add one on the Club Settings page (Google Account > Security > App Passwords, needs 2-Step Verification turned on first).');

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass: appPassword },
    });
    let info;
    try {
        // Gmail sends as the authenticated account itself - it ignores/
        // rejects an arbitrary "from" address, so there's no separate
        // sender-name field to set here (unlike SMTP2Go/Mailgun).
        info = await transporter.sendMail({ from: user, to: to.join(','), subject, html: htmlBody, text: textBody });
    } catch (err) {
        throw new Error(err.message || 'Gmail send failed.');
    }
    if (!info.accepted || info.accepted.length === 0) {
        throw new Error('Gmail accepted the connection but sent to nobody - check the recipient addresses.');
    }
    return { succeeded: info.accepted.length, failed: (info.rejected || []).length };
}

// Extracts and normalizes whichever provider's fields are relevant from a
// club_settings row - keeps the routes that call sendEmail() from needing
// to know each provider's own column names.
function clubEmailConfig(club) {
    const provider = club?.email_provider || 'smtp2go';
    if (provider === 'mailgun') {
        return { provider, apiKey: club.mailgun_api_key, domain: club.mailgun_domain, senderEmail: club.mailgun_sender_email, senderName: club.mailgun_sender_name };
    }
    if (provider === 'gmail') {
        return { provider, user: club.gmail_user, appPassword: club.gmail_app_password };
    }
    return { provider: 'smtp2go', apiKey: club.smtp2go_api_key, senderEmail: club.smtp2go_sender_email, senderName: club.smtp2go_sender_name };
}

async function sendEmail(club, { to, subject, htmlBody, textBody }) {
    if (!to || to.length === 0) throw new Error('No recipient email addresses.');
    const config = clubEmailConfig(club);
    const message = { to, subject, htmlBody, textBody };
    if (config.provider === 'mailgun') return sendViaMailgun({ ...config, ...message });
    if (config.provider === 'gmail') return sendViaGmail({ ...config, ...message });
    return sendViaSmtp2go({ ...config, ...message });
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
