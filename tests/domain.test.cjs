'use strict';
process.env.TZ='America/Toronto';
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
 for(const data of[{unit:'Unknown',instructions:'x'},{unit:'Pediatrics',instructions:null},{unit:'Pediatrics',instructions:'x'.repeat(D.FLOOR_MAX+1)}])
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
 let s=start(request());assert.throws(()=>start(s),D.DomainError);s=request(s,{room_id:'4100'});assert.throws(()=>start(s,'J002'),/previous cleaning/);
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
 let s=request(cmd(fresh(),'automatic',{enabled:true}));s=cmd(s,'select-worker',{worker_id:job(s).worker_id});s=cmd(start(s),'release',{job_id:'J001'});assert.equal(job(s).status,'queued');assert.equal(job(D.snapshot(s,T)).worker_id,null);
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
 assert.equal(job(active).estimated_finish,T+20*M);assert.equal(job(active).overdue,true);const cleaned=D.snapshot(finish(start(request())),T+24*60*M);assert.equal(room(cleaned).status,'cleaned');assert.equal(room(cleaned).last_cleaned_at,T);
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

const report=(s,extra={},at=s.settings.now)=>cmd(s,'report',{reporter_role:'nurse',category:'other',description:'A room issue needs review.',...extra},at);
const summarize=(s,filters={})=>cmd(s,'summarize-feedback',{filters});
const summary=(s,timeframe='month')=>D.buildFeedbackSummary(s,{timeframe});
const analyze=(s,unit='Pediatrics',timeframe='month')=>{const a=summarize(s,{timeframe});return cmd(a,'recommendation',{unit,summary_id:a.feedback_summaries.at(-1).id});};
const lastRec=s=>s.recommendations.at(-1);

