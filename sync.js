// 億家 Enterprise Alpha 2.1 - Supabase REST 雲端同步層
// 本機 localStorage 保留為離線快取；啟用後 save() 會非阻塞推送雲端。

const CONFIG_KEY='yj_cloud_config';
const STATUS_KEY='yj_cloud_status';
const SESSION_CONFIG_KEY='yj_cloud_session_config';
const FOUNDER_MGMT_SESSION_KEY='yj_eob_founder_mgmt_session';

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

function loadFounderMgmtSession(){
  try{return JSON.parse(localStorage.getItem(FOUNDER_MGMT_SESSION_KEY)||'{}')||{}}catch{return {}}
}
function saveFounderMgmtSession(data){
  const now=Math.floor(Date.now()/1000);
  const next={
    access_token:String(data?.access_token||''),
    refresh_token:String(data?.refresh_token||''),
    expires_at:Number(data?.expires_at||0)||now+Number(data?.expires_in||3600),
    user_id:String(data?.user?.id||data?.user_id||''),
    email:String(data?.user?.email||data?.email||'').trim().toLowerCase(),
    saved_at:new Date().toISOString()
  };
  if(next.access_token)localStorage.setItem(FOUNDER_MGMT_SESSION_KEY,JSON.stringify(next));
  return next;
}
function clearFounderMgmtSession(){localStorage.removeItem(FOUNDER_MGMT_SESSION_KEY)}
async function refreshFounderMgmtSession(session){
  if(!session?.refresh_token)return null;
  try{
    const data=await authRequest('token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
    if(!data?.access_token)return null;
    return saveFounderMgmtSession(data);
  }catch(_e){clearFounderMgmtSession();return null}
}
async function cachedFounderManagementToken(){
  const session=loadFounderMgmtSession();
  const now=Math.floor(Date.now()/1000);
  if(session?.access_token&&Number(session.expires_at||0)>now+90)return session.access_token;
  const refreshed=await refreshFounderMgmtSession(session);
  return refreshed?.access_token||'';
}


const PRODUCT_KEY='yj4_products';
const PRODUCT_INVENTORY_KEY='yj_store_product_inventory';
const EMPLOYEE_KEY='yj4_employees';
const FOUNDER_KEY='yj_founder_profile';
const STOCKTAKE_PERSONNEL_KEY='yj_stocktake_personnel_master';
const HQ_SPECIAL_PERSONNEL_KEY='yj_hq_special_personnel_master';
const SELF_CHECKOUT_ACCOUNT_KEY='yj_self_checkout_account';
const HQ_SPECIAL_TM_PERMISSIONS_KEY='yj_hq_special_tm_permissions';
const SC_EMPLOYEE_UPDATE_KEY='yj_sc_employee_master_update';

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
  'yj_product_group_codes',
  'yj_promotion_rules',
  'yj_promotion_auto_arrival_options',
  'yj_linked_inventory_rules',
  'yj_customer_display_settings',
  'yj_ordering_rules',
  'yj_notices',
  'yj_stocktake_personnel_auth',
  'yj_hq_tm_reminders',
  'yj_total_shelf_return_rules',
  'yj4_transfers',
  STOCKTAKE_PERSONNEL_KEY,
  HQ_SPECIAL_PERSONNEL_KEY,
  SC_EMPLOYEE_UPDATE_KEY,
  SELF_CHECKOUT_ACCOUNT_KEY,
  HQ_SPECIAL_TM_PERMISSIONS_KEY,
  'yj_tm_screen_categories',
  'yj_tm_quick_amount_keys',
  'yj_tm_anybuy_products',
  'yj_self_anybuy_categories',
  'yj_self_anybuy_products',
  'yj_logistics_receipt_visibility_settings'
]);

