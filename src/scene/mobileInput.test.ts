import test from 'node:test'
import assert from 'node:assert/strict'
import {MobileInputController,type MobileInputCallbacks,type MobilePointer,type MobileTouchTarget} from './mobileInput'

const bottle:MobileTouchTarget={kind:'object',side:'left',zone:'oil'}
const at=(id:number,x:number,y:number,timeStamp:number,pointerType='touch'):MobilePointer=>({pointerId:id,clientX:x,clientY:y,timeStamp,pointerType})

function harness(hit:MobileTouchTarget|null=bottle){
 const events:string[]=[],rotations:number[]=[],pans:number[]=[],sweeps:number[]=[]
 const callbacks:MobileInputCallbacks={
  pick:()=>hit,zoneAt:()=>hit?.zone||null,
  grab:target=>events.push(`grab ${target.zone}`),
  move:(_target,motion)=>{events.push(`move ${motion.over}`);sweeps.push(motion.gesture.sweep||0)},
  rotate:(_target,rotation)=>rotations.push(rotation.delta),
  drop:(_target,_x,_y,_over,cancelled)=>events.push(cancelled?'cancel':'drop'),
  pan:dx=>pans.push(dx),
 }
 return {controller:new MobileInputController(callbacks),events,rotations,pans,sweeps}
}

test('a touched object stays gripped through movement and drops once on release',()=>{
 const h=harness()
 assert.equal(h.controller.pointerDown(at(1,100,100,0)),true)
 h.controller.pointerMove(at(1,125,120,16))
 h.controller.pointerUp(at(1,125,120,32))
 h.controller.pointerUp(at(1,125,120,33))
 assert.deepEqual(h.events,['grab oil','move oil','drop'])
 assert.deepEqual(h.pans,[])
})

test('a second finger rotates the held object without dropping it or panning the camera',()=>{
 const h=harness()
 h.controller.pointerDown(at(1,100,100,0))
 h.controller.pointerDown(at(2,140,100,10))
 h.controller.pointerMove(at(2,100,140,20))
 assert(Math.abs(h.rotations[0]-Math.PI/2)<1e-9)
 assert.deepEqual(h.events,['grab oil'])
 h.controller.pointerUp(at(2,100,140,30))
 h.controller.pointerMove(at(1,120,100,40))
 h.controller.pointerUp(at(1,120,100,50))
 assert.deepEqual(h.events,['grab oil','move oil','drop'])
 assert.deepEqual(h.pans,[])
})

test('two-finger rotation remains small when its angle crosses the -π/π seam',()=>{
 const h=harness()
 h.controller.pointerDown(at(1,200,200,0))
 h.controller.pointerDown(at(2,100,199,10))
 h.controller.pointerMove(at(2,100,201,20))
 assert.equal(h.rotations.length,1)
 assert(Math.abs(h.rotations[0])<.03)
})

test('horizontal movement on empty space pans only after a short deliberate swipe',()=>{
 const h=harness(null)
 h.controller.pointerDown(at(1,100,100,0))
 h.controller.pointerMove(at(1,105,101,16))
 assert.deepEqual(h.pans,[])
 h.controller.pointerMove(at(1,112,102,32))
 h.controller.pointerMove(at(1,130,102,48))
 h.controller.pointerUp(at(1,130,102,64))
 assert.deepEqual(h.pans,[7,18])
 assert.deepEqual(h.events,[])
})

test('vertical blank-space drag does not steer the portrait camera',()=>{
 const h=harness(null)
 h.controller.pointerDown(at(1,100,100,0))
 h.controller.pointerMove(at(1,101,145,16))
 h.controller.pointerMove(at(1,104,180,32))
 assert.deepEqual(h.pans,[])
})

test('mouse events are ignored so the desktop control path remains independent',()=>{
 const h=harness()
 assert.equal(h.controller.pointerDown(at(1,100,100,0,'mouse')),false)
 assert.equal(h.controller.pointerMove(at(1,120,100,16,'mouse')),false)
 assert.equal(h.controller.pointerUp(at(1,120,100,32,'mouse')),false)
 assert.deepEqual(h.events,[])
})

test('cancel releases an object and reset cannot drop it twice',()=>{
 const h=harness()
 h.controller.pointerDown(at(1,100,100,0))
 h.controller.pointerCancel(at(1,110,110,16))
 h.controller.reset()
 assert.deepEqual(h.events,['grab oil','cancel'])
})

test('one finger still detects back-and-forth ingredient scooping',()=>{
 const h=harness({kind:'object',side:'right',zone:'rice'})
 h.controller.pointerDown(at(1,100,100,0))
 let t=16
 for(let x=104;x<=180;x+=4){h.controller.pointerMove(at(1,x,100,t));t+=16}
 for(let x=176;x>=100;x-=4){h.controller.pointerMove(at(1,x,100,t));t+=16}
 assert(h.sweeps.reduce((a,b)=>a+b,0)>=.5)
})
