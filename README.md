# EVSync v0.8 — floor instructions and availability windows

A static browser prototype with Nurse, EVS Worker, and EVS Admin demos. No backend, database, account, build step, or installation is required.

## Open locally

Extract the ZIP into a fresh folder and open **index.html** in your browser. Alternatively, from the extracted folder:

```bash
python3 server.py
```

Open **http://localhost:8000**. This optional server serves static files only and binds to **127.0.0.1**. Stop it with Ctrl+C; use `--port 8001` if needed. The hosted version needs no local server.

## Initial demo

Every new page session starts with **62 rooms and one requested cleaning: Room 2150, Pediatrics**. It is available now, uses Standard cleaning, and requires no PPE. Its floor-default instruction is:

> Retain and clean the reusable stethoscope. Do not discard.

There is no prior cleaning history. The other 61 rooms show no status or timestamp. Refreshing restores this single default request and clears session changes.

| Unit | Inclusive room range | Rooms |
| --- | --- | --- |
| Cardiology | 4100–4120 | 21 |
| Oncology | 4121–4140 | 20 |
| Pediatrics | 2150–2170 | 21 |

The app records its own cleaning workflow and history. It makes no claims about occupancy or room readiness and does not connect to a hospital system.

Room lists sort in this order:

1. **Cleaning**
2. **Requested** (including accepted/assigned jobs that have not started)
3. **Cleaned**
4. Rooms with no cleaning history or active request

Within each group, room numbers sort numerically. Search and unit/status filters preserve this ordering. There is no user-facing Unknown status: rooms without history show their number and unit, with no status or last-cleaned timestamp.

**Cleaned** is quiet, neutral historical information. The room displays, for example, **As of 06:14, 05/30**. This records when the worker last marked cleaning complete. It does not mean the room is currently available or suitable for use. The timestamp stays unchanged as time passes.

## Real time

Requests, acceptance, starts, completion, and estimates use the actual device clock. Display uses the browser's local time zone, 24-hour time, and month/day dates. Timestamps retain their full date internally, so estimates work across midnight and year boundaries.

The desktop phone clock and visible estimates refresh automatically without replacing controls, losing form edits, or clearing the PPE acknowledgement. Estimated finish means the predicted end of cleaning. Passing an estimate does not automatically mark a task complete.

Cleaning times remain **Standard 20 min**, **Enhanced 30 min**, and **Specialist 40 min**. Estimates use fictional travel/preparation/queue assumptions; automatic assignment always picks the demo worker.

## Quick walkthrough

1. Open **EVS Worker Demo**. There is exactly one request: **Room 2150, Pediatrics**. Open it to see the stethoscope instruction.
2. Choose **Accept job** to reserve it. Check **Required PPE and room instructions confirmed**, then choose **Start now**. Starting directly also accepts the task.
3. Switch to Nurse Demo: Room 2150 is **Cleaning** and sorts first.
4. Return to the worker task and choose **Mark as done**. Nurse Demo shows **Cleaned** with the actual completion date and time.
5. In Nurse Demo, request **Room 2151**. Open the larger **Equipment instructions & notes** control; it scrolls the revealed content into view. Select **Use floor defaults** to include the same stethoscope instruction, and add custom instructions if useful.
6. Keep availability as **Now**, or choose **Later** and enter **From** and optional **Until** dates/times. Send the request. Future tasks can be accepted in advance, but Start now stays disabled until the room's window begins.
7. Use **Edit** to change an unstarted task's window, including switching back to Now. Refreshing restores the single Room 2150 demo request.

The persistent main-menu button preserves requests, settings, and history while switching roles. On phones the app fills the screen; desktop retains the phone frame. Each visitor/tab has its own session. There is no browser storage or communication between browsers.

## Nurse controls

Active requests have **Edit / Cancel** side by side. Edit opens the existing class, priority, PPE, equipment instructions, and notes. Saving updates the same request and its estimate while preserving request, acceptance, and start times. The room cannot be changed. An edit cannot give the assigned worker requirements outside their demo capabilities.

