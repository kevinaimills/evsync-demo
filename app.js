'use strict';
const Domain = globalThis.EVSyncDomain;
let simulation = null;
let state = null;
let role = 'menu';
let screen = 'menu';
let colourScheme = 'bold';
let selectedRoom = null;
let editingJob = null;
let requestConfirmation = null;
let nurseList = 'rooms';
let adminUnit = 'Pediatrics';
let selectedWorker = Domain.USER_WORKER_ID;
let selectedTask = null;
let roomSearch = '';
let roomUnit = 'all';
let statusFilter = 'all';
let busy = false;
let formError = '';
let toastTimer;
let requestsTab='active',reportContext=null,reportReturn=null,reportFormBack='picker',reportHasMenu=false,reportSearch='';
let reportDraft={description:'',unit:''};
let selectedReport=null,reportAdminReturn='feedback',feedbackFilter='open',feedbackUnit='all';
let feedbackTimeframe='month';
let selectedFeedbackSummary=null,assignmentFilter='available',assignmentJobId=null;
let estimateJobId=null,pendingStart=null;

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = (n) => String(n).padStart(2,'0');
const time = (n) => n == null ? '' : `${pad(new Date(n).getHours())}:${pad(new Date(n).getMinutes())}`;
const dateTime = (n) => n == null ? '' : `${time(n)}, ${pad(new Date(n).getMonth()+1)}/${pad(new Date(n).getDate())}`;
const cleanedOn = (n) => n == null ? '' : `Cleaned ${pad(new Date(n).getMonth()+1)}/${pad(new Date(n).getDate())}/${String(new Date(n).getFullYear()).slice(-2)}, ${time(n)}`;
const cleanedStamp = (n) => `<time class="cleaned-timestamp" datetime="${new Date(n).toISOString()}">${cleanedOn(n)}</time>`;
const estimate = (job) => job.status==='cleaning'&&job.overdue?'Estimate overdue':job.estimated_finish == null ? 'Awaiting worker' : `${(job.status==='cleaning'?job.forecast_at_least:job.expected_at_least)?'From ':''}${dateTime(job.estimated_finish)}`;
const expectedTime = (job) => `${Domain.expectedMinutes(job)}${job.expected_at_least?'+':''} min`;
const currentWorkerName = () => Domain.workerName(state,selectedWorker);
const latestCleanedJob = (id) => state.jobs.filter(j=>j.room_id===id&&j.status==='complete').sort((a,b)=>b.completed_at-a.completed_at||b.requested_at-a.requested_at)[0];
const localInputTime = (n) => `${new Date(n).getFullYear()}-${pad(new Date(n).getMonth()+1)}-${pad(new Date(n).getDate())}T${time(n)}`;
const availabilityText = (job) => job.availability_mode==='now'?'Now':`From ${dateTime(job.available_from)}`;
const availabilityRow = (job) => `<dt>Available</dt><dd>${esc(availabilityText(job))}</dd>`;
const scheduledLabel = (job) => job.availability_mode==='later'?`<span class="task-window">From ${dateTime(job.available_from)}</span>`:'';
const now = () => state.settings.now;
const jobForRoom = (id) => state.jobs.find(j => j.room_id === id && ['queued','assigned','cleaning'].includes(j.status));
const workerFor = (j) => state.workers.find(w => w.id === j?.worker_id);
const roomFor = (j) => state.rooms.find(r => r.id === j?.room_id);
const label = (status) => ({requested:'Requested',queued:'Requested',assigned:'Requested',cleaning:'Cleaning',cleaned:'Cleaned',complete:'Cleaned',unknown:''}[status] || '');
const badge = (status) => label(status) ? `<span class="badge ${status==='complete'?'cleaned':esc(status)}">${label(status)}</span>` : '';

const iconPaths = {
  plus:'M12 5v14M5 12h14',
  search:'M20 20l-4.5-4.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  back:'m14 6-6 6 6 6',
  rooms:'M4 21V4h12v17M8 8h4M8 12h4M8 16h4M16 11h4v10M2 21h20',
  mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  flag:'M5 22V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0',
  list:'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
  check:'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M8 12l3 3 5-5'
};
const icon = (name,size=20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name]}"/></svg>`;

function toast(message, error=false) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => el.className = '', 4300);
}

async function mutate(action, payload={}, message='Updated') {
  if (busy) return null;
  busy = true;
  try {
    // Commit a validated copy; invalid actions leave the current simulation intact.
    const next = Domain.transact(simulation, action, payload);
    const nextView = Domain.snapshot(next);
    simulation = next;
    state = nextView;
    formError = '';
    if(message)toast(message);
    return state;
  } catch (error) {
    toast(error.message, true);
    formError = error.message;
    setFormError(error.message);
    return null;
  } finally {
    busy = false;
  }
}

function reportHeaderButton(job=null) {
  return `<button class="report-header-button" data-action="begin-report" ${job?`data-job="${job.id}"`:''} title="Report an issue">${icon('flag',17)}<span>Report</span></button>`;
}
function appHeader() {
  if(role==='menu')return '<header class="app-header"><h1>Choose a demo</h1></header>';
  if(['report-menu','report-picker','report-form'].includes(screen))return `<header class="app-header"><div class="header-title"><button class="back-button" data-action="report-back">${icon('back')} Back</button><h1>Report issue</h1></div></header>`;
  if(role==='admin'){
    const titles={tasks:'EVS Admin',feedback:'Feedback',settings:'Settings',task:'Room '+currentTask()?.room_id,'assign-worker':'Assign employee','feedback-report':'Issue report','feedback-summary':'Report summary'};
    const back={task:'tasks','assign-worker':'task','feedback-report':reportAdminReturn,'feedback-summary':'feedback'}[screen];
    return `<header class="app-header">${back?`<div class="header-title"><button class="back-button" data-screen="${back}">${icon('back')} Back</button><h1>${titles[screen]}</h1></div>`:`<h1>${titles[screen]||'EVS Admin'}</h1>`}</header>`;
  }
  if(role==='evs')return `<header class="app-header">${screen==='task'?`<button class="back-button" data-back-tasks>${icon('back')} Back</button><span class="identity-label">${currentWorkerName()}</span>`:`<h1>Tasks</h1><select id="demo-worker" class="demo-worker-select" aria-label="EVS worker demo">${state.workers.map(w=>`<option value="${w.id}" ${w.id===selectedWorker?'selected':''}>${w.name}</option>`).join('')}</select>`}${reportHeaderButton()}</header>`;
  const title=screen==='edit'?'Edit request':screen==='form'?'Request cleaning':screen==='detail'?`Room ${selectedRoom}`:screen==='requests'?'My requests':'Rooms';
  const back=['form','edit','detail'].includes(screen),report=!['form','edit'].includes(screen);
  return `<header class="app-header ${back?'':'nurse-list-header'}">${back?`<div class="header-title"><button class="back-button" data-screen="${screen==='edit'?'detail':nurseList}">${icon('back')} Back</button><h1>${title}</h1></div>`:`<h1 class="screen-title"><span class="title-mark" aria-hidden="true">${icon(screen==='requests'?'list':'rooms',23)}</span><span>${title}</span></h1>`}${report?reportHeaderButton(screen==='detail'?jobForRoom(selectedRoom):null):''}</header>`;
}

