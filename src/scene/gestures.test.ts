import test from 'node:test'
import assert from 'node:assert/strict'
import {CookingGestureTracker} from './gestures'
import {Quaternion,Euler,Vector3} from 'three'
import {wristForSpoonContact,SPOON_BOWL,HAND_GRIP} from './toolContact'
test('passing straight over a tray neither scoops nor pours',()=>{
 const t=new CookingGestureTracker();let sweep=0,circle=0
 for(let x=0;x<=160;x+=4){const g=t.sample(x,100,'rice');sweep+=g.sweep;circle+=g.circle}
 assert.equal(sweep,0);assert.equal(circle,0)
})
test('back-and-forth scoops without being mistaken for a circle',()=>{
 const t=new CookingGestureTracker();let sweep=0,circle=0
 for(const [start,end,step] of [[0,80,4],[80,0,-4],[0,80,4]])for(let x=start;step>0?x<=end:x>=end;x+=step){const g=t.sample(x,100,'rice');sweep+=g.sweep;circle+=g.circle}
 assert(sweep>=1);assert.equal(circle,0)
})
test('a wrist circle is recognized in either direction',()=>{
 for(const sign of [-1,1]){const t=new CookingGestureTracker();let n=0
  for(let i=0;i<=48;i++){const a=i/48*Math.PI*2*sign;n+=t.sample(200+40*Math.cos(a),200+40*Math.sin(a),'wok').circle}
  assert.equal(n,1)
 }
})
test('moving between regions cannot complete a stale circle',()=>{
 const t=new CookingGestureTracker();let n=0
 for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;n+=t.sample(200+40*Math.cos(a),200+40*Math.sin(a),i<24?'rice':'wok').circle}
 assert.equal(n,0)
})
test('the actual Blender spoon bowl touches the target even with wrist pitch/yaw/roll',()=>{
 for(const angles of [[.4,.2,0],[.8,-.4,.3],[.25,.1,2.4]]){
  const q=new Quaternion().setFromEuler(new Euler(...angles)),target=new Vector3(.07,1.14,-.11)
  const wrist=wristForSpoonContact(target,q)
  const actual=SPOON_BOWL.clone().add(HAND_GRIP).applyQuaternion(q).add(wrist)
  assert(actual.distanceTo(target)<1e-9)
 }
})
