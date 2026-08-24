// 億家 Enterprise Alpha 2.1 - Supabase REST 雲端同步層
// 本機 localStorage 保留為離線快取；啟用後 save() 會非阻塞推送雲端。

const CONFIG_KEY='yj_cloud_config';
const STATUS_KEY='yj_cloud_status';
const SESSION_CONFIG_KEY='yj_cloud_session_config';

function runtimeStoreId(){
  const raw=localStorage.getItem('yj_store_no');
  if(raw==null||raw==='')return '001';
  try{return String(JSON.parse(raw)||'001').trim()||'001'}
  catch{return String(raw||'001').replace(/^"|"$/g,'').trim()||'001'}
}

const NEVER_SYNC=new Set([
  'yj4_session',
  'yj_remember_login',
  'yj_remember_person',
  'yj_store_no',
  'yj_store_name',
  CONFIG_KEY,
  STATUS_KEY
]);

export function getCloudConfig(){
  try{
    const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')||{};
    const storeId=runtimeStoreId();
    if(saved.rememberCredentials===false){
      const session=JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)||'{}')||{};
      return {...saved,...session,storeId,rememberCredentials:false};
    }
    return {...saved,storeId,rememberCredentials:saved.rememberCredentials!==false};
  }catch{
    return {storeId:runtimeStoreId()};
  }
}

export function setCloudConfig(cfg){
  const rememberCredentials=cfg?.rememberCredentials!==false;
  const clean={
    url:String(cfg?.url||'').trim().replace(/\/+$/,''),
    anonKey:String(cfg?.anonKey||'').trim(),
    storeId:runtimeStoreId(),
    enabled:cfg?.enabled!==false,
    rememberCredentials
  };
  if(rememberCredentials){
    localStorage.setItem(CONFIG_KEY,JSON.stringify(clean));
    sessionStorage.removeItem(SESSION_CONFIG_KEY);
  }else{
    localStorage.setItem(CONFIG_KEY,JSON.stringify({url:'',anonKey:'',storeId:clean.storeId,enabled:clean.enabled,rememberCredentials:false}));
    sessionStorage.setItem(SESSION_CONFIG_KEY,JSON.stringify({url:clean.url,anonKey:clean.anonKey}));
  }
  return clean;
}

