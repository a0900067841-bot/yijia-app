import{cloudPushKey}from'./sync.js';

function autoInternalBarcode(prefix='YJP'){
 const ts=Date.now().toString(36).toUpperCase();
 const rand=Math.random().toString(36).slice(2,7).toUpperCase();
 return `${prefix}${ts}${rand}`;
}

export const K={products:'yj4_products',sales:'yj4_sales',employees:'yj4_employees',stores:'yj4_stores',session:'yj4_session',audit:'yj4_audit',transfers:'yj4_transfers',logistics:'yj4_logistics',ec:'yj4_ec',attendance:'yj4_attendance',revenue:'yj4_revenue',quality:'yj4_quality',waste:'yj4_waste',inventoryMoves:'yj4_inventory_moves',members:'yj4_members',permissions:'yj4_permissions',updates:'yj4_updates',held:'yj4_held',deposits:'yj4_deposits',handovers:'yj4_handovers',logisticsSchedules:'yj4_logistics_schedules',orders:'yj4_orders',productGroups:'yj4_product_groups',scheduler:'yj_scheduler',permissionTemplates:'yj_permission_templates',freshBatches:'yj_fresh_batches',shifts:'yj_shifts',xAccounts:'yj_x_accounts',promotionRules:'yj_promotion_rules',systemSettings:'yj_system_settings',pointSettings:'yj_point_settings',memberBonusCampaigns:'yj_member_bonus_campaigns',linkedInventoryRules:'yj_linked_inventory_rules',receivingInspections:'yj_receiving_inspections',customerDisplayState:'yj_customer_display_state',customerDisplaySettings:'yj_customer_display_settings',masterUpdate:'yj_master_update_signal',notices:'yj_notices',tmScLink:'yj_tm_sc_link'};
export const load=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
export const save=(k,v)=>{
 localStorage.setItem(k,JSON.stringify(v));
 if(String(k)!=='yj_promotion_rules'){try{cloudPushKey(k,v)}catch{}}
 return v
};
export const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2);
export const money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
export function seed(){
 if(!load(K.customerDisplaySettings,null))save(K.customerDisplaySettings,{enabled:true,intervalSeconds:5,slides:[],music:[],game:{enabled:false,type:'grid',title:'幸運四格抽抽樂',soundUrl:'',prizes:[]}});
 if(!load(K.receivingInspections,null))save(K.receivingInspections,[]);
 if(!load(K.memberBonusCampaigns,null))save(K.memberBonusCampaigns,[]);
 if(!load(K.linkedInventoryRules,null))save(K.linkedInventoryRules,[{id:'rule-tissue-n0001-c0001',parentCode:'N0001',componentCode:'C0001',componentQty:8,active:true,inboundSync:true,saleSync:true,note:'億家衛生紙：1串＝8包'}]);
 if(!load(K.pointSettings,null))save(K.pointSettings,{earnAmount:1,earnPoints:1,redeemPoints:300,redeemAmount:1});
 if(!load(K.systemSettings,null))save(K.systemSettings,{shifts:{早班:{start:'07:00',end:'15:00'},晚班:{start:'15:00',end:'23:00'},大夜班:{start:'23:00',end:'07:00'}},reserveCash:0});
 if(!load(K.promotionRules,null))save(K.promotionRules,[]);
 if(!load(K.products,null))save(K.products,[
 {id:uid(),name:'御飯糰－肉鬆',barcode:'471000000001',category:'鮮食',logistics:'鮮食一配',price:35,cost:20,stock:30,safeStock:5,icon:'🍙',active:true},
 {id:uid(),name:'光泉鮮奶 936ml',barcode:'471000000002',category:'低溫',logistics:'乳品',price:89,cost:65,stock:20,safeStock:4,icon:'🥛',active:true},
 {id:uid(),name:'礦泉水 600ml',barcode:'471000000003',category:'常溫',logistics:'常溫',price:20,cost:10,stock:60,safeStock:8,icon:'💧',active:true},
 {id:uid(),name:'冷凍水餃',barcode:'471000000004',category:'冷凍',logistics:'冷凍',price:129,cost:85,stock:16,safeStock:3,icon:'🥟',active:true}
 ]);
 
 const productRows=load(K.products,[]);let productChanged=false;
 productRows.forEach((p,i)=>{
  if(!p.code){p.code=`P${String(i+1).padStart(5,'0')}`;productChanged=true}
  if(!p.shortName){p.shortName=p.name||'';productChanged=true}
  if(!Array.isArray(p.barcodes)){p.barcodes=p.barcode?[p.barcode]:[];productChanged=true}
  p.barcodes=[...new Set(p.barcodes.map(x=>String(x).trim()).filter(Boolean))];
  if(!p.barcode&&p.barcodes[0]){p.barcode=p.barcodes[0];productChanged=true}
  if(!p.barcode&&(!p.barcodes||!p.barcodes.length)){
   p.barcode=autoInternalBarcode('YJP');
   p.barcodes=[p.barcode];
   p.barcodeSource='system';
   productChanged=true;
  }
  if(!p.deliveryType){p.deliveryType=p.logistics||'常溫';productChanged=true}
  if(!p.logistics){p.logistics=p.deliveryType||'常溫';productChanged=true}
  if(!p.status){p.status=p.active===false?'停用':'啟用';productChanged=true}
  if(p.maxStock===undefined){p.maxStock=0;productChanged=true}
  if(p.allowNegativeStock===undefined){p.allowNegativeStock=false;productChanged=true}
  if(p.isFresh===undefined){p.isFresh=p.category==='鮮食';productChanged=true}
  if(Object.prototype.hasOwnProperty.call(p,'shelfLifeHours')){delete p.shelfLifeHours;productChanged=true}
  if(p.discountBeforeHours===undefined){p.discountBeforeHours=p.isFresh?7:0;productChanged=true}
  if(p.alertBeforeMinutes===undefined){p.alertBeforeMinutes=p.isFresh?10:0;productChanged=true}
  if(p.blockExpiredSale===undefined){p.blockExpiredSale=p.isFresh;productChanged=true}
  p.active=p.status!=='停用';
 });
 if(productChanged)save(K.products,productRows);

 if(!load(K.employees,null))save(K.employees,[{id:'founder',name:'Yuan',account:'yuan',password:'1234',phone:'',email:'',role:'創辦人',active:true}]);
 const seededEmployees=load(K.employees,[]);let employeeChanged=false;
 seededEmployees.forEach(x=>{
  if(!x.password){x.password='1234';employeeChanged=true}
  if(!x.storeCode){x.storeCode=String(load('yj_store_no','001')||'001');employeeChanged=true}
 });
 if(employeeChanged)save(K.employees,seededEmployees);
 if(!load(K.stores,null))save(K.stores,[{id:'main',name:'總店',code:'001',active:true}]);
 if(!load(K.members,null))save(K.members,[]);
 if(!load(K.freshBatches,null))save(K.freshBatches,[]);
 const freshBatchRows=load(K.freshBatches,[]);let freshBatchChanged=false;
 freshBatchRows.forEach(x=>{if(Object.prototype.hasOwnProperty.call(x,'shelfLifeHours')){delete x.shelfLifeHours;freshBatchChanged=true}});
 if(freshBatchChanged)save(K.freshBatches,freshBatchRows);
 if(!load(K.shifts,null))save(K.shifts,[]);
 if(!load(K.xAccounts,null))save(K.xAccounts,[]);
 if(!load(K.orders,null))save(K.orders,[]);
 if(!load(K.productGroups,null))save(K.productGroups,['飲料','零食','泡麵','日用品','麵包','鮮食','乳品','冷凍','其他']);
 if(!load(K.permissions,null))save(K.permissions,{});
 if(!load(K.logisticsSchedules,null))save(K.logisticsSchedules,[
  {id:uid(),storeCode:'001',storeName:'總店',type:'常溫',scheduled:'05:30～09:00',note:''},
  {id:uid(),storeCode:'001',storeName:'總店',type:'鮮食一配',scheduled:'06:30～08:30',note:''},
  {id:uid(),storeCode:'001',storeName:'總店',type:'鮮食二配',scheduled:'07:57～09:27',note:''},
  {id:uid(),storeCode:'001',storeName:'總店',type:'乳品',scheduled:'09:00～10:30',note:''},
  {id:uid(),storeCode:'001',storeName:'總店',type:'冷凍',scheduled:'11:42～15:12',note:''},
  {id:uid(),storeCode:'001',storeName:'總店',type:'EC',scheduled:'依物流通知',note:''}
 ]);
}