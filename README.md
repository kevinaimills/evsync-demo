# EVSync v0.9 — simpler requests and cleaning flow

A static browser prototype with Nurse, EVS Worker, and EVS Admin demos. No application server, database, account, build step, or package installation is required.

## Run locally

Extract the ZIP into a fresh folder and open **index.html** in a browser. Alternatively, from the extracted folder:

```bash
python3 server.py
```

Open **http://localhost:8000**. This optional static-file server binds to **127.0.0.1**. Stop it with Ctrl+C. Use `--port 8001` if needed.

## Initial demo

There are **62 rooms** and one cleaning request: **Room 2150, Pediatrics**, Basic cleaning, available now, with no PPE required. EVS sees the floor instruction:

> Retain and clean the reusable stethoscope. Do not discard.

The other rooms have no cleaning history or active request. Each visitor/tab has an independent in-memory session. Refreshing restores the original demo, including floor settings.

| Unit | Inclusive room range | Rooms |
| --- | --- | --- |
| Cardiology | 4100–4120 | 21 |
| Oncology | 4121–4140 | 20 |
| Pediatrics | 2150–2170 | 21 |

Room lists sort **Cleaning → Requested → Cleaned → no history**, then by room number within each group. Requested includes work assigned by the Admin or automatic-assignment setting that has not started. Unknown is internal only; the user sees no status or timestamp for those rooms.

Cleaned is historical information, displayed quietly with **As of 06:14, 05/30**, for example. The app does not infer occupancy or room readiness. Cancelling a new request preserves any earlier cleaning history.

Desktop retains the phone frame. Phones use the actual screen directly. The persistent **Demo mode: main menu** button switches roles without resetting the session.

## Nurse Demo

**Rooms** and **Requests** have styled icon headings. Back is a prominent button and returns to the list you came from. Back from Edit returns to the active request details.

Select a room with no active request to open **Request cleaning** immediately, with that room selected. This includes rooms that were previously cleaned. An active room opens its request details with **Edit / Cancel**.

The form uses task questions:

- **Which room?**
- **When will the room be available?** — Now or Later.
- **How much cleaning is required?** — Basic (20 min) or Extra (30 min).
- **How urgent is this request?** — Routine or Urgent.
- **What PPE is required?** — Optional; leaving everything unchecked is valid.
- **Any additional instructions?** — One optional text field, always visible.

There are no separate equipment instructions, floor-default selection, or expandable notes section. Nurse instructions are appended to the floor instructions EVS receives; nurses cannot remove or replace those floor instructions.

**Later** reveals one availability date/time, initially suggesting 30 minutes ahead. There is no end time or expiry. The form scrolls only if needed to show the date field, and keeps Now/Later visible. Reduced-motion preferences are respected.

New availability times cannot be in the past. Editing other request details preserves an existing availability timestamp even after that time has passed. Availability can be changed before cleaning starts; after starting, it is fixed while other request details remain editable.

Saving an edit updates the same request. **Cancel** asks for confirmation, withdraws the request (including active work), and returns to the list. It does not record a completed cleaning.

## EVS Worker Demo

The worker is **Maya Chen**. The list includes unassigned requests and Maya's assigned/active work, Urgent first and then oldest request. Other workers' assignments are excluded. Urgent cards are red, routine cards are white, and PPE is shown.

Open a task to see its floor instructions followed by any additional Nurse instructions.

Before starting there is one action: **Start cleaning now**. It requires **Required PPE and room instructions confirmed**, the room's availability time to have arrived, and no other cleaning in progress. Starting also assigns an unassigned request to Maya in that same action. There is no separate accept/reserve step.

After starting, two actions appear side by side: **Cancel / Mark as done**.

- **Cancel** releases the active task and returns the same request to the list. It does not withdraw the Nurse request or record completion. Starting it again begins a fresh cleaning.
- **Mark as done** records the actual completion time, updates the room's Cleaned history, and returns to the worker list.

The real clock enables the start button when availability arrives, retaining the PPE acknowledgement. Availability has no expiry; a future request can be started at any later time.

## EVS Admin Demo

**Tasks** shows all active requests. The Admin can assign an unassigned task to Maya or return an unstarted assignment to the queue. Assignment does not start cleaning.

**Settings → Automatically assign new tasks** defaults to off. Turning it on assigns subsequent requests to Maya. Existing tasks retain their assignments. It does not auto-start or interrupt cleaning.

**Settings → Floor instructions** lets the Admin choose a unit and edit its instructions. Pediatrics initially has the stethoscope instruction; the other units start empty. Saved instructions automatically appear on every EVS task in that unit, including existing requests. Nurse notes stay separate in the model and remain appended in the EVS display. Unsaved Admin text survives clock updates and changes to the automatic-assignment toggle.

## Quick walkthrough

1. Open **EVS Worker Demo → Room 2150**. Review the stethoscope instruction, check the acknowledgement, and choose **Start cleaning now**.
2. Switch to Nurse Demo and observe Cleaning at the top of the list.
3. Return to the worker task and choose **Mark as done**. Nurse Demo now shows Cleaned with the actual timestamp.
4. Select that cleaned room or another inactive room: the request form opens immediately. Try Extra cleaning and add one note.
5. Try Later. It adds only the availability start. Submit the request and observe the disabled worker start button until that time. Use Nurse Edit to switch back to Now for immediate demonstration.
6. Open **EVS Admin Demo → Settings → Floor instructions**. Change the Pediatrics instruction, save it, and return to the worker task to see the update alongside the Nurse note.

## Time and estimates

All action timestamps use the actual device clock and full dates internally. Display uses the browser's local time zone, 24-hour time, and month/day dates. The phone clock and visible estimates refresh without replacing controls or losing text input.

Assigned-task estimates include the worker's current queue, room availability, travel, preparation, and Basic/Extra cleaning time. Unassigned requests await a worker before receiving an estimate. A future assignment does not block an estimate for work available now. Estimates are fictional demo business logic, and passing one never automatically completes cleaning.

## GitHub Pages

See **GITHUB_PAGES.md** for the browser instructions. Upload the extracted folder's contents with `index.html` at the repository root, then select **Settings → Pages → Deploy from a branch → main → / (root)**. Relative asset paths and `.nojekyll` are included. No backend deployment is needed.

## Source and verification

- `domain.js`: room history, request validation, start/cancel/complete, Admin assignment, unit instructions, real timestamps, and estimates.
- `app.js`: the three role views, request questions, navigation, and conditional availability scrolling.
- `index.html` / `style.css`: responsive phone interface and fixed demo-menu footer.
- `server.py`: optional localhost-only static server.
- `tests/`: domain and frontend-wiring checks.

With Node 18+:

```bash
node --test tests/*.test.cjs
```

All **65 checks pass**. They cover automatic instructions and Admin editing, Basic/Extra durations, single-action starts, PPE confirmation, start-time-only availability, no-scroll and constrained-scroll cases, direct room-to-form navigation, back routing, cancellation, history, sorting, real clock behavior, input retention, and static asset paths.

Frontend checks use a small DOM adapter and viewport geometry fixtures, not a visual renderer. Rendered visual verification was unavailable because the managed preview service was unavailable.
