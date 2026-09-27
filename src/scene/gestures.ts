/** Mouse trajectories, independent from frame rate and cooking state. */
export class CookingGestureTracker {
  private previous: [number, number] | null = null
  private direction: [number, number] | null = null
  private run = 0
  private travel = 0
  private turns = 0
  private bounds = [Infinity, -Infinity, Infinity, -Infinity]
  private zone: string | null = null
  reset(zone: string | null = null) {
    this.previous = null; this.direction = null; this.run = 0
    this.travel = 0; this.turns = 0; this.bounds = [Infinity, -Infinity, Infinity, -Infinity]; this.zone = zone
  }
  sample(x: number, y: number, zone: string | null): {sweep:number;circle:number} {
    if (zone !== this.zone) this.reset(zone)
    if (!this.previous) { this.previous = [x,y]; return {sweep:0,circle:0} }
    const dx=x-this.previous[0],dy=y-this.previous[1],distance=Math.hypot(dx,dy)
    if (distance < 3) return {sweep:0,circle:0}
    this.previous=[x,y];this.travel+=distance;this.run+=distance
    this.bounds=[Math.min(this.bounds[0],x),Math.max(this.bounds[1],x),Math.min(this.bounds[2],y),Math.max(this.bounds[3],y)]
    const direction:[number,number]=[dx/distance,dy/distance]
    let sweep=0,circle=0
    if (this.direction) {
      const dot=this.direction[0]*direction[0]+this.direction[1]*direction[1]
      const turn=Math.atan2(this.direction[0]*direction[1]-this.direction[1]*direction[0],dot)
      if (dot < -.45) {
        if (this.run > 27) sweep=.55
        this.run=0; this.turns=0
      } else if (Math.abs(turn) < 1.7) this.turns+=turn
      const width=this.bounds[1]-this.bounds[0],height=this.bounds[3]-this.bounds[2]
      // A compact almost-full circle flips the wrist. Straight sweeps never do.
      if (Math.abs(this.turns)>4.7 && this.travel>85 && width>20 && height>20) {
        circle=1;this.turns=0;this.travel=0;this.bounds=[x,x,y,y]
      }
    }
    this.direction=direction
    return {sweep,circle}
  }
}