const STORE_SCOPED_KEYS=new Set([
  'yj4_sales','yj4_audit','yj4_logistics','yj4_ec',
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
function isStocktakePersonnelRow(x){return !!x&&(x.isStocktakePersonnel===true||String(x.role||'')==='盤點人員'||String(x.employmentType||'')==='盤點人員')}
function normalizeStocktakePersonnelRow(x){return {...x,isStocktakePersonnel:true,employmentType:'盤點人員',storeCode:String(x?.storeCode||'001')||'001',storeName:x?.storeName||'總店',active:x?.active!==false,loginEnabled:x?.loginEnabled!==false}}
function storeEmployeeRows(rows){return (Array.isArray(rows)?rows:[]).filter(x=>x?.role!=='創辦人'&&!isStocktakePersonnelRow(x))}
function stocktakePersonnelRows(rows){return (Array.isArray(rows)?rows:[]).filter(isStocktakePersonnelRow).map(normalizeStocktakePersonnelRow)}
function hqSpecialPersonnelRows(rows){return (Array.isArray(rows)?rows:[]).filter(x=>x&&(x.crossStore===true||x.isEngineerPersonnel===true||x.isHeadOfficePersonnel===true||['工程師','總部人員'].includes(String(x.role||''))))}
function mergeEmployeeRows(...groups){const out=[],seen=new Set();for(const group of groups){for(const x of (Array.isArray(group)?group:[])){const key=String(x?.id||x?.employeeCode||x?.account||'');if(!key||seen.has(key))continue;seen.add(key);out.push(x)}}return out}

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

async function authRequest(path,opts={}){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const res=await fetch(`${c.url}/auth/v1/${path}`,{
      ...opts,
      signal:opts.signal||controller.signal,
      headers:{apikey:c.anonKey,'Content-Type':'application/json',...(opts.headers||{})}
    });
    const text=await res.text().catch(()=> '');
    let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok)throw new Error(data?.msg||data?.error_description||data?.message||`Auth ${res.status}`);
    return data;
  }catch(e){
    if(e?.name==='AbortError')throw new Error('EOB 管理授權連線逾時，請稍後重試');
    throw e;
  }finally{clearTimeout(timer)}
}
async function resolveStaffLogin(username){
  try{
    const rows=await request('rpc/yijia_resolve_staff_login',{method:'POST',body:JSON.stringify({p_username:String(username||'').trim().toLowerCase()})});
    const row=Array.isArray(rows)?rows[0]:rows;
    if(!row?.login_email)throw new Error('not_found');
    return row.login_email;
  }catch(_err){
    throw new Error('找不到 EOB 管理登入帳號；請在創辦人的「EOB 帳號設定」先完成 EOB 登入資料');
  }
}
async function staffAccessToken(username,password){
  const email=await resolveStaffLogin(username);
  const data=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  if(!data?.access_token)throw new Error('Supabase Auth 驗證失敗');
  return data.access_token;
}
async function staffAccessTokenByEmail(email,password){
  const loginEmail=String(email||'').trim().toLowerCase();
  if(!loginEmail||!password)throw new Error('缺少 EOB 管理 Email 或密碼');
  const data=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email:loginEmail,password})});
  if(!data?.access_token)throw new Error('Supabase Auth 驗證失敗');
  return data.access_token;
}
async function founderManagementToken({callerAccount='',callerEmail='',callerPassword=''}){
  // Alpha 4.54：EOB 管理授權改成獨立的 Supabase session。
  // 先使用已保存的 founder access/refresh token；SC 登入帳號或密碼怎麼改都不影響同步。
  // 只有第一次尚未授權、session 失效或被撤銷時，才用 EOB Email/帳號＋EOB 密碼重新取得 session。
  const cached=await cachedFounderManagementToken();
  if(cached)return cached;
  let emailError=null,accountError=null;
  if(callerEmail&&callerPassword){
    try{
      const data=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email:String(callerEmail).trim().toLowerCase(),password:callerPassword})});
      if(data?.access_token){saveFounderMgmtSession(data);return data.access_token}
    }catch(err){emailError=err}
  }
  if(callerAccount&&callerPassword){
    try{
      const email=await resolveStaffLogin(callerAccount);
      const data=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email,password:callerPassword})});
      if(data?.access_token){saveFounderMgmtSession(data);return data.access_token}
    }catch(err){accountError=err}
  }
  throw new Error(emailError?.message||accountError?.message||'EOB 管理授權尚未建立；請在創辦人的 EOB 帳號設定輸入一次目前 EOB 管理密碼');
}
export async function requestStaffPasswordRecovery(username,redirectTo=''){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const email=await resolveStaffLogin(username);
  const c=getCloudConfig();
  const qs=redirectTo?`?redirect_to=${encodeURIComponent(redirectTo)}`:'';
  const res=await fetch(`${c.url}/auth/v1/recover${qs}`,{
    method:'POST',
    headers:{apikey:c.anonKey,'Content-Type':'application/json'},
    body:JSON.stringify({email})
  });
  const text=await res.text().catch(()=> '');
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.msg||data?.error_description||data?.message||`Auth ${res.status}`);
  return {ok:true,email};
}
export async function completeStaffPasswordRecovery(accessToken,newPassword){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  if(!accessToken)throw new Error('缺少密碼復原權杖');
  if(!newPassword||String(newPassword).length<6)throw new Error('新密碼至少 6 碼');
  const c=getCloudConfig();
  const res=await fetch(`${c.url}/auth/v1/user`,{
    method:'PUT',
    headers:{apikey:c.anonKey,Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({password:String(newPassword)})
  });
  const text=await res.text().catch(()=> '');
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.msg||data?.error_description||data?.message||`Auth ${res.status}`);
  return data;
}

