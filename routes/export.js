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
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rows) sheet.addRow(r);

    // Numeric columns right-aligned for readability.
    ['E', 'F', 'G', 'H', 'I', 'J'].forEach((col) => {
        sheet.getColumn(col).alignment = { horizontal: 'right' };
    });

    const rangeLabel = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `session-trend_${rangeLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
});

module.exports = router;
