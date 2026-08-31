const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');
const { sendEmail, parseRecipientList } = require('../lib/sendEmail');

const router = express.Router();

const DATE_FORMATS = ['DMY', 'MDY', 'YMD'];

router.get('/', (req, res) => {
    res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
});

router.put('/', (req, res) => {
    const existing = store.queryOne('SELECT * FROM club_settings WHERE id = 1');
    const merged = { ...existing, ...req.body };
    if (!DATE_FORMATS.includes(merged.date_format)) {
        return res.status(400).json({ error: `date_format must be one of ${DATE_FORMATS.join(', ')}` });
    }
    try {
        store.run(
            `UPDATE club_settings SET club_name=?, default_game_minutes=?, default_break_minutes=?, max_capacity=?, square_enabled=?,
             smtp2go_api_key=?, smtp2go_sender_email=?, smtp2go_sender_name=?, summary_recipient_emails=?, square_access_token=?, square_location_id=?,
             gender_aware_pairing=?, date_format=?, updated_at=datetime('now')
             WHERE id=1`,
            [merged.club_name, merged.default_game_minutes, merged.default_break_minutes, merged.max_capacity,
                merged.square_enabled ? 1 : 0,
                merged.smtp2go_api_key || null, merged.smtp2go_sender_email || null, merged.smtp2go_sender_name || null, merged.summary_recipient_emails || null,
                merged.square_access_token || null, merged.square_location_id || null,
                merged.gender_aware_pairing ? 1 : 0, merged.date_format]
        );
        store.persist();
        broadcast('club_settings', {});
        res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Catches a bad API key or misconfigured sender/recipients in Settings,
// before relying on it for a real end-of-night send.
router.post('/send-test-email', async (req, res) => {
    const club = store.queryOne('SELECT * FROM club_settings WHERE id = 1');
    const to = parseRecipientList(club?.summary_recipient_emails);
    if (to.length === 0) return res.status(400).json({ error: 'No recipient email addresses configured yet - add some above first.' });
    try {
        const result = await sendEmail({
            apiKey: club.smtp2go_api_key,
            senderEmail: club.smtp2go_sender_email,
            senderName: club.smtp2go_sender_name,
            to,
            subject: `${club.club_name || 'Game Scheduler'} - test email`,
            htmlBody: '<p>This is a test email from Game Scheduler\'s Club Settings page. If you got this, your email setup is working.</p>',
            textBody: "This is a test email from Game Scheduler's Club Settings page. If you got this, your email setup is working.",
        });
        res.json({ sent_to: to, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
