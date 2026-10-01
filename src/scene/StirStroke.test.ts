import assert from 'node:assert/strict'
import test from 'node:test'
import {Vector3} from 'three'
import {StirStroke} from './StirStroke'

test('released spoon repeats a straight stroke instead of circling',()=>{
 const stroke=new StirStroke()
 stroke.sample(new Vector3(-.05,0,.01),true,.016,.8)
 stroke.sample(new Vector3(.02,0,.01),true,.016,.8)
 for(let i=0;i<120;i++){
  const p=stroke.sample(new Vector3(0,0,0),false,.016,.8)
  assert.ok(Math.abs(p.z-.01)<1e-8)
  assert.ok(Math.hypot(p.x,p.z)<=.185+1e-8)
 }
})

test('release starts at the last manually controlled contact',()=>{
 const stroke=new StirStroke()
 stroke.sample(new Vector3(.035,0,-.055),true,.016,.4)
 const p=stroke.sample(new Vector3(),false,0,.4)
 assert.ok(p.distanceTo(new Vector3(.035,0,-.055))<1e-8)
})