**Cancel** asks for confirmation, then withdraws the request, including active work. It records no completion. Any earlier cleaning timestamp remains: a room cleaned earlier returns to its previous Cleaned history; a room never cleaned returns to showing no status information.

### Equipment instructions and floor defaults

The **Equipment instructions & notes** section has a large, full-width tap target. Opening it scrolls the new fields into view; closing it does not scroll. Reduced-motion preferences are respected.

For Pediatrics rooms, **Use floor defaults** is an optional checkbox that previews the exact instruction before you select it. It adds the reusable-stethoscope instruction alongside any custom equipment instructions and notes. It does not overwrite typed text or select PPE. Other units currently have no configured floor defaults, so the option is hidden there. The seeded request has the Pediatrics default selected; new requests leave it unchecked.

### Availability windows

**Available for cleaning** defaults to **Now**. **Later** reveals date/time fields, initially suggesting 30 minutes ahead with a one-hour window. **Until** can be cleared to allow an open-ended window.

A new scheduled start must not be in the past. If an end is supplied, the window must fit the selected cleaning duration. Requests and their availability appear in Nurse, Worker, and Admin details; future times also appear in task cards. Accepted-task estimates respect availability, travel, preparation, and existing work. An urgent future reservation does not block estimates for work available now.

A future task can be accepted in advance. **Start now** requires both the PPE/instructions acknowledgement and an open window with enough time left for cleaning. The live clock enables it when the window opens, without clearing acknowledgement. If the task can no longer fit, the worker is told to ask the nurse to update the window. This never auto-starts, auto-completes, or deletes the request.

The nurse can edit the window before cleaning starts. Once cleaning has started, the window is fixed; equipment instructions and notes remain editable. These times are manually entered demo information, not data from a hospital system.

## EVS Worker controls

The demo worker is **Maya Chen**. The task list shows unclaimed requests and Maya's claimed/in-progress work, sorted Urgent first, then oldest request. Urgent cards are red, routine cards are white, and PPE is included. Other workers' assignments do not appear in Maya's list.

| Task state | Side-by-side actions |
| --- | --- |
| Requested | **Accept job / Start now** |
| Accepted | **Cancel job / Start now** |
| Cleaning | **Cancel job / Mark as done** |

A worker may reserve multiple tasks but may clean only one at a time. **Mark as done** records the completion time and frees the worker for the next task.

**Cancel job** releases the claim and returns that same request to the available list. It does not withdraw the nurse's request or record a completed cleaning. Cancelling active work clears its progress; accepting/starting again begins a fresh cleaning. Automatic assignment does not immediately reclaim a released job.

## EVS Admin controls

**Tasks** shows all active requests, including other workers' work. The admin can assign an unclaimed task to Maya or return an unstarted assignment to the available list.

**Settings → Automatically assign new tasks** defaults to off. Turning it on assigns only subsequent requests to Maya. It does not assign existing requests, start tasks, or interrupt work in progress.

## GitHub Pages

See **GITHUB_PAGES.md** for browser instructions. The hosting steps are unchanged: upload the extracted folder's contents with `index.html` at the repository root, then configure **Settings → Pages → Deploy from a branch → main → / (root)**.

The files use relative paths and support GitHub project URLs. `.nojekyll` is included. Nothing has been published on your behalf.

## Source and checks

- `domain.js`: session state, room history, claims, assignment, real-time estimates, validation, and sorting.
- `app.js`: the three role views and local actions.
- `index.html` / `style.css`: responsive phone interface and persistent main-menu footer.
- `server.py`: optional localhost-only static server.
- `tests/`: model and frontend-wiring checks.

With Node 18+:

```bash
node --test tests/*.test.cjs
```

All **76 checks pass**, covering the single seeded request, floor-default previews and selection, custom-note retention, notes-section scroll wiring, future windows and start gating, deadline validation, editing, real-time estimates, midnight/date handling, room sorting, cleaning history, cancellation, optional PPE, paired actions, admin assignment, and menu retention.

Frontend checks use a small DOM adapter, not a visual renderer. Visual browser verification was unavailable because the workspace's managed preview service was unavailable.
