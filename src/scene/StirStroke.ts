import {Vector3} from 'three'

/** Remembers the player's last spoon stroke and continues it as a short push-pull. */
export class StirStroke {
 private readonly origin=new Vector3()
 private readonly previous=new Vector3()
 private readonly axis=new Vector3(1,0,0)
 private readonly result=new Vector3()
 private hasPrevious=false
 private wasDragging=false
 private elapsed=0

 reset(){this.hasPrevious=false;this.wasDragging=false;this.elapsed=0}

 sample(local:Vector3,dragging:boolean,dt:number,intensity:number){
  if(dragging){
   if(this.hasPrevious){
    const dx=local.x-this.previous.x,dz=local.z-this.previous.z
    if(Math.hypot(dx,dz)>.005)this.axis.set(dx,0,dz).normalize()
   }
   this.origin.set(local.x,0,local.z)
   this.previous.copy(local)
   this.hasPrevious=true
   this.wasDragging=true
   this.elapsed=0
   return this.result.copy(local)
  }
  if(this.wasDragging){this.wasDragging=false;this.elapsed=0}
  this.elapsed+=Math.max(0,dt)
  const amplitude=.045+Math.min(1,Math.max(0,intensity))*.025
  const displacement=Math.sin(this.elapsed*(4+intensity*3))*amplitude
  this.result.copy(this.origin).addScaledVector(this.axis,displacement)
  const radius=Math.hypot(this.result.x,this.result.z)
  if(radius>.185){this.result.x*=.185/radius;this.result.z*=.185/radius}
  return this.result
 }
}