function nurseNav() {
  return `<nav class="app-nav" aria-label="Nurse navigation"><button data-screen="rooms" class="${screen==='rooms'?'selected':''}">${icon('rooms')} Rooms</button><button data-screen="requests" class="${screen==='requests'?'selected':''}">${icon('list')} My requests</button></nav>`;
}

function roomStatus(room) { return Domain.roomStatus(state,room); }
function baseRooms() { return state.rooms.filter(r => r.id.includes(roomSearch) && (roomUnit === 'all' || r.unit === roomUnit)); }
function matchesStatus(room, filter) { return filter === 'all' || roomStatus(room) === filter; }
function visibleRooms() { return Domain.sortedRooms(state,baseRooms().filter(r => matchesStatus(r,statusFilter))); }
function roomFilters() {
  const filters=[['all','All'],['cleaning','Cleaning'],['requested','Requested'],['cleaned','Cleaned']];
  return filters.map(([id,text]) => `<button data-filter="${id}" class="${id === statusFilter ? 'selected' : ''}" aria-pressed="${id === statusFilter}">${text} ${baseRooms().filter(r => matchesStatus(r,id)).length}</button>`).join('');
}
function roomCard(room) {
  const job=jobForRoom(room.id),status=roomStatus(room);
  if(status==='cleaned'){
    const completed=latestCleanedJob(room.id);
    return `<article class="room-card cleaned-room-card"><button class="cleaned-room-link" data-room="${room.id}" aria-label="Room ${room.id}, ${cleanedOn(room.last_cleaned_at)}"><span class="room-info"><strong>Room ${room.id}</strong><small>${room.unit}</small></span><span class="room-state"><small class="cleaned-on">${cleanedStamp(room.last_cleaned_at)}</small></span></button><div class="cleaned-action"><button class="report-issue-muted" data-action="begin-report" data-job="${completed.id}" aria-label="Report an issue with Room ${room.id}">Report an issue</button></div></article>`;
  }
  const eta=job?.estimated_finish!=null?`<small class="eta" data-estimate="${job.id}" data-estimate-prefix="Est. finish ">Est. finish ${estimate(job)}</small>`:'';
  return `<button class="room-card" data-room="${room.id}" aria-label="Room ${room.id}${label(status)?', '+label(status):''}"><span class="room-info"><strong>Room ${room.id}</strong><small>${room.unit}</small>${job?.priority==='urgent'?'<small class="priority-label">Urgent</small>':''}</span>${status==='unknown'?'':`<span class="room-state">${badge(status)}${job?.availability_mode==='later'?`<small class="availability-card">From ${dateTime(job.available_from)}</small>`:''}${eta}</span>`}</button>`;
}

function filteredRooms() {
  const rooms = visibleRooms();
  return rooms.length ? rooms.map(roomCard).join('') : '<p class="filter-empty">No matching rooms.</p>';
}
function renderRoomList() {
  $('#room-list').innerHTML = filteredRooms();
  $('#room-filters').innerHTML = roomFilters();
  $('#room-count').textContent = `${visibleRooms().length} matching rooms`;
}

function nurseRooms() {
  return `<div class="app-content list-content"><div class="list-tools"><div class="toolbar"><label class="search"><span class="visually-hidden">Search room number</span>${icon('search',17)}<input id="room-search" type="search" placeholder="Find a room" value="${esc(roomSearch)}"></label><select id="unit-filter" aria-label="Filter unit"><option value="all">All units</option>${['Cardiology','Oncology','Pediatrics'].map(u => `<option ${u === roomUnit ? 'selected' : ''}>${u}</option>`).join('')}</select></div><div class="filter-bar" id="room-filters" role="group" aria-label="Filter by room status">${roomFilters()}</div></div><span id="room-count" class="visually-hidden" aria-live="polite"></span><div class="room-list" id="room-list">${filteredRooms()}</div></div><div class="app-bottom"><button class="primary full" data-action="new-request">${icon('plus')} Request cleaning</button></div>${nurseNav()}`;
}

function nurseRequests() {
  const jobs=Domain.myRequests(state,requestsTab),active=Domain.myRequests(state).length;
  return `<div class="app-content"><div class="segmented" role="group" aria-label="My request status"><button data-request-tab="active" class="${requestsTab==='active'?'selected':''}">Active ${active}</button><button data-request-tab="completed" class="${requestsTab==='completed'?'selected':''}">Completed</button></div><div class="request-list">${jobs.map(j=>`<article class="my-request-card">${j.status==='complete'?`<div class="my-request-body"><span class="room-info"><strong>Room ${j.room_id}</strong><small>${roomFor(j).unit}</small><small>Cleaned by ${esc(workerFor(j)?.name||'EVS')}</small></span><span class="room-state"><small class="cleaned-on">${cleanedStamp(j.completed_at)}</small><button class="report-issue-muted" data-action="begin-report" data-job="${j.id}">Report an issue</button></span></div>`:`<button class="my-request-body" data-room="${j.room_id}"><span class="room-info"><strong>Room ${j.room_id}</strong><small>${roomFor(j).unit} · ${state.classes[j.cleaning_class].label}</small>${j.priority==='urgent'?'<small class="priority-label">Urgent</small>':''}</span><span class="room-state">${badge(j.status)}${j.estimated_finish!=null?`<small data-estimate="${j.id}" data-estimate-prefix="Est. finish ">Est. finish ${estimate(j)}</small>`:''}</span></button><div class="request-card-actions"><button class="text-button" data-action="edit-request" data-job="${j.id}">Edit</button><button class="text-button" data-action="begin-report" data-job="${j.id}">Report an issue</button></div>`}</article>`).join('')||`<p class="filter-empty">No ${requestsTab==='active'?'active':'completed'} requests.</p>`}</div></div><div class="app-bottom"><button class="primary full" data-action="new-request">${icon('plus')} Request cleaning</button></div>${nurseNav()}`;
}

function ppeChips(job) {
  if(!job.ppe.length)return '<p class="supporting-text">No PPE required</p>';
  return `<div class="ppe-chips">${job.ppe.map(p => `<span class="ppe-chip">${esc(p)}</span>`).join('')}</div>`;
}
function requestDetails(job) {
  const historical=job.status==='complete'&&job.instructions_at_start!==null;
  const text=role==='nurse'?job.notes:historical?job.instructions_at_start:Domain.instructions(state,job),highlight=role!=='nurse'&&!historical&&!!Domain.floorInstructions(state,job);
  return `<section class="info-block"><h2>Required PPE</h2>${ppeChips(job)}</section>${text?`<section class="info-block instructions-note ${highlight?'feedback-reminder':''}"><h2>${role==='nurse'?'Additional instructions':historical?'Instructions at cleaning start':'Instructions'}</h2><p>${esc(text)}</p></section>`:''}`;
}

