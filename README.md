# EVSync v0.14

A static classroom prototype with Nurse, EVS Worker, and EVS Admin demos. It runs in a browser, including on a phone. No application server, database, account, package installation, or build step is needed.

## Open locally

Extract the ZIP into a fresh folder and open **index.html**. Alternatively, from that folder:

```bash
python3 server.py
```

Open **http://localhost:8000**. The optional server serves static files and binds only to **127.0.0.1**. Stop it with Ctrl+C; use `--port 8001` if needed.

Data lives in the current page session. Switching demos preserves it; refreshing resets it. Each visitor and tab is independent. On a phone, the app fills the display; desktop retains the phone frame. **Demo mode: main menu** is always available below the app.

## Initial state

One request is included: **Room 2150, Pediatrics**, Basic cleaning, available now, no PPE required. Its floor instructions are:

> Retain and clean the reusable stethoscope. Do not discard.

The 62 rooms are Cardiology **4100–4120**, Oncology **4121–4140**, and Pediatrics **2150–2170**. Other rooms start with no cleaning history. Lists sort Cleaning, Requested, Cleaned, then rooms with no history. Completed rooms display **Cleaned 05/30/26, 06:14**, using the actual local completion date/time. This records cleaning history, not hospital occupancy or room readiness.

## Suggested walkthrough

1. Open **EVS Admin Demo**, select Room 2150, and choose **Assign to an employee**. Select EVS worker 3; the app returns to the assignments overview.
2. Open **EVS Worker Demo**. Use the worker selector at the top to select **EVS worker 3**. Their assignment message and task appear. Open the task to acknowledge the message.
3. Optionally **Change estimate** using the scrollable ten-minute choices. Confirm PPE/instructions and choose **Start cleaning now**. During cleaning, **Update estimate** asks how many minutes remain.
4. Mark it done. **Nurse Demo** shows the dated completion. Its gentle red **Report an issue** button opens a report for that exact job, showing the cleaning time and worker. Enter **What is the problem?** and send.
5. Open **Admin → Feedback**. Filter by status, unit, and timeframe, then choose **Summarize displayed reports**. **Load sample feedback** adds clearly labelled examples for demonstrating this flow.
6. Read the simulated narrative summary and inspect any source reports. The summary describes the selected reports and does not offer instruction updates.
7. Open **Admin → Settings → Default floor instructions** to edit unit instructions manually. Admin navigation is **Tasks / Feedback / Settings**.

## Nurse requests and reports

A room without active work opens directly in the request form. Sending a new request shows **Job requested!** above the job details. **Go back to main menu**, below Edit / Cancel, returns to the same Nurse list as the header Back button. Editing an existing request does not repeat the new-request confirmation. Choose **Basic (20 min)** or **Extra (30 min)**; PPE is optional. Additional instructions are appended to the unit's floor instructions shown to EVS.

Availability choices are **Now**, **In 15 / 30 / 45 / 60 minutes**, and **Choose date/time…**. Relative choices are calculated at submission. Editing preserves the stored absolute time, including seconds. There is no end time or expiry. A custom field scrolls into view only when necessary and keeps the availability selector visible.

Active jobs have **Edit / Cancel**. Nurses can revise urgency, notes, PPE, cleaning level, and availability before cleaning starts. **My requests → Completed** shows the worker and cleaning date/time with a direct issue-report button. Completed work has no notification badge, completion counter, or prompt; nurses can check the history when needed.

The general **Report** entry point has two buttons: **Report a general issue** and **Report an issue with a specific job**. The general option opens the text form with an optional unit. The specific-job option opens the room/job picker, listing open work orders and recently cleaned work; search also finds rooms without a job. Nurse report buttons attached to a job still go straight to its prefilled form. Back follows the selected branch and retains the draft. The form has one free-text **What is the problem?** field. Reporting does not create cleaning work or change room status. The EVS header Report button always opens the two-choice menu, including while viewing or cleaning a task; it never silently selects that task. Sending a report returns to the originating EVS screen.

## Worker assignments and estimates

Workers are named **EVS worker 1–4**. The worker selector switches the simulated employee within the same session. Shared requested work and that employee's assignments are visible; another employee's assignments are hidden. The current cleaning is pinned first. Waiting work is urgent first, with available work before future work within each priority, then availability time and request age.

Admin can assign or reassign unstarted jobs. Assigned jobs show **Change assignment**. Choosing an employee returns to the main assignments overview. **Available workers** excludes employees currently cleaning, even if they have queued assignments. **All workers** includes everyone, so work can be queued behind an active cleaning. Employees without the required PPE coverage cannot be selected. Cleaning already in progress cannot be reassigned.

