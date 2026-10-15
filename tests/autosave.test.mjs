import {test} from "node:test";
import assert from "node:assert/strict";
import {createAutosave,watchChanges,announceChange} from "../assets/autosave.js";

test("autosave serializes edits made during a save and preserves the later edit",async()=>{
  const writes=[],states=[];let draft="first",finish;
  const autosave=createAutosave({delay:60000,onState:state=>states.push(state),write:()=>{
    writes.push(draft);return new Promise(resolve=>{finish=resolve});
  }});
  autosave.change();const first=autosave.flush();assert.equal(autosave.busy,true);
  assert.equal(autosave.reset(),false);
  draft="second";autosave.change();autosave.flush();assert.deepEqual(writes,["first"]);
  finish();await first;assert.equal(autosave.dirty,true);
  const second=autosave.flush();assert.deepEqual(writes,["first","second"]);
  finish();await second;assert.equal(autosave.dirty,false);assert.equal(states.at(-1),"saved");autosave.reset();
});

test("autosave keeps failed edits and never retries a stale revision automatically",async()=>{
  let calls=0;const errors=[];
  const autosave=createAutosave({delay:60000,onState:(state,error)=>{if(error)errors.push(error)},write:async()=>{
    calls++;throw Object.assign(new Error("Stale revision"),{status:409});
  }});
  autosave.change();await autosave.flush();
  assert.equal(autosave.dirty,true);assert.equal(autosave.blocked,true);assert.equal(errors[0].status,409);
  autosave.change();await autosave.flush();assert.equal(calls,1);autosave.reset();
});

test("autosave can retry a network failure without falsely reporting saved",async()=>{
  let offline=true;const states=[];
  const autosave=createAutosave({delay:60000,onState:state=>states.push(state),write:async()=>{if(offline)throw new Error("Offline")}});
  autosave.change();await autosave.flush();assert.equal(autosave.dirty,true);assert.equal(states.at(-1),"error");
  offline=false;await autosave.flush();assert.equal(autosave.dirty,false);assert.equal(states.at(-1),"saved");autosave.reset();
});

test("live refresh ignores its own save announcement and refreshes for another page",async()=>{
  const previous={document:globalThis.document,window:globalThis.window,BroadcastChannel:globalThis.BroadcastChannel};
  const channels=[];let calls=0,stop;
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  globalThis.BroadcastChannel=class{constructor(){channels.push(this)}postMessage(data){for(const channel of channels)if(channel!==this)channel.onmessage?.({data})}close(){}};
  try{
    stop=watchChanges(async()=>{calls++},60000);
    announceChange();assert.equal(calls,0);
    channels[0].onmessage({data:{type:"changed",source:"different-page"}});assert.equal(calls,1);
    await new Promise(resolve=>setImmediate(resolve));
    document.hidden=true;channels[0].onmessage({data:{type:"changed",source:"different-page"}});assert.equal(calls,1);
  }finally{stop?.();Object.assign(globalThis,previous)}
});
