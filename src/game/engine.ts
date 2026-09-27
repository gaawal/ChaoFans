export type Action = 'oil' | 'egg' | 'meat' | 'veg' | 'rice' | 'stir' | 'sauce' | 'toss' | 'flame' | 'serve'
export type Skill = 'pot' | 'spoon' | 'fire' | 'oil' | 'egg' | 'seasoning' | 'stamina'
export type Phase = 'menu' | 'playing' | 'paused' | 'result' | 'upgrade' | 'closed'
export interface Order { id:number; name:string; avatar:string; meats:string[]; veg:string[]; spicy:string; price:number; patience:number; maxPatience:number }
export interface Step { action:Action; title:string; hint:string; hand:'left'|'right'; hits:number; ideal:number; late:number }
export const STEPS:Step[] = [
 {action:'oil',title:'热锅淋油',hint:'右手淋油，开个好头',hand:'right',hits:1,ideal:.7,late:5},
 {action:'egg',title:'打蛋爆香',hint:'轻轻一敲，金黄开场',hand:'right',hits:1,ideal:1,late:5},
 {action:'meat',title:'下荤菜',hint:'按客人的荤菜组合下锅',hand:'right',hits:1,ideal:1,late:5},
 {action:'stir',title:'炒熟荤菜',hint:'翻炒 3 次，让香气跑出来',hand:'right',hits:3,ideal:.55,late:7},
 {action:'veg',title:'下素菜',hint:'翠绿入锅，色条起飞',hand:'right',hits:1,ideal:.7,late:5},
 {action:'rice',title:'米饭下锅',hint:'左侧米饭，一勺入魂',hand:'right',hits:1,ideal:.7,late:5},
 {action:'stir',title:'黄金翻炒',hint:'翻炒 4 次，把饭粒炒散',hand:'right',hits:4,ideal:.5,late:8},
 {action:'sauce',title:'沿锅调味',hint:'调料撒中，口味正好',hand:'right',hits:1,ideal:.8,late:5},
 {action:'toss',title:'颠出锅气',hint:'右手收勺，再用左手颠锅',hand:'left',hits:2,ideal:.8,late:7},
 {action:'serve',title:'出锅交单',hint:'香气正好，快端给客人',hand:'right',hits:1,ideal:.6,late:5},
]
export const UPGRADES:{id:Skill;title:string;tag:string;description:string;icon:string}[] = [
 {id:'pot',title:'一飞冲天',tag:'锅功',description:'颠锅高度 +35%，每次颠锅额外获得香与色。',icon:'↟'},
 {id:'spoon',title:'无影快勺',tag:'勺功',description:'翻炒冷却缩短，色条收益增加。',icon:'✧'},
 {id:'fire',title:'烈焰掌门',tag:'火功',description:'猛火锅气更强，等待时更不容易焦糊。',icon:'♨'},
 {id:'oil',title:'爆香开场',tag:'油功',description:'淋油就获得额外香气，整锅起点更高。',icon:'◈'},
 {id:'egg',title:'金包银',tag:'蛋功',description:'打蛋额外增加色条，黄金饭粒更耀眼。',icon:'◉'},
 {id:'seasoning',title:'灵魂一撒',tag:'调味功',description:'调味额外增加味条，提高顾客满意度。',icon:'✺'},
 {id:'stamina',title:'永动大厨',tag:'耐力',description:'双手恢复更快，完美判定窗口更宽。',icon:'ϟ'},
]
export interface Result { order:Order; quality:number[]; score:number; grade:string; earned:number; xp:number; comment:string; failed:boolean }
export interface GameState { phase:Phase; orders:Order[]; nextId:number; spawnIn:number; step:number; hits:number; elapsed:number; lastHit:number; quality:number[]; combo:number; bestCombo:number; coins:number; xp:number; level:number; completed:number; happy:number; skills:Record<Skill,number>; choices:Skill[]; left:number; right:number; flameCooldown:number; notice:string; noticeKind:'good'|'bad'|'normal'; event:number; lastAction:Action|'collision'|null; result:Result|null; time:number; sound:boolean }
const emptySkills=():Record<Skill,number>=>({pot:0,spoon:0,fire:0,oil:0,egg:0,seasoning:0,stamina:0})
const clamp=(x:number,a=0,b=100)=>Math.min(b,Math.max(a,x))
export const priceFor=(meats:number,veg:number)=>6+meats*2+veg*2+(meats-1)*2
const pick=<T>(items:T[],random:()=>number)=>items[Math.floor(random()*items.length)]
export function createOrder(id:number,random=Math.random):Order {
 const names=['下班的阿杰','夜跑的小夏','隔壁摊老陈','加班的小周','路过的阿岚'];const meats=['牛肉','火腿','虾仁'];const veg=['青菜','玉米','胡萝卜'];
 const m=random()>.5?2:1,v=random()>.5?2:1; const offset=Math.floor(random()*3)
 return {id,name:names[(id-1)%names.length],avatar:['杰','夏','陈','周','岚'][(id-1)%5],meats:Array.from({length:m},(_,i)=>meats[(offset+i)%3]),veg:Array.from({length:v},(_,i)=>veg[(offset+i)%3]),spicy:pick(['微辣','不辣','中辣'],random),price:priceFor(m,v),patience:75,maxPatience:75}
}
export function initialState():GameState { return {phase:'menu',orders:[],nextId:1,spawnIn:18,step:0,hits:0,elapsed:0,lastHit:0,quality:[5,5,5],combo:0,bestCombo:0,coins:0,xp:0,level:1,completed:0,happy:0,skills:emptySkills(),choices:[],left:0,right:0,flameCooldown:0,notice:'今晚的第一锅，等你开火。',noticeKind:'normal',event:0,lastAction:null,result:null,time:0,sound:true} }
export function startGame(random=Math.random):GameState {return {...initialState(),phase:'playing',orders:[createOrder(1,random)],nextId:2,notice:'新客到！跟着流程，开炒！'}}
function feedback(s:GameState,text:string,kind:GameState['noticeKind'],action:GameState['lastAction']):GameState{return {...s,notice:text,noticeKind:kind,lastAction:action,event:s.event+1}}
function settle(s:GameState,failed=false):GameState {
 const order=s.orders[0];if(!order)return s
 const score=Math.round(s.quality.reduce((a,b)=>a+b,0)/3)
 const earned=failed?0:Math.round(order.price*(.5+score/100));const xp=failed?8:20+Math.round(score*.65)
 const result:Result={order,quality:[...s.quality],score,grade:failed?'超时':score>=85?'S':score>=68?'A':score>=45?'B':'C',earned,xp,failed,comment:failed?'等太久啦，下次再来。':score>=85?'这锅气！老板，你该去开宗立派！':score>=65?'好香！下次还来你这摊。':score>=40?'还不错，下一锅再加把劲。':'有点手忙脚乱，下一锅会更好。'}
 return {...s,phase:'result',result,coins:s.coins+earned,xp:s.xp+xp,completed:s.completed+1,happy:s.happy+(!failed&&score>=65?1:0),combo:0}
}
export function tick(s:GameState,dt:number,random=Math.random):GameState {
 if(s.phase!=='playing')return s
 dt=Math.max(0,Math.min(dt,.25))
 let n={...s,time:s.time+dt,elapsed:s.elapsed+dt,lastHit:s.lastHit+dt,left:Math.max(0,s.left-dt),right:Math.max(0,s.right-dt),flameCooldown:Math.max(0,s.flameCooldown-dt),spawnIn:s.spawnIn-dt,orders:s.orders.map(o=>({...o,patience:Math.max(0,o.patience-dt)}))}
 if(n.orders[0]?.patience===0)return settle(n,true)
 // Waiting customers may leave; the active order receives a visible result.
 n.orders=n.orders.filter((o,i)=>i===0||o.patience>0)
 if(n.spawnIn<=0&&n.orders.length<3&&n.completed+n.orders.length<5){n.orders.push(createOrder(n.nextId++,random));n.spawnIn=22}
 const late=STEPS[n.step].late
 if(n.elapsed>late){const loss=dt*(1.6/(1+n.skills.fire*.25));n.quality=n.quality.map(q=>clamp(q-loss));n.combo=0;if(s.elapsed<=late)n=feedback(n,'有点焦了！快做下一步','bad',null)}
 return n
}
export function act(s:GameState,action:Action):GameState {
 if(s.phase!=='playing'||!s.orders.length)return s
 const left=action==='toss'||action==='flame';const cooldown=left?s.left:s.right
 if(cooldown>0)return s
 // Toss enters the spoon's working zone. A flame boost is compatible with stirring.
 if((action==='toss'&&s.right>0)||(!left&&s.left>0&&s.lastAction==='toss'))return feedback({...s,left:.6,right:.6,combo:0,quality:s.quality.map(q=>clamp(q-3))},'双手打架！等另一只手收回','bad','collision')
 const speed=1/(1+s.skills.stamina*.15+(action==='stir'?s.skills.spoon*.18:0));let n={...s,left:left?.65*speed:s.left,right:left?s.right:.36*speed}
 if(action==='flame'){
   if(s.flameCooldown>0)return s
   if(s.step<3)return feedback(n,'先把食材下锅，再爆锅气','normal',action)
   n.quality=[clamp(s.quality[0]+2),clamp(s.quality[1]+8+s.skills.fire*4),s.quality[2]];n.flameCooldown=6
   return feedback(n,'锅气爆发！香 +'+(8+s.skills.fire*4),'good',action)
 }
 const step=STEPS[s.step]
 if(action!==step.action)return feedback({...n,combo:0,quality:s.quality.map(q=>clamp(q-2))},`别急！先${step.title}`,'bad',action)
 const early=s.lastHit<step.ideal*.6/(1+s.skills.stamina*.2);const late=s.elapsed>step.late;const perfect=!early&&!late
 const gain=perfect?1:early?.6:.4
 const gains:Record<Action,number[]>={oil:[3,7+s.skills.oil*7,2],egg:[13+s.skills.egg*9,5,5],meat:[5,7,9],veg:[13,4,6],rice:[6,3,6],stir:[5+s.skills.spoon*2,4,3],sauce:[4,5,23+s.skills.seasoning*9],toss:[6+s.skills.pot*3,12+s.skills.pot*5,5],flame:[0,0,0],serve:[3,3,5]}
 n.quality=n.quality.map((q,i)=>clamp(q+gains[action][i]*gain));n.combo=perfect?s.combo+1:0;n.bestCombo=Math.max(s.bestCombo,n.combo);n.lastHit=0;n.hits=s.hits+1
 if(action==='serve')return settle(feedback(n,'出锅！','good',action))
 if(n.hits>=step.hits){n.step++;n.hits=0;n.elapsed=0}
 return feedback(n,perfect?(action==='toss'?'锅气！起飞！':action==='stir'?'黄金！完美翻炒！':'完美！'+step.title):early?'太快啦！稍等一拍更香':'慢了一拍，但接住了！',perfect?'good':'normal',action)
}
export function continueGame(s:GameState,random=Math.random):GameState {
 if(s.phase!=='result')return s
 if(s.completed>=5)return {...s,phase:'closed'}
 if(s.xp>=60+s.level*15){const choices=UPGRADES.map(u=>u.id);for(let i=choices.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]]}return {...s,phase:'upgrade',choices:choices.slice(0,3),xp:s.xp-(60+s.level*15),level:s.level+1}}
 return nextOrder(s,random)
}
function nextOrder(s:GameState,random=Math.random):GameState {
 const orders=s.orders.slice(1);let nextId=s.nextId;if(!orders.length)orders.push(createOrder(nextId++,random))
 return {...s,phase:'playing',orders,nextId,step:0,hits:0,elapsed:0,lastHit:0,quality:[5,5,5],left:0,right:0,flameCooldown:0,result:null,notice:'下一位！热锅，继续！',noticeKind:'normal',lastAction:null}
}
export function chooseUpgrade(s:GameState,skill:Skill,random=Math.random):GameState {if(s.phase!=='upgrade'||!s.choices.includes(skill))return s;return nextOrder({...s,skills:{...s.skills,[skill]:s.skills[skill]+1},choices:[]},random)}
