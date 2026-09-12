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
  const PLATFORM_FEE_RATE = 0.005;
  const DEFAULT_STATE = Object.freeze({
    schema:1, points:1250, gameCoins:0, walletBalance:0, walletHistory:[], lastGoalDeletedAt:null, lastQuizDate:"", goals:[
      {id:"home",name:"Dream Home",description:"Build a down-payment fund",target:500000,invested:200000,mode:"Monthly SIP",monthly:10000,completed:false,createdAt:Date.now()-120*86400000,deadlineAt:Date.now()+365*86400000,lastAmountEditAt:null},
      {id:"car",name:"New Car",description:"Plan the next car without rushing",target:300000,invested:120000,mode:"Monthly SIP",monthly:8000,completed:false,createdAt:Date.now()-90*86400000,deadlineAt:Date.now()+200*86400000,lastAmountEditAt:null},
      {id:"study",name:"Higher Studies",description:"Fund education with confidence",target:800000,invested:300000,mode:"Lump sum",monthly:0,completed:false,createdAt:Date.now()-60*86400000,deadlineAt:Date.now()+500*86400000,lastAmountEditAt:null}
    ], transactions:[], exchangeRequests:[],
    tycoon:{level:1,xp:0,buildings:{},challenges:{},gamesPlayed:0,lastGameResult:"No round played yet."},
    subscription:{status:"free",trialStartedAt:null,trialEndsAt:null,billingConsentAt:null,cancelledAt:null,lastWeeklyBonusWeek:""},
    profile:{username:"Rick",photo:"",verifiedContact:"",linkedAccounts:[{id:"acct-1",name:"GoalGrow Bank",last4:"4821",type:"netbanking"}],pendingChange:null}
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
    result.walletBalance=asInt(source.walletBalance,0,0,MAX_RUPEES);
    result.lastGoalDeletedAt=asInt(source.lastGoalDeletedAt,0,0,Number.MAX_SAFE_INTEGER)||null;
    result.lastQuizDate=asText(source.lastQuizDate,"",20);
    result.walletHistory=(Array.isArray(source.walletHistory)?source.walletHistory:[]).slice(0,100).map((h,index)=>({
      id:asText(h?.id,"wallet-"+index,100),
      type:asText(h?.type,"credit",40),
      label:asText(h?.label,"Wallet activity",120),
      goalName:asText(h?.goalName,"",60),
      gross:asInt(h?.gross,0,0,MAX_RUPEES),
      fee:asInt(h?.fee,0,0,MAX_RUPEES),
      net:asInt(h?.net,0,0,MAX_RUPEES),
      amount:asInt(h?.amount,0,-MAX_RUPEES,MAX_RUPEES),
      createdAt:asInt(h?.createdAt,now(),0,Number.MAX_SAFE_INTEGER)
    }));
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
    result.profile={username:asText(rawProfile.username,"Rick",40),photo:safePhotoUrl(rawProfile.photo),verifiedContact:asText(rawProfile.verifiedContact,"",100),linkedAccounts:(Array.isArray(rawProfile.linkedAccounts)?rawProfile.linkedAccounts:seed.profile.linkedAccounts).slice(0,10).map((a,index)=>{const t=a?.type==="upi"||a?.type==="card"?"upi":a?.type==="bitcoin"?"bitcoin":"netbanking";const rawId=asText(a?.last4||a?.identifier,"0000",80);const last4=(t==="bitcoin"||t==="upi")?rawId.slice(-8):rawId.replace(/\D/g,"").slice(-4).padStart(4,"0");return {id:asText(a?.id,"account-"+index,80),name:asText(a?.name,"Linked account",60),last4,type:t};}),pendingChange:null};
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
    const deadlineAt=parseDeadline(monthsValue,dateValue||"");
    if(!deadlineAt)return {ok:false,message:"Set a time period in months (1–600)."};
    const created=now();
    state.goals.push({id:makeId("goal"),name:cleanName,description:asText(description,"Financial goal",120),target:cleanTarget,invested:0,mode:"Monthly SIP",monthly:0,completed:false,completedAt:null,completionAwarded:false,createdAt:created,deadlineAt,lastAmountEditAt:null});
    const months=asInt(monthsValue,0,1,600);
    return {ok:true,message:"Goal created: "+cleanName+(months?" · "+months+" month"+(months===1?"":"s"):"")+"."};
  }
  function amountEditCooldownRemaining(goal){
    if(!goal?.lastAmountEditAt) return 0;
    return Math.max(0, goal.lastAmountEditAt+AMOUNT_EDIT_COOLDOWN_MS-now());
  }
  function deleteCooldownRemaining(){
    if(!state.lastGoalDeletedAt) return 0;
    return Math.max(0, state.lastGoalDeletedAt+DELETE_GOAL_COOLDOWN_MS-now());
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
    const deadlineAt=parseDeadline(monthsValue,dateValue||"");
    if(!deadlineAt) return {ok:false,message:"Set months (1–600)."};
    goal.deadlineAt=deadlineAt;
    const months=asInt(monthsValue,0,1,600);
    return {ok:true,message:"Time period for "+goal.name+" updated"+(months?" · "+months+" months":"")+"."};
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
    // Period: only update if months provided
    const hasMonths=asInt(monthsValue,0,0,600)>0;
    if(hasMonths){
      const deadlineAt=parseDeadline(monthsValue,"");
      if(!deadlineAt) return {ok:false,message:"Set months (1–600)."};
      if(deadlineAt!==goal.deadlineAt){
        goal.deadlineAt=deadlineAt;
        messages.push("period → "+asInt(monthsValue,0,1,600)+" months");
        changed=true;
      }
    }
    if(!changed) return {ok:false,message:"No changes to save. Update the target amount or set a new time period."};
    return {ok:true,message:"SIP updated for "+goal.name+": "+messages.join("; ")+"."};
  }
  function deleteGoal(goalId){
    const goal=state.goals.find(item=>item.id===String(goalId));
    if(!goal) return {ok:false,message:"Goal not found."};
    const remainingCd=deleteCooldownRemaining();
    if(remainingCd>0) return {ok:false,message:"After deleting a goal, other SIPs are locked for 30 days. Try again in "+formatCooldown(remainingCd)+"."};
    const invested=goal.invested;
    const goalName=goal.name;
    state.goals=state.goals.filter(item=>item.id!==goal.id);
    state.lastGoalDeletedAt=now();
    if(invested>0){
      const fee=Math.floor(invested*PLATFORM_FEE_RATE);
      const net=invested-fee;
      state.walletBalance=clamp(state.walletBalance+net,0,MAX_RUPEES);
      state.walletHistory.unshift({
        id:makeId("wallet"),
        type:"credit",
        label:"Goal liquidation · "+goalName,
        goalName,
        gross:invested,
        fee,
        net,
        amount:net,
        createdAt:now()
      });
      state.walletHistory=state.walletHistory.slice(0,100);
      addTransaction("Goal deleted · "+goalName+" · "+money(net)+" to wallet (0.5% fee)","Wallet",net);
      return {ok:true,message:"Deleted \""+goalName+"\". "+money(net)+" credited to wallet after 0.5% platform fee ("+money(fee)+"). Redeem from Profile & wallet."};
    }
    addTransaction("Goal deleted · "+goalName,"Goal edit",0);
    return {ok:true,message:"Deleted goal: "+goalName+"."};
  }
  function redeemWallet(amount,accountId){
    const clean=asInt(amount,0,1,MAX_RUPEES);
    if(clean<1) return {ok:false,message:"Enter a whole-rupee amount of at least ₹1."};
    if(clean>state.walletBalance) return {ok:false,message:"Wallet has only "+money(state.walletBalance)+" available."};
    const bank=state.profile.linkedAccounts.find(item=>item.id===String(accountId));
    if(!bank) return {ok:false,message:"Select a linked bank account."};
    state.walletBalance-=clean;
    state.walletHistory.unshift({
      id:makeId("wallet"),
      type:"debit",
      label:"Redeem to "+bank.name,
      goalName:"",
      gross:clean,
      fee:0,
      net:clean,
      amount:-clean,
      createdAt:now()
    });
    state.walletHistory=state.walletHistory.slice(0,100);
    state.exchangeRequests.unshift({id:makeId("wallet-out"),coins:0,rupees:clean,accountId:bank.id,status:"Pending demo",createdAt:now()});
    addTransaction("Wallet redeem · "+bank.name+" · "+money(clean),"Wallet",-clean);
    return {ok:true,message:"Redeem request for "+money(clean)+" to "+bank.name+" created (demo)."};
  }
  function accountTypeLabel(type){
    if(type==="upi") return "UPI";
    if(type==="bitcoin") return "Bitcoin Wallet";
    return "Net Banking";
  }
  function addLinkedAccount(type,name,identifier){
    const t=type==="upi"||type==="card"?"upi":type==="bitcoin"?"bitcoin":"netbanking";
    const cleanName=asText(name,"",60);
    const raw=asText(identifier,"",80);
    if(!cleanName) return {ok:false,message:"Enter an account name."};
    if(!raw||raw.length<4) return {ok:false,message:"Enter a valid identifier (at least 4 characters)."};
    if(state.profile.linkedAccounts.length>=10) return {ok:false,message:"You can link up to 10 accounts in this demo."};
    const last4=(t==="bitcoin"||t==="upi")?raw.slice(-8):raw.replace(/\D/g,"").slice(-4).padStart(4,"0");
    if(t==="netbanking"&&last4.replace(/0/g,"").length===0&&!/\d/.test(raw)) return {ok:false,message:"Enter a valid account number."};
    if(t==="upi"&&raw.length<5) return {ok:false,message:"Enter a valid UPI ID."};
    state.profile.linkedAccounts.push({id:makeId("acct"),name:cleanName,last4,type:t});
    addTransaction("Linked "+accountTypeLabel(t)+" · "+cleanName,"Account",0);
    return {ok:true,message:accountTypeLabel(t)+" linked: "+cleanName+" · •••• "+last4+"."};
  }
  function openAddAccountModal(){
    const typeStep=document.getElementById("addAccountTypeStep");
    const form=document.getElementById("addAccountForm");
    if(typeStep) typeStep.hidden=false;
    if(form){form.hidden=true;form.reset();}
    setText("addAccountMeta","Choose how you want to link a payout method.");
    openModal("addAccountModal");
  }
  function selectAccountType(type){
    const t=type==="upi"||type==="card"?"upi":type==="bitcoin"?"bitcoin":"netbanking";
    document.getElementById("addAccountType").value=t;
    document.getElementById("addAccountTypeStep").hidden=true;
    const form=document.getElementById("addAccountForm");
    form.hidden=false;
    const nameLabel=document.getElementById("addAccountNameLabel");
    const idLabel=document.getElementById("addAccountIdLabel");
    const nameInput=document.getElementById("addAccountName");
    const idInput=document.getElementById("addAccountIdentifier");
    const hint=document.getElementById("addAccountHint");
    if(t==="upi"){
      nameLabel.textContent="UPI label";
      idLabel.textContent="UPI ID";
      nameInput.placeholder="e.g. Personal UPI";
      idInput.placeholder="name@upi or mobile@upi";
      hint.textContent="Only a masked suffix is stored in this demo.";
    }else if(t==="bitcoin"){
      nameLabel.textContent="Wallet label";
      idLabel.textContent="Bitcoin address";
      nameInput.placeholder="e.g. Cold wallet";
      idInput.placeholder="bc1... or 1... address";
      hint.textContent="Only a short masked suffix is stored in this demo.";
    }else{
      nameLabel.textContent="Bank / account name";
      idLabel.textContent="Account number";
      nameInput.placeholder="e.g. HDFC Salary";
      idInput.placeholder="Account number";
      hint.textContent="Only the last 4 digits are stored in this demo.";
    }
    setText("addAccountMeta","Linking: "+accountTypeLabel(t));
    setTimeout(()=>nameInput?.focus(),50);
  }
  function stageCost(def,stage){return stage>=5?0:def.costs[stage];}
  function buyStage(id){const def=BUILDINGS.find(item=>item.id===id);if(!def)return {ok:false,message:"Unknown building."};const stage=state.tycoon.buildings[def.id];if(state.tycoon.level<def.unlock)return {ok:false,message:def.name+" unlocks at Empire Level "+def.unlock+"."};if(stage>=5)return {ok:false,message:def.name+" is already at Stage 5."};const cost=stageCost(def,stage);if(state.points<cost)return {ok:false,message:"You need "+(cost-state.points)+" more reward points."};state.points-=cost;state.tycoon.buildings[def.id]=stage+1;addTransaction((stage?"Upgrade · ":"Built · ")+def.name,"Empire",-cost);const levels=awardXp(stage?85:140);return {ok:true,message:def.name+" is now Stage "+(stage+1)+". +"+(stage?85:140)+" XP"+(levels?" · Empire Level "+state.tycoon.level+"!":".")};}
  function randomInt(max){if(globalThis.crypto?.getRandomValues){const values=new Uint32Array(1);globalThis.crypto.getRandomValues(values);return values[0]%max;}return Math.floor(Math.random()*max);}
  function playRound(){if(state.points<25)return {ok:false,message:"You need 25 reward points to play."};state.points-=25;const roll=randomInt(100),won=roll<12?150:roll<40?75:roll<72?30:0;if(won)state.points=clamp(state.points+won,0,MAX_POINTS);state.tycoon.gamesPlayed++;state.tycoon.lastGameResult=won?"You won "+won+" reward points!":"No reward points this round; your empire still keeps growing.";addTransaction("Reward round"+(won?" · +"+won+" reward points":""),"Game",won?won-25:-25);if(won)awardXp(20);return {ok:true,message:state.tycoon.lastGameResult};}
  function claimChallenge(id){const item=CHALLENGES.find(challenge=>challenge.id===id),today=new Date().toISOString().slice(0,10);if(!item)return {ok:false,message:"Unknown challenge."};if(state.tycoon.challenges[id]===today)return {ok:false,message:"That daily action is already claimed."};state.tycoon.challenges[id]=today;addPoints(item.points,item.label,"Daily action");const levels=awardXp(item.xp);return {ok:true,message:"+"+item.points+" points and +"+item.xp+" XP"+(levels?" · Level "+state.tycoon.level+"!":".")};}
  function calculateCashout(coins){const amount=asInt(coins,-1,MIN_CASHOUT_COINS,MAX_POINTS);if(amount<MIN_CASHOUT_COINS)return {ok:false,message:"Minimum cash-out is "+MIN_CASHOUT_COINS.toLocaleString("en-IN")+" reward points."};if(amount%COINS_PER_RUPEE!==0)return {ok:false,message:"Use a multiple of "+COINS_PER_RUPEE+" reward points."};if(amount>state.points)return {ok:false,message:"You only have "+state.points.toLocaleString("en-IN")+" reward points."};return {ok:true,coins:amount,rupees:amount/COINS_PER_RUPEE};}
  function requestCashout(coins,accountId){const verdict=calculateCashout(coins);if(!verdict.ok)return verdict;const bank=state.profile.linkedAccounts.find(item=>item.id===accountId);if(!bank)return {ok:false,message:"Select a linked bank account."};state.points-=verdict.coins;state.exchangeRequests.unshift({id:makeId("cashout"),coins:verdict.coins,rupees:verdict.rupees,accountId:bank.id,status:"Pending demo",createdAt:now()});addTransaction("Cash-out request · "+bank.name,"Exchange",-verdict.coins);return {ok:true,message:"Demo cash-out request for "+money(verdict.rupees)+" was created."};}
  function resetDemo(){
    try{storage.removeItem(STORAGE_KEY);}catch{}
    state=normaliseState(clone(DEFAULT_STATE));
    state.transactions=[];
    state.exchangeRequests=[];
    state.walletBalance=0;
    state.walletHistory=[];
    state.lastGoalDeletedAt=null;
    state.lastQuizDate="";
    state.tycoon={level:1,xp:0,buildings:{},challenges:{},gamesPlayed:0,lastGameResult:"No round played yet."};
    BUILDINGS.forEach(def=>{state.tycoon.buildings[def.id]=0;});
    CHALLENGES.forEach(def=>{state.tycoon.challenges[def.id]="";});
    state.subscription={status:"free",trialStartedAt:null,trialEndsAt:null,billingConsentAt:null,cancelledAt:null,lastWeeklyBonusWeek:""};
    state.points=DEFAULT_STATE.points;
    state.gameCoins=0;
    state.goals=clone(DEFAULT_STATE.goals);
    state.profile=clone(DEFAULT_STATE.profile);
    saveState();
    return {ok:true,message:"Demo fully reset. Goals, points, reward points, wallet, activity, history, empire, and subscription are restored to defaults."};
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
    const card=element("article","card goal-card"),head=element("div","row"),title=element("h3","",goal.name);
    const right=element("div","goal-head-right");
    const badge=element("span","status"+(goal.completed?" gold":""),goal.completed?"Completed":"Active");
    right.appendChild(badge);
    // 3-dot menu with Delete
    const menuWrap=element("div","goal-menu");
    const menuBtn=element("button","goal-menu-btn");
    menuBtn.type="button";
    menuBtn.setAttribute("aria-label","Goal options");
    menuBtn.setAttribute("aria-haspopup","true");
    menuBtn.setAttribute("aria-expanded","false");
    menuBtn.dataset.action="toggle-goal-menu";
    menuBtn.dataset.goalId=goal.id;
    menuBtn.innerHTML="⋯";
    const menu=element("div","goal-menu-dropdown");
    menu.hidden=true;
    const delCd=deleteCooldownRemaining();
    const delItem=element("button","goal-menu-item danger");
    delItem.type="button";
    delItem.dataset.action="delete-goal";
    delItem.dataset.goalId=goal.id;
    delItem.textContent=delCd>0?"Delete · "+formatCooldown(delCd):"Delete";
    if(delCd>0) delItem.disabled=true;
    menu.appendChild(delItem);
    menuWrap.append(menuBtn,menu);
    right.appendChild(menuWrap);
    head.append(title,right);
    const desc=element("p","",goal.description),amount=element("div","amount",money(goal.target));
    const meta=element("div","goal-meta");
    meta.append(element("span","",money(goal.invested)+" invested"),element("b","",Math.round(goal.invested/goal.target*100)+"%"));
    const progress=element("div","progress"),fill=document.createElement("i");
    fill.style.width=(goal.invested/goal.target*100)+"%";progress.appendChild(fill);
    const sub=element("div","goal-meta");
    sub.append(element("span","",goal.mode+(goal.mode==="Monthly SIP"&&goal.monthly?" · "+money(goal.monthly)+"/month":"")),element("span","",goal.completed?"Goal reached":money(remaining(goal))+" remaining"));
    card.append(head,desc,amount,meta,progress,sub);
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
  function closeAllGoalMenus(){
    document.querySelectorAll(".goal-menu-dropdown").forEach(menu=>{
      menu.hidden=true;
      const btn=menu.previousElementSibling;
      if(btn) btn.setAttribute("aria-expanded","false");
    });
  }
  function toggleGoalMenu(btn){
    const menu=btn.nextElementSibling;
    if(!menu) return;
    const isOpen=!menu.hidden;
    closeAllGoalMenus();
    if(!isOpen){
      menu.hidden=false;
      btn.setAttribute("aria-expanded","true");
    }
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
    const monthsInput=document.getElementById("editSipMonths");
    if(monthsInput) monthsInput.value="";
    setText("editSipMeta",goal.name+" · currently "+money(goal.target)+" · invested "+money(goal.invested));
    openModal("editSipModal");
    setTimeout(()=>amountInput?.focus(),50);
  }
  function renderActivity(target,filter){const root=clear(document.getElementById(target));const rows=state.transactions.filter(filter||(()=>true)).slice(0,6);if(!rows.length){root?.appendChild(element("div","empty","No activity recorded yet."));return;}rows.forEach(row=>{const item=element("div","activity-row"),left=document.createElement("div");left.append(element("b","",row.label),element("small","",row.kind+" · "+dateTime(row.createdAt)));const quantity=Math.abs(row.amount).toLocaleString("en-IN");const isInvest=isInvestmentTx(row);const shown=isInvest?money(Math.abs(row.amount)):quantity+(row.kind==="Exchange"?" reward points":" pts");const amount=element("b",row.amount<0?"negative":"positive",(row.amount<0?"−":"+")+shown);item.append(left,amount);root?.appendChild(item);});}
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
  function renderDashboard(){setText("heroPoints",state.points.toLocaleString("en-IN"));setText("heroRedeemable",redeemableRupees(state.points));const sub=state.subscription;setText("heroPremium",isPremium()?sub.status==="trial"?"Trial active":"Premium active":"Free plan");renderActivity("dashboardActivity");renderChart();}
  const QUIZ_BANK = [
    {q:"What does SIP stand for?", opts:["Systematic Investment Plan","Simple Interest Plan","Secure Income Portfolio","Scheduled Insurance Policy"], a:0},
    {q:"Diversification mainly helps you:", opts:["Guarantee higher returns","Reduce concentration risk","Avoid all market risk","Eliminate taxes"], a:1},
    {q:"Compounding works best when you:", opts:["Withdraw often","Start early and stay invested","Only invest lump sums","Avoid equity entirely"], a:1},
    {q:"An emergency fund is typically meant for:", opts:["Luxury upgrades","Unexpected essential expenses","Stock trading capital","Paying only rent"], a:1},
    {q:"Higher expected return usually comes with:", opts:["Lower risk","Higher risk","Zero volatility","Guaranteed principal"], a:1},
    {q:"A goal-based plan should start with:", opts:["Picking a random fund","Defining the goal and timeline","Checking social media tips","Maxing credit cards"], a:1},
    {q:"Inflation reduces:", opts:["The purchasing power of money","Your bank's name","The number of weekdays","Stamp duty only"], a:0},
    {q:"Asset allocation decides:", opts:["Only stock tickers","Mix of asset classes vs risk","Daily news headlines","ATM withdrawal limits"], a:1},
    {q:"A longer investment horizon generally allows:", opts:["No need to invest","More capacity to take market risk","Only cash holdings","Ignoring goals"], a:1},
    {q:"Tracking progress toward a goal helps you:", opts:["Ignore budgets","Stay accountable and adjust","Avoid saving","Guarantee returns"], a:1}
  ];
  let quizSession=null, birdGame=null, matchGame=null;

  function todayKey(){return new Date().toISOString().slice(0,10);}

  function showGamingMenu(){
    stopBirdGame();
    stopMatchGame();
    ["gamingMenu","quizPanel","birdPanel","matchPanel"].forEach(id=>{
      const el=document.getElementById(id);
      if(!el)return;
      if(id==="gamingMenu") el.hidden=false; else el.hidden=true;
    });
  }
  function showGamePanel(panelId){
    ["gamingMenu","quizPanel","birdPanel","matchPanel"].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.hidden = id!==panelId;
    });
  }

  function renderGame(){
    setText("gamingPointsBadge", state.points.toLocaleString("en-IN")+" Reward points");
    const today=todayKey();
    if(state.lastQuizDate===today){
      setText("quizStatus","Already completed today. Come back tomorrow.");
    }else{
      setText("quizStatus","Ready to play today · up to 125 Reward points.");
    }
  }

  function startQuiz(){
    if(state.lastQuizDate===todayKey()){
      toast("You already completed today's quiz.");
      return;
    }
    const shuffled=[...QUIZ_BANK].sort(()=>Math.random()-0.5).slice(0,5);
    quizSession={questions:shuffled, index:0, correct:0};
    showGamePanel("quizPanel");
    renderQuizQuestion();
  }
  function renderQuizQuestion(){
    if(!quizSession) return;
    const i=quizSession.index;
    if(i>=quizSession.questions.length){
      state.lastQuizDate=todayKey();
      const pts=quizSession.correct*25;
      if(pts>0){
        addPoints(pts,"Daily Quiz · "+quizSession.correct+"/5 correct","Game");
      }else{
        addTransaction("Daily Quiz · 0/5 correct","Game",0);
      }
      saveState();
      toast("Quiz done: "+quizSession.correct+"/5 correct · +"+pts+" Reward points.");
      quizSession=null;
      showGamingMenu();
      render();
      return;
    }
    const item=quizSession.questions[i];
    setText("quizIndex", String(i+1));
    setText("quizQuestion", item.q);
    setText("quizFeedback", "");
    const box=clear(document.getElementById("quizOptions"));
    item.opts.forEach((opt,idx)=>{
      const btn=element("button","btn outline quiz-opt",opt);
      btn.type="button";
      btn.dataset.action="quiz-answer";
      btn.dataset.index=String(idx);
      box?.appendChild(btn);
    });
  }
  function answerQuiz(idx){
    if(!quizSession) return;
    const item=quizSession.questions[quizSession.index];
    const correct=Number(idx)===item.a;
    if(correct){
      quizSession.correct++;
      setText("quizFeedback","Correct! +25 Reward points when you finish.");
    }else{
      setText("quizFeedback","Not quite. Correct: "+item.opts[item.a]);
    }
    document.querySelectorAll(".quiz-opt").forEach(b=>b.disabled=true);
    setTimeout(()=>{
      quizSession.index++;
      renderQuizQuestion();
    },700);
  }

  function startBirdGame(){
    if(state.points<50){toast("You need 50 Reward points to play Pointie Bird.");return;}
    if(birdGame&&birdGame.running){toast("A Pointie Bird run is already active.");return;}
    state.points-=50;
    addTransaction("Pointie Bird entry","Game",-50);
    saveState();
    setText("gamingPointsBadge", state.points.toLocaleString("en-IN")+" Reward points");
    showGamePanel("birdPanel");
    const canvas=document.getElementById("birdCanvas");
    if(!canvas) return;
    const ctx=canvas.getContext("2d");
    canvas.width=400;
    canvas.height=520;
    const W=canvas.width, H=canvas.height;
    const GROUND_H=80;
    const PLAY_H=H-GROUND_H;
    const GRAVITY=0.45;
    const FLAP=-7.2;
    const MAX_FALL=10;
    const PIPE_W=56;
    const PIPE_GAP=128;
    const PIPE_SPEED=2.4;
    const PIPE_EVERY=90;
    const SESSION_SECS=59;
    const PTS_PER_ORB=5;
    birdGame={
      running:true,
      started:false,
      sessionActive:true,
      score:0,
      coins:0,
      totalCredited:0,
      bird:{x:W*0.32, y:PLAY_H/2, vy:0, r:16},
      pipes:[],
      clouds:[],
      coinList:[],
      frame:0,
      groundX:0,
      timeLeft:SESSION_SECS,
      lastTick:0
    };
    for(let i=0;i<4;i++){
      birdGame.clouds.push({x:40+i*110, y:30+Math.random()*90, s:0.7+Math.random()*0.5});
    }
    function updateHud(){
      setText("birdTimer", String(Math.max(0, Math.ceil(birdGame.timeLeft))));
      setText("birdCoins", String(birdGame.coins));
      setText("birdRoundPts", String(birdGame.coins*PTS_PER_ORB));
    }
    updateHud();
    setText("birdHint","Tap to flap. Each gold orb = +5 reward points. Hit a pipe → points credited and you restart. Session: 59s.");
    function spawnPipe(){
      const margin=40;
      const top=margin+Math.random()*(PLAY_H-PIPE_GAP-margin*2);
      birdGame.pipes.push({x:W+10, top, gap:PIPE_GAP, w:PIPE_W, passed:false});
      birdGame.coinList.push({x:W+10+PIPE_W/2, y:top+PIPE_GAP/2, r:9, taken:false});
    }
    function creditRound(reason){
      if(!birdGame) return 0;
      const bonus=birdGame.coins*PTS_PER_ORB;
      if(bonus>0){
        addPoints(bonus,"Pointie Bird · "+birdGame.coins+" orbs","Game");
        birdGame.totalCredited+=bonus;
        saveState();
        setText("gamingPointsBadge", state.points.toLocaleString("en-IN")+" Reward points");
      }
      return bonus;
    }
    function resetRound(){
      if(!birdGame) return;
      birdGame.started=false;
      birdGame.score=0;
      birdGame.coins=0;
      birdGame.bird={x:W*0.32, y:PLAY_H/2, vy:0, r:16};
      birdGame.pipes=[];
      birdGame.coinList=[];
      birdGame.frame=0;
      birdGame.groundX=0;
      updateHud();
    }
    function endSession(msg){
      if(!birdGame||!birdGame.sessionActive) return;
      // credit any remaining uncredited orbs from current attempt
      const bonus=creditRound("session end");
      birdGame.sessionActive=false;
      birdGame.running=false;
      birdGame.started=false;
      const total=birdGame.totalCredited;
      setText("birdHint", msg+(total?" · +"+total+" Reward points credited this session.":" · No orbs collected.")+" Tap Back when ready.");
      setText("gamingPointsBadge", state.points.toLocaleString("en-IN")+" Reward points");
      updateHud();
    }
    function onCrash(msg){
      if(!birdGame||!birdGame.sessionActive||!birdGame.running) return;
      const bonus=creditRound(msg);
      if(birdGame.timeLeft<=0){
        endSession(msg+(bonus?" · +"+bonus+" pts.":".")+" Time's up!");
        return;
      }
      setText("birdHint", msg+(bonus?" · +"+bonus+" Reward points credited.":" · No orbs that round.")+" Tap to fly again ("+Math.ceil(birdGame.timeLeft)+"s left).");
      resetRound();
    }
    function flap(){
      if(!birdGame||!birdGame.sessionActive) return;
      if(!birdGame.running) return;
      if(!birdGame.started){
        birdGame.started=true;
        if(!birdGame.lastTick) birdGame.lastTick=performance.now();
        birdGame.bird.vy=FLAP;
        setText("birdHint","Collect gold orbs (+5 pts each). Hit a pipe → credit & restart.");
        return;
      }
      birdGame.bird.vy=FLAP;
    }
    canvas.onpointerdown=(e)=>{e.preventDefault();flap();};
    function hitPipe(b,p){
      const bx=b.x, by=b.y, r=b.r*0.85;
      if(bx+r>p.x&&bx-r<p.x+p.w){
        if(by-r<p.top||by+r>p.top+p.gap) return true;
      }
      return false;
    }
    function drawBackground(){
      const grd=ctx.createLinearGradient(0,0,0,PLAY_H);
      grd.addColorStop(0,"#4EC0CA");
      grd.addColorStop(1,"#DDEEF0");
      ctx.fillStyle=grd;
      ctx.fillRect(0,0,W,PLAY_H);
      ctx.fillStyle="rgba(255,255,255,0.85)";
      birdGame.clouds.forEach(c=>{
        const x=c.x, y=c.y, s=c.s;
        ctx.beginPath();
        ctx.ellipse(x,y,28*s,16*s,0,0,Math.PI*2);
        ctx.ellipse(x+18*s,y+4*s,22*s,14*s,0,0,Math.PI*2);
        ctx.ellipse(x-16*s,y+6*s,18*s,12*s,0,0,Math.PI*2);
        ctx.fill();
      });
    }
    function drawGround(){
      ctx.fillStyle="#DED895";
      ctx.fillRect(0,PLAY_H,W,GROUND_H);
      ctx.fillStyle="#73BF2E";
      ctx.fillRect(0,PLAY_H,W,14);
      ctx.fillStyle="#5CA023";
      const gx=((birdGame.groundX%24)+24)%24;
      for(let x=-24+gx;x<W;x+=24){
        ctx.fillRect(x,PLAY_H+2,12,8);
      }
      ctx.strokeStyle="#C2A84A";
      ctx.lineWidth=2;
      for(let y=PLAY_H+24;y<H;y+=12){
        ctx.beginPath();
        ctx.moveTo(0,y);
        ctx.lineTo(W,y);
        ctx.stroke();
      }
    }
    function drawPipe(p){
      const cap=18;
      ctx.fillStyle="#73BF2E";
      ctx.fillRect(p.x,0,p.w,p.top);
      ctx.fillRect(p.x-4,p.top-cap,p.w+8,cap);
      const by=p.top+p.gap;
      ctx.fillRect(p.x,by,p.w,PLAY_H-by);
      ctx.fillRect(p.x-4,by,p.w+8,cap);
      ctx.fillStyle="#9CE659";
      ctx.fillRect(p.x+6,0,8,p.top-cap);
      ctx.fillRect(p.x+6,by+cap,8,PLAY_H-by-cap);
      ctx.strokeStyle="#548C22";
      ctx.lineWidth=2;
      ctx.strokeRect(p.x,0,p.w,p.top);
      ctx.strokeRect(p.x-4,p.top-cap,p.w+8,cap);
      ctx.strokeRect(p.x,by,p.w,PLAY_H-by);
      ctx.strokeRect(p.x-4,by,p.w+8,cap);
    }
    function drawBird(b){
      const angle=Math.max(-0.6,Math.min(0.9,b.vy*0.07));
      ctx.save();
      ctx.translate(b.x,b.y);
      ctx.rotate(angle);
      ctx.fillStyle="#F8C41C";
      ctx.beginPath();
      ctx.ellipse(0,0,b.r+2,b.r,0,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle="#F2A40A";
      ctx.beginPath();
      ctx.ellipse(-4,2,10,7, -0.3,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle="#FFF3C4";
      ctx.beginPath();
      ctx.ellipse(2,5,9,7,0,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle="#fff";
      ctx.beginPath();
      ctx.arc(8,-4,5,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle="#222";
      ctx.beginPath();
      ctx.arc(9,-4,2.2,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle="#F26C0A";
      ctx.beginPath();
      ctx.moveTo(12,0);
      ctx.lineTo(22,3);
      ctx.lineTo(12,6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    function drawHudOverlay(){
      const t=Math.max(0, Math.ceil(birdGame.timeLeft));
      ctx.fillStyle="rgba(0,0,0,0.35)";
      ctx.fillRect(10,10,78,36);
      ctx.fillStyle=t<=10?"#ffb4b0":"#fff";
      ctx.font="bold 22px system-ui,sans-serif";
      ctx.textAlign="left";
      ctx.textBaseline="middle";
      ctx.fillText(t+"s", 22, 28);
      ctx.fillStyle="rgba(0,0,0,0.35)";
      ctx.fillRect(W-150,10,140,36);
      ctx.fillStyle="#f4c857";
      ctx.beginPath();ctx.arc(W-130,28,8,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";
      ctx.font="bold 16px system-ui,sans-serif";
      ctx.textAlign="left";
      ctx.fillText(birdGame.coins+" · +"+(birdGame.coins*PTS_PER_ORB)+" pts", W-116, 28);
    }
    function loop(now){
      if(!birdGame||!birdGame.running) return;
      const g=birdGame, b=g.bird;
      g.frame++;
      // session timer ticks once the first flap has happened
      if(g.sessionActive && g.lastTick){
        const dt=(now-(g.lastTick||now))/1000;
        g.lastTick=now;
        if(g.started || g.timeLeft<SESSION_SECS){
          g.timeLeft=Math.max(0, g.timeLeft-dt);
          if(g.frame%15===0) updateHud();
          if(g.timeLeft<=0){
            endSession("Time's up!");
            // still draw final frame below
          }
        }
      }
      if(g.sessionActive && g.started && g.timeLeft>0){
        g.groundX-=PIPE_SPEED;
        b.vy=Math.min(MAX_FALL, b.vy+GRAVITY);
        b.y+=b.vy;
        if(b.y-b.r<0){b.y=b.r;b.vy=0;}
        if(b.y+b.r>PLAY_H){onCrash("Hit the ground!");}
        else{
          if(g.frame%PIPE_EVERY===0) spawnPipe();
          g.pipes.forEach(p=>p.x-=PIPE_SPEED);
          g.coinList.forEach(c=>c.x-=PIPE_SPEED);
          g.clouds.forEach(c=>{c.x-=0.6; if(c.x<-50) c.x=W+40;});
          g.pipes=g.pipes.filter(p=>p.x+p.w>-10);
          g.coinList=g.coinList.filter(c=>c.x+c.r>0&&!c.taken);
          let crashed=false;
          for(const p of g.pipes){
            if(hitPipe(b,p)){onCrash("Hit a pipe!");crashed=true;break;}
            if(!p.passed&&p.x+p.w<b.x){
              p.passed=true;
              g.score++;
            }
          }
          if(!crashed){
            for(const c of g.coinList){
              if(c.taken) continue;
              const dx=b.x-c.x, dy=b.y-c.y;
              if(dx*dx+dy*dy<(b.r+c.r)*(b.r+c.r)){
                c.taken=true;
                g.coins++;
                updateHud();
              }
            }
          }
        }
      }else if(g.sessionActive && !g.started){
        b.y=PLAY_H/2+Math.sin(g.frame/12)*8;
        g.clouds.forEach(c=>{c.x-=0.3; if(c.x<-50) c.x=W+40;});
      }
      // draw
      drawBackground();
      if(g.pipes) g.pipes.forEach(drawPipe);
      if(g.coinList) g.coinList.forEach(c=>{
        if(c.taken) return;
        ctx.fillStyle="#f4c857";
        ctx.beginPath();ctx.arc(c.x,c.y,c.r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#fff3";
        ctx.beginPath();ctx.arc(c.x-2,c.y-2,3,0,Math.PI*2);ctx.fill();
      });
      drawBird(b);
      drawGround();
      drawHudOverlay();
      if(g.sessionActive && !g.started){
        ctx.fillStyle="rgba(0,0,0,0.35)";
        ctx.fillRect(W/2-100,PLAY_H/2-28,200,56);
        ctx.fillStyle="#fff";
        ctx.font="bold 18px system-ui,sans-serif";
        ctx.textAlign="center";
        ctx.textBaseline="middle";
        ctx.fillText(g.timeLeft<SESSION_SECS?"Tap to fly again":"Tap to start", W/2, PLAY_H/2);
      }
      if(g.running) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  function stopBirdGame(){
    if(birdGame){
      // if leaving mid-session with uncredited orbs, credit them
      if(birdGame.sessionActive && birdGame.coins>0){
        const bonus=birdGame.coins*5;
        addPoints(bonus,"Pointie Bird · "+birdGame.coins+" orbs","Game");
        saveState();
      }
      birdGame.running=false;
      birdGame.sessionActive=false;
      birdGame=null;
    }
  }

  function startMatchGame(){
    if(state.points<100){toast("You need 100 Reward points to play Match-it-UP.");return;}
    if(matchGame&&!matchGame.over){toast("A Match-it-UP game is already active.");return;}
    stopMatchGame();
    state.points-=100;
    addTransaction("Match-it-UP entry","Game",-100);
    saveState();
    setText("gamingPointsBadge", state.points.toLocaleString("en-IN")+" Reward points");
    showGamePanel("matchPanel");
    const symbols=["🏠","🚗","📚","💰","📈","🏦","🪙","🎯"];
    const deck=[...symbols,...symbols].sort(()=>Math.random()-0.5);
    matchGame={
      deck, flipped:[], matched:new Set(), lock:false,
      pairs:0, time:30, timerId:null, over:false
    };
    setText("matchTimer","30");
    setText("matchCount","0");
    setText("matchStatus","Find all 8 pairs within 30 seconds.");
    const grid=clear(document.getElementById("matchGrid"));
    deck.forEach((sym,i)=>{
      const card=element("button","match-card");
      card.type="button";
      card.dataset.index=String(i);
      card.dataset.action="match-flip";
      card.innerHTML='<span class="match-back">?</span><span class="match-face" hidden>'+sym+"</span>";
      grid?.appendChild(card);
    });
    matchGame.timerId=setInterval(()=>{
      if(!matchGame||matchGame.over) return;
      matchGame.time--;
      setText("matchTimer",String(matchGame.time));
      if(matchGame.time<=0){
        endMatch(false);
      }
    },1000);
  }
  function flipMatchCard(index){
    if(!matchGame||matchGame.over||matchGame.lock) return;
    index=Number(index);
    if(matchGame.matched.has(index)||matchGame.flipped.includes(index)) return;
    const cards=document.querySelectorAll(".match-card");
    const card=cards[index];
    if(!card) return;
    card.querySelector(".match-back").hidden=true;
    card.querySelector(".match-face").hidden=false;
    card.classList.add("open");
    matchGame.flipped.push(index);
    if(matchGame.flipped.length<2) return;
    matchGame.lock=true;
    const [a,b]=matchGame.flipped;
    if(matchGame.deck[a]===matchGame.deck[b]){
      matchGame.matched.add(a);matchGame.matched.add(b);
      matchGame.pairs++;
      setText("matchCount",String(matchGame.pairs));
      matchGame.flipped=[];
      matchGame.lock=false;
      if(matchGame.pairs===8) endMatch(true);
    }else{
      setTimeout(()=>{
        [a,b].forEach(i=>{
          const c=cards[i];
          if(!c||matchGame.matched.has(i)) return;
          c.querySelector(".match-back").hidden=false;
          c.querySelector(".match-face").hidden=true;
          c.classList.remove("open");
        });
        matchGame.flipped=[];
        matchGame.lock=false;
      },550);
    }
  }
  function endMatch(won){
    if(!matchGame||matchGame.over) return;
    matchGame.over=true;
    if(matchGame.timerId) clearInterval(matchGame.timerId);
    if(won){
      addPoints(200,"Match-it-UP win","Game");
      saveState();
      setText("matchStatus","Perfect! All pairs matched. +200 Reward points.");
      toast("Match-it-UP cleared! +200 Reward points.");
    }else{
      setText("matchStatus","Time's up! You matched "+matchGame.pairs+"/8 pairs.");
      toast("Time's up — "+matchGame.pairs+"/8 pairs.");
    }
    render();
  }
  function stopMatchGame(){
    if(matchGame?.timerId) clearInterval(matchGame.timerId);
    matchGame=null;
  }


  function subscriptionDescription(){
    const sub=state.subscription;
    if(sub.status==="trial"&&sub.trialEndsAt){
      const left=Math.max(0,sub.trialEndsAt-now());
      const days=Math.ceil(left/86400000);
      return "Premium trial active · about "+days+" day"+(days===1?"":"s")+" left"+(sub.cancelledAt?" · renewal cancelled":"")+".";
    }
    if(sub.status==="active") return sub.cancelledAt?"Premium active · renewal cancelled.":"Premium active · ₹"+PREMIUM_MONTHLY_PRICE+"/month (demo).";
    return "Free plan · up to "+FREE_ACTIVE_GOAL_LIMIT+" active goals.";
  }
  function renderPremium(){setText("subscriptionState",subscriptionDescription());const button=document.getElementById("trialButton"),cancel=document.getElementById("cancelSubscriptionButton");if(button){button.disabled=isPremium();button.textContent=isPremium()?"Premium is active":"Start 7-day free trial";}if(cancel)cancel.disabled=!isPremium();}
  function renderAccount(){
    renderAvatar();
    setText("cashoutCoinBalance",state.points.toLocaleString("en-IN")+" reward points available");
    setText("cashoutRedeemable",redeemableRupees(state.points));
    setText("conversionRedeemable",redeemableRupees(state.points));
    setText("walletBalance",money(state.walletBalance));
    const amountInput=document.getElementById("walletRedeemAmount");
    if(amountInput){
      amountInput.max=String(Math.max(1,state.walletBalance));
      setText("walletRedeemHint",state.walletBalance>0?"Up to "+money(state.walletBalance)+" available after platform fees already deducted.":"Wallet is empty. Delete a goal with invested funds to receive a credit here.");
    }
    const p=state.profile;
    const username=document.getElementById("profileUsername"),photo=document.getElementById("profilePhoto");
    if(username&&document.activeElement!==username)username.value=p.username;
    if(photo&&document.activeElement!==photo)photo.value=p.photo;
    const banks=clear(document.getElementById("bankAccounts"));
    const bankSelect=clear(document.getElementById("exchangeBank"));
    const walletBank=clear(document.getElementById("walletRedeemBank"));
    p.linkedAccounts.forEach(account=>{
      const row=element("div","bank"),info=document.createElement("div");
      const typeLabel=accountTypeLabel(account.type||"netbanking");
      info.append(element("b","",account.name),element("small","","•••• "+account.last4+" · "+typeLabel));
      row.append(info,element("span","status","Verified"));
      banks?.appendChild(row);
      const option=document.createElement("option");
      option.value=account.id;
      option.textContent=account.name+" · •••• "+account.last4;
      bankSelect?.appendChild(option);
      const option2=option.cloneNode(true);
      walletBank?.appendChild(option2);
    });
    const pending=p.pendingChange,panel=clear(document.getElementById("verificationPanel"));
    if(pending){
      const note=element("div","notice info");
      note.append(element("b","","Verification requested."),document.createTextNode(" Confirm after completing the "+pending.method+" verification with "+pending.contact+". This demo UI does not impersonate an identity service."));
      panel?.appendChild(note);
      const confirm=addButton(panel,"Confirm verified change (demo)","confirm-profile",{},"btn small");
      confirm.style.marginTop="9px";
    }else panel?.appendChild(element("p","help","Changes expire after 15 minutes if verification is not completed."));
    updateExchangeQuote();
    const history=clear(document.getElementById("exchangeHistory"));
    if(!state.exchangeRequests.length){
      history?.appendChild(element("div","empty","No cash-out requests yet."));
    }else state.exchangeRequests.slice(0,8).forEach(request=>{
      const row=element("div","activity-row"),left=document.createElement("div");
      left.append(element("b","",money(request.rupees)+" · "+request.status),element("small","",(request.coins?request.coins.toLocaleString("en-IN")+" reward points · ":"")+dateTime(request.createdAt)));
      row.append(left,element("span","status gold","Demo only"));
      history?.appendChild(row);
    });
    const walletHist=clear(document.getElementById("walletHistory"));
    if(!state.walletHistory.length){
      walletHist?.appendChild(element("div","empty","No wallet activity yet. Deleting a goal with invested money will appear here."));
    }else state.walletHistory.slice(0,12).forEach(entry=>{
      const row=element("div","activity-row"),left=document.createElement("div");
      let detail="";
      if(entry.type==="credit"&&entry.gross){
        detail="Gross "+money(entry.gross)+" · Fee "+money(entry.fee)+" · Net "+money(entry.net);
      }else{
        detail=entry.label;
      }
      left.append(element("b","",entry.label),element("small","",detail+" · "+dateTime(entry.createdAt)));
      const amt=element("b",entry.amount<0?"negative":"positive",(entry.amount<0?"−":"+")+money(Math.abs(entry.amount)));
      row.append(left,amt);
      walletHist?.appendChild(row);
    });
  }

  function updateExchangeQuote(){const input=document.getElementById("exchangeCoins"),quote=document.getElementById("exchangeQuote");if(!input||!quote)return;const coins=Number(input.value);quote.textContent=Number.isSafeInteger(coins)&&coins>0&&coins%COINS_PER_RUPEE===0?coins.toLocaleString("en-IN")+" reward points = "+money(coins/COINS_PER_RUPEE):"Enter a multiple of "+COINS_PER_RUPEE+" reward points to see the value.";}
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
      else if(action==="open-add-account")openAddAccountModal();
      else if(action==="close-add-account")closeModal("addAccountModal");
      else if(action==="select-account-type")selectAccountType(button.dataset.type);
      else if(action==="back-account-type"){
        document.getElementById("addAccountForm").hidden=true;
        document.getElementById("addAccountTypeStep").hidden=false;
        setText("addAccountMeta","Choose how you want to link a payout method.");
      }
      else if(action==="toggle-goal-menu"){event.stopPropagation();toggleGoalMenu(button);}
      else if(action==="delete-goal"){
        closeAllGoalMenus();
        const goal=state.goals.find(item=>item.id===button.dataset.goalId);
        if(!goal)return;
        const remainingCd=deleteCooldownRemaining();
        if(remainingCd>0){toast("After deleting a goal, other SIPs are locked for 30 days. Try again in "+formatCooldown(remainingCd)+".");return;}
        const feeNote=goal.invested>0?" Invested "+money(goal.invested)+" will move to your wallet after a 0.5% platform fee.":"";
        const lockNote=" Remaining SIPs will be locked from deletion for 30 days.";
        if(confirm("Delete goal \""+goal.name+"\"?"+feeNote+lockNote+" This cannot be undone in this demo."))commit(deleteGoal(goal.id));
      }
      else if(action==="chart-scale"){chartScale=button.dataset.scale||"days";renderChart();}
      else if(action==="start-quiz")startQuiz();
      else if(action==="start-bird")startBirdGame();
      else if(action==="start-match")startMatchGame();
      else if(action==="exit-game"){showGamingMenu();renderGame();}
      else if(action==="quiz-answer")answerQuiz(button.dataset.index);
      else if(action==="match-flip")flipMatchCard(button.dataset.index);
      else if(action==="cancel-subscription")commit(cancelSubscription());
      else if(action==="confirm-profile")commit(confirmProfileChange());
    });
    document.addEventListener("click",event=>{
      // Close goal menus when clicking outside
      if(!event.target.closest(".goal-menu")) closeAllGoalMenus();
      ["investModal","editSipModal","addAccountModal"].forEach(id=>{
        const modal=document.getElementById(id);
        if(modal&&!modal.hidden&&event.target===modal)closeModal(id);
      });
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"){
        closeAllGoalMenus();
        closeInvestModal();
        closeModal("editSipModal");
        closeModal("addAccountModal");
      }
    });
    document.addEventListener("change",event=>{if(event.target.id==="exchangeCoins")updateExchangeQuote();if(event.target.id==="historyGoalFilter"||event.target.id==="historyTypeFilter")renderHistory();if(event.target.id==="chartGoalSelect")renderChart();});document.addEventListener("input",event=>{if(event.target.id==="exchangeCoins")updateExchangeQuote();});
    document.addEventListener("submit",event=>{
      const form=event.target;
      if(!(form instanceof HTMLFormElement))return;
      event.preventDefault();
      if(form.id==="investForm"){const result=invest(form.goal.value,form.amount.value,form.type.value);commit(result);if(result.ok)closeInvestModal();}
      else if(form.id==="goalForm"){const result=createGoal(form.name.value,form.target.value,form.description.value,form.months.value,"");if(result.ok)form.reset();commit(result);}
      else if(form.id==="editSipForm"){const result=editGoalSip(form.goalId.value,form.target.value,form.months.value,"");commit(result);if(result.ok)closeModal("editSipModal");}
      else if(form.id==="subscriptionForm")commit(startTrial(form.consent.checked));
      else if(form.id==="exchangeForm")commit(requestCashout(form.coins.value,form.bank.value));
      else if(form.id==="walletRedeemForm"){const result=redeemWallet(form.amount.value,form.bank.value);commit(result);if(result.ok)form.reset();}
      else if(form.id==="addAccountForm"){const result=addLinkedAccount(form.type.value,form.name.value,form.identifier.value);commit(result);if(result.ok)closeModal("addAccountModal");}
      else if(form.id==="profileForm")commit(requestProfileVerification(form));
    });
    window.addEventListener("resize",()=>{if(document.getElementById("dashboardView")?.classList.contains("active"))renderChart();});
    window.addEventListener("storage",event=>{if(event.key===STORAGE_KEY){state=loadState();render();toast("GoalGrow updated from another tab.");}});render();
  }
  /* Pure hooks make the critical invariants testable without a browser UI. */
  globalThis.GoalGrowTestHooks={normaliseState,validateInvestment,xpForLevel,calculateCashout:coins=>calculateCashout(coins),getState:()=>clone(state),setState:value=>{state=normaliseState(value);},resetDemo:()=>resetDemo(),invest:(id,amount,type)=>invest(id,amount,type),createGoal:(name,target,description)=>createGoal(name,target,description),awardXp:(amount)=>awardXp(amount),buyStage:(id)=>buyStage(id),startTrial:(consent)=>startTrial(consent),cancelSubscription:()=>cancelSubscription(),COINS_PER_RUPEE,MIN_CASHOUT_COINS,MAX_EMPIRE_LEVEL};