test('reports can link to requested, cleaning, and completed work or stand alone',()=>{
 let s=request();s=report(s,{job_id:'J001',category:'equipment',description:'Keep the stethoscope.'});assert.equal(s.reports[0].room_id,'2150');assert.equal(s.reports[0].unit,'Pediatrics');
 s=start(s);s=report(s,{job_id:'J001',reporter_role:'evs'});s=finish(s,'J001',T+M);s=report(s,{job_id:'J001'});
 s=report(s,{unit:'Pediatrics',description:'A floor-wide problem.'});s=report(s,{description:'A general process problem.'});
 assert.equal(s.reports.length,5);assert.equal(s.reports[3].room_id,null);assert.equal(s.reports[3].unit,'Pediatrics');assert.equal(s.reports[4].unit,null);assert.equal(s.reports[4].job_id,null);assert.equal(s.jobs.length,1);
});
test('room-only reports work without creating a cleaning order; linked units cannot be spoofed',()=>{
 let s=report(fresh(),{room_id:'4100'});assert.equal(s.jobs.length,0);assert.equal(s.reports[0].unit,'Cardiology');
 s=report(request(),{job_id:'J001',unit:'Cardiology'});assert.equal(s.reports[0].unit,'Pediatrics');
 assert.throws(()=>report(request(),{job_id:'J001',room_id:'4100'}),/must match/);
});
test('invalid reports fail atomically and reporting timestamps come from the action clock',()=>{
 const s=request(),before=JSON.stringify(s);
 for(const extra of[{reporter_role:'admin'},{description:''},{description:'x'.repeat(1201)},{category:'invalid'},{unit:'Unknown'},{job_id:'missing'}])assert.throws(()=>report(s,extra),D.DomainError);
 assert.equal(JSON.stringify(s),before);const a=report(s,{at:T-1000},T+M);assert.equal(a.reports[0].at,T+M);assert.equal(a.reports[0].reporter_name,'Nurse Demo');
});
test('reports can be reviewed, resolved, and reopened while preserving original content',()=>{
 let s=report(request());s=cmd(s,'report-status',{report_id:'R001',status:'reviewed'},T+M);assert.equal(s.reports[0].reviewed_at,T+M);
 s=cmd(s,'report-status',{report_id:'R001',status:'resolved'},T+2*M);assert.equal(s.reports[0].resolved_at,T+2*M);
 s=cmd(s,'report-status',{report_id:'R001',status:'open'},T+3*M);assert.equal(s.reports[0].resolved_at,null);assert.equal(s.reports[0].at,T);assert.equal(s.reports[0].description,'A room issue needs review.');
 assert.throws(()=>cmd(s,'report-status',{report_id:'R001',status:'bad'}),D.DomainError);
});
test('sample feedback is explicit, labelled, idempotent, and never creates work or fake completions',()=>{
 const s=cmd(D.newState(T),'sample-feedback');assert.equal(s.jobs.length,1);assert.equal(s.reports.length,5);assert.ok(s.reports.every(r=>r.sample));
 assert.equal(D.performance(s).completed,0);assert.equal(s.settings.sample_feedback_loaded,true);assert.throws(()=>cmd(s,'sample-feedback'),/already loaded/);
 assert.equal(D.buildRecommendation(s,'Pediatrics',summary(s)).report_ids.length,4);assert.equal(D.buildRecommendation(s,'Pediatrics',summary(s,'all')).report_ids.length,5);
});
test('recommendations use the summarized month, include general issues, and exclude unrelated units',()=>{
 let s=cmd(fresh(),'sample-feedback');s=report(s,{unit:'Oncology',category:'equipment',description:'Keep equipment here.'});
 s=analyze(s);const r=lastRec(s);assert.equal(s.feedback_summaries.at(-1).filters.timeframe,'month');assert.equal(r.model,'simulated-rules');assert.equal(r.report_ids.length,4);
 assert.ok(!r.report_ids.includes('R006'));assert.ok(r.groups.some(g=>g.key==='stethoscope'&&g.report_ids.length===2));assert.ok(!Object.hasOwn(r,'highlight'));
 assert.equal(D.buildRecommendation(s,'Cardiology',summary(s)).report_ids.length,1);
});
test('generating analysis does not alter instructions; append needs an explicit apply action',()=>{
 let s=analyze(cmd(request(),'sample-feedback')),r=lastRec(s),before=s.settings.floor_instructions.Pediatrics;
 assert.equal(before,r.before);assert.equal(r.applied_at,null);s=cmd(s,'apply-recommendation',{recommendation_id:r.id,mode:'append',text:r.append_text,highlight:true});
 assert.equal(s.settings.floor_instructions.Pediatrics,before+'\n\n'+r.append_text);assert.ok(!Object.hasOwn(s.settings,'floor_highlights'));assert.match(D.instructions(s,job(s)),/Before leaving/);
 assert.equal(lastRec(s).applied_mode,'append');assert.ok(s.events.some(e=>e.kind==='instructions'&&e.recommendation_id===r.id&&e.changes.instructions.before===before));
 assert.throws(()=>cmd(s,'apply-recommendation',{recommendation_id:r.id,mode:'append',text:'Again',highlight:false}),/already applied/);
 assert.ok(s.reports.every(r=>r.status==='open'));
});
test('Admin can replace instructions with an edited draft without deleting nurse notes',()=>{
 let s=analyze(cmd(request(fresh(),{notes:'Keep bed rails clean.'}),'sample-feedback'));
 s=cmd(s,'apply-recommendation',{recommendation_id:lastRec(s).id,mode:'replace',text:'Retain all reusable room equipment.',highlight:false});
 assert.equal(s.settings.floor_instructions.Pediatrics,'Retain all reusable room equipment.');assert.equal(D.instructions(s,job(s)),'Retain all reusable room equipment.\n\nKeep bed rails clean.');
});
test('stale recommendations and invalid application choices cannot overwrite saved instructions',()=>{
 const generated=analyze(cmd(request(),'sample-feedback')),id=lastRec(generated).id;
 const changed=cmd(generated,'floor-instructions',{unit:'Pediatrics',instructions:'New saved text.'}),before=JSON.stringify(changed);
 assert.throws(()=>cmd(changed,'apply-recommendation',{recommendation_id:id,mode:'replace',text:'Old draft',highlight:true}),/changed/);assert.equal(JSON.stringify(changed),before);
 for(const extra of[{mode:'bad'},{text:''},{text:'x'.repeat(D.FLOOR_MAX+1)}])assert.throws(()=>cmd(generated,'apply-recommendation',{recommendation_id:id,mode:'append',text:'Valid',highlight:false,...extra}),D.DomainError);
});
test('unclassified feedback remains evidence for human review without invented instructions',()=>{
 let s=report(fresh(),{description:'The workers keep fooing when they should bar.'});s=analyze(s);const r=lastRec(s);
 assert.equal(r.report_ids.length,1);assert.equal(r.groups[0].key,'other');assert.equal(r.append_text,'');assert.equal(r.replacement_text,r.before);
});
test('timeframes validate their values and repeated analysis avoids duplicate instruction text',()=>{
 const s=cmd(fresh(),'sample-feedback');for(const period of['30',0,366,1.5,'yesterday'])assert.throws(()=>analyze(s,'Pediatrics',period),D.DomainError);
 const a=analyze(s),r=lastRec(a),b=cmd(a,'apply-recommendation',{recommendation_id:r.id,mode:'append',text:r.append_text,highlight:true});
 assert.equal(D.buildRecommendation(b,'Pediatrics',summary(b)).append_text,'');
});
test('pre-start estimates do not claim tasks and remaining-time updates retain initial forecasts',()=>{
 let s=cmd(request(),'estimate',{job_id:'J001',minutes:35,reason:'Extra work expected.'});assert.equal(job(s).status,'queued');assert.equal(job(s).worker_id,null);assert.equal(D.expectedMinutes(job(s)),35);
 s=start(s);assert.equal(job(s).initial_estimated_finish,T+35*M);s=cmd(s,'estimate',{job_id:'J001',minutes:10,reason:'Almost finished.'},T+5*M);
 assert.equal(job(s).forecast_finish,T+15*M);assert.equal(job(s).initial_estimated_finish,T+35*M);assert.equal(job(s).attempts[0].last_estimated_finish,T+15*M);
 assert.equal(job(s).estimate_history.length,2);assert.equal(job(s).estimate_history[1].kind,'remaining');assert.equal(job(s).estimate_history[1].reason,'Almost finished.');
 assert.equal(job(D.snapshot(s,T+8*M)).estimated_finish,T+15*M);assert.equal(job(D.snapshot(s,T+16*M)).overdue,true);
});
test('invalid estimates, changes to closed work, and changes to another worker fail atomically',()=>{
 const s=request(),before=JSON.stringify(s);for(const minutes of[0,241,1.5,'5'])assert.throws(()=>cmd(s,'estimate',{job_id:'J001',minutes}),D.DomainError);assert.equal(JSON.stringify(s),before);
 const other=cmd(s,'assign',{job_id:'J001',worker_id:'sam'});assert.throws(()=>cmd(other,'estimate',{job_id:'J001',minutes:5}),/another worker/);
 assert.throws(()=>cmd(finish(start(s)),'estimate',{job_id:'J001',minutes:5}),/closed/);
});
test('nurse cleaning-level changes do not erase an explicit active-worker estimate',()=>{
 let s=start(request());s=cmd(s,'estimate',{job_id:'J001',minutes:12},T+3*M);s=cmd(s,'edit',{job_id:'J001',cleaning_class:'extra'},T+4*M);
 assert.equal(job(s).duration,30);assert.equal(job(s).forecast_finish,T+15*M);
});
test('handoff can record an earlier completion and start the next task atomically',()=>{
 let s=start(request());s=request(s,{room_id:'4100'});s=cmd(s,'handoff',{previous_job_id:'J001',next_job_id:'J002',resolution:'complete',completed_at:T+10*M,ppe_confirmed:true},T+20*M);
 assert.equal(job(s).status,'complete');assert.equal(job(s).completed_at,T+10*M);assert.equal(job(s).completion_recorded_at,T+20*M);assert.equal(room(s).last_cleaned_at,T+10*M);
 assert.equal(job(s,'J002').status,'cleaning');assert.equal(job(s,'J002').started_at,T+20*M);assert.equal(D.unreadCompletions(s).length,1);
});
test('unfinished handoff creates an EVS report and releases the old task without marking it cleaned',()=>{
 let s=start(request());s=request(s,{room_id:'4100'});s=cmd(s,'handoff',{previous_job_id:'J001',next_job_id:'J002',resolution:'release',reason:'The room was unavailable.',ppe_confirmed:true},T+5*M);
 assert.equal(job(s).status,'queued');assert.equal(room(s).status,'requested');assert.equal(room(s).last_cleaned_at,null);assert.equal(job(s,'J002').status,'cleaning');
 assert.equal(s.reports[0].reporter_role,'evs');assert.equal(s.reports[0].job_id,'J001');assert.equal(s.reports[0].description,'The room was unavailable.');assert.equal(job(s).attempts[0].outcome,'cancelled');
});
test('failed handoffs roll back completion, issue reports, release, and next-task changes',()=>{
 let s=start(request());s=request(s,{room_id:'4100',availability_mode:'later',available_from:T+60*M});const before=JSON.stringify(s);
 const base={previous_job_id:'J001',next_job_id:'J002',resolution:'complete',ppe_confirmed:true};
 for(const extra of[{}, {resolution:'release',reason:'Supplies missing.'},{next_job_id:'J001'},{next_job_id:'missing'},{resolution:'bad'},{completed_at:T-M},{completed_at:T+10*M},{ppe_confirmed:false}])
  assert.throws(()=>cmd(s,'handoff',{...base,...extra},T+5*M),D.DomainError);
 assert.equal(JSON.stringify(s),before);assert.equal(s.reports.length,0);
});
test('an unfinished handoff requires an explanation even when the next task is available',()=>{
 let s=start(request());s=request(s,{room_id:'4100'});assert.throws(()=>cmd(s,'handoff',{previous_job_id:'J001',next_job_id:'J002',resolution:'release',reason:'',ppe_confirmed:true}),D.DomainError);
});
test('My requests and completion indicators are scoped to the current demo nurse',()=>{
 let s=request();s=finish(start(s),'J001',T+M);s=request(s,{room_id:'4100',requester_id:'another-nurse'});s=finish(start(s,'J002'),'J002',T+2*M);
 assert.deepEqual(D.myRequests(s,'completed').map(j=>j.id),['J001']);assert.equal(D.myRequests(s).length,0);assert.equal(D.unreadCompletions(s).length,1);
 const count=s.events.length;s=cmd(s,'seen-completions');assert.equal(D.unreadCompletions(s).length,0);assert.equal(s.events.length,count);assert.equal(job(s,'J002').completion_seen_at,null);
});
test('queue ordering puts urgent first, then available work and future availability times',()=>{
 let s=request(fresh(),{room_id:'4100',priority:'routine'});s=request(s,{room_id:'4101',priority:'urgent',availability_mode:'later',available_from:T+60*M});
 s=request(s,{room_id:'4102',priority:'urgent'});s=request(s,{room_id:'4103',priority:'urgent',availability_mode:'later',available_from:T+30*M});
 s=request(s,{room_id:'4104',priority:'routine',availability_mode:'later',available_from:T+15*M});
 assert.deepEqual(D.requestedTasks(s).map(j=>j.id),['J003','J004','J002','J001','J005']);
});
test('performance measures wait after availability, actual durations, and initial/revised forecast error',()=>{
 let s=request(fresh(),{availability_mode:'later',available_from:T+60*M});s=start(s,'J001',T+65*M);
 s=cmd(s,'estimate',{job_id:'J001',minutes:5,reason:'Nearly done.'},T+70*M);s=finish(s,'J001',T+78*M);
 s=report(s,{description:'General issue.'});s=report(s,{job_id:'J001'});s=report(s,{job_id:'J001',description:'A second report on the same task.'});
 let p=D.performance(s);assert.equal(p.completed,1);assert.equal(p.median_wait,5);assert.equal(p.basic_time,13);assert.equal(p.initial_error,7);assert.equal(p.revised_error,3);assert.equal(p.completed_with_reports,1);assert.equal(p.report_rate,1);
 s=request(s,{room_id:'4100',cleaning_class:'extra'},T+80*M);s=start(s,'J002',T+82*M);s=finish(s,'J002',T+112*M);p=D.performance(s);
 assert.equal(p.completed,2);assert.equal(p.median_wait,3.5);assert.equal(p.extra_time,30);assert.equal(p.initial_error,3.5);assert.equal(p.revised_error,1.5);assert.equal(p.report_rate,.5);assert.equal(D.performance(s,'Pediatrics').completed,1);
});
test('empty performance data is unavailable rather than a fabricated zero, and cancelled attempts are retained',()=>{
 assert.equal(D.performance(fresh()).median_wait,null);assert.equal(D.performance(fresh()).report_rate,null);
 let s=start(request());s=cmd(s,'release',{job_id:'J001'},T+5*M);s=start(s,'J001',T+10*M);s=finish(s,'J001',T+20*M);
 assert.equal(job(s).attempts.length,2);assert.equal(job(s).attempts[0].outcome,'cancelled');assert.equal(D.performance(s).basic_time,10);assert.equal(D.performance(s).median_wait,0);
});
test('audit records keep before/after values, actors, reasons, and original request evidence',()=>{
 let s=request(fresh(),{ppe:['Gloves']});s=cmd(s,'edit',{job_id:'J001',priority:'urgent',ppe:[],notes:'New instruction.'});s=cmd(s,'estimate',{job_id:'J001',minutes:25,reason:'More work.'});
 const edit=s.events.find(e=>e.kind==='edit'),estimate=s.events.find(e=>e.kind==='estimate');assert.deepEqual(edit.changes.priority,{before:'routine',after:'urgent'});assert.deepEqual(edit.changes.ppe,{before:['Gloves'],after:[]});
 assert.equal(edit.actor,'Nurse Demo');assert.equal(estimate.actor,'EVS worker 1');assert.equal(estimate.details.reason,'More work.');assert.deepEqual(s.events.find(e=>e.kind==='request').details.ppe,['Gloves']);
});
test('export includes reports, recommendations, jobs, settings, and activity as an independent snapshot',()=>{
 const s=analyze(cmd(request(),'sample-feedback')),out=D.exportData(s);assert.equal(out.session_only,true);assert.equal(out.version,'0.18');assert.equal(out.reports.length,5);assert.equal(out.recommendations.length,1);
 out.reports[0].description='Changed copy';assert.notEqual(s.reports[0].description,'Changed copy');assert.equal(out.exported_at,new Date(T).toISOString());
 const reset=cmd(s,'reset');assert.equal(reset.reports.length,0);assert.equal(reset.recommendations.length,0);assert.equal(reset.jobs.length,1);
});

