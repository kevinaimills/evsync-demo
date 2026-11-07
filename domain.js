/* Browser-only cleaning requests and history. Timestamps are epoch milliseconds. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.EVSyncDomain=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const USER_WORKER_ID='maya',MINUTE=60000;
  const CLASSES={basic:{label:'Basic',minutes:20},extra:{label:'Extra',minutes:30}};
  const PPE=['Gloves','Gown','Medical mask','Eye protection','Respirator'];
  const UNITS={Cardiology:0,Oncology:1,Pediatrics:2};
  const DEFAULT_INSTRUCTIONS={Cardiology:'',Oncology:'',Pediatrics:'Retain and clean the reusable stethoscope. Do not discard.'};
  const ACTIVE=new Set(['queued','assigned','cleaning']);
  const ROOM_ORDER={cleaning:0,requested:1,cleaned:2,unknown:3};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  class DomainError extends Error{constructor(message){super(message);this.name='DomainError';}}
  function find(items,id,label){const item=items.find(v=>String(v.id)===String(id));if(!item)throw new DomainError(`${label} not found.`);return item;}
  function clock(s,at){if(!Number.isFinite(at))throw new DomainError('Supply a valid timestamp.');s.settings.now=at;return s;}
  function event(s,kind,message,job=null,actor='System'){s.events.push({id:++s.settings.event_seq,at:s.settings.now,kind,message,job_id:job,actor});}
  function taskOrder(a,b){return Number(b.priority==='urgent')-Number(a.priority==='urgent')||a.requested_at-b.requested_at||compare(a.id,b.id);}
  function requestedTasks(s,workerId=s.settings.user_worker_id){return s.jobs.filter(j=>j.status==='queued'||(j.worker_id===workerId&&['assigned','cleaning'].includes(j.status))).sort(taskOrder);}
  function roomStatus(s,room){
    const active=s.jobs.find(j=>j.room_id===room.id&&ACTIVE.has(j.status));
    return active?(active.status==='cleaning'?'cleaning':'requested'):room.last_cleaned_at==null?'unknown':'cleaned';
  }
  function sortedRooms(s,rooms=s.rooms){return [...rooms].sort((a,b)=>ROOM_ORDER[roomStatus(s,a)]-ROOM_ORDER[roomStatus(s,b)]||Number(a.id)-Number(b.id));}
  function floorInstructions(s,job){return s.settings.floor_instructions[find(s.rooms,job.room_id,'Room').unit]||'';}
  function instructions(s,job){return [floorInstructions(s,job),job.notes].filter(Boolean).join('\n\n');}
  function startIssue(s,job){return s.settings.now<job.available_from?'This room is not available for cleaning yet.':'';}
  function travelMinutes(from,to){return 2+3*Math.abs(UNITS[from]-UNITS[to]);}
  function schedule(s){
    const now=s.settings.now,rooms=Object.fromEntries(s.rooms.map(r=>[r.id,r]));
    s.rooms.forEach(r=>{r.status=roomStatus(s,r);});
    s.jobs.filter(j=>ACTIVE.has(j.status)).sort(taskOrder).forEach((j,i)=>j.queue_rank=i+1);
    for(const job of s.jobs.filter(j=>j.status==='queued'))Object.assign(job,{worker_id:null,estimated_finish:null,estimated_start:null,breakdown:null});
    for(const worker of s.workers){
      const active=s.jobs.find(j=>j.worker_id===worker.id&&j.status==='cleaning');
      let available=now,unit=worker.unit;
      if(active){
        const remaining=Math.max(1,active.duration-(now-active.started_at)/MINUTE);
        active.estimated_finish=now+remaining*MINUTE;active.overdue=now>=active.started_at+active.duration*MINUTE;
        available=active.estimated_finish;unit=rooms[active.room_id].unit;
      }
      const pending=s.jobs.filter(j=>j.worker_id===worker.id&&j.status==='assigned');
      while(pending.length){
        pending.sort((a,b)=>Math.max(available,a.available_from)-Math.max(available,b.available_from)||taskOrder(a,b));
        const job=pending.shift(),travel=travelMinutes(unit,rooms[job.room_id].unit),prep=2+(job.ppe.includes('Respirator')?2:0);
        const start=Math.max(available+(travel+prep)*MINUTE,job.available_from);
        job.breakdown={wait:Math.max(0,(start-now)/MINUTE-travel-prep),travel,prep,clean:job.duration};
        job.estimated_start=start;job.estimated_finish=start+job.duration*MINUTE;
        available=job.estimated_finish;unit=rooms[job.room_id].unit;
      }
    }
    return s;
  }
  function assign(s,job,workerId,source){
    if(job.status!=='queued')throw new DomainError('This task is already assigned or started.');
    const worker=find(s.workers,workerId,'Worker');
    if(!job.ppe.every(p=>worker.ppe.includes(p)))throw new DomainError('This worker does not cover the PPE requirements.');
    Object.assign(job,{status:'assigned',worker_id:worker.id,assigned_at:s.settings.now,assignment_source:source});
    event(s,'assignment',`Room ${job.room_id} → ${worker.name}`,job.id,source==='admin'?'EVS Admin':source==='automatic'?'System':worker.name);
  }
  function requestFields(s,data){
    const type=data.cleaning_class??'basic';
    if(!Object.hasOwn(CLASSES,type))throw new DomainError('Choose Basic or Extra cleaning.');
    const ppe=data.ppe===undefined?[]:data.ppe;
    if(!Array.isArray(ppe)||!ppe.every(p=>PPE.includes(p)))throw new DomainError('Choose valid PPE requirements or leave them empty.');
    const priority=data.priority??'routine';
    if(!['routine','urgent'].includes(priority))throw new DomainError('Choose routine or urgent priority.');
    return {cleaning_class:type,priority,ppe:[...new Set(ppe)],notes:String(data.notes??'').slice(0,600),duration:s.settings.durations[type]};
  }
  function availabilityFields(s,data,previous=null){
    const mode=data.availability_mode??previous?.availability_mode??'now';
    if(!['now','later'].includes(mode))throw new DomainError('Choose Now or Later for room availability.');
    if(mode==='now')return {availability_mode:'now',available_from:previous?.availability_mode==='now'?previous.available_from:s.settings.now};
    const from=data.available_from??previous?.available_from;
    if(!Number.isFinite(from))throw new DomainError('Enter a valid availability date and time.');
    const unchanged=previous?.availability_mode==='later'&&from===previous.available_from;
    if(!unchanged&&from<s.settings.now)throw new DomainError('Choose a future availability time, or select Now.');
    return {availability_mode:'later',available_from:from};
  }
  function createJob(s,data){
    const room=find(s.rooms,data.room_id,'Room');
    if(s.jobs.some(j=>j.room_id===room.id&&ACTIVE.has(j.status)))throw new DomainError('This room already has an active cleaning request.');
    const fields=requestFields(s,data),availability=availabilityFields(s,data);
    const job={id:`J${String(++s.settings.job_seq).padStart(3,'0')}`,room_id:room.id,...fields,...availability,status:'queued',worker_id:null,
      requested_at:s.settings.now,assigned_at:null,assignment_source:null,started_at:null,completed_at:null,estimated_finish:null,estimated_start:null};
    s.jobs.push(job);event(s,'request',`Room ${room.id} · ${CLASSES[job.cleaning_class].label} cleaning requested`,job.id,'Nurse');
    if(s.settings.automatic_assignment)assign(s,job,s.settings.user_worker_id,'automatic');
  }
  function newState(at=Date.now(),{seedDemo=true}={}){
    const s={settings:{now:at,job_seq:0,event_seq:0,durations:{basic:20,extra:30},floor_instructions:clone(DEFAULT_INSTRUCTIONS),
      automatic_assignment:false,user_worker_id:USER_WORKER_ID},rooms:[],workers:[],jobs:[],events:[]};
    clock(s,at);
    for(const[unit,first,last]of[['Cardiology',4100,4120],['Oncology',4121,4140],['Pediatrics',2150,2170]])
      for(let number=first;number<=last;number++)s.rooms.push({id:String(number),unit,status:'unknown',last_cleaned_at:null});
    for(const[id,name,unit,respirator]of[['maya','Maya Chen','Cardiology',true],['sam','Sam Rivera','Cardiology',false],
      ['jordan','Jordan Ellis','Pediatrics',false],['avery','Avery Patel','Oncology',true]])
      s.workers.push({id,name,unit,ppe:respirator?[...PPE]:PPE.slice(0,-1),completed:0});
    if(seedDemo)createJob(s,{room_id:'2150',cleaning_class:'basic',ppe:[]});
    return schedule(s);
  }
  function requireOwner(job,workerId){if(job.worker_id!==workerId)throw new DomainError('This task belongs to another worker.');}
  function release(s,job,actor){
    Object.assign(job,{status:'queued',worker_id:null,assigned_at:null,assignment_source:null,started_at:null,completed_at:null,
      estimated_finish:null,estimated_start:null,breakdown:null,overdue:false});
    event(s,'release',`Room ${job.room_id} returned to requested tasks`,job.id,actor);
  }
  function applyAction(s,action,data={}){
    const user=s.settings.user_worker_id,now=s.settings.now;
    if(action==='request')createJob(s,data);
    else if(action==='automatic'){
      if(typeof data.enabled!=='boolean')throw new DomainError('Supply a valid automatic assignment setting.');
      s.settings.automatic_assignment=data.enabled;event(s,'setting',`Automatic assignment ${data.enabled?'on':'off'}`,null,'EVS Admin');
    }else if(action==='floor-instructions'){
      if(!Object.hasOwn(UNITS,data.unit)||typeof data.instructions!=='string'||data.instructions.length>600)
        throw new DomainError('Choose a unit and enter up to 600 characters of floor instructions.');
      s.settings.floor_instructions[data.unit]=data.instructions.trim();event(s,'setting',`${data.unit} floor instructions updated`,null,'EVS Admin');
    }else if(['start','release','assign','unassign','cancel','edit','complete'].includes(action)){
      const job=find(s.jobs,data.job_id,'Job'),room=find(s.rooms,job.room_id,'Room');
      if(action==='assign')assign(s,job,data.worker_id||user,'admin');
      else if(action==='start'){
        if(!['queued','assigned'].includes(job.status))throw new DomainError('Only a requested task can be started.');
        if(job.status==='assigned')requireOwner(job,user);
        if(data.ppe_confirmed!==true)throw new DomainError('Confirm the required PPE and room instructions before starting.');
        const issue=startIssue(s,job);if(issue)throw new DomainError(issue);
        if(s.jobs.some(j=>j.worker_id===user&&j.status==='cleaning'))throw new DomainError('Finish or cancel your current job before starting another.');
        if(job.status==='queued')assign(s,job,user,'start');
        Object.assign(job,{status:'cleaning',started_at:now});find(s.workers,user,'Worker').unit=room.unit;
        event(s,'start',`Started Room ${room.id}`,job.id,'Maya Chen');
      }else if(action==='release'){
        if(job.status!=='cleaning')throw new DomainError('This cleaning has not started.');
        requireOwner(job,user);release(s,job,'Maya Chen');
      }else if(action==='unassign'){
        if(job.status!=='assigned')throw new DomainError('Only an unstarted assignment can be returned to the queue.');
        release(s,job,'EVS Admin');
      }else if(action==='cancel'){
        if(!ACTIVE.has(job.status))throw new DomainError('This request is already closed.');
        Object.assign(job,{status:'cancelled',worker_id:null,assigned_at:null,assignment_source:null,started_at:null,
          estimated_finish:null,estimated_start:null,breakdown:null,overdue:false});
        event(s,'cancel',`Request for Room ${room.id} cancelled`,job.id,'Nurse');
      }else if(action==='edit'){
        if(!ACTIVE.has(job.status))throw new DomainError('This request is already closed.');
        if(data.room_id!==undefined&&String(data.room_id)!==job.room_id)throw new DomainError('The room cannot be changed on an existing request.');
        const fields=requestFields(s,{...job,...data}),availability=availabilityFields(s,data,job),worker=s.workers.find(w=>w.id===job.worker_id);
        if(job.status==='cleaning'&&(availability.availability_mode!==job.availability_mode||availability.available_from!==job.available_from))
          throw new DomainError('Availability cannot change after cleaning has started.');
        if(worker&&!fields.ppe.every(p=>worker.ppe.includes(p)))throw new DomainError('The assigned worker does not cover these PPE requirements.');
        Object.assign(job,fields,availability);event(s,'edit',`Room ${room.id} request updated`,job.id,'Nurse');
      }else{
        requireOwner(job,data.worker_id||user);
        if(job.status!=='cleaning'||data.checks_confirmed!==true)throw new DomainError('Confirm cleaning before marking cleaned.');
        Object.assign(job,{status:'complete',completed_at:now,estimated_finish:now});room.last_cleaned_at=now;
        find(s.workers,job.worker_id,'Worker').completed++;event(s,'complete',`Room ${room.id} cleaned`,job.id,'EVS');
      }
    }else throw new DomainError('Unknown action.');
    return schedule(s);
  }
  function transact(s,action,data={},at=Date.now()){
    if(!data||typeof data!=='object'||Array.isArray(data))throw new DomainError('Supply action fields as an object.');
    if(action==='reset')return newState(at);
    return applyAction(clock(clone(s),at),action,data);
  }
  function snapshot(s,at=Date.now()){
    const r=schedule(clock(clone(s),at));r.classes=clone(CLASSES);r.ppe_options=[...PPE];r.events.reverse();
    r.metrics={requested:r.rooms.filter(room=>room.status==='requested').length,cleaning:r.rooms.filter(room=>room.status==='cleaning').length,
      cleaned:r.rooms.filter(room=>room.status==='cleaned').length};return r;
  }
  return Object.freeze({USER_WORKER_ID,MINUTE,CLASSES:clone(CLASSES),PPE:[...PPE],DomainError,newState,schedule,transact,snapshot,
    requestedTasks,taskOrder,roomStatus,sortedRooms,travelMinutes,floorInstructions,instructions,startIssue});
});
