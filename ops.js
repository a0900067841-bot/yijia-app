import{K,load,save,uid}from'./db.js';
import{audit,currentUser}from'./core.js';
export const logisticsTypes=['常溫','鮮食一配','鮮食二配','乳品','冷凍','EC'];
export const ecTypes=['常溫EC','冷凍EC'];
export function logistics(type,note=''){const r=load(K.logistics,[]);r.unshift({id:uid(),storeCode:'001',storeName:'總店',type,note,user:currentUser().name,at:new Date().toISOString(),status:'已到店'});save(K.logistics,r);audit('物流到店簽到',type)}
function currentStoreCode(){
 const raw=localStorage.getItem('yj_store_no');
 if(raw==null||raw==='')return '001';
 try{return String(JSON.parse(raw)||'001').trim()||'001'}catch{return String(raw||'001').replace(/^"|"$/g,'').trim()||'001'}
}
export function attendance(kind){const r=load(K.attendance,[]);r.unshift({id:uid(),storeCode:currentStoreCode(),user:currentUser().name,userAccount:String(currentUser()?.account||''),kind,at:new Date().toISOString()});save(K.attendance,r);audit('員工'+kind)}
export function addEC(x){const r=load(K.ec,[]);r.unshift({id:uid(),type:x.type,name:x.name,last3:x.last3,packageNo:x.packageNo||'',pickupStore:x.pickupStore||'',value:Number(x.value||0),status:x.status||'已寄件',abnormal:x.abnormal||'',at:new Date().toISOString(),sentAt:new Date().toISOString(),sentBy:currentUser().name});save(K.ec,r);audit('EC寄件',x.name+'｜'+x.last3+'｜取貨店 '+(x.pickupStore||'未設定'))}
export function cancelEC(id,reason=''){const r=load(K.ec,[]),x=r.find(v=>v.id===id);if(!x)throw Error('找不到包裹');x.status='已取消寄件';x.cancelReason=reason;x.cancelAt=new Date().toISOString();save(K.ec,r);audit('取消EC寄件',x.name+'｜'+x.last3+'｜'+reason)}
export function createTransfer(toStore,product,qty,date=''){if(product.category==='鮮食'&&!date)throw Error('鮮食需輸入日期');const r=load(K.transfers,[]),t={id:`TR-001-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(r.length+1).padStart(4,'0')}`,from:'001',to:toStore,items:[{productId:product.id,name:product.name,category:product.category,qty:Number(qty),date}],status:'運送中',at:new Date().toISOString()};const ps=load(K.products,[]),p=ps.find(x=>x.id===product.id);if(!p||p.stock<qty)throw Error('庫存不足');p.stock-=Number(qty);save(K.products,ps);r.unshift(t);save(K.transfers,r);audit('轉貨轉出',t.id);return t}
export function receiveTransfer(id){const r=load(K.transfers,[]),t=r.find(x=>x.id===id);if(!t)throw Error('找不到轉貨單');if(t.status!=='運送中')throw Error('此單不可轉入');const ps=load(K.products,[]);t.items.forEach(i=>{const p=ps.find(x=>x.id===i.productId);if(p)p.stock+=Number(i.qty)});t.status='已轉入';t.inAt=new Date().toISOString();t.inUser=currentUser().name;save(K.products,ps);save(K.transfers,r);audit('轉貨轉入',id)}

export function updateECStatus(id,status,extra={}){const r=load(K.ec,[]),x=r.find(v=>v.id===id||v.packageNo===id);if(!x)throw Error('找不到包裹');const now=new Date().toISOString();x.status=status;Object.assign(x,extra);if(status==='待取件'){x.arrivedAt=now;x.arrivedBy=currentUser().name}if(status==='已取件'){x.pickedAt=now;x.pickedBy=currentUser().name}if(status==='已離店'){x.leftAt=now;x.leftBy=currentUser().name}save(K.ec,r);audit('EC'+status,`${x.packageNo||x.id}｜${x.name}`);return x}


export function recordCloudLogisticsArrival(batch){
 const type=batch?.delivery_type||batch?.type||'常溫';
 const batchNo=batch?.batch_no||batch?.batchNo||'';
 const r=load(K.logistics,[]);
 r.unshift({id:uid(),storeCode:'001',storeName:'總店',type,note:`雲端批次 ${batchNo}`,batchNo,user:currentUser().name,at:new Date().toISOString(),status:'已到店',source:'cloud'});
 save(K.logistics,r);
 if(type==='EC'){
  const ec=load(K.ec,[]);
  if(!ec.some(x=>x.packageNo===batchNo)){
   ec.unshift({id:uid(),type:'EC',name:'EC物流批次',last3:'',packageNo:batchNo,pickupStore:'001',value:0,status:'待取件',at:new Date().toISOString(),arrivedAt:new Date().toISOString(),arrivedBy:currentUser().name,source:'logistics_batch'});
   save(K.ec,ec);
  }
 }
 audit('物流到店簽到',`${type}｜${batchNo}｜雲端同步`);
}
