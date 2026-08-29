// Shared across every page (same idiom as branding.js/events.js): renders a
// plain 'YYYY-MM-DD' date string in whichever format the club picked in
// Settings (DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD). Purely a display
// concern - every date is still stored and sent over the API as
// 'YYYY-MM-DD' regardless of this setting, so nothing else needs to change
// to read it. Call setDateFormat(club.date_format) once per page (same
// club-settings fetch every page already does for applyBranding), then use
// formatDate(dateStr) wherever a date renders as text.
//
// Native <input type="date"> pickers are a browser/OS-level thing this
// can't touch - their displayed format follows the browser's own locale,
// not this setting, and their value is always 'YYYY-MM-DD' either way.
let clubDateFormat = 'YMD';

function setDateFormat(format) {
    if (format === 'DMY' || format === 'MDY' || format === 'YMD') clubDateFormat = format;
}

function formatDate(isoDateStr) {
    if (!isoDateStr) return '';
    const parts = isoDateStr.split('-');
    if (parts.length !== 3) return isoDateStr; // not a plain YYYY-MM-DD string - leave it alone
    const [y, m, d] = parts;
    if (clubDateFormat === 'DMY') return `${d}/${m}/${y}`;
    if (clubDateFormat === 'MDY') return `${m}/${d}/${y}`;
    return `${y}-${m}-${d}`;
}
