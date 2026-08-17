// Parses the club's membership Excel export (Rego #, Full Name, Gender,
// Mbshp Type, Status columns - no header on the gender column) into the same
// row shape lib/csvImport.js's planImport() expects from a CSV. Kept separate
// from csvImport.js because these source columns are specific to this export
// format, not a generic import schema.
const ExcelJS = require('exceljs');

const SKILL_FROM_TYPE = { 'Comp A': 'A', 'Comp B': 'B', 'Comp C': 'C' };

function splitFullName(fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return { first_name: parts[0] || '', last_name: '' };
    return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

async function parseGbcMembersXlsx(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('Workbook has no sheets');

    const rows = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
        const values = sheet.getRow(r).values; // 1-indexed; values[0] is unused
        const rego = values[1];
        const fullName = values[2];
        const gender = values[3];
        const mbshpType = values[4];
        const status = values[5];
        if (!fullName || !String(fullName).trim()) continue;

        const { first_name, last_name } = splitFullName(String(fullName));
        const noteParts = [];
        if (mbshpType) noteParts.push(`Membership type: ${mbshpType}`);
        if (status) noteParts.push(`Status: ${status}`);

        rows.push({
            first_name,
            last_name,
            email: '',
            phone: '',
            dob: '',
            skill_level: SKILL_FROM_TYPE[mbshpType] || '',
            gender: gender === 'M' || gender === 'F' ? gender : '',
            membership_number: rego != null ? String(rego) : '',
            notes: noteParts.join('; '),
        });
    }
    return rows;
}

module.exports = { parseGbcMembersXlsx, splitFullName };