Assignments create a recipient-specific in-app message. Opening the assigned task or dismissing the notice acknowledges it. Reassignment, withdrawal, and returning work to the shared queue retire obsolete notices. These are local demo messages, not browser push notifications.

**Automatically assign new tasks** defaults off and affects subsequent requests only. When enabled, the demo picks the compatible worker with the earliest predicted start, accounting for current cleaning, queued assignments, room availability, travel, and preparation. Equal starts favor the worker with fewer existing jobs. Assignment never starts cleaning automatically.

There is one initial action: **Start cleaning now**, gated by availability and PPE/instructions confirmation. Afterwards, **Cancel / Mark as done** stay side by side. Cancel releases the same request without recording a completion; Mark as done records actual completion.

Estimate choices are **10 / 20 / 30 / 40 / 50 / 60+ minutes** in a scrollable selector. Before starting, this changes the expected duration without claiming the job. During cleaning, it changes the remaining-time forecast. Explanations are optional. **60+** is a lower bound and appears as a finish time **From …**; it never produces an overdue warning and is excluded from exact forecast-error metrics. Precise estimates can become overdue; time passing never marks work complete.

If a worker tries to start another room while cleaning, they must confirm whether the previous task was finished, is still being cleaned, or could not be finished. Completion can be backdated between its start and now; the actual finish and entry time are retained. Unfinished work requires an explanation, creates a report, and returns to the queue. These changes commit together only if the next task can start.

## Feedback summaries

Feedback filters are **Open / Reviewed / Resolved / All**, unit, and **Today / This week / This month / This year / All time**. General reports are included in each unit filter. The default timeframe is **This month**. Calendar boundaries use the device's local time, with weeks starting Monday.

**Summarize displayed reports** uses exactly the displayed status/unit/timeframe filters. The summary starts with **(Simulated; no AI model currently connected)**, then describes the actual selected issues. Sample feedback produces narratives about stethoscope handling, missed cleaning under a bed, supply shortages, and older availability issues when included. Custom reports are grouped by topic with excerpts of their actual wording; unknown issues are not replaced with invented claims.

**View source reports** lets the Admin inspect the evidence and return to the summary. Summarizing never changes instructions or report status. The instruction-update workflow has been removed from the app; instructions remain manually editable under **Settings → Default floor instructions** and prominent on EVS tasks. Historical completed work retains the instructions and PPE confirmed at cleaning start.

**Load sample feedback** is optional and loads labelled examples once per session. It does not create cleaning work or affect Performance metrics.

## Dictation

Every writing field has **Dictate**: reports, additional instructions, floor instructions, estimate explanations, and unfinished-work explanations. It focuses the field and explains using the device keyboard's microphone. Text remains editable. No audio is recorded by the app and no microphone permission, speech service, or Whisper integration is included.

## Admin navigation and visual cues

Admin navigation is **Tasks / Feedback / Settings**. The Summary / Performance section and its activity-log and sample-performance controls are omitted from this version. Feedback still has **Summarize displayed reports** and source-report review.

Green identifies primary actions and current selections. Informational notifications, including **Job requested!** and assignment notices, use a pale blue background with a narrow side accent. The request confirmation has a checkmark and a flatter shape so it reads as a message rather than a button.

Requested-work badges consistently use amber; Cleaning badges use blue. PPE and room instructions use a quiet warm tint. Urgent jobs use a soft red tint and narrow edge instead of a solid red panel. Static details and secondary controls use quieter neutral surfaces. Labels remain visible so colour is never the only way to understand status. Touch target sizes and workflow controls are retained.

## GitHub Pages and source

Hosting remains static. Follow **GITHUB_PAGES.md**. Upload the folder's contents with `index.html` at repository root. All app paths are relative and `.nojekyll` is included. Updating the hosted files needs no server on your computer.

- `domain.js`: state, assignments, reports, summaries, metrics, timestamps, validation, and atomic actions.
- `app.js`: three role interfaces and local interactions.
- `index.html` / `style.css`: responsive phone app, dialogs, and persistent main menu.
- `server.py`: optional localhost-only static server.
- `tests/`: model and frontend regression checks.

With Node 18+:

```bash
node --test tests/*.test.cjs
```

All **149 checks pass**. Frontend checks use a small DOM adapter and viewport geometry fixtures, not a rendered browser. Changed text/background colour pairs were also checked for contrast. Visual verification was unavailable because the managed preview service was unavailable.