export async function adminSyncStaffAccount({callerAccount='',callerEmail='',callerPassword='',employee,newPassword=''}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const token=await founderManagementToken({callerAccount,callerEmail,callerPassword});
  const c=getCloudConfig();
  const res=await fetch(`${c.url}/functions/v1/yijia-staff-admin`,{
    method:'POST',
    headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({action:'sync_employee',employee,newPassword})
  });
  const text=await res.text().catch(()=> '');
  let data=null;try{data=text?JSON.parse(text):null}catch{data={message:text}}
  if(!res.ok||data?.ok===false)throw new Error(data?.error||data?.message||`Edge Function ${res.status}`);
  // 創辦人若在這次同步修改自己的 EOB 密碼，立即以新密碼重建管理 session，避免下一次同步又要求舊密碼。
  if(newPassword&&String(employee?.role||'')==='創辦人'&&String(employee?.authEmail||employee?.email||'').trim()){
    try{
      const auth=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email:String(employee.authEmail||employee.email).trim().toLowerCase(),password:String(newPassword)})});
      if(auth?.access_token)saveFounderMgmtSession(auth);
    }catch(_e){clearFounderMgmtSession()}
  }
  return data;
}


export async function adminSyncStocktakeAccess({callerAccount='',callerEmail='',callerPassword='',username,canStocktake=false,canPersonnel=false,canUploadHq=false}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const token=await founderManagementToken({callerAccount,callerEmail,callerPassword}),c=getCloudConfig();
  const res=await fetch(`${c.url}/rest/v1/rpc/admin_set_stocktake_personnel_access`,{method:'POST',headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({p_username:String(username||'').trim().toLowerCase(),p_can_stocktake:!!canStocktake,p_can_personnel:!!canPersonnel,p_can_upload_hq:!!canUploadHq})});
  const text=await res.text().catch(()=> '');let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.message||data?.error||String(data||`RPC ${res.status}`));
  return data;
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
        {store_id:storeId,data_key:EMPLOYEE_KEY,data:storeEmployeeRows(value),updated_at:new Date().toISOString()},
        {store_id:'HQ',data_key:STOCKTAKE_PERSONNEL_KEY,data:stocktakePersonnelRows(value),updated_at:new Date().toISOString()},
        {store_id:'HQ',data_key:HQ_SPECIAL_PERSONNEL_KEY,data:hqSpecialPersonnelRows(value),updated_at:new Date().toISOString()}
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
    rows.push({store_id:'HQ',data_key:STOCKTAKE_PERSONNEL_KEY,data:stocktakePersonnelRows(emps),updated_at:new Date().toISOString()});
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
  // Alpha 3.92 migration: older stocktake personnel may still be parked inside store 001 employee data.
  // Read that legacy source even when the current browser is on another store, so cross-store login can recover before SC login.
  const headOfficeRows=storeId==='001'?storeRows:(await request(`yijia_app_state?select=store_id,data_key,data,updated_at&store_id=eq.001&data_key=eq.${EMPLOYEE_KEY}&order=updated_at.asc`)||[]);

  // 升級相容：保留切換前本機資料，若新架構 HQ／分店層尚未建立可自動搬移。
  const legacyLocalProducts=(()=>{try{return JSON.parse(localStorage.getItem(PRODUCT_KEY)||'[]')}catch{return []}})();
  const legacyLocalEmployees=(()=>{try{return JSON.parse(localStorage.getItem(EMPLOYEE_KEY)||'[]')}catch{return []}})();
  const legacyHQEmployees=shared.find(x=>String(x.data_key)===EMPLOYEE_KEY)?.data||[];
  const legacyStoreProducts=storeRows.find(x=>String(x.data_key)===PRODUCT_KEY)?.data||[];
  const legacyHeadOfficeEmployees=headOfficeRows.find(x=>String(x.data_key)===EMPLOYEE_KEY)?.data||[];

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
  let stocktakePersonnel=shared.find(x=>String(x.data_key)===STOCKTAKE_PERSONNEL_KEY)?.data||[];
  const legacyEmployeeSource=(Array.isArray(legacyHQEmployees)&&legacyHQEmployees.length)?legacyHQEmployees:((Array.isArray(legacyHeadOfficeEmployees)&&legacyHeadOfficeEmployees.length)?legacyHeadOfficeEmployees:legacyLocalEmployees);
  if((!Array.isArray(founder)||!founder.length)&&Array.isArray(legacyEmployeeSource))founder=founderRows(legacyEmployeeSource);
  if((!Array.isArray(storeEmployees)||!storeEmployees.length)&&Array.isArray(legacyEmployeeSource)){
    storeEmployees=legacyEmployeeSource.filter(x=>x?.role!=='創辦人'&&!isStocktakePersonnelRow(x)&&String(x?.storeCode||'001')===storeId);
  }
  if((!Array.isArray(stocktakePersonnel)||!stocktakePersonnel.length)&&Array.isArray(legacyEmployeeSource)){
    stocktakePersonnel=stocktakePersonnelRows(legacyEmployeeSource);
  }
  localStorage.setItem(EMPLOYEE_KEY,JSON.stringify([...(Array.isArray(founder)?founder:[]),...(Array.isArray(storeEmployees)?storeEmployees:[]),...(Array.isArray(stocktakePersonnel)?stocktakePersonnel:[])]));

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
  if(!shared.some(x=>String(x.data_key)===STOCKTAKE_PERSONNEL_KEY)&&Array.isArray(stocktakePersonnel)&&stocktakePersonnel.length)migrationPayload.push({store_id:'HQ',data_key:STOCKTAKE_PERSONNEL_KEY,data:stocktakePersonnel,updated_at:new Date().toISOString()});
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
    // Alpha 3.92：舊版若有尚未下傳 TM 的本機員工修改，先把 SC 員工主檔送上雲端，
    // 再下載合併，避免第一次升級時用雲端舊資料覆蓋 iPad 上較新的員工資料。
    try{
      const localEmployees=JSON.parse(localStorage.getItem(EMPLOYEE_KEY)||'[]');
      if(Array.isArray(localEmployees)&&localEmployees.length){
        const storeId=runtimeStoreId();
        const cloudStore=await request(`yijia_app_state?select=data&store_id=eq.${encodeURIComponent(storeId)}&data_key=eq.${EMPLOYEE_KEY}&limit=1`)||[];
        const cloudFounder=await request(`yijia_app_state?select=data&store_id=eq.HQ&data_key=eq.${FOUNDER_KEY}&limit=1`)||[];
        const cloudStocktake=await request(`yijia_app_state?select=data&store_id=eq.HQ&data_key=eq.${STOCKTAKE_PERSONNEL_KEY}&limit=1`)||[];
        const localStore=storeEmployeeRows(localEmployees),localFounder=founderRows(localEmployees),localStocktake=stocktakePersonnelRows(localEmployees);
        const cloudStoreCount=Array.isArray(cloudStore[0]?.data)?cloudStore[0].data.length:0;
        const cloudFounderCount=Array.isArray(cloudFounder[0]?.data)?cloudFounder[0].data.length:0;
        const cloudStocktakeCount=Array.isArray(cloudStocktake[0]?.data)?cloudStocktake[0].data.length:0;
        const shouldMigrate=localStorage.getItem('yj_employee_master_dirty')==='1'||localStore.length>cloudStoreCount||localFounder.length>cloudFounderCount||localStocktake.length>cloudStocktakeCount;
        if(shouldMigrate)await cloudPushKey(EMPLOYEE_KEY,localEmployees);
      }
    }catch(e){console.warn('employee pre-push migration failed',e)}
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