export function cloudConfigured(){
  const c=getCloudConfig();
  return !!(c.enabled&&/^https:\/\//i.test(c.url)&&c.anonKey&&c.storeId);
}

export function cloudStatus(){
  try{return JSON.parse(localStorage.getItem(STATUS_KEY)||'{}')||{}}catch{return {}}
}

function setStatus(patch){
  const next={...cloudStatus(),...patch};
  localStorage.setItem(STATUS_KEY,JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('yj-cloud-status',{detail:next}));
  return next;
}


const PRODUCT_KEY='yj4_products';
const PRODUCT_INVENTORY_KEY='yj_store_product_inventory';
const EMPLOYEE_KEY='yj4_employees';
const FOUNDER_KEY='yj_founder_profile';
const SELF_CHECKOUT_ACCOUNT_KEY='yj_self_checkout_account';
const HQ_SPECIAL_TM_PERMISSIONS_KEY='yj_hq_special_tm_permissions';
const STOCKTAKE_PERSONNEL_KEY='yj_stocktake_personnel_master';
const HQ_SPECIAL_PERSONNEL_KEY='yj_hq_special_personnel_master';

const PRODUCT_INVENTORY_FIELDS=new Set([
  'stock','safeStock','safetyStock','maxStock','minOrderQty','maxOrderQty',
  'useMaxStock','safeStockPercent','safeAddPercent',
  'safeFallbackPercent','triggerSafePercent'
]);

// 只有使用者指定的共用主檔走 HQ。
// 門市清單是切換門市必要的系統索引，也維持 HQ。
const SHARED_KEYS=new Set([
  'yj4_members',
  'yj_point_settings',
  'yj_member_bonus_campaigns',
  'yj4_stores',
  'yj4_product_groups',
  'yj_promotion_rules',
  'yj_promotion_auto_arrival_options',
  'yj_linked_inventory_rules',
  'yj_customer_display_settings',
  'yj_notices',
  'yj_hq_tm_reminders',
  SELF_CHECKOUT_ACCOUNT_KEY,
  HQ_SPECIAL_TM_PERMISSIONS_KEY,
  'yj_tm_screen_categories',
  'yj_tm_quick_amount_keys',
  'yj_app_anybuy_orders',
  'yj_app_member_products',
  'yj_app_return_requests',
  'yj_app_anybuy_return_requests'
]);

const STORE_SCOPED_KEYS=new Set([
  'yj4_sales','yj4_audit','yj4_transfers','yj4_logistics','yj4_ec',
  'yj4_attendance','yj4_revenue','yj4_quality','yj4_waste','yj4_inventory_moves',
  'yj4_updates','yj4_held','yj4_deposits','yj4_handovers','yj4_logistics_schedules',
  'yj4_orders','yj_scheduler','yj_fresh_batches','yj_shifts','yj_x_accounts',
  'yj_system_settings','yj_stocktake_batches','yj_stocktake_month',
  'yj4_permissions','yj_permission_templates','yj_master_update_signal','yj_employee_history','yj_employee_blacklist'
]);

function productMasterRows(rows){
  return (Array.isArray(rows)?rows:[]).map(row=>{
    const out={...row};
    for(const k of PRODUCT_INVENTORY_FIELDS)delete out[k];
    return out;
  });
}
function productInventoryRows(rows){
  return (Array.isArray(rows)?rows:[]).map(row=>{
    const out={id:row.id||'',code:row.code||''};
    for(const k of PRODUCT_INVENTORY_FIELDS){
      if(Object.prototype.hasOwnProperty.call(row,k))out[k]=row[k];
    }
    return out;
  });
}
function mergeProductRows(master,inventory){
  const inv=Array.isArray(inventory)?inventory:[];
  return (Array.isArray(master)?master:[]).map(row=>{
    const x=inv.find(v=>(v.id&&v.id===row.id)||(v.code&&String(v.code)===String(row.code)))||{};
    return {
      ...row,
      stock:Number(x.stock??0),
      safeStock:Number(x.safeStock??x.safetyStock??0),
      safetyStock:Number(x.safetyStock??x.safeStock??0),
      maxStock:Number(x.maxStock??0),
      minOrderQty:Number(x.minOrderQty??0),
      maxOrderQty:Number(x.maxOrderQty??0),
      ...(Object.prototype.hasOwnProperty.call(x,'useMaxStock')?{useMaxStock:x.useMaxStock}:{}),
      ...(Object.prototype.hasOwnProperty.call(x,'safeStockPercent')?{safeStockPercent:x.safeStockPercent}:{}),
      ...(Object.prototype.hasOwnProperty.call(x,'safeAddPercent')?{safeAddPercent:x.safeAddPercent}:{}),
      ...(Object.prototype.hasOwnProperty.call(x,'safeFallbackPercent')?{safeFallbackPercent:x.safeFallbackPercent}:{}),
      ...(Object.prototype.hasOwnProperty.call(x,'triggerSafePercent')?{triggerSafePercent:x.triggerSafePercent}:{})
    };
  });
}
function founderRows(rows){return (Array.isArray(rows)?rows:[]).filter(x=>x?.role==='創辦人')}
function storeEmployeeRows(rows){return (Array.isArray(rows)?rows:[]).filter(x=>x?.role!=='創辦人')}
function mergeEmployeeRows(...groups){
  const out=[],seen=new Set();
  for(const group of groups){
    for(const x of (Array.isArray(group)?group:[])){
      const key=String(x?.id||x?.employeeCode||x?.account||'').trim();
      if(!key||seen.has(key))continue;
      seen.add(key);out.push(x);
    }
  }
  return out;
}

function clearCurrentStoreLocalData(){
  for(const key of STORE_SCOPED_KEYS)localStorage.removeItem(key);
  localStorage.removeItem(PRODUCT_KEY);
  localStorage.removeItem(EMPLOYEE_KEY);
}

function scopeStoreIdForKey(key){
  const k=String(key||'');
  if(k===PRODUCT_KEY||k===EMPLOYEE_KEY)return runtimeStoreId();
  return SHARED_KEYS.has(k)?'HQ':runtimeStoreId();
}

function shouldSyncKey(key){
  const k=String(key||'');
  if(!k||NEVER_SYNC.has(k))return false;
  return k.startsWith('yj4_') || k.startsWith('yj_');
}

function headers(){
  const c=getCloudConfig();
  return {
    apikey:c.anonKey,
    Authorization:`Bearer ${c.anonKey}`,
    'Content-Type':'application/json'
  };
}

async function request(path,opts={}){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const res=await fetch(`${c.url}/rest/v1/${path}`,{
    ...opts,
    headers:{...headers(),...(opts.headers||{})}
  });
  if(!res.ok){
    const text=await res.text().catch(()=> '');
    throw new Error(`Supabase ${res.status}: ${text||res.statusText}`);
  }
  if(res.status===204)return null;
  const text=await res.text();
  return text?JSON.parse(text):null;
}

export async function testCloudConnection(){
  const c=getCloudConfig();
  setStatus({state:'testing',message:'測試連線中…'});
  try{
    await request(`yijia_app_state?select=data_key&store_id=eq.${encodeURIComponent(c.storeId)}&limit=1`);
    setStatus({state:'online',message:'Supabase 連線正常',lastTestAt:new Date().toISOString(),error:''});
    return true;
  }catch(e){
    setStatus({state:'error',message:'Supabase 連線失敗',error:e.message,lastTestAt:new Date().toISOString()});
    throw e;
  }
}

export async function cloudPushKey(key,value){
  const k=String(key||'');
  if(!shouldSyncKey(k)||!cloudConfigured())return false;
  const storeId=runtimeStoreId();
  try{
    if(k===PRODUCT_KEY){
      const payload=[
        {store_id:'HQ',data_key:PRODUCT_KEY,data:productMasterRows(value),updated_at:new Date().toISOString()},
        {store_id:storeId,data_key:PRODUCT_INVENTORY_KEY,data:productInventoryRows(value),updated_at:new Date().toISOString()}
      ];
      await request('yijia_app_state?on_conflict=store_id,data_key',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(payload)
      });
    }else if(k===EMPLOYEE_KEY){
      const payload=[
        {store_id:storeId,data_key:EMPLOYEE_KEY,data:storeEmployeeRows(value),updated_at:new Date().toISOString()}
      ];
      const founders=founderRows(value);
      if(founders.length)payload.push({store_id:'HQ',data_key:FOUNDER_KEY,data:founders,updated_at:new Date().toISOString()});
      await request('yijia_app_state?on_conflict=store_id,data_key',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(payload)
      });
    }else{
      await request('yijia_app_state?on_conflict=store_id,data_key',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify([{
          store_id:scopeStoreIdForKey(k),
          data_key:k,
          data:value,
          updated_at:new Date().toISOString()
        }])
      });
    }
    setStatus({state:'online',message:`已同步 ${k===PRODUCT_KEY?'商品主檔＋本店庫存':k===EMPLOYEE_KEY?'本店員工':'資料'}`,storeId,lastPushAt:new Date().toISOString(),lastKey:k,error:''});
    return true;
  }catch(e){
    setStatus({state:'error',message:'雲端同步失敗（資料已保留本機）',error:e.message,lastKey:k});
    console.error('cloudPushKey',k,e);
    return false;
  }
}