test('start records preserve the instructions and PPE actually confirmed, despite later floor updates',()=>{
 let s=start(request(fresh(),{notes:'Keep the monitor.',ppe:['Gloves']}));const original=job(s).instructions_at_start;s=cmd(s,'floor-instructions',{unit:'Pediatrics',instructions:'New instructions for future work.'});
 assert.match(original,/stethoscope/);assert.equal(job(s).instructions_at_start,original);assert.equal(job(s).attempts[0].instructions,original);assert.deepEqual(job(s).attempts[0].ppe,['Gloves']);assert.equal(s.events.find(e=>e.kind==='start').details.instructions_at_start,original);
});

test('generic worker names and the selected employee scope task ownership and reporting',()=>{
 let s=request();assert.deepEqual(s.workers.map(w=>w.name),['EVS worker 1','EVS worker 2','EVS worker 3','EVS worker 4']);
 s=cmd(s,'assign',{job_id:'J001',worker_id:'jordan'});assert.equal(D.requestedTasks(s).length,0);s=cmd(s,'select-worker',{worker_id:'jordan'});assert.equal(D.requestedTasks(s)[0].id,'J001');
 s=finish(start(s));assert.equal(s.events.find(e=>e.kind==='complete').actor,'EVS worker 3');s=report(s,{reporter_role:'evs'});assert.equal(s.reports[0].reporter_name,'EVS worker 3');assert.throws(()=>cmd(s,'select-worker',{worker_id:'missing'}),D.DomainError);
});
test('available workers excludes cleaning but permits employees with waiting assignments',()=>{
 let s=cmd(request(),'assign',{job_id:'J001',worker_id:'sam'});assert.equal(D.availableWorkers(s).length,4);
 s=cmd(s,'select-worker',{worker_id:'sam'});s=start(s);assert.deepEqual(D.availableWorkers(s).map(w=>w.id),['maya','jordan','avery']);assert.equal(s.workers.length,4);
});
test('assignment messages follow the recipient and obsolete messages disappear after reassignment',()=>{
 let s=cmd(request(),'assign',{job_id:'J001',worker_id:'sam'});assert.equal(D.unreadAssignments(s).length,0);assert.equal(D.unreadAssignments(s,'sam').length,1);assert.match(s.notifications[0].message,/Room 2150/);
 s=cmd(s,'assign',{job_id:'J001',worker_id:'jordan'},T+M);assert.equal(D.unreadAssignments(s,'sam').length,0);assert.equal(s.notifications[0].obsolete_at,T+M);assert.equal(D.unreadAssignments(s,'jordan').length,1);
 const count=s.notifications.length;s=cmd(s,'assign',{job_id:'J001',worker_id:'jordan'});assert.equal(s.notifications.length,count);
 s=cmd(s,'select-worker',{worker_id:'jordan'});s=cmd(s,'seen-assignments');assert.equal(D.unreadAssignments(s).length,0);assert.equal(s.notifications[1].seen_at,T+M);
});
test('returning or cancelling a job retires assignment messages; starting also acknowledges them',()=>{
 const assigned=()=>cmd(request(),'assign',{job_id:'J001'});
 for(const a of['unassign','cancel']){const s=cmd(assigned(),a,{job_id:'J001'});assert.equal(D.unreadAssignments(s).length,0);assert.equal(s.notifications[0].obsolete_at,T);}
 const started=start(assigned());assert.equal(started.notifications[0].seen_at,T);assert.equal(D.unreadAssignments(started).length,0);assert.throws(()=>cmd(started,'assign',{job_id:'J001',worker_id:'sam'}),/unstarted/);
});
test('all-worker assignments can queue behind active cleaning and still enforce PPE eligibility',()=>{
 let s=start(request());s=request(s,{room_id:'4100'});s=cmd(s,'assign',{job_id:'J002',worker_id:'maya'});assert.equal(job(s,'J002').status,'assigned');assert.ok(job(s,'J002').estimated_start>job(s).estimated_finish);
 s=request(s,{room_id:'4127',ppe:['Respirator']});const before=JSON.stringify(s);assert.throws(()=>cmd(s,'assign',{job_id:'J003',worker_id:'sam'}),/PPE/);assert.equal(JSON.stringify(s),before);
});
test('automatic dispatch chooses the earliest compatible worker, then balances equal starts',()=>{
 let s=request(cmd(fresh(),'automatic',{enabled:true}));assert.equal(job(s).worker_id,'jordan');assert.equal(job(s).estimated_start,T+4*M);assert.equal(s.notifications[0].worker_id,'jordan');
 s=request(s,{room_id:'2151'});assert.equal(job(s,'J002').worker_id,'avery');
 let p=request(cmd(fresh(),'automatic',{enabled:true}),{ppe:['Respirator']});assert.equal(job(p).worker_id,'avery');
 let b=start(request(fresh(),{room_id:'4100'}));b=cmd(b,'automatic',{enabled:true});b=request(b,{room_id:'4101'});assert.equal(job(b,'J002').worker_id,'sam');
 let f=cmd(fresh(),'automatic',{enabled:true});f=request(f,{room_id:'4100',availability_mode:'later',available_from:T+120*M});f=request(f,{room_id:'4101',availability_mode:'later',available_from:T+120*M});assert.equal(job(f,'J002').worker_id,'sam');
});
test('calendar timeframes use local midnight, Monday, month and year boundaries',()=>{
 const at=Date.parse('2026-06-03T12:00:00-04:00');
 for(const[period,date]of[['today','2026-06-03T00:00:00-04:00'],['week','2026-06-01T00:00:00-04:00'],['month','2026-06-01T00:00:00-04:00'],['year','2026-01-01T00:00:00-05:00']]){
  const lower=Date.parse(date);assert.equal(D.timeframeStart(at,period),lower);assert.equal(D.inTimeframe(lower,at,period),true);assert.equal(D.inTimeframe(lower-1,at,period),false);
 }
 assert.equal(D.timeframeStart(at,'all'),null);assert.equal(D.inTimeframe(0,at,'all'),true);assert.equal(D.inTimeframe(at+1,at,'all'),false);assert.equal(D.timeframeStart(Date.parse('2026-06-07T23:59:00-04:00'),'week'),Date.parse('2026-06-01T00:00:00-04:00'));
 assert.equal(D.timeframeStart(Date.parse('2026-06-08T00:00:00-04:00'),'week'),Date.parse('2026-06-08T00:00:00-04:00'));
});
test('local calendar boundaries remain correct over daylight saving changes',()=>{
 const now=Date.parse('2026-03-08T23:30:00-04:00'),start=Date.parse('2026-03-08T00:00:00-05:00');assert.equal(D.timeframeStart(now,'today'),start);assert.equal(D.inTimeframe(start,now,'today'),true);assert.equal(D.inTimeframe(start-1,now,'today'),false);
 const fall=Date.parse('2026-11-01T23:30:00-05:00');assert.equal(D.timeframeStart(fall,'today'),Date.parse('2026-11-01T00:00:00-04:00'));
});
test('Feedback summaries exactly preserve the displayed status, unit and calendar-period source set',()=>{
 const at=Date.parse('2026-06-03T12:00:00-04:00');let s=D.newState(at-3*D.DAY,{seedDemo:false});s=report(s,{unit:'Pediatrics',description:'Old month report.'});s=report(s,{unit:'Pediatrics'},at-2*M);s=report(s,{description:'General issue.'},at-M);s=report(s,{unit:'Oncology'},at);s=cmd(s,'report-status',{report_id:'R002',status:'resolved'},at);
 const filters={status:'open',unit:'Pediatrics',timeframe:'month'},ids=D.filteredReports(s,filters).map(r=>r.id);assert.deepEqual(ids,['R003']);s=summarize(s,filters);assert.deepEqual(s.feedback_summaries[0].report_ids,ids);assert.deepEqual(s.feedback_summaries[0].filters,filters);
 s=cmd(s,'recommendation',{unit:'Pediatrics',summary_id:'S001'});assert.deepEqual(lastRec(s).report_ids,ids);assert.throws(()=>D.filteredReports(s,{status:'missing'}),D.DomainError);assert.throws(()=>D.filteredReports(s,{unit:'missing'}),D.DomainError);assert.throws(()=>summarize(s,{status:'reviewed'}),/no displayed/);
});
test('a multi-unit summary creates drafts using only target-unit and general source reports',()=>{
 let s=report(fresh(),{unit:'Pediatrics',description:'Retain the stethoscope.'});s=report(s,{unit:'Oncology',description:'Supplies missing.'});s=report(s,{description:'General equipment handling issue.'});s=summarize(s,{timeframe:'all'});
 s=cmd(s,'recommendation',{unit:'Pediatrics',summary_id:'S001'});assert.deepEqual(new Set(lastRec(s).report_ids),new Set(['R001','R003']));assert.ok(!lastRec(s).append_text.includes('supplies needed'));
 s=cmd(s,'recommendation',{unit:'Cardiology',summary_id:'S001'});assert.deepEqual(lastRec(s).report_ids,['R003']);
});
test('performance filters by actual completion rather than request or reporting time',()=>{
 const midnight=Date.parse('2026-06-01T00:00:00-04:00');let s=D.newState(midnight-2*M,{seedDemo:false});s=finish(start(request(s)),'J001',midnight-M);s=request(s,{room_id:'2151'},midnight);s=finish(start(s,'J002'),'J002',midnight+M);
 assert.equal(D.performance(s,null,'today').completed,1);assert.equal(D.performance(s,null,'week').completed,1);assert.equal(D.performance(s,null,'month').completed,1);assert.equal(D.performance(s,null,'year').completed,2);assert.equal(D.performance(s,null,'all').completed,2);assert.throws(()=>D.performance(fresh(),null,'missing'),D.DomainError);
});
test('60+ estimates are lower bounds, never become overdue, and are excluded from precision errors',()=>{
 let s=cmd(request(),'estimate',{job_id:'J001',minutes:60,at_least:true});s=start(s);assert.equal(job(s).expected_at_least,true);assert.equal(job(s).attempts[0].initial_at_least,true);assert.equal(job(D.snapshot(s,T+120*M)).overdue,false);
 s=finish(s,'J001',T+90*M);assert.equal(D.performance(s).initial_error,null);assert.equal(D.performance(s).revised_error,null);
 let p=start(request());p=cmd(p,'estimate',{job_id:'J001',minutes:60,at_least:true},T+5*M);assert.equal(job(p).forecast_at_least,true);assert.equal(job(p).estimate_history[0].at_least,true);p=finish(p,'J001',T+80*M);assert.equal(D.performance(p).initial_error,60);assert.equal(D.performance(p).revised_error,null);
 assert.throws(()=>cmd(request(),'estimate',{job_id:'J001',minutes:50,at_least:true}),/60\+/);
});
test('free-form reports infer a display topic without requiring a category selection',()=>{
 const s=cmd(request(),'report',{reporter_role:'nurse',job_id:'J001',description:'Keep and clean the reusable stethoscope.'});assert.equal(s.reports[0].category,'equipment');assert.equal(s.reports[0].description,'Keep and clean the reusable stethoscope.');
});