export function cloudLocalConfigKey(){return CONFIG_KEY;}


// Alpha 2.12 - 億家物流批次雲端連動
export async function adminListLogisticsBatches(limit=100){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_list_logistics_batches',{
    method:'POST',
    body:JSON.stringify({p_store_code:c.storeId||'001',p_limit:Number(limit)||100})
  })||[];
  // Alpha 5.26：舊 RPC 尚未回傳 delivery_date 時，直接由資料表補入最新值。
  try{
    const direct=await request(`logistics_batches?select=batch_no,delivery_date,delivery_run,group_key&store_code=eq.${encodeURIComponent(c.storeId||'001')}&limit=${Number(limit)||100}`);
    const byNo=new Map((Array.isArray(direct)?direct:[]).map(x=>[String(x.batch_no||''),x]));
    return (Array.isArray(rows)?rows:[]).map(x=>({...x,delivery_date:x.delivery_date||byNo.get(String(x.batch_no||''))?.delivery_date||null}));
  }catch(e){
    console.warn('logistics_batches delivery_date direct merge failed',e);
    return Array.isArray(rows)?rows:[];
  }
}

export async function adminCreateLogisticsBatch({deliveryType,deliveryDate='',deliveryRun='DEFAULT',source='backend',externalRef='',notes='',storeCode=''}={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_create_logistics_batch_grouped',{
    method:'POST',
    body:JSON.stringify({
      p_delivery_type:String(deliveryType||''),
      p_delivery_date:String(deliveryDate||''),
      p_delivery_run:String(deliveryRun||'DEFAULT').trim()||'DEFAULT',
      p_source:String(source||'backend'),
      p_external_ref:String(externalRef||'')||null,
      p_notes:String(notes||'')||null,
      p_store_code:String(storeCode||c.storeId||'001').trim()||'001'
    })
  })||[];
  return rows[0]||rows;
}


