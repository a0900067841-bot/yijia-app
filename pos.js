import{K,load,save,money}from'./db.js';
import{audit,currentUser}from'./core.js';

export const state={cart:[],payment:'現金',discount:0,category:'全部',paymentDetail:null,note:'',selected:'',member:null,correctionMode:null,exchangeMode:null,lastCompletedSale:null,wasteMode:false,wasteBackup:null,gamePrizeApplications:[],transactionId:'',taxId:''};
export const products=()=>load(K.products,[]).filter(x=>x.active!==false&&x.tmHidden!==true);

export function makeReturnCode(saleId){
 const raw=String(saleId||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
 return `RT${raw}`;
}

export function findSaleByReturnCode(code){
 const q=String(code||'').trim().toUpperCase();
 return load(K.sales,[]).find(s=>String(s.returnCode||makeReturnCode(s.id)).toUpperCase()===q)||null;
}

export function beginCorrectionMode(sale){
 if(!sale)throw Error('找不到原交易');
 if(['已整筆退貨','已作廢'].includes(sale.status))throw Error('此交易已退貨或作廢，無法再次更正');

 sale.items=(sale.items||[]).map((item,i)=>({
  ...item,
  lineId:item.lineId||`${sale.id}-L${i+1}`
 }));

 const selections=sale.items.map(item=>{
  const alreadyReturned=Number(item.returnedQty||0);
  const availableQty=Math.max(0,Number(item.qty||0)-alreadyReturned);
  return {
   lineId:item.lineId,
   productId:item.id||item.productId,
   name:item.name,
   originalQty:Number(item.qty||0),
   alreadyReturned,
   availableQty,
   price:Number(item.price||0),
   barcode:item.barcode||''
  };
 });

 state.correctionMode={
  saleId:sale.id,
  returnCode:sale.returnCode||makeReturnCode(sale.id),
  startedAt:new Date().toISOString(),
  selections
 };

 // 將原交易尚未退貨的商品載回購物車，使用原交易售價。
 state.cart=sale.items.map(item=>{
  const available=Math.max(0,Number(item.qty||0)-Number(item.returnedQty||0));
  return {
   ...structuredClone(item),
   id:item.id||item.productId,
   productId:item.id||item.productId,
   lineId:item.lineId,
   qty:available,
   correctionOriginalQty:available,
   correctionSource:true
  };
 }).filter(x=>Number(x.qty||0)>0);

 state.discount=0;
 state.paymentDetail=null;
 state.note=`更正原交易 ${sale.id}`;
 state.selected='';
 return state.correctionMode;
}


export function beginExchangeMode(sale){
 beginCorrectionMode(sale);
 state.exchangeMode={
  saleId:sale.id,
  originals:(state.correctionMode?.selections||[]).map(x=>({...x}))
 };
 state.note=`換貨原交易 ${sale.id}`;
 return state.exchangeMode;
}
export function endExchangeMode(){
 state.exchangeMode=null;
 endCorrectionMode();
}
export function exchangeAmounts(){
 if(!state.exchangeMode)return {returnAmount:0,newAmount:0,difference:0};
 let returnAmount=0;
 for(const o of state.exchangeMode.originals||[]){
  const current=state.cart.find(x=>x.correctionSource&&x.lineId===o.lineId);
  const kept=current?Number(current.qty||0):0;
  returnAmount+=Math.max(0,Number(o.availableQty||0)-kept)*Number(o.price||0);
 }
 const newAmount=state.cart.filter(x=>!x.correctionSource).reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);
 return {returnAmount,newAmount,difference:newAmount-returnAmount};
}

export function endCorrectionMode(){
 state.correctionMode=null;
 state.cart=[];
 state.discount=0;
 state.gamePrizeApplications=[];
 state.paymentDetail=null;
 state.note='';
 state.selected='';
 state.transactionId='';
 state.taxId='';
}


const barcodes=p=>[...new Set((Array.isArray(p.barcodes)?p.barcodes:[p.barcode]).map(x=>String(x||'').trim()).filter(Boolean))];
const freshBatches=()=>load(K.freshBatches,[]);

function freshStatus(batch,now=new Date()){
 if(batch.status==='已廢棄')return '已廢棄';
 if(Number(batch.remainingQty||0)<=0)return '已售完';
 const expiry=new Date(batch.expiryAt);
 if(Number.isNaN(expiry.getTime()))return '資料異常';
 if(now>=expiry)return '已過期';
 return '正常';
}

function availableFreshBatches(productId){
 return freshBatches()
  .filter(b=>b.productId===productId&&freshStatus(b)==='正常'&&Number(b.remainingQty||0)>0)
  .sort((a,b)=>new Date(a.expiryAt)-new Date(b.expiryAt));
}

