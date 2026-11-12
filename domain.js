/* Static demo domain: explicit actions, real timestamps, session-only state. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.EVSyncDomain=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const USER_WORKER_ID='maya',NURSE_ID='nurse-demo',MINUTE=60000,DAY=86400000,FLOOR_MAX=2400;
  const CLASSES={basic:{label:'Basic',minutes:20},extra:{label:'Extra',minutes:30}};
  const PPE=['Gloves','Gown','Medical mask','Eye protection','Respirator'];
  const UNITS={Cardiology:0,Oncology:1,Pediatrics:2};
  const TIMEFRAMES={today:'Today',week:'This week',month:'This month',year:'This year',all:'All time'};
  const CATEGORIES={equipment:'Equipment handling',cleaning:'Cleaning quality',access:'Room availability',supplies:'Supplies',other:'Other'};
  const DEFAULT_INSTRUCTIONS={Cardiology:'',Oncology:'',Pediatrics:'Retain and clean the reusable stethoscope. Do not discard.'};
  const ACTIVE=new Set(['queued','assigned','cleaning']),ROOM_ORDER={cleaning:0,requested:1,cleaned:2,unknown:3};
  const clone=value=>JSON.parse(JSON.stringify(value)),compare=(a,b)=>a<b?-1:a>b?1:0;
  class DomainError extends Error{constructor(message){super(message);this.name='DomainError';}}
  function find(items,id,label){const item=items.find(v=>String(v.id)===String(id));if(!item)throw new DomainError(`${label} not found.`);return item;}
  function clock(s,at){if(!Number.isFinite(at))throw new DomainError('Supply a valid timestamp.');s.settings.now=at;return s;}
  function validUnit(unit){return Object.hasOwn(UNITS,unit);}
  function content(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new DomainError(`Enter ${required?'a description of ':''}up to ${max} characters.`);return value.trim();}
  function changes(before,after,fields){const result={};for(const key of fields)if(JSON.stringify(before[key])!==JSON.stringify(after[key]))result[key]={before:clone(before[key]??null),after:clone(after[key]??null)};return result;}
  function event(s,kind,message,job=null,actor='System',delta={},extra={}){s.events.push({id:++s.settings.event_seq,at:s.settings.now,kind,message,job_id:job,actor,changes:delta,...extra});}
  function taskOrder(a,b,now=Date.now()){return Number(b.priority==='urgent')-Number(a.priority==='urgent')||Math.max(now,a.available_from)-Math.max(now,b.available_from)||a.requested_at-b.requested_at||compare(a.id,b.id);}
  function requestedTasks(s,workerId=s.settings.user_worker_id){return s.jobs.filter(j=>j.status==='queued'||(j.worker_id===workerId&&['assigned','cleaning'].includes(j.status))).sort((a,b)=>taskOrder(a,b,s.settings.now));}
  function myRequests(s,tab='active'){return s.jobs.filter(j=>j.requester_id===s.settings.nurse_id&&(tab==='completed'?j.status==='complete':ACTIVE.has(j.status))).sort((a,b)=>tab==='completed'?b.completed_at-a.completed_at||compare(b.id,a.id):Number(b.status==='cleaning')-Number(a.status==='cleaning')||taskOrder(a,b,s.settings.now));}
  function unreadCompletions(s){return myRequests(s,'completed').filter(j=>j.completion_seen_at==null);}
  function roomStatus(s,room){const active=s.jobs.find(j=>j.room_id===room.id&&ACTIVE.has(j.status));return active?(active.status==='cleaning'?'cleaning':'requested'):room.last_cleaned_at==null?'unknown':'cleaned';}
  function sortedRooms(s,rooms=s.rooms){return [...rooms].sort((a,b)=>ROOM_ORDER[roomStatus(s,a)]-ROOM_ORDER[roomStatus(s,b)]||Number(a.id)-Number(b.id));}
  function floorInstructions(s,job){return s.settings.floor_instructions[find(s.rooms,job.room_id,'Room').unit]||'';}
  function instructions(s,job){return [floorInstructions(s,job),job.notes].filter(Boolean).join('\n\n');}
  function startIssue(s,job){if(s.settings.now<job.available_from)return 'This room is not available for cleaning yet.';const w=find(s.workers,s.settings.user_worker_id,'Worker');return job.ppe.every(p=>w.ppe.includes(p))?'':'This worker does not cover the required PPE.';}
  function expectedMinutes(job){return job.expected_minutes??job.duration;}
  function travelMinutes(from,to){return 2+3*Math.abs(UNITS[from]-UNITS[to]);}
  function schedule(s){
    const now=s.settings.now,rooms=Object.fromEntries(s.rooms.map(r=>[r.id,r]));s.rooms.forEach(r=>{r.status=roomStatus(s,r);});
    s.jobs.filter(j=>ACTIVE.has(j.status)).sort((a,b)=>taskOrder(a,b,now)).forEach((j,i)=>j.queue_rank=i+1);
    for(const j of s.jobs.filter(j=>j.status==='queued'))Object.assign(j,{worker_id:null,estimated_finish:null,estimated_start:null,breakdown:null});
    for(const worker of s.workers){
      const active=s.jobs.find(j=>j.worker_id===worker.id&&j.status==='cleaning');let available=now,unit=worker.unit;
      if(active){active.estimated_finish=active.forecast_finish;active.overdue=!active.forecast_at_least&&now>active.forecast_finish;available=Math.max(now,active.forecast_finish);unit=rooms[active.room_id].unit;}
      const pending=s.jobs.filter(j=>j.worker_id===worker.id&&j.status==='assigned');
      while(pending.length){
        pending.sort((a,b)=>Math.max(available,a.available_from)-Math.max(available,b.available_from)||taskOrder(a,b,now));
        const j=pending.shift(),travel=travelMinutes(unit,rooms[j.room_id].unit),prep=2+(j.ppe.includes('Respirator')?2:0);
        const start=Math.max(available+(travel+prep)*MINUTE,j.available_from);
        j.breakdown={wait:Math.max(0,(start-now)/MINUTE-travel-prep),travel,prep,clean:expectedMinutes(j)};
        j.estimated_start=start;j.estimated_finish=start+expectedMinutes(j)*MINUTE;available=j.estimated_finish;unit=rooms[j.room_id].unit;
      }
    }return s;
  }
  function workerName(s,id=s.settings.user_worker_id){return find(s.workers,id,'Worker').name;}
  function availableWorkers(s){return s.workers.filter(w=>!s.jobs.some(j=>j.worker_id===w.id&&j.status==='cleaning'));}
  function unreadAssignments(s,id=s.settings.user_worker_id){return s.notifications.filter(n=>n.worker_id===id&&n.seen_at===null&&n.obsolete_at===null&&s.jobs.some(j=>j.id===n.job_id&&j.worker_id===id&&j.status==='assigned'));}
  function retireAssignments(s,jobId){for(const n of s.notifications.filter(n=>n.job_id===jobId&&n.obsolete_at===null))n.obsolete_at=s.settings.now;}
  function assign(s,j,workerId,source){
    if(!['queued','assigned'].includes(j.status))throw new DomainError('Only an unstarted task can be assigned.');const w=find(s.workers,workerId,'Worker');
    if(!j.ppe.every(p=>w.ppe.includes(p)))throw new DomainError('This worker does not cover the PPE requirements.');
    if(j.status==='assigned'&&j.worker_id===w.id)return;
    const before=j.worker_id;retireAssignments(s,j.id);Object.assign(j,{status:'assigned',worker_id:w.id,assigned_at:s.settings.now,assignment_source:source});
    if(source!=='start')s.notifications.push({id:`N${String(++s.settings.notification_seq).padStart(3,'0')}`,at:s.settings.now,worker_id:w.id,job_id:j.id,message:`You have been assigned Room ${j.room_id}.`,seen_at:null,obsolete_at:null});
    event(s,'assignment',`Room ${j.room_id} → ${w.name}`,j.id,source==='admin'?'EVS Admin':source==='automatic'?'System':w.name,{worker_id:{before,after:w.id}});
  }
  function mostAvailableWorker(s,job){
    const candidates=s.workers.filter(w=>job.ppe.every(p=>w.ppe.includes(p))).map((w,index)=>{
      const copy=clone(s),trial=find(copy.jobs,job.id,'Job');Object.assign(trial,{status:'assigned',worker_id:w.id});schedule(copy);
      return {worker:w,start:trial.estimated_start,load:s.jobs.filter(j=>j.worker_id===w.id&&ACTIVE.has(j.status)).length,index};
    }).sort((a,b)=>a.start-b.start||a.load-b.load||a.index-b.index);
    if(!candidates.length)throw new DomainError('No employee covers the required PPE.');return candidates[0].worker;
  }
  function timeframeStart(at,period='all'){
    if(!Object.hasOwn(TIMEFRAMES,period))throw new DomainError('Choose a valid timeframe.');if(period==='all')return null;
    const d=new Date(at);d.setHours(0,0,0,0);if(period==='week')d.setDate(d.getDate()-(d.getDay()+6)%7);if(period==='month')d.setDate(1);if(period==='year'){d.setMonth(0,1);}return d.getTime();
  }
  function inTimeframe(at,now,period='all'){const start=timeframeStart(now,period);return Number.isFinite(at)&&at<=now&&(start===null||at>=start);}
  function filteredReports(s,{status='all',unit='all',timeframe='month'}={}){
    if(!['all','open','reviewed','resolved'].includes(status)||(unit!=='all'&&!validUnit(unit)))throw new DomainError('Choose valid report filters.');timeframeStart(s.settings.now,timeframe);
    return s.reports.filter(r=>(status==='all'||r.status===status)&&(unit==='all'||r.unit===unit||r.unit===null)&&inTimeframe(r.at,s.settings.now,timeframe)).sort((a,b)=>b.at-a.at||compare(b.id,a.id));
  }
  function requestFields(s,data){
    const type=data.cleaning_class??'basic';if(!Object.hasOwn(CLASSES,type))throw new DomainError('Choose Basic or Extra cleaning.');
    const ppe=data.ppe===undefined?[]:data.ppe;if(!Array.isArray(ppe)||!ppe.every(p=>PPE.includes(p)))throw new DomainError('Choose valid PPE requirements or leave them empty.');
    const priority=data.priority??'routine';if(!['routine','urgent'].includes(priority))throw new DomainError('Choose routine or urgent priority.');
    return {cleaning_class:type,priority,ppe:[...new Set(ppe)],notes:content(data.notes??'',600),duration:s.settings.durations[type]};
  }
  function availabilityFields(s,data,previous=null){
    const mode=data.availability_mode??previous?.availability_mode??'now';if(!['now','later'].includes(mode))throw new DomainError('Choose a valid availability option.');
    if(mode==='now')return {availability_mode:'now',available_from:previous?.availability_mode==='now'?previous.available_from:s.settings.now};
    const from=data.available_from??previous?.available_from;if(!Number.isFinite(from))throw new DomainError('Enter a valid availability date and time.');
    if(!(previous?.availability_mode==='later'&&from===previous.available_from)&&from<s.settings.now)throw new DomainError('Choose a future availability time, or select Now.');
    return {availability_mode:'later',available_from:from};
  }
  function createJob(s,data){
    const room=find(s.rooms,data.room_id,'Room');if(s.jobs.some(j=>j.room_id===room.id&&ACTIVE.has(j.status)))throw new DomainError('This room already has an active cleaning request.');
    const fields=requestFields(s,data),availability=availabilityFields(s,data);
    const requester=typeof data.requester_id==='string'&&data.requester_id?data.requester_id:s.settings.nurse_id;
    const j={id:`J${String(++s.settings.job_seq).padStart(3,'0')}`,room_id:room.id,...fields,...availability,status:'queued',worker_id:null,requester_id:requester,
      requested_at:s.settings.now,assigned_at:null,assignment_source:null,started_at:null,first_started_at:null,completed_at:null,completion_recorded_at:null,completion_seen_at:null,
      estimated_finish:null,estimated_start:null,expected_minutes:null,expected_at_least:false,forecast_at_least:false,forecast_finish:null,initial_estimated_finish:null,instructions_at_start:null,attempts:[],estimate_history:[]};
    s.jobs.push(j);event(s,'request',`Room ${room.id} · ${CLASSES[j.cleaning_class].label} cleaning requested`,j.id,'Nurse Demo',{}, {details:{priority:j.priority,available_from:j.available_from,notes:j.notes,ppe:j.ppe}});
    if(s.settings.automatic_assignment)assign(s,j,mostAvailableWorker(s,j).id,'automatic');
  }
  function newState(at=Date.now(),{seedDemo=true}={}){
    const s={settings:{now:at,job_seq:0,event_seq:0,report_seq:0,recommendation_seq:0,summary_seq:0,notification_seq:0,durations:{basic:20,extra:30},floor_instructions:clone(DEFAULT_INSTRUCTIONS),
      sample_feedback_loaded:false,sample_performance_loaded:false,automatic_assignment:false,user_worker_id:USER_WORKER_ID,nurse_id:NURSE_ID},
      rooms:[],workers:[],jobs:[],events:[],reports:[],recommendations:[],feedback_summaries:[],notifications:[],performance_samples:[]};clock(s,at);
    for(const[unit,first,last]of[['Cardiology',4100,4120],['Oncology',4121,4140],['Pediatrics',2150,2170]])for(let n=first;n<=last;n++)s.rooms.push({id:String(n),unit,status:'unknown',last_cleaned_at:null});
    for(const[id,name,unit,respirator]of[['maya','EVS worker 1','Cardiology',true],['sam','EVS worker 2','Cardiology',false],['jordan','EVS worker 3','Pediatrics',false],['avery','EVS worker 4','Oncology',true]])s.workers.push({id,name,unit,ppe:respirator?[...PPE]:PPE.slice(0,-1),completed:0});
    if(seedDemo)createJob(s,{room_id:'2150',cleaning_class:'basic',ppe:[]});return schedule(s);
  }
  function requireOwner(j,id){if(j.worker_id!==id)throw new DomainError('This task belongs to another worker.');}
  function activeAttempt(j){return j.attempts.at(-1);}
  function release(s,j,actor){
    retireAssignments(s,j.id);
    if(j.status==='cleaning')Object.assign(activeAttempt(j),{ended_at:s.settings.now,outcome:'cancelled'});
    Object.assign(j,{status:'queued',worker_id:null,assigned_at:null,assignment_source:null,started_at:null,completed_at:null,forecast_finish:null,initial_estimated_finish:null,instructions_at_start:null,estimated_finish:null,estimated_start:null,breakdown:null,overdue:false});
    event(s,'release',`Room ${j.room_id} returned to requested tasks`,j.id,actor);
  }
  function completeJob(s,j,data){
    requireOwner(j,data.worker_id||s.settings.user_worker_id);if(j.status!=='cleaning'||data.checks_confirmed!==true)throw new DomainError('Confirm cleaning before marking cleaned.');
    const at=data.completed_at??s.settings.now;if(!Number.isFinite(at)||at<j.started_at||at>s.settings.now)throw new DomainError('Completion time must be between the cleaning start and now.');
    retireAssignments(s,j.id);Object.assign(activeAttempt(j),{ended_at:at,recorded_at:s.settings.now,outcome:'complete'});
    Object.assign(j,{status:'complete',completed_at:at,completion_recorded_at:s.settings.now,completion_seen_at:null,estimated_finish:at});
    const room=find(s.rooms,j.room_id,'Room');room.last_cleaned_at=Math.max(room.last_cleaned_at??0,at);find(s.workers,j.worker_id,'Worker').completed++;
    event(s,'complete',`Room ${j.room_id} cleaned`,j.id,workerName(s,j.worker_id),{status:{before:'cleaning',after:'complete'}},{details:{completed_at:at,recorded_at:s.settings.now}});
  }
  function recordReport(s,data,{sample=false,at=s.settings.now}={}){
    if(!['nurse','evs'].includes(data.reporter_role))throw new DomainError('Choose Nurse or EVS as the reporting role.');
    let j=null,room=null,unit=data.unit||null;
    if(data.job_id){j=find(s.jobs,data.job_id,'Task');room=find(s.rooms,j.room_id,'Room');if(data.room_id&&data.room_id!==room.id)throw new DomainError('The task and room must match.');}
    else if(data.room_id)room=find(s.rooms,data.room_id,'Room');
    if(room)unit=room.unit;if(unit!==null&&!validUnit(unit))throw new DomainError('Choose a valid unit, or All units.');
    const guessed=topic({description:typeof data.description==='string'?data.description:'',category:'other'});
    const category=data.category||(guessed==='stethoscope'?'equipment':guessed);if(!Object.hasOwn(CATEGORIES,category))throw new DomainError('Choose a valid issue category.');
    const r={id:`R${String(++s.settings.report_seq).padStart(3,'0')}`,at,reporter_role:data.reporter_role,reporter_name:data.reporter_role==='nurse'?'Nurse Demo':workerName(s),job_id:j?.id||null,room_id:room?.id||null,unit,
      category,description:content(data.description,1200,true),status:'open',reviewed_at:null,resolved_at:null,sample};
    s.reports.push(r);event(s,sample?'example':'issue',`${sample?'Example report':'Issue reported'} · ${room?'Room '+room.id:unit||'General issue'}`,j?.id||null,r.reporter_name,{}, {report_id:r.id,sample,details:{category,unit}});return r;
  }
  const RULES={
    stethoscope:{label:'Stethoscope handling',text:'Before leaving the room, confirm the reusable stethoscope has been retained for cleaning and reuse.'},
    equipment:{label:'Reusable equipment',text:'Check the floor instructions before discarding reusable equipment; ask the EVS admin when handling is unclear.'},
    cleaning:{label:'Missed cleaning details',text:'Before marking a task done, recheck any areas called out in the room instructions.'},
    access:{label:'Room availability',text:'If the room is unavailable at the stated time, report the access issue and revise the estimate with an explanation.'},
    supplies:{label:'Supply shortages',text:'Check that the supplies needed for the task are available before starting and report shortages promptly.'},
    other:{label:'Other issues requiring review',text:''}};
  function topic(r){const t=r.description.toLowerCase();if(/stethoscope/.test(t))return 'stethoscope';if(r.category!=='other')return r.category;if(/discard|reusable|equipment/.test(t))return 'equipment';if(/under the bed|under bed|missed|dirty/.test(t))return 'cleaning';if(/suppl|shortage/.test(t))return 'supplies';if(/unavailable|occupied|access/.test(t))return 'access';return 'other';}
  function groupedReports(reports){
    const groups=[];for(const r of reports){const key=topic(r);let g=groups.find(g=>g.key===key);if(!g){g={key,label:RULES[key].label,report_ids:[]};groups.push(g);}g.report_ids.push(r.id);}
    return groups.sort((a,b)=>b.report_ids.length-a.report_ids.length||compare(a.key,b.key));
  }
  function summaryParagraph(group,reports){
    const sources=group.report_ids.map(id=>find(reports,id,'Report')),units=[...new Set(sources.map(r=>r.unit||'general'))];
    const count=sources.length,subject=`${count} ${units.length===1?units[0]+' ':''}report${count===1?'':'s'}`;
    const samples={stethoscope:'reusable stethoscopes being discarded instead of retained for cleaning and reuse',equipment:'problems retaining and cleaning reusable equipment',cleaning:'missed cleaning under a bed',access:'a room being unavailable at its scheduled cleaning time',supplies:'needed supplies being unavailable at the start of tasks, causing delays'};
    if(sources.every(r=>r.sample)&&samples[group.key])return `${subject} ${count===1?'describes':'describe'} ${samples[group.key]}.`;
    const excerpts=[...new Set(sources.map(r=>r.description))].slice(0,2).map(t=>`“${t.length>220?t.slice(0,217)+'…':t}”`).join(' ');
    return `${subject} ${count===1?'raises':'raise'} ${group.key==='other'?'an issue for review':'concerns about '+group.label.toLowerCase()}: ${excerpts}`;
  }
  function buildFeedbackSummary(s,filters={}){
    const scope={status:filters.status??'all',unit:filters.unit??'all',timeframe:filters.timeframe??'month'},reports=filteredReports(s,scope),groups=groupedReports(reports);
    return {generated_at:s.settings.now,filters:scope,report_ids:reports.map(r=>r.id),groups,paragraphs:groups.map(g=>summaryParagraph(g,reports)),model:'simulated-rules'};
  }
  function loadPerformanceSamples(s){
    if(s.settings.sample_performance_loaded)throw new DomainError('Sample performance data is already loaded.');
    const now=s.settings.now,cohorts=[[0,12],[1,12],[10,12],[45,8],[400,4]],units=Object.keys(UNITS);let index=0;
    for(const[daysBack,count]of cohorts){
      const day=new Date(now);day.setHours(0,0,0,0);day.setDate(day.getDate()-daysBack);const begin=day.getTime();
      const next=new Date(begin);next.setDate(next.getDate()+1);const end=daysBack===0?now:next.getTime()-1;
      for(let i=0;i<count;i++,index++){
        const completed=Math.floor(begin+(end-begin)*(i+.5)/count),unit=units[index%units.length],rooms=s.rooms.filter(r=>r.unit===unit),type=index%2?'extra':'basic';
        const duration=CLASSES[type].minutes-2+(index%5)*2,wait=[3,7,12,5,9,4][index%6],started=completed-duration*MINUTE,available=started-wait*MINUTE;
        const initial=started+CLASSES[type].minutes*MINUTE,revised=completed+[-3,-1,1,2,0,2][index%6]*MINUTE;
        s.performance_samples.push({id:`P${String(index+1).padStart(3,'0')}`,sample:true,status:'complete',room_id:rooms[index%rooms.length].id,worker_id:s.workers[index%s.workers.length].id,
          cleaning_class:type,requested_at:available-5*MINUTE,available_from:available,first_started_at:started,started_at:started,completed_at:completed,with_report:index%7===0,
          attempts:[{started_at:started,initial_estimated_finish:initial,last_estimated_finish:revised,initial_at_least:false,last_at_least:false,ended_at:completed,outcome:'complete'}]});
      }
    }
    s.settings.sample_performance_loaded=true;
    event(s,'example','Sample performance data loaded',null,'EVS Admin',{}, {sample:true,details:{count:s.performance_samples.length}});
  }
  function buildRecommendation(s,unit,summary){
    if(!validUnit(unit)||!summary||!Array.isArray(summary.report_ids))throw new DomainError('Choose a unit and summarize the displayed reports first.');
    const reports=summary.report_ids.map(id=>find(s.reports,id,'Report')).filter(r=>r.unit===unit||r.unit===null);
    if(!reports.length)throw new DomainError('The displayed reports do not apply to this unit.');
    const groups=groupedReports(reports),before=s.settings.floor_instructions[unit],updates=groups.map(g=>RULES[g.key].text).filter(t=>t&&!before.toLowerCase().includes(t.toLowerCase()));
    const append=updates.join('\n');return {unit,summary_id:summary.id,generated_at:s.settings.now,before,report_ids:reports.map(r=>r.id),groups,append_text:append,replacement_text:[before,append].filter(Boolean).join('\n'),model:'simulated-rules'};
  }
  function median(values){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
  function performance(s,unit=null,timeframe='all'){
    timeframeStart(s.settings.now,timeframe);
    const done=[...s.jobs,...s.performance_samples].filter(j=>j.status==='complete'&&inTimeframe(j.completed_at,s.settings.now,timeframe)&&(!unit||find(s.rooms,j.room_id,'Room').unit===unit));
    const attempts=done.map(j=>({j,a:activeAttempt(j)}));const linked=new Set(s.reports.filter(r=>r.job_id).map(r=>r.job_id)),hasReport=j=>j.sample?j.with_report:linked.has(j.id);
    return {completed:done.length,sample_completed:done.filter(j=>j.sample).length,median_wait:median(done.map(j=>Math.max(0,(j.first_started_at-Math.max(j.requested_at,j.available_from))/MINUTE))),
      basic_time:median(done.filter(j=>j.cleaning_class==='basic').map(j=>(j.completed_at-j.started_at)/MINUTE)),extra_time:median(done.filter(j=>j.cleaning_class==='extra').map(j=>(j.completed_at-j.started_at)/MINUTE)),
      initial_error:median(attempts.filter(({a})=>!a.initial_at_least).map(({j,a})=>Math.abs(j.completed_at-a.initial_estimated_finish)/MINUTE)),revised_error:median(attempts.filter(({a})=>!a.last_at_least).map(({j,a})=>Math.abs(j.completed_at-a.last_estimated_finish)/MINUTE)),
      completed_with_reports:done.filter(hasReport).length,report_rate:done.length?done.filter(hasReport).length/done.length:null};
  }
  function applyAction(s,action,data={}){
    const user=s.settings.user_worker_id,now=s.settings.now;
    if(action==='request')createJob(s,data);
    else if(action==='select-worker'){find(s.workers,data.worker_id,'Worker');s.settings.user_worker_id=data.worker_id;}
    else if(action==='seen-assignments'){for(const n of unreadAssignments(s))if(!data.job_id||n.job_id===data.job_id)n.seen_at=now;}
    else if(action==='seen-completions'){for(const j of unreadCompletions(s))j.completion_seen_at=now;}
    else if(action==='automatic'){
      if(typeof data.enabled!=='boolean')throw new DomainError('Supply a valid automatic assignment setting.');const before=s.settings.automatic_assignment;s.settings.automatic_assignment=data.enabled;
      event(s,'setting',`Automatic assignment ${data.enabled?'on':'off'}`,null,'EVS Admin',{automatic_assignment:{before,after:data.enabled}});
    }else if(action==='floor-instructions'){
      if(!validUnit(data.unit))throw new DomainError('Choose a valid unit.');const next=content(data.instructions,FLOOR_MAX),before=s.settings.floor_instructions[data.unit];
      s.settings.floor_instructions[data.unit]=next;
      event(s,'instructions',`${data.unit} floor instructions updated`,null,'EVS Admin',{instructions:{before,after:next}},{details:{unit:data.unit}});
    }else if(action==='report')recordReport(s,data);
    else if(action==='report-status'){
      const r=find(s.reports,data.report_id,'Report');if(!['open','reviewed','resolved'].includes(data.status))throw new DomainError('Choose Open, Reviewed, or Resolved.');
      const before=r.status;r.status=data.status;if(data.status!=='open')r.reviewed_at??=now;r.resolved_at=data.status==='resolved'?now:null;
      event(s,'review',`${r.id} marked ${r.status}`,r.job_id,'EVS Admin',{status:{before,after:r.status}},{report_id:r.id});
    }else if(action==='sample-feedback'){
      if(s.settings.sample_feedback_loaded)throw new DomainError('Sample feedback is already loaded.');
      const samples=[['Pediatrics','equipment','A reusable stethoscope was discarded instead of being retained for cleaning.',18],['Pediatrics','equipment','Please remind EVS to retain and clean reusable stethoscopes; this has happened more than once.',42],['Pediatrics','cleaning','The area under the bed was missed in a room turnover.',60],[null,'supplies','Some tasks are delayed because needed supplies are not available at the start.',24],['Pediatrics','access','An older example: a room was unavailable at its scheduled time.',45*24]];
      for(const[unit,category,description,hours]of samples)recordReport(s,{reporter_role:'nurse',unit,category,description},{sample:true,at:now-hours*60*MINUTE});s.settings.sample_feedback_loaded=true;
    }else if(action==='sample-performance'){loadPerformanceSamples(s);
    }else if(action==='summarize-feedback'){
      const summary=buildFeedbackSummary(s,data.filters);if(!summary.report_ids.length)throw new DomainError('There are no displayed reports to summarize.');
      summary.id=`S${String(++s.settings.summary_seq).padStart(3,'0')}`;s.feedback_summaries.push(summary);
      event(s,'analysis',`${summary.report_ids.length} displayed reports summarized`,null,'EVS Admin',{}, {summary_id:summary.id,details:{filters:summary.filters,report_ids:summary.report_ids,model:summary.model}});
    }else if(action==='recommendation'){
      const summary=find(s.feedback_summaries,data.summary_id,'Feedback summary'),r=buildRecommendation(s,data.unit,summary);r.id=`A${String(++s.settings.recommendation_seq).padStart(3,'0')}`;r.applied_at=null;s.recommendations.push(r);
      event(s,'analysis',`${r.unit} instruction draft prepared`,null,'EVS Admin',{}, {recommendation_id:r.id,details:{unit:r.unit,summary_id:summary.id,report_ids:r.report_ids,model:r.model}});
    }else if(action==='apply-recommendation'){
      const r=find(s.recommendations,data.recommendation_id,'Recommendation');if(r.applied_at!==null)throw new DomainError('This recommendation was already applied.');
      if(s.settings.floor_instructions[r.unit]!==r.before)throw new DomainError('Floor instructions changed. Create a new draft from the summary.');
      if(!['append','replace'].includes(data.mode))throw new DomainError('Choose Append or Replace.');const draft=content(data.text,FLOOR_MAX,true);
      const after=data.mode==='append'?[r.before,draft].filter(Boolean).join('\n\n'):draft;content(after,FLOOR_MAX,true);
      s.settings.floor_instructions[r.unit]=after;Object.assign(r,{applied_at:now,applied_mode:data.mode,applied_text:draft,after});
      event(s,'instructions',`${r.unit} recommendation applied (${data.mode})`,null,'EVS Admin',{instructions:{before:r.before,after}}, {recommendation_id:r.id,details:{unit:r.unit,report_ids:r.report_ids,model:r.model}});
    }else if(action==='handoff'){
      const previous=find(s.jobs,data.previous_job_id,'Current task'),next=find(s.jobs,data.next_job_id,'Next task');if(previous.id===next.id)throw new DomainError('Choose a different next task.');
      requireOwner(previous,user);if(previous.status!=='cleaning')throw new DomainError('The previous task is not active.');
      if(data.resolution==='complete')completeJob(s,previous,{checks_confirmed:true,completed_at:data.completed_at});
      else if(data.resolution==='release'){const reason=content(data.reason,600,true);recordReport(s,{reporter_role:'evs',job_id:previous.id,description:reason,category:'other'});release(s,previous,workerName(s));}
      else throw new DomainError('Confirm whether the previous task was completed.');
      applyAction(s,'start',{job_id:next.id,ppe_confirmed:data.ppe_confirmed});event(s,'handoff',`Previous task confirmed before starting Room ${next.room_id}`,next.id,workerName(s),{}, {details:{previous_job_id:previous.id,resolution:data.resolution}});
    }else if(['start','release','assign','unassign','cancel','edit','complete','estimate'].includes(action)){
      const j=find(s.jobs,data.job_id,'Job'),room=find(s.rooms,j.room_id,'Room');
      if(action==='assign')assign(s,j,data.worker_id||user,'admin');
      else if(action==='start'){
        if(!['queued','assigned'].includes(j.status))throw new DomainError('Only a requested task can be started.');if(j.status==='assigned')requireOwner(j,user);
        if(data.ppe_confirmed!==true)throw new DomainError('Confirm the required PPE and room instructions before starting.');const issue=startIssue(s,j);if(issue)throw new DomainError(issue);
        if(s.jobs.some(k=>k.worker_id===user&&k.status==='cleaning'))throw new DomainError('Confirm the previous cleaning before starting another.');
        if(j.status==='queued')assign(s,j,user,'start');const finish=now+expectedMinutes(j)*MINUTE;
        for(const n of unreadAssignments(s))if(n.job_id===j.id)n.seen_at=now;
        Object.assign(j,{status:'cleaning',started_at:now,forecast_finish:finish,forecast_at_least:j.expected_at_least,initial_estimated_finish:finish,instructions_at_start:instructions(s,j)});j.first_started_at??=now;
        j.attempts.push({started_at:now,worker_id:user,initial_estimated_finish:finish,last_estimated_finish:finish,initial_at_least:j.expected_at_least,last_at_least:j.expected_at_least,instructions:j.instructions_at_start,ppe:[...j.ppe],ended_at:null,outcome:null});find(s.workers,user,'Worker').unit=room.unit;
        event(s,'start',`Started Room ${room.id}`,j.id,workerName(s),{status:{before:'requested',after:'cleaning'}},{details:{initial_estimated_finish:finish,expected_minutes:expectedMinutes(j),instructions_at_start:j.instructions_at_start,ppe:[...j.ppe]}});
      }else if(action==='estimate'){
        if(!ACTIVE.has(j.status))throw new DomainError('This request is already closed.');if(j.status!=='queued')requireOwner(j,user);
        if(!Number.isInteger(data.minutes)||data.minutes<1||data.minutes>240)throw new DomainError('Enter 1–240 whole minutes.');if(data.at_least===true&&data.minutes!==60)throw new DomainError('Choose 60+ minutes for an open-ended estimate.');const reason=content(data.reason??'',600);
        const previous=j.status==='cleaning'?j.forecast_finish:expectedMinutes(j),kind=j.status==='cleaning'?'remaining':'duration';
        const atLeast=data.at_least===true;
        if(kind==='remaining'){j.forecast_finish=now+data.minutes*MINUTE;j.forecast_at_least=atLeast;activeAttempt(j).last_estimated_finish=j.forecast_finish;activeAttempt(j).last_at_least=atLeast;}else {j.expected_minutes=data.minutes;j.expected_at_least=atLeast;}
        const next=kind==='remaining'?j.forecast_finish:expectedMinutes(j);j.estimate_history.push({at:now,kind,minutes:data.minutes,at_least:atLeast,reason,before:previous,after:next});
        event(s,'estimate',`Room ${room.id} ${kind==='remaining'?'remaining time':'cleaning estimate'} revised`,j.id,workerName(s),{[kind==='remaining'?'estimated_finish':'expected_minutes']:{before:previous,after:next}},{details:{reason,minutes:data.minutes,at_least:atLeast,kind}});
      }else if(action==='release'){if(j.status!=='cleaning')throw new DomainError('This cleaning has not started.');requireOwner(j,user);release(s,j,workerName(s));}
      else if(action==='unassign'){if(j.status!=='assigned')throw new DomainError('Only an unstarted assignment can be returned to the queue.');release(s,j,'EVS Admin');}
      else if(action==='cancel'){
        if(!ACTIVE.has(j.status))throw new DomainError('This request is already closed.');retireAssignments(s,j.id);if(j.status==='cleaning')Object.assign(activeAttempt(j),{ended_at:now,outcome:'withdrawn'});
        Object.assign(j,{status:'cancelled',worker_id:null,assigned_at:null,assignment_source:null,started_at:null,forecast_finish:null,estimated_finish:null,estimated_start:null,breakdown:null,overdue:false});
        event(s,'cancel',`Request for Room ${room.id} cancelled`,j.id,'Nurse Demo',{status:{before:'active',after:'cancelled'}});
      }else if(action==='edit'){
        if(!ACTIVE.has(j.status))throw new DomainError('This request is already closed.');if(data.room_id!==undefined&&String(data.room_id)!==j.room_id)throw new DomainError('The room cannot be changed on an existing request.');
        const before=clone(j),fields=requestFields(s,{...j,...data}),availability=availabilityFields(s,data,j),worker=s.workers.find(w=>w.id===j.worker_id);
        if(j.status==='cleaning'&&(availability.availability_mode!==j.availability_mode||availability.available_from!==j.available_from))throw new DomainError('Availability cannot change after cleaning has started.');
        if(worker&&!fields.ppe.every(p=>worker.ppe.includes(p)))throw new DomainError('The assigned worker does not cover these PPE requirements.');
        Object.assign(j,fields,availability);if(before.duration!==j.duration&&j.expected_minutes===null&&j.status==='cleaning'&&!j.estimate_history.some(e=>e.kind==='remaining'&&e.at>=j.started_at)){j.forecast_finish=j.started_at+j.duration*MINUTE;activeAttempt(j).last_estimated_finish=j.forecast_finish;}
        event(s,'edit',`Room ${room.id} request updated`,j.id,'Nurse Demo',changes(before,j,['cleaning_class','priority','ppe','notes','available_from']));
      }else completeJob(s,j,data);
    }else throw new DomainError('Unknown action.');return schedule(s);
  }
  function transact(s,action,data={},at=Date.now()){if(!data||typeof data!=='object'||Array.isArray(data))throw new DomainError('Supply action fields as an object.');if(action==='reset')return newState(at);return applyAction(clock(clone(s),at),action,data);}
  function snapshot(s,at=Date.now()){
    const r=schedule(clock(clone(s),at));r.classes=clone(CLASSES);r.ppe_options=[...PPE];r.categories=clone(CATEGORIES);r.events.reverse();r.reports.sort((a,b)=>b.at-a.at||compare(b.id,a.id));
    r.metrics={requested:r.rooms.filter(v=>v.status==='requested').length,cleaning:r.rooms.filter(v=>v.status==='cleaning').length,cleaned:r.rooms.filter(v=>v.status==='cleaned').length};return r;
  }
  function exportData(s){return {version:'0.16',exported_at:new Date(s.settings.now).toISOString(),session_only:true,settings:clone(s.settings),jobs:clone(s.jobs),reports:clone(s.reports),recommendations:clone(s.recommendations),feedback_summaries:clone(s.feedback_summaries),notifications:clone(s.notifications),workers:clone(s.workers),performance_samples:clone(s.performance_samples),events:clone(s.events)};}
  return Object.freeze({USER_WORKER_ID,NURSE_ID,MINUTE,DAY,FLOOR_MAX,TIMEFRAMES:clone(TIMEFRAMES),CLASSES:clone(CLASSES),PPE:[...PPE],CATEGORIES:clone(CATEGORIES),DomainError,newState,schedule,transact,snapshot,
    requestedTasks,taskOrder,myRequests,unreadCompletions,roomStatus,sortedRooms,travelMinutes,floorInstructions,instructions,startIssue,expectedMinutes,workerName,availableWorkers,unreadAssignments,mostAvailableWorker,timeframeStart,inTimeframe,filteredReports,buildFeedbackSummary,buildRecommendation,performance,exportData});
});
