'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../domain.js');
const T=Date.parse('2026-05-30T10:00:00Z'),M=D.MINUTE;
const fresh=()=>D.newState(T,{seedDemo:false}),job=(s,id='J001')=>s.jobs.find(j=>j.id===id),room=(s,id='4127')=>s.rooms.find(r=>r.id===id);
const cmd=(s,a,d={},at=s.settings.now)=>D.transact(s,a,d,at);
const request=(s,extra={},at=s.settings.now)=>cmd(s,'request',{room_id:'4127',cleaning_class:'standard',ppe:[],...extra},at);
const seeded=()=>request(fresh(),{cleaning_class:'enhanced',priority:'urgent',ppe:['Gloves','Gown'],notes:'Under the bed.',equipment:'Keep stethoscope.'});
const start=s=>cmd(s,'start',{job_id:'J001',ppe_confirmed:true});
const finish=(s,at=s.settings.now)=>cmd(s,'complete',{job_id:'J001',checks_confirmed:true},at);

test('unseeded fixtures contain 62 unknown rooms, no history, no tasks, and manual assignment',()=>{
 const s=fresh();assert.equal(s.rooms.length,62);assert.equal(s.jobs.length,0);assert.equal(s.events.length,0);
 assert.ok(s.rooms.every(r=>r.status==='unknown'&&r.last_cleaned_at===null));assert.equal(s.settings.automatic_assignment,false);
 assert.deepEqual(D.snapshot(s,T).metrics,{requested:0,cleaning:0,cleaned:0});
});
test('all room ranges and units are exact, inclusive, and unique',()=>{
 const s=fresh();
 for(const[unit,first,last]of[['Cardiology',4100,4120],['Oncology',4121,4140],['Pediatrics',2150,2170]])
  assert.deepEqual(s.rooms.filter(r=>r.unit===unit).map(r=>Number(r.id)),Array.from({length:last-first+1},(_,i)=>first+i));
 assert.equal(new Set(s.rooms.map(r=>r.id)).size,62);assert.ok(s.workers.every(w=>w.unit!=='Medicine'));
});
test('the default clock uses actual epoch milliseconds for initialization and actions',()=>{
 const before=Date.now(),s=D.newState(undefined,{seedDemo:false}),a=D.transact(s,'request',{room_id:'4100'}),after=Date.now();
 assert.ok(s.settings.now>=before&&s.settings.now<=after);assert.ok(job(a).requested_at>=before&&job(a).requested_at<=after);
 const snap=D.snapshot(s);assert.ok(snap.settings.now>=after&&snap.settings.now<=Date.now());
});
test('PPE is optional, and cleaning defaults remain 20 and 30 minutes',()=>{
 const a=request(fresh());assert.deepEqual(job(a).ppe,[]);assert.equal(job(a).duration,20);
 const b=cmd(fresh(),'request',{room_id:'4100',cleaning_class:'enhanced'});assert.deepEqual(job(b).ppe,[]);assert.equal(job(b).duration,30);
 assert.equal(D.CLASSES.standard.minutes,20);assert.equal(D.CLASSES.enhanced.minutes,30);
});
test('availability defaults to Now without tracking occupancy or requiring a checkbox',()=>{
 const s=request(fresh());assert.equal(job(s).availability_mode,'now');assert.equal(job(s).available_from,T);assert.equal(job(s).available_until,null);
 assert.equal(room(s).status,'requested');assert.equal(room(s).last_cleaned_at,null);
 assert.ok(!Object.hasOwn(room(s),'occupied'));assert.ok(!Object.hasOwn(room(s),'available'));
});