export async function adminBindEcGroupToBatch({batchNo,temperature}={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_bind_ec_group_to_batch',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:String(batchNo||'').trim(),
      p_temperature:String(temperature||'').trim(),
      p_store_code:c.storeId||'001'
    })
  })||[];
  return rows[0]||rows;
}



export async function adminDeleteInvalidLogisticsBatch(batchNo){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_delete_invalid_logistics_batch',{
    method:'POST',
    body:JSON.stringify({p_batch_no:String(batchNo||'').trim(),p_store_code:c.storeId||'001'})
  })||[];
  return rows[0]||rows;
}

// Alpha 2.14 - 表定到店時間雲端共用
export async function adminListLogisticsSchedules(storeCode=''){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  return await request('rpc/admin_list_logistics_schedules',{
    method:'POST',
    body:JSON.stringify({p_store_code:String(storeCode||c.storeId||'001').trim()||'001'})
  })||[];
}

export async function adminUpsertLogisticsSchedule({deliveryType,scheduledTime,note='',storeCode=''}={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_upsert_logistics_schedule',{
    method:'POST',
    body:JSON.stringify({
      p_delivery_type:String(deliveryType||''),
      p_scheduled_time:String(scheduledTime||''),
      p_note:String(note||''),
      p_store_code:String(storeCode||c.storeId||'001').trim()||'001'
    })
  })||[];
  return rows[0]||rows;
}


