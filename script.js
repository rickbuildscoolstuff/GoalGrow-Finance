  "use strict";
  /*
    Single-file integration of the supplied finance dashboard and Financial Tycoon
    module. The original TypeScript game model is represented below as validated
    plain JavaScript so it runs without a bundler. This is a browser-only demo;
    it deliberately does not claim to process payments, hold passwords, or move money.
  */
  const STORAGE_KEY = "goalgrow.unified.v1";
  const MAX_RUPEES = 1000000000;
  const MAX_POINTS = 1000000000;
  const MAX_EMPIRE_LEVEL = 100;
  const FREE_ACTIVE_GOAL_LIMIT = 3;
  const AMOUNT_EDIT_COOLDOWN_MS = 7*86400000;
  const DELETE_GOAL_COOLDOWN_MS = 30*86400000;
  const PREMIUM_MONTHLY_PRICE = 299;
  const TRIAL_DAYS = 7;
  const COINS_PER_RUPEE = 100;
  const MIN_CASHOUT_COINS = 1000;
  const BUILDINGS = Object.freeze([
    {id:"starter",name:"Starter House",icon:"🏠",unlock:1,description:"Your first financial foothold.",costs:[100,160,240,360,520]},
    {id:"bank",name:"Savings Bank",icon:"🏦",unlock:2,description:"A stable base for better habits.",costs:[300,450,650,900,1250]},
    {id:"tower",name:"Investment Tower",icon:"📊",unlock:3,description:"A landmark for consistent investing.",costs:[750,1050,1450,1950,2600]},
    {id:"business",name:"Business Center",icon:"🏢",unlock:4,description:"A hub for your growing plan.",costs:[1500,2100,2850,3750,4900]},
    {id:"district",name:"Financial District",icon:"🏙️",unlock:5,description:"A city district built on progress.",costs:[3000,4050,5350,6900,8750]},
    {id:"empire",name:"Empire Headquarters",icon:"🌆",unlock:6,description:"The final property in your city.",costs:[6000,7900,10100,12700,15700]}
  ]);
  const CHALLENGES = Object.freeze([
    {id:"track",label:"Track today’s spending",points:20,xp:30},
    {id:"review",label:"Review a weekly budget",points:45,xp:55},
    {id:"learn",label:"Learn one finance concept",points:30,xp:40}
  ]);
  const DEFAULT_STATE = Object.freeze({
    schema:1, points:1250, gameCoins:0, goals:[
      {id:"home",name:"Dream Home",description:"Build a down-payment fund",target:500000,invested:200000,mode:"Monthly SIP",monthly:10000,completed:false,createdAt:Date.now()-120*86400000,deadlineAt:Date.now()+365*86400000,lastAmountEditAt:null},
      {id:"car",name:"New Car",description:"Plan the next car without rushing",target:300000,invested:120000,mode:"Monthly SIP",monthly:8000,completed:false,createdAt:Date.now()-90*86400000,deadlineAt:Date.now()+200*86400000,lastAmountEditAt:null},
      {id:"study",name:"Higher Studies",description:"Fund education with confidence",target:800000,invested:300000,mode:"Lump sum",monthly:0,completed:false,createdAt:Date.now()-60*86400000,deadlineAt:Date.now()+500*86400000,lastAmountEditAt:null}
    ], transactions:[], exchangeRequests:[],
    tycoon:{level:1,xp:0,buildings:{},challenges:{},gamesPlayed:0,lastGameResult:"No round played yet."},
    subscription:{status:"free",trialStartedAt:null,trialEndsAt:null,billingConsentAt:null,cancelledAt:null,lastWeeklyBonusWeek:""},
    profile:{username:"Rick",photo:"",verifiedContact:"",linkedAccounts:[{id:"acct-1",name:"GoalGrow Bank",last4:"4821"}],pendingChange:null}
  });
  const memoryStorage = new Map();
  const storage = typeof localStorage !== "undefined" ? localStorage : {getItem:k=>memoryStorage.get(k)||null,setItem:(k,v)=>memoryStorage.set(k,v)};
  const clone = value => JSON.parse(JSON.stringify(value));
  const now = () => Date.now();
  const asInt = (value, fallback=0, min=0, max=MAX_POINTS) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
  };
  const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
  const asText = (value,fallback,max=120) => typeof value === "string" ? value.trim().slice(0,max) || fallback : fallback;
  const makeId = prefix => prefix + "-" + (globalThis.crypto?.randomUUID?.() || (now().toString(36)+Math.random().toString(36).slice(2,9)));
  const money = amount => "₹" + asInt(amount,0,0,MAX_RUPEES).toLocaleString("en-IN");
  const dateTime = timestamp => new Date(timestamp).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});
  const xpForLevel = level => 500 + (asInt(level,1,1,MAX_EMPIRE_LEVEL)-1)*250;
  const weekKey = timestamp => { const d=new Date(timestamp); const monday=new Date(d); monday.setHours(0,0,0,0); monday.setDate(d.getDate()-((d.getDay()+6)%7)); return monday.toISOString().slice(0,10); };
  const safePhotoUrl = value => { try { const u=new URL(value); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };

  function normaliseState(raw){
    const seed=clone(DEFAULT_STATE), source=raw&&typeof raw==="object"?raw:{};
    const result={...seed}; result.points=asInt(source.points,seed.points); result.gameCoins=asInt(source.gameCoins,0);
    const seen=new Set();
    result.goals=(Array.isArray(source.goals)?source.goals:seed.goals).slice(0,200).map((goal,index)=>{
      const target=asInt(goal?.target,100,100,MAX_RUPEES); const invested=clamp(asInt(goal?.invested,0,0,MAX_RUPEES),0,target);
      let id=asText(goal?.id,"goal-"+index,80); while(seen.has(id)) id+="-"+index; seen.add(id);
      const completed=invested===target;
      const createdAt=asInt(goal?.createdAt,now(),0,Number.MAX_SAFE_INTEGER);
      let deadlineAt=asInt(goal?.deadlineAt,0,0,Number.MAX_SAFE_INTEGER)||null;
      if(deadlineAt&&deadlineAt<createdAt) deadlineAt=null;
      const lastAmountEditAt=asInt(goal?.lastAmountEditAt,0,0,Number.MAX_SAFE_INTEGER)||null;
      return {id,name:asText(goal?.name,"Untitled goal",60),description:asText(goal?.description,"Financial goal",120),target,invested,mode:goal?.mode==="Lump sum"?"Lump sum":"Monthly SIP",monthly:clamp(asInt(goal?.monthly,0,0,MAX_RUPEES),0,target),completed,completedAt:completed?asInt(goal?.completedAt,0,0,Number.MAX_SAFE_INTEGER):null,completionAwarded:completed?Boolean(goal?.completionAwarded):false,createdAt,deadlineAt,lastAmountEditAt};
    });
    result.transactions=(Array.isArray(source.transactions)?source.transactions:(Array.isArray(seed.transactions)?seed.transactions:[])).slice(0,500).map((t,index)=>({id:asText(t?.id,"tx-"+index,100),label:asText(t?.label,"Account activity",80),kind:asText(t?.kind,"Activity",40),amount:asInt(t?.amount,0,-MAX_POINTS,MAX_POINTS),createdAt:asInt(t?.createdAt,now(),0,Number.MAX_SAFE_INTEGER)}));
    result.exchangeRequests=(Array.isArray(source.exchangeRequests)?source.exchangeRequests:[]).slice(0,100).map((r,index)=>({id:asText(r?.id,"exchange-"+index,100),coins:asInt(r?.coins,0),rupees:asInt(r?.rupees,0,0,MAX_RUPEES),accountId:asText(r?.accountId,"",100),status:"Pending demo",createdAt:asInt(r?.createdAt,now(),0,Number.MAX_SAFE_INTEGER)}));
    const rawTycoon=source.tycoon&&typeof source.tycoon==="object"?source.tycoon:{};
    result.tycoon={level:asInt(rawTycoon.level,1,1,MAX_EMPIRE_LEVEL),xp:asInt(rawTycoon.xp,0,0,MAX_POINTS),buildings:{},challenges:{},gamesPlayed:asInt(rawTycoon.gamesPlayed,0),lastGameResult:asText(rawTycoon.lastGameResult,"No round played yet.",120)};
    BUILDINGS.forEach(def=>{result.tycoon.buildings[def.id]=asInt(rawTycoon.buildings?.[def.id],0,0,5);});
    CHALLENGES.forEach(def=>{const claimed=asText(rawTycoon.challenges?.[def.id],"",20); result.tycoon.challenges[def.id]=/^\d{4}-\d{2}-\d{2}$/.test(claimed)?claimed:"";});
    let safety=0; while(result.tycoon.level<MAX_EMPIRE_LEVEL && result.tycoon.xp>=xpForLevel(result.tycoon.level) && safety++<MAX_EMPIRE_LEVEL){result.tycoon.xp-=xpForLevel(result.tycoon.level);result.tycoon.level++;}
    if(result.tycoon.level===MAX_EMPIRE_LEVEL) result.tycoon.xp=Math.min(result.tycoon.xp,xpForLevel(MAX_EMPIRE_LEVEL)-1);
    const rawSubscription=source.subscription&&typeof source.subscription==="object"?source.subscription:{};
    result.subscription={status:["free","trial","active"].includes(rawSubscription.status)?rawSubscription.status:"free",trialStartedAt:asInt(rawSubscription.trialStartedAt,0,0,Number.MAX_SAFE_INTEGER)||null,trialEndsAt:asInt(rawSubscription.trialEndsAt,0,0,Number.MAX_SAFE_INTEGER)||null,billingConsentAt:asInt(rawSubscription.billingConsentAt,0,0,Number.MAX_SAFE_INTEGER)||null,cancelledAt:asInt(rawSubscription.cancelledAt,0,0,Number.MAX_SAFE_INTEGER)||null,lastWeeklyBonusWeek:asText(rawSubscription.lastWeeklyBonusWeek,"",20)};
    const rawProfile=source.profile&&typeof source.profile==="object"?source.profile:{};
    result.profile={username:asText(rawProfile.username,"Rick",40),photo:safePhotoUrl(rawProfile.photo),verifiedContact:asText(rawProfile.verifiedContact,"",100),linkedAccounts:(Array.isArray(rawProfile.linkedAccounts)?rawProfile.linkedAccounts:seed.profile.linkedAccounts).slice(0,10).map((a,index)=>({id:asText(a?.id,"account-"+index,80),name:asText(a?.name,"Linked account",60),last4:asText(a?.last4,"0000",4).replace(/\D/g,"").slice(-4).padStart(4,"0")})),pendingChange:null};
    const pending=rawProfile.pendingChange; if(pending&&typeof pending==="object"&&asInt(pending.expiresAt,0,0,Number.MAX_SAFE_INTEGER)>now()) result.profile.pendingChange={username:asText(pending.username,result.profile.username,40),photo:safePhotoUrl(pending.photo),contact:asText(pending.contact,"",100),method:pending.method==="phone"?"phone":"email",expiresAt:asInt(pending.expiresAt,0,0,Number.MAX_SAFE_INTEGER)};
    return result;
  }
  function loadState(){try{return normaliseState(JSON.parse(storage.getItem(STORAGE_KEY)||"null"));}catch{return normaliseState(null);}}
  let state=loadState();
  function saveState(){try{storage.setItem(STORAGE_KEY,JSON.stringify(state)); if(typeof document!=="undefined") document.getElementById("syncStatus").textContent="Saved locally just now";}catch{if(typeof document!=="undefined") toast("Local storage is unavailable; this session cannot be saved.");}}
  function isPremium(){return state.subscription.status==="trial"||(state.subscription.status==="active"&&!state.subscription.cancelledAt);}
  function activeGoalCount(){return state.goals.filter(goal=>!goal.completed).length;}
  function remaining(goal){return Math.max(0,goal.target-goal.invested);}
  function addTransaction(label,kind,amount){state.transactions.unshift({id:makeId("tx"),label,kind,amount,createdAt:now()});state.transactions=state.transactions.slice(0,500);}
  function addPoints(amount,label,kind="Reward"){const safe=asInt(amount,0,0,MAX_POINTS);state.points=clamp(state.points+safe,0,MAX_POINTS);addTransaction(label,kind,safe);}
  function reconcile(){let changed=false, current=now(), sub=state.subscription;
    if(sub.status==="trial"&&sub.trialEndsAt&&current>=sub.trialEndsAt){sub.status=sub.cancelledAt?"free":"active";changed=true;}
    if(sub.cancelledAt&&sub.status==="active"){sub.status="free";changed=true;}
    if(isPremium()){const key=weekKey(current);if(sub.lastWeeklyBonusWeek!==key){sub.lastWeeklyBonusWeek=key;addPoints(100,"Premium weekly bonus");changed=true;}}
    if(changed) saveState(); return changed;
  }
  function awardXp(amount){const tycoon=state.tycoon;tycoon.xp=clamp(tycoon.xp+asInt(amount,0,0,MAX_POINTS),0,MAX_POINTS);let levels=0;while(tycoon.level<MAX_EMPIRE_LEVEL&&tycoon.xp>=xpForLevel(tycoon.level)){tycoon.xp-=xpForLevel(tycoon.level);tycoon.level++;levels++;}if(tycoon.level===MAX_EMPIRE_LEVEL)tycoon.xp=Math.min(tycoon.xp,xpForLevel(MAX_EMPIRE_LEVEL)-1);return levels;}
  function validateInvestment(goal,amount){const contribution=asInt(amount,-1,1,MAX_RUPEES);if(!goal)return {ok:false,message:"Choose a valid goal."};if(goal.completed||remaining(goal)===0)return {ok:false,message:"This goal is complete and cannot accept another investment."};if(contribution<1)return {ok:false,message:"Enter a whole-rupee amount of at least ₹1."};if(contribution>remaining(goal))return {ok:false,message:"Investment exceeds the remaining " + money(remaining(goal)) + "."};return {ok:true,amount:contribution};}
  function invest(goalId,amount,type){
    const goal=state.goals.find(item=>item.id===String(goalId));
    const verdict=validateInvestment(goal,amount);
    if(!verdict.ok)return verdict;
    const isLump=type==="Lump sum";
    goal.invested+=verdict.amount;
    // Lump sum into an SIP goal: add the one-time amount without changing SIP mode or monthly size
    if(isLump){
      if(goal.mode!=="Monthly SIP") goal.mode="Lump sum";
    }else{
      goal.mode="Monthly SIP";
      goal.monthly=verdict.amount;
    }
    const txKind=isLump?"Lump sum":"Monthly SIP";
    const earned=Math.max(5,Math.floor(verdict.amount/1000)*5);
    addPoints(earned,"Investment reward · "+goal.name);
    addTransaction("Investment · "+goal.name,txKind,-verdict.amount);
    let completion=0;
    if(goal.invested===goal.target&&!goal.completionAwarded){
      goal.completed=true;goal.completedAt=now();goal.completionAwarded=true;
      completion=250+(isPremium()?150:0);
      addPoints(completion,"Goal achieved · "+goal.name,"Completion bonus");
      awardXp(120);
    }
    const modeNote=isLump&&goal.mode==="Monthly SIP"?" (lump sum top-up; SIP plan unchanged)":"";
    return {ok:true,message:money(verdict.amount)+" invested in "+goal.name+modeNote+". +"+earned+(completion?" +"+completion+" completion points.":" points.")};
  }
  function parseDeadline(monthsValue,dateValue){
    const months=asInt(monthsValue,0,0,600);
    if(months>0) return now()+months*30.44*86400000;
    if(dateValue){
      const t=Date.parse(dateValue);
      if(Number.isFinite(t)&&t>now()) return t;
    }
    return null;
  }
  function createGoal(name,target,description,monthsValue,dateValue){
    if(!isPremium()&&activeGoalCount()>=FREE_ACTIVE_GOAL_LIMIT)return {ok:false,message:"Free membership allows three active goals. Start Premium for unlimited active goals."};
    const cleanName=asText(name,"",60), cleanTarget=asInt(target,0,100,MAX_RUPEES);
    if(!cleanName||!cleanTarget)return {ok:false,message:"Enter a name and a target from ₹100 to ₹1,00,00,00,000."};
    const deadlineAt=parseDeadline(monthsValue,dateValue);
    if(!deadlineAt)return {ok:false,message:"Set a time period: choose months to achieve (1–600) or a future target date."};
    const created=now();
    state.goals.push({id:makeId("goal"),name:cleanName,description:asText(description,"Financial goal",120),target:cleanTarget,invested:0,mode:"Monthly SIP",monthly:0,completed:false,completedAt:null,completionAwarded:false,createdAt:created,deadlineAt,lastAmountEditAt:null});
    return {ok:true,message:"Goal created: "+cleanName+" · target by "+new Date(deadlineAt).toLocaleDateString("en-IN",{dateStyle:"medium"})+"."};
  }
  function amountEditCooldownRemaining(goal){
    if(!goal?.lastAmountEditAt) return 0;
    return Math.max(0, goal.lastAmountEditAt+AMOUNT_EDIT_COOLDOWN_MS-now());
  }
  function deleteCooldownRemaining(goal){
    if(!goal?.createdAt) return 0;
    return Math.max(0, goal.createdAt+DELETE_GOAL_COOLDOWN_MS-now());
  }
  function formatCooldown(ms){
    if(ms<=0) return "";
    const days=Math.ceil(ms/86400000);
    if(days>=30) return days+" day"+(days===1?"":"s");
    if(days>=1) return days+" day"+(days===1?"":"s");
    const hours=Math.ceil(ms/3600000);
    return hours+" hour"+(hours===1?"":"s");
  }
  function editGoalAmount(goalId,newTarget){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal) return {ok:false,message:"Goal not found."};
    if(goal.completed) return {ok:false,message:"Completed goals cannot change their target amount."};
    const remaining=amountEditCooldownRemaining(goal);
    if(remaining>0) return {ok:false,message:"Target amount can be changed once every 7 days. Try again in "+formatCooldown(remaining)+"."};
    const cleanTarget=asInt(newTarget,0,100,MAX_RUPEES);
    if(!cleanTarget) return {ok:false,message:"Enter a target from ₹100 to ₹1,00,00,00,000."};
    if(cleanTarget<goal.invested) return {ok:false,message:"New target cannot be below the already invested "+money(goal.invested)+"."};
    if(cleanTarget===goal.target) return {ok:false,message:"Enter a different target amount."};
    const previous=goal.target;
    goal.target=cleanTarget;
    goal.lastAmountEditAt=now();
    goal.completed=goal.invested===goal.target;
    addTransaction("Target updated · "+goal.name,"Goal edit",0);
    return {ok:true,message:"Target for "+goal.name+" changed from "+money(previous)+" to "+money(cleanTarget)+". Next change allowed after 7 days."};
  }
  function editGoalDeadline(goalId,monthsValue,dateValue){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal) return {ok:false,message:"Goal not found."};
    if(goal.completed) return {ok:false,message:"Completed goals cannot change their time period."};
    const deadlineAt=parseDeadline(monthsValue,dateValue);
    if(!deadlineAt) return {ok:false,message:"Set months (1–600) or a future target date."};
    goal.deadlineAt=deadlineAt;
    return {ok:true,message:"Time period for "+goal.name+" updated · target by "+new Date(deadlineAt).toLocaleDateString("en-IN",{dateStyle:"medium"})+"."};
  }
  function editGoalSip(goalId,newTarget,monthsValue,dateValue){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal) return {ok:false,message:"Goal not found."};
    if(goal.completed) return {ok:false,message:"Completed goals cannot be edited."};
    const messages=[];
    let changed=false;
    // Amount (only if not on cooldown and value differs)
    const cooldown=amountEditCooldownRemaining(goal);
    const cleanTarget=asInt(newTarget,0,100,MAX_RUPEES);
    if(cleanTarget && cleanTarget!==goal.target){
      if(cooldown>0) return {ok:false,message:"Target amount can be changed once every 7 days. Try again in "+formatCooldown(cooldown)+"."};
      if(cleanTarget<goal.invested) return {ok:false,message:"New target cannot be below the already invested "+money(goal.invested)+"."};
      const previous=goal.target;
      goal.target=cleanTarget;
      goal.lastAmountEditAt=now();
      goal.completed=goal.invested===goal.target;
      addTransaction("Target updated · "+goal.name,"Goal edit",0);
      messages.push("target "+money(previous)+" → "+money(cleanTarget));
      changed=true;
    }
    // Period: only update if months or a valid future date provided
    const hasMonths=asInt(monthsValue,0,0,600)>0;
    const hasDate=dateValue && Number.isFinite(Date.parse(dateValue)) && Date.parse(dateValue)>now();
    if(hasMonths || hasDate){
      const deadlineAt=parseDeadline(monthsValue,dateValue);
      if(!deadlineAt) return {ok:false,message:"Set months (1–600) or a future target date."};
      if(deadlineAt!==goal.deadlineAt){
        goal.deadlineAt=deadlineAt;
        messages.push("period → "+new Date(deadlineAt).toLocaleDateString("en-IN",{dateStyle:"medium"}));
        changed=true;
      }
    }
    if(!changed) return {ok:false,message:"No changes to save. Update the target amount or set a new time period."};
    return {ok:true,message:"SIP updated for "+goal.name+": "+messages.join("; ")+"."};
  }
  function deleteGoal(goalId){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal) return {ok:false,message:"Goal not found."};
    const remaining=deleteCooldownRemaining(goal);
    if(remaining>0) return {ok:false,message:"A goal can only be deleted 30 days after it was created. Try again in "+formatCooldown(remaining)+"."};
    state.goals=state.goals.filter(item=>item.id!==goal.id);
    addTransaction("Goal deleted · "+goal.name,"Goal edit",0);
    return {ok:true,message:"Deleted goal: "+goal.name+"."};
  }
  function stageCost(def,stage){return stage>=5?0:def.costs[stage];}
  function buyStage(id){const def=BUILDINGS.find(item=>item.id===id);if(!def)return {ok:false,message:"Unknown building."};const stage=state.tycoon.buildings[def.id];if(state.tycoon.level<def.unlock)return {ok:false,message:def.name+" unlocks at Empire Level "+def.unlock+"."};if(stage>=5)return {ok:false,message:def.name+" is already at Stage 5."};const cost=stageCost(def,stage);if(state.points<cost)return {ok:false,message:"You need "+(cost-state.points)+" more reward points."};state.points-=cost;state.tycoon.buildings[def.id]=stage+1;addTransaction((stage?"Upgrade · ":"Built · ")+def.name,"Empire",-cost);const levels=awardXp(stage?85:140);return {ok:true,message:def.name+" is now Stage "+(stage+1)+". +"+(stage?85:140)+" XP"+(levels?" · Empire Level "+state.tycoon.level+"!":".")};}
  function randomInt(max){if(globalThis.crypto?.getRandomValues){const values=new Uint32Array(1);globalThis.crypto.getRandomValues(values);return values[0]%max;}return Math.floor(Math.random()*max);}
  function playRound(){if(state.points<25)return {ok:false,message:"You need 25 reward points to play."};state.points-=25;const roll=randomInt(100),coins=roll<12?150:roll<40?75:roll<72?30:0;state.gameCoins=clamp(state.gameCoins+coins,0,MAX_POINTS);state.tycoon.gamesPlayed++;state.tycoon.lastGameResult=coins?"You won "+coins+" game coins!":"No coins this round; your empire still keeps growing.";addTransaction("Reward round"+(coins?" · +"+coins+" coins":""),"Game",-25);if(coins)awardXp(20);return {ok:true,message:state.tycoon.lastGameResult};}
  function claimChallenge(id){const item=CHALLENGES.find(challenge=>challenge.id===id),today=new Date().toISOString().slice(0,10);if(!item)return {ok:false,message:"Unknown challenge."};if(state.tycoon.challenges[id]===today)return {ok:false,message:"That daily action is already claimed."};state.tycoon.challenges[id]=today;addPoints(item.points,item.label,"Daily action");const levels=awardXp(item.xp);return {ok:true,message:"+"+item.points+" points and +"+item.xp+" XP"+(levels?" · Level "+state.tycoon.level+"!":".")};}
  function calculateCashout(coins){const amount=asInt(coins,-1,MIN_CASHOUT_COINS,MAX_POINTS);if(amount<MIN_CASHOUT_COINS)return {ok:false,message:"Minimum cash-out is "+MIN_CASHOUT_COINS.toLocaleString("en-IN")+" coins."};if(amount%COINS_PER_RUPEE!==0)return {ok:false,message:"Use a multiple of "+COINS_PER_RUPEE+" coins."};if(amount>state.gameCoins)return {ok:false,message:"You only have "+state.gameCoins.toLocaleString("en-IN")+" game coins."};return {ok:true,coins:amount,rupees:amount/COINS_PER_RUPEE};}
  function requestCashout(coins,accountId){const verdict=calculateCashout(coins);if(!verdict.ok)return verdict;const bank=state.profile.linkedAccounts.find(item=>item.id===accountId);if(!bank)return {ok:false,message:"Select a linked bank account."};state.gameCoins-=verdict.coins;state.exchangeRequests.unshift({id:makeId("cashout"),coins:verdict.coins,rupees:verdict.rupees,accountId:bank.id,status:"Pending demo",createdAt:now()});addTransaction("Cash-out request · "+bank.name,"Exchange",-verdict.coins);return {ok:true,message:"Demo cash-out request for "+money(verdict.rupees)+" was created."};}
  function resetDemo(){
    try{storage.removeItem(STORAGE_KEY);}catch{}
    state=normaliseState(clone(DEFAULT_STATE));
    state.transactions=[];
    state.exchangeRequests=[];
    state.tycoon={level:1,xp:0,buildings:{},challenges:{},gamesPlayed:0,lastGameResult:"No round played yet."};
    BUILDINGS.forEach(def=>{state.tycoon.buildings[def.id]=0;});
    CHALLENGES.forEach(def=>{state.tycoon.challenges[def.id]="";});
    state.subscription={status:"free",trialStartedAt:null,trialEndsAt:null,billingConsentAt:null,cancelledAt:null,lastWeeklyBonusWeek:""};
    state.points=DEFAULT_STATE.points;
    state.gameCoins=0;
    state.goals=clone(DEFAULT_STATE.goals);
    state.profile=clone(DEFAULT_STATE.profile);
    saveState();
    return {ok:true,message:"Demo fully reset. Goals, points, coins, activity, history, empire, and subscription are restored to defaults."};
  }
  function startTrial(consent){if(isPremium())return {ok:false,message:"Premium is already active."};if(!consent)return {ok:false,message:"Consent to monthly billing is required before a trial can start."};const started=now();state.subscription={status:"trial",trialStartedAt:started,trialEndsAt:started+TRIAL_DAYS*86400000,billingConsentAt:started,cancelledAt:null,lastWeeklyBonusWeek:""};reconcile();return {ok:true,message:"Your 7-day Premium trial is active. Cancel any time before billing."};}
  function cancelSubscription(){if(state.subscription.status==="free")return {ok:false,message:"There is no active Premium subscription to cancel."};const inTrial=state.subscription.status==="trial";state.subscription.cancelledAt=now();if(!inTrial)state.subscription.status="free";return {ok:true,message:inTrial?"Renewal cancelled. Trial benefits remain until the trial end.":"Premium renewal cancelled. Demo Premium benefits have ended."};}
  function toast(message){if(typeof document==="undefined")return;const node=document.getElementById("toast");node.textContent=message;node.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove("show"),3400);}
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function clear(node){if(node)node.replaceChildren();return node;}
  function addButton(parent,text,action,data={},className="btn small"){const button=element("button",className,text);button.type="button";button.dataset.action=action;Object.entries(data).forEach(([key,value])=>button.dataset[key]=value);parent.appendChild(button);return button;}
  function setText(id,text){const node=document.getElementById(id);if(node)node.textContent=text;}
  function renderAvatar(){const p=state.profile,initial=(p.username[0]||"G").toUpperCase(),photo=safePhotoUrl(p.photo);["avatarImage","bigAvatarImage"].forEach(id=>{const image=document.getElementById(id);if(image){image.hidden=!photo;if(photo)image.src=photo;else image.removeAttribute("src");}});setText("avatarInitial",initial);setText("bigAvatarInitial",initial);setText("topUsername",p.username);setText("profileName",p.username);setText("profileContact",p.verifiedContact?"Verified "+p.verifiedContact:"No verified contact");setText("profilePoints",state.points.toLocaleString("en-IN")+" reward points");}
  function goalCard(goal){
    const card=element("article","card goal-card"),head=element("div","row"),title=element("h3","",goal.name),badge=element("span","status"+(goal.completed?" gold":""),goal.completed?"Completed":"Active");
    head.append(title,badge);
    const desc=element("p","",goal.description),amount=element("div","amount",money(goal.target));
    const meta=element("div","goal-meta");
    meta.append(element("span","",money(goal.invested)+" invested"),element("b","",Math.round(goal.invested/goal.target*100)+"%"));
    const progress=element("div","progress"),fill=document.createElement("i");
    fill.style.width=(goal.invested/goal.target*100)+"%";progress.appendChild(fill);
    const deadlineLabel=goal.deadlineAt?("By "+new Date(goal.deadlineAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})):"No deadline set";
    const sub=element("div","goal-meta");
    sub.append(element("span","",goal.mode+(goal.mode==="Monthly SIP"&&goal.monthly?" · "+money(goal.monthly)+"/month":"")),element("span","",goal.completed?"Goal reached":money(remaining(goal))+" remaining"));
    const timeRow=element("div","goal-meta goal-deadline");
    timeRow.append(element("span","",deadlineLabel));
    card.append(head,desc,amount,meta,progress,sub,timeRow);
    const actions=element("div","goal-actions");
    if(!goal.completed){
      addButton(actions,"Invest toward goal","select-invest",{goalId:goal.id},"btn small");
      const editCd=amountEditCooldownRemaining(goal);
      const editLabel=editCd>0?"Edit SIP · "+formatCooldown(editCd):"Edit SIP";
      addButton(actions,editLabel,"edit-goal-sip",{goalId:goal.id},"btn small outline");
    }
    card.appendChild(actions);
    return card;
  }
  function renderGoals(){const dashboard=clear(document.getElementById("dashboardGoals")),all=clear(document.getElementById("allGoals"));state.goals.forEach(goal=>{if(dashboard)dashboard.appendChild(goalCard(goal));if(all)all.appendChild(goalCard(goal));});if(!state.goals.length){const empty=element("div","empty","No goals yet.");dashboard?.appendChild(empty);all?.appendChild(empty.cloneNode(true));}const active=activeGoalCount(),completed=state.goals.length-active,total=state.goals.reduce((sum,goal)=>sum+goal.invested,0),target=state.goals.reduce((sum,goal)=>sum+goal.target,0);const stats=clear(document.getElementById("goalStats"));[["Total goals",state.goals.length],["Active goals",active],["Completed",completed],["Invested",money(total)]].forEach(([label,value])=>{const card=element("div","card stat-card");card.append(element("small","",label),element("b","",String(value)));stats?.appendChild(card);});setText("goalLimitStatus",isPremium()?"Premium · unlimited active goals":active+" / "+FREE_ACTIVE_GOAL_LIMIT+" free active goals");updateInvestmentLimit();}
  function updateInvestmentLimit(){const goalInput=document.getElementById("investmentGoal"),input=document.getElementById("investmentAmount"),hint=document.getElementById("investmentLimit"),meta=document.getElementById("investModalGoalMeta");if(!goalInput||!input||!hint)return;const goal=state.goals.find(item=>item.id===goalInput.value);if(!goal||goal.completed){input.disabled=true;hint.textContent="This goal cannot accept another investment.";if(meta)meta.textContent="Select an active goal to continue.";return;}const limit=remaining(goal);input.disabled=false;input.max=String(limit);hint.textContent="Remaining cap: "+money(limit)+". Larger amounts are rejected.";if(meta)meta.textContent=goal.name+" · "+money(goal.invested)+" invested · "+money(limit)+" remaining";}
  function openInvestModal(goalId){const modal=document.getElementById("investModal"),goalInput=document.getElementById("investmentGoal"),form=document.getElementById("investForm"),amount=document.getElementById("investmentAmount");if(!modal||!goalInput)return;const goal=state.goals.find(item=>item.id===String(goalId));if(!goal||goal.completed){toast("This goal cannot accept another investment.");return;}goalInput.value=goal.id;if(form)form.reset();goalInput.value=goal.id;updateInvestmentLimit();modal.hidden=false;requestAnimationFrame(()=>modal.setAttribute("data-open","true"));setTimeout(()=>amount?.focus(),50);}
  function closeInvestModal(){const modal=document.getElementById("investModal");if(!modal)return;modal.removeAttribute("data-open");setTimeout(()=>{modal.hidden=true;},200);}
  function openModal(id){const modal=document.getElementById(id);if(!modal)return;modal.hidden=false;requestAnimationFrame(()=>modal.setAttribute("data-open","true"));}
  function closeModal(id){const modal=document.getElementById(id);if(!modal)return;modal.removeAttribute("data-open");setTimeout(()=>{modal.hidden=true;},200);}
  function openEditSipModal(goalId){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal||goal.completed){toast("This goal cannot be edited.");return;}
    document.getElementById("editSipGoalId").value=goal.id;
    const amountInput=document.getElementById("editSipAmount");
    amountInput.value=String(goal.target);
    amountInput.min=String(Math.max(100,goal.invested));
    amountInput.disabled=false;
    const cooldown=amountEditCooldownRemaining(goal);
    if(cooldown>0){
      setText("editSipAmountHint","Target amount can be changed once every 7 days. Try again in "+formatCooldown(cooldown)+". You can still update the time period.");
    }else{
      setText("editSipAmountHint","Cannot be below the already invested "+money(goal.invested)+". Target amount can be changed once every 7 days.");
    }
    document.getElementById("editSipMonths").value="";
    const dateInput=document.getElementById("editSipDate");
    if(goal.deadlineAt){
      const d=new Date(goal.deadlineAt);
      dateInput.value=d.toISOString().slice(0,10);
    }else dateInput.value="";
    setText("editSipMeta",goal.name+" · currently "+money(goal.target)+" · invested "+money(goal.invested)+(goal.deadlineAt?" · target by "+new Date(goal.deadlineAt).toLocaleDateString("en-IN",{dateStyle:"medium"}):" · no deadline set"));
    openModal("editSipModal");
    setTimeout(()=>amountInput?.focus(),50);
  }
  function renderActivity(target,filter){const root=clear(document.getElementById(target));const rows=state.transactions.filter(filter||(()=>true)).slice(0,6);if(!rows.length){root?.appendChild(element("div","empty","No activity recorded yet."));return;}rows.forEach(row=>{const item=element("div","activity-row"),left=document.createElement("div");left.append(element("b","",row.label),element("small","",row.kind+" · "+dateTime(row.createdAt)));const quantity=Math.abs(row.amount).toLocaleString("en-IN");const isInvest=isInvestmentTx(row);const shown=isInvest?money(Math.abs(row.amount)):quantity+(row.kind==="Exchange"?" coins":" pts");const amount=element("b",row.amount<0?"negative":"positive",(row.amount<0?"−":"+")+shown);item.append(left,amount);root?.appendChild(item);});}
  function redeemableRupees(coins){return money(Math.floor(asInt(coins,0,0,MAX_POINTS)/COINS_PER_RUPEE));}
  let chartScale="days";
  function goalInvestments(goal){
    if(!goal)return [];
    return state.transactions
      .filter(row=>isInvestmentTx(row)&&investmentGoalName(row)===goal.name)
      .sort((a,b)=>a.createdAt-b.createdAt)
      .map(row=>({t:row.createdAt,amount:Math.abs(row.amount)}));
  }
  function buildActualSeries(investments,goal){
    let cum=0;
    if(investments.length){
      const points=[{t:investments[0].t,v:0}];
      investments.forEach(item=>{cum+=item.amount;points.push({t:item.t,v:cum});});
      // Hold the latest balance flat to "now" so the line does not look unfinished
      const last=points[points.length-1];
      if(last.t<now()) points.push({t:now(),v:last.v});
      return points;
    }
    // No dated transactions: show a flat line at the current invested balance
    const invested=goal?goal.invested:0;
    const startT=now()-30*86400000;
    return [{t:startT,v:invested},{t:now(),v:invested}];
  }
  function buildExpectedSeries(goal,actual,scale){
    if(!goal)return [];
    const target=goal.target;
    const current=Math.min(goal.invested,target);
    const remainingAmt=Math.max(0,target-current);
    const nowT=now();
    let endT;
    if(goal.deadlineAt&&goal.deadlineAt>nowT){
      endT=goal.deadlineAt;
    }else if(goal.mode==="Monthly SIP"&&goal.monthly>0){
      const monthsLeft=Math.max(1,Math.ceil(remainingAmt/goal.monthly));
      endT=nowT+monthsLeft*30.44*86400000;
    }else if(actual.length>=2){
      const first=actual[0], last=actual[actual.length-1];
      const span=Math.max(86400000,last.t-first.t);
      const gained=Math.max(0,last.v-first.v);
      const ratePerMonth=gained>0?(gained/span)*30.44*86400000:0;
      const monthsLeft=ratePerMonth>0?Math.max(1,Math.ceil(remainingAmt/ratePerMonth)):12;
      endT=nowT+monthsLeft*30.44*86400000;
    }else{
      endT=nowT+12*30.44*86400000;
    }
    if(endT<=nowT) endT=nowT+30*86400000;
    const step=scale==="months"?30.44*86400000:scale==="weeks"?7*86400000:86400000;
    const points=[{t:nowT,v:current}];
    for(let t=nowT+step;t<endT;t+=step){
      const progress=Math.min(1,(t-nowT)/(endT-nowT));
      points.push({t,v:current+remainingAmt*progress});
    }
    points.push({t:endT,v:target});
    return points;
  }
  function formatChartLabel(ts,scale){
    const d=new Date(ts);
    if(scale==="months")return d.toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
    if(scale==="weeks")return d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    return d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
  }
  function drawInvestChart(goal){
    const canvas=document.getElementById("investChart");
    const empty=document.getElementById("chartEmpty");
    if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const dpr=window.devicePixelRatio||1;
    const cssW=canvas.clientWidth||800;
    const cssH=280;
    canvas.width=Math.floor(cssW*dpr);
    canvas.height=Math.floor(cssH*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH);
    if(!goal){
      if(empty){empty.hidden=false;empty.textContent="Create a goal to see its investment trajectory.";}
      return;
    }
    const investments=goalInvestments(goal);
    const actual=buildActualSeries(investments,goal);
    const expected=buildExpectedSeries(goal,actual,chartScale);
    const hasHistory=investments.length>0||(goal.invested>0);
    if(empty){empty.hidden=hasHistory;empty.textContent="No investment history for this goal yet. Confirm a contribution to start the graph.";}
    const all=[...actual,...expected];
    const minT=Math.min(...all.map(p=>p.t));
    const maxT=Math.max(...all.map(p=>p.t));
    const maxV=Math.max(goal.target, ...all.map(p=>p.v), 1);
    const padL=52,padR=16,padT=16,padB=36;
    const plotW=cssW-padL-padR, plotH=cssH-padT-padB;
    const xOf=t=>padL+((t-minT)/Math.max(1,maxT-minT))*plotW;
    const yOf=v=>padT+plotH-(v/maxV)*plotH;
    ctx.strokeStyle="#dce7e1";ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const y=padT+(plotH*i)/4;
      ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+plotW,y);ctx.stroke();
      const val=Math.round(maxV*(1-i/4));
      ctx.fillStyle="#688078";ctx.font="11px Inter,system-ui,sans-serif";ctx.textAlign="right";
      ctx.fillText("₹"+val.toLocaleString("en-IN"),padL-8,y+4);
    }
    const labelCount=Math.min(6, Math.max(2, Math.floor(plotW/90)));
    ctx.textAlign="center";ctx.fillStyle="#688078";
    for(let i=0;i<=labelCount;i++){
      const t=minT+((maxT-minT)*i)/labelCount;
      ctx.fillText(formatChartLabel(t,chartScale),xOf(t),cssH-12);
    }
    function strokeSeries(points,color,dashed){
      if(points.length<2)return;
      ctx.beginPath();
      ctx.setLineDash(dashed?[6,5]:[]);
      ctx.strokeStyle=color;ctx.lineWidth=dashed?2:2.5;ctx.lineJoin="round";
      points.forEach((p,i)=>{const x=xOf(p.t),y=yOf(p.v);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
      ctx.stroke();ctx.setLineDash([]);
    }
    strokeSeries(expected,"#9bb5ab",true);
    if(hasHistory){
      strokeSeries(actual,"#168568",false);
      const last=actual[actual.length-1];
      ctx.fillStyle="#168568";
      ctx.beginPath();ctx.arc(xOf(last.t),yOf(last.v),4,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle="#073b30";ctx.font="11px Inter,system-ui,sans-serif";ctx.textAlign="left";
    ctx.fillText("Target "+money(goal.target),padL,14);
  }
  function renderChart(){
    const select=document.getElementById("chartGoalSelect");
    if(select){
      const previous=select.value;
      clear(select);
      if(!state.goals.length){
        const opt=document.createElement("option");opt.value="";opt.textContent="No goals yet";select.appendChild(opt);
      }else{
        state.goals.forEach(goal=>{
          const opt=document.createElement("option");
          opt.value=goal.id;
          opt.textContent=goal.name+(goal.completed?" (completed)":"");
          select.appendChild(opt);
        });
        if([...select.options].some(o=>o.value===previous))select.value=previous;
        else select.value=state.goals[0].id;
      }
    }
    document.querySelectorAll("[data-action='chart-scale']").forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.scale===chartScale);
    });
    const goalId=select?.value;
    const goal=state.goals.find(g=>g.id===goalId)||state.goals[0]||null;
    drawInvestChart(goal);
  }
  function renderDashboard(){setText("heroPoints",state.points.toLocaleString("en-IN"));setText("heroCoins",state.gameCoins.toLocaleString("en-IN"));setText("heroRedeemable",redeemableRupees(state.gameCoins));const sub=state.subscription;setText("heroPremium",isPremium()?sub.status==="trial"?"Trial active":"Premium active":"Free plan");renderActivity("dashboardActivity");renderChart();}
  function renderGame(){const t=state.tycoon,needed=xpForLevel(t.level),built=BUILDINGS.filter(def=>t.buildings[def.id]>0).length;setText("empireLevel",t.level);setText("empireXp",t.xp.toLocaleString("en-IN")+" / "+needed.toLocaleString("en-IN")+" XP");setText("empireBuildings",built+" / "+BUILDINGS.length+" built");setText("gameCoins",state.gameCoins.toLocaleString("en-IN"));setText("gameRoundResult",t.lastGameResult);const bar=document.getElementById("empireXpBar");if(bar)bar.style.width=(t.xp/needed*100)+"%";const next=BUILDINGS.find(def=>def.unlock>t.level);setText("empireUnlock",next?"Next unlock: "+next.name+" · Level "+next.unlock:"All properties unlocked");const container=clear(document.getElementById("buildings"));BUILDINGS.forEach(def=>{const stage=t.buildings[def.id],unlocked=t.level>=def.unlock,card=element("article","building"+(unlocked?"":" locked"));card.append(element("h3","",def.icon+" "+def.name),element("p","",def.description));const dots=element("div","stage-dots");for(let index=0;index<5;index++)dots.appendChild(element("i",index<stage?"on":""));card.appendChild(dots);const label=!unlocked?"Unlock at Level "+def.unlock:stage===5?"Stage 5 · Complete":"Stage "+stage+" → "+(stage+1)+" · "+stageCost(def,stage)+" pts";const button=addButton(card,label,"buy-building",{buildingId:def.id},"btn small");button.disabled=!unlocked||stage===5||state.points<stageCost(def,stage);container?.appendChild(card);});const today=new Date().toISOString().slice(0,10),challenges=clear(document.getElementById("challenges"));CHALLENGES.forEach(challenge=>{const line=element("div","challenge"),text=document.createElement("div");text.append(element("b","",challenge.label),element("small","",challenge.points+" points · "+challenge.xp+" XP"));line.appendChild(text);const claimed=t.challenges[challenge.id]===today,button=addButton(line,claimed?"Claimed":"Claim","claim-challenge",{challengeId:challenge.id},"btn small");button.disabled=claimed;challenges?.appendChild(line);});renderActivity("gameActivity",row=>row.kind==="Game"||row.kind==="Empire"||row.kind==="Daily action");}
  function subscriptionDescription(){const s=state.subscription;if(isPremium()&&s.status==="trial")return "Trial active until "+new Date(s.trialEndsAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})+(s.cancelledAt?". Renewal is cancelled.":". ₹"+PREMIUM_MONTHLY_PRICE+"/month begins after the trial unless cancelled.");if(isPremium())return "Premium active. ₹"+PREMIUM_MONTHLY_PRICE+"/month subscription is simulated in this prototype.";return s.cancelledAt?"Subscription cancelled. Premium benefits have ended.":"Free plan: up to three active goals.";}
  function renderPremium(){setText("subscriptionState",subscriptionDescription());const button=document.getElementById("trialButton"),cancel=document.getElementById("cancelSubscriptionButton");if(button){button.disabled=isPremium();button.textContent=isPremium()?"Premium is active":"Start 7-day free trial";}if(cancel)cancel.disabled=!isPremium();}
  function renderAccount(){renderAvatar();setText("cashoutCoinBalance",state.gameCoins.toLocaleString("en-IN")+" coins available");setText("cashoutRedeemable",redeemableRupees(state.gameCoins));setText("conversionRedeemable",redeemableRupees(state.gameCoins));const p=state.profile;const username=document.getElementById("profileUsername"),photo=document.getElementById("profilePhoto");if(username&&document.activeElement!==username)username.value=p.username;if(photo&&document.activeElement!==photo)photo.value=p.photo;const banks=clear(document.getElementById("bankAccounts")),bankSelect=clear(document.getElementById("exchangeBank"));p.linkedAccounts.forEach(account=>{const row=element("div","bank"),info=document.createElement("div");info.append(element("b","",account.name),element("small","","•••• "+account.last4+" · linked"));row.append(info,element("span","status","Verified"));banks?.appendChild(row);const option=document.createElement("option");option.value=account.id;option.textContent=account.name+" · •••• "+account.last4;bankSelect?.appendChild(option);});const pending=p.pendingChange,panel=clear(document.getElementById("verificationPanel"));if(pending){const note=element("div","notice info");note.append(element("b","","Verification requested."),document.createTextNode(" Confirm after completing the "+pending.method+" verification with "+pending.contact+". This demo UI does not impersonate an identity service."));panel?.appendChild(note);const confirm=addButton(panel,"Confirm verified change (demo)","confirm-profile",{},"btn small");confirm.style.marginTop="9px";}else panel?.appendChild(element("p","help","Changes expire after 15 minutes if verification is not completed."));updateExchangeQuote();const history=clear(document.getElementById("exchangeHistory"));if(!state.exchangeRequests.length){history?.appendChild(element("div","empty","No cash-out requests yet."));}else state.exchangeRequests.slice(0,8).forEach(request=>{const row=element("div","activity-row"),left=document.createElement("div");left.append(element("b","",money(request.rupees)+" · "+request.status),element("small","",request.coins.toLocaleString("en-IN")+" coins · "+dateTime(request.createdAt)));row.append(left,element("span","status gold","Demo only"));history?.appendChild(row);});}
  function updateExchangeQuote(){const input=document.getElementById("exchangeCoins"),quote=document.getElementById("exchangeQuote");if(!input||!quote)return;const coins=Number(input.value);quote.textContent=Number.isSafeInteger(coins)&&coins>0&&coins%COINS_PER_RUPEE===0?coins.toLocaleString("en-IN")+" coins = "+money(coins/COINS_PER_RUPEE):"Enter a multiple of "+COINS_PER_RUPEE+" coins to see the value.";}
  function isInvestmentTx(row){return row.kind==="Monthly SIP"||row.kind==="Lump sum"||(typeof row.label==="string"&&row.label.startsWith("Investment · "));}
  function investmentGoalName(row){if(typeof row.label==="string"&&row.label.startsWith("Investment · ")) return row.label.slice("Investment · ".length).trim()||"Unknown goal";return "Unknown goal";}
  function getInvestmentHistory(){return state.transactions.filter(isInvestmentTx).sort((a,b)=>b.createdAt-a.createdAt);}
  function renderHistory(){
    const all=getInvestmentHistory();
    const goalFilter=document.getElementById("historyGoalFilter");
    const typeFilter=document.getElementById("historyTypeFilter");
    const selectedGoal=goalFilter?goalFilter.value:"";
    const selectedType=typeFilter?typeFilter.value:"";
    if(goalFilter){
      const previous=goalFilter.value;
      clear(goalFilter);
      const allOpt=document.createElement("option");allOpt.value="";allOpt.textContent="All goals";goalFilter.appendChild(allOpt);
      const names=[...new Set(all.map(investmentGoalName))].sort((a,b)=>a.localeCompare(b));
      names.forEach(name=>{const opt=document.createElement("option");opt.value=name;opt.textContent=name;goalFilter.appendChild(opt);});
      if([...goalFilter.options].some(o=>o.value===previous)) goalFilter.value=previous;
    }
    const filtered=all.filter(row=>{
      if(selectedGoal&&investmentGoalName(row)!==selectedGoal) return false;
      if(selectedType&&row.kind!==selectedType) return false;
      return true;
    });
    const totalAmount=filtered.reduce((sum,row)=>sum+Math.abs(row.amount),0);
    const sipCount=filtered.filter(r=>r.kind==="Monthly SIP").length;
    const lumpCount=filtered.filter(r=>r.kind==="Lump sum").length;
    const stats=clear(document.getElementById("historyStats"));
    [["Investments",filtered.length],["Total invested",money(totalAmount)],["Monthly SIP",sipCount],["Lump sum",lumpCount]].forEach(([label,value])=>{
      const card=element("div","card stat-card");
      card.append(element("small","",label),element("b","",String(value)));
      stats?.appendChild(card);
    });
    setText("historyCountStatus",filtered.length+" investment"+(filtered.length===1?"":"s")+(selectedGoal||selectedType?" (filtered)":""));
    const body=clear(document.getElementById("historyBody"));
    const empty=document.getElementById("historyEmpty");
    const table=document.getElementById("historyTable");
    if(!filtered.length){
      if(table) table.hidden=true;
      if(empty){empty.hidden=false;empty.textContent=all.length?"No investments match the current filters.":"No investments recorded yet. Confirm a contribution from the Dashboard to build your history.";}
      return;
    }
    if(table) table.hidden=false;
    if(empty) empty.hidden=true;
    filtered.forEach(row=>{
      const tr=document.createElement("tr");
      const dateTd=element("td","date-cell",dateTime(row.createdAt));
      const goalTd=element("td","goal-name",investmentGoalName(row));
      const typeTd=document.createElement("td");
      const badge=element("span","type-badge"+(row.kind==="Lump sum"?" lump":""),row.kind||"Investment");
      typeTd.appendChild(badge);
      const amountTd=element("td","num amount-cell",money(Math.abs(row.amount)));
      tr.append(dateTd,goalTd,typeTd,amountTd);
      body?.appendChild(tr);
    });
  }
  function render(){reconcile();if(typeof document==="undefined")return;renderDashboard();renderGoals();renderHistory();renderGame();renderPremium();renderAccount();renderAvatar();}
  function commit(result){if(result?.ok){saveState();render();toast(result.message);}else toast(result?.message||"That action could not be completed.");}
  function navigate(view){document.querySelectorAll(".page").forEach(page=>page.classList.toggle("active",page.id===view+"View"));document.querySelectorAll("[data-action='navigate']").forEach(button=>button.classList.toggle("active",button.dataset.view===view));if(typeof window!=="undefined")window.scrollTo({top:0,behavior:"smooth"});}
  function requestProfileVerification(form){const username=asText(form.username.value,"",40),method=form.method.value==="phone"?"phone":"email",contact=asText(form.contact.value,"",100),photo=safePhotoUrl(form.photo.value),password=form.password.value;const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,phone=/^\+?[0-9]{10,15}$/;if(!username)return {ok:false,message:"Enter a username."};if(form.photo.value&& !photo)return {ok:false,message:"Profile photos must use a valid https URL."};if(!(method==="email"?email.test(contact):phone.test(contact)))return {ok:false,message:"Enter a valid "+method+" contact."};if(password&&password.length<12)return {ok:false,message:"Use at least 12 characters for a new password."};state.profile.pendingChange={username,photo,contact,method,expiresAt:now()+15*60*1000};return {ok:true,message:"Verification requested. Password data was intentionally not saved."};}
  function confirmProfileChange(){const pending=state.profile.pendingChange;if(!pending||pending.expiresAt<=now())return {ok:false,message:"No valid verification request is waiting."};state.profile.username=pending.username;state.profile.photo=pending.photo;state.profile.verifiedContact=pending.contact;state.profile.pendingChange=null;return {ok:true,message:"Profile change verified in this demo. Use a real identity provider in production."};}
  if(typeof document!=="undefined"){
    document.addEventListener("click",event=>{
      const button=event.target.closest("[data-action]");
      if(!button)return;
      const action=button.dataset.action;
      if(action==="navigate")navigate(button.dataset.view);
      else if(action==="reset-demo")commit(resetDemo());
      else if(action==="select-invest")openInvestModal(button.dataset.goalId);
      else if(action==="close-invest-modal")closeInvestModal();
      else if(action==="edit-goal-sip")openEditSipModal(button.dataset.goalId);
      else if(action==="close-edit-sip")closeModal("editSipModal");
      else if(action==="chart-scale"){chartScale=button.dataset.scale||"days";renderChart();}
      else if(action==="buy-building")commit(buyStage(button.dataset.buildingId));
      else if(action==="play-round")commit(playRound());
      else if(action==="claim-challenge")commit(claimChallenge(button.dataset.challengeId));
      else if(action==="cancel-subscription")commit(cancelSubscription());
      else if(action==="confirm-profile")commit(confirmProfileChange());
    });
    document.addEventListener("click",event=>{
      ["investModal","editSipModal"].forEach(id=>{
        const modal=document.getElementById(id);
        if(modal&&!modal.hidden&&event.target===modal)closeModal(id);
      });
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"){
        closeInvestModal();
        closeModal("editSipModal");
      }
    });
    document.addEventListener("change",event=>{if(event.target.id==="exchangeCoins")updateExchangeQuote();if(event.target.id==="historyGoalFilter"||event.target.id==="historyTypeFilter")renderHistory();if(event.target.id==="chartGoalSelect")renderChart();});document.addEventListener("input",event=>{if(event.target.id==="exchangeCoins")updateExchangeQuote();});
    document.addEventListener("submit",event=>{
      const form=event.target;
      if(!(form instanceof HTMLFormElement))return;
      event.preventDefault();
      if(form.id==="investForm"){const result=invest(form.goal.value,form.amount.value,form.type.value);commit(result);if(result.ok)closeInvestModal();}
      else if(form.id==="goalForm"){const result=createGoal(form.name.value,form.target.value,form.description.value,form.months.value,form.deadline.value);if(result.ok)form.reset();commit(result);}
      else if(form.id==="editSipForm"){const result=editGoalSip(form.goalId.value,form.target.value,form.months.value,form.deadline.value);commit(result);if(result.ok)closeModal("editSipModal");}
      else if(form.id==="subscriptionForm")commit(startTrial(form.consent.checked));
      else if(form.id==="exchangeForm")commit(requestCashout(form.coins.value,form.bank.value));
      else if(form.id==="profileForm")commit(requestProfileVerification(form));
    });
    window.addEventListener("resize",()=>{if(document.getElementById("dashboardView")?.classList.contains("active"))renderChart();});
    window.addEventListener("storage",event=>{if(event.key===STORAGE_KEY){state=loadState();render();toast("GoalGrow updated from another tab.");}});render();
  }
  /* Pure hooks make the critical invariants testable without a browser UI. */
  globalThis.GoalGrowTestHooks={normaliseState,validateInvestment,xpForLevel,calculateCashout:coins=>calculateCashout(coins),getState:()=>clone(state),setState:value=>{state=normaliseState(value);},resetDemo:()=>resetDemo(),invest:(id,amount,type)=>invest(id,amount,type),createGoal:(name,target,description)=>createGoal(name,target,description),awardXp:(amount)=>awardXp(amount),buyStage:(id)=>buyStage(id),startTrial:(consent)=>startTrial(consent),cancelSubscription:()=>cancelSubscription(),COINS_PER_RUPEE,MIN_CASHOUT_COINS,MAX_EMPIRE_LEVEL};