export async function cloudPullKey(key){
  const k=String(key||'');
  if(!shouldSyncKey(k)||!cloudConfigured())return null;
  const storeId=runtimeStoreId();
  try{
    if(k===PRODUCT_KEY){
      const masterRows=await request(`yijia_app_state?select=data,updated_at&store_id=eq.HQ&data_key=eq.${PRODUCT_KEY}&order=updated_at.desc&limit=1`)||[];
      const invRows=await request(`yijia_app_state?select=data,updated_at&store_id=eq.${encodeURIComponent(storeId)}&data_key=eq.${PRODUCT_INVENTORY_KEY}&order=updated_at.desc&limit=1`)||[];
      const data=mergeProductRows(masterRows[0]?.data||[],invRows[0]?.data||[]);
      localStorage.setItem(PRODUCT_KEY,JSON.stringify(data));
      setStatus({state:'online',message:`已同步共用商品主檔＋${storeId}庫存`,storeId,lastPullAt:new Date().toISOString(),lastKey:k,error:''});
      return data;
    }
    if(k===SELF_CHECKOUT_ACCOUNT_KEY){
      const rows=await request(
        `yijia_app_state?select=store_id,data_key,data,updated_at&store_id=eq.HQ&data_key=eq.${encodeURIComponent(SELF_CHECKOUT_ACCOUNT_KEY)}&order=updated_at.desc&limit=1`
      )||[];
      const row=rows[0];
      if(!row){
        localStorage.removeItem(SELF_CHECKOUT_ACCOUNT_KEY);
        setStatus({state:'online',message:'HQ 尚未設定自助結帳帳號 99999',storeId,lastPullAt:new Date().toISOString(),lastKey:k,error:''});
        return null;
      }
      localStorage.setItem(SELF_CHECKOUT_ACCOUNT_KEY,JSON.stringify(row.data));
      setStatus({state:'online',message:'已同步 HQ 自助結帳帳號 99999',storeId,lastPullAt:new Date().toISOString(),lastKey:k,error:''});
      return row.data;
    }
    if(k===EMPLOYEE_KEY){
      const empRows=await request(`yijia_app_state?select=data,updated_at&store_id=eq.${encodeURIComponent(storeId)}&data_key=eq.${EMPLOYEE_KEY}&order=updated_at.desc&limit=1`)||[];
      const founder=await request(`yijia_app_state?select=data,updated_at&store_id=eq.HQ&data_key=eq.${FOUNDER_KEY}&order=updated_at.desc&limit=1`)||[];
      const stocktake=await request(`yijia_app_state?select=data,updated_at&store_id=eq.HQ&data_key=eq.${STOCKTAKE_PERSONNEL_KEY}&order=updated_at.desc&limit=1`)||[];
      const special=await request(`yijia_app_state?select=data,updated_at&store_id=eq.HQ&data_key=eq.${HQ_SPECIAL_PERSONNEL_KEY}&order=updated_at.desc&limit=1`)||[];
      const data=mergeEmployeeRows(founder[0]?.data||[],empRows[0]?.data||[],stocktake[0]?.data||[],special[0]?.data||[]);
      localStorage.setItem(EMPLOYEE_KEY,JSON.stringify(data));
      setStatus({state:'online',message:`已同步 ${storeId} 店舖人員＋HQ跨店人員`,storeId,lastPullAt:new Date().toISOString(),lastKey:k,error:''});
      return data;
    }
    const target=SHARED_KEYS.has(k)?'HQ':storeId;
    const rows=await request(
      `yijia_app_state?select=store_id,data_key,data,updated_at&store_id=eq.${encodeURIComponent(target)}&data_key=eq.${encodeURIComponent(k)}&order=updated_at.desc&limit=1`
    )||[];
    const row=rows[0];
    if(!row)return null;
    localStorage.setItem(k,JSON.stringify(row.data));
    setStatus({state:'online',message:`已同步 ${target}｜${k}`,storeId,lastPullAt:new Date().toISOString(),lastKey:k,error:''});
    return row.data;
  }catch(e){
    setStatus({state:'error',message:'雲端同步失敗（保留本機資料）',error:e.message,lastKey:k});
    console.error('cloudPullKey',k,e);
    return null;
  }
}

