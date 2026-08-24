// TM Alpha 8.90: unified employee-number clocking + HQ cross-store personnel + Z Mode separation; based on Alpha 8.35.
import{K,load,save,uid,money,seed}from'./db.js';
import{currentUser,employees,login,logout,audit}from'./core.js';
import{state,products,add,qty,setQty,totals,checkout,itemActivePromotions,correctSale,closeSale,makeReturnCode,findSaleByReturnCode,beginCorrectionMode,endCorrectionMode,beginExchangeMode,endExchangeMode,exchangeAmounts}from'./pos.js';
import{logisticsTypes,ecTypes,logistics,recordCloudLogisticsArrival,attendance,addEC,cancelEC,updateECStatus,createTransfer,receiveTransfer}from'./ops.js';
import{collect,correct,z,autoCloseBusinessDay}from'./revenue.js';
import{code128Svg,code128Bits,systemBarcode,ensureBarcode}from'./barcode.js';

import{getCloudConfig,setCloudConfig,cloudConfigured,cloudStatus,testCloudConnection,cloudPushAll,cloudPullAll,cloudPullKey,cloudPushKey,cloudBootstrap,cloudPullPromotionRules,posFindLogisticsBatch,posReceiveLogisticsBatch,posResolveReceivingCode,posGetInventoryReceiptDetails,posCompleteInventoryReceipt,posReceiveEcArrivalBatch,posListPendingLogisticsBatches,posLeaveEcReturnBatch,posEcSummary,posSearchEcPickup,posPickupEcPackage,posListEcFlow}from'./sync.js';

let posCategory='全部';

function tmDisplayVersion(){
 const raw=String(window.APP_VERSION?`5.5.0-alpha${window.APP_VERSION}`:(window.YIJIA_VERSION||`5.5.0-alpha${window.YJ_VERSION||'8.65'}`));
 const m=raw.match(/^(\d+\.\d+\.\d+)-alpha(\d+(?:\.\d+)?)$/i);
 return m?`v${m[1]} Alpha ${m[2]}`:`v${raw}`;
}

function isPosServiceItem(x){return !!(x&&(x.ecPickup===true||x.collectionPayment===true||x.billPayment===true||x.utilityPayment===true||['bill','utility-bill','ec-pickup','collection'].includes(String(x.serviceType||''))))}
function currentServicePaymentMethod(){const rows=(state.cart||[]).filter(isPosServiceItem);const methods=[...new Set(rows.map(x=>String(x.servicePaymentMethod|| (x.ecPickup?'現金':'現金')).trim()).filter(Boolean))];return methods.length===1?methods[0]:(methods.length?'現金':'')}
const app=document.querySelector('#app'),loginDialog=document.querySelector('#loginDialog'),genericDialog=document.querySelector('#genericDialog');
const pages=[['home','🏠','首頁'],['products','📦','商品管理'],['promotions','🏷️','總部商品活動'],['ordering','🛒','訂購管理'],['inventory','📊','庫存管理'],['quality','🏷️','品保／時控'],['logistics','🚚','物流管理'],['ec','📮','EC管理'],['transfers','🔄','轉貨管理'],['attendance','🕘','出勤管理'],['members','👥','會員管理'],['employees','👤','員工管理'],['permissions','🔐','權限管理'],['stores','🏪','門市管理'],['transactions','🧾','交易管理'],['revenue','📈','營收管理'],['operations','📊','營運情報'],['updates','⬇️','更新中心'],['audit','📋','Audit Log'],['system-settings','☁️','雲端與更新']];

const ROLE_LIST=['創辦人','店長','副店長','正職','兼職','總部支援'];
const ROLE_RANK={'兼職':1,'正職':2,'副店長':3,'店長':4,'創辦人':5,'總部支援':0};

const PERMISSION_CATEGORIES={
 pos:{label:'TM／前台',icon:'🧾',items:{
  posAccess:'進入 POS',posCheckout:'結帳',posDiscount:'折扣',posManualPrice:'手動改價',
  posCancel:'取消交易',manualClose:'手動日結',attendanceClock:'打卡',
  productLookup:'商品查詢',memberLookup:'會員查詢',transactionPrint:'列印交易',
  wasteCreate:'廢棄登錄',timeLookup:'時控查詢',deposit:'投庫',handover:'交班',
  logisticsSign:'物流簽到',transferInPos:'轉貨單轉入'
 }},
 products:{label:'商品管理',icon:'📦',items:{
  productsAccess:'進入商品管理',productCreate:'新增商品',productEdit:'修改商品',
  productDelete:'刪除商品',productGroup:'品群分類',productPrice:'修改售價',
  productCost:'修改成本',productBarcode:'條碼管理',productPrint:'商品列印'
 }},
 inventory:{label:'庫存管理',icon:'📊',items:{
  inventoryAccess:'進入庫存管理',inventoryChange:'庫存異動',
  inventoryCount:'盤點',inventoryPrint:'庫存列印'
 }},
 quality:{label:'品保／時控',icon:'🏷️',items:{
  qualityAccess:'進入品保／時控',timeCreate:'新增時控',timeEdit:'修改時控',
  timeDelete:'刪除時控',timePrint:'列印時控貼紙',wasteQuery:'廢棄查詢'
 }},
 ordering:{label:'訂購管理',icon:'🛒',items:{
  orderingAccess:'進入訂購管理',orderLedger:'台帳訂購',orderFos:'FOS 鮮食訂購',
  orderSupplies:'備品訂購',orderSpecial:'特殊用品訂購',orderGroup:'品群訂購',
  orderPrint:'訂購列印',orderDelete:'刪除訂購單'
 }},
 ec:{label:'EC 管理',icon:'📮',items:{
  ecAccess:'進入 EC 管理',ecCreate:'新增包裹',ecPrint:'列印標籤',
  ecAbnormal:'異常查詢',ecCancel:'取消寄件'
 }},
 logistics:{label:'物流管理',icon:'🚚',items:{
  logisticsAccess:'進入物流管理',logisticsQuery:'預定到店查詢',
  logisticsEdit:'到店時間設定'
 }},
 transfers:{label:'轉貨管理',icon:'🔄',items:{
  transfersAccess:'進入轉貨管理',transferOut:'轉貨轉出',
  transferIn:'轉貨轉入',transferPrint:'轉貨單列印'
 }},
 stores:{label:'門市管理',icon:'🏪',items:{
  storesAccess:'進入門市管理',storeAdd:'新增門市',
  storeCode:'轉換店號',storeQuery:'查詢其他門市'
 }},
 employees:{label:'員工管理',icon:'👤',items:{
  employeesAccess:'進入員工管理',employeeCreate:'新增員工',
  employeeEdit:'修改員工',employeeCredentials:'設定帳號密碼',
  employeeStatus:'修改人員狀態',employeeHistory:'查看員工歷程',
  blacklistQuery:'黑名／離職查詢',blacklistManage:'黑名單管理'
 }},
 system:{label:'系統管理',icon:'⚙️',items:{
  permissionsAccess:'進入權限管理',permissionEdit:'修改下級權限',
  revenueAccess:'營收管理',revenueCorrect:'營收修正',zCreate:'產生 Z 帳',
  reportPrint:'列印報表',systemSettingsAccess:'設定',transactionBackAccess:'後台交易查詢',transactionBackCorrect:'後台交易更正／退貨',transactionBackVoid:'後台交易作廢',auditAccess:'Audit Log',
  attendanceAccess:'出勤管理',attendanceEdit:'工時修改',
  attendancePrint:'出勤列印'
 }}
};

function allPermissionKeys(){
 return Object.values(PERMISSION_CATEGORIES).flatMap(c=>Object.keys(c.items));
}

function roleTemplate(role){
 const all=allPermissionKeys();
 if(role==='創辦人')return Object.fromEntries(all.map(k=>[k,true]));
 const sets={
  店長:all.filter(k=>k!=='permissionEdit'),
  副店長:all.filter(k=>!['permissionEdit','storeAdd','storeCode'].includes(k)),
  正職:['posAccess','posCheckout','attendanceClock','productLookup','memberLookup',
      'transactionPrint','wasteCreate','timeLookup','deposit','handover','logisticsSign',
      'inventoryAccess','qualityAccess','orderingAccess','orderLedger','orderFos',
      'orderSupplies','orderSpecial','orderGroup'],
  兼職:['posAccess','posCheckout','attendanceClock','productLookup','memberLookup',
      'transactionPrint','wasteCreate','timeLookup','logisticsSign'],
  總部支援:[]
 };
 return Object.fromEntries(all.map(k=>[k,(sets[role]||[]).includes(k)]));
}

function permissionStore(){return load(K.permissions,{})}
const HQ_SPECIAL_TM_PERMISSIONS_KEY='yj_hq_special_tm_permissions';
function hqSpecialTmPermissions(){return load(HQ_SPECIAL_TM_PERMISSIONS_KEY,{})||{}}

function userPermissions(user){
 if(!user)return {};
 if(user.role==='創辦人')return roleTemplate('創辦人');
 const store=permissionStore(),hq=hqSpecialTmPermissions();
 let special=hq[user.id]||null;
 if(!special){
  const code=String(user.employeeCode||user.employeeNo||user.account||'').trim().replace(/[\s-]+/g,'');
  special=Object.values(hq).find(x=>String(x?.employeeCode||x?.account||'').trim().replace(/[\s-]+/g,'')===code)||null;
 }
 return {...roleTemplate(user.role),...(store[user.id]||{}),...(special||{})};
}

function canManageTarget(actor,target){
 if(!actor||!target||actor.id===target.id)return false;
 if(actor.role==='創辦人')return true;
 if(actor.role==='總部支援')return false;
 if(target.role==='總部支援')return false;
 return (ROLE_RANK[actor.role]||0)>(ROLE_RANK[target.role]||0);
}

function canGrantPermission(actor,key){
 if(!actor)return false;
 if(actor.role==='創辦人')return true;
 return userPermissions(actor)[key]===true;
}

document.querySelector('#nav').innerHTML=pages.map(x=>`<button class="nav-item" data-nav="${x[0]}">${x[1]}<span>${x[2]}</span></button>`).join('');
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const nowInput=v=>new Date(new Date(v).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
function clock(){const d=new Date(),w='日一二三四五六'[d.getDay()];return{date:`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}（${w}）`,time:d.toLocaleTimeString('zh-TW',{hour12:false})}}
function currentStoreCode(){
 const raw=localStorage.getItem('yj_store_no');
 if(raw==null||raw==='')return '001';
 try{
  const parsed=JSON.parse(raw);
  return String(parsed||'001').trim()||'001';
 }catch{
  // 相容 Alpha 2.90 / 7.16 曾寫入的純文字 002、003 等舊格式。
  return String(raw||'001').replace(/^"|"$/g,'').trim()||'001';
 }
}
function store(){
 const rows=load(K.stores,[]);
 return rows.find(x=>String(x.code)===currentStoreCode())||rows[0]||{name:'總店',code:'001'};
}
function setCurrentStore(x){
 if(!x)return false;
 const code=String(x.code||'001').trim()||'001';
 const name=String(x.name||'億家門市').trim()||'億家門市';
 // 統一使用 save() 的 JSON 格式，避免 002 被 load() 判定為無效 JSON。
 save('yj_store_no',code);
 save('yj_store_name',name);
 return currentStoreCode()===code;
}
function tmCrossStoreEmployee(x){return !!(x&&(x.crossStore===true||x.isStocktakePersonnel===true||x.isEngineerPersonnel===true||x.isHeadOfficePersonnel===true||['盤點人員','工程師','總部人員'].includes(String(x.role||''))))}
function storeEmployees(code=currentStoreCode()){
 return employees().filter(x=>x.role==='創辦人'||tmCrossStoreEmployee(x)||String(x.storeCode||'001')===String(code));
}
let pendingLoginMode='front';
let posLockMode=false;
const POS_SHIFT_OPENER_KEY='yj_pos_shift_opener';
const POS_SHIFT_OPENER_ROLE_KEY='yj_pos_shift_opener_role';
function posShiftOpenerName(){
 const saved=String(localStorage.getItem(POS_SHIFT_OPENER_KEY)||'').trim();
 return saved||currentOpenShift()?.cashier||currentUser()?.name||'';
}
function posShiftOpenerRole(){
 const saved=String(localStorage.getItem(POS_SHIFT_OPENER_ROLE_KEY)||'').trim();
 if(saved)return saved;
 const opener=posShiftOpenerName();
 const found=availableLoginPeople().find(x=>x.name===opener);
 return found?.role||currentUser()?.role||'';
}
function ensurePosShiftOpener(name,role=''){
 const current=String(localStorage.getItem(POS_SHIFT_OPENER_KEY)||'').trim();
 if(current){
  if(!localStorage.getItem(POS_SHIFT_OPENER_ROLE_KEY)){
   const found=availableLoginPeople().find(x=>x.name===current);
   const resolved=found?.role||role||'';
   if(resolved)localStorage.setItem(POS_SHIFT_OPENER_ROLE_KEY,resolved);
  }
  return current;
 }
 const next=String(name||'').trim();
 if(next){
  localStorage.setItem(POS_SHIFT_OPENER_KEY,next);
  const resolved=String(role||availableLoginPeople().find(x=>x.name===next)?.role||'').trim();
  if(resolved)localStorage.setItem(POS_SHIFT_OPENER_ROLE_KEY,resolved);
 }
 return next;
}
function clearPosShiftOpener(){
 localStorage.removeItem(POS_SHIFT_OPENER_KEY);
 localStorage.removeItem(POS_SHIFT_OPENER_ROLE_KEY);
}
function setLoginLockAppearance(locked){
 posLockMode=!!locked;
 loginDialog?.classList.toggle('pos-lock-login',posLockMode);
}


function availableLoginPeople(){
 return storeEmployees().filter(x=>x.active!==false&&x.account);
}


function employeeHasPermissionBeforeLogin(emp,key){
 if(!emp)return false;
 if(emp.role==='創辦人')return true;
 return load(K.permissions,{})[emp.id]?.[key]===true;
}
let loginStoreSwitchUnlocked=false;
function refreshLoginStoreSwitch(){
 const panel=document.querySelector('#loginStoreSwitchPanel');
 const select=document.querySelector('#loginStoreSelect');
 const account=String(document.querySelector('#loginAccount')?.value||'').trim();
 if(!panel||!select)return;
 const emp=storeEmployees().find(x=>x.active!==false&&String(x.account||'').trim()===account);
 const allowed=loginStoreSwitchUnlocked||employeeHasPermissionBeforeLogin(emp,'storeSwitch');
 panel.hidden=!allowed;
 if(!allowed)return;
 const rows=load(K.stores,[]).filter(x=>x.active!==false);
 select.innerHTML=rows.map(x=>`<option value="${esc(x.code)}" ${String(x.code)===currentStoreCode()?'selected':''}>${esc(x.name)}｜${esc(x.code)}</option>`).join('');
}
function bindLoginStoreSwitch(){
 const account=document.querySelector('#loginAccount'),person=document.querySelector('#loginPerson'),storeSelect=document.querySelector('#loginStoreSelect');
 const refresh=()=>refreshLoginStoreSwitch();
 if(account){account.addEventListener('input',refresh);account.addEventListener('change',refresh)}
 if(person)person.addEventListener('change',()=>setTimeout(refresh,0));
 if(storeSelect)storeSelect.onchange=async()=>{
  const targetCode=String(storeSelect.value||'');
  if(!targetCode||targetCode===currentStoreCode())return;
  const accountValue=String(document.querySelector('#loginAccount')?.value||'').trim();
  const password=String(document.querySelector('#loginPassword')?.value||'');
  const emp=storeEmployees().find(x=>x.active!==false&&String(x.account||'').trim()===accountValue);
  if(!emp||String(emp.password||'')!==password)return alert('切換門市前，請先輸入目前門市的正確帳號與密碼');
  if(!employeeHasPermissionBeforeLogin(emp,'storeSwitch'))return alert('此帳號沒有「切換門市」權限');
  const target=load(K.stores,[]).find(x=>String(x.code)===targetCode&&x.active!==false);
  if(!target)return alert('找不到門市');
  const old=currentStoreCode();
  if(!setCurrentStore(target))return alert('門市切換失敗，請再試一次');
  if(currentStoreCode()!==String(target.code))return alert(`門市切換失敗：預期 ${target.code}，目前仍為 ${currentStoreCode()}`);
  if(cloudConfigured()){
   try{
    storeSelect.disabled=true;
    await cloudPullAll();
   }catch(err){
    const oldStore=load(K.stores,[]).find(x=>String(x.code)===String(old));
    if(oldStore)setCurrentStore(oldStore);
    storeSelect.disabled=false;
    return alert('切換門市雲端資料載入失敗，已返回原門市：'+String(err?.message||err));
   }
  }
  loginStoreSwitchUnlocked=true;
  saveAudit('登入頁切換門市',`${old}→${target.code} ${target.name}`);
  fillLoginPeople();
  const a=document.querySelector('#loginAccount'),pw=document.querySelector('#loginPassword');
  if(a)a.value='';if(pw)pw.value='';
  refreshLoginStoreSwitch();
  if(storeSelect)storeSelect.disabled=false;
  alert(`已切換到 ${target.name}（${target.code}）。\n一般員工只有此門市已建立資料才能登入；創辦人為全門市共用最高權限帳號。`);
 };
}
function tmLoginAttendanceState(account=''){
 const a=String(account||'').trim();
 if(!a)return {label:'未輸入帳號',state:'idle'};
 const rows=(load(K.attendance,[])||[])
  .filter(x=>String(x.storeCode||currentStoreCode())===currentStoreCode())
  .filter(x=>String(x.userAccount||'').trim()===a)
  .sort((x,y)=>new Date(y.at||0)-new Date(x.at||0));
 if(!rows.length)return {label:'尚未簽到',state:'off'};
 const latest=rows[0];
 if(latest.kind==='簽到')return {label:`上班中｜${latest.user||a}`,state:'in'};
 return {label:`已簽退｜${latest.user||a}`,state:'out'};
}
function refreshTmLoginAttendance(){
 const account=document.querySelector('#loginAccount');
 const box=document.querySelector('#tmLoginAttendance');
 if(!box)return;
 const s=tmLoginAttendanceState(account?.value||'');
 box.textContent=s.label;
 box.dataset.state=s.state;
}
function fillLoginPeople(){
 const account=document.querySelector('#loginAccount');
 const password=document.querySelector('#loginPassword');
 if(account)account.value='';
 if(password)password.value='';
 refreshTmLoginAttendance();
}
function syncLoginAccount(){refreshTmLoginAttendance()}


const TM_BIOMETRIC_LOGIN_KEY='yj_tm_biometric_login_v1';
function tmBiometricBindings(){
 const rows=load(TM_BIOMETRIC_LOGIN_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
function saveTmBiometricBindings(rows){save(TM_BIOMETRIC_LOGIN_KEY,Array.isArray(rows)?rows:[])}
function tmB64url(bytes){
 const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 let s='';for(const b of u8)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function tmFromB64url(value){
 let s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
 const raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}
function tmRandomChallenge(size=32){const a=new Uint8Array(size);crypto.getRandomValues(a);return a}
async function tmPlatformBiometricAvailable(){
 try{
  return !!(window.PublicKeyCredential&&navigator.credentials&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
 }catch(_){return false}
}
function tmBindingCandidates(account=''){
 const a=String(account||'').trim();
 const allowed=new Set(availableLoginPeople().map(x=>String(x.account||'').trim()));
 return tmBiometricBindings().filter(x=>
  String(x.storeCode||'')===currentStoreCode()&&allowed.has(String(x.account||'').trim())&&(!a||String(x.account||'').trim()===a)
 );
}
function refreshTmFaceLoginState(){
 // Alpha 8.89：取消 Face ID／裝置生物辨識登入功能。
 return;
}
async function tmCreateBiometricCredential(){
 if(!(await tmPlatformBiometricAvailable())){alert('此裝置／瀏覽器目前無法使用 Face ID、Touch ID 或裝置生物辨識');return null}
 try{
  const nonce=tmB64url(tmRandomChallenge(12));
  return await navigator.credentials.create({publicKey:{
   challenge:tmRandomChallenge(),
   rp:{name:'Yijia TM'},
   user:{id:tmRandomChallenge(),name:`tm-setup-${nonce}`,displayName:'Yijia TM 收銀員'},
   pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
   authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'},
   timeout:60000,
   attestation:'none'
  }});
 }catch(err){
  if(String(err?.name||'')!=='NotAllowedError')console.error('Face ID enrollment start error',err);
  if(String(err?.name||'')!=='NotAllowedError')alert('Face ID／裝置辨識設定失敗：'+String(err?.message||err));
  return null;
 }
}
function tmSaveBiometricBinding(emp,credential){
 if(!emp||!credential)return false;
 const id=tmB64url(credential.rawId);
 const rows=tmBiometricBindings().filter(x=>!(String(x.storeCode||'')===currentStoreCode()&&String(x.account||'')===String(emp.account||'')));
 rows.push({credentialId:id,employeeId:emp.id||'',account:String(emp.account||''),name:String(emp.name||''),storeCode:currentStoreCode(),createdAt:new Date().toISOString()});
 saveTmBiometricBindings(rows);
 saveAudit('設定 Face ID 登錄',`${emp.name||emp.account}｜${currentStoreCode()}`);
 refreshTmFaceLoginState();
 return true;
}
function tmPromptBiometricBinding(credential){
 if(!credential)return;
 dlg('第一次設定臉部辨識',`<div class="tm-biometric-setup">
   <p><strong>臉部辨識已完成。</strong></p>
   <p class="muted">第一次使用需輸入 TM 帳號與密碼，確認這個 Face ID／裝置辨識要綁定哪一位收銀員。</p>
   <label>帳號<input id="tmBioSetupAccount" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="請輸入帳號"></label>
   <label>密碼<input id="tmBioSetupPassword" type="password" autocomplete="current-password" placeholder="請輸入密碼"></label>
   <div class="actions"><button class="primary" type="button" id="tmBioSetupConfirm">確認綁定並登入</button><button class="button" type="button" data-action="close-dialog">取消</button></div>
 </div>`);
 const a=document.querySelector('#tmBioSetupAccount'),pw=document.querySelector('#tmBioSetupPassword'),ok=document.querySelector('#tmBioSetupConfirm');
 const prefill=String(document.querySelector('#loginAccount')?.value||'').trim();if(a&&prefill)a.value=prefill;
 if(ok)ok.onclick=()=>{
  const account=String(a?.value||'').trim(),password=String(pw?.value||'');
  if(!account)return alert('請輸入帳號');
  if(!password)return alert('請輸入密碼');
  const emp=availableLoginPeople().find(x=>String(x.account||'').trim()===account);
  if(!emp)return alert('此門市沒有建立此員工資料，或帳號目前已停用');
  if(String(emp.password||'')!==password)return alert('帳號或密碼錯誤，無法完成臉部辨識綁定');
  if(!tmSaveBiometricBinding(emp,credential))return;
  try{genericDialog.close()}catch(_){ }
  alert('臉部辨識登錄設定完成');
  tmFinishBiometricLogin(emp);
 };
 setTimeout(()=>a?.focus(),50);
}
function tmFinishBiometricLogin(selected){
 if(!selected)return false;
 const storeCode=currentStoreCode();
 save(K.session,{...selected,password:undefined,storeCode});
 loginDialog.close();
 if(pendingLoginMode==='front'){
  const wasLocked=posLockMode;
  const opener=ensurePosShiftOpener(selected.name,selected.role);
  if(!localStorage.getItem('yj_pos_login_at_'+opener))localStorage.setItem('yj_pos_login_at_'+opener,new Date().toISOString());
  saveAudit(wasLocked?'Face ID 解鎖 TM':'Face ID 登入前台',`${selected.name}${wasLocked?`｜本班開機人員 ${opener}`:''}`);
  setLoginLockAppearance(false);
 }else saveAudit('Face ID 登入後台',selected.name);
 const la=document.querySelector('#loginAccount'),pw=document.querySelector('#loginPassword');if(la)la.value='';if(pw)pw.value='';
 mode(pendingLoginMode);setTimeout(checkSchedules,100);return true;
}
async function tmBiometricLogin(){
 // Alpha 8.89：此功能已取消，保留函式避免舊快取或舊事件呼叫造成錯誤。
 return false;
}

function showLogin(target='front',options={}){
 pendingLoginMode=target;
 setLoginLockAppearance(target==='front'&&options.locked===true);
 const title=document.querySelector('#loginTitle');
 const hint=document.querySelector('#loginHint');
 const password=document.querySelector('#loginPassword');

 const selfHandoverLogin=target==='front'&&isSelfCheckout()&&selfReopenPending();
 if(title)title.textContent=target==='back'?'登入後台管理系統':posLockMode?'🔒 TM 已鎖機':(selfHandoverLogin?'自助結帳下一班登入':'收銀員登錄');
 if(hint)hint.textContent=target==='back'
   ?'切換至後台前，請重新驗證登入帳號與密碼'
   :posLockMode
     ?`目前班別尚未交班｜開機人員：${posShiftOpenerName()||'—'}｜請登入解鎖`
     :(selfHandoverLogin?'自助模式已完成交班，請使用下一班實際操作人員自己的帳號與密碼登入；正式交易仍由 99999 結帳':'請選擇登入帳號並輸入密碼');

 loginStoreSwitchUnlocked=false;
 fillLoginPeople();
 const account=document.querySelector('#loginAccount');
 if(account){
  account.value='';
  account.oninput=()=>{refreshTmLoginAttendance()};
 }
 if(password)password.value='';
 const storeCaption=document.querySelector('#loginStoreCaption');
 if(storeCaption)storeCaption.textContent=`目前門市：${store().name}（${store().code}）`;
 refreshTmLoginAttendance();
 const manage=document.querySelector('#tmLoginManage');
 if(manage)manage.onclick=()=>openTmModeSwitch({fromLogin:true});

 if(!loginDialog.open)loginDialog.showModal();
 setTimeout(()=>account?.focus(),30);
}
function hero(){const s=store(),u=currentUser(),t=clock(),opener=posShiftOpenerName()||u?.name||'',openerRole=posShiftOpenerRole()||u?.role||'';return`<section class="hero"><h2>🏪 ${esc(s.name)}</h2><div class="hero-grid"><div><small>店號</small><strong>${esc(s.code)}</strong></div><div><small>日期</small><strong>${t.date}</strong></div><div><small>時間</small><strong data-clock>${t.time}</strong></div><div><small>操作人員</small><strong>${esc(opener)}</strong></div><div><small>角色</small><strong>${esc(openerRole)}</strong></div></div></section>`}
function mode(m){document.body.dataset.mode=m;render(m==='front'?'pos':'home')}
function requestMode(m){showLogin(m)}
let currentRenderedPage='';
function render(p){if(!currentUser())return showLogin();const requested=String(p||'');const page=(document.body.dataset.mode==='front'&&requested==='front')?'pos':requested;currentRenderedPage=page;document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.nav===page));app.innerHTML=document.body.dataset.mode==='front'?front(page):back(page);bind(page)}
function dlg(title,body){document.querySelector('#dialogTitle').textContent=title;document.querySelector('#dialogBody').innerHTML=body;genericDialog.showModal()}
function saveAudit(a,d=''){audit(a,d);}
const permissionLabels={transferOut:'轉貨轉出',transferIn:'轉貨轉入',ecCancel:'EC取消寄件',storeAdd:'新增門市',storeCode:'轉換店號',employeeCredentials:'員工帳號密碼設定',systemShiftSettings:'班別設定',systemShiftTimeSettings:'各班時間設定',systemReserveCashSettings:'店舖預留金設定',memberBonusCampaignSettings:'會員贈點活動設定',systemSettingsAccess:'設定',storeSwitch:'切換門市'};
function hasPermission(key){const u=currentUser();if(!u)return false;if(['創辦人','管理員'].includes(u.role))return true;return load(K.permissions,{})[u.id]?.[key]===true}
function requirePermission(key){if(hasPermission(key))return true;alert(`需要「${permissionLabels[key]||key}」權限`);return false}
function latestArrival(type,storeCode='001'){return load(K.logistics,[]).find(x=>x.type===type&&(x.storeCode||'001')===storeCode)}


let __yjScannerLoadPromise=null;
async function ensureHtml5QrcodeLoaded(){
 if(window.Html5Qrcode)return true;
 if(__yjScannerLoadPromise)return __yjScannerLoadPromise;
 __yjScannerLoadPromise=new Promise(async resolve=>{
  const sources=[
   'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
   'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
  ];
  const waitForLib=async(ms=2500)=>{
   const end=Date.now()+ms;
   while(Date.now()<end){
    if(window.Html5Qrcode)return true;
    await new Promise(r=>setTimeout(r,100));
   }
   return !!window.Html5Qrcode;
  };
  if(await waitForLib(1200))return resolve(true);
  for(const src of sources){
   try{
    const existing=[...document.scripts].find(x=>String(x.src||'')===src);
    if(existing){
     if(await waitForLib(2500))return resolve(true);
     continue;
    }
    const ok=await new Promise(done=>{
     const el=document.createElement('script');
     el.src=src;el.async=false;
     el.onload=()=>done(true);
     el.onerror=()=>done(false);
     document.head.appendChild(el);
    });
    if(ok&&await waitForLib(2500))return resolve(true);
   }catch(e){console.warn('掃碼元件載入失敗',src,e)}
  }
  resolve(!!window.Html5Qrcode);
 }).finally(()=>{if(!window.Html5Qrcode)__yjScannerLoadPromise=null});
 return __yjScannerLoadPromise;
}
async function scanCode({title='掃描條碼',onResult}={}){
 dlg(title,`<div id="reader" style="width:100%;min-height:260px"></div><p id="scanHint">請允許相機權限，將條碼放入畫面中央。</p><div class="toolbar"><button class="button" id="scanManual">手動輸入</button><button class="button" id="scanClose">關閉</button></div>`);
 let scanner=null,done=false;
 const finish=async(code,meta={})=>{if(done)return;done=true;try{if(scanner)await scanner.stop()}catch{}genericDialog.close();if(code&&onResult)onResult(String(code).trim(),meta)};
 setTimeout(async()=>{
  document.querySelector('#scanManual').onclick=()=>{const v=prompt('請輸入條碼／單號');if(v)finish(v)};
  document.querySelector('#scanClose').onclick=()=>finish('');
  const hint0=document.querySelector('#scanHint');
  if(!window.Html5Qrcode){
   if(hint0)hint0.textContent='正在啟動相機掃描元件…';
   const ready=await ensureHtml5QrcodeLoaded();
   if(!ready){
    if(hint0)hint0.textContent='相機掃描元件載入失敗，請確認網路後關閉此視窗再重試；仍可使用手動輸入。';
    return;
   }
  }
  try{
   const F=window.Html5QrcodeSupportedFormats;
   const formats=F?[F.CODE_128,F.CODE_39,F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.ITF,F.CODABAR,F.QR_CODE].filter(x=>x!==undefined):undefined;
   scanner=new Html5Qrcode('reader',{formatsToSupport:formats,experimentalFeatures:{useBarCodeDetectorIfSupported:true},verbose:false});
   const cams=await Html5Qrcode.getCameras();if(!cams.length)throw Error('找不到相機');
   const back=cams.find(x=>/back|rear|environment|後置/i.test(x.label))||cams[cams.length-1];
   const cameraConfig={facingMode:'environment'};
   try{
    await scanner.start(cameraConfig,{fps:15,qrbox:(vw,vh)=>({width:Math.max(220,Math.min(360,Math.floor(vw*.92))),height:Math.max(100,Math.min(150,Math.floor(vh*.36)))}),aspectRatio:1.4,disableFlip:false},(txt,result)=>finish(txt,{format:String(result?.result?.format?.formatName||result?.decodedResult?.result?.format?.formatName||'')}),()=>{});
    const hint=document.querySelector('#scanHint');if(hint)hint.textContent='支援 Code128／商品條碼／QR Code。請讓完整條碼橫向置中，讀取成功會自動關閉。';
   }catch(firstErr){
    try{
     await scanner.start(back.id,{fps:15,qrbox:(vw,vh)=>({width:Math.max(220,Math.min(360,Math.floor(vw*.92))),height:Math.max(100,Math.min(150,Math.floor(vh*.36)))}),aspectRatio:1.4,disableFlip:false},(txt,result)=>finish(txt,{format:String(result?.result?.format?.formatName||result?.decodedResult?.result?.format?.formatName||'')}),()=>{});
     const hint=document.querySelector('#scanHint');if(hint)hint.textContent='支援 Code128／商品條碼／QR Code。請讓完整條碼橫向置中，讀取成功會自動關閉。';
    }catch(secondErr){throw secondErr||firstErr}
   }
  }catch(e){const hint=document.querySelector('#scanHint');if(hint)hint.textContent='無法啟動相機：'+(e?.message||e)+'。請確認 Safari／主畫面 App 已允許相機權限，可改用手動輸入。'}
 },50);
}

const deliveryTypeZh=x=>({
 ambient:'常溫',
 fresh_1:'鮮食一配',
 fresh_2:'鮮食二配',
 low_1:'低溫一配',
 low_2:'低溫二配',
 dairy:'低溫一配',
 frozen:'冷凍',
 yijiatong:'億家通',
 ec:'EC'
}[String(x||'').trim().toLowerCase()]||x||'');
const logisticsStatusZh=x=>({
 pending:'待簽到',
 expected:'預計進貨',
 inbound:'進貨中',
 transmitted:'已傳輸',
 arrived:'已到店',
 received:'已收貨',
 accepted:'已驗收',
 checked:'已驗收',
 completed:'已完成',
 done:'已完成',
 cancelled:'已取消',
 canceled:'已取消',
 returning:'退貨中',
 returned:'已退貨'
}[String(x||'').trim().toLowerCase()]||x||'—');
const ecTempZh=x=>x==='frozen'?'冷凍':'常溫';

function normalizeFreshDeliveryType(value){
 const v=String(value||'').trim().toLowerCase();
 if(v==='fresh_1'||v==='鮮食一配')return 'fresh_1';
 if(v==='fresh_2'||v==='鮮食二配')return 'fresh_2';
 if(v==='low_1'||v==='低溫一配'||v==='dairy'||v==='乳品')return 'low_1';
 if(v==='low_2'||v==='低溫二配')return 'low_2';
 return '';
}
function freshDeliverySlot(value){
 const type=normalizeFreshDeliveryType(value);
 if(type==='fresh_1'||type==='low_1')return 'one';
 if(type==='fresh_2'||type==='low_2')return 'two';
 return '';
}

function isRiceBallProduct(product,item={}){
 const text=[product?.name,product?.category,product?.group,product?.productGroup,item?.product_name,item?.product_code]
  .filter(Boolean).join('｜');
 return /飯糰/.test(text);
}

function freshExpiryByReceivingRule(receivedAt,deliveryType,riceBall){
 const d=new Date(receivedAt);
 if(Number.isNaN(d.getTime()))return null;
 const slot=freshDeliverySlot(deliveryType);
 if(!slot)return null;
 // 「第 N 天」採進貨當天算第 1 天：一配非飯糰 +2 天、二配非飯糰 +3 天。
 const addDays=riceBall?1:(slot==='one'?2:3);
 d.setDate(d.getDate()+addDays);
 d.setHours(slot==='one'?23:17,0,0,0);
 return d;
}

function createAutoFreshBatchesFromReceipt(receipt,receivedAt=new Date()){
 const type=normalizeFreshDeliveryType(receipt?.delivery_type);
 if(!type)return {count:0,totalQty:0,items:[]};
 const items=Array.isArray(receipt?.items)?receipt.items:[];
 if(!items.length)return {count:0,totalQty:0,items:[]};
 const ps=products(),rows=freshBatches(),created=[];
 const sourceReceipt=String(receipt?.receipt_no||receipt?.batch_no||'').trim();
 items.forEach((i,index)=>{
  const qty=Number(i?.qty||0);if(qty<=0)return;
  const p=ps.find(x=>String(x.id||'')===String(i.product_id||''))
    ||ps.find(x=>String(x.code||'')===String(i.product_code||''))
    ||ps.find(x=>productBarcodes(x).includes(String(i.barcode||'')));
  if(!p||!(p.category==='鮮食'||p.group==='鮮食'||p.isFresh===true))return;
  const productDelivery=normalizeFreshDeliveryType(p.logistics||p.deliveryType||'');
  const effectiveType=productDelivery||type;
  if(!effectiveType)return;
  // 同一張進貨單同一商品只自動建立一次，避免重新整理或重送造成重複批次。
  if(rows.some(x=>x.autoCreated===true&&x.sourceReceipt===sourceReceipt&&String(x.productId||'')===String(p.id)))return;
  const riceBall=isRiceBallProduct(p,i);
  const expiry=freshExpiryByReceivingRule(receivedAt,effectiveType,riceBall);
  if(!expiry)return;
  const stamp=new Date(receivedAt);
  const yy=String(stamp.getFullYear()).slice(-2),mo=String(stamp.getMonth()+1).padStart(2,'0'),da=String(stamp.getDate()).padStart(2,'0'),hh=String(stamp.getHours()).padStart(2,'0'),mi=String(stamp.getMinutes()).padStart(2,'0'),ss=String(stamp.getSeconds()).padStart(2,'0');
  const code=String(p.code||i.product_code||index+1).replace(/[^0-9A-Za-z]/g,'').slice(-8)||String(index+1);
  let batchNo=`FB${yy}${mo}${da}${hh}${mi}${ss}-${code}`;
  let n=2;while(rows.some(x=>x.batchNo===batchNo))batchNo=`FB${yy}${mo}${da}${hh}${mi}${ss}-${code}-${n++}`;
  const item={
   id:uid(),productId:p.id,productCode:p.code||i.product_code||'',productName:p.name||i.product_name||'',
   barcode:productBarcodes(p)[0]||i.barcode||'',batchNo,receivedAt:new Date(receivedAt).toISOString(),
   expiryAt:expiry.toISOString(),
   qty,remainingQty:qty,note:`進貨自動建立｜${deliveryTypeZh(effectiveType)}｜${riceBall?'飯糰系列':'一般鮮食'}｜來源 ${sourceReceipt||'物流簽到'}`,
   status:'正常',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),user:currentUser()?.name||'',
   autoCreated:true,sourceReceipt,sourceBatch:String(receipt?.batch_no||''),deliveryType:effectiveType,riceBall
  };
  rows.unshift(item);created.push(item);
 });
 if(created.length){
  save(K.freshBatches,rows);
  saveAudit('進貨自動新增鮮食批次',`${sourceReceipt||receipt?.batch_no||''}｜${created.length}批｜${created.reduce((a,x)=>a+Number(x.qty||0),0)}件`);
 }
 return {count:created.length,totalQty:created.reduce((a,x)=>a+Number(x.qty||0),0),items:created};
}

function applyReceiptItemsToLocalInventory(receipt){
 const items=Array.isArray(receipt?.items)?receipt.items:[];
 if(!items.length)return {updated:0,totalQty:0,missing:[],freshBatchCount:0,freshBatchQty:0};
 const receivedAt=new Date();
 const ps=products(),moves=load(K.inventoryMoves,[]),missing=[];let updated=0,totalQty=0;
 for(const i of items){
  const qty=Number(i.qty||0);if(qty<=0)continue;
  const p=ps.find(x=>String(x.id||'')===String(i.product_id||''))
    ||ps.find(x=>String(x.code||'')===String(i.product_code||''))
    ||ps.find(x=>productBarcodes(x).includes(String(i.barcode||'')));
  if(!p){missing.push(i.product_name||i.product_code||i.barcode||'未知商品');continue}
  p.stock=Number(p.stock||0)+qty;updated++;totalQty+=qty;
  moves.unshift({id:uid(),productId:p.id,productName:p.name,qty,type:'物流進貨',reference:receipt.receipt_no||receipt.batch_no||'',user:currentUser()?.name||'',at:new Date().toISOString()});
  const link=load(K.linkedInventoryRules,[]).find(r=>r&&r.active!==false&&r.inboundSync!==false&&String(r.parentCode||'').trim().toUpperCase()===String(p.code||'').trim().toUpperCase());
  if(link){const component=ps.find(x=>String(x.code||'').trim().toUpperCase()===String(link.componentCode||'').trim().toUpperCase());if(component){const addQty=qty*Math.max(1,Number(link.componentQty||1));component.stock=Number(component.stock||0)+addQty;moves.unshift({id:uid(),productId:component.id,productName:component.name,qty:addQty,type:'組合拆零進貨連動',reference:receipt.receipt_no||receipt.batch_no||'',user:currentUser()?.name||'',at:new Date().toISOString()});saveAudit('組合拆零進貨連動',`${p.code||''} ${p.name} +${qty} → ${component.code||''} ${component.name} +${addQty}`)}}
 }
 save(K.products,ps);save(K.inventoryMoves,moves);
 const fresh=createAutoFreshBatchesFromReceipt(receipt,receivedAt);
 saveAudit('物流簽到自動入庫',`${receipt?.receipt_no||receipt?.batch_no||''}｜${totalQty}件${fresh.count?`｜鮮食批次${fresh.count}批`:''}`);
 return {updated,totalQty,missing,freshBatchCount:fresh.count,freshBatchQty:fresh.totalQty};
}

function pickupPage(){
 return `<div class="ref-pickup-page">
  <header class="ref-pos-greenbar"><button class="ref-brand ref-brand-home" data-page="pos">☰　億家 <small>SuperApp Enterprise</small></button><div class="ref-pickup-title-tabs"><h2>EC取貨管理</h2><button class="ref-pickup-type" data-pickup-type="group">團購</button><button class="ref-pickup-type" data-pickup-type="preorder">預購</button><button class="ref-pickup-type active" data-pickup-type="ec">EC</button></div><div>${new Date().toLocaleString('zh-TW')}　👤 ${esc(currentUser()?.account||currentUser()?.name||'')}</div></header>
  <div class="ref-pickup-filterbar">
   <div class="ref-searchbox"><input id="pickupQuery" placeholder="手機末三碼" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" autocomplete="off"><span>⌕</span></div>
   <button class="ref-chip active" data-pickup-surname="">全部</button>
   <button class="ref-filter-arrow" data-action="pickup-filter-left" aria-label="往左">←</button>
   <div id="pickupSurnameFilters" class="ref-pickup-surname-filters"></div>
   <button class="ref-more" data-action="pickup-search">☷ 更多篩選</button>
   <button class="ref-filter-arrow" data-action="pickup-filter-right" aria-label="往右">→</button>
  </div>
  <div class="ref-pickup-table-wrap"><table class="ref-pickup-table"><thead><tr><th>溫層</th><th>姓名</th><th>手機末三碼</th><th>廠商名稱</th><th>數量</th><th>訂單編號</th><th>取貨日</th><th>金額</th><th>操作</th></tr></thead><tbody id="pickupResults"><tr><td colspan="9">讀取中…</td></tr></tbody></table></div>
  <footer class="ref-pickup-footer"><span id="pickupWaitingCount">讀取中…</span><div>‹　<b>1</b>　›</div><span>每頁顯示：20 筆</span></footer>
 </div>`;
}

function pickupVendorName(x){
 return String(
  x?.vendor_name??x?.vendor??x?.supplier_name??x?.supplier??x?.sender_name??x?.sender??''
 ).trim()||'—';
}
function pickupOrderNo(x){
 return String(x?.order_no??x?.order_number??x?.package_no??'').trim()||'—';
}
function pickupSurname(name){
 const s=String(name||'').trim();
 return s?s.slice(0,1):'';
}
function renderPickupSurnameFilters(rows,active=''){
 const box=document.querySelector('#pickupSurnameFilters');if(!box)return;
 const surnames=[...new Set((Array.isArray(rows)?rows:[]).map(x=>pickupSurname(x.recipient_name)).filter(Boolean))].slice(0,10);
 box.innerHTML=surnames.map(s=>`<button class="ref-chip ${s===active?'active':''}" data-pickup-surname="${esc(s)}">${esc(s)}</button>`).join('');
 const all=document.querySelector('[data-pickup-surname=""]');
 if(all)all.classList.toggle('active',!active);
}
let pickupTypeMode='ec';
function pickupRowType(x){
 const raw=String(x?.pickup_type??x?.order_type??x?.source_type??x?.source??'ec').trim().toLowerCase();
 if(['group','團購'].includes(raw))return 'group';
 if(['preorder','預購'].includes(raw))return 'preorder';
 return 'ec';
}
function pickupDeadlineState(x){
 const raw=String(x?.pickup_deadline||'').trim();
 if(!raw)return null;
 const d=new Date(raw.includes('T')?raw:`${raw}T00:00:00`);if(Number.isNaN(d.getTime()))return null;
 const now=new Date(); const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const due=new Date(d.getFullYear(),d.getMonth(),d.getDate());
 const days=Math.floor((today-due)/86400000);
 if(days<0)return null;
 if(days>3)return {key:'overdue',label:'超過可退貨期限'};
 return {key:'return',label:'待退'};
}
function pickupVisualState(x){
 const deadline=pickupDeadlineState(x); if(deadline)return deadline;
 const amount=Number(x?.value||0);
 if(amount===0||amount>=3000)return {key:'special',label:''};
 return {key:'normal',label:''};
}
async function loadPickupResults(q='',surname=''){
 const box=document.querySelector('#pickupResults');if(!box)return;
 const count=document.querySelector('#pickupWaitingCount');
 box.innerHTML='<tr><td colspan="9">讀取未取貨名單中…</td></tr>';
 try{
  const normalized=String(q||'').replace(/\D/g,'').slice(0,3);
  if(normalized && normalized.length!==3){box.innerHTML='<tr><td colspan="9">請輸入手機末三碼（3位數字）</td></tr>';if(count)count.textContent='請輸入3碼';return;}
  const sourceRows=(await posSearchEcPickup(normalized)).filter(x=>x.status==='arrived');
  const typedRows=sourceRows.filter(x=>pickupRowType(x)===pickupTypeMode);
  renderPickupSurnameFilters(typedRows,surname);
  const rows=surname?typedRows.filter(x=>pickupSurname(x.recipient_name)===surname):typedRows;
  if(count)count.textContent=`共 ${rows.length} 件待取貨`;
  box.innerHTML=rows.length?rows.map(x=>{
   const due=Number(x.value||0),vendor=pickupVendorName(x),orderNo=pickupOrderNo(x),visual=pickupVisualState(x);
   return `<tr class="pickup-row pickup-${visual.key}"><td>${ecTempZh(x.temperature)}</td><td><b>${esc(x.recipient_name||'未填姓名')}</b>${visual.label?`<small class="pickup-state-label">${esc(visual.label)}</small>`:''}</td><td>${esc(x.recipient_last3||'—')}</td><td>${esc(vendor)}</td><td>1</td><td>${esc(orderNo)}</td><td>${esc(x.pickup_deadline||'—')}</td><td>${money(due)}</td><td><button class="primary ${scServiceConnected()?'':'disabled-by-sc'}" data-ec-checkout="${esc(x.package_no)}" data-ec-amount="${due}" ${scServiceConnected()?'':'disabled title="與 SC 斷開，僅可查詢包裹"'}>${due>0?'取貨／結帳':'0 元取貨'}</button></td></tr>`;
  }).join(''):'<tr><td colspan="9">目前沒有未取貨包裹</td></tr>';
  document.querySelectorAll('[data-ec-checkout]').forEach(b=>b.onclick=()=>{
   if(!scServiceConnected()){showScDisconnectedNotice();return}
   const packageNo=b.dataset.ecCheckout,amount=Number(b.dataset.ecAmount||0);
   if(state.cart.length)return alert('目前 TM 購物車已有商品，請先完成或取消目前交易，再帶入 EC 包裹。');
   state.cart=[{id:`EC-${packageNo}`,code:packageNo,name:`EC 包裹取貨 ${packageNo}`,price:amount,cost:0,qty:1,ecPickup:true,ecPackageNo:packageNo,category:'EC服務',allowNegativeStock:true}];
   state.discount=0;state.payment='現金';state.note=`EC取貨｜${packageNo}`;render('pos');setTimeout(drawPOS,0)
  });
 }catch(e){box.innerHTML=`<tr><td colspan="9"><b>查詢失敗</b>｜${esc(e.message)}</td></tr>`}
}

const EC_FLOW_HISTORY_KEY='yj_ec_flow_history_v1';
let ecFlowActiveAction='arrival';
function ecFlowHistory(){return load(EC_FLOW_HISTORY_KEY,[])}
function saveEcFlowHistory(rows){save(EC_FLOW_HISTORY_KEY,rows.slice(0,500))}
function recordEcFlowHistory(action,batchNo,count){
 const rows=ecFlowHistory();
 rows.unshift({id:uid(),action,batchNo:String(batchNo||''),count:Number(count||0),operator:currentUser()?.name||currentUser()?.account||'',at:new Date().toISOString()});
 saveEcFlowHistory(rows);
}
function ecFlowTodayRows(action){
 const now=new Date(); const y=now.getFullYear(),m=now.getMonth(),d=now.getDate();
 return ecFlowHistory().filter(x=>x.action===action&&(()=>{const t=new Date(x.at);return t.getFullYear()===y&&t.getMonth()===m&&t.getDate()===d})());
}
function ecFlowTodayDetailHtml(action){
 const rows=ecFlowTodayRows(action),isArrival=action==='arrival';
 return rows.length?`<div class="ec-day-table"><div class="ec-day-head"><span>時間</span><span>${isArrival?'進貨Key／共同貨單':'退貨Key／共同貨單'}</span><span>件數</span><span>操作員</span></div>${rows.map(x=>`<div class="ec-day-row"><span>${new Date(x.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})}</span><b>${esc(x.batchNo)}</b><strong>${Number(x.count||0)}</strong><span>${esc(x.operator||'—')}</span></div>`).join('')}</div>`:'<div class="notice">今天尚無完成明細</div>';
}
function renderEcFlowWork(action='arrival'){
 ecFlowActiveAction=action;
 document.querySelectorAll('[data-ec-main-action]').forEach(b=>b.classList.toggle('active',b.dataset.ecMainAction===action));
 const title=document.querySelector('#ecFlowWorkTitle'),keyLabel=document.querySelector('#ecFlowKeyLabel'),detail=document.querySelector('#ecFlowTodayDetail');
 if(title)title.textContent=action==='arrival'?'EC進店｜今日進貨明細':'EC離店｜今日退貨明細';
 if(keyLabel)keyLabel.textContent=action==='arrival'?'進貨 Key／共同貨單條碼':'退貨 Key／共同貨單條碼';
 if(detail)detail.innerHTML=ecFlowTodayDetailHtml(action);
 const a=document.querySelector('#ecBatchFlowAction');if(a)a.value=action;
 const code=document.querySelector('#ecBatchFlowCode');if(code){code.value='';code.placeholder=action==='arrival'?'輸入或掃描進貨 Key':'輸入或掃描退貨 Key'}
 const scan=document.querySelector('#ecBatchFlowScan');if(scan)scan.textContent=action==='arrival'?'📷 掃描進貨 Key':'📷 掃描退貨 Key';
 refreshEcBatchFlowSelect(action).catch(()=>{});
}
function showEcPrintPrebuild(action,record){
 const label=action==='arrival'?'進貨明細':'退貨明細';
 const el=document.querySelector('#ecBatchFlowResult');if(el){el.style.display='block';el.innerHTML+=`<br><b>🖨 ${label}自動列印：預做</b><br><small>未送出實體列印指令。</small>`}
}
function ecFlowPage(){
 return `<div class="toolbar"><button class="button" data-page="pos">← 前台首頁</button><button class="button" data-action="ec-flow-refresh">🔄 更新</button></div>
 <div class="page-head"><h2>📮 EC 進離店</h2></div>
 <div class="ec-main-actions">
  <button class="ec-main-btn active" data-ec-main-action="arrival">EC進店</button>
  <button class="ec-main-btn" data-ec-main-action="leave">EC離店</button>
  <button class="ec-main-btn" data-ec-reprint="arrival">進店補印</button>
  <button class="ec-main-btn" data-ec-reprint="leave">離店補印</button>
 </div>
 <div class="panel" style="margin-top:14px">
  <h3 id="ecFlowWorkTitle">EC進店｜今日進貨明細</h3>
  <div id="ecFlowTodayDetail">讀取中…</div>
 </div>
 <div class="panel" style="margin-top:12px">
  <h3>EC共同貨單作業</h3>
  <input type="hidden" id="ecBatchFlowAction" value="arrival">
  <label>選擇貨單<select id="ecBatchFlowSelect"><option value="">— 請選擇貨單 —</option></select></label>
  <label><span id="ecFlowKeyLabel">進貨 Key／共同貨單條碼</span><input id="ecBatchFlowCode" placeholder="輸入或掃描進貨 Key" autocomplete="off"></label>
  <div class="toolbar"><button class="button" id="ecBatchFlowScan">📷 掃描進貨 Key</button><button class="primary" id="ecBatchFlowRun">確認</button></div>
  <div id="ecBatchFlowResult" class="notice" style="display:none;margin-top:8px"></div>
  <div class="notice" style="margin-top:8px">確認完成後會自動建立本次進／退貨明細；實體自動列印、進店補印、離店補印目前皆為預做。</div>
 </div>`;
}

function ecBatchNoFromRow(x,kind='expected'){
 return String(kind==='return_due'?(x?.logistics_batch_no||x?.return_logistics_batch_no||x?.return_batch_logistics_no||x?.return_batch_no||''):(x?.inbound_batch_no||x?.logistics_batch_no||x?.batch_no||'')).trim();
}
async function refreshEcBatchFlowSelect(action='arrival'){
 const sel=document.querySelector('#ecBatchFlowSelect');if(!sel)return;
 if(!scServiceConnected()){sel.innerHTML='<option value="">— 與 SC 斷開，無法查詢 —</option>';showScDisconnectedNotice('ecFlow');return}
 sel.innerHTML='<option value="">讀取貨單中…</option>';
 try{
  let opts=[];
  if(action==='arrival'){
   const batches=(await posListPendingLogisticsBatches(300)).filter(x=>String(x.delivery_type||'').toLowerCase()==='ec');
   opts=batches.map(x=>({value:String(x.batch_no||'').trim(),label:`${x.batch_no}｜EC共同貨單｜${x.external_ref||x.source||'待進店'}`}));
  }else{
   const rows=await posListEcFlow('return_due');
   const seen=new Set();
   opts=rows.map(x=>({value:ecBatchNoFromRow(x,'return_due'),label:`${ecBatchNoFromRow(x,'return_due')}｜EC退貨共同貨單`})).filter(x=>x.value&&!seen.has(x.value)&&(seen.add(x.value),true));
  }
  sel.innerHTML='<option value="">— 請選擇貨單 —</option>'+opts.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
 }catch(e){sel.innerHTML='<option value="">— 貨單讀取失敗，可直接掃描／Key —</option>'}
}
async function runEcBatchFlow(){
 if(!scServiceConnected()){showScDisconnectedNotice('ecFlow');return}
 const action=document.querySelector('#ecBatchFlowAction')?.value||ecFlowActiveAction||'arrival';
 const code=String(document.querySelector('#ecBatchFlowCode')?.value||document.querySelector('#ecBatchFlowSelect')?.value||'').trim();
 const result=document.querySelector('#ecBatchFlowResult');
 if(!code)return alert(action==='arrival'?'請輸入或掃描進貨 Key':'請輸入或掃描退貨 Key');
 if(!cloudConfigured())return alert('TM 尚未設定 Supabase');
 result.style.display='block';result.textContent=action==='arrival'?'EC 進店處理中…':'EC 離店處理中…';
 try{
  let batch=code,count=0;
  if(action==='arrival'){
   const resolved=await posResolveReceivingCode(code); batch=String(resolved?.batch_no||code).trim();
   let row=await posFindLogisticsBatch(batch,'EC');
   if(row){const received=await posReceiveLogisticsBatch(batch,'EC',currentUser()?.name||'');if(received)recordCloudLogisticsArrival(received)}
   const r=await posReceiveEcArrivalBatch(batch,currentUser()?.name||''); count=Number(r?.package_count||0);
   result.innerHTML=`<b>EC 進店完成</b><br>進貨 Key／共同貨單：${esc(batch)}<br>本次進店：${count} 件`;
  }else{
   const r=await posLeaveEcReturnBatch(code,currentUser()?.name||''); batch=String(r?.batch_no||code).trim();count=Number(r?.package_count||0);
   result.innerHTML=`<b>EC 離店完成</b><br>退貨 Key／共同貨單：${esc(batch)}<br>本次離店：${count} 件`;
  }
  recordEcFlowHistory(action,batch,count);
  renderEcFlowWork(action);
  showEcPrintPrebuild(action,{batch,count});
 }catch(e){result.innerHTML=`<b>EC ${action==='arrival'?'進店':'離店'}失敗</b><br>${esc(e.message)}`}
}

function front(p){
 if(p==='front'||p==='pos')return posPage();
 if(p==='transactions-front')return transactionPage(true);
 if(p==='system-settings')return systemSettingsPage();
 if(p==='pickup')return pickupPage();
 if(p==='ec-flow')return ecFlowPage();
 if(p==='tm-peripherals')return tmPeripheralPage();
 if(p==='tm-notices')return tmNoticePage();
 if(p==='transfer-in')return`<div class="toolbar"><button class="button" data-page="pos">← 返回</button></div><div class="panel"><h2>轉貨單過刷轉入</h2><div class="inline-field"><input id="transferNo" placeholder="掃描或輸入單號" style="width:100%;padding:11px"><button class="button" data-action="scan-transfer-no">📷 掃描</button></div><button class="primary" data-action="receive">確認轉入</button></div>`;
 return`${hero()}<div class="home-actions"><button class="home-action" data-page="pos"><span class="ico">🧾</span><span><strong>TM 收銀</strong>進入收銀結帳畫面</span></button><button class="home-action" data-scroll="manage"><span class="ico">⚙️</span><span><strong>管理</strong>門市日常作業</span></button></div><h3 class="section-title" id="manage">管理功能選單</h3><div class="manage-grid"><button class="manage-item" data-action="manual-close"><b>📅</b>手動日結</button><button class="manage-item" data-action="alcohol-reminder-toggle"><b>🍺</b>酒類提醒開/關</button><button class="manage-item" data-action="product-lookup"><b>🔍</b>商品查詢</button><button class="manage-item" data-action="member-lookup"><b>👤</b>會員</button><button class="manage-item" data-action="collection-payment"><b>🧾</b>代收繳費</button><button class="manage-item" data-page="transactions-front"><b>🧾</b>交易存根</button><button class="manage-item" data-page="pickup"><b>📦</b>取貨</button><button class="manage-item" data-page="ec-flow"><b>📮</b>EC收發作業</button><button class="manage-item" data-action="new-waste"><b>🗑️</b>廢棄登錄</button><button class="manage-item" data-action="time-lookup"><b>🕒</b>時控查詢</button><button class="manage-item" data-action="deposit"><b>💰</b>投庫</button><button class="manage-item pos-lock-action" data-action="lock-pos"><b>🔒</b>鎖機</button><button class="manage-item" data-action="handover"><b>🤝</b>交班</button><button class="manage-item" data-action="logistics"><b>🚚</b>物流簽到</button><button class="manage-item" data-action="attendance-clock"><b>🕘</b>打卡</button><button class="manage-item" data-page="transfer-in"><b>📥</b>轉貨單轉入</button><button class="manage-item" data-page="system-settings"><b>☁️</b>雲端與更新</button></div>`}


let posBottomMenuPage=0;
let posBottomMenuOpen='';

const POS_HOLD_KEY='yj_pos_held_transactions_v1';
function posHeldTransactions(){return load(POS_HOLD_KEY,[])}
function savePosHeldTransactions(rows){save(POS_HOLD_KEY,rows)}
function clearHeldTransactionsAfterClose(reason='日結'){
 const n1=posHeldTransactions().length,n2=(Array.isArray(load(K.held,[]))?load(K.held,[]):[]).length;
 savePosHeldTransactions([]);save(K.held,[]);
 if(n1+n2>0)saveAudit('日結清除交易暫存',`${reason}｜清除 ${n1+n2} 筆`);
 return n1+n2;
}
function holdCurrentTransaction(){
 if(!state.cart.length)return alert('目前沒有可暫存的交易');
 const rows=posHeldTransactions();
 const now=new Date();
 const member=state.member?structuredClone(state.member):null;
 const row={
  id:`HOLD-${Date.now()}`,
  heldAt:now.toISOString(),
  heldBy:currentUser()?.name||'',
  phoneLast3:member?.phone?String(member.phone).slice(-3):'',
  cart:structuredClone(state.cart),
  payment:state.payment,
  discount:Number(state.discount||0),
  note:String(state.note||''),
  member,
  total:Number(totals().total||0)
 };
 rows.unshift(row);
 savePosHeldTransactions(rows);
 saveAudit('交易暫存',`${row.id}｜${money(row.total)}｜${row.cart.length}項`);
 state.cart=[];state.discount=0;state.note='';state.member=null;state.selected='';
 alert('交易已暫存');
 render('pos');
}
function deleteHeldTransaction(id){
 const rows=posHeldTransactions(),row=rows.find(x=>x.id===id);
 if(!row)return;
 if(!confirm('確定刪除此筆暫存交易？'))return;
 savePosHeldTransactions(rows.filter(x=>x.id!==id));
 saveAudit('刪除暫存交易',id);
 openHeldTransactions();
}
function restoreHeldTransaction(id){
 const rows=posHeldTransactions(),row=rows.find(x=>x.id===id);
 if(!row)return alert('找不到暫存交易');
 if(state.cart.length&&!confirm('目前購物車已有商品，帶入暫存交易會取代目前內容，確定繼續？'))return;
 state.cart=structuredClone(row.cart||[]);
 state.payment=row.payment||'現金';
 state.discount=Number(row.discount||0);
 state.note=row.note||'';
 state.member=row.member?structuredClone(row.member):null;
 state.selected=state.cart[0]?.id||'';
 savePosHeldTransactions(rows.filter(x=>x.id!==id));
 saveAudit('帶入暫存交易',`${id}｜${money(row.total||0)}`);
 genericDialog.close();
 render('pos');
}
function heldTransactionDetailHtml(row){
 const items=row.cart||[];
 return `<div class="held-detail">
  <div class="held-detail-title">暫存交易存根</div>
  <table class="table"><thead><tr><th>項次</th><th>品名</th><th>單價</th><th>數量</th><th>金額</th></tr></thead><tbody>
   ${items.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.name||'')}</td><td>${money(x.price||0)}</td><td>${Number(x.qty||0)}</td><td>${money(Number(x.price||0)*Number(x.qty||0))}</td></tr>`).join('')||'<tr><td colspan="5">無商品</td></tr>'}
  </tbody></table>
 </div>`;
}
function openHeldTransactions(){
 const rows=posHeldTransactions();
 dlg('交易暫存',`
  <div class="held-page">
   <div class="held-list-wrap">
    <table class="table held-list"><thead><tr><th>項次</th><th>手機末三碼</th><th>暫存時間</th><th>數量</th><th>金額</th><th>預覽</th></tr></thead><tbody>
     ${rows.map((x,i)=>`<tr class="${i===0?'active':''}" data-held-row="${x.id}">
      <td>${i+1}</td><td>${esc(x.phoneLast3||'—')}</td><td>${new Date(x.heldAt).toLocaleString('zh-TW')}</td><td>${(x.cart||[]).reduce((s,v)=>s+Number(v.qty||0),0)}</td><td>${money(x.total||0)}</td>
      <td><button class="button" data-held-preview="${x.id}">預覽</button></td>
     </tr>`).join('')||'<tr><td colspan="6">目前沒有暫存交易</td></tr>'}
    </tbody></table>
   </div>
   <div id="heldDetailBox">${rows[0]?heldTransactionDetailHtml(rows[0]):'<div class="notice">請先暫存交易</div>'}</div>
   <div class="held-actions">
    <button class="primary" id="heldRestore" ${rows.length?'':'disabled'}>帶入交易</button>
    <button class="button danger" id="heldDelete" ${rows.length?'':'disabled'}>刪除暫存</button>
    <button class="button" id="heldClose">離開</button>
   </div>
  </div>`);
 setTimeout(()=>{
  let selected=rows[0]?.id||'';
  const detail=document.querySelector('#heldDetailBox');
  document.querySelectorAll('[data-held-preview]').forEach(btn=>btn.onclick=()=>{
   selected=btn.dataset.heldPreview;
   const row=rows.find(x=>x.id===selected);
   document.querySelectorAll('[data-held-row]').forEach(tr=>tr.classList.toggle('active',tr.dataset.heldRow===selected));
   if(detail)detail.innerHTML=heldTransactionDetailHtml(row);
  });
  document.querySelector('#heldRestore')?.addEventListener('click',()=>restoreHeldTransaction(selected));
  document.querySelector('#heldDelete')?.addEventListener('click',()=>deleteHeldTransaction(selected));
  document.querySelector('#heldClose')?.addEventListener('click',()=>genericDialog.close());
 },0);
}



const ALCOHOL_STATE_KEY='yj_alcohol_reminder_state',ALCOHOL_HISTORY_KEY='yj_alcohol_reminder_history';
function alcoholReminderState(){return load(ALCOHOL_STATE_KEY,{enabled:true,updatedAt:'',updatedBy:''})||{enabled:true}}
function managerOrAboveByAccount(account){const a=String(account||'').trim();return load(K.employees,[]).find(x=>x.active!==false&&String(x.account||'').trim()===a&&['創辦人','管理員','店長'].includes(String(x.role||'')))||null}
async function toggleAlcoholReminder(){const account=prompt('請輸入店長以上的員編(帳號)','');if(account===null)return;const manager=managerOrAboveByAccount(account);if(!manager)return alert('驗證失敗：請輸入店長以上的員編(帳號)');const cur=alcoholReminderState(),next={enabled:cur.enabled===false,updatedAt:new Date().toISOString(),updatedBy:manager.name||manager.account||'',updatedByAccount:manager.account||'',source:'TM'};save(ALCOHOL_STATE_KEY,next);const hist=load(ALCOHOL_HISTORY_KEY,[])||[];hist.unshift({id:uid(),at:next.updatedAt,enabled:next.enabled,operatorName:manager.name||'',operatorAccount:manager.account||'',source:'TM'});save(ALCOHOL_HISTORY_KEY,hist);if(cloudConfigured())try{await cloudPushKey(ALCOHOL_STATE_KEY,next);await cloudPushKey(ALCOHOL_HISTORY_KEY,hist)}catch(_e){}saveAudit('酒類提醒開關',`${next.enabled?'開啟':'關閉'}｜${manager.name||manager.account}`);alert(`酒類提醒已${next.enabled?'開啟':'關閉'}`)}
let customerDisplaySyncTimer=0;
let customerDisplayLastPayload='';
let posSubtotalSignature='';
let posSubtotalReady=false;
let posGameSession=null;
let posGameCountdownTimer=0;
let posGameDeadlineTimer=0;
let posGamePollTimer=0;
const POS_CUSTOMER_GAME_MAX_DRAWS=4;
let posGameCompletedSignature='';
let posGameCompletedTransactionId='';
function posCheckoutSignature(){
 const cart=(state.cart||[]).map(x=>[x.id||x.productId,x.qty,x.price,!!x.ecPickup]);
 return JSON.stringify({cart,discount:Number(state.discount||0),member:state.member?.id||state.member?.code||'',redeem:Number(state.memberRedeemAmount||0),note:String(state.note||'')});
}
function subtotalReadyForCurrentTransaction(){return !!state.cart.length&&posSubtotalReady&&posSubtotalSignature===posCheckoutSignature()}
function localGameDateKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function activeCustomerGameActivities(){
 const cfg=customerMediaSettings(),today=localGameDateKey();
 let rows=Array.isArray(cfg.gameActivities)?cfg.gameActivities:[];
 if(!rows.length&&cfg.game?.enabled)rows=[{...cfg.game,id:cfg.game.id||'legacy-game',active:true,startDate:'',endDate:''}];
 return rows.filter(g=>g&&g.active!==false&&(!g.startDate||today>=String(g.startDate))&&(!g.endDate||today<=String(g.endDate)));
}
function gameCartItemMatchesProduct(c,ap){
 const p=products().find(x=>String(x.id)===String(c.productId||c.id));
 return [ap?.id,ap?.productId,ap?.code,ap?.barcode,ap?.name].filter(Boolean).some(v=>[p?.id,p?.code,p?.barcode,p?.name,c.id,c.productId,c.name].filter(Boolean).map(String).includes(String(v)));
}
function gameMatchedCartQty(g){
 const ps=Array.isArray(g?.products)?g.products:[];if(!ps.length)return 0;
 return (state.cart||[]).filter(c=>!c.ecPickup&&ps.some(ap=>gameCartItemMatchesProduct(c,ap))).reduce((sum,c)=>sum+Math.max(0,Number(c.qty||0)),0);
}
function gamePromotionRuleApplied(g,kind){
 const wanted=kind==='two-item-discount'?'多件折扣':'第2件折扣';
 const ps=Array.isArray(g?.products)?g.products:[];
 const matched=(state.cart||[]).filter(c=>!c.ecPickup&&(!ps.length||ps.some(ap=>gameCartItemMatchesProduct(c,ap))));
 if(!matched.length)return false;
 const itemHasRule=matched.some(c=>{const p=products().find(x=>String(x.id)===String(c.productId||c.id));return p&&(itemActivePromotions(p)||[]).some(r=>r.type===wanted&&(wanted!=='多件折扣'||Math.max(1,Number(r.qty||2))===2))});
 const applied=(totals().promotionApplications||[]).some(a=>a.type===wanted&&(wanted!=='多件折扣'||Number(a.qty||0)>=2));
 return itemHasRule&&applied;
}
function gameEligibleDrawCount(g){
 const qty=gameMatchedCartQty(g),rule=String(g?.triggerRule||'quantity');
 let required=Math.max(1,Math.floor(Number(g?.requiredQty||1)));
 // 2件打折／第二件打折是「客顯遊戲自己的觸發規則」，不是要求商品先存在另一個促銷活動。
 // 只要指定商品數量達門檻就應自動啟動；否則手動啟動會成功、按小計卻永遠不會啟動。
 if(rule==='two-item-discount'||rule==='second-item-discount')required=Math.max(2,required);
 if(qty<required)return 0;
 return Math.max(0,Math.floor(qty/required));
}
function gameProductMatchesCart(g){return gameEligibleDrawCount(g)>0}
function eligibleCustomerGame(){return activeCustomerGameActivities().find(gameProductMatchesCart)||null}
function weightedPosGamePrize(game){
 const rows=(Array.isArray(game?.prizes)?game.prizes:[]).filter(x=>x&&x.active!==false);if(!rows.length)return{name:'銘謝惠顧'};
 const total=rows.reduce((s,x)=>s+Math.max(0,Number(x.probability||0)),0);if(total<=0)return rows[Math.floor(Math.random()*rows.length)];
 let r=Math.random()*total;for(const x of rows){r-=Math.max(0,Number(x.probability||0));if(r<=0)return x}return rows.at(-1);
}
function gamePrizePayRate(prize){
 const name=String(prize?.name||prize?.label||'').trim();
 if(/^(0\s*元|免費|全額折抵|全免)$/i.test(name))return 0;
 const m=name.match(/([0-9]+(?:\.[0-9]+)?)\s*折/);
 if(!m)return null;
 const n=Number(m[1]);if(!Number.isFinite(n)||n<0)return null;
 return Math.max(0,Math.min(1,n<=10?n/10:n/100));
}
function gameEligibleUnits(game){
 const ps=Array.isArray(game?.products)?game.products:[];
 const units=[];if(!ps.length)return units;
 (state.cart||[]).forEach((c,cartIndex)=>{
  if(c.ecPickup)return;
  if(ps.length&&!ps.some(ap=>gameCartItemMatchesProduct(c,ap)))return;
  const qty=Math.max(0,Math.floor(Number(c.qty||0)));
  for(let i=0;i<qty;i++)units.push({cartIndex,itemId:c.productId||c.id,name:c.name||'',price:Math.max(0,Number(c.price||0))});
 });
 return units;
}
function gamePrizeDisplayLabel(game,prizeName){
 const rule=String(game?.triggerRule||'quantity');
 const required=Math.max(1,Math.floor(Number(game?.requiredQty||1)));
 if(rule==='second-item-discount')return `第二件${prizeName}`;
 if(rule==='two-item-discount')return `${required}件${prizeName}`;
 return prizeName;
}
function applyGamePrizeToTransaction(game,result,drawNo=1){
 if(!result||String(result.status||'done')!=='done')return null;
 const prizeName=String(result.prize||result.prizeName||'').trim();
 const payRate=gamePrizePayRate({name:prizeName});
 if(payRate===null)return null;
 const required=Math.max(1,Math.floor(Number(game?.requiredQty||1)));
 const units=gameEligibleUnits(game);
 const start=(Math.max(1,Number(drawNo||1))-1)*required;
 const group=units.slice(start,start+required);
 if(!group.length)return null;
 const base=Math.round(group.reduce((s,u)=>s+Number(u.price||0),0)*100)/100;
 const rule=String(game?.triggerRule||'quantity');
 let discount=0;
 if(rule==='second-item-discount'){
  // 第二件打折：只折該組的最後一件，不是整組一起打折。
  const target=group[group.length-1];
  discount=Math.round(Number(target?.price||0)*(1-payRate)*100)/100;
 }else{
  discount=Math.round(base*(1-payRate)*100)/100;
 }
 if(discount<=0)return null;
 if(!Array.isArray(state.gamePrizeApplications))state.gamePrizeApplications=[];
 const key=`${String(result.sessionId||'')}|${Number(drawNo||1)}`;
 if(state.gamePrizeApplications.some(x=>x.key===key))return null;
 const app={key,activityId:game?.id||'',activityName:game?.title||game?.name||'客顯遊戲',prize:prizeName,resultLabel:gamePrizeDisplayLabel(game,prizeName),triggerRule:rule,drawNo:Number(drawNo||1),qty:group.length,base,discount,payRate,items:group.map(x=>({itemId:x.itemId,name:x.name,price:x.price}))};
 state.gamePrizeApplications.push(app);
 return app;
}
function stopPosGameTimers(){clearTimeout(posGameCountdownTimer);clearTimeout(posGameDeadlineTimer);clearInterval(posGamePollTimer);posGameCountdownTimer=0;posGameDeadlineTimer=0;posGamePollTimer=0}
function posGameCustomerDrawCap(session=posGameSession){return Math.max(1,Math.min(POS_CUSTOMER_GAME_MAX_DRAWS,Number(session?.totalDraws||1)))}
function posGameCompletedForCurrentTransaction(){return !!state.cart.length&&String(posGameCompletedTransactionId||'')===String(state.transactionId||'')&&String(posGameCompletedSignature||'')===posCheckoutSignature()}
function markPosGameCompleted(){posGameCompletedTransactionId=String(state.transactionId||'');posGameCompletedSignature=posCheckoutSignature()}
function clearPosGameCompleted(){posGameCompletedTransactionId='';posGameCompletedSignature=''}
function updatePosGameCountdown(){const el=document.querySelector('#posGameCountdown');if(!el)return;const cap=posGameCustomerDrawCap();if(posGameSession?.status==='pending'&&posGameSession?.customerStarted)el.textContent=`客顯遊戲 ${Math.min(Number(posGameSession.currentDraw||1),cap)}/${cap} 客人已開始抽獎，等待結果…`;else if(posGameSession?.status==='pending')el.textContent=`客顯遊戲 ${Math.min(Number(posGameSession.currentDraw||1),cap)}/${cap} 倒數 ${Math.max(0,Number(posGameSession.remaining||0))} 秒`;else if(posGameSession?.status==='done')el.textContent=`遊戲完成：${posGameSession.prize||'已完成'}`;else el.textContent=''}
async function autoApplyRemainingGameDraws(game,finished,startDraw,totalDraws,source='pos-auto-remaining'){
 const rows=[];
 for(let drawNo=Math.max(1,Number(startDraw||1));drawNo<=Math.max(0,Number(totalDraws||0));drawNo++){
  const prize=weightedPosGamePrize(game);
  const result={sessionId:`${String(finished?.id||uid())}-auto-${drawNo}`,status:'done',source,prize:prize.name||'獎項',prizeId:prize.id||'',activityId:game?.id||'',transactionId:String(state.transactionId||''),drawNo,at:new Date().toISOString()};
  const app=applyGamePrizeToTransaction(game,result,drawNo);rows.push({result,app});
 }
 return rows;
}
async function finishPosGameSession(result={}){
 if(!posGameSession)return;
 const finished={...posGameSession};stopPosGameTimers();
 const applied=applyGamePrizeToTransaction(finished.game,result,finished.currentDraw||1);
 const existingKey=`${String(result.sessionId||'')}|${Number(finished.currentDraw||1)}`;
 const effectiveApplied=applied||(Array.isArray(state.gamePrizeApplications)?state.gamePrizeApplications.find(x=>x.key===existingKey):null);
 const enrichedResult={...result,status:String(result.status||'done'),transactionId:String(state.transactionId||''),resultLabel:String(effectiveApplied?.resultLabel||result.resultLabel||result.prize||result.prizeName||''),qty:Number(effectiveApplied?.qty||0),discount:Number(effectiveApplied?.discount||0),appliedDiscount:Number(effectiveApplied?.discount||0)};
 try{localStorage.setItem('yj_customer_display_game_result',JSON.stringify(enrichedResult))}catch(_){}
 try{await patchGameSession(finished.id,{status:String(enrichedResult.status||'done'),result:enrichedResult,completed_at:new Date().toISOString()})}catch(e){console.warn('complete game session',e)}
 try{await cloudPushKey('yj_customer_display_game_result',enrichedResult)}catch(_){}
 posGameSession.status='done';posGameSession.prize=result.prize||result.prizeName||'已完成';posGameSession.result=enrichedResult;updatePosGameCountdown();
 const totalDraws=Math.max(1,Number(finished.totalDraws||1));
 const currentDraw=Math.max(1,Number(finished.currentDraw||1));
 const customerCap=Math.min(POS_CUSTOMER_GAME_MAX_DRAWS,totalDraws);
 const source=String(result.source||'');
 // 按「電腦代抽」後，一次處理本交易所有剩餘抽數，不再逐次跳詢問。
 // 客人最多自行抽 4 次，第 5 次起由電腦自動完成。
 const forceAutoRemainder=source==='pos-auto'||currentDraw>=customerCap;
 const skipAllRemainder=source==='timeout-skip';
 if(!skipAllRemainder&&currentDraw<totalDraws&&forceAutoRemainder){
  const autoRows=await autoApplyRemainingGameDraws(finished.game,finished,currentDraw+1,totalDraws,source==='pos-auto'?'pos-auto-batch':'customer-limit-auto');
  const last=autoRows.at(-1)?.app;
  if(last){posGameSession.prize=`${last.resultLabel||last.prize||'已完成'}（其餘電腦代抽）`;posGameSession.result={...enrichedResult,autoDrawCount:autoRows.length,lastAutoResult:last.resultLabel||last.prize||''}}
 }
 if(!finished.manual&&!skipAllRemainder&&!forceAutoRemainder&&currentDraw<customerCap){
  posSubtotalReady=false;drawPOS();
  await forceCustomerDisplaySync();
  await startPosGameCountdown(finished.game,{totalDraws:finished.totalDraws,currentDraw:currentDraw+1});return;
 }
 // 本筆交易抽獎到此結束：之後誤按小計或手動啟動，都不可重新抽。
 markPosGameCompleted();
 posSubtotalReady=true;drawPOS();
 await forceCustomerDisplaySync();
}
async function gameSessionRequest(path,opts={}){
 const c=getCloudConfig();
 if(!c?.enabled||!c?.url||!c?.anonKey||!c?.storeId)throw new Error('Supabase 尚未設定');
 const r=await fetch(String(c.url).replace(/\/+$/,'')+'/rest/v1/'+path,{...opts,headers:{apikey:c.anonKey,Authorization:`Bearer ${c.anonKey}`,'Content-Type':'application/json',...(opts.headers||{})},cache:'no-store'});
 if(!r.ok){const t=await r.text().catch(()=>'');throw new Error(`game session ${r.status}: ${t||r.statusText}`)}
 if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null;
}
async function upsertGameSession(row){
 const c=getCloudConfig();
 return gameSessionRequest('yijia_customer_game_sessions?on_conflict=store_id,session_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify([{store_id:String(c.storeId),...row,updated_at:new Date().toISOString()}])});
}
async function patchGameSession(sessionId,patch){
 const c=getCloudConfig();
 return gameSessionRequest(`yijia_customer_game_sessions?store_id=eq.${encodeURIComponent(c.storeId)}&session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
}
async function fetchGameSession(sessionId){
 const c=getCloudConfig();
 const rows=await gameSessionRequest(`yijia_customer_game_sessions?select=*&store_id=eq.${encodeURIComponent(c.storeId)}&session_id=eq.${encodeURIComponent(sessionId)}&limit=1&_=${Date.now()}`);
 return rows?.[0]||null;
}
async function fetchCustomerGameResultDirect(){
 const sessionId=String(posGameSession?.id||'');
 const c=getCloudConfig();
 if(!c?.enabled||!c?.url||!c?.anonKey||!c?.storeId)return null;
 let dedicated=null,legacy=null;
 // 7.65：專用 session 與舊 yijia_app_state 要同時讀。
 // 客顯若已把 started/done 寫到任一通道，POS 不能被另一條仍停在 pending 的資料卡住。
 if(sessionId){
  try{
   const row=await fetchGameSession(sessionId);
   if(row){
    const result=row.result&&typeof row.result==='object'?row.result:{};
    dedicated={sessionId:row.session_id,status:row.status,activityId:row.activity_id||'',transactionId:row.transaction_id||'',at:row.updated_at,...result};
   }
  }catch(err){console.warn('fetch dedicated game session',err)}
 }
 try{
  const u=String(c.url).replace(/\/+$/,'')+`/rest/v1/yijia_app_state?select=data,updated_at&store_id=eq.${encodeURIComponent(c.storeId)}&data_key=eq.${encodeURIComponent('yj_customer_display_game_result')}&order=updated_at.desc&limit=1`;
  const r=await fetch(u,{headers:{apikey:c.anonKey,Authorization:`Bearer ${c.anonKey}`},cache:'no-store'});
  if(r.ok){const rows=await r.json();legacy=rows?.[0]?.data||null}else console.warn('legacy game result',r.status);
 }catch(err){console.warn('fetch legacy game result',err)}
 const same=x=>x&&String(x.sessionId||'')===sessionId;
 const rank=x=>{if(!same(x))return -1;const st=String(x.status||'');if(st==='done')return 3;if(st==='started')return 2;if(st==='skipped')return 1;if(st==='pending')return 0;return -1};
 // terminal/started 狀態優先，不以來源優先；同級時以時間較新的為準。
 const candidates=[dedicated,legacy].filter(same).sort((a,b)=>{
  const rd=rank(b)-rank(a);if(rd)return rd;
  return Date.parse(b?.at||0)-Date.parse(a?.at||0);
 });
 return candidates[0]||dedicated||legacy||null;
}
async function pollCustomerGameResult(){
 if(!posGameSession||posGameSession.status!=='pending')return;
 const accept=async r=>{
  if(!r||String(r.sessionId||'')!==String(posGameSession?.id||''))return 'ignore';
  const status=String(r.status||'');
  if(status==='started'){
   posGameSession.customerStarted=true;posGameSession.customerStartedAt=r.at||posGameSession.customerStartedAt||new Date().toISOString();
   clearTimeout(posGameCountdownTimer);posGameCountdownTimer=0;clearTimeout(posGameDeadlineTimer);posGameDeadlineTimer=0;updatePosGameCountdown();return 'started';
  }
  if(status==='done'){await finishPosGameSession(r);return 'done'}
  return 'ignore';
 };
 try{
  // 遊戲即時回傳不再走一般 cloudPullKey/localStorage 快取層，直接讀本門市最新雲端列。
  const remote=await fetchCustomerGameResultDirect();
  await accept(remote);
 }catch(err){console.warn('pollCustomerGameResult',err)}
}
async function startPosGameCountdown(game,{manual=false,totalDraws=1,currentDraw=1}={}){
 stopPosGameTimers();const sec=10;const now=Date.now();
 posGameSession={id:uid(),activityId:game?.id||'',title:game?.title||game?.name||'客顯遊戲',status:'pending',remaining:sec,manual,totalDraws:Math.max(1,Number(totalDraws||1)),currentDraw:Math.max(1,Number(currentDraw||1)),game,startedAt:new Date(now).toISOString(),deadlineAt:now+(sec*1000),customerStarted:false};
 try{await upsertGameSession({session_id:posGameSession.id,activity_id:String(posGameSession.activityId||''),transaction_id:String(state.transactionId||''),title:String(posGameSession.title||''),status:'pending',request:{sessionId:posGameSession.id,activityId:posGameSession.activityId,title:posGameSession.title,startedAt:posGameSession.startedAt,totalDraws:posGameCustomerDrawCap(posGameSession),currentDraw:Math.min(posGameSession.currentDraw,posGameCustomerDrawCap(posGameSession))},result:{},started_at:posGameSession.startedAt,deadline_at:new Date(posGameSession.deadlineAt).toISOString()})}catch(e){console.warn('create game session',e)}
 try{await cloudPushKey('yj_customer_display_game_result',{sessionId:posGameSession.id,status:'pending',transactionId:String(state.transactionId||''),at:new Date().toISOString()})}catch(_){}
 await forceCustomerDisplaySync();updatePosGameCountdown();
 // 手動啟動也必須走同一套倒數、started/done 監聽與折扣套用流程。
 // manual 只代表啟動來源，不再代表跳過遊戲流程。
 posGamePollTimer=setInterval(pollCustomerGameResult,250);
 // 顯示倒數與到時處理拆開：顯示每 100ms 依 deadline 真實重算；到時另有獨立 timeout。
 const tick=()=>{
  if(!posGameSession||posGameSession.status!=='pending'||posGameSession.customerStarted)return;
  const leftMs=Number(posGameSession.deadlineAt||0)-Date.now();
  posGameSession.remaining=Math.max(0,Math.ceil(leftMs/1000));
  updatePosGameCountdown();
  if(leftMs>0)posGameCountdownTimer=setTimeout(tick,100);
 };
 posGameCountdownTimer=setTimeout(tick,100);
 posGameDeadlineTimer=setTimeout(async()=>{
  if(!posGameSession||posGameSession.status!=='pending'||posGameSession.customerStarted)return;
  posGameSession.remaining=0;updatePosGameCountdown();
  await pollCustomerGameResult();
  if(!posGameSession||posGameSession.status!=='pending'||posGameSession.customerStarted)return;
  clearInterval(posGamePollTimer);posGamePollTimer=0;
  const yes=confirm('客顯 10 秒內尚未點選開始抽獎。是否由電腦代抽？');
  if(yes){const prize=weightedPosGamePrize(game);const result={sessionId:posGameSession.id,status:'done',source:'pos-auto',prize:prize.name||'獎項',prizeId:prize.id||'',activityId:game?.id||'',transactionId:String(state.transactionId||''),at:new Date().toISOString()};try{await patchGameSession(posGameSession.id,{status:'done',result,completed_at:new Date().toISOString()})}catch(_){};try{await cloudPushKey('yj_customer_display_game_result',result)}catch(_){};await finishPosGameSession(result)}
  else{const result={sessionId:posGameSession.id,status:'skipped',source:'timeout-skip',prize:'未抽獎',activityId:game?.id||'',transactionId:String(state.transactionId||''),at:new Date().toISOString()};try{await patchGameSession(posGameSession.id,{status:'skipped',result,completed_at:new Date().toISOString()})}catch(_){};try{await cloudPushKey('yj_customer_display_game_result',result)}catch(_){};await finishPosGameSession(result)}
 },sec*1000+50);
}
async function continueSubtotalFlow(){
 if(state.wasteMode)return; if(!state.cart.length)return alert('目前沒有商品，無法小計');
 const sig=posCheckoutSignature();
 // 同一筆交易已完成遊戲後，誤按小計只維持既有折扣，不會再建立新 session。
 if(posGameCompletedForCurrentTransaction()){
  posSubtotalSignature=sig;posSubtotalReady=true;stopPosGameTimers();drawPOS();await forceCustomerDisplaySync();return;
 }
 posSubtotalSignature=sig;posSubtotalReady=false;
 // 商品/會員等內容若已改變，視為新的小計條件，才重新計算遊戲。
 clearPosGameCompleted();state.gamePrizeApplications=[];
 await refreshCustomerDisplaySettingsCloud();const game=eligibleCustomerGame();
 if(!game){posSubtotalReady=true;posGameSession=null;drawPOS();return}
 const drawCount=gameEligibleDrawCount(game);
 await startPosGameCountdown(game,{totalDraws:Math.max(1,drawCount),currentDraw:1});drawPOS();
}
const CUSTOMER_INTERACTION_REQUEST='yj_customer_display_interaction_request';
const CUSTOMER_INTERACTION_RESPONSE='yj_customer_display_interaction_response';
async function waitCustomerInteraction(request,timeoutMs=90000){
 const req={...request,id:uid(),transactionId:String(state.transactionId||''),createdAt:new Date().toISOString(),status:'waiting'};
 save(CUSTOMER_INTERACTION_REQUEST,req);try{if(cloudConfigured())await cloudPushKey(CUSTOMER_INTERACTION_REQUEST,req)}catch(_e){}
 scheduleCustomerDisplaySync(0);
 const start=Date.now();
 while(Date.now()-start<timeoutMs){
  if(cloudConfigured())try{await cloudPullKey(CUSTOMER_INTERACTION_RESPONSE)}catch(_e){}
  const resp=load(CUSTOMER_INTERACTION_RESPONSE,null);
  if(resp&&String(resp.requestId||'')===String(req.id))return resp;
  await new Promise(r=>setTimeout(r,700));
 }
 return {requestId:req.id,action:'timeout'};
}
async function customerConfirmMember(m){
 const resp=await waitCustomerInteraction({type:'memberConfirm',title:'請確認會員資料',memberName:m?.name||'會員',memberNo:m?.code||m?.memberNo||'',memberPhone:m?.phone||''});
 return resp.action==='correct';
}
async function customerInputMember(){
 const resp=await waitCustomerInteraction({type:'memberInput',title:'請輸入會員'});
 return resp.action==='submit'?String(resp.value||'').trim():'';
}
async function customerConfirmPointRedeem(points,amount){
 const resp=await waitCustomerInteraction({type:'pointRedeem',title:'會員點數折抵確認',points:Number(points||0),amount:Number(amount||0),memberName:state.member?.name||'會員'});
 return resp.action==='confirm';
}

let tmMemberCustomerInputActive=false;

function setTmMemberCustomerInputStatus(active){
 tmMemberCustomerInputActive=!!active;
 refreshPosMessage();
}

function openSelfSubtotalMemberDialog(){
 const current=state.member;
 dlg('會員累點',`
  <div class="self-member-dialog">
   <h2>會員累點</h2>
   <p>請輸入手機號碼／會員編號</p>
   <input id="selfMemberInput" class="self-member-display" inputmode="none" readonly
     value="${esc(current?.phone||current?.code||current?.memberNo||'')}" placeholder="請輸入會員">
   <div id="selfMemberResult" class="self-member-result">
    ${current?`目前：<b>${esc(current.name||'會員')}</b>｜${esc(current.phone||current.code||'')}`:'尚未綁定會員'}
   </div>
   <div class="self-member-keypad">
    ${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-self-member-key="${n}">${n}</button>`).join('')}
    <span></span>
    <button type="button" data-self-member-key="0">0</button>
    <button type="button" class="self-member-clear" id="selfMemberClear">清除</button>
   </div>
   <div class="self-member-bottom-actions">
    <button type="button" class="primary" id="selfMemberConfirm">確認</button>
    <button type="button" class="danger" id="selfMemberCancel">取消累點</button>
   </div>
  </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#selfMemberInput');
  const result=document.querySelector('#selfMemberResult');
  document.querySelectorAll('[data-self-member-key]').forEach(btn=>btn.addEventListener('click',()=>{
   if(!input)return;
   if(input.value.length>=24)return;
   input.value+=btn.dataset.selfMemberKey||'';
   resetSelfIdleTimer();
  }));
  document.querySelector('#selfMemberClear')?.addEventListener('click',()=>{
   if(input)input.value='';
   if(result)result.textContent='尚未綁定會員';
   resetSelfIdleTimer();
  });
  document.querySelector('#selfMemberConfirm')?.addEventListener('click',async()=>{
   const q=String(input?.value||'').trim();
   if(!q)return alert('請輸入會員，或按「取消累點」');
   try{await refreshPosMembersCloud({redraw:false})}catch(_e){}
   const m=posFindMember(q);
   if(!m){
    if(result)result.innerHTML='<span class="bad-text">找不到會員，請重新輸入</span>';
    return;
   }
   state.member=m;state.memberRedeemPoints=0;state.memberRedeemAmount=0;
   genericDialog.close();
   await continueSubtotalFlow();
   resetSelfIdleTimer();
  });
  document.querySelector('#selfMemberCancel')?.addEventListener('click',async()=>{
   state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;
   genericDialog.close();
   await continueSubtotalFlow();
   resetSelfIdleTimer();
  });
 },0);
}

async function runSubtotalFlow(){
 if(state.wasteMode)return;
 if(!state.cart.length)return alert('目前沒有商品，無法小計');
 // 同一筆內容已完成小計後，再按一次小計不做任何動作。
 if(subtotalReadyForCurrentTransaction())return;
 if(isSelfCheckout()){
  openSelfSubtotalMemberDialog();
  return;
 }
 try{await refreshPosMembersCloud({redraw:false})}catch(_e){}
 const current=state.member;dlg('會員累點',`<div class="subtotal-member-dialog"><h3>請詢問客人是否有會員</h3><label>會員<input id="subtotalMemberInput" placeholder="手機號碼／會員編號／會員條碼" value="${esc(current?.phone||current?.code||current?.memberNo||'')}"></label><div id="subtotalMemberResult">${current?`目前：<b>${esc(current.name||'會員')}</b>｜${esc(current.phone||current.code||'')}`:'尚未綁定會員'}</div><div class="subtotal-member-actions"><button class="button" id="subtotalMemberCustomer">切換客顯</button><button class="primary" id="subtotalMemberConfirm">確認</button><button class="button danger" id="subtotalMemberCancel">取消累點</button></div></div>`);
 setTimeout(()=>{const input=document.querySelector('#subtotalMemberInput'),ok=document.querySelector('#subtotalMemberConfirm'),customer=document.querySelector('#subtotalMemberCustomer'),cancel=document.querySelector('#subtotalMemberCancel');
  if(ok)ok.onclick=async()=>{const q=String(input?.value||'').trim();let m=state.member;if(q){m=posFindMember(q);if(!m)return alert('找不到會員')}else if(!m)return alert('請輸入會員，或按「取消累點」');ok.disabled=true;ok.textContent='等待客人確認…';const correct=await customerConfirmMember(m);ok.disabled=false;ok.textContent='確認';if(!correct){state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;input.value='';document.querySelector('#subtotalMemberResult').innerHTML='<span class="bad-text">客人選擇「錯誤」，請重新輸入會員</span>';input.focus();return}state.member=m;state.memberRedeemPoints=0;state.memberRedeemAmount=0;genericDialog.close();await continueSubtotalFlow()};
  if(customer)customer.onclick=async()=>{
   customer.disabled=true;
   setTmMemberCustomerInputStatus(true);
   document.querySelector('#dialogBody').innerHTML='<div class="tm-member-input-wait"><div class="tm-member-input-icon">👤</div><h2>會員輸入中</h2><p>請等待客人在客顯完成會員輸入。</p></div>';
   const q=await customerInputMember();
   setTmMemberCustomerInputStatus(false);
   if(!q){genericDialog.close();return alert('客顯未完成會員輸入')}
   const m=posFindMember(q);
   if(!m){genericDialog.close();return alert('找不到客人輸入的會員，請重新輸入')}
   const correct=await customerConfirmMember(m);
   if(!correct){state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;genericDialog.close();return alert('客人確認會員錯誤，已清除，請重新輸入')}
   state.member=m;state.memberRedeemPoints=0;state.memberRedeemAmount=0;
   genericDialog.close();await continueSubtotalFlow()
  };
  if(cancel)cancel.onclick=async()=>{state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;genericDialog.close();await continueSubtotalFlow()};input?.focus()},0);
}

async function manualStartSecondScreenGame(){
 if(posGameCompletedForCurrentTransaction())return alert('本筆交易抽獎已完成，不能重複抽獎');
 await refreshCustomerDisplaySettingsCloud();const game=eligibleCustomerGame();if(!game)return alert('本筆交易沒有符合客顯遊戲活動的對應商品，無法啟動第二片螢幕遊戲');
 if(posGameSession?.status==='pending'){posGameSession.startedAt=new Date().toISOString();scheduleCustomerDisplaySync(0);alert('已重新送出第二片螢幕遊戲啟動指令');return}
 await startPosGameCountdown(game,{manual:true,totalDraws:Math.max(1,gameEligibleDrawCount(game)),currentDraw:1});alert('已送出第二片螢幕遊戲啟動指令');
}
function customerDisplayPayload(){
 const s=store();
 const sale=state.lastCompletedSale;
 if(sale){
  return {
   mode:'completed',
   paymentConnecting:false,
   storeCode:currentStoreCode(),
   storeName:s?.name||'億家門市',
   terminalMode:tmOperationMode(),
   transactionId:String(sale.id||state.transactionId||''),
   items:(sale.items||[]).filter(x=>!x.ecPickup).map(x=>({
    name:x.name||'',price:Number(x.price||0),qty:Number(x.qty||0),
    amount:Number(x.price||0)*Number(x.qty||0)
   })),
   subtotal:Number(sale.subtotal??sale.total??0),
   discount:Number(sale.discountTotal??sale.discount??0),
   total:Number(sale.total||0),
   tendered:Number(sale.tendered||sale.total||0),
   change:Number(sale.change||0),
   payment:sale.payment||sale.paymentMethod||'',
   memberName:sale.memberName||'',
   memberNo:sale.memberNo||sale.memberCode||'',
   memberPoints:Number(sale.memberPointsAfter||0),
   taxId:String(sale.taxId||sale.companyNo||''),
   promotions:[
    ...(Array.isArray(sale.promotions)?sale.promotions:(Array.isArray(sale.promotionApplications)?sale.promotionApplications.map(x=>({name:x.name||x.summary||x.type||'促銷活動',qty:Number(x.qty||0),discount:Number(x.discount||0)})):[])),
    ...(Array.isArray(sale.gamePrizeApplications)?sale.gamePrizeApplications.map(x=>({name:String(x.prize||'獎項'),qty:Number(x.qty||0),discount:Number(x.discount||0),resultLabel:String(x.resultLabel||x.prize||'獎項')})):[])
   ],
   gameRequest:posGameSession?.status==='pending'?{sessionId:posGameSession.id,activityId:posGameSession.activityId,title:posGameSession.title,startedAt:posGameSession.startedAt}:null,
   gameResultText:Array.isArray(sale.gamePrizeApplications)&&sale.gamePrizeApplications.length?String(sale.gamePrizeApplications.at(-1)?.resultLabel||sale.gamePrizeApplications.at(-1)?.prize||''):'',
   completedAt:sale.at||new Date().toISOString(),
   voiceCue:state.customerVoiceCue||null,
   specialNotice:state.customerDisplayNotice||null,
   updatedAt:new Date().toISOString()
  };
 }
 const t=totals();
 return {
  mode:state.wasteMode?'waste':'sale',
  terminalMode:tmOperationMode(),
  paymentConnecting:!!state.paymentConnecting,
  paymentConnectingMethod:String(state.paymentConnectingMethod||''),
  storeCode:currentStoreCode(),
  storeName:s?.name||'億家門市',
  transactionId:String(state.transactionId||''),
  items:(state.cart||[]).filter(x=>!x.ecPickup).map(x=>({
   name:x.name||'',price:Number(x.price||0),qty:Number(x.qty||0),
   amount:Number(x.price||0)*Number(x.qty||0),
   instant:!!x.freshDiscounted
  })),
  subtotal:Number(t.subtotal??t.merchandiseTotal??0),
  discount:Number((t.promotionDiscount||0)+(t.manualDiscount||0)+(t.pointDiscount||0)+(t.gamePrizeDiscount||0)),
  total:Number(t.total||0),
  memberName:state.member?.name||'',
  memberNo:state.member?.code||state.member?.memberNo||state.member?.id||'',
  memberPoints:Number(state.member?.points||0),
  taxId:String(state.taxId||''),
  gameRequest:posGameSession?.status==='pending'?{sessionId:posGameSession.id,activityId:posGameSession.activityId,title:posGameSession.title,startedAt:posGameSession.startedAt}:null,
  gameResultText:Array.isArray(t.gamePrizeApplications)&&t.gamePrizeApplications.length?String(t.gamePrizeApplications.at(-1)?.resultLabel||t.gamePrizeApplications.at(-1)?.prize||''):'',
  voiceCue:state.customerVoiceCue||null,
  specialNotice:state.customerDisplayNotice||null,
  promotions:[
   ...(state.cart||[]).filter(x=>!x.ecPickup).flatMap(x=>{
    const p=products().find(v=>String(v.id)===String(x.productId||x.id));
    const rows=p?(itemActivePromotions(p)||[]):[];
    return rows.slice(0,1).map(r=>({name:r.name||r.summary||r.type||'促銷活動',qty:Number(x.qty||0),discount:0}));
   }),
   ...(Array.isArray(t.gamePrizeApplications)?t.gamePrizeApplications:[]).map(x=>({name:String(x.prize||'獎項'),qty:Number(x.qty||0),discount:Number(x.discount||0),resultLabel:String(x.resultLabel||x.prize||'獎項')}))
  ],
  updatedAt:new Date().toISOString()
 };
}

let __posBackgroundAudio=null;
let __posMediaSettingsLast='';
function customerMediaSettings(){
 const cfg=load(K.customerDisplaySettings,{});
 return cfg&&typeof cfg==='object'?cfg:{};
}
function activeMusicFor(target){
 const rows=Array.isArray(customerMediaSettings().music)?customerMediaSettings().music:[];
 return rows.find(x=>x&&x.active!==false&&((target==='pos'&&x.pos===true)||(target==='customer'&&x.customer===true)))||null;
}
function ensurePosBackgroundMusic(){
 const track=activeMusicFor('pos');
 const signature=JSON.stringify(track||null);
 if(signature===__posMediaSettingsLast)return;
 __posMediaSettingsLast=signature;
 if(__posBackgroundAudio){try{__posBackgroundAudio.pause()}catch{}__posBackgroundAudio=null}
 if(!track?.url)return;
 const audio=new Audio(track.url);
 audio.loop=track.loop!==false;
 audio.volume=1; // 音量不做軟體控制，交給 iPhone/iPad 實體音量鍵。
 audio.preload='auto';
 __posBackgroundAudio=audio;
 const play=()=>audio.play().catch(()=>{});
 play();
 if(audio.paused){
  const once=()=>{play();document.removeEventListener('pointerdown',once)};
  document.addEventListener('pointerdown',once,{once:true});
 }
}
async function refreshCustomerDisplaySettingsCloud(){
 if(!cloudConfigured())return;
 try{await cloudPullKey(K.customerDisplaySettings);ensurePosBackgroundMusic()}catch(_){}
}
async function pushCustomerDisplayState(force=false){
 const payload=customerDisplayPayload();
 const compare=JSON.stringify({...payload,updatedAt:''});
 if(!force&&compare===customerDisplayLastPayload)return true;
 customerDisplayLastPayload=compare;
 localStorage.setItem(K.customerDisplayState,JSON.stringify(payload));
 if(cloudConfigured())return await cloudPushKey(K.customerDisplayState,payload);
 return true;
}
async function forceCustomerDisplaySync(){
 clearTimeout(customerDisplaySyncTimer);customerDisplaySyncTimer=0;
 return await pushCustomerDisplayState(true);
}
function scheduleCustomerDisplaySync(delay=180){
 clearTimeout(customerDisplaySyncTimer);
 customerDisplaySyncTimer=setTimeout(()=>{pushCustomerDisplayState(false)},delay);
}
function setCustomerVoiceCue(text,kind='status'){
 const cfg=load(K.customerDisplaySettings,{})||{};
 const defaults=[
  {event:'payment-processing',name:'交易中',text:'交易中',repeats:2,intervalMs:3000,active:true},
  {event:'take-card',name:'請取卡',text:'請取卡',repeats:2,intervalMs:2000,active:true}
 ];
 const rows=Array.isArray(cfg.voiceTypes)&&cfg.voiceTypes.length?cfg.voiceTypes:defaults;
 const row=rows.find(x=>x&&x.active!==false&&(String(x.event||'')===String(kind)||String(x.name||'')===String(text)))||defaults.find(x=>x.event===kind)||{};
 if(row.active===false)return null;
 state.customerVoiceCue={id:uid(),text:String(row.text||row.speakText||text||''),kind:String(kind||'status'),repeats:Math.max(1,Number(row.repeats||row.times||2)),intervalMs:Math.max(0,Number(row.intervalMs||((row.intervalSeconds||row.interval||0)*1000)||(kind==='take-card'?2000:3000))),audioUrl:String(row.audioUrl||row.url||row.soundUrl||''),at:new Date().toISOString()};
 return state.customerVoiceCue;
}
function paymentNeedsTakeCard(detail){
 const methods=[detail?.method,detail?.subtype,...(Array.isArray(detail?.breakdown)?detail.breakdown.map(x=>x?.method):[])].map(x=>String(x||''));
 return methods.some(x=>/信用卡|電子票證|悠遊卡|一卡通|icash/i.test(x));
}
function paymentProcessingWaitMs(detail,method=''){
 // Alpha 8.07: 交易等待時間只作為內部流程，不在 TM／客顯顯示倒數秒數。
 const methods=[method,detail?.method,detail?.subtype,...(Array.isArray(detail?.breakdown)?detail.breakdown.map(x=>x?.method):[])].map(x=>String(x||''));
 if(methods.some(x=>/信用卡/i.test(x)))return 25000;
 if(methods.some(x=>/電子票證|悠遊卡|一卡通|icash/i.test(x)))return 15000;
 if(methods.some(x=>/行動支付|億家\s*Pay|LINE\s*Pay|Apple\s*Pay|Google\s*Pay|Samsung|全盈|街口|悠遊付/i.test(x)))return 5000;
 return 1200;
}
function posHeaderCompanyNo(sale=null){
 return String(sale?.taxId||state.taxId||'—');
}
const TM_SC_LINK_KEY='yj_tm_sc_link';
const HQ_APP_SETTINGS_KEY='yj_hq_app_settings';
const APP_ANYBUY_ORDERS_KEY='yj_app_anybuy_orders';
const APP_MEMBER_PRODUCTS_KEY='yj_app_member_products';
const APP_ANYBUY_PAYMENT_SYNC_QUEUE_KEY='yj_app_anybuy_payment_sync_queue';
const APP_ANYBUY_RETURN_REQUESTS_KEY='yj_app_return_requests';
const APP_ANYBUY_RETURN_REQUESTS_LEGACY_KEY='yj_app_anybuy_return_requests';

function appAnybuyPendingOrdersLocal(){
 const rows=load(APP_ANYBUY_ORDERS_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
function appMemberProductsLocal(){
 const rows=load(APP_MEMBER_PRODUCTS_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
function appAnybuyOrderCode(x){
 return String(x?.paymentCode||x?.payment_code||x?.barcode||x?.code||x?.orderId||x?.id||'').trim();
}
function appAnybuyOrderId(x){
 return String(x?.orderId||x?.order_id||x?.id||'').trim();
}
function appAnybuyOrderStatus(x){
 return String(x?.status||x?.paymentStatus||x?.payment_status||'待付款').trim();
}
function appAnybuyOrderTotal(x){
 const direct=Number(x?.total??x?.amount??x?.payableAmount??x?.payable_amount);
 if(Number.isFinite(direct)&&direct>=0)return direct;
 return (Array.isArray(x?.items)?x.items:[]).reduce((sum,it)=>{
  const cartQty=Math.max(1,Number(it?.cartQuantity??it?.cart_quantity??1));
  return sum+Number(it?.price||0)*cartQty;
 },0);
}
function appAnybuyOrderItems(x){
 return Array.isArray(x?.items)?x.items:[];
}
function appAnybuyOrderItemNetAllocations(order){
 const items=appAnybuyOrderItems(order);
 const total=Math.max(0,Number(appAnybuyOrderTotal(order)||0));
 if(!items.length)return [];
 const explicit=items.map(it=>{
  const v=Number(it?.netAmount??it?.net_amount??it?.paidAmount??it?.paid_amount??it?.discountedTotal??it?.discounted_total);
  return Number.isFinite(v)&&v>=0?v:null;
 });
 if(explicit.every(v=>v!==null)){
  const sum=explicit.reduce((a,v)=>a+Number(v||0),0);
  if(Math.abs(sum-total)<0.011)return explicit.map(v=>Math.round(Number(v||0)*100)/100);
 }
 const gross=items.map(it=>Math.max(0,Number(it?.price||0))*Math.max(1,Number(it?.cartQuantity??it?.cart_quantity??1)));
 const grossTotal=gross.reduce((a,v)=>a+v,0);
 let used=0;
 return gross.map((g,i)=>{
  if(i===gross.length-1)return Math.max(0,Math.round((total-used)*100)/100);
  const value=grossTotal>0?Math.round(total*(g/grossTotal)*100)/100:0;
  used+=value;return value;
 });
}
function appAnybuyRedemptionRevenueAmount(entitlement,redeemQty){
 const remainingQty=Math.max(0,Math.floor(Number(entitlement?.remainingQuantity||0)));
 const q=Math.max(0,Math.min(remainingQty,Math.floor(Number(redeemQty||0))));
 if(!q||!remainingQty)return 0;
 const remainingValue=Math.max(0,Number(entitlement?.recognizedRevenueRemaining??entitlement?.netPaidRemaining??0));
 if(q>=remainingQty)return Math.round(remainingValue*100)/100;
 return Math.round((remainingValue*(q/remainingQty))*100)/100;
}

function appAnybuyOrderDeadline(x){
 return String(x?.paymentDeadline||x?.payment_deadline||x?.expiresAt||x?.expires_at||'').trim();
}
function appAnybuyOrderIsExpired(x){
 const raw=appAnybuyOrderDeadline(x);if(!raw)return false;
 const t=Date.parse(raw);return Number.isFinite(t)&&Date.now()>t;
}
function appAnybuyOrderPaymentMethod(x){
 return String(x?.paymentMethod||x?.payment_method||'店舖結帳').trim();
}
function appAnybuyStorePaymentAllowed(x){
 const m=appAnybuyOrderPaymentMethod(x).toLowerCase();
 return !m||['店舖結帳','門市結帳','store','store_checkout','store-checkout'].includes(m);
}
function appAnybuyMemberKey(x){
 return String(x?.memberId||x?.member_id||x?.memberNo||x?.member_no||x?.memberPhone||x?.member_phone||'').trim();
}
function appAnybuyPaymentSyncQueue(){
 const rows=load(APP_ANYBUY_PAYMENT_SYNC_QUEUE_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
function appAnybuyReturnRequestsLocal(){
 const rows=load(APP_ANYBUY_RETURN_REQUESTS_KEY,[]);
 if(Array.isArray(rows)&&rows.length)return rows;
 const legacy=load(APP_ANYBUY_RETURN_REQUESTS_LEGACY_KEY,[]);
 return Array.isArray(legacy)?legacy:[];
}
function appAnybuyReturnRequestCode(x){return String(x?.returnCode||x?.return_code||x?.code||'').trim()}
async function findAppAnybuyReturnRequest(code){
 const q=String(code||'').trim();if(!q)return null;
 let rows=appAnybuyReturnRequestsLocal();
 if(cloudConfigured()){
  try{
   const fresh=await cloudPullKey(APP_ANYBUY_RETURN_REQUESTS_KEY);if(Array.isArray(fresh))rows=fresh;
   if(!rows.length){const legacy=await cloudPullKey(APP_ANYBUY_RETURN_REQUESTS_LEGACY_KEY);if(Array.isArray(legacy))rows=legacy}
  }catch(e){console.warn('App隨買退貨申請同步失敗',e)}
 }
 return rows.find(x=>appAnybuyReturnRequestCode(x)===q)||null;
}
function appAnybuyReturnRequestExpired(req){
 const raw=String(req?.returnDeadline||req?.return_deadline||'').trim();
 const t=Date.parse(raw);return !!raw&&Number.isFinite(t)&&Date.now()>t;
}
function appAnybuyReturnRequestStatusOpen(req){
 return ['待回原門市辦理','待辦理','pending','requested'].includes(String(req?.status||'待回原門市辦理').trim());
}
function appAnybuyReturnRequestMemberProduct(req){
 const id=String(req?.memberProductId||req?.member_product_id||'').trim();
 const rows=appMemberProductsLocal();
 return rows.find(x=>String(x?.id||'')===id)||
  rows.find(x=>String(x?.orderId||'')===String(req?.orderId||'')&&String(x?.code||'')===String(req?.code||''));
}
async function completeAppAnybuyReturnRequest(req,saleId){
 if(!req)return false;
 let rows=appAnybuyReturnRequestsLocal();
 if(cloudConfigured())try{const fresh=await cloudPullKey(APP_ANYBUY_RETURN_REQUESTS_KEY);if(Array.isArray(fresh))rows=fresh}catch(_e){}
 const target=rows.find(x=>String(x?.id||'')===String(req?.id||''))||rows.find(x=>appAnybuyReturnRequestCode(x)===appAnybuyReturnRequestCode(req));
 if(!target)return false;
 const now=new Date().toISOString();
 Object.assign(target,{status:'已完成退貨',completedAt:now,completedStoreCode:currentStoreCode(),completedBy:currentUser()?.name||'',completedByAccount:currentUser()?.account||'',refundSaleId:String(saleId||''),updatedAt:now});
 save(APP_ANYBUY_RETURN_REQUESTS_KEY,rows);
 if(cloudConfigured())try{await cloudPushKey(APP_ANYBUY_RETURN_REQUESTS_KEY,rows)}catch(e){console.warn('隨買退貨申請完成同步失敗',e);return false}
 return true;
}

function queueAppAnybuyPaymentSync(payload){
 const rows=appAnybuyPaymentSyncQueue();
 const key=String(payload?.orderId||payload?.paymentCode||'');
 const i=rows.findIndex(x=>String(x?.orderId||x?.paymentCode||'')===key);
 const row={...payload,queuedAt:new Date().toISOString()};
 if(i>=0)rows[i]=row;else rows.unshift(row);
 save(APP_ANYBUY_PAYMENT_SYNC_QUEUE_KEY,rows.slice(0,100));
}
function removeAppAnybuyPaymentSyncQueue(orderId,paymentCode=''){
 const rows=appAnybuyPaymentSyncQueue().filter(x=>{
  if(orderId&&String(x?.orderId||'')===String(orderId))return false;
  if(paymentCode&&String(x?.paymentCode||'')===String(paymentCode))return false;
  return true;
 });
 save(APP_ANYBUY_PAYMENT_SYNC_QUEUE_KEY,rows);
}
function appAnybuyValidityUntil(paidAt,days){
 const n=Math.max(0,Math.floor(Number(days||0)));if(!n)return '';
 const d=new Date(paidAt);if(Number.isNaN(d.getTime()))return '';
 d.setDate(d.getDate()+n);return d.toISOString();
}
function anybuySaleLines(sale){
 return [...(Array.isArray(sale?.items)?sale.items:[]),...(Array.isArray(sale?.serviceItems)?sale.serviceItems:[])].filter(x=>x?.appAnybuyPayment===true||x?.appAnybuyDeposit===true||x?.appAnybuyRedeem===true);
}
function anybuyPurchaseLines(sale){return anybuySaleLines(sale).filter(x=>x?.appAnybuyPayment===true||x?.appAnybuyDeposit===true)}
function anybuyRedeemLines(sale){return anybuySaleLines(sale).filter(x=>x?.appAnybuyRedeem===true)}
function saleHasAnybuy(sale){return anybuySaleLines(sale).length>0}
function saleHasNormalGoodsWithAnybuy(sale){
 const anyIds=new Set(anybuySaleLines(sale).map(x=>String(x.lineId||x.id||'')));
 const normal=(Array.isArray(sale?.items)?sale.items:[]).filter(x=>!anyIds.has(String(x.lineId||x.id||''))&&!x?.appAnybuyPayment&&!x?.appAnybuyDeposit&&!x?.appAnybuyRedeem);
 return saleHasAnybuy(sale)&&normal.length>0;
}
function saleRecognizedRevenueNet(sale){
 const net=Math.max(0,Number(typeof saleNet==='function'?saleNet(sale):(sale?.netTotal??sale?.total??0)));
 const consignment=Math.max(0,Number(sale?.consignmentNetAmount??sale?.consignmentAmount??sale?.deferredRevenueAmount??0));
 return Math.max(0,Math.round((net-consignment)*100)/100);
}
function appAnybuyEntitlementsForSale(sale){
 const orderIds=new Set(anybuyPurchaseLines(sale).map(x=>String(x.appAnybuyOrderId||'')).filter(Boolean));
 const paymentCodes=new Set(anybuyPurchaseLines(sale).map(x=>String(x.appAnybuyPaymentCode||'')).filter(Boolean));
 return appMemberProductsLocal().filter(x=>
  (x?.orderId&&orderIds.has(String(x.orderId)))||
  (x?.paymentCode&&paymentCodes.has(String(x.paymentCode)))
 );
}
function appAnybuyPurchaseReturnEligibility(sale){
 const lines=anybuyPurchaseLines(sale);
 if(!lines.length)return {allowed:true,reason:''};
 const paidRaw=String(lines[0]?.appAnybuyPaidAt||sale?.at||'');
 const paidAt=Date.parse(paidRaw);
 if(!Number.isFinite(paidAt))return {allowed:false,reason:'找不到隨買付款時間，請先同步 App 訂單資料'};
 if(Date.now()-paidAt>7*24*60*60*1000)return {allowed:false,reason:'隨買商品已超過付款完成後 7 天，不能退貨'};
 const ent=appAnybuyEntitlementsForSale(sale);
 if(!ent.length)return {allowed:false,reason:'找不到會員「我的商品」資料，請先同步後再退貨'};
 const redeemed=ent.some(x=>Number(x?.remainingQuantity??0)<Number(x?.originalQuantity??0));
 if(redeemed)return {allowed:false,reason:'此隨買商品已經兌換過，不能退貨'};
 return {allowed:true,reason:''};
}
function appAnybuyLineReturnEligibility(sale,line){
 if(line?.appAnybuyRedeem===true)return {allowed:true,reason:'兌換交易只能用部分更正處理'};
 if(line?.appAnybuyPayment===true||line?.appAnybuyDeposit===true)return appAnybuyPurchaseReturnEligibility(sale);
 return {allowed:true,reason:''};
}
function wholeAnybuyTransactionCloseEligibility(sale){
 if(!saleHasAnybuy(sale))return {allowed:true,reason:''};
 if(saleHasNormalGoodsWithAnybuy(sale))return {allowed:false,reason:'此交易包含隨買代銷與一般商品，不能整筆作廢／整筆退貨，請使用「交易更正／部分退貨」'};
 if(anybuyRedeemLines(sale).length)return {allowed:false,reason:'隨買兌換交易不能整筆作廢／整筆退貨，請使用「交易更正／部分退貨」'};
 return appAnybuyPurchaseReturnEligibility(sale);
}
async function syncAppAnybuyReturnAfterSaleChange(saleId){
 const sale=load(K.sales,[]).find(x=>String(x.id)===String(saleId));if(!sale)return false;
 const purchaseLines=anybuyPurchaseLines(sale);if(!purchaseLines.length)return true;
 const fullyReturned=purchaseLines.every(x=>Number(x.returnedQty||0)>=Number(x.qty||0));
 if(!fullyReturned)return true;
 const orderIds=new Set(purchaseLines.map(x=>String(x.appAnybuyOrderId||'')).filter(Boolean));
 const codes=new Set(purchaseLines.map(x=>String(x.appAnybuyPaymentCode||'')).filter(Boolean));
 const now=new Date().toISOString();

 let owned=appMemberProductsLocal();
 owned=owned.map(x=>{
  const match=(x?.orderId&&orderIds.has(String(x.orderId)))||(x?.paymentCode&&codes.has(String(x.paymentCode)));
  if(!match)return x;
  return {...x,status:'已退貨',remainingQuantity:0,returnedAt:now,returnedSaleId:String(saleId),updatedAt:now};
 });
 save(APP_MEMBER_PRODUCTS_KEY,owned);
 if(cloudConfigured())try{await cloudPushKey(APP_MEMBER_PRODUCTS_KEY,owned)}catch(e){console.warn('隨買退貨同步我的商品失敗',e)}

 let orders=appAnybuyPendingOrdersLocal();
 orders=orders.map(x=>{
  const match=(appAnybuyOrderId(x)&&orderIds.has(appAnybuyOrderId(x)))||(appAnybuyOrderCode(x)&&codes.has(appAnybuyOrderCode(x)));
  if(!match)return x;
  return {...x,status:'已退貨',paymentStatus:'refunded',refundedAt:now,refundSaleId:String(saleId),updatedAt:now};
 });
 save(APP_ANYBUY_ORDERS_KEY,orders);
 if(cloudConfigured())try{await cloudPushKey(APP_ANYBUY_ORDERS_KEY,orders)}catch(e){console.warn('隨買退貨同步訂單失敗',e)}
 saveAudit('App隨買退貨',`${saleId}｜未兌換且7天內｜我的商品已鎖定退貨`);
 return true;
}


function tmHqAppSettings(){
 const base={
  tmPanel:{enabled:true,title:'TM 面板',welcome:'歡迎使用億家 TM',showMember:true,showNotices:true},
  selfPanel:{enabled:true,title:'自助結帳',welcome:'歡迎使用自助結帳',crossStoreRedeem:true,ecSend:true,ecPickup:true},
  appBackend:{enabled:true,maintenance:false,announcement:'',pointsSync:true,crossStoreRedeem:true}
 };
 const raw=load(HQ_APP_SETTINGS_KEY,null);
 if(!raw||typeof raw!=='object')return base;
 return {
  ...base,...raw,
  tmPanel:{...base.tmPanel,...(raw.tmPanel||{})},
  selfPanel:{...base.selfPanel,...(raw.selfPanel||{}),ecPickup:(raw.selfPanel?.ecPickup ?? raw.selfPanel?.pickup ?? base.selfPanel.ecPickup)},
  appBackend:{...base.appBackend,...(raw.appBackend||{})}
 };
}
async function refreshTmHqAppSettings(){
 if(cloudConfigured())try{await cloudPullKey(HQ_APP_SETTINGS_KEY)}catch(e){console.warn('App設定同步失敗',e)}
 return tmHqAppSettings();
}
function tmPanelSettingsBanner(){
 const cfg=tmHqAppSettings().tmPanel;
 if(cfg.enabled===false)return '<div class="tm-panel-disabled">TM 面板目前已由總部停用</div>';
 return `<div class="tm-hq-panel-banner"><div><b>${esc(cfg.title||'TM 面板')}</b><small>${esc(cfg.welcome||'')}</small></div></div>`;
}
function selfPanelSettingsBanner(){
 const cfg=tmHqAppSettings().selfPanel;
 if(cfg.enabled===false)return '<div class="self-panel-disabled">自助模式目前已由總部停用</div>';
 return `<div class="self-hq-panel-banner"><div><b>${esc(cfg.title||'自助結帳')}</b><small>${esc(cfg.welcome||'')}</small></div></div>`;
}
const SC_RUNTIME_KEY='yj_sc_runtime_state';
function scRuntimeRecord(){return load(SC_RUNTIME_KEY,{})||{}}
function scRuntimeRestarting(){const r=scRuntimeRecord();if(r.status!=='restarting')return false;const until=Date.parse(r.until||'');return !Number.isFinite(until)||Date.now()<until}
function scServiceConnected(){
 if(navigator.onLine!==true||!cloudConfigured()||scRuntimeRestarting())return false;
 const r=scRuntimeRecord(),status=String(r.status||'').toLowerCase(),at=Date.parse(r.updatedAt||'');
 if(status==='offline'||status==='restarting'||status==='closed')return false;
 if(status==='background'){
  const explicitUntil=Date.parse(r.until||'');
  const until=Number.isFinite(explicitUntil)?explicitUntil:(Number.isFinite(at)?at+10*60*1000:NaN);
  return Number.isFinite(until)&&Date.now()<=until;
 }
 // Alpha 8.06: online 不再使用舊 45 秒 heartbeat timeout，避免 SC 實際仍連線時被誤判斷線。
 return status==='online';
}
function showScDisconnectedNotice(context='transaction'){
 let layer=document.querySelector('#scDisconnectedNotice');if(layer)layer.remove();
 const messages={
  ec:'目前無法進行 EC 取貨結帳。EC 包裹仍可查詢與查看資料，待 SC 恢復連線後再完成交易。',
  collection:'目前無法進行繳帳單／代收交易，待 SC 恢復連線後再操作。',
  wasteLogin:'目前無法進行廢棄登入，待 SC 恢復連線後再操作。',
  wasteQuery:'目前無法查詢廢棄資料，待 SC 恢復連線後再查詢。',
  freshNear:'目前無法查詢鮮食即期資料，待 SC 恢復連線後再查詢。',
  freshExpired:'目前無法查詢鮮食過期資料，待 SC 恢復連線後再查詢。',
  ecFlow:'目前無法進行 EC 進店／EC 離店查詢或登入，待 SC 恢復連線後再操作。',
  transferIn:'目前無法查詢或登入貨單轉入，待 SC 恢復連線後再操作。',
  transaction:'目前無法進行需要 SC 連線的交易，待 SC 恢復連線後再操作。'
 };
 layer=document.createElement('div');layer.id='scDisconnectedNotice';layer.className='sc-disconnect-overlay';
 layer.innerHTML=`<div class="sc-disconnect-card"><h2>與 SC 斷開</h2><p>${esc(messages[context]||messages.transaction)}</p><div class="sc-disconnect-actions"><button class="primary" id="scDisconnectedConfirm">確認</button></div></div>`;
 document.body.appendChild(layer);document.querySelector('#scDisconnectedConfirm')?.addEventListener('click',()=>layer.remove());
}
function updateScDependentUi(){
 const online=scServiceConnected();
 document.querySelectorAll('[data-ec-checkout]').forEach(btn=>{btn.disabled=!online;btn.title=online?'':'與 SC 斷開，僅可查詢包裹';btn.classList.toggle('disabled-by-sc',!online)});
 const c=document.querySelector('#collectionSubmit');if(c){c.disabled=!online;c.title=online?'':'與 SC 斷開，無法繳帳單'}
}
async function refreshScRuntime(){if(cloudConfigured())try{await cloudPullKey(SC_RUNTIME_KEY)}catch(_e){}updatePosQuickButtonStates();updateScDependentUi()}
clearInterval(window.__yjScRuntimeTimer);window.__yjScRuntimeTimer=setInterval(()=>{if(!document.hidden)refreshScRuntime()},5000);setTimeout(refreshScRuntime,700);
const TM_CUSTOM_REMINDER_KEY='yj_tm_custom_reminders',HQ_TM_REMINDER_KEY='yj_hq_tm_reminders';
function tmLocalDateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function tmLocalMonthKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function tmReminderTargetDate(x){if(x?.createdLocalDate)return String(x.createdLocalDate);const d=x?.startAt?new Date(x.startAt):x?.updatedAt?new Date(x.updatedAt):new Date();return tmLocalDateKey(d)}
function tmReminderActive(x,now=Date.now()){
 if(!x||x.enabled===false)return false;
 const n=new Date(now),scope=x.scope||'daily',target=tmReminderTargetDate(x);
 if(scope==='today'&&tmLocalDateKey(n)!==target)return false;
 if(scope==='month'&&tmLocalMonthKey(n)!==String(target).slice(0,7))return false;
 const ss=x.startAt?new Date(x.startAt):null,ee=x.endAt?new Date(x.endAt):null;
 if(scope==='daily'){
  const min=n.getHours()*60+n.getMinutes(),smin=ss?ss.getHours()*60+ss.getMinutes():0,emin=ee?ee.getHours()*60+ee.getMinutes():1439;
  if(ee&&emin<smin){if(!(min>=smin||min<=emin))return false}else if(min<smin||min>emin)return false;
  return true;
 }
 const s=ss?.getTime(),e=ee?.getTime();if(Number.isFinite(s)&&now<s)return false;if(Number.isFinite(e)&&now>e)return false;return true
}
function tmReminderSeenKey(x,prefix='store'){const scope=x.scope||'daily',bucket=scope==='month'?tmLocalMonthKey():tmLocalDateKey();return `yj_tm_reminder_seen_${prefix}_${x.id}_${x.updatedAt||''}_${scope==='today'?'today':bucket}`}
function showNextTmCustomReminder(){
 if(document.querySelector('#tmCustomReminderOverlay'))return;
 const now=Date.now(),hq=(load(HQ_TM_REMINDER_KEY,[])||[]).map(x=>({...x,__source:'hq'})),store=(load(TM_CUSTOM_REMINDER_KEY,[])||[]).map(x=>({...x,__source:'store'})),rows=[...hq,...store];
 const x=rows.find(v=>{if(!tmReminderActive(v,now))return false;const key=tmReminderSeenKey(v,v.__source);return localStorage.getItem(key)!=='1'});if(!x)return;
 const key=tmReminderSeenKey(x,x.__source),layer=document.createElement('div');layer.id='tmCustomReminderOverlay';layer.className='sc-disconnect-overlay';layer.innerHTML=`<div class="sc-disconnect-card"><h2>${esc(x.title||'門市提醒')}</h2>${x.__source==='hq'?'<small style="display:block;margin-bottom:8px">總部提醒</small>':''}<p>${esc(x.message||'')}</p><div class="sc-disconnect-actions"><button class="primary" id="tmCustomReminderConfirm">確認</button></div></div>`;document.body.appendChild(layer);document.querySelector('#tmCustomReminderConfirm')?.addEventListener('click',()=>{localStorage.setItem(key,'1');layer.remove();setTimeout(showNextTmCustomReminder,100)})
}
async function refreshTmCustomReminders(){if(cloudConfigured())try{await cloudPullKey(TM_CUSTOM_REMINDER_KEY);await cloudPullKey(HQ_TM_REMINDER_KEY)}catch(_e){}showNextTmCustomReminder()}
clearInterval(window.__yjTmCustomReminderTimer);window.__yjTmCustomReminderTimer=setInterval(()=>{if(!document.hidden)refreshTmCustomReminders()},15000);setTimeout(refreshTmCustomReminders,1200);

function tmScLinkPayload(reason='heartbeat'){
 const cs=typeof cloudStatus==='function'?cloudStatus():{};
 return {storeCode:currentStoreCode(),tmVersion:tmDisplayVersion(),tmOnline:navigator.onLine===true&&window.__yjTmRestarting!==true,tmState:window.__yjTmRestarting===true?'restarting':'online',cloudConfigured:cloudConfigured(),cloudState:String(cs?.state||''),operator:currentUser()?.name||'',reason,updatedAt:new Date().toISOString()};
}
async function publishTmScLink(reason='heartbeat'){
 const payload=tmScLinkPayload(reason);save(TM_SC_LINK_KEY,payload);
 if(cloudConfigured())try{await cloudPushKey(TM_SC_LINK_KEY,payload)}catch(_e){}
 return payload;
}
function startTmScHeartbeat(){
 if(window.__yjTmScHeartbeat)return;
 window.__yjTmScHeartbeat=setInterval(()=>publishTmScLink('heartbeat'),15000);
 window.addEventListener('online',()=>publishTmScLink('online'));
 window.addEventListener('offline',()=>publishTmScLink('offline'));
 setTimeout(()=>publishTmScLink('startup'),600);
}
function posPeripheralStatus(name){
 if(name==='SC' || name==='SC連線')return scServiceConnected()?'正常':'異常';
 return '預作';
}
function posPeripheralHasAbnormal(){return ['SC'].some(n=>posPeripheralStatus(n)==='異常')}
function tmNoticeReadToken(){const u=currentUser();return `${currentStoreCode()}|${u?.id||u?.account||u?.name||'unknown'}`}
function tmNoticeRows(){return (Array.isArray(load(K.notices,[]))?load(K.notices,[]):[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')))}
function tmNoticeIsRead(x){return Array.isArray(x?.readBy)&&x.readBy.includes(tmNoticeReadToken())}
function tmNoticeUnreadCounts(){const rows=tmNoticeRows().filter(x=>!tmNoticeIsRead(x));return {normal:rows.filter(x=>String(x.priority||'normal')!=='urgent').length,urgent:rows.filter(x=>String(x.priority||'normal')==='urgent').length,total:rows.length}}
function posQuickButtons(){
 const bad=posPeripheralHasAbnormal(),c=tmNoticeUnreadCounts();
 return `<div class="pos-quick-stack">
  <button type="button" class="pos-quick-button peripheral ${bad?'abnormal':''}" data-action="tm-peripheral-popup">周邊</button>
  <button type="button" class="pos-quick-button notice ${c.urgent>0?'urgent':''}" data-page="tm-notices">通報${c.total?`<span class="pos-quick-badge">${c.total}</span>`:''}</button>
 </div>`;
}
function updatePosQuickButtonStates(){
 const p=document.querySelector('.pos-quick-button.peripheral');if(p)p.classList.toggle('abnormal',posPeripheralHasAbnormal());
 const n=document.querySelector('.pos-quick-button.notice'),c=tmNoticeUnreadCounts();if(n){n.classList.toggle('urgent',c.urgent>0);let b=n.querySelector('.pos-quick-badge');if(c.total){if(!b){b=document.createElement('span');b.className='pos-quick-badge';n.appendChild(b)}b.textContent=String(c.total)}else b?.remove()}
}
function openTmPeripheralPopup(){
 const names=['SC連線','發票機','票券機','悠遊卡','一卡通','刷卡機','行動EOB','Yiljia連線'];
 const token=String(Date.now());window.__tmPeripheralDetectToken=token;
 dlg('周邊設備狀態',`<div class="tm-peripheral-detecting"><div class="tm-peripheral-spinner"></div><div><strong>周邊設備偵測中…</strong><small id="tmPeripheralDetectCountdown">請稍候</small></div></div><div class="tm-peripheral-popup-list">${names.map((name,i)=>`<div class="tm-peripheral-popup-row"><span>${esc(name)}</span><b class="detecting" data-tm-peripheral-status="${i}">偵測中</b></div>`).join('')}</div><div class="tm-peripheral-popup-foot" id="tmPeripheralDetectFoot">正在檢查設備連線狀態，請稍候…</div><button class="button tm-peripheral-popup-close" data-action="close-dialog" disabled>關閉</button>`);
 genericDialog.classList.add('tm-peripheral-popup-dialog');
 const blockCancel=e=>{if(window.__tmPeripheralDetectToken===token)e.preventDefault()};
 genericDialog.addEventListener('cancel',blockCancel);
 genericDialog.addEventListener('close',()=>{genericDialog.removeEventListener('cancel',blockCancel);genericDialog.classList.remove('tm-peripheral-popup-dialog');if(window.__tmPeripheralDetectToken===token)window.__tmPeripheralDetectToken=''}, {once:true});
 try{publishTmScLink('peripheral-detect')}catch(_e){}
 let remain=10;
 const timer=setInterval(()=>{
  if(window.__tmPeripheralDetectToken!==token || !genericDialog.open){clearInterval(timer);return}
  remain--;
  const c=document.querySelector('#tmPeripheralDetectCountdown');if(c)c.textContent=remain>0?'請稍候':'完成';
  const bars=document.querySelectorAll('[data-tm-peripheral-status]');
  const passed=10-remain;
  bars.forEach((el,i)=>{if(i<Math.min(names.length,Math.floor(passed*names.length/9)))el.textContent='檢查中…'});
  if(remain<=0){
   clearInterval(timer);
   const scOk=posPeripheralStatus('SC')==='正常';
   const results=[
    [scOk?'OK':'未連線',scOk?'ok':'off'],
    ['未連線','off'],['未連線','off'],['未連線','off'],['未連線','off'],['未連線','off'],['未連線','off'],['未連線','off']
   ];
   document.querySelectorAll('[data-tm-peripheral-status]').forEach((el,i)=>{const r=results[i]||['未連線','off'];el.textContent=r[0];el.className=r[1]});
   const foot=document.querySelector('#tmPeripheralDetectFoot');if(foot)foot.textContent='周邊設備偵測完成';
   // 偵測完成後先解除鎖定，否則 close-dialog 事件會因 token 尚存在而被擋住。
   if(window.__tmPeripheralDetectToken===token)window.__tmPeripheralDetectToken='';
   const close=document.querySelector('.tm-peripheral-popup-close');if(close){close.disabled=false;close.removeAttribute('disabled')}
   const detecting=document.querySelector('.tm-peripheral-detecting');if(detecting)detecting.classList.add('done');
   updatePosQuickButtonStates();
  }
 },1000);
}
async function refreshTmNoticesCloud(){
 if(!cloudConfigured())return false;
 try{const before=JSON.stringify(load(K.notices,[]));await cloudPullKey(K.notices);const changed=before!==JSON.stringify(load(K.notices,[]));updatePosQuickButtonStates();return changed}catch(_e){updatePosQuickButtonStates();return false}
}
function tmPeripheralPage(){
 const sc=posPeripheralStatus('SC'),last=cloudStatus()?.lastSuccessAt||cloudStatus()?.updatedAt||'—';
 const devices=[
  {name:'發票機', sub:'預作功能', status:'預作'},
  {name:'票券機', sub:'預作功能', status:'預作'},
  {name:'悠遊卡', sub:'預作功能', status:'預作'},
  {name:'一卡通', sub:'預作功能', status:'預作'},
  {name:'刷卡機', sub:'預作功能', status:'預作'},
  {name:'行動EOB', sub:'由原電子秤改為行動 EOB', status:'預作'},
  {name:'二連式票機', sub:'預作功能', status:'預作'},
  {name:'FamiPort連線', sub:'預作功能', status:'預作'},
 ]
 if(window.__tmPeripheralDetail==='SC')return `<div class="tm-tool-page"><div class="tm-tool-head"><button class="button" data-action="tm-peripheral-back">← 返回周邊</button><h2>SC 連線狀態</h2></div><div class="tm-link-summary"><p><b>目前狀態：</b><span class="${sc==='正常'?'ok-text':'bad-text'}">${sc}</span></p><p><b>網路：</b>${navigator.onLine?'已連線':'離線'}</p><p><b>雲端設定：</b>${cloudConfigured()?'已設定':'未設定'}</p><p><b>最近雲端同步：</b>${esc(String(last))}</p><div class="toolbar"><button class="primary" data-action="tm-sc-refresh">重新連線／同步</button></div></div></div>`;
 return `<div class="tm-tool-page"><div class="tm-tool-head"><button class="button" data-page="pos">← 返回 TM</button><h2>周邊設備狀態</h2></div><div class="tm-link-summary tm-peripheral-note"><p><b>目前設定：</b>已移除「貼標機」，並將「電子秤」改為「行動 EOB」。其餘設備先以預作方式建立，之後可再逐項接通。</p></div><div class="tm-device-list tm-device-grid">
  <button class="tm-device-row" data-action="tm-sc-detail"><span><strong>SC連線</strong><small>後台連動</small></span><b class="${sc==='正常'?'ok':'bad'}">${sc}</b></button>
  ${devices.map(d=>`<button class="tm-device-row" data-action="tm-peripheral-prebuild" data-device="${esc(d.name)}"><span><strong>${esc(d.name)}</strong><small>${esc(d.sub)}</small></span><b class="pending">${esc(d.status)}</b></button>`).join('')}
 </div></div>`;
}
function tmNoticePage(){
 const detail=String(window.__tmNoticeDetailId||'');
 const rows=tmNoticeRows(),c=tmNoticeUnreadCounts();
 const codeOf=x=>String(x.noticeNo||x.code||x.id||'');
 const sourceOf=x=>String(x.department||x.source||x.unit||x.publisher||'總部');
 const classicTop=`${posHeader()}
  <section class="tm-notice-pos-table">
   <div class="pos-classic-row head"><span>項次</span><span>品名</span><span>單價</span><span>數量</span><span>金額</span></div>
   <div class="tm-notice-pos-empty" aria-hidden="true">${Array.from({length:5},()=>'<div></div>').join('')}</div>
  </section>
  <section class="tm-notice-pos-strip">
   <div><span>一般</span><b>${c.normal}</b><small>封</small></div>
   <div><span>緊急</span><b class="urgent">${c.urgent}</b><small>封</small></div>
   <div><span>全部</span><b>${rows.length}</b><small>封</small></div>
   <label>指示<input value="" readonly></label>
   <label>通報搜尋<input id="tmNoticeSearch" placeholder="主旨 / 編號"></label>
  </section>`;
 if(detail){
  const x=rows.find(v=>String(v.id)===detail);
  if(x)return `<div class="pos-classic tm-notice-classic tm-notice-layer2">
   ${classicTop}
   <section class="tm-notice-inline-document">
    <div class="tm-notice-inline-toolbar"><span>1</span><small>之 1</small><span>⌕</span><span class="spacer"></span><span>−</span><span>＋</span><span>↻</span><span>▣</span><span>列印</span><button class="tm-notice-inline-close" data-action="tm-notice-back">關閉</button></div>
    <article class="tm-notice-document">
     <table class="tm-notice-doc-meta"><tr><th>通報編號</th><td>${esc(codeOf(x))}</td><th>通報日期</th><td>${esc(String(x.date||''))}</td><th>保存期限</th><td>${esc(String(x.endDate||x.expireDate||'—'))}</td></tr><tr><th>級別</th><td>${String(x.priority)==='urgent'?'緊急':'一般'}</td><th>發文單位</th><td>${esc(sourceOf(x))}</td><th>歸檔檔案</th><td>一般通報</td></tr><tr><th>主旨</th><td colspan="5">${esc(x.subject||'')}</td></tr></table>
     <h2>發文主旨：${esc(x.subject||'')}</h2>
     <div class="tm-notice-doc-body">${esc(x.body||x.content||x.subject||'').replace(/\n/g,'<br>')}</div>
    </article>
   </section>
   <div class="tm-notice-bottom-actions"><button class="button" data-action="tm-notice-refresh">重整</button><button class="button" data-page="pos">離開</button></div>
  </div>`;
  window.__tmNoticeDetailId='';
 }
 return `<div class="pos-classic tm-notice-classic tm-notice-layer1">
  ${classicTop}
  <section class="tm-notice-inline-list" id="tmNoticeLegacyList">
   ${rows.map(x=>`<button class="tm-notice-inline-row ${tmNoticeIsRead(x)?'read':''} ${String(x.priority)==='urgent'?'urgent':''}" data-tm-notice="${esc(x.id)}" data-search="${esc(`${x.subject||''} ${codeOf(x)} ${sourceOf(x)}`.toLowerCase())}"><span class="mail">✉</span><span class="subject">${esc(x.subject||'')}</span><span class="meta">${esc(String(x.date||''))} ${esc(sourceOf(x))}</span></button>`).join('')||'<div class="empty">目前沒有通報資料</div>'}
  </section>
  <div class="tm-notice-bottom-actions"><button class="button" data-action="tm-notice-refresh">重整</button><button class="button" data-page="pos">離開</button></div>
 </div>`;
}
async function openTmNotice(id){const rows=tmNoticeRows(),x=rows.find(v=>String(v.id)===String(id));if(!x)return;x.readBy=Array.isArray(x.readBy)?x.readBy:[];const token=tmNoticeReadToken();if(!x.readBy.includes(token)){x.readBy.push(token);save(K.notices,rows);if(cloudConfigured())try{await cloudPushKey(K.notices,rows)}catch(_e){}}window.__tmNoticeDetailId=String(id);render('tm-notices')}
function bindTmNoticeSearch(){const input=document.querySelector('#tmNoticeSearch');if(!input)return;input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll('.tm-notice-legacy-row').forEach(row=>{row.style.display=!q||String(row.dataset.search||'').includes(q)?'grid':'none'})})}
function posHeader(sale=null){
 if(!sale&&!state.wasteMode&&!state.transactionId)state.transactionId='T'+Date.now();
 const txn=sale?.id||state.transactionId||'—';
 const now=sale?.at?new Date(sale.at):new Date();
 const waste=!sale&&state.wasteMode===true;
 return `<header class="pos-classic-head">
  <div class="pos-sale-title-wrap">
   <div class="pos-sale-title ${waste?'pos-waste-title':''}"><button type="button" class="pos-voice-shortcut" data-action="voice-shortcut" title="語音快捷" aria-label="語音快捷">🎙</button> <strong>${waste?'廢棄':'銷售'}</strong></div>
   ${waste?'<button type="button" class="pos-waste-exit-button" data-action="exit-waste-mode">離開</button>':''}
  </div>
  <div class="pos-head-meta">
   <div>交易序號：<b id="posHeaderTxn">${esc(txn)}</b></div>
   <div>統一編號：<b id="posHeaderTax">${esc(posHeaderCompanyNo(sale))}</b></div>
  </div>
  <div class="pos-head-store">
   <div>版本：${tmDisplayVersion()}</div>
   <div>店號：${esc(currentStoreCode())}</div>
   <div>收銀員：${esc(currentUser()?.name||'')}</div>
   <div>${now.toLocaleString('zh-TW',{hour12:false})}</div>
  </div>
  ${posQuickButtons()}
 </header>`;
}
function tmCategoryDisplayName(name){
 const raw=String(name||'').trim();
 return raw.toUpperCase()==='FF'?'蕃薯':raw;
}
function posCategoryTabs(){
 const cfg=tmScreenCategories();
 const cats=cfg.length
  ? cfg.map(x=>String(x.name||'').trim()).filter(Boolean)
  : [...new Set(products().map(x=>String(x.category||'其他').trim()).filter(Boolean))];
 const list=[...cats];
 if(!list.length)return '';
 if(!list.includes(state.category))state.category=list[0];
 return list.map(x=>`<button class="category ${state.category===x?'active':''}" data-category="${esc(x)}">${esc(tmCategoryDisplayName(x))}</button>`).join('');
}

async function findAppAnybuyStorePaymentOrder(code){
 const q=String(code||'').trim();if(!q)return null;
 let rows=appAnybuyPendingOrdersLocal();
 if(cloudConfigured()){
  try{
   const fresh=await cloudPullKey(APP_ANYBUY_ORDERS_KEY);
   if(Array.isArray(fresh))rows=fresh;
  }catch(e){console.warn('App隨買待付款訂單同步失敗',e)}
 }
 return rows.find(x=>[
  x?.paymentCode,x?.payment_code,x?.barcode,x?.code,x?.orderId,x?.order_id,x?.id
 ].some(v=>String(v||'').trim()===q))||null;
}
function appAnybuyStorePaymentOrderHtml(order){
 const items=appAnybuyOrderItems(order),total=appAnybuyOrderTotal(order);
 return `<div class="app-anybuy-storepay">
  <div class="notice"><b>已辨識 App 店舖結帳訂單</b><br>
   付款條碼：${esc(appAnybuyOrderCode(order)||'—')}<br>
   訂單編號：${esc(appAnybuyOrderId(order)||'—')}<br>
   會員：${esc(order?.memberName||order?.member_name||order?.memberPhone||order?.member_phone||appAnybuyMemberKey(order)||'—')}<br>
   付款期限：${esc(appAnybuyOrderDeadline(order)||'未設定')}<br>
   狀態：${esc(appAnybuyOrderStatus(order))}
  </div>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>商品</th><th>購買組數</th><th>取得數量</th><th>單價</th><th>小計</th></tr></thead>
   <tbody>${items.map(it=>{
    const cartQty=Math.max(1,Number(it?.cartQuantity??it?.cart_quantity??1));
    const acquiredQty=Math.max(1,Number(it?.quantity??it?.qty??1));
    const price=Number(it?.price||0);
    return `<tr><td>${esc(it?.name||it?.productName||it?.product_name||it?.code||'隨買商品')}</td><td>購買 ${cartQty} 組</td><td>取得 ${acquiredQty} 件</td><td>${money(price)}</td><td>${money(price*cartQty)}</td></tr>`;
   }).join('')||'<tr><td colspan="5">訂單未附商品明細</td></tr>'}</tbody>
  </table></div>
  <div class="checkout-amount"><small>應收金額</small><strong>${money(total)}</strong></div>
 </div>`;
}
async function openAppAnybuyStorePaymentOrder(order){
 if(!order)return alert('找不到 App 店舖結帳訂單');
 const status=appAnybuyOrderStatus(order);
 if(['已付款','paid','完成','completed'].includes(status.toLowerCase())||['已付款','完成'].includes(status))return alert('此訂單已完成付款');
 if(['取消','已取消','cancelled','canceled'].includes(status.toLowerCase())||['取消','已取消'].includes(status))return alert('此訂單已取消');
 if(appAnybuyOrderIsExpired(order))return alert('此訂單付款期限已過，無法收款');
 if(!appAnybuyStorePaymentAllowed(order))return alert('此訂單不是「店舖結帳」訂單');
 const total=appAnybuyOrderTotal(order);
 if(!(total>0))return alert('訂單金額無效，無法結帳');
 if((state.cart||[]).some(x=>x?.appAnybuyPayment===true||x?.appAnybuyDeposit===true))return alert('同一筆交易目前只能帶入一筆 App 隨買店舖結帳訂單。');

 dlg('App 隨買｜店舖結帳',`${appAnybuyStorePaymentOrderHtml(order)}
  <div class="toolbar" style="justify-content:flex-end">
   <button class="button" id="appAnybuyStorePayCancel">取消</button>
   <button class="primary" id="appAnybuyStorePayGo">帶入 TM 收款</button>
  </div>`);
 setTimeout(()=>{
  document.querySelector('#appAnybuyStorePayCancel')?.addEventListener('click',()=>genericDialog.close());
  document.querySelector('#appAnybuyStorePayGo')?.addEventListener('click',()=>{
   const orderId=appAnybuyOrderId(order),paymentCode=appAnybuyOrderCode(order);
   const sourceItems=appAnybuyOrderItems(order);
   const allocations=appAnybuyOrderItemNetAllocations(order);
   if(sourceItems.length){
    sourceItems.forEach((it,i)=>{
     const cartQty=Math.max(1,Math.floor(Number(it?.cartQuantity??it?.cart_quantity??1)));
     const acquiredQty=Math.max(1,Math.floor(Number(it?.quantity??it?.qty??1)));
     const allocated=Math.max(0,Number(allocations[i]||0));
     const netUnit=allocated/cartQty;
     state.cart.push({
      id:`APP-ANYBUY-${orderId||paymentCode}-${String(it?.productId||it?.product_id||it?.id||i)}`,
      productId:String(it?.productId||it?.product_id||it?.id||''),
      code:String(it?.code||it?.productCode||it?.product_code||paymentCode),
      name:String(it?.name||it?.productName||it?.product_name||'隨買商品'),
      price:netUnit,
      originalUnitPrice:Number(it?.price||0),
      cost:0,
      qty:cartQty,
      cartQuantity:cartQty,
      acquiredQuantity:acquiredQty,
      actualQuantity:acquiredQty,
      validityDays:Math.max(0,Math.floor(Number(it?.validityDays||it?.valid_days||0))),
      manualAmount:true,
      appAnybuyPayment:true,
      appAnybuyDeposit:true,
      appAnybuyRedeem:false,
      pointsEligible:true,
      consignmentSale:true,
      consignmentType:'隨買跨店取',
      excludeFromRevenue:true,
      deferredRevenueAmount:allocated,
      appAnybuyOrderId:orderId,
      appAnybuyPaymentCode:paymentCode,
      appAnybuyMemberKey:appAnybuyMemberKey(order),
      appAnybuyProductId:String(it?.productId||it?.product_id||it?.id||''),
      appAnybuyProductCode:String(it?.code||it?.productCode||it?.product_code||''),
      category:'App隨買',
      allowNegativeStock:true
     });
    });
   }else{
    state.cart.push({
     id:`APP-ANYBUY-${orderId||paymentCode}`,code:paymentCode,name:`App 隨買店舖結帳 ${orderId||paymentCode}`,
     price:total,cost:0,qty:1,cartQuantity:1,acquiredQuantity:1,manualAmount:true,
     appAnybuyPayment:true,appAnybuyDeposit:true,appAnybuyRedeem:false,pointsEligible:true,
     consignmentSale:true,consignmentType:'隨買跨店取',excludeFromRevenue:true,deferredRevenueAmount:total,
     appAnybuyOrderId:orderId,appAnybuyPaymentCode:paymentCode,appAnybuyMemberKey:appAnybuyMemberKey(order),
     category:'App隨買',allowNegativeStock:true
    });
   }
   state.discount=0;
   state.payment='現金';
   state.note=[state.note,`App隨買店舖結帳｜${orderId||paymentCode}`].filter(Boolean).join('｜');
   window.__yjAppAnybuyPendingPayment={
    orderId,paymentCode,
    orderSnapshot:structuredClone(order)
   };
   genericDialog.close();
   render('pos');setTimeout(()=>{drawPOS();openCheckoutDialog()},20);
  });
 },0);
}
async function finalizeAppAnybuyStorePayment(orderSnapshot,sale){
 const orderId=appAnybuyOrderId(orderSnapshot),paymentCode=appAnybuyOrderCode(orderSnapshot);
 const paidAt=new Date().toISOString();
 const payload={orderId,paymentCode,saleId:String(sale?.id||''),paidAt,storeCode:currentStoreCode(),operator:currentUser()?.name||'',operatorAccount:currentUser()?.account||''};
 try{
  let orders=appAnybuyPendingOrdersLocal();
  if(cloudConfigured()){
   const fresh=await cloudPullKey(APP_ANYBUY_ORDERS_KEY);
   if(Array.isArray(fresh))orders=fresh;
  }
  const i=orders.findIndex(x=>(orderId&&appAnybuyOrderId(x)===orderId)||(paymentCode&&appAnybuyOrderCode(x)===paymentCode));
  if(i<0)throw new Error('雲端找不到待付款訂單');
  const current=orders[i];
  const status=appAnybuyOrderStatus(current);
  if(['已付款','paid','完成','completed'].includes(status.toLowerCase())||['已付款','完成'].includes(status)){
   removeAppAnybuyPaymentSyncQueue(orderId,paymentCode);return true;
  }
  orders[i]={
   ...current,
   status:'已付款',
   paymentStatus:'paid',
   paidAt,
   paidStoreCode:currentStoreCode(),
   paidStoreName:String(localStorage.getItem('yj_store_name')||'').replace(/^"|"$/g,''),
   tmSaleId:String(sale?.id||''),
   paidBy:currentUser()?.name||'',
   paidByAccount:currentUser()?.account||'',
   updatedAt:paidAt
  };
  save(APP_ANYBUY_ORDERS_KEY,orders);
  if(cloudConfigured()){
   const ok=await cloudPushKey(APP_ANYBUY_ORDERS_KEY,orders);
   if(ok===false)throw new Error('訂單付款狀態同步失敗');
  }

  let owned=appMemberProductsLocal();
  if(cloudConfigured()){
   try{const freshOwned=await cloudPullKey(APP_MEMBER_PRODUCTS_KEY);if(Array.isArray(freshOwned))owned=freshOwned}catch(_e){}
  }
  const memberKey=appAnybuyMemberKey(current)||appAnybuyMemberKey(orderSnapshot);
  const sourceOrder=appAnybuyOrderItems(current).length?current:orderSnapshot;
  const sourceItems=appAnybuyOrderItems(sourceOrder);
  const netAllocations=appAnybuyOrderItemNetAllocations(sourceOrder);
  for(let itemIndex=0;itemIndex<sourceItems.length;itemIndex++){
   const it=sourceItems[itemIndex];
   const qty=Math.max(1,Math.floor(Number(it?.quantity||it?.qty||1)));
   const netPaidTotal=Math.max(0,Number(netAllocations[itemIndex]||0));
   const validityDays=Math.max(0,Math.floor(Number(it?.validityDays||it?.valid_days||0)));
   const productCode=String(it?.code||it?.productCode||it?.product_code||'').trim();
   const entitlementId=`ENT-${orderId||paymentCode}-${productCode||String(it?.id||'ITEM')}`;
   const existing=owned.findIndex(x=>String(x?.id||'')===entitlementId);
   const row={
    id:entitlementId,
    memberId:String(current?.memberId||current?.member_id||orderSnapshot?.memberId||orderSnapshot?.member_id||''),
    memberNo:String(current?.memberNo||current?.member_no||orderSnapshot?.memberNo||orderSnapshot?.member_no||''),
    memberPhone:String(current?.memberPhone||current?.member_phone||orderSnapshot?.memberPhone||orderSnapshot?.member_phone||''),
    memberKey,
    orderId:orderId||String(current?.id||''),
    paymentCode,
    productId:String(it?.productId||it?.product_id||it?.id||''),
    code:productCode,
    name:String(it?.name||it?.productName||it?.product_name||'隨買商品'),
    category:String(it?.category||'隨買'),
    cartQuantity:Math.max(1,Math.floor(Number(it?.cartQuantity??it?.cart_quantity??1))),
    originalQuantity:qty,
    remainingQuantity:qty,
    netPaidTotal,
    netPaidRemaining:netPaidTotal,
    recognizedRevenueTotal:netPaidTotal,
    recognizedRevenueRemaining:netPaidTotal,
    recognizedRevenueAmount:0,
    validityDays,
    validFrom:paidAt,
    validUntil:appAnybuyValidityUntil(paidAt,validityDays),
    activityStartDate:String(it?.activityStartDate||''),
    activityEndDate:String(it?.activityEndDate||''),
    activityContent:String(it?.activityContent||''),
    status:'可兌換',
    source:'store_checkout',
    paidStoreCode:currentStoreCode(),
    tmSaleId:String(sale?.id||''),
    createdAt:paidAt,
    updatedAt:paidAt
   };
   if(existing>=0)owned[existing]={...owned[existing],...row};
   else owned.unshift(row);
  }
  save(APP_MEMBER_PRODUCTS_KEY,owned);
  if(cloudConfigured()){
   const ok=await cloudPushKey(APP_MEMBER_PRODUCTS_KEY,owned.slice(0,5000));
   if(ok===false)throw new Error('我的商品同步失敗');
  }
  removeAppAnybuyPaymentSyncQueue(orderId,paymentCode);
  saveAudit('App隨買店舖結帳',`${orderId||paymentCode}｜${money(appAnybuyOrderTotal(current))}｜交易 ${sale?.id||''}`);
  return true;
 }catch(err){
  console.warn('App隨買店舖結帳後同步失敗',err);
  queueAppAnybuyPaymentSync({...payload,orderSnapshot});
  return false;
 }
}
async function retryAppAnybuyPaymentSyncQueue(){
 if(!cloudConfigured())return;
 const rows=appAnybuyPaymentSyncQueue();if(!rows.length)return;
 for(const q of rows.slice(0,10)){
  try{
   const fakeSale={id:q.saleId||''};
   const ok=await finalizeAppAnybuyStorePayment(q.orderSnapshot||{orderId:q.orderId,paymentCode:q.paymentCode},fakeSale);
   if(!ok)break;
  }catch(_e){break}
 }
}

function openAnybuyServiceFlow(title,kind){
 const isEasy=String(kind).startsWith('easycard');
 const isDeposit=String(kind).includes('deposit');
 const accounting=isDeposit
  ?'寄杯／購買只收款並建立可兌換數量，不列入日商；實際日商於兌換時認列。'
  :'兌換時依該商品實際淨付款金額（折價券／活動折扣後）按本次兌換數量認列日商；累計不會超過原實付金額。';
 dlg(title,`<div class="anybuy-service-flow"><h2>${esc(title)}</h2><p>${isEasy?'請感應悠遊卡':'請掃描 App 條碼'}</p><div class="notice">${isEasy?'悠遊卡感應入口已建立':'App 條碼掃描入口已建立'}。${accounting}</div><button class="button" id="anybuyServiceClose">返回</button></div>`);
 setTimeout(()=>document.querySelector('#anybuyServiceClose')?.addEventListener('click',()=>genericDialog.close()),0);
}
function posMenuGroups(){
 return [
  {id:'商品',icon:'🛒',items:[['hold-current-transaction','交易暫存'],['held-transactions','暫存查詢']]},
  {id:'加值',icon:'💳',items:[['stored-value-topup','票證加值'],['stored-value-balance','餘額查詢']]},
  {id:'取貨',icon:'📦',page:'pickup',items:[]},
  {id:'管理',icon:'⚙️',items:[['ec-flow-page','EC收發作業'],['logistics','物流簽到'],['transfer-in-page','貨單轉入']]},
  {id:'隨買跨店取',icon:'🥤',items:[['anybuy-deposit','隨買跨店取寄杯'],['anybuy-redeem','隨買跨店取領取'],['easycard-deposit','悠遊卡寄杯'],['easycard-redeem','悠遊卡領取']]},
  {id:'打卡',icon:'🕘',directAction:'attendance-clock',items:[]},
  {id:'會員查詢',icon:'👤',items:[['member-lookup','輸入手機號碼'],['member-lookup','查詢'],['member-lookup','新增'],['member-lookup','折抵']]},
  {id:'查詢',icon:'🔍',items:[['product-lookup','商品查詢']]},
  {id:'應免稅',icon:'🧾',items:[['add-taxable-amount','應稅'],['add-taxfree-amount','免稅']]},
  {id:'廢棄',icon:'🗑️',items:[['new-waste','廢棄登入'],['waste-query-pos','廢棄查詢']]},
  {id:'鮮食查詢',icon:'🥡',items:[['fresh-near-expiry','鮮食即期查詢'],['fresh-expired','鮮食過期查詢']]},
  {id:'交班',icon:'🤝',items:[['tm-mode-switch','模式切換'],['deposit','投庫'],['handover','交班']]},
  {id:'系統設定',icon:'⚙️',items:[['system-settings-page','雲端與更新'],['system-restart','系統重啟']]}
 ];
}
function posMenuFlyout(groupId=posBottomMenuOpen){
 const g=posMenuGroups().find(x=>x.id===groupId);
 if(!g||!g.items.length)return '';
 return `<div class="pos-confirmed-flyout" data-pos-flyout="${esc(g.id)}" ${posBottomMenuOpen===g.id?'':'hidden'}>
  <div class="pos-confirmed-flyout-title">${esc(g.id)}</div>
  <div class="pos-confirmed-flyout-grid">
   ${g.items.map(([action,label])=>{
    if(action==='system-settings-page'&&!hasPermission('systemSettingsAccess'))return '';
    return `<button class="button" data-pos-subaction="${action}">${esc(label)}</button>`;
   }).join('')}
  </div>
 </div>`;
}
function posBottomBar(){
 const groups=posMenuGroups(),pageSize=5;
 return `<div id="posBottomMenuArea">
  <div id="posFlyoutLayer">${groups.map(g=>posMenuFlyout(g.id)).join('')}</div>
  <footer class="pos-confirmed-bottom">
   <button class="pos-page-arrow" data-pos-menu-page="-1">←<small>上一頁</small></button>
   ${groups.map((g,i)=>`<button class="pos-confirmed-main ${posBottomMenuOpen===g.id?'active':''}" data-pos-menu-group="${g.id}" data-pos-direct-page="${g.page||''}" data-pos-direct-action="${g.directAction||''}" data-pos-menu-index="${i}" ${Math.floor(i/pageSize)===posBottomMenuPage?'':'hidden'}>${g.icon}<span>${esc(g.id)}</span>${g.items.length?'<small>⌃</small>':''}</button>`).join('')}
   <button class="pos-page-arrow" data-pos-menu-page="1">→<small>下一頁</small></button>
  </footer>
 </div>`;
}
function syncPosBottomMenuDom(){
 const groups=posMenuGroups(),pageSize=5,maxPage=Math.max(0,Math.ceil(groups.length/pageSize)-1);
 posBottomMenuPage=Math.max(0,Math.min(maxPage,posBottomMenuPage));
 document.querySelectorAll('[data-pos-menu-index]').forEach(btn=>{
  const index=Number(btn.dataset.posMenuIndex||0);
  btn.hidden=Math.floor(index/pageSize)!==posBottomMenuPage;
  btn.classList.toggle('active',btn.dataset.posMenuGroup===posBottomMenuOpen);
 });
 document.querySelectorAll('[data-pos-flyout]').forEach(el=>{
  el.hidden=el.dataset.posFlyout!==posBottomMenuOpen;
 });
}
function bindPosBottomMenu(){
 const area=document.querySelector('#posBottomMenuArea');
 if(!area)return;
 area.querySelectorAll('[data-pos-menu-group]').forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.posMenuGroup;
  const direct=btn.dataset.posDirectPage;
  const directAction=btn.dataset.posDirectAction;
  if(direct){posBottomMenuOpen='';render(direct);return;}
  if(directAction){posBottomMenuOpen='';syncPosBottomMenuDom();triggerPosAction(directAction);return;}
  if(id==='商品')state.lastCompletedSale=null;
  posBottomMenuOpen=posBottomMenuOpen===id?'':id;
  syncPosBottomMenuDom();
 });
 area.querySelectorAll('[data-pos-menu-page]').forEach(btn=>btn.onclick=()=>{
  const groups=posMenuGroups(),pageSize=5,maxPage=Math.max(0,Math.ceil(groups.length/pageSize)-1);
  const dir=Number(btn.dataset.posMenuPage||0);
  posBottomMenuPage=dir<0?Math.max(0,posBottomMenuPage-1):Math.min(maxPage,posBottomMenuPage+1);
  posBottomMenuOpen='';
  syncPosBottomMenuDom();
 });
 area.querySelectorAll('[data-pos-subaction]').forEach(btn=>btn.onclick=()=>{
  const action=btn.dataset.posSubaction;
  posBottomMenuOpen='';
  syncPosBottomMenuDom();
  runPosSubaction(action);
 });
 syncPosBottomMenuDom();
}
function posCompletedPage(sale){
 const items=(sale.items||[]),qty=items.reduce((s,x)=>s+Number(x.qty||0),0);
 const discount=Number(sale.discountTotal??sale.discount??0),service=Number(sale.serviceAmount||0);
 const breakdown=(sale.paymentBreakdown||[]).length?sale.paymentBreakdown:[{method:sale.payment||'現金',amount:Number(sale.total||0)}];
 return `<div class="pos-classic pos-completed">
  ${posHeader(sale)}
  <section class="pos-classic-table">
   <div class="pos-classic-row head"><span>項次</span><span>品名</span><span>單價</span><span>數量</span><span>金額</span></div>
   <div class="pos-classic-scroll">${items.map((x,i)=>`<div class="pos-classic-row"><span>${i+1}</span><span>${esc(x.name)}</span><span>${Number(x.price||0)}</span><span>${Number(x.qty||0)}</span><span>${Number(x.price||0)*Number(x.qty||0)}</span></div>`).join('')}</div>
  </section>
  <section class="pos-classic-summary">
   <div>代收 ${service>0?1:0} 件 <b>${money(service)}</b></div>
   <div>折扣 ${discount>0?1:0} 件 <b>${money(discount)}</b></div>
   <div>商品 ${qty} 件 <b>${money(sale.total||0)}</b></div>
  </section>
  <section class="pos-complete-mid">
   <div class="pos-complete-message">
    <div class="pos-next-transaction"><span>提示</span><button class="button" data-action="next-sale">進行下一筆交易</button></div>
    <h3>訊息</h3>
    <ul>
     ${sale.memberId?'<li>會員交易完成，點數已依規則處理</li>':'<li class="warn">非會員交易，無會員累點</li>'}
     <li>本筆商品金額 ${money(sale.total||0)}</li>
     ${discount>0?`<li>本筆折扣 ${money(discount)}</li>`:''}
    </ul>
   </div>
   <div class="pos-complete-cash">
    <div><span>收您</span><strong>${money(sale.tendered||sale.total||0)}</strong></div>
    <div><span>找零</span><strong>${money(sale.change||0)}</strong></div>
    <small>總點數：${Number(sale.memberPointsAfter||0)}　　當月到期數：${Number(sale.memberExpiringPoints||0)}<br>折抵金額：${money(sale.memberRedeemAmount||0)}</small>
   </div>
  </section>
  <section class="pos-payment-summary">
   <div class="head"><span>項次</span><span>支付類別</span><span>金額</span></div>
   ${breakdown.map((x,i)=>`<div><span>${i+1}</span><b>${esc(x.method||sale.payment||'')}</b><span>${money(x.amount||0)}</span></div>`).join('')}
   <div class="pos-end-stamp">終</div>
  </section>
  ${posBottomBar()}
 </div>`;
}

function posMessageEntries(){
 if(state.wasteMode){
  const count=(state.cart||[]).reduce((s,x)=>s+Number(x.qty||0),0);
  const amount=(state.cart||[]).reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);
  return [{
   type:'warn',
   title:'廢棄模式',
   text:count?`目前已 KEY ${count} 件，廢棄金額 ${money(amount)}；確認全部商品後按「廢棄」。`:'請掃描／輸入要廢棄的商品，全部 KEY 完後再按「廢棄」。'
  }];
 }

 const entries=[];
 if(tmMemberCustomerInputActive){
  entries.push({type:'member',title:'會員',text:'會員輸入中'});
 }
 const cart=Array.isArray(state.cart)?state.cart:[];
 const t=totals();
 const merchandise=cart.filter(x=>!isPosServiceItem(x));
 const last=merchandise.length?merchandise[merchandise.length-1]:null;

 if(last){
  entries.push({
   type:'product',
   title:'商品',
   text:`${last.name||''}　${money(last.price||0)} × ${Number(last.qty||0)}`
  });

  const product=products().find(p=>String(p.id)===String(last.productId||last.id))||
   products().find(p=>String(p.name||'')===String(last.name||''));
  if(product){
   const promos=itemActivePromotions(product)||[];
   if(promos.length){
    entries.push({
     type:'promo',
     title:'活動',
     text:promos.slice(0,2).map(x=>x.name||x.summary||x.type||'優惠活動').join('／')
    });
   }
  }
  if(last.freshDiscounted){
   entries.push({type:'promo',title:'即期',text:'此商品已套用即期折扣。'});
  }
 }

 const promoDiscount=Number(t.promotionDiscount||0);
 const manualDiscount=Number(t.manualDiscount||0);
 const pointDiscount=Number(t.pointDiscount||0);
 const discountTotal=promoDiscount+manualDiscount+pointDiscount;
 if(discountTotal>0){
  const parts=[];
  if(promoDiscount>0)parts.push(`活動 ${money(promoDiscount)}`);
  if(manualDiscount>0)parts.push(`折扣 ${money(manualDiscount)}`);
  if(pointDiscount>0)parts.push(`點數折抵 ${money(pointDiscount)}`);
  entries.push({type:'discount',title:'優惠',text:`已折抵 ${money(discountTotal)}（${parts.join('／')}）`});
 }

 if(state.member){
  const name=state.member.name||state.member.phone||'會員';
  const points=Number(state.member.points||0);
  const redeem=Number(state.memberRedeemPoints||0);
  const memberNo=maskMemberNo(state.member.code||state.member.memberNo||state.member.id);
  entries.push({
   type:'member',
   title:'會員',
   text:`會員編號 ${memberNo||'—'}｜${name}｜目前 ${points} 點${redeem>0?`｜本筆折抵 ${redeem} 點`:''}`
  });
 }

 const ecCount=cart.filter(x=>x.ecPickup).length,collectionCount=cart.filter(x=>x.collectionPayment||x.billPayment||x.utilityPayment).length;
 if(ecCount)entries.push({type:'service',title:'取貨',text:`本筆包含 ${ecCount} 件 EC 取貨。`});
 if(collectionCount)entries.push({type:'service',title:'代收',text:`本筆包含 ${collectionCount} 件代收帳單，需由結帳畫面完成付款。`});

 if(cart.length){
  entries.push({
   type:'total',
   title:'應付',
   text:`商品 ${merchandise.reduce((s,x)=>s+Number(x.qty||0),0)} 件｜目前應付 ${money(t.total||0)}`
  });
 }else{
  entries.push({
   type:'idle',
   title:'待機',
   text:'請掃描商品、EC 或代收條碼，或手動輸入條碼開始交易。'
  });
 }
 return entries;
}
function posMessageHtml(){
 const rows=posMessageEntries();
 return `<div class="pos-message-live">${rows.map((x,i)=>`
  <div class="pos-message-line ${esc(x.type||'')} ${i===0?'primary-line':''}">
   <b>${esc(x.title||'訊息')}</b><span>${esc(x.text||'')}</span>
  </div>`).join('')}</div>`;
}
function refreshPosMessage(){
 const box=document.querySelector('#posMessageContent');
 if(box)box.innerHTML=posMessageHtml();
}

function tmQuickAmountBar(){
 if(isSelfCheckout()||state.wasteMode)return '';
 const rows=tmQuickAmountKeys();
 if(!rows.length)return '';
 return `<section class="tm-quick-amount-bar"><b>快速金額</b>${rows.map(x=>`<button type="button" data-tm-quick-key="${esc(x.id)}">${esc(x.name||'快速商品')}<strong>${money(x.amount||0)}</strong></button>`).join('')}</section>`;
}
function addTmQuickAmountProduct(row,p){
 if(!row||!p)return;
 try{
  const before=state.cart.length;
  add(p.id,'quick-amount');
  let target=null;
  if(state.cart.length>before)target=state.cart[state.cart.length-1];
  else target=[...state.cart].reverse().find(x=>String(x.id)===String(p.id));
  if(!target)return alert('商品加入失敗');
  target.price=Number(row.amount||0);
  target.quickAmountKeyId=row.id;
  target.quickAmountKeyName=row.name;
  target.quickAmountOverride=true;
  saveAudit('TM快速金額鍵',`${row.name}｜${money(row.amount||0)}｜${p.name}`);
  drawPOS();
  showTmAgeReminder(p);
 }catch(e){alert(e.message)}
}
function tmQuickSweetPotatoProduct(row){
 const ids=[row.productId1||row.productId,row.productId2].map(x=>String(x||'')).filter(Boolean);
 const ps=ids.map(id=>products().find(x=>String(x.id)===id)).filter(Boolean);
 if(!ps.length)return null;
 if(ps.length===1)return ps[0];

 const month=new Date().getMonth()+1;
 // 1～6月使用冷凍蕃薯；7～12月使用去土／生鮮蕃薯。
 const wantFrozen=month>=1&&month<=6;
 const bySeason=ps.find(p=>{
  const text=[p.name,p.shortName,p.category,p.group].filter(Boolean).join('｜');
  return wantFrozen?/冷凍/.test(text):/去土|生鮮/.test(text);
 });
 return bySeason||ps[wantFrozen?1:0]||ps[0];
}
function applyTmQuickAmountKey(id){
 const row=tmQuickAmountKeys().find(x=>String(x.id)===String(id));
 if(!row)return alert('找不到快速金額鍵');
 const p=tmQuickSweetPotatoProduct(row);
 if(!p)return alert('快速金額鍵對應商品不存在');
 // 直接帶入交易，不再詢問「生鮮／冷凍」。
 addTmQuickAmountProduct(row,p);
}

function posPage(){
 if(isSelfCheckout())return selfCheckoutPage();
 if(state.lastCompletedSale)return posCompletedPage(state.lastCompletedSale);
 return `<div class="pos-classic pos-active">
  ${tmPanelSettingsBanner()}
  ${tmTrainingMode()?'<div class="tm-training-banner">教育訓練模式｜所有交易皆為虛擬，不入帳、不扣庫存 <button data-action="exit-training">離開教育訓練</button></div>':''}
  ${posHeader()}
  ${correctionModeBanner()}
  <section class="pos-classic-table">
   <div class="pos-classic-row head"><span>項次</span><span>品名</span><span>單價</span><span>數量</span><span>金額</span></div>
   <div id="cartList" class="pos-classic-scroll"></div>
  </section>
  <section class="pos-classic-summary-wrap">
   <section class="pos-classic-summary" id="totalBox"></section>
   ${state.wasteMode?'':`<div class="pos-subtotal-area"><button type="button" class="button danger pos-transaction-cancel" data-action="clear">交易取消</button><button type="button" class="pos-subtotal-main" data-action="subtotal">小計</button><div id="posGameCountdown" class="pos-game-countdown">${posGameSession?.status==='pending'?`客顯遊戲 ${Math.min(Number(posGameSession.currentDraw||1),posGameCustomerDrawCap())}/${posGameCustomerDrawCap()} 倒數 ${Math.max(0,Number(posGameSession.remaining||0))} 秒`:posGameSession?.status==='done'?`遊戲完成：${esc(posGameSession.prize||'已完成')}`:''}</div></div>`}
   <button type="button" class="pos-checkout-main ${state.wasteMode?'pos-waste-submit-main':''} ${!state.wasteMode&&!subtotalReadyForCurrentTransaction()?'is-locked':''}" data-action="checkout">${state.wasteMode?'廢棄':'結帳'}</button>
  </section>
  <section class="pos-active-mid">
   <div class="pos-scan-box">
    <div><button class="primary pos-square ${state.wasteMode?'pos-waste-scan':''}" data-action="scan">📷</button><label>請掃描/輸入<input id="search" placeholder="${state.wasteMode?'請掃描要廢棄的商品':'掃描商品、EC二段式、帳單三段式或QR Code'}" inputmode="search"></label></div>
    <div><button class="button pos-square">#</button><label>${state.wasteMode?'廢棄備註':'統一編號輸入'}<input id="${state.wasteMode?'transactionNote':'transactionTaxId'}" value="${esc(state.wasteMode?(state.note||''):(state.taxId||''))}" placeholder="${state.wasteMode?'可輸入本次廢棄備註':'請輸入 8 位統一編號'}" ${state.wasteMode?'':'inputmode="numeric" maxlength="8"'}></label></div>
   </div>
   <div class="pos-message-box ${state.wasteMode?'pos-waste-message':''}"><h3>📣 訊息</h3><div id="posMessageContent">${posMessageHtml()}</div></div>
  </section>
  <section class="pos-category-wrap"><div class="pos-category-tabs">${posCategoryTabs()}</div><div id="productGrid" class="pos-original-products"></div></section>
  ${posBottomBar()}
  <div class="ref-payment-hidden">${['現金','信用卡','行動支付','電子票證','禮物卡','混合付款'].map((x,i)=>`<button class="payment ${i?'':'selected'}" data-pay="${x}">${x}</button>`).join('')}</div>
 </div>`;
}
function metrics(){const d=new Date().toISOString().slice(0,10),all=load(K.sales,[]).filter(x=>x.at.startsWith(d)&&!['已作廢','已整筆退貨','作廢'].includes(x.status)),isService=x=>x.serviceSale===true||(x.items||[]).some(i=>i.ecPickup),ss=all.filter(x=>!isService(x)&&x.excludeFromRevenue!==true),service=all.filter(isService),rev=ss.reduce((s,x)=>s+Number((x.netTotal??x.total)||0),0),serviceAmount=service.reduce((s,x)=>s+Number(x.serviceAmount??x.netTotal??x.total??0),0),cost=ss.reduce((s,x)=>s+(x.items||[]).reduce((a,i)=>a+(i.cost||0)*Math.max(0,Number(i.qty||0)-Number(i.returnedQty||0)),0),0);return`<div class="metric"><small>日商</small><strong>${money(rev)}</strong></div><div class="metric"><small>來客數</small><strong>${ss.length}</strong></div><div class="metric"><small>客單</small><strong>${money(ss.length?rev/ss.length:0)}</strong></div><div class="metric"><small>毛利率</small><strong>${rev?((rev-cost)/rev*100).toFixed(1):'0.0'}%</strong></div><div class="metric"><small>服務性商品$</small><strong>${money(serviceAmount)}</strong></div><div class="metric"><small>服務性來客數</small><strong>${service.length}</strong></div>`}


function isTobaccoProduct(p){
 const text=[p?.name,p?.shortName,p?.category,p?.group,p?.brand].filter(Boolean).join('｜');
 return p?.tobacco===true||/菸|煙|香菸|香煙|TEREA|HEETS|IQOS/i.test(text);
}
function tobaccoPackageKind(p){
 const text=[p?.name,p?.shortName,p?.category,p?.group].filter(Boolean).join('｜');
 return /條|條裝|carton/i.test(text)?'carton':'pack';
}
function productDisplayIconHtml(p){
 if(isTobaccoProduct(p))return `<span class="yj-tobacco-icon ${tobaccoPackageKind(p)}" aria-hidden="true"><i></i><i></i><i></i></span>`;
 return `<span class="yj-product-emoji">${esc(p?.icon||'📦')}</span>`;
}

function productBarcodes(p){
 const rows=Array.isArray(p.barcodes)?p.barcodes:[p.barcode];
 return [...new Set(rows.map(x=>String(x||'').trim()).filter(Boolean))];
}
function productMargin(p){
 const price=Number(p.price||0),cost=Number(p.cost||0);
 return price>0?((price-cost)/price*100):0;
}
function productStatusLabel(p){return p.status|| (p.active===false?'停用':'啟用')}
function productMatches(p,q){
 q=String(q||'').trim().toLowerCase();
 if(!q)return true;
 return [p.code,p.name,p.shortName,p.group,p.category,p.deliveryType,p.logistics,...productBarcodes(p)]
  .some(v=>String(v||'').toLowerCase().includes(q));
}

function productLookupPromoActive(row){
 if(!row||row.active===false)return false;
 const today=localDateKey();
 if(row.startDate&&today<String(row.startDate))return false;
 if(row.endDate&&today>String(row.endDate))return false;
 return true;
}
function productLookupPromotions(p){
 if(!p)return {combo:[],store:[]};
 const promos=promotionRows().filter(productLookupPromoActive).filter(x=>{
  const target=String(x.target||'').trim();
  if(!target)return false;
  return x.targetType==='品群'
   ? String(p.group||'')===target
   : [String(p.code||''),...productBarcodes(p)].includes(target);
 });
 const member=memberBonusCampaignRows().filter(productLookupPromoActive).filter(x=>{
  const target=String(x.target||'').trim();
  const category=String(x.category||x.type||'');
  if(!target)return category==='指定期間消費';
  if(category.includes('品群'))return String(p.group||'')===target;
  if(category.includes('商品'))return [String(p.code||''),String(p.name||''),...productBarcodes(p)].includes(target);
  return false;
 });
 return {combo:promos,store:member};
}
function productLookupResultHtml(p){
 if(!p)return `<div class="ref-product-lookup-empty">請輸入商品條碼、代號或名稱後查詢</div>`;
 const bars=productBarcodes(p),promos=productLookupPromotions(p);
 const combo=promos.combo.map(x=>`<tr><td>${esc(x.name||'商品活動')}</td><td>${esc(x.summary||x.type||'')}</td><td>${esc(x.startDate||'不限')} ～ ${esc(x.endDate||'不限')}</td></tr>`).join('');
 const storeRows=promos.store.map(x=>`<tr><td>${esc(x.name||'會員活動')}</td><td>${esc(x.summary||`${Number(x.bonusPoints||0)} 點`)}</td><td>${esc(x.startDate||'不限')} ～ ${esc(x.endDate||'不限')}</td></tr>`).join('');
 return `<div class="ref-product-lookup-info">
  <div class="ref-product-lookup-row">
   <span>商品條碼／代號</span>
   <div><b>${esc(bars[0]||'—')}</b><small>${esc(p.code||'—')}</small></div>
  </div>
  <div class="ref-product-lookup-row">
   <span>商品名稱／單價</span>
   <div><b>${esc(p.name||'—')}</b><small>${money(p.price)}</small></div>
  </div>
  <div class="ref-product-lookup-row">
   <span>庫存數</span>
   <div><b class="ref-product-lookup-stock">${Number(p.stock||0)}</b><small>${p.allowNegativeStock?'允許負庫存':'不得負庫存'}</small></div>
  </div>
  <div class="ref-product-lookup-row">
   <span>商品活動</span>
   <div><b>${promos.combo.length+promos.store.length} 項</b><small>${promos.combo.length+promos.store.length?'目前有符合活動':'目前無活動'}</small></div>
  </div>
 </div>
 <div class="ref-product-lookup-promos">
  <section>
   <h3>組合促銷活動</h3>
   <table><thead><tr><th>活動名稱</th><th>優惠內容</th><th>活動期間</th></tr></thead><tbody>${combo||'<tr><td colspan="3">目前沒有符合的組合促銷活動</td></tr>'}</tbody></table>
  </section>
  <section>
   <h3>全店行銷活動</h3>
   <table><thead><tr><th>活動名稱</th><th>優惠內容</th><th>活動期間</th></tr></thead><tbody>${storeRows||'<tr><td colspan="3">目前沒有符合的全店／會員行銷活動</td></tr>'}</tbody></table>
  </section>
 </div>`;
}
function openProductLookup(){
 dlg('商品查詢',`
  <div class="ref-product-lookup-v726">
   <div class="ref-product-lookup-search">
    <button class="ref-product-lookup-icon" type="button" data-product-lookup-mic title="語音輸入">🎙</button>
    <input id="productLookupInput" placeholder="請輸入商品條碼／代號／名稱" autocomplete="off">
    <button class="ref-product-lookup-icon" type="button" data-product-lookup-keyboard title="觸控鍵盤">⌨</button>
    <button class="primary" type="button" id="productLookupSearch">查詢</button>
   </div>
   <div id="productLookupResult">${productLookupResultHtml(null)}</div>
   <div class="ref-product-lookup-bottom">
    <button class="primary" id="productLookupUse" disabled>帶入交易</button>
    <button class="button" id="productLookupClose">離開</button>
   </div>
  </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#productLookupInput'),result=document.querySelector('#productLookupResult');
  const search=document.querySelector('#productLookupSearch'),use=document.querySelector('#productLookupUse'),close=document.querySelector('#productLookupClose');
  let selected=null;
  const run=()=>{
   const q=String(input?.value||'').trim();
   if(!q){selected=null;result.innerHTML=productLookupResultHtml(null);use.disabled=true;return}
   const rows=products().filter(x=>productMatches(x,q));
   selected=rows.find(x=>productBarcodes(x).includes(q)||String(x.code||'')===q)||rows[0]||null;
   result.innerHTML=selected?productLookupResultHtml(selected):'<div class="ref-product-lookup-empty">找不到商品</div>';
   use.disabled=!selected;
  };
  search.onclick=run;
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run()}};
  close.onclick=()=>genericDialog.close();
  use.onclick=()=>{
   if(!selected)return;
   try{
    add(selected.id,'lookup');
    const restrictedProduct=selected;
    genericDialog.close();
    render('pos');
    setTimeout(()=>{drawPOS();showTmAgeReminder(restrictedProduct)},0);
   }catch(err){alert(err?.message||err)}
  };
  document.querySelector('[data-product-lookup-keyboard]')?.addEventListener('click',()=>input?.focus());
  document.querySelector('[data-product-lookup-mic]')?.addEventListener('click',()=>{
   const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
   if(!SR)return alert('目前瀏覽器不支援語音輸入');
   const rec=new SR();rec.lang='zh-TW';rec.interimResults=false;rec.maxAlternatives=1;
   rec.onresult=e=>{input.value=e.results?.[0]?.[0]?.transcript||'';run()};
   rec.onerror=()=>alert('語音輸入失敗，請改用條碼或文字查詢');
   rec.start();
  });
 },0);
}
function productRow(p){
 return `<tr>
  <td>${esc(p.code||'—')}</td>
  <td>${productDisplayIconHtml(p)} ${esc(p.name)}<small class="product-short-name">${esc(p.shortName||'')}</small></td>
  <td>${productBarcodes(p).map(x=>`<div>${esc(x)}</div>`).join('')||'—'}</td>
  <td>${esc(p.category||'')}</td>
  <td>${esc(p.group||'其他')}</td>
  <td>${esc(p.deliveryType||p.logistics||'')}</td>
  <td>${money(p.price)}</td>
  <td>${money(p.cost)}</td>
  <td>${productMargin(p).toFixed(1)}%</td>
  <td>${p.stock??0}</td>
  <td>${esc(productStatusLabel(p))}</td>
  <td><button class="button" data-print-product="${p.id}">🖨️ 價標</button> <button class="button" data-edit-product="${p.id}">修改</button> <button class="button danger" data-delete-product="${p.id}">刪除</button></td>
 </tr>`;
}
function readProductForm(){
 const extra=String(document.querySelector('#pba')?.value||'')
  .split(/\n|,|，/).map(x=>x.trim()).filter(Boolean);
 const primary=String(document.querySelector('#pb')?.value||'').trim();
 const generatedPrimary=primary||systemBarcode('YJP');const barcodes=[...new Set([generatedPrimary,...extra].filter(Boolean))];
 const category=document.querySelector('#pc').value;
 const status=document.querySelector('#pstatus').value;
 return {
  code:document.querySelector('#pcode').value.trim(),
  name:document.querySelector('#pn').value.trim(),
  shortName:document.querySelector('#psn').value.trim(),
  barcode:barcodes[0]||'',
  barcodes,
  category,
  group:document.querySelector('#pg').value,
  deliveryType:document.querySelector('#pl').value,
  logistics:document.querySelector('#pl').value,
  price:Number(document.querySelector('#pp').value||0),
  cost:Number(document.querySelector('#pco').value||0),
  stock:Number(document.querySelector('#pst').value||0),
  safeStock:Number(document.querySelector('#psa').value||0),
  maxStock:Number(document.querySelector('#pmax').value||0),
  allowNegativeStock:document.querySelector('#pneg').checked,
  icon:document.querySelector('#pi').value||'📦',
  status,
  active:status!=='停用',
  isFresh:category==='鮮食',
  discountBeforeHours:category==='鮮食'?Number(document.querySelector('#pdiscount').value||7):0,
  alertBeforeMinutes:category==='鮮食'?Number(document.querySelector('#palert').value||10):0,
  blockExpiredSale:category==='鮮食'?document.querySelector('#pblock').checked:false
 };
}
function validateProductItem(item,rows,currentId=''){
 if(!item.code||!item.name||!item.barcode)return '商品代號、商品名稱與主要條碼必填';
 if(rows.some(x=>x.id!==currentId&&String(x.code||'').toLowerCase()===item.code.toLowerCase()))return '商品代號不可重複';
 const allOther=rows.filter(x=>x.id!==currentId).flatMap(productBarcodes);
 const duplicate=item.barcodes.find(x=>allOther.includes(x));
 if(duplicate)return `商品條碼 ${duplicate} 已被其他商品使用`;
 if(item.price<0||item.cost<0||item.stock<0||item.safeStock<0||item.maxStock<0)return '價格與庫存欄位不可為負數';
 return '';
}
function bindProductFreshFields(){
 const category=document.querySelector('#pc'),fresh=document.querySelector('#freshProductFields');
 const autoBarcode=document.querySelector('#autoProductBarcode');
 if(autoBarcode)autoBarcode.onclick=()=>{const input=document.querySelector('#pb');if(input)input.value=systemBarcode('YJP')};

 if(!category||!fresh)return;
 const sync=()=>fresh.hidden=category.value!=='鮮食';
 category.onchange=sync;sync();
 const price=document.querySelector('#pp'),cost=document.querySelector('#pco'),margin=document.querySelector('#marginPreview');
 const calc=()=>{const p=Number(price.value||0),c=Number(cost.value||0);margin.textContent=p>0?`${((p-c)/p*100).toFixed(1)}%`:'0.0%'};
 price.oninput=calc;cost.oninput=calc;calc();
}


function freshBatches(){return load(K.freshBatches,[])}

function freshBatchStatus(batch,now=new Date()){
 const remaining=Number(batch.remainingQty||0);
 if(batch.status==='已廢棄')return '已廢棄';
 if(remaining<=0)return '已售完';
 const expiry=new Date(batch.expiryAt);
 if(Number.isNaN(expiry.getTime()))return '資料異常';
 if(now>=expiry)return '已過期';
 const p=products().find(x=>x.id===batch.productId);
 const alertMinutes=Number(p?.alertBeforeMinutes??10);
 if((expiry-now)/60000<=alertMinutes)return '即將到期';
 return '正常';
}

function freshBatchRow(batch){
 const p=products().find(x=>x.id===batch.productId);
 return `<tr>
  <td>${esc(batch.batchNo||'')}</td>
  <td>${esc(p?.code||batch.productCode||'')}</td>
  <td>${esc(p?.name||batch.productName||'')}</td>
  <td>${esc(batch.barcode||'')}</td>
  <td>${new Date(batch.receivedAt).toLocaleString('zh-TW')}</td>
  <td>${new Date(batch.expiryAt).toLocaleString('zh-TW')}</td>
  <td>${batch.qty}</td>
  <td>${batch.remainingQty}</td>
  <td>${esc(freshBatchStatus(batch))}</td>
  <td><button class="button" data-fresh-edit="${batch.id}">修改</button> <button class="button danger" data-fresh-waste="${batch.id}">廢棄</button></td>
 </tr>`;
}

function toLocalDateTimeInput(value){
 const d=value instanceof Date?new Date(value.getTime()):new Date(value);
 if(Number.isNaN(d.getTime()))return '';
 const pad=n=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openFreshBatchForm(existing=null){
 const freshProducts=products().filter(x=>(x.category==='鮮食'||x.group==='鮮食'||x.isFresh===true)&&productStatusLabel(x)!=='停用');
 if(!freshProducts.length)return alert('目前沒有可用的鮮食商品，請先在商品管理新增鮮食商品');

 const now=new Date();
 const localNow=toLocalDateTimeInput(now);

 dlg(existing?'修改鮮食批次':'新增鮮食批次',`
  <label>鮮食商品<select id="freshProductSelect" ${existing?.autoCreated?'disabled':''}>${freshProducts.map(p=>`<option value="${p.id}" ${existing?.productId===p.id?'selected':''}>${esc(p.code||'—')}｜${esc(p.name)}｜${esc(productBarcodes(p)[0]||'無條碼')}</option>`).join('')}</select></label>
  <label>批次號<input id="freshBatchNo" value="${esc(existing?.batchNo||'')}"></label>
  <label>進貨日期時間<input id="freshReceivedAt" type="datetime-local" value="${existing?.receivedAt?toLocalDateTimeInput(existing.receivedAt):localNow}"></label>
  <label>到期日期時間<input id="freshExpiryAt" type="datetime-local" value="${existing?.expiryAt?toLocalDateTimeInput(existing.expiryAt):''}"></label>
  <label>進貨數量<input id="freshQty" type="number" min="1" value="${existing?.qty??1}"></label>
  <label>剩餘數量<input id="freshRemainingQty" type="number" min="0" value="${existing?.remainingQty??1}"></label>
  <label>備註<textarea id="freshNote" rows="3">${esc(existing?.note||'')}</textarea></label>
  <button class="primary" id="freshSaveButton">儲存批次</button>`);

 setTimeout(()=>{
  const select=document.querySelector('#freshProductSelect');
  const received=document.querySelector('#freshReceivedAt');
  const expiry=document.querySelector('#freshExpiryAt');
  const qty=document.querySelector('#freshQty');
  const remaining=document.querySelector('#freshRemainingQty');
  const saveBtn=document.querySelector('#freshSaveButton');

  const applyRule=(force=false)=>{
   const p=freshProducts.find(x=>x.id===select.value);
   if(!p)return;
   const autoExpiry=freshExpiryByReceivingRule(received.value,p.deliveryType||p.logistics||existing?.deliveryType||'',isRiceBallProduct(p));
   if(autoExpiry&&(force||!expiry.value))expiry.value=toLocalDateTimeInput(autoExpiry);
  };

  select.onchange=()=>applyRule(true);
  received.oninput=()=>applyRule(true);
  qty.oninput=()=>{if(!existing)remaining.value=qty.value};
  if(!existing)applyRule(true);

  saveBtn.onclick=()=>{
   const p=freshProducts.find(x=>x.id===select.value);
   const batchNo=document.querySelector('#freshBatchNo').value.trim();
   const qtyValue=Number(qty.value||0),remainingValue=Number(remaining.value||0);
   if(!p)return alert('請選擇鮮食商品');
   if(!batchNo)return alert('批次號必填');
   if(!received.value||!expiry.value)return alert('進貨時間與到期時間必填');
   if(qtyValue<=0)return alert('進貨數量必須大於 0');
   if(remainingValue<0||remainingValue>qtyValue)return alert('剩餘數量需介於 0 與進貨數量之間');

   const rows=freshBatches();
   if(rows.some(x=>x.id!==existing?.id&&x.batchNo===batchNo))return alert('批次號不可重複');

   const receivedDate=new Date(received.value),expiryDate=new Date(expiry.value);
   if(Number.isNaN(receivedDate.getTime())||Number.isNaN(expiryDate.getTime()))return alert('進貨時間或到期時間格式錯誤');
   const item={
    ...(existing||{}),
    id:existing?.id||uid(),productId:p.id,productCode:p.code||'',productName:p.name,
    barcode:productBarcodes(p)[0]||'',batchNo,receivedAt:receivedDate.toISOString(),expiryAt:expiryDate.toISOString(),
    qty:qtyValue,remainingQty:remainingValue,note:document.querySelector('#freshNote').value.trim(),
    status:existing?.status||'正常',createdAt:existing?.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString(),user:currentUser()?.name||'',
    deliveryType:p.deliveryType||p.logistics||existing?.deliveryType||'',riceBall:isRiceBallProduct(p)
   };
   delete item.shelfLifeHours;

   if(existing){
    rows[rows.findIndex(x=>x.id===existing.id)]=item;
    saveAudit('修改鮮食批次',`${item.batchNo}｜${item.productName}`);
   }else{
    rows.unshift(item);
    saveAudit('新增鮮食批次',`${item.batchNo}｜${item.productName}｜${item.qty}`);
   }
   save(K.freshBatches,rows);
   alert('鮮食批次已儲存');
   genericDialog.close();
   render('quality');
  };
 },0);
}

function productRows(){return products().map(productRow).join('')}
function saleNet(s){return Number((s.netTotal??s.total)||0)}
function transactionCashierAccount(s){
 const direct=String(s?.userAccount||s?.cashierAccount||'').trim();
 if(direct)return direct;
 const name=String(s?.user||'').trim();
 const emp=load(K.employees,[]).find(x=>String(x.name||'').trim()===name);
 return String(emp?.account||name||'');
}
function isEcServiceSale(s){return !!(s&&(((s.items||[]).length===0&&Number(s.serviceAmount||0)>0&&(s.ecItems||[]).length>0)||(s.items||[]).some(i=>i.ecPickup)||(s.ecItems||[]).some(i=>i.ecPickup)))}
function saleStatusClass(s){return ['已整筆退貨','已作廢'].includes(s.status)?'tx-closed':s.status==='已更正'?'tx-corrected':''}
function transactionItemRows(sale){
 return (sale.items||[]).map((x,i)=>{
  const returned=Number(x.returnedQty||0),remain=Math.max(0,Number(x.qty||0)-returned),changed=returned>0;
  const tag=x.appAnybuyRedeem?'隨買兌換':(x.appAnybuyPayment||x.appAnybuyDeposit?'隨買代銷':'');
  return `<tr class="${changed?'tx-returned-item':''}"><td>${i+1}</td><td><span class="${changed?'tx-strike':''}">${esc(x.name)}</span>${tag?`<small class="tx-anybuy-tag">${esc(tag)}</small>`:''}${changed?`<small class="tx-return-note">${remain<=0?'已退貨':`更正後數量：${remain}`}｜退貨 ${returned}</small>`:''}</td><td><span class="${changed?'tx-strike':''}">${x.qty}</span></td><td>${money(x.price)}</td><td>${money(Number(x.price||0)*Number(x.qty||0))}</td></tr>`;
 }).join('')||'<tr><td colspan="5">無商品</td></tr>';
}
function transactionHistoryHtml(sale){
 const rows=sale.correctionHistory||[];
 return rows.map(x=>`<div class="tx-history"><b>${esc(x.type)}</b><span>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user||'')}</span><span>原因：${esc(x.reason||'')} ${x.note?`｜${esc(x.note)}`:''}</span><span>退款：${money(x.refund||0)}（現金 ${money(x.cashRefund||0)}／非現金 ${money(x.nonCashRefund||0)}）</span></div>`).join('')||'<p>尚無更正／退貨紀錄</p>';
}
let transactionSelectedId='';
function txLocalDate(iso){
 const d=new Date(iso);if(Number.isNaN(d.getTime()))return'';
 const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
 return `${y}-${m}-${day}`;
}
function txMachineNo(){return '01'}
function txInvoiceNo(s){return String(s?.invoiceNo||s?.invoiceNumber||'').trim()}
function txFilterRowsFromUI(){
 const all=load(K.sales,[]).filter(s=>!isEcServiceSale(s));
 const type=document.querySelector('#transactionType')?.value||'全部';
 const date=document.querySelector('#transactionDate')?.value||'';
 const product=(document.querySelector('#transactionProduct')?.value||'').trim().toLowerCase();
 const cashier=(document.querySelector('#transactionCashier')?.value||'').trim().toLowerCase();
 const invoice=(document.querySelector('#transactionInvoice')?.value||'').trim().toLowerCase();
 const tx=(document.querySelector('#transactionNo')?.value||'').trim().toLowerCase();
 return all.filter(s=>{
  if(type!=='全部'&&String(s.status||'正常')!==type)return false;
  if(date&&txLocalDate(s.at)!==date)return false;
  if(product&&!((s.items||[]).some(i=>[i.code,i.barcode,i.name].some(v=>String(v||'').toLowerCase().includes(product)))))return false;
  if(cashier&&!transactionCashierAccount(s).toLowerCase().includes(cashier))return false;
  if(invoice&&!txInvoiceNo(s).toLowerCase().includes(invoice))return false;
  if(tx&&!String(s.id||'').toLowerCase().includes(tx))return false;
  return true;
 });
}
function transactionBackRowsHtml(rows,selectedId=''){
 return rows.map(s=>`<tr class="tx-master-row ${saleStatusClass(s)} ${s.id===selectedId?'selected':''}" data-tx-select="${esc(s.id)}" tabindex="0">
  <td><span class="tx-radio-dot">${s.id===selectedId?'●':'○'}</span></td>
  <td>${txMachineNo()}</td>
  <td>${new Date(s.at).toLocaleString('zh-TW')}</td>
  <td><b>${esc(s.id)}</b></td>
  <td>${esc(txInvoiceNo(s)||'—')}</td>
  <td>${esc(transactionCashierAccount(s))}</td>
  <td class="tx-amount">${money(saleNet(s))}</td>
  <td><b>${esc(s.status||'正常')}</b>${saleHasAnybuy(s)?`<small class="tx-anybuy-tag">${anybuyRedeemLines(s).length?'隨買兌換':'隨買代銷'}</small>`:''}</td>
 </tr>`).join('')||'<tr><td colspan="8" class="empty">查無交易</td></tr>';
}
function transactionReceiptPreview(s,frontMode=false){
 if(!s)return `<div class="tx-receipt-empty"><b>交易存根預覽</b><span>點選左側任一筆交易即可查看存根</span></div>`;
 const corrected=s.status==='已更正';
 const wholeClose=wholeAnybuyTransactionCloseEligibility(s);
 const itemHtml=(s.items||[]).map((x,i)=>{
  const returned=Number(x.returnedQty||0),qty=Math.max(0,Number(x.qty||0)-returned),line=Number(x.price||0)*qty;
  const tag=x.appAnybuyRedeem?'隨買兌換':(x.appAnybuyPayment||x.appAnybuyDeposit?'隨買代銷':'');
  return `<div class="tx-receipt-item ${returned?'is-corrected':''}"><div><b>${esc(x.name||'商品')}</b><small>${esc(x.code||x.barcode||'')}</small>${tag?`<small class="tx-anybuy-tag">${esc(tag)}</small>`:''}</div><div>${money(x.price)} × ${qty}</div><strong>${money(line)}</strong>${returned?`<small class="tx-receipt-return">原 ${x.qty}｜已退 ${returned}</small>`:''}</div>`;
 }).join('')||'<div class="tx-receipt-empty-line">無商品明細</div>';
 const promo=Number(s.promotionDiscount||0),manual=Number(s.manualDiscount||0),discount=Number((s.discountTotal??s.discount??(promo+manual))||0);
 const breakdown=(s.paymentBreakdown||[]).map(x=>`<div class="tx-receipt-line"><span>${esc(x.label||x.method||'付款')}</span><b>${money(x.amount||0)}</b></div>`).join('');
 const returnCode=makeReturnCode(s.id);
 let barcode='';try{barcode=code128Svg(returnCode||s.id,{height:45,moduleWidth:1.15,quiet:8,showText:true})}catch(e){barcode=`<div class="barcode-fallback">${esc(returnCode||s.id)}</div>`}
 return `<div class="tx-receipt-paper ${saleStatusClass(s)}">
  <div class="tx-receipt-brand"><b>億家 TM</b><span>交易存根預覽</span></div>
  <div class="tx-receipt-meta">
   <div><span>日期時間</span><b>${new Date(s.at).toLocaleString('zh-TW')}</b></div>
   <div><span>機號</span><b>${txMachineNo()}</b></div>
   <div><span>交易序號</span><b>${esc(s.id)}</b></div>
   <div><span>統一編號</span><b>${esc(s.taxId||'—')}</b></div>
   <div><span>發票號碼</span><b>${esc(txInvoiceNo(s)||'—')}</b></div>
   <div><span>收銀員</span><b>${esc(transactionCashierAccount(s))}</b></div>
   <div><span>狀態</span><b>${esc(s.status||'正常')}</b></div>
  </div>
  <div class="tx-receipt-sep"></div>
  <div class="tx-receipt-items">${itemHtml}</div>
  <div class="tx-receipt-sep"></div>
  <div class="tx-receipt-line"><span>商品小計</span><b>${money(s.subtotal??s.total)}</b></div>
  ${promo?`<div class="tx-receipt-line"><span>活動優惠</span><b>-${money(promo)}</b></div>`:''}
  ${manual?`<div class="tx-receipt-line"><span>其他折扣</span><b>-${money(manual)}</b></div>`:''}
  ${discount&&!promo&&!manual?`<div class="tx-receipt-line"><span>折扣</span><b>-${money(discount)}</b></div>`:''}
  <div class="tx-receipt-total"><span>總計</span><strong>${money(saleNet(s))}</strong></div>
  ${Number(s.consignmentNetAmount??s.consignmentAmount??0)>0?`<div class="tx-receipt-line"><span>隨買代銷（不列日商）</span><b>${money(Number(s.consignmentNetAmount??s.consignmentAmount??0))}</b></div>`:''}
  ${saleHasAnybuy(s)?`<div class="tx-receipt-line"><span>本筆認列日商</span><b>${money(saleRecognizedRevenueNet(s))}</b></div>`:''}
  <div class="tx-receipt-line"><span>付款方式</span><b>${esc([s.payment,s.paymentSubtype].filter(Boolean).join('｜')||'—')}</b></div>
  ${breakdown}
  ${s.payment==='現金'?`<div class="tx-receipt-line"><span>實收</span><b>${money(s.tendered||s.cashAmount||saleNet(s))}</b></div><div class="tx-receipt-line"><span>找零</span><b>${money(s.change||0)}</b></div>`:''}
  ${Number(s.memberRedeemAmount||0)>0?`<div class="tx-receipt-line"><span>點數折抵</span><b>-${money(Number(s.memberRedeemAmount||0))}</b></div>`:''}
  ${s.memberPointsRule?`<div class="tx-receipt-line"><span>點數規則</span><b>${esc(s.memberPointsRule)}</b></div>`:''}
  ${s.memberName?`<div class="tx-receipt-line"><span>會員</span><b>${esc(s.memberName)} ${esc(s.memberPhone||'')}</b></div>
  <div class="tx-member-points">
   <div><span>目前點數</span><b>${Number(s.memberPointsAfter??0)} 點</b></div>
   <div><span>此次新增</span><b>+${Number(s.memberAddedPoints??((s.memberEarnedPoints||0)+(s.memberBonusPoints||0)))} 點</b></div>
   ${Number(s.memberRedeemPoints||0)>0?`<div><span>此次折抵</span><b>-${Number(s.memberRedeemPoints||0)} 點</b></div>`:''}
   ${Number(s.memberReturnDeductPoints||0)>0?`<div class="point-return"><span>退貨扣回</span><b>-${Number(s.memberReturnDeductPoints||0)} 點</b></div>`:''}
   ${Number(s.memberRedeemRestoredPoints||0)>0?`<div class="point-restore"><span>折抵退回</span><b>+${Number(s.memberRedeemRestoredPoints||0)} 點</b></div>`:''}
  </div>`:''}
  ${s.note?`<div class="tx-receipt-note">備註：${esc(s.note)}</div>`:''}
  <div class="tx-receipt-barcode"><small>${corrected?'更正後退貨條碼':'退貨條碼'}</small>${barcode}</div>
  <div class="tx-receipt-actions">
   <button class="button" data-tx-print="${esc(s.id)}">🖨️ 補印</button>
   <button class="button tx-correct-btn" data-tx-correct="${esc(s.id)}" data-tx-front="${frontMode?'1':'0'}" ${s.locked?'disabled':''}>交易更正／部分退貨</button>
   <button class="button" data-tx-exchange="${esc(s.id)}" data-tx-front="${frontMode?'1':'0'}" ${s.locked||saleHasAnybuy(s)?'disabled title="隨買代銷／兌換不使用一般換貨流程"':''}>換貨</button>
   <button class="button danger" data-tx-return="${esc(s.id)}" data-tx-front="${frontMode?'1':'0'}" ${s.locked||!wholeClose.allowed?`disabled title="${esc(wholeClose.reason)}"`:''}>整筆退貨</button>
   <button class="button danger" data-tx-void="${esc(s.id)}" data-tx-front="${frontMode?'1':'0'}" ${s.locked||!wholeClose.allowed?`disabled title="${esc(wholeClose.reason)}"`:''}>整筆作廢</button>
  </div>
  ${(s.correctionHistory||[]).length?`<details class="tx-receipt-history"><summary>更正／退貨紀錄（${s.correctionHistory.length}）</summary>${transactionHistoryHtml(s)}</details>`:''}
 </div>`;
}
function transactionMasterDetailPage(frontMode=false){
 const rows=load(K.sales,[]).filter(s=>!isEcServiceSale(s));
 const selected=rows.find(x=>x.id===transactionSelectedId)||rows[0]||null;
 transactionSelectedId=selected?.id||'';
 const statusOptions=['全部','正常','已更正','已整筆退貨','已作廢'];
 const title=frontMode?'TM 交易存根查詢':'交易存根';
 const backBtn=frontMode?'<button class="button" data-action="return-to-tm">← 返回 TM</button>':'';
 return `<div class="page-head tx-page-head"><div><h2>${title}</h2><small>點選交易清單後直接顯示完整交易存根；EC 包裹取貨不列入交易存根查詢。</small></div>${backBtn?`<div class="toolbar">${backBtn}</div>`:''}</div>
 <div class="panel tx-filter-panel">
  <div class="tx-filter-grid">
   <label>類型<select id="transactionType">${statusOptions.map(x=>`<option>${x}</option>`).join('')}</select></label>
   <label>交易日期<input id="transactionDate" type="date"></label>
   <label>商品代碼／條碼<input id="transactionProduct" placeholder="商品代號、條碼或名稱"></label>
   <label>收銀員<input id="transactionCashier" placeholder="收銀員"></label>
   <label>發票號碼<input id="transactionInvoice" placeholder="有開立時可查"></label>
   <label>交易序號<input id="transactionNo" placeholder="例如 T178... "></label>
  </div>
  <div class="tx-filter-actions"><button class="primary" id="transactionQueryBtn">查詢</button><button class="button" id="transactionClearBtn">清除</button><button class="button" data-action="print-transactions">列印清單</button></div>
 </div>
 <div class="tx-master-detail">
  <div class="panel tx-master-panel"><div class="tx-master-summary"><b>交易清單</b><span id="transactionCount">${rows.length} 筆</span></div><div class="table-wrap tx-master-scroll"><table class="table tx-master-table"><thead><tr><th>選</th><th>機號</th><th>交易日期時間</th><th>交易序號</th><th>發票號碼</th><th>收銀員</th><th>銷售金額</th><th>狀態</th></tr></thead><tbody id="transactionRows">${transactionBackRowsHtml(rows,transactionSelectedId)}</tbody></table></div></div>
  <aside class="panel tx-detail-panel"><div id="transactionDetailPane">${transactionReceiptPreview(selected,frontMode)}</div></aside>
 </div>`;
}
function transactionBackPage(){return transactionMasterDetailPage(false)}
function transactionPage(frontMode=false){return transactionMasterDetailPage(frontMode)}

let transactionCloudPulledAt=0,transactionCloudPulling=false;
async function scheduleTransactionCloudRefresh(pageName){
 if(!cloudConfigured()||transactionCloudPulling||Date.now()-transactionCloudPulledAt<12000)return;
 transactionCloudPulling=true;transactionCloudPulledAt=Date.now();
 try{
  await cloudPullKey(K.sales);
  const target=String(pageName||'transactions');
  if(document.body.dataset.mode==='front'&&target==='transactions-front'&&currentRenderedPage==='transactions-front')render('transactions-front');
  else if(document.body.dataset.mode==='back'&&target==='transactions'&&currentRenderedPage==='transactions')render('transactions');
 }catch(_e){}finally{transactionCloudPulling=false}
}

function bindTransactionMasterDetail(frontMode=false){
 const refresh=()=>{
  const rows=txFilterRowsFromUI();
  if(!rows.some(x=>x.id===transactionSelectedId))transactionSelectedId=rows[0]?.id||'';
  const tbody=document.querySelector('#transactionRows');if(tbody)tbody.innerHTML=transactionBackRowsHtml(rows,transactionSelectedId);
  const count=document.querySelector('#transactionCount');if(count)count.textContent=`${rows.length} 筆`;
  const selected=rows.find(x=>x.id===transactionSelectedId)||null;
  const pane=document.querySelector('#transactionDetailPane');if(pane)pane.innerHTML=transactionReceiptPreview(selected,frontMode);
  bindRows();
 };
 const bindRows=()=>document.querySelectorAll('[data-tx-select]').forEach(row=>{
  const choose=()=>{
   transactionSelectedId=row.dataset.txSelect||'';
   refresh();
   if(window.innerWidth<=860){setTimeout(()=>document.querySelector('#transactionDetailPane')?.scrollIntoView({behavior:'smooth',block:'start'}),40)}
  };
  row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}};
 });
 document.querySelector('#transactionQueryBtn')?.addEventListener('click',refresh);
 document.querySelector('#transactionClearBtn')?.addEventListener('click',()=>{
  ['transactionDate','transactionProduct','transactionCashier','transactionInvoice','transactionNo'].forEach(id=>{const el=document.querySelector('#'+id);if(el)el.value=''});
  const type=document.querySelector('#transactionType');if(type)type.value='全部';refresh();
 });
 ['transactionType','transactionDate'].forEach(id=>document.querySelector('#'+id)?.addEventListener('change',refresh));
 ['transactionProduct','transactionCashier','transactionInvoice','transactionNo'].forEach(id=>document.querySelector('#'+id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();refresh()}}));
 bindRows();
}
function transactionRowsHtml(rows,frontMode){
 return rows.map(s=>`<tr class="${saleStatusClass(s)}"><td>${esc(s.id)}</td><td>${new Date(s.at).toLocaleString('zh-TW')}</td><td>${esc(transactionCashierAccount(s))}</td><td>${esc(s.payment||'')}</td><td>${money(s.total)}</td><td>${money(saleNet(s))}</td><td><b>${esc(s.status||'正常')}</b></td><td><div class="tx-actions"><button class="button" data-tx-view="${s.id}" data-tx-front="${frontMode?'1':'0'}">查看交易</button><button class="button" data-tx-print="${s.id}">補印交易存根</button><button class="button tx-correct-btn" data-tx-correct="${s.id}" data-tx-front="${frontMode?'1':'0'}" ${s.locked?'disabled':''}>交易更正</button><button class="button" data-tx-exchange="${s.id}" data-tx-front="${frontMode?'1':'0'}" ${s.locked?'disabled':''}>換貨</button><button class="button danger" data-tx-return="${s.id}" data-tx-front="${frontMode?'1':'0'}" ${s.locked?'disabled':''}>整筆退貨</button><button class="button danger" data-tx-void="${s.id}" data-tx-front="${frontMode?'1':'0'}" ${s.locked?'disabled':''}>整筆作廢</button></div></td></tr>`).join('')||'<tr><td colspan="8">尚無交易</td></tr>';
}
function openTransactionDetail(id){
 const s=load(K.sales,[]).find(x=>x.id===id);if(!s)return alert('找不到交易');if(isEcServiceSale(s))return alert('EC 包裹取貨不提供交易存根查詢');
 dlg('交易存根',`<div class="tx-detail-head ${saleStatusClass(s)}"><p><b>交易編號：</b>${esc(s.id)}</p><p><b>時間：</b>${new Date(s.at).toLocaleString('zh-TW')}</p><p><b>狀態：</b>${esc(s.status||'正常')}</p><p><b>原交易金額：</b>${money(s.total)}　<b>目前淨額：</b>${money(saleNet(s))}</p></div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>商品</th><th>原數量</th><th>單價</th><th>原小計</th></tr></thead><tbody>${transactionItemRows(s)}</tbody></table></div><h3>更正／退貨紀錄</h3>${transactionHistoryHtml(s)}<p class="tx-no-print">更正與退貨完成後不另外產生退貨明細；補印時會列印目前交易狀態與更正後內容。</p>`);
}
function openTransactionCorrection(id,frontMode){
 const sale=load(K.sales,[]).find(x=>x.id===id);if(!sale)return alert('找不到交易');if(isEcServiceSale(sale))return alert('EC 包裹取貨不可更正或退貨');if(sale.locked)return alert('此交易已鎖定');
 const reasonOptions=['客人不要','商品瑕疵','收銀刷錯','重複刷到','店長核准','其他'];
 dlg('交易更正／部分退貨',`<p>交易：${esc(sale.id)}｜目前淨額 ${money(saleNet(sale))}</p>${saleHasAnybuy(sale)?'<div class="notice">隨買跨店取屬代銷／兌換交易；若與一般商品同筆結帳，只能在這裡做部分更正。隨買購買商品僅限付款後 7 天內且完全未兌換才能退貨。</div>':''}<div class="tx-correction-list">${(sale.items||[]).map((x,i)=>{const baseAvailable=Math.max(0,Number(x.qty||0)-Number(x.returnedQty||0));const eligible=appAnybuyLineReturnEligibility(sale,x);const available=eligible.allowed?baseAvailable:0;const tag=x.appAnybuyRedeem?'隨買兌換':(x.appAnybuyPayment||x.appAnybuyDeposit?'隨買代銷':'');return `<label class="tx-correction-row ${eligible.allowed?'':'is-disabled'}"><span><b>${esc(x.name)}</b>${tag?`<small class="tx-anybuy-tag">${esc(tag)}</small>`:''}<small>原數量 ${x.qty}｜已退 ${x.returnedQty||0}｜可退 ${available}</small>${!eligible.allowed?`<small class="bad">${esc(eligible.reason)}</small>`:''}</span><input type="number" min="0" max="${available}" value="0" data-tx-return-qty="${x.lineId||`${sale.id}-L${i+1}`}" ${eligible.allowed?'':'disabled'}></label>`}).join('')}</div><label>更正原因<select id="txReason">${reasonOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><label>備註<input id="txReasonNote" placeholder="選填"></label><p class="tx-no-print">完成後不列印退貨／更正明細。</p><button class="primary" id="txCorrectionSave">確認交易更正</button>`);
 setTimeout(()=>{
  document.querySelectorAll('[data-tx-return-qty]').forEach(el=>{
    const sync=()=>el.closest('.tx-correction-row')?.classList.toggle('selected-return',Number(el.value||0)>0);
    el.addEventListener('input',sync);sync();
  });
  document.querySelector('#txCorrectionSave').onclick=()=>{
    if(!frontMode&&!requirePermission('transactionBackCorrect'))return;
    const adjustments=[...document.querySelectorAll('[data-tx-return-qty]')]
      .map(el=>({lineId:el.dataset.txReturnQty,returnQty:Number(el.value||0)}))
      .filter(x=>x.returnQty>0);
    try{
      correctSale(id,adjustments,txReason.value,txReasonNote.value.trim());reconcileMemberPointsAfterReturn(id);
      syncAppAnybuyReturnAfterSaleChange(id).then(async()=>{
       if(window.__yjAppAnybuyReturnRequest){
        await completeAppAnybuyReturnRequest(window.__yjAppAnybuyReturnRequest,id).catch(()=>{});
        window.__yjAppAnybuyReturnRequest=null;
       }
      }).catch(e=>console.warn('隨買退貨同步失敗',e));
      genericDialog.close();
      render(frontMode?'transactions-front':'transactions');
    }catch(err){alert(err.message)}
  };
},0);
}
function confirmWholeTransaction(id,type,frontMode){
 const ecSale=load(K.sales,[]).find(x=>x.id===id);if(isEcServiceSale(ecSale))return alert('EC 包裹取貨不可退貨或作廢');
 if(!frontMode){const key=type==='void'?'transactionBackVoid':'transactionBackCorrect';if(!requirePermission(key))return}
 const sale=load(K.sales,[]).find(x=>x.id===id);if(!sale)return alert('找不到交易');if(sale.locked)return alert('此交易已鎖定');
 const anybuyClose=wholeAnybuyTransactionCloseEligibility(sale);if(!anybuyClose.allowed)return alert(anybuyClose.reason);
 const reasons=type==='void'?['誤刷','測試交易','收銀錯誤','系統異常','其他']:['客人取消','客訴退貨','商品瑕疵','系統異常','其他'];
 dlg(type==='void'?'整筆作廢':'整筆退貨',`<p>交易：${esc(sale.id)}｜目前淨額 ${money(saleNet(sale))}</p><label>原因<select id="txWholeReason">${reasons.map(x=>`<option>${x}</option>`).join('')}</select></label><label>備註<input id="txWholeNote" placeholder="選填"></label><p class="tx-warning">此操作會沖回庫存、鮮食批次、營收與送金；完成後交易鎖定，且不列印退貨明細。</p><button class="primary danger" id="txWholeConfirm">確認${type==='void'?'作廢':'整筆退貨'}</button>`);
 setTimeout(()=>document.querySelector('#txWholeConfirm').onclick=()=>{try{closeSale(id,type,txWholeReason.value,txWholeNote.value.trim());reconcileMemberPointsAfterReturn(id);syncAppAnybuyReturnAfterSaleChange(id).catch(e=>console.warn('隨買退貨同步失敗',e));genericDialog.close();render(frontMode?'transactions-front':'transactions')}catch(err){alert(err.message)}},0);
}
function back(p){
 if(p==='home'){return storeOperationsHome()}
 if(p==='products')return`<div class="page-head"><h2>商品管理 2.0</h2><div class="toolbar"><input id="productAdminSearch" placeholder="搜尋商品代號／名稱／條碼"><button class="button" data-action="manage-groups">品群分類</button><button class="primary" data-action="new-product">＋ 新增商品</button></div></div><div class="panel table-wrap"><table class="table product-master-table"><thead><tr><th>商品代號</th><th>商品</th><th>條碼</th><th>類別</th><th>品群</th><th>配送別</th><th>售價</th><th>成本</th><th>毛利率</th><th>庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody id="productAdminRows">${productRows()}</tbody></table></div>`;
 if(p==='ordering'){const rows=load(K.orders,[]);return`<div class="page-head"><h2>訂購管理</h2></div><div class="order-direct-grid">${ORDER_TYPES_V531.map(([type,icon])=>`<button class="order-direct" data-v531-order-type="${type}">${icon} ${type}<small>點擊進入訂購</small></button>`).join('')}</div><div class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>訂單號</th><th>類型</th><th>預定到貨</th><th>品項數</th><th>總數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${v531OrderSummary(rows)}</tbody></table></div>`}
 if(false&&p==='ordering'){const rows=load(K.orders,[]),types=['台帳訂購','FOS鮮食訂購','備品訂購','特殊用品訂購','品群訂購'];return`<div class="page-head"><h2>訂購管理</h2><div class="toolbar"><button class="primary" data-action="new-order">＋ 新增訂購單</button></div></div><div class="order-type-grid">${types.map(t=>`<button class="order-type" data-order-filter="${t}">${t}</button>`).join('')}</div><div class="panel table-wrap"><table class="table"><thead><tr><th>訂單號</th><th>類型</th><th>預定到貨</th><th>品項數</th><th>總數量</th><th>狀態</th><th>操作</th></tr></thead><tbody id="orderRows">${orderRows(rows)}</tbody></table></div>`}
 if(p==='inventory'){const ps=products(),moves=load(K.inventoryMoves,[]),low=ps.filter(x=>x.stock<=x.safeStock).length,total=ps.reduce((a,x)=>a+x.stock,0),cost=ps.reduce((a,x)=>a+x.stock*x.cost,0);return`<div class="page-head"><h2>庫存管理</h2><button class="primary" data-action="inventory-adjust">＋ 庫存異動</button></div><div class="metric-grid"><div class="metric"><small>商品總數</small><strong>${ps.length}</strong></div><div class="metric"><small>低庫存</small><strong>${low}</strong></div><div class="metric"><small>庫存總量</small><strong>${total}</strong></div><div class="metric"><small>庫存成本</small><strong>${money(cost)}</strong></div></div><div class="quality-grid" style="margin-top:14px"><div class="panel table-wrap"><h3>即時庫存</h3><table class="table"><tr><th>商品</th><th>庫存</th><th>安全庫存</th><th>狀態</th><th>操作</th></tr>${ps.map(x=>`<tr><td>${productDisplayIconHtml(x)} ${esc(x.name)}</td><td>${x.stock}</td><td>${x.safeStock}</td><td>${x.stock<=x.safeStock?'⚠️ 低庫存':'正常'}</td><td><button class="button" data-stock="${x.id}">調整</button></td></tr>`).join('')}</table></div><div class="panel table-wrap"><h3>異動紀錄</h3><table class="table"><tr><th>商品</th><th>數量</th><th>類型</th><th>原因</th><th>時間</th></tr>${moves.map(x=>`<tr><td>${esc(x.product)}</td><td>${x.qty>0?'+':''}${x.qty}</td><td>${esc(x.type||'調整')}</td><td>${esc(x.reason||'')}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td></tr>`).join('')||'<tr><td colspan="5">尚無異動紀錄</td></tr>'}</table></div></div>`}
 if(p==='quality'){const q=load(K.quality,[]),w=load(K.waste,[]);return`<div class="page-head"><h2>品保／時控</h2><div class="toolbar"><button class="primary" data-action="new-fresh-batch">＋ 新增鮮食批次</button><button class="button" data-action="new-quality">＋ 新增時控商品</button><button class="button" data-action="new-waste">＋ 廢棄登錄</button></div></div><div class="panel"><h3>鮮食批次管理</h3><div class="table-wrap"><table class="table fresh-batch-table"><thead><tr><th>批次號</th><th>商品代號</th><th>商品名稱</th><th>商品條碼</th><th>進貨時間</th><th>到期時間</th><th>進貨數量</th><th>剩餘數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${freshBatches().map(freshBatchRow).join('')||'<tr><td colspan="10">尚無鮮食批次</td></tr>'}</tbody></table></div></div><div class="quality-grid" style="margin-top:14px"><div class="panel"><h3>時控商品</h3><div class="table-wrap"><table class="table"><tr><th>商品</th><th>日期</th><th>折扣價</th><th>數量</th><th>狀態</th><th>操作</th></tr>${q.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.date)}</td><td>${money(x.price)}</td><td>${x.qty}</td><td>${esc(x.status)}</td><td><button class="button" data-edit-quality="${x.id}">修改</button> <button class="button" data-print-quality="${x.id}">列印</button> <button class="button danger" data-delete-quality="${x.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="6">尚無時控商品</td></tr>'}</table></div></div><div class="panel"><h3>廢棄紀錄</h3><div class="table-wrap"><table class="table"><tr><th>商品</th><th>數量</th><th>原因</th><th>操作人</th><th>時間</th></tr>${w.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${esc(x.reason)}</td><td>${esc(x.user||'')}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td></tr>`).join('')||'<tr><td colspan="5">尚無廢棄紀錄</td></tr>'}</table></div></div></div>`}
 if(p==='employees'){const es=load(K.employees,[]);return`<div class="page-head"><h2>員工管理</h2><button class="primary" data-action="new-employee">＋ 新增員工</button></div><div class="panel table-wrap"><table class="table"><tr><th>姓名</th><th>帳號</th><th>手機</th><th>角色</th><th>狀態</th><th>操作</th></tr>${es.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.account)}</td><td>${esc(x.phone||'')}</td><td>${esc(x.role)}</td><td>${x.active!==false?'在職':'停用'}</td><td><button class="button" data-edit-employee="${x.id}">修改</button> <button class="button" data-employee-credentials="${x.id}">帳密設定</button> <button class="button" data-toggle-employee="${x.id}">${x.active!==false?'停用':'啟用'}</button></td></tr>`).join('')}</table></div>`}
 if(p==='attendance'){const r=load(K.attendance,[]),today=new Date().toISOString().slice(0,10),todayRows=r.filter(x=>x.at.startsWith(today)),ins=todayRows.filter(x=>x.kind==='簽到').length,outs=todayRows.filter(x=>x.kind==='簽退').length;return`<div class="page-head"><h2>出勤管理</h2><div class="toolbar"><button class="primary" data-action="attendance-edit">✏️ 工時修改</button><button class="button" data-action="attendance-print">🖨️ 列印</button></div></div><div class="attendance-summary"><div class="metric"><small>今日簽到</small><strong>${ins}</strong></div><div class="metric"><small>今日簽退</small><strong>${outs}</strong></div><div class="metric"><small>未簽退</small><strong>${Math.max(0,ins-outs)}</strong></div></div><div class="panel table-wrap"><table class="table"><tr><th>員工</th><th>類型</th><th>日期時間</th><th>修改原因</th><th>操作</th></tr>${r.map(x=>`<tr><td>${esc(x.user)}</td><td>${esc(x.kind)}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.modifyReason||'')}</td><td><button class="button" data-attendance-edit="${x.id}">修改</button></td></tr>`).join('')||'<tr><td colspan="5">尚無出勤紀錄</td></tr>'}</table></div>`}
 if(p==='members'){const ms=load(K.members,[]);return`${memberPointSettingsPanel()}${memberBonusCampaignPage()}<div class="page-head"><h2>會員管理 <small style="font-size:13px;font-weight:500">☁️ 與後台共用會員主檔</small></h2><div class="toolbar"><button class="button" data-action="member-cloud-refresh">↻ 同步會員／點數／活動</button><button class="primary" data-action="new-member">＋ 新增會員</button></div></div><div class="panel table-wrap"><table class="table"><tr><th>姓名</th><th>手機</th><th>編號</th><th>點數</th><th>操作</th></tr>${ms.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.code)}</td><td>${x.points||0}</td><td><button class="button" data-edit-member="${x.id}">修改</button> <button class="button danger" data-delete-member="${x.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="5">尚無會員</td></tr>'}</table></div>`}
 if(p==='permissions'){
 const es=load(K.employees,[]);
 return `<h2>權限管理</h2>
 <div class="panel">
  <h3>角色資料</h3>
  <div class="role-list">
   ${ROLE_LIST.map(role=>`<span class="role-chip">${role}</span>`).join('')}
  </div>
  <p>總部支援為獨立授權角色，只能由創辦人設定權限。</p>
 </div>
 <div class="panel" style="margin-top:12px">
  <p>請先選擇人員。只能管理比自己低階的人員，不能修改自己、同級或上級。</p>
  <div class="permission-people">
   ${es.map(x=>`<button class="permission-person ${canManageTarget(currentUser(),x)?'':'locked'}"
      data-permission-person="${x.id}"
      ${canManageTarget(currentUser(),x)?'':'disabled'}>
      <strong>${esc(x.name)}</strong>
      <span>${esc(x.role)}</span>
    </button>`).join('')}
  </div>
 </div>`
}
 if(p==='audit'){const r=load(K.audit,[]);return`<div class="page-head"><h2>Audit Log</h2><button class="button" data-action="audit-print">🖨️ 列印</button></div><div class="panel">${r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user)}｜${esc(x.action)}｜${esc(x.detail)}</div><hr>`).join('')||'尚無紀錄'}</div>`}
 if(p==='updates'){const r=load(K.updates,[]);return`<h2>更新中心</h2><div class="toolbar"><button class="primary" data-update="POS">下傳 POS</button><button class="primary" data-update="後台">下傳後台</button><button class="primary" data-update="全部">全部下傳</button></div><div class="panel">${r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.target)}｜${esc(x.status)}</div><hr>`).join('')||'尚無更新紀錄'}</div>`}
 if(p==='transactions'){if(!hasPermission('transactionBackAccess'))return`<h2>交易管理</h2><div class="panel"><p>需要「後台交易查詢」權限。</p></div>`;return transactionPage(false)}
 if(p==='xaccount')return xAccountPage();
 if(p==='promotions')return promotionPage();
 if(p==='system-settings')return systemSettingsPage();
 if(p==='pickup')return pickupPage();
 if(p==='ec-flow')return ecFlowPage();
 if(p==='revenue'){const r=load(K.revenue,[]);return`<div class="panel" style="margin-bottom:14px"><div class="page-head"><h3>X帳／交班</h3><div class="toolbar">${currentOpenShift()?'<button class="primary" data-action="close-shift">完成交班／X帳</button>':'<button class="primary" data-action="open-shift">開班</button>'}</div></div>${currentOpenShift()?`<p>目前班次：<b>${esc(currentOpenShift().type)}</b>｜${esc(currentOpenShift().cashier)}｜${new Date(currentOpenShift().openedAt).toLocaleString('zh-TW')} 開班</p>`:'<p>目前沒有開班中的班次。</p>'}<button class="button" data-action="view-x-history">查看 X 帳紀錄</button></div><h2>營收管理</h2><div class="toolbar"><button class="primary" data-action="collect">營收收集</button><button class="button" data-action="x">X帳查詢</button></div><div class="panel table-wrap"><table class="table"><tr><th>日期</th><th>總營收</th><th>現金收入</th><th>非現金收入</th><th>投庫</th><th>應送金</th><th>筆數</th><th>狀態</th><th>操作</th></tr>${r.map(x=>`<tr><td>${x.date}</td><td>${money(x.total)}</td><td>${money(x.cashRevenue||0)}</td><td>${money(x.nonCashRevenue||0)}</td><td>${money(x.deposits||0)}</td><td>${money(x.sendAmount??x.actualCash??0)}</td><td>${x.count}</td><td>${x.status}</td><td><button class="button" data-correct="${x.id}">修正</button> <button class="button" data-z="${x.id}">Z帳</button> <button class="button" data-print="${x.id}">列印Z帳＋送金單</button></td></tr>`).join('')}</table></div>`}
 if(p==='logistics'){const schedules=load(K.logisticsSchedules,[]),logs=load(K.logistics,[]);return`<div class="page-head"><h2>物流管理</h2><div class="toolbar"><button class="primary" data-action="logistics-query">預定到店查詢</button><button class="button" data-action="logistics-schedule-edit">到店時間設定</button></div></div><div class="panel table-wrap"><table class="table"><tr><th>店名</th><th>配別</th><th>本日到店時間</th><th>表定到店時間</th><th>備註</th></tr>${schedules.map(x=>{const a=logs.find(l=>(l.storeCode||'001')===x.storeCode&&l.type===x.type&&l.at.startsWith(new Date().toISOString().slice(0,10)));return`<tr><td>${esc(x.storeName)}（${esc(x.storeCode)}）</td><td>${esc(x.type)}</td><td>${a?new Date(a.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}):'尚未到店'}</td><td>${esc(x.scheduled)}</td><td>${esc(a?.note||x.note||'')}</td></tr>`}).join('')}</table></div>`}
 if(p==='ec'){const rows=load(K.ec,[]),today=new Date().toISOString().slice(0,10),todaySent=rows.filter(x=>x.sentAt?.startsWith(today)).length,todayArrived=rows.filter(x=>x.arrivedAt?.startsWith(today)).length,todayPicked=rows.filter(x=>x.pickedAt?.startsWith(today)).length,todayLeft=rows.filter(x=>x.leftAt?.startsWith(today)).length,waiting=rows.filter(x=>x.status==='待取件').length,value=rows.reduce((a,x)=>a+Number(x.value||0),0);return`<div class="page-head"><h2>EC管理</h2><div class="toolbar"><button class="primary" data-action="new-ec">＋ 寄件</button><button class="button" data-action="ec-print-all">列印標籤</button></div></div><div class="metric-grid"><div class="metric"><small>今日寄件</small><strong>${todaySent}</strong></div><div class="metric"><small>今日進貨</small><strong>${todayArrived}</strong></div><div class="metric"><small>待取件</small><strong>${waiting}</strong></div><div class="metric"><small>今日取件</small><strong>${todayPicked}</strong></div><div class="metric"><small>今日離店</small><strong>${todayLeft}</strong></div><div class="metric"><small>包裹價值</small><strong>${money(value)}</strong></div></div><div class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>溫層</th><th>姓名</th><th>末三碼</th><th>包裹編號</th><th>取貨店</th><th>價值</th><th>狀態</th><th>寄件</th><th>進貨</th><th>取件</th><th>離店</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.type)}</td><td>${esc(x.name)}</td><td>${esc(x.last3)}</td><td>${esc(x.packageNo||'')}</td><td>${esc(x.pickupStore||'—')}</td><td>${money(x.value)}</td><td>${esc(x.status)}</td><td>${x.sentAt?new Date(x.sentAt).toLocaleString('zh-TW'):'—'}</td><td>${x.arrivedAt?new Date(x.arrivedAt).toLocaleString('zh-TW'):'—'}</td><td>${x.pickedAt?new Date(x.pickedAt).toLocaleString('zh-TW'):'—'}</td><td>${x.leftAt?new Date(x.leftAt).toLocaleString('zh-TW'):'—'}</td><td><button class="button" data-ec-print="${x.id}">列印</button> <button class="button danger" data-ec-cancel="${x.id}">取消寄件</button></td></tr>`).join('')||'<tr><td colspan="12">尚無EC包裹</td></tr>'}</table></div>`}
 if(p==='transfers'){const rows=load(K.transfers,[]);return`<div class="page-head"><h2>轉貨管理</h2><div class="toolbar"><button class="primary" data-action="transfer-out">轉出</button><button class="button" data-action="transfer-in-back">轉入</button></div></div><div class="panel table-wrap"><table class="table"><tr><th>轉貨單號</th><th>轉出店</th><th>轉入店</th><th>商品</th><th>日期</th><th>數量</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td><td>${x.items.map(i=>esc(i.name)).join('、')}</td><td>${x.items.map(i=>esc(i.date||'—')).join('、')}</td><td>${x.items.reduce((a,i)=>a+Number(i.qty),0)}</td><td>${esc(x.status)}</td><td>${x.status==='運送中'?`<button class="button" data-transfer-receive="${x.id}">轉入</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8">尚無轉貨單</td></tr>'}</table></div>`}
 if(p==='stores'){const rows=load(K.stores,[]);return`<div class="page-head"><h2>門市管理</h2><div class="toolbar"><button class="primary" data-action="store-add">＋ 新增門市</button><button class="button" data-action="store-code">轉換店號</button><button class="button" data-action="store-query">查詢其他門市</button></div></div><div class="panel table-wrap"><table class="table"><tr><th>門市名稱</th><th>店號</th><th>狀態</th></tr>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.code)}</td><td>${x.active!==false?'啟用':'停用'}</td></tr>`).join('')}</table></div>`}
 if(p==='operations')return`<h2>營運情報</h2><div class="metric-grid">${metrics()}</div>`;
 const title=pages.find(x=>x[0]===p)?.[2]||'模組';return`<h2>${title}</h2><div class="panel"><p>此模組將在下一包完成。</p></div>`}


const ORDER_TYPES_V531=[
 ['台帳訂購','📦'],
 ['FOS鮮食訂購','🥪'],
 ['備品訂購','🧴'],
 ['特殊用品訂購','📋'],
 ['品群訂購','🏷️']
];

function v531FindProduct(value){
 const q=String(value||'').trim().toLowerCase();
 if(!q)return null;
 return products().find(p=>
  String(p.code||'').toLowerCase()===q||
  String(p.name||'').toLowerCase()===q||
  productBarcodes(p).some(b=>String(b).toLowerCase()===q)
 )||null;
}

function v531OrderSummary(rows){
 return rows.map(o=>`<tr>
  <td>${esc(o.id)}</td><td>${esc(o.type)}</td><td>${esc(o.deliveryDate||'')}</td>
  <td>${o.items?.length||0}</td><td>${(o.items||[]).reduce((s,x)=>s+Number(x.qty||0),0)}</td>
  <td>${esc(o.status||'已建立')}</td>
  <td><button class="button" data-v531-order-print="${o.id}">列印</button> <button class="button danger" data-v531-order-delete="${o.id}">刪除</button></td>
 </tr>`).join('')||'<tr><td colspan="7">尚無訂購單</td></tr>';
}

function v531ItemHtml(item,index){
 return `<div class="order-product-card">
  <div class="order-product-main"><strong>${esc(item.code)}｜${esc(item.name)}</strong>
  <small>條碼：${esc(item.barcode||'—')}　品群：${esc(item.group||'其他')}　類別：${esc(item.category||'')}　配送別：${esc(item.deliveryType||'')}</small></div>
  <label>數量<input type="number" min="1" value="${item.qty}" data-v531-order-qty="${index}"></label>
  <button type="button" class="button danger" data-v531-order-remove="${index}">刪除</button>
 </div>`;
}

function v531OpenOrdering(type){
 let items=[];
 const selectable=products().filter(p=>productStatusLabel(p)!=='停用');

 dlg(type,`
  <div class="ordering-entry-grid">
   <label>商品下拉選擇
    <select id="v531OrderProductSelect">
     <option value="">請選擇商品</option>
     ${selectable.map(p=>`<option value="${p.id}">${esc(p.code||'—')}｜${esc(p.name)}｜${esc(productBarcodes(p)[0]||'無條碼')}</option>`).join('')}
    </select>
   </label>
   <label>商品代號／條碼<input id="v531OrderProductInput" placeholder="輸入商品代號或條碼"></label>
  </div>
  <div class="toolbar">
   <button type="button" class="button" id="v531OrderScan">📷 相機掃描</button>
   <button type="button" class="primary" id="v531OrderAdd">加入商品</button>
  </div>
  <div id="v531OrderItems"></div>
  <label>預定到貨日<input id="v531OrderDate" type="date"></label>
  <label>備註<textarea id="v531OrderNote" rows="3"></textarea></label>
  <button type="button" class="primary" id="v531OrderSave">儲存訂購單</button>`);

 const redraw=()=>{
  const box=document.querySelector('#v531OrderItems');
  if(box)box.innerHTML=items.map(v531ItemHtml).join('')||'<p class="empty-note">尚未加入商品</p>';
 };

 setTimeout(()=>{
  const select=document.querySelector('#v531OrderProductSelect');
  const input=document.querySelector('#v531OrderProductInput');
  const add=document.querySelector('#v531OrderAdd');
  const scan=document.querySelector('#v531OrderScan');
  const box=document.querySelector('#v531OrderItems');
  const saveBtn=document.querySelector('#v531OrderSave');
  redraw();

  select.onchange=()=>{
   const p=products().find(x=>x.id===select.value);
   if(p)input.value=p.code||productBarcodes(p)[0]||'';
  };

  scan.onclick=()=>scanCode({title:'掃描訂購商品',onResult:code=>input.value=code});

  add.onclick=()=>{
   const p=products().find(x=>x.id===select.value)||v531FindProduct(input.value);
   if(!p)return alert('找不到商品');
   if(productStatusLabel(p)==='停用')return alert('此商品已停用，無法訂購');
   const old=items.find(x=>x.productId===p.id);
   if(old)old.qty+=1;
   else items.push({
    productId:p.id,code:p.code||'',name:p.name,barcode:productBarcodes(p)[0]||'',
    group:p.group||'其他',category:p.category||'',deliveryType:p.deliveryType||p.logistics||'',qty:1
   });
   select.value='';input.value='';redraw();
  };

  box.onclick=e=>{
   const remove=e.target.closest('[data-v531-order-remove]');
   if(remove){items.splice(Number(remove.dataset.v531OrderRemove),1);redraw()}
  };
  box.oninput=e=>{
   const qty=e.target.closest('[data-v531-order-qty]');
   if(qty)items[Number(qty.dataset.v531OrderQty)].qty=Math.max(1,Number(qty.value)||1);
  };

  saveBtn.onclick=()=>{
   if(!items.length)return alert('請至少加入一項商品');
   const rows=load(K.orders,[]);
   const now=new Date();
   const order={
    id:`OR-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,
    type,deliveryDate:document.querySelector('#v531OrderDate').value,
    note:document.querySelector('#v531OrderNote').value.trim(),
    items:items.map(x=>({...x})),status:'已建立',at:now.toISOString(),user:currentUser()?.name||''
   };
   rows.unshift(order);save(K.orders,rows);
   saveAudit('建立訂購單',`${order.id}｜${order.type}｜${order.items.length}項`);
   alert('訂購單已儲存');genericDialog.close();render('ordering');
  };
 },0);
}

function v531PrintOrder(order){
 const body=(order.items||[]).map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.barcode||'')}</td><td>${esc(x.group||'')}</td><td>${esc(x.category||'')}</td><td>${esc(x.deliveryType||'')}</td><td>${x.qty}</td></tr>`).join('');
 printHTML(`訂購單 ${order.id}`,`<p>類型：${esc(order.type)}</p><p>預定到貨日：${esc(order.deliveryDate||'')}</p><table><tr><th>商品代號</th><th>商品名稱</th><th>條碼</th><th>品群</th><th>類別</th><th>配送別</th><th>數量</th></tr>${body}</table><p>備註：${esc(order.note||'')}</p>`);
}

function orderRows(rows){return rows.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.type)}</td><td>${esc(o.deliveryDate||'')}</td><td>${o.items.length}</td><td>${o.items.reduce((a,x)=>a+Number(x.qty),0)}</td><td>${esc(o.status)}</td><td><button class="button" data-view-order="${o.id}">查看</button> <button class="button danger" data-delete-order="${o.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">尚無訂購單</td></tr>'}
function orderForm(){return`<label>訂購類型<select id="orderType">${['台帳訂購','FOS鮮食訂購','備品訂購','特殊用品訂購','品群訂購'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>預定到貨日<input id="orderDate" type="date"></label><div class="panel"><h3>商品明細</h3><div class="inline-field"><input id="orderBarcode" placeholder="掃描或輸入商品條碼"><button type="button" class="button" id="scanOrderBarcode">📷 掃描</button><button type="button" class="button" id="addOrderItem">加入</button></div><div id="orderItemList"></div></div><label>備註<textarea id="orderNote"></textarea></label><button class="primary" id="saveOrder">建立訂購單</button>`}


function employeeRoleOptions(selected=''){
 const actor=currentUser();
 const roles=actor?.role==='創辦人'
  ? ['創辦人','店長','副店長','正職','兼職','總部支援']
  : ['店長','副店長','正職','兼職'];
 return roles.map(x=>`<option ${selected===x?'selected':''}>${x}</option>`).join('');
}

function validateEmployeeRoleChange(originalRole,newRole){
 const actor=currentUser();
 if(newRole==='總部支援'&&actor?.role!=='創辦人'){
  alert('只有創辦人可以建立或設定總部支援');
  return false;
 }
 if(originalRole==='總部支援'&&actor?.role!=='創辦人'){
  alert('只有創辦人可以修改總部支援人員');
  return false;
 }
 return true;
}

function openPermissionCategories(targetId){
 const target=load(K.employees,[]).find(x=>x.id===targetId);
 if(!target||!canManageTarget(currentUser(),target))return alert('不能修改此人員的權限');
 dlg(`設定權限－${target.name}`,`
  <p>${esc(target.role)}</p>
  <div class="permission-category-grid">
   ${Object.entries(PERMISSION_CATEGORIES).map(([key,c])=>`
    <button class="permission-category" data-permission-category="${key}" data-permission-target="${target.id}">
     <b>${c.icon}</b><strong>${c.label}</strong><small>${Object.keys(c.items).length} 個細項</small>
    </button>`).join('')}
  </div>`);
}

function openPermissionDetail(targetId,categoryKey){
 const target=load(K.employees,[]).find(x=>x.id===targetId);
 const category=PERMISSION_CATEGORIES[categoryKey];
 if(!target||!category||!canManageTarget(currentUser(),target))return alert('不能修改此人員的權限');

 const all=permissionStore();
 const current={...roleTemplate(target.role),...(all[target.id]||{})};

 dlg(`${category.label}－${target.name}`,`
  <div class="permission-detail">
   ${Object.entries(category.items).map(([key,label])=>{
    const grantable=canGrantPermission(currentUser(),key);
    return `<label class="permission-row ${grantable?'':'locked'}">
     <input type="checkbox" data-permission-key="${key}" ${current[key]?'checked':''} ${grantable?'':'disabled'}>
     <span>${label}</span>${grantable?'':'<em>🔒 無法授予</em>'}
    </label>`;
   }).join('')}
  </div>
  <div class="modal-actions">
   <button class="button" id="permissionBackButton">← 返回分類</button>
   <button class="primary" id="permissionSaveButton">儲存</button>
  </div>`);

 setTimeout(()=>{
  const back=document.querySelector('#permissionBackButton');
  const saveBtn=document.querySelector('#permissionSaveButton');

  if(back)back.onclick=()=>openPermissionCategories(target.id);

  if(saveBtn)saveBtn.onclick=()=>{
   saveBtn.disabled=true;
   saveBtn.textContent='儲存中…';
   try{
    savePermissionCategory(target.id,categoryKey);
   }catch(err){
    console.error(err);
    alert('儲存失敗：'+(err?.message||err));
    saveBtn.disabled=false;
    saveBtn.textContent='儲存';
   }
  };
 },0);
}

function savePermissionCategory(targetId,categoryKey){
 const target=load(K.employees,[]).find(x=>x.id===targetId);
 const category=PERMISSION_CATEGORIES[categoryKey];

 if(!target||!category||!canManageTarget(currentUser(),target)){
  throw new Error('不能修改此人員的權限');
 }

 const all=permissionStore();
 const before={...(all[target.id]||{})};
 const next={...before};

 document.querySelectorAll('[data-permission-key]').forEach(box=>{
  const key=box.dataset.permissionKey;
  if(canGrantPermission(currentUser(),key)){
   next[key]=Boolean(box.checked);
  }
 });

 all[target.id]=next;
 save(K.permissions,all);

 const verify=load(K.permissions,{});
 if(!verify[target.id]){
  throw new Error('權限資料未成功寫入');
 }

 const changed=Object.keys(category.items).filter(
  k=>Boolean(before[k])!==Boolean(next[k])
 );

 saveAudit(
  '修改權限',
  `${target.name}｜${category.label}｜${changed.join('、')||'無異動'}`
 );

 alert('權限已儲存');
 genericDialog.close();
 render('permissions');
}


const FRESH_ALERT_KEY='yj_fresh_alerted_batches';

function checkFreshExpiryAlerts(){
 const now=new Date();
 const alerted=load(FRESH_ALERT_KEY,{});
 let changed=false;
 freshBatches().forEach(batch=>{
  if(Number(batch.remainingQty||0)<=0||batch.status==='已廢棄')return;
  const p=products().find(x=>x.id===batch.productId);
  if(!p||p.category!=='鮮食')return;
  const expiry=new Date(batch.expiryAt);
  const minutes=(expiry-now)/60000;
  const threshold=Number(p.alertBeforeMinutes??10);
  if(minutes>0&&minutes<=threshold&&!alerted[batch.id]){
   alert(`請檢查商品效期並下架\n\n商品名稱：${p.name}\n商品條碼：${batch.barcode||productBarcodes(p)[0]||''}\n到期時間：${expiry.toLocaleString('zh-TW')}\n剩餘數量：${batch.remainingQty}`);
   alerted[batch.id]=new Date().toISOString();
   changed=true;
   saveAudit('鮮食到期提醒',`${p.name}｜${batch.barcode||''}｜${batch.expiryAt}｜剩餘${batch.remainingQty}`);
  }
 });
 if(changed)save(FRESH_ALERT_KEY,alerted);
}


function wasteProductAvailableQty(p){
 if(!p)return 0;
 const stock=Math.max(0,Number(p.stock||0));
 return isFreshWasteProduct(p)?Math.min(stock,availableFreshWasteQty(p.id)):stock;
}
function addWasteCartProduct(p){
 if(!p)return alert('找不到商品');
 if(productStatusLabel(p)==='停用')return alert('此商品目前停用，不能廢棄');
 const max=wasteProductAvailableQty(p);
 if(max<=0)return alert(isFreshWasteProduct(p)?'此鮮食目前沒有可廢棄的庫存／批次數量':'此商品目前庫存為 0，不能廢棄');
 const old=state.cart.find(x=>x.wasteItem&&String(x.productId)===String(p.id));
 if(old){
  if(Number(old.qty||0)>=max)return alert(`已達可廢棄上限 ${max}`);
  old.qty=Number(old.qty||0)+1;state.selected=old.id;
 }else{
  const id=`WASTE-${p.id}-${Date.now()}`;
  state.cart.push({id,productId:p.id,code:p.code||'',barcode:productBarcodes(p)[0]||'',name:p.name,price:Number(p.price||0),cost:Number(p.cost||0),qty:1,category:p.category||'',group:p.group||'',wasteItem:true,wasteReason:'過期'});
  state.selected=id;
 }
}
function setWasteCartQty(id,value){
 const item=state.cart.find(x=>x.id===id&&x.wasteItem);if(!item)return;
 const p=products().find(x=>String(x.id)===String(item.productId));if(!p)return;
 const max=wasteProductAvailableQty(p);
 item.qty=Math.max(1,Math.min(max,Math.floor(Number(value||1))));
}
function enterWasteMode(){
 if(!scServiceConnected()){showScDisconnectedNotice('wasteLogin');return;}
 if(state.wasteMode)return;
 state.wasteBackup={cart:structuredClone(state.cart||[]),payment:state.payment,discount:state.discount,note:state.note||'',selected:state.selected||'',member:state.member||null,memberRedeemPoints:Number(state.memberRedeemPoints||0),memberRedeemAmount:Number(state.memberRedeemAmount||0)};
 state.wasteMode=true;state.cart=[];state.discount=0;state.note='';state.selected='';state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;state.lastCompletedSale=null;posBottomMenuOpen='';render('pos');
}
function exitWasteMode({discardConfirm=true}={}){
 if(!state.wasteMode)return;
 if(discardConfirm&&state.cart.length&&!confirm('目前還有尚未送出的廢棄商品，確定返回銷售？'))return;
 const b=state.wasteBackup||{};
 state.wasteMode=false;state.cart=Array.isArray(b.cart)?b.cart:[];state.payment=b.payment||'現金';state.discount=Number(b.discount||0);state.note=b.note||'';state.selected=b.selected||'';state.member=b.member||null;state.memberRedeemPoints=Number(b.memberRedeemPoints||0);state.memberRedeemAmount=Number(b.memberRedeemAmount||0);state.wasteBackup=null;posBottomMenuOpen='';render('pos');
}
function commitWasteFromPos(){
 if(!scServiceConnected()){showScDisconnectedNotice('wasteLogin');return;}
 const items=state.cart.filter(x=>x.wasteItem);if(!items.length)return alert('目前沒有商品，無法廢棄');
 const ps=load(K.products,[]),byId=new Map(ps.map(p=>[String(p.id),p]));
 for(const x of items){
  const p=byId.get(String(x.productId));if(!p)return alert(`找不到商品：${x.name}`);
  const allowed=isFreshWasteProduct(p)?Math.min(Math.max(0,Number(p.stock||0)),availableFreshWasteQty(p.id)):Math.max(0,Number(p.stock||0));
  if(Number(x.qty||0)>allowed)return alert(`${p.name} 可廢棄數量只剩 ${allowed}，請重新確認`);
 }
 const totalQty=items.reduce((s,x)=>s+Number(x.qty||0),0),totalAmount=items.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);
 if(!confirm(`確認廢棄 ${items.length} 項／${totalQty} 件／${money(totalAmount)}？`))return;
 const wasteRows=load(K.waste,[]),batches=freshBatches(),now=new Date().toISOString(),detail=[];
 for(const x of items){
  const p=byId.get(String(x.productId)),q=Math.max(1,Math.floor(Number(x.qty||1))),before=Number(p.stock||0);let batchAffected=[];
  if(isFreshWasteProduct(p)){const allocation=allocateFreshWaste(p.id,q,batches);if(allocation.remain>0)return alert(`${p.name} 鮮食批次不足，廢棄未送出`);batchAffected=allocation.affected}
  p.stock=Math.max(0,before-q);
  wasteRows.unshift({id:uid(),productId:p.id,productCode:p.code||'',barcode:productBarcodes(p)[0]||'',name:p.name,price:Number(p.price||0),amount:Number(p.price||0)*q,qty:q,reason:x.wasteReason||'過期',note:state.note||'',user:currentUser().name,at:now,stockBefore:before,stockAfter:p.stock,batchNos:batchAffected.map(v=>v.batchNo).filter(Boolean),batchWaste:batchAffected});
  detail.push(`${p.name}×${q}(${x.wasteReason||'過期'})`);
 }
 save(K.products,ps);save(K.waste,wasteRows);save(K.freshBatches,batches);saveAudit('POS 集中廢棄',`${detail.join('、')}｜共 ${items.length}項 ${totalQty}件 ${money(totalAmount)}`);
 alert(`廢棄完成\n${items.length} 項／${totalQty} 件／${money(totalAmount)}`);state.cart=[];state.note='';state.selected='';exitWasteMode({discardConfirm:false});
}

let unifiedScanSession={parts:[],mode:'',provider:null,startedAt:0};
function resetUnifiedScanSession(){unifiedScanSession={parts:[],mode:'',provider:null,startedAt:0}}
function collectionProvidersLocal(){return (load('yj_collection_service_providers',[])||[]).filter(x=>x&&x.enabled!==false)}
function collectionProviderForCode(code){
 const q=String(code||'').trim(),rows=collectionProvidersLocal();
 const candidates=rows.filter(x=>{
  const prefix=String(x.prefix||'').trim(),len=Number(x.length||0);
  if(!prefix)return false;
  if(!q.startsWith(prefix))return false;
  return !len||q.length===len;
 });
 return candidates.sort((a,b)=>String(b.prefix||'').length-String(a.prefix||'').length)[0]||null;
}
function scanModeCount(mode){return mode==='three'?3:mode==='two'?2:1}
function scanModeZh(mode){return mode==='three'?'三段式帳單':mode==='two'?'二段式 EC／帳單':mode==='qr'?'QR Code':'單一條碼'}
function showUnifiedScanProgress(){
 const n=unifiedScanSession.parts.length,total=scanModeCount(unifiedScanSession.mode||'three');
 const provider=unifiedScanSession.provider?.name||'待辨識';
 dlg('條碼待續刷',`<div class="notice"><b>${esc(scanModeZh(unifiedScanSession.mode||'three'))}</b><br>類型：${esc(provider)}<br>已讀取 ${n}／${total} 段</div><div class="table-wrap"><table class="table"><tbody>${unifiedScanSession.parts.map((x,i)=>`<tr><th>第 ${i+1} 段</th><td>${esc(x)}</td></tr>`).join('')}</tbody></table></div><p>請繼續刷下一段條碼；也可以取消本次多段掃碼。</p><div class="toolbar"><button class="primary" id="continueUnifiedScan">📷 繼續掃描</button><button class="button" id="cancelUnifiedScan">取消</button></div>`);
 setTimeout(()=>{document.querySelector('#continueUnifiedScan')?.addEventListener('click',()=>{genericDialog.close();scanCode({title:'繼續掃描下一段',onResult:(code,meta)=>processUnifiedPosCode(code,{clearInput:false,scanMeta:meta})})});document.querySelector('#cancelUnifiedScan')?.addEventListener('click',()=>{resetUnifiedScanSession();genericDialog.close()})},0);
}
async function tryEcTwoPart(parts){
 const tests=[...parts,parts.join(''),parts.join('-'),parts.join('|')];
 for(const q of tests){
  try{const rows=await posSearchEcPickup(q),ec=ecExactBarcodeRow(rows,q);if(ec)return ec}catch(_){}
 }
 return null;
}
function finalizeCollectionParts(parts,provider=null){
 const ref=parts.join(' / ');
 resetUnifiedScanSession();
 openCollectionPayment(ref,{provider,parts});
}

function ecExactBarcodeRow(rows,code){
 code=String(code||'').trim();
 return (Array.isArray(rows)?rows:[]).find(x=>[
  x?.package_no,x?.packageNo,x?.order_no,x?.orderNo,x?.barcode,x?.ec_barcode
 ].some(v=>String(v||'').trim()===code))||null;
}
function openEcBarcodePickup(row){
 const packageNo=String(row?.package_no||row?.packageNo||row?.order_no||row?.orderNo||'').trim();
 const amount=Math.max(0,Number(row?.value||row?.amount||0));
 const scOnline=scServiceConnected();
 dlg('EC 條碼辨識',`<div class="notice"><b>已辨識為 EC 包裹</b><br>包裹編號：${esc(packageNo||'—')}<br>收件人：${esc(row?.recipient_name||row?.name||'—')}<br>手機末三碼：${esc(row?.recipient_last3||row?.last3||'—')}<br>代收金額：<b>${money(amount)}</b><br>狀態：${esc(row?.status||'—')}</div>${scOnline?'':'<div class="notice sc-disconnect-inline"><b>與 SC 斷開</b><br>目前可以辨識／查看 EC 包裹，但無法帶入取貨結帳。</div>'}<button class="primary" id="ecBarcodeCheckout" ${scOnline?'':'disabled title="與 SC 斷開，無法進行 EC 取貨"'}>帶入 EC 取貨／結帳</button>`);
 setTimeout(()=>{const b=document.querySelector('#ecBarcodeCheckout');if(!b)return;b.onclick=()=>{if(!scServiceConnected()){showScDisconnectedNotice('ec');return}if(!packageNo)return alert('EC 包裹編號無效');if(state.cart.length)return alert('目前 TM 購物車已有商品，請先完成或取消目前交易，再帶入 EC 包裹。');state.cart=[{id:`EC-${packageNo}`,code:packageNo,name:`EC 包裹取貨 ${packageNo}`,price:amount,cost:0,qty:1,ecPickup:true,ecPackageNo:packageNo,category:'EC服務',allowNegativeStock:true}];state.discount=0;state.payment='現金';state.note=`EC取貨｜${packageNo}`;genericDialog.close();render('pos');setTimeout(drawPOS,0)}},0);
}

function tmRestrictedProductKind(p){
 const text=[p?.category,p?.group,p?.name,p?.shortName,p?.brand,p?.tags].filter(Boolean).join('｜');
 if(
  p?.tobacco===true||
  /菸|煙|香菸|香煙|紙菸|電子菸|加熱菸|TEREA|HEETS|IQOS/i.test(text)
 )return 'tobacco';
 if(
  p?.alcohol===true||
  /酒|啤酒|葡萄酒|威士忌|高粱|清酒|燒酎|伏特加|琴酒|蘭姆|白蘭地/i.test(text)
 )return 'alcohol';
 return '';
}

function tmAgeCutoffText(age){
 const d=new Date();
 d.setFullYear(d.getFullYear()-Number(age||0));
 d.setDate(d.getDate()-1);
 const y=d.getFullYear()-1911;
 const mm=String(d.getMonth()+1).padStart(2,'0');
 const dd=String(d.getDate()).padStart(2,'0');
 return `民國${y}/${mm}/${dd}前出生者`;
}

function showTmAgeReminder(p){
 if(isSelfCheckout()||state.wasteMode||tmTrainingMode())return;
 const kind=tmRestrictedProductKind(p);
 if(!kind)return;
 if(kind==='tobacco'){
  alert(`此商品購買有年齡限制\n販售菸品須滿20歲\n（${tmAgeCutoffText(20)}）`);
 }else{
  alert(`此商品購買有年齡限制\n販售酒品須滿18歲\n（${tmAgeCutoffText(18)}）`);
 }
}

async function processUnifiedPosCode(raw,{clearInput=true,scanMeta={}}={}){
 const q=String(raw||'').trim();if(!q)return;
 const input=document.querySelector('#search');
 const isQr=/QR/i.test(String(scanMeta?.format||''));
 if(!state.wasteMode&&/^YR[A-Z0-9_-]+$/i.test(q)){
  resetUnifiedScanSession();
  if(clearInput&&input)input.value='';
  if(!cloudConfigured())return alert('TM 尚未設定 Supabase，無法讀取 App 隨買退貨申請');
  try{
   const req=await findAppAnybuyReturnRequest(q);
   if(!req)return alert('找不到這筆隨買退貨申請');
   if(!appAnybuyReturnRequestStatusOpen(req))return alert(`此退貨申請狀態為「${req.status||'已處理'}」，不能再次辦理`);
   if(String(req.paidStoreCode||'')&&String(req.paidStoreCode)!==currentStoreCode())return alert(`此商品只能回原付款門市辦理退貨：${req.paidStoreName||req.paidStoreCode}`);
   if(appAnybuyReturnRequestExpired(req))return alert('此退貨申請已超過退貨期限');
   const mp=appAnybuyReturnRequestMemberProduct(req);
   if(!mp)return alert('找不到這筆會員商品資料，請先同步 App');
   if(Number(mp.remainingQuantity??0)!==Number(mp.originalQuantity??0))return alert('此商品已經兌換過，不能退貨');
   const sale=load(K.sales,[]).find(x=>String(x.id||'')===String(req.tmSaleId||''));
   if(!sale)return alert('找不到原 TM 交易，無法辦理退貨');
   const eligibility=appAnybuyPurchaseReturnEligibility(sale);
   if(!eligibility.allowed)return alert(eligibility.reason);
   window.__yjAppAnybuyReturnRequest=structuredClone(req);
   dlg('隨買跨店取退貨',`<div class="notice"><b>原門市退貨</b><br>退貨碼：${esc(q)}<br>商品：${esc(req.name||mp.name||'隨買商品')}<br>數量：${Number(req.quantity||mp.originalQuantity||0)}<br>原交易：${esc(req.tmSaleId||'—')}<br>原付款門市：${esc(req.paidStoreName||req.paidStoreCode||'—')}<br>退貨期限：${esc(req.returnDeadline||'—')}</div><button class="primary" id="anybuyReturnOpenCorrection">進入交易更正／部分退貨</button>`);
   setTimeout(()=>document.querySelector('#anybuyReturnOpenCorrection')?.addEventListener('click',()=>{
    genericDialog.close();openSaleInCorrectionMode(sale);
   }),0);
  }catch(err){alert('隨買退貨申請讀取失敗：'+(err?.message||err))}
  return;
 }
 if(!state.wasteMode&&/^YS[A-Z0-9_-]+$/i.test(q)){
  resetUnifiedScanSession();
  if(clearInput&&input)input.value='';
  if(!cloudConfigured())return alert('TM 尚未設定 Supabase，無法讀取 App 店舖結帳訂單');
  try{
   const order=await findAppAnybuyStorePaymentOrder(q);
   if(!order)return alert('找不到這筆 App 店舖結帳訂單，請確認付款條碼是否正確或已過期');
   await openAppAnybuyStorePaymentOrder(order);
  }catch(err){alert('App 店舖結帳讀取失敗：'+(err?.message||err))}
  return;
 }
 if(!state.wasteMode&&handleReturnCode(q)){resetUnifiedScanSession();if(clearInput&&input)input.value='';return}
 const byBarcode=products().find(x=>productBarcodes(x).includes(q)),byCode=products().find(x=>String(x.code||'')===q),p=byBarcode||byCode;
 if(p){resetUnifiedScanSession();try{state.wasteMode?addWasteCartProduct(p):add(p.id,isSelfCheckout()?(byBarcode?'self-barcode':'self-code'):(byBarcode?'barcode':'code'));if(clearInput&&input)input.value='';drawPOS();if(isSelfCheckout()&&!state.wasteMode&&(p.alcohol===true||p.tobacco===true||/菸|煙|酒/.test([p.category,p.group,p.name].filter(Boolean).join('｜')))){selfVerifiedSignature='';setTimeout(()=>openSelfStaffVerification(()=>render('pos')),30)}else if(!isSelfCheckout()&&!state.wasteMode){showTmAgeReminder(p)}}catch(err){alert(err.message)}return}
 if(state.wasteMode){alert('找不到商品');return}

 if(isQr){
  resetUnifiedScanSession();
  if(!scServiceConnected()){showScDisconnectedNotice('collection');if(clearInput&&input)input.value='';return}
  if(clearInput&&input)input.value='';
  openCollectionPayment(q,{qr:true,parts:[q]});return;
 }

 try{
  if(cloudConfigured()){
   const rows=await posSearchEcPickup(q),ec=ecExactBarcodeRow(rows,q);
   if(ec){resetUnifiedScanSession();if(clearInput&&input)input.value='';openEcBarcodePickup(ec);return}
  }
 }catch(_){}

 const matched=collectionProviderForCode(q);
 if(unifiedScanSession.parts.length===0){
  const mode=matched?.barcodeMode||(matched?.type==='EC'?'two':'three');
  if(mode==='single'||mode==='qr'){
   if(!scServiceConnected()){showScDisconnectedNotice('collection');if(clearInput&&input)input.value='';return}
   if(clearInput&&input)input.value='';openCollectionPayment(q,{provider:matched,parts:[q]});return;
  }
  unifiedScanSession={parts:[q],mode,provider:matched||null,startedAt:Date.now()};
  if(clearInput&&input)input.value='';
  showUnifiedScanProgress();return;
 }

 if(unifiedScanSession.parts.includes(q)){alert('這一段條碼已經刷過，請刷下一段');return}
 unifiedScanSession.parts.push(q);
 const parts=[...unifiedScanSession.parts];

 if(parts.length===2){
  const ec=await tryEcTwoPart(parts);
  if(ec){resetUnifiedScanSession();if(clearInput&&input)input.value='';openEcBarcodePickup(ec);return}
  if(unifiedScanSession.mode==='two'){
   if(!scServiceConnected()){resetUnifiedScanSession();showScDisconnectedNotice('collection');return}
   finalizeCollectionParts(parts,unifiedScanSession.provider);return;
  }
  showUnifiedScanProgress();return;
 }

 if(parts.length>=3){
  if(!scServiceConnected()){resetUnifiedScanSession();showScDisconnectedNotice('collection');return}
  finalizeCollectionParts(parts.slice(0,3),unifiedScanSession.provider);return;
 }
 showUnifiedScanProgress();
}
function submitPosSearch(){
 const input=document.querySelector('#search'),q=String(input?.value||'').trim();if(!q)return;
 processUnifiedPosCode(q);
}


function b3sReceiptWrap(ctx,text,maxWidth){
 const chars=Array.from(String(text||'')),lines=[];let line='';
 for(const ch of chars){const t=line+ch;if(ctx.measureText(t).width>maxWidth&&line){lines.push(line);line=ch}else line=t}
 if(line)lines.push(line);return lines.length?lines:[''];
}
function b3sMakeSaleReceiptBitmap(sale,width=384){
 const corrected=(sale.items||[]).some(x=>Number(x.returnedQty||0)>0)||sale.status==='已更正'||sale.locked;
 const items=(sale.items||[]).map(x=>{const returned=Number(x.returnedQty||0),remain=Math.max(0,Number(x.qty||0)-returned);return {...x,_remain:remain,_returned:returned}}).filter(x=>x._remain>0||x._returned>0);
 const history=sale.correctionHistory||[];
 const height=Math.max(700,430+items.length*100+history.length*44);
 const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.textBaseline='top';const pad=16,max=width-pad*2;let y=14;
 const setFont=(size=18,weight=500)=>{ctx.font=`${weight} ${size}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`};
 const text=(t,size=18,weight=500,align='left',gap=7)=>{setFont(size,weight);ctx.textAlign=align;ctx.fillText(String(t??''),align==='center'?width/2:align==='right'?width-pad:pad,y);y+=size+gap};
 const rule=(thick=2,space=10)=>{ctx.fillRect(pad,y,max,thick);y+=thick+space};
 const dotted=()=>{for(let x=pad;x<width-pad;x+=12)ctx.fillRect(x,y,7,2);y+=11};
 const wrapped=(t,size=18,weight=600,maxWidth=max)=>{setFont(size,weight);const lines=b3sReceiptWrap(ctx,String(t||''),maxWidth);for(const ln of lines){ctx.textAlign='left';ctx.fillText(ln,pad,y);y+=size+5}return lines.length};
 text('億家 TM',28,900,'center',6);
 text(corrected?'交易存根・已更正':'交易存根',21,800,'center',10);
 rule(3,12);
 text(`交易編號 ${sale.id}`,14,650);
 text(`時間 ${new Date(sale.at).toLocaleString('zh-TW')}`,14,500);
 text(`收銀員 ${sale.user||'—'}`,14,500);
 if(sale.memberName||sale.memberPhone){
  text(`會員 ${sale.memberName||''}${sale.memberPhone?` ${sale.memberPhone}`:''}`,14,500);
  text(`目前點數 ${Number(sale.memberPointsAfter??0)} 點`,14,500);
  text(`此次新增 +${Number(sale.memberAddedPoints??((sale.memberEarnedPoints||0)+(sale.memberBonusPoints||0)))} 點`,14,500);
  if(Number(sale.memberRedeemPoints||0)>0)text(`此次折抵 -${Number(sale.memberRedeemPoints||0)} 點`,14,500);
 }
 if(corrected)text(`狀態 ${sale.status||'已更正'}`,14,700);
 dotted();
 setFont(15,800);ctx.textAlign='left';ctx.fillText('商品',pad,y);ctx.textAlign='center';ctx.fillText('數量',width-112,y);ctx.textAlign='right';ctx.fillText('小計',width-pad,y);y+=23;rule(2,8);
 for(const x of items){
   wrapped(x.name,17,750,max-4);
   const qtyText=x._returned>0?`${x._remain} / 原${x.qty}`:`${x.qty}`;
   const subtotal=Number(x.price||0)*x._remain;
   setFont(14,500);ctx.textAlign='left';ctx.fillText(`${money(x.price)} ×`,pad,y);ctx.textAlign='center';ctx.fillText(qtyText,width-112,y);ctx.textAlign='right';ctx.fillText(money(subtotal),width-pad,y);y+=21;
   if(x._returned>0){setFont(12,500);ctx.textAlign='left';ctx.fillText(`已退 ${x._returned}`,pad,y);y+=18}
   y+=4;
 }
 dotted();
 const subtotal=Number(sale.subtotal??(sale.items||[]).reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||0),0));
 const manualDiscount=Number(sale.manualDiscount||0),promotionDiscount=Number(sale.promotionDiscount||0),discount=Number(sale.discount||manualDiscount+promotionDiscount||0);
 const currentTotal=Number(saleNet(sale));
 const amountRow=(label,value,bold=false,size=16)=>{setFont(size,bold?800:550);ctx.textAlign='left';ctx.fillText(label,pad,y);ctx.textAlign='right';ctx.fillText(money(value),width-pad,y);y+=size+7};
 amountRow('商品小計',subtotal,false,15);
 if(promotionDiscount>0)amountRow('活動優惠',-promotionDiscount,false,15);
 if(manualDiscount>0)amountRow('其他折扣',-manualDiscount,false,15);
 if(discount>0&&promotionDiscount===0&&manualDiscount===0)amountRow('折扣',-discount,false,15);
 rule(2,8);
 amountRow('應收金額',currentTotal,true,27);
 dotted();
 const payRows=(sale.paymentBreakdown||[]).length?sale.paymentBreakdown:[{method:sale.payment||'付款',amount:currentTotal}];
 for(const p of payRows)amountRow(`付款 ${p.method||''}`,Number(p.amount||0),false,15);
 if(Number(sale.memberRedeemAmount||0)>0)amountRow('點數折抵',-Number(sale.memberRedeemAmount||0),false,15);
 if(Number(sale.tendered||0)>0){amountRow('實收',Number(sale.tendered||0),false,15);if(Number(sale.change||0)>0)amountRow('找零',Number(sale.change||0),true,17)}
 if(sale.note){dotted();text('備註',14,800);wrapped(sale.note,14,500,max)}
 if(history.length){dotted();text('更正／退貨紀錄',15,800);for(const h of history){wrapped(`${new Date(h.at).toLocaleString('zh-TW')} ${h.type||''} ${h.reason||''}`,12,500,max)}}
 const code=String(sale.returnCode||makeReturnCode(sale.id)||'');
 if(code){
   dotted();text('退貨條碼',14,800,'center',5);
   try{
    const bits=code128Bits(code),quiet=8,avail=max-quiet*2,module=Math.max(1,Math.floor(avail/bits.length)),bw=bits.length*module,startX=Math.floor((width-bw)/2),bh=58;
    let i=0;while(i<bits.length){if(bits[i]==='1'){let j=i;while(j<bits.length&&bits[j]==='1')j++;ctx.fillRect(startX+i*module,y,(j-i)*module,bh);i=j}else i++}
    y+=64;text(code,13,650,'center',7);
   }catch(_e){text(code,13,650,'center',7)}
 }
 dotted();text('謝謝光臨',16,700,'center',2);text('億家 TM',12,500,'center',5);
 const used=Math.min(height,Math.max(180,y+12));const out=document.createElement('canvas');out.width=width;out.height=used;out.getContext('2d').drawImage(c,0,0,width,used,0,0,width,used);return b3sCanvasToBitmap(out);
}

function saleReceiptHtml(sale){
 const corrected=(sale.items||[]).some(x=>Number(x.returnedQty||0)>0)||sale.status==='已更正'||sale.locked;
 const items=(sale.items||[]).map(x=>{
  const returned=Number(x.returnedQty||0),remain=Math.max(0,Number(x.qty||0)-returned);
  return {...x,_remain:remain,_returned:returned}
 }).filter(x=>x._remain>0||x._returned>0);
 const subtotal=Number(sale.subtotal??(sale.items||[]).reduce((a,x)=>a+Number(x.price||0)*Number(x.qty||0),0));
 const manualDiscount=Number(sale.manualDiscount||0),promotionDiscount=Number(sale.promotionDiscount||0);
 const discount=Number(sale.discount||manualDiscount+promotionDiscount||0);
 const currentTotal=Number(saleNet(sale));
 const payRows=(sale.paymentBreakdown||[]).length?sale.paymentBreakdown:[{method:sale.payment||'付款',amount:currentTotal}];
 const history=sale.correctionHistory||[];
 return `<div class="receipt55">
   <div class="r-center"><h2>億家 TM</h2><b>${corrected?'交易存根・已更正':'交易存根'}</b></div>
   <hr>
   <div>交易編號：${esc(sale.id)}</div>
   <div>統一編號：${esc(sale.taxId||'—')}</div>
   <div>時間：${esc(new Date(sale.at).toLocaleString('zh-TW'))}</div>
   <div>收銀員：${esc(sale.user||'—')}</div>
   ${(sale.memberName||sale.memberPhone)?`<div>會員：${esc((sale.memberName||'')+(sale.memberPhone?' '+sale.memberPhone:''))}</div>
   <div>目前點數：${Number(sale.memberPointsAfter??0)} 點</div>
   <div>此次新增：+${Number(sale.memberAddedPoints??((sale.memberEarnedPoints||0)+(sale.memberBonusPoints||0)))} 點</div>
   ${Number(sale.memberRedeemPoints||0)>0?`<div>此次折抵：-${Number(sale.memberRedeemPoints||0)} 點</div>`:''}`:''}
   ${corrected?`<div>狀態：${esc(sale.status||'已更正')}</div>`:''}
   <hr>
   <table class="receipt-items"><thead><tr><th>商品</th><th>數量</th><th>小計</th></tr></thead><tbody>
   ${items.map(x=>{
      const qty=x._returned>0?`${x._remain} / 原${x.qty}`:`${x.qty}`;
      const sub=Number(x.price||0)*x._remain;
      return `<tr><td>${esc(x.name)}<small>${money(x.price)} ×${x._returned>0?`<br>已退 ${x._returned}`:''}</small></td><td>${esc(qty)}</td><td>${money(sub)}</td></tr>`
    }).join('')}
   </tbody></table>
   <hr>
   <div class="r-row"><span>商品小計</span><b>${money(subtotal)}</b></div>
   ${promotionDiscount>0?`<div class="r-row"><span>活動優惠</span><b>-${money(promotionDiscount)}</b></div>`:''}
   ${manualDiscount>0?`<div class="r-row"><span>其他折扣</span><b>-${money(manualDiscount)}</b></div>`:''}
   ${discount>0&&promotionDiscount===0&&manualDiscount===0?`<div class="r-row"><span>折扣</span><b>-${money(discount)}</b></div>`:''}
   <div class="r-total"><span>應收金額</span><strong>${money(currentTotal)}</strong></div>
   <hr>
   ${payRows.map(p=>`<div class="r-row"><span>付款 ${esc(p.method||'')}</span><b>${money(Number(p.amount||0))}</b></div>`).join('')}
   ${Number(sale.memberRedeemAmount||0)>0?`<div class="r-row"><span>點數折抵</span><b>-${money(Number(sale.memberRedeemAmount||0))}</b></div>`:''}
   ${Number(sale.tendered||0)>0?`<div class="r-row"><span>實收</span><b>${money(Number(sale.tendered||0))}</b></div>`:''}
   ${Number(sale.change||0)>0?`<div class="r-row"><span>找零</span><b>${money(Number(sale.change||0))}</b></div>`:''}
   ${sale.note?`<hr><div>備註：${esc(sale.note)}</div>`:''}
   ${history.length?`<hr><b>更正／退貨紀錄</b>${history.map(h=>`<div class="r-history">${esc(new Date(h.at).toLocaleString('zh-TW'))} ${esc(h.type||'')} ${esc(h.reason||'')}</div>`).join('')}`:''}
   <hr><div class="r-center">退貨代碼<br><b>${esc(String(sale.returnCode||makeReturnCode(sale.id)||''))}</b></div>
   <hr><div class="r-center">謝謝光臨<br><small>億家 TM</small></div>
 </div>`;
}

async function printSaleDetail(sale){
 if(isEcServiceSale(sale))throw Error('EC 包裹取貨不可列印或補印交易存根');
 const ok=printHTML('交易存根',saleReceiptHtml(sale),{receipt:true});
 if(!ok)throw Error('無法開啟列印頁，請允許彈出式視窗後再試一次');
 saveAudit('列印交易存根',sale.id);
 return true;
}

function b3sMakeSimpleSlipBitmap({title='',subtitle='',rows=[],footer='億家 TM'},width=384){
 const lineHeight=28;
 const height=Math.max(300,150+rows.length*lineHeight+80);
 const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.textBaseline='top';const pad=16,max=width-pad*2;let y=14;
 const font=(size=18,weight=500)=>{ctx.font=`${weight} ${size}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`};
 const draw=(t,size=18,weight=500,align='left',gap=6)=>{font(size,weight);ctx.textAlign=align;ctx.fillText(String(t??''),align==='center'?width/2:align==='right'?width-pad:pad,y);y+=size+gap};
 const wrap=(t,size=16,weight=500)=>{font(size,weight);for(const ln of b3sReceiptWrap(ctx,String(t??''),max)){ctx.textAlign='left';ctx.fillText(ln,pad,y);y+=size+5}};
 const rule=()=>{ctx.fillRect(pad,y,max,2);y+=12};
 draw('億家 TM',27,900,'center',5);draw(title,23,850,'center',8);if(subtitle)draw(subtitle,14,550,'center',10);rule();
 for(const row of rows){
  if(row.rule){rule();continue}
  if(row.center){draw(row.text||'',row.size||17,row.bold?800:550,'center',row.gap??6);continue}
  if(row.wrap){wrap(row.text||'',row.size||16,row.bold?750:500);continue}
  font(row.size||16,row.bold?800:550);ctx.textAlign='left';ctx.fillText(String(row.label||''),pad,y);ctx.textAlign='right';ctx.fillText(String(row.value??''),width-pad,y);y+=(row.size||16)+(row.gap??8);
 }
 rule();draw(footer,13,550,'center',5);
 const used=Math.min(height,Math.max(180,y+12));const out=document.createElement('canvas');out.width=width;out.height=used;out.getContext('2d').drawImage(c,0,0,width,used,0,0,width,used);return b3sCanvasToBitmap(out);
}
function handoverWindow(){
 const selfMode=isSelfCheckout();
 const shift=selfMode?null:currentOpenShift();
 const user=selfMode?SELF_ACCOUNT:(posShiftOpenerName()||currentUser()?.name||'');
 // 自助模式必須只計算「本次進入自助模式後」的交易，不可沿用上一班／前一次 99999 的交易。
 const start=selfMode
  ? (localStorage.getItem(SELF_HANDOVER_START_KEY)||new Date().toISOString())
  : (shift?.openedAt||localStorage.getItem('yj_pos_login_at_'+user)||new Date(new Date().setHours(0,0,0,0)).toISOString());
 return {shift,start,end:new Date().toISOString(),user};
}
function handoverPrintSummary(){
 const w=handoverWindow(),startMs=new Date(w.start).getTime(),endMs=new Date(w.end).getTime();
 const shiftSales=load(K.sales,[]).filter(s=>{const t=new Date(s.at).getTime();return String(s.storeCode||'001')===currentStoreCode()&&t>=startMs&&t<=endMs&&!isEcServiceSale(s)});
 const voidSales=shiftSales.filter(s=>s.status==='已作廢');
 const sales=shiftSales.filter(s=>s.status!=='已作廢'&&s.status!=='已整筆退貨'&&!s.excludeFromRevenue);
 const deposits=load(K.deposits,[]).filter(d=>{const t=new Date(d.at).getTime();return String(d.storeCode||'001')===currentStoreCode()&&t>=startMs&&t<=endMs});
 const depositAmount=deposits.reduce((a,d)=>a+Number(d.amount||0),0);
 const cashRevenue=sales.reduce((a,s)=>a+Number(s.netCashAmount??s.cashAmount??(s.payment==='現金'?saleNet(s):0))+Number(s.serviceCashAmount||0),0);
 const discountAmount=sales.reduce((a,s)=>a+Number(s.discountTotal??s.discount??(Number(s.manualDiscount||0)+Number(s.promotionDiscount||0)+Number(s.memberRedeemAmount||0))),0);
 const salesAmount=sales.reduce((a,s)=>a+Number(typeof saleNet==='function'?saleNet(s):s.total||0),0);
 const cashDifference=depositAmount-cashRevenue;
 return {...w,sales,voidSales,voidCount:voidSales.length,deposits,depositAmount,cashRevenue,discountAmount,salesAmount,totalAmount:depositAmount,cashDifference};
}
function formatCashDifference(value){
 const n=Number(value||0);
 if(n>0)return `+${money(n)}`;
 if(n<0)return `-${money(Math.abs(n))}`;
 return '$0';
}
async function printDepositSlip(deposit){
 const body=`<div class="receipt55">
   <div class="r-center"><h2>億家 TM</h2><b>投庫單</b></div><hr>
   <div class="r-row"><span>投庫單號</span><b>${esc(deposit.depositNo||deposit.id)}</b></div>
   <div class="r-row"><span>時間</span><b>${esc(new Date(deposit.at).toLocaleString('zh-TW'))}</b></div>
   <div class="r-row"><span>操作員</span><b>${esc(deposit.user||'—')}</b></div>
   <hr><div class="r-total"><span>投庫金額</span><strong>${money(deposit.amount)}</strong></div>
   <hr><div class="r-center">請妥善保存本單<br><small>億家 TM</small></div>
 </div>`;
 const ok=printHTML('投庫單',body,{receipt:true});
 if(!ok)throw Error('無法開啟列印頁，請允許彈出式視窗後再試一次');
 saveAudit('列印投庫單',`${deposit.depositNo||deposit.id}｜${money(deposit.amount)}`);
 return true;
}
function b3sMakeHandoverReceiptBitmap(sum,width=384){
 const storeNo=String(load('yj_store_no','001')||'001');
 const storeName=String(load('yj_store_name','億家門市')||'億家門市');
 const start=new Date(sum.start),end=new Date(sum.end);
 const deposits=Array.isArray(sum.deposits)?sum.deposits:[];
 const extraH=Math.min(deposits.length,12)*26;
 const height=Math.max(650,610+extraH);
 const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.textBaseline='top';
 const pad=16,max=width-pad*2;let y=12;
 const font=(size=16,weight=500)=>{ctx.font=`${weight} ${size}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`};
 const text=(t,size=16,weight=500,align='left',x=null)=>{font(size,weight);ctx.textAlign=align;ctx.fillText(String(t??''),x??(align==='center'?width/2:align==='right'?width-pad:pad),y)};
 const line=(gap=10)=>{ctx.fillRect(pad,y,max,2);y+=gap};
 const dashed=(gap=10)=>{ctx.save();ctx.setLineDash([7,5]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();ctx.restore();y+=gap};
 const row=(label,value,size=15,bold=false)=>{font(size,bold?800:500);ctx.textAlign='left';ctx.fillText(label,pad,y);ctx.textAlign='right';ctx.fillText(value,width-pad,y);y+=size+7};
 const dt=d=>d.toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
 text('億家',44,900,'center');y+=50;
 text('收銀員交接班明細表',20,700,'center');y+=30;
 row('開始',dt(start),14,false);row('結束',dt(end),14,false);
 row('店號',storeNo,14,false);row('店名',storeName,14,false);
 row('收銀員',String(sum.user||'—'),14,false);
 if(sum.shift?.type)row('班別',String(sum.shift.type),14,false);
 y+=2;line(12);
 text('投庫明細',18,800,'left');y+=26;
 if(deposits.length){
  deposits.slice(0,12).forEach((d,i)=>{
   const tm=new Date(d.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
   row(`＋ 第${String(i+1).padStart(2,'0')}筆 ${tm}`,money(d.amount),15,false);
  });
  if(deposits.length>12){row(`＋ 其餘 ${deposits.length-12} 筆`,'已合併計入',13,false)}
 }else row('＋ 本班無投庫','$0',15,false);
 y+=2;dashed(12);
 row('投庫筆數',`${deposits.length} 次`,16,false);
 row('折扣金額',money(sum.discountAmount),17,true);
 row('現金短溢收',formatCashDifference(sum.cashDifference),19,true);
 row('交易筆數',`${sum.sales.length} 筆`,16,false);
 row('交易作廢張數',`${Number(sum.voidCount||0)} 張`,16,false);
 y+=2;line(12);
 row('投庫小計',money(sum.depositAmount),23,true);
 y+=8;
 font(15,700);ctx.textAlign='left';ctx.fillText('交班人簽章',pad,y);
 const boxX=width-150,boxY=y-2,boxW=134,boxH=92;ctx.lineWidth=2;ctx.strokeRect(boxX,boxY,boxW,boxH);
 y+=boxH+12;dashed(10);
 text('億家 TM',13,550,'center');y+=20;
 const used=Math.min(height,Math.max(260,y+10));const out=document.createElement('canvas');out.width=width;out.height=used;out.getContext('2d').drawImage(c,0,0,width,used,0,0,width,used);return b3sCanvasToBitmap(out);
}
async function printHandoverSlip(sum){
 const storeNo=String(load('yj_store_no','001')||'001');
 const storeName=String(load('yj_store_name','億家門市')||'億家門市');
 const deposits=Array.isArray(sum.deposits)?sum.deposits:[];
 const body=`<div class="receipt55">
   <div class="r-center"><h1 style="margin:0">億家</h1><b>收銀員交接班明細表</b></div><hr>
   <div class="r-row"><span>開始</span><b>${esc(new Date(sum.start).toLocaleString('zh-TW'))}</b></div>
   <div class="r-row"><span>結束</span><b>${esc(new Date(sum.end).toLocaleString('zh-TW'))}</b></div>
   <div class="r-row"><span>店號</span><b>${esc(storeNo)}</b></div>
   <div class="r-row"><span>店名</span><b>${esc(storeName)}</b></div>
   <div class="r-row"><span>收銀員</span><b>${esc(sum.user||'—')}</b></div>
   ${sum.shift?.type?`<div class="r-row"><span>班別</span><b>${esc(sum.shift.type)}</b></div>`:''}
   <hr><b>投庫明細</b>
   ${deposits.length?deposits.map((d,i)=>`<div class="r-row"><span>＋ 第${String(i+1).padStart(2,'0')}筆 ${esc(new Date(d.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}))}</span><b>${money(d.amount)}</b></div>`).join(''):`<div class="r-row"><span>＋ 本班無投庫</span><b>$0</b></div>`}
   <hr>
   <div class="r-row"><span>投庫筆數</span><b>${deposits.length} 次</b></div>
   <div class="r-row"><span>折扣金額</span><b>${money(sum.discountAmount)}</b></div>
   <div class="r-row"><span>現金短溢收</span><b>${formatCashDifference(sum.cashDifference)}</b></div>
   <div class="r-row"><span>交易筆數</span><b>${sum.sales.length} 筆</b></div>
   <div class="r-row"><span>交易作廢張數</span><b>${Number(sum.voidCount||0)} 張</b></div>
   <div class="r-total"><span>投庫小計</span><strong>${money(sum.depositAmount)}</strong></div>
   <hr><div class="signature-box">交班人簽章</div>
   <div class="r-center"><small>億家 TM</small></div>
 </div>`;
 const ok=printHTML('收銀員交接班明細表',body,{receipt:true});
 if(!ok)throw Error('無法開啟列印頁，請允許彈出式視窗後再試一次');
 saveAudit('列印交班單',`${sum.user}｜投庫小計${money(sum.depositAmount)}｜投庫${deposits.length}次｜作廢${Number(sum.voidCount||0)}張｜折扣${money(sum.discountAmount)}｜短溢收${formatCashDifference(sum.cashDifference)}`);
 return true;
}

function openHeldTransactionsDialog(){
 const rows=load(K.held,[]);
 if(!rows.length)return alert('目前沒有暫停交易');
 dlg('恢復交易',`<div class="held-list">${rows.map((x,i)=>`<button class="held-card" data-held-id="${x.id}"><strong>${esc(x.name||`暫停交易 ${i+1}`)}</strong><span>${new Date(x.at).toLocaleString('zh-TW')}</span><span>${x.items.length} 項商品｜${money(x.items.reduce((s,a)=>s+Number(a.price||0)*Number(a.qty||0),0)-Number(x.discount||0))}</span></button>`).join('')}</div>`);
 setTimeout(()=>document.querySelectorAll('[data-held-id]').forEach(b=>b.onclick=()=>{
  const all=load(K.held,[]),x=all.find(v=>v.id===b.dataset.heldId);if(!x)return;
  state.cart=structuredClone(x.items||[]);state.discount=Number(x.discount||0);state.payment=x.payment||'現金';state.note=x.note||'';
  save(K.held,all.filter(v=>v.id!==x.id));genericDialog.close();drawPOS();saveAudit('取回掛單',x.id);
 }),0);
}

function openCheckoutDialog(){
 const t=totals(),total=t.total,goodsTotal=Number(t.merchandiseTotal||0),ecAmount=Number(t.serviceAmount||0),serviceMethod=currentServicePaymentMethod()||'現金';
 if(!state.cart.length)return alert('購物車是空的');
 const ecOnly=goodsTotal<=0&&ecAmount>0;
 const collectionOnly=ecOnly&&(state.cart||[]).some(x=>x.collectionPayment||x.billPayment||x.utilityPayment);
 if(ecOnly){state.payment=serviceMethod==='信用卡'?'信用卡':serviceMethod==='億家Pay'?'行動支付':'現金';state.memberRedeemPoints=0;state.memberRedeemAmount=0;}
 const selected=ecOnly?state.payment:(state.payment||'現金');
 const mobileOptions=['億家 Pay','LINE Pay','Apple Pay','Google Pay','Samsung Wallet','全盈+PAY','街口支付','悠遊付','其他'];
 const storedOptions=['悠遊卡','一卡通','icash 2.0','其他'];
 const giftOptions=['億家禮物卡','電子禮物卡','其他'];
 dlg('TM 結帳',`
  <div class="checkout-amount"><small>本筆應收</small><strong>${money(total)}</strong></div>
  ${ecAmount>0?`<div class="notice ec-cash-split-notice"><b>${collectionOnly?'代收帳單付款':'EC 代收'}</b><br>商品應收：${money(goodsTotal)}<br>服務性應收：<b>${money(ecAmount)}</b><br>服務支付：<b>${esc(serviceMethod)}</b></div>`:''}
  <label>商品付款方式<select id="checkoutMethod" ${ecOnly?'disabled':''}>${(ecOnly?[selected]:['現金','信用卡','行動支付','電子票證','禮物卡','混合付款']).map(x=>`<option ${selected===x?'selected':''}>${x}</option>`).join('')}</select></label>
  <div id="checkoutPaymentFields"></div>
  ${ecOnly?'':`<label class="print-choice"><input id="printCurrentDetail" type="checkbox"><span><b>列印本筆商品交易存根</b><small>EC 包裹不會出現在商品交易存根。</small></span></label>`}
  <button class="primary checkout-confirm" id="checkoutConfirm">確認付款並完成交易</button>`);
 setTimeout(()=>{
  const method=document.querySelector('#checkoutMethod'),fields=document.querySelector('#checkoutPaymentFields'),confirmBtn=document.querySelector('#checkoutConfirm');
  const ecCashField=()=>ecAmount>0?`<div class="ec-cash-required"><label>EC 收現金<input id="ecCashTendered" type="number" min="${ecAmount}" inputmode="decimal" placeholder="至少 ${ecAmount}"></label><div class="checkout-change"><span>EC 找零</span><strong id="ecCashChange">${money(0)}</strong></div></div>`:'';
  const bindEcCash=()=>{const input=document.querySelector('#ecCashTendered'),out=document.querySelector('#ecCashChange');if(!input||!out)return;input.oninput=()=>out.textContent=money(Math.max(0,Number(input.value||0)-ecAmount));if(ecOnly){input.value=ecAmount;input.oninput()}};
  const renderFields=()=>{
   const m=ecOnly?selected:method.value;state.payment=m;
   if(collectionOnly&&serviceMethod==='信用卡'){fields.innerHTML=`<div class="payment-note"><b>信用卡代收</b><br>請完成信用卡付款 ${money(ecAmount)}。</div>`;}
   else if(collectionOnly&&serviceMethod==='億家Pay'){fields.innerHTML=`<div class="payment-note"><b>億家Pay 代收</b><br>請完成億家Pay付款 ${money(ecAmount)}。</div>`;}
   else if(m==='現金'){
    fields.innerHTML=`<label>${ecAmount>0?'商品＋EC 客人付':'客人付'}<input id="cashTendered" type="number" min="0" inputmode="decimal" placeholder="輸入實收金額"></label><div class="quick-cash"><button type="button" data-cash-exact>收到剛好</button>${[100,500,1000,2000,3000,5000,10000].map(v=>`<button type="button" data-cash-quick="${v}">${v.toLocaleString('zh-TW')}</button>`).join('')}</div><div class="checkout-change"><span>找零</span><strong id="cashChange">${money(0)}</strong></div><div id="cashShortage" class="cash-shortage"></div>`;
    const input=document.querySelector('#cashTendered'),change=document.querySelector('#cashChange'),shortage=document.querySelector('#cashShortage');
    const calc=()=>{const paid=Number(input.value||0),diff=paid-total;change.textContent=money(Math.max(0,diff));shortage.textContent=paid>0&&diff<0?`尚差 ${money(Math.abs(diff))}`:'';};
    input.oninput=calc;fields.querySelector('[data-cash-exact]').onclick=()=>{input.value=total;calc()};fields.querySelectorAll('[data-cash-quick]').forEach(b=>b.onclick=()=>{input.value=b.dataset.cashQuick;calc()});setTimeout(()=>input.focus(),0);
   }else if(m==='行動支付'){fields.innerHTML=`<label>行動支付<select id="paymentSubtype">${mobileOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><p class="payment-note">非現金只支付商品 ${money(goodsTotal)}。</p>${ecCashField()}`;bindEcCash()}
   else if(m==='電子票證'){fields.innerHTML=`<label>電子票證<select id="paymentSubtype">${storedOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><p class="payment-note">非現金只支付商品 ${money(goodsTotal)}。</p>${ecCashField()}`;bindEcCash()}
   else if(m==='禮物卡'){fields.innerHTML=`<label>禮物卡<select id="paymentSubtype">${giftOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><p class="payment-note">禮物卡只支付商品 ${money(goodsTotal)}。</p>${ecCashField()}`;bindEcCash()}
   else if(m==='混合付款'){
    fields.innerHTML=`<label>商品現金金額<input id="mixedCash" type="number" min="0" max="${goodsTotal}" value="0" inputmode="decimal"></label><label>商品其餘付款方式<select id="mixedMethod"><option>信用卡</option><option>行動支付</option><option>電子票證</option><option>禮物卡</option></select></label><div class="checkout-change"><span>商品其餘應付</span><strong id="mixedRemain">${money(goodsTotal)}</strong></div><div id="mixedWarning" class="cash-shortage"></div>${ecCashField()}`;
    const cash=document.querySelector('#mixedCash'),remain=document.querySelector('#mixedRemain'),warn=document.querySelector('#mixedWarning');cash.oninput=()=>{const v=Number(cash.value||0);remain.textContent=money(Math.max(0,goodsTotal-v));warn.textContent=v>goodsTotal?'商品現金金額不可超過商品應收':''};bindEcCash();
   }else{fields.innerHTML=`<p class="payment-note">請完成商品 ${money(goodsTotal)} 的非現金付款。</p>${ecCashField()}`;bindEcCash()}
  };
  method.onchange=renderFields;renderFields();
  confirmBtn.onclick=async()=>{
   if(ecAmount>0&&!scServiceConnected()){showScDisconnectedNotice();return}
   const m=ecOnly?selected:method.value;
   let detail={method:m,cashAmount:0,nonCashAmount:0,serviceCashAmount:(serviceMethod==='現金'?ecAmount:0),serviceNonCashAmount:(serviceMethod==='現金'?0:ecAmount),tendered:0,change:0,subtype:'',breakdown:[],note:state.note||''};
   if(collectionOnly&&serviceMethod==='信用卡'){detail.subtype='信用卡';detail.autoDetectCard=true;detail.breakdown=[{method:'信用卡',amount:ecAmount}];}
   else if(collectionOnly&&serviceMethod==='億家Pay'){detail.subtype='億家Pay';detail.breakdown=[{method:'億家Pay',amount:ecAmount}];}
   else if(m==='現金'){
    const tendered=Number(document.querySelector('#cashTendered').value||0);if(tendered<total)return alert(`金額不足，尚差 ${money(total-tendered)}`);
    detail={...detail,cashAmount:goodsTotal,tendered,change:tendered-total,breakdown:goodsTotal>0?[{method:'現金',amount:goodsTotal}]:[]};
   }else{
    if(ecAmount>0){const ecTendered=Number(document.querySelector('#ecCashTendered')?.value||0);if(ecTendered<ecAmount)return alert(`EC 代收必須付現金 ${money(ecAmount)}，尚差 ${money(ecAmount-ecTendered)}`);detail.tendered=ecTendered;detail.change=ecTendered-ecAmount}
    if(m==='混合付款'){const cash=Number(document.querySelector('#mixedCash').value||0);if(cash<0||cash>goodsTotal)return alert('商品現金金額不可超過商品應收金額');const other=goodsTotal-cash,otherMethod=document.querySelector('#mixedMethod').value;detail={...detail,cashAmount:cash,nonCashAmount:other,subtype:otherMethod,breakdown:[...(cash>0?[{method:'現金',amount:cash}]:[]),...(other>0?[{method:otherMethod,amount:other}]:[])]}}
    else{detail.nonCashAmount=goodsTotal;detail.subtype=document.querySelector('#paymentSubtype')?.value||m;detail.breakdown=goodsTotal>0?[{method:detail.subtype,amount:goodsTotal}]:[]}
   }
   const needsPaymentConnection=Number(detail.nonCashAmount||0)>0||Number(detail.serviceNonCashAmount||0)>0;
   await refreshCustomerDisplaySettingsCloud().catch(()=>{});
   setCustomerVoiceCue('交易中','payment-processing');
   if(needsPaymentConnection){state.paymentConnecting=true;state.paymentConnectingMethod=detail.subtype||m;}
   await forceCustomerDisplaySync().catch(()=>{});
   if(needsPaymentConnection){
    const waitMs=paymentProcessingWaitMs(detail,m);
    confirmBtn.disabled=true;confirmBtn.textContent='交易處理中，請稍候…';
    await new Promise(r=>setTimeout(r,waitMs));
   }
   try{
    const shouldPrint=!ecOnly&&!!document.querySelector('#printCurrentDetail')?.checked;await refreshMemberSystemCloud({redraw:false}).catch(()=>{});
    const appAnybuyPending=window.__yjAppAnybuyPendingPayment?structuredClone(window.__yjAppAnybuyPendingPayment):null;
    const redeemPoints=Number(state.memberRedeemPoints||0),redeemAmount=Number(state.memberRedeemAmount||0);const sale=checkout(detail);applyMemberBenefitsAfterSale(sale,redeemPoints,redeemAmount);state.memberRedeemPoints=0;state.memberRedeemAmount=0;
    const ecItems=(sale.ecItems||[]).filter(x=>x.ecPickup&&x.ecPackageNo);let ecSyncError='';for(const item of ecItems){try{await posPickupEcPackage(item.ecPackageNo,currentUser()?.name||'')}catch(e){ecSyncError=e.message||String(e);break}}
    let appAnybuySyncOk=true;
    if(appAnybuyPending?.orderSnapshot){
     appAnybuySyncOk=await finalizeAppAnybuyStorePayment(appAnybuyPending.orderSnapshot,sale);
     window.__yjAppAnybuyPendingPayment=null;
    }
    genericDialog.close();
    state.paymentConnecting=false;state.paymentConnectingMethod='';state.lastCompletedSale=sale;
    if(paymentNeedsTakeCard(detail))setCustomerVoiceCue('請取卡','take-card');
    posSubtotalSignature='';posSubtotalReady=false;posGameSession=null;clearPosGameCompleted();stopPosGameTimers();
    render('pos');
    scheduleCustomerDisplaySync(0);
    if(shouldPrint&&sale.items?.length)await printSaleDetail(sale);
    if(ecSyncError)alert(`付款完成，但 EC 取貨狀態同步失敗：${ecSyncError}`);
    if(appAnybuyPending?.orderSnapshot&&!appAnybuySyncOk)alert('收款已完成，但 App 訂單／我的商品同步暫時失敗；TM 已加入重試佇列，連線恢復後會再次同步。');
    else if(appAnybuyPending?.orderSnapshot)alert('App 店舖結帳完成，商品已加入會員「我的商品」。');
   }catch(err){if(needsPaymentConnection){state.paymentConnecting=false;state.paymentConnectingMethod='';await forceCustomerDisplaySync().catch(()=>{});confirmBtn.disabled=false;confirmBtn.textContent='確認付款並完成交易'}alert(err.message)}
  };
 },0);
}

function ecActionDialog(action=null,frontMode=false){
 if(!scServiceConnected()){showScDisconnectedNotice('ecFlow');return}
 const fixed=action;
 const labels={arrival:'進貨',pickup:'取件',leave:'離店'};
 dlg(fixed?`EC${labels[fixed]}`:'EC收發作業',`
  ${fixed?'':`<label>作業類型<select id="ecActionType"><option value="arrival">進貨</option><option value="pickup">取件</option><option value="leave">離店</option></select></label>`}
  <label>包裹編號<input id="ecActionNo" placeholder="輸入或掃描包裹編號"></label>
  <div id="ecLeaveReasonWrap" style="display:${fixed==='leave'?'block':'none'}"><label>離店原因<select id="ecLeaveReason"><option>退回物流</option><option>轉運</option><option>逾期未取</option><option>其他</option></select></label></div>
  <button class="primary" id="ecActionSave">確認</button>`);
 setTimeout(()=>{
  const typeSel=document.querySelector('#ecActionType'),wrap=document.querySelector('#ecLeaveReasonWrap');
  if(typeSel)typeSel.onchange=()=>wrap.style.display=typeSel.value==='leave'?'block':'none';
  document.querySelector('#ecActionSave').onclick=()=>{
   const no=document.querySelector('#ecActionNo').value.trim(),kind=fixed||(typeSel?.value||'arrival');
   if(!no)return alert('請輸入包裹編號');
   try{
    if(kind==='arrival')updateECStatus(no,'待取件');
    if(kind==='pickup')updateECStatus(no,'已取件');
    if(kind==='leave')updateECStatus(no,'已離店',{leaveReason:document.querySelector('#ecLeaveReason')?.value||''});
    genericDialog.close();
    if(frontMode){alert(`EC${labels[kind]}完成`);render('front')}else render('ec');
   }catch(err){alert(err.message)}
  };
 },0);
}


function correctionModeBanner(){

 if(state.exchangeMode){
  const a=exchangeAmounts(),d=Number(a.difference||0);
  const diff=d>0?`需補款 ${money(d)}`:d<0?`應退款 ${money(Math.abs(d))}`:'差額 $0';
  return `<div class="correction-mode-banner exchange-mode-banner"><strong>🔄 換貨模式｜原交易 ${esc(state.exchangeMode.saleId)}</strong><span>減少／移除要退回的原商品，再加入新商品。</span><b>${diff}</b><button class="button" data-action="cancel-exchange">取消換貨</button><button class="primary" data-action="confirm-exchange">換貨結算</button></div>`;
 }
 const mode=state.correctionMode;
 if(!mode)return '';
 return `<div class="pos-correction-banner">
  <strong>🔴 交易更正模式</strong>
  <span>原交易序號：${esc(mode.saleId)}</span>
  <span>退貨條碼：${esc(mode.returnCode)}</span>
  <button class="button" data-action="cancel-correction-mode">取消更正</button>
 </div>`;
}

function correctionCartHtml(){
 const mode=state.correctionMode;
 if(!mode)return '';
 return `<div class="correction-cart-panel">
  ${mode.selections.map((x,i)=>`
   <div class="correction-pos-row ${Number(x.returnQty||0)>0?'active':''}">
    <div>
     <strong>${esc(x.name)}</strong>
     <small>原數量 ×${x.originalQty}　已退 ×${x.alreadyReturned}　可退 ×${x.availableQty}</small>
    </div>
    <label>本次退貨
     <input type="number" min="0" max="${x.availableQty}" value="${x.returnQty||0}" data-pos-correction-qty="${i}">
    </label>
   </div>`).join('')}
  <label>更正原因
   <select id="posCorrectionReason">
    <option>客人不要</option>
    <option>商品瑕疵</option>
    <option>掃描錯誤</option>
    <option>重複刷到</option>
    <option>收銀錯誤</option>
    <option>其他</option>
   </select>
  </label>
  <label>備註<textarea id="posCorrectionNote" rows="2"></textarea></label>
  <button class="primary" data-action="confirm-pos-correction">確認交易更正</button>
 </div>`;
}


function correctionRefundPlan(){
 const mode=state.correctionMode;
 if(!mode)return null;
 const sale=load(K.sales,[]).find(x=>String(x.id||'')===String(mode.saleId||''));
 if(!sale)throw new Error('找不到原交易');
 const yrReq=window.__yjAppAnybuyReturnRequest||null;
 let adjustments=(mode.selections||[]).map(sel=>{
  const current=state.cart.find(c=>String(c.lineId||'')===String(sel.lineId||''));
  const kept=current?Number(current.qty||0):0;
  if(kept>Number(sel.availableQty||0))throw new Error(`${sel.name} 數量不可高於原交易數量`);
  return {lineId:sel.lineId,productId:sel.productId,name:sel.name,returnQty:Math.max(0,Number(sel.availableQty||0)-kept)};
 }).filter(x=>x.returnQty>0);
 // YR 是 App 已成立的整筆未兌換退貨申請；若店員尚未手動減量，直接帶入可退的隨買代銷項目。
 if(!adjustments.length&&yrReq){
  adjustments=(mode.selections||[]).map(sel=>{
   const line=(sale.items||[]).find(x=>String(x.lineId||'')===String(sel.lineId||''));
   const eligible=appAnybuyLineReturnEligibility(sale,line);
   return eligible.allowed&&line&&(line.appAnybuyPayment===true||line.appAnybuyDeposit===true)
    ?{lineId:sel.lineId,productId:sel.productId,name:sel.name,returnQty:Number(sel.availableQty||0)}:null;
  }).filter(Boolean).filter(x=>x.returnQty>0);
 }
 if(!adjustments.length)throw new Error('商品數量尚未變更；請先減少或移除要退貨的商品');
 const ratio=Number(sale.subtotal||0)>0?Number(sale.total||0)/Number(sale.subtotal||1):1;
 let refund=0;
 for(const a of adjustments){
  const line=(sale.items||[]).find(x=>String(x.lineId||'')===String(a.lineId||''));
  if(!line)continue;
  const isAnybuy=!!(line.appAnybuyPayment||line.appAnybuyDeposit||line.appAnybuyRedeem||line.consignmentSale);
  refund+=isAnybuy?Number(line.price||0)*Number(a.returnQty||0):Number(line.price||0)*Number(a.returnQty||0)*ratio;
 }
 refund=Math.max(0,Math.min(Number(sale.netTotal??sale.total??0),Math.round(refund*100)/100));
 const payment=[sale.payment,sale.paymentSubtype].filter(Boolean).join('｜')||'原付款方式';
 return {sale,adjustments,refund,payment,yrReq};
}

function openCorrectionRefundDialog(){
 if(!state.correctionMode||state.exchangeMode)return false;
 let plan;try{plan=correctionRefundPlan()}catch(err){alert(err.message);return true}
 const rows=plan.adjustments.map(a=>`<div class="tx-receipt-line"><span>${esc(a.name||'商品')} × ${Number(a.returnQty||0)}</span><b>退貨</b></div>`).join('');
 dlg('TM 退款確認',`
  <div class="checkout-amount"><small>本筆應退</small><strong>${money(plan.refund)}</strong></div>
  <div class="notice"><b>交易更正／退貨</b><br>原交易：${esc(plan.sale.id)}<br>退款方式：<b>${esc(plan.payment)}</b><br>${plan.yrReq?`YR 退貨碼：${esc(plan.yrReq.returnCode||'')}`:''}</div>
  <div class="tx-receipt-history">${rows}</div>
  <label>更正原因<select id="refundCorrectionReason"><option>客人不要</option><option>商品瑕疵</option><option>掃描錯誤</option><option>重複刷到</option><option selected>收銀錯誤</option><option>其他</option></select></label>
  <label>備註<input id="refundCorrectionNote" placeholder="選填"></label>
  <div class="notice">此畫面為退款，不會再次向客人收款。</div>
  <button class="primary checkout-confirm" id="correctionRefundConfirm">確認退款 ${money(plan.refund)}</button>`);
 setTimeout(()=>{
  const btn=document.querySelector('#correctionRefundConfirm');if(!btn)return;
  btn.onclick=async()=>{
   if(btn.disabled)return;btn.disabled=true;btn.textContent='退款處理中…';
   try{
    const reason=document.querySelector('#refundCorrectionReason')?.value||'交易更正';
    const note=document.querySelector('#refundCorrectionNote')?.value?.trim()||'';
    correctSale(plan.sale.id,plan.adjustments,reason,note);
    reconcileMemberPointsAfterReturn(plan.sale.id);
    await syncAppAnybuyReturnAfterSaleChange(plan.sale.id);
    if(window.__yjAppAnybuyReturnRequest){
     await completeAppAnybuyReturnRequest(window.__yjAppAnybuyReturnRequest,plan.sale.id);
     window.__yjAppAnybuyReturnRequest=null;
    }
    genericDialog.close();
    alert(`退款完成｜應退 ${money(plan.refund)}｜${plan.payment}`);
    endCorrectionMode();
    render('transactions-front');
   }catch(err){btn.disabled=false;btn.textContent=`確認退款 ${money(plan.refund)}`;alert(err?.message||err)}
  };
 },0);
 return true;
}

function openSaleInCorrectionMode(sale){
 try{
  beginCorrectionMode(sale);
  if(state.correctionMode&&saleHasAnybuy(sale)){
   for(const sel of state.correctionMode.selections||[]){
    const line=(sale.items||[]).find(x=>String(x.lineId||'')===String(sel.lineId||''));
    const eligibility=appAnybuyLineReturnEligibility(sale,line);
    if(!eligibility.allowed){
     sel.availableQty=0;sel.returnDisabled=true;sel.returnDisabledReason=eligibility.reason;
     state.cart=state.cart.filter(x=>String(x.lineId||'')!==String(sel.lineId||''));
    }
   }
  }
  if(!state.cart.length){
   endCorrectionMode();
   throw new Error('原交易沒有可更正的商品明細');
  }
  render('pos');
 }catch(err){alert(err.message)}
}

function handleReturnCode(code){
 const sale=findSaleByReturnCode(code);
 if(!sale)return false;
 openSaleInCorrectionMode(sale);
 return true;
}


function ensureTimeControlBarcode(row){
 if(!row)return row;
 if(!row.timeBarcode)row.timeBarcode=systemBarcode('YJT');
 return row;
}
function ensureEcBarcode(row){
 if(!row)return row;
 if(!row.packageNo)row.packageNo=systemBarcode('YJE');
 return row;
}
function autoBarcodeHtml(code,opts={}){
 if(!code)return '';
 try{return code128Svg(code,opts)}catch{return `<div class="barcode-fallback">${esc(code)}</div>`}
}


const CASH_DENOMS=[1000,500,100,50,10,5,1];

function shiftRows(){return load(K.shifts,[])}
function xAccountRows(){return load(K.xAccounts,[])}

function currentOpenShift(){
 return shiftRows().find(x=>x.status==='開班中'&&String(x.storeCode||'001')===currentStoreCode())||null;
}

function nextXNo(dateStr=new Date().toISOString().slice(0,10)){
 const compact=dateStr.replaceAll('-','');
 const same=xAccountRows().filter(x=>x.date===dateStr);
 return `X${compact}-${String(same.length+1).padStart(4,'0')}`;
}

function startShift(){
 if(currentOpenShift())return alert('目前已有開班中的班次，請先完成交班');
 const now=new Date();
 dlg('開班',`
  <label>班別<select id="shiftType"><option>早班</option><option>晚班</option><option>大夜班</option><option>其他</option></select></label>
  <label>收銀人員<input id="shiftCashier" value="${esc(currentUser()?.name||'')}" readonly></label>
  
  <label>備註<textarea id="shiftOpenNote" rows="2"></textarea></label>
  <button class="primary" id="shiftOpenSave">確認開班</button>`);
 setTimeout(()=>shiftOpenSave.onclick=()=>{
  const rows=shiftRows();
  const shift={
   id:'S'+Date.now(),
   storeCode:currentStoreCode(),
   type:shiftType.value,
   cashier:shiftCashier.value,
      openNote:shiftOpenNote.value.trim(),
   openedAt:new Date().toISOString(),
   status:'開班中'
  };
  rows.unshift(shift);save(K.shifts,rows);
  saveAudit('開班',`${shift.type}｜${shift.cashier}`);
  genericDialog.close();render('xaccount');
 },0);
}

function shiftSales(shift){
 const start=new Date(shift.openedAt).getTime();
 const end=shift.closedAt?new Date(shift.closedAt).getTime():Date.now();
 return load(K.sales,[]).filter(s=>{
  const t=new Date(s.at).getTime();
  return String(s.storeCode||'001')===String(shift.storeCode||currentStoreCode())&&t>=start&&t<=end;
 });
}

function paymentBreakdownForSales(sales){
 const out={現金:0,信用卡:0,一卡通:0,行動支付:0,電子票證:0,禮物卡:0,其他非現金:0};
 for(const s of sales){
  const cash=Number(s.cashAmount??(s.payment==='現金'?s.total:0));
  if(cash)out['現金']+=cash;
  const non=Number(s.nonCashAmount??(s.payment==='現金'?0:s.total));
  const subtype=String(s.paymentSubtype||s.payment||'');
  if(non){
   if(subtype.includes('信用'))out['信用卡']+=non;
   else if(subtype.includes('一卡通'))out['一卡通']+=non;
   else if(subtype.includes('行動')||subtype.includes('Pay')||subtype.includes('PAY'))out['行動支付']+=non;
   else if(subtype.includes('電子票證')||subtype.includes('悠遊')||subtype.includes('icash'))out['電子票證']+=non;
   else if(subtype.includes('禮物'))out['禮物卡']+=non;
   else out['其他非現金']+=non;
  }
 }
 return out;
}

function shiftFinancialSummary(shift){
 const sales=shiftSales(shift);
 const normal=sales.filter(s=>s.status!=='已作廢'&&s.status!=='已整筆退貨');
 const revenueSales=normal.filter(s=>!isEcServiceSale(s)&&saleRecognizedRevenueNet(s)>0);
 const gross=revenueSales.reduce((sum,s)=>sum+saleRecognizedRevenueNet(s),0);
 const net=revenueSales.reduce((sum,s)=>sum+saleRecognizedRevenueNet(s),0);
 const pay=paymentBreakdownForSales(normal);
 const voided=sales.filter(s=>s.status==='已作廢').reduce((sum,s)=>sum+Number(s.total||0),0);
 const returned=sales.filter(s=>s.status==='已整筆退貨').reduce((sum,s)=>sum+Number(s.total||0),0);
 const corrected=sales.filter(s=>Array.isArray(s.corrections)&&s.corrections.length)
  .reduce((sum,s)=>sum+Math.max(0,Number(s.total||0)-Number(typeof saleNet==='function'?saleNet(s):s.total||0)),0);
 const deposits=load(K.deposits,[]).filter(d=>{
  const t=new Date(d.at).getTime();
  const start=new Date(shift.openedAt).getTime();
  const end=shift.closedAt?new Date(shift.closedAt).getTime():Date.now();
  return String(d.storeCode||'001')===String(shift.storeCode||currentStoreCode())&&t>=start&&t<=end;
 }).reduce((sum,d)=>sum+Number(d.amount||0),0);
 const expectedCash=Number(pay['現金']||0)-deposits;
 return {sales,normal,gross,net,pay,voided,returned,corrected,deposits,expectedCash};
}

function cashCountGrid(existing={}){
 return `<div class="cash-count-grid">
  ${CASH_DENOMS.map(v=>`<div class="cash-count-row">
   <strong>${v} 元</strong>
   <input type="number" min="0" value="${existing[v]||0}" data-denom="${v}">
   <span data-denom-total="${v}">${money((existing[v]||0)*v)}</span>
  </div>`).join('')}
 </div><div class="cash-count-total">點鈔總額：<strong id="cashCountTotal">$0</strong></div>`;
}

function readCashCount(){
 const counts={};let total=0;
 document.querySelectorAll('[data-denom]').forEach(el=>{
  const denom=Number(el.dataset.denom),count=Math.max(0,Number(el.value||0));
  counts[denom]=count;total+=denom*count;
 });
 return {counts,total};
}

function bindCashCounter(){
 const update=()=>{
  let total=0;
  document.querySelectorAll('[data-denom]').forEach(el=>{
   const d=Number(el.dataset.denom),c=Math.max(0,Number(el.value||0)),sub=d*c;
   total+=sub;
   const out=document.querySelector(`[data-denom-total="${d}"]`);
   if(out)out.textContent=money(sub);
  });
  const totalEl=document.querySelector('#cashCountTotal');
  if(totalEl)totalEl.textContent=money(total);
  const expected=Number(document.querySelector('#expectedCashValue')?.dataset.value||0);
  const diff=document.querySelector('#cashDifference');
  if(diff){
   const delta=total-expected;
   diff.textContent=(delta===0?'相符':delta>0?`溢收 ${money(delta)}`:`短收 ${money(Math.abs(delta))}`);
   diff.className='cash-difference '+(delta===0?'ok':delta>0?'over':'short');
  }
 };
 document.querySelectorAll('[data-denom]').forEach(el=>el.oninput=update);
 update();
}

function closeShift(){
 const shift=currentOpenShift();
 if(!shift)return alert('目前沒有開班中的班次');
 const sum=shiftFinancialSummary(shift);
 dlg('X 帳／交班',`
  <div class="x-summary-grid">
   <div><small>班別</small><strong>${esc(shift.type)}</strong></div>
   <div><small>收銀人員</small><strong>${esc(shift.cashier)}</strong></div>
   <div><small>交易筆數</small><strong>${sum.normal.length}</strong></div>
   <div><small>本班營收</small><strong>${money(sum.net)}</strong></div>
   <div><small>現金收入</small><strong>${money(sum.pay['現金'])}</strong></div>
   <div><small>非現金收入</small><strong>${money(sum.net-sum.pay['現金'])}</strong></div>
   <div><small>投庫</small><strong>${money(sum.deposits)}</strong></div>
   <div><small>應有現金</small><strong id="expectedCashValue" data-value="${sum.expectedCash}">${money(sum.expectedCash)}</strong></div>
  </div>
  <h3>點鈔</h3>
  ${cashCountGrid()}
  <div id="cashDifference" class="cash-difference"></div>
  <label>交班備註<textarea id="shiftCloseNote" rows="2"></textarea></label>
  <button class="primary" id="shiftCloseSave">完成 X 帳／交班</button>`);

 setTimeout(()=>{
  bindCashCounter();
  shiftCloseSave.onclick=()=>{
   const {counts,total}=readCashCount();
   const difference=total-sum.expectedCash;
   const rows=shiftRows();
   const target=rows.find(x=>x.id===shift.id);
   if(!target)return alert('找不到班次');
   const now=new Date();
   target.closedAt=now.toISOString();
   target.status='已交班';
   target.closeNote=shiftCloseNote.value.trim();
   target.countedCash=total;
   target.cashCount=counts;
   target.expectedCash=sum.expectedCash;
   target.difference=difference;

   const xRows=xAccountRows();
   const date=now.toISOString().slice(0,10);
   const x={
    id:uid(),
    xNo:nextXNo(date),
    date,
    shiftId:target.id,
    shiftType:target.type,
    cashier:target.cashier,
    openedAt:target.openedAt,
    closedAt:target.closedAt,
    openingCash:0,
    transactionCount:sum.normal.length,
    gross:sum.gross,
    net:sum.net,
    payments:sum.pay,
    correctedAmount:sum.corrected,
    returnedAmount:sum.returned,
    voidedAmount:sum.voided,
    deposits:sum.deposits,
    expectedCash:sum.expectedCash,
    countedCash:total,
    difference,
    cashCount:counts,
    note:target.closeNote,
    status:'已完成',
    createdAt:now.toISOString(),
    user:currentUser()?.name||''
   };
   xRows.unshift(x);
   save(K.shifts,rows);save(K.xAccounts,xRows);
   saveAudit('X帳交班',`${x.xNo}｜${x.shiftType}｜${x.cashier}｜差額${money(difference)}`);
   genericDialog.close();
   if(document.body.dataset.mode==='front'){
    app.innerHTML=`<section class="handover-complete-screen"><div class="handover-complete-card"><div class="handover-complete-icon">✅</div><h1>X 帳／交班完成</h1><p>${esc(x.xNo)} 已完成。</p><button class="primary" id="handoverBackFront">返回前台首頁</button></div></section>`;
    document.querySelector('#handoverBackFront')?.addEventListener('click',()=>render('front'));
   }else{
    render('xaccount');
   }
  };
 },0);
}

function printXAccount(x){
 const cashRows=CASH_DENOMS.map(v=>`<tr><td>${v}</td><td>${x.cashCount?.[v]||0}</td><td>${money((x.cashCount?.[v]||0)*v)}</td></tr>`).join('');
 const payRows=Object.entries(x.payments||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${money(v)}</td></tr>`).join('');
 printHTML(`X帳 ${x.xNo}`,`
  <p>店號：${esc(load('yj_store_no','001'))}</p>
  <p>店名：${esc(load('yj_store_name','億家門市'))}</p>
  <p>X帳號：${esc(x.xNo)}</p>
  <p>班別：${esc(x.shiftType)}</p>
  <p>收銀人員：${esc(x.cashier)}</p>
  <p>開班：${new Date(x.openedAt).toLocaleString('zh-TW')}</p>
  <p>交班：${new Date(x.closedAt).toLocaleString('zh-TW')}</p>
  <hr>
  <h3>營收</h3>
  <p>交易筆數：${x.transactionCount}</p>
  <p>本班淨營收：${money(x.net)}</p>
  <table><tr><th>付款方式</th><th>金額</th></tr>${payRows}</table>
  <p>交易更正：${money(x.correctedAmount||0)}</p>
  <p>整筆退貨：${money(x.returnedAmount||0)}</p>
  <p>作廢：${money(x.voidedAmount||0)}</p>
  <p>投庫：${money(x.deposits||0)}</p>
  <hr>
  <h3>現金盤點</h3>
  <table><tr><th>面額</th><th>數量</th><th>小計</th></tr>${cashRows}</table>
  <p>應有現金：${money(x.expectedCash)}</p>
  <p>實際現金：${money(x.countedCash)}</p>
  <p><strong>${x.difference===0?'現金相符':x.difference>0?`溢收 ${money(x.difference)}`:`短收 ${money(Math.abs(x.difference))}`}</strong></p>
  <p>備註：${esc(x.note||'')}</p>
  <br><p>交班人簽名：________________</p><p>接班人簽名：________________</p>
 `);
}

function xAccountPage(){
 const shift=currentOpenShift();
 const xs=xAccountRows();
 return `<div class="page-head"><h2>X帳／交班</h2><div class="toolbar">
  ${shift?`<button class="primary" data-action="close-shift">完成交班／X帳</button>`:`<button class="primary" data-action="open-shift">開班</button>`}
 </div></div>
 ${shift?`<div class="panel shift-active"><h3>目前班次：${esc(shift.type)}</h3><p>${esc(shift.cashier)}｜${new Date(shift.openedAt).toLocaleString('zh-TW')} 開班</p></div>`:
 `<div class="panel"><p>目前沒有開班中的班次。</p></div>`}
 <div class="panel table-wrap" style="margin-top:14px"><table class="table">
  <tr><th>X帳號</th><th>日期</th><th>班別</th><th>收銀人員</th><th>淨營收</th><th>應有現金</th><th>實際現金</th><th>差額</th><th>操作</th></tr>
  ${xs.map(x=>`<tr><td>${esc(x.xNo)}</td><td>${esc(x.date)}</td><td>${esc(x.shiftType)}</td><td>${esc(x.cashier)}</td><td>${money(x.net)}</td><td>${money(x.expectedCash)}</td><td>${money(x.countedCash)}</td><td class="${x.difference===0?'diff-ok':x.difference>0?'diff-over':'diff-short'}">${x.difference===0?'相符':x.difference>0?`+${money(x.difference)}`:`-${money(Math.abs(x.difference))}`}</td><td><button class="button" data-x-print="${x.id}">列印X帳</button></td></tr>`).join('')||'<tr><td colspan="9">尚無X帳</td></tr>'}
 </table></div>`;
}


function storeHomeMetrics(){
 const today=new Date().toISOString().slice(0,10);
 const sales=load(K.sales,[]).filter(s=>String(s.at||'').slice(0,10)===today);
 const valid=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status));
 const revenueSales=valid.filter(s=>!isEcServiceSale(s)&&saleRecognizedRevenueNet(s)>0);
 const net=s=>saleRecognizedRevenueNet(s);
 const revenue=revenueSales.reduce((a,s)=>a+net(s),0), customers=revenueSales.length;
 const member=revenueSales.filter(s=>s.memberId||s.member||s.memberPhone);
 const memberRevenue=member.reduce((a,s)=>a+net(s),0);
 return {revenue,customers,avg:customers?Math.round(revenue/customers):0,
 memberRevenue,memberCustomers:member.length,memberAvg:member.length?Math.round(memberRevenue/member.length):0,
 memberRate:revenue?Math.round(memberRevenue/revenue*100):0};
}
function homeStatusRows(){
 const orders=load(K.orders,[]), quality=load(K.quality,[]), products=load(K.products,[]);
 const shift=currentOpenShift(), today=new Date().toISOString().slice(0,10), xs=xAccountRows();
 const pendingOrders=orders.filter(x=>!['已傳輸','完成'].includes(x.status)).length;
 const pendingQuality=quality.filter(x=>!['完成','已下架'].includes(x.status)).length;
 const lowStock=products.filter(x=>Number(x.safetyStock||0)>0&&Number(x.stock||0)<=Number(x.safetyStock||0)).length;
 const sales=load(K.sales,[]).filter(s=>String(s.at||'').slice(0,10)===today);
 const returns=sales.filter(s=>s.status==='已整筆退貨'||(Array.isArray(s.corrections)&&s.corrections.length)).length;
 return [
  ['營收',`${sales.length} 筆本日交易`,'即時','ok','revenue','明細'],
  ['訂購',`${pendingOrders} 筆待傳輸／處理`,pendingOrders?'未完成':'正常',pendingOrders?'warn':'ok','home','查詢'],
  ['退貨',`${returns} 筆退貨／更正紀錄`,returns?'有紀錄':'正常',returns?'warn':'ok','transactions','查詢'],
  ['變價','進入商品管理設定售價／折扣','商品管理','info','products','處理'],
  ['品保',`${pendingQuality} 筆品保資料待處理`,pendingQuality?'待處理':'正常',pendingQuality?'warn':'ok','quality','明細'],
  ['FIFO','進入品保執行效期／下架檢查','品保','info','quality','查詢'],
  ['庫存',`${lowStock} 項低於安全庫存`,lowStock?'待處理':'正常',lowStock?'warn':'ok','inventory','查詢'],
  ['更新','進入系統設定／更新中心','系統','info','home','處理'],
  ['X帳',shift?`${shift.type}｜${shift.cashier}｜開班中`:(xs.some(x=>x.date===today)?'本日已有交班紀錄':'目前未開班'),shift?'開班中':'查詢',shift?'warn':'ok','xaccount',shift?'處理':'查詢'],
  ['Z帳','進入營收管理執行日結／查看報表','營收管理','info','revenue','處理']
 ];
}
function storeOperationsHome(){
 const m=storeHomeMetrics(),u=currentUser()||{},shift=currentOpenShift(),now=new Date();
 const storeNo=load('yj_store_no','001'),storeName=load('yj_store_name','億家門市');
 return `<div class="store-home">
 <section class="store-identity"><div>
  <div class="enterprise-brand"><span class="brand-mark">億</span><div><strong>億家 Enterprise</strong><small>店舖系統</small></div></div>
  <div class="store-meta"><span>操作員：<b>${esc(u.name||u.username||'未登入')}</b></span><span>店舖：<b>${esc(storeNo)} ${esc(storeName)}</b></span><span>${now.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'})} <b id="homeLiveClock">${now.toLocaleTimeString('zh-TW',{hour12:false})}</b></span></div>
 </div><div class="shift-home-state ${shift?'active':'idle'}"><small>目前班次</small><strong>${shift?esc(shift.type):'未開班'}</strong><span>${shift?`${esc(shift.cashier)}｜開班中`:'請至 X帳／交班開班'}</span></div></section>
 <section class="panel"><div class="home-section-title"><span class="home-round-icon">↗</span><h2>營收速報</h2></div>
 <div class="speed-table"><div class="speed-head"><span>欄位</span><span>全店</span><span>會員</span></div>
 <div><span>日商</span><b>${money(m.revenue)}</b><b>${money(m.memberRevenue)}</b></div>
 <div><span>來客數</span><b>${m.customers} 人</b><b>${m.memberCustomers} 人</b></div>
 <div><span>客單價</span><b>${money(m.avg)}</b><b>${money(m.memberAvg)}</b></div>
 <div class="speed-rate"><span>會員營收占比</span><b>—</b><b>${m.memberRate}%</b></div></div></section>
 <section class="panel"><div class="home-section-title"><span class="home-round-icon">♢</span><h2>訊息</h2></div><div class="home-message-list">
 ${homeStatusRows().map(r=>`<div class="home-message-row"><span class="message-tag">${esc(r[0])}</span><span>${esc(r[1])}</span><span class="message-state ${r[3]}">${esc(r[2])}</span><button class="home-query ${r[3]}" data-nav="${esc(r[4])}">${esc(r[5])}</button></div>`).join('')}
 </div></section></div>`;
}



async function refreshMemberSystemCloud({redraw=false}={}){
 if(!cloudConfigured())return false;
 const keys=[K.members,K.pointSettings,K.memberBonusCampaigns];
 const before=keys.map(k=>JSON.stringify(load(k,null)));
 const pulled=[];
 for(const k of keys)pulled.push(await cloudPullKey(k));
 const members=Array.isArray(pulled[0])?pulled[0]:load(K.members,[]);
 if(state.member){
  const key=String(state.member.id||state.member.phone||state.member.code||'');
  const latest=members.find(m=>String(m.id||'')===key||String(m.phone||'')===key||String(m.code||m.memberNo||'')===key);
  if(latest)state.member=latest;
 }
 const changed=keys.some((k,i)=>before[i]!==JSON.stringify(load(k,null)));
 if(changed&&redraw&&document.querySelector('#cartList')){drawPOS();bindPosMemberPanel()}
 return changed;
}
async function refreshPosMembersCloud(opts={}){return refreshMemberSystemCloud(opts)}


function maskMemberNo(value){
 const s=String(value||'').trim();
 if(!s)return '';
 if(s.length<=4)return s[0]+'***'+s.slice(-1);
 return s.slice(0,2)+'***'+s.slice(-2);
}
function nextPosMemberNo(){
 const rows=posMemberRows();
 const base=Date.now().toString().slice(-6);
 let code='M0'+base;
 let n=1;
 while(rows.some(x=>String(x.code||x.memberNo||'')===code)){code='M0'+base+String(n++).slice(-1)}
 return code;
}
function findPosMemberByPhone(phone){
 const q=String(phone||'').trim();
 return posMemberRows().find(x=>String(x.phone||'').trim()===q)||null;
}
function applyPosMember(m){
 state.member=m||null;
 if(!m){state.memberRedeemPoints=0;state.memberRedeemAmount=0}
 drawPOS();scheduleCustomerDisplaySync(0);
}
function openPosMemberLookup(){
 const m=state.member||null;
 dlg('會員查詢',`
  <div class="pos-member-lookup-dialog">
   <label>輸入手機號碼<input id="posMemberLookupPhone" inputmode="tel" placeholder="請輸入手機號碼" value="${esc(m?.phone||'')}"></label>
   <div class="pos-member-lookup-actions">
    <button class="primary" id="posMemberLookupSearch">查詢</button>
    <button class="button" id="posMemberLookupAdd">新增</button>
    <button class="button" id="posMemberLookupRedeem" ${m?'':'disabled'}>折抵</button>
   </div>
   <div id="posMemberLookupResult" class="pos-member-lookup-result">
    ${m?`<b>${esc(m.name||'會員')}</b><span>會員編號：${esc(maskMemberNo(m.code||m.memberNo||m.id))}</span><span>手機：${esc(m.phone||'—')}</span><span>點數：${Number(m.points||0)} 點</span>`:'尚未查詢會員'}
   </div>
  </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#posMemberLookupPhone');
  const result=document.querySelector('#posMemberLookupResult');
  const redeem=document.querySelector('#posMemberLookupRedeem');
  const refreshResult=member=>{
   if(!result)return;
   if(!member){result.innerHTML='<span>找不到會員</span>';if(redeem)redeem.disabled=true;return}
   result.innerHTML=`<b>${esc(member.name||'會員')}</b><span>會員編號：${esc(maskMemberNo(member.code||member.memberNo||member.id))}</span><span>手機：${esc(member.phone||'—')}</span><span>點數：${Number(member.points||0)} 點</span>`;
   if(redeem)redeem.disabled=false;
  };
  document.querySelector('#posMemberLookupSearch').onclick=()=>{
   const member=findPosMemberByPhone(input?.value);
   if(!member){refreshResult(null);return}
   applyPosMember(member);refreshResult(member);
  };
  document.querySelector('#posMemberLookupAdd').onclick=()=>{
   const phone=String(input?.value||'').trim();
   if(!phone)return alert('請先輸入手機號碼');
   if(findPosMemberByPhone(phone))return alert('此手機號碼已經是會員');
   const name=prompt('會員姓名（可留空）','')??'';
   const rows=posMemberRows(),code=nextPosMemberNo();
   const member={id:uid(),name:String(name).trim()||'會員',phone,code,memberNo:code,points:0,pointLedger:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
   rows.unshift(member);save(K.members,rows);grantSignupBonus?.(member);applyPosMember(member);saveAudit('POS新增會員',`${code}｜${phone}`);refreshResult(member);
  };
  document.querySelector('#posMemberLookupRedeem').onclick=()=>{
   const member=state.member;
   if(!member)return alert('請先查詢會員');
   const cfg=pointSettings();
   const available=Math.max(0,Number(member.points||0));
   if(available<=0)return alert('此會員目前沒有可折抵點數');
   const requested=Number(prompt(`目前 ${available} 點\n請輸入要折抵的點數`,String(Math.min(available,Number(cfg.redeemPoints||300)))));
   if(!requested||requested<0)return;
   const unitPts=Math.max(1,Number(cfg.redeemPoints||300)),unitAmount=Math.max(0,Number(cfg.redeemAmount||1));
   const usable=Math.min(available,Math.floor(requested/unitPts)*unitPts);
   if(usable<=0)return alert(`需以 ${unitPts} 點為折抵單位`);
   const amount=(usable/unitPts)*unitAmount;
   state.memberRedeemPoints=usable;state.memberRedeemAmount=amount;
   drawPOS();scheduleCustomerDisplaySync(0);
   alert(`已設定折抵 ${usable} 點／${money(amount)}`);
   genericDialog.close();
  };
  if(input){input.focus();input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();document.querySelector('#posMemberLookupSearch')?.click()}}}
 },0);
}
function posMemberRows(){return load((typeof K!=='undefined'&&K.members)?K.members:'yj_members',[])}
function posFindMember(q){
 q=String(q||'').trim(); if(!q)return null;
 return posMemberRows().find(m=>[m.phone,m.id,m.memberNo,m.barcode].some(v=>String(v||'').trim()===q))||null;
}
function posMemberPanel(){
 const m=state.member||null;
 return `<div class="pos-member-panel">
 <div class="pos-member-title-row"><div class="pos2-pay-title">會員</div><button type="button" class="button pos-member-redeem-btn" id="posMemberRedeem" ${m?'':'disabled'}>折抵</button></div>
 <div class="pos-member-input-row"><input id="posMemberInput" placeholder="手機號碼／會員編號／會員條碼"><button type="button" class="button" id="posMemberSearch">查詢</button><button type="button" class="primary" id="posMemberJoin">加入</button></div>
 <div id="posMemberResult">${m?`<b>${esc(m.name||'會員')}</b>　${esc(m.phone||m.memberNo||m.id||'')}　｜目前點數 <b>${Number(m.points||0)}</b> 點`:'本筆尚未綁定會員'}</div>
 ${m?`<div class="toolbar"><button type="button" class="button" id="posMemberClear">移除會員</button></div>${Number(state.memberRedeemPoints||0)>0?`<div class="setting-hint">本筆折抵：${Number(state.memberRedeemPoints||0)} 點 → ${money(Number(state.memberRedeemAmount||0))}</div>`:''}`:''}</div>`;
}
function bindPosMemberPanel(){
 const input=document.querySelector('#posMemberInput'), search=document.querySelector('#posMemberSearch'), join=document.querySelector('#posMemberJoin');
 if(search)search.onclick=async()=>{await refreshPosMembersCloud();const m=posFindMember(input?input.value:'');if(!m){alert('找不到會員');return}state.member=m;render('pos')};
 if(join)join.onclick=()=>{
  const prefill=String(input?.value||'').trim();
  const phone=/^09\d{8}$/.test(prefill)?prefill:'';
  dlg('加入會員',`<label>姓名<input id="posJoinName" placeholder="會員姓名"></label><label>手機<input id="posJoinPhone" inputmode="tel" value="${esc(phone)}" placeholder="09xxxxxxxx"></label><label>會員編號<input id="posJoinCode" value="M${Date.now().toString().slice(-8)}"></label><button class="primary" id="posJoinSave">加入並綁定本筆</button>`);
  setTimeout(()=>{
   const saveBtn=document.querySelector('#posJoinSave');
   if(!saveBtn)return;
   saveBtn.onclick=async()=>{
    await refreshPosMembersCloud();
    const name=document.querySelector('#posJoinName')?.value.trim()||'';
    const phoneVal=document.querySelector('#posJoinPhone')?.value.trim()||'';
    const code=document.querySelector('#posJoinCode')?.value.trim()||'';
    if(!name)return alert('請輸入會員姓名');
    if(!phoneVal)return alert('請輸入手機號碼');
    if(!/^09\d{8}$/.test(phoneVal))return alert('手機號碼格式不正確');
    if(!code)return alert('請輸入會員編號');
    const rows=load(K.members,[]);
    if(rows.some(x=>String(x.phone||'').trim()===phoneVal))return alert('此手機號碼已是會員');
    if(rows.some(x=>String(x.code||x.memberNo||'').trim()===code))return alert('此會員編號已存在');
    const member={id:uid(),name,phone:phoneVal,code,memberNo:code,points:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    rows.unshift(member);
    save(K.members,rows);
    grantSignupBonus(member);
    saveAudit('POS加入會員',`${member.name}｜${member.phone}｜${member.code}`);
    state.member=member;
    genericDialog.close();
    render('pos');
   };
  },0);
 };
 const redeem=document.querySelector('#posMemberRedeem');
 if(redeem)redeem.onclick=async()=>{
  const m=state.member;if(!m)return;const cfg=pointSettings();
  const unitPts=Math.max(1,Number(cfg.redeemPoints||300)),unitAmt=Math.max(0,Number(cfg.redeemAmount||1));
  if(unitAmt<=0)return alert('目前後台未設定可折抵金額');
  const manualOnly=Math.max(0,Number(state.discount||0)),t=totals();
  const payableBeforePoints=Math.max(0,Number(t.subtotal||0)-Number(t.promotionDiscount||0)-manualOnly);
  const maxByPoints=Math.floor(Number(m.points||0)/unitPts),maxByAmount=Math.floor(payableBeforePoints/unitAmt),maxUnits=Math.min(maxByPoints,maxByAmount);
  if(maxUnits<=0)return alert(maxByPoints<=0?`點數不足，目前 ${Number(m.points||0)} 點；每 ${unitPts} 點折 ${money(unitAmt)}`:'本筆已無可折抵金額');
  const raw=prompt(`每 ${unitPts} 點折 ${money(unitAmt)}。\n本筆最多可使用 1～${maxUnits} 個折抵單位：`,String(maxUnits));if(raw===null)return;
  const units=Math.max(0,Math.min(maxUnits,Math.floor(Number(raw)||0)));if(units<=0)return;
  const points=units*unitPts,amount=units*unitAmt;redeem.disabled=true;redeem.textContent='等待客顯確認…';const approved=await customerConfirmPointRedeem(points,amount);if(!approved){redeem.disabled=false;redeem.textContent='折抵';return alert('客人未確認點數折抵，本筆不折抵點數')}state.memberRedeemPoints=points;state.memberRedeemAmount=amount;drawPOS();bindPosMemberPanel();
 };
 const clear=document.querySelector('#posMemberClear');
 if(clear)clear.onclick=()=>{state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;render('pos')};
 if(input)input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(search)search.click()}};
}


function openCollectionPayment(initialCode='',meta={}){
 const scOnline=scServiceConnected();
 const provider=meta?.provider||collectionProviderForCode(String(meta?.parts?.[0]||initialCode||''));
 const parts=Array.isArray(meta?.parts)?meta.parts:[String(initialCode||'')].filter(Boolean);
 const providerName=provider?.name||'待確認代收單位';
 const barcodeMode=provider?.barcodeMode||((meta?.qr)?'qr':parts.length===3?'three':parts.length===2?'two':'single');
 const overdue=provider?.overduePolicy||'';
 const overdueText=overdue==='reprint'?'逾期需補單':overdue==='reject'?'逾期不可受理':overdue==='accept'?'逾期可直接受理':'依發行單位規則';
 const reprint=provider?.reprintMethod==='kiosk'?'多媒體機台':provider?.reprintMethod==='issuer'?'原發行單位':provider?.reprintMethod==='none'?'不提供補單':'—';
 dlg('代收繳費',`<div class="notice"><b>${esc(providerName)}</b><br>條碼模式：${esc(scanModeZh(barcodeMode))}｜${esc(overdueText)}${overdue==='reprint'?`｜補單：${esc(reprint)}`:''}${provider?.reprintNote?`<br>${esc(provider.reprintNote)}`:''}</div>${parts.length>1?`<div class="notice">已讀取 ${parts.length} 段：${parts.map((x,i)=>`第${i+1}段 ${esc(x)}`).join(' ｜ ')}</div>`:''}<div class="settings-grid"><label>代收類型<select id="collectionType"><option>水電費</option><option>電信費</option><option>信用卡費</option><option>稅費</option><option>保險費</option><option>其他帳單</option></select></label><label>帳單／銷帳編號<div class="inline-field"><input id="collectionRef" inputmode="numeric" value="${esc(initialCode)}" placeholder="請輸入或掃描編號"><button type="button" class="button" id="collectionScan">📷 掃描帳單</button></div></label><label>代收金額<input id="collectionAmount" type="number" min="1" step="1" placeholder="0"></label></div><div class="notice"><b>代收繳費屬服務性交易</b><br>代收金額不列入一般商品營收；完成後會計入服務性商品金額／服務性來客數。</div>${scOnline?'':'<div class="notice sc-disconnect-inline"><b>與 SC 斷開</b><br>目前只能查看／輸入帳單資料，無法完成繳費。</div>'}<button class="primary" id="collectionSubmit" ${scOnline?'':'disabled title="與 SC 斷開，無法繳帳單"'}>確認代收</button>`);
 setTimeout(()=>{if(!scServiceConnected())showScDisconnectedNotice();updateScDependentUi();const cs=document.querySelector('#collectionScan');if(cs)cs.onclick=()=>scanCode({title:'掃描代收帳單／QR Code',onResult:(code,scanMeta)=>{genericDialog.close();resetUnifiedScanSession();processUnifiedPosCode(code,{clearInput:false,scanMeta})}});collectionSubmit.onclick=()=>{if(!scServiceConnected()){showScDisconnectedNotice();return}const amount=Math.max(0,Number(collectionAmount.value||0)),ref=collectionRef.value.trim(),type=collectionType.value;if(amount<=0)return alert('請輸入代收金額');if(state.cart.length)return alert('代收帳單需單獨帶入結帳畫面，請先完成或取消目前交易');const configuredPayment=String(provider?.paymentMethod||(load('yj_collection_service_config',{})||{}).paymentMethod||'現金').trim()||'現金';if(!state.transactionId)state.transactionId='T'+Date.now();state.cart=[{id:`COL-${Date.now()}`,code:ref,name:`代收繳費｜${providerName}`,price:amount,cost:0,qty:1,ecPickup:false,collectionPayment:true,billPayment:true,serviceType:'bill',servicePaymentMethod:configuredPayment,serviceReference:ref,serviceCategory:type,serviceProvider:providerName,allowNegativeStock:true,manualAmount:true}];state.discount=0;state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;state.payment=configuredPayment==='信用卡'?'信用卡':configuredPayment==='億家Pay'?'行動支付':'現金';state.note=`代收繳費｜${providerName}｜${ref}`;genericDialog.close();render('pos');setTimeout(()=>{drawPOS();alert('代收帳單已帶入結帳畫面，請按「小計」後再進行結帳。')},0)};},0);
}
function pointSettings(){
 return load(K.pointSettings,{earnAmount:1,earnPoints:1,redeemPoints:300,redeemAmount:1});
}
function savePointSettings(){
 const s={
  earnAmount:Math.max(1,Number(document.querySelector('#pointEarnAmount')?.value||1)),
  earnPoints:Math.max(0,Number(document.querySelector('#pointEarnPoints')?.value||1)),
  redeemPoints:Math.max(1,Number(document.querySelector('#pointRedeemPoints')?.value||300)),
  redeemAmount:Math.max(0,Number(document.querySelector('#pointRedeemAmount')?.value||1))
 };
 save(K.pointSettings,s);
 saveAudit('點數設定',`${s.earnAmount}元集${s.earnPoints}點｜${s.redeemPoints}點折${s.redeemAmount}元`);
 alert('點數規則已儲存');
 render('members');
}
function memberPointSettingsPanel(){
 const s=pointSettings();
 return `<div class="panel" style="margin-bottom:14px">
  <div class="page-head"><h3>會員累點／折抵設定</h3></div>
  <div class="settings-grid">
   <label>消費金額（元）<input id="pointEarnAmount" type="number" min="1" value="${s.earnAmount}"></label>
   <label>累積點數<input id="pointEarnPoints" type="number" min="0" value="${s.earnPoints}"></label>
   <label>折抵所需點數<input id="pointRedeemPoints" type="number" min="1" value="${s.redeemPoints}"></label>
   <label>可折抵金額（元）<input id="pointRedeemAmount" type="number" min="0" value="${s.redeemAmount}"></label>
  </div>
  <p class="setting-hint">目前規則：${s.earnAmount} 元集 ${s.earnPoints} 點；${s.redeemPoints} 點折抵 ${s.redeemAmount} 元。</p>
  <button class="primary" data-action="save-point-settings">儲存點數設定</button>
 </div>`;
}

function promotionRows(){
 return load(K.promotionRules,[]);
}
function promotionPage(){
 const rows=promotionRows();
 return `<div class="page-head"><h2>總部商品活動</h2><div class="toolbar"><button class="button" data-action="refresh-promotions">↻ 同步總部活動</button></div></div>
 <div class="panel"><p class="setting-hint">此頁由總部後台同步，TM 僅供查看；新增、修改、刪除請至管理後台操作。</p></div>
 <div class="panel table-wrap"><table class="table"><thead><tr><th>活動名稱</th><th>活動類型</th><th>商品／品群</th><th>條件</th><th>期間</th><th>狀態</th></tr></thead><tbody>
 ${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.type)}</td><td>${esc(x.targetLabel||`${x.targetType||''}：${x.target||''}`)}</td><td>${esc(x.summary||'')}</td><td>${esc(x.startDate||'')}～${esc(x.endDate||'')}</td><td>${x.active===false?'停用':'啟用'}</td></tr>`).join('')||'<tr><td colspan="6">尚無活動</td></tr>'}
 </tbody></table></div>`;
}

function openPromotionForm(existing=null){
 const x=existing||{};
 dlg(existing?'修改商品活動':'新增商品活動',`
  <label>活動名稱<input id="promoName" value="${esc(x.name||'')}"></label>
  <label>活動類型<select id="promoType">${['買一送一','第2件折扣','多件折扣','固定組合價'].map(v=>`<option ${x.type===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label>套用範圍<select id="promoTargetType"><option ${x.targetType==='商品'?'selected':''}>商品</option><option ${x.targetType==='品群'?'selected':''}>品群</option></select></label>
  <label>商品代號／品群<input id="promoTarget" value="${esc(x.target||'')}" placeholder="例如 MILK001 或 飲料"></label>
  <div class="settings-grid">
   <label>購買件數<input id="promoQty" type="number" min="1" value="${x.qty||2}"></label>
   <label>折扣比例（例如 0.6=6折）<input id="promoRate" type="number" min="0" max="1" step="0.01" value="${x.rate??1}"></label>
   <label>固定優惠價（選填）<input id="promoFixed" type="number" min="0" value="${x.fixedPrice??''}"></label>
  </div>
  <div class="settings-grid">
   <label>開始日期<input id="promoStart" type="date" value="${esc(x.startDate||'')}"></label>
   <label>結束日期<input id="promoEnd" type="date" value="${esc(x.endDate||'')}"></label>
  </div>
  <label class="check-field"><input id="promoActive" type="checkbox" ${x.active===false?'':'checked'}>啟用活動</label>
  <button class="primary" id="promoSave">儲存活動</button>`);
 setTimeout(()=>promoSave.onclick=()=>{
   const rows=promotionRows();
   const type=promoType.value,qty=Math.max(1,Number(promoQty.value||1)),rate=Number(promoRate.value||1),fixed=promoFixed.value===''?null:Number(promoFixed.value);
   const summary= type==='買一送一'?`買 ${qty} 件，其中 1 件免費`
    : type==='第2件折扣'?`第 2 件 ${Math.round(rate*10)} 折`
    : type==='多件折扣'?`${qty} 件 ${Math.round(rate*10)} 折`
    : `${qty} 件 ${money(fixed||0)}`;
   const row={
    id:x.id||uid(),name:promoName.value.trim()||'未命名活動',type,targetType:promoTargetType.value,
    target:promoTarget.value.trim(),targetLabel:`${promoTargetType.value}：${promoTarget.value.trim()}`,
    qty,rate,fixedPrice:fixed,startDate:promoStart.value,endDate:promoEnd.value,active:promoActive.checked,summary,
    updatedAt:new Date().toISOString(),user:currentUser()?.name||''
   };
   const i=rows.findIndex(r=>r.id===row.id);if(i>=0)rows[i]=row;else rows.unshift(row);
   save(K.promotionRules,rows);saveAudit('商品活動設定',`${row.name}｜${row.summary}`);
   genericDialog.close();render('promotions');
 },0);
}

function systemSettingsPage(){
 const canCloud=hasPermission('cloudRemoteSync'),canVersion=hasPermission('systemVersion');
 return `<div class="page-head"><div class="toolbar"><button class="button" data-page="pos">← 返回</button></div><h2>☁️ 雲端與更新</h2></div>
 <div class="panel">
  <h3>系統</h3>
  <p class="setting-hint">重新啟動已整合至 X Mode → 30. 關機。</p>
 </div>
 ${canCloud?cloudSyncPanel():''}
 ${canVersion?`<div class="panel" style="margin-top:14px"><h3>系統版本</h3><p>前台 TM 版本：<b>${tmDisplayVersion()}</b></p><p class="setting-hint">網站版本由 GitHub → Vercel 自動部署。</p><button class="button" data-action="reload-latest">重新載入最新版</button></div>`:''}`;
}

function saveSystemSettings(){
 const old=load(K.systemSettings,{shifts:{早班:{start:'07:00',end:'15:00'},晚班:{start:'15:00',end:'23:00'},大夜班:{start:'23:00',end:'07:00'}},reserveCash:0});
 const shifts=structuredClone(old.shifts||{});
 if(hasPermission('systemShiftSettings')||hasPermission('systemShiftTimeSettings')){
  for(const n of ['早班','晚班','大夜班']){
   shifts[n]=shifts[n]||{};
   if(hasPermission('systemShiftTimeSettings')){
    shifts[n].start=document.querySelector(`[data-shift-start="${n}"]`)?.value||shifts[n].start||'';
    shifts[n].end=document.querySelector(`[data-shift-end="${n}"]`)?.value||shifts[n].end||'';
   }
  }
 }
 const reserveCash=hasPermission('systemReserveCashSettings')
  ? Math.max(0,Number(document.querySelector('#reserveCashSetting')?.value||0))
  : Number(old.reserveCash||0);
 const s={...old,shifts,reserveCash,updatedAt:new Date().toISOString()};
 save(K.systemSettings,s);
 saveAudit('系統設定','班別／時間／店舖預留金依權限異動');
 alert('系統設定已儲存');
 render('system-settings');
}


function memberBonusCampaignRows(){
 return load(K.memberBonusCampaigns,[]);
}
function memberBonusCampaignTypeOptions(){
 return ['新會員加入','指定支付方式滿額','指定商品消費','指定品群消費','會員生日','指定期間消費','自訂'];
}
function memberBonusCampaignPage(){
 const canEdit=hasPermission('memberBonusCampaignSettings');
 const rows=memberBonusCampaignRows();
 return `<div class="panel member-bonus-panel">
  <div class="page-head"><h3>會員贈點活動設定 ${canEdit?'':'🔒'}</h3>
   <div class="toolbar">${canEdit?'<button class="primary" data-action="new-member-bonus">＋ 新增贈點活動</button>':'<button class="button" disabled>需開權限</button>'}</div>
  </div>
  <p class="setting-hint">可設定新會員贈點、指定支付滿額加贈、活動日期、活動類別與點數效期。</p>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>活動名稱</th><th>類別</th><th>條件</th><th>加贈點數</th><th>活動期間</th><th>點數效期</th><th>狀態</th><th>操作</th></tr></thead>
   <tbody>${rows.map(x=>`<tr>
    <td>${esc(x.name)}</td>
    <td>${esc(x.category||x.type)}</td>
    <td>${esc(x.summary||'')}</td>
    <td>${Number(x.bonusPoints||0)} 點</td>
    <td>${esc(x.startDate||'不限')} ～ ${esc(x.endDate||'不限')}</td>
    <td>${x.expiryType==='天數'?`${Number(x.expiryDays||0)} 天`:x.expiryType==='指定日期'?esc(x.expiryDate||'未設定'):'永久'}</td>
    <td>${x.active===false?'停用':'啟用'}</td>
    <td>${canEdit?`<button class="button" data-edit-member-bonus="${x.id}">修改</button> <button class="button danger" data-disable-member-bonus="${x.id}">${x.active===false?'啟用':'停用'}</button>`:'僅查看'}</td>
   </tr>`).join('')||'<tr><td colspan="8">尚無會員贈點活動</td></tr>'}</tbody>
  </table></div>
 </div>`;
}
function openMemberBonusCampaignForm(existing=null){
 if(!requirePermission('memberBonusCampaignSettings'))return;
 const x=existing||{};
 dlg(existing?'修改會員贈點活動':'新增會員贈點活動',`
  <label>活動名稱<input id="mbName" value="${esc(x.name||'')}"></label>
  <label>活動類別<select id="mbCategory">${memberBonusCampaignTypeOptions().map(v=>`<option ${x.category===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <div class="settings-grid">
   <label>開始日期<input id="mbStart" type="date" value="${esc(x.startDate||'')}"></label>
   <label>結束日期<input id="mbEnd" type="date" value="${esc(x.endDate||'')}"></label>
  </div>
  <div class="settings-grid">
   <label>最低消費金額<input id="mbMinSpend" type="number" min="0" value="${Number(x.minSpend||0)}"></label>
   <label>加贈點數<input id="mbBonusPoints" type="number" min="0" value="${Number(x.bonusPoints||100)}"></label>
  </div>
  <label>指定支付方式<select id="mbPayment">
   ${['不限','億家Pay','現金','信用卡','行動支付','電子票證','禮物卡'].map(v=>`<option ${x.paymentMethod===v?'selected':''}>${v}</option>`).join('')}
  </select></label>
  <label>指定商品／品群（選填）<input id="mbTarget" value="${esc(x.target||'')}" placeholder="例如 MILK001 或 飲料"></label>
  <fieldset><legend>點數效期</legend>
   <label>效期類型<select id="mbExpiryType">
    ${['永久','天數','指定日期'].map(v=>`<option ${x.expiryType===v?'selected':''}>${v}</option>`).join('')}
   </select></label>
   <div class="settings-grid">
    <label>有效天數<input id="mbExpiryDays" type="number" min="1" value="${Number(x.expiryDays||30)}"></label>
    <label>指定到期日<input id="mbExpiryDate" type="date" value="${esc(x.expiryDate||'')}"></label>
   </div>
  </fieldset>
  <label>備註<textarea id="mbNote" rows="2">${esc(x.note||'')}</textarea></label>
  <label class="check-field"><input id="mbActive" type="checkbox" ${x.active===false?'':'checked'}>啟用活動</label>
  <button class="primary" id="mbSave">儲存活動</button>`);
 setTimeout(()=>mbSave.onclick=()=>{
  const rows=memberBonusCampaignRows();
  const category=mbCategory.value;
  const minSpend=Math.max(0,Number(mbMinSpend.value||0));
  const bonusPoints=Math.max(0,Number(mbBonusPoints.value||0));
  const paymentMethod=mbPayment.value;
  const target=mbTarget.value.trim();
  let summary='';
  if(category==='新會員加入') summary=`新會員加入加贈 ${bonusPoints} 點`;
  else if(category==='指定支付方式滿額') summary=`${paymentMethod} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else if(category==='指定商品消費') summary=`商品 ${target||'未指定'} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else if(category==='指定品群消費') summary=`品群 ${target||'未指定'} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else summary=`消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;

  const row={
   id:x.id||uid(),
   name:mbName.value.trim()||'未命名贈點活動',
   category,startDate:mbStart.value,endDate:mbEnd.value,minSpend,bonusPoints,
   paymentMethod,target,expiryType:mbExpiryType.value,
   expiryDays:Math.max(1,Number(mbExpiryDays.value||30)),
   expiryDate:mbExpiryDate.value,note:mbNote.value.trim(),active:mbActive.checked,
   summary,updatedAt:new Date().toISOString(),user:currentUser()?.name||''
  };
  const i=rows.findIndex(r=>r.id===row.id);if(i>=0)rows[i]=row;else rows.unshift(row);
  save(K.memberBonusCampaigns,rows);
  saveAudit('會員贈點活動設定',`${row.name}｜${row.summary}`);
  genericDialog.close();render('members');
 },0);
}
function activeMemberBonusCampaigns(date=new Date()){
 const d=date.toISOString().slice(0,10);
 return memberBonusCampaignRows().filter(x=>{
  if(x.active===false)return false;
  if(x.startDate&&d<x.startDate)return false;
  if(x.endDate&&d>x.endDate)return false;
  return true;
 });
}
function memberPointExpiryDate(campaign,baseDate=new Date()){
 if(campaign.expiryType==='指定日期'&&campaign.expiryDate)return campaign.expiryDate;
 if(campaign.expiryType==='天數'){
  const d=new Date(baseDate);d.setDate(d.getDate()+Number(campaign.expiryDays||0));
  return d.toISOString().slice(0,10);
 }
 return '';
}


function grantMemberBonus(member,campaign,source='活動贈點'){
 if(!member||!campaign)return false;
 const members=load(K.members,[]);
 const target=members.find(m=>m.id===member.id)||member;
 target.points=Number(target.points||0)+Number(campaign.bonusPoints||0);
 target.pointLedger=Array.isArray(target.pointLedger)?target.pointLedger:[];
 target.pointLedger.unshift({
  id:'PT'+Date.now()+Math.random().toString(36).slice(2,6),
  type:'贈點',points:Number(campaign.bonusPoints||0),campaignId:campaign.id,campaignName:campaign.name,
  source,at:new Date().toISOString(),expiryDate:memberPointExpiryDate(campaign)
 });
 if(members.some(m=>m.id===target.id))save(K.members,members);
 saveAudit('會員贈點',`${target.name||target.id}｜${campaign.name}｜+${campaign.bonusPoints}點`);
 return true;
}
function grantSignupBonus(member){
 const c=activeMemberBonusCampaigns().find(x=>x.category==='新會員加入');
 if(c)grantMemberBonus(member,c,'新會員加入');
}
function memberBonusPaymentMethods(campaign){
 const arr=Array.isArray(campaign?.paymentMethods)?campaign.paymentMethods.map(v=>String(v||'').trim()).filter(Boolean):[];
 if(arr.length)return arr;
 const legacy=String(campaign?.paymentMethod||'不限').trim()||'不限';
 return legacy.includes('、')?legacy.split('、').map(v=>v.trim()).filter(Boolean):[legacy];
}
function memberBonusPaymentMatches(campaign,payment){
 const methods=memberBonusPaymentMethods(campaign);
 if(!methods.length||methods.includes('不限'))return true;
 return methods.includes(String(payment||'').trim());
}
function campaignMatchesSale(c,sale){
 const total=Number(sale.total||0);if(Number(c.minSpend||0)>total)return false;
 const pay=String(sale.payment||'');if(!memberBonusPaymentMatches(c,pay))return false;
 const target=String(c.target||'').trim();const items=sale.items||[];
 if(c.category==='指定支付方式滿額')return true;
 if(c.category==='指定商品消費')return !!target&&items.some(x=>[x.id,x.code,x.barcode,x.name].some(v=>String(v||'').trim()===target));
 if(c.category==='指定品群消費')return !!target&&items.some(x=>String(x.category||x.group||'').trim()===target);
 if(c.category==='會員生日'){const m=load(K.members,[]).find(x=>x.id===sale.memberId);if(!m?.birthday)return false;return String(m.birthday).slice(5,10)===new Date().toISOString().slice(5,10)}
 if(c.category==='新會員加入')return false;
 return true;
}
function applyMemberBenefitsAfterSale(sale,redeemPoints=0,redeemAmount=0){
 if(!sale?.memberId||sale.serviceSale||!(sale.items||[]).length||Number(sale.total||0)<=0)return;
 const pointItems=(sale.items||[]).filter(x=>x?.appAnybuyRedeem!==true&&x?.pointsEligible!==false);
 const pointEligibleTotal=Math.max(0,pointItems.reduce((sum,x)=>sum+Number(x.price||0)*Math.max(0,Number(x.qty||0)-Number(x.returnedQty||0)),0)-Number(sale.discountTotal||0));
 const pointSale={...sale,total:pointEligibleTotal,netTotal:pointEligibleTotal,items:pointItems};
 const members=load(K.members,[]),m=members.find(x=>x.id===sale.memberId);if(!m)return;
 m.pointLedger=Array.isArray(m.pointLedger)?m.pointLedger:[];
 const pointsBefore=Number(m.points||0);
 if(Number(redeemPoints||0)>0){
  m.points=Math.max(0,Number(m.points||0)-Number(redeemPoints));
  m.pointLedger.unshift({id:'PT'+Date.now()+'R',type:'折抵',points:-Number(redeemPoints),amount:Number(redeemAmount||0),source:`交易 ${sale.id}`,at:new Date().toISOString()});
  sale.memberRedeemPoints=Number(redeemPoints);
  sale.memberRedeemAmount=Number(redeemAmount||0);
 }
 const cfg=pointSettings(),earnAmount=Math.max(1,Number(cfg.earnAmount||1)),earnPoints=Math.max(0,Number(cfg.earnPoints||0));
 const earned=Math.floor(Number(pointEligibleTotal||0)/earnAmount)*earnPoints;
 if(earned>0){
  m.points=Number(m.points||0)+earned;
  m.pointLedger.unshift({id:'PT'+Date.now()+'E',type:'消費累點',points:earned,source:`交易 ${sale.id}`,at:new Date().toISOString()});
  sale.memberEarnedPoints=earned;
 }
 const campaigns=pointEligibleTotal>0?activeMemberBonusCampaigns().filter(c=>campaignMatchesSale(c,pointSale)):[];
 sale.memberBonusAwards=campaigns.map(c=>({
  campaignId:c.id,campaignName:c.name,points:Number(c.bonusPoints||0),
  minSpend:Number(c.minSpend||0),category:c.category||c.type||'',
  paymentMethod:c.paymentMethod||'不限',target:c.target||'',
  startDate:c.startDate||'',endDate:c.endDate||''
 }));
 for(const c of campaigns){
  m.points=Number(m.points||0)+Number(c.bonusPoints||0);
  m.pointLedger.unshift({id:'PT'+Date.now()+Math.random().toString(36).slice(2,5),type:'贈點',points:Number(c.bonusPoints||0),campaignId:c.id,campaignName:c.name,source:`交易 ${sale.id}`,at:new Date().toISOString(),expiryDate:memberPointExpiryDate(c)});
 }
 const bonusPoints=campaigns.reduce((n,c)=>n+Number(c.bonusPoints||0),0);
 sale.memberBonusPoints=bonusPoints;
 sale.memberPointEligibleAmount=pointEligibleTotal;
 sale.memberPointsRule=anybuyRedeemLines(sale).length&&!pointItems.length?'隨買兌換不累點':(anybuyPurchaseLines(sale).length?'隨買購買累點':'一般交易累點');
 sale.memberAddedPoints=Number(earned||0)+bonusPoints;
 sale.memberPointsBefore=pointsBefore;
 sale.memberPointsAfter=Number(m.points||0);
 m.updatedAt=new Date().toISOString();
 save(K.members,members);

 const sales=load(K.sales,[]),saved=sales.find(x=>x.id===sale.id);
 if(saved){
  saved.memberEarnedPoints=sale.memberEarnedPoints||0;
  saved.memberBonusPoints=sale.memberBonusPoints||0;
  saved.memberBonusAwards=Array.isArray(sale.memberBonusAwards)?sale.memberBonusAwards:[];
  saved.memberAddedPoints=sale.memberAddedPoints||0;
  saved.memberPointEligibleAmount=Number(sale.memberPointEligibleAmount||0);
  saved.memberPointsRule=sale.memberPointsRule||'';
  saved.memberRedeemPoints=sale.memberRedeemPoints||0;
  saved.memberRedeemAmount=sale.memberRedeemAmount||0;
  saved.memberPointsBefore=sale.memberPointsBefore;
  saved.memberPointsAfter=sale.memberPointsAfter;
  save(K.sales,sales);
 }
 saveAudit('會員點數結算',`${m.name||m.id}｜累點 ${earned}｜活動贈點 ${bonusPoints}｜折抵 ${Number(redeemPoints||0)}點/${money(Number(redeemAmount||0))}｜目前 ${m.points}點`);
}


function saleRemainingForMemberRules(sale){
 const total=Math.max(0,Number(sale?.netTotal??sale?.total??0));
 const items=(sale?.items||[]).map(x=>({...x,qty:Math.max(0,Number(x.qty||0)-Number(x.returnedQty||0))})).filter(x=>Number(x.qty||0)>0);
 return {...sale,total,netTotal:total,items};
}
function memberBonusAwardSnapshots(sale,member){
 const saved=Array.isArray(sale?.memberBonusAwards)?sale.memberBonusAwards:[];
 if(saved.length)return saved;
 const ledger=Array.isArray(member?.pointLedger)?member.pointLedger:[];
 const rows=ledger.filter(x=>x.type==='贈點'&&x.points>0&&String(x.source||'')===`交易 ${sale.id}`);
 const campaigns=memberBonusCampaignRows();
 return rows.map(x=>{
  const c=campaigns.find(v=>String(v.id||'')===String(x.campaignId||''))||{};
  return {campaignId:x.campaignId||c.id||'',campaignName:x.campaignName||c.name||'活動贈點',points:Number(x.points||0),
   minSpend:Number(c.minSpend||0),category:c.category||c.type||'',paymentMethods:memberBonusPaymentMethods(c),paymentMethod:c.paymentMethod||'不限',target:c.target||'',
   startDate:c.startDate||'',endDate:c.endDate||''};
 });
}
function bonusAwardStillQualifies(award,sale){
 const adjusted=saleRemainingForMemberRules(sale);
 if(Number(award.minSpend||0)>Number(adjusted.total||0))return false;
 if(!memberBonusPaymentMatches(award,adjusted.payment||''))return false;
 const target=String(award.target||'').trim(),items=adjusted.items||[];
 if(award.category==='指定商品消費')return !!target&&items.some(x=>[x.id,x.code,x.barcode,x.name].some(v=>String(v||'').trim()===target));
 if(award.category==='指定品群消費')return !!target&&items.some(x=>String(x.category||x.group||'').trim()===target);
 return true;
}
function reconcileMemberPointsAfterReturn(saleId){
 const sales=load(K.sales,[]),sale=sales.find(x=>x.id===saleId);
 if(!sale?.memberId||sale.serviceSale)return sale;
 const members=load(K.members,[]),m=members.find(x=>x.id===sale.memberId);if(!m)return sale;
 m.pointLedger=Array.isArray(m.pointLedger)?m.pointLedger:[];
 const adjustedTotal=Math.max(0,Number(sale.netTotal??sale.total??0));
 const originalTotal=Math.max(0,Number(sale.total||0));
 const cfg=pointSettings(),earnAmount=Math.max(1,Number(cfg.earnAmount||1)),earnPoints=Math.max(0,Number(cfg.earnPoints||0));
 const originalEarn=Math.max(0,Number(sale.memberEarnedPoints||0));
 const keepEarn=Math.min(originalEarn,Math.floor(adjustedTotal/earnAmount)*earnPoints);
 const desiredEarnDeduct=Math.max(0,originalEarn-keepEarn);
 const prevEarnDeduct=Math.max(0,Number(sale.memberReturnEarnDeductPoints||0));
 const earnDeduct=Math.max(0,desiredEarnDeduct-prevEarnDeduct);

 let bonusDeduct=0;
 const revoked=new Set(Array.isArray(sale.memberRevokedCampaignIds)?sale.memberRevokedCampaignIds:[]);
 const awards=memberBonusAwardSnapshots(sale,m);
 for(const award of awards){
  const key=String(award.campaignId||award.campaignName||'bonus');
  if(revoked.has(key))continue;
  if(!bonusAwardStillQualifies(award,sale)){
   const pts=Math.max(0,Number(award.points||0));
   if(pts>0){
    bonusDeduct+=pts;revoked.add(key);
    m.pointLedger.unshift({id:'PT'+Date.now()+Math.random().toString(36).slice(2,6),type:'退貨扣回加贈',points:-pts,
     campaignId:award.campaignId||'',campaignName:award.campaignName||'',source:`退貨 ${sale.id}`,at:new Date().toISOString()});
   }
  }
 }
 if(earnDeduct>0){
  m.pointLedger.unshift({id:'PT'+Date.now()+'D',type:'退貨扣回累點',points:-earnDeduct,source:`退貨 ${sale.id}`,at:new Date().toISOString()});
 }

 const origRedeem=Math.max(0,Number(sale.memberRedeemPoints||0));
 const prevRedeemRestore=Math.max(0,Number(sale.memberRedeemRestoredPoints||0));
 const desiredRedeemRestore=origRedeem>0&&originalTotal>0
  ?Math.min(origRedeem,adjustedTotal<=0?origRedeem:Math.floor(origRedeem*(1-adjustedTotal/originalTotal)))
  :0;
 const redeemRestore=Math.max(0,desiredRedeemRestore-prevRedeemRestore);
 if(redeemRestore>0){
  m.pointLedger.unshift({id:'PT'+Date.now()+'B',type:'退貨退回折抵',points:redeemRestore,source:`退貨 ${sale.id}`,at:new Date().toISOString()});
 }

 // 全數扣回允許形成負點，避免會員先把點數用掉後退貨卻無法回收。
 m.points=Number(m.points||0)-earnDeduct-bonusDeduct+redeemRestore;
 m.updatedAt=new Date().toISOString();

 sale.memberReturnEarnDeductPoints=prevEarnDeduct+earnDeduct;
 sale.memberReturnBonusDeductPoints=Math.max(0,Number(sale.memberReturnBonusDeductPoints||0))+bonusDeduct;
 sale.memberReturnDeductPoints=Number(sale.memberReturnEarnDeductPoints||0)+Number(sale.memberReturnBonusDeductPoints||0);
 sale.memberRedeemRestoredPoints=prevRedeemRestore+redeemRestore;
 sale.memberRevokedCampaignIds=[...revoked];
 sale.memberPointsAfter=Number(m.points||0);
 const h=(sale.correctionHistory||[])[0];
 if(h){
  h.memberPoints={earnDeduct,bonusDeduct,redeemRestore,pointsAfter:sale.memberPointsAfter};
 }
 save(K.members,members);save(K.sales,sales);
 saveAudit('退貨點數調整',`${m.name||m.id}｜${sale.id}｜累點扣回 ${earnDeduct}｜加贈扣回 ${bonusDeduct}｜折抵退回 ${redeemRestore}｜目前 ${m.points}`);
 return sale;
}

function cloudSyncPanel(){
 const c=getCloudConfig(),s=cloudStatus(),canEdit=hasPermission('cloudRemoteSync');
 const configured=cloudConfigured();
 const stateLabel=s.state==='online'?'🟢 已連線':s.state==='syncing'?'🟡 同步中':s.state==='error'?'🔴 錯誤':configured?'🟠 已設定':'⚪ 未設定';
 if(!canEdit)return '';
 return `<div class="panel cloud-sync-panel" style="margin-top:14px">
  <div class="page-head"><h3>☁️ Supabase 雲端同步</h3><div class="cloud-state">${stateLabel}</div></div>
  <p class="setting-hint">同步店號自動跟隨目前門市。TM 各店營運資料互不共用；僅商品主檔（庫存除外）、總部商品活動、會員資料為全店共用。</p>
  <div class="settings-grid">
   <label>Project URL<input id="cloudUrl" placeholder="https://xxxx.supabase.co" value="${esc(c.url||'')}"></label>
   <label>anon public key<input id="cloudAnonKey" type="password" value="${esc(c.anonKey||'')}"></label>
   <label>同步店號<input id="cloudStoreId" value="${esc(currentStoreCode())}" readonly><small>自動跟隨目前門市，不需手動修改</small></label>
   <label class="check-field"><input id="cloudRememberCredentials" type="checkbox" ${c.rememberCredentials===false?'':'checked'}>記住 Project URL 與 anon public key（此裝置）</label>
   <label class="check-field"><input id="cloudEnabled" type="checkbox" ${c.enabled===false?'':'checked'}>啟用雲端同步</label>
  </div>
  <div class="toolbar cloud-actions">
   <button class="primary" data-action="cloud-save">儲存雲端設定</button>
   <button class="button" data-action="cloud-test">測試連線</button>
   <button class="button" data-action="cloud-push-all">⬆️ 將本機資料上傳雲端</button>
   <button class="button" data-action="cloud-pull-all">⬇️ 從雲端下載到本機</button>
  </div>
  <div class="cloud-status-detail">
   <b>狀態：</b>${esc(s.message||'尚未同步')}
   ${s.lastPushAt?`<br>最近自動上傳：${new Date(s.lastPushAt).toLocaleString('zh-TW')}`:''}
   ${s.lastPullAt?`<br>最近下載：${new Date(s.lastPullAt).toLocaleString('zh-TW')}`:''}
   ${s.error?`<br><span class="cloud-error">${esc(s.error)}</span>`:''}
  </div>
 </div>`;
}

function readCloudForm(){
 return {
  url:document.querySelector('#cloudUrl')?.value||'',
  anonKey:document.querySelector('#cloudAnonKey')?.value||'',
  storeId:currentStoreCode(),
  rememberCredentials:document.querySelector('#cloudRememberCredentials')?.checked!==false,
  enabled:document.querySelector('#cloudEnabled')?.checked!==false
 };
}


function addManualTaxAmount(taxType){
 const label=taxType==='免稅'?'免稅金額':'應稅金額';
 const raw=prompt(`輸入${label}`,'');
 if(raw===null)return;
 const amount=Number(String(raw).replace(/,/g,''));
 if(!Number.isFinite(amount)||amount<=0)return alert('請輸入大於 0 的金額');
 state.lastCompletedSale=null;
 state.cart.push({
  id:`MAN-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
  code:'',name:label,price:Math.round(amount*100)/100,qty:1,
  manualAmount:true,taxType,category:'手動金額',group:'手動金額',
  allowNegativeStock:true,active:true,status:'啟用'
 });
 state.selected=state.cart[state.cart.length-1].id;
 render('pos');
}

function tmOrderBatchValues(order){
 const out=[];
 const add=v=>{const x=String(v||'').trim();if(x&&!out.includes(x))out.push(x)};
 String(order?.batchNo||order?.batch_no||'').split('、').forEach(add);
 for(const x of (Array.isArray(order?.batches)?order.batches:[]))add(x?.batchNo||x?.batch_no);
 return out;
}
function tmOrderForBatch(batchNo){
 const batch=String(batchNo||'').trim();
 if(!batch)return null;
 return (load(K.orders,[])||[]).find(o=>tmOrderBatchValues(o).includes(batch))||null;
}
function tmBatchMeta(order,batchNo){
 const batch=String(batchNo||'').trim();
 return (Array.isArray(order?.batches)?order.batches:[]).find(x=>String(x?.batchNo||x?.batch_no||'').trim()===batch)||null;
}
function tmLegacySplitBatchSet(){
 const orders=load(K.orders,[])||[];
 const groups=new Map();
 for(const o of orders){
  for(const b of (Array.isArray(o?.batches)?o.batches:[])){
   const batch=String(b?.batchNo||b?.batch_no||'').trim();
   if(!batch||b?.mergedShipment)continue;
   const type=String(b?.deliveryType||b?.cloudDeliveryType||o?.deliveryType||'').trim();
   const date=String(b?.deliveryDate||o?.deliveryDate||'').slice(0,10);
   const period=String(b?.arrivalPeriod||'').trim();
   if(!type||!date)continue;
   const key=`${type}@@${date}@@${period}`;
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(batch);
  }
 }
 const hidden=new Set();
 for(const arr of groups.values()){
  const unique=[...new Set(arr)];
  if(unique.length>1)unique.forEach(x=>hidden.add(x));
 }
 return hidden;
}
function tmPendingBatchLabel(row){
 const batch=String(row?.batch_no||'').trim();
 const order=tmOrderForBatch(batch);
 const meta=tmBatchMeta(order,batch);
 const type=deliveryTypeZh(row?.delivery_type||meta?.cloudDeliveryType||meta?.deliveryType||order?.deliveryType||'');
 const merged=!!meta?.mergedShipment;
 const sourceOrders=Array.isArray(meta?.mergedSourceOrders)?meta.mergedSourceOrders.filter(Boolean):[];
 const source=merged
  ? `合併貨單${sourceOrders.length?`（${sourceOrders.length}張訂購）`:''}`
  : String(row?.external_ref||row?.source||order?.id||'待到店');
 return `${batch}｜${type||'—'}｜${source}`;
}
function tmFindOrderForBatch(batchNo,externalRef=''){
 const batch=String(batchNo||'').trim(),ref=String(externalRef||'').trim();
 const orders=load(K.orders,[]);
 if(ref){
  const exact=orders.find(o=>String(o.id||'').trim()===ref);if(exact)return exact;
  const pref=orders.filter(o=>ref.startsWith(`${String(o.id||'').trim()}-`)).sort((a,b)=>String(b.id||'').length-String(a.id||'').length)[0];if(pref)return pref;
 }
 return orders.find(o=>tmOrderBatchValues(o).includes(batch))||null;
}
function tmFallbackReceipt(batchNo,resolved=null){
 const batch=String(batchNo||resolved?.batch_no||'').trim();if(!batch)return null;
 const order=tmFindOrderForBatch(batch,resolved?.external_ref||resolved?.source_ref||'');if(!order)return null;
 const meta=tmBatchMeta(order,batch);
 return {
  batch_no:batch,
  receipt_no:String(resolved?.receipt_no||'').trim(),
  order_no:String(order.id||''),
  delivery_type:resolved?.delivery_type||meta?.cloudDeliveryType||meta?.deliveryType||order.deliveryType||'',
  status:resolved?.status||'pending',
  source:resolved?.source||'ordering',
  virtual_order_fallback:true,
  items:(order.items||[]).filter(x=>Number(x.qty||0)>0).map((x,i)=>({
   ...x,line_no:i+1,product_id:x.productId||x.product_id||'',product_code:x.code||x.product_code||'',
   product_name:x.name||x.product_name||'',ordered_qty:Number(x.qty||0),notice_qty:Number(x.qty||0)
  }))
 };
}

function openReceivingReceiptAcceptance(initialCode=''){
 dlg('進貨驗收',`
  <div class="receiving-acceptance">
   <div class="notice"><b>貨單驗收（獨立作業）</b><br>物流簽到與進貨驗收分開處理。本頁只做驗收；未完成物流簽到的貨單不可驗收。</div>
   <label>選擇待驗收貨單
    <select id="receiptAcceptanceSelect"><option value="">— 請選擇已簽到、待驗收貨單 —</option></select>
   </label>
   <label>貨單專用簽到條碼
    <div class="receiving-combo-row">
     <input id="receiptAcceptanceCode" value="${esc(initialCode)}" placeholder="掃描 YJB...／YJIN... 或輸入貨單號" autocomplete="off">
     <button type="button" class="button" id="receiptAcceptanceScan">掃描</button>
     <button type="button" class="primary" id="receiptAcceptanceFind">讀取貨單</button>
    </div>
   </label>
   <div id="receiptAcceptanceSummary" class="receiving-product-preview">尚未讀取貨單</div>
   <div id="receiptAcceptanceBody"></div>
  </div>`);
 setTimeout(()=>{
  const codeEl=document.querySelector('#receiptAcceptanceCode');
  const receiptSelect=document.querySelector('#receiptAcceptanceSelect');
  const summary=document.querySelector('#receiptAcceptanceSummary');
  const body=document.querySelector('#receiptAcceptanceBody');
  let resolved=null,receipt=null;
  const refreshAcceptanceSelect=()=>{
   if(!receiptSelect)return;
   const completed=new Set(load(K.receivingInspections,[]).filter(x=>x?.recordKind==='receipt-completion'&&String(x.storeCode||'001')===currentStoreCode()).map(x=>String(x.batchNo||'').trim()).filter(Boolean));
   const seen=new Set();
   const rows=load(K.logistics,[]).filter(x=>x&&x.status==='已到店').map(x=>{
    const batch=String(x.batchNo||x.batch_no||'').trim();
    const receiptNo=String(x.receiptNo||x.receipt_no||'').trim();
    const source=String(x.source||x.deliveryType||x.delivery_type||x.logistics||'').trim();
    return {batch,receiptNo,source};
   }).filter(x=>x.batch&&!completed.has(x.batch)&&!seen.has(x.batch)&&(seen.add(x.batch),true));
   receiptSelect.innerHTML='<option value="">— 請選擇已簽到、待驗收貨單 —</option>'+rows.map(x=>`<option value="${esc(x.batch)}">${esc(x.batch)}${x.receiptNo?`｜${esc(x.receiptNo)}`:''}${x.source?`｜${esc(x.source)}`:''}</option>`).join('');
   if(!rows.length)receiptSelect.innerHTML='<option value="">— 目前沒有已簽到待驗收貨單 —</option>';
  };
  refreshAcceptanceSelect();
  const findLocalProduct=item=>{
   const ps=products();
   return ps.find(x=>String(x.id||'')===String(item.product_id||''))
    ||ps.find(x=>String(x.code||'').trim()===String(item.product_code||'').trim())
    ||ps.find(x=>productBarcodes(x).includes(String(item.barcode||'').trim()))||null;
  };
  const renderReceipt=()=>{
   const items=Array.isArray(receipt?.items)?receipt.items:[];
   const ref=receipt?.receipt_no||resolved?.receipt_no||receipt?.batch_no||resolved?.batch_no||'';
   const batchKey=String(receipt?.batch_no||resolved?.batch_no||'').trim();
   const completedMarker=load(K.receivingInspections,[]).find(x=>x.recordKind==='receipt-completion'&&String(x.batchNo||'').trim()===batchKey&&String(x.storeCode||'001')===currentStoreCode());
   summary.innerHTML=`<b>${esc(ref||'貨單')}</b><span>批次：${esc(batchKey||'—')}｜來源：${esc(receipt?.source||resolved?.source||'—')}｜狀態：${completedMarker?'已驗收':esc(receipt?.status||resolved?.status||'待驗收')}</span>${completedMarker?`<span>驗收時間：${new Date(completedMarker.at).toLocaleString('zh-TW')}｜${esc(completedMarker.user||'')}</span>`:''}`;
   body.innerHTML=`
    <div class="receiving-acceptance-toolbar">
     <button type="button" class="button" id="receiptAcceptAll">全部符合</button>
     <button type="button" class="button" id="receiptAddMisdelivery">＋ 誤配商品</button>
     <button type="button" class="button" id="receiptAcceptanceHistory">驗收紀錄</button>
    </div>
    <div class="table-wrap"><table class="table receiving-acceptance-table">
     <thead><tr><th>商品代號</th><th>品名</th><th>應到</th><th>實到</th><th>差異</th><th>狀態</th></tr></thead>
     <tbody>${items.map((i,idx)=>{
      const expected=Math.max(0,Number(i.qty||0));
      return `<tr data-receipt-line="${idx}"><td>${esc(i.product_code||'—')}</td><td>${esc(i.product_name||findLocalProduct(i)?.name||'—')}</td><td class="expected">${expected}</td><td><input class="actual" type="number" min="0" step="1" inputmode="numeric" value="${expected}"></td><td class="diff">0</td><td><select class="issue"><option value="正常">正常</option><option value="欠品">欠品</option><option value="污損">污損</option></select></td></tr>`;
     }).join('')||'<tr><td colspan="6">此貨單目前沒有商品明細；請先在 SC 重新整理物流並確認訂購已傳輸。</td></tr>'}</tbody>
    </table></div>
    <label>整張貨單備註<textarea id="receiptAcceptanceNote" rows="2" placeholder="可留空"></textarea></label>
    <button type="button" class="primary receipt-complete-button" id="receiptAcceptanceComplete" ${items.length&&!completedMarker?'':'disabled'}>${completedMarker?'此貨單已完成驗收':'完成驗收並入庫'}</button>`;
   const refreshLine=row=>{
    const expected=Number(row.querySelector('.expected')?.textContent||0);
    const actual=Math.max(0,Math.floor(Number(row.querySelector('.actual')?.value||0)));
    const diff=actual-expected;
    row.querySelector('.diff').textContent=diff>0?`+${diff}`:String(diff);
    const issue=row.querySelector('.issue');
    if(issue&&issue.value==='正常'&&actual<expected)issue.value='欠品';
    if(issue&&actual===expected&&issue.value==='欠品')issue.value='正常';
   };
   body.querySelectorAll('[data-receipt-line]').forEach(row=>{
    row.querySelector('.actual').oninput=()=>refreshLine(row);
    row.querySelector('.issue').onchange=()=>refreshLine(row);
   });
   document.querySelector('#receiptAcceptAll').onclick=()=>body.querySelectorAll('[data-receipt-line]').forEach(row=>{
    row.querySelector('.actual').value=row.querySelector('.expected').textContent;
    row.querySelector('.issue').value='正常';refreshLine(row);
   });
   document.querySelector('#receiptAddMisdelivery').onclick=()=>openReceivingInspection('誤配',ref);
   document.querySelector('#receiptAcceptanceHistory').onclick=openReceivingInspectionHistory;
   document.querySelector('#receiptAcceptanceComplete').onclick=async()=>{
    if(completedMarker)return alert('此貨單已完成驗收，不能重複入庫');
    const btn=document.querySelector('#receiptAcceptanceComplete');
    const lines=[...body.querySelectorAll('[data-receipt-line]')];
    if(!lines.length)return alert('此貨單沒有可驗收的商品明細');
    const adjustedItems=[];
    const anomalyRows=load(K.receivingInspections,[]);
    const now=new Date().toISOString();
    lines.forEach((row,idx)=>{
     const src=items[idx]||{};
     const expected=Math.max(0,Number(src.qty||0));
     const actual=Math.max(0,Math.floor(Number(row.querySelector('.actual')?.value||0)));
     const issue=row.querySelector('.issue')?.value||'正常';
     adjustedItems.push({...src,qty:actual,expected_qty:expected,actual_qty:actual,inspection_status:issue});
     if(issue!=='正常'||actual!==expected){
      anomalyRows.unshift({id:uid(),type:issue==='正常'?(actual<expected?'欠品':'數量差異'):issue,reference:ref,productId:src.product_id||'',productCode:src.product_code||'',barcode:src.barcode||'',name:src.product_name||'',qty:Math.abs(actual-expected)||Math.max(1,expected-actual),expectedQty:expected,actualQty:actual,note:`貨單驗收：應到 ${expected}／實到 ${actual}`,adjustStock:false,storeCode:currentStoreCode(),user:currentUser().name,userAccount:String(currentUser()?.account||''),at:now,status:'驗收完成'});
     }
    });
    if(btn){btn.disabled=true;btn.textContent='完成驗收中…'}
    try{
     const batch=String(receipt?.batch_no||resolved?.batch_no||'').trim();
     if(!batch)throw new Error('找不到貨單批次號');
     const completed=await posCompleteInventoryReceipt(batch,currentUser()?.name||'');
     const inbound={...(completed||receipt),items:adjustedItems};
     const applied=applyReceiptItemsToLocalInventory(inbound);
     const differenceCount=anomalyRows.filter(x=>x.at===now&&x.recordKind!=='receipt-completion').length;
     anomalyRows.unshift({id:uid(),recordKind:'receipt-completion',type:'完成驗收',reference:ref,batchNo:batch,qty:adjustedItems.reduce((a,x)=>a+Number(x.qty||0),0),storeCode:currentStoreCode(),user:currentUser().name,userAccount:String(currentUser()?.account||''),at:now,status:'已驗收'});
     save(K.receivingInspections,anomalyRows);
     saveAudit('進貨驗收完成',`${ref||batch}｜實到 ${adjustedItems.reduce((a,x)=>a+Number(x.qty||0),0)} 件｜差異 ${differenceCount} 筆`);
     genericDialog.close();
     let msg=`進貨驗收完成\n${ref||batch}\n實際入庫 ${applied.totalQty} 件`;
     if(applied.freshBatchCount)msg+=`\n自動新增鮮食批次 ${applied.freshBatchCount} 批（${applied.freshBatchQty} 件）`;
     if(applied.missing.length)msg+=`\n未匹配商品：${applied.missing.join('、')}`;
     alert(msg);
     render('pos');
    }catch(err){if(btn){btn.disabled=false;btn.textContent='完成驗收並入庫'}alert('完成驗收失敗：'+err.message)}
   };
  };
  const loadReceipt=async()=>{
   const code=String(codeEl?.value||'').trim();
   if(!code)return alert('請掃描或輸入貨單專用條碼');
   if(!cloudConfigured())return alert('TM 尚未設定 Supabase，請先到「雲端與更新」完成設定');
   summary.textContent='讀取貨單中…';body.innerHTML='';
   try{
    resolved=await posResolveReceivingCode(code);
    const batch=String(resolved?.batch_no||code).trim();
    try{if(cloudConfigured())await cloudPullKey(K.orders)}catch(e){console.warn('TM 驗收前訂購同步失敗',e)}
    receipt=await posGetInventoryReceiptDetails(batch);
    if(!receipt&&resolved?.batch_no&&String(resolved.batch_no)!==code)receipt=await posGetInventoryReceiptDetails(code);
    if(!receipt)receipt=tmFallbackReceipt(batch,resolved);
    if(!receipt)throw new Error(resolved?'找到物流批次，但沒有對應進貨單／訂購明細':'找不到這張貨單，請確認條碼與店號');
    resolved=resolved||{batch_no:receipt.batch_no,receipt_no:receipt.receipt_no,status:receipt.status,source:receipt.source};
    // Alpha 7.69：物流簽到與進貨驗收完全分開。驗收只接受已完成物流簽到的貨單。
    const signedBatch=String(receipt?.batch_no||resolved?.batch_no||'').trim();
    const signedReceipt=String(receipt?.receipt_no||resolved?.receipt_no||'').trim();
    const signed=load(K.logistics,[]).some(x=>x&&x.status==='已到店'&&(
      String(x.batchNo||x.batch_no||'').trim()===signedBatch ||
      (signedReceipt&&String(x.receiptNo||x.receipt_no||'').trim()===signedReceipt)
    ));
    if(!signed)throw new Error('此貨單尚未完成物流簽到，請先到「管理 → 物流簽到」完成簽到後，再另外進行驗收');
    renderReceipt();
   }catch(err){summary.innerHTML=`<b>讀取失敗</b><span>${esc(err.message)}</span>`}
  };
  document.querySelector('#receiptAcceptanceFind').onclick=loadReceipt;
  if(receiptSelect)receiptSelect.onchange=()=>{if(receiptSelect.value){codeEl.value=receiptSelect.value;loadReceipt()}};
  document.querySelector('#receiptAcceptanceScan').onclick=()=>scanCode({title:'掃描待驗收貨單條碼',onResult:code=>{codeEl.value=code;loadReceipt()}});
  codeEl.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadReceipt()}};
  if(initialCode)loadReceipt();else codeEl?.focus();
 },0);
}

function receivingInspectionTypeLabel(action){
 return action==='receiving-misdelivery'?'誤配':action==='receiving-damaged'?'污損':'欠品';
}
function openReceivingInspection(type,defaultRef=''){
 const ps=products().filter(x=>productStatusLabel(x)!=='停用');
 const rows=load(K.receivingInspections,[]);
 let currentType=['誤配','污損','欠品'].includes(type)?type:'誤配';
 const recentRefs=[
  ...load(K.logistics,[]).map(x=>String(x.receiptNo||x.receipt_no||x.batchNo||x.batch_no||x.id||'').trim()),
  ...load(K.orders,[]).map(x=>String(x.id||'').trim())
 ].filter(Boolean);
 const refOptions=[...new Set(recentRefs)].slice(0,30);
 dlg('進貨商品驗收',`
  <div class="receiving-inspection-form">
   <label>進貨商品驗收
    <select id="receivingType">
     ${['誤配','污損','欠品'].map(x=>`<option value="${x}" ${x===currentType?'selected':''}>${x}</option>`).join('')}
    </select>
   </label>
   <div class="notice" id="receivingTypeNotice"><b>${esc(currentType)}</b>：請輸入本次進貨驗收異常商品與數量。</div>

   <label>貨單／進貨單號
    <div class="receiving-combo-row">
     <select id="receivingRefSelect">
      <option value="">下拉選擇近期貨單／進貨單號</option>
      ${refOptions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}
     </select>
     <input id="receivingRef" value="${esc(defaultRef)}" placeholder="或手動輸入貨單／進貨單號">
     <button type="button" class="button" id="receivingRefScan">掃描</button>
    </div>
   </label>

   <label>商品
    <div class="receiving-combo-row">
     <select id="receivingProductSelect">
      <option value="">下拉選擇商品</option>
      ${ps.map(p=>`<option value="${esc(p.id)}">${esc(p.code||'—')}｜${esc(p.name)}｜${esc(productBarcodes(p)[0]||'無條碼')}</option>`).join('')}
     </select>
     <input id="receivingProductInput" placeholder="或輸入條碼／商品代號／品名">
     <button type="button" class="button" id="receivingProductScan">掃描</button>
    </div>
   </label>
   <div id="receivingProductPreview" class="receiving-product-preview">尚未選擇商品</div>
   <label>異常數量<input id="receivingQty" type="number" min="1" value="1" inputmode="numeric"></label>
   <label>備註<textarea id="receivingNote" rows="3" placeholder="${currentType==='誤配'?'例如：送錯品項／非本店訂購商品':currentType==='污損'?'例如：外箱破損、內容物滲漏':'例如：通知 10 件，實收 8 件'}"></textarea></label>
   <label class="receiving-stock-option"><input id="receivingAdjustStock" type="checkbox"> 此異常商品已經入庫，驗收送出時同步扣回庫存</label>
   <div class="receiving-inspection-actions">
    <button type="button" class="button" id="receivingHistory">驗收紀錄</button>
    <button type="button" class="primary" id="receivingSubmit">確認登錄</button>
   </div>
  </div>`);
 setTimeout(()=>{
  let selected=null;
  const typeSelect=document.querySelector('#receivingType');
  const typeNotice=document.querySelector('#receivingTypeNotice');
  const noteInput=document.querySelector('#receivingNote');
  const syncTypeUi=()=>{
   currentType=typeSelect?.value||'誤配';
   if(typeNotice)typeNotice.innerHTML=`<b>${esc(currentType)}</b>：請輸入本次進貨驗收異常商品與數量。`;
   if(noteInput)noteInput.placeholder=currentType==='誤配'?'例如：送錯品項／非本店訂購商品':currentType==='污損'?'例如：外箱破損、內容物滲漏':'例如：通知 10 件，實收 8 件';
  };
  if(typeSelect)typeSelect.onchange=syncTypeUi;
  syncTypeUi();
  const input=document.querySelector('#receivingProductInput');
  const productSelect=document.querySelector('#receivingProductSelect');
  const refSelect=document.querySelector('#receivingRefSelect');
  const refInput=document.querySelector('#receivingRef');
  const preview=document.querySelector('#receivingProductPreview');
  const findProduct=q=>{
   q=String(q||'').trim().toLowerCase();
   if(!q)return null;
   return ps.find(p=>String(p.code||'').toLowerCase()===q||productBarcodes(p).some(b=>String(b).toLowerCase()===q))
    ||ps.find(p=>String(p.name||'').toLowerCase().includes(q))||null;
  };
  const selectProduct=q=>{
   selected=findProduct(q);
   preview.innerHTML=selected
    ? `<b>${esc(selected.name)}</b><span>${esc(selected.code||'')}｜${esc(productBarcodes(selected)[0]||'無條碼')}｜目前庫存 ${Number(selected.stock||0)}</span>`
    : '找不到商品';
   if(selected&&productSelect)productSelect.value=selected.id;
  };
  if(productSelect)productSelect.onchange=()=>{
   const p=ps.find(x=>String(x.id)===String(productSelect.value));
   selected=p||null;
   if(p){
    input.value=p.code||productBarcodes(p)[0]||p.name||'';
    preview.innerHTML=`<b>${esc(p.name)}</b><span>${esc(p.code||'')}｜${esc(productBarcodes(p)[0]||'無條碼')}｜目前庫存 ${Number(p.stock||0)}</span>`;
   }else{
    input.value='';
    preview.textContent='尚未選擇商品';
   }
  };
  if(refSelect)refSelect.onchange=()=>{
   if(refSelect.value&&refInput)refInput.value=refSelect.value;
  };
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();selectProduct(input.value)}};
  input.onchange=()=>selectProduct(input.value);
  document.querySelector('#receivingProductScan').onclick=()=>scanCode({title:`掃描${currentType}商品`,onResult:code=>{input.value=code;selectProduct(code)}});
  document.querySelector('#receivingRefScan').onclick=()=>scanCode({title:'掃描貨單／進貨單號',onResult:code=>{
   if(refInput)refInput.value=code;
   if(refSelect&&[...refSelect.options].some(o=>o.value===code))refSelect.value=code;
  }});
  document.querySelector('#receivingHistory').onclick=()=>openReceivingInspectionHistory();
  document.querySelector('#receivingSubmit').onclick=()=>{
   if(!selected)selectProduct(input.value);
   if(!selected)return alert('請先選擇商品');
   const qty=Math.max(1,Math.floor(Number(document.querySelector('#receivingQty').value||1)));
   const ref=String(document.querySelector('#receivingRef').value||'').trim();
   const note=String(document.querySelector('#receivingNote').value||'').trim();
   const adjust=!!document.querySelector('#receivingAdjustStock').checked;
   const psAll=load(K.products,[]),p=psAll.find(x=>String(x.id)===String(selected.id));
   if(!p)return alert('找不到商品資料');
   if(adjust&&qty>Number(p.stock||0))return alert(`扣回數量不可大於目前庫存 ${Number(p.stock||0)}`);
   const before=Number(p.stock||0);
   if(adjust){
    p.stock=before-qty;
    save(K.products,psAll);
    const moves=load(K.inventoryMoves,[]);
    moves.unshift({id:uid(),productId:p.id,productName:p.name,qty:-qty,type:`進貨驗收-${currentType}`,reference:ref,user:currentUser().name,at:new Date().toISOString()});
    save(K.inventoryMoves,moves);
   }
   rows.unshift({
    id:uid(),type:currentType,reference:ref,productId:p.id,productCode:p.code||'',
    barcode:productBarcodes(p)[0]||'',name:p.name,qty,note,
    adjustStock:adjust,stockBefore:before,stockAfter:adjust?before-qty:before,
    storeCode:currentStoreCode(),user:currentUser().name,
    userAccount:String(currentUser()?.account||''),at:new Date().toISOString(),
    status:'已登錄'
   });
   save(K.receivingInspections,rows);
   saveAudit('進貨商品驗收',`${currentType}｜${p.name}×${qty}${ref?`｜${ref}`:''}${adjust?`｜庫存 ${before}→${before-qty}`:'｜僅登錄未調庫存'}`);
   genericDialog.close();
   alert(`${currentType}驗收已登錄\n${p.name} × ${qty}`);
  };
  input?.focus();
 },0);
}
function openReceivingInspectionHistory(){
 const rows=load(K.receivingInspections,[]).filter(x=>String(x.storeCode||'001')===currentStoreCode()&&x.recordKind!=='receipt-completion');
 dlg('進貨商品驗收紀錄',`
  <div class="table-wrap"><table class="table">
   <tr><th>時間</th><th>類型</th><th>貨單／進貨單</th><th>商品</th><th>數量</th><th>庫存處理</th><th>操作人</th><th>備註</th></tr>
   ${rows.map(x=>`<tr>
    <td>${new Date(x.at).toLocaleString('zh-TW')}</td>
    <td><b>${esc(x.type||'')}</b></td>
    <td>${esc(x.reference||'—')}</td>
    <td>${esc(x.productCode||'')} ${esc(x.name||'')}</td>
    <td>${Number(x.qty||0)}</td>
    <td>${x.adjustStock?`已扣回 ${Number(x.stockBefore||0)}→${Number(x.stockAfter||0)}`:'僅登錄'}</td>
    <td>${esc(x.user||'')}</td>
    <td>${esc(x.note||'')}</td>
   </tr>`).join('')||'<tr><td colspan="8">尚無驗收異常紀錄</td></tr>'}
  </table></div>`);
}
function showWasteQueryPos(){
 if(!scServiceConnected()){showScDisconnectedNotice('wasteQuery');return;}
 const rows=load(K.waste,[]);
 dlg('廢棄查詢',`<div class="table-wrap"><table class="table"><tr><th>時間</th><th>商品</th><th>數量</th><th>原因</th><th>操作人</th></tr>${rows.map(x=>`<tr><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.name)}</td><td>${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.user||'')}</td></tr>`).join('')||'<tr><td colspan="5">尚無廢棄紀錄</td></tr>'}</table></div>`);
}
function showFreshLookup(kind){
 if(!scServiceConnected()){showScDisconnectedNotice(kind==='expired'?'freshExpired':'freshNear');return;}
 const now=new Date(),ps=products(),productMap=new Map(ps.map(p=>[String(p.id),p]));
 const rows=freshBatches().filter(x=>Number(x.remainingQty||0)>0).map(x=>({...x,status:freshBatchStatus(x)}));
 const filtered=rows.filter(x=>{
  const exp=new Date(x.expiryAt);
  if(kind==='expired')return exp<=now;
  const hours=(exp-now)/3600000;
  return exp>now&&hours<=24;
 });
 dlg(kind==='expired'?'鮮食過期查詢':'鮮食即期查詢',`<div class="table-wrap"><table class="table"><tr><th>商品</th><th>批次</th><th>剩餘</th><th>到期時間</th><th>狀態</th></tr>${filtered.map(x=>`<tr><td>${esc(x.productName||productMap.get(String(x.productId))?.name||'')}</td><td>${esc(x.batchNo||'')}</td><td>${Number(x.remainingQty||0)}</td><td>${new Date(x.expiryAt).toLocaleString('zh-TW')}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="5">目前沒有資料</td></tr>'}</table></div>`);
}
function normalizeVoiceShortcutText(text){
 return String(text||'').trim().replace(/[，。！？、,.!?\s]+/g,'').toLowerCase();
}
function resolveVoiceShortcut(text){
 const t=normalizeVoiceShortcutText(text);
 if(!t)return null;
 const defs=[
  {label:'物流簽到',match:['物流簽到','物流到店','物流'],run:()=>triggerPosAction('logistics')},
  {label:'EC進店',match:['ec進店','ec到店','ec進貨'],run:()=>ecActionDialog('arrival',true)},
  {label:'EC離店',match:['ec離店','ec退貨','ec退回'],run:()=>ecActionDialog('leave',true)},
  {label:'會員查詢',match:['會員查詢','查會員','會員'],run:()=>openPosMemberLookup()},
  {label:'商品查詢',match:['商品查詢','查商品','商品'],run:()=>openProductLookup()},
  {label:'投庫',match:['投庫'],run:()=>triggerPosAction('deposit')},
  {label:'交班',match:['交班'],run:()=>triggerPosAction('handover')},
  {label:'鎖機',match:['鎖機','離櫃鎖機'],run:()=>triggerPosAction('lock-pos')},
  {label:'回首頁',match:['回首頁','返回首頁','首頁'],run:()=>render('front')}
 ];
 return defs.find(d=>d.match.some(k=>t.includes(normalizeVoiceShortcutText(k))))||null;
}
function openVoiceShortcut(){
 dlg('🎙 語音快捷',`<div class="notice"><b>請說出功能名稱</b><br>例如：物流簽到、會員查詢、商品查詢、EC進店、EC離店、投庫、交班、鎖機、回首頁。<br><small>辨識後不會立刻執行，必須再按「執行」。</small></div>
  <label>辨識內容<input id="voiceShortcutText" autocomplete="off" placeholder="請說出指令或手動輸入"></label>
  <div class="toolbar"><button type="button" class="button" id="voiceShortcutListen">🎙 開始聆聽</button><button type="button" class="button" id="voiceShortcutParse">辨識指令</button></div>
  <div id="voiceShortcutResult" class="notice" style="margin-top:10px">尚未辨識指令</div>
  <button type="button" class="primary" id="voiceShortcutExecute" disabled style="width:100%;margin-top:10px">執行</button>`);
 setTimeout(()=>{
  const input=document.querySelector('#voiceShortcutText');
  const listen=document.querySelector('#voiceShortcutListen');
  const parse=document.querySelector('#voiceShortcutParse');
  const result=document.querySelector('#voiceShortcutResult');
  const execute=document.querySelector('#voiceShortcutExecute');
  let pending=null,rec=null;
  const prepare=()=>{
   const raw=String(input?.value||'').trim();
   pending=resolveVoiceShortcut(raw);
   if(!raw){result.textContent='尚未辨識指令';execute.disabled=true;return}
   if(!pending){result.innerHTML=`我聽到：<b>${esc(raw)}</b><br><span class="bad">目前沒有對應的快捷功能。</span>`;execute.disabled=true;return}
   result.innerHTML=`我聽到：<b>${esc(raw)}</b><br>準備執行：<b>${esc(pending.label)}</b>`;
   execute.disabled=false;
  };
  parse.onclick=prepare;
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();prepare()}};
  listen.onclick=()=>{
   const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
   if(!SR){
    result.innerHTML='此瀏覽器目前沒有提供網頁語音辨識。<br>你可以點上方輸入框，使用 iPhone/iPad 鍵盤的語音聽寫後再按「辨識指令」。';
    input?.focus();return;
   }
   try{rec?.abort?.()}catch{}
   rec=new SR();rec.lang='zh-TW';rec.interimResults=false;rec.maxAlternatives=1;
   listen.disabled=true;listen.textContent='🎙 聆聽中…';result.textContent='請說出指令…';
   rec.onresult=e=>{input.value=e.results?.[0]?.[0]?.transcript||'';prepare()};
   rec.onerror=e=>{result.textContent=e?.error==='not-allowed'?'麥克風權限未開放，請允許麥克風後再試。':'語音辨識失敗，請再試一次或手動輸入。'};
   rec.onend=()=>{listen.disabled=false;listen.textContent='🎙 開始聆聽'};
   try{rec.start()}catch(e){listen.disabled=false;listen.textContent='🎙 開始聆聽';result.textContent='無法啟動語音辨識，請再試一次。'}
  };
  execute.onclick=()=>{
   prepare();if(!pending)return;
   const cmd=pending;genericDialog.close();
   setTimeout(()=>{try{cmd.run()}catch(e){alert('語音快捷執行失敗：'+String(e?.message||e))}},80);
  };
  if(window.SpeechRecognition||window.webkitSpeechRecognition)setTimeout(()=>listen.click(),120);else input?.focus();
 },0);
}

function triggerPosAction(action){
 const b=document.createElement('button');
 b.type='button';
 b.dataset.action=action;
 b.hidden=true;
 document.body.appendChild(b);
 try{b.click()}finally{setTimeout(()=>b.remove(),0)}
}

function wasteReasonOptions(selected='過期'){
 const reasons=['過期','即期未售','商品破損','品質異常','客退','其他'];
 return reasons.map(x=>`<option value="${x}" ${x===selected?'selected':''}>${x}</option>`).join('');
}
function isFreshWasteProduct(p){
 return !!p&&(p.category==='鮮食'||p.group==='鮮食'||p.isFresh===true);
}
function availableFreshWasteQty(productId){
 return freshBatches()
  .filter(x=>String(x.productId)===String(productId)&&x.status!=='已廢棄')
  .reduce((s,x)=>s+Math.max(0,Number(x.remainingQty||0)),0);
}
function allocateFreshWaste(productId,qty,batches){
 let remain=Math.max(0,Number(qty||0));
 const affected=[];
 const rows=batches
  .filter(x=>String(x.productId)===String(productId)&&x.status!=='已廢棄'&&Number(x.remainingQty||0)>0)
  .sort((a,b)=>new Date(a.expiryAt||0)-new Date(b.expiryAt||0));
 for(const batch of rows){
  if(remain<=0)break;
  const before=Math.max(0,Number(batch.remainingQty||0));
  const take=Math.min(before,remain);
  if(take<=0)continue;
  batch.remainingQty=before-take;
  batch.updatedAt=new Date().toISOString();
  if(batch.remainingQty<=0)batch.status='已廢棄';
  affected.push({batchNo:batch.batchNo||'',qty:take,before,after:batch.remainingQty});
  remain-=take;
 }
 return {remain,affected};
}
function wasteCheckoutTotals(items){
 return {
  lines:items.length,
  qty:items.reduce((s,x)=>s+Number(x.qty||0),0),
  amount:items.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0)
 };
}
function openWasteCheckoutFlow(){
 if(!scServiceConnected()){showScDisconnectedNotice('wasteLogin');return;}
 let items=[];
 const getProduct=id=>products().find(x=>String(x.id)===String(id));
 const findProduct=value=>{
  const q=String(value||'').trim().toLowerCase();
  if(!q)return null;
  return products().find(p=>
   String(p.code||'').toLowerCase()===q||
   String(p.name||'').toLowerCase()===q||
   productBarcodes(p).some(b=>String(b).toLowerCase()===q)
  )||null;
 };
 const maxWasteQty=p=>{
  const stock=Math.max(0,Number(p?.stock||0));
  return isFreshWasteProduct(p)?Math.min(stock,availableFreshWasteQty(p.id)):stock;
 };
 const lineHtml=(x,i)=>{
  const p=getProduct(x.productId)||{};
  const max=maxWasteQty(p);
  return `<div class="pos-waste-row" data-waste-line="${i}">
   <span class="pos-waste-index">${i+1}</span>
   <div class="pos-waste-product"><b>${esc(x.name)}</b><small>${esc(x.code||'')}｜${esc(x.barcode||'')}</small></div>
   <span>${money(x.price)}</span>
   <div class="pos-waste-qty">
    <button type="button" data-waste-minus="${i}">−</button>
    <input type="number" min="1" max="${max}" value="${Number(x.qty||1)}" data-waste-qty="${i}">
    <button type="button" data-waste-plus="${i}">＋</button>
    <small>可廢 ${max}</small>
   </div>
   <span class="pos-waste-line-amount">${money(Number(x.price||0)*Number(x.qty||0))}</span>
   <select data-waste-reason="${i}">${wasteReasonOptions(x.reason)}</select>
   <button type="button" class="button danger" data-waste-remove="${i}">刪除</button>
  </div>`;
 };
 const draw=()=>{
  const list=document.querySelector('#wasteCheckoutList');
  if(list)list.innerHTML=items.map(lineHtml).join('')||'<div class="pos-waste-empty">尚未 key 入商品</div>';
  const t=wasteCheckoutTotals(items);
  const lines=document.querySelector('#wasteTotalLines'),qty=document.querySelector('#wasteTotalQty'),amt=document.querySelector('#wasteTotalAmount');
  if(lines)lines.textContent=String(t.lines);
  if(qty)qty.textContent=String(t.qty);
  if(amt)amt.textContent=money(t.amount);
  const submit=document.querySelector('#wasteCheckoutSubmit');
  if(submit)submit.disabled=!items.length;
 };
 const addProduct=p=>{
  if(!p)return alert('找不到商品');
  if(productStatusLabel(p)==='停用')return alert('此商品目前停用，不能廢棄');
  const max=maxWasteQty(p);
  if(max<=0){
   return alert(isFreshWasteProduct(p)?'此鮮食目前沒有可廢棄的庫存／批次數量':'此商品目前庫存為 0，不能廢棄');
  }
  const old=items.find(x=>x.productId===p.id);
  if(old){
   if(Number(old.qty||0)>=max)return alert(`已達可廢棄上限 ${max}`);
   old.qty=Number(old.qty||0)+1;
  }else{
   items.push({
    productId:p.id,code:p.code||'',barcode:productBarcodes(p)[0]||'',
    name:p.name,price:Number(p.price||0),qty:1,reason:'過期'
   });
  }
  draw();
 };
 dlg('廢棄登入',`<div class="pos-waste-checkout">
  <section class="pos-waste-keybar">
   <button type="button" class="primary pos-square" id="wasteScanButton">⌗</button>
   <label><span>請掃描／輸入商品</span><input id="wasteKeyInput" placeholder="條碼／商品代號／品名" inputmode="search" autocomplete="off"></label>
   <button type="button" class="button" id="wasteKeyButton">KEY 入</button>
  </section>

  <section class="pos-waste-table">
   <div class="pos-waste-row head">
    <span>項次</span><span>品名</span><span>單價</span><span>數量</span><span>金額</span><span>廢棄原因</span><span>操作</span>
   </div>
   <div id="wasteCheckoutList"></div>
  </section>

  <section class="pos-waste-summary">
   <div>商品品項數 <b id="wasteTotalLines">0</b></div>
   <div>廢棄總件數 <b id="wasteTotalQty">0</b></div>
   <div>廢棄總金額 <b id="wasteTotalAmount">$0</b></div>
  </section>

  <section class="pos-waste-actions">
   <button type="button" class="button" id="wasteCheckoutBack">返回</button>
   <button type="button" class="button danger" id="wasteCheckoutClear">清空</button>
   <button type="button" class="pos-waste-submit" id="wasteCheckoutSubmit" disabled>廢棄</button>
  </section>
 </div>`);
 setTimeout(()=>{
  const key=document.querySelector('#wasteKeyInput');
  const keyBtn=document.querySelector('#wasteKeyButton');
  const scan=document.querySelector('#wasteScanButton');
  const list=document.querySelector('#wasteCheckoutList');
  const clear=document.querySelector('#wasteCheckoutClear');
  const back=document.querySelector('#wasteCheckoutBack');
  const submit=document.querySelector('#wasteCheckoutSubmit');
  const keyCurrent=()=>{
   const p=findProduct(key?.value);
   if(!p)return alert('找不到商品');
   addProduct(p);
   if(key){key.value='';key.focus()}
  };
  if(keyBtn)keyBtn.onclick=keyCurrent;
  if(key)key.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();keyCurrent()}};
  if(scan)scan.onclick=()=>scanCode({title:'掃描廢棄商品',onResult:code=>{
   const p=findProduct(code);
   if(!p)return alert('找不到商品');
   addProduct(p);
   setTimeout(()=>key?.focus(),0);
  }});
  if(back)back.onclick=()=>genericDialog.close();
  if(clear)clear.onclick=()=>{
   if(items.length&&!confirm('確定清空目前廢棄清單？'))return;
   items=[];draw();key?.focus();
  };
  if(list){
   list.onclick=e=>{
    const minus=e.target.closest('[data-waste-minus]');
    const plus=e.target.closest('[data-waste-plus]');
    const remove=e.target.closest('[data-waste-remove]');
    if(remove){
     items.splice(Number(remove.dataset.wasteRemove),1);draw();return;
    }
    const target=minus||plus;
    if(target){
     const i=Number(minus?minus.dataset.wasteMinus:plus.dataset.wastePlus);
     const x=items[i],p=getProduct(x?.productId);
     if(!x||!p)return;
     const max=maxWasteQty(p);
     x.qty=Math.max(1,Math.min(max,Number(x.qty||1)+(minus?-1:1)));
     draw();
    }
   };
   list.oninput=e=>{
    const qty=e.target.closest('[data-waste-qty]');
    if(qty){
     const i=Number(qty.dataset.wasteQty),x=items[i],p=getProduct(x?.productId);
     if(!x||!p)return;
     const max=maxWasteQty(p);
     x.qty=Math.max(1,Math.min(max,Math.floor(Number(qty.value||1))));
     qty.value=x.qty;
     const row=qty.closest('.pos-waste-row');
     const amount=row?.querySelector('.pos-waste-line-amount');
     if(amount)amount.textContent=money(Number(x.price||0)*Number(x.qty||0));
     const t=wasteCheckoutTotals(items);
     document.querySelector('#wasteTotalQty').textContent=String(t.qty);
     document.querySelector('#wasteTotalAmount').textContent=money(t.amount);
    }
    const reason=e.target.closest('[data-waste-reason]');
    if(reason){
     const x=items[Number(reason.dataset.wasteReason)];
     if(x)x.reason=reason.value;
    }
   };
  }
  if(submit)submit.onclick=()=>{
   if(!items.length)return alert('請先 key 入商品');
   // Re-check stock/batch availability immediately before commit.
   const ps=load(K.products,[]);
   const byId=new Map(ps.map(p=>[String(p.id),p]));
   for(const x of items){
    const p=byId.get(String(x.productId));
    if(!p)return alert(`找不到商品：${x.name}`);
    const stock=Math.max(0,Number(p.stock||0));
    const freshAvailable=isFreshWasteProduct(p)?availableFreshWasteQty(p.id):stock;
    const allowed=isFreshWasteProduct(p)?Math.min(stock,freshAvailable):stock;
    if(Number(x.qty||0)>allowed)return alert(`${p.name} 可廢棄數量只剩 ${allowed}，請重新確認`);
   }
   const t=wasteCheckoutTotals(items);
   if(!confirm(`確認廢棄 ${t.lines} 項／${t.qty} 件／${money(t.amount)}？`))return;

   const wasteRows=load(K.waste,[]);
   const batches=freshBatches();
   const now=new Date().toISOString();
   const detail=[];
   for(const x of items){
    const p=byId.get(String(x.productId));
    const q=Math.max(1,Math.floor(Number(x.qty||1)));
    const before=Number(p.stock||0);
    let batchAffected=[];
    if(isFreshWasteProduct(p)){
     const allocation=allocateFreshWaste(p.id,q,batches);
     if(allocation.remain>0){
      alert(`${p.name} 鮮食批次不足，廢棄未送出`);
      return;
     }
     batchAffected=allocation.affected;
    }
    p.stock=Math.max(0,before-q);
    wasteRows.unshift({
     id:uid(),productId:p.id,productCode:p.code||'',barcode:productBarcodes(p)[0]||'',
     name:p.name,price:Number(p.price||0),amount:Number(p.price||0)*q,qty:q,
     reason:x.reason||'其他',user:currentUser().name,at:now,
     stockBefore:before,stockAfter:p.stock,
     batchNos:batchAffected.map(v=>v.batchNo).filter(Boolean),
     batchWaste:batchAffected
    });
    detail.push(`${p.name}×${q}(${x.reason||'其他'})`);
   }
   save(K.products,ps);
   save(K.waste,wasteRows);
   save(K.freshBatches,batches);
   saveAudit('POS 集中廢棄',`${detail.join('、')}｜共 ${t.lines}項 ${t.qty}件 ${money(t.amount)}`);
   genericDialog.close();
   alert(`廢棄完成\n${t.lines} 項／${t.qty} 件／${money(t.amount)}`);
  };
  draw();
  key?.focus();
 },0);
}

function base64UrlEncodeUtf8(text){
 const bytes=new TextEncoder().encode(String(text||''));
 let binary='';
 bytes.forEach(b=>binary+=String.fromCharCode(b));
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function customerDisplayPairingUrl(target='tm'){
 const cfg=getCloudConfig();
 if(!cloudConfigured()||!cfg.url||!cfg.anonKey)throw new Error('請先完成 TM 的 Supabase 雲端設定');
 const pair=base64UrlEncodeUtf8(JSON.stringify({
  url:String(cfg.url||'').replace(/\/+$/,''),
  key:String(cfg.anonKey||''),
  store:currentStoreCode()
 }));
 const base=new URL('/customer-display.html',location.origin);
 base.searchParams.set('pair',pair);
 base.searchParams.set('target',target==='self'?'self':'tm');
 base.searchParams.set('tmv','8.90');
 return base.toString();
}
function openCustomerDisplayPairing(){
 let tmUrl='',selfUrl='';
 try{tmUrl=customerDisplayPairingUrl('tm');selfUrl=customerDisplayPairingUrl('self')}catch(e){alert(e.message);return}
 dlg('客顯配對',`
  <div class="customer-pairing-dialog customer-pairing-dual">
   <h3>客顯裝置配對</h3>
   <p><b>一般 TM 客顯使用 iPhone；自助結帳客顯使用 iPad。</b><br>請分別用對應裝置掃描下方 QR Code。完成一次配對後，TM／自助模式切換時會自動切換對應客顯，不需要重新掃描。</p>
   <div class="customer-pair-dual-grid">
    <section><h4>TM 客顯｜iPhone</h4><div id="customerPairQrTm" class="customer-pair-qr"></div></section>
    <section><h4>自助客顯｜iPad</h4><div id="customerPairQrSelf" class="customer-pair-qr"></div></section>
   </div>
   <div class="customer-pair-store">目前門市：<b>${esc(store()?.name||'億家門市')}｜${esc(currentStoreCode())}</b></div>
   <small>兩台裝置可同時配對；系統會依 TM／自助模式自動切換哪一台顯示交易。</small>
   <button type="button" class="button" id="customerPairClose">關閉</button>
  </div>`);
 setTimeout(()=>{
  const make=(id,url)=>{
   const box=document.querySelector(id);if(!box)return;
   if(window.QRCode){box.innerHTML='';new QRCode(box,{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M})}
   else box.innerHTML='<div class="error">QR Code 元件載入失敗，請確認網路後重新整理 TM。</div>';
  };
  make('#customerPairQrTm',tmUrl);make('#customerPairQrSelf',selfUrl);
  const close=document.querySelector('#customerPairClose');
  if(close)close.onclick=()=>genericDialog.close();
 },0);
}

const TM_MODE_PREFS_KEY='yj_tm_mode_preferences_v1';
const SELF_EC_SWITCH_KEY='yj_self_ec_switches_v1';
function selfEcSwitchStore(){
 const raw=load(SELF_EC_SWITCH_KEY,{})||{};
 return raw&&typeof raw==='object'?raw:{};
}
function selfEcSwitches(){
 const store=String(currentStoreCode()||'001'),raw=selfEcSwitchStore(),row=raw[store]||{};
 // Upgrade compatibility: if old X Mode prefs already contain a value, migrate it once.
 const old=tmModePrefs();
 const ecSend=row.ecSend!==undefined?row.ecSend:(old.ecSend!==undefined?old.ecSend:true);
 const ecPickup=row.ecPickup!==undefined?row.ecPickup:(old.ecPickup!==undefined?old.ecPickup:true);
 if(row.ecSend===undefined||row.ecPickup===undefined){
  raw[store]={...row,ecSend:!!ecSend,ecPickup:!!ecPickup,updatedAt:new Date().toISOString()};
  save(SELF_EC_SWITCH_KEY,raw);
 }
 return {ecSend:!!ecSend,ecPickup:!!ecPickup};
}
async function saveSelfEcSwitch(key,value,authorizedBy=''){
 const store=String(currentStoreCode()||'001'),raw=selfEcSwitchStore(),before=raw[store]||{};
 raw[store]={...before,[key]:!!value,updatedAt:new Date().toISOString(),authorizedBy:String(authorizedBy||'')};
 save(SELF_EC_SWITCH_KEY,raw);
 // Keep the old preference key in sync for compatibility with older cached code.
 saveTmModePref(key,!!value);
 if(cloudConfigured())try{await cloudPushKey(SELF_EC_SWITCH_KEY,raw)}catch(e){console.warn('自助 EC 開關雲端同步失敗',e)}
 return raw[store];
}
let tmModePage=1;
let tmModeName='X';
let tmZOperator=null;

function tmNormalizeEmployeeCode(value){
 return String(value||'').trim().replace(/[\s-]+/g,'');
}
function tmEmployeeNumber(emp){
 return tmNormalizeEmployeeCode(emp?.employeeCode||emp?.employeeNo||emp?.staffNo||emp?.staffCode||emp?.code||emp?.account||'');
}
function tmEmployeeActive(emp){
 if(!emp||emp.active===false||emp.loginEnabled===false)return false;
 const status=String(emp.employmentStatus||emp.status||'').trim();
 return !/離職|離店|停用|黑名/.test(status);
}
function tmZIdentity(emp){
 if(emp?.isStocktakePersonnel===true)return '盤點人員';
 if(emp?.isEngineerPersonnel===true||emp?.isEngineer===true||emp?.engineer===true)return '工程師';
 const text=[emp?.role,emp?.title,emp?.jobTitle,emp?.employeeType,emp?.employmentType,emp?.identityType,emp?.position,emp?.badgeTitle].filter(Boolean).join('｜');
 if(/盤點/.test(text))return '盤點人員';
 if(/工程/.test(text))return '工程師';
 return '';
}
function tmZEmployeeEnabled(emp){
 return tmEmployeeActive(emp)&&!!tmZIdentity(emp);
}
function tmEmployeeBarcodeValues(emp){
 return [
  tmEmployeeNumber(emp),emp?.employeeCode,emp?.employeeNo,emp?.staffNo,emp?.staffCode,
  emp?.employeeBarcode,emp?.barcode,emp?.account,emp?.id
 ].filter(Boolean).map(tmNormalizeEmployeeCode);
}
function tmFindEmployeeByBarcode(value,{zOnly=false}={}){
 const code=tmNormalizeEmployeeCode(value);if(!code)return null;
 return employees().find(emp=>(zOnly?tmZEmployeeEnabled(emp):tmEmployeeActive(emp))&&tmEmployeeBarcodeValues(emp).includes(code))||null;
}
function tmFindZEmployeeByBarcode(value){return tmFindEmployeeByBarcode(value,{zOnly:true})}
async function tmResolveEmployeeByBarcode(value,{zOnly=false}={}){
 const code=tmNormalizeEmployeeCode(value);
 let emp=tmFindEmployeeByBarcode(code,{zOnly});
 if(emp||!cloudConfigured())return emp;
 try{
  await cloudPullKey(K.employees);
  emp=tmFindEmployeeByBarcode(code,{zOnly});
  if(emp)return emp;
 }catch(e){console.warn('employee master refresh failed',e)}
 if(zOnly){
  try{
   const registry=await cloudPullKey('yj_stocktake_personnel_auth');
   const rows=Array.isArray(registry)?registry:[];
   const row=rows.find(x=>x?.active!==false&&[
    x?.employeeCode,x?.employeeNo,x?.account,x?.id
   ].filter(Boolean).map(tmNormalizeEmployeeCode).includes(code));
   if(row)return {
    ...row,
    employeeCode:String(row.employeeCode||row.employeeNo||row.account||code),
    account:String(row.account||code),
    role:String(row.role||'盤點人員'),
    isStocktakePersonnel:true,
    active:row.active!==false,
    employmentStatus:'在職'
   };
  }catch(e){console.warn('stocktake personnel registry refresh failed',e)}
 }
 return null;
}

function tmModePrefs(){
 try{return JSON.parse(localStorage.getItem(TM_MODE_PREFS_KEY)||'{}')||{}}catch{return{}}
}
function saveTmModePref(key,value){
 const p=tmModePrefs();p[key]=value;localStorage.setItem(TM_MODE_PREFS_KEY,JSON.stringify(p));
}

let tmSelfManagerEmployee=null;
function tmModeActor(){
 if(tmModeName==='Z'&&tmZOperator)return tmZOperator;
 if(tmOperationMode()==='self'&&tmSelfManagerEmployee)return tmSelfManagerEmployee;
 return currentUser();
}
function tmModeRole(){return String(tmModeActor()?.role||tmZIdentity(tmModeActor())||'').trim()}
function tmModeIsFounder(){return tmModeRole()==='創辦人'}
function tmModeIsEngineer(){return tmModeRole().includes('工程')}
function tmModeIsHeadOffice(){const u=tmModeActor();return !!(u&&(u.isHeadOfficePersonnel===true||String(u.role||'').includes('總部')))}
function tmModeIsManagerOrAbove(){return tmModeIsFounder()||tmModeIsHeadOffice()||['管理員','店長'].includes(tmModeRole())}
function tmModeHasPermission(key){
 const u=tmModeActor();if(!u)return false;
 if(u.role==='創辦人')return true;
 const p=userPermissions(u);
 return p[key]===true;
}
function tmModeRequire(test,message){if(test)return true;alert(message);return false}

function openTmStoreUpdate(){
 if(!tmModeRequire(tmModeIsFounder()||tmModeIsHeadOffice(),'店號更新只有總部人員或創辦人可以操作'))return;
 const rows=load(K.stores,[]).filter(x=>x&&x.active!==false);
 if(!rows.length)return alert('目前沒有可切換的門市資料');
 dlg('店號更新',`
  <p>目前店號：<b>${esc(currentStoreCode())}</b></p>
  <label>切換店號<select id="tmStoreUpdateSelect">${rows.map(x=>`<option value="${esc(x.code)}" ${String(x.code)===currentStoreCode()?'selected':''}>${esc(x.code)}｜${esc(x.name)}</option>`).join('')}</select></label>
  <div class="tm-mode-auth-actions"><button class="button" id="tmStoreUpdateCancel">取消</button><button class="primary" id="tmStoreUpdateSave">更新店號</button></div>`);
 setTimeout(()=>{
  document.querySelector('#tmStoreUpdateCancel')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage));
  document.querySelector('#tmStoreUpdateSave')?.addEventListener('click',async()=>{
   const code=String(document.querySelector('#tmStoreUpdateSelect')?.value||'').trim();
   const target=rows.find(x=>String(x.code)===code);
   if(!target)return alert('找不到選擇的門市');
   if(!setCurrentStore(target))return alert('店號更新失敗');
   saveAudit('X Mode 店號更新',`${target.code}｜${target.name}`);
   try{if(cloudConfigured())await cloudPullAll()}catch(_e){}
   alert(`店號已更新為 ${target.code}｜${target.name}`);
   openTmModePanel(tmModeName,tmModePage);
  });
 },0);
}

function openTmDonation(){
 if(!tmModeRequire(tmModeIsFounder()||tmModeIsHeadOffice()||tmModeHasPermission('tmDonation'),'零錢捐需總部人員或已開啟零錢捐權限'))return;
 dlg('零錢捐',`
  <p>輸入本筆要加入結帳的捐款金額。</p>
  <div class="tm-donation-presets"><button class="button" data-donation-amount="1">$1</button><button class="button" data-donation-amount="5">$5</button><button class="button" data-donation-amount="10">$10</button><button class="button" data-donation-amount="50">$50</button></div>
  <label>捐款金額<input id="tmDonationAmount" type="number" min="1" step="1" inputmode="numeric"></label>
  <div class="tm-mode-auth-actions"><button class="button" id="tmDonationCancel">取消</button><button class="primary" id="tmDonationAdd">加入結帳</button></div>`);
 setTimeout(()=>{
  document.querySelectorAll('[data-donation-amount]').forEach(b=>b.addEventListener('click',()=>{const i=document.querySelector('#tmDonationAmount');if(i)i.value=b.dataset.donationAmount||''}));
  document.querySelector('#tmDonationCancel')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage));
  document.querySelector('#tmDonationAdd')?.addEventListener('click',()=>{
   const amount=Math.floor(Number(document.querySelector('#tmDonationAmount')?.value||0));
   if(amount<=0)return alert('請輸入捐款金額');
   const row={id:`DON-${Date.now()}`,code:'DONATION',name:'零錢捐',price:amount,cost:0,qty:1,manualAmount:true,taxType:'免稅',category:'公益捐款',group:'公益捐款',donation:true,serviceType:'donation',allowNegativeStock:true};
   state.cart.push(row);state.selected=row.id;if(!state.transactionId)state.transactionId='T'+Date.now();
   saveAudit('X Mode 零錢捐',`加入結帳 ${money(amount)}`);
   genericDialog.close();render('pos');setTimeout(()=>drawPOS(),0);
  });
 },0);
}


const TM_TRAINING_MODE_KEY='yj_tm_training_mode_v1';
const SELF_ACCOUNT='99999';
const SELF_ACCOUNT_KEY='yj_self_checkout_account';
const SELF_HANDOVER_START_KEY='yj_self_handover_start';
const TM_SCREEN_CATEGORIES_KEY='yj_tm_screen_categories';
const TM_QUICK_AMOUNT_KEYS_KEY='yj_tm_quick_amount_keys';

function tmQuickAmountKeys(){
 const rows=load(TM_QUICK_AMOUNT_KEYS_KEY,[]);
 return Array.isArray(rows)?rows.filter(x=>x&&x.active!==false).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0)):[];
}
async function refreshTmQuickAmountKeys(){
 if(cloudConfigured()){
  try{
   const rows=await cloudPullKey(TM_QUICK_AMOUNT_KEYS_KEY);
   if(Array.isArray(rows))save(TM_QUICK_AMOUNT_KEYS_KEY,rows);
  }catch(e){console.warn('TM quick amount keys pull failed',e)}
 }
 return tmQuickAmountKeys();
}

function tmScreenCategories(){
 const rows=load(TM_SCREEN_CATEGORIES_KEY,[]);
 return Array.isArray(rows)?rows.filter(x=>x&&x.active!==false&&String(x.name||'').trim()):[];
}

async function refreshTmScreenCategories({redraw=false}={}){
 const before=JSON.stringify(tmScreenCategories());
 if(cloudConfigured()){
  try{
   const rows=await cloudPullKey(TM_SCREEN_CATEGORIES_KEY);
   if(Array.isArray(rows))save(TM_SCREEN_CATEGORIES_KEY,rows);
  }catch(e){console.warn('TM screen categories pull failed',e)}
 }
 const after=tmScreenCategories();
 if(redraw&&before!==JSON.stringify(after)&&!isSelfCheckout()&&document.querySelector('.pos-category-wrap')){
  state.category=after[0]?.name||'';
  render('pos');
  setTimeout(drawPOS,0);
 }
 return after;
}
const SELF_REOPEN_PENDING_KEY='yj_self_checkout_reopen_pending';
const SELF_PREVIOUS_SESSION_KEY='yj_self_checkout_previous_session';
function tmTrainingMode(){return localStorage.getItem(TM_TRAINING_MODE_KEY)==='1'}
function setTmTrainingMode(v){v?localStorage.setItem(TM_TRAINING_MODE_KEY,'1'):localStorage.removeItem(TM_TRAINING_MODE_KEY)}
function selfCheckoutConfig(){const x=load(SELF_ACCOUNT_KEY,null);return x&&String(x.account||SELF_ACCOUNT)===SELF_ACCOUNT?x:null}
async function refreshSelfCheckoutConfig(){
 if(cloudConfigured()){
  try{
   const fresh=await cloudPullKey(SELF_ACCOUNT_KEY);
   if(fresh&&String(fresh.account||SELF_ACCOUNT)===SELF_ACCOUNT){
    save(SELF_ACCOUNT_KEY,fresh);
    return fresh;
   }
  }catch(e){console.warn('self account pull failed',e)}
 }
 return selfCheckoutConfig();
}
function selfCheckoutSessionProfile(){const c=selfCheckoutConfig();if(!c||c.enabled===false)return null;return {id:c.id||'SELF-99999',name:c.name||'自助結帳',account:SELF_ACCOUNT,role:'自助結帳',active:true,loginEnabled:true,crossStore:true,systemAccount:true,storeCode:currentStoreCode()}}
function rememberPreviousSession(){const u=currentUser();if(u&&String(u.account||'')!==SELF_ACCOUNT)try{localStorage.setItem(SELF_PREVIOUS_SESSION_KEY,JSON.stringify(u))}catch(_){}}
function activateSelfCheckoutSystemSession(){const p=selfCheckoutSessionProfile();if(!p)throw new Error('尚未由總部 SC 設定自助結帳帳號 99999');rememberPreviousSession();save(K.session,p);ensurePosShiftOpener(p.name,p.role);return p}
function restoreSelfManagerAsTmSession(){
 const current=currentUser();
 if(current&&String(current.account||'')!==SELF_ACCOUNT){
  const session={...current,password:undefined};
  save(K.session,session);
  try{localStorage.setItem(SELF_PREVIOUS_SESSION_KEY,JSON.stringify(session))}catch(_){}
  return true;
 }
 if(tmSelfManagerEmployee){
  const session={...tmSelfManagerEmployee,password:undefined};
  save(K.session,session);
  try{localStorage.setItem(SELF_PREVIOUS_SESSION_KEY,JSON.stringify(session))}catch(_){}
  return true;
 }
 try{
  const x=JSON.parse(localStorage.getItem(SELF_PREVIOUS_SESSION_KEY)||'null');
  if(x&&x.account&&String(x.account)!==SELF_ACCOUNT&&x.active!==false){
   save(K.session,{...x,password:undefined});
   return true;
  }
 }catch(_){}
 return false;
}
function markSelfReopenPending(v){v?localStorage.setItem(SELF_REOPEN_PENDING_KEY,'1'):localStorage.removeItem(SELF_REOPEN_PENDING_KEY)}
function selfReopenPending(){return localStorage.getItem(SELF_REOPEN_PENDING_KEY)==='1'}
function isSelfCheckout(){return tmOperationMode()==='self'}
function selfRestrictedCartReason(){
 const rows=state.cart||[];
 if(rows.some(x=>x.ecPickup))return '自助模式無法使用取貨服務';
 if(rows.some(x=>x.collectionPayment||x.billPayment||x.utilityPayment))return '自助模式無法使用繳帳單／代收';
 if(rows.some(x=>x.serviceType&&['bill','utility-bill','ec-pickup','collection','shipment','rental'].includes(String(x.serviceType))))return '此服務無法使用自助結帳';
 if(rows.some(x=>/租金|寄貨|代收|繳費|取貨/.test(String(x.name||''))))return '此服務無法使用自助結帳';
 return '';
}
function selfNeedsStaffVerification(){
 return (state.cart||[]).some(x=>x.alcohol===true||x.tobacco===true||/菸|煙|酒/.test([x.category,x.group,x.name].filter(Boolean).join('｜')));
}
let selfVerifiedSignature='';
function selfVerificationSignature(){return (state.cart||[]).map(x=>`${x.id}:${x.qty}`).sort().join('|')}
function selfAgeCutoffText(){const d=new Date();d.setFullYear(d.getFullYear()-18);const y=d.getFullYear()-1911,mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return `民國${y}/${mm}/${dd}前出生者`}
function removeLatestRestrictedItem(){for(let i=(state.cart||[]).length-1;i>=0;i--){const x=state.cart[i];if(x&&(x.alcohol===true||x.tobacco===true||/菸|煙|酒/.test([x.category,x.group,x.name].filter(Boolean).join('｜')))){state.cart.splice(i,1);break}}selfVerifiedSignature='';render('pos')}
function openSelfStaffVerification(onSuccess){
 dlg('',`<div class="self-age-overlay"><div class="self-age-dialog"><div class="self-age-main"><div class="self-age-warning">⚠</div><div class="self-age-copy"><b>此商品購買有年齡限制</b><b>販售酒品須滿18歲</b><b>（${esc(selfAgeCutoffText())}）</b><b>違者須自付罰鍰</b><b>請呼叫店員協助，請稍候</b></div></div><div class="self-age-entry"><label>店員條碼</label><input id="selfVerifyEmployee" inputmode="numeric" autocomplete="off"></div><div class="self-age-actions"><button class="self-age-no" id="selfVerifyCancel">否，取消登錄</button><button class="self-age-yes" id="selfVerifyGo">是，符合年齡</button></div><button class="self-age-scan" id="selfVerifyScan">📷 掃描店員條碼</button></div></div>`);
 setTimeout(()=>{const input=document.querySelector('#selfVerifyEmployee');input?.focus();let busy=false;const go=async value=>{if(busy)return;busy=true;try{const emp=await tmResolveEmployeeByBarcode(value??input?.value??'');if(!emp)return alert('找不到有效的店員條碼');selfVerifiedSignature=selfVerificationSignature();saveAudit('自助菸酒年齡確認',`${emp.name||tmEmployeeNumber(emp)}｜${tmEmployeeNumber(emp)}｜符合年齡`);genericDialog.close();onSuccess?.()}finally{busy=false}};document.querySelector('#selfVerifyGo')?.addEventListener('click',()=>go());input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});document.querySelector('#selfVerifyScan')?.addEventListener('click',()=>scanCode({title:'掃描店員條碼',onResult:code=>{input.value=code;go(code)}}));document.querySelector('#selfVerifyCancel')?.addEventListener('click',()=>{saveAudit('自助菸酒年齡確認','取消登錄');genericDialog.close();removeLatestRestrictedItem()})},0);
}
function openSelfManagerAuth(){
 dlg('收銀員登入',`<div class="attendance-ref tm-z-clock self-manager-login">
   <div class="attendance-logo">yijia</div>
   <div class="attendance-card">
    <h2>收銀員登入</h2>
    <p>請輸入員工帳號與密碼後進入 X Mode。</p>
    <label>帳號<input id="selfManagerAccount" autocomplete="username" inputmode="numeric" placeholder="請輸入帳號"></label>
    <label>密碼<input id="selfManagerPassword" type="password" autocomplete="current-password" inputmode="numeric" placeholder="請輸入密碼"></label>
    <button class="attendance-main in" id="selfManagerGo">確認</button>
    <button class="button" id="selfManagerClear">清除</button>
    <button class="button" id="selfManagerCancel">離開</button>
   </div>
  </div>`);
 setTimeout(()=>{
  const account=document.querySelector('#selfManagerAccount');
  const password=document.querySelector('#selfManagerPassword');
  account?.focus();
  let busy=false;
  const go=async()=>{
   if(busy)return;busy=true;
   try{
    const a=String(account?.value||'').trim(),p=String(password?.value||'');
    if(!a||!p)return alert('請輸入帳號與密碼');
    try{if(cloudConfigured()){await cloudPullKey(K.employees);await cloudPullKey(K.permissions);await cloudPullKey(HQ_SPECIAL_TM_PERMISSIONS_KEY)}}catch(_e){}
    const emp=storeEmployees().find(x=>
      x.active!==false&&x.loginEnabled!==false&&
      String(x.account||'').trim()===a
    );
    if(!emp||String(emp.password||'')!==p)return alert('帳號或密碼錯誤');
    if(String(emp.account||'')===SELF_ACCOUNT)return alert('99999 為自助結帳專用帳號，不能用來進入管理 X Mode');
    tmSelfManagerEmployee=emp;
    saveAudit('自助模式管理登入',`${emp.name||emp.account}｜${emp.account}`);
    genericDialog.close();
    openTmModePanel('X',1);
   }finally{busy=false}
  };
  document.querySelector('#selfManagerGo')?.addEventListener('click',go);
  account?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();password?.focus()}});
  password?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});
  document.querySelector('#selfManagerClear')?.addEventListener('click',()=>{if(account)account.value='';if(password)password.value='';account?.focus()});
  document.querySelector('#selfManagerCancel')?.addEventListener('click',()=>genericDialog.close());
 },0);
}
let selfIdleTimer=0;
const SELF_IDLE_CANCEL_MS=60000;
function clearSelfTransaction({silent=false,reason='自助交易取消'}={}){
 stopPosGameTimers();posGameSession=null;posSubtotalSignature='';posSubtotalReady=false;clearPosGameCompleted();
 state.cart=[];state.discount=0;state.gamePrizeApplications=[];state.note='';state.taxId='';state.transactionId='';state.selected='';state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;selfVerifiedSignature='';
 if(!silent)saveAudit('自助交易取消',reason);
 scheduleCustomerDisplaySync(0);
}
function resetSelfIdleTimer(){
 clearTimeout(selfIdleTimer);selfIdleTimer=0;
 if(!isSelfCheckout()||!state.cart?.length||state.paymentConnecting)return;
 selfIdleTimer=setTimeout(()=>{
  if(!isSelfCheckout()||!state.cart?.length||state.paymentConnecting)return;
  clearSelfTransaction({silent:false,reason:'1分鐘無操作自動取消'});
  try{if(genericDialog?.open)genericDialog.close()}catch(_e){}
  render('pos');
  alert('1 分鐘未操作，本筆自助交易已自動取消。');
 },SELF_IDLE_CANCEL_MS);
}
function selfRemoveCartLine(lineKey){
 const rows=state.cart||[];
 const idx=rows.findIndex(x=>String(x.selfLineId||'')===String(lineKey||''));
 if(idx<0)return;
 const [removed]=rows.splice(idx,1);
 selfVerifiedSignature='';
 saveAudit('自助刪除單一商品',`${removed?.name||''}｜${money(removed?.price||0)}`);
 if(!rows.length){
  state.transactionId='';state.discount=0;state.gamePrizeApplications=[];state.note='';state.taxId='';state.selected='';state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;
 }
 resetSelfIdleTimer();
 render('pos');
}
function bindSelfIdleActivity(){
 if(window.__yjSelfIdleBound)return;window.__yjSelfIdleBound=true;
 ['pointerdown','keydown','touchstart'].forEach(evt=>document.addEventListener(evt,()=>{
  if(isSelfCheckout()&&state.cart?.length)resetSelfIdleTimer();
 },{passive:true}));
}
bindSelfIdleActivity();

let selfCheckoutScreen='home';
function selfCheckoutHomePage(){
 const hq=tmHqAppSettings().selfPanel;
 return `<div class="self-home-v861">
  ${selfPanelSettingsBanner()}
  <button class="self-home-manage" data-action="self-manage"><span>⚙</span> 管理</button>
  <div class="self-home-mode-badge">▣ ${esc(hq.title||'自助結帳')}模式</div>
  <section class="self-home-hero">
   <div class="self-home-title-mark"></div>
   <div class="self-home-title"><h1>${esc(hq.welcome||'歡迎使用自助結帳')}<br>億家自助結帳系統</h1><p>SELF-CHECKOUT SYSTEM</p></div>
   <div class="self-home-visual" aria-hidden="true">
    <div class="self-home-person">●</div>
    <div class="self-home-cart">🛒</div>
    <div class="self-home-counter"><b>Yijia</b><span>億家</span></div>
   </div>
  </section>
  <section class="self-home-mode-select">
   <h2>請選擇交易模式</h2>
   <div class="self-home-notice-row"><div class="self-home-no-cash"><b>×</b> 無法使用現金支付</div><button class="self-home-language" data-action="self-language">◎ Language</button></div>
   <button class="self-home-entry primary-entry" data-action="self-start-sale"><span class="entry-icon">🛒</span><strong>商品結帳</strong><i>›</i></button>
   ${hq.crossStoreRedeem!==false?'<button class="self-home-entry pickup-entry" data-action="self-pickup"><span class="entry-icon">▣</span><strong>跨店取／兌換</strong><i>›</i></button>':''}
   ${(hq.ecSend!==false&&selfEcSwitches().ecSend)?'<button class="self-home-entry ec-send-entry" data-action="self-ec-send"><span class="entry-icon">📦</span><strong>包裹寄件</strong><i>›</i></button>':''}
   ${(hq.ecPickup!==false&&selfEcSwitches().ecPickup)?'<button class="self-home-entry ec-pickup-entry" data-action="self-ec-pickup"><span class="entry-icon">📥</span><strong>包裹取貨</strong><i>›</i></button>':''}
  </section>
 </div>`;
}
const SELF_EC_SERVICE_HISTORY_KEY='yj_self_ec_service_history';
function selfEcServiceEnabled(kind){
 const hq=tmHqAppSettings().selfPanel,p=selfEcSwitches();
 return kind==='send'
  ? hq.ecSend!==false&&p.ecSend
  : hq.ecPickup!==false&&p.ecPickup;
}
function saveSelfEcServiceHistory(kind,code){
 const rows=load(SELF_EC_SERVICE_HISTORY_KEY,[])||[];
 const rec={id:`SECEC-${Date.now()}`,kind,code:String(code||''),storeCode:currentStoreCode(),at:new Date().toISOString(),operator:String(currentUser()?.account||SELF_ACCOUNT)};
 rows.unshift(rec);save(SELF_EC_SERVICE_HISTORY_KEY,rows.slice(0,500));
 if(cloudConfigured())cloudPushKey(SELF_EC_SERVICE_HISTORY_KEY,rows.slice(0,500)).catch(()=>{});
 return rec;
}
function openSelfEcBarcodeFlow(kind){
 const isSend=kind==='send',title=isSend?'包裹寄件':'包裹取貨';
 if(!selfEcServiceEnabled(kind))return alert(`${title}目前已關閉`);
 dlg(title,`<div class="self-ec-barcode-flow">
  <div class="self-ec-step-badge">1 / 2</div>
  <h2>${title}</h2>
  <p>請掃描${isSend?'寄件':'取件'}條碼</p>
  <div class="self-pickup-code-row"><input id="selfEcCode" inputmode="search" placeholder="掃描或輸入條碼"><button class="primary" id="selfEcScan">掃描</button></div>
  <div id="selfEcReadState" class="notice">尚未讀取條碼</div>
  <div class="toolbar"><button class="primary" id="selfEcConfirm" disabled>確認</button><button class="button" id="selfEcBack">返回</button></div>
 </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#selfEcCode'),stateEl=document.querySelector('#selfEcReadState'),confirmBtn=document.querySelector('#selfEcConfirm');
  const read=code=>{
   const v=String(code||'').trim();if(!v)return;
   if(input)input.value=v;
   if(stateEl)stateEl.innerHTML=`已讀取${isSend?'寄件':'取件'}條碼：<b>${esc(v)}</b>`;
   if(confirmBtn)confirmBtn.disabled=false;
  };
  input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();read(input.value)}});
  input?.addEventListener('change',()=>read(input.value));
  document.querySelector('#selfEcScan')?.addEventListener('click',()=>scanCode({title:`掃描${isSend?'寄件':'取件'}條碼`,onResult:read}));
  document.querySelector('#selfEcBack')?.addEventListener('click',()=>genericDialog.close());
  confirmBtn?.addEventListener('click',()=>{
   const code=String(input?.value||'').trim();if(!code)return alert('請先掃描條碼');
   const rec=saveSelfEcServiceHistory(kind,code);
   saveAudit(isSend?'自助 EC 包裹寄件':'自助 EC 包裹取貨',code);
   dlg(`${title}完成`,`<div class="self-ec-complete">
    <div class="self-ec-complete-check">✓</div>
    <h2>${title}完成</h2>
    <div class="self-ec-complete-detail"><span>條碼</span><b>${esc(code)}</b></div>
    <div class="self-ec-complete-detail"><span>完成時間</span><b>${esc(new Date(rec.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}))}</b></div>
    <button class="primary self-ec-home-btn" id="selfEcHome">⌂ 回主畫面</button>
   </div>`);
   setTimeout(()=>document.querySelector('#selfEcHome')?.addEventListener('click',()=>{genericDialog.close();selfCheckoutScreen='home';render('pos')}),0);
  });
  input?.focus();
 },0);
}

function openSelfPickupEntry(){
 if(tmHqAppSettings().selfPanel.crossStoreRedeem===false)return alert('跨店取／兌換目前已由總部停用');
 dlg('跨店取／兌換',`<div class="self-pickup-entry-v861">
  <h2>跨店取／兌換</h2>
  <p>請掃描取貨／兌換條碼，或手動輸入代碼。</p>
  <div class="self-pickup-code-row"><input id="selfPickupCode" inputmode="search" placeholder="掃描或輸入條碼"><button class="primary" id="selfPickupScan">掃描</button></div>
  <div class="toolbar"><button class="primary" id="selfPickupSearch">查詢</button><button class="button" id="selfPickupBack">返回</button></div>
  <div id="selfPickupResult" class="notice" style="margin-top:12px">尚未輸入條碼</div>
 </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#selfPickupCode'),result=document.querySelector('#selfPickupResult');
  const run=()=>{
   const code=String(input?.value||'').trim();
   if(!code){if(result)result.textContent='請先輸入或掃描條碼';return}
   if(result)result.innerHTML=`已讀取代碼：<b>${esc(code)}</b><br>目前此入口已接通至自助模式，正式跨店取／兌換資料驗證會沿用既有取貨資料流程。`;
   saveAudit('自助跨店取／兌換查詢',code);
  };
  document.querySelector('#selfPickupSearch')?.addEventListener('click',run);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run()}});
  document.querySelector('#selfPickupScan')?.addEventListener('click',()=>scanCode({title:'掃描取貨／兌換條碼',onResult:code=>{if(input)input.value=code;run()}}));
  document.querySelector('#selfPickupBack')?.addEventListener('click',()=>genericDialog.close());
  input?.focus();
 },0);
}
function selfCheckoutPage(){
 if(selfCheckoutScreen==='home'&&!state.cart?.length)return selfCheckoutHomePage();
 const t=totals(),cfg=tmScreenCategories(),cats=cfg.length?cfg.map(x=>({id:String(x.id),name:String(x.name)})):[{id:'__all__',name:'全部商品'}],hq=tmHqAppSettings().selfPanel;
 resetSelfIdleTimer();
 return `<div class="self-checkout">
  ${selfPanelSettingsBanner()}
  <header class="self-head"><button class="self-manage" data-action="self-manage">管理</button><button class="self-sale-home" data-action="self-home">首頁</button><div><h1>${esc(hq.title||'自助結帳')}</h1><small>SELF-CHECKOUT SYSTEM</small></div><div class="self-brand-visual">Yijia</div></header>
  <div class="self-body">
   <aside class="self-categories">${cats.map(c=>`<button data-self-category="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</aside>
   <main class="self-cart">
    <h2>🛒 我的購物車</h2>
    <div class="self-scan"><input id="search" placeholder="掃描／輸入商品條碼"><button data-action="scan">📷 掃描</button></div>
    <div class="self-cart-head"><span>項次</span><span>品名</span><span>單價</span><span>數量</span><span>金額</span><span></span></div>
    <div class="self-cart-list">${(state.cart||[]).map((x,i)=>`<div class="self-cart-row"><span>${i+1}</span><b>${esc(x.name)}</b><span>${money(x.price)}</span><span>1</span><span>${money(Number(x.price||0))}</span><button type="button" class="self-trash" data-self-remove="${esc(x.selfLineId||'')}">🗑️</button></div>`).join('')||'<p class="empty">購物車是空的</p>'}</div>
    <div class="self-summary"><div>折扣 <b>${money(state.discount||0)}</b></div><div>共 ${state.cart.length} 件</div><div>合計 <strong>${money(t.total)}</strong></div></div>
    <div class="self-actions"><button class="danger" data-action="clear">✖ 交易取消</button><button class="primary" data-action="subtotal">小計</button><button class="primary self-checkout-go" data-action="checkout">我要結帳</button></div>
   </main>
  </div>
 </div>`;
}
function openSelfCategory(categoryId){
 const cfg=tmScreenCategories(),cat=cfg.find(x=>String(x.id)===String(categoryId));
 const ids=new Set((cat?.productIds||[]).map(String));
 const rows=categoryId==='__all__'
  ?products().filter(x=>x.active!==false)
  :products().filter(x=>x.active!==false&&ids.has(String(x.id)));
 const title=cat?.name||(categoryId==='__all__'?'全部商品':'分類');
 dlg(`自助結帳｜${title}`,`<div class="self-product-grid">${rows.map(x=>`<button data-self-product="${esc(x.id)}"><b>${esc(x.name)}</b><span>${money(x.price)}</span></button>`).join('')||'<p>此分類目前沒有商品</p>'}</div>`);
}
function finishVirtualTrainingSale(method){
 const t=totals(),count=(state.cart||[]).reduce((n,x)=>n+Number(x.qty||0),0);
 saveAudit('教育訓練虛擬結帳',`${method}｜${count}件｜${money(t.total)}｜未入帳`);
 state.cart=[];state.discount=0;state.gamePrizeApplications=[];state.note='';state.taxId='';state.transactionId='';state.selected='';state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;
 posSubtotalSignature='';posSubtotalReady=false;genericDialog.close();render('pos');alert('教育訓練交易完成（虛擬交易，不入交易明細／營收／庫存）');
}
function openTrainingCheckoutDialog(){
 const t=totals();
 dlg('教育訓練｜虛擬結帳',`<div class="notice"><b>教育訓練模式</b><br>本次只模擬結帳，不會寫入交易明細、營收、庫存或會員正式點數。</div><div class="checkout-amount"><small>模擬應收</small><strong>${money(t.total)}</strong></div><div class="tm-mode-select-grid"><button data-training-pay="現金">現金</button><button data-training-pay="信用卡">信用卡</button><button data-training-pay="行動支付">手機支付</button><button data-training-pay="電子票證">電子票證支付</button><button data-training-pay="禮物卡">禮物卡</button></div><button class="button" id="trainingCheckoutCancel">取消</button>`);
 setTimeout(()=>{document.querySelectorAll('[data-training-pay]').forEach(b=>b.addEventListener('click',()=>finishVirtualTrainingSale(b.dataset.trainingPay)));document.querySelector('#trainingCheckoutCancel')?.addEventListener('click',()=>genericDialog.close())},0);
}
function openSelfCheckoutDialog(){
 const reason=selfRestrictedCartReason();if(reason)return alert(reason);
 const go=()=>{
  const t=totals();
  const mobileOptions=['億家 Pay','LINE Pay','Apple Pay','Google Pay','Samsung Wallet','全盈+PAY','街口支付','悠遊付','其他'];
  const storedOptions=['悠遊卡','一卡通','icash 2.0','其他'];
  const giftOptions=['億家禮物卡','電子禮物卡','其他'];
  const methodDefs={
   '信用卡':{payMethod:'信用卡',label:'信用卡',options:null,note:'信用卡由端末自動偵測卡別，按下後直接進行付款。'},
   '手機支付':{payMethod:'行動支付',label:'手機支付',options:mobileOptions,note:'請選擇手機支付方式。'},
   '電子票證支付':{payMethod:'電子票證',label:'電子票證支付',options:storedOptions,note:'請選擇電子票證付款方式。'},
   '禮物卡':{payMethod:'禮物卡',label:'禮物卡',options:giftOptions,note:'請選擇禮物卡付款方式。'}
  };
  const order=['信用卡','手機支付','電子票證支付','禮物卡'];
  let selectedMode='手機支付';

  const processPayment=async(mode,subtype='')=>{
   const conf=methodDefs[mode]||methodDefs['手機支付'];
   const method=conf.payMethod;
   const actualSubtype=(subtype||method).trim()||method;
   const detail={
    method,
    cashAmount:0,
    nonCashAmount:totals().total,
    serviceCashAmount:0,
    serviceNonCashAmount:0,
    tendered:0,
    change:0,
    subtype:actualSubtype,
    autoDetectCard:method==='信用卡',
    breakdown:[{method,amount:totals().total}],
    note:state.note||'',
    cashierOverride:{name:selfCheckoutConfig()?.name||'自助結帳',account:SELF_ACCOUNT}
   };
   const confirmBtn=document.querySelector('#selfPayConfirm');
   const cancelBtn=document.querySelector('#selfPayCancel');
   const modeButtons=[...document.querySelectorAll('[data-self-pay-mode]')];
   if(confirmBtn)confirmBtn.disabled=true;
   if(cancelBtn)cancelBtn.disabled=true;
   modeButtons.forEach(btn=>btn.disabled=true);
   if(confirmBtn)confirmBtn.textContent='交易處理中…';
   setCustomerVoiceCue('交易中','payment-processing');
   state.paymentConnecting=true;
   state.paymentConnectingMethod=method;
   await forceCustomerDisplaySync().catch(()=>{});
   await new Promise(r=>setTimeout(r,paymentProcessingWaitMs(detail,method)));
   try{
    const sale=checkout(detail);
    genericDialog.close();
    state.paymentConnecting=false;
    state.paymentConnectingMethod='';
    state.lastCompletedSale=sale;
    selfCheckoutScreen='home';
    if(paymentNeedsTakeCard(detail))setCustomerVoiceCue('請取卡','take-card');
    posSubtotalSignature='';
    posSubtotalReady=false;
    render('pos');
    scheduleCustomerDisplaySync(0);
   }catch(e){
    state.paymentConnecting=false;
    state.paymentConnectingMethod='';
    if(confirmBtn){confirmBtn.disabled=false;confirmBtn.textContent='確認付款'}
    if(cancelBtn)cancelBtn.disabled=false;
    modeButtons.forEach(btn=>btn.disabled=false);
    alert(e.message);
   }
  };

  dlg('自助結帳｜付款',`
   <div class="checkout-amount"><small>本筆應收</small><strong>${money(t.total)}</strong></div>
   <p>自助模式不接受現金。信用卡由端末自動偵測卡別；其他支付方式請先選類型，再選實際支付方式。</p>
   <div class="tm-mode-select-grid self-pay-grid">
    ${order.map(name=>`<button type="button" class="self-pay-method ${name===selectedMode?'active':''}" data-self-pay-mode="${name}">${name}</button>`).join('')}
   </div>
   <div id="selfPayFields" class="self-pay-fields"></div>
   <div class="toolbar self-pay-actions">
    <button class="button" id="selfPayCancel">取消</button>
    <button class="primary" id="selfPayConfirm">確認付款</button>
   </div>`);

  setTimeout(()=>{
   const fields=document.querySelector('#selfPayFields');
   const confirmBtn=document.querySelector('#selfPayConfirm');
   const modeButtons=[...document.querySelectorAll('[data-self-pay-mode]')];

   const renderFields=()=>{
    const conf=methodDefs[selectedMode]||methodDefs['手機支付'];
    modeButtons.forEach(btn=>btn.classList.toggle('active',btn.dataset.selfPayMode===selectedMode));
    if(selectedMode==='信用卡'){
     fields.innerHTML=`<div class="payment-note self-credit-auto"><b>信用卡自動偵測</b><br>不需選擇 Visa／Mastercard／JCB 等卡別，系統會由刷卡端末自動辨識。</div>`;
     if(confirmBtn)confirmBtn.hidden=true;
     return;
    }
    if(confirmBtn)confirmBtn.hidden=false;
    fields.innerHTML=`<label>${conf.label}<select id="selfPaySubtype">${(conf.options||[]).map(x=>`<option>${x}</option>`).join('')}</select></label>
     <p class="payment-note">${conf.note}<br>本筆將以 <b>${conf.payMethod}</b> 完成 ${money(t.total)} 付款。</p>`;
   };

   modeButtons.forEach(btn=>btn.addEventListener('click',async()=>{
    const mode=btn.dataset.selfPayMode||'手機支付';
    selectedMode=mode;
    if(mode==='信用卡'){
     modeButtons.forEach(x=>x.classList.toggle('active',x===btn));
     await processPayment('信用卡','信用卡');
     return;
    }
    renderFields();
   }));

   renderFields();

   confirmBtn?.addEventListener('click',async()=>{
    const conf=methodDefs[selectedMode]||methodDefs['手機支付'];
    const subtype=(document.querySelector('#selfPaySubtype')?.value||conf.payMethod).trim()||conf.payMethod;
    await processPayment(selectedMode,subtype);
   });

   document.querySelector('#selfPayCancel')?.addEventListener('click',()=>genericDialog.close());
  },0);
 };
 if(selfNeedsStaffVerification()&&selfVerifiedSignature!==selfVerificationSignature())return openSelfStaffVerification(go);
 go();
}

const TM_OPERATION_MODE_KEY='yj_tm_operation_mode';
function tmOperationMode(){return localStorage.getItem(TM_OPERATION_MODE_KEY)==='self'?'self':'tm'}
function applyTmOperationMode(){document.body.dataset.tmOperationMode=tmOperationMode()}
function openTmOperationModeSwitch(){
 dlg('模式切換',`
  <div class="tm-operation-mode-grid">
   <button class="tm-mode-choice ${tmOperationMode()==='tm'?'active':''}" data-operation-mode="tm">TM</button>
   <button class="tm-mode-choice ${tmOperationMode()==='self'?'active':''}" data-operation-mode="self">自助結帳</button>
  </div>
  <p class="tm-operation-mode-note">目前模式：<b>${tmOperationMode()==='self'?'自助結帳':'TM'}</b></p>`);
 setTimeout(()=>document.querySelectorAll('[data-operation-mode]').forEach(b=>b.addEventListener('click',async()=>{
  const mode=b.dataset.operationMode==='self'?'self':'tm';
  if(mode==='self'){
   const hq=await refreshTmHqAppSettings();
   if(hq.selfPanel.enabled===false)return alert('自助模式目前已由總部停用');
   const selfCfg=await refreshSelfCheckoutConfig();
   await refreshTmScreenCategories();
   if(!selfCfg||selfCfg.enabled===false)return alert('總部 SC 的自助結帳帳號 99999 尚未同步到 TM，請確認 SC 已儲存並同步後再試。');
   if(selfReopenPending()){
    genericDialog.close();
    showLogin('front');
    return
   }
   try{activateSelfCheckoutSystemSession()}catch(e){return alert(e.message)}
   // 尚未交班前，進入自助模式永遠直接使用 99999，不顯示下一班登入畫面。
   markSelfReopenPending(false);
   localStorage.setItem(TM_OPERATION_MODE_KEY,'self');
   localStorage.setItem(SELF_HANDOVER_START_KEY,new Date().toISOString());
   selfEcSwitches(); // 初始化／保留本門市 EC 開關，不因模式切換重設
   selfCheckoutScreen='home';
   setTmTrainingMode(false);
   applyTmOperationMode();
   saveAudit('X Mode 模式切換','自助結帳｜首次/未交班｜自動登入99999');
   genericDialog.close();
   if(loginDialog?.open)loginDialog.close();
   render('pos');
   // Alpha 8.89：模式切換後立即把 terminalMode=self 發到雲端，
   // 讓已配對的 iPad 客顯立刻離開待機畫面。
   try{await forceCustomerDisplaySync()}catch(e){console.warn('自助客顯模式同步失敗',e)}
   return
  }
  // 自助模式切回 TM 時一律要求收銀員重新登入，不自動還原上一位人員。
  const hq=await refreshTmHqAppSettings();
  if(hq.tmPanel.enabled===false)return alert('TM 面板目前已由總部停用');
  localStorage.setItem(TM_OPERATION_MODE_KEY,'tm');
  markSelfReopenPending(false);
  clearTimeout(selfIdleTimer);selfIdleTimer=0;
  setTmTrainingMode(false);
  applyTmOperationMode();
  genericDialog.close();
  tmSelfManagerEmployee=null;
  try{localStorage.removeItem(K.session)}catch(_e){}
  saveAudit('X Mode 模式切換','TM｜要求收銀員重新登入');
  try{await forceCustomerDisplaySync()}catch(e){console.warn('TM 客顯模式同步失敗',e)}
  showLogin('front');

 })),0);
}

setTimeout(()=>{refreshTmHqAppSettings().catch(()=>{})},500);
setInterval(()=>{refreshTmHqAppSettings().catch(()=>{})},60000);

function tmCustomerAdRows(){
 const cfg=load(K.customerDisplaySettings,{})||{};
 const src=Array.isArray(cfg.slides)?cfg.slides:Array.isArray(cfg.ads)?cfg.ads:Array.isArray(cfg.banners)?cfg.banners:Array.isArray(cfg.carousel)?cfg.carousel:[];
 return src.filter(x=>x&&x.active!==false).map(x=>typeof x==='string'?{url:x,title:''}:{url:x.url||x.image||x.src||'',title:x.title||x.name||''}).filter(x=>x.url||x.title);
}
let tmPowerSavingWakeTimer=0;
let tmPowerSavingAsleep=false;
let tmPowerSavingEventsBound=false;
function tmPowerSavingIdleMinutes(){
 const s=load(K.systemSettings,{})||{};
 const n=Number(s.powerSavingIdleMinutes??5);
 return Number.isFinite(n)?Math.min(120,Math.max(1,Math.round(n))):5;
}
function ensureTmPowerSavingOverlay(){
 let el=document.querySelector('#tmPowerSavingOverlay');
 if(el)return el;
 el=document.createElement('div');el.id='tmPowerSavingOverlay';el.innerHTML='<div><b>省電模式</b><small>點一下畫面喚醒 TM</small></div>';
 el.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();await wakeTmFromPowerSaving();});
 document.body.appendChild(el);return el;
}
async function syncTmPowerSavingState(enabled){
 const base=customerDisplayPayload();
 const payload={...base,mode:enabled?'power-saving':base.mode,powerSaving:!!enabled,ads:tmCustomerAdRows(),updatedAt:new Date().toISOString()};
 localStorage.setItem(K.customerDisplayState,JSON.stringify(payload));
 if(cloudConfigured())try{await cloudPushKey(K.customerDisplayState,payload)}catch(_e){}
}
async function sleepTmForPowerSaving(){
 if(tmModePrefs().powerSaving!==true)return;
 tmPowerSavingAsleep=true;
 const el=ensureTmPowerSavingOverlay();
 el.classList.add('show');document.body.classList.add('tm-power-saving-enabled');
 await syncTmPowerSavingState(true);
}
async function wakeTmFromPowerSaving(){
 const wasAsleep=tmPowerSavingAsleep;
 tmPowerSavingAsleep=false;
 ensureTmPowerSavingOverlay().classList.remove('show');
 document.body.classList.remove('tm-power-saving-enabled');
 if(wasAsleep)await syncTmPowerSavingState(false);
 scheduleTmPowerSaving();
}
function scheduleTmPowerSaving(){
 clearTimeout(tmPowerSavingWakeTimer);
 if(tmModePrefs().powerSaving!==true)return;
 const ms=tmPowerSavingIdleMinutes()*60*1000;
 tmPowerSavingWakeTimer=setTimeout(()=>{sleepTmForPowerSaving()},ms);
}
function bindTmPowerSavingActivity(){
 if(tmPowerSavingEventsBound)return;tmPowerSavingEventsBound=true;
 const activity=()=>{if(tmModePrefs().powerSaving===true&&!tmPowerSavingAsleep)scheduleTmPowerSaving()};
 ['pointerdown','keydown','touchstart'].forEach(name=>document.addEventListener(name,activity,{passive:true,capture:true}));
}
async function refreshTmPowerSavingSettings(){
 if(cloudConfigured())try{await cloudPullKey(K.systemSettings)}catch(_e){}
 if(tmModePrefs().powerSaving===true&&!tmPowerSavingAsleep)scheduleTmPowerSaving();
}
function applyTmPowerSaving(){
 ensureTmPowerSavingOverlay();bindTmPowerSavingActivity();
 if(tmModePrefs().powerSaving===true){scheduleTmPowerSaving()}
 else{clearTimeout(tmPowerSavingWakeTimer);tmPowerSavingAsleep=false;ensureTmPowerSavingOverlay().classList.remove('show');document.body.classList.remove('tm-power-saving-enabled')}
}
async function toggleTmPowerSaving(){
 if(!tmModeRequire(tmModeIsManagerOrAbove(),'省電模式需店長以上權限才能開啟／關閉'))return;
 const next=!(tmModePrefs().powerSaving===true);saveTmModePref('powerSaving',next);
 if(next){await refreshTmPowerSavingSettings();applyTmPowerSaving();saveAudit('X Mode 省電模式',`開啟｜閒置 ${tmPowerSavingIdleMinutes()} 分鐘後啟動`);alert(`省電模式已開啟\n閒置 ${tmPowerSavingIdleMinutes()} 分鐘後自動暗屏`)}
 else{applyTmPowerSaving();await syncTmPowerSavingState(false);saveAudit('X Mode 省電模式','關閉');alert('省電模式已關閉')}
 openTmModePanel(tmModeName,tmModePage);
}

async function toggleTmMemberRights(){
 if(!tmModeRequire(tmModeIsManagerOrAbove(),'會員權益需店長權限（含以上）才能開啟／關閉'))return;
 const p=tmModePrefs(),next=!(p.memberReminder??true);saveTmModePref('memberReminder',next);saveAudit('X Mode 會員權益',next?'開啟':'關閉');
 try{if(cloudConfigured())await cloudPushKey(TM_MODE_PREFS_KEY,tmModePrefs())}catch(_e){}
 alert(`會員權益已${next?'開啟':'關閉'}`);openTmModePanel(tmModeName,tmModePage);
}

function openTmFactorySetting(){
 if(!tmModeRequire(tmModeIsFounder(),'廠區設定只有創辦人可以操作'))return;
 const sys=load(K.systemSettings,{})||{},f=sys.factory||{};
 dlg('廠區設定',`
  <label>廠區代碼<input id="tmFactoryCode" value="${esc(f.code||'')}"></label>
  <label>廠區名稱<input id="tmFactoryName" value="${esc(f.name||'')}"></label>
  <label>區域／備註<input id="tmFactoryArea" value="${esc(f.area||'')}"></label>
  <div class="tm-mode-auth-actions"><button class="button" id="tmFactoryCancel">取消</button><button class="primary" id="tmFactorySave">儲存</button></div>`);
 setTimeout(()=>{
  document.querySelector('#tmFactoryCancel')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage));
  document.querySelector('#tmFactorySave')?.addEventListener('click',async()=>{
   const next={...sys,factory:{code:String(document.querySelector('#tmFactoryCode')?.value||'').trim(),name:String(document.querySelector('#tmFactoryName')?.value||'').trim(),area:String(document.querySelector('#tmFactoryArea')?.value||'').trim(),updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''}};
   save(K.systemSettings,next);try{if(cloudConfigured())await cloudPushKey(K.systemSettings,next)}catch(_e){}saveAudit('X Mode 廠區設定',`${next.factory.code}｜${next.factory.name}`);alert('廠區設定已儲存');openTmModePanel(tmModeName,tmModePage);
  });
 },0);
}
function tmModeAllowedZ(){
 return !!(tmZOperator&&tmZEmployeeEnabled(tmZOperator));
}
function tmZAttendanceState(emp){
 const no=tmEmployeeNumber(emp),rows=(load(K.attendance,[])||[])
  .filter(x=>String(x.storeCode||currentStoreCode())===currentStoreCode())
  .filter(x=>String(x.employeeNo||x.userAccount||'').trim()===no)
  .sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
 return rows[0]?.kind==='簽到'?'in':'out';
}
async function publishCustomerDisplayNotice(notice,durationMs=12000){
 const id=String(notice?.id||`CDN-${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
 const payload={id,...(notice||{}),at:new Date().toISOString(),expiresAt:new Date(Date.now()+Math.max(3000,Number(durationMs)||12000)).toISOString()};
 state.customerDisplayNotice=payload;
 try{await forceCustomerDisplaySync()}catch(_e){}
 setTimeout(async()=>{if(state.customerDisplayNotice?.id!==id)return;state.customerDisplayNotice=null;try{await forceCustomerDisplaySync()}catch(_e){}},Math.max(3000,Number(durationMs)||12000)+150);
 return payload;
}
function recordZAttendance(emp,kind){
 if(!tmZEmployeeEnabled(emp))throw new Error('此人員目前無法使用 Z Mode');
 const no=tmEmployeeNumber(emp);if(!no)throw new Error('此人員沒有員工編號');
 const rows=load(K.attendance,[]),now=new Date(),last=rows.find(x=>String(x.storeCode||currentStoreCode())===currentStoreCode()&&String(x.employeeNo||x.userAccount||'')===no);
 if(last&&last.kind===kind&&now-new Date(last.at||0)<5000)throw new Error(`已完成${kind}，請勿重複刷取`);
 const identity=tmZIdentity(emp);
 rows.unshift({id:uid(),storeCode:currentStoreCode(),user:emp.name||no,userAccount:String(emp.account||no),employeeNo:no,role:identity,kind,at:now.toISOString(),source:'Z Mode 條碼'});
 save(K.attendance,rows);saveAudit(`Z Mode ${identity}${kind}`,`${emp.name||no}｜${no}`);
 publishCustomerDisplayNotice({type:'attendance',identity,name:emp.name||'',employeeNo:no,action:kind,title:`${identity}${kind}`,status:'完成'}).catch(()=>{});
 return true;
}
function openTmZAttendanceResolved(emp){
 if(!tmZEmployeeEnabled(emp))return alert('此員工編號不是有效的盤點人員／工程師');
 const identity=tmZIdentity(emp),no=tmEmployeeNumber(emp),st=tmZAttendanceState(emp);
 dlg('Z Mode｜人員簽到／簽退',`<div class="attendance-ref tm-z-clock"><div class="attendance-logo">yijia</div><div class="attendance-card"><h2>${esc(identity)}</h2><div class="attendance-person">👤 ${esc(emp.name||'')} <small>${esc(no)}</small></div><div class="attendance-clock-now">${new Date().toLocaleString('zh-TW')}</div><div class="notice">目前狀態：<b>${st==='in'?'已簽到':'未簽到／已簽退'}</b></div><button class="attendance-main in" id="tmZClockIn">簽到並進入 Z Mode</button><button class="attendance-main out" id="tmZClockOut">簽退</button><button class="button" id="tmZRescan">重新刷取</button></div></div>`);
 setTimeout(()=>{
  document.querySelector('#tmZClockIn')?.addEventListener('click',()=>{try{recordZAttendance(emp,'簽到');tmZOperator=emp;genericDialog.close();openTmModePanel('Z',1)}catch(e){alert(e.message)}});
  document.querySelector('#tmZClockOut')?.addEventListener('click',()=>{try{recordZAttendance(emp,'簽退');if(tmZOperator&&tmEmployeeNumber(tmZOperator)===no)tmZOperator=null;genericDialog.close();alert('簽退完成')}catch(e){alert(e.message)}});
  document.querySelector('#tmZRescan')?.addEventListener('click',requestTmZMode);
 },0);
}

function tmEmployeeAttendanceState(emp){
 const no=tmEmployeeNumber(emp);
 const rows=(load(K.attendance,[])||[])
  .filter(x=>String(x.storeCode||currentStoreCode())===currentStoreCode())
  .filter(x=>tmNormalizeEmployeeCode(x.employeeNo||x.userAccount||'')===no)
  .sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
 return rows[0]?.kind==='簽到'?'in':'out';
}
function recordTmEmployeeAttendance(emp,kind){
 if(!tmEmployeeActive(emp))throw new Error('此員工目前已停用或離職，無法打卡');
 const no=tmEmployeeNumber(emp);if(!no)throw new Error('此員工沒有員工編號');
 const rows=load(K.attendance,[]),now=new Date();
 const last=(rows||[]).find(x=>String(x.storeCode||currentStoreCode())===currentStoreCode()&&tmNormalizeEmployeeCode(x.employeeNo||x.userAccount||'')===no);
 if(last&&last.kind===kind&&now-new Date(last.at||0)<5000)throw new Error(`已完成${kind}，請勿重複刷取`);
 const identity=tmZIdentity(emp)||String(emp.position||emp.role||emp.employmentType||'員工');
 rows.unshift({id:uid(),storeCode:currentStoreCode(),user:emp.name||no,userAccount:String(emp.account||no),employeeNo:no,role:identity,kind,at:now.toISOString(),source:'員工編號條碼'});
 save(K.attendance,rows);saveAudit(`員工${kind}`,`${emp.name||no}｜${no}`);
 publishCustomerDisplayNotice({type:'attendance',identity,name:emp.name||'',employeeNo:no,action:kind,title:`${identity}${kind}`,status:'完成'}).catch(()=>{});
 return true;
}
function openTmEmployeeAttendanceResolved(emp){
 if(!tmEmployeeActive(emp))return alert('此員工目前無法打卡');
 const no=tmEmployeeNumber(emp),identity=tmZIdentity(emp)||String(emp.position||emp.role||emp.employmentType||'員工');
 const st=tmEmployeeAttendanceState(emp);
 dlg('員工簽到／簽退',`<div class="attendance-ref tm-z-clock"><div class="attendance-logo">yijia</div><div class="attendance-card"><h2>員工簽到／簽退</h2><div class="attendance-person">👤 ${esc(emp.name||'')} <small>${esc(no)}</small></div><div class="notice">${esc(identity)}｜目前狀態：<b>${st==='in'?'已簽到':'未簽到／已簽退'}</b></div><div class="attendance-clock-now">${new Date().toLocaleString('zh-TW')}</div><button class="attendance-main in" id="tmEmployeeClockIn">簽到</button><button class="attendance-main out" id="tmEmployeeClockOut">簽退</button><button class="button" id="tmEmployeeRescan">重新刷取</button></div></div>`);
 setTimeout(()=>{
  document.querySelector('#tmEmployeeClockIn')?.addEventListener('click',()=>{try{recordTmEmployeeAttendance(emp,'簽到');genericDialog.close();refreshTmLoginAttendance();alert(`${emp.name||no} 簽到完成`)}catch(e){alert(e.message)}});
  document.querySelector('#tmEmployeeClockOut')?.addEventListener('click',()=>{try{recordTmEmployeeAttendance(emp,'簽退');genericDialog.close();refreshTmLoginAttendance();alert(`${emp.name||no} 簽退完成`)}catch(e){alert(e.message)}});
  document.querySelector('#tmEmployeeRescan')?.addEventListener('click',requestTmEmployeeAttendance);
 },0);
}
function requestTmEmployeeAttendance(){
 dlg('打卡｜刷取員工編號',`<div class="attendance-ref tm-z-clock"><div class="attendance-logo">yijia</div><div class="attendance-card"><h2>刷取員工編號</h2><p>一般員工、盤點人員、工程師、總部人員皆由此打卡。</p><label>員工編號<input id="tmEmployeeAttendanceBarcode" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="請刷取員工編號"></label><button class="attendance-main in" id="tmEmployeeAttendanceGo">確認</button><button class="button" id="tmEmployeeAttendanceScan">📷 掃描員工編號</button><button class="button" id="tmEmployeeAttendanceCancel">取消</button></div></div>`);
 setTimeout(()=>{
  const input=document.querySelector('#tmEmployeeAttendanceBarcode');input?.focus();let busy=false;
  const go=async value=>{if(busy)return;busy=true;try{const emp=await tmResolveEmployeeByBarcode(value??input?.value??'');if(!emp)return alert('找不到有效的員工編號');openTmEmployeeAttendanceResolved(emp)}finally{busy=false}};
  document.querySelector('#tmEmployeeAttendanceGo')?.addEventListener('click',()=>go());
  input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});
  document.querySelector('#tmEmployeeAttendanceScan')?.addEventListener('click',()=>scanCode({title:'掃描員工編號',onResult:code=>go(code)}));
  document.querySelector('#tmEmployeeAttendanceCancel')?.addEventListener('click',()=>genericDialog.close());
 },0);
}
function openTmModeSwitch(options={}){
 dlg('模式切換',`
  <div class="tm-mode-select">
   <h2>請選擇操作模式</h2>
   <div class="tm-mode-select-grid">
    <button type="button" class="tm-mode-choice" id="tmModeLock">LOCK</button>
    <button type="button" class="tm-mode-choice" id="tmModeX">X Mode</button>
    <button type="button" class="tm-mode-choice" id="tmModeZ">Z Mode</button>
    <button type="button" class="tm-mode-choice" id="tmModeClose">關閉</button>
   </div>
  </div>`);
 setTimeout(()=>{
  document.querySelector('#tmModeLock')?.addEventListener('click',()=>{genericDialog.close();if(!currentUser())return alert('LOCK 需先登入 TM');triggerPosAction('lock-pos')});
  document.querySelector('#tmModeX')?.addEventListener('click',()=>{genericDialog.close();openTmModePanel('X',1,{fromLogin:options.fromLogin===true})});
  document.querySelector('#tmModeZ')?.addEventListener('click',()=>requestTmZMode());
  document.querySelector('#tmModeClose')?.addEventListener('click',()=>genericDialog.close());
 },0);
}
function requestTmZMode(){
 dlg('Z Mode｜刷取員工編號',`<div class="attendance-ref tm-z-clock"><div class="attendance-logo">yijia</div><div class="attendance-card"><h2>盤點人員／工程師</h2><p>Z Mode 僅驗證操作身分；簽到／簽退統一使用 TM 底部「打卡」。</p><label>員工編號<input id="tmZEmployeeBarcode" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="請刷取員工編號"></label><button class="attendance-main in" id="tmZEmployeeGo">確認並進入 Z Mode</button><button class="button" id="tmZEmployeeScan">📷 掃描員工編號</button><button class="button" id="tmZCancel">取消</button></div></div>`);
 setTimeout(()=>{
  const input=document.querySelector('#tmZEmployeeBarcode');input?.focus();let busy=false;
  const go=async value=>{if(busy)return;busy=true;try{const emp=await tmResolveEmployeeByBarcode(value??input?.value??'',{zOnly:true});if(!emp)return alert('找不到有效的盤點人員／工程師員工編號');tmZOperator=emp;genericDialog.close();openTmModePanel('Z',1)}finally{busy=false}};
  document.querySelector('#tmZEmployeeGo')?.addEventListener('click',()=>go());
  input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});
  document.querySelector('#tmZEmployeeScan')?.addEventListener('click',()=>scanCode({title:'掃描員工編號',onResult:code=>go(code)}));
  document.querySelector('#tmZCancel')?.addEventListener('click',()=>genericDialog.close());
 },0);
}
function tmModeItems(page){
 if(page===1)return[
  ['read-account','1. 讀帳'],['ticket-reprint','6. 票券重印'],
  ['day-close','2. 日結帳'],['store-update','7. 店號更新'],
  [(tmModeName==='X'&&isSelfCheckout())?'self-handover':'training',(tmModeName==='X'&&isSelfCheckout())?'3. 交班':'3. 教育訓練'],['blank-8','8.'],
  ['mode-switch','4. 模式切換'],['blank-9','9.'],
  ['receipt-query','5. 存根查詢'],['donation','10. 零錢捐']
 ];
 if(page===2)return[
  ['second-screen-game','11. 第二片螢幕遊戲'],['blank-16','16.'],
  ['coffee-label','12. 咖啡貼標'],['screen-sound','17. 螢幕聲音控制'],
  ['blank-13','13.'],['blank-18','18.'],
  ['blank-14','14.'],['coffee-qrcode','19. 智能咖啡機QRCODE'],
  ['alcohol-setting','15. 酒設定'],['coffee-redeem','20. 智能咖啡機條碼兌換查詢']
 ];
 const selfMode=tmOperationMode()==='self';
 return[
  ['power-saving','21. 省電模式'],['customer-display-pair','26. 客顯配對'],
  ['member-reminder','22. 會員權益'],[selfMode?'ec-send-toggle':'blank-27',selfMode?'27. EC寄件':'27.'],
  ['factory-setting','23. 廠區設定'],[selfMode?'ec-pickup-toggle':'blank-28',selfMode?'28. EC取貨':'28.'],
  ['blank-24','24.'],['blank-29','29.'],
  ['dayclose-export','25. 日結資料匯出'],['shutdown','30. 關機']
 ];
}
function tmModeButtonLabel(action,label){
 const p=tmModePrefs();
 const suffix=(key,def=true)=>`：${(p[key]??def)?'啟用':'不啟用'}`;
 if(action==='coffee-label')return label+suffix('coffeeLabel',false);
 if(action==='screen-sound')return label+`：${(p.screenSound??p.keyboardSound??true)?'ON':'OFF'}`;
 if(action==='coffee-qrcode')return label+suffix('coffeeQr',false);
 if(action==='power-saving')return label+suffix('powerSaving',false);
 if(action==='member-reminder')return label+suffix('memberReminder',true);
 if(action==='ec-send-toggle')return `${label}：${selfEcSwitches().ecSend?'啟用':'不啟用'}`;
 if(action==='ec-pickup-toggle')return `${label}：${selfEcSwitches().ecPickup?'啟用':'不啟用'}`;
 if(action==='cleaning-reminder')return label+suffix('cleaningReminder',true);
 return label;
}
function openTmModePanel(modeName='X',page=1,options={}){
 tmModeName=modeName==='Z'?'Z':'X';
 tmModePage=Math.max(1,Math.min(3,Number(page)||1));
 dlg(`${tmModeName} Mode`,`
  <div class="tm-mode-panel">
   <div class="tm-mode-head">
    <strong>${tmModeName}Mode</strong>
    <div><span>店號：${esc(currentStoreCode())}</span><span>版本：${esc(tmDisplayVersion())}</span></div>
   </div>
   ${tmModeName==='Z'?`<div class="tm-z-banner">${esc(tmZIdentity(tmZOperator)||'盤點人員／工程師')}｜${esc(tmZOperator?.name||'')}｜員工編號 ${esc(tmEmployeeNumber(tmZOperator))}</div>`:''}
   <div class="tm-mode-grid">
    ${tmModeItems(tmModePage).map(([a,l])=>`<button type="button" class="tm-mode-item ${a.startsWith('blank-')?'is-blank':''}" data-tm-mode-action="${esc(a)}" ${a.startsWith('blank-')?'disabled':''}>${esc(tmModeButtonLabel(a,l))}</button>`).join('')}
   </div>
   <div class="tm-mode-pager">
    <button type="button" class="tm-mode-arrow" id="tmModePrev" ${tmModePage<=1?'disabled':''}>◀</button>
    <strong>${tmModePage} / 3</strong>
    <button type="button" class="tm-mode-arrow" id="tmModeNext" ${tmModePage>=3?'disabled':''}>▶</button>
    <button type="button" class="tm-mode-exit" id="tmModeExit">離開</button>
   </div>
   <div class="tm-mode-hint" id="tmModeHint">請點擊選單按鈕</div>
  </div>`);
 setTimeout(()=>{
  document.querySelector('#tmModePrev')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage-1,options));
  document.querySelector('#tmModeNext')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage+1,options));
  document.querySelector('#tmModeExit')?.addEventListener('click',()=>{
   genericDialog.close();
   if(options.fromLogin===true){if(!loginDialog.open)loginDialog.showModal();return}
   render('pos');
  });
  document.querySelectorAll('[data-tm-mode-action]').forEach(btn=>btn.addEventListener('click',()=>runTmModeAction(btn.dataset.tmModeAction)));
 },0);
}
function tmModeReadAccount(){
 const shift=currentOpenShift();
 const sales=shift?shiftSales(shift):[];
 const total=sales.filter(x=>!['已作廢','已整筆退貨'].includes(x.status)).reduce((s,x)=>s+Number(x.total||0),0);
 const deposits=load(K.deposits,[]).filter(x=>String(x.storeCode||'001')===currentStoreCode()).reduce((s,x)=>s+Number(x.amount||0),0);
 dlg(`${tmModeName} Mode｜讀帳`,`
  <div class="tm-read-account">
   <h3>版本與帳務確認</h3>
   <div class="tm-read-grid">
    <div><small>模式</small><b>${esc(tmModeName)} Mode</b></div>
    <div><small>TM版本</small><b>${esc(tmDisplayVersion())}</b></div>
    <div><small>店號</small><b>${esc(currentStoreCode())}</b></div>
    <div><small>操作人員</small><b>${esc(currentUser()?.name||'')}</b></div>
    <div><small>目前班別</small><b>${esc(shift?.type||'未開班')}</b></div>
    <div><small>本班交易</small><b>${sales.length} 筆</b></div>
    <div><small>本班營收</small><b>${money(total)}</b></div>
    <div><small>投庫累計</small><b>${money(deposits)}</b></div>
   </div>
   <button type="button" class="button" id="tmReadBack">返回 ${tmModeName} Mode</button>
  </div>`);
 setTimeout(()=>document.querySelector('#tmReadBack')?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage)),0);
}
function tmModeToggle(key,label,def=true){
 const p=tmModePrefs(),next=!(p[key]??def);saveTmModePref(key,next);
 alert(`${label}已${next?'啟用':'關閉'}`);openTmModePanel(tmModeName,tmModePage);
}
function tmModeManualBarcode(){
 dlg(`${tmModeName} Mode｜手輸掃描條碼`,`
  <label>條碼<input id="tmModeBarcode" inputmode="numeric" autocomplete="off"></label>
  <button type="button" class="primary" id="tmModeBarcodeGo">帶回 TM</button>`);
 setTimeout(()=>{
  const input=document.querySelector('#tmModeBarcode');input?.focus();
  document.querySelector('#tmModeBarcodeGo')?.addEventListener('click',()=>{
   const code=String(input?.value||'').trim();
   if(!code)return alert('請輸入條碼');
   genericDialog.close();render('pos');
   setTimeout(()=>{const q=document.querySelector('#search');if(q){q.value=code;q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}},50);
  });
 },0);
}
function tmModeExportDayclose(){
 const payload={
  exportedAt:new Date().toISOString(),
  storeCode:currentStoreCode(),
  version:tmDisplayVersion(),
  shifts:shiftRows(),
  xAccounts:xAccountRows(),
  sales:load(K.sales,[]),
  deposits:load(K.deposits,[])
 };
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`Yijia_TM_dayclose_${currentStoreCode()}_${new Date().toISOString().slice(0,10)}.json`;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),5000);
 alert('日結資料已匯出');
}
function tmSelfEcToggleAuthorizedEmployee(account){
 const q=String(account||'').trim().toLowerCase();
 if(!q)return null;
 return (load(K.employees,[])||[]).find(x=>{
  if(!x||x.active===false||String(x.employmentStatus||'')==='離職'||String(x.status||'')==='離職')return false;
  if(String(x.account||'').trim().toLowerCase()!==q)return false;
  return String(x.role||'')==='創辦人'||x.isHeadOfficePersonnel===true||String(x.role||'').includes('總部人員');
 })||null;
}
function openSelfEcToggleAuthorization(key,label,def=true){
 if(tmOperationMode()!=='self')return;
 const current=selfEcSwitches(),next=!Boolean(current[key]??def);
 dlg(`${label}｜${next?'開啟':'關閉'}授權`,`
  <div class="tm-mode-auth-card">
   <h3>${esc(label)}：${next?'開啟':'關閉'}</h3>
   <p>此設定僅影響自助模式。開啟或關閉都需要輸入「創辦人」或「總部人員」帳號。</p>
   <label>授權帳號
    <input id="selfEcToggleAuthAccount" autocomplete="username" placeholder="請輸入創辦人或總部人員帳號">
   </label>
   <div id="selfEcToggleAuthState" class="notice" style="margin-top:10px">尚未驗證帳號</div>
   <div class="tm-mode-auth-actions">
    <button class="button" id="selfEcToggleAuthCancel">取消</button>
    <button class="primary" id="selfEcToggleAuthConfirm">確認${next?'開啟':'關閉'}</button>
   </div>
  </div>`);
 setTimeout(()=>{
  const input=document.querySelector('#selfEcToggleAuthAccount');
  const stateEl=document.querySelector('#selfEcToggleAuthState');
  const confirmBtn=document.querySelector('#selfEcToggleAuthConfirm');
  const cancelBtn=document.querySelector('#selfEcToggleAuthCancel');
  input?.focus();

  const verify=async()=>{
   const account=String(input?.value||'').trim();
   if(!account){if(stateEl)stateEl.textContent='請輸入授權帳號';return}
   confirmBtn.disabled=true;
   if(stateEl)stateEl.textContent='驗證中…';
   try{
    if(cloudConfigured())try{await cloudPullKey(K.employees)}catch(_e){}
    const emp=tmSelfEcToggleAuthorizedEmployee(account);
    if(!emp){
     if(stateEl)stateEl.textContent='驗證失敗：僅限創辦人或總部人員帳號';
     return;
    }
    await saveSelfEcSwitch(key,next,emp.account||emp.name||'');
    saveAudit(`自助模式 ${label}開關`,`${next?'開啟':'關閉'}｜授權：${emp.name||emp.account}（${emp.account}）`);
    genericDialog.close();
    alert(`${label}已${next?'開啟':'關閉'}`);
    openTmModePanel(tmModeName,tmModePage);
   }finally{
    if(confirmBtn)confirmBtn.disabled=false;
   }
  };
  confirmBtn?.addEventListener('click',verify);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();verify()}});
  cancelBtn?.addEventListener('click',()=>openTmModePanel(tmModeName,tmModePage));
 },0);
}

function runTmModeAction(action){
 const hint=document.querySelector('#tmModeHint');
 if(hint)hint.textContent=`執行：${action}`;
 if(action==='read-account'){if(!tmModeRequire(tmModeHasPermission('tmReadAccount'),'讀帳需由 SC 開啟「TM 讀帳」權限'))return;tmModeReadAccount();return}
 if(action==='day-close'){genericDialog.close();triggerPosAction('manual-close');return}
 if(action==='self-handover'){
  if(!isSelfCheckout())return alert('此交班功能僅供自助模式使用');
  genericDialog.close();
  triggerPosAction('handover');
  return
 }
 if(action==='training'){setTmTrainingMode(true);localStorage.setItem(TM_OPERATION_MODE_KEY,'tm');genericDialog.close();saveAudit('X Mode 教育訓練','進入教育訓練模式');render('pos');return}
 if(action==='invoice-print'){render('transactions-front');genericDialog.close();return}
 if(action==='receipt-query'){genericDialog.close();render('transactions-front');return}
 if(action==='ticket-reprint'){dlg('票券重印','<p>票券重印入口已建立，後續可依你要保留的票券流程接通。</p>');return}
 if(action==='store-update'){openTmStoreUpdate();return}
 if(action==='usb-invoice'){dlg('USB發票號碼取號','<p>USB 發票號碼取號入口已建立。</p>');return}
 if(action==='bulk-sale'){dlg('大單交易','<p>大單交易模式入口已建立，後續可接大量商品/數量輸入流程。</p>');return}
 if(action==='donation'){openTmDonation();return}
 if(action==='second-screen-game'){genericDialog.close();manualStartSecondScreenGame();return}
 if(action==='coffee-label'){tmModeToggle('coffeeLabel','咖啡貼標',false);return}
 if(action==='manual-barcode'){tmModeManualBarcode();return}
 if(action==='alcohol-setting'){
  if(!tmModeRequire(tmModeIsManagerOrAbove(),'酒設定需店長以上權限才能開啟／關閉'))return;
  const cur=alcoholReminderState(),next={enabled:cur.enabled===false,updatedAt:new Date().toISOString(),updatedBy:tmModeActor()?.name||tmModeActor()?.account||'',updatedByAccount:tmModeActor()?.account||'',source:'TM X Mode'};
  save(ALCOHOL_STATE_KEY,next);saveAudit('X Mode 酒設定',next.enabled?'啟用':'不啟用');alert(`酒設定已${next.enabled?'啟用':'不啟用'}`);openTmModePanel(tmModeName,tmModePage);return
 }
 if(action==='mode-switch'){openTmOperationModeSwitch();return}
 if(action==='screen-sound'){tmModeToggle('screenSound','螢幕聲音',true);return}
 if(action==='printer-clean'){dlg('發票機清潔','<p>發票機清潔作業入口已建立。</p><button class="primary" id="tmPrinterCleanDone">完成清潔</button>');setTimeout(()=>tmPrinterCleanDone.onclick=()=>{genericDialog.close();openTmModePanel(tmModeName,tmModePage)},0);return}
 if(action==='coffee-qrcode'){tmModeToggle('coffeeQr','智能咖啡機 QRCODE',false);return}
 if(action==='coffee-redeem'){dlg('智能咖啡機條碼兌換查詢','<label>條碼<input id="coffeeRedeemCode" inputmode="numeric"></label><button class="primary" id="coffeeRedeemGo">查詢</button><div id="coffeeRedeemResult"></div>');setTimeout(()=>coffeeRedeemGo.onclick=()=>coffeeRedeemResult.textContent=coffeeRedeemCode.value.trim()?'查詢入口已接通，後續再串正式資料來源。':'請輸入條碼',0);return}
 if(action==='customer-display-pair'){
  if(!currentUser())return alert('客顯配對需先登入 TM');
  openCustomerDisplayPairing();return
 }
 if(action==='ec-send-toggle'){
  if(tmOperationMode()!=='self')return;
  if(tmHqAppSettings().selfPanel.ecSend===false)return alert('EC寄件已由總部 SC 停用，自助模式無法開啟');
  openSelfEcToggleAuthorization('ecSend','EC寄件',true);return
 }
 if(action==='ec-pickup-toggle'){
  if(tmOperationMode()!=='self')return;
  if(tmHqAppSettings().selfPanel.ecPickup===false)return alert('EC取貨已由總部 SC 停用，自助模式無法開啟');
  openSelfEcToggleAuthorization('ecPickup','EC取貨',true);return
 }
 if(action==='power-saving'){toggleTmPowerSaving();return}
 if(action==='member-reminder'){toggleTmMemberRights();return}
 if(action==='factory-setting'){openTmFactorySetting();return}
 if(action==='cleaning-reminder'){tmModeToggle('cleaningReminder','機台清潔提醒音效',true);return}
 if(action==='dayclose-export'){tmModeExportDayclose();return}
 if(action==='shutdown'){
  dlg('30. 關機',`<div class="tm-mode-select">
   <h2>電源選項</h2>
   <p>請選擇要執行的動作。</p>
   <div class="tm-mode-select-grid">
    <button type="button" class="tm-mode-choice" id="tmPowerRestart">重新啟動</button>
    <button type="button" class="tm-mode-choice" id="tmPowerShutdown">關機</button>
    <button type="button" class="tm-mode-choice" id="tmPowerCancel">取消</button>
   </div>
  </div>`);
  setTimeout(()=>{
   document.querySelector('#tmPowerRestart')?.addEventListener('click',()=>{
    if(!confirm('確定重新啟動 TM 系統介面？'))return;
    saveAudit('X Mode 30. 關機','重新啟動');
    genericDialog.close();
    location.reload();
   });
   document.querySelector('#tmPowerShutdown')?.addEventListener('click',()=>{
    if(!confirm('確定進入關機／鎖定狀態？'))return;
    saveAudit('X Mode 30. 關機','關機／鎖定');
    genericDialog.close();
    triggerPosAction('lock-pos');
   });
   document.querySelector('#tmPowerCancel')?.addEventListener('click',()=>genericDialog.close());
  },0);
  return
 }
}

function runPosSubaction(action){
 if(action==='tm-mode-switch'){openTmModeSwitch();return}
 if(action==='stored-value-topup'){triggerPosAction('stored-value-topup');return}
 if(action==='stored-value-balance'){triggerPosAction('stored-value-balance');return}
 if(action==='ec-flow-page'){if(!scServiceConnected()){showScDisconnectedNotice('ecFlow');return}render('ec-flow');return}
 if(action==='ec-arrival'){ecActionDialog('arrival',true);return}
 if(action==='ec-leave'){ecActionDialog('leave',true);return}
 if(action==='customer-display-game-start'){manualStartSecondScreenGame();return}
 if(action==='anybuy-deposit'){openAnybuyServiceFlow('隨買跨店取寄杯','app-deposit');return}
 if(action==='anybuy-redeem'){openAnybuyServiceFlow('隨買跨店取領取','app-redeem');return}
 if(action==='easycard-deposit'){openAnybuyServiceFlow('悠遊卡寄杯','easycard-deposit');return}
 if(action==='easycard-redeem'){openAnybuyServiceFlow('悠遊卡領取','easycard-redeem');return}
 if(action==='logistics'){triggerPosAction('logistics');return}
 if(action==='transfer-in-page'){if(!scServiceConnected()){showScDisconnectedNotice('transferIn');return}render('transfer-in');return}
 if(action==='receiving-receipt'){openReceivingReceiptAcceptance();return}
 if(['receiving-misdelivery','receiving-damaged','receiving-shortage'].includes(action)){openReceivingInspection(receivingInspectionTypeLabel(action));return}
 if(action==='clock-in'||action==='clock-out'){triggerPosAction('attendance-clock');return}
 if(action==='member-lookup'){openPosMemberLookup();return}
 if(action==='alcohol-reminder-toggle'){toggleAlcoholReminder();return}
 if(action==='product-lookup'){openProductLookup();return}
 if(action==='transactions-front-page'){render('transactions-front');return}
 if(action==='add-taxable-amount'){addManualTaxAmount('應稅');return}
 if(action==='add-taxfree-amount'){addManualTaxAmount('免稅');return}
 if(action==='hold-current-transaction'){holdCurrentTransaction();return}
 if(action==='held-transactions'){openHeldTransactions();return}
 if(action==='new-waste'){enterWasteMode();return}
 if(action==='waste-query-pos'){showWasteQueryPos();return}
 if(action==='fresh-near-expiry'){showFreshLookup('near');return}
 if(action==='fresh-expired'){showFreshLookup('expired');return}
 if(action==='lock-pos'){triggerPosAction('lock-pos');return}
 if(action==='deposit'){triggerPosAction('deposit');return}
 if(action==='handover'){triggerPosAction('handover');return}
 if(action==='system-settings-page'){if(!requirePermission('systemSettingsAccess'))return;render('system-settings');return}
 if(action==='customer-display-pair'){openCustomerDisplayPairing();return}
 if(action==='system-restart'){if(confirm('確定重新啟動系統介面？'))location.reload();return}
 if(action==='manual-close'){triggerPosAction('manual-close');return}
}
function bind(p){
 if(p!=='pos')clearInterval(window.__yjPromoSyncTimer);
 if(p!=='pos')clearInterval(window.__yjTmNoticeSyncTimer);
 if(p==='tm-notices')setTimeout(()=>{bindTmNoticeSearch();refreshTmNoticesCloud().then(changed=>{if(changed&&currentRenderedPage==='tm-notices')render('tm-notices')});},0);
 if(!['pos','members'].includes(p))setTimeout(()=>refreshTmQuickAmountKeys().catch(()=>{}),700);
setTimeout(()=>refreshTmScreenCategories({redraw:true}).catch(()=>{}),900);
clearInterval(window.__yjTmScreenCategorySyncTimer);
window.__yjTmScreenCategorySyncTimer=setInterval(()=>refreshTmScreenCategories({redraw:true}).catch(()=>{}),30000);
clearInterval(window.__yjMemberSyncTimer);
 if(p==='pickup')setTimeout(()=>{
  pickupTypeMode='ec';loadPickupResults('');
  if(!scServiceConnected())showScDisconnectedNotice();
  updateScDependentUi();
  const q=document.querySelector('#pickupQuery');if(q){q.oninput=()=>{q.value=q.value.replace(/\D/g,'').slice(0,3)};q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(q.value.length===3||q.value.length===0)loadPickupResults(q.value,'')}}}
  document.querySelectorAll('[data-pickup-type]').forEach(btn=>btn.onclick=()=>{pickupTypeMode=btn.dataset.pickupType||'ec';document.querySelectorAll('[data-pickup-type]').forEach(x=>x.classList.toggle('active',x===btn));loadPickupResults(q?.value||'','')});
 },0);
 if(p==='ec-flow')setTimeout(()=>{renderEcFlowWork('arrival');const sel=document.querySelector('#ecBatchFlowSelect'),code=document.querySelector('#ecBatchFlowCode');if(sel)sel.onchange=()=>{if(sel.value)code.value=sel.value};document.querySelectorAll('[data-ec-main-action]').forEach(b=>b.onclick=()=>renderEcFlowWork(b.dataset.ecMainAction));document.querySelectorAll('[data-ec-reprint]').forEach(b=>b.onclick=()=>alert((b.dataset.ecReprint==='arrival'?'進店補印':'離店補印')+'目前為預做，尚未送出實體列印。'));document.querySelector('#ecBatchFlowScan')?.addEventListener('click',()=>scanCode({title:ecFlowActiveAction==='arrival'?'掃描 EC 進貨 Key':'掃描 EC 退貨 Key',onResult:v=>{code.value=v}}));document.querySelector('#ecBatchFlowRun')?.addEventListener('click',runEcBatchFlow)},0);
 if(p==='home'||p==='dashboard'){clearInterval(window.__yjHomeClock);window.__yjHomeClock=setInterval(()=>{const el=document.querySelector('#homeLiveClock');if(el)el.textContent=new Date().toLocaleTimeString('zh-TW',{hour12:false})},1000)}document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{const page=b.dataset.page;if(page==='ec-flow'&&!scServiceConnected()){showScDisconnectedNotice('ecFlow');return}if(page==='transfer-in'&&!scServiceConnected()){showScDisconnectedNotice('transferIn');return}render(page)});document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>document.querySelector('#'+b.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));if(p==='pos'){
 state.category=state.category||'全部';
 drawPOS();
 bindPosMemberPanel();
 bindPosBottomMenu();
 scheduleCustomerDisplaySync();
 ensurePosBackgroundMusic();refreshCustomerDisplaySettingsCloud();

 const now=Date.now();
 const lastSync=Number(window.__yjPosLastInitialSyncAt||0);
 if(now-lastSync>30000){
  window.__yjPosLastInitialSyncAt=now;
  refreshPosMembersCloud({redraw:false}).then(changed=>{if(changed&&document.querySelector('#cartList'))drawPOS()}).catch(()=>{});
  cloudPullPromotionRules().then(changed=>{if(changed&&document.querySelector('#cartList'))drawPOS()}).catch(()=>{});
 }
 clearInterval(window.__yjMemberSyncTimer);
 window.__yjMemberSyncTimer=setInterval(async()=>{
  if(document.hidden||window.__yjMemberSyncBusy)return;
  window.__yjMemberSyncBusy=true;
  try{await refreshPosMembersCloud({redraw:false})}catch(_){}
  finally{window.__yjMemberSyncBusy=false}
 },60000);
 refreshTmNoticesCloud();
 clearInterval(window.__yjTmNoticeSyncTimer);
 window.__yjTmNoticeSyncTimer=setInterval(()=>{if(!document.hidden)refreshTmNoticesCloud()},60000);
 updatePosQuickButtonStates();
 clearInterval(window.__yjPromoSyncTimer);
 window.__yjPromoSyncTimer=setInterval(async()=>{
  if(document.hidden||window.__yjPromoSyncBusy)return;
  window.__yjPromoSyncBusy=true;
  try{
   const changed=await cloudPullPromotionRules();
   if(changed&&document.querySelector('#cartList'))requestAnimationFrame(()=>drawPOS());
  }catch(_){}
  finally{window.__yjPromoSyncBusy=false}
 },120000);

 document.querySelectorAll('[data-pos-correction-qty]').forEach(el=>el.oninput=()=>el.closest('.correction-pos-row')?.classList.toggle('active',Number(el.value||0)>0));
 const posSearch=document.querySelector('#search');
 if(posSearch){
  let searchFrame=0;
  posSearch.oninput=()=>{
   cancelAnimationFrame(searchFrame);
   searchFrame=requestAnimationFrame(drawPOS);
  };
  posSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitPosSearch()}};
 }
 setTimeout(checkFreshExpiryAlerts,100)
}if(p==='members'){refreshPosMembersCloud({redraw:false}).then(changed=>{if(changed&&document.querySelector('[data-edit-member], [data-delete-member]'))render('members')}).catch(()=>{});clearInterval(window.__yjMemberSyncTimer);window.__yjMemberSyncTimer=setInterval(async()=>{if(document.hidden||window.__yjMemberSyncBusy)return;window.__yjMemberSyncBusy=true;try{await refreshPosMembersCloud({redraw:false})}catch(_){}finally{window.__yjMemberSyncBusy=false}},30000)}if(p==='ordering'){document.querySelectorAll('[data-order-filter]').forEach(b=>b.onclick=()=>{const rows=load(K.orders,[]).filter(x=>x.type===b.dataset.orderFilter);document.querySelector('#orderRows').innerHTML=orderRows(rows)})}if(p==='products'){const s=document.querySelector('#productAdminSearch');s.oninput=()=>{document.querySelector('#productAdminRows').innerHTML=products().filter(x=>productMatches(x,s.value)).map(productRow).join('')||'<tr><td colspan="12">查無商品</td></tr>'}}if(p==='transactions'){bindTransactionMasterDetail(false)}if(p==='transactions-front'){bindTransactionMasterDetail(true)}}
function drawPOS(){if(isSelfCheckout()){scheduleCustomerDisplaySync(0);return}
 const search=document.querySelector('#search');
 const q=(search?.value||'').toLowerCase();
 document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===state.category));
 document.querySelectorAll('[data-pay]').forEach(b=>b.classList.toggle('selected',b.dataset.pay===state.payment));
 const cfgCats=tmScreenCategories();
 const activeCfg=cfgCats.find(c=>String(c.name||'').trim()===String(state.category||'').trim());
 const configuredIds=new Set((activeCfg?.productIds||[]).map(String));
 const rows=products().filter(x=>{
  const matchCategory=cfgCats.length
   ?!!activeCfg&&configuredIds.has(String(x.id))
   :x.category===state.category;
  const matchSearch=[x.name,x.shortName,x.code,x.category,...productBarcodes(x)].some(v=>String(v||'').toLowerCase().includes(q));
  return matchCategory&&matchSearch;
 });
 const pg=document.querySelector('#productGrid');
 if(pg){
  const quickCategoryName=tmCategoryDisplayName(state.category);
  const quickHtml=quickCategoryName==='蕃薯'
   ?tmQuickAmountKeys().map(x=>`<button class="pos-original-product tm-quick-category-key" data-tm-quick-key="${esc(x.id)}"><strong>${esc(x.name||'蕃薯')}</strong><b>${money(x.amount||0)}</b><small>快速金額</small></button>`).join('')
   :'';
  const productHtml=rows.map(x=>{const promos=itemActivePromotions(x);return `<button class="pos-original-product" data-product="${x.id}"><span class="pos-product-icon">${productDisplayIconHtml(x)}</span><strong>${esc(x.name)}</strong><b>${money(x.price)}</b>${promos.length?`<small>🏷️ ${esc(promos[0].name)}</small>`:''}<small>${esc(x.code||'')}｜庫存 ${x.stock}</small></button>`}).join('');
  pg.innerHTML=quickHtml+productHtml||'<div class="empty">此分類沒有商品</div>';
 }
 document.querySelectorAll('[data-tm-quick-key]').forEach(b=>b.onclick=()=>applyTmQuickAmountKey(b.dataset.tmQuickKey));
 document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>{if(state.correctionMode&&!state.exchangeMode&&!state.wasteMode)return alert('交易更正中只能調整原交易商品數量');try{const p=products().find(x=>String(x.id)===String(b.dataset.product));state.wasteMode?addWasteCartProduct(p):add(b.dataset.product,'browse');drawPOS();if(!state.wasteMode)showTmAgeReminder(p)}catch(e){alert(e.message)}});
 const cl=document.querySelector('#cartList');if(cl)cl.innerHTML=state.cart.map((x,i)=>`<div class="pos-classic-row ${state.selected===x.id?'selected':''} ${state.wasteMode?'waste-row':''}" data-cart="${x.id}"><span>${i+1}</span><strong>${esc(x.name)}${x.freshDiscounted?'<small>(即)</small>':''}${x.manualAmount?`<small>${esc(x.taxType||'')}</small>`:''}${state.wasteMode?`<small class="waste-reason-inline">原因：<select data-waste-cart-reason="${x.id}">${wasteReasonOptions(x.wasteReason||'過期')}</select></small>`:''}</strong><span>${Number(x.price||0)}</span><span class="qty"><button data-minus="${x.id}">−</button><input data-qty-input="${x.id}" value="${x.qty}" inputmode="numeric"><button data-plus="${x.id}">＋</button></span><span>${Number(x.price||0)*Number(x.qty||0)} <button data-remove="${x.id}">×</button></span></div>`).join('')||`<div class="empty">${state.wasteMode?'尚未 KEY 入廢棄商品':'購物車是空的'}</div>`;
 const t=totals(),tb=document.querySelector('#totalBox');if(tb){if(state.wasteMode){const w=state.cart.filter(x=>x.wasteItem),q=w.reduce((s,x)=>s+Number(x.qty||0),0),a=w.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);tb.innerHTML=`<div>廢棄品項 <b>${w.length}</b> 項</div><div>廢棄數量 <b>${q}</b> 件</div><div>廢棄總額 <b>${money(a)}</b></div>`}else{const allDiscount=Number(t.promotionDiscount||0)+Number(t.manualDiscount||0)+Number(t.pointDiscount||0)+Number(t.gamePrizeDiscount||0);const discountQty=(Array.isArray(t.gamePrizeApplications)?t.gamePrizeApplications.reduce((s,x)=>s+Number(x.qty||0),0):0)||((allDiscount>0)?1:0);tb.innerHTML=`<div>代收 ${t.serviceAmount>0?1:0} 件 <b>${money(t.serviceAmount||0)}</b></div><div>折扣 ${discountQty} 件 <b>${money(allDiscount)}</b><button class="pos-inline-discount" data-action="discount">折扣</button></div><div>商品 ${state.cart.filter(x=>!isPosServiceItem(x)).reduce((s,x)=>s+Number(x.qty||0),0)} 件 <b>${money(t.merchandiseTotal||0)}</b></div>`}}
 const checkoutMain=document.querySelector('.pos-checkout-main');if(checkoutMain){checkoutMain.textContent=state.wasteMode?'廢棄':'結帳';checkoutMain.classList.toggle('pos-waste-submit-main',state.wasteMode);checkoutMain.classList.toggle('is-locked',!state.wasteMode&&!subtotalReadyForCurrentTransaction())}updatePosGameCountdown()
 refreshPosMessage();
 document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=e=>{e.stopPropagation();try{if(state.wasteMode){const x=state.cart.find(v=>v.id===b.dataset.plus);setWasteCartQty(b.dataset.plus,Number(x?.qty||0)+1)}else qty(b.dataset.plus,1);drawPOS()}catch(err){alert(err.message)}});
 document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=e=>{e.stopPropagation();try{if(state.wasteMode){const x=state.cart.find(v=>v.id===b.dataset.minus);setWasteCartQty(b.dataset.minus,Math.max(1,Number(x?.qty||1)-1))}else qty(b.dataset.minus,-1);drawPOS()}catch(err){alert(err.message)}});
 document.querySelectorAll('[data-qty-input]').forEach(i=>{i.onclick=e=>e.stopPropagation();i.onchange=()=>{try{state.wasteMode?setWasteCartQty(i.dataset.qtyInput,Number(i.value)):setQty(i.dataset.qtyInput,Number(i.value));drawPOS()}catch(err){alert(err.message);drawPOS()}}});
 document.querySelectorAll('[data-waste-cart-reason]').forEach(s=>{s.onclick=e=>e.stopPropagation();s.onchange=()=>{const x=state.cart.find(v=>v.id===s.dataset.wasteCartReason);if(x)x.wasteReason=s.value}});
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=e=>{e.stopPropagation();state.cart=state.cart.filter(x=>x.id!==b.dataset.remove);drawPOS()});
 document.querySelectorAll('[data-cart]').forEach(r=>r.onclick=()=>{state.selected=r.dataset.cart;drawPOS()});
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;drawPOS()});
 document.querySelectorAll('[data-pay]').forEach(b=>{const ecOnly=!state.wasteMode&&state.cart.length>0&&state.cart.every(x=>x.ecPickup);b.disabled=state.wasteMode||(ecOnly&&b.dataset.pay!=='現金');b.classList.toggle('selected',!state.wasteMode&&b.dataset.pay===(ecOnly?'現金':state.payment));b.onclick=()=>{if(state.wasteMode)return;if(ecOnly&&b.dataset.pay!=='現金')return alert('EC 代收只能使用現金付款');state.payment=b.dataset.pay;drawPOS()}});
 const note=document.querySelector('#transactionNote');if(note){note.value=state.note||'';note.oninput=()=>{state.note=note.value;scheduleCustomerDisplaySync()};}
 const taxInput=document.querySelector('#transactionTaxId');if(taxInput){taxInput.value=state.taxId||'';taxInput.oninput=()=>{taxInput.value=taxInput.value.replace(/\D/g,'').slice(0,8);state.taxId=taxInput.value;const h=document.querySelector('#posHeaderTax');if(h)h.textContent=state.taxId||'—';scheduleCustomerDisplaySync(0)};}
 scheduleCustomerDisplaySync();
}
function productForm(p={}){
 const bars=productBarcodes(p),extra=bars.slice(1).join('\n');
 return `<div class="product-form-grid">
 <label>商品代號<input id="pcode" value="${esc(p.code||'')}" placeholder="例如 FS00125"></label>
 <label>商品名稱<input id="pn" value="${esc(p.name||'')}"></label>
 <label>商品簡稱<input id="psn" value="${esc(p.shortName||'')}"></label>
 <label>主要條碼<div class="inline-field"><input id="pb" value="${esc(bars[0]||'')}" placeholder="留空即自動產生"><button type="button" class="button" id="scanProductBarcode">📷 掃描</button><button type="button" class="button" id="autoProductBarcode">自動生成</button></div></label>
 <label class="full-field">其他條碼（每行一個）<textarea id="pba" rows="3">${esc(extra)}</textarea></label>
 <label>商品類別<select id="pc">${['常溫','鮮食','低溫','冷凍'].map(x=>`<option ${p.category===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <label>品群分類<select id="pg">${load(K.productGroups,['其他']).map(x=>`<option ${p.group===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
 <label>配送別<select id="pl">${['常溫','鮮食一配','鮮食二配','低溫一配','低溫二配','冷凍','EC'].map(x=>`<option ${(['乳品'].includes(p.deliveryType||p.logistics)?'低溫一配':(p.deliveryType||p.logistics))===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <label>售價<input id="pp" type="number" min="0" value="${p.price??0}"></label>
 <label>成本<input id="pco" type="number" min="0" value="${p.cost??0}"></label>
 <label>毛利率<div class="readonly-value" id="marginPreview">0.0%</div></label>
 <label>庫存<input id="pst" type="number" min="0" value="${p.stock??0}"></label>
 <label>安全庫存<input id="psa" type="number" min="0" value="${p.safeStock??5}"></label>
 <label>最大庫存<input id="pmax" type="number" min="0" value="${p.maxStock??0}"></label>
 <label>圖示<input id="pi" value="${esc(p.icon||'📦')}"></label>
 <label>商品狀態<select id="pstatus">${['啟用','新品','停售','停用','季節商品'].map(x=>`<option ${productStatusLabel(p)===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <label class="check-field"><input id="pneg" type="checkbox" ${p.allowNegativeStock?'checked':''}>允許負庫存</label>
 </div>
 <fieldset id="freshProductFields" class="fresh-settings">
  <legend>鮮食設定</legend>
  <div class="product-form-grid">
   <label>到期前自動折扣（小時）<input id="pdiscount" type="number" min="0" step="0.5" value="${p.discountBeforeHours??7}"></label>
   <label>到期前提醒（分鐘）<input id="palert" type="number" min="0" value="${p.alertBeforeMinutes??10}"></label>
   <label class="check-field"><input id="pblock" type="checkbox" ${p.blockExpiredSale!==false?'checked':''}>過期禁止販售</label>
  </div>
 </fieldset>
 <button class="primary" id="saveProduct">儲存商品</button>`;
}
function printHTML(title,body,options={}){
 const w=open('','_blank');
 if(!w){alert('無法開啟列印視窗，請允許此網站開啟彈出式視窗後再試一次');return false}
 const receipt=!!options.receipt,label=!!options.label;
 const pageCss=receipt?'@page{size:58mm auto;margin:4mm}':label?'@page{margin:4mm}':'@page{margin:12mm}';
 w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
 <style>
 ${pageCss}
 *{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;color:#111;margin:0;background:#fff}
 .print-page{padding:${receipt?'4mm':'12mm'};max-width:${receipt?'58mm':'900px'};margin:auto}
 .no-print{display:flex;gap:10px;margin-bottom:16px;position:sticky;top:0;background:#fff;padding:8px 0}
 .no-print button{padding:10px 16px;font-size:16px}
 table,th,td{border:1px solid #aaa;border-collapse:collapse;padding:7px}
 .receipt55{font-size:12px;line-height:1.45}.receipt55 h2{margin:0 0 4px;font-size:20px}.receipt55 hr{border:0;border-top:1px dashed #111;margin:7px 0}
 .r-center{text-align:center}.r-row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.r-total{display:flex;justify-content:space-between;align-items:flex-end;font-weight:800;margin:7px 0}.r-total strong{font-size:22px}
 .receipt-items{width:100%;font-size:11px}.receipt-items,.receipt-items th,.receipt-items td{border:0!important;padding:3px 1px!important}.receipt-items th{text-align:left;border-bottom:1px solid #111!important}.receipt-items th:nth-child(2),.receipt-items td:nth-child(2){text-align:center}.receipt-items th:last-child,.receipt-items td:last-child{text-align:right}.receipt-items small{display:block;font-size:10px}
 .r-history{font-size:10px;margin:2px 0}.signature-box{border:1px solid #111;height:72px;padding:8px;margin:8px 0}
 .product-label-browser{width:55mm;min-height:30mm;border:1px dashed #bbb;padding:4mm;text-align:center}.label-name{font-size:18px;font-weight:800}.label-price{font-size:34px;font-weight:900;margin:4px}.label-code{font-size:12px;margin-top:2px}
 @media print{.no-print{display:none!important}.print-page{padding:0}body{background:#fff}}
 </style></head><body><div class="print-page"><div class="no-print"><button onclick="window.close()">← 返回</button><button onclick="window.print()">🖨️ 系統列印</button></div>${receipt||label?'':`<h1>億家 SuperApp Enterprise</h1><h2>${esc(title)}</h2><p>列印時間：${new Date().toLocaleString('zh-TW')}</p>`}${body}</div></body></html>`);
 w.document.close();
 try{w.focus()}catch(_e){}
 return true;
}

async function applyEmployeeMasterUpdate(signal){
 if(window.__yjMasterUpdateBusy)return;
 const rev=Number(signal?.revision||0),last=Number(localStorage.getItem('yj_pos_last_employee_master_revision')||0);
 if(!rev||rev<=last)return;
 window.__yjMasterUpdateBusy=true;
 const o=document.querySelector('#updateOverlay'),bar=document.querySelector('#updateBar'),pct=document.querySelector('#updatePct'),title=document.querySelector('#updateTitle'),detail=document.querySelector('#updateDetail');
 title.textContent='TM 主檔更新中';detail.textContent='正在接收最新員工資料，更新完成前 TM 暫停操作。';bar.style.width='15%';pct.textContent='15%';o.classList.add('show');
 try{
  bar.style.width='45%';pct.textContent='45%';detail.textContent='下載員工主檔…';
  const employees=await cloudPullKey(K.employees);if(!Array.isArray(employees))throw new Error('無法取得員工主檔');try{await cloudPullKey(SELF_ACCOUNT_KEY)}catch(_){}
  await cloudPullKey(K.permissions);
  try{await cloudPullKey(HQ_SPECIAL_TM_PERMISSIONS_KEY)}catch(_e){}
  bar.style.width='85%';pct.textContent='85%';detail.textContent='套用員工帳號、職位、狀態與 HQ TM 權限…';
  localStorage.setItem('yj_pos_last_employee_master_revision',String(rev));
  const rows=load(K.updates,[]);rows.unshift({id:uid(),target:'POS',kind:'員工主檔',status:'成功',at:new Date().toISOString(),revision:rev});save(K.updates,rows);saveAudit('POS 主檔更新',`員工主檔 revision ${rev}`);
  bar.style.width='100%';pct.textContent='100%';detail.textContent='主檔更新完成，恢復操作中…';
  setTimeout(()=>{o.classList.remove('show');window.__yjMasterUpdateBusy=false;try{if(document.body.dataset.mode==='front'&&document.querySelector('.pos-classic'))render('front')}catch{}},700);
 }catch(err){detail.textContent='主檔更新失敗：'+err.message;bar.style.width='100%';pct.textContent='!';setTimeout(()=>{o.classList.remove('show');window.__yjMasterUpdateBusy=false},1800)}
}
async function checkEmployeeMasterUpdate(){
 if(document.hidden||window.__yjMasterUpdateBusy||!cloudConfigured())return;
 try{const signal=await cloudPullKey(K.masterUpdate);if(signal?.kind==='employee-master')await applyEmployeeMasterUpdate(signal)}catch(e){console.warn('master update check failed',e)}
}
function runUpdate(target){const o=document.querySelector('#updateOverlay'),bar=document.querySelector('#updateBar'),pct=document.querySelector('#updatePct'),title=document.querySelector('#updateTitle');if(target==='POS'){document.body.dataset.mode='front';render('front')}title.textContent=target==='POS'?'TM 主檔更新中':target+'更新中';o.classList.add('show');let p=0;const timer=setInterval(()=>{p=Math.min(100,p+10);bar.style.width=p+'%';pct.textContent=p+'%';if(p>=100){clearInterval(timer);const rows=load(K.updates,[]);rows.unshift({id:uid(),target,status:'成功',at:new Date().toISOString()});save(K.updates,rows);saveAudit('更新',target);setTimeout(()=>{o.classList.remove('show');alert(target+'更新完成')},500)}},150)}

document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{document.body.dataset.mode='back';render(b.dataset.nav)});
let b3sTestDevice=null;
async function testB3SBluetooth(){
 try{
  if(!('bluetooth' in navigator) || typeof navigator.bluetooth?.requestDevice!=='function'){
   alert('目前這個瀏覽器沒有提供 Web Bluetooth。請確認是在 Bluefy 裡開啟億家 TM。');
   return;
  }
  let available=true;
  if(typeof navigator.bluetooth.getAvailability==='function'){
   try{available=await navigator.bluetooth.getAvailability()}catch(_e){}
  }
  if(available===false){
   alert('目前偵測不到藍牙功能。請先開啟 iPhone 藍牙，並允許 Bluefy 使用藍牙。');
   return;
  }
  const B3S_OPTIONAL_SERVICES=[
   'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
   '0000ff00-0000-1000-8000-00805f9b34fb',
   '0000ffe0-0000-1000-8000-00805f9b34fb',
   '000018f0-0000-1000-8000-00805f9b34fb',
   '0000fee7-0000-1000-8000-00805f9b34fb',
   '49535343-fe7d-4ae5-8fa9-9fafd205e455'
  ];
  const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:B3S_OPTIONAL_SERVICES});
  b3sTestDevice=device;
  let connected=false, connectError='';
  if(device.gatt){
   try{
    const server=await device.gatt.connect();
    connected=!!server?.connected;
   }catch(err){connectError=String(err?.message||err)}
  }
  const name=device.name||'未提供裝置名稱';
  const id=device.id||'—';
  dlg('B3S 藍牙測試',`
   <div class="panel" style="margin:0">
    <h3>${connected?'✅ 已連線':'🔵 已找到藍牙裝置'}</h3>
    <p><strong>裝置：</strong>${esc(name)}</p>
    <p><strong>裝置 ID：</strong>${esc(id)}</p>
    <p><strong>GATT：</strong>${device.gatt?(connected?'已連線':'可用但尚未連線'):'此裝置未提供 GATT'}</p>
    ${connectError?`<p style="color:#b42318"><strong>連線訊息：</strong>${esc(connectError)}</p>`:''}
    <p style="color:#667085">如果這裡顯示 NIIMBOT／B3S 且已連線，就代表免費的 Bluefy 路線第一階段成功。</p>
    ${device.gatt&&connected?'<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="button" data-action="b3s-gatt-scan">🔎 讀取 GATT 服務</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div>':''}
   </div>`);
  device.addEventListener?.('gattserverdisconnected',()=>{
   if(b3sTestDevice===device) b3sTestDevice=null;
  });
 }catch(err){
  const msg=String(err?.message||err||'未知錯誤');
  if(err?.name==='NotFoundError') return;
  alert('B3S 藍牙測試失敗：'+msg);
 }
}


let b3sUartNotifyChar=null;
let b3sUartWriteChar=null;
let b3sNotifyLog=[];
const B3S_UART_SERVICE='e7810a71-73ae-499d-8c15-faa9aef0c3f2';
const B3S_UART_NOTIFY='bef8d6c9-9c21-4c9e-b632-bd58c1009f9f';
const B3S_UART_WRITE='bef8d6c9-9c21-4c9e-b632-bd58c1009f9f';
function fmtHex(view){try{return Array.from(new Uint8Array(view.buffer,view.byteOffset,view.byteLength)).map(x=>x.toString(16).padStart(2,'0')).join(' ').toUpperCase()}catch(_e){return ''}}
async function setupB3SUart(){
 try{
  const device=b3sTestDevice;
  if(!device?.gatt){alert('尚未選擇 B3S');return}
  const server=device.gatt.connected?device.gatt:await device.gatt.connect();
  const service=await server.getPrimaryService(B3S_UART_SERVICE);
  const notifyChar=await service.getCharacteristic(B3S_UART_NOTIFY);
  const writeChar=await service.getCharacteristic(B3S_UART_WRITE);
  b3sUartNotifyChar=notifyChar; b3sUartWriteChar=writeChar; b3sNotifyLog=[];
  notifyChar.addEventListener('characteristicvaluechanged',ev=>{
   const bytes=Array.from(new Uint8Array(ev.target.value.buffer,ev.target.value.byteOffset,ev.target.value.byteLength));
   const hex=bytes.map(x=>x.toString(16).padStart(2,'0')).join(' ').toUpperCase();
   b3sNotifyLog.unshift({at:new Date().toLocaleTimeString(),hex,bytes});
   if(b3sNotifyLog.length>30)b3sNotifyLog.length=30;
   const box=document.querySelector('#b3sNotifyLog');
   if(box) box.innerHTML=b3sNotifyLog.map(x=>`<div><b>${esc(x.at)}</b> ${esc(x.hex||'(空資料)')}</div>`).join('');
  });
  await notifyChar.startNotifications();
  dlg('B3S NIIMBOT 通道',`<div class="panel" style="margin:0"><h3>✅ NIIMBOT BLE 通道已確認</h3><p><strong>裝置：</strong>${esc(device.name||'B3S')}</p><p><strong>寫入：</strong><span style="word-break:break-all">${B3S_UART_WRITE}</span><br><small>write / writeWithoutResponse</small></p><p><strong>接收通知：</strong><span style="word-break:break-all">${B3S_UART_NOTIFY}</span><br><small>notify 已啟用</small></p><p style="color:#667085">UART 已就緒。下一步可只查詢型號／協議資訊，不會送出列印工作。</p><div id="b3sNotifyLog" style="max-height:180px;overflow:auto;font-family:monospace;font-size:12px;background:#f7f7f7;padding:10px;border-radius:10px">等待印表機通知…</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="button primary" data-action="b3s-info-probe">ℹ️ 讀取印表機資訊</button><button class="button" data-action="b3s-gatt-scan">返回 GATT</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div></div>`);
 }catch(err){alert('UART 通道設定失敗：'+String(err?.message||err))}
}

function b3sPack(cmd,data=[]){
 const out=new Uint8Array(7+data.length);
 out[0]=0x55;out[1]=0x55;out[2]=cmd;out[3]=data.length;
 let crc=cmd^data.length;
 data.forEach((v,i)=>{out[4+i]=v;crc^=v});
 out[4+data.length]=crc&0xff;out[5+data.length]=0xaa;out[6+data.length]=0xaa;
 return out;
}
async function b3sSafeWrite(bytes){
 if(!b3sUartWriteChar) throw new Error('UART 寫入通道尚未建立');
 if(typeof b3sUartWriteChar.writeValueWithoutResponse==='function') return b3sUartWriteChar.writeValueWithoutResponse(bytes);
 if(typeof b3sUartWriteChar.writeValue==='function') return b3sUartWriteChar.writeValue(bytes);
 if(typeof b3sUartWriteChar.writeValueWithResponse==='function') return b3sUartWriteChar.writeValueWithResponse(bytes);
 throw new Error('此瀏覽器不支援 BLE 寫入');
}
function b3sFrameFromBytes(bytes){
 if(!bytes||bytes.length<7)return null;
 for(let i=0;i<=bytes.length-7;i++){
  if(bytes[i]!==0x55||bytes[i+1]!==0x55)continue;
  const len=bytes[i+3],end=i+7+len;
  if(end>bytes.length)continue;
  return {cmd:bytes[i+2],data:bytes.slice(i+4,i+4+len)};
 }
 return null;
}
async function probeB3SInfo(){
 try{
  if(!b3sUartWriteChar||!b3sUartNotifyChar){alert('請先建立 UART 監聽');return}
  b3sNotifyLog=[];
  const box=document.querySelector('#b3sNotifyLog');
  if(box)box.textContent='正在送出唯讀資訊查詢…';
  // B3S 使用 NIIMBOT BLE characteristic，先做安全的連線/心跳/序號/狀態查詢；不建立列印工作。
  await b3sSafeWrite(new Uint8Array([0x03,0x55,0x55,0xc1,0x01,0x01,0xc1,0xaa,0xaa]));
  await new Promise(r=>setTimeout(r,300));
  await b3sSafeWrite(b3sPack(0xdc,[0x01]));
  await new Promise(r=>setTimeout(r,500));
  await b3sSafeWrite(new Uint8Array([0x55,0x55,0x40,0x01,0x0b,0x4a,0xaa,0xaa]));
  await new Promise(r=>setTimeout(r,650));
  await b3sSafeWrite(b3sPack(0xa5,[0x01]));
  await new Promise(r=>setTimeout(r,1000));
  const frames=b3sNotifyLog.map(x=>b3sFrameFromBytes(x.bytes)).filter(Boolean);
  const status=frames.find(x=>x.cmd===0xb5);
  const model=frames.find(x=>x.cmd===0x48);
  let modelId='尚未回覆';
  if(model?.data?.length>=2) modelId=((model.data[0]<<8)|model.data[1]).toString();
  else if(model?.data?.length===1) modelId=(model.data[0]<<8).toString();
  let proto='尚未回覆';
  if(status?.data?.length>=13){const n=status.data[11]*100+status.data[12];proto=(n>=204&&n<300)?'3':(n>=302?'5':(n>=300?'4':'未知'));}
  dlg('B3S 印表機回應',`<div class="panel" style="margin:0"><h3>ℹ️ 通訊測試完成</h3><p><strong>裝置：</strong>${esc(b3sTestDevice?.name||'B3S')}</p><p><strong>型號 ID：</strong>${esc(modelId)}</p><p><strong>推定協議版本：</strong>${esc(proto)}</p><p style="color:#667085">已確認 B3S 有回傳 NIIMBOT 封包。下一步可執行一次最小影像列印；不會讀寫 POS 商品、交易或庫存資料。</p><div style="max-height:260px;overflow:auto;font-family:monospace;font-size:12px;background:#f7f7f7;padding:10px;border-radius:10px">${b3sNotifyLog.length?b3sNotifyLog.map(x=>`<div><b>${esc(x.at)}</b> ${esc(x.hex||'(空資料)')}</div>`).join(''):'沒有收到通知資料'}</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="button primary" data-action="b3s-test-print">🧪 最小影像測試</button><button class="button" data-action="b3s-uart-setup">返回 BLE 通道</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div></div>`);
 }catch(err){alert('B3S 資訊查詢失敗：'+String(err?.message||err))}
}


async function b3sTestPrint(){
 try{
  if(!b3sUartWriteChar||!b3sUartNotifyChar){alert('請先建立 NIIMBOT BLE 通道');return}
  const ok=confirm('這次會送出一個最小的 B1 列印工作，讓 B3S 嘗試實際出紙 1 次。\n\n只會列印一個很小的黑色方塊，不含商品、價格、條碼，也不會變更 TM、庫存或交易資料。\n\n要繼續嗎？');
  if(!ok)return;
  b3sNotifyLog=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const u16=n=>[(n>>8)&0xff,n&0xff];
  const send=async(cmd,data=[1],delay=120)=>{await b3sSafeWrite(b3sPack(cmd,data));await wait(delay)};

  // Minimal B1-style print task based on NiimBlueLib protocol docs:
  // SetDensity -> SetLabelType -> PrintStart(7b) -> PageStart -> SetPageSize(6b)
  // -> image rows -> PageEnd -> PrintStatus -> PrintEnd.
  // Keep the raster deliberately tiny (32x32 px) so this test consumes minimal media.
  await send(0x21,[2]);                         // SetDensity
  await send(0x23,[1]);                         // SetLabelType
  await send(0x01,[0x00,0x01,0,0,0,0,0],180); // PrintStart, 1 page
  await send(0x03,[1]);                         // PageStart
  await send(0x13,[...u16(32),...u16(32),...u16(1)],180); // 32 rows x 32 cols, 1 copy

  // 8 blank rows, 16 black rows, 8 blank rows.
  await send(0x84,[...u16(0),8],80);            // PrintEmptyRow
  const row32=[0xff,0xff,0xff,0xff];
  await send(0x85,[...u16(8),0,0,0,16,...row32],120); // PrintBitmapRow, repeat 16
  await send(0x84,[...u16(24),8],80);           // PrintEmptyRow

  await send(0xe3,[1],500);                     // PageEnd
  await send(0xa3,[1],700);                     // PrintStatus
  await send(0xf3,[1],1200);                    // PrintEnd

  const frames=b3sNotifyLog.map(x=>b3sFrameFromBytes(x.bytes)).filter(Boolean);
  const seen=frames.map(x=>'0x'+x.cmd.toString(16).padStart(2,'0').toUpperCase());
  dlg('B3S 最小影像列印',`<div class="panel" style="margin:0"><h3>🧪 已送出最小列印工作</h3><p><strong>裝置：</strong>${esc(b3sTestDevice?.name||'B3S')}</p><p><strong>測試內容：</strong>32×32 px，小型黑色方塊</p><p><strong>收到回應：</strong>${esc(seen.length?seen.join('、'):'尚未收到')}</p><p style="color:#667085">請以印表機是否實際出紙為準。這次使用完整的 B1 列印流程，不是 0x5A 測試頁指令。</p><div style="max-height:240px;overflow:auto;font-family:monospace;font-size:12px;background:#f7f7f7;padding:10px;border-radius:10px">${b3sNotifyLog.length?b3sNotifyLog.map(x=>`<div><b>${esc(x.at)}</b> ${esc(x.hex||'(空資料)')}</div>`).join(''):'沒有收到通知資料'}</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="button primary" data-action="b3s-yijia-test-print">🖨️ 億家 TEST</button><button class="button" data-action="b3s-info-probe">返回資訊測試</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div></div>`);
 }catch(err){alert('B3S 最小影像列印失敗：'+String(err?.message||err))}
}

function b3sMakeTextBitmap(text='億家 TEST',width=256,height=72){
 const c=document.createElement('canvas');c.width=width;c.height=height;
 const ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
 ctx.fillStyle='#000';ctx.textBaseline='middle';ctx.textAlign='center';
 ctx.font='700 38px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';
 ctx.fillText(text,width/2,height/2+1);
 const img=ctx.getImageData(0,0,width,height).data;
 const rowBytes=Math.ceil(width/8), rows=[];
 for(let y=0;y<height;y++){
  const row=new Array(rowBytes).fill(0);let any=false;
  for(let x=0;x<width;x++){
   const i=(y*width+x)*4;
   const lum=(img[i]+img[i+1]+img[i+2])/3;
   if(img[i+3]>16 && lum<150){row[x>>3]|=(0x80>>(x&7));any=true}
  }
  rows.push({bytes:row,any});
 }
 return {width,height,rows};
}

async function b3sPrintYijiaTest(){
 try{
  if(!b3sUartWriteChar||!b3sUartNotifyChar){alert('請先建立 NIIMBOT BLE 通道');return}
  if(!confirm('將實際列印 1 張「億家 TEST」文字測試標籤。\n\n不會變更商品、交易、會員或庫存資料。要繼續嗎？'))return;
  b3sNotifyLog=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const u16=n=>[(n>>8)&0xff,n&0xff];
  const send=async(cmd,data=[1],delay=55)=>{await b3sSafeWrite(b3sPack(cmd,data));await wait(delay)};
  const bmp=b3sMakeTextBitmap('億家 TEST',256,72);

  await send(0x21,[2],100);
  await send(0x23,[1],100);
  await send(0x01,[0x00,0x01,0,0,0,0,0],160);
  await send(0x03,[1],100);
  await send(0x13,[...u16(bmp.height),...u16(bmp.width),...u16(1)],160);

  let y=0;
  while(y<bmp.height){
   if(!bmp.rows[y].any){
    let n=1;while(y+n<bmp.height&&!bmp.rows[y+n].any&&n<250)n++;
    await send(0x84,[...u16(y),n],35);y+=n;continue;
   }
   await send(0x85,[...u16(y),0,0,0,1,...bmp.rows[y].bytes],45);y++;
  }

  await send(0xe3,[1],450);
  await send(0xa3,[1],650);
  await send(0xf3,[1],1000);
  const frames=b3sNotifyLog.map(x=>b3sFrameFromBytes(x.bytes)).filter(Boolean);
  const seen=frames.map(x=>'0x'+x.cmd.toString(16).padStart(2,'0').toUpperCase());
  dlg('B3S 億家 TEST',`<div class="panel" style="margin:0"><h3>🖨️ 已送出「億家 TEST」</h3><p><strong>裝置：</strong>${esc(b3sTestDevice?.name||'B3S')}</p><p><strong>影像：</strong>256×72 px 黑白文字</p><p><strong>收到回應：</strong>${esc(seen.length?seen.join('、'):'尚未收到')}</p><p style="color:#667085">請以實際出紙內容為準。若中文字「億家」與 TEST 都正常，下一步即可接商品名稱、售價、商品代號與條碼。</p><div style="max-height:220px;overflow:auto;font-family:monospace;font-size:12px;background:#f7f7f7;padding:10px;border-radius:10px">${b3sNotifyLog.length?b3sNotifyLog.map(x=>`<div><b>${esc(x.at)}</b> ${esc(x.hex||'(空資料)')}</div>`).join(''):'沒有收到通知資料'}</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="button" data-action="b3s-info-probe">返回資訊測試</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div></div>`);
 }catch(err){alert('B3S 億家 TEST 列印失敗：'+String(err?.message||err))}
}


function b3sCanvasToBitmap(canvas){
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const {width,height}=canvas;
 const img=ctx.getImageData(0,0,width,height).data;
 const rowBytes=Math.ceil(width/8),rows=[];
 for(let y=0;y<height;y++){
  const bytes=new Uint8Array(rowBytes);let any=false;
  for(let x=0;x<width;x++){
   const i=(y*width+x)*4,lum=(img[i]*299+img[i+1]*587+img[i+2]*114)/1000;
   if(img[i+3]>20&&lum<150){bytes[x>>3]|=(0x80>>(x&7));any=true}
  }
  rows.push({bytes:[...bytes],any});
 }
 return {width,height,rows};
}
function b3sFitText(ctx,text,maxWidth,startSize,minSize=14){
 let size=startSize;
 while(size>minSize){ctx.font=`700 ${size}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`;if(ctx.measureText(text).width<=maxWidth)break;size-=2}
 return size;
}
function b3sMakeProductLabelBitmap(p,width=256,height=136){
 const c=document.createElement('canvas');c.width=width;c.height=height;
 const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.textBaseline='top';
 const pad=8;
 const name=String(p.name||'商品');
 b3sFitText(ctx,name,width-pad*2,26,16);ctx.textAlign='left';ctx.fillText(name,pad,5);
 ctx.font='700 44px -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif';ctx.textAlign='right';ctx.fillText(`$${Math.round(Number(p.price||0))}`,width-pad,34);
 ctx.font='600 13px -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif';ctx.textAlign='left';ctx.fillText(`代號 ${String(p.code||'—')}`,pad,45);
 const barcode=String(productBarcodes(p)[0]||p.barcode||p.code||'').trim();
 if(barcode){
  try{
   const bits=code128Bits(barcode),quiet=8,available=width-pad*2-quiet*2;
   const module=Math.max(1,Math.floor(available/bits.length));
   const bw=bits.length*module,startX=Math.floor((width-bw)/2),y0=82,bh=34;
   let i=0;ctx.fillStyle='#000';
   while(i<bits.length){if(bits[i]==='1'){let j=i;while(j<bits.length&&bits[j]==='1')j++;ctx.fillRect(startX+i*module,y0,(j-i)*module,bh);i=j}else i++}
   ctx.font='600 11px ui-monospace,SFMono-Regular,Menlo,monospace';ctx.textAlign='center';ctx.fillText(barcode,width/2,118);
  }catch(_e){ctx.font='600 12px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(barcode,width/2,102)}
 }
 return b3sCanvasToBitmap(c);
}
async function b3sPrintBitmap(bmp,{title='B3S 列印',labelType=1}={}){
 if(!b3sUartWriteChar)throw new Error('尚未建立 B3S 列印通道，請先執行「B3S 藍牙測試」並建立列印連線');
 b3sNotifyLog=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const u16=n=>[(n>>8)&0xff,n&0xff];
 const send=async(cmd,data=[1],delay=55)=>{await b3sSafeWrite(b3sPack(cmd,data));await wait(delay)};
 await send(0x21,[2],100);await send(0x23,[labelType],100);await send(0x01,[0x00,0x01,0,0,0,0,0],160);await send(0x03,[1],100);
 await send(0x13,[...u16(bmp.height),...u16(bmp.width),...u16(1)],160);
 let y=0;
 while(y<bmp.height){
  if(!bmp.rows[y].any){let n=1;while(y+n<bmp.height&&!bmp.rows[y+n].any&&n<250)n++;await send(0x84,[...u16(y),n],35);y+=n;continue}
  await send(0x85,[...u16(y),0,0,0,1,...bmp.rows[y].bytes],45);y++;
 }
 await send(0xe3,[1],450);await send(0xa3,[1],650);await send(0xf3,[1],1000);
 return b3sNotifyLog.map(x=>b3sFrameFromBytes(x.bytes)).filter(Boolean).map(x=>'0x'+x.cmd.toString(16).padStart(2,'0').toUpperCase());
}
async function printProductLabel(productId){
 const p=products().find(x=>x.id===productId);
 if(!p)return alert('找不到商品');
 if(!confirm(`列印商品價標？

${p.name}
售價：${money(p.price)}
條碼：${productBarcodes(p)[0]||'—'}`))return;
 const body=`<div class="product-label-browser">
   <div class="label-name">${esc(p.name)}</div>
   <div class="label-price">${money(p.price)}</div>
   <div class="label-code">商品代號：${esc(p.code||'—')}</div>
   <div class="label-code">條碼：${esc(productBarcodes(p)[0]||'—')}</div>
 </div>`;
 const ok=printHTML('商品價標',body,{label:true});
 if(!ok)return alert('無法開啟列印頁，請允許彈出式視窗後再試一次');
 saveAudit('列印商品價標',`${p.code||''}｜${p.name}`);
}

async function scanB3SGatt(){
 try{
  const device=b3sTestDevice;
  if(!device?.gatt){alert('尚未選擇 B3S');return}
  const server=device.gatt.connected?device.gatt:await device.gatt.connect();
  const candidates=[
   'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
   '0000ff00-0000-1000-8000-00805f9b34fb',
   '0000ffe0-0000-1000-8000-00805f9b34fb',
   '000018f0-0000-1000-8000-00805f9b34fb',
   '0000fee7-0000-1000-8000-00805f9b34fb',
   '49535343-fe7d-4ae5-8fa9-9fafd205e455'
  ];
  const rows=[];
  const seen=new Set();
  async function addService(service){
   if(!service||seen.has(service.uuid))return;
   seen.add(service.uuid);
   let chars=[];
   try{chars=await service.getCharacteristics()}catch(_e){}
   if(!chars.length){rows.push({service:service.uuid,char:'—',props:'—'});return}
   for(const ch of chars){
    const p=ch.properties||{};
    const props=['read','write','writeWithoutResponse','notify','indicate'].filter(k=>p[k]).join(', ')||'—';
    rows.push({service:service.uuid,char:ch.uuid,props});
   }
  }
  try{
   const services=await server.getPrimaryServices();
   for(const service of services)await addService(service);
  }catch(_e){}
  for(const uuid of candidates){
   try{await addService(await server.getPrimaryService(uuid))}catch(_e){}
  }
  let html='';
  if(rows.length){
   html=`<div style="overflow:auto;max-height:55vh"><table style="width:100%;font-size:13px"><thead><tr><th>Service UUID</th><th>Characteristic UUID</th><th>屬性</th></tr></thead><tbody>${rows.map(r=>`<tr><td style="word-break:break-all">${esc(r.service)}</td><td style="word-break:break-all">${esc(r.char)}</td><td>${esc(r.props)}</td></tr>`).join('')}</tbody></table></div>`;
  }else{
   html='<p style="color:#b42318">目前沒有讀到可存取的 GATT Service。這不代表 B3S 不能列印，可能只是它使用了目前尚未授權的特殊 UUID。</p>';
  }
  dlg('B3S GATT 服務掃描',`<div class="panel" style="margin:0"><h3>🔎 只讀診斷</h3><p><strong>裝置：</strong>${esc(device.name||'B3S')}</p>${html}<p style="color:#667085">已找到標準 Transparent UART 服務。下一步只會開啟接收通知，不會送出列印資料。</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="button" data-action="b3s-uart-setup">📡 建立 UART 監聽</button><button class="button" data-action="b3s-disconnect">中斷連線</button></div></div>`);
 }catch(err){alert('GATT 服務掃描失敗：'+String(err?.message||err))}
}
document.body.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.action==='self-start-sale'){selfCheckoutScreen='sale';saveAudit('自助交易模式','商品結帳');render('pos');return}
 if(b.dataset.action==='self-home'){
  if(state.cart?.length&&!confirm('返回首頁會取消目前交易，確定返回？'))return;
  if(state.cart?.length)clearSelfTransaction({silent:false,reason:'返回自助首頁'});
  selfCheckoutScreen='home';render('pos');return
 }
 if(b.dataset.action==='self-pickup'){saveAudit('自助交易模式','跨店取／兌換');openSelfPickupEntry();return}
 if(b.dataset.action==='self-ec-send'){saveAudit('自助交易模式','包裹寄件');openSelfEcBarcodeFlow('send');return}
 if(b.dataset.action==='self-ec-pickup'){saveAudit('自助交易模式','包裹取貨');openSelfEcBarcodeFlow('pickup');return}
 if(b.dataset.action==='self-language'){dlg('Language','<div class="panel"><h3>語言 / Language</h3><button class="primary" id="selfLangZh">繁體中文</button><button class="button" id="selfLangEn" disabled>English（預留）</button></div>');setTimeout(()=>document.querySelector('#selfLangZh')?.addEventListener('click',()=>genericDialog.close()),0);return}
 if(b.dataset.action==='self-manage'){
  if(state.cart?.length){
   resetSelfIdleTimer();
   alert('交易中無法操作管理功能。');
   return
  }
  openSelfManagerAuth();return
 }
 if(b.dataset.selfRemove){selfRemoveCartLine(b.dataset.selfRemove);return}
 if(b.dataset.selfCategory){openSelfCategory(b.dataset.selfCategory);return}
 if(b.dataset.selfProduct){try{const p=products().find(x=>String(x.id)===String(b.dataset.selfProduct));add(b.dataset.selfProduct,'self');genericDialog.close();resetSelfIdleTimer();render('pos');if(p&&(p.alcohol===true||p.tobacco===true||/菸|煙|酒/.test([p.category,p.group,p.name].filter(Boolean).join('｜')))){selfVerifiedSignature='';setTimeout(()=>openSelfStaffVerification(()=>render('pos')),30)}}catch(e){alert(e.message)}return}
 if(b.dataset.action==='exit-training'){setTmTrainingMode(false);saveAudit('教育訓練','離開教育訓練模式');render('pos');return}
 if(b.dataset.action==='b3s-bluetooth-test'){await testB3SBluetooth();return}
 if(b.dataset.action==='b3s-gatt-scan'){await scanB3SGatt();return}
 if(b.dataset.action==='b3s-uart-setup'){await setupB3SUart();return}
 if(b.dataset.action==='b3s-info-probe'){await probeB3SInfo();return}
 if(b.dataset.action==='b3s-test-print'){await b3sTestPrint();return}
 if(b.dataset.action==='b3s-yijia-test-print'){await b3sPrintYijiaTest();return}
 if(b.dataset.action==='b3s-disconnect'){try{b3sUartNotifyChar?.stopNotifications?.()}catch(_e){} try{b3sTestDevice?.gatt?.disconnect()}catch(_e){} b3sUartNotifyChar=null;b3sUartWriteChar=null;b3sTestDevice=null;genericDialog.close();alert('已中斷藍牙連線');return}
 if(b.dataset.action==='cloud-save'){if(!requirePermission('cloudRemoteSync'))return;
  if(!requirePermission('systemSettingsAccess'))return;
  setCloudConfig(readCloudForm());
  saveAudit('雲端同步設定','Supabase 連線設定已更新');
  alert('雲端設定已儲存');
  render('system-settings');
  return;
 }
 if(b.dataset.action==='cloud-test'){if(!requirePermission('cloudRemoteSync'))return;
  try{
   if(hasPermission('systemSettingsAccess'))setCloudConfig(readCloudForm());
   await testCloudConnection();
   alert('Supabase 連線成功');
  }catch(e){alert('Supabase 連線失敗：'+e.message)}
  render('system-settings');return;
 }
 if(b.dataset.action==='cloud-push-all'){if(!requirePermission('cloudRemoteSync'))return;
  if(!confirm('確定要將此裝置目前的本機資料上傳並覆蓋同店號雲端資料嗎？'))return;
  try{
   if(hasPermission('systemSettingsAccess'))setCloudConfig(readCloudForm());
   const n=await cloudPushAll();
   alert(`已上傳 ${n} 組資料到雲端`);
  }catch(e){alert('上傳失敗：'+e.message)}
  render('system-settings');return;
 }
 if(b.dataset.action==='cloud-pull-all'){if(!requirePermission('cloudRemoteSync'))return;
  if(!confirm('確定要從雲端下載資料並覆蓋此裝置的本機資料嗎？'))return;
  try{
   if(hasPermission('systemSettingsAccess'))setCloudConfig(readCloudForm());
   const n=await cloudPullAll();
   alert(`已下載 ${n} 組資料，系統將重新載入`);
   location.reload();
  }catch(e){alert('下載失敗：'+e.message)}
  return;
 }

 if(b.dataset.action==='new-member-bonus'){openMemberBonusCampaignForm();return}
 if(b.dataset.editMemberBonus){const x=memberBonusCampaignRows().find(v=>v.id===b.dataset.editMemberBonus);if(x)openMemberBonusCampaignForm(x);return}
 if(b.dataset.disableMemberBonus){
  if(!requirePermission('memberBonusCampaignSettings'))return;
  const rows=memberBonusCampaignRows(),x=rows.find(v=>v.id===b.dataset.disableMemberBonus);
  if(x){x.active=x.active===false;save(K.memberBonusCampaigns,rows);saveAudit('會員贈點活動狀態',`${x.name}｜${x.active?'啟用':'停用'}`);render('members')}
  return;
 }

 if(b.dataset.action==='save-point-settings'){savePointSettings();return}
 if(b.dataset.action==='refresh-promotions'){cloudPullPromotionRules().then(()=>{render('promotions')}).catch(e=>alert(e.message));return}
 if(b.dataset.action==='new-promotion'){openPromotionForm();return}
 if(b.dataset.editPromotion){const x=promotionRows().find(v=>v.id===b.dataset.editPromotion);if(x)openPromotionForm(x);return}
 if(b.dataset.deletePromotion){if(confirm('確定刪除此活動？')){save(K.promotionRules,promotionRows().filter(v=>v.id!==b.dataset.deletePromotion));render('promotions')}return}
 if(b.dataset.action==='save-system-settings'){saveSystemSettings();return}
 if(b.dataset.action==='system-restart'){if(confirm('確定重新啟動系統介面？'))location.reload();return}
 if(b.dataset.action==='view-x-history'){render('xaccount');return}


 if(b.dataset.action==='open-shift'){startShift();return}
 if(b.dataset.action==='close-shift'){closeShift();return}
 if(b.dataset.xPrint){const x=xAccountRows().find(v=>v.id===b.dataset.xPrint);if(x)printXAccount(x);return}

 if(b.dataset.action==='return-to-tm'){
  try{if(genericDialog?.open)genericDialog.close()}catch(_e){}
  transactionSelectedId='';posBottomMenuOpen='';
  render('pos');return
 }
 if(b.dataset.action==='cancel-correction-mode'){endCorrectionMode();render('pos');return}
 
 if(b.dataset.action==='cancel-exchange'){
  endExchangeMode();render('transactions-front');return;
 }
 if(b.dataset.action==='confirm-exchange'){
  const mode=state.exchangeMode;
  if(!mode)return;
  try{
   const a=exchangeAmounts();
   const returned=(mode.originals||[]).map(o=>{
    const c=state.cart.find(x=>x.correctionSource&&x.lineId===o.lineId);
    const kept=c?Number(c.qty||0):0;
    return {lineId:o.lineId,productId:o.productId,returnQty:Math.max(0,Number(o.availableQty||0)-kept)};
   }).filter(x=>x.returnQty>0);
   const replacements=structuredClone(state.cart.filter(x=>!x.correctionSource));
   if(!returned.length)return alert('請先減少或移除要退回的原商品');
   if(!replacements.length)return alert('請先加入要換的新商品');
   const d=Number(a.difference||0);
   const text=d>0?`需補款 ${money(d)}`:d<0?`應退款 ${money(Math.abs(d))}`:'差額 $0';
   if(!confirm(`${text}\n確定進行換貨？`))return;
   correctSale(mode.saleId,returned,'換貨','換貨退回原商品');reconcileMemberPointsAfterReturn(mode.saleId);
   endExchangeMode();
   state.cart=replacements;
   state.note=`換貨新商品｜原交易 ${mode.saleId}`;
   alert(`原商品退回完成｜${text}\n請接著用正常 TM 結帳新商品。`);
   drawPOS();
  }catch(err){alert(err.message)}
  return;
 }
 if(b.dataset.action==='confirm-pos-correction'){openCorrectionRefundDialog();return}


 if(Object.prototype.hasOwnProperty.call(b.dataset,'pickupSurname')){
  const surname=String(b.dataset.pickupSurname||'');
  document.querySelectorAll('[data-pickup-surname]').forEach(x=>x.classList.toggle('active',String(x.dataset.pickupSurname||'')===surname));
  loadPickupResults(document.querySelector('#pickupQuery')?.value.trim()||'',surname);
  return
 }
 if(b.dataset.action==='pickup-search'){const el=document.querySelector('#pickupQuery');const q=String(el?.value||'').replace(/\D/g,'').slice(0,3);if(el)el.value=q;if(q&&q.length!==3)return alert('搜尋只能輸入手機末三碼（3位數字）');loadPickupResults(q,'');return}
 if(b.dataset.action==='pickup-filter-left'){document.querySelector('#pickupSurnameFilters')?.scrollBy({left:-240,behavior:'smooth'});return}
 if(b.dataset.action==='pickup-filter-right'){document.querySelector('#pickupSurnameFilters')?.scrollBy({left:240,behavior:'smooth'});return}
 if(b.dataset.action==='pickup-scan'){scanCode({title:'掃描取貨包裹',onResult:code=>{const el=document.querySelector('#pickupQuery');if(el){el.value=code;loadPickupResults(code)}}});return}
 if(b.dataset.action==='ec-flow-refresh'){renderEcFlowWork(ecFlowActiveAction||'arrival');return}
 if(b.dataset.action==='ec-front'){ecActionDialog(null,true);return}
 if(b.dataset.action==='ec-arrival'){ecActionDialog('arrival');return}
 if(b.dataset.action==='ec-pickup'){ecActionDialog('pickup');return}
 if(b.dataset.action==='ec-leave'){ecActionDialog('leave');return}

 if(b.dataset.action==='new-fresh-batch'){openFreshBatchForm();return}
 if(b.dataset.freshEdit){const item=freshBatches().find(x=>x.id===b.dataset.freshEdit);if(item)openFreshBatchForm(item);return}
 if(b.dataset.freshWaste){
  const rows=freshBatches(),item=rows.find(x=>x.id===b.dataset.freshWaste);
  if(!item)return;
  if(!confirm(`確定將批次 ${item.batchNo} 登錄為已廢棄？`))return;
  const wasteQty=Math.max(0,Number(item.remainingQty||0));
  item.status='已廢棄';item.remainingQty=0;item.updatedAt=new Date().toISOString();
  save(K.freshBatches,rows);
  const ps=load(K.products,[]),prod=ps.find(x=>x.id===item.productId)||ps.find(x=>x.name===item.productName);
  if(prod&&wasteQty>0){const before=Number(prod.stock||0);prod.stock=Math.max(0,before-wasteQty);save(K.products,ps);const wr=load(K.waste,[]);wr.unshift({id:uid(),productId:prod.id,productCode:prod.code||'',barcode:prod.barcode||'',name:prod.name,qty:wasteQty,reason:'鮮食批次廢棄',batchNo:item.batchNo,user:currentUser().name,at:new Date().toISOString(),stockBefore:before,stockAfter:prod.stock});save(K.waste,wr);}
  saveAudit('廢棄鮮食批次',`${item.batchNo}｜${item.productName}｜${wasteQty}件｜庫存同步`);
  render('quality');return;
 }

 if(b.dataset.v531OrderType){v531OpenOrdering(b.dataset.v531OrderType);return}
 if(b.dataset.v531OrderPrint){const o=load(K.orders,[]).find(x=>x.id===b.dataset.v531OrderPrint);if(o)v531PrintOrder(o);return}
 if(b.dataset.v531OrderDelete){
  if(!confirm('確定刪除此訂購單？'))return;
  const rows=load(K.orders,[]),o=rows.find(x=>x.id===b.dataset.v531OrderDelete);
  save(K.orders,rows.filter(x=>x.id!==b.dataset.v531OrderDelete));
  saveAudit('刪除訂購單',o?.id||b.dataset.v531OrderDelete);render('ordering');return;
 }

 if(b.dataset.permissionPerson){openPermissionCategories(b.dataset.permissionPerson);return}
 if(b.dataset.permissionCategory){openPermissionDetail(b.dataset.permissionTarget,b.dataset.permissionCategory);return}

 if(b.dataset.tmNotice){await openTmNotice(b.dataset.tmNotice);return}
 if(b.dataset.action==='voice-shortcut'){openVoiceShortcut();return}
 if(b.dataset.action==='alcohol-reminder-toggle'){toggleAlcoholReminder();return}
 if(b.dataset.action==='collection-payment'){if(isSelfCheckout())return alert('自助模式無法使用繳帳單／代收');openCollectionPayment();return}
 if(b.dataset.action==='back')requestMode('back');if(b.dataset.action==='front')requestMode('front');if(b.dataset.action==='logout'){logout();showLogin('front')}if(b.dataset.action==='close-dialog'){if(window.__tmPeripheralDetectToken)return;genericDialog.close();}
 if(b.dataset.pay){state.payment=b.dataset.pay;document.querySelectorAll('.payment').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}
 if(b.dataset.action==='clear'){
  if((state.cart.length||state.taxId||state.transactionId)&&!confirm('確定取消本筆交易？\n商品、折扣、會員、統一編號與抽獎狀態都會清除。'))return;
  if(isSelfCheckout()){clearSelfTransaction({silent:false,reason:'顧客按交易取消'});render('pos');return}
  tmMemberCustomerInputActive=false;stopPosGameTimers();posGameSession=null;posSubtotalSignature='';posSubtotalReady=false;clearPosGameCompleted();state.cart=[];state.discount=0;state.gamePrizeApplications=[];state.note='';state.taxId='';state.transactionId='';state.selected='';state.member=null;state.memberRedeemPoints=0;state.memberRedeemAmount=0;drawPOS();scheduleCustomerDisplaySync(0)
 }
 if(b.id==='scanProductBarcode'){scanCode({title:'掃描商品條碼',onResult:code=>{const el=document.querySelector('#pb');if(el)el.value=code}})}
 if(b.dataset.action==='scan-transfer-no'){if(!scServiceConnected()){showScDisconnectedNotice('transferIn');return}scanCode({title:'掃描轉貨單',onResult:code=>{const el=document.querySelector('#transferNo');if(el)el.value=code}})}
 if(b.dataset.action==='scan'){scanCode({title:state.wasteMode?'掃描廢棄商品':'掃描商品／EC／代收條碼／QR Code',onResult:(code,meta)=>processUnifiedPosCode(code,{clearInput:false,scanMeta:meta})})}
 if(b.dataset.action==='discount'){if(state.wasteMode)return alert('廢棄模式不使用折扣');if(state.cart.some(isPosServiceItem))return alert('代收／EC 服務性交易不可使用折扣');const v=Number(prompt('折扣金額',state.discount));if(!Number.isNaN(v))state.discount=Math.max(0,v);drawPOS()}
 if(b.dataset.action==='manual-price'){const c=state.cart.find(x=>x.id===state.selected);if(!c)return alert('請先點選購物車商品');if(isPosServiceItem(c))return alert('代收／EC 金額不可在結帳畫面修改');const v=Number(prompt('輸入新單價',c.price));if(!Number.isNaN(v)&&v>=0){c.price=v;drawPOS()}}
 if(b.dataset.action==='manual-qty'){const c=state.cart.find(x=>x.id===state.selected);if(!c)return alert('請先點選購物車商品');const v=Number(prompt('輸入數量',c.qty));if(v>0){c.qty=Math.floor(v);drawPOS()}}
 if(b.dataset.action==='hold'){if(state.wasteMode)return alert('廢棄模式不使用交易暫存');if(!state.cart.length)return alert('購物車是空的');const rows=load(K.held,[]);const name=prompt('暫停交易名稱／備註（可留白）','')||'';const id=uid();rows.unshift({id,name,items:structuredClone(state.cart),discount:state.discount,payment:state.payment,note:state.note||'',at:new Date().toISOString()});save(K.held,rows);state.cart=[];state.discount=0;state.gamePrizeApplications=[];state.note='';state.selected='';state.memberRedeemPoints=0;state.memberRedeemAmount=0;drawPOS();saveAudit('掛單',id)}
 if(b.dataset.action==='restore'){openHeldTransactionsDialog();return}
 if(b.dataset.action==='subtotal'){if(openCorrectionRefundDialog())return;runSubtotalFlow();return}
 if(b.dataset.action==='checkout'){
  if(state.wasteMode){commitWasteFromPos();return}
  if(!state.cart.length)return alert('目前沒有商品，無法結帳');
  if(posSubtotalSignature!==posCheckoutSignature())return alert('請先按「小計」後才能結帳');
  if(!posSubtotalReady)return alert('客顯遊戲尚未完成，請等待倒數或完成抽獎');
  if(tmTrainingMode()){openTrainingCheckoutDialog();return}
  if(isSelfCheckout()){openSelfCheckoutDialog();return}
  openCheckoutDialog();return
 }
 if(b.dataset.action==='exit-waste-mode'){exitWasteMode();return}
 if(b.dataset.action==='next-sale'){state.lastCompletedSale=null;posBottomMenuOpen='';render('pos');scheduleCustomerDisplaySync(0);return}
 if(b.dataset.action==='add-taxable-amount'){addManualTaxAmount('應稅');return}
 if(b.dataset.action==='add-taxfree-amount'){addManualTaxAmount('免稅');return}
 if(b.dataset.action==='tm-peripheral-popup'){openTmPeripheralPopup();return}
 if(b.dataset.action==='tm-sc-detail'){window.__tmPeripheralDetail='SC';render('tm-peripherals');return}
 if(b.dataset.action==='tm-peripheral-back'){window.__tmPeripheralDetail='';render('tm-peripherals');return}
 if(b.dataset.action==='tm-sc-refresh'){
  b.disabled=true;b.textContent='同步中…';
  try{await publishTmScLink('manual-refresh');if(cloudConfigured()){await cloudPullKey(K.notices);await testCloudConnection()}alert('SC 連線／同步完成')}catch(err){alert('SC 連線失敗：'+String(err?.message||err))}
  render('tm-peripherals');return
 }
 if(b.dataset.action==='tm-peripheral-prebuild'){alert(`${b.dataset.device||'設備'}目前為預作功能，尚未接入實際硬體。`);return}
 if(b.dataset.action==='tm-notice-refresh'){await refreshTmNoticesCloud();render('tm-notices');return}
 if(b.dataset.action==='tm-notice-back'){window.__tmNoticeDetailId='';render('tm-notices');return}

 if(b.dataset.action==='manage-groups'){const groups=load(K.productGroups,[]);dlg('品群分類管理',`<div id="groupList">${groups.map((x,i)=>`<div class="group-row"><span>${esc(x)}</span><button class="button danger" data-remove-group="${i}">刪除</button></div>`).join('')}</div><div class="inline-field"><input id="newGroup" placeholder="新增品群名稱"><button class="primary" id="addGroup">新增</button></div>`);setTimeout(()=>{addGroup.onclick=()=>{const v=newGroup.value.trim();if(!v)return;if(groups.includes(v))return alert('品群已存在');groups.push(v);save(K.productGroups,groups);genericDialog.close();render('products')}} ,0)}
 if(b.dataset.removeGroup!==undefined){const groups=load(K.productGroups,[]),i=Number(b.dataset.removeGroup);if(confirm(`刪除品群「${groups[i]}」？`)){groups.splice(i,1);save(K.productGroups,groups);genericDialog.close();render('products')}}
 if(b.dataset.action==='new-order'){let items=[];dlg('新增訂購單',orderForm());const redraw=()=>{const el=document.querySelector('#orderItemList');if(el)el.innerHTML=items.map((x,i)=>`<div class="order-item"><span>${esc(x.name)}</span><input type="number" min="1" value="${x.qty}" data-order-qty="${i}"><button class="button danger" data-order-remove="${i}">刪除</button></div>`).join('')||'<p>尚未加入商品</p>'};setTimeout(()=>{redraw();scanOrderBarcode.onclick=()=>scanCode({title:'掃描訂購商品',onResult:code=>{orderBarcode.value=code}});addOrderItem.onclick=()=>{const p=products().find(x=>x.barcode===orderBarcode.value.trim());if(!p)return alert('找不到商品');const old=items.find(x=>x.productId===p.id);old?old.qty++:items.push({productId:p.id,name:p.name,barcode:p.barcode,group:p.group||'其他',qty:1});orderBarcode.value='';redraw()};dialogBody.onclick=e=>{const q=e.target.closest('[data-order-qty]'),r=e.target.closest('[data-order-remove]');if(q){items[Number(q.dataset.orderQty)].qty=Math.max(1,Number(q.value)||1)}if(r){items.splice(Number(r.dataset.orderRemove),1);redraw()}};saveOrder.onclick=()=>{if(!items.length)return alert('請至少加入一項商品');const rows=load(K.orders,[]),o={id:`OR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,type:orderType.value,deliveryDate:orderDate.value,items,note:orderNote.value.trim(),status:'已建立',at:new Date().toISOString(),user:currentUser().name};rows.unshift(o);save(K.orders,rows);saveAudit('建立訂購單',`${o.id}｜${o.type}`);genericDialog.close();render('ordering')}} ,0)}
 if(b.dataset.viewOrder){const o=load(K.orders,[]).find(x=>x.id===b.dataset.viewOrder);dlg('訂購單 '+o.id,`<p>類型：${esc(o.type)}</p><p>預定到貨：${esc(o.deliveryDate||'')}</p><table class="table"><tr><th>商品</th><th>品群</th><th>數量</th></tr>${o.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.group||'其他')}</td><td>${x.qty}</td></tr>`).join('')}</table><p>備註：${esc(o.note||'')}</p><button class="button" id="printOrder">列印</button>`);setTimeout(()=>printOrder.onclick=()=>printHTML('訂購單 '+o.id,document.querySelector('#dialogBody').innerHTML),0)}
 if(b.dataset.deleteOrder){const rows=load(K.orders,[]),o=rows.find(x=>x.id===b.dataset.deleteOrder);if(confirm(`刪除訂購單 ${o.id}？`)){save(K.orders,rows.filter(x=>x.id!==o.id));saveAudit('刪除訂購單',o.id);render('ordering')}}
 if(b.dataset.action==='new-product'){dlg('新增商品',productForm());setTimeout(()=>{bindProductFreshFields();document.querySelector('#saveProduct').onclick=()=>{const rows=load(K.products,[]),item={id:uid(),...readProductForm()};const error=validateProductItem(item,rows);if(error)return alert(error);rows.unshift(item);save(K.products,rows);saveAudit('新增商品',`${item.code}｜${item.name}`);genericDialog.close();render('products')}},0)}
 if(b.dataset.printProduct){await printProductLabel(b.dataset.printProduct);return}
 if(b.dataset.editProduct){const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.editProduct);dlg('修改商品',productForm(p));setTimeout(()=>{bindProductFreshFields();document.querySelector('#saveProduct').onclick=()=>{const next=readProductForm(),error=validateProductItem(next,rows,p.id);if(error)return alert(error);const before=`${p.code||''}｜${p.name}`;Object.assign(p,next);save(K.products,rows);saveAudit('修改商品',`${before}→${p.code}｜${p.name}`);genericDialog.close();render('products')}},0)}
 if(b.dataset.deleteProduct){const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.deleteProduct);if(confirm(`確定刪除「${p.name}」？`)){save(K.products,rows.filter(x=>x.id!==p.id));saveAudit('刪除商品',p.name);render('products')}}
 if(b.dataset.action==='inventory-adjust'){dlg('庫存異動',`<label>商品<select id="iap">${products().map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>異動類型<select id="iat"><option>入庫</option><option>出庫</option><option>盤點調整</option><option>其他</option></select></label><label>異動數量（出庫請輸入負數）<input id="iaq" type="number"></label><label>原因<input id="iar"></label><button class="primary" id="ias">確認</button>`);setTimeout(()=>ias.onclick=()=>{const ps=load(K.products,[]),p=ps.find(x=>x.id===iap.value),q=Number(iaq.value);if(!q)return alert('請輸入異動數量');p.stock=Math.max(0,p.stock+q);save(K.products,ps);const moves=load(K.inventoryMoves,[]);moves.unshift({id:uid(),product:p.name,qty:q,type:iat.value,reason:iar.value,user:currentUser().name,at:new Date().toISOString()});save(K.inventoryMoves,moves);saveAudit('庫存異動',`${p.name} ${q}`);genericDialog.close();render('inventory')},0)}
 if(b.dataset.stock){const ps=load(K.products,[]),p=ps.find(x=>x.id===b.dataset.stock),v=Number(prompt('輸入調整後庫存',p.stock));if(!Number.isNaN(v)&&v>=0){const d=v-p.stock;p.stock=v;save(K.products,ps);const m=load(K.inventoryMoves,[]);m.unshift({id:uid(),product:p.name,qty:d,type:'直接調整',reason:'人工調整',at:new Date().toISOString()});save(K.inventoryMoves,m);saveAudit('調整庫存',`${p.name}→${v}`);render('inventory')}}
 if(b.dataset.action==='new-quality'){dlg('新增時控商品',`<label>商品<select id="qp">${products().map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>日期<input id="qd" type="date"></label><label>折扣價<input id="qpr" type="number"></label><label>數量<input id="qq" type="number" value="1"></label><button class="primary" id="qs">建立</button>`);setTimeout(()=>qs.onclick=()=>{const p=products().find(x=>x.id===qp.value),rows=load(K.quality,[]);rows.unshift({id:uid(),productId:p.id,name:p.name,date:qd.value,price:Number(qpr.value),qty:Number(qq.value),status:'有效',createdBy:currentUser().name,createdAt:new Date().toISOString()});save(K.quality,rows);saveAudit('新增時控商品',p.name);genericDialog.close();render('quality')},0)}
 if(b.dataset.editQuality){const rows=load(K.quality,[]),x=rows.find(v=>v.id===b.dataset.editQuality);dlg('修改時控商品',`<label>日期<input id="eqd" type="date" value="${x.date}"></label><label>折扣價<input id="eqp" type="number" value="${x.price}"></label><label>數量<input id="eqq" type="number" value="${x.qty}"></label><label>狀態<select id="eqs"><option ${x.status==='有效'?'selected':''}>有效</option><option ${x.status==='停售'?'selected':''}>停售</option></select></label><button class="primary" id="eqsave">儲存</button>`);setTimeout(()=>eqsave.onclick=()=>{Object.assign(x,{date:eqd.value,price:Number(eqp.value),qty:Number(eqq.value),status:eqs.value});save(K.quality,rows);saveAudit('修改時控商品',x.name);genericDialog.close();render('quality')},0)}
 if(b.dataset.deleteQuality){const rows=load(K.quality,[]),x=rows.find(v=>v.id===b.dataset.deleteQuality);if(confirm(`刪除時控商品「${x.name}」？`)){save(K.quality,rows.filter(v=>v.id!==x.id));saveAudit('刪除時控商品',x.name);render('quality')}}
 if(b.dataset.printQuality){const x=load(K.quality,[]).find(v=>v.id===b.dataset.printQuality);printHTML('時控商品貼紙',`<h1>${esc(x.name)}</h1><p>折扣價：${money(x.price)}</p><p>日期：${esc(x.date)}</p><p>數量：${x.qty}</p>`)}
 if(b.dataset.action==='new-waste'){enterWasteMode();return}

 if(b.dataset.action==='new-employee'){dlg('新增員工',`<label>姓名<input id="en"></label><label>帳號<input id="ea"></label><label>初始密碼<input id="epw" type="password" value="1234"></label><label>手機<input id="ep"></label><label>Email<input id="ee"></label><label>角色<select id="er">${employeeRoleOptions()}</select></label><button class="primary" id="es">儲存</button>`);setTimeout(()=>es.onclick=()=>{const rows=load(K.employees,[]),u={id:uid(),name:en.value.trim(),account:ea.value.trim(),password:epw.value||'1234',phone:ep.value.trim(),email:ee.value.trim(),role:er.value,active:true};if(!u.name||!u.account)return alert('姓名與帳號必填');if(!validateEmployeeRoleChange('',u.role))return;rows.push(u);save(K.employees,rows);if(u.role==='總部支援'){const perms=load(K.permissions,{});perms[u.id]={};save(K.permissions,perms)}saveAudit('新增員工',`${u.name}｜${u.role}`);genericDialog.close();render('employees')},0)}
 if(b.dataset.editEmployee){const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.editEmployee);dlg('修改員工',`<label>姓名<input id="men" value="${esc(u.name)}"></label><label>帳號<input id="mea" value="${esc(u.account)}"></label><label>手機<input id="mep" value="${esc(u.phone||'')}"></label><label>Email<input id="mee" value="${esc(u.email||'')}"></label><label>角色<select id="mer">${employeeRoleOptions(u.role)}</select></label><button class="primary" id="mes">儲存</button>`);setTimeout(()=>mes.onclick=()=>{const oldRole=u.role,newRole=mer.value;if(!validateEmployeeRoleChange(oldRole,newRole))return;Object.assign(u,{name:men.value.trim(),account:mea.value.trim(),phone:mep.value.trim(),email:mee.value.trim(),role:newRole});save(K.employees,rows);if(newRole==='總部支援'&&oldRole!=='總部支援'){const perms=load(K.permissions,{});perms[u.id]={};save(K.permissions,perms)}saveAudit('修改員工',`${u.name}｜${oldRole}→${u.role}`);genericDialog.close();render('employees')},0)}

 if(b.dataset.employeeCredentials){
  if(!requirePermission('employeeCredentials'))return;
  const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.employeeCredentials);
  dlg('設定員工帳號與密碼',`<p>員工：${esc(u.name)}</p><label>登入帳號<input id="credAccount" value="${esc(u.account||'')}"></label><label>新密碼<input id="credPassword" type="password" placeholder="至少4碼"></label><label>確認密碼<input id="credConfirm" type="password"></label><button class="primary" id="credSave">儲存帳密</button>`);
  setTimeout(()=>credSave.onclick=()=>{
   const account=credAccount.value.trim(),pw=credPassword.value;
   if(!account||pw.length<4)return alert('帳號必填，密碼至少4碼');
   if(pw!==credConfirm.value)return alert('兩次密碼不一致');
   if(rows.some(x=>x.id!==u.id&&x.account===account))return alert('帳號已被使用');
   const oldAccount=u.account;u.account=account;u.password=pw;save(K.employees,rows);
   saveAudit('設定員工帳號密碼',`${u.name}｜${oldAccount||'未設定'}→${account}`);
   genericDialog.close();render('employees')
  },0)
 }

 if(b.dataset.toggleEmployee){const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.toggleEmployee);u.active=u.active===false;save(K.employees,rows);saveAudit(u.active?'啟用員工':'停用員工',u.name);render('employees')}
 if(b.dataset.action==='clock-in'){attendance('簽到');render(document.body.dataset.mode==='front'?'front':'attendance')}if(b.dataset.action==='clock-out'){attendance('簽退');render(document.body.dataset.mode==='front'?'front':'attendance')}
 if(b.dataset.action==='attendance-edit'){const rows=load(K.attendance,[]);dlg('工時修改',`<label>紀錄<select id="aeid">${rows.map(x=>`<option value="${x.id}">${esc(x.user)}｜${esc(x.kind)}｜${new Date(x.at).toLocaleString('zh-TW')}</option>`).join('')}</select></label><label>修改日期時間<input id="aetime" type="datetime-local"></label><label>修改原因<input id="aereason"></label><button class="primary" id="aesave">儲存</button>`);setTimeout(()=>aesave.onclick=()=>{const x=rows.find(v=>v.id===aeid.value);if(!x)return;const reason=aereason.value.trim();if(!reason||!aetime.value)return alert('時間與原因必填');const before=x.at;x.at=new Date(aetime.value).toISOString();x.modifyReason=reason;x.modifiedBy=currentUser().name;x.modifiedAt=new Date().toISOString();save(K.attendance,rows);saveAudit('工時修改',`${x.user}｜${new Date(before).toLocaleString('zh-TW')}→${new Date(x.at).toLocaleString('zh-TW')}｜${reason}`);genericDialog.close();render('attendance')},0)}
 if(b.dataset.attendanceEdit){const rows=load(K.attendance,[]),x=rows.find(v=>v.id===b.dataset.attendanceEdit);dlg('工時修改',`<p>${esc(x.user)}｜${esc(x.kind)}</p><label>修改日期時間<input id="aetime2" type="datetime-local" value="${nowInput(x.at)}"></label><label>修改原因<input id="aereason2"></label><button class="primary" id="aesave2">儲存</button>`);setTimeout(()=>aesave2.onclick=()=>{if(!aereason2.value.trim())return alert('請輸入原因');const before=x.at;x.at=new Date(aetime2.value).toISOString();x.modifyReason=aereason2.value.trim();x.modifiedBy=currentUser().name;x.modifiedAt=new Date().toISOString();save(K.attendance,rows);saveAudit('工時修改',`${x.user}｜${new Date(before).toLocaleString('zh-TW')}→${new Date(x.at).toLocaleString('zh-TW')}`);genericDialog.close();render('attendance')},0)}
 if(b.dataset.action==='attendance-print'){const rows=load(K.attendance,[]);printHTML('出勤報表',`<table style="width:100%;border-collapse:collapse"><tr><th>員工</th><th>類型</th><th>時間</th><th>修改原因</th></tr>${rows.map(x=>`<tr><td>${esc(x.user)}</td><td>${esc(x.kind)}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.modifyReason||'')}</td></tr>`).join('')}</table>`)}
 if(b.dataset.action==='member-cloud-refresh'){await refreshPosMembersCloud({redraw:false});alert('會員、累點／折抵規則、贈點活動已與後台同步');render('members');return}
 if(b.dataset.action==='new-member'){dlg('新增會員',`<label>姓名<input id="mn"></label><label>手機<input id="mp"></label><label>會員編號<input id="mc" value="M${Date.now().toString().slice(-8)}"></label><label>點數<input id="mpts" type="number" value="0"></label><button class="primary" id="ms">儲存</button>`);setTimeout(()=>ms.onclick=()=>{const rows=load(K.members,[]),m={id:uid(),name:mn.value.trim(),phone:mp.value.trim(),code:mc.value.trim(),memberNo:mc.value.trim(),points:Number(mpts.value),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.unshift(m);save(K.members,rows);saveAudit('新增會員',m.name);genericDialog.close();render('members')},0)}
 if(b.dataset.editMember){const rows=load(K.members,[]),m=rows.find(x=>x.id===b.dataset.editMember);dlg('修改會員',`<label>姓名<input id="emn" value="${esc(m.name)}"></label><label>手機<input id="emp" value="${esc(m.phone)}"></label><label>會員編號<input id="emc" value="${esc(m.code)}"></label><label>點數<input id="empts" type="number" value="${m.points||0}"></label><button class="primary" id="ems">儲存</button>`);setTimeout(()=>ems.onclick=()=>{Object.assign(m,{name:emn.value.trim(),phone:emp.value.trim(),code:emc.value.trim(),memberNo:emc.value.trim(),points:Number(empts.value),updatedAt:new Date().toISOString()});save(K.members,rows);saveAudit('修改會員',m.name);genericDialog.close();render('members')},0)}
 if(b.dataset.deleteMember){const rows=load(K.members,[]),m=rows.find(x=>x.id===b.dataset.deleteMember);if(confirm(`刪除會員「${m.name}」？`)){save(K.members,rows.filter(x=>x.id!==m.id));saveAudit('刪除會員',m.name);render('members')}}
 if(b.dataset.action==='product-lookup'){openProductLookup();return}
 if(b.dataset.action==='member-lookup'){openPosMemberLookup();return}
 if(b.dataset.action==='time-lookup'){const r=load(K.quality,[]);alert(r.length?r.map(x=>`${x.name}｜${x.date}｜${money(x.price)}｜${x.status}`).join('\n'):'沒有時控商品')}
 if(b.dataset.action==='print-transactions'){const r=load(K.sales,[]).filter(x=>!isEcServiceSale(x));printHTML('交易存根',r.map(x=>`<div>${x.id}｜${new Date(x.at).toLocaleString('zh-TW')}｜${money(x.total)}｜${x.payment}</div><hr>`).join('')||'無交易')}
 if(b.dataset.txView){if(b.dataset.txFront!=='1'&&!hasPermission('transactionBackAccess'))return alert('需要「後台交易查詢」權限');openTransactionDetail(b.dataset.txView);return}
 if(b.dataset.txPrint){
  const sale=load(K.sales,[]).find(x=>x.id===b.dataset.txPrint);
  if(!sale){alert('找不到交易');return}
  if(isEcServiceSale(sale)){alert('EC 包裹取貨不可補印交易存根');return}
  try{await printSaleDetail(sale)}catch(err){console.error(err);alert('交易存根列印失敗：'+err.message)}
  return
}
 if(b.dataset.txCorrect){const s=load(K.sales,[]).find(x=>x.id===b.dataset.txCorrect);if(isEcServiceSale(s))return alert('EC 包裹取貨不可更正或退貨');if(s)openSaleInCorrectionMode(s);return}
 if(b.dataset.txExchange){
  const s=load(K.sales,[]).find(x=>x.id===b.dataset.txExchange);
  if(!s)return alert('找不到交易');
  try{beginExchangeMode(s);render('pos')}catch(err){alert(err.message)}
  return
 }
 if(b.dataset.txReturn){confirmWholeTransaction(b.dataset.txReturn,'return',b.dataset.txFront==='1');return}
 if(b.dataset.txVoid){confirmWholeTransaction(b.dataset.txVoid,'void',b.dataset.txFront==='1');return}
 if(b.dataset.action==='reload-latest'){
  if(!requirePermission('systemVersion'))return;
  try{
   if('serviceWorker' in navigator){
    const regs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
   }
   if(window.caches){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('yijia-pos-alpha-')).map(k=>caches.delete(k)))}
  }catch(_e){}
  const u=new URL(location.href);u.searchParams.set('_tmv',Date.now().toString());location.replace(u.toString());return
 }
 if(b.dataset.action==='deposit'){
  const v=Number(prompt('投庫金額'));
  if(v>0){
   const r=load(K.deposits,[]),now=new Date(),deposit={id:uid(),depositNo:`D${now.toISOString().replace(/\D/g,'').slice(2,14)}`,amount:v,user:currentUser().name,at:now.toISOString()};
   r.unshift(deposit);save(K.deposits,r);saveAudit('投庫',money(v));
   try{await printDepositSlip(deposit);alert(`投庫完成\n金額：${money(v)}\n已開啟投庫單列印頁`)}catch(err){alert(`投庫已完成，但投庫單列印頁未開啟。\n${String(err?.message||err)}`)}
  }
  return;
 }
 if(b.dataset.action==='lock-pos'){
  const opener=ensurePosShiftOpener(posShiftOpenerName()||currentUser()?.name||'',posShiftOpenerRole()||currentUser()?.role||'');
  const lockedBy=currentUser()?.name||'';
  saveAudit('POS鎖機',`${lockedBy}｜開機人員 ${opener||'—'}｜未交班`);
  logout();
  document.body.dataset.mode='front';
  app.innerHTML=`<section class="pos-locked-placeholder"><div>🔒</div><b>TM 已鎖機</b><small>目前班別尚未交班</small></section>`;
  showLogin('front',{locked:true});
  return;
 }
 if(b.dataset.action==='handover'){
  const from=posShiftOpenerName()||currentUser()?.name||'';const sum=handoverPrintSummary();
  const selfHandover=isSelfCheckout();
  const handoverMessage=selfHandover?`確認自助結帳交班？\n\n自助模式不收現金，不需投庫。\n交易筆數：${sum.sales.length}\n銷售金額：${money(sum.salesAmount)}\n\n確認後會開啟交班單列印頁並登出。`:`確認交班？\n\n折扣：${money(sum.discountAmount)}\n投庫：${sum.deposits.length} 次／${money(sum.depositAmount)}\n短溢收：${formatCashDifference(sum.cashDifference)}\n交易作廢：${Number(sum.voidCount||0)} 張\n投庫小計：${money(sum.depositAmount)}\n\n確認後會開啟交班單列印頁並登出。`;
  if(!confirm(handoverMessage))return;
  try{await printHandoverSlip(sum)}catch(err){return alert('交班單列印頁開啟失敗，尚未登出：'+String(err?.message||err))}
  const r=load(K.handovers,[]);r.unshift({id:uid(),storeCode:currentStoreCode(),from,fromAccount:String(currentUser()?.account||''),to:'',at:new Date().toISOString(),start:sum.start,end:sum.end,depositCount:sum.deposits.length,depositAmount:sum.depositAmount,cashRevenue:sum.cashRevenue,discountAmount:sum.discountAmount,cashDifference:sum.cashDifference,transactionCount:sum.sales.length,voidCount:Number(sum.voidCount||0),salesAmount:sum.salesAmount,totalAmount:sum.depositAmount});save(K.handovers,r);
  saveAudit('交班',`${from}｜投庫${sum.deposits.length}次${money(sum.depositAmount)}｜作廢${Number(sum.voidCount||0)}張｜折扣${money(sum.discountAmount)}｜短溢收${formatCashDifference(sum.cashDifference)}｜投庫小計${money(sum.depositAmount)}`);
  localStorage.removeItem('yj_pos_login_at_'+from);
  if(selfHandover){
   localStorage.removeItem(SELF_HANDOVER_START_KEY);
   // 交班登出前保留可回復的正常 TM 人員；切回 TM 時直接自動登入。
   const previous=tmSelfManagerEmployee;
   if(previous&&String(previous.account||'')!==SELF_ACCOUNT){
    try{localStorage.setItem(SELF_PREVIOUS_SESSION_KEY,JSON.stringify({...previous,password:undefined}))}catch(_){}
   }
   markSelfReopenPending(true);
  }
  clearPosShiftOpener();setLoginLockAppearance(false);
  // Alpha 7.48：交班後先建立明確的完成畫面，再登出並顯示下一班登入。
  // 即使 iOS/Safari 因列印分頁切換焦點而沒有立即顯示 loginDialog，也不會只剩白畫面。
  const completedAt=new Date();
  logout();
  document.body.dataset.mode='front';
  app.innerHTML=`<section class="handover-complete-screen">
   <div class="handover-complete-card">
    <div class="handover-complete-icon">✅</div>
    <h1>交班完成</h1>
    <p>交班人：<b>${esc(from||'—')}</b></p>
    <p>交班時間：<b>${completedAt.toLocaleString('zh-TW')}</b></p>
    <p>交班單已開啟列印頁。</p>
    <button class="primary" id="handoverNextLogin">下一班登入</button>
   </div>
  </section>`;
  const nextLogin=()=>showLogin('front');
  document.querySelector('#handoverNextLogin')?.addEventListener('click',nextLogin);
  // 等列印新分頁完成焦點切換後再叫出登入；若未顯示，使用者仍看得到「交班完成」與登入按鈕。
  setTimeout(nextLogin,180);
  return;
 }
 if(b.dataset.action==='logistics'){
  // Alpha 7.71：下拉選單改以 Supabase 雲端待簽到物流批次為主，本機訂購資料只作備援。
  dlg('物流到店簽到',`<label>直接選取貨單<select id="ltOrderSelect"><option value="">— 雲端貨單讀取中… —</option></select></label><label>物流／進貨條碼<input id="ltBatch" placeholder="掃描 YJB... 或 YJIN..." autocomplete="off"></label>
  <div class="toolbar"><button class="button" id="ltScan">📷 掃描條碼</button><button class="primary" id="ltFind">查詢物流</button></div>
  <div id="ltResult" class="notice" style="display:none;margin-top:10px"></div>`);
  setTimeout(()=>{
   const batchEl=document.querySelector('#ltBatch'),resultEl=document.querySelector('#ltResult'),orderSelect=document.querySelector('#ltOrderSelect');
   const loadReceivingOptions=async()=>{
    let opts=[];
    try{if(cloudConfigured())await cloudPullKey(K.orders)}catch(e){console.warn('TM 訂購貨單同步失敗',e)}
    try{
     const cloudRows=await posListPendingLogisticsBatches(300);
     const legacyHidden=tmLegacySplitBatchSet();
     opts=cloudRows
      .filter(x=>!legacyHidden.has(String(x.batch_no||'').trim()))
      .map(x=>({value:String(x.batch_no||'').trim(),label:tmPendingBatchLabel(x)}))
      .filter(x=>x.value);
    }catch(e){console.warn('TM 待簽到物流批次讀取失敗',e)}
    if(!opts.length){
     const arrivedCodes=new Set(load(K.logistics,[]).filter(x=>x&&x.status==='已到店').flatMap(x=>[String(x.batchNo||'').trim(),String(x.receiptNo||'').trim(),String(x.externalRef||'').trim()]).filter(Boolean));
     const legacyHidden=tmLegacySplitBatchSet();
     opts=(load(K.orders,[])||[]).flatMap(o=>tmOrderBatchValues(o).filter(v=>v&&!arrivedCodes.has(v)&&!legacyHidden.has(v)).map(v=>{
      const meta=tmBatchMeta(o,v);
      const type=deliveryTypeZh(meta?.cloudDeliveryType||meta?.deliveryType||o.deliveryType||'');
      const merged=!!meta?.mergedShipment;
      return {value:v,label:`${v}｜${type||o.type||'訂購'}｜${merged?'合併貨單':'本機備援'}`};
     }));
    }
    const unique=opts.filter((x,i,a)=>a.findIndex(y=>y.value===x.value)===i);
    orderSelect.innerHTML='<option value="">— 請選擇尚未到店貨單 —</option>'+unique.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
   };
   loadReceivingOptions();
   if(orderSelect)orderSelect.onchange=()=>{if(orderSelect.value){batchEl.value=orderSelect.value;findBatch()}};
   const findBatch=async()=>{
    const code=batchEl.value.trim();if(!code)return alert('請掃描或輸入物流／進貨條碼');
    if(!cloudConfigured())return alert('TM 尚未設定 Supabase，請先到「雲端與更新」完成設定');
    resultEl.style.display='block';resultEl.textContent='查詢物流批次中…';
    try{
     let resolved=await posResolveReceivingCode(code);
     if(!resolved){resultEl.innerHTML='<b>找不到待簽到物流／進貨單</b><br>請確認條碼與店號是否正確。';return}
     const order=tmOrderForBatch(resolved.batch_no);
     const meta=tmBatchMeta(order,resolved.batch_no);
     const typeZh=deliveryTypeZh(resolved.delivery_type||meta?.cloudDeliveryType||meta?.deliveryType||order?.deliveryType||'');
     let row=await posFindLogisticsBatch(resolved.batch_no,typeZh);
     if(!row){resultEl.innerHTML=`<b>${esc(resolved.batch_no)}</b><br>此批次可能已簽到或目前不可簽到。`;return}
     const merged=!!meta?.mergedShipment;
     const mergedSources=Array.isArray(meta?.mergedSourceOrders)?meta.mergedSourceOrders.filter(Boolean):[];
     resultEl.innerHTML=`<b>${esc(row.batch_no)}｜${esc(typeZh||'—')}</b><br>${resolved.receipt_no?`進貨單：${esc(resolved.receipt_no)}<br>`:''}${merged?`貨單：同物流合併貨單${mergedSources.length?`（${mergedSources.length}張訂購）`:''}<br>`:''}來源：${esc(row.source||'—')}｜來源單號：${esc(row.external_ref||'—')}<br>狀態：${esc(logisticsStatusZh(row.status||'pending'))}<br><button class="primary" id="ltConfirm" style="margin-top:10px;width:100%">確認到店簽到</button>`;
     document.querySelector('#ltConfirm').onclick=async()=>{
      const btn=document.querySelector('#ltConfirm');btn.disabled=true;btn.textContent='簽到中…';
      try{
       const received=await posReceiveLogisticsBatch(row.batch_no,typeZh,currentUser()?.name||'');
       if(!received)throw new Error('資料庫沒有回傳簽到結果');
       recordCloudLogisticsArrival(received);
       // Alpha 7.48：同步更新本地貨單狀態，已到店後立刻從待簽到下拉選單消失。
       try{
        const orderRows=load(K.orders,[]);
        let changed=false;
        orderRows.forEach(o=>{
         const batches=tmOrderBatchValues(o);
         const receipts=[
          ...String(o.receiptNo||'').split('、').map(x=>x.trim()).filter(Boolean),
          ...(Array.isArray(o.receipts)?o.receipts.map(x=>String(x?.receiptNo||x?.receipt_no||'').trim()).filter(Boolean):[])
         ];
         if(batches.includes(String(row.batch_no||'').trim())||receipts.includes(String(resolved.receipt_no||'').trim())){
          o.status='已到貨';
          o.arrivedAt=new Date().toISOString();
          o.arrivedBy=currentUser()?.name||'';
          changed=true;
         }
        });
        if(changed){
         save(K.orders,orderRows);
         try{if(cloudConfigured())await cloudPushKey(K.orders,orderRows)}catch(e){console.warn('TM 物流簽到後訂購狀態回寫雲端失敗',e)}
        }
       }catch(_){}
       let message='物流到店簽到完成';
       if(typeZh==='EC'){
        const ecResult=await posReceiveEcArrivalBatch(row.batch_no,currentUser()?.name||'');
        message+=`\nEC 到店 ${Number(ecResult?.package_count||0)} 件，已轉待取貨。`;
       }else{
        message+='\n此動作只完成物流簽到。';
       }
       publishCustomerDisplayNotice({type:'logistics',title:'物流簽到',identity:'物流',name:String(row.source||typeZh||'物流'),employeeNo:String(resolved.receipt_no||row.batch_no||''),action:'簽到',status:'完成',detail:`${typeZh}${resolved.receipt_no?`｜${resolved.receipt_no}`:''}`}).catch(()=>{});
       genericDialog.close();alert(message);render(document.body.dataset.mode==='front'?'pos':'logistics');
      }catch(err){btn.disabled=false;btn.textContent='確認到店簽到';alert('物流簽到失敗：'+err.message)}
     };
    }catch(err){resultEl.innerHTML=`<b>查詢失敗</b><br>${esc(err.message)}`}
   };
   document.querySelector('#ltFind').onclick=findBatch;
   document.querySelector('#ltScan').onclick=()=>scanCode({title:'掃描物流／進貨條碼',onResult:code=>{batchEl.value=code;findBatch()}});
   batchEl.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findBatch()}};
  },0)
 }
 if(b.dataset.action==='receive'){if(!scServiceConnected()){showScDisconnectedNotice('transferIn');return}try{receiveTransfer(document.querySelector('#transferNo').value);alert('轉入完成');render('pos')}catch(err){alert(err.message)}}
 if(b.dataset.action==='attendance-clock'){
  requestTmEmployeeAttendance();
 }
 if(b.dataset.action==='toggle-value-menu'){
  const valueMenu=document.querySelector('#posValueFlyout');
  const manageMenu=document.querySelector('#posManageFlyout');
  const wasteMenu=document.querySelector('#posWasteTimeSubmenu');
  if(manageMenu)manageMenu.hidden=true;
  if(wasteMenu)wasteMenu.hidden=true;
  if(valueMenu)valueMenu.hidden=!valueMenu.hidden;
  return;
 }
 if(b.dataset.action==='toggle-manage-menu'){
  const valueMenu=document.querySelector('#posValueFlyout');
  const manageMenu=document.querySelector('#posManageFlyout');
  const wasteMenu=document.querySelector('#posWasteTimeSubmenu');
  if(valueMenu)valueMenu.hidden=true;
  if(wasteMenu)wasteMenu.hidden=true;
  if(manageMenu)manageMenu.hidden=!manageMenu.hidden;
  return;
 }
 if(b.dataset.action==='waste-time-menu'){
  const wasteMenu=document.querySelector('#posWasteTimeSubmenu');
  if(wasteMenu)wasteMenu.hidden=!wasteMenu.hidden;
  return;
 }
 if(b.dataset.action==='stored-value-topup'){
  alert('電子票證加值目前為預留功能；等票卡機正式新增後再接入硬體功能。');
  return;
 }
 if(b.dataset.action==='stored-value-balance'){
  alert('票證餘額查詢目前為預留功能；等票卡機正式新增後再接入硬體功能。');
  return;
 }
 if(b.dataset.action==='manual-close'){if(!confirm('確定執行手動日結？日結後 TM 將鎖定並顯示約 5 分鐘重新啟動畫面。'))return;const r=collect();const cleared=clearHeldTransactionsAfterClose('手動日結');const ss=schedulerState(),today=localDateKey();ss.lastAutoClose=today;ss.lastAutoCloseAt=new Date().toISOString();ss.nextAutoCloseAt='';ss.manualCloseRequiredDate='';saveSchedulerState(ss);saveAudit('手動日結',`${r.date}｜${money(r.total)}｜清除暫存${cleared}筆｜5分鐘重新啟動`);tmRestartScreen(300,'手動日結');return}
 if(b.dataset.action==='logistics-query'){alert('畫面已顯示今日預定與實際到店時間；前台物流簽到後會立即同步更新。')}
 if(b.dataset.action==='logistics-schedule-edit'){const rows=load(K.logisticsSchedules,[]);dlg('到店時間設定',`<label>配別<select id="lseType">${rows.map(x=>`<option value="${x.id}">${esc(x.storeName)}｜${esc(x.type)}</option>`).join('')}</select></label><label>表定到店時間<input id="lseTime"></label><label>備註<input id="lseNote"></label><button class="primary" id="lseSave">儲存</button>`);setTimeout(()=>lseSave.onclick=()=>{const x=rows.find(v=>v.id===lseType.value);x.scheduled=lseTime.value.trim()||x.scheduled;x.note=lseNote.value.trim();save(K.logisticsSchedules,rows);saveAudit('修改物流表定時間',`${x.storeName}｜${x.type}｜${x.scheduled}`);genericDialog.close();render('logistics')},0)}
 if(b.dataset.action==='new-ec'){
  const storeRows=load(K.stores,[]);
  dlg('新增EC包裹',`<label>溫層<select id="ecType">${ecTypes.map(x=>`<option>${x}</option>`).join('')}</select></label><label>姓名<input id="ecName"></label><label>手機末三碼<input id="ecLast3" maxlength="3"></label><label>包裹編號<input id="ecNo"></label><label>取貨店<input id="ecPickupStore" list="ecPickupStores" placeholder="輸入店名或店號"><datalist id="ecPickupStores">${storeRows.map(x=>`<option value="${esc(x.name)}（${esc(x.code)}）"></option>`).join('')}</datalist></label><label>包裹價值金額<input id="ecValue" type="number" value="0"></label><label>異常備註<input id="ecAbnormal"></label><button class="primary" id="ecSave">儲存</button>`);
  setTimeout(()=>document.querySelector('#ecSave').onclick=()=>{
   const name=document.querySelector('#ecName').value.trim(),last3=document.querySelector('#ecLast3').value,pickupStore=document.querySelector('#ecPickupStore').value.trim();
   if(!name||!/^[0-9]{3}$/.test(last3))return alert('姓名與手機末三碼必填');
   if(!pickupStore)return alert('取貨店必填');
   addEC({type:document.querySelector('#ecType').value,name,last3,packageNo:document.querySelector('#ecNo').value.trim(),pickupStore,value:document.querySelector('#ecValue').value,abnormal:document.querySelector('#ecAbnormal').value.trim(),status:document.querySelector('#ecAbnormal').value.trim()?'異常':'已寄件'});
   genericDialog.close();render('ec');
  },0)
 }
 if(b.dataset.ecPrint){const x=load(K.ec,[]).find(v=>v.id===b.dataset.ecPrint);printHTML('EC標籤',`<div style="text-align:center;border:2px solid;padding:30px"><h2>${esc(x.type)}</h2><h1>${esc(x.name)}</h1><h1>末三碼 ${esc(x.last3)}</h1><p>${esc(x.packageNo||'')}</p><p>取貨店：${esc(x.pickupStore||'—')}</p></div>`)}
 if(b.dataset.action==='ec-print-all'){const rows=load(K.ec,[]).filter(x=>x.status!=='已取消寄件');printHTML('EC標籤',rows.map(x=>`<div style="text-align:center;border:2px solid;padding:25px;margin-bottom:15px;page-break-inside:avoid"><h2>${esc(x.type)}</h2><h1>${esc(x.name)}｜末三碼 ${esc(x.last3)}</h1><p>${esc(x.packageNo||'')}</p><p>取貨店：${esc(x.pickupStore||'—')}</p></div>`).join('')||'無可列印包裹')}
 if(b.dataset.action==='ec-abnormal'){const rows=load(K.ec,[]).filter(x=>x.abnormal||x.status==='異常');alert(rows.length?rows.map(x=>`${x.name}｜${x.last3}｜${x.abnormal||x.status}`).join('\n'):'目前沒有異常包裹')}
 if(b.dataset.ecCancel){if(!requirePermission('ecCancel'))return;const reason=prompt('請輸入取消寄件原因');if(!reason)return;try{cancelEC(b.dataset.ecCancel,reason);render('ec')}catch(err){alert(err.message)}}
 if(b.dataset.action==='transfer-out'){if(!requirePermission('transferOut'))return;dlg('建立轉出單',`<label>轉入店號<input id="toStore"></label><label>商品條碼<div class="inline-field"><input id="trBarcode" placeholder="掃描商品條碼"><button type="button" class="button" id="scanTransferProduct">📷 掃描</button></div></label><label>商品<select id="trProduct">${products().map(x=>`<option value="${x.id}">${esc(x.name)}｜庫存${x.stock}</option>`).join('')}</select></label><label>鮮食日期<input id="trDate" type="date"></label><label>數量<input id="trQty" type="number" value="1"></label><button class="primary" id="trSave">確認轉出</button>`);setTimeout(()=>{scanTransferProduct.onclick=()=>scanCode({title:'掃描轉貨商品',onResult:code=>{trBarcode.value=code;const p=products().find(x=>x.barcode===code);if(p)trProduct.value=p.id;else alert('找不到商品')}});trSave.onclick=()=>{try{const p=products().find(x=>x.id===trProduct.value);createTransfer(toStore.value.trim(),p,Number(trQty.value),trDate.value);genericDialog.close();render('transfers')}catch(err){alert(err.message)}}},0)}
 if(b.dataset.action==='transfer-in-back'){if(!requirePermission('transferIn'))return;scanCode({title:'掃描轉貨單',onResult:no=>{if(!no)return;try{receiveTransfer(no.trim());alert('轉入完成');render('transfers')}catch(err){alert(err.message)}}});return}
 if(b.dataset.transferReceive){if(!requirePermission('transferIn'))return;try{receiveTransfer(b.dataset.transferReceive);render('transfers')}catch(err){alert(err.message)}}
 if(b.dataset.action==='store-add'){if(!requirePermission('storeAdd'))return;dlg('新增門市',`<label>門市名稱<input id="storeName"></label><label>店號<input id="storeCode"></label><button class="primary" id="storeSave">新增</button>`);setTimeout(()=>storeSave.onclick=()=>{const rows=load(K.stores,[]),code=storeCode.value.trim();if(!storeName.value.trim()||!code)return alert('門市名稱與店號必填');if(rows.some(x=>x.code===code))return alert('店號已存在');rows.push({id:uid(),name:storeName.value.trim(),code,active:true});save(K.stores,rows);saveAudit('新增門市',`${storeName.value.trim()}｜${code}`);genericDialog.close();render('stores')},0)}
 if(b.dataset.action==='store-code'){if(!requirePermission('storeCode'))return;const rows=load(K.stores,[]);dlg('轉換店號',`<label>門市<select id="scStore">${rows.map(x=>`<option value="${x.id}">${esc(x.name)}｜${esc(x.code)}</option>`).join('')}</select></label><label>新店號<input id="scCode"></label><label>原因<input id="scReason"></label><button class="primary" id="scSave">確認轉換</button>`);setTimeout(()=>scSave.onclick=()=>{const x=rows.find(v=>v.id===scStore.value),old=x.code,n=scCode.value.trim();if(!n||!scReason.value.trim())return alert('新店號與原因必填');if(rows.some(v=>v.id!==x.id&&v.code===n))return alert('店號已存在');x.code=n;save(K.stores,rows);saveAudit('轉換店號',`${x.name}｜${old}→${n}｜${scReason.value.trim()}`);genericDialog.close();render('stores')},0)}
 if(b.dataset.action==='store-query'){const q=prompt('輸入門市名稱或店號','');if(q===null)return;const rows=load(K.stores,[]).filter(x=>x.name.includes(q)||x.code.includes(q));alert(rows.length?rows.map(x=>`${x.name}（${x.code}）｜${x.active!==false?'啟用':'停用'}`).join('\n'):'找不到門市')}
 if(b.dataset.update)runUpdate(b.dataset.update)
 if(b.dataset.action==='audit-print'){const r=load(K.audit,[]);printHTML('Audit Log',r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user)}｜${esc(x.action)}｜${esc(x.detail)}</div><hr>`).join(''))}
 if(b.dataset.action==='collect'){collect();render('revenue')}if(b.dataset.action==='x'){const r=collect();alert(`X帳\n總營收 ${money(r.total)}\n現金收入 ${money(r.cashRevenue||0)}\n非現金收入 ${money(r.nonCashRevenue||0)}\n應送金 ${money(r.sendAmount||0)}\n交易 ${r.count}`)}if(b.dataset.correct){dlg('營收修正',`<label>實際現金<input id="rc" type="number"></label><label>差額原因<input id="rr"></label><label>送金方式<select id="rm"><option>現金送金</option><option>銀行存款</option><option>總部收款</option><option>暫不送金</option></select></label><button class="primary" id="rs">儲存</button>`);setTimeout(()=>rs.onclick=()=>{correct(b.dataset.correct,rc.value,rr.value,rm.value);genericDialog.close();render('revenue')},0)}if(b.dataset.z){try{z(b.dataset.z);render('revenue')}catch(err){alert(err.message)}}if(b.dataset.print){const r=load(K.revenue,[]).find(x=>x.id===b.dataset.print);if(!r?.zNo)return alert('請先產生Z帳');printHTML('Z帳表＋送金單',`<div style="float:right;border:1px solid;padding:20px;width:160px;height:90px;text-align:center">店長簽名</div><h3>Z帳號：${r.zNo}</h3><p>總營收：${money(r.total)}</p><p>現金收入：${money(r.cashRevenue||0)}</p><p>非現金收入：${money(r.nonCashRevenue||0)}</p><p>投庫／留存：${money(r.deposits||0)}</p><hr><h2>送金單</h2><p>方式：${r.method}</p><p>應送金金額：${money(r.actualCash??r.sendAmount??0)}</p>`)}
});

function localDateKey(d=new Date()){
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function previousDateKey(){
 const d=new Date();d.setDate(d.getDate()-1);return localDateKey(d)
}
async function publishCustomerDisplayRestart(reason='日結',seconds=300){
 const payload={mode:'restarting',terminalMode:tmOperationMode(),reason:String(reason||'日結'),restartToken:`CDR-${Date.now()}`,restartSeconds:Number(seconds||300),storeCode:currentStoreCode(),storeName:store()?.name||'億家門市',transactionId:'',items:[],promotions:[],subtotal:0,discount:0,total:0,tendered:0,updatedAt:new Date().toISOString()};
 customerDisplayLastPayload='';
 try{localStorage.setItem(K.customerDisplayState,JSON.stringify(payload));if(cloudConfigured())await cloudPushKey(K.customerDisplayState,payload)}catch(_e){}
}
async function publishCustomerDisplayReady(){
 const payload={mode:'sale',terminalMode:tmOperationMode(),paymentConnecting:false,storeCode:currentStoreCode(),storeName:store()?.name||'億家門市',transactionId:'',items:[],promotions:[],subtotal:0,discount:0,total:0,tendered:0,memberName:'',memberNo:'',taxId:'',voiceCue:null,updatedAt:new Date().toISOString()};
 customerDisplayLastPayload='';
 try{localStorage.setItem(K.customerDisplayState,JSON.stringify(payload));if(cloudConfigured())await cloudPushKey(K.customerDisplayState,payload)}catch(_e){}
}
function tmRestartScreen(seconds=300,reason='日結'){
 const end=Date.now()+seconds*1000;window.__yjTmRestarting=true;publishTmScLink('restart-start');publishCustomerDisplayRestart(reason,seconds);let overlay=document.querySelector('#tmRestartOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='tmRestartOverlay';overlay.className='system-restart-overlay';document.body.appendChild(overlay)}
 const tick=()=>{const left=Math.max(0,Math.ceil((end-Date.now())/1000));overlay.innerHTML=`<div class="system-restart-card"><div class="system-restart-spinner"></div><h1>TM 正在重新啟動</h1><p>${esc(reason)}處理中，請勿關閉或操作系統</p><strong>約 ${Math.ceil(left/60)} 分鐘</strong></div>`;if(left<=0){clearInterval(timer);window.__yjTmRestarting=false;publishTmScLink('restart-complete');try{state.cart=[];state.discount=0;state.lastCompletedSale=null;state.customerVoiceCue=null;logout()}catch(_e){}publishCustomerDisplayReady();overlay.remove();showLogin('front')}};tick();const timer=setInterval(tick,1000);
}
function schedulerState(){return load(K.scheduler,{lastDayChange:'',lastAutoClose:'',lastDayChangeAt:'',lastAutoCloseAt:'',nextAutoCloseAt:'',manualCloseRequiredDate:''})}
function saveSchedulerState(s){save(K.scheduler,s)}
function performDayChange(){
 const s=schedulerState(),today=localDateKey();
 if(s.lastDayChange===today)return false;
 s.lastDayChange=today;s.lastDayChangeAt=new Date().toISOString();saveSchedulerState(s);
 saveAudit('自動日替',`${today}｜系統重新載入營業日`);
 try{localStorage.setItem('yj_current_business_date',today)}catch{}
 if(document.body.dataset.mode==='back')setTimeout(()=>render('home'),50);
 return true
}
function activeSaleInProgress(){return !!(state.paymentConnecting||(Array.isArray(state.cart)&&state.cart.length>0))}
function autoCloseDeadline(now=new Date()){const d=new Date(now);d.setHours(5,30,0,0);return d}
function autoCloseStart(now=new Date()){const d=new Date(now);d.setHours(5,0,0,0);return d}
function markManualCloseRequired(now=new Date()){
 const s=schedulerState(),today=localDateKey(now);if(s.lastAutoClose===today)return false;
 if(s.manualCloseRequiredDate!==today){s.manualCloseRequiredDate=today;s.nextAutoCloseAt='';saveSchedulerState(s);saveAudit('TM 日結逾時',`${today}｜超過 05:30，改為手動日結`);if(document.body.dataset.mode==='front'&&!window.__yjManualCloseAlerted){window.__yjManualCloseAlerted=today;setTimeout(()=>alert('已超過 05:30，今日需執行手動日結。'),0)}}
 return true
}
function performAutoClose(now=new Date()){
 const s=schedulerState(),today=localDateKey(now);if(s.lastAutoClose===today||window.__yjTmRestarting)return false;
 const deadline=autoCloseDeadline(now);if(now>=deadline)return markManualCloseRequired(now);
 if(activeSaleInProgress()){
  const next=new Date(Math.min(now.getTime()+5*60*1000,deadline.getTime()));s.nextAutoCloseAt=next.toISOString();saveSchedulerState(s);saveAudit('TM 日結延後',`${today}｜交易進行中，自動延後至 ${String(next.getHours()).padStart(2,'0')}:${String(next.getMinutes()).padStart(2,'0')}`);return false
 }
 const target=previousDateKey();autoCloseBusinessDay(target);const cleared=clearHeldTransactionsAfterClose('每日自動日結');s.lastAutoClose=today;s.lastAutoCloseAt=new Date().toISOString();s.nextAutoCloseAt='';s.manualCloseRequiredDate='';saveSchedulerState(s);saveAudit('TM 自動日結',`營業日 ${target}｜清除暫存${cleared}筆｜5 分鐘重新啟動`);if(document.body.dataset.mode==='front')tmRestartScreen(300,'每日自動日結');return true
}
function checkSchedules(){
 const now=new Date(),h=now.getHours(),m=now.getMinutes(),today=localDateKey(now);const s=schedulerState();
 const abnormal=h===23&&m===59;if(window.__yjPosDayReplacementNetwork!==abnormal){window.__yjPosDayReplacementNetwork=abnormal;updatePosQuickButtonStates()};
 if(s.lastDayChange!==today)performDayChange();
 if(s.lastAutoClose===today)return;
 const start=autoCloseStart(now),deadline=autoCloseDeadline(now);if(now>=deadline){markManualCloseRequired(now);return}
 if(now<start)return;
 const due=s.nextAutoCloseAt?new Date(s.nextAutoCloseAt):start;if(now>=due)performAutoClose(now)
}
clearInterval(window.__yjScheduleTimer);window.__yjScheduleTimer=setInterval(()=>{if(!document.hidden)checkSchedules()},15000);

const legacyLoginPerson=document.querySelector('#loginPerson');
if(legacyLoginPerson)legacyLoginPerson.onchange=syncLoginAccount;

document.querySelector('#toggleLoginPassword').onclick=()=>{
 const input=document.querySelector('#loginPassword');
 input.type=input.type==='password'?'text':'password';
};

loginDialog.addEventListener('cancel',e=>e.preventDefault());

document.querySelector('#loginForm').onsubmit=e=>{
 e.preventDefault();

 const personId=document.querySelector('#loginPerson')?.value||'';
 const account=document.querySelector('#loginAccount')?.value.trim()||'';
 const password=document.querySelector('#loginPassword')?.value||'';
 const people=availableLoginPeople();
 const selectedByList=personId?people.find(x=>x.id===personId):null;
 const selectedByAccount=account?people.find(x=>String(x.account||'')===account):null;
 const selected=selectedByList||selectedByAccount;

 if(!account)return alert('請選擇帳號或手動輸入登入帳號');
 if(!password)return alert('請輸入密碼');
 if(selectedByList&&account!==String(selectedByList.account||''))return alert('手動輸入的帳號與下拉選取人員不相符；請改成正確帳號，或把下拉選單切回空白後直接輸入帳號');
 if(!selected)return alert(`此門市（${store().name}）沒有建立此員工資料，或帳號目前已停用，無法登入`);

 if(account===SELF_ACCOUNT&&selfReopenPending())return alert('交班後不可使用 99999 直接開班，請使用實際人員自己的帳號登入');
 if(login(account,password)){
  const reopenSelf=isSelfCheckout()&&selfReopenPending();
  if(reopenSelf){
   tmSelfManagerEmployee=selected||null;
   if(selected){
    const restoreSession={...selected,password:undefined};
    try{localStorage.setItem(SELF_PREVIOUS_SESSION_KEY,JSON.stringify(restoreSession))}catch(_){}
   }
   markSelfReopenPending(false);
   localStorage.setItem(TM_OPERATION_MODE_KEY,'self');
   selfCheckoutScreen='home';
   setTmTrainingMode(false);
   saveAudit('自助結帳下一班開班授權',`${selected?.name||account}｜${account}｜正式結帳人員99999`)
  }
  else if(account!==SELF_ACCOUNT&&!posLockMode){localStorage.setItem(TM_OPERATION_MODE_KEY,'tm');setTmTrainingMode(false)}
  applyTmOperationMode();
  loginDialog.close();
  if(pendingLoginMode==='front'){
   const wasLocked=posLockMode;
   // 鎖機解鎖可以使用任何有效帳號；未交班前永遠保留原開機人員。
   const opener=ensurePosShiftOpener(selected.name,selected.role);
   if(!localStorage.getItem('yj_pos_login_at_'+opener))localStorage.setItem('yj_pos_login_at_'+opener,new Date().toISOString());
   saveAudit(wasLocked?'POS解鎖':'登入前台',`${selected.name}${wasLocked?`｜本班開機人員 ${opener}`:''}`);
   setLoginLockAppearance(false);
  }else{
   saveAudit('登入後台',selected.name);
  }
  // 登入成功後立即清空登入表單，避免畫面或瀏覽器保留上一位帳密。
  const lp=document.querySelector('#loginPerson'),la=document.querySelector('#loginAccount'),pw=document.querySelector('#loginPassword');
  if(lp)lp.value='';if(la)la.value='';if(pw)pw.value='';
  mode(pendingLoginMode);
  setTimeout(checkSchedules,100);
 }else{
  const pw=document.querySelector('#loginPassword');if(pw)pw.value='';
  alert('帳號或密碼錯誤');
 }
};
document.addEventListener('keydown',e=>{if(e.key!=='Enter'||document.body.dataset.mode!=='front'||!document.querySelector('#cartList'))return;const tag=(e.target?.tagName||'').toLowerCase();if(['input','textarea','select','button'].includes(tag))return;e.preventDefault();openCheckoutDialog();});
clearInterval(window.__yjUiClockTimer);window.__yjUiClockTimer=setInterval(()=>{if(!document.hidden)document.querySelectorAll('[data-clock]').forEach(x=>x.textContent=clock().time)},1000);

function suspendPosBackgroundWork(){
 clearInterval(window.__yjMemberSyncTimer);
 clearInterval(window.__yjPromoSyncTimer);
 window.__yjMemberSyncTimer=null;
 window.__yjPromoSyncTimer=null;
}
function resumePosAfterBackground(){
 if(document.hidden)return;
 const isPos=document.body.dataset.mode==='front'&&!!document.querySelector('.pos-classic');
 if(!isPos)return;
 requestAnimationFrame(()=>{
  try{
   if(document.querySelector('#cartList'))drawPOS();
   bindPosBottomMenu();
  }catch(e){console.error('TM resume redraw failed',e)}
 });
 clearTimeout(window.__yjResumeSyncTimer);
 window.__yjResumeSyncTimer=setTimeout(async()=>{
  if(document.hidden||!document.querySelector('.pos-classic'))return;
  if(!window.__yjMemberSyncBusy){
   window.__yjMemberSyncBusy=true;
   try{await refreshPosMembersCloud({redraw:false})}catch(_){}
   finally{window.__yjMemberSyncBusy=false}
  }
 },1500);
 clearInterval(window.__yjMemberSyncTimer);
 window.__yjMemberSyncTimer=setInterval(async()=>{
  if(document.hidden||window.__yjMemberSyncBusy)return;
  window.__yjMemberSyncBusy=true;
  try{await refreshPosMembersCloud({redraw:false})}catch(_){}
  finally{window.__yjMemberSyncBusy=false}
 },60000);
 clearInterval(window.__yjPromoSyncTimer);
 window.__yjPromoSyncTimer=setInterval(async()=>{
  if(document.hidden||window.__yjPromoSyncBusy)return;
  window.__yjPromoSyncBusy=true;
  try{
   const changed=await cloudPullPromotionRules();
   if(changed&&document.querySelector('#cartList'))requestAnimationFrame(()=>drawPOS());
  }catch(_){}
  finally{window.__yjPromoSyncBusy=false}
 },120000);
}
if(!window.__yjLifecycleBound){
 window.__yjLifecycleBound=true;
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
   clearTimeout(window.__yjResumeSyncTimer);
   suspendPosBackgroundWork();
  }else resumePosAfterBackground();
 },{passive:true});
 window.addEventListener('pagehide',()=>suspendPosBackgroundWork(),{passive:true});
 window.addEventListener('pageshow',()=>{if(!document.hidden)resumePosAfterBackground()},{passive:true});
}
['gesturestart','gesturechange','gestureend'].forEach(name=>document.addEventListener(name,e=>e.preventDefault(),{passive:false}));

async function startEnterprise(){
 try{await cloudBootstrap()}catch(e){console.error('cloudBootstrap failed',e)}
 try{seed()}catch(e){console.error('seed failed',e)}
 applyTmOperationMode();applyTmPowerSaving();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v='+encodeURIComponent(window.APP_VERSION||window.YJ_VERSION||'8.90'),{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
 try{
  logout();showLogin('front');
  window.__YJ_BOOT_OK=true;
  try{sessionStorage.removeItem('yj_tm_boot_retry_883')}catch(_e){}
 }catch(e){
  console.error('TM startup failed',e);
  app.innerHTML='<div class="notice" style="margin:24px"><b>TM 啟動失敗</b><br>系統將自動重新載入，不需關閉 App。</div>';
  setTimeout(()=>window.__yjTmBootRecover?.('TM 主程式啟動失敗'),100);
 }
 setTimeout(checkSchedules,300);
}
startEnterprise().catch(e=>{
 console.error(e);
 try{showLogin('front');window.__YJ_BOOT_OK=true}
 catch(_){setTimeout(()=>window.__yjTmBootRecover?.('TM 啟動例外'),100)}
});
clearInterval(window.__yjPowerSavingSettingsTimer);window.__yjPowerSavingSettingsTimer=setInterval(()=>{if(!document.hidden)refreshTmPowerSavingSettings()},60000);

clearInterval(window.__yjMasterUpdateTimer);window.__yjMasterUpdateTimer=setInterval(()=>{checkEmployeeMasterUpdate()},5000);setTimeout(checkEmployeeMasterUpdate,1800);
clearInterval(window.__yjFreshAlertTimer);window.__yjFreshAlertTimer=setInterval(()=>{if(!document.hidden)checkFreshExpiryAlerts()},60000);
clearInterval(window.__yjLinkedRulesTimer);
window.__yjLinkedRulesTimer=setInterval(async()=>{
 if(document.hidden||window.__yjLinkedRulesBusy||!cloudConfigured())return;
 window.__yjLinkedRulesBusy=true;
 try{await cloudPullKey(K.linkedInventoryRules)}catch(_){}
 finally{window.__yjLinkedRulesBusy=false}
},30000);
setTimeout(checkFreshExpiryAlerts,1500);


try{
 localStorage.removeItem('yijia_remember_login');
 localStorage.removeItem('rememberLogin');
 localStorage.removeItem('remember_login');
 localStorage.removeItem('rememberUser');
 localStorage.removeItem('lastLoginUser');
}catch(e){}


// Alpha 7.75 TM↔SC heartbeat
startTmScHeartbeat();

setTimeout(()=>retryAppAnybuyPaymentSyncQueue().catch(()=>{}),5000);
setInterval(()=>retryAppAnybuyPaymentSyncQueue().catch(()=>{}),60000);