function nurseDetail() {
  const room=state.rooms.find(r=>r.id===selectedRoom),job=jobForRoom(room.id),status=roomStatus(room),worker=workerFor(job);
  return `<div class="app-content">${job&&requestConfirmation===job.id?`<p class="request-confirmation" role="status">${icon('check',20)}<span>Job requested!</span></p>`:''}<p class="meta-line"><span>${room.unit}</span>${badge(status)}</p>${job?`<dl class="detail-grid"><dt>Estimated finish</dt><dd class="estimate-value" data-estimate="${job.id}">${estimate(job)}</dd>${availabilityRow(job)}<dt>Worker</dt><dd>${worker?esc(worker.name):'Awaiting assignment'}</dd><dt>Cleaning</dt><dd>${state.classes[job.cleaning_class].label}</dd><dt>Priority</dt><dd>${job.priority==='urgent'?'Urgent':'Routine'}</dd></dl>${requestDetails(job)}<div class="paired-actions"><button class="secondary" data-action="edit-request" data-job="${job.id}">Edit</button><button class="danger-btn" data-action="cancel-request" data-job="${job.id}">Cancel</button></div><div class="detail-return"><button class="back-button" data-screen="${nurseList}">${icon('back')} Go back to main menu</button></div>`:status==='cleaned'?`<p class="last-cleaned">${cleanedStamp(room.last_cleaned_at)}</p>`:''}</div>${!job?`<div class="app-bottom"><button class="primary full" data-action="new-request" data-room-id="${room.id}">Request cleaning</button></div>`:''}${nurseNav()}`;
}

