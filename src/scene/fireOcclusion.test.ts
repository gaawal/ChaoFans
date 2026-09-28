import test from 'node:test'
import assert from 'node:assert/strict'
import {Euler,Matrix4,Quaternion,Vector3} from 'three'
import {protectedByWok} from './fireOcclusion'

test('fire is excluded from the bowl, rim wall and food above the pan',()=>{
 const pose=new Matrix4().makeTranslation(0,1.1,0),inv=pose.clone().invert()
 for(const local of [[0,.005,0],[.19,.064,0],[.279,.12,0],[0,.30,0]]){
  assert.equal(protectedByWok(new Vector3(...local).applyMatrix4(pose),inv),true)
 }
 assert.equal(protectedByWok(new Vector3(.31,1.22,0),inv),false)
 assert.equal(protectedByWok(new Vector3(.2,1.06,0),inv),false)
})
test('a lifted and tilted pan masks its own interior, not the old stove space',()=>{
 const pose=new Matrix4().compose(new Vector3(.38,1.52,.09),new Quaternion().setFromEuler(new Euler(.4,0,.18)),new Vector3(1,1,1)),inv=pose.clone().invert()
 assert.equal(protectedByWok(new Vector3(0,.06,0).applyMatrix4(pose),inv),true)
 assert.equal(protectedByWok(new Vector3(.2,-.06,0).applyMatrix4(pose),inv),false)
 assert.equal(protectedByWok(new Vector3(0,1.14,0),inv),false)
})
