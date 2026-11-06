'use strict';
const Domain = globalThis.EVSyncDomain;
let simulation = null;
let state = null;
let role = 'menu';
let screen = 'menu';
let selectedRoom = null;
let editingJob = null;
const selectedWorker = Domain.USER_WORKER_ID;
let selectedTask = null;
let roomSearch = '';
let roomUnit = 'all';
let statusFilter = 'all';
let busy = false;
let formError = '';
let toastTimer;

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = (n) => String(n).padStart(2,'0');
const time = (n) => n == null ? 'Awaiting acceptance' : `${pad(new Date(n).getHours())}:${pad(new Date(n).getMinutes())}`;
const dateTime = (n) => n == null ? '' : `${time(n)}, ${pad(new Date(n).getMonth()+1)}/${pad(new Date(n).getDate())}`;
const asOf = (n) => n == null ? '' : `As of ${dateTime(n)}`;
const cleanedStamp = (n) => `<time datetime="${new Date(n).toISOString()}">${asOf(n)}</time>`;
const estimate = (job) => job.window_conflict ? 'Outside availability window' : job.estimated_finish == null ? 'Awaiting acceptance' : dateTime(job.estimated_finish);
const localInputTime = (n) => `${new Date(n).getFullYear()}-${pad(new Date(n).getMonth()+1)}-${pad(new Date(n).getDate())}T${time(n)}`;
const availabilityText = (job) => job.availability_mode==='now'?'Now':`${dateTime(job.available_from)}${job.available_until==null?' onward':' – '+dateTime(job.available_until)}`;
const availabilityRow = (job) => `<dt>Available</dt><dd>${esc(availabilityText(job))}</dd>`;
const scheduledLabel = (job) => job.availability_mode==='later'?`<span class="task-window">From ${dateTime(job.available_from)}${job.available_until==null?'':' · until '+dateTime(job.available_until)}</span>`:'';
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
  list:'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1'
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
    toast(message);
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

function appHeader() {
  if(role==='menu')return '<header class="app-header"><h1>Choose a demo</h1></header>';
  if(role==='evs'||role==='admin') {
    const identity=role==='evs'?'Maya Chen':'EVS Admin';
    const title=role==='evs'?'Cleaning tasks':'EVS Admin';
    return `<header class="app-header">${screen==='task'?`<button class="back-button" data-back-tasks>${icon('back',16)} Tasks</button>`:`<h1>${title}</h1>`}${role==='evs'?`<span class="identity-label">${identity}</span>`:''}</header>`;
  }
  const title=screen==='edit'?'Edit request':screen==='form'?'Request cleaning':screen==='detail'?`Room ${selectedRoom}`:screen==='requests'?'Requests':'Rooms';
  const back=['form','edit','detail'].includes(screen);
  return `<header class="app-header">${back?`<div class="header-title"><button class="back-button" data-screen="${screen==='edit'?'detail':'rooms'}">${icon('back',16)} Back</button><h1>${title}</h1></div>`:`<h1>${title}</h1>`}</header>`;
}