test('sample performance creates labelled historical data without changing live work or rooms',()=>{
 const original=start(request()),before=JSON.stringify({jobs:original.jobs,rooms:original.rooms,workers:original.workers,reports:original.reports}),s=cmd(original,'sample-performance');
 assert.equal(s.performance_samples.length,48);assert.equal(s.settings.sample_performance_loaded,true);assert.equal(JSON.stringify({jobs:s.jobs,rooms:s.rooms,workers:s.workers,reports:s.reports}),before);assert.equal(original.performance_samples.length,0);
 assert.ok(s.performance_samples.every(j=>j.sample&&j.status==='complete'&&j.requested_at<=j.available_from&&j.available_from<=j.started_at&&j.started_at<=j.completed_at&&j.completed_at<=T));assert.equal(new Set(s.performance_samples.map(j=>j.id)).size,48);
 assert.equal(s.events.at(-1).sample,true);assert.equal(s.events.at(-1).details.count,48);const saved=JSON.stringify(s);assert.throws(()=>cmd(s,'sample-performance'),/already loaded/);assert.equal(JSON.stringify(s),saved);
});
test('sample metrics populate all fields and follow unit and completion-time filters',()=>{
 const s=cmd(fresh(),'sample-performance'),all=D.performance(s),today=D.performance(s,null,'today');assert.equal(all.completed,48);assert.equal(all.sample_completed,48);assert.equal(all.completed_with_reports,7);assert.equal(today.completed,12);assert.equal(today.sample_completed,12);
 for(const unit of ['Cardiology','Oncology','Pediatrics']){assert.equal(D.performance(s,unit,'all').completed,16);assert.equal(D.performance(s,unit,'today').completed,4);}
 for(const key of['median_wait','basic_time','extra_time','initial_error','revised_error','report_rate'])assert.ok(Number.isFinite(all[key]),key);assert.ok(all.revised_error<all.initial_error);assert.ok(D.performance(s,null,'year').completed<48);assert.ok(D.performance(s,null,'week').completed>=12);
});
test('real completions combine with sample metrics and reset clears all samples',()=>{
 let s=finish(start(request()),'J001',T+M);s=report(s,{job_id:'J001'});s=cmd(s,'sample-performance');const p=D.performance(s,null,'today');assert.equal(p.completed,13);assert.equal(p.sample_completed,12);assert.equal(p.completed_with_reports,3);
 const out=D.exportData(s);assert.equal(out.performance_samples.length,48);out.performance_samples[0].room_id='changed';assert.notEqual(s.performance_samples[0].room_id,'changed');s=cmd(s,'reset');assert.equal(s.performance_samples.length,0);assert.equal(s.settings.sample_performance_loaded,false);assert.equal(D.performance(s).completed,0);
});
test('sample calendar cohorts handle local midnight and daylight saving days without future dates',()=>{
 for(const date of['2026-11-11T00:00:00-05:00','2026-11-01T23:50:00-05:00','2026-03-08T23:50:00-04:00']){
  const at=Date.parse(date),s=cmd(D.newState(at,{seedDemo:false}),'sample-performance');assert.equal(D.performance(s,null,'today').completed,12);assert.ok(s.performance_samples.every(j=>j.completed_at<=at));assert.equal(D.performance(s,null,'all').completed,48);
 }
});
test('sample summary paragraphs describe the exact filtered issues and counts',()=>{
 const s=cmd(fresh(),'sample-feedback'),a=D.buildFeedbackSummary(s);assert.equal(a.paragraphs.length,3);assert.ok(a.paragraphs.some(p=>p.startsWith('2 Pediatrics reports describe reusable stethoscopes being discarded')));assert.ok(a.paragraphs.some(p=>p.includes('missed cleaning under a bed')));assert.ok(a.paragraphs.some(p=>p.includes('needed supplies being unavailable')));assert.ok(!a.paragraphs.some(p=>p.includes('scheduled cleaning time')));
 const all=D.buildFeedbackSummary(s,{timeframe:'all'});assert.ok(all.paragraphs.some(p=>p.includes('unavailable at its scheduled cleaning time')));const only=cmd(s,'report-status',{report_id:'R001',status:'resolved'});const r=D.buildFeedbackSummary(only,{status:'resolved'});assert.deepEqual(r.report_ids,['R001']);assert.equal(r.paragraphs.length,1);assert.match(r.paragraphs[0],/^1 Pediatrics report describes/);
});
test('custom summaries preserve actual wording and never substitute sample claims',()=>{
 let s=cmd(fresh(),'report',{reporter_role:'nurse',description:'The stethoscope label needs replacing.'});const original=s.settings.floor_instructions.Pediatrics;s=summarize(s);const a=s.feedback_summaries[0];assert.ok(a.paragraphs[0].includes('The stethoscope label needs replacing.'));assert.ok(!a.paragraphs[0].includes('discarded'));assert.equal(s.settings.floor_instructions.Pediatrics,original);assert.equal(s.recommendations.length,0);
});
