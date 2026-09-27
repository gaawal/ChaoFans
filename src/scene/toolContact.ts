import {Vector3, Quaternion} from 'three'
// Measured from the Blender Ladle root. Contact is its bowl's lowest center.
export const SPOON_BOWL = new Vector3(0,-.062,-.404)
export const HAND_GRIP = new Vector3(0,-.025,-.105)
export function wristForSpoonContact(contact:Vector3,rotation:Quaternion,grip=HAND_GRIP){
  return contact.clone().sub(SPOON_BOWL.clone().add(grip).applyQuaternion(rotation))
}
export function panFoodSurface(x:number,z:number,amount:number){
  const r=Math.hypot(x,z)
  return .003+.122*Math.pow(Math.min(r,.28)/.28,1.75)+.008+Math.max(0,1-r*r/.0625)*.028*Math.min(1,amount)
}
/**
 * The ladle lying on the front strip, measured off the exported model: turned a
 * quarter turn so the bowl points out to the left, then tipped 8 degrees so the
 * bowl and the end of the handle meet the worktop together. `LADLE_REST_OFFSET`
 * centres the model over the spot the simulation recorded.
 */
export const LADLE_REST_ROTATION=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2)
 .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.1396))
export const LADLE_REST_OFFSET=new Vector3(.215,0,0)
