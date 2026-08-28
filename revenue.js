export const REMITTANCE_BANKS={
 '中華郵政':'700',
 '台灣銀行':'004',
 '合作金庫':'006',
 '第一銀行':'007',
 '華南銀行':'008',
 '彰化銀行':'009'
};

import{K,load,save,uid,money}from'./db.js';
import{audit}from'./core.js';

function saleCashAmount(sale){
 return Number(sale.netCashAmount??sale.cashAmount??(sale.payment==='現金'?(sale.netTotal??sale.total):0));
}

function saleNonCashAmount(sale){
 return Number(sale.netNonCashAmount??sale.nonCashAmount??(sale.payment==='現金'?0:(sale.netTotal??sale.total)));
}

function saleRevenueAmount(sale){
 const net=Math.max(0,Number(sale.netTotal??sale.total??0));
 const consignment=Math.max(0,Number(sale.consignmentNetAmount??sale.consignmentAmount??sale.deferredRevenueAmount??0));
 return Math.max(0,Math.round((net-consignment)*100)/100);
}
export function collect(){
 const date=new Date().toISOString().slice(0,10);
 const sales=load(K.sales,[]).filter(x=>x.at?.startsWith(date)&&x.status!=='作廢'&&x.status!=='已作廢'&&x.status!=='已整筆退貨'&&!(x.serviceSale===true||(x.items||[]).some(i=>i.ecPickup)));
 const deposits=load(K.deposits,[])
  .filter(x=>x.at?.startsWith(date))
  .reduce((sum,x)=>sum+Number(x.amount||0),0);

 const total=sales.reduce((sum,x)=>sum+saleRevenueAmount(x),0);
 const cashRevenue=sales.reduce((sum,x)=>sum+saleCashAmount(x),0);
 const nonCashRevenue=sales.reduce((sum,x)=>sum+saleNonCashAmount(x),0);

 const next={
  id:uid(),
  date,
  total,
  cashRevenue,
  nonCashRevenue,
  deposits,
  sendAmount:Math.max(0,cashRevenue-deposits),
  count:sales.length,
  status:'已收集',
  at:new Date().toISOString()
 };

 const rows=load(K.revenue,[]);
 const old=rows.find(x=>x.date===date&&x.status==='已收集');

 if(old){
  Object.assign(old,next,{id:old.id});
 }else{
  rows.unshift(next);
 }

 save(K.revenue,rows);
 audit(
  '營收收集',
  `${money(next.total)}｜現金${money(next.cashRevenue)}｜非現金${money(next.nonCashRevenue)}｜送金${money(next.sendAmount)}`
 );
 return old||next;
}

export function correct(id,actualCash,reason,method,bankName=''){
 const rows=load(K.revenue,[]);
 const record=rows.find(x=>x.id===id);
 if(!record)throw Error('找不到營收紀錄');

 const storeCode=String(localStorage.getItem('yj_store_no')||'001').replace(/^"|"$/g,'').trim()||'001';
 const bankCode=REMITTANCE_BANKS[bankName]||'';
 const remittanceAccount=method==='銀行送金'&&bankCode?`${bankCode}${storeCode.padStart(6,'0')}`:'';

 Object.assign(record,{
  actualCash:Number(actualCash),
  reason,
  method,
  bankName:method==='銀行送金'?bankName:'',
  remittanceAccount,
  cashDifference:Number(actualCash)-Number(record.sendAmount||0),
  status:'已修正'
 });

 save(K.revenue,rows);
 audit('營收修正',`${method}｜${money(record.actualCash)}`);
 return record;
}

export function z(id){
 const rows=load(K.revenue,[]);
 const record=rows.find(x=>x.id===id);
 if(!record)throw Error('找不到營收紀錄');
 if(!record.method)throw Error('請先修正並選擇送金方式');

 record.zNo='Z'+Date.now();
 record.status='已產生Z帳';
 save(K.revenue,rows);
 audit('產生Z帳',record.zNo);
 return record;
}

export function autoCloseBusinessDay(date){
 const target=date||new Date().toISOString().slice(0,10);
 const sales=load(K.sales,[]).filter(
  x=>x.at?.startsWith(target)&&x.status!=='作廢'&&x.status!=='已作廢'&&x.status!=='已整筆退貨'&&!(x.serviceSale===true||(x.items||[]).some(i=>i.ecPickup))
 );

 const total=sales.reduce((sum,x)=>sum+saleRevenueAmount(x),0);
 const cashRevenue=sales.reduce((sum,x)=>sum+saleCashAmount(x),0);
 const nonCashRevenue=sales.reduce((sum,x)=>sum+saleNonCashAmount(x),0);

 const rows=load(K.revenue,[]);
 const existing=rows.find(x=>x.date===target&&x.autoClose===true);
 if(existing)return existing;

 const record={
  id:uid(),
  date:target,
  total,
  cashRevenue,
  nonCashRevenue,
  sendAmount:cashRevenue,
  count:sales.length,
  status:'自動日結完成',
  autoClose:true,
  createdAt:new Date().toISOString(),
  zNo:'AZ'+Date.now()
 };

 rows.unshift(record);
 save(K.revenue,rows);
 audit('自動日結',`${target}｜${money(total)}｜${sales.length}筆`);
 return record;
}