test('invalid PPE, unknown rooms, and duplicate active requests fail atomically',()=>{
 const s=seeded(),before=JSON.stringify(s);
 for(const extra of [{ppe:null},{ppe:'Gloves'},{ppe:['Unknown']},{room_id:'9999'},{room_id:'4127'}])
  assert.throws(()=>request(s,extra),D.DomainError);
 assert.equal(JSON.stringify(s),before);
});
test('accepting needs no checkbox and the room remains Requested',()=>{
 const s=cmd(seeded(),'accept',{job_id:'J001'},T+M);
 assert.equal(job(s).status,'assigned');assert.equal(job(s).worker_id,'maya');assert.equal(job(s).accepted_at,T+M);
 assert.equal(job(s).started_at,null);assert.equal(room(s).status,'requested');
});
test('direct start accepts and starts at the actual action timestamp',()=>{
 const s=cmd(seeded(),'start',{job_id:'J001',ppe_confirmed:true},T+2*M);
 assert.equal(job(s).status,'cleaning');assert.equal(job(s).worker_id,'maya');assert.equal(job(s).accepted_at,T+2*M);
 assert.equal(job(s).started_at,T+2*M);assert.equal(room(s).status,'cleaning');assert.equal(room(s).last_cleaned_at,null);
});
test('start requires acknowledgement even for requests with no PPE',()=>{
 for(const s of[seeded(),request(fresh())])assert.throws(()=>cmd(s,'start',{job_id:'J001'}),D.DomainError);
});
test('worker cancellation releases the same request without a cleaning timestamp',()=>{
 const initial=seeded();
 for(const s of[cmd(initial,'accept',{job_id:'J001'}),start(initial)]){
  const a=cmd(s,'release',{job_id:'J001'});assert.equal(job(a).status,'queued');assert.equal(job(a).worker_id,null);
  assert.equal(job(a).started_at,null);assert.equal(job(a).requested_at,job(initial).requested_at);assert.deepEqual(job(a).ppe,job(initial).ppe);
  assert.equal(room(a).status,'requested');assert.equal(room(a).last_cleaned_at,null);assert.equal(a.jobs.length,1);
 }
});
test('automatic assignment applies only to new tasks and always chooses Maya without starting',()=>{
 let s=cmd(seeded(),'automatic',{enabled:true});assert.equal(job(s).status,'queued');
 s=request(s,{room_id:'2150'});assert.equal(job(s,'J002').worker_id,'maya');assert.equal(job(s,'J002').status,'assigned');
 assert.equal(job(s,'J002').assignment_source,'automatic');assert.equal(job(s,'J002').started_at,null);assert.equal(room(s,'2150').status,'requested');
 s=cmd(s,'automatic',{enabled:false});assert.equal(job(s,'J002').worker_id,'maya');
 s=request(s,{room_id:'4100'});assert.equal(job(s,'J003').status,'queued');
});
test('releasing an automatic assignment does not immediately reassign it',()=>{
 let s=request(cmd(fresh(),'automatic',{enabled:true}));s=cmd(s,'release',{job_id:'J001'});
 assert.equal(job(s).status,'queued');assert.equal(job(D.snapshot(s,T)).worker_id,null);
});
test('workers may accept multiple tasks but may start only one',()=>{
 let s=request(start(seeded()),{room_id:'2150'});s=cmd(s,'accept',{job_id:'J002'});
 assert.equal(job(s,'J002').status,'assigned');assert.throws(()=>cmd(s,'start',{job_id:'J002',ppe_confirmed:true}),D.DomainError);
});
test('EVS tasks sort Urgent then oldest and exclude work assigned to other workers',()=>{
 let s=request(fresh(),{room_id:'4100'},T);s=request(s,{room_id:'4101',priority:'urgent'},T+M);s=request(s,{room_id:'4102'},T+2*M);
 s=cmd(s,'assign',{job_id:'J003',worker_id:'sam'});
 assert.deepEqual(D.requestedTasks(s).map(j=>j.id),['J002','J001']);
 s=cmd(s,'edit',{job_id:'J001',priority:'urgent'});assert.deepEqual(D.requestedTasks(s).map(j=>j.id),['J001','J002']);
});
test('duplicate acceptance and modifying another worker’s claim fail',()=>{
 const a=cmd(seeded(),'accept',{job_id:'J001'});assert.throws(()=>cmd(a,'accept',{job_id:'J001'}),D.DomainError);
 const b=cmd(seeded(),'assign',{job_id:'J001',worker_id:'sam'});
 for(const action of ['accept','release','start','complete'])assert.throws(()=>cmd(b,action,{job_id:'J001',ppe_confirmed:true,checks_confirmed:true}),D.DomainError);
});
test('admin may assign and unassign unstarted tasks only',()=>{
 let s=cmd(seeded(),'assign',{job_id:'J001'});assert.equal(job(s).assignment_source,'admin');
 s=cmd(s,'unassign',{job_id:'J001'});assert.equal(job(s).status,'queued');
 assert.throws(()=>cmd(start(s),'unassign',{job_id:'J001'}),D.DomainError);
});
test('nurse cancellation before or during cleaning removes request with no invented history',()=>{
 for(const s of[seeded(),start(seeded())]){
  const a=cmd(s,'cancel',{job_id:'J001'});assert.equal(job(a).status,'cancelled');assert.equal(room(a).status,'unknown');
  assert.equal(room(a).last_cleaned_at,null);assert.ok(!D.requestedTasks(a).some(j=>j.id==='J001'));
 }
});
test('completion records the actual time, marks Cleaned, and frees the worker',()=>{
 let s=start(seeded());assert.throws(()=>cmd(s,'complete',{job_id:'J001'}),D.DomainError);
 s=finish(s,T+7*M);assert.equal(job(s).completed_at,T+7*M);assert.equal(job(s).status,'complete');
 assert.equal(room(s).status,'cleaned');assert.equal(room(s).last_cleaned_at,T+7*M);assert.equal(s.workers.find(w=>w.id==='maya').completed,1);
 assert.equal(D.requestedTasks(s).length,0);
 for(const action of['edit','cancel','complete'])assert.throws(()=>cmd(s,action,{job_id:'J001',checks_confirmed:true}),D.DomainError);
 s=request(s,{room_id:'2150'});s=cmd(s,'start',{job_id:'J002',ppe_confirmed:true});assert.equal(job(s,'J002').status,'cleaning');
});
test('Cleaned is historical: time passing never implies room readiness or removes the timestamp',()=>{
 const s=finish(start(seeded()),T+7*M),next=D.snapshot(s,T+3*24*60*M);
 assert.equal(room(next).status,'cleaned');assert.equal(room(next).last_cleaned_at,T+7*M);
 assert.ok(next.rooms.every(r=>['requested','cleaning','cleaned','unknown'].includes(r.status)));
});
test('a new cleaning request preserves previous history; cancellation restores the earlier Cleaned status',()=>{
 const first=finish(start(seeded()),T+7*M),requested=request(first,{},T+60*M);
 assert.equal(room(requested).status,'requested');assert.equal(room(requested).last_cleaned_at,T+7*M);
 for(const s of[requested,cmd(requested,'start',{job_id:'J002',ppe_confirmed:true})]){
  const cancelled=cmd(s,'cancel',{job_id:'J002'});assert.equal(room(cancelled).status,'cleaned');assert.equal(room(cancelled).last_cleaned_at,T+7*M);
 }
});
test('repeat completion replaces the room’s last-cleaned time, preserving both job timestamps',()=>{
 let s=request(finish(start(seeded()),T+7*M),{},T+60*M);s=cmd(s,'start',{job_id:'J002',ppe_confirmed:true});
 s=cmd(s,'complete',{job_id:'J002',checks_confirmed:true},T+70*M);
 assert.equal(room(s).last_cleaned_at,T+70*M);assert.equal(job(s).completed_at,T+7*M);assert.equal(job(s,'J002').completed_at,T+70*M);
});
test('room sorting is Cleaning, Requested, Cleaned, then blank history with numeric ties',()=>{
 let s=request(fresh(),{room_id:'4120'});s=finish(start(s));s=request(s,{room_id:'2160'});s=cmd(s,'start',{job_id:'J002',ppe_confirmed:true});
 s=request(s,{room_id:'4100'});s=request(s,{room_id:'2151'});s=cmd(s,'accept',{job_id:'J004'});
 const before=s.rooms.map(r=>r.id),sorted=D.sortedRooms(s);
 assert.deepEqual(sorted.slice(0,4).map(r=>r.id),['2160','2151','4100','4120']);
 assert.deepEqual(sorted.slice(0,4).map(r=>r.status),['cleaning','requested','requested','cleaned']);
 assert.ok(sorted.slice(4).every(r=>r.status==='unknown'));assert.deepEqual(s.rooms.map(r=>r.id),before);
});
test('room sorting works on unit/search-filtered subsets',()=>{
 let s=request(fresh(),{room_id:'4101'});s=request(s,{room_id:'2150'});
 assert.equal(D.sortedRooms(s,s.rooms.filter(r=>r.unit==='Cardiology'))[0].id,'4101');
});
test('editing updates a single request, can clear PPE, and preserves request time',()=>{
 const before=seeded(),s=cmd(before,'edit',{job_id:'J001',cleaning_class:'standard',priority:'routine',ppe:[],notes:'Updated',equipment:''},T+M);
 assert.equal(s.jobs.length,1);assert.equal(job(s).requested_at,T);assert.equal(job(s).duration,20);assert.equal(job(s).priority,'routine');
 assert.equal(job(s).notes,'Updated');assert.deepEqual(job(s).ppe,[]);assert.equal(job(s).equipment,'');assert.equal(job(before).priority,'urgent');
});
test('editing preserves accepted and started timestamps and recomputes estimates',()=>{
 let s=cmd(seeded(),'accept',{job_id:'J001'},T+M);s=cmd(s,'edit',{job_id:'J001',cleaning_class:'specialist'},T+2*M);
 assert.equal(job(s).worker_id,'maya');assert.equal(job(s).accepted_at,T+M);assert.equal(job(s).estimated_finish,T+(2+7+40)*M);
 s=cmd(s,'start',{job_id:'J001',ppe_confirmed:true},T+3*M);s=cmd(s,'edit',{job_id:'J001',cleaning_class:'standard'},T+4*M);
 assert.equal(job(s).started_at,T+3*M);assert.equal(job(s).estimated_finish,T+23*M);assert.equal(room(s).status,'cleaning');
});
test('editing an existing request never triggers automatic assignment',()=>{
 const s=cmd(cmd(seeded(),'automatic',{enabled:true}),'edit',{job_id:'J001',priority:'routine'});
 assert.equal(job(s).status,'queued');assert.equal(job(s).worker_id,null);
});
test('invalid edits and changes outside assigned worker capabilities fail atomically',()=>{
 const s=cmd(seeded(),'assign',{job_id:'J001',worker_id:'sam'}),before=JSON.stringify(s);
 for(const extra of[{room_id:'4100'},{cleaning_class:'unknown'},{priority:'other'},{ppe:null},{ppe:['Respirator']},{cleaning_class:'specialist'}])
  assert.throws(()=>cmd(s,'edit',{job_id:'J001',...extra}),D.DomainError);
 assert.equal(JSON.stringify(s),before);
});
test('ETAs use minute durations over real timestamps and include travel and prep',()=>{
 let s=seeded();assert.equal(job(s).estimated_finish,null);s=cmd(s,'accept',{job_id:'J001'},T);
 assert.equal(job(s).estimated_finish,T+37*M);assert.equal(job(s).breakdown.clean,30);
 s=request(s,{room_id:'2150'});s=cmd(s,'accept',{job_id:'J002'});
 assert.equal(job(s,'J002').estimated_finish,T+Object.values(job(s,'J002').breakdown).reduce((a,b)=>a+b,0)*M);
});
test('live estimates cross midnight and year boundaries without wrapping timestamps',()=>{
 const at=Date.parse('2026-12-31T23:55:00Z');let s=request(D.newState(at,{seedDemo:false}),{room_id:'4100'});
 s=cmd(s,'accept',{job_id:'J001'});assert.equal(job(s).estimated_finish,Date.parse('2027-01-01T00:19:00Z'));
 const later=D.snapshot(s,at+10*M);assert.equal(job(later).estimated_finish,Date.parse('2027-01-01T00:29:00Z'));
 assert.equal(job(s).accepted_at,at);
});
test('a past estimate never auto-completes a task or invents a cleaning record',()=>{
 const s=D.snapshot(start(seeded()),T+120*M);assert.equal(job(s).status,'cleaning');assert.equal(room(s).status,'cleaning');
 assert.equal(room(s).last_cleaned_at,null);assert.equal(job(s).overdue,true);assert.equal(job(s).estimated_finish,T+121*M);
});
test('snapshot refreshes the clock and estimates without changing stored event times or state',()=>{
 const s=cmd(seeded(),'accept',{job_id:'J001'}),before=JSON.stringify(s),snap=D.snapshot(s,T+5*M);
 assert.equal(snap.settings.now,T+5*M);assert.equal(job(snap).accepted_at,T);assert.equal(job(snap).requested_at,T);
 assert.equal(JSON.stringify(s),before);
});
test('reset restores only the default request at the current supplied time',()=>{
 const before=cmd(seeded(),'automatic',{enabled:true}),reset=cmd(before,'reset',{},T+60*M);
 assert.deepEqual(reset,D.newState(T+60*M));assert.equal(reset.jobs.length,1);assert.equal(job(reset).room_id,'2150');assert.equal(reset.rooms.filter(r=>r.status==='unknown').length,61);
});