function freshContext(product){
 if(product.category!=='鮮食')return {allowed:true,price:Number(product.price||0),discounted:false,batch:null};
 const batches=availableFreshBatches(product.id);
 if(!batches.length)return {allowed:false,reason:'無法販售：沒有有效的鮮食批次'};
 const batch=batches[0],expiry=new Date(batch.expiryAt),now=new Date();
 if(now>=expiry)return {allowed:false,reason:'無法販售',batch};
 const remainingHours=(expiry-now)/3600000;
 const discountHours=Number(product.discountBeforeHours??7);
 const discounted=remainingHours<=discountHours;
 return {
  allowed:true,batch,discounted,remainingHours,
  originalPrice:Number(product.price||0),
  price:discounted?Math.round(Number(product.price||0)*0.5):Number(product.price||0)
 };
}

function freshCartQuantity(productId,batchId){
 return state.cart
  .filter(x=>x.id===productId&&x.freshBatchId===batchId)
  .reduce((s,x)=>s+Number(x.qty||0),0);
}

export function add(id,source='browse'){
 if(!state.transactionId)state.transactionId='T'+Date.now();
 const p=products().find(x=>x.id===id);
 if(!p)return;
 const selfSource=String(source||'').startsWith('self');
 const sourceType=String(source||'').replace(/^self-?/,'');
 if(p.category==='鮮食'&&sourceType==='code'){
  audit('鮮食商品代號攔截',`${p.code||''}｜${p.name}`);
  throw Error('鮮食商品無法使用商品代號結帳，請掃描商品條碼。');
 }

 const ctx=freshContext(p);
 if(!ctx.allowed){
  audit('過期鮮食攔截',`${p.name}｜${ctx.batch?.barcode||barcodes(p)[0]||''}`);
  throw Error(ctx.reason||'無法販售');
 }

 const batchId=ctx.batch?.id||'';
 const c=state.cart.find(x=>x.id===id&&(p.category!=='鮮食'||x.freshBatchId===batchId));
 const stockLimit=p.category==='鮮食'?Number(ctx.batch.remainingQty||0):Number(p.stock||0);
 const currentQty=p.category==='鮮食'
   ?freshCartQuantity(p.id,batchId)
   :state.cart.filter(x=>x.id===id).reduce((sum,x)=>sum+Number(x.qty||0),0);
 if(p.category==='鮮食'){
  if(currentQty>=stockLimit)throw Error('庫存不足');
 }else if(!p.allowNegativeStock&&currentQty>=stockLimit){
  throw Error('庫存不足');
 }

 if(c&&!selfSource)c.qty++;
 else{
  const item={...p,qty:1};
  if(selfSource)item.selfLineId=`SELF-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  if(p.category==='鮮食'){
   item.originalPrice=Number(p.price||0);
   item.price=ctx.price;
   item.freshBatchId=batchId;
   item.freshBatchNo=ctx.batch.batchNo;
   item.freshExpiryAt=ctx.batch.expiryAt;
   item.freshDiscounted=ctx.discounted;
   item.discountLabel=ctx.discounted?'鮮食效期 5 折':'';
   if(ctx.discounted)audit('鮮食自動5折',`${p.name}｜${ctx.batch.batchNo}｜${money(ctx.price)}`);
  }
  state.cart.push(item);
 }
}

export function qty(id,d){
 const c=state.cart.find(x=>x.id===id),p=products().find(x=>x.id===id);
 if(!c)return;
 const n=Number(c.qty||0)+Number(d||0);
 if(state.correctionMode&&c.correctionSource){
  const max=Number(c.correctionOriginalQty||0);
  if(n<=0){state.cart=state.cart.filter(x=>x!==c);return}
  if(n>max)throw Error('更正後數量不可高於原交易數量');
  c.qty=n;return;
 }
 if(n<=0){state.cart=state.cart.filter(x=>x!==c);return}
 if(p.category==='鮮食'){
  const batch=freshBatches().find(x=>x.id===c.freshBatchId);
  if(!batch||freshStatus(batch)!=='正常')throw Error('無法販售');
  if(n>Number(batch.remainingQty||0))throw Error('庫存不足');
 }else if(!p.allowNegativeStock&&n>Number(p.stock||0))throw Error('庫存不足');
 c.qty=n;
}


export function setQty(id,value){
 const c=state.cart.find(x=>x.id===id),p=products().find(x=>x.id===id);
 if(!c||!p)return;
 const n=Math.floor(Number(value));
 if(!Number.isFinite(n)||n<1)throw Error('數量至少為 1');
 if(p.category==='鮮食'){
  const batch=freshBatches().find(x=>x.id===c.freshBatchId);
  if(!batch||freshStatus(batch)!=='正常')throw Error('無法販售');
  if(n>Number(batch.remainingQty||0))throw Error('庫存不足');
 }else if(!p.allowNegativeStock&&n>Number(p.stock||0))throw Error('庫存不足');
 c.qty=n;
}

function localDateKey(d=new Date()){
 const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
 return `${y}-${m}-${day}`;
}

function activePromotionRules(){
 const today=localDateKey();
 return load(K.promotionRules,[]).filter(r=>{
  if(!r||r.active===false)return false;
  if(r.startDate&&today<String(r.startDate))return false;
  if(r.endDate&&today>String(r.endDate))return false;
  return !!String(r.target||'').trim();
 });
}

function promotionMatchesItem(rule,item){
 if(!rule||!item||item.ecPickup)return false;
 const target=String(rule.target||'').trim();
 if(rule.targetType==='品群'){
  return [item.category,item.productGroup,item.group,item.groupName].some(v=>String(v||'').trim()===target);
 }
 return String(item.code||'').trim()===target;
}

function promotionEstimate(rule,units){
 const qty=Math.max(1,Math.floor(Number(rule.qty||1)));
 const prices=units.map(u=>Number(u.price||0)).sort((a,b)=>b-a);
 if(!prices.length)return 0;
 let discount=0;
 if(rule.type==='買一送一'){
  const groupSize=Math.max(2,qty);
  for(let i=0;i+groupSize<=prices.length;i+=groupSize){
   const g=prices.slice(i,i+groupSize);discount+=Math.min(...g);
  }
 }else if(rule.type==='第2件折扣'){
  const rate=Math.max(0,Math.min(1,Number(rule.rate??1)));
  for(let i=0;i+2<=prices.length;i+=2){
   const g=prices.slice(i,i+2);discount+=Math.min(...g)*(1-rate);
  }
 }else if(rule.type==='多件折扣'){
  const rate=Math.max(0,Math.min(1,Number(rule.rate??1)));
  for(let i=0;i+qty<=prices.length;i+=qty){discount+=prices.slice(i,i+qty).reduce((a,b)=>a+b,0)*(1-rate)}
 }else if(rule.type==='固定組合價'){
  const fixed=Math.max(0,Number(rule.fixedPrice||0));
  for(let i=0;i+qty<=prices.length;i+=qty){discount+=Math.max(0,prices.slice(i,i+qty).reduce((a,b)=>a+b,0)-fixed)}
 }
 return Math.max(0,Math.round(discount*100)/100);
}

function promotionApply(rule,remaining,cart){
 const units=[];
 cart.forEach((item,idx)=>{
  if(!promotionMatchesItem(rule,item))return;
  const n=Math.max(0,Math.floor(Number(remaining[idx]||0)));
  for(let i=0;i<n;i++)units.push({idx,price:Number(item.price||0)});
 });
 units.sort((a,b)=>b.price-a.price);
 const qty=Math.max(1,Math.floor(Number(rule.qty||1)));
 let groupSize=qty;
 if(rule.type==='買一送一')groupSize=Math.max(2,qty);
 if(rule.type==='第2件折扣')groupSize=2;
 const groupCount=Math.floor(units.length/groupSize);
 if(groupCount<=0)return null;
 const used=units.slice(0,groupCount*groupSize);
 const discount=promotionEstimate(rule,used);
 if(discount<=0)return null;
 const counts={};used.forEach(u=>counts[u.idx]=(counts[u.idx]||0)+1);
 Object.entries(counts).forEach(([idx,n])=>remaining[Number(idx)]=Math.max(0,Number(remaining[Number(idx)]||0)-Number(n||0)));
 return {id:rule.id||'',name:rule.name||'商品活動',type:rule.type||'',summary:rule.summary||'',discount,qty:used.length};
}

export function calculatePromotions(cart=state.cart){
 const rules=activePromotionRules();
 const remaining=cart.map(x=>Math.max(0,Math.floor(Number(x.qty||0))));
 const candidates=rules.map(rule=>{
  const units=[];cart.forEach((item,idx)=>{if(!promotionMatchesItem(rule,item))return;for(let i=0;i<remaining[idx];i++)units.push({idx,price:Number(item.price||0)})});
  return {rule,estimate:promotionEstimate(rule,units)};
 }).filter(x=>x.estimate>0).sort((a,b)=>b.estimate-a.estimate);
 const applications=[];
 for(const c of candidates){const a=promotionApply(c.rule,remaining,cart);if(a)applications.push(a)}
 const discount=Math.round(applications.reduce((s,a)=>s+Number(a.discount||0),0)*100)/100;
 return {discount,applications};
}

export function itemActivePromotions(item){
 return activePromotionRules().filter(r=>promotionMatchesItem(r,item));
}

function isServiceItem(x){return !!(x&&(x.ecPickup===true||x.collectionPayment===true||x.billPayment===true||x.utilityPayment===true||['bill','utility-bill','ec-pickup','collection'].includes(String(x.serviceType||''))))}
function isAnybuyPurchaseItem(x){return !!(x&&(x.appAnybuyPayment===true||x.appAnybuyDeposit===true))}
function isAnybuyRedeemItem(x){return !!(x&&x.appAnybuyRedeem===true)}
function isAnybuyItem(x){return isAnybuyPurchaseItem(x)||isAnybuyRedeemItem(x)}
function anybuyEntitlementsForSale(sale){
 const rows=load('yj_app_member_products',[]);if(!Array.isArray(rows))return [];
 const ids=new Set((sale.items||[]).filter(isAnybuyPurchaseItem).map(x=>String(x.appAnybuyOrderId||'')).filter(Boolean));
 const codes=new Set((sale.items||[]).filter(isAnybuyPurchaseItem).map(x=>String(x.appAnybuyPaymentCode||'')).filter(Boolean));
 return rows.filter(x=>(x?.orderId&&ids.has(String(x.orderId)))||(x?.paymentCode&&codes.has(String(x.paymentCode))));
}
function anybuyPurchaseReturnEligibility(sale){
 const lines=(sale.items||[]).filter(isAnybuyPurchaseItem);if(!lines.length)return {allowed:true,reason:''};
 const paid=Date.parse(String(lines[0]?.appAnybuyPaidAt||sale.at||''));if(!Number.isFinite(paid))return {allowed:false,reason:'找不到隨買付款時間'};
 if(Date.now()-paid>7*24*60*60*1000)return {allowed:false,reason:'隨買商品已超過付款完成後 7 天，不能退貨'};
 const ent=anybuyEntitlementsForSale(sale);if(!ent.length)return {allowed:false,reason:'找不到會員我的商品資料，請先同步'};
 if(ent.some(x=>Number(x?.remainingQuantity??0)<Number(x?.originalQuantity??0)))return {allowed:false,reason:'此隨買商品已經兌換過，不能退貨'};
 return {allowed:true,reason:''};
}


export function totals(){
 const merchandiseSubtotal=state.cart.filter(x=>!isServiceItem(x)).reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);
 const serviceAmount=state.cart.filter(x=>isServiceItem(x)).reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);
 const subtotal=merchandiseSubtotal+serviceAmount;
 const promo=calculatePromotions(state.cart.filter(x=>!isServiceItem(x)));
 const manualDiscount=Math.max(0,Number(state.discount||0));
 const pointDiscount=Math.max(0,Number(state.memberRedeemAmount||0));
 const gamePrizeApplications=Array.isArray(state.gamePrizeApplications)?state.gamePrizeApplications:[];
 const gamePrizeDiscount=Math.max(0,gamePrizeApplications.reduce((s,x)=>s+Number(x?.discount||0),0));
 const promotionDiscount=Math.min(merchandiseSubtotal,Math.max(0,Number(promo.discount||0)));
 const discountTotal=Math.min(merchandiseSubtotal,promotionDiscount+manualDiscount+pointDiscount+gamePrizeDiscount);
 const merchandiseTotal=Math.max(0,merchandiseSubtotal-discountTotal);
 return{subtotal,merchandiseSubtotal,serviceAmount,promotionDiscount,promotionApplications:promo.applications,manualDiscount,pointDiscount,gamePrizeDiscount,gamePrizeApplications,discountTotal,merchandiseTotal,total:merchandiseTotal+serviceAmount};
}

function validateFreshCart(){
 for(const c of state.cart){
  const p=products().find(x=>x.id===c.id);
  if(!p||p.category!=='鮮食')continue;
  const batch=freshBatches().find(x=>x.id===c.freshBatchId);
  if(!batch||freshStatus(batch)!=='正常')throw Error(`${c.name} 已過期或無有效批次，無法販售`);
  if(Number(batch.remainingQty||0)<Number(c.qty||0))throw Error(`${c.name} 鮮食批次庫存不足`);
 }
}

function deductFreshFIFO(cart){
 const rows=freshBatches();
 const usage=[];
 for(const c of cart){
  const p=products().find(x=>x.id===c.id);
  if(!p||p.category!=='鮮食')continue;
  let need=Number(c.qty||0);
  const candidates=rows
   .filter(b=>b.productId===p.id&&freshStatus(b)==='正常'&&Number(b.remainingQty||0)>0)
   .sort((a,b)=>new Date(a.expiryAt)-new Date(b.expiryAt));
  for(const batch of candidates){
   if(need<=0)break;
   const take=Math.min(need,Number(batch.remainingQty||0));
   batch.remainingQty=Number(batch.remainingQty||0)-take;
   batch.updatedAt=new Date().toISOString();
   usage.push({lineId:c.lineId,productId:p.id,batchId:batch.id,batchNo:batch.batchNo,qty:take,restoredQty:0});
   need-=take;
   audit('鮮食FIFO扣庫存',`${p.name}｜${batch.batchNo}｜${take}`);
  }
  if(need>0)throw Error(`${p.name} 鮮食批次庫存不足`);
 }
 save(K.freshBatches,rows);
 return usage;
}

function round2(v){return Math.round(Number(v||0)*100)/100}
function effectiveTotal(sale){return round2(sale.netTotal??sale.total??0)}
function effectiveCash(sale){return round2(sale.netCashAmount??sale.cashAmount??0)}
function effectiveNonCash(sale){return round2(sale.netNonCashAmount??sale.nonCashAmount??0)}

function restoreInventoryForReturn(sale,line,qtyToRestore){
 const ps=load(K.products,[]);
 const p=ps.find(x=>x.id===line.id);
 if(p){
  p.stock=Number(p.stock||0)+Number(qtyToRestore||0);
  const linked=linkedInventoryRuleForProduct(p);
  if(linked){
   const component=ps.find(x=>productCodeOf(x)===linked.componentCode);
   if(component){
    const restoreQty=Number(qtyToRestore||0)*Number(linked.componentQty||0);
    component.stock=Number(component.stock||0)+restoreQty;
    audit('連動退貨回補庫存',`${p.code||''} ${p.name}×${qtyToRestore} → ${component.code||''} ${component.name} +${restoreQty}`);
   }
  }
  save(K.products,ps);
 }
 if(!p||p.category!=='鮮食')return;
 const batches=freshBatches();
 let remaining=Number(qtyToRestore||0);
 const usages=(sale.freshUsage||[]).filter(u=>u.lineId===line.lineId||(!u.lineId&&u.productId===line.id));
 for(const u of usages){
  if(remaining<=0)break;
  const available=Math.max(0,Number(u.qty||0)-Number(u.restoredQty||0));
  const give=Math.min(remaining,available);
  if(give<=0)continue;
  const b=batches.find(x=>x.id===u.batchId)||batches.find(x=>x.batchNo===u.batchNo&&x.productId===line.id);
  if(b){b.remainingQty=Number(b.remainingQty||0)+give;b.updatedAt=new Date().toISOString();if(b.status==='已售完')b.status='正常'}
  u.restoredQty=Number(u.restoredQty||0)+give;
  remaining-=give;
  audit('鮮食退貨回補批次',`${line.name}｜${u.batchNo||u.batchId}｜${give}`);
 }
 if(remaining>0&&line.freshBatchId){
  const b=batches.find(x=>x.id===line.freshBatchId);
  if(b){b.remainingQty=Number(b.remainingQty||0)+remaining;b.updatedAt=new Date().toISOString();remaining=0}
 }
 save(K.freshBatches,batches);
}

function refundPaymentAllocation(sale,refundAmount){
 const before=effectiveTotal(sale);
 if(before<=0)return {cashRefund:0,nonCashRefund:0};
 const cash=effectiveCash(sale),noncash=effectiveNonCash(sale);
 let cashRefund=round2(refundAmount*(cash/before));
 cashRefund=Math.min(cash,cashRefund);
 let nonCashRefund=round2(refundAmount-cashRefund);
 if(nonCashRefund>noncash){const spill=round2(nonCashRefund-noncash);nonCashRefund=noncash;cashRefund=Math.min(cash,round2(cashRefund+spill))}
 return {cashRefund,nonCashRefund};
}

export function correctSale(saleId,adjustments,reason,note=''){
 const sales=load(K.sales,[]),sale=sales.find(x=>x.id===saleId);
 if(!sale)throw Error('找不到交易');
 if(['已整筆退貨','已作廢'].includes(sale.status))throw Error('此交易已鎖定，不能再次更正');
 if(!String(reason||'').trim())throw Error('請選擇交易更正原因');
 let refund=0;const changed=[];
 sale.items=(sale.items||[]).map((line,i)=>{if(!line.lineId)line.lineId=`${sale.id}-L${i+1}`;return line});
 for(const a of adjustments||[]){
  const line=sale.items.find(x=>x.lineId===a.lineId);if(!line)continue;
  const already=Number(line.returnedQty||0),max=Math.max(0,Number(line.qty||0)-already),q=Math.floor(Number(a.returnQty||0));
  if(q<=0)continue;if(q>max)throw Error(`${line.name} 可退數量不足`);
  if(isAnybuyPurchaseItem(line)){
   const eligible=anybuyPurchaseReturnEligibility(sale);if(!eligible.allowed)throw Error(eligible.reason);
  }
  const ratio=Number(sale.subtotal||0)>0?Number(sale.total||0)/Number(sale.subtotal||1):1;
  const amount=round2(isAnybuyItem(line)?Number(line.price||0)*q:Number(line.price||0)*q*ratio);
  line.returnedQty=already+q;line.correctedQty=Math.max(0,Number(line.qty||0)-Number(line.returnedQty||0));
  refund=round2(refund+amount);changed.push({lineId:line.lineId,name:line.name,qty:q,refund:amount,appAnybuy:isAnybuyItem(line)});
  if(isAnybuyPurchaseItem(line))sale.consignmentNetAmount=round2(Math.max(0,Number(sale.consignmentNetAmount??sale.consignmentAmount??0)-amount));
  if(!isAnybuyItem(line))restoreInventoryForReturn(sale,line,q);
 }
 if(!changed.length)throw Error('請至少選擇一項退貨數量');
 refund=Math.min(refund,effectiveTotal(sale));
 const allocation=refundPaymentAllocation(sale,refund);
 sale.netTotal=round2(effectiveTotal(sale)-refund);
 sale.netCashAmount=round2(effectiveCash(sale)-allocation.cashRefund);
 sale.netNonCashAmount=round2(effectiveNonCash(sale)-allocation.nonCashRefund);
 sale.status='已更正';sale.processingStatus='更正完成';sale.refundTotal=round2(Number(sale.refundTotal||0)+refund);
 sale.correctionHistory=sale.correctionHistory||[];sale.correctionHistory.unshift({id:'C'+Date.now(),type:'部分退貨／交易更正',reason,note,items:changed,refund,cashRefund:allocation.cashRefund,nonCashRefund:allocation.nonCashRefund,user:currentUser().name,userAccount:String(currentUser()?.account||''),at:new Date().toISOString()});
 save(K.sales,sales);audit('交易更正',`${sale.id}｜${reason}｜退款${money(refund)}｜不列印退貨明細`);return sale;
}

export function closeSale(saleId,type,reason,note=''){
 const sales=load(K.sales,[]),sale=sales.find(x=>x.id===saleId);
 if(!sale)throw Error('找不到交易');
 if(['已整筆退貨','已作廢'].includes(sale.status))throw Error('此交易已鎖定，不能重複處理');
 const anybuy=(sale.items||[]).filter(isAnybuyItem),normal=(sale.items||[]).filter(x=>!isAnybuyItem(x));
 if(anybuy.length&&normal.length)throw Error('此交易包含隨買代銷／兌換與一般商品，不能整筆處理，請使用交易更正／部分退貨');
 if(anybuy.some(isAnybuyRedeemItem))throw Error('隨買兌換交易不能整筆處理，請使用交易更正／部分退貨');
 if(anybuy.some(isAnybuyPurchaseItem)){const eligible=anybuyPurchaseReturnEligibility(sale);if(!eligible.allowed)throw Error(eligible.reason)}
 if(!String(reason||'').trim())throw Error('請選擇原因');
 const before=effectiveTotal(sale),cash=effectiveCash(sale),noncash=effectiveNonCash(sale);
 sale.items=(sale.items||[]).map((line,i)=>{if(!line.lineId)line.lineId=`${sale.id}-L${i+1}`;const remain=Math.max(0,Number(line.qty||0)-Number(line.returnedQty||0));if(remain>0&&!isAnybuyItem(line))restoreInventoryForReturn(sale,line,remain);line.returnedQty=Number(line.qty||0);line.correctedQty=0;return line});
 if((sale.items||[]).some(isAnybuyPurchaseItem))sale.consignmentNetAmount=0;
 sale.netTotal=0;sale.netCashAmount=0;sale.netNonCashAmount=0;sale.refundTotal=round2(Number(sale.refundTotal||0)+before);
 sale.status=type==='void'?'已作廢':'已整筆退貨';sale.processingStatus=type==='void'?'作廢完成':'退貨完成';sale.locked=true;
 sale.correctionHistory=sale.correctionHistory||[];sale.correctionHistory.unshift({id:'C'+Date.now(),type:type==='void'?'整筆作廢':'整筆退貨',reason,note,refund:before,cashRefund:cash,nonCashRefund:noncash,user:currentUser().name,userAccount:String(currentUser()?.account||''),at:new Date().toISOString()});
 save(K.sales,sales);audit(type==='void'?'整筆作廢':'整筆退貨',`${sale.id}｜${reason}｜退款${money(before)}｜不列印退貨明細`);return sale;
}


function productCodeOf(p){return String(p?.code||'').trim().toUpperCase()}
function linkedInventoryRuleForProduct(p){
 const code=productCodeOf(p);
 return load(K.linkedInventoryRules,[]).find(r=>r&&r.active!==false&&r.saleSync!==false&&String(r.parentCode||'').trim().toUpperCase()===code)||null;
}

function scRuntimeAllowsServiceCheckout(){
 const dependent=(state.cart||[]).some(isServiceItem);
 if(!dependent)return true;
 if(typeof navigator!=='undefined'&&navigator.onLine===false)return false;
 let r={};try{r=JSON.parse(localStorage.getItem('yj_sc_runtime_state')||'{}')||{}}catch{}
 const status=String(r.status||'').toLowerCase(),at=Date.parse(r.updatedAt||'');
 if(status==='offline'||status==='restarting'||status==='closed')return false;
 if(status==='background'){
  const explicitUntil=Date.parse(r.until||'');
  const until=Number.isFinite(explicitUntil)?explicitUntil:(Number.isFinite(at)?at+10*60*1000:NaN);
  return Number.isFinite(until)&&Date.now()<=until;
 }
 // Alpha 8.06: 與 TM 畫面層共用相同規則，不再用 45 秒 heartbeat 阻擋服務性結帳。
 return status==='online';
}

export function checkout(paymentDetail=null){
 if(!state.cart.length)throw Error('購物車是空的');
 if(!scRuntimeAllowsServiceCheckout())throw Error('與SC斷開：無法進行 EC 取貨結帳或繳帳單');
 validateFreshCart();

 const ps=load(K.products,[]);
 const requiredByProductId=new Map();
 for(const c of state.cart){
  if(isServiceItem(c)||c.manualAmount)continue;
  const p=ps.find(x=>x.id===c.id);
  if(!p)throw Error(c.name+'商品不存在');
  if(p.category!=='鮮食')requiredByProductId.set(p.id,(requiredByProductId.get(p.id)||0)+Number(c.qty||0));
  const linked=linkedInventoryRuleForProduct(p);
  if(linked){
   const component=ps.find(x=>productCodeOf(x)===linked.componentCode);
   if(!component)throw Error(`找不到綁定庫存商品 ${linked.componentCode}`);
   requiredByProductId.set(component.id,(requiredByProductId.get(component.id)||0)+Number(c.qty||0)*Number(linked.componentQty||0));
  }
 }
 for(const [productId,requiredQty] of requiredByProductId){
  const p=ps.find(x=>x.id===productId);
  if(p&&!p.allowNegativeStock&&Number(p.stock||0)<Number(requiredQty||0))throw Error(`${p.name}庫存不足（本次需扣 ${requiredQty}）`);
 }

 const t=totals();
 const serviceSale=state.cart.length>0&&state.cart.every(isServiceItem);
 const consignmentAmount=round2(state.cart.filter(isAnybuyPurchaseItem).reduce((sum,x)=>sum+Number(x.price||0)*Number(x.qty||0),0));
 const deferredRevenueSale=state.cart.length>0&&state.cart.every(x=>isAnybuyPurchaseItem(x));
 const detail=paymentDetail||state.paymentDetail||{
  method:state.payment,
  cashAmount:state.payment==='現金'?t.merchandiseTotal:0,
  nonCashAmount:state.payment==='現金'?0:t.merchandiseTotal,
  serviceCashAmount:t.serviceAmount,
  serviceNonCashAmount:0,
  tendered:state.payment==='現金'?t.total:t.serviceAmount,
  change:0
 };
 const cashAmount=Number(detail.cashAmount||0);
 const nonCashAmount=Number(detail.nonCashAmount||0);
 const serviceCashAmount=Number((detail.serviceCashAmount ?? t.serviceAmount) || 0);
 const serviceNonCashAmount=Number(detail.serviceNonCashAmount||0);
 if(Math.round((cashAmount+nonCashAmount)*100)!==Math.round(t.merchandiseTotal*100))throw Error('商品付款金額合計與商品應收金額不符');
 if(Math.round((serviceCashAmount+serviceNonCashAmount)*100)!==Math.round(t.serviceAmount*100))throw Error('服務性付款金額與應收金額不符');

 const allSoldItems=structuredClone(state.cart).map((x,i)=>({...x,lineId:x.lineId||`L${Date.now()}-${i+1}`,returnedQty:0,correctedQty:Number(x.qty||0)}));
 const soldItems=allSoldItems.filter(x=>!isServiceItem(x));
 const serviceItems=allSoldItems.filter(isServiceItem);
 const ecItems=serviceItems.filter(x=>x.ecPickup);
 const collectionItems=serviceItems.filter(x=>x.collectionPayment||x.billPayment||x.utilityPayment);
 const sale={
  id:state.transactionId||('T'+Date.now()),
  items:soldItems,
  ecItems,
  ...t,
  discount:t.discountTotal,
  manualDiscount:t.manualDiscount,
  promotionDiscount:t.promotionDiscount,
  promotionApplications:t.promotionApplications,
  payment:detail.method||state.payment,
  paymentSubtype:detail.subtype||'',
  paymentBreakdown:detail.breakdown||[],
  note:String(detail.note??state.note??''),
  status:'正常',
  correctionHistory:[],
  processingStatus:'未處理',
  locked:false,
  cashAmount,
  netTotal:t.merchandiseTotal,
  total:t.merchandiseTotal,
  merchandiseSubtotal:t.merchandiseSubtotal,
  netCashAmount:cashAmount,
  netNonCashAmount:nonCashAmount,
  nonCashAmount,
  tendered:Number(detail.tendered||0),
  change:Number(detail.change||0),
  serviceSale,
  deferredRevenueSale,
  deferredRevenueAmount:consignmentAmount,
  consignmentSale:consignmentAmount>0,
  consignmentAmount,
  consignmentNetAmount:consignmentAmount,
  mixedAnybuyConsignment:consignmentAmount>0&&state.cart.some(x=>!isAnybuyItem(x)&&!isServiceItem(x)),
  serviceAmount:t.serviceAmount,
  serviceCashAmount:t.serviceAmount,
  serviceCustomerCount:t.serviceAmount>0?1:0,
  serviceTransactions:collectionItems.map(x=>({type:x.serviceCategory||'代收',reference:x.serviceReference||x.code||'',provider:x.serviceProvider||'',amount:Number(x.price||0)*Number(x.qty||0),paymentMethod:x.servicePaymentMethod||detail.method||'現金'})),
  serviceItems,
  combinedTenderTotal:t.total,
  excludeFromRevenue:serviceSale||deferredRevenueSale,
  memberId:state.member?.id||'',
  memberPhone:state.member?.phone||'',
  memberName:state.member?.name||'',
  taxId:String(state.taxId||''),
  user:String(detail.cashierOverride?.name||currentUser().name),
  userAccount:String(detail.cashierOverride?.account||currentUser()?.account||''),
  cashierAccount:String(detail.cashierOverride?.account||currentUser()?.account||''),
  storeCode:String(localStorage.getItem('yj_store_no')?(()=>{try{return JSON.parse(localStorage.getItem('yj_store_no'))}catch{return localStorage.getItem('yj_store_no')}})():'001'),
  at:new Date().toISOString()
 };

 sale.freshUsage=deductFreshFIFO(soldItems);
 soldItems.forEach(c=>{
  if(isServiceItem(c))return;
  const p=ps.find(x=>x.id===c.id);
  if(!p)return;
  const nextStock=Number(p.stock||0)-Number(c.qty||0);
  p.stock=p.allowNegativeStock?nextStock:Math.max(0,nextStock);
  const linked=linkedInventoryRuleForProduct(p);
  if(linked){
   const component=ps.find(x=>productCodeOf(x)===linked.componentCode);
   if(component){
    const extraQty=Number(c.qty||0)*Number(linked.componentQty||0);
    const componentNext=Number(component.stock||0)-extraQty;
    component.stock=component.allowNegativeStock?componentNext:Math.max(0,componentNext);
    audit('連動銷售扣庫存',`${p.code||''} ${p.name}×${c.qty} → ${component.code||''} ${component.name} -${extraQty}`);
   }
  }
 });
 save(K.products,ps);

 const ss=load(K.sales,[]);
 ss.unshift(sale);
 save(K.sales,ss);
 audit('完成交易',`${sale.id}｜商品${money(sale.total)}｜商品現金${money(sale.cashAmount)}｜商品非現金${money(sale.nonCashAmount)}｜EC現金${money(sale.serviceCashAmount||0)}`);
 state.cart=[];
 state.discount=0;
 state.payment='現金';
 state.paymentDetail=null;
 state.note='';
 state.selected='';
 state.member=null;
 state.transactionId='';
 state.taxId='';
 state.lastCompletedSale=structuredClone(sale);
 return sale;
}
