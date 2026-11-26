/* Documents & Renewals PWA — every paper with a date on it, and
 * when it comes due. Registration, insurance, licenses, warranties,
 * titles, and anything else with a date on it.
 *
 * No build step, no dependencies, no account, no server. Documents
 * live in this device's localStorage and move as one plain JSON file.
 *
 * Bikes live in the SHARED Pocket Garage roster (the "pocket-garage-
 * bikes" key, via the vendored bike-profile.js — the same b1/b2/b3
 * roster the other apps use). This app never invents a second bike
 * model: a document points at a roster key, or at "" for a general
 * document that belongs to no bike in particular (the Challenger,
 * household papers — the rider names the vehicle in the document
 * title or notes; this app holds no vehicle roster of its own).
 * Add a bike here and it is added to the shared roster; there is no
 * delete-bike here in v1 — roster management belongs to the landing
 * dashboard (Phase 2), so a bike you mistype is removed there, not
 * here.
 *
 * User-entered figures only, stated plainly wherever a number
 * appears: every date and renewal cost is one the rider typed in.
 * Nothing is invented, and no renewal cost or date is ever
 * suggested. A document with no cost entered carries no cost in the
 * totals — the summary says how many are unpriced instead of
 * guessing. A document with no expiry date (a title, a bill of
 * sale) is kept on file with status "No expiry" — the app never
 * invents a renewal date for paper that has none.
 *
 * The status rule (printed on the Documents tab, in the text export,
 * and here): a document is OVERDUE when its expiry date is before
 * today; DUE SOON when it falls within the next 30 days (the same
 * 30-day due-soon window the bike log uses — SOON_DAYS there); and
 * CURRENT when it is further out. Days are counted in whole days,
 * from today's date, ignoring time of day.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
var STORAGE_KEY = 'documents-renewals-v1';
var VERSION = 1;

/* Due-soon window, days — the same 30 days the bike log uses for its
 * due-soon window (SOON_DAYS in bike-maintenance-log-pwa/app.js). */
var SOON_DAYS = 30;

/* The only document types the app knows. These are the app's own
 * filing labels, not facts about a document — a document's type is
 * picked by the rider from this list. */
var TYPES = ['Registration', 'Insurance', 'License', 'Warranty', 'Title', 'Other'];

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                  */
/* ------------------------------------------------------------------ */
function round2(x) { return Math.round(x * 100) / 100; }

function isDateISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function todayISO() {
  var d = new Date();
  var m = '' + (d.getMonth() + 1);
  var day = '' + d.getDate();
  return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}

/* Whole days from a to b (b - a), ignoring time of day. Negative when
 * b is before a. */