test('the default demo contains exactly one immediately available Pediatrics stethoscope request',()=>{
 const s=D.newState(T);assert.equal(s.jobs.length,1);assert.equal(job(s).room_id,'2150');assert.equal(job(s).requested_at,T);
 assert.equal(job(s).availability_mode,'now');assert.equal(job(s).available_from,T);assert.equal(job(s).status,'queued');
 assert.equal(job(s).use_floor_defaults,true);assert.equal(D.equipmentInstructions(job(s)),'Retain and clean the reusable stethoscope. Do not discard.');
 assert.equal(s.rooms.filter(r=>r.status==='unknown').length,61);assert.ok(s.rooms.every(r=>r.last_cleaned_at===null));
});
test('Pediatrics floor defaults are explicit, additive, and do not alter custom notes or PPE',()=>{
 const s=request(fresh(),{room_id:'2151',use_floor_defaults:true,equipment:'Clean the bed rails.',notes:'Please knock.'});
 assert.equal(job(s).equipment,'Clean the bed rails.');assert.equal(job(s).notes,'Please knock.');assert.deepEqual(job(s).ppe,[]);
 assert.match(D.equipmentInstructions(job(s)),/stethoscope[\s\S]*Do not discard\.[\s\S]*Clean the bed rails\./);
 assert.equal(job(request(fresh(),{room_id:'2151'})).floor_equipment,'');
 assert.throws(()=>request(fresh(),{use_floor_defaults:true}),D.DomainError);
});
test('editing can turn floor defaults on and off without deleting manual instructions',()=>{
 let s=request(fresh(),{room_id:'2151',equipment:'Keep monitor.'});s=cmd(s,'edit',{job_id:'J001',use_floor_defaults:true});
 assert.match(D.equipmentInstructions(job(s)),/stethoscope/);s=cmd(s,'edit',{job_id:'J001',use_floor_defaults:false});
 assert.equal(D.equipmentInstructions(job(s)),'Keep monitor.');assert.equal(job(s).floor_equipment,'');
});
test('future tasks can be accepted early but cannot start before their availability',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+60*M});
 const original=JSON.stringify(s);assert.throws(()=>cmd(s,'start',{job_id:'J001',ppe_confirmed:true},T+59*M),/not available/);assert.equal(JSON.stringify(s),original);
 s=cmd(s,'accept',{job_id:'J001'});assert.equal(job(s).estimated_start,T+60*M);assert.equal(job(s).estimated_finish,T+80*M);
 s=cmd(s,'start',{job_id:'J001',ppe_confirmed:true},T+60*M);assert.equal(job(s).started_at,T+60*M);assert.equal(room(s).status,'cleaning');
});
test('availability validation rejects invalid, past, reversed, and too-short windows atomically',()=>{
 const s=fresh(),before=JSON.stringify(s);
 for(const fields of[{availability_mode:'invalid'},
  {availability_mode:'later',available_from:NaN},{availability_mode:'later',available_from:T-M},
  {availability_mode:'later',available_from:T+30*M,available_until:'bad'},
  {availability_mode:'later',available_from:T+30*M,available_until:T+20*M},
  {availability_mode:'later',available_from:T+30*M,available_until:T+40*M}])assert.throws(()=>request(s,fields),D.DomainError);
 assert.equal(JSON.stringify(s),before);
});
test('a window end limits starting time without inventing completion or deleting the request',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+30*M,available_until:T+90*M});
 s=cmd(s,'accept',{job_id:'J001'});assert.equal(job(s).estimated_finish,T+50*M);
 assert.equal(D.startIssue(D.snapshot(s,T+70*M),job(s)),'');
 assert.throws(()=>cmd(s,'start',{job_id:'J001',ppe_confirmed:true},T+71*M),/no longer fits/);
 const expired=D.snapshot(s,T+100*M);assert.equal(room(expired).status,'requested');assert.equal(job(expired).window_conflict,true);
 assert.equal(job(expired).estimated_finish,null);assert.equal(room(expired).last_cleaned_at,null);
});
test('future urgent reservations do not block estimates for available work',()=>{
 let s=request(fresh(),{priority:'urgent',availability_mode:'later',available_from:T+120*M});s=cmd(s,'accept',{job_id:'J001'});
 s=request(s,{room_id:'4100',priority:'routine'});s=cmd(s,'accept',{job_id:'J002'});
 assert.equal(job(s,'J002').estimated_start,T+4*M);assert.equal(job(s,'J002').estimated_finish,T+24*M);
 assert.equal(job(s).estimated_start,T+120*M);
});
test('automatic assignment respects future windows and never starts the work',()=>{
 const s=request(cmd(fresh(),'automatic',{enabled:true}),{availability_mode:'later',available_from:T+60*M});
 assert.equal(job(s).worker_id,'maya');assert.equal(job(s).status,'assigned');assert.equal(job(s).started_at,null);assert.equal(job(s).estimated_finish,T+80*M);
});
test('time windows can be rescheduled before starting, including back to Now',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+60*M,available_until:T+120*M});
 s=cmd(s,'edit',{job_id:'J001',availability_mode:'later',available_from:T+120*M,available_until:null});
 assert.equal(job(s).available_from,T+120*M);assert.equal(job(s).available_until,null);assert.equal(s.jobs.length,1);
 s=cmd(s,'edit',{job_id:'J001',availability_mode:'now'},T+M);assert.equal(job(s).available_from,T+M);assert.equal(job(s).availability_mode,'now');
});
test('editing notes preserves an elapsed window; started work locks the time window',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+30*M,available_until:T+90*M});
 s=cmd(s,'edit',{job_id:'J001',notes:'Changed'},T+40*M);assert.equal(job(s).available_from,T+30*M);
 s=cmd(s,'start',{job_id:'J001',ppe_confirmed:true},T+40*M);s=cmd(s,'edit',{job_id:'J001',notes:'Another note'},T+41*M);
 assert.equal(job(s).started_at,T+40*M);assert.equal(job(s).notes,'Another note');
 assert.throws(()=>cmd(s,'edit',{job_id:'J001',availability_mode:'now'},T+42*M),/cannot change/);
});
test('scheduled windows span midnight with real dates and preserve timestamps on release',()=>{
 const at=Date.parse('2026-12-31T23:55:00Z');let s=request(D.newState(at,{seedDemo:false}),{availability_mode:'later',available_from:at+30*M,available_until:at+90*M});
 s=cmd(s,'accept',{job_id:'J001'});assert.equal(job(s).estimated_start,Date.parse('2027-01-01T00:25:00Z'));
 s=cmd(s,'release',{job_id:'J001'});assert.equal(job(s).available_from,at+30*M);assert.equal(job(s).available_until,at+90*M);
});