function requestForm() {
  const job=screen==='edit'?state.jobs.find(j=>j.id===editingJob):null;
  const rooms=Domain.sortedRooms(state,state.rooms.filter(r=>r.id===job?.room_id||!jobForRoom(r.id)));
  if(!rooms.length)return `<div class="app-content"><p>Every room already has an active request.</p></div>${nurseNav()}`;
  const room=rooms.find(r=>r.id===(job?.room_id||selectedRoom))||rooms[0],priority=job?.priority||'routine',locked=job?.status==='cleaning';
  const choice=job?.availability_mode==='later'?'custom':'now';
  const from=job?.availability_mode==='later'?job.available_from:Math.ceil((Date.now()+30*Domain.MINUTE)/(5*Domain.MINUTE))*5*Domain.MINUTE;
  return `<div class="app-content"><form id="request-form"><div id="form-error" class="form-error" role="alert" ${formError?'':'hidden'}>${esc(formError)}</div>
    <div class="form-field"><label for="request-room">Which room?</label><select id="request-room" name="room_id" required ${job?'disabled':''}>${rooms.map(r=>`<option value="${r.id}" ${r.id===room.id?'selected':''}>${r.id} · ${r.unit}</option>`).join('')}</select></div>
    <fieldset id="availability-choice" class="availability-choice" ${locked?'disabled':''}><legend>When will the room be available?</legend><select id="availability-option" name="availability_option" aria-label="When will the room be available?">${[['now','Now'],['15','In 15 minutes'],['30','In 30 minutes'],['45','In 45 minutes'],['60','In 60 minutes'],['custom','Choose date/time…']].map(([value,label])=>`<option value="${value}" ${value===choice?'selected':''}>${label}</option>`).join('')}</select>
      <fieldset id="availability-fields" class="availability-fields" ${choice==='custom'?'':'hidden disabled'}><div class="form-field"><label for="available-from">Available from</label><input id="available-from" name="available_from" type="datetime-local" value="${localInputTime(from)}" min="${localInputTime(Math.min(Date.now(),from))}" required></div></fieldset>${locked?'<p class="supporting-text">Availability is fixed once cleaning starts.</p>':''}</fieldset>
    <fieldset><legend>How much cleaning is required?</legend><div class="choice-grid cleaning-choices">${Object.entries(state.classes).map(([id,c])=>`<label class="choice"><input type="radio" name="cleaning_class" value="${id}" ${id===(job?.cleaning_class||'basic')?'checked':''}><span>${c.label}<small>${state.settings.durations[id]} min</small></span></label>`).join('')}</div></fieldset>
    <fieldset><legend>How urgent is this request?</legend><div class="choice-grid">${['routine','urgent'].map(value=>`<label class="choice"><input type="radio" name="priority" value="${value}" ${priority===value?'checked':''}>${value==='urgent'?'Urgent':'Routine'}</label>`).join('')}</div></fieldset>
    <fieldset><legend>What PPE is required? <span class="optional-label">(optional)</span></legend><div class="choice-grid">${state.ppe_options.map(p=>`<label class="choice"><input type="checkbox" name="ppe" value="${esc(p)}" ${job?.ppe.includes(p)?'checked':''}>${esc(p)}</label>`).join('')}</div></fieldset>
    ${textAreaField('nurse-note','notes','Any additional instructions?',job?.notes||'',{max:600})}</form></div><div class="app-bottom"><button type="submit" form="request-form" class="primary full">${job?'Save changes':'Send request'}</button></div>`;
}
function updateAvailabilityFields() {
  const fields=$('#availability-fields');if(!fields)return;
  const custom=$('#availability-option')?.value==='custom',locked=state.jobs.find(j=>j.id===editingJob)?.status==='cleaning';fields.hidden=!custom;fields.disabled=!custom||locked;
}
function ensureAvailabilityVisible() {
  requestAnimationFrame(()=>{
    const content=$('.app-content'),choice=$('#availability-option'),fields=$('#availability-fields');if(!content||!choice||!fields||fields.hidden)return;
    const viewport=content.getBoundingClientRect(),control=choice.getBoundingClientRect(),input=fields.getBoundingClientRect(),top=content.scrollTop;
    if(input.bottom<=viewport.bottom&&control.top>=viewport.top)return;
    const keepChoice=top+control.top-viewport.top-8,target=Math.max(0,input.bottom>viewport.bottom?Math.min(top+input.bottom-viewport.bottom+8,keepChoice):keepChoice);
    if(Math.abs(target-top)<1)return;content.scrollTo({top:target,behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
}

function applyColourScheme() {
  const bold=colourScheme==='bold';
  document.documentElement.dataset.colourScheme=colourScheme;
  const toggle=$('#bold-colours');if(toggle)toggle.checked=bold;
  const label=$('#colour-scheme-name');if(label)label.textContent=bold?'Bold':'Original (v0.14)';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',bold?'#e8eef5':'#153f3b');
}
function mainMenuView() {
  return `<div class="app-content"><div class="demo-options"><button class="demo-option" data-demo="nurse"><span>Nurse Demo</span>${icon('back',20)}</button><button class="demo-option" data-demo="evs"><span>EVS Worker Demo</span>${icon('back',20)}</button><button class="demo-option" data-demo="admin"><span>EVS Admin Demo</span>${icon('back',20)}</button></div><label class="theme-setting" for="bold-colours"><span class="theme-label"><strong>Colour scheme</strong><span id="colour-scheme-name">${colourScheme==='bold'?'Bold':'Original (v0.14)'}</span></span><span class="switch-control"><input id="bold-colours" type="checkbox" role="switch" aria-label="Use bold colours" aria-describedby="colour-scheme-name" ${colourScheme==='bold'?'checked':''}><span aria-hidden="true"></span></span></label></div>`;
}
function taskSummary(job,includePPE=false,admin=false) {
  const room=roomFor(job);
  return `<span class="task-title-row"><strong>Room ${room.id}</strong>${badge(job.status)}</span><span class="task-meta">${room.unit} · ${state.classes[job.cleaning_class].label}</span>${scheduledLabel(job)}${job.priority==='urgent'?'<span class="task-urgency">Urgent</span>':''}${includePPE?`<span class="task-ppe">${job.ppe.length?job.ppe.map(p=>`<span class="ppe-chip">${esc(p)}</span>`).join(''):'<span>No PPE required</span>'}</span>`:''}${admin?`<span class="task-owner">${esc(workerFor(job)?.name||'Unassigned')}</span>`:''}`;
}
function evsView() {
  const tasks=Domain.requestedTasks(state),current=tasks.find(j=>j.status==='cleaning'),pending=tasks.filter(j=>j.status!=='cleaning');
  const card=j=>`<button class="task-card ${j.priority==='urgent'?'urgent':''}" data-task="${j.id}">${taskSummary(j,true)}</button>`;
  const groups=[['urgent',true,'Urgent · available now'],['urgent',false,'Urgent · available later'],['routine',true,'Available now'],['routine',false,'Available later']];
  return `<div class="app-content">${assignmentNotice()}${current?`<h2 class="section-label">Cleaning now</h2><div class="task-list current-task">${card(current)}</div>`:''}${groups.map(([priority,ready,title])=>{const list=pending.filter(j=>j.priority===priority&&(j.available_from<=now())===ready);return list.length?`<h2 class="section-label">${title}</h2><div class="task-list">${list.map(card).join('')}</div>`:'';}).join('')}${!tasks.length?'<div class="empty-state"><h2>No requested tasks.</h2></div>':''}</div>`;
}

function currentTask() {return state.jobs.find(j=>j.id===selectedTask);}
function anotherActiveTask(job) {return state.jobs.some(j=>j.id!==job.id&&j.worker_id===selectedWorker&&j.status==='cleaning');}
function evsDetail() {
  const job=currentTask();if(!job||!Domain.requestedTasks(state).some(j=>j.id===job.id))return '<div class="app-content"><p>This task is no longer available.</p></div>';
  const started=job.status==='cleaning';
  return `<div class="app-content"><section class="task-heading ${job.priority==='urgent'?'urgent':''}">${taskSummary(job)}</section>${requestDetails(job)}<dl class="detail-grid"><dt>Expected time</dt><dd>${expectedTime(job)}</dd>${availabilityRow(job)}<dt>Estimated finish</dt><dd data-estimate="${job.id}">${estimate(job)}</dd>${started?`<dt>Started</dt><dd>${dateTime(job.started_at)}</dd>`:''}</dl><button class="secondary full estimate-link" data-action="estimate-dialog" data-job="${job.id}">${started?'Update estimate':'Change estimate'}</button></div><div class="app-bottom worker-action-area">${started?`<div class="worker-actions paired-actions"><button class="danger-btn" data-action="release-job" data-job="${job.id}">Cancel</button><button class="primary" data-action="complete-job" data-job="${job.id}">Mark as done</button></div>`:`<label class="check-line"><input id="ppe-confirmed" type="checkbox"><span>Required PPE and room instructions confirmed</span></label><p id="start-restriction" class="supporting-text task-busy-note" hidden></p><button id="start-job" class="primary full" data-action="start" data-job="${job.id}" disabled>Start cleaning now</button>`}</div>`;
}

function adminNav() {
  const selected=['task','assign-worker'].includes(screen)?'tasks':screen==='feedback-report'?'feedback':screen==='feedback-summary'?'feedback':screen;
  return `<nav class="app-nav admin-nav" aria-label="EVS admin navigation">${[['tasks','Tasks'],['feedback','Feedback'],['settings','Settings']].map(([id,title])=>`<button data-admin-screen="${id}" class="${id===selected?'selected':''}">${title}</button>`).join('')}</nav>`;
}

function adminTasks() {
  const tasks=state.jobs.filter(j=>['queued','assigned','cleaning'].includes(j.status)).sort((a,b)=>Number(b.status==='cleaning')-Number(a.status==='cleaning')||Domain.taskOrder(a,b,now()));
  return `<div class="app-content"><div class="task-list">${tasks.map(j=>`<button class="task-card ${j.priority==='urgent'?'urgent':''}" data-admin-task="${j.id}">${taskSummary(j,true,true)}</button>`).join('')||'<p class="supporting-text">No active requests.</p>'}</div></div>${adminNav()}`;
}
function adminSettings() {
  return `<div class="app-content"><section class="settings-section"><label class="setting-row" for="auto-assign"><span>Automatically assign new tasks</span><span class="switch-control"><input id="auto-assign" type="checkbox" role="switch" ${state.settings.automatic_assignment?'checked':''}><span aria-hidden="true"></span></span></label><p class="supporting-text">When enabled, new tasks are assigned to the most available worker automatically.</p></section><section class="settings-section floor-settings"><h2>Default floor instructions</h2><form id="floor-instructions-form"><div id="form-error" class="form-error" role="alert" hidden></div><div class="form-field"><label for="defaults-unit">Which unit?</label><select id="defaults-unit" name="unit">${Object.keys(state.settings.floor_instructions).map(unit=>`<option ${unit===adminUnit?'selected':''}>${unit}</option>`).join('')}</select></div>${textAreaField('floor-instructions','instructions','Instructions for this unit',state.settings.floor_instructions[adminUnit],{max:Domain.FLOOR_MAX,rows:4})}<button type="submit" class="primary full">Save instructions</button></form></section></div>${adminNav()}`;
}

function adminDetail() {
  const job=currentTask();if(!job)return '<div class="app-content">Task not found.</div>'+adminNav();
  return `<div class="app-content"><section class="task-heading ${job.priority==='urgent'?'urgent':''}">${taskSummary(job)}</section><dl class="detail-grid"><dt>Worker</dt><dd>${esc(workerFor(job)?.name||'Unassigned')}</dd><dt>Requested</dt><dd>${dateTime(job.requested_at)}</dd>${availabilityRow(job)}<dt>Estimated finish</dt><dd data-estimate="${job.id}">${estimate(job)}</dd></dl>${requestDetails(job)}</div>${['queued','assigned'].includes(job.status)?`<div class="app-bottom"><button class="primary full" data-action="choose-employee" data-job="${job.id}">${job.status==='assigned'?'Change assignment':'Assign to an employee'}</button>${job.status==='assigned'?`<button class="text-button full" data-action="admin-unassign" data-job="${job.id}">Return to available tasks</button>`:''}</div>`:''}${adminNav()}`;
}
function updateStartButton() {
  const button=$('#start-job'),job=currentTask();if(!button)return;
  const issue=!job?'This task is no longer available.':Domain.startIssue(state,job),other=state.jobs.find(j=>j.id!==job?.id&&j.worker_id===selectedWorker&&j.status==='cleaning');
  button.disabled=!$('#ppe-confirmed')?.checked||!!issue;const note=$('#start-restriction');
  if(note){note.textContent=issue+(job&&state.settings.now<job.available_from?' Available from '+dateTime(job.available_from)+'.':'')|| (other?`Confirm whether Room ${other.room_id} is finished before starting this task.`:'');note.hidden=!note.textContent;}
}

function renderPhone() {
  if(role==='nurse'&&screen==='detail'&&selectedRoom&&!jobForRoom(selectedRoom)){editingJob=null;screen='form';}
  if(['form','edit'].includes(screen)&&role==='nurse'&&$('#request-form'))return;
  const scroll=$('.app-content')?.scrollTop||0;
  const oldJob=$('[data-action="start"]')?.dataset.job;
  const confirmed=$('#ppe-confirmed')?.checked||false;
  let view;
  if(role==='menu')view=mainMenuView();
  else if(screen==='report-menu')view=reportMenu();
  else if(screen==='report-picker')view=reportPicker();
  else if(screen==='report-form')view=reportForm();
  else if(role==='evs')view=screen==='task'?evsDetail():evsView();
  else if(role==='admin')view=screen==='settings'?adminSettings():screen==='task'?adminDetail():screen==='feedback'?feedbackView():screen==='feedback-report'?feedbackDetail():screen==='assign-worker'?assignmentView():screen==='feedback-summary'?feedbackSummaryView():adminTasks();
  else view=['form','edit'].includes(screen)?requestForm():screen==='detail'?nurseDetail():screen==='requests'?nurseRequests():nurseRooms();
  $('#phone-app').innerHTML=appHeader()+view;
  if($('.app-content'))$('.app-content').scrollTop=scroll;
  if($('#room-count'))renderRoomList();
  if($('#ppe-confirmed')&&oldJob===$('[data-action="start"]')?.dataset.job)$('#ppe-confirmed').checked=confirmed;
  updateStartButton();
  updateAvailabilityFields();
}
function render() {if(!state)return;refreshClock();renderPhone();}
function enterDemo(mode) {
  role=mode;selectedTask=null;selectedWorker=state.settings.user_worker_id;navigate(mode==='nurse'?'rooms':mode==='menu'?'menu':'tasks');
  if(mode==='evs')notifyWorker();
}

function navigate(next) {
  if(role==='admin'&&['summary','activity'].includes(next))next='tasks';
  screen = next;
  if(next!=='detail')requestConfirmation=null;
  if(role==='nurse'&&['rooms','requests'].includes(next))nurseList=next;
  $('#phone-app').innerHTML = '';
  formError = '';
  refreshClock();
  renderPhone();
}

function setFormError(message) {
  const error = $('#form-error');
  if (error) { error.textContent = message; error.hidden = false; error.scrollIntoView({block:'nearest'}); }
}

let modalReturnFocus;
function showModal(html) {
  if(!$('#modal-root').innerHTML)modalReturnFocus=document.activeElement;
  $('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button>${html}</section></div>`;
  $('.modal button, .modal input, .modal select')?.focus();
}
function closeModal(){ $('#modal-root').innerHTML='';pendingStart=null;estimateJobId=null;modalReturnFocus?.focus(); }
function textAreaField(id,name,title,value='',{max=600,rows=3,required=false}={}) {
  return `<div class="form-field"><div class="field-label-row"><label for="${id}">${title}${required?'':' <span class="optional-label">(optional)</span>'}</label><button type="button" class="dictation-button" data-dictate="${id}" title="Use keyboard dictation">${icon('mic',16)} Dictate</button></div><textarea id="${id}" name="${name}" rows="${rows}" maxlength="${max}" ${required?'required':''} placeholder="Type or use your keyboard’s microphone.">${esc(value)}</textarea></div>`;
}
const unitOptions=(selected,allLabel='All units')=>`<option value="all">${allLabel}</option>${Object.keys(state.settings.floor_instructions).map(u=>`<option value="${u}" ${selected===u?'selected':''}>${u}</option>`).join('')}`;
const currentReport=()=>state.reports.find(r=>r.id===selectedReport);
const reportTarget=r=>r.room_id?`Room ${r.room_id}`:r.unit?`${r.unit} · general issue`:'General issue · all units';
const reportStatus=r=>`<span class="report-status ${r.status}">${({open:'Open',reviewed:'Reviewed',resolved:'Resolved'})[r.status]}</span>`;
function beginReport(jobId=null) {
  reportReturn={role,screen,selectedRoom,selectedTask};reportDraft={description:'',unit:''};reportSearch='';reportHasMenu=!jobId;
  if(jobId){const job=state.jobs.find(j=>j.id===jobId);reportContext={job_id:job.id,room_id:job.room_id};reportFormBack='picker';navigate('report-form');}
  else {reportContext=null;navigate(reportHasMenu?'report-menu':'report-picker');}
}
function returnFromReport() {
  const back=reportReturn||{role,screen:role==='nurse'?'rooms':'tasks'};role=back.role;selectedRoom=back.selectedRoom;selectedTask=back.selectedTask;reportReturn=null;reportContext=null;reportHasMenu=false;navigate(back.screen);
}
function reportPickerOptions() {
  const q=reportSearch.trim().toLowerCase(),matches=j=>`${j.room_id} ${roomFor(j).unit}`.toLowerCase().includes(q);
  const open=state.jobs.filter(j=>['queued','assigned','cleaning'].includes(j.status)&&matches(j)).sort((a,b)=>Domain.taskOrder(a,b,now()));
  const completed=state.jobs.filter(j=>j.status==='complete'&&matches(j)).sort((a,b)=>b.completed_at-a.completed_at).slice(0,20);
  const card=j=>`<button class="report-source-card" data-report-task="${j.id}"><span><strong>Room ${j.room_id}</strong><small>${roomFor(j).unit} · ${j.status==='complete'?cleanedStamp(j.completed_at):'Requested '+dateTime(j.requested_at)}</small></span>${j.status==='complete'?'':badge(j.status)}</button>`;
  const known=new Set([...open,...completed].map(j=>j.room_id));
  const other=q?state.rooms.filter(r=>`${r.id} ${r.unit}`.toLowerCase().includes(q)&&!known.has(r.id)):[];
  return `${open.length?`<h2 class="section-label">Open work orders</h2><div class="task-list">${open.map(card).join('')}</div>`:''}${completed.length?`<h2 class="section-label">Recently cleaned</h2><div class="task-list">${completed.map(card).join('')}</div>`:''}${other.length?`<h2 class="section-label">Other rooms</h2><div class="task-list">${other.map(r=>`<button class="report-source-card" data-report-room="${r.id}"><span><strong>Room ${r.id}</strong><small>${r.unit}</small></span></button>`).join('')}</div>`:''}${!open.length&&!completed.length&&!other.length?'<p class="filter-empty">No matching work orders. Search for a room, or report a general issue.</p>':''}`;
}
function reportMenu() {
  return `<div class="app-content"><div class="report-choices"><button class="secondary full" data-action="report-general">Report a general issue</button><button class="secondary full" data-action="report-specific">Report an issue with a specific job</button></div></div>`;
}
function reportPicker() {
  return `<div class="app-content">${!reportHasMenu?'<button class="secondary full" data-action="report-general">Report a general issue</button>':''}<div class="form-field report-search"><label for="report-room-search">Report an issue with a specific job</label><input id="report-room-search" type="search" value="${esc(reportSearch)}" placeholder="Room number or unit"></div><div id="report-options">${reportPickerOptions()}</div></div>`;
}
function reportForm() {
  const j=reportContext?.job_id?state.jobs.find(j=>j.id===reportContext.job_id):null,r=reportContext?.room_id?state.rooms.find(r=>r.id===reportContext.room_id):null;
  return `<div class="app-content"><div class="report-context"><strong>${r?'Room '+r.id:'General issue'}</strong><span>${r?r.unit:'No room or work order required'}</span>${j?.status==='complete'?`<p class="cleaned-on">${cleanedStamp(j.completed_at)}</p><p class="cleaned-by">Cleaned by ${esc(workerFor(j)?.name||'EVS')}</p>`:j?badge(j.status):''}</div><form id="report-form"><div id="form-error" class="form-error" role="alert" hidden></div>${!r?`<div class="form-field"><label for="report-unit">Which unit? <span class="optional-label">(optional)</span></label><select id="report-unit" name="unit"><option value="">All units / general</option>${Object.keys(state.settings.floor_instructions).map(u=>`<option ${reportDraft.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>`:''}${textAreaField('report-description','description','What is the problem?',reportDraft.description,{max:1200,rows:5,required:true})}</form></div><div class="app-bottom"><button class="primary full" type="submit" form="report-form">Send report</button></div>`;
}

function feedbackFilters(){return {status:feedbackFilter,unit:feedbackUnit,timeframe:feedbackTimeframe};}
function displayedReports(){return Domain.filteredReports(state,feedbackFilters());}
function timeframeOptions(value){return Object.entries(Domain.TIMEFRAMES).map(([id,title])=>`<option value="${id}" ${id===value?'selected':''}>${title}</option>`).join('');}
function feedbackRows() {
  const reports=displayedReports();return reports.map(r=>`<button class="feedback-card" data-view-report="${r.id}"><span class="task-title-row"><strong>${esc(reportTarget(r))}</strong>${reportStatus(r)}</span><small>${dateTime(r.at)} · ${esc(r.reporter_name)}${r.sample?' · Example':''}</small><p>${esc(r.description)}</p><span class="category-label">${state.categories[r.category]} · ${r.id}</span></button>`).join('')||'<p class="filter-empty">No matching reports.</p>';
}
function feedbackView() {
  const count=displayedReports().length;
  return `<div class="app-content"><div class="segmented small-segments">${['open','reviewed','resolved','all'].map(id=>`<button data-feedback-filter="${id}" class="${feedbackFilter===id?'selected':''}">${id[0].toUpperCase()+id.slice(1)}</button>`).join('')}</div><div class="filter-pair"><label><span class="visually-hidden">Report unit</span><select id="feedback-unit">${unitOptions(feedbackUnit)}</select></label><label><span class="visually-hidden">Report timeframe</span><select id="feedback-timeframe">${timeframeOptions(feedbackTimeframe)}</select></label></div><button class="primary full summarize-entry" data-action="summarize-feedback" ${count?'':'disabled'}>Summarize displayed reports</button><p class="scope-caption">${count} report${count===1?'':'s'} shown · ${Domain.TIMEFRAMES[feedbackTimeframe]}</p><div id="feedback-list" class="task-list">${feedbackRows()}</div></div>${!state.settings.sample_feedback_loaded?'<div class="app-bottom"><button class="secondary full" data-action="sample-feedback">Load sample feedback</button></div>':''}${adminNav()}`;
}

function feedbackDetail() {
  const r=currentReport();if(!r)return `<div class="app-content">Report not found.</div>${adminNav()}`;
  return `<div class="app-content"><p class="meta-line"><strong>${esc(reportTarget(r))}</strong>${reportStatus(r)}</p>${r.sample?'<p class="example-note">Example report for demonstration</p>':''}<dl class="detail-grid"><dt>Reported</dt><dd>${dateTime(r.at)}</dd><dt>Reported by</dt><dd>${esc(r.reporter_name)} (${r.reporter_role==='nurse'?'Nurse':'EVS'})</dd><dt>Topic</dt><dd>${state.categories[r.category]}</dd><dt>Reference</dt><dd>${r.id}${r.job_id?' · '+r.job_id:''}</dd></dl><section class="info-block instructions-note"><h2>What is the problem?</h2><p>${esc(r.description)}</p></section><div class="form-field"><label for="report-status">Review status</label><select id="report-status">${['open','reviewed','resolved'].map(id=>`<option value="${id}" ${r.status===id?'selected':''}>${id[0].toUpperCase()+id.slice(1)}</option>`).join('')}</select></div>${r.job_id?`<button class="secondary full" data-admin-task="${r.job_id}">View work order</button>`:''}</div>${adminNav()}`;
}
function assignmentNotice() {
  const notes=Domain.unreadAssignments(state,selectedWorker);if(!notes.length)return '';
  return `<section class="assignment-notice" role="status"><strong>New assignment${notes.length===1?'':'s'}</strong>${notes.map(n=>`<p>${esc(n.message)}</p>`).join('')}<button class="text-button" data-action="dismiss-assignments">Dismiss</button></section>`;
}
let assignmentToastSignatures={};
function notifyWorker() {
  const notes=Domain.unreadAssignments(state,selectedWorker),signature=notes.map(n=>n.id).join(',');
  if(notes.length&&assignmentToastSignatures[selectedWorker]!==signature){assignmentToastSignatures[selectedWorker]=signature;toast(notes.length===1?notes[0].message:`You have been assigned ${notes.length} jobs.`);}
}
function assignmentView() {
  const job=state.jobs.find(j=>j.id===assignmentJobId);if(!job)return `<div class="app-content">Task not found.</div>${adminNav()}`;
  const workers=assignmentFilter==='available'?Domain.availableWorkers(state):state.workers;
  return `<div class="app-content"><p class="meta-line"><strong>Room ${job.room_id}</strong>${badge(job.status)}</p><div class="segmented employee-filter"><button data-assignment-filter="available" class="${assignmentFilter==='available'?'selected':''}">Available workers</button><button data-assignment-filter="all" class="${assignmentFilter==='all'?'selected':''}">All workers</button></div><div class="task-list">${workers.map(w=>{
    const active=state.jobs.find(j=>j.worker_id===w.id&&j.status==='cleaning'),assigned=state.jobs.filter(j=>j.worker_id===w.id&&j.status==='assigned').length;
    const capable=job.ppe.every(p=>w.ppe.includes(p)),current=job.worker_id===w.id&&job.status==='assigned';
    return `<button class="employee-card" data-assign-worker="${w.id}" ${!capable||current?'disabled':''}><span><strong>${w.name}</strong><small>${active?'Cleaning Room '+active.room_id:'Available now'}${assigned?' · '+assigned+' assigned':''}</small>${!capable?'<small>Required PPE coverage unavailable</small>':''}</span><span class="employee-action">${current?'Assigned':'Assign'}</span></button>`;
  }).join('')||'<p class="filter-empty">Every employee is currently cleaning. Choose All workers to assign a queued task.</p>'}</div></div>${adminNav()}`;
}
const currentFeedbackSummary=()=>state.feedback_summaries.find(s=>s.id===selectedFeedbackSummary);
function sourceReportLinks(ids) {
  return ids.map(id=>{const r=state.reports.find(v=>v.id===id);return `<button class="source-link" data-view-report="${id}">${id} · ${r.sample?'Example · ':''}${esc(reportTarget(r))} · ${dateTime(r.at)}</button>`;}).join('');
}
function feedbackSummaryView() {
  const summary=currentFeedbackSummary();if(!summary)return `<div class="app-content">Summarize reports from Feedback first.</div>${adminNav()}`;
  return `<div class="app-content"><p class="meta-line"><strong>${summary.report_ids.length} displayed report${summary.report_ids.length===1?'':'s'}</strong></p><p class="scope-caption">${Domain.TIMEFRAMES[summary.filters.timeframe]} · ${summary.filters.unit==='all'?'All units':summary.filters.unit} · ${summary.filters.status==='all'?'All statuses':summary.filters.status[0].toUpperCase()+summary.filters.status.slice(1)}</p><p class="supporting-text simulation-note">(Simulated; no AI model currently connected)</p><section class="report-summary-text" aria-label="Summary of displayed reports">${summary.paragraphs.map(text=>`<p>${esc(text)}</p>`).join('')}</section><details class="summary-sources"><summary>View source reports (${summary.report_ids.length})</summary>${sourceReportLinks(summary.report_ids)}</details></div>${adminNav()}`;
}
async function summarizeDisplayedReports() {
  if(await mutate('summarize-feedback',{filters:feedbackFilters()},'Displayed reports summarized')){
    selectedFeedbackSummary=state.feedback_summaries.at(-1).id;navigate('feedback-summary');
  }
}

function openEstimate(jobId) {
  const j=state.jobs.find(j=>j.id===jobId);estimateJobId=j.id;
  const remaining=j.status==='cleaning',minutes=remaining?Math.max(1,Math.ceil((j.forecast_finish-now())/Domain.MINUTE)):Domain.expectedMinutes(j);
  const atLeast=remaining?j.forecast_at_least:j.expected_at_least,selected=atLeast||minutes>=60?'60+':String(Math.max(10,Math.ceil(minutes/10)*10));
  showModal(`<h2 id="modal-title">${remaining?'How many minutes remain?':'How long will cleaning take?'}</h2><form id="estimate-form"><div class="form-field"><label for="estimate-minutes">Minutes</label><select id="estimate-minutes" name="minutes" class="estimate-picker" size="4" required>${['10','20','30','40','50','60+'].map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v} minutes</option>`).join('')}</select></div>${textAreaField('estimate-reason','reason','Why is the estimate changing?','',{max:600})}<button class="primary full" type="submit">Update estimate</button></form>`);
}
function handoffChoices() {
  const previous=state.jobs.find(j=>j.id===pendingStart?.previous_job_id);if(!previous)return;
  showModal(`<h2 id="modal-title">Is Room ${previous.room_id} finished?</h2><p>Confirm the previous cleaning before starting another room.</p><div class="handoff-choices"><button class="primary full" data-action="handoff-finished">Yes, finished</button><button class="secondary full" data-action="handoff-still">Still cleaning</button><button class="secondary full" data-action="handoff-unfinished">Couldn’t finish</button></div>`);
}
function handoffForm(resolution) {
  pendingStart.resolution=resolution;const previous=state.jobs.find(j=>j.id===pendingStart.previous_job_id);
  showModal(`<h2 id="modal-title">${resolution==='complete'?'Confirm completion':'Report unfinished cleaning'}</h2><p>Room ${previous.room_id}</p><form id="handoff-form">${resolution==='complete'?`<fieldset><legend>When was it finished?</legend><div class="choice-grid"><label class="choice"><input id="finish-now" name="finish_mode" type="radio" value="now" checked>Just now</label><label class="choice"><input id="finish-earlier" name="finish_mode" type="radio" value="earlier">Earlier</label></div></fieldset><div id="handoff-time" class="form-field" hidden><label for="completion-time">Actual completion time</label><input id="completion-time" name="completed_at" type="datetime-local" value="${localInputTime(now())}" min="${localInputTime(previous.started_at)}" max="${localInputTime(now())}" required disabled></div>`:textAreaField('handoff-reason','reason','What prevented completion?','',{max:600,required:true})}<button class="primary full" type="submit">${resolution==='complete'?'Mark done & start next':'Report & start next'}</button><button class="text-button full" type="button" data-action="handoff-back">Back</button></form>`);
}
document.addEventListener('click',async(e)=>{
  const el=e.target.closest('button');if(!el||busy||el.disabled)return;
  if(el.dataset.dictate){$('#'+el.dataset.dictate)?.focus();toast('Use the microphone on your device’s keyboard to dictate, or type here.');return;}
  if(el.dataset.demo){closeModal();enterDemo(el.dataset.demo);return;}
  if(el.dataset.action==='main-menu'){closeModal();enterDemo('menu');return;}
  if(el.dataset.filter){statusFilter=el.dataset.filter;renderRoomList();return;}
  if(el.dataset.requestTab){requestsTab=el.dataset.requestTab;if(requestsTab==='completed')await mutate('seen-completions',{},'');render();return;}
  if(el.dataset.screen){if(role==='nurse'&&el.dataset.screen==='requests'&&requestsTab==='completed')await mutate('seen-completions',{},'');navigate(el.dataset.screen);return;}
  if(el.dataset.adminScreen){navigate(el.dataset.adminScreen);return;}
  if(el.dataset.feedbackFilter){feedbackFilter=el.dataset.feedbackFilter;renderPhone();return;}
  if(el.hasAttribute('data-back-tasks')){selectedTask=null;navigate('tasks');return;}
  if(el.dataset.room){selectedRoom=el.dataset.room;editingJob=null;navigate(jobForRoom(selectedRoom)?'detail':'form');return;}
  if(el.dataset.task||el.dataset.adminTask){selectedTask=el.dataset.task||el.dataset.adminTask;if(role==='evs')await mutate('seen-assignments',{job_id:selectedTask},'');navigate('task');return;}
  if(el.dataset.reportTask||el.dataset.reportRoom){const j=el.dataset.reportTask?state.jobs.find(j=>j.id===el.dataset.reportTask):null;reportContext={job_id:j?.id||null,room_id:j?.room_id||el.dataset.reportRoom};reportFormBack='picker';navigate('report-form');return;}
  if(el.dataset.viewReport){reportAdminReturn=screen==='feedback-summary'?screen:'feedback';selectedReport=el.dataset.viewReport;navigate('feedback-report');return;}
  const action=el.dataset.action,id=el.dataset.job;
  if(action==='begin-report'){beginReport(id);return;}
  if(action==='report-specific'){navigate('report-picker');return;}
  if(action==='report-general'){reportContext={job_id:null,room_id:null};reportFormBack=screen==='report-menu'?'menu':'picker';navigate('report-form');return;}
  if(action==='report-back'){if(screen==='report-form')navigate(reportFormBack==='menu'?'report-menu':'report-picker');else if(screen==='report-picker'&&reportHasMenu)navigate('report-menu');else returnFromReport();return;}
  if(action==='new-request'){editingJob=null;selectedRoom=el.dataset.roomId||selectedRoom;navigate('form');}
  if(action==='edit-request'){editingJob=id;selectedRoom=state.jobs.find(j=>j.id===id).room_id;navigate('edit');}
  if(action==='release-job'&&await mutate('release',{job_id:id},'Job returned to requested tasks'))render();
  if(action==='choose-employee'){assignmentJobId=id;assignmentFilter='available';navigate('assign-worker');}
  if(el.dataset.assignmentFilter){assignmentFilter=el.dataset.assignmentFilter;renderPhone();return;}
  if(el.dataset.assignWorker){const worker=state.workers.find(w=>w.id===el.dataset.assignWorker);if(await mutate('assign',{job_id:assignmentJobId,worker_id:worker.id},`Assigned to ${worker.name}. A message is waiting in their demo.`)){selectedTask=null;assignmentJobId=null;navigate('tasks');}return;}
  if(action==='dismiss-assignments'&&await mutate('seen-assignments',{},''))renderPhone();
  if(action==='admin-unassign'&&await mutate('unassign',{job_id:id},'Returned to available tasks'))render();
  if(action==='start'){
    if(!$('#ppe-confirmed')?.checked)return toast('Confirm the PPE and room instructions first.',true);
    const other=state.jobs.find(j=>j.id!==id&&j.worker_id===selectedWorker&&j.status==='cleaning');
    if(other){pendingStart={previous_job_id:other.id,next_job_id:id,ppe_confirmed:true};handoffChoices();return;}
    if(await mutate('start',{job_id:id,ppe_confirmed:true},'Cleaning started'))render();
  }
  if(action==='complete-job'&&await mutate('complete',{job_id:id,checks_confirmed:true},'Room marked cleaned')){selectedTask=null;navigate('tasks');render();}
  if(action==='cancel-request')showModal(`<h2 id="modal-title">Cancel this request?</h2><p>This withdraws the cleaning request. Any earlier cleaning timestamp is kept.</p><div class="control-row"><button class="secondary" data-action="close-modal">Keep request</button><button class="danger-btn" data-action="confirm-cancel" data-job="${id}">Cancel request</button></div>`);
  if(action==='confirm-cancel'&&await mutate('cancel',{job_id:id},'Request cancelled')){closeModal();navigate(nurseList);}
  if(action==='close-modal')closeModal();
  if(action==='estimate-dialog')openEstimate(id);
  if(action==='handoff-finished')handoffForm('complete');
  if(action==='handoff-unfinished')handoffForm('release');
  if(action==='handoff-back')handoffChoices();
  if(action==='handoff-still'){const previous=pendingStart.previous_job_id;closeModal();selectedTask=previous;navigate('task');}
  if(action==='sample-feedback'&&await mutate('sample-feedback',{},'Example reports loaded'))render();
  if(action==='summarize-feedback')await summarizeDisplayedReports();

});
document.addEventListener('change',async(e)=>{
  const el=e.target;
  if(el.id==='bold-colours'){colourScheme=el.checked?'bold':'original';applyColourScheme();return;}
  if(el.id==='unit-filter'){roomUnit=el.value;renderRoomList();}
  if(el.id==='ppe-confirmed')updateStartButton();
  if(el.id==='availability-option'){updateAvailabilityFields();if(el.value==='custom')ensureAvailabilityVisible();}
  if(el.id==='defaults-unit'){adminUnit=el.value;$('#floor-instructions').value=state.settings.floor_instructions[adminUnit];if($('#form-error'))$('#form-error').hidden=true;}
  if(el.id==='auto-assign')await mutate('automatic',{enabled:el.checked},'Assignment setting updated');
  if(el.id==='report-unit')reportDraft.unit=el.value;
  if(el.id==='feedback-unit'){feedbackUnit=el.value;renderPhone();}
  if(el.id==='feedback-timeframe'){feedbackTimeframe=el.value;renderPhone();}
  if(el.id==='report-status'&&await mutate('report-status',{report_id:selectedReport,status:el.value},'Report updated'))render();
  if(el.id==='demo-worker'&&await mutate('select-worker',{worker_id:el.value},'')){selectedWorker=state.settings.user_worker_id;selectedTask=null;navigate('tasks');notifyWorker();}
  if(['finish-now','finish-earlier'].includes(el.id)){const earlier=el.id==='finish-earlier'&&el.checked;$('#handoff-time').hidden=!earlier;$('#completion-time').disabled=!earlier;}
});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='room-search'){roomSearch=el.value;renderRoomList();}
  if(el.id==='report-room-search'){reportSearch=el.value;$('#report-options').innerHTML=reportPickerOptions();}
  if(el.id==='report-description')reportDraft.description=el.value;
});
document.addEventListener('submit',async(e)=>{
  const supported=['request-form','floor-instructions-form','report-form','estimate-form','handoff-form'];if(!supported.includes(e.target.id))return;e.preventDefault();const f=new FormData(e.target);
  if(e.target.id==='report-form'){
    const payload={reporter_role:role,job_id:reportContext?.job_id||null,room_id:reportContext?.room_id||null,unit:f.get('unit')||null,description:f.get('description')};
    if(await mutate('report',payload,'Issue report recorded'))returnFromReport();return;
  }
  if(e.target.id==='estimate-form'){
    if(await mutate('estimate',{job_id:estimateJobId,minutes:f.get('minutes')==='60+'?60:Number(f.get('minutes')),at_least:f.get('minutes')==='60+',reason:f.get('reason')||''},'Estimate updated')){closeModal();render();}return;
  }
  if(e.target.id==='handoff-form'){
    if(!pendingStart)return;const payload={...pendingStart,reason:f.get('reason')||''};
    if(payload.resolution==='complete'&&f.get('finish_mode')==='earlier')payload.completed_at=new Date(f.get('completed_at')||'').getTime();
    if(await mutate('handoff',payload,'Previous task recorded; next cleaning started')){const next=payload.next_job_id;closeModal();selectedTask=next;navigate('task');}return;
  }
  if(e.target.id==='floor-instructions-form'){
    if(await mutate('floor-instructions',{unit:f.get('unit'),instructions:f.get('instructions')},'Floor instructions saved'))render();return;
  }
  const editing=screen==='edit',previous=editing?state.jobs.find(j=>j.id===editingJob):null,roomId=previous?previous.room_id:f.get('room_id');
  const payload={job_id:editingJob,room_id:roomId,cleaning_class:f.get('cleaning_class'),priority:f.get('priority'),ppe:f.getAll('ppe'),notes:f.get('notes')};
  if(previous?.status!=='cleaning'){
    const option=f.get('availability_option')||'now';payload.availability_mode=option==='now'?'now':'later';
    if(option==='custom'){
      const value=f.get('available_from')||'';
      payload.available_from=previous?.availability_mode==='later'&&value===localInputTime(previous.available_from)?previous.available_from:new Date(value).getTime();
    }
    else if(option!=='now'){const offset=Number(option);payload.available_from=[15,30,45,60].includes(offset)?Date.now()+offset*Domain.MINUTE:NaN;}
  }
  if(await mutate(editing?'edit':'request',payload,editing?'Request updated':'Request sent')){selectedRoom=roomId;requestConfirmation=editing?null:jobForRoom(roomId)?.id;editingJob=null;navigate('detail');render();}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();const modal=$('.modal');if(modal&&e.key==='Tab'){
    const els=[...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled),first=els[0],last=els.at(-1);if(!first)return;
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});

// The same build works from file://, localhost, and a GitHub Pages subdirectory.
function fitViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale !== 1) return;
  document.documentElement.style.setProperty('--app-height', `${viewport?.height || window.innerHeight}px`);
}
if (typeof window !== 'undefined') {
  fitViewport();
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
}
function initialize() {
  applyColourScheme();
  simulation = Domain.newState();
  state = Domain.snapshot(simulation);
  render();
}
initialize();
// Updating text nodes keeps estimates live without replacing inputs or scroll position.
function refreshClock() {
  if(!simulation)return;
  const previousDay=localInputTime(now()).slice(0,10);
  state=Domain.snapshot(simulation);
  if(previousDay!==localInputTime(now()).slice(0,10)&&role==='admin'&&screen==='feedback')renderPhone();
  $('#phone-time').textContent=time(now());
  for(const el of document.querySelectorAll('[data-estimate]')) {
    const job=state.jobs.find(j=>j.id===el.dataset.estimate);
    if(job)el.textContent=(el.dataset.estimatePrefix||'')+estimate(job);
  }
  updateStartButton();
}
setInterval(refreshClock,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshClock();});