export async function cloudPushAll(){
  if(!cloudConfigured())throw new Error('請先設定 Supabase');
  const storeId=runtimeStoreId(),rows=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(!shouldSyncKey(key)||key===PRODUCT_KEY||key===EMPLOYEE_KEY)continue;
    try{
      rows.push({
        store_id:scopeStoreIdForKey(key),
        data_key:key,
        data:JSON.parse(localStorage.getItem(key)),
        updated_at:new Date().toISOString()
      });
    }catch{}
  }
  const products=JSON.parse(localStorage.getItem(PRODUCT_KEY)||'[]');
  if(Array.isArray(products)){
    rows.push({store_id:'HQ',data_key:PRODUCT_KEY,data:productMasterRows(products),updated_at:new Date().toISOString()});
    rows.push({store_id:storeId,data_key:PRODUCT_INVENTORY_KEY,data:productInventoryRows(products),updated_at:new Date().toISOString()});
  }
  const emps=JSON.parse(localStorage.getItem(EMPLOYEE_KEY)||'[]');
  if(Array.isArray(emps)){
    rows.push({store_id:storeId,data_key:EMPLOYEE_KEY,data:storeEmployeeRows(emps),updated_at:new Date().toISOString()});
    const founders=founderRows(emps);
    if(founders.length)rows.push({store_id:'HQ',data_key:FOUNDER_KEY,data:founders,updated_at:new Date().toISOString()});
  }
  if(!rows.length)return 0;
  setStatus({state:'syncing',message:`上傳 ${storeId} 門市資料中…`,storeId});
  for(let i=0;i<rows.length;i+=50){
    await request('yijia_app_state?on_conflict=store_id,data_key',{
      method:'POST',
      headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(rows.slice(i,i+50))
    });
  }
  setStatus({state:'online',message:`${storeId} 已上傳 ${rows.length} 組資料`,storeId,lastPushAllAt:new Date().toISOString(),error:''});
  return rows.length;
}