// Alpha 2.17 - 後台訂購 ↔ 物流批次 ↔ 進貨連動
export async function adminTransmitOrderToLogistics(order,operatorName=''){
  const c=getCloudConfig();
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_transmit_order_to_logistics_grouped',{
    method:'POST',
    body:JSON.stringify({
      p_order_no:String(order?.id||'').trim(),
      p_order_type:String(order?.type||'').trim(),
      p_delivery_type:String(order?.deliveryType||'常溫').trim(),
      p_delivery_date:String(order?.deliveryDate||'').trim(),
      p_delivery_run:String(order?.deliveryRun||'DEFAULT').trim()||'DEFAULT',
      p_note:String(order?.note||'').trim(),
      p_items:Array.isArray(order?.items)?order.items:[],
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_operator:String(operatorName||'').trim()
    })
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function adminGetOrderReceiptByBatch(batchNo){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const rows=await request('rpc/pos_get_order_receipt_by_batch',{
    method:'POST',
    body:JSON.stringify({p_batch_no:String(batchNo||'').trim()})
  });
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function adminSetLogisticsDeliveryDate(batchNo,deliveryDate){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const no=String(batchNo||'').trim();
  const date=String(deliveryDate||'').trim();
  if(!no||!date)return false;
  await request('rpc/pos_set_logistics_delivery_date',{
    method:'POST',
    body:JSON.stringify({
      p_batch_no:no,
      p_delivery_date:date
    })
  });
  return true;
}


// Alpha 2.18 - 商品進貨單 + EC 雲端管理
export async function adminListEcPackages(limit=300){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  return await request('rpc/admin_list_ec_packages',{
    method:'POST',body:JSON.stringify({p_store_code:c.storeId||'001',p_limit:Number(limit)||300})
  })||[];
}

export async function adminCreateEcPackage(payload={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_create_ec_package',{
    method:'POST',body:JSON.stringify({
      p_recipient_name:String(payload.recipientName||''),
      p_recipient_phone:String(payload.recipientPhone||''),
      p_temperature:String(payload.temperature||'ambient'),
      p_store_code:String(c.storeId||'001'),
      p_store_name:String(payload.storeName||'總店'),
      p_expected_arrival_at:payload.expectedArrivalAt||null,
      p_batch_no:String(payload.batchNo||'')||null,
      p_route_code:String(payload.routeCode||'')||null,
      p_pickup_code:String(payload.pickupCode||'')||null,
      p_sender_name:String(payload.senderName||'')||null,
      p_sender_phone:String(payload.senderPhone||'')||null,
      p_value:Number(payload.value||0),
      p_notes:String(payload.notes||'')||null
    })
  })||[];
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function adminCreateEcReturnBatch(temperature,operatorName=''){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_create_ec_return_batch',{
    method:'POST',body:JSON.stringify({p_temperature:String(temperature||''),p_store_code:c.storeId||'001',p_operator:String(operatorName||'')})
  })||[];
  return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function adminListEcReturnBatches(limit=100){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  return await request('rpc/admin_list_ec_return_batches',{
    method:'POST',body:JSON.stringify({p_store_code:c.storeId||'001',p_limit:Number(limit)||100})
  })||[];
}

export async function adminSyncInventoryReceiptItems(batchNo=''){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  try{
    const rows=await request('rpc/admin_sync_inventory_receipt_items',{
      method:'POST',
      body:JSON.stringify({
        p_batch_no:String(batchNo||'').trim()||null,
        p_store_code:String(c.storeId||'001').trim()||'001'
      })
    });
    return Array.isArray(rows)?(rows[0]??null):rows;
  }catch(e){
    // 3.44 SQL 尚未更新時不阻斷明細讀取；仍可直接讀現有 receipt/items。
    console.warn('admin_sync_inventory_receipt_items unavailable',e);
    return null;
  }
}

export async function adminGetInventoryReceiptByBatch(batchNo){
 const batch=String(batchNo||'').trim();
 if(!batch)return null;
 let receipt=null;

 // 先嘗試 3.44 統一 RPC；舊環境沒有也不阻斷。
 try{await adminSyncInventoryReceiptItems(batch)}catch{}

 // 優先讀目前資料庫 RPC。
 for(const fn of ['admin_get_inventory_receipt','admin_get_inventory_receipt_by_batch','pos_get_order_receipt_by_batch']){
  try{
   const rows=await request(`rpc/${fn}`,{
    method:'POST',
    body:JSON.stringify({p_batch_no:batch})
   });
   const row=Array.isArray(rows)?(rows[0]||null):rows;
   if(row){receipt=row;break}
  }catch(e){console.warn(`${fn} unavailable`,e)}
 }

 // RPC 都沒有時直接讀主檔。
 if(!receipt){
  try{
   const rows=await request(`inventory_receipts?select=*&batch_no=eq.${encodeURIComponent(batch)}&limit=1`);
   receipt=Array.isArray(rows)?(rows[0]||null):null;
  }catch(e){console.error('inventory_receipts fallback failed',e)}
 }
 if(!receipt)return null;

 // Alpha 5.26：即使 RPC 有回資料，也再以主檔補上新欄位，避免舊 RPC 缺 delivery_date。
 try{
  const directRows=await request(`inventory_receipts?select=*&batch_no=eq.${encodeURIComponent(batch)}&limit=1`);
  const directRow=Array.isArray(directRows)?(directRows[0]||null):null;
  if(directRow)receipt={...receipt,...directRow,items:Array.isArray(receipt.items)?receipt.items:directRow.items};
 }catch(e){console.warn('inventory_receipts master merge failed',e)}

 // 關鍵：所有來源的貨單都一律再讀 inventory_receipt_items，不再假設 RPC 已經內嵌 items。
 const receiptId=String(receipt.id||receipt.receipt_id||'').trim();
 if(receiptId){
  try{
   const items=await request(`inventory_receipt_items?select=*&receipt_id=eq.${encodeURIComponent(receiptId)}&order=id.asc`);
   if(Array.isArray(items))receipt={...receipt,items};
  }catch(e){
   // 有些舊 schema 沒有 id 排序欄位，改成不排序再取一次。
   try{
    const items=await request(`inventory_receipt_items?select=*&receipt_id=eq.${encodeURIComponent(receiptId)}`);
    if(Array.isArray(items))receipt={...receipt,items};
   }catch(e2){console.warn('inventory_receipt_items direct read failed',e2)}
  }
 }
 return receipt;
}

export async function adminListInventoryReceipts(limit=100){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_list_inventory_receipts',{
    method:'POST',body:JSON.stringify({p_store_code:c.storeId||'001',p_limit:Number(limit)||100})
  })||[];
  // Alpha 5.26：舊 RPC 尚未包含 delivery_date 時，以 inventory_receipts 主檔補齊。
  try{
    const direct=await request(`inventory_receipts?select=receipt_no,batch_no,delivery_date&store_code=eq.${encodeURIComponent(c.storeId||'001')}&limit=${Number(limit)||100}`);
    const byBatch=new Map((Array.isArray(direct)?direct:[]).map(x=>[String(x.batch_no||''),x]));
    return (Array.isArray(rows)?rows:[]).map(x=>({...x,delivery_date:x.delivery_date||byBatch.get(String(x.batch_no||''))?.delivery_date||null}));
  }catch(e){
    console.warn('inventory_receipts delivery_date direct merge failed',e);
    return Array.isArray(rows)?rows:[];
  }
}


