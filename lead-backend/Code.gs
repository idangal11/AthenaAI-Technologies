/**
 * AthenaAI lead backend (Google Apps Script, bound to a Google Sheet).
 *
 * Every form submission is (1) saved as a row in the "לידים" sheet and
 * (2) emailed to the business owner from the owner's own Google account.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment >
 * Web app > Execute as: Me > Who has access: Anyone. Use the /exec URL in the site.
 */

// Leave empty to notify the account that owns this script. Set to send elsewhere.
var NOTIFY_EMAIL = '';
var BUSINESS_NAME = 'AthenaAI Technologies';
var SHEET_NAME = 'לידים';
var HEADERS = ['תאריך', 'שם', 'שם העסק', 'טלפון', 'דוא״ל', 'מתעניין/ת ב', 'עמוד'];

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p._honey) return json({ ok: true }); // bot trap: pretend success, save nothing

    var lead = {
      name: clean(p.name, 80),
      business: clean(p.business, 120),
      phone: clean(p.phone, 30),
      email: clean(p.email, 120),
      pkg: clean(p.package, 80),
      page: clean(p.page, 200)
    };
    if (!lead.name || (!lead.phone && !lead.email)) return json({ ok: false, error: 'missing' });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet();
      sheet.appendRow([new Date(), cell(lead.name), cell(lead.business), cell(lead.phone), cell(lead.email), cell(lead.pkg), cell(lead.page)]);
    } finally {
      lock.releaseLock();
    }

    // The row is already saved, so a mail failure never loses the lead.
    try { notify(lead); } catch (mailErr) { console.error('mail failed: ' + mailErr); }
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json({ ok: true, service: 'lead-backend' });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setRightToLeft(true);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function notify(lead) {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  var rows = [
    ['שם', lead.name],
    ['שם העסק', lead.business],
    ['טלפון', lead.phone],
    ['דוא״ל', lead.email],
    ['מתעניין/ת ב', lead.pkg]
  ].filter(function (r) { return r[1]; });

  var htmlRows = rows.map(function (r) {
    return '<tr><td style="padding:10px 14px;border-bottom:1px solid #e6e8f0;color:#5a6384;white-space:nowrap">' + esc(r[0]) +
      '</td><td style="padding:10px 14px;border-bottom:1px solid #e6e8f0;font-weight:bold;color:#0e1430">' + esc(r[1]) + '</td></tr>';
  }).join('');

  var html =
    '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#0e1430;max-width:520px">' +
    '<p style="margin:0 0 14px;font-size:18px;font-weight:bold">פנייה חדשה מדף הנחיתה</p>' +
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e6e8f0;border-radius:8px">' + htmlRows + '</table>' +
    '<p style="margin:14px 0 0;font-size:13px;color:#5a6384">הפנייה נשמרה גם בגיליון הלידים.</p>' +
    '</div>';

  var text = 'פנייה חדשה מדף הנחיתה\n\n' + rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');

  var mail = { to: to, subject: 'פנייה חדשה: ' + lead.name, body: text, htmlBody: html, name: BUSINESS_NAME };
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(lead.email)) mail.replyTo = lead.email;
  MailApp.sendEmail(mail);
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// Stops a value from being run as a spreadsheet formula.
function cell(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