function nurseNav() {
  return `<nav class="app-nav" aria-label="Nurse navigation"><button data-screen="rooms" class="${screen === 'rooms' ? 'selected' : ''}" ${screen === 'rooms' ? 'aria-current="page"' : ''}>${icon('rooms')} Rooms</button><button data-screen="requests" class="${screen === 'requests' ? 'selected' : ''}" ${screen === 'requests' ? 'aria-current="page"' : ''}>${icon('list')} Requests</button></nav>`;
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
  const timestamp=status==='cleaned'?`<small class="cleaned-at">${cleanedStamp(room.last_cleaned_at)}</small>`:'';
  const eta=job?.estimated_finish != null ? `<small class="eta" data-estimate="${job.id}" data-estimate-prefix="Est. finish ">Est. finish ${estimate(job)}</small>` : '';
  return `<button class="room-card" data-room="${room.id}" aria-label="Room ${room.id}${label(status)?', '+label(status):''}${status==='cleaned'?', '+asOf(room.last_cleaned_at):''}"><span class="room-info"><strong>Room ${room.id}</strong><small>${room.unit}</small>${job?.priority === 'urgent' ? '<small class="priority-label">Urgent</small>' : ''}</span>${status==='unknown'?'':`<span class="room-state">${badge(status)}${timestamp}${job?.availability_mode==='later'?`<small class="availability-card">From ${dateTime(job.available_from)}</small>`:''}${eta}</span>`}</button>`;
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
  const order={cleaning:0,queued:1,assigned:1,complete:2};
  const jobs=state.jobs.filter(j=>j.status!=='cancelled').sort((a,b)=>order[a.status]-order[b.status]||Number(a.room_id)-Number(b.room_id)||b.requested_at-a.requested_at||b.id.localeCompare(a.id));
  return `<div class="app-content"><div class="request-list">${jobs.map(j => `<button class="job-list-card" data-room="${j.room_id}" aria-label="Room ${j.room_id}, ${label(j.status)}"><span class="room-info"><strong>Room ${j.room_id}</strong><small>${state.classes[j.cleaning_class].label} · ${dateTime(j.requested_at)}</small>${j.priority === 'urgent' ? '<small class="priority-label">Urgent</small>' : ''}</span><span class="room-state">${badge(j.status)}${j.status === 'complete' ? `<small class="cleaned-at">${cleanedStamp(j.completed_at)}</small>` : j.estimated_finish != null ? `<small class="eta" data-estimate="${j.id}" data-estimate-prefix="Est. finish ">Est. finish ${estimate(j)}</small>` : ''}</span></button>`).join('') || '<p class="filter-empty">No requests.</p>'}</div></div><div class="app-bottom"><button class="primary full" data-action="new-request">${icon('plus')} Request cleaning</button></div>${nurseNav()}`;
}

function ppeChips(job) {
  if(!job.ppe.length)return '<p class="supporting-text">No PPE required</p>';
  return `<div class="ppe-chips">${job.ppe.map(p => `<span class="ppe-chip">${esc(p)}</span>`).join('')}</div>`;
}
function requestDetails(job) {
  const equipment=Domain.equipmentInstructions(job);
  return `<section class="info-block"><h2>Required PPE</h2>${ppeChips(job)}</section>${equipment ? `<section class="info-block equipment-note"><h2>Equipment instructions</h2><p>${esc(equipment)}</p></section>` : ''}${job.notes ? `<section class="info-block"><h2>Nurse’s note</h2><p>${esc(job.notes)}</p></section>` : ''}`;
}

function nurseDetail() {
  const room=state.rooms.find(r=>r.id===selectedRoom),job=jobForRoom(room.id),status=roomStatus(room),worker=workerFor(job);
  return `<div class="app-content"><p class="meta-line"><span>${room.unit}</span>${badge(status)}</p>${job?`<dl class="detail-grid"><dt>Estimated finish</dt><dd class="estimate-value" data-estimate="${job.id}">${estimate(job)}</dd>${availabilityRow(job)}<dt>Worker</dt><dd>${worker?esc(worker.name):'Awaiting assignment'}</dd><dt>Cleaning</dt><dd>${state.classes[job.cleaning_class].label}</dd><dt>Priority</dt><dd>${job.priority==='urgent'?'Urgent':'Routine'}</dd></dl>${requestDetails(job)}<div class="paired-actions"><button class="secondary" data-action="edit-request" data-job="${job.id}">Edit</button><button class="danger-btn" data-action="cancel-request" data-job="${job.id}">Cancel</button></div>`:status==='cleaned'?`<p class="last-cleaned">${cleanedStamp(room.last_cleaned_at)}</p>`:''}</div>${!job?`<div class="app-bottom"><button class="primary full" data-action="new-request" data-room-id="${room.id}">Request cleaning</button></div>`:''}${nurseNav()}`;
}

