import type {GestureInput,HandSide,Zone} from '../game/simulation'
import {CookingGestureTracker} from './gestures'

/** Client coordinates are used throughout so StreetScene can reuse its raycaster. */
export interface MobilePointer {
  pointerId:number
  pointerType:string
  clientX:number
  clientY:number
  timeStamp:number
}

/** A ray hit on a real object or hand. The scene chooses which hand can hold it. */
export interface MobileTouchTarget {
  kind:'object'|'hand'
  side:HandSide
  zone:Zone|null
}

export interface MobileTouchMove {
  clientX:number
  clientY:number
  dx:number
  dy:number
  /** Same 0–1 speed range as the existing desktop hand controls. */
  speed:number
  over:Zone|null
  gesture:GestureInput
}

export interface MobileTouchRotation {
  /** Signed change in radians since the preceding pointer event. */
  delta:number
  /** Signed accumulated angle for this two-finger gesture. */
  total:number
}

export interface MobileInputCallbacks {
  /** Called once at the first touch; return null to use an empty-space camera pan. */
  pick:(clientX:number,clientY:number)=>MobileTouchTarget|null
  zoneAt:(clientX:number,clientY:number)=>Zone|null
  grab:(target:MobileTouchTarget,clientX:number,clientY:number)=>void
  move:(target:MobileTouchTarget,motion:MobileTouchMove)=>void
  rotate:(target:MobileTouchTarget,rotation:MobileTouchRotation)=>void
  drop:(target:MobileTouchTarget,clientX:number,clientY:number,over:Zone|null,cancelled:boolean)=>void
  /** Horizontal camera travel in screen pixels. */
  pan:(deltaX:number)=>void
}

interface Finger {
  id:number
  x:number
  y:number
  startX:number
  startY:number
  time:number
}

const finger=(event:MobilePointer):Finger=>({
  id:event.pointerId,x:event.clientX,y:event.clientY,
  startX:event.clientX,startY:event.clientY,time:event.timeStamp,
})
const shortestAngle=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle))
const isTouch=(event:MobilePointer)=>event.pointerType==='touch'

/**
 * A small pointer state machine for portrait play. The first finger owns either
 * one object or the camera; a second finger only rotates an owned object.
 * It never changes the mouse path, and the scene owns all physical placement.
 */
export class MobileInputController {
  private primary:Finger|null=null
  private secondary:Finger|null=null
  private held:MobileTouchTarget|null=null
  private panning=false
  private angle:number|null=null
  private totalRotation=0
  private tracker=new CookingGestureTracker()

  constructor(private callbacks:MobileInputCallbacks){}

  pointerDown(event:MobilePointer):boolean {
    if(!isTouch(event))return false
    if(!this.primary){
      this.primary=finger(event)
      this.held=this.callbacks.pick(event.clientX,event.clientY)
      this.panning=false
      this.tracker.reset()
      if(this.held)this.callbacks.grab(this.held,event.clientX,event.clientY)
      return true
    }
    if(!this.secondary){
      this.secondary=finger(event)
      this.angle=this.currentAngle()
      this.totalRotation=0
      return true
    }
    return false
  }

  pointerMove(event:MobilePointer):boolean {
    if(!isTouch(event))return false
    if(this.secondary?.id===event.pointerId){
      this.secondary.x=event.clientX
      this.secondary.y=event.clientY
      this.secondary.time=event.timeStamp
      this.updateRotation()
      return true
    }
    if(this.primary?.id!==event.pointerId)return false
    const primary=this.primary
    const dx=event.clientX-primary.x,dy=event.clientY-primary.y
    const dt=Math.max(.008,(event.timeStamp-primary.time)/1000)
    primary.x=event.clientX;primary.y=event.clientY;primary.time=event.timeStamp
    if(this.held){
      const over=this.callbacks.zoneAt(event.clientX,event.clientY)
      const gesture=this.tracker.sample(event.clientX,event.clientY,over)
      this.callbacks.move(this.held,{
        clientX:event.clientX,clientY:event.clientY,dx,dy,
        speed:Math.min(1,Math.hypot(dx,dy)/dt/650),over,gesture,
      })
      this.updateRotation()
    }else{
      const totalX=event.clientX-primary.startX,totalY=event.clientY-primary.startY
      if(!this.panning&&Math.abs(totalX)>=8&&Math.abs(totalX)>=Math.abs(totalY)*.9)this.panning=true
      if(this.panning&&dx)this.callbacks.pan(dx)
    }
    return true
  }

  pointerUp(event:MobilePointer):boolean {return this.finish(event,false)}
  pointerCancel(event:MobilePointer):boolean {return this.finish(event,true)}

  /** Cancels an active gesture when gameplay is paused or the scene is disposed. */
  reset():void {
    if(this.primary&&this.held)this.callbacks.drop(this.held,this.primary.x,this.primary.y,null,true)
    this.clear()
  }

  private finish(event:MobilePointer,cancelled:boolean):boolean {
    if(!isTouch(event))return false
    if(this.secondary?.id===event.pointerId){
      this.secondary=null
      this.angle=null
      this.totalRotation=0
      return true
    }
    if(this.primary?.id!==event.pointerId)return false
    if(this.held){
      const over=cancelled?null:this.callbacks.zoneAt(event.clientX,event.clientY)
      this.callbacks.drop(this.held,event.clientX,event.clientY,over,cancelled)
    }
    this.clear()
    return true
  }

  private clear():void {
    this.primary=null;this.secondary=null;this.held=null;this.panning=false
    this.angle=null;this.totalRotation=0;this.tracker.reset()
  }

  private currentAngle():number|null {
    if(!this.primary||!this.secondary)return null
    return Math.atan2(this.secondary.y-this.primary.y,this.secondary.x-this.primary.x)
  }

  private updateRotation():void {
    if(!this.held)return
    const current=this.currentAngle()
    if(current===null)return
    if(this.angle!==null){
      const delta=shortestAngle(current-this.angle)
      if(Math.abs(delta)>1e-4){
        this.totalRotation+=delta
        this.callbacks.rotate(this.held,{delta,total:this.totalRotation})
      }
    }
    this.angle=current
  }
}