export async function cloudPullAll(){
  if(!cloudConfigured())throw new Error('請先設定 Supabase');
  const storeId=runtimeStoreId();
  setStatus({state:'syncing',message:`下載 ${storeId} 門市資料中…`,storeId});
  const shared=await request(`yijia_app_state?select=store_id,data_key,data,updated_at&store_id=eq.HQ&order=updated_at.asc`)||[];
  const storeRows=await request(`yijia_app_state?select=store_id,data_key,data,updated_at&store_id=eq.${encodeURIComponent(storeId)}&order=updated_at.asc`)||[];

  // 升級相容：保留切換前本機資料，若新架構 HQ／分店層尚未建立可自動搬移。
  const legacyLocalProducts=(()=>{try{return JSON.parse(localStorage.getItem(PRODUCT_KEY)||'[]')}catch{return []}})();
  const legacyLocalEmployees=(()=>{try{return JSON.parse(localStorage.getItem(EMPLOYEE_KEY)||'[]')}catch{return []}})();
  const legacyHQEmployees=shared.find(x=>String(x.data_key)===EMPLOYEE_KEY)?.data||[];
  const legacyStoreProducts=storeRows.find(x=>String(x.data_key)===PRODUCT_KEY)?.data||[];

  clearCurrentStoreLocalData();

  // 先套用真正的 HQ 共用資料。
  for(const row of shared){
    const k=String(row.data_key||'');
    if(SHARED_KEYS.has(k))localStorage.setItem(k,JSON.stringify(row.data));
  }

  // 商品：HQ 主檔 + 本店庫存層。舊版資料可自動轉成新架構。
  let master=shared.find(x=>String(x.data_key)===PRODUCT_KEY)?.data||[];
  let inventory=storeRows.find(x=>String(x.data_key)===PRODUCT_INVENTORY_KEY)?.data||[];
  const legacyProducts=(Array.isArray(legacyStoreProducts)&&legacyStoreProducts.length)?legacyStoreProducts:legacyLocalProducts;
  if((!Array.isArray(master)||!master.length)&&Array.isArray(legacyProducts)&&legacyProducts.length)master=productMasterRows(legacyProducts);
  if((!Array.isArray(inventory)||!inventory.length)&&Array.isArray(legacyProducts)&&legacyProducts.length)inventory=productInventoryRows(legacyProducts);

  // Alpha 2.95 / 7.21 相容修復：
  // 2.94 / 7.20 曾錯把 allowNegativeStock 放在各店庫存層。
  // 若 HQ 商品主檔尚無此欄位，就從舊庫存層／本機商品回填到共用主檔。
  master=(Array.isArray(master)?master:[]).map(row=>{
    if(Object.prototype.hasOwnProperty.call(row,'allowNegativeStock'))return row;
    const oldInv=(Array.isArray(inventory)?inventory:[]).find(v=>(v.id&&v.id===row.id)||(v.code&&String(v.code)===String(row.code)));
    const oldLocal=(Array.isArray(legacyProducts)?legacyProducts:[]).find(v=>(v.id&&v.id===row.id)||(v.code&&String(v.code)===String(row.code)));
    const recovered=oldInv?.allowNegativeStock===true||oldLocal?.allowNegativeStock===true;
    return {...row,allowNegativeStock:recovered};
  });

  localStorage.setItem(PRODUCT_KEY,JSON.stringify(mergeProductRows(master,inventory)));

  // 員工：只有本店員工同步；創辦人例外保存在 HQ。
  let founder=shared.find(x=>String(x.data_key)===FOUNDER_KEY)?.data||[];
  let storeEmployees=storeRows.find(x=>String(x.data_key)===EMPLOYEE_KEY)?.data||[];
  const legacyEmployeeSource=(Array.isArray(legacyHQEmployees)&&legacyHQEmployees.length)?legacyHQEmployees:legacyLocalEmployees;
  if((!Array.isArray(founder)||!founder.length)&&Array.isArray(legacyEmployeeSource))founder=founderRows(legacyEmployeeSource);
  if((!Array.isArray(storeEmployees)||!storeEmployees.length)&&Array.isArray(legacyEmployeeSource)){
    storeEmployees=legacyEmployeeSource.filter(x=>x?.role!=='創辦人'&&String(x?.storeCode||'001')===storeId);
  }
  localStorage.setItem(EMPLOYEE_KEY,JSON.stringify([...(Array.isArray(founder)?founder:[]),...(Array.isArray(storeEmployees)?storeEmployees:[])]));

  // 第一次遇到舊資料時，把新結構回寫一次，避免下次再依賴舊格式。
  const migrationPayload=[];
  const existingMaster=shared.find(x=>String(x.data_key)===PRODUCT_KEY)?.data||[];
  const masterNeedsNegativeFlagMigration=Array.isArray(master)&&master.some((row,i)=>{
    const old=(Array.isArray(existingMaster)?existingMaster:[]).find(v=>(v.id&&v.id===row.id)||(v.code&&String(v.code)===String(row.code)));
    return !old||!Object.prototype.hasOwnProperty.call(old,'allowNegativeStock')||old.allowNegativeStock!==row.allowNegativeStock;
  });
  if((!shared.some(x=>String(x.data_key)===PRODUCT_KEY)||masterNeedsNegativeFlagMigration)&&Array.isArray(master)&&master.length)migrationPayload.push({store_id:'HQ',data_key:PRODUCT_KEY,data:productMasterRows(master),updated_at:new Date().toISOString()});
  if(!storeRows.some(x=>String(x.data_key)===PRODUCT_INVENTORY_KEY)&&Array.isArray(inventory))migrationPayload.push({store_id:storeId,data_key:PRODUCT_INVENTORY_KEY,data:inventory,updated_at:new Date().toISOString()});
  if(!shared.some(x=>String(x.data_key)===FOUNDER_KEY)&&Array.isArray(founder)&&founder.length)migrationPayload.push({store_id:'HQ',data_key:FOUNDER_KEY,data:founder,updated_at:new Date().toISOString()});
  if(!storeRows.some(x=>String(x.data_key)===EMPLOYEE_KEY)&&Array.isArray(storeEmployees))migrationPayload.push({store_id:storeId,data_key:EMPLOYEE_KEY,data:storeEmployees,updated_at:new Date().toISOString()});
  if(migrationPayload.length){
    await request('yijia_app_state?on_conflict=store_id,data_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(migrationPayload)});
  }

  // 其餘全部只套用目前門市資料。
  for(const row of storeRows){
    const k=String(row.data_key||'');
    if(k===PRODUCT_INVENTORY_KEY||k===EMPLOYEE_KEY||SHARED_KEYS.has(k))continue;
    if(shouldSyncKey(k))localStorage.setItem(k,JSON.stringify(row.data));
  }

  const sharedCount=shared.filter(x=>SHARED_KEYS.has(String(x.data_key||''))).length;
  setStatus({state:'online',message:`${storeId} 已下載：共用主檔 ${sharedCount}／本店資料 ${storeRows.length}`,storeId,lastPullAt:new Date().toISOString(),error:''});
  return sharedCount+storeRows.length+2;
}

export async function cloudBootstrap(){
  if(!cloudConfigured())return {configured:false,pulled:0};
  try{
    const count=await cloudPullAll();
    return {configured:true,pulled:count};
  }catch(e){
    // 雲端失敗時仍然讓 POS 使用本機資料啟動
    console.error('cloudBootstrap',e);
    setStatus({state:'offline',message:'目前使用本機資料',error:e.message});
    return {configured:true,pulled:0,error:e.message};
  }
}

export async function cloudSyncNow(){
  // 手動雙向：先下載，再將當前本機整體上傳。
  // 建議首次設定時使用明確的 Push/Pull 按鈕，避免方向搞錯。
  const pulled=await cloudPullAll();
  const pushed=await cloudPushAll();
  return {pulled,pushed};
}



// Alpha 4.9 - POS 只讀同步總部商品活動，避免 POS 回寫覆蓋 HQ 活動資料
export async function cloudPullPromotionRules(){
  if(!cloudConfigured())return [];
  const rows=await request(
    `yijia_app_state?select=data,updated_at&store_id=eq.HQ&data_key=eq.yj_promotion_rules&order=updated_at.desc&limit=1`
  )||[];
  const data=Array.isArray(rows)&&rows[0]&&Array.isArray(rows[0].data)?rows[0].data:[];
  localStorage.setItem('yj_promotion_rules',JSON.stringify(data));
  setStatus({state:'online',message:`已同步 ${data.length} 筆總部商品活動`,storeId:runtimeStoreId(),lastPromotionPullAt:new Date().toISOString(),error:''});
  window.dispatchEvent(new CustomEvent('yj-promotion-sync',{detail:{count:data.length}}));
  return data;
}

export function cloudLocalConfigKey(){return CONFIG_KEY;}


// Alpha 3.8 - 億家物流批次／POS 到店簽到 RPC
export async function posFindLogisticsBatch(batchNo,deliveryType){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_get_logistics_batch',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_delivery_type:String(deliveryType||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001'
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function posReceiveLogisticsBatch(batchNo,deliveryType,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_receive_logistics_batch',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_delivery_type:String(deliveryType||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_received_by:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}


// Alpha 4.1 - 進貨條碼 / 自動入庫 / EC 取貨與進離店
export async function posResolveReceivingCode(code){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_resolve_receiving_code',{
    method:'POST',
    body:JSON.stringify({
      p_code:String(code||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001'
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}


export async function posGetInventoryReceiptDetails(batchNo){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const batch=String(batchNo||'').trim();
  if(!batch)return null;
  let receipt=null;
  try{
    const rows=await request(`inventory_receipts?select=*&batch_no=eq.${encodeURIComponent(batch)}&store_code=eq.${encodeURIComponent(String(c.storeId||'001').trim()||'001')}&limit=1`);
    receipt=Array.isArray(rows)?(rows[0]||null):null;
  }catch(_){
    const rows=await request(`inventory_receipts?select=*&batch_no=eq.${encodeURIComponent(batch)}&limit=1`);
    receipt=Array.isArray(rows)?(rows[0]||null):null;
  }
  if(!receipt)return null;
  const receiptId=String(receipt.id||receipt.receipt_id||'').trim();
  if(receiptId){
    try{
      const items=await request(`inventory_receipt_items?select=*&receipt_id=eq.${encodeURIComponent(receiptId)}&order=id.asc`);
      receipt={...receipt,items:Array.isArray(items)?items:[]};
    }catch(_){
      const items=await request(`inventory_receipt_items?select=*&receipt_id=eq.${encodeURIComponent(receiptId)}`);
      receipt={...receipt,items:Array.isArray(items)?items:[]};
    }
  }
  return receipt;
}

export async function posCompleteInventoryReceipt(batchNo,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_complete_inventory_receipt',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_received_by:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function posReceiveEcArrivalBatch(batchNo,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_receive_ec_arrival_batch',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_operator:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}



// Alpha 7.71 - POS 直接讀取雲端待簽到物流批次，避免只依賴本機訂購資料。
export async function posListPendingLogisticsBatches(limit=200){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/admin_list_logistics_batches',{
    method:'POST',
    body:JSON.stringify({p_store_code:String(c.storeId||'001').trim()||'001',p_limit:Number(limit)||200})
  });
  return (Array.isArray(rows)?rows:[]).filter(x=>{
    const st=String(x?.status||'pending').trim().toLowerCase();
    return ['pending','expected','transmitted','待簽到','未到店'].includes(st);
  });
}

// Alpha 7.71 - EC 退貨共同貨單離店。需搭配 POS_ALPHA_7_71_EC_BATCH_FLOW.sql。
export async function posLeaveEcReturnBatch(batchNo,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_leave_ec_return_batch',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_operator:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function posEcSummary(){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_ec_summary',{
    method:'POST',
    body:JSON.stringify({p_store_code:String(c.storeId||'001').trim()||'001'})
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function posSearchEcPickup(query){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_search_ec_pickup',{
    method:'POST',
    body:JSON.stringify({
      p_query:String(query||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001'
    })
  });
  return Array.isArray(rows)?rows:[];
}

export async function posPickupEcPackage(packageNo,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_pickup_ec_package',{
    method:'POST',
    body:JSON.stringify({
      p_package_no:String(packageNo||'').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_operator:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function posListEcFlow(kind='expected'){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_list_ec_flow',{
    method:'POST',
    body:JSON.stringify({
      p_kind:String(kind||'expected').trim(),
      p_store_code:String(c.storeId||'001').trim()||'001'
    })
  });
  return Array.isArray(rows)?rows:[];
}