function requestForm() {
  const job=screen==='edit'?state.jobs.find(j=>j.id===editingJob):null;
  const rooms=Domain.sortedRooms(state,state.rooms.filter(r=>r.id===job?.room_id||!jobForRoom(r.id)));
  if (!rooms.length) return `<div class="app-content"><p>No rooms available for a new request.</p><p class="supporting-text">Every room already has an active request.</p></div>${nurseNav()}`;
  const room=rooms.find(r=>r.id===(job?.room_id||selectedRoom))||rooms[0],priority=job?.priority||'routine';
  const mode=job?.availability_mode||'now',locked=job?.status==='cleaning';
  const from=job?.availability_mode==='later'?job.available_from:Math.ceil((Date.now()+30*Domain.MINUTE)/(5*Domain.MINUTE))*5*Domain.MINUTE;
  const until=job?.availability_mode==='later'?job.available_until:from+60*Domain.MINUTE;
  const floor=Domain.floorDefaults(room.unit);
  return `<div class="app-content"><form id="request-form"><div id="form-error" class="form-error" role="alert" ${formError ? '' : 'hidden'}>${esc(formError)}</div>
    <div class="form-field"><label for="request-room">Room</label><select id="request-room" name="room_id" required ${job?'disabled':''}>${rooms.map(r => `<option value="${r.id}" ${r.id===room.id?'selected':''}>${r.id} · ${r.unit}</option>`).join('')}</select></div>
    <fieldset class="availability-choice" ${locked?'disabled':''}><legend>Available for cleaning</legend><div class="choice-grid">${['now','later'].map(value=>`<label class="choice"><input id="availability-${value}" type="radio" name="availability_mode" value="${value}" ${mode===value?'checked':''}>${value==='now'?'Now':'Later'}</label>`).join('')}</div>
      <fieldset id="availability-fields" class="availability-fields" ${mode==='now'?'hidden':''} ${mode==='now'||locked?'disabled':''}>
        <div class="form-field"><label for="available-from">From</label><input id="available-from" name="available_from" type="datetime-local" value="${localInputTime(from)}" min="${localInputTime(Math.min(Date.now(),from))}" required></div>
        <div class="form-field"><label for="available-until">Until <span class="optional-label">(optional)</span></label><input id="available-until" name="available_until" type="datetime-local" value="${until==null?'':localInputTime(until)}"></div>
        <p class="supporting-text">Cleaning must fit within the window. Leave Until blank for no end time.</p>
      </fieldset>${locked?'<p class="supporting-text">The time window is fixed after cleaning starts.</p>':''}</fieldset>
    <div class="form-field"><label for="cleaning-class">Cleaning class</label><select id="cleaning-class" name="cleaning_class">${Object.entries(state.classes).map(([id,c]) => `<option value="${id}" ${id===(job?.cleaning_class||'standard')?'selected':''}>${c.label} (${state.settings.durations[id]} min)</option>`).join('')}</select></div>
    <fieldset><legend>Priority</legend><div class="choice-grid">${['routine','urgent'].map(value=>`<label class="choice"><input type="radio" name="priority" value="${value}" ${priority===value?'checked':''}>${value==='urgent'?'Urgent':'Routine'}</label>`).join('')}</div></fieldset>
    <fieldset><legend>PPE requirements <span class="optional-label">(optional)</span></legend><div class="choice-grid">${state.ppe_options.map(p => `<label class="choice"><input type="checkbox" name="ppe" value="${esc(p)}" ${job?.ppe.includes(p)?'checked':''}>${esc(p)}</label>`).join('')}</div></fieldset>
    <details id="request-extra-fields" class="extra-fields" ${job?.equipment||job?.notes||job?.use_floor_defaults?'open':''}><summary id="request-extra-summary">Equipment instructions & notes <span class="optional-label">(optional)</span></summary><div id="request-extras" class="request-extras">
      <label id="floor-default-options" class="check-line floor-default-choice" ${floor.equipment?'':'hidden'}><input id="use-floor-defaults" name="use_floor_defaults" type="checkbox" ${job?.use_floor_defaults?'checked':''} ${floor.equipment?'':'disabled'}><span><strong>Use floor defaults</strong><span id="floor-default-preview">${esc(floor.equipment)}</span></span></label>
      <div class="form-field"><label for="equipment">Equipment instructions <span class="optional-label">(optional)</span></label><input id="equipment" name="equipment" type="text" maxlength="300" placeholder="Items to retain, clean, or handle separately" value="${esc(job?.equipment||'')}"></div><div class="form-field"><label for="nurse-note">Additional instructions <span class="optional-label">(optional)</span></label><textarea id="nurse-note" name="notes" maxlength="600">${esc(job?.notes||'')}</textarea></div>
    </div></details></form></div><div class="app-bottom"><button type="submit" form="request-form" class="primary full">${job?'Save changes':'Send request'}</button></div>`;
}
function updateFloorDefaults() {
  const room=state.rooms.find(r=>r.id===$('#request-room')?.value),floor=Domain.floorDefaults(room?.unit);
  const wrapper=$('#floor-default-options'),checkbox=$('#use-floor-defaults');
  if(wrapper)wrapper.hidden=!floor.equipment;
  if(checkbox)checkbox.disabled=!floor.equipment;
  if($('#floor-default-preview'))$('#floor-default-preview').textContent=floor.equipment;
}
function updateAvailabilityFields() {
  const fields=$('#availability-fields');if(!fields)return;
  const later=$('#availability-later')?.checked,locked=state.jobs.find(j=>j.id===editingJob)?.status==='cleaning';
  fields.hidden=!later;fields.disabled=!later||locked;
  const from=new Date($('#available-from')?.value||'').getTime();
  const duration=state.settings.durations[$('#cleaning-class')?.value];
  if(Number.isFinite(from)&&duration)$('#available-until').min=localInputTime(from+duration*Domain.MINUTE);
}
function revealSection(id) {
  requestAnimationFrame(()=>{
    if(id==='request-extras'&&!$('#request-extra-fields')?.open)return;
    const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#'+id)?.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'});
  });
}