// Alpha 2.46 - 活動商品自動到店：物流 + 進貨單/庫存同步（不建立訂購單）
export async function adminCreatePromotionAutoArrival(payload={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const rows=await request('rpc/admin_create_promotion_auto_arrival_grouped',{
    method:'POST',body:JSON.stringify({
      p_activity_name:String(payload.activityName||''),
      p_delivery_type:String(payload.deliveryType||''),
      p_delivery_date:String(payload.deliveryDate||''),
      p_delivery_run:String(payload.deliveryRun||'DEFAULT').trim()||'DEFAULT',
      p_external_ref:String(payload.externalRef||''),
      p_notes:String(payload.notes||''),
      p_product_id:String(payload.productId||'')||null,
      p_product_code:String(payload.productCode||'')||null,
      p_barcode:String(payload.barcode||'')||null,
      p_product_name:String(payload.productName||''),
      p_supplier_code:String(payload.supplierCode||''),
      p_supplier_name:String(payload.supplierName||''),
      p_qty:Number(payload.qty||0),
      p_store_code:String(payload.storeCode||c.storeId||'001'),
      p_operator:String(payload.operator||'')
    })
  })||[];
  return Array.isArray(rows)?(rows[0]||null):rows;
}


// Admin Alpha 3.47 — 後台進貨驗收
export async function adminAcceptInventoryReceipt(batchNo,items=[],operatorName=''){
 if(!cloudConfigured())throw new Error('Supabase 尚未設定');
 const c=getCloudConfig();
 const rows=await request('rpc/admin_accept_inventory_receipt',{
  method:'POST',
  body:JSON.stringify({
   p_batch_no:String(batchNo||'').trim(),
   p_store_code:String(c.storeId||'001').trim()||'001',
   p_operator:String(operatorName||''),
   p_items:Array.isArray(items)?items:[]
  })
 });
 return Array.isArray(rows)?(rows[0]||null):rows;
}

export async function adminSendEobFindSignal(payload){
  if(!cloudConfigured())throw new Error('尚未設定 Supabase');
  const body={
    p_store_code:String(payload?.storeCode||runtimeStoreId()||'001'),
    p_store_name:String(payload?.storeName||''),
    p_sender_name:String(payload?.by||''),
    p_sender_account:String(payload?.account||''),
    p_nonce:String(payload?.nonce||('EOBF-'+Date.now()))
  };
  try{
    const data=await request('rpc/yijia_eob_send_find_signal',{method:'POST',body:JSON.stringify(body)});
    return data;
  }catch(e){
    // SQL 尚未部署時維持舊 app_state 寫入相容。
    const ok=await cloudPushKey('yj_eob_find_signal',payload);
    if(!ok)throw e;
    return {ok:true,fallback:true};
  }
}


// SC Alpha 4.28 - EOB 盤點雲端接通
export async function adminListEobStocktakes(limit=100){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  // Alpha 4.57：admin_list_eob_stocktakes 只授權 authenticated。
  // 舊版錯把 anon key 當 Bearer token 呼叫，因此 SQL Editor 看得到資料，SC 卻永遠讀不到。
  // 這裡改用已保存的創辦人 EOB 管理 session；SC 帳號密碼仍與 EOB 完全獨立。
  const token=await cachedFounderManagementToken();
  if(!token)throw new Error('EOB 管理授權尚未建立或已失效，請先在創辦人的「EOB 帳號設定」完成一次 EOB 管理授權');
  const res=await fetch(`${c.url}/rest/v1/rpc/admin_list_eob_stocktakes`,{
    method:'POST',
    headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      p_store_code:String(c.storeId||'001').trim()||'001',
      p_limit:Math.max(1,Math.min(300,Number(limit)||100))
    })
  });
  const text=await res.text().catch(()=> '');
  let rows=null;try{rows=text?JSON.parse(text):[]}catch{rows=[]}
  if(!res.ok)throw new Error(rows?.message||rows?.error_description||rows?.hint||text||`Supabase ${res.status}`);
  return Array.isArray(rows)?rows:[];
}


// SC Alpha 4.58 - 勾選 EOB 盤點資料上傳總部並標記完成
export async function adminUploadEobStocktakesHq(operationIds,operatorName='SC'){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const ids=(Array.isArray(operationIds)?operationIds:[]).map(x=>String(x||'').trim()).filter(Boolean);
  if(!ids.length)throw new Error('沒有選擇盤點資料');
  const c=getCloudConfig();
  const token=await cachedFounderManagementToken();
  if(!token)throw new Error('EOB 管理授權尚未建立或已失效，請先完成創辦人 EOB 管理授權');
  const res=await fetch(`${c.url}/rest/v1/rpc/admin_upload_eob_stocktakes_hq`,{
    method:'POST',
    headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_operation_ids:ids,p_operator:String(operatorName||'SC')})
  });
  const text=await res.text().catch(()=> '');
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.message||data?.error_description||data?.hint||text||`Supabase ${res.status}`);
  return data;
}

