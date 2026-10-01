import test from 'node:test'
import assert from 'node:assert/strict'
import {chooseZoneHit} from './zonePicking'
import type {ZoneHit} from './zonePicking'

const hit=(zone:ZoneHit['zone'],distance:number)=>({zone,distance})

test('rice remains selectable through the oversized invisible handle box',()=>{
 assert.equal(chooseZoneHit([hit('handle',.4),hit('rice',.7)])?.zone,'rice')
})

test('the visible wooden grip can still be grabbed where it really covers rice',()=>{
 assert.equal(chooseZoneHit([hit('handle',.4),hit('rice',.7)],.6)?.zone,'handle')
})

test('a wooden grip behind the rice hit does not obscure rice',()=>{
 assert.equal(chooseZoneHit([hit('handle',.4),hit('rice',.7)],.73)?.zone,'rice')
})

test('unrelated foreground targets keep their normal raycast priority',()=>{
 assert.equal(chooseZoneHit([hit('rice',.7),hit('handle',.4),hit('oil',.3)])?.zone,'oil')
})

test('the nearest hit wins when there is no rice overlap',()=>{
 assert.equal(chooseZoneHit([hit('wok',.9),hit('handle',.4)])?.zone,'handle')
 assert.equal(chooseZoneHit([]),null)
})
