# documents-renewals-pwa

A tracker for documents and renewals — as a phone app you install
from the browser. No app store, no account, no server.

Registration, insurance, licenses, warranties, titles, and anything
else with a date on it. Each document carries its type, its bike (or
no bike — the Challenger, household papers), its expiry or renewal
date, its renewal cost, and its notes, and the app computes whether
it is overdue, due soon, current, or has no expiry at all.

> All bikes, names, dates, and numbers below are examples only.

## What it does

- **Documents tab** — every document, worst first (overdue, then
  due soon, then current, then no expiry), with search (name or
  notes), a bike filter, a type filter, and a status filter. Each
  row shows the document, its type, its bike, its expiry date and
  status (with days), its renewal cost, and its notes, with Edit and
  Delete. The add form takes a name as the only required field —
  type, bike, expiry date, renewal cost, and notes are all optional.
  The same form edits: tap Edit on a row and it fills in, with a
  Cancel edit button.
- **Summary tab** — per-bike totals and all-bikes totals: documents
  by status, renewal costs entered, and the next renewal. A
  document with no cost entered has no cost in the totals — the
  summary counts it as unpriced instead of guessing a price.
- **Bikes tab** — the shared Pocket Garage roster (b1/b2/b3: 1995 Fat
  Boy, 1990 Softail, 1947 Knucklehead), with an add-a-bike form.
  Bikes live in the shared `pocket-garage-bikes` key via the vendored
  `bike-profile.js` — the same roster the other apps use, no second
  bike model. There is no delete-bike here: roster management belongs
  to the landing dashboard (Phase 2), so a mistyped bike is removed
  there, not here.
- **Data tab** — export the whole file as JSON, export one bike as
  JSON or readable text, import (replaces the file), load example
  data, and delete all documents. Delete clears this app's documents
  only — the shared bike roster is not touched.

## The status rule (read this before trusting a badge)

- **Overdue** — the expiry date is before today.
- **Due soon** — the expiry date falls within the next 30 days (the
  same 30-day due-soon window the bike log uses).
- **Current** — the expiry date is further out.
- **No expiry** — the document has no expiry date (a title, a bill
  of sale). It is kept on file and the app never invents a renewal
  date for it.

## The honesty rule (read this before trusting a number)

Every date and renewal cost on screen is one you typed in, or
computed from numbers you typed in by the formulas printed right
next to them. Nothing is invented: no renewal cost or date is ever
suggested.

- A document with no cost entered has no cost in the totals. The
  summary says how many documents are unpriced instead of guessing.
- A document with no expiry date has status "No expiry" — the app
  never invents a renewal date for paper that has none.
- A document can belong to a bike or to no bike at all ("General
  (no bike)" — the Challenger, household papers). The rider names
  the vehicle in the document title or notes; this app holds no
  vehicle roster of its own.

## Files

- `index.html` — the four tabs (Documents / Summary / Bikes / Data).
- `app.js` — pure logic (Node-testable) + the DOM layer. No build
  step, no dependencies.
- `styles.css` — 1990 Treatment (live dyno `styles.css` is the
  reference): gloss tank black #070709, chrome, purple #9d6bff,
  UnifrakturCook headings, Archivo Narrow body. Buttons have no hover
  transform — the house hover shift breaks Playwright stability
  checks and sticks after a tap on touch (AGENTS.md, Nov 24, 2026).
- `sw.js` — app-shell cache `documents-renewals-v1`; every file
  `index.html` loads is precached. `sw-update.js` is the shared
  update-button module (vendored verbatim, md5
  `dca37625a13049e7eb021d5a25c649d3`).
- `bike-profile.js` — the shared bike roster module (vendored
  verbatim, md5 `c618323a4b8ed7f37004260a044503ce`).
- `manifest.webmanifest`, `icons/` — PWA install files. Icons are
  Pillow-drawn from `make_icons.py` (chrome document page, folded
  corner, purple header bar, DOCS label — the 512 icon was read back
  and reads clearly as a document).
- `test.js` — Node suite, 95 checks. `test_ui.py` — Playwright UI
  smoke (see TESTING.md).

## Publish

New repo (the connector cannot create repos — that happens in the
browser at publish time), GitHub Pages enabled in Settings → Pages
(it is off by default on a new repo and the site 404s without it),
then a landing card for documents & renewals. Push paths (every file
the live `sw.js` precaches or `index.html` loads — the standing
lesson): all files in this directory except `make_icons.py`,
`test.js`, `test_ui.py`, and `TESTING.md`.