function mainMenuView() {
  return `<div class="app-content"><div class="demo-options"><button class="demo-option" data-demo="nurse"><span>Nurse Demo</span>${icon('back',20)}</button><button class="demo-option" data-demo="evs"><span>EVS Worker Demo</span>${icon('back',20)}</button><button class="demo-option" data-demo="admin"><span>EVS Admin Demo</span>${icon('back',20)}</button></div></div>`;
}
function taskSummary(job,includePPE=false,admin=false) {
  const room=roomFor(job);
  return `<span class="task-title-row"><strong>Room ${room.id}</strong>${badge(job.status)}</span><span class="task-meta">${room.unit} · ${state.classes[job.cleaning_class].label}</span>${scheduledLabel(job)}${job.priority==='urgent'?'<span class="task-urgency">Urgent</span>':''}${includePPE?`<span class="task-ppe">${job.ppe.length?job.ppe.map(p=>`<span class="ppe-chip">${esc(p)}</span>`).join(''):'<span>No PPE required</span>'}</span>`:''}${admin?`<span class="task-owner">${esc(workerFor(job)?.name||'Unassigned')}</span>`:''}`;
}
function evsView() {
  const tasks=Domain.requestedTasks(state);
  return `<div class="app-content"><div class="task-list">${tasks.map(job=>`<button class="task-card ${job.priority==='urgent'?'urgent':''}" data-task="${job.id}" aria-label="Room ${job.room_id}, ${job.priority==='urgent'?'Urgent, ':''}${label(job.status)}">${taskSummary(job,true)}</button>`).join('')||'<div class="empty-state"><h2>No requested tasks.</h2></div>'}</div></div>`;
}
function currentTask() {return state.jobs.find(j=>j.id===selectedTask);}
function anotherActiveTask(job) {return state.jobs.some(j=>j.id!==job.id&&j.worker_id===selectedWorker&&j.status==='cleaning');}
function evsDetail() {
  const job=currentTask();
  if(!job||!Domain.requestedTasks(state).some(j=>j.id===job.id))return '<div class="app-content"><p>This task is no longer available.</p></div>';
  const accepted=job.status==='assigned',started=job.status==='cleaning';
  return `<div class="app-content"><section class="task-heading ${job.priority==='urgent'?'urgent':''}">${taskSummary(job)}</section>${requestDetails(job)}<dl class="detail-grid"><dt>Cleaning time</dt><dd>${job.duration} min</dd>${availabilityRow(job)}<dt>Estimated finish</dt><dd data-estimate="${job.id}">${estimate(job)}</dd>${started?`<dt>Started</dt><dd>${dateTime(job.started_at)}</dd>`:''}</dl></div><div class="app-bottom worker-action-area">${!started?`<label class="check-line"><input id="ppe-confirmed" type="checkbox"><span>Required PPE and room instructions confirmed</span></label><p id="start-restriction" class="supporting-text task-busy-note" hidden></p>`:''}<div class="worker-actions paired-actions">${accepted||started?`<button class="danger-btn" data-action="release-job" data-job="${job.id}">Cancel job</button>`:`<button class="secondary" data-action="accept-job" data-job="${job.id}">Accept job</button>`}${started?`<button class="primary" data-action="complete-job" data-job="${job.id}">Mark as done</button>`:`<button id="start-job" class="primary" data-action="start" data-job="${job.id}" data-worker="${selectedWorker}" disabled>Start now</button>`}</div></div>`;
}
function adminNav() {
  return `<nav class="app-nav" aria-label="EVS admin navigation"><button data-admin-screen="tasks" class="${screen==='tasks'||screen==='task'?'selected':''}">${icon('list')} Tasks</button><button data-admin-screen="settings" class="${screen==='settings'?'selected':''}">Settings</button></nav>`;
}
function adminTasks() {
  const tasks=state.jobs.filter(j=>['queued','assigned','cleaning'].includes(j.status)).sort(Domain.taskOrder);
  return `<div class="app-content"><div class="task-list">${tasks.map(j=>`<button class="task-card ${j.priority==='urgent'?'urgent':''}" data-admin-task="${j.id}">${taskSummary(j,true,true)}</button>`).join('')||'<p class="supporting-text">No active requests.</p>'}</div></div>${adminNav()}`;
}
function adminSettings() {
  return `<div class="app-content"><section class="settings-section"><label class="setting-row" for="auto-assign"><span>Automatically assign new tasks</span><span class="switch-control"><input id="auto-assign" type="checkbox" role="switch" ${state.settings.automatic_assignment?'checked':''}><span aria-hidden="true"></span></span></label><p class="supporting-text">New tasks are assigned to ${esc(state.workers.find(w=>w.id===selectedWorker).name)} when this is on. Existing tasks keep their current assignments.</p></section></div>${adminNav()}`;
}
function adminDetail() {
  const job=currentTask();if(!job)return '<div class="app-content">Task not found.</div>'+adminNav();
  return `<div class="app-content"><section class="task-heading ${job.priority==='urgent'?'urgent':''}">${taskSummary(job)}</section><dl class="detail-grid"><dt>Worker</dt><dd>${esc(workerFor(job)?.name||'Unassigned')}</dd><dt>Requested</dt><dd>${dateTime(job.requested_at)}</dd>${availabilityRow(job)}<dt>Estimated finish</dt><dd data-estimate="${job.id}">${estimate(job)}</dd></dl>${requestDetails(job)}</div>${job.status==='queued'?`<div class="app-bottom"><button class="primary full" data-action="admin-assign" data-job="${job.id}">Assign to demo worker</button></div>`:job.status==='assigned'?`<div class="app-bottom"><button class="secondary full" data-action="admin-unassign" data-job="${job.id}">Return to available tasks</button></div>`:''}${adminNav()}`;
}
function updateStartButton() {
  const button=$('#start-job'),job=currentTask();
  if(!button)return;
  const issue=!job?'This task is no longer available.':anotherActiveTask(job)?'Finish or cancel your current job before starting another.':Domain.startIssue(state,job);
  button.disabled=!$('#ppe-confirmed')?.checked||!!issue;
  const note=$('#start-restriction');
  if(note){note.textContent=issue+(job&&state.settings.now<job.available_from?' Available from '+dateTime(job.available_from)+'.':'');note.hidden=!issue;}
}