// SC Alpha 4.55 - 創辦人更正 EOB 誤選盤點類型。
export async function adminCorrectEobStocktakeType(operationId,stocktakeType='personnel'){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const token=await cachedFounderManagementToken();
  if(!token)throw new Error('EOB 管理授權尚未建立或已失效，請先在創辦人 EOB 帳號設定完成一次授權');
  const res=await fetch(`${c.url}/rest/v1/rpc/admin_correct_eob_stocktake_type`,{
    method:'POST',
    headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_operation_id:String(operationId||''),p_stocktake_type:String(stocktakeType||'personnel')})
  });
  const text=await res.text().catch(()=> '');
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.message||data?.error_description||data?.hint||text||`Supabase ${res.status}`);
  return data;
}


// SC Alpha 5.68 - App 點數兌換設定（創辦人授權管理）
async function pointRewardAdminRpc(name,body={}){
  if(!cloudConfigured())throw new Error('Supabase 尚未設定');
  const c=getCloudConfig();
  const token=await cachedFounderManagementToken();
  if(!token)throw new Error('點數兌換設定需要創辦人管理授權；請先在創辦人的 EOB 帳號設定完成一次管理授權');
  const res=await fetch(`${c.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await res.text().catch(()=> '');let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(data?.message||data?.error_description||data?.hint||String(data||`Supabase ${res.status}`));
  return data;
}
export async function adminListPointRewards(){const x=await pointRewardAdminRpc('admin_list_point_rewards',{});return Array.isArray(x)?x:(Array.isArray(x?.items)?x.items:[])}
export async function adminGetPointRewardSettings(){return await pointRewardAdminRpc('admin_get_point_reward_settings',{})||{rewardEnabled:false}}
export async function adminSetPointRewardEnabled(enabled){return await pointRewardAdminRpc('admin_set_point_reward_enabled',{p_enabled:!!enabled})}
export async function adminUpsertPointReward(x={}){return await pointRewardAdminRpc('admin_upsert_point_reward',{p_id:x.id||null,p_reward_code:String(x.rewardCode||''),p_name:String(x.name||''),p_description:String(x.description||'')||null,p_reward_type:String(x.rewardType||'other'),p_points_cost:Number(x.pointsCost||0),p_stock_limit:x.stockLimit==null?null:Number(x.stockLimit),p_per_member_limit:Number(x.perMemberLimit||0),p_image_url:String(x.imageUrl||'')||null,p_payload:x.payload&&typeof x.payload==='object'?x.payload:{},p_starts_at:x.startsAt||null,p_ends_at:x.endsAt||null,p_active:!!x.active,p_sort_order:Number(x.sortOrder||0)})}
export async function adminDeletePointReward(id){return await pointRewardAdminRpc('admin_delete_point_reward',{p_id:String(id||'')})}


// SC Alpha 5.69 — 億家Pay正式設定／帳本查詢（共用 App 正式資料表）
export async function scGetYijiaPaySettings(){return await request('rpc/sc_get_yijiapay_settings',{method:'POST',body:'{}'});}
export async function scUpdateYijiaPaySettings(enabled,cashReloadEnabled,monthlyLimit){return await request('rpc/sc_update_yijiapay_settings',{method:'POST',body:JSON.stringify({p_enabled:!!enabled,p_cash_reload_enabled:!!cashReloadEnabled,p_monthly_cash_reload_limit:Number(monthlyLimit||0)})});}
export async function scListYijiaPayPayments(limit=200){return await request('rpc/sc_list_yijiapay_payments',{method:'POST',body:JSON.stringify({p_limit:Number(limit||200)})});}
export async function scListYijiaPayReloads(limit=200){return await request('rpc/sc_list_yijiapay_reloads',{method:'POST',body:JSON.stringify({p_limit:Number(limit||200)})});}
export async function scListYijiaPayRefunds(limit=200){return await request('rpc/sc_list_yijiapay_refunds',{method:'POST',body:JSON.stringify({p_limit:Number(limit||200)})});}
export async function scListYijiaPayLedger(limit=500){return await request('rpc/sc_list_yijiapay_ledger',{method:'POST',body:JSON.stringify({p_limit:Number(limit||500)})});}