function daysBetween(a, b) {
  var da = new Date(a + 'T00:00:00Z').getTime();
  var db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

/* ISO date n days from the given ISO date (n may be negative). */
function addDaysISO(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(x) {
  if (x === null || x === undefined) return '—';
  return '$' + (Math.round(x * 100) / 100).toFixed(2);
}

function slugify(name) {
  var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'bike';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */
/* Status of one document against a "today" (defaults to the real
 * today; tests pass a fixed date so results never drift).
 * Returns { status, days } where days is whole days until expiry —
 * negative when overdue, null when the document has no expiry date.
 *   no expiry date        -> 'no-expiry'
 *   expiry before today   -> 'overdue'
 *   expiry within 30 days -> 'due-soon'  (today counts: 0 days left)
 *   expiry further out    -> 'current'                                   */
function docStatus(doc, today) {
  today = today || todayISO();
  if (!doc.expiry_date) return { status: 'no-expiry', days: null };
  var days = daysBetween(today, doc.expiry_date);
  if (days < 0) return { status: 'overdue', days: days };
  if (days <= SOON_DAYS) return { status: 'due-soon', days: days };
  return { status: 'current', days: days };
}

function statusText(doc, today) {
  var st = docStatus(doc, today);
  if (st.status === 'no-expiry') return 'No expiry — kept on file';
  if (st.status === 'overdue') return 'Overdue by ' + (-st.days) + (st.days === -1 ? ' day' : ' days');
  if (st.status === 'due-soon') return st.days === 0 ? 'Due today' : 'Due in ' + st.days + (st.days === 1 ? ' day' : ' days');
  return 'Current — due in ' + st.days + (st.days === 1 ? ' day' : ' days');
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
function emptyStore() {
  return { version: VERSION, documents: [] };
}

/* A document, validated. Throws with a plain message on bad input.
 * name is required (a document with no name is unfindable). type is
 * one of the six labels, defaulting to 'Other' when not given or
 * unknown. bike_key is '' for a general document, or a roster key.
 * expiry_date is optional: blank means the paper has no expiry (a
 * title, a bill of sale) and the status is 'no-expiry' — the app
 * never invents a renewal date. renewal_cost is optional: blank
 * means unknown (null), and the document carries no cost in the
 * totals; $0 is a real price (a free renewal). notes are free text,
 * trimmed. */
function validateDocFields(p) {
  if (!p || typeof p !== 'object') throw new Error('document must be an object');
  var name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) throw new Error('document needs a name');
  if (typeof p.bike_key !== 'string') throw new Error('document needs a bike (or none)');
  var type = typeof p.type === 'string' ? p.type.trim() : 'Other';
  if (TYPES.indexOf(type) < 0) type = 'Other';
  var expiry = null;
  if (p.expiry_date !== '' && p.expiry_date !== null && p.expiry_date !== undefined) {
    if (!isDateISO(p.expiry_date)) throw new Error('expiry date must be a real date (YYYY-MM-DD) or left blank');
    expiry = p.expiry_date;
  }
  var cost = null;
  if (p.renewal_cost !== '' && p.renewal_cost !== null && p.renewal_cost !== undefined) {
    cost = Number(p.renewal_cost);
    if (isNaN(cost) || cost < 0) throw new Error('renewal cost must be $0 or more, or left blank');
    cost = round2(cost);
  }
  return {
    bike_key: p.bike_key,
    name: name,
    type: type,
    expiry_date: expiry,
    renewal_cost: cost,
    notes: typeof p.notes === 'string' ? p.notes.trim() : ''
  };
}

/* Ids mint as d1, d2, ... — highest suffix in use + 1, the same rule
 * as the bike log. Delete the highest and the next mint reuses it;
 * delete the lowest and the next mint is highest + 1. */
function nextDocId(store) {
  var max = 0;
  store.documents.forEach(function (d) {
    var m = /^d(\d+)$/.exec(d.id || '');
    if (m && +m[1] > max) max = +m[1];
  });
  return 'd' + (max + 1);
}

function addDoc(store, fields) {
  var doc = validateDocFields(fields);
  doc.id = nextDocId(store);
  store.documents.push(doc);
  return doc;
}

function updateDoc(store, id, fields) {
  var cur = getDoc(store, id);
  if (!cur) return null;
  var merged = validateDocFields({
    bike_key: fields.bike_key !== undefined ? fields.bike_key : cur.bike_key,
    name: fields.name !== undefined ? fields.name : cur.name,
    type: fields.type !== undefined ? fields.type : cur.type,
    expiry_date: fields.expiry_date !== undefined ? fields.expiry_date : cur.expiry_date,
    renewal_cost: fields.renewal_cost !== undefined ? fields.renewal_cost : cur.renewal_cost,
    notes: fields.notes !== undefined ? fields.notes : cur.notes
  });
  merged.id = id;
  var i = store.documents.indexOf(cur);
  store.documents[i] = merged;
  return merged;
}

function deleteDoc(store, id) {
  var i = -1;
  store.documents.forEach(function (d, n) { if (d.id === id) i = n; });
  if (i < 0) return false;
  store.documents.splice(i, 1);
  return true;
}

function getDoc(store, id) {
  for (var i = 0; i < store.documents.length; i++) {
    if (store.documents[i].id === id) return store.documents[i];
  }
  return null;
}

/* Same bike + name + type, matched case-insensitively, is the
 * duplicate test. The sample loader uses this so tapping "Load
 * example data" twice never doubles the file. */
function hasDoc(store, bikeKey, name, type) {
  var n = String(name || '').trim().toLowerCase();
  var t = String(type || '').trim().toLowerCase();
  return store.documents.some(function (d) {
    return d.bike_key === bikeKey &&
      String(d.name).toLowerCase() === n &&
      String(d.type).toLowerCase() === t;
  });
}

/* ------------------------------------------------------------------ */
/* Search / filter / sort                                              */
/* ------------------------------------------------------------------ */
/* filters: { query, type, bike, status } — all optional.
 * query matches name or notes, case-insensitive substring. type is
 * exact (case-insensitive). bike is a roster key, '' for general-
 * only, or 'all'. status is one of 'overdue' / 'due-soon' /
 * 'current' / 'no-expiry' / 'all'.
 * Results sort worst first: overdue (most overdue first), then
 * due-soon (soonest first), then current (soonest first), then
 * no-expiry (name-sorted). Within a status, by expiry date, then
 * name. */
function filterDocs(store, filters, today) {
  filters = filters || {};
  today = today || todayISO();
  var q = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : '';
  var type = typeof filters.type === 'string' ? filters.type.trim().toLowerCase() : '';
  var bike = filters.bike === undefined ? 'all' : filters.bike;
  var status = filters.status === undefined ? 'all' : filters.status;
  var order = { 'overdue': 0, 'due-soon': 1, 'current': 2, 'no-expiry': 3 };
  return store.documents.filter(function (d) {
    if (q && String(d.name).toLowerCase().indexOf(q) < 0 &&
        String(d.notes || '').toLowerCase().indexOf(q) < 0) return false;
    if (type && type !== 'all' && String(d.type).toLowerCase() !== type) return false;
    if (bike !== 'all') {
      if (bike === '') { if (d.bike_key !== '') return false; }
      else if (d.bike_key !== bike) return false;
    }
    if (status && status !== 'all' && docStatus(d, today).status !== status) return false;
    return true;
  }).sort(function (a, b) {
    var sa = docStatus(a, today), sb = docStatus(b, today);
    if (order[sa.status] !== order[sb.status]) return order[sa.status] - order[sb.status];
    if (sa.days === null && sb.days === null) return String(a.name).localeCompare(String(b.name));
    if (sa.days === null) return 1;
    if (sb.days === null) return -1;
    if (sa.days !== sb.days) return sa.days - sb.days;
    return String(a.name).localeCompare(String(b.name));
  });
}

function typesInUse(store) {
  var seen = {};
  store.documents.forEach(function (d) { if (d.type) seen[d.type] = true; });
  return TYPES.filter(function (t) { return seen[t]; });
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */
/* Stats for one bike (or '' for general documents): counts by status,
 * how many carry a renewal cost, the total renewal cost of the
 * priced ones, and the next renewal — the soonest document with an
 * expiry date on or after today, or null when there is none. */
function docStats(store, bikeKey, today) {
  today = today || todayISO();
  var docs = store.documents.filter(function (d) { return d.bike_key === bikeKey; });
  var st = { total: docs.length, overdue: 0, dueSoon: 0, current: 0, noExpiry: 0,
             priced: 0, unpriced: 0, totalCost: 0, nextRenewal: null };
  var nextDays = null;
  docs.forEach(function (d) {
    var s = docStatus(d, today);
    if (s.status === 'overdue') st.overdue++;
    else if (s.status === 'due-soon') st.dueSoon++;
    else if (s.status === 'current') st.current++;
    else st.noExpiry++;
    if (d.renewal_cost === null || d.renewal_cost === undefined) st.unpriced++;
    else { st.priced++; st.totalCost = round2(st.totalCost + d.renewal_cost); }
    if (s.days !== null && s.days >= 0 && (nextDays === null || s.days < nextDays)) {
      nextDays = s.days;
      st.nextRenewal = d;
    }
  });
  return st;
}

function allDocStats(store, today) {
  today = today || todayISO();
  var st = { total: store.documents.length, overdue: 0, dueSoon: 0, current: 0, noExpiry: 0,
             priced: 0, unpriced: 0, totalCost: 0, nextRenewal: null };
  var nextDays = null;
  store.documents.forEach(function (d) {
    var s = docStatus(d, today);
    if (s.status === 'overdue') st.overdue++;
    else if (s.status === 'due-soon') st.dueSoon++;
    else if (s.status === 'current') st.current++;
    else st.noExpiry++;
    if (d.renewal_cost === null || d.renewal_cost === undefined) st.unpriced++;
    else { st.priced++; st.totalCost = round2(st.totalCost + d.renewal_cost); }
    if (s.days !== null && s.days >= 0 && (nextDays === null || s.days < nextDays)) {
      nextDays = s.days;
      st.nextRenewal = d;
    }
  });
  return st;
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */
function validateImport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.documents))
    throw new Error('import needs a documents array');
  var store = emptyStore();
  data.documents.forEach(function (raw) {
    var doc = validateDocFields(raw);
    doc.id = nextDocId(store);
    store.documents.push(doc);
  });
  return store;
}

/* One bike's documents as JSON: stats + documents, worst first. */
function bikeDocsExport(store, bikeKey, today) {
  today = today || todayISO();
  var docs = filterDocs(store, { bike: bikeKey }, today);
  return {
    bike_key: bikeKey,
    exported: today,
    stats: docStats(store, bikeKey, today),
    documents: docs.map(function (d) {
      return { id: d.id, name: d.name, type: d.type, expiry_date: d.expiry_date,
               renewal_cost: d.renewal_cost, status: docStatus(d, today).status,
               status_text: statusText(d, today), notes: d.notes || '' };
    })
  };
}

/* One bike's documents as readable plain text. bikeKey 'all' covers
 * every bike plus general documents; nameFn, when given, resolves a
 * roster key to a bike name for the per-line label. */
function bikeDocsText(store, bikeKey, bikeName, today, nameFn) {
  today = today || todayISO();
  var ex = bikeKey === 'all'
    ? { stats: allDocStats(store, today),
        documents: filterDocs(store, {}, today).map(function (d) {
          return { id: d.id, bike_key: d.bike_key, name: d.name, type: d.type,
                   expiry_date: d.expiry_date, renewal_cost: d.renewal_cost,
                   status: docStatus(d, today).status,
                   status_text: statusText(d, today), notes: d.notes || '' };
        }) }
    : bikeDocsExport(store, bikeKey, today);
  var lines = [];
  lines.push('Documents & Renewals — ' + bikeName);
  lines.push('Exported ' + today + '. Every date and cost below was typed in by the rider — nothing invented.');
  lines.push('');
  var s = ex.stats;
  lines.push(s.total + ' document' + (s.total === 1 ? '' : 's') + ': ' +
    s.overdue + ' overdue, ' + s.dueSoon + ' due soon, ' + s.current + ' current, ' +
    s.noExpiry + ' no expiry. Renewal costs entered: ' + fmtMoney(s.totalCost) +
    ' across ' + s.priced + ' priced document' + (s.priced === 1 ? '' : 's') +
    ' (' + s.unpriced + ' unpriced).');
  if (s.nextRenewal) {
    lines.push('Next renewal: ' + s.nextRenewal.name + ' — ' + s.nextRenewal.expiry_date +
      ' (' + statusText(s.nextRenewal, today) + ').');
  }
  lines.push('');
  if (!ex.documents.length) lines.push('(No documents for this bike yet.)');
  ex.documents.forEach(function (d) {
    var who = '';
    if (bikeKey === 'all') {
      who = ' [' + (nameFn ? nameFn(d.bike_key) : (d.bike_key || 'General')) + ']';
    }
    lines.push('- ' + d.name + who + ' [' + d.type + '] — ' +
      (d.expiry_date || 'no expiry date') + ' — ' + d.status_text +
      ' — renewal cost ' + fmtMoney(d.renewal_cost) +
      (d.notes ? ' — ' + d.notes : ''));
  });
  lines.push('');
  lines.push('Status rule: overdue is past its date; due soon is within 30 days; current is further out; no expiry is paper that has no renewal date.');
  return lines.join('\n');
}

function exportFilename(bikeName, ext) {
  return 'documents-' + slugify(bikeName) + '.' + ext;
}

/* ------------------------------------------------------------------ */
/* Sample data                                                         */
/* ------------------------------------------------------------------ */
/* Example documents — dates are relative to today so the OVERDUE /
 * DUE SOON / CURRENT / NO EXPIRY statuses always show, whenever the
 * sample is loaded. The registration cost ($20.50) is the Arizona
 * motorcycle renewal figure from the Nov 21 registration research;
 * every other cost is an example price only. The Challenger entry is
 * an example record too — its real registration date and cost are
 * not in the app until the rider types them in. */
function sampleStore() {
  var t = todayISO();
  var s = emptyStore();
  var rows = [
    { bike_key: 'b1', name: '1995 Fat Boy — registration', type: 'Registration', expiry_date: addDaysISO(t, 18), renewal_cost: 20.50, notes: 'AZ motorcycle renewal — example cost' },
    { bike_key: 'b2', name: '1990 Softail — insurance', type: 'Insurance', expiry_date: addDaysISO(t, -9), renewal_cost: 132.00, notes: 'example premium only' },
    { bike_key: 'b3', name: '1947 Knucklehead — registration', type: 'Registration', expiry_date: addDaysISO(t, 120), renewal_cost: 20.50, notes: '' },
    { bike_key: 'b1', name: '1995 Fat Boy — battery warranty', type: 'Warranty', expiry_date: addDaysISO(t, 200), renewal_cost: null, notes: '' },
    { bike_key: 'b3', name: '1947 Knucklehead — title', type: 'Title', expiry_date: null, renewal_cost: null, notes: "title in Dad's name — example record" },
    { bike_key: '', name: 'Challenger — registration (BADNEW5)', type: 'Registration', expiry_date: addDaysISO(t, 45), renewal_cost: null, notes: 'example record — cost not entered' }
  ];
  rows.forEach(function (r) { addDoc(s, r); });
  return s;
}

/* ------------------------------------------------------------------ */
/* DOM layer — browser only. The pure logic above runs in Node tests. */
/* ------------------------------------------------------------------ */
if (typeof document !== 'undefined') {
  var BikeProfile = (typeof window !== 'undefined' && window.PG_BikeProfile) ? window.PG_BikeProfile : null;
  var SWUpdate = (typeof window !== 'undefined' && window.PG_SWUpdate) ? window.PG_SWUpdate : null;

  var storage = (function () {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.getItem('__docs_probe__'); return localStorage; }
    } catch (e) { /* private mode / blocked storage: memory only */ }
    var mem = {};
    return {
      getItem: function (k) { return mem.hasOwnProperty(k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  })();

  var profile = BikeProfile ? BikeProfile.create(storage) : null;
  var store = emptyStore();
  var editingId = null;

  function loadStore() {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw) store = validateImport(JSON.parse(raw));
    } catch (e) { store = emptyStore(); }
  }
  function saveStore() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* quota: keep the in-memory copy */ }
  }

  function el(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function bikeName(key) {
    if (!key) return 'General (no bike)';
    var b = profile ? profile.getBike(key) : null;
    return b ? b.name : key;
  }

  function bikeOptions(select, includeAll, includeGeneral) {
    var bikes = profile ? profile.listBikes() : [];
    var html = '';
    if (includeAll) html += '<option value="all">All bikes</option>';
    if (includeGeneral) html += '<option value="">General (no bike)</option>';
    bikes.forEach(function (b) {
      html += '<option value="' + escapeHtml(b.key) + '">' + escapeHtml(b.name) + '</option>';
    });
    select.innerHTML = html;
  }

  function statusBadge(doc) {
    var st = docStatus(doc);
    if (st.status === 'overdue') return '<span class="badge overdue">OVERDUE</span>';
    if (st.status === 'due-soon') return '<span class="badge soon">DUE SOON</span>';
    if (st.status === 'current') return '<span class="badge ok">CURRENT</span>';
    return '<span class="badge">NO EXPIRY</span>';
  }

  function renderDocs() {
    var filters = {
      query: el('docs-search').value,
      type: el('docs-type').value,
      bike: el('docs-bike').value,
      status: el('docs-status').value
    };
    var docs = filterDocs(store, filters);
    var list = el('docs-list');
    if (!docs.length) {
      list.innerHTML = '<p class="muted">No documents match — add one below, or load the example data from the Data tab to see how it looks.</p>';
      return;
    }
    var html = '';
    docs.forEach(function (d) {
      html += '<div class="card"><p><strong>' + escapeHtml(d.name) + '</strong> ' +
        '<span class="badge">' + escapeHtml(d.type) + '</span> ' + statusBadge(d) + '</p>' +
        '<p class="muted">' + escapeHtml(bikeName(d.bike_key)) + ' &middot; ' +
        (d.expiry_date ? escapeHtml(d.expiry_date) + ' &middot; ' + escapeHtml(statusText(d)) : 'No expiry date — kept on file') +
        ' &middot; renewal cost ' + fmtMoney(d.renewal_cost) + '</p>' +
        (d.notes ? '<p>' + escapeHtml(d.notes) + '</p>' : '') +
        '<button type="button" class="secondary" data-edit="' + d.id + '">Edit</button> ' +
        '<button type="button" class="danger" data-del="' + d.id + '">Delete</button></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var doc = getDoc(store, btn.getAttribute('data-del'));
        if (doc && confirm('Delete "' + doc.name + '"?')) {
          deleteDoc(store, doc.id);
          saveStore(); renderAll();
          toast('Deleted ' + doc.name);
        }
      });
    });
    list.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { startEdit(btn.getAttribute('data-edit')); });
    });
  }

  function renderSummary() {
    var key = el('summary-bike').value;
    var st = key === 'all' ? allDocStats(store) : docStats(store, key);
    var label = key === 'all' ? 'All bikes' : bikeName(key);
    var html = '<div class="card"><p><strong>' + escapeHtml(label) + '</strong></p>' +
      '<p>' + st.total + ' document' + (st.total === 1 ? '' : 's') + ': ' +
      st.overdue + ' overdue, ' + st.dueSoon + ' due soon, ' + st.current + ' current, ' +
      st.noExpiry + ' no expiry.</p>' +
      '<p>Renewal costs entered: <strong>' + fmtMoney(st.totalCost) + '</strong> across ' +
      st.priced + ' priced document' + (st.priced === 1 ? '' : 's') +
      ' (' + st.unpriced + ' unpriced — no cost entered, not guessed).</p>';
    if (st.nextRenewal) {
      html += '<p>Next renewal: <strong>' + escapeHtml(st.nextRenewal.name) + '</strong> — ' +
        escapeHtml(st.nextRenewal.expiry_date) + ' (' + escapeHtml(statusText(st.nextRenewal)) + ').</p>';
    } else {
      html += '<p class="muted">No upcoming renewal with a date.</p>';
    }
    html += '</div>';
    el('summary-cards').innerHTML = html;
  }

  function renderBikes() {
    var bikes = profile ? profile.listBikes() : [];
    var html = '<ul class="bike-list">';
    bikes.forEach(function (b) {
      var n = store.documents.filter(function (d) { return d.bike_key === b.key; }).length;
      html += '<li><strong>' + escapeHtml(b.name) + '</strong>' +
        (b.year ? ' (' + escapeHtml(String(b.year)) + ')' : '') +
        ' — ' + n + ' document' + (n === 1 ? '' : 's') + '</li>';
    });
    html += '</ul>';
    el('bikes-list').innerHTML = html;
  }

  function renderData() {
    var st = allDocStats(store);
    el('data-counts').textContent = st.total + ' documents on file: ' +
      st.overdue + ' overdue, ' + st.dueSoon + ' due soon, ' + st.current + ' current, ' +
      st.noExpiry + ' no expiry.';
  }

  function fillFilters() {
    bikeOptions(el('docs-bike'), true, true);
    bikeOptions(el('summary-bike'), true, false);
    bikeOptions(el('d-bike'), false, true);
    bikeOptions(el('export-bike'), true, true);
    var types = typesInUse(store);
    var opts = '<option value="all">All types</option>';
    TYPES.forEach(function (t) {
      if (types.indexOf(t) >= 0) opts += '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
    });
    el('docs-type').innerHTML = opts;
  }

  function renderAll() {
    fillFilters();
    renderDocs();
    renderSummary();
    renderBikes();
    renderData();
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    el('view-' + name).classList.add('active');
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    if (name === 'summary') renderSummary();
    if (name === 'data') renderData();
  }

  function resetForm() {
    editingId = null;
    el('doc-form').reset();
    el('form-heading').textContent = 'Add a document';
    el('doc-submit').textContent = 'Add document';
    el('doc-cancel').style.display = 'none';
  }

  function startEdit(id) {
    var d = getDoc(store, id);
    if (!d) return;
    editingId = id;
    el('d-name').value = d.name;
    el('d-type').value = d.type;
    el('d-bike').value = d.bike_key;
    el('d-expiry').value = d.expiry_date || '';
    el('d-cost').value = d.renewal_cost === null ? '' : d.renewal_cost;
    el('d-notes').value = d.notes || '';
    el('form-heading').textContent = 'Edit document';
    el('doc-submit').textContent = 'Save changes';
    el('doc-cancel').style.display = '';
    el('form-heading').scrollIntoView();
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function init() {
    loadStore();
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
    });
    ['docs-search', 'docs-type', 'docs-bike', 'docs-status'].forEach(function (id) {
      el(id).addEventListener('input', renderDocs);
      el(id).addEventListener('change', renderDocs);
    });
    el('summary-bike').addEventListener('change', renderSummary);

    el('doc-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fields = {
        bike_key: el('d-bike').value,
        name: el('d-name').value,
        type: el('d-type').value,
        expiry_date: el('d-expiry').value || null,
        renewal_cost: el('d-cost').value === '' ? null : Number(el('d-cost').value),
        notes: el('d-notes').value
      };
      try {
        if (editingId) {
          updateDoc(store, editingId, fields);
          toast('Saved ' + fields.name);
        } else {
          addDoc(store, fields);
          toast('Added ' + fields.name);
        }
      } catch (err) { alert(err.message); return; }
      saveStore();
      resetForm();
      renderAll();
    });
    el('doc-cancel').addEventListener('click', function () { resetForm(); });

    el('bike-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!profile) { alert('The shared bike roster is not available in this browser.'); return; }
      var year = el('bike-year').value.trim();
      var key = profile.addBike({
        name: el('bike-name').value.trim(),
        year: year === '' ? null : Number(year),
        model: el('bike-model').value.trim(),
        notes: el('bike-notes').value.trim()
      });
      saveStore();
      renderAll();
      el('bike-form').reset();
      toast('Added bike ' + key);
    });

    el('export-btn').addEventListener('click', function () {
      download('documents-renewals-backup.json', JSON.stringify(store, null, 2));
      toast('Backup downloaded');
    });
    el('copy-export-btn').addEventListener('click', function () {
      var txt = JSON.stringify(store, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('Backup copied'); });
      } else { alert('Clipboard is not available in this browser.'); }
    });
    el('export-json-btn').addEventListener('click', function () {
      var key = el('export-bike').value;
      var name = key === 'all' ? 'all-bikes' : bikeName(key);
      var data = key === 'all'
        ? { bike_key: 'all', exported: todayISO(), stats: allDocStats(store),
            documents: filterDocs(store, {}).map(function (d) {
              return { id: d.id, bike_key: d.bike_key, name: d.name, type: d.type,
                       expiry_date: d.expiry_date, renewal_cost: d.renewal_cost,
                       status: docStatus(d).status, status_text: statusText(d), notes: d.notes || '' };
            }) }
        : bikeDocsExport(store, key);
      download(exportFilename(name, 'json'), JSON.stringify(data, null, 2));
      toast('Exported ' + name);
    });
    el('export-text-btn').addEventListener('click', function () {
      var key = el('export-bike').value;
      var name = key === 'all' ? 'all-bikes' : bikeName(key);
      var text = key === 'all'
        ? bikeDocsText(store, 'all', 'All bikes', todayISO(), bikeName)
        : bikeDocsText(store, key, bikeName(key));
      download(exportFilename(name, 'txt'), text, 'text/plain');
      toast('Exported ' + name);
    });
    el('copy-text-btn').addEventListener('click', function () {
      var key = el('export-bike').value;
      var text = key === 'all'
        ? bikeDocsText(store, 'all', 'All bikes', todayISO(), bikeName)
        : bikeDocsText(store, key, bikeName(key));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Text copied'); });
      } else { alert('Clipboard is not available in this browser.'); }
    });
    el('import-btn').addEventListener('click', function () {
      var file = el('import-file').files && el('import-file').files[0];
      var pasted = el('import-text').value.trim();
      function doImport(text) {
        try {
          var data = JSON.parse(text);
          store = validateImport(data);
          saveStore();
          resetForm();
          renderAll();
          toast('Imported ' + store.documents.length + ' documents');
        } catch (err) { alert(err.message); }
      }
      if (file) {
        var reader = new FileReader();
        reader.onload = function () { doImport(String(reader.result)); };
        reader.readAsText(file);
      } else if (pasted) {
        doImport(pasted);
      } else {
        alert('Pick a JSON file or paste JSON first.');
      }
    });
    el('sample-btn').addEventListener('click', function () {
      var sample = sampleStore();
      var added = 0;
      sample.documents.forEach(function (d) {
        if (!hasDoc(store, d.bike_key, d.name, d.type)) {
          try { addDoc(store, d); added++; } catch (e) { /* a sample row that collides is skipped, not forced */ }
        }
      });
      saveStore();
      renderAll();
      toast(added ? 'Loaded ' + added + ' example documents' : 'Example documents already here');
    });
    el('clear-btn').addEventListener('click', function () {
      if (confirm('Delete ALL documents? The shared bike roster is not touched.')) {
        store = emptyStore();
        saveStore();
        resetForm();
        renderAll();
        toast('All documents deleted');
      }
    });

    if (SWUpdate && SWUpdate.init) SWUpdate.init();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

/* Node exports for test.js. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY: STORAGE_KEY, VERSION: VERSION, SOON_DAYS: SOON_DAYS, TYPES: TYPES,
    round2: round2, isDateISO: isDateISO, todayISO: todayISO, daysBetween: daysBetween,
    addDaysISO: addDaysISO, fmtMoney: fmtMoney, slugify: slugify, escapeHtml: escapeHtml,
    docStatus: docStatus, statusText: statusText,
    emptyStore: emptyStore, validateDocFields: validateDocFields,
    nextDocId: nextDocId, addDoc: addDoc, updateDoc: updateDoc, deleteDoc: deleteDoc,
    getDoc: getDoc, hasDoc: hasDoc, filterDocs: filterDocs, typesInUse: typesInUse,
    docStats: docStats, allDocStats: allDocStats,
    validateImport: validateImport, bikeDocsExport: bikeDocsExport, bikeDocsText: bikeDocsText,
    exportFilename: exportFilename, sampleStore: sampleStore
  };
}