function renderPhone() {
  if(['form','edit'].includes(screen)&&role==='nurse'&&$('#request-form'))return;
  const scroll=$('.app-content')?.scrollTop||0;
  const oldJob=$('[data-action="start"]')?.dataset.job;
  const confirmed=$('#ppe-confirmed')?.checked||false;
  let view;
  if(role==='menu')view=mainMenuView();
  else if(role==='evs')view=screen==='task'?evsDetail():evsView();
  else if(role==='admin')view=screen==='settings'?adminSettings():screen==='task'?adminDetail():adminTasks();
  else view=['form','edit'].includes(screen)?requestForm():screen==='detail'?nurseDetail():screen==='requests'?nurseRequests():nurseRooms();
  $('#phone-app').innerHTML=appHeader()+view;
  if($('.app-content'))$('.app-content').scrollTop=scroll;
  if($('#room-count'))renderRoomList();
  if($('#ppe-confirmed')&&oldJob===$('[data-action="start"]')?.dataset.job)$('#ppe-confirmed').checked=confirmed;
  updateStartButton();
  updateAvailabilityFields();
}
function render() {if(!state)return;refreshClock();renderPhone();}
function enterDemo(mode) {role=mode;selectedTask=null;navigate(mode==='nurse'?'rooms':mode==='menu'?'menu':'tasks');}

