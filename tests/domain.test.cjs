'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../domain.js');
const T=Date.parse('2026-05-30T10:00:00Z'),M=D.MINUTE;
const fresh=()=>D.newState(T,{seedDemo:false}),job=(s,id='J001')=>s.jobs.find(j=>j.id===id),room=(s,id='2150')=>s.rooms.find(r=>r.id===id);
const cmd=(s,a,d={},at=s.settings.now)=>D.transact(s,a,d,at);
const request=(s=fresh(),extra={},at=s.settings.now)=>cmd(s,'request',{room_id:'2150',...extra},at);
const start=(s,id='J001',at=s.settings.now)=>cmd(s,'start',{job_id:id,ppe_confirmed:true},at);
const finish=(s,id='J001',at=s.settings.now)=>cmd(s,'complete',{job_id:id,checks_confirmed:true},at);

test('default session has one Basic Pediatrics request and no cleaning history',()=>{
 const s=D.newState(T);assert.equal(s.rooms.length,62);assert.equal(s.jobs.length,1);assert.equal(job(s).room_id,'2150');
 assert.equal(job(s).cleaning_class,'basic');assert.equal(job(s).duration,20);assert.deepEqual(job(s).ppe,[]);assert.equal(job(s).status,'queued');
 assert.equal(s.settings.automatic_assignment,false);assert.ok(s.rooms.every(r=>r.last_cleaned_at===null));assert.equal(s.rooms.filter(r=>r.status==='unknown').length,61);
 assert.equal(D.instructions(s,job(s)),'Retain and clean the reusable stethoscope. Do not discard.');
});
test('room ranges are exact, inclusive, and unique',()=>{
 const s=fresh();for(const[unit,first,last]of[['Cardiology',4100,4120],['Oncology',4121,4140],['Pediatrics',2150,2170]])
  assert.deepEqual(s.rooms.filter(r=>r.unit===unit).map(r=>Number(r.id)),Array.from({length:last-first+1},(_,i)=>first+i));
 assert.equal(new Set(s.rooms.map(r=>r.id)).size,62);assert.ok(s.rooms.every(r=>r.status==='unknown'));
});
test('only Basic 20 and Extra 30 are offered and PPE remains optional',()=>{
 assert.deepEqual(Object.keys(D.CLASSES),['basic','extra']);
 const a=request(),b=request(fresh(),{cleaning_class:'extra'});assert.equal(job(a).duration,20);assert.equal(job(b).duration,30);assert.deepEqual(job(a).ppe,[]);
 assert.throws(()=>request(fresh(),{cleaning_class:'invalid'}),D.DomainError);
});
test('invalid PPE, rooms, and duplicate active requests fail atomically',()=>{
 const s=request(),before=JSON.stringify(s);
 for(const extra of[{room_id:'9999'},{room_id:'2150'},{room_id:'4100',ppe:null},{room_id:'4100',ppe:['Unknown']}])assert.throws(()=>request(s,extra),D.DomainError);
 assert.equal(JSON.stringify(s),before);
});
test('real epoch timestamps are used by default for state and actions',()=>{
 const before=Date.now(),s=D.newState(),a=D.transact(s,'request',{room_id:'4100'}),after=Date.now();
 assert.ok(s.settings.now>=before&&s.settings.now<=after);assert.ok(job(a,'J002').requested_at>=before&&job(a,'J002').requested_at<=after);
 assert.ok(D.snapshot(s).settings.now>=after);
});
test('a request contains one additional-instructions field; floor instructions are automatic',()=>{
 const s=request(fresh(),{notes:'Clean the bed rails.'});assert.equal(job(s).notes,'Clean the bed rails.');
 assert.equal(D.instructions(s,job(s)),'Retain and clean the reusable stethoscope. Do not discard.\n\nClean the bed rails.');
 assert.ok(!Object.hasOwn(job(s),'equipment'));assert.ok(!Object.hasOwn(job(s),'use_floor_defaults'));
 const a=cmd(s,'edit',{job_id:'J001',notes:''});assert.match(D.instructions(a,job(a)),/stethoscope/);assert.equal(job(a).notes,'');
});
test('Admin floor instructions apply to existing and new tasks without overwriting nurse notes',()=>{
 let s=request(fresh(),{notes:'Keep this note.'});s=cmd(s,'floor-instructions',{unit:'Pediatrics',instructions:'Clean and retain reusable equipment.'});
 assert.equal(D.instructions(s,job(s)),'Clean and retain reusable equipment.\n\nKeep this note.');
 s=request(s,{room_id:'2151'});assert.equal(D.instructions(s,job(s,'J002')),'Clean and retain reusable equipment.');
 assert.equal(D.floorInstructions(request(fresh(),{room_id:'4100'}),{room_id:'4100'}),'');
});
test('floor settings validate units and length without partial mutation',()=>{
 const s=request(),before=JSON.stringify(s);
 for(const data of[{unit:'Unknown',instructions:'x'},{unit:'Pediatrics',instructions:null},{unit:'Pediatrics',instructions:'x'.repeat(601)}])
  assert.throws(()=>cmd(s,'floor-instructions',data),D.DomainError);
 assert.equal(JSON.stringify(s),before);const a=cmd(s,'floor-instructions',{unit:'Cardiology',instructions:'  Keep monitor.  '});assert.equal(a.settings.floor_instructions.Cardiology,'Keep monitor.');
});
test('one start action claims and starts the task with no acceptance step',()=>{
 const s=start(request(),'J001',T+M);assert.equal(job(s).status,'cleaning');assert.equal(job(s).worker_id,'maya');
 assert.equal(job(s).assigned_at,T+M);assert.equal(job(s).started_at,T+M);assert.equal(room(s).status,'cleaning');
 assert.throws(()=>cmd(request(),'accept',{job_id:'J001'}),D.DomainError);assert.ok(!Object.hasOwn(job(s),'accepted_at'));
});
test('start always requires PPE/instructions acknowledgement, including with no PPE',()=>{
 const s=request(),before=JSON.stringify(s);assert.throws(()=>cmd(s,'start',{job_id:'J001'}),/Confirm/);assert.equal(JSON.stringify(s),before);
});
test('a worker cannot start somebody else’s assignment, a duplicate task, or two tasks',()=>{
 const assigned=cmd(request(),'assign',{job_id:'J001',worker_id:'sam'});assert.throws(()=>start(assigned),/another worker/);
 let s=start(request());assert.throws(()=>start(s),D.DomainError);s=request(s,{room_id:'4100'});assert.throws(()=>start(s,'J002'),/current job/);
});
test('Cancel after starting returns the same request without recording completion',()=>{
 const before=request(fresh(),{notes:'Keep monitor.'}),s=cmd(start(before),'release',{job_id:'J001'});
 assert.equal(job(s).status,'queued');assert.equal(job(s).worker_id,null);assert.equal(job(s).started_at,null);assert.equal(job(s).requested_at,T);
 assert.equal(job(s).notes,'Keep monitor.');assert.equal(s.jobs.length,1);assert.equal(room(s).status,'requested');assert.equal(room(s).last_cleaned_at,null);
 assert.throws(()=>cmd(before,'release',{job_id:'J001'}),/not started/);
});
test('Nurse cancellation withdraws requested or active work without inventing cleaning history',()=>{
 for(const s of[request(),start(request())]){
  const a=cmd(s,'cancel',{job_id:'J001'});assert.equal(job(a).status,'cancelled');assert.equal(room(a).status,'unknown');assert.equal(room(a).last_cleaned_at,null);
  assert.ok(!D.requestedTasks(a).some(j=>j.id==='J001'));
 }
});
test('completion records actual time, marks Cleaned, and frees the worker',()=>{
 const active=start(request());assert.throws(()=>cmd(active,'complete',{job_id:'J001'}),/Confirm/);
 let s=finish(active,'J001',T+7*M);assert.equal(job(s).status,'complete');assert.equal(job(s).completed_at,T+7*M);assert.equal(room(s).last_cleaned_at,T+7*M);
 assert.equal(room(s).status,'cleaned');assert.equal(s.workers.find(w=>w.id==='maya').completed,1);assert.equal(D.requestedTasks(s).length,0);
 for(const action of['complete','edit','cancel'])assert.throws(()=>cmd(s,action,{job_id:'J001',checks_confirmed:true}),D.DomainError);
 s=request(s,{room_id:'4100'});assert.equal(job(start(s,'J002'),'J002').status,'cleaning');
});
test('history survives repeat requests and withdrawal; only a completed cleaning updates it',()=>{
 let s=finish(start(request()),'J001',T+7*M);s=request(s,{},T+60*M);assert.equal(room(s).last_cleaned_at,T+7*M);assert.equal(room(s).status,'requested');
 const withdrawn=cmd(s,'cancel',{job_id:'J002'});assert.equal(room(withdrawn).status,'cleaned');assert.equal(room(withdrawn).last_cleaned_at,T+7*M);
 s=finish(start(s,'J002'),'J002',T+70*M);assert.equal(room(s).last_cleaned_at,T+70*M);assert.equal(job(s).completed_at,T+7*M);
});
test('room lists sort Cleaning, Requested, Cleaned, then no history, with numeric ties',()=>{
 let s=finish(start(request(fresh(),{room_id:'4120'})));s=request(s,{room_id:'2160'});s=start(s,'J002');
 s=request(s,{room_id:'4100'});s=request(s,{room_id:'2151'});const original=s.rooms.map(r=>r.id),sorted=D.sortedRooms(s);
 assert.deepEqual(sorted.slice(0,4).map(r=>r.id),['2160','2151','4100','4120']);assert.ok(sorted.slice(4).every(r=>r.status==='unknown'));assert.deepEqual(s.rooms.map(r=>r.id),original);
 const subset=D.sortedRooms(s,s.rooms.filter(r=>r.unit==='Cardiology'));assert.equal(subset[0].id,'4100');
});
test('Later stores only an availability start and allows starting any time after it',()=>{
 const s=request(fresh(),{availability_mode:'later',available_from:T+60*M});assert.ok(!Object.hasOwn(job(s),'available_until'));
 assert.throws(()=>start(s,'J001',T+59*M),/not available/);assert.equal(job(start(s,'J001',T+60*M)).started_at,T+60*M);
 assert.equal(job(start(s,'J001',T+3*24*60*M)).status,'cleaning');
});
test('invalid and past availability dates fail atomically',()=>{
 const s=fresh(),before=JSON.stringify(s);
 for(const fields of[{availability_mode:'bad'},{availability_mode:'later',available_from:NaN},{availability_mode:'later',available_from:T-M}])
  assert.throws(()=>request(s,fields),D.DomainError);assert.equal(JSON.stringify(s),before);
});
test('editing can reschedule Later or switch back to Now while preserving the request',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+60*M});s=cmd(s,'edit',{job_id:'J001',available_from:T+120*M});
 assert.equal(job(s).available_from,T+120*M);assert.equal(s.jobs.length,1);assert.equal(job(s).requested_at,T);
 s=cmd(s,'edit',{job_id:'J001',availability_mode:'now'},T+M);assert.equal(job(s).availability_mode,'now');assert.equal(job(s).available_from,T+M);
});
test('notes can be edited after the availability time passed; active cleaning locks availability',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+30*M});s=cmd(s,'edit',{job_id:'J001',notes:'Changed'},T+40*M);
 assert.equal(job(s).available_from,T+30*M);s=start(s,'J001',T+40*M);s=cmd(s,'edit',{job_id:'J001',notes:'Another note'},T+41*M);
 assert.equal(job(s).started_at,T+40*M);assert.equal(job(s).notes,'Another note');assert.throws(()=>cmd(s,'edit',{job_id:'J001',availability_mode:'now'},T+42*M),/cannot change/);
});
test('Nurse edits preserve assignment and progress and recalculate Basic/Extra estimates',()=>{
 let s=cmd(request(),'assign',{job_id:'J001'});s=cmd(s,'edit',{job_id:'J001',cleaning_class:'extra'});
 assert.equal(job(s).assigned_at,T);assert.equal(job(s).duration,30);assert.equal(job(s).estimated_finish,T+40*M);
 s=start(s,'J001',T+M);s=cmd(s,'edit',{job_id:'J001',cleaning_class:'basic'},T+2*M);assert.equal(job(s).started_at,T+M);assert.equal(job(s).estimated_finish,T+21*M);
});
test('invalid room changes and PPE edits outside worker capabilities are rejected',()=>{
 const s=cmd(request(),'assign',{job_id:'J001',worker_id:'sam'}),before=JSON.stringify(s);
 for(const extra of[{room_id:'4100'},{cleaning_class:'invalid'},{ppe:['Respirator']},{ppe:null}])assert.throws(()=>cmd(s,'edit',{job_id:'J001',...extra}),D.DomainError);
 assert.equal(JSON.stringify(s),before);
});
test('automatic assignment affects only new tasks and never starts cleaning',()=>{
 let s=cmd(request(),'automatic',{enabled:true});assert.equal(job(s).status,'queued');s=request(s,{room_id:'4100'});
 assert.equal(job(s,'J002').status,'assigned');assert.equal(job(s,'J002').worker_id,'maya');assert.equal(job(s,'J002').started_at,null);
 s=cmd(s,'automatic',{enabled:false});assert.equal(job(s,'J002').worker_id,'maya');
});
test('automatic assignment does not reclaim a cleaning cancelled by the worker',()=>{
 let s=request(cmd(fresh(),'automatic',{enabled:true}));s=cmd(start(s),'release',{job_id:'J001'});assert.equal(job(s).status,'queued');assert.equal(job(D.snapshot(s,T)).worker_id,null);
});
test('admin can assign/unassign only unstarted work; worker start still uses one action',()=>{
 let s=cmd(request(),'assign',{job_id:'J001'});assert.equal(room(s).status,'requested');assert.equal(job(s).assignment_source,'admin');
 const a=cmd(s,'unassign',{job_id:'J001'});assert.equal(job(a).status,'queued');s=start(s);assert.equal(job(s).status,'cleaning');assert.throws(()=>cmd(s,'unassign',{job_id:'J001'}),D.DomainError);
});
test('EVS tasks remain urgent-first, then oldest, and exclude other workers',()=>{
 let s=request(fresh(),{room_id:'4100'});s=request(s,{room_id:'4101',priority:'urgent'},T+M);s=request(s,{room_id:'4102'},T+2*M);
 s=cmd(s,'assign',{job_id:'J003',worker_id:'sam'});assert.deepEqual(D.requestedTasks(s).map(j=>j.id),['J002','J001']);
});
test('assigned estimates respect availability, queue, travel, and prep without reserving work through a worker action',()=>{
 let s=request(fresh(),{priority:'urgent',availability_mode:'later',available_from:T+120*M});s=cmd(s,'assign',{job_id:'J001'});
 s=request(s,{room_id:'4100'});s=cmd(s,'assign',{job_id:'J002'});
 assert.equal(job(s,'J002').estimated_start,T+4*M);assert.equal(job(s,'J002').estimated_finish,T+24*M);assert.equal(job(s).estimated_start,T+120*M);
 assert.equal(job(s).estimated_finish,T+140*M);
});
test('timestamps and estimates cross midnight/year boundaries without wrapping',()=>{
 const at=Date.parse('2026-12-31T23:55:00Z');let s=request(D.newState(at,{seedDemo:false}),{room_id:'4100',availability_mode:'later',available_from:at+30*M});
 s=cmd(s,'assign',{job_id:'J001'});assert.equal(job(s).estimated_start,Date.parse('2027-01-01T00:25:00Z'));
 assert.equal(job(s).estimated_finish,Date.parse('2027-01-01T00:45:00Z'));
});
test('time passing never invents completion or removes historical cleaning information',()=>{
 const active=D.snapshot(start(request()),T+120*M);assert.equal(job(active).status,'cleaning');assert.equal(room(active).last_cleaned_at,null);
 assert.equal(job(active).estimated_finish,T+121*M);const cleaned=D.snapshot(finish(start(request())),T+24*60*M);assert.equal(room(cleaned).status,'cleaned');assert.equal(room(cleaned).last_cleaned_at,T);
});
test('snapshots and failed transactions leave session state unchanged',()=>{
 const s=cmd(request(),'assign',{job_id:'J001'}),before=JSON.stringify(s),a=D.snapshot(s,T+5*M);
 assert.equal(a.settings.now,T+5*M);assert.equal(job(a).requested_at,T);assert.equal(JSON.stringify(s),before);
 a.settings.floor_instructions.Pediatrics='Changed copy';assert.match(s.settings.floor_instructions.Pediatrics,/stethoscope/);
});
test('reset restores one default request, floor instructions, and the real supplied time',()=>{
 let s=cmd(request(),'floor-instructions',{unit:'Pediatrics',instructions:'Changed'});s=cmd(s,'automatic',{enabled:true});
 const reset=cmd(s,'reset',{},T+60*M);assert.deepEqual(reset,D.newState(T+60*M));assert.equal(job(reset).requested_at,T+60*M);
});
