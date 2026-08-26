const express = require('express');
const ExcelJS = require('exceljs');
const store = require('../db/store');
const { sessionReportRows } = require('../lib/sessionReport');

const router = express.Router();

// JSON preview of the same rows the .xlsx contains - lets the UI show a table
// before the user commits to downloading, and keeps the export logic testable
// without parsing a binary file.
router.get('/report', (req, res) => {
    const { from, to } = req.query;
    const rows = sessionReportRows(store.getDb(), from, to);
    res.json({ from: from || null, to: to || null, rows });
});

// Real .xlsx (not a renamed CSV) via exceljs - one row per session so the
// club can pivot/chart headcount over time in Excel directly.
router.get('/report.xlsx', async (req, res) => {
    const { from, to } = req.query;
    const rows = sessionReportRows(store.getDb(), from, to);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Game Scheduler';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Session trend');

    // Payment categories are club-configurable and can differ session to
    // session (ad-hoc Cash/Card/Voucher/Other vs a template's Member/
    // Non-Member/Concession tiers) - a fixed column set can't be assumed, so
    // it's built from whatever categories actually appear across the rows
    // being exported, with each row zero-filled for categories it didn't use.
    const paymentCategories = [...new Set(rows.flatMap((r) => r.payment_breakdown.map((p) => p.category)))].sort();

    sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Session', key: 'label', width: 20 },
        { header: 'Mode', key: 'mode', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Unique players', key: 'unique_players', width: 16 },
        { header: 'Peak concurrent', key: 'peak_concurrent', width: 16 },
        { header: 'Rounds played', key: 'rounds_played', width: 15 },
        { header: 'Active members', key: 'active_members', width: 16 },
        { header: 'Lapsed members', key: 'lapsed_members', width: 16 },
        { header: 'Guests', key: 'guests', width: 12 },
        { header: 'Players played', key: 'players_played', width: 15 },
        { header: 'Grade A', key: 'grade_a', width: 10 },
        { header: 'Grade B', key: 'grade_b', width: 10 },
        { header: 'Grade C', key: 'grade_c', width: 10 },
        { header: 'Grade D', key: 'grade_d', width: 10 },
        { header: 'Grade E', key: 'grade_e', width: 10 },
        { header: 'Male', key: 'male', width: 10 },
        { header: 'Female', key: 'female', width: 10 },
        { header: 'Gender unknown', key: 'gender_unknown', width: 16 },
        { header: 'Junior (18 & under)', key: 'junior', width: 18 },
        { header: 'Senior (19 & over)', key: 'senior', width: 18 },
        { header: 'Age unknown', key: 'age_unknown', width: 14 },
        ...paymentCategories.flatMap((cat) => [
            { header: `${cat} (count)`, key: `pay_${cat}_count`, width: 16 },
            { header: `${cat} ($)`, key: `pay_${cat}_amount`, width: 12 },
        ]),
        { header: 'Total funds ($)', key: 'total_funds', width: 16 },
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rows) {
        const byCategory = new Map(r.payment_breakdown.map((p) => [p.category, p]));
        const paymentCells = {};
        for (const cat of paymentCategories) {
            const p = byCategory.get(cat);
            paymentCells[`pay_${cat}_count`] = p ? p.count : 0;
            paymentCells[`pay_${cat}_amount`] = p ? p.amount_cents / 100 : 0;
        }
        sheet.addRow({
            ...r,
            grade_a: r.grade_counts.A,
            grade_b: r.grade_counts.B,
            grade_c: r.grade_counts.C,
            grade_d: r.grade_counts.D,
            grade_e: r.grade_counts.E,
            male: r.gender_counts.M,
            female: r.gender_counts.F,
            gender_unknown: r.gender_counts.unknown,
            junior: r.age_counts.junior,
            senior: r.age_counts.senior,
            age_unknown: r.age_counts.unknown,
            ...paymentCells,
            total_funds: r.total_funds_cents / 100,
        });
    }

    // Numeric columns right-aligned for readability.
    sheet.columns.forEach((col, i) => {
        if (i >= 4) col.alignment = { horizontal: 'right' };
    });
    ['total_funds', ...paymentCategories.map((cat) => `pay_${cat}_amount`)].forEach((key) => {
        sheet.getColumn(key).numFmt = '$#,##0.00';
    });

    const rangeLabel = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `session-trend_${rangeLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
});

module.exports = router;