function navigate(next) {
  screen = next;
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
  modalReturnFocus = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section></div>`;
  $('.modal button, .modal input, .modal select')?.focus();
}
function closeModal() { $('#modal-root').innerHTML=''; modalReturnFocus?.focus(); }

document.addEventListener('click',async(e)=>{
  const summary=e.target.closest('summary');
  if(summary?.id==='request-extra-summary'&&!$('#request-extra-fields')?.open)revealSection('request-extras');
  const el=e.target.closest('button');if(!el||busy||el.disabled)return;
  if(el.dataset.demo){enterDemo(el.dataset.demo);return;}
  if(el.dataset.action==='main-menu'){closeModal();enterDemo('menu');return;}
  if(el.dataset.filter){statusFilter=el.dataset.filter;renderRoomList();return;}
  if(el.dataset.screen){navigate(el.dataset.screen);return;}
  if(el.dataset.adminScreen){navigate(el.dataset.adminScreen);return;}
  if(el.hasAttribute('data-back-tasks')){selectedTask=null;navigate('tasks');return;}
  if(el.dataset.room){selectedRoom=el.dataset.room;navigate('detail');return;}
  if(el.dataset.task||el.dataset.adminTask){selectedTask=el.dataset.task||el.dataset.adminTask;navigate('task');return;}
  const action=el.dataset.action,id=el.dataset.job;
  if(action==='new-request'){editingJob=null;selectedRoom=el.dataset.roomId||selectedRoom;navigate('form');}
  if(action==='edit-request'){editingJob=id;navigate('edit');}
  if(action==='accept-job'&&await mutate('accept',{job_id:id},'Job accepted'))render();
  if(action==='release-job'&&await mutate('release',{job_id:id},'Job returned to requested tasks'))render();
  if(action==='admin-assign'&&await mutate('assign',{job_id:id},'Assigned to demo worker'))render();
  if(action==='admin-unassign'&&await mutate('unassign',{job_id:id},'Returned to available tasks'))render();
  if(action==='start'){
    if(!$('#ppe-confirmed')?.checked)return toast('Confirm the PPE and room instructions first.',true);
    if(await mutate('start',{job_id:id,ppe_confirmed:true},'Cleaning started'))render();
  }
  if(action==='complete-job'&&await mutate('complete',{job_id:id,checks_confirmed:true},'Room marked cleaned')){selectedTask=null;navigate('tasks');render();}
  if(action==='cancel-request')showModal(`<h2 id="modal-title">Cancel this request?</h2><p>This withdraws the cleaning request, including any work in progress. Any earlier cleaning timestamp will be kept. This does not record a completed cleaning.</p><div class="control-row"><button class="secondary" data-action="close-modal">Keep request</button><button class="danger-btn" data-action="confirm-cancel" data-job="${id}">Cancel request</button></div>`);
  if(action==='confirm-cancel'&&await mutate('cancel',{job_id:id},'Request cancelled')){closeModal();render();}
  if(action==='close-modal')closeModal();
});
document.addEventListener('change',async(e)=>{
  const el=e.target;
  if(el.id==='unit-filter'){roomUnit=el.value;renderRoomList();}
  if(el.id==='ppe-confirmed')updateStartButton();
  if(el.id==='request-room')updateFloorDefaults();
  if(['availability-now','availability-later','available-from','cleaning-class'].includes(el.id)){
    updateAvailabilityFields();if(el.id==='availability-later'&&el.checked)revealSection('availability-fields');
  }
  if(el.id==='auto-assign'){await mutate('automatic',{enabled:el.checked},'Assignment setting updated');render();}
});
document.addEventListener('input',e=>{if(e.target.id==='room-search'){roomSearch=e.target.value;renderRoomList();}});
document.addEventListener('submit',async(e)=>{
  if(e.target.id!=='request-form')return;e.preventDefault();
  const f=new FormData(e.target);
  const editing=screen==='edit';
  const previous=editing?state.jobs.find(j=>j.id===editingJob):null;
  const roomId=previous?previous.room_id:f.get('room_id');
  const payload={job_id:editingJob,room_id:roomId,cleaning_class:f.get('cleaning_class'),priority:f.get('priority'),
    ppe:f.getAll('ppe'),equipment:f.get('equipment'),notes:f.get('notes'),use_floor_defaults:f.has('use_floor_defaults')};
  if(previous?.status!=='cleaning'){
    payload.availability_mode=f.get('availability_mode')||'now';
    if(payload.availability_mode==='later'){
      payload.available_from=new Date(f.get('available_from')||'').getTime();
      payload.available_until=f.get('available_until')?new Date(f.get('available_until')).getTime():null;
    }
  }
  const result=await mutate(editing?'edit':'request',payload,editing?'Request updated':'Request sent');
  if(result){selectedRoom=roomId;editingJob=null;navigate('detail');render();}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  const modal=$('.modal');if(modal&&e.key==='Tab'){
    const els=[...modal.querySelectorAll('button,input,select,[tabindex="0"]')],first=els[0],last=els.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
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
  simulation = Domain.newState();
  state = Domain.snapshot(simulation);
  render();
}
initialize();
// Updating text nodes keeps estimates live without replacing inputs or scroll position.
function refreshClock() {
  if(!simulation)return;
  state=Domain.snapshot(simulation);
  $('#phone-time').textContent=time(now());
  for(const el of document.querySelectorAll('[data-estimate]')) {
    const job=state.jobs.find(j=>j.id===el.dataset.estimate);
    if(job)el.textContent=(el.dataset.estimatePrefix||'')+estimate(job);
  }
  updateStartButton();
}
setInterval(refreshClock,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshClock();});
