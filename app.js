// SC Alpha 5.69 — 億家Pay正式設定與金流查詢，沿用 App 共用錢包／帳本。
// SC Alpha 4.60 emergency stability: rollback 4.59 founder session optimizer; preserve 4.58 EOB stocktake/back/HQ upload.
import{K,load,save,uid,money,seed}from'./db.js';
import{currentUser,employees,login,logout,audit}from'./core.js';
import{state,products,add,qty,setQty,totals,checkout,correctSale,closeSale,makeReturnCode,findSaleByReturnCode,beginCorrectionMode,endCorrectionMode}from'./pos.js';
import{logisticsTypes,ecTypes,logistics,attendance,addEC,cancelEC,updateECStatus,createTransfer,receiveTransfer}from'./ops.js';
import{collect,correct,z,autoCloseBusinessDay,REMITTANCE_BANKS}from'./revenue.js';
import{code128Svg,systemBarcode,ensureBarcode,numericProductBarcode}from'./barcode.js';

import{getCloudConfig,setCloudConfig,cloudConfigured,cloudStatus,testCloudConnection,cloudPushAll,cloudPullAll,cloudPullKey,cloudPushKey,cloudBootstrap,adminListLogisticsBatches,adminCreateLogisticsBatch,adminBindEcGroupToBatch,adminDeleteInvalidLogisticsBatch,adminListLogisticsSchedules,adminUpsertLogisticsSchedule,adminTransmitOrderToLogistics,adminGetOrderReceiptByBatch,adminSetLogisticsDeliveryDate,adminListEcPackages,adminCreateEcPackage,adminCreateEcReturnBatch,adminListEcReturnBatches,adminGetInventoryReceiptByBatch,adminListInventoryReceipts,adminSyncInventoryReceiptItems,adminCreatePromotionAutoArrival,adminAcceptInventoryReceipt,adminSendEobFindSignal,adminListEobStocktakes,adminCorrectEobStocktakeType,adminUploadEobStocktakesHq,adminSyncStaffAccount,adminSyncStocktakeAccess,adminListPointRewards,adminGetPointRewardSettings,adminSetPointRewardEnabled,adminUpsertPointReward,adminDeletePointReward,scGetYijiaPaySettings,scUpdateYijiaPaySettings,scListYijiaPayPayments,scListYijiaPayReloads,scListYijiaPayRefunds,scListYijiaPayLedger}from'./sync.js';

let posCategory='全部';
let yijiaPayScSettings={enabled:true,cashReloadEnabled:true,monthlyCashReloadLimit:5000};
let yijiaPayScRows={payments:[],reloads:[],refunds:[],ledger:[]};
let yijiaPayScLoaded=false,yijiaPayScLoading=false;
async function refreshYijiaPayScCloud({rerender=false}={}){
 if(!cloudConfigured()||yijiaPayScLoading)return false;yijiaPayScLoading=true;
 try{
  const [cfg,payments,reloads,refunds,ledger]=await Promise.all([scGetYijiaPaySettings(),scListYijiaPayPayments(200),scListYijiaPayReloads(200),scListYijiaPayRefunds(200),scListYijiaPayLedger(500)]);
  const c=Array.isArray(cfg)?(cfg[0]||{}):(cfg||{});
  yijiaPayScSettings={enabled:c.enabled!==false,cashReloadEnabled:c.cashReloadEnabled??c.cash_reload_enabled??true,monthlyCashReloadLimit:Number(c.monthlyCashReloadLimit??c.monthly_cash_reload_limit??5000)};
  yijiaPayScRows={payments:Array.isArray(payments)?payments:[],reloads:Array.isArray(reloads)?reloads:[],refunds:Array.isArray(refunds)?refunds:[],ledger:Array.isArray(ledger)?ledger:[]};yijiaPayScLoaded=true;
  if(rerender&&currentAdminPage()==='app-settings')render('app-settings');return true;
 }catch(e){console.warn('億家Pay SC 同步失敗',e);return false}finally{yijiaPayScLoading=false}
}
function yjPayEntryZh(t){return ({payment:'付款',reload:'現金儲值',refund:'一般退款',expiry_refund:'到期退款',adjustment:'總部人工調整'})[String(t||'')]||String(t||'—')}
function yijiaPayScSection(){
 const c=yijiaPayScSettings,ledger=yijiaPayScRows.ledger||[],payments=yijiaPayScRows.payments||[],reloads=yijiaPayScRows.reloads||[],refunds=yijiaPayScRows.refunds||[];
 const fmt=v=>money(Number(v||0)),dt=v=>v?new Date(v).toLocaleString('zh-TW'):'—';
 return `<section class="panel app-settings-section"><div class="page-head"><div><h3>💳 億家Pay</h3><small>正式共用 app_yijiapay_* 資料｜不建立第二套錢包或帳本</small></div><div class="toolbar"><button class="button" data-action="yijiapay-sc-refresh">↻ 更新金流</button><button class="primary" data-action="yijiapay-sc-save">儲存億家Pay設定</button></div></div>
 <div class="settings-grid"><label class="check-field"><input id="yjPayEnabled" type="checkbox" ${c.enabled!==false?'checked':''}>開放億家Pay</label><label class="check-field"><input id="yjPayCashReloadEnabled" type="checkbox" ${c.cashReloadEnabled!==false?'checked':''}>開放現金儲值</label><label>每月現金儲值上限（元）<input id="yjPayMonthlyLimit" type="number" min="0" step="100" value="${Number(c.monthlyCashReloadLimit||5000)}"></label></div>
 <div class="notice"><b>唯一餘額來源：</b>app_yijiapay_wallets　<b>唯一金流帳本：</b>app_yijiapay_wallet_ledger</div>
 <h4>最近付款</h4><div class="table-wrap"><table class="table"><tr><th>時間</th><th>付款碼</th><th>會員</th><th>店號</th><th>TM交易</th><th>金額</th><th>已退</th><th>狀態</th></tr>${payments.slice(0,30).map(x=>`<tr><td>${dt(x.createdAt||x.created_at||x.usedAt||x.used_at)}</td><td>${esc(x.payCode||x.pay_code||'')}</td><td>${esc(x.memberPhone||x.member_phone||'')}</td><td>${esc(x.storeCode||x.used_store_code||'')}</td><td>${esc(x.tmSaleId||x.tm_sale_id||'')}</td><td>${fmt(x.amount)}</td><td>${fmt(x.refundedAmount||x.refunded_amount)}</td><td>${esc(x.status||'')}</td></tr>`).join('')||'<tr><td colspan="8">尚無資料</td></tr>'}</table></div>
 <h4>最近儲值／退款</h4><div class="table-wrap"><table class="table"><tr><th>類型</th><th>時間</th><th>會員</th><th>店號</th><th>交易編號</th><th>金額</th><th>餘額後</th></tr>${[...reloads.map(x=>({...x,_kind:'現金儲值',_amt:x.amount,_sale:x.tmSaleId||x.tm_sale_id})),...refunds.map(x=>({...x,_kind:'退款',_amt:x.refundAmount||x.refund_amount,_sale:x.refundSaleId||x.refund_sale_id}))].sort((a,b)=>Date.parse(b.createdAt||b.created_at||0)-Date.parse(a.createdAt||a.created_at||0)).slice(0,30).map(x=>`<tr><td>${x._kind}</td><td>${dt(x.createdAt||x.created_at)}</td><td>${esc(x.phone||x.memberPhone||'')}</td><td>${esc(x.storeCode||x.store_code||'')}</td><td>${esc(x._sale||'')}</td><td>${fmt(x._amt)}</td><td>${fmt(x.balanceAfter||x.balance_after)}</td></tr>`).join('')||'<tr><td colspan="7">尚無資料</td></tr>'}</table></div>
 <h4>統一錢包帳本</h4><div class="table-wrap"><table class="table"><tr><th>時間</th><th>entry_type</th><th>類型</th><th>會員</th><th>金額</th><th>前餘額</th><th>後餘額</th><th>店號</th><th>來源</th></tr>${ledger.slice(0,80).map(x=>`<tr><td>${dt(x.createdAt||x.created_at)}</td><td>${esc(x.entryType||x.entry_type||'')}</td><td>${esc(yjPayEntryZh(x.entryType||x.entry_type))}</td><td>${esc(x.phone||'')}</td><td>${fmt(x.amount)}</td><td>${fmt(x.balanceBefore||x.balance_before)}</td><td>${fmt(x.balanceAfter||x.balance_after)}</td><td>${esc(x.storeCode||x.store_code||'')}</td><td>${esc(x.sourceId||x.source_id||x.tmSaleId||x.tm_sale_id||'')}</td></tr>`).join('')||'<tr><td colspan="9">尚無資料</td></tr>'}</table></div></section>`;
}
const app=document.querySelector('#app'),loginDialog=document.querySelector('#loginDialog'),genericDialog=document.querySelector('#genericDialog');
const pages=[['home','🏠','首頁'],['products','📦','商品管理'],['promotions','🏷️','總部商品活動'],['ordering','🛒','訂購管理'],['inventory','📊','盤點管理'],['quality','🏷️','品保／時控'],['logistics','🚚','物流管理'],['ec','📮','EC管理'],['transfers','🔄','轉貨管理'],['attendance','🕘','出勤管理'],['members','👥','會員管理'],['employees','👤','人員基本資料'],['stores','🏪','門市管理'],['transactions','🧾','交易存根'],['revenue','📈','營收管理'],['operations','📊','營運情報'],['audit','📋','業務紀錄'],['system-settings','☁️','雲端與更新'],['customer-display-settings','📺','客顯設定']];

const ROLE_LIST=['創辦人','店長','副店長','正職','兼職','總部支援','盤點人員','工程師','總部人員'];
const ROLE_RANK={'兼職':1,'正職':2,'副店長':3,'店長':4,'創辦人':5,'總部支援':0,'盤點人員':0,'工程師':0,'總部人員':0};
const SELF_CHECKOUT_ACCOUNT_KEY='yj_self_checkout_account';
const TM_SCREEN_CATEGORIES_KEY='yj_tm_screen_categories';
const TM_QUICK_AMOUNT_KEYS_KEY='yj_tm_quick_amount_keys';
const HQ_APP_SETTINGS_KEY='yj_hq_app_settings';
const APP_ANYBUY_PRODUCTS_KEY='yj_app_anybuy_products';
const TM_ANYBUY_PRODUCTS_KEY='yj_tm_anybuy_products';
const APP_COUPONS_KEY='yj_app_coupons';
const POINT_REWARD_TYPES={product:'商品',coupon:'優惠券',voucher:'兌換券',other:'其他'};
let pointRewardCloudRows=[];
let pointRewardCloudConfig={rewardEnabled:false};
let pointRewardCloudLoaded=false;
let pointRewardCloudLoading=false;

function pointRewardDateValue(v){
 if(!v)return '';
 const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v).slice(0,10);
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function pointRewardPayloadText(v){try{return JSON.stringify(v&&typeof v==='object'?v:{},null,2)}catch{return '{}'}}
async function refreshPointRewardSettingsCloud({rerender=false}={}){
 if(pointRewardCloudLoading)return false;
 if(!cloudConfigured()){pointRewardCloudRows=[];pointRewardCloudConfig={rewardEnabled:false};pointRewardCloudLoaded=true;if(rerender&&currentAdminPage()==='point-reward-settings')render('point-reward-settings');return false}
 pointRewardCloudLoading=true;
 try{
  const [rows,cfg]=await Promise.all([adminListPointRewards(),adminGetPointRewardSettings()]);
  pointRewardCloudRows=Array.isArray(rows)?rows:[];
  pointRewardCloudConfig=cfg&&typeof cfg==='object'?cfg:{rewardEnabled:false};
  pointRewardCloudLoaded=true;
  return true;
 }catch(e){
  pointRewardCloudLoaded=true;
  console.warn('點數兌換設定同步失敗',e);
  if(rerender)alert('點數兌換設定同步失敗：'+(e?.message||e));
  return false;
 }finally{
  pointRewardCloudLoading=false;
  if(rerender&&currentAdminPage()==='point-reward-settings')render('point-reward-settings');
 }
}
function pointRewardRowsHtml(){
 const rows=pointRewardCloudRows||[];
 return rows.map(x=>`<tr>
  <td>${esc(x.reward_code||'')}</td><td><b>${esc(x.name||'')}</b><small style="display:block">${esc(x.description||'')}</small></td>
  <td>${esc(POINT_REWARD_TYPES[x.reward_type]||x.reward_type||'其他')}</td><td>${Number(x.points_cost||0)} 點</td>
  <td>${x.stock_limit==null?'不限':`${Number(x.redeemed_qty||0)} / ${Number(x.stock_limit||0)}`}</td><td>${Number(x.per_member_limit||0)>0?`${Number(x.per_member_limit)} 次`:'不限'}</td>
  <td>${x.starts_at||x.ends_at?`${esc(pointRewardDateValue(x.starts_at)||'不限')} ～ ${esc(pointRewardDateValue(x.ends_at)||'不限')}`:'不限'}</td>
  <td>${x.active?'<b class="good">啟用</b>':'<b class="bad">停用</b>'}</td><td>${Number(x.sort_order||0)}</td>
  <td><div class="actions"><button class="button" data-action="point-reward-edit" data-id="${esc(x.id||'')}">修改</button><button class="button danger" data-action="point-reward-delete" data-id="${esc(x.id||'')}">刪除</button></div></td>
 </tr>`).join('')||'<tr><td colspan="10">目前尚未建立點數兌換項目</td></tr>';
}
function pointRewardSettingsPage(){
 if(!isHeadOffice())return `<div class="page-head"><h2>點數兌換設定</h2></div><div class="panel"><p>此功能僅在總部 SC 顯示。</p></div>`;
 if(!canAccessHqAppSettings())return `<div class="page-head"><h2>點數兌換設定</h2></div><div class="panel"><p>需要「App設定」權限。</p></div>`;
 return `<div class="page-head"><div><h2>點數兌換設定</h2><small>App 點數兌換目錄｜新增、修改、刪除後直接供 App 使用</small></div><div class="toolbar"><button class="button" data-nav="member-point-settings">← 點數設定</button><button class="button" data-action="point-reward-refresh">↻ 同步雲端</button><button class="primary" data-action="point-reward-add">＋ 新增兌換</button></div></div>
 <section class="panel"><div class="setting-grid"><label class="check-field"><input id="pointRewardEnabled" type="checkbox" ${pointRewardCloudConfig.rewardEnabled?'checked':''}>啟用 App 點數兌換</label><div><button class="button" data-action="point-reward-save-enabled">儲存啟用狀態</button></div></div><p class="setting-hint">關閉時 App 不會顯示可兌換項目；既有兌換紀錄不會刪除。</p></section>
 <section class="panel" style="margin-top:14px"><div class="table-wrap"><table class="table"><thead><tr><th>兌換代碼</th><th>名稱／說明</th><th>類型</th><th>所需點數</th><th>總量／已兌</th><th>每會員限兌</th><th>活動期間</th><th>狀態</th><th>排序</th><th>操作</th></tr></thead><tbody>${pointRewardRowsHtml()}</tbody></table></div></section>`;
}
function openPointRewardEditor(row=null){
 const x=row||{};const isEdit=!!x.id;
 dlg(isEdit?'修改點數兌換':'新增點數兌換',`<input type="hidden" id="prId" value="${esc(x.id||'')}">
  <div class="grid2"><label>兌換代碼<input id="prCode" value="${esc(x.reward_code||'')}" placeholder="例如 COFFEE100"></label><label>兌換名稱<input id="prName" value="${esc(x.name||'')}" placeholder="例如 大杯美式 1 杯"></label>
  <label>類型<select id="prType">${Object.entries(POINT_REWARD_TYPES).map(([k,v])=>`<option value="${k}" ${String(x.reward_type||'other')===k?'selected':''}>${v}</option>`).join('')}</select></label><label>所需點數<input id="prPoints" type="number" min="1" step="1" value="${Number(x.points_cost||100)}"></label>
  <label>總兌換上限<input id="prStock" type="number" min="0" step="1" value="${x.stock_limit==null?'':Number(x.stock_limit)}" placeholder="空白＝不限"></label><label>每會員限兌<input id="prPerMember" type="number" min="0" step="1" value="${Number(x.per_member_limit||0)}"><small>0＝不限</small></label>
  <label>開始日<input id="prStart" type="date" value="${esc(pointRewardDateValue(x.starts_at))}"></label><label>結束日<input id="prEnd" type="date" value="${esc(pointRewardDateValue(x.ends_at))}"></label>
  <label>圖片網址<input id="prImage" value="${esc(x.image_url||'')}" placeholder="https://..."></label><label>排序<input id="prSort" type="number" step="10" value="${Number(x.sort_order||0)}"></label></div>
  <label>說明<textarea id="prDesc" rows="3">${esc(x.description||'')}</textarea></label><label>兌換內容 payload（JSON）<textarea id="prPayload" rows="5" placeholder='例如 {"productCode":"P00001"}'>${esc(pointRewardPayloadText(x.payload))}</textarea></label>
  <label class="check-field"><input id="prActive" type="checkbox" ${x.active!==false?'checked':''}>啟用此兌換項目</label>
  <button class="primary" data-action="point-reward-save-modal">${isEdit?'儲存修改':'建立兌換'}</button>`);
}
function appCoupons(){
 const rows=load(APP_COUPONS_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
async function saveAppCoupons(rows){
 const clean=(Array.isArray(rows)?rows:[]).map((x,i)=>({
  id:String(x.id||`CPN-${Date.now()}-${i}`),
  code:String(x.code||'').trim(),
  name:String(x.name||'').trim(),
  type:String(x.type||'折價券').trim(),
  value:Number(x.value||0),
  minSpend:Number(x.minSpend||0),
  startDate:String(x.startDate||'').trim(),
  endDate:String(x.endDate||'').trim(),
  imageUrl:String(x.imageUrl||'').trim(),
  active:x.active!==false,
  note:String(x.note||'').trim(),
  updatedAt:new Date().toISOString(),
  updatedBy:currentUser()?.name||''
 })).filter(x=>x.code&&x.name);
 save(APP_COUPONS_KEY,clean);
 if(cloudConfigured())try{await cloudPushKey(APP_COUPONS_KEY,clean)}catch(e){console.warn('優惠券同步失敗',e)}
 return clean;
}
function appCouponTable(){
 const rows=appCoupons();
 return `<div class="table-wrap"><table class="table app-coupon-table">
  <thead><tr><th>優惠券代碼</th><th>優惠券名稱</th><th>類型</th><th>優惠值</th><th>最低消費</th><th>開始日</th><th>結束日</th><th>圖片網址</th><th>啟用</th><th>備註</th><th>操作</th></tr></thead>
  <tbody id="appCouponRows">
   ${rows.map(x=>`<tr data-app-coupon-row="${esc(x.id)}">
    <td><input data-cpn="code" value="${esc(x.code||'')}"></td>
    <td><input data-cpn="name" value="${esc(x.name||'')}"></td>
    <td><select data-cpn="type">${['折價券','折扣券','商品券','贈品券','免運券','其他'].map(v=>`<option ${String(x.type||'折價券')===v?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><input data-cpn="value" type="number" min="0" value="${Number(x.value||0)}"></td>
    <td><input data-cpn="minSpend" type="number" min="0" value="${Number(x.minSpend||0)}"></td>
    <td><input data-cpn="startDate" type="date" value="${esc(x.startDate||'')}"></td>
    <td><input data-cpn="endDate" type="date" value="${esc(x.endDate||'')}"></td>
    <td><input data-cpn="imageUrl" value="${esc(x.imageUrl||'')}" placeholder="https://..."></td>
    <td><input data-cpn="active" type="checkbox" ${x.active!==false?'checked':''}></td>
    <td><input data-cpn="note" value="${esc(x.note||'')}"></td>
    <td><button class="button danger" data-action="app-coupon-delete" data-id="${esc(x.id)}">刪除</button></td>
   </tr>`).join('')||'<tr><td colspan="11">尚未建立優惠券</td></tr>'}
  </tbody>
 </table></div>`;
}
function collectAppCouponRows(){
 return [...document.querySelectorAll('[data-app-coupon-row]')].map(tr=>({
  id:tr.dataset.appCouponRow,
  code:String(tr.querySelector('[data-cpn="code"]')?.value||'').trim(),
  name:String(tr.querySelector('[data-cpn="name"]')?.value||'').trim(),
  type:String(tr.querySelector('[data-cpn="type"]')?.value||'折價券').trim(),
  value:Number(tr.querySelector('[data-cpn="value"]')?.value||0),
  minSpend:Number(tr.querySelector('[data-cpn="minSpend"]')?.value||0),
  startDate:String(tr.querySelector('[data-cpn="startDate"]')?.value||'').trim(),
  endDate:String(tr.querySelector('[data-cpn="endDate"]')?.value||'').trim(),
  imageUrl:String(tr.querySelector('[data-cpn="imageUrl"]')?.value||'').trim(),
  active:!!tr.querySelector('[data-cpn="active"]')?.checked,
  note:String(tr.querySelector('[data-cpn="note"]')?.value||'').trim()
 })).filter(x=>x.code||x.name);
}
function appAnybuyProducts(){const rows=load(APP_ANYBUY_PRODUCTS_KEY,[]);return Array.isArray(rows)?rows:[]}
async function saveAppAnybuyProducts(rows){
 const clean=(Array.isArray(rows)?rows:[]).map((x,i)=>({
  id:String(x.id||`ABP-${Date.now()}-${i}`),
  code:String(x.code||'').trim(),
  name:String(x.name||'').trim(),
  category:String(x.category||'隨買').trim(),
  originalPrice:Number(x.originalPrice??x.price??0),
  price:Number(x.price||0),
  groupCount:Math.max(1,Math.floor(Number(x.groupCount||1))),
  maxPurchaseGroups:Math.max(0,Math.floor(Number(x.maxPurchaseGroups||0))),
  quantity:Math.max(0,Math.floor(Number(x.quantity||0))),
  validityDays:Math.max(0,Math.floor(Number(x.validityDays||0))),
  activityStartDate:String(x.activityStartDate||'').trim(),
  activityEndDate:String(x.activityEndDate||'').trim(),
  activityContent:String(x.activityContent||'').trim(),
  imageUrl:String(x.imageUrl||'').trim(),
  active:x.active!==false,
  note:String(x.note||'').trim(),
  updatedAt:new Date().toISOString(),
  updatedBy:currentUser()?.name||''
 })).filter(x=>x.code&&x.name);
 save(APP_ANYBUY_PRODUCTS_KEY,clean);if(cloudConfigured())try{await cloudPushKey(APP_ANYBUY_PRODUCTS_KEY,clean)}catch(e){console.warn('隨買商品同步失敗',e)}return clean;
}
function appAnybuyProductTable(){
 const rows=appAnybuyProducts();
 return `<div class="table-wrap"><table class="table app-anybuy-table"><thead><tr><th>商品代號</th><th>商品名稱</th><th>類別</th><th>原價</th><th>售價</th><th>組數</th><th>數量</th><th>限購組數</th><th>效期（天）</th><th>活動開始日</th><th>活動結束日</th><th>活動內容</th><th>圖片網址</th><th>啟用</th><th>備註</th><th>操作</th></tr></thead><tbody id="appAnybuyRows">${rows.map(x=>`<tr data-app-anybuy-row="${esc(x.id)}"><td><input data-abp="code" value="${esc(x.code||'')}"></td><td><input data-abp="name" value="${esc(x.name||'')}"></td><td><input data-abp="category" value="${esc(x.category||'隨買')}"></td><td><input data-abp="originalPrice" type="number" min="0" value="${Number(x.originalPrice??x.price??0)}"></td><td><input data-abp="price" type="number" min="0" value="${Number(x.price||0)}"></td><td><input data-abp="groupCount" type="number" min="1" step="1" value="${Math.max(1,Number(x.groupCount||1))}" title="例如 1 組"></td><td><input data-abp="quantity" type="number" min="0" step="1" value="${Number(x.quantity??0)}" title="例如 3 杯"></td><td><input data-abp="maxPurchaseGroups" type="number" min="0" step="1" value="${Math.max(0,Number(x.maxPurchaseGroups||0))}" title="0 表示不限購"></td><td><input data-abp="validityDays" type="number" min="0" step="1" value="${Number(x.validityDays??0)}" title="0 表示未設定固定效期"></td><td><input data-abp="activityStartDate" type="date" value="${esc(x.activityStartDate||'')}"></td><td><input data-abp="activityEndDate" type="date" value="${esc(x.activityEndDate||'')}"></td><td><textarea data-abp="activityContent" rows="2" placeholder="例如：買2送1、任選2件折10元">${esc(x.activityContent||'')}</textarea></td><td>
 <div class="app-anybuy-image-cell">
  <div class="app-anybuy-image-preview" data-abp-image-preview="${esc(x.id)}">${x.imageUrl?`<img src="${esc(x.imageUrl)}" alt="${esc(x.name||'商品圖片')}">`:'<span>尚未上傳</span>'}</div>
  <input type="hidden" data-abp="imageUrl" value="${esc(x.imageUrl||'')}">
  <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" data-abp-image-file="${esc(x.id)}">
  <small data-abp-image-status="${esc(x.id)}">${x.imageUrl?'目前已有圖片；重新選擇會覆蓋。':'請從裝置選擇圖片'}</small>
 </div>
</td><td><input data-abp="active" type="checkbox" ${x.active!==false?'checked':''}></td><td><input data-abp="note" value="${esc(x.note||'')}"></td><td><button class="button danger" data-action="app-anybuy-delete">刪除</button></td></tr>`).join('')||'<tr><td colspan="16">尚未建立隨買商品</td></tr>'}</tbody></table></div>`;
}
function collectAppAnybuyRows(){return [...document.querySelectorAll('[data-app-anybuy-row]')].map(tr=>({
 id:tr.dataset.appAnybuyRow,
 code:String(tr.querySelector('[data-abp="code"]')?.value||'').trim(),
 name:String(tr.querySelector('[data-abp="name"]')?.value||'').trim(),
 category:String(tr.querySelector('[data-abp="category"]')?.value||'隨買').trim(),
 originalPrice:Number(tr.querySelector('[data-abp="originalPrice"]')?.value||0),
 price:Number(tr.querySelector('[data-abp="price"]')?.value||0),
 groupCount:Math.max(1,Math.floor(Number(tr.querySelector('[data-abp="groupCount"]')?.value||1))),
 maxPurchaseGroups:Math.max(0,Math.floor(Number(tr.querySelector('[data-abp="maxPurchaseGroups"]')?.value||0))),
 quantity:Math.max(0,Math.floor(Number(tr.querySelector('[data-abp="quantity"]')?.value||0))),
 validityDays:Math.max(0,Math.floor(Number(tr.querySelector('[data-abp="validityDays"]')?.value||0))),
 activityStartDate:String(tr.querySelector('[data-abp="activityStartDate"]')?.value||'').trim(),
 activityEndDate:String(tr.querySelector('[data-abp="activityEndDate"]')?.value||'').trim(),
 activityContent:String(tr.querySelector('[data-abp="activityContent"]')?.value||'').trim(),
 imageUrl:String(tr.querySelector('[data-abp="imageUrl"]')?.value||'').trim(),
 active:!!tr.querySelector('[data-abp="active"]')?.checked,
 note:String(tr.querySelector('[data-abp="note"]')?.value||'').trim()
})).filter(x=>x.code||x.name)}
function bindAppAnybuyImageUploads(){
 document.querySelectorAll('[data-abp-image-file]').forEach(input=>{
  if(input.dataset.boundAnybuyImage==='1')return;
  input.dataset.boundAnybuyImage='1';
  input.addEventListener('change',()=>{
   const file=input.files?.[0]||null;if(!file)return;
   if(!String(file.type||'').startsWith('image/')&&!/\.(jpg|jpeg|png|webp)$/i.test(file.name||''))return alert('請選擇 JPG、PNG 或 WebP 圖片');
   if(Number(file.size||0)>3*1024*1024)return alert('圖片檔案請勿超過 3MB');
   const r=new FileReader();
   r.onload=()=>{
    const tr=input.closest('[data-app-anybuy-row]');
    if(!tr)return;
    const hidden=tr.querySelector('[data-abp="imageUrl"]');
    const id=tr.dataset.appAnybuyRow||'';
    const preview=tr.querySelector(`[data-abp-image-preview="${CSS.escape(String(id))}"]`)||tr.querySelector('.app-anybuy-image-preview');
    const status=tr.querySelector(`[data-abp-image-status="${CSS.escape(String(id))}"]`)||tr.querySelector('[data-abp-image-status]');
    const dataUrl=String(r.result||'');
    if(hidden)hidden.value=dataUrl;
    if(preview)preview.innerHTML=`<img src="${dataUrl}" alt="商品圖片">`;
    if(status)status.textContent=`已選擇：${file.name||'圖片'}；按「儲存隨買商品」後同步。`;
   };
   r.onerror=()=>alert('圖片讀取失敗，請重新選擇');
   r.readAsDataURL(file);
  });
 });
}


function tmAnybuyProducts(){const rows=load(TM_ANYBUY_PRODUCTS_KEY,[]);return Array.isArray(rows)?rows:[]}
async function saveTmAnybuyProducts(rows){
 const clean=(Array.isArray(rows)?rows:[]).map((x,i)=>({
  id:String(x.id||`TMP-${Date.now()}-${i}`),
  code:String(x.code||'').trim(),
  name:String(x.name||'').trim(),
  category:String(x.category||'隨買').trim(),
  originalPrice:Number(x.originalPrice??x.price??0),
  price:Number(x.price||0),
  groupCount:Math.max(1,Math.floor(Number(x.groupCount||1))),
  maxPurchaseGroups:Math.max(0,Math.floor(Number(x.maxPurchaseGroups||0))),
  quantity:Math.max(0,Math.floor(Number(x.quantity||0))),
  validityDays:Math.max(0,Math.floor(Number(x.validityDays||0))),
  activityStartDate:String(x.activityStartDate||'').trim(),
  activityEndDate:String(x.activityEndDate||'').trim(),
  activityContent:String(x.activityContent||'').trim(),
  imageUrl:String(x.imageUrl||'').trim(),
  active:x.active!==false,
  note:String(x.note||'').trim(),
  source:'TM',
  updatedAt:new Date().toISOString(),
  updatedBy:currentUser()?.name||''
 })).filter(x=>x.code&&x.name);
 save(TM_ANYBUY_PRODUCTS_KEY,clean);
 if(cloudConfigured())try{await cloudPushKey(TM_ANYBUY_PRODUCTS_KEY,clean)}catch(e){console.warn('TM隨買活動同步失敗',e)}
 return clean;
}
function tmAnybuyProductTable(){
 const rows=tmAnybuyProducts();
 return `<div class="table-wrap"><table class="table app-anybuy-table"><thead><tr><th>商品代號</th><th>商品名稱</th><th>類別</th><th>原價</th><th>售價</th><th>組數</th><th>數量</th><th>限購組數</th><th>效期（天）</th><th>活動開始日</th><th>活動結束日</th><th>活動內容</th><th>圖片網址</th><th>啟用</th><th>備註</th><th>操作</th></tr></thead><tbody id="tmAnybuyRows">${rows.map(x=>`<tr data-tm-anybuy-row="${esc(x.id)}"><td><input data-tmp="code" value="${esc(x.code||'')}"></td><td><input data-tmp="name" value="${esc(x.name||'')}"></td><td><input data-tmp="category" value="${esc(x.category||'隨買')}"></td><td><input data-tmp="originalPrice" type="number" min="0" value="${Number(x.originalPrice??x.price??0)}"></td><td><input data-tmp="price" type="number" min="0" value="${Number(x.price||0)}"></td><td><input data-tmp="groupCount" type="number" min="1" step="1" value="${Math.max(1,Number(x.groupCount||1))}" title="例如 1 組"></td><td><input data-tmp="quantity" type="number" min="0" step="1" value="${Number(x.quantity??0)}" title="例如 3 杯"></td><td><input data-tmp="maxPurchaseGroups" type="number" min="0" step="1" value="${Math.max(0,Number(x.maxPurchaseGroups||0))}" title="0 表示不限購"></td><td><input data-tmp="validityDays" type="number" min="0" step="1" value="${Number(x.validityDays??0)}" title="0 表示未設定固定效期"></td><td><input data-tmp="activityStartDate" type="date" value="${esc(x.activityStartDate||'')}"></td><td><input data-tmp="activityEndDate" type="date" value="${esc(x.activityEndDate||'')}"></td><td><textarea data-tmp="activityContent" rows="2" placeholder="例如：買2送1、任選2件折10元">${esc(x.activityContent||'')}</textarea></td><td>
 <div class="app-anybuy-image-cell">
  <div class="app-anybuy-image-preview" data-tmp-image-preview="${esc(x.id)}">${x.imageUrl?`<img src="${esc(x.imageUrl)}" alt="${esc(x.name||'商品圖片')}">`:'<span>尚未上傳</span>'}</div>
  <input type="hidden" data-tmp="imageUrl" value="${esc(x.imageUrl||'')}">
  <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" data-tmp-image-file="${esc(x.id)}">
  <small data-tmp-image-status="${esc(x.id)}">${x.imageUrl?'目前已有圖片；重新選擇會覆蓋。':'請從裝置選擇圖片'}</small>
 </div>
</td><td><input data-tmp="active" type="checkbox" ${x.active!==false?'checked':''}></td><td><input data-tmp="note" value="${esc(x.note||'')}"></td><td><button class="button danger" data-action="tm-anybuy-delete">刪除</button></td></tr>`).join('')||'<tr><td colspan="16">尚未建立 TM 隨買跨店取活動</td></tr>'}</tbody></table></div>`;
}
function collectTmAnybuyRows(){return [...document.querySelectorAll('[data-tm-anybuy-row]')].map(tr=>({
 id:tr.dataset.tmAnybuyRow,
 code:String(tr.querySelector('[data-tmp="code"]')?.value||'').trim(),
 name:String(tr.querySelector('[data-tmp="name"]')?.value||'').trim(),
 category:String(tr.querySelector('[data-tmp="category"]')?.value||'隨買').trim(),
 originalPrice:Number(tr.querySelector('[data-tmp="originalPrice"]')?.value||0),
 price:Number(tr.querySelector('[data-tmp="price"]')?.value||0),
 groupCount:Math.max(1,Math.floor(Number(tr.querySelector('[data-tmp="groupCount"]')?.value||1))),
 maxPurchaseGroups:Math.max(0,Math.floor(Number(tr.querySelector('[data-tmp="maxPurchaseGroups"]')?.value||0))),
 quantity:Math.max(0,Math.floor(Number(tr.querySelector('[data-tmp="quantity"]')?.value||0))),
 validityDays:Math.max(0,Math.floor(Number(tr.querySelector('[data-tmp="validityDays"]')?.value||0))),
 activityStartDate:String(tr.querySelector('[data-tmp="activityStartDate"]')?.value||'').trim(),
 activityEndDate:String(tr.querySelector('[data-tmp="activityEndDate"]')?.value||'').trim(),
 activityContent:String(tr.querySelector('[data-tmp="activityContent"]')?.value||'').trim(),
 imageUrl:String(tr.querySelector('[data-tmp="imageUrl"]')?.value||'').trim(),
 active:!!tr.querySelector('[data-tmp="active"]')?.checked,
 note:String(tr.querySelector('[data-tmp="note"]')?.value||'').trim()
})).filter(x=>x.code||x.name)}
function bindTmAnybuyImageUploads(){
 document.querySelectorAll('[data-tmp-image-file]').forEach(input=>{
  if(input.dataset.boundTmAnybuyImage==='1')return;
  input.dataset.boundTmAnybuyImage='1';
  input.addEventListener('change',()=>{
   const file=input.files?.[0]||null;if(!file)return;
   if(!String(file.type||'').startsWith('image/')&&!/\.(jpg|jpeg|png|webp)$/i.test(file.name||''))return alert('請選擇 JPG、PNG 或 WebP 圖片');
   if(Number(file.size||0)>3*1024*1024)return alert('圖片檔案請勿超過 3MB');
   const r=new FileReader();
   r.onload=()=>{
    const tr=input.closest('[data-tm-anybuy-row]');if(!tr)return;
    const hidden=tr.querySelector('[data-tmp="imageUrl"]');
    const id=tr.dataset.tmAnybuyRow||'';
    const preview=tr.querySelector(`[data-tmp-image-preview="${CSS.escape(String(id))}"]`)||tr.querySelector('.app-anybuy-image-preview');
    const status=tr.querySelector(`[data-tmp-image-status="${CSS.escape(String(id))}"]`)||tr.querySelector('[data-tmp-image-status]');
    const dataUrl=String(r.result||'');
    if(hidden)hidden.value=dataUrl;
    if(preview)preview.innerHTML=`<img src="${dataUrl}" alt="商品圖片">`;
    if(status)status.textContent=`已選擇：${file.name||'圖片'}；按「儲存 TM 隨買活動」後同步。`;
   };
   r.onerror=()=>alert('圖片讀取失敗，請重新選擇');
   r.readAsDataURL(file);
  });
 });
}
function tmAnybuySettingsPage(){
 if(!isHeadOffice())return `<div class="page-head"><h2>TM 隨買跨店取活動設定</h2></div><div class="panel"><p>此功能僅在總部 SC 顯示。</p></div>`;
 if(!canAccessHqAppSettings())return `<div class="page-head"><h2>TM 隨買跨店取活動設定</h2></div><div class="panel"><p>需要「App設定」權限。</p></div>`;
 return `<div class="hq-app-settings-page">
  <div class="page-head"><div><h2>TM 隨買跨店取活動設定</h2><small>總部 SC 專用｜TM 現場寄杯活動主檔，與 App 活動完全分開</small></div><div class="toolbar"><button class="button" data-action="tm-anybuy-cloud-refresh">↻ 雲端同步</button><button class="button" data-nav="member-point-settings">← 返回</button></div></div>
  <div class="notice"><b>活動來源：</b>這裡只管理 TM 現場結帳寄杯活動；App 隨買跨店取活動仍由「App設定」管理，兩邊不互相混用。</div>
  <section class="panel app-settings-section"><div class="page-head"><div><h3>🛍️ TM 隨買跨店取活動</h3><small>欄位與 App 隨買商品設定一致｜支援「原價＋售價」、「組數＋數量」及「限購組數」；0 表示不限購｜新增、修改、刪除後同步至所有 TM</small></div><div class="toolbar"><button class="button" data-action="tm-anybuy-add">＋ 新增隨買商品</button><button class="primary" data-action="tm-anybuy-save">儲存 TM 隨買活動</button></div></div>${tmAnybuyProductTable()}</section>
 </div>`;
}

const APP_SETTINGS_PERMISSION_KEY='appSettingsAccess';

function canAccessHqAppSettings(u=currentUser()){
 if(!u||!isHeadOffice())return false;
 const role=String(u.role||u.employmentType||'').trim();
 if(role==='創辦人')return true;
 const special=role==='工程師'||role==='總部人員'||u.isEngineerPersonnel===true||u.isHeadOfficePersonnel===true;
 return special&&userPermissions(u)?.[APP_SETTINGS_PERMISSION_KEY]===true;
}
function defaultHqAppSettings(){
 return {
  tmPanel:{enabled:true,title:'TM 面板',welcome:'歡迎使用億家 TM',showMember:true,showNotices:true},
  selfPanel:{enabled:true,title:'自助結帳',welcome:'歡迎使用自助結帳',crossStoreRedeem:true,ecSend:true,ecPickup:true},
  appBackend:{
   enabled:true,maintenance:false,announcement:'',pointsSync:true,crossStoreRedeem:true,yijiaPayMonthlyCashTopupLimit:5000,
   prebuiltHidden:{yijiaPay:true,coupons:true,shop:true,orders:true,notifications:true,storeFinder:true,campaigns:true},
   featureManagement:[
    {code:'yijiaPay',name:'億家 Pay',hidden:true,note:'預做功能',sortOrder:10},
    {code:'coupons',name:'優惠券',hidden:true,note:'預做功能',sortOrder:20},
    {code:'shop',name:'億家小舖／商城',hidden:true,note:'預做功能',sortOrder:30},
    {code:'orders',name:'我的訂單',hidden:true,note:'預做功能',sortOrder:40},
    {code:'notifications',name:'通知中心',hidden:true,note:'預做功能',sortOrder:50},
    {code:'storeFinder',name:'找門市',hidden:true,note:'預做功能',sortOrder:60},
    {code:'campaigns',name:'活動專區／更多活動',hidden:true,note:'預做功能',sortOrder:70}
   ]
  },
  updatedAt:'',updatedBy:''
 };
}
function hqAppSettings(){
 const raw=load(HQ_APP_SETTINGS_KEY,null),base=defaultHqAppSettings();
 if(!raw||typeof raw!=='object')return base;
 return {
  ...base,...raw,
  tmPanel:{...base.tmPanel,...(raw.tmPanel||{})},
  selfPanel:{...base.selfPanel,...(raw.selfPanel||{}),ecPickup:(raw.selfPanel?.ecPickup ?? raw.selfPanel?.pickup ?? base.selfPanel.ecPickup)},
  appBackend:{
   ...base.appBackend,...(raw.appBackend||{}),
   prebuiltHidden:{...base.appBackend.prebuiltHidden,...(raw.appBackend?.prebuiltHidden||{})},
   featureManagement:(()=>{
    const list=Array.isArray(raw.appBackend?.featureManagement)?raw.appBackend.featureManagement:[];
    const legacy={...base.appBackend.prebuiltHidden,...(raw.appBackend?.prebuiltHidden||{})};
    const defaults=base.appBackend.featureManagement||[];
    const merged=[...defaults.map(x=>({...x,hidden:legacy[x.code] ?? x.hidden})),...list];
    const byCode=new Map();
    merged.forEach((x,i)=>{const code=String(x?.code||'').trim();if(!code)return;byCode.set(code,{code,name:String(x.name||code),hidden:x.hidden===true,note:String(x.note||''),sortOrder:Number.isFinite(Number(x.sortOrder))?Number(x.sortOrder):(i+1)*10})});
    return [...byCode.values()].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'zh-Hant'));
   })()
  }
 };
}
async function saveHqAppSettings(next){
 const value={...next,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
 save(HQ_APP_SETTINGS_KEY,value);
 if(cloudConfigured())try{await cloudPushKey(HQ_APP_SETTINGS_KEY,value)}catch(e){console.warn('App設定雲端同步失敗',e)}
 saveAudit('App設定',`TM面板／自助模式面板／App後台設定已更新｜億家Pay當月現金儲值額度 ${Number(value.appBackend?.yijiaPayMonthlyCashTopupLimit??5000)} 元`);
 return value;
}
function hqAppSettingsPage(){
 if(!isHeadOffice())return `<div class="page-head"><h2>App設定</h2></div><div class="panel"><p>此功能僅在總部 SC 顯示。</p></div>`;
 if(!canAccessHqAppSettings())return `<div class="page-head"><h2>App設定</h2></div><div class="panel"><p>需要「App設定」權限。創辦人預設可使用；工程師／總部人員需由創辦人開啟。</p></div>`;
 const x=hqAppSettings();
 return `<div class="hq-app-settings-page">
  <div class="page-head">
   <div><h2>App設定</h2><small>總部 SC 專用｜管理 TM 面板、自助模式面板與 App 後台</small></div>
   <div class="toolbar"><button class="button" data-action="app-settings-cloud-refresh">↻ 雲端同步</button><button class="button" data-nav="member-point-settings">← 返回會員累點／折抵設定</button></div>
  </div>
  <div class="notice"><b>權限：</b>創辦人預設可操作；工程師、總部人員需由創辦人在各自權限頁開啟「App設定」。一般門市 SC 不顯示此頁。</div>

  <section class="panel app-settings-section">
   <div class="page-head"><div><h3>🖥️ TM 面板設定</h3><small>管理 TM 面板的顯示與基本功能開關</small></div></div>
   <div class="settings-grid">
    <label>面板名稱<input id="appTmTitle" value="${esc(x.tmPanel.title||'TM 面板')}"></label>
    <label>歡迎文字<input id="appTmWelcome" value="${esc(x.tmPanel.welcome||'')}"></label>
    <label class="check-field"><input id="appTmEnabled" type="checkbox" ${x.tmPanel.enabled!==false?'checked':''}>啟用 TM 面板</label>
    <label class="check-field"><input id="appTmMember" type="checkbox" ${x.tmPanel.showMember!==false?'checked':''}>顯示會員功能</label>
    <label class="check-field"><input id="appTmNotices" type="checkbox" ${x.tmPanel.showNotices!==false?'checked':''}>顯示通報／提醒</label>
   </div>
  </section>

  <section class="panel app-settings-section">
   <div class="page-head"><div><h3>🧍 自助模式面板設定</h3><small>管理自助模式主畫面與服務入口</small></div></div>
   <div class="settings-grid">
    <label>面板名稱<input id="appSelfTitle" value="${esc(x.selfPanel.title||'自助結帳')}"></label>
    <label>歡迎文字<input id="appSelfWelcome" value="${esc(x.selfPanel.welcome||'')}"></label>
    <label class="check-field"><input id="appSelfEnabled" type="checkbox" ${x.selfPanel.enabled!==false?'checked':''}>啟用自助模式面板</label>
    <label class="check-field"><input id="appSelfCrossStore" type="checkbox" ${x.selfPanel.crossStoreRedeem!==false?'checked':''}>顯示跨店取／兌換</label>
    <label class="check-field"><input id="appSelfEcSend" type="checkbox" ${x.selfPanel.ecSend!==false?'checked':''}>顯示 EC 寄件</label>
    <label class="check-field"><input id="appSelfEcPickup" type="checkbox" ${x.selfPanel.ecPickup!==false?'checked':''}>顯示 EC 取貨</label>
   </div>
  </section>

  <section class="panel app-settings-section">
   <div class="page-head"><div><h3>📱 App 後台設定</h3><small>App 本體由另一端開發；此處保留總部後台控制與同步設定</small></div></div>
   <div class="settings-grid">
    <label class="check-field"><input id="appBackendEnabled" type="checkbox" ${x.appBackend.enabled!==false?'checked':''}>啟用 App 服務</label>
    <label class="check-field"><input id="appBackendMaintenance" type="checkbox" ${x.appBackend.maintenance===true?'checked':''}>維護模式</label>
    <label class="check-field"><input id="appBackendPoints" type="checkbox" ${x.appBackend.pointsSync!==false?'checked':''}>會員點數同步</label>
    <label class="check-field"><input id="appBackendRedeem" type="checkbox" ${x.appBackend.crossStoreRedeem!==false?'checked':''}>跨店取／兌換功能</label>
    <label>億家Pay｜當月現金儲值額度（元）
     <input id="appBackendYijiaPayCashLimit" type="number" min="0" step="100" value="${Number(x.appBackend.yijiaPayMonthlyCashTopupLimit??5000)}">
     <small>每位會員每月可使用「現金」儲值至億家Pay的最高累計金額。</small>
    </label>
    <label class="wide">App 公告<textarea id="appBackendAnnouncement" rows="4" placeholder="顯示於 App 的公告內容">${esc(x.appBackend.announcement||'')}</textarea></label>
   </div>
  </section>

  ${yijiaPayScSection()}

  <section class="panel app-settings-section">
   <div class="page-head">
    <div><h3>🧩 App 功能管理</h3><small>可新增、修改、刪除 App 功能控制項；之後新增功能不必再修改 SC 的隱藏設定程式。</small></div>
    <div class="toolbar"><button class="button" data-action="app-feature-add">＋ 新增功能</button></div>
   </div>
   <div class="notice"><b>使用方式：</b>功能代碼是 App 端辨識用的固定 key；勾選「隱藏」後，App 會依代碼隱藏對應入口。未來新功能只要建立一個新的功能代碼，SC 這個管理頁不必再加新欄位。</div>
   <div style="overflow:auto">
    <table class="data-table">
     <thead><tr><th>功能代碼</th><th>功能名稱</th><th>隱藏</th><th>排序</th><th>備註</th><th>操作</th></tr></thead>
     <tbody id="appFeatureRows">${(x.appBackend.featureManagement||[]).map(f=>`<tr data-app-feature-row>
      <td><input data-app-feature="code" value="${esc(f.code||'')}" placeholder="例如 memberTasks"></td>
      <td><input data-app-feature="name" value="${esc(f.name||'')}" placeholder="功能名稱"></td>
      <td style="text-align:center"><input data-app-feature="hidden" type="checkbox" ${f.hidden===true?'checked':''}></td>
      <td><input data-app-feature="sortOrder" type="number" step="10" value="${Number(f.sortOrder||0)}" style="width:90px"></td>
      <td><input data-app-feature="note" value="${esc(f.note||'')}" placeholder="預做／測試／正式…"></td>
      <td><button class="button danger" data-action="app-feature-delete">刪除</button></td>
     </tr>`).join('')}</tbody>
    </table>
   </div>
   <div class="notice" style="margin-top:12px"><b>相容舊設定：</b>原本的「預做功能隱藏設定」已自動轉入這份清單。會員條碼、點數、隨買跨店取、我的商品等正式功能若沒有列入清單，就維持正常顯示。</div>
  </section>

  <section class="panel app-settings-section"><div class="page-head"><div><h3>🛍️ 隨買商品設定</h3><small>App 隨買跨店取商品主檔｜支援「原價＋售價」、「組數＋數量」及「限購組數」；0 表示不限購｜新增、修改、刪除後同步</small></div><div class="toolbar"><button class="button" data-action="app-anybuy-add">＋ 新增隨買商品</button><button class="primary" data-action="app-anybuy-save">儲存隨買商品</button></div></div>${appAnybuyProductTable()}</section>

  <section class="panel app-settings-section"><div class="page-head"><div><h3>🎟️ 優惠券設定</h3><small>App 優惠券主檔｜新增、修改、刪除後同步</small></div><div class="toolbar"><button class="button" data-action="app-coupon-add">＋ 新增優惠券</button><button class="primary" data-action="app-coupon-save">儲存優惠券</button></div></div>${appCouponTable()}</section>

  <div class="toolbar" style="justify-content:flex-end;margin-top:14px"><button class="primary" data-action="save-hq-app-settings">儲存 App 設定</button></div>
 </div>`;
}
function canManageTmScreenCategories(){
 const u=currentUser();
 if(!u||!isHeadOffice())return false;
 const role=String(u.role||u.employmentType||'').trim();
 return role==='創辦人'||role==='總部人員'||role==='工程師'||u.isHeadOfficePersonnel===true||u.isEngineerPersonnel===true;
}
function canManageSelfCheckoutAccount(){const u=currentUser();return isHeadOffice()&&!!u&&(String(u.role||'')==='創辦人'||u.isEngineerPersonnel===true||String(u.role||'')==='工程師')}
function selfCheckoutAccountConfig(){const x=load(SELF_CHECKOUT_ACCOUNT_KEY,null);return x&&String(x.account||'99999')==='99999'?x:{account:'99999',name:'自助結帳',enabled:true}}
function openSelfCheckoutAccountSettings(){if(!canManageSelfCheckoutAccount())return alert('99999 自助結帳帳號只有總部創辦人或工程師可以設定');const x=selfCheckoutAccountConfig();dlg('自助結帳帳號 99999',`<div class="panel"><p><b>99999 是所有門市共用的自助結帳專用結帳人員帳號。</b><br>一般門市 SC 不顯示此帳號資料；只有總部創辦人／工程師可以設定。</p><label>帳號<input value="99999" readonly></label><label>顯示名稱<input id="selfAccountName" value="${esc(x.name||'自助結帳')}"></label><label>密碼<input id="selfAccountPassword" type="password" value="${esc(x.password||'')}" autocomplete="new-password"></label><label><input id="selfAccountEnabled" type="checkbox" ${x.enabled!==false?'checked':''}> 啟用所有門市自助結帳</label><button class="primary" id="selfAccountSave">儲存並同步所有門市</button></div>`);setTimeout(()=>document.querySelector('#selfAccountSave')?.addEventListener('click',async()=>{const name=document.querySelector('#selfAccountName')?.value.trim()||'自助結帳',password=document.querySelector('#selfAccountPassword')?.value||'';if(password.length<4)return alert('99999 密碼至少 4 碼');const cfg={id:'SELF-99999',account:'99999',name,password,enabled:!!document.querySelector('#selfAccountEnabled')?.checked,role:'自助結帳',systemAccount:true,crossStore:true,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};save(SELF_CHECKOUT_ACCOUNT_KEY,cfg);if(cloudConfigured()){const ok=await cloudPushKey(SELF_CHECKOUT_ACCOUNT_KEY,cfg);if(!ok)return alert('資料已保留本機，但同步到所有門市失敗，請檢查雲端連線')}saveAudit('設定自助結帳帳號','99999｜全門市同步');genericDialog.close();alert('99999 自助結帳帳號已同步所有門市 TM')}),0)}


function migrateIndependentEobCredentials(){
 const rows=load(K.employees,[]);
 if(!Array.isArray(rows)||!rows.length)return;
 let changed=false;
 for(const u of rows){
  if(!Object.prototype.hasOwnProperty.call(u,'eobAccount')){u.eobAccount=String(u.account||'').trim().toLowerCase();changed=true}
  if(!Object.prototype.hasOwnProperty.call(u,'eobPassword')){u.eobPassword=String(u.password||'');changed=true}
  if(!Object.prototype.hasOwnProperty.call(u,'eobEmail')){u.eobEmail=String(u.email||'').trim().toLowerCase();changed=true}
  if(!Object.prototype.hasOwnProperty.call(u,'eobLoginEnabled')){u.eobLoginEnabled=u.loginEnabled!==false&&u.active!==false;changed=true}
 }
 if(changed)save(K.employees,rows);
}
migrateIndependentEobCredentials();

function migrateProductBarcodesToNumeric(){
 const rows=load(K.products,[]);
 if(!Array.isArray(rows)||!rows.length)return;
 const used=new Set();
 let changed=false;
 const nextUnique=()=>{let code=numericProductBarcode();while(used.has(code))code=numericProductBarcode();used.add(code);return code};
 for(const p of rows){
  const current=Array.isArray(p.barcodes)&&p.barcodes.length?p.barcodes:[p.barcode].filter(Boolean);
  const normalized=[];
  for(const raw of current){
   const v=String(raw||'').trim();
   let n=/^\d+$/.test(v)?v:nextUnique();
   if(used.has(n)&&!normalized.includes(n)) n=nextUnique();
   else used.add(n);
   if(!normalized.includes(n))normalized.push(n);
   if(v!==n)changed=true;
  }
  if(!normalized.length){normalized.push(nextUnique());changed=true}
  if(String(p.barcode||'')!==normalized[0])changed=true;
  p.barcode=normalized[0];p.barcodes=normalized;
 }
 if(changed){save(K.products,rows);try{saveAudit('商品條碼轉換','非數字商品條碼已轉為純數字')}catch{}}
}
migrateProductBarcodesToNumeric();

async function stocktakePasswordHash(value){
 try{
  const bytes=new TextEncoder().encode(String(value||''));
  const buf=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
 }catch{return ''}
}
async function syncStocktakePersonnelRegistry(){
 if(!cloudConfigured()||!isHeadOffice())return false;
 try{
  const rows=stocktakePersonnelEmployees(),all=permissionStore();
  const registry=[];
  for(const u of rows){
   registry.push({
    id:String(u.id||''),name:String(u.name||'盤點人員'),account:eobAccountOf(u),employeeCode:String(u.employeeCode||u.employeeNo||u.account||''),
    password_hash:await stocktakePasswordHash(eobPasswordOf(u)),active:u.active!==false&&u.loginEnabled!==false,
    role:'盤點人員',cross_store:true,
    permissions:{
     eobStocktake:!!all?.[u.id]?.eobStocktake,
     eobStocktakePersonnel:!!all?.[u.id]?.eobStocktakePersonnel,
     stocktakeUploadHeadOffice:!!all?.[u.id]?.stocktakeUploadHeadOffice
    },updated_at:new Date().toISOString()
   });
  }
  localStorage.setItem('yj_stocktake_personnel_auth',JSON.stringify(registry));
  await cloudPushKey('yj_stocktake_personnel_auth',registry);
  return true;
 }catch(err){console.warn('盤點人員 EOB 登入名冊同步失敗',err);return false}
}
setTimeout(()=>{if(isHeadOffice()&&cloudConfigured())syncStocktakePersonnelRegistry()},1500);
function eobAccountOf(u){return String(u?.eobAccount||'').trim().toLowerCase()}
function eobPasswordOf(u){return String(u?.eobPassword||'')}
function eobEmailOf(u){return String(u?.eobEmail||'').trim().toLowerCase()}

// Alpha 4.58: EOB盤點返回鍵；盤點資料上傳總部正式接通；保留 4.57 authenticated RPC 與 timeout/finally。
// Alpha 4.54: SC 登入與 EOB 管理授權真正分離。EOB 權限/員工自動同步改用獨立保存的 founder Supabase session，不再依賴目前 SC 登入帳號密碼。
// Alpha 4.53: 修正 iPhone／iPad 數字鍵輸入偶發一次按鍵卻重複輸入 3～4 次；只攔截極短時間內同欄位、同數字的重複 beforeinput，不影響正常連按或貼上。
// Alpha 4.52: 修正創辦人第一次 EOB bootstrap／換綁仍先查 alias 的死循環；創辦人本人改以 EOB Email 直接驗證 Supabase Auth。
// SC/EOB 帳密仍互相獨立；目前 EOB 管理密碼只用於此次 Supabase Auth 驗證，不寫入員工資料。
// 不再用 SC account/password 當 EOB fallback；只有明確設定 EOB 帳號時才同步 EOB。
// 兩邊可由使用者自行設成一樣，但改其中一邊不會自動改另一邊。
async function syncStocktakePersonnelCloudAccount(u,newEobPassword='',opts={}){
 if(!cloudConfigured()||!isHeadOffice()||!isFounder()||!u)return false;
 const operator=employees().find(x=>String(x.id)===String(currentUser()?.id));
 const callerAccount=String(opts?.callerAccount||eobAccountOf(operator)).trim().toLowerCase();
 const callerPassword=String(opts?.callerPassword||eobPasswordOf(operator));
 const callerEmail=String(opts?.callerEmail||eobEmailOf(operator)).trim().toLowerCase();
 const p=userPermissions(u),username=eobAccountOf(u);
 if(!username)throw new Error('此員工尚未設定 EOB 登入帳號');
 try{
  await syncEmployeeCloudAccount(u,newEobPassword,opts);
  await adminSyncStocktakeAccess({callerAccount,callerEmail,callerPassword,username,canStocktake:!!p.eobStocktake,canPersonnel:!!p.eobStocktakePersonnel,canUploadHq:!!p.stocktakeUploadHeadOffice});
  return true;
 }catch(err){console.warn('盤點人員 EOB 權限同步失敗',err);throw err}
}

async function syncEmployeeCloudAccount(u,newEobPassword='',opts={}){
 if(!cloudConfigured()||!isFounder()||!u)return false;
 const operator=employees().find(x=>String(x.id)===String(currentUser()?.id));
 const callerAccount=String(opts?.callerAccount||eobAccountOf(operator)).trim().toLowerCase();
 const callerPassword=String(opts?.callerPassword||eobPasswordOf(operator));
 const callerEmail=String(opts?.callerEmail||eobEmailOf(operator)).trim().toLowerCase();
 const perms=userPermissions(u),founder=String(u.role||'')==='創辦人';
 const employmentOff=['離職','離店','停用'].includes(String(u.employmentStatus||''))||u.active===false;
 const eobEnabled=(u.eobLoginEnabled!==false)&&!employmentOff&&(founder||u.isEngineerPersonnel===true||String(u.role||'')==='工程師'||!!perms.eobReceiving||!!perms.eobStocktake||u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員');
 const username=eobAccountOf(u);
 if(!username)throw new Error('請先設定 EOB 登入帳號');
 const payload={
  ...u,
  account:username,
  previousUsername:String(opts?.previousEobAccount||u.eobPreviousAccount||'').trim().toLowerCase(),
  email:eobEmailOf(u),
  authEmail:eobEmailOf(u),
  employeeCode:String(u.employeeCode||u.employeeNo||u.account||''),
  loginEnabled:u.eobLoginEnabled!==false&&!employmentOff,
  eobEnabled,
  eobOrder:eobEnabled&&(founder||!!perms.eobOrder),
  eobReturn:eobEnabled&&(founder||!!perms.eobReturn)
 };
 return await adminSyncStaffAccount({callerAccount,callerEmail,callerPassword,employee:payload,newPassword:String(newEobPassword||'')});
}


const PERMISSION_CATEGORIES={
 general:{label:'一般權限',icon:'✅',items:{
  eobReceiving:'EOB 驗收',eobOrder:'EOB 訂購',eobReturn:'EOB 非 EC 退貨',scStocktake:'SC 盤點',mobilePosAccess:'行動 POS',patrolReceiving:'巡迴進貨',patrolReturn:'巡迴退貨',newspaperReceiving:'巡迴報紙驗收'
 }},
 stocktake:{label:'盤點',icon:'📋',items:{
  eobStocktake:'EOB 盤點',eobStocktakePersonnel:'盤點人員專用',stocktakeUploadHeadOffice:'盤點資料上傳總部'
 }},
 pos:{label:'POS／前台',icon:'🧾',items:{
  posAccess:'進入 POS',posCheckout:'結帳',posDiscount:'折扣',posManualPrice:'手動改價',
  posCancel:'取消交易',manualClose:'手動日結',attendanceClock:'打卡',
  productLookup:'商品查詢',memberLookup:'會員查詢',transactionPrint:'列印交易',
  wasteCreate:'廢棄登錄',timeLookup:'時控查詢',deposit:'投庫',handover:'交班',
  logisticsSign:'物流簽到',transferInPos:'轉貨單轉入'
 }},
 products:{label:'商品管理',icon:'📦',items:{
  productsAccess:'進入商品管理',productCreate:'新增商品',productEdit:'修改商品',
  productDelete:'刪除商品',productGroup:'品群分類',productPrice:'修改售價',
  productCost:'修改成本',productBarcode:'條碼管理',productPrint:'商品列印',
  productMultipleEdit:'商品倍數設定',
  promotionsAccess:'總部商品活動設定',promotionsManage:'總部商品活動修改／刪除'
 }},
 inventory:{label:'庫存設定',icon:'📊',items:{
  inventoryOrderLimitEdit:'最大／最小訂購數設定'
 }},
 quality:{label:'品保／時控',icon:'🏷️',items:{
  qualityAccess:'進入品保／時控',qualityWasteCreate:'廢棄登錄',productShelfReturn:'下架商品退貨',
  qualityOperate:'操作（修改／廢棄）',qualityDelete:'刪除',
  timeCreate:'新增時控商品',timeEdit:'修改時控',
  timeDelete:'刪除時控',timePrint:'列印時控貼紙',wasteQuery:'廢棄查詢／修改'
 }},
 ordering:{label:'訂購管理',icon:'🛒',items:{
  orderingAccess:'進入訂購管理',orderLedger:'台帳訂購',orderFos:'FOS 鮮食訂購',
  orderSupplies:'用度品訂購',orderSpecial:'特殊品訂購',orderGroup:'品群訂購',
  orderPrint:'訂購列印',orderDelete:'刪除訂購單',orderClearAccess:'訂購資料清除',orderFacePrint:'FACE卡列印',
  orderMultipleUse:'使用訂購倍數',orderAutoAI:'系統自動訂購／AI輔助',freshAIOrder:'鮮食 AI 輔助訂購'
 }},
 ec:{label:'EC 管理',icon:'📮',items:{
  ecAccess:'進入 EC 管理',ecCreate:'新增包裹',ecPrint:'列印標籤',
  ecAbnormal:'異常查詢',ecCancel:'取消寄件'
 }},
 logistics:{label:'物流管理',icon:'🚚',items:{
  logisticsAccess:'進入物流管理',logisticsQuery:'預定到店查詢',
  logisticsEdit:'表定到店時間設定',logisticsCreate:'建立物流批次',logisticsDelete:'刪除貨單'
 }},
 transfers:{label:'轉貨管理',icon:'🔄',items:{
  transfersAccess:'進入轉貨管理',transferOut:'轉貨轉出',
  transferIn:'轉貨轉入',transferPrint:'轉貨單列印'
 }},
 stores:{label:'門市管理',icon:'🏪',items:{
  storesAccess:'進入門市管理',storeAdd:'新增門市',
  storeEdit:'修改門市',storeDelete:'刪除門市',storeSwitch:'切換門市',crossStoreView:'跨店查看',crossStoreManage:'跨店修改／刪除',promotionsAccess:'總部商品活動設定',promotionsManage:'總部商品活動修改／刪除',
  crossStoreView:'跨店查看指定後台資料',crossStoreManage:'跨店修改／刪除指定後台資料',
  storeCode:'轉換店號',storeQuery:'查詢其他門市'
 }},
 employees:{label:'人員基本資料',icon:'👤',items:{
  employeesAccess:'進入人員基本資料',employeeCreate:'新增員工',
  employeeManage:'員工設定（修改／帳密／停用）',
  employeeHistoryBlacklistQuery:'前一間離職店／黑名單查詢',employeeBadgePrint:'名牌列印'
 }},
 members:{label:'會員管理',icon:'👥',items:{
  memberEdit:'修改會員',memberDelete:'刪除會員',
  memberPointSettings:'會員累點／折抵設定',
  memberBonusCampaignSettings:'會員贈點活動設定'
 }},
 system:{label:'系統管理',icon:'⚙️',items:{
  permissionsAccess:'進入權限管理',permissionEdit:'修改下級權限',
  revenueAccess:'營收管理',revenueCorrect:'營收修正',zCreate:'產生 Z 帳',
  reportPrint:'列印報表',systemSettingsAccess:'設定',cloudRemoteSync:'☁️ Supabase 遠端同步',systemVersion:'系統版本',transactionBackAccess:'後台交易查詢',transactionBackCorrect:'後台交易更正／退貨',transactionBackVoid:'後台交易作廢',auditAccess:'業務紀錄',
  attendanceAccess:'出勤管理',attendanceEdit:'工時修改',attendanceDelete:'刪除出勤紀錄',
  attendancePrint:'出勤列印'
 }}
};

function allPermissionKeys(){
 const base=Object.values(PERMISSION_CATEGORIES).flatMap(c=>Object.keys(c.items));
 const dynamic=[];try{for(const l1 of Object.values(SC_PERMISSION_DIRECTORY||{}))for(const l2 of Object.values(l1.children||{}))for(const row of (l2.items||[]))dynamic.push(row[2]);}catch{}
 return [...new Set([...base,...dynamic])];
}

function roleTemplate(role){
 const all=allPermissionKeys();
 if(role==='創辦人')return Object.fromEntries(all.map(k=>[k,true]));
 const sets={
  店長:all.filter(k=>!['permissionEdit','crossStoreView','crossStoreManage','promotionsAccess','promotionsManage','eobReceiving','eobOrder','eobReturn','eobStocktake','eobStocktakePersonnel','mobilePosAccess','patrolReceiving','patrolReturn','newspaperReceiving'].includes(k)),
  副店長:all.filter(k=>!['permissionEdit','storeAdd','storeCode','crossStoreView','crossStoreManage','promotionsAccess','promotionsManage','eobReceiving','eobOrder','eobReturn','eobStocktake','eobStocktakePersonnel','mobilePosAccess','patrolReceiving','patrolReturn','newspaperReceiving'].includes(k)),
  正職:['posAccess','posCheckout','attendanceClock','productLookup','memberLookup',
      'transactionPrint','wasteCreate','timeLookup','deposit','handover','logisticsSign',
      'qualityAccess','orderingAccess','orderLedger','orderFos',
      'orderSupplies','orderSpecial','orderGroup'],
  兼職:['posAccess','posCheckout','attendanceClock','productLookup','memberLookup',
      'transactionPrint','wasteCreate','timeLookup','logisticsSign'],
  總部支援:[]
 };
 return Object.fromEntries(all.map(k=>[k,(sets[role]||[]).includes(k)]));
}

function permissionStore(){return load(K.permissions,{})}
function isFounder(){return currentUser()?.role==='創辦人'}

function userPermissions(user){
 if(!user)return {};
 const store=permissionStore();
 return {...roleTemplate(user.role),...(store[user.id]||{})};
}

function isFounderSelf(actor,target){
 return !!actor&&!!target&&actor.role==='創辦人'&&target.role==='創辦人'&&String(actor.id)===String(target.id);
}
function canManageTarget(actor,target){
 if(!actor||!target)return false;
 if(isFounderSelf(actor,target))return true;
 if(String(actor.id)===String(target.id))return false;
 if(!canManageCurrentStoreAcross())return false;
 // 只有創辦人本人能修改自己的資料／權限；其他人永遠不能修改創辦人。
 if(target.role==='創辦人')return false;
 if(actor.role==='創辦人')return true;
 if(actor.role==='總部支援')return false;
 if(target.role==='總部支援')return false;
 return (ROLE_RANK[actor.role]||0)>(ROLE_RANK[target.role]||0);
}
function canEditEmployeeTarget(actor,target){
 return canManageTarget(actor,target);
}
function founderImmutable(target){
 return target?.role==='創辦人'&&!isFounderSelf(currentUser(),target);
}

function canGrantPermission(actor,key){
 if(!actor)return false;
 if(['eobStocktake','eobStocktakePersonnel'].includes(key)&&!isHeadOffice())return false;
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
function isHeadOffice(){return String(currentStoreCode())==='001'}
const PRODUCT_MANAGEMENT_2_KEYS=new Set(['productsAccess','productCreate','productEdit','productDelete','productGroup','productPrice','productCost','productBarcode','productPrint','productMultipleEdit']);
function productManagement2Allowed(user=currentUser()){
 if(!user)return false;
 const role=String(user.role||user.employmentType||'').trim();
 return role==='創辦人'||role==='管理員'||role==='總部人員'||role==='工程師'||user.isHeadOfficePersonnel===true||user.isEngineerPersonnel===true;
}
function canEditGlobalProductMaster(user=currentUser()){
 return isHeadOffice()&&productManagement2Allowed(user);
}
function stocktakePersonnelEmployees(){return employees().filter(x=>x&&(x.isStocktakePersonnel===true||String(x.role||'')==='盤點人員'||String(x.employmentType||'')==='盤點人員'))}
function engineerPersonnelEmployees(){return employees().filter(x=>x&&(x.isEngineerPersonnel===true||String(x.role||'')==='工程師'||String(x.employmentType||'')==='工程師'))}
function headOfficePersonnelEmployees(){return employees().filter(x=>x&&(x.isHeadOfficePersonnel===true||String(x.role||'')==='總部人員'||String(x.employmentType||'')==='總部人員'))}
function isSpecialHqPersonnel(x){return !!(x&&(x.isStocktakePersonnel===true||x.isEngineerPersonnel===true||x.isHeadOfficePersonnel===true||['盤點人員','工程師','總部人員'].includes(String(x.role||''))||['盤點人員','工程師','總部人員'].includes(String(x.employmentType||''))))}
function storeEmployees(code=currentStoreCode()){
 return employees().filter(x=>!isSpecialHqPersonnel(x)&&(x.role==='創辦人'||String(x.storeCode||'001')===String(code)));
}
function permissionTargetEmployees(){return storeEmployees()}
function stocktakePermissionTargetEmployees(){return isHeadOffice()?stocktakePersonnelEmployees():[]}
function specialPersonnelEmployees(kind){return kind==='engineer'?engineerPersonnelEmployees():headOfficePersonnelEmployees()}
function homeStoreCode(){return String(currentUser()?.storeCode||'001').trim()||'001'}
function isCrossStoreContext(){return !isFounder()&&currentStoreCode()!==homeStoreCode()}
function canViewCurrentStoreAcross(){return !isCrossStoreContext()||hasPermission('crossStoreView')}
function canManageCurrentStoreAcross(){return !isCrossStoreContext()||hasPermission('crossStoreManage')}
function requireCrossStoreManage(){if(canManageCurrentStoreAcross())return true;alert('目前為其他門市，需要「跨店修改／刪除」權限');return false}
function recordStoreCode(row){
 if(row?.storeCode)return String(row.storeCode);
 const account=String(row?.userAccount||row?.cashierAccount||'').trim(),name=String(row?.user||row?.cashier||'').trim();
 const e=employees().find(x=>(account&&String(x.account||'')===account)||(name&&String(x.name||'')===name));
 return String(e?.storeCode||'001');
}
function scopedRows(key){return load(key,[]).filter(x=>recordStoreCode(x)===currentStoreCode())}

let pendingLoginMode='back';

function availableLoginPeople(){
 const seen=new Set();
 return [...storeEmployees(),...stocktakePersonnelEmployees(),...engineerPersonnelEmployees(),...headOfficePersonnelEmployees()].filter(x=>x.active!==false&&x.loginEnabled!==false&&x.account&&!seen.has(String(x.id))&&seen.add(String(x.id)));
}

function fillLoginPeople(){
 const people=availableLoginPeople();
 const select=document.querySelector('#loginPerson');
 const account=document.querySelector('#loginAccount');
 const password=document.querySelector('#loginPassword');
 if(!select||!account)return;

 // 每次開啟登入頁都保持空白，不記住上一位使用者。
 select.innerHTML=`<option value="">— 請選擇帳號（也可直接手動輸入）—</option>`+
  people.map(x=>`<option value="${x.id}">${esc(x.name)}／${esc(x.role)}（${esc(x.account||'')}）</option>`).join('');
 select.value='';
 account.value='';
 if(password)password.value='';
}

function syncLoginAccount(){
 const select=document.querySelector('#loginPerson');
 const account=document.querySelector('#loginAccount');
 if(!select||!account)return;
 const selected=availableLoginPeople().filter(x=>!x.isStocktakePersonnel&&String(x.role||'')!=='盤點人員').find(x=>x.id===select.value);
 // 下拉選取時才帶入帳號；切回空白就清空，仍可自行手打帳號。
 account.value=selected?.account||'';
}

function showLogin(target='back'){
 pendingLoginMode=target;
 const title=document.querySelector('#loginTitle');
 const hint=document.querySelector('#loginHint');
 const password=document.querySelector('#loginPassword');

 if(title)title.textContent=target==='back'?'登入 SC 管理系統':'登入前台 TM';
 if(hint)hint.textContent=target==='back'
   ?'切換至 SC 前，請重新驗證登入帳號與密碼'
   :'請選擇登入帳號並輸入密碼';

 fillLoginPeople();
 const lp=document.querySelector('#loginPerson');if(lp)lp.onchange=syncLoginAccount;
 const account=document.querySelector('#loginAccount');
 if(lp)lp.value='';
 if(account)account.value='';
 if(password)password.value='';

 if(!loginDialog.open)loginDialog.showModal();
 setTimeout(()=>password?.focus(),30);
}
function hero(){const s=store(),u=currentUser(),t=clock();return`<section class="hero"><h2>🏪 ${esc(s.name)}</h2><div class="hero-grid"><div><small>店號</small><strong>${esc(s.code)}</strong></div><div><small>日期</small><strong>${t.date}</strong></div><div><small>時間</small><strong data-clock>${t.time}</strong></div><div><small>操作人員</small><strong>${esc(u.name)}</strong></div><div><small>角色</small><strong>${esc(u.role)}</strong></div></div></section>`}
function mode(m){document.body.dataset.mode='back';render('home')}
function requestMode(m){showLogin('back')}
function canOpenSystemSettings(){return true}

function refreshPermissionVisibility(){
 const u=currentUser();
 if(!u)return;

 // 側邊選單：沒有頁面權限就完全隱藏；總部商品活動僅創辦人可見。
 document.querySelectorAll('.nav-item').forEach(el=>{
  const page=String(el.dataset.nav||'');
  const visible=navPageVisible(page);
  el.hidden=!visible;
  el.style.display=visible?'':'none';
 });

 // 頁面內需開權限的選項：沒有權限直接不顯示。
 const actionPermissions={
  'new-employee':'employeeCreate',
  'switch-store':'storeSwitch',
  'employee-history-blacklist-query':'employeeHistoryBlacklistQuery',
  'save-point-settings':'memberPointSettings',
  'admin-logistics-create':'logisticsCreate',
  'logistics-schedule-edit':'logisticsEdit',
  'new-quality':'timeCreate',
  'new-waste':'qualityWasteCreate',
  'new-ec-cloud':'ecCreate',
  'new-ec':'ecCreate',
  'manage-groups':'productGroup',
  'product-multiple-settings':'productMultipleEdit',
  'new-product':'productCreate',
  'tm-hidden-products-settings':'productsAccess',
  'tm-screen-categories-settings':'productsAccess',
  'tm-quick-amount-settings':'productsAccess'
 };
 document.querySelectorAll('[data-action]').forEach(el=>{
  const perm=actionPermissions[el.dataset.action];
  if(perm&&!hasPermission(perm))el.hidden=true;
 });

 const dataPermissionSelectors=[
  ['[data-employee-settings]','employeeManage'],
  ['[data-edit-member]','memberEdit'],
  ['[data-delete-member]','memberDelete'],
  ['[data-edit-product]','productEdit'],
  ['[data-delete-product]','productDelete'],
  ['[data-store-edit]','storeEdit'],
  ['[data-store-delete]','storeDelete']
 ];
 dataPermissionSelectors.forEach(([sel,perm])=>{
  document.querySelectorAll(sel).forEach(el=>{if(!hasPermission(perm))el.hidden=true});
 });

 // 商品主檔為總部共用主檔：新增／修改／刪除與 TM 不顯示設定只有總店可操作。
 if(!canEditGlobalProductMaster()){
  document.querySelectorAll('[data-action="new-product"],[data-action="tm-hidden-products-settings"],[data-edit-product],[data-delete-product]').forEach(el=>el.hidden=true);
 }
 if(!canManageTmScreenCategories()){
  document.querySelectorAll('[data-action="tm-screen-categories-settings"],[data-action="tm-quick-amount-settings"]').forEach(el=>el.hidden=true);
 }

 // 只有創辦人可見。
 document.querySelectorAll('[data-action="linked-inventory-settings"]').forEach(el=>el.hidden=!isFounder());

 // 只有創辦人／管理員可新增鮮食批次。
 document.querySelectorAll('[data-action="new-fresh-batch"]').forEach(el=>{
  el.hidden=!['創辦人','管理員'].includes(currentUser()?.role);
 });

 // 舊版留下的 disabled 權限按鈕也不顯示。
 document.querySelectorAll('button[disabled][title*="權限"],button[disabled][title*="管理員"],button[disabled]').forEach(el=>{if(/權限|需開|無修改/.test(el.title||el.textContent||''))el.hidden=true});
}
function refreshProtectedNav(){
 renderAuthorizedNav();
 refreshPermissionVisibility();
}
function accountListPage(dailyMode=false){
 if(!hasPermission('revenueAccess'))return `<h2>權限不足</h2><div class="panel"><p>需要「營收管理」權限。</p></div>`;
 const r=load(K.revenue,[]),title=dailyMode?'帳表一覽（當日）':'帳表一覽';
 return `<div class="page-head"><div><h2>${title}</h2><small>營收業務｜帳表與營收作業入口</small></div></div>
 <div class="panel"><div class="page-head"><div><h3>營收管理</h3><small>營收收集、修正、送金與營收報表</small></div><button class="primary" data-nav="revenue">進入營收管理</button></div></div>
 <div class="panel table-wrap" style="margin-top:14px"><h3>${title}</h3><table class="table"><tr><th>日期</th><th>總營收</th><th>筆數</th><th>狀態</th><th>操作</th></tr>${r.map(x=>`<tr><td>${esc(x.date)}</td><td>${money(x.total)}</td><td>${Number(x.count||0)}</td><td>${esc(x.status||'')}</td><td><button class="button" data-nav="revenue">營收管理</button></td></tr>`).join('')||'<tr><td colspan="5">尚無帳表資料</td></tr>'}</table></div>`;
}
function render(p){if(!currentUser())return showLogin('back');p=String(p||'home');if(isStocktakeOperator()&&!stocktakeScPageAllowed(p))p='home';document.body.dataset.mode='back';window.__yjCurrentAdminPage=p;renderAuthorizedNav();document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.nav===(String(p).startsWith('ordering-')?'ordering':p)));refreshPermissionVisibility();
 try{
  app.innerHTML=back(p);
  bind(p);
  refreshPermissionVisibility();
 }catch(err){
  console.error('render',p,err);
  app.innerHTML=`<div class="panel render-error-panel"><h2>頁面載入失敗</h2><p>${esc(err?.message||String(err))}</p><button class="button" data-nav="home">返回首頁</button></div>`;
  return;
 }if(p==='logistics')setTimeout(()=>{refreshLogisticsCloud();refreshInventoryReceiptsCloud()},0);if(p==='home')setTimeout(()=>{refreshLogisticsSchedulesCloud();if(cloudConfigured())refreshNoticeCloud().catch(()=>{});},0);if(p==='ec')setTimeout(()=>refreshEcCloud(),0);if(p==='ordering')setTimeout(()=>{refreshInventoryReceiptsCloud()},0);if(p==='members'||p==='member-analysis')setTimeout(()=>refreshMembersCloud({rerender:true}),0);if(p==='transactions')setTimeout(()=>refreshTransactionOperationalCloud(),0);if(p==='notice')setTimeout(()=>refreshNoticeCloud(),0);if(p==='franchise-area')setTimeout(()=>refreshFranchiseCloud({rerender:true}),0);if(p==='tm-link')setTimeout(()=>refreshTmLinkPage(),0);if(scPrebuildMeta(p)?.label==='EOB盤點'&&cloudConfigured()&&!eobStocktakeCloudRows.length&&!eobStocktakeCloudLoading)setTimeout(()=>refreshEobStocktakeCloud({rerender:true}),0);if(scPrebuildMeta(p)?.label==='EC商品查詢'&&cloudConfigured()&&!ecServiceQueryRows.length&&!ecServiceQueryLoading)setTimeout(()=>refreshEcServiceQuery({rerender:true}),0);if(scPrebuildMeta(p)?.label==='收銀員操作異常分析'&&cloudConfigured()&&!cashierAnomalyCloudLoaded&&!cashierAnomalyCloudLoading)setTimeout(()=>refreshCashierAnomalyCloud({rerender:true}),0);if(p==='point-reward-settings'&&!pointRewardCloudLoaded&&!pointRewardCloudLoading)setTimeout(()=>refreshPointRewardSettingsCloud({rerender:true}),0);if(p==='app-settings'&&!yijiaPayScLoaded&&!yijiaPayScLoading)setTimeout(()=>refreshYijiaPayScCloud({rerender:true}),0);if(p==='revenue'&&cloudConfigured())setTimeout(async()=>{try{await cloudPullKey(K.deposits);await cloudPullKey(K.handovers);await cloudPullKey(K.xAccounts)}catch(_e){}},0);if(p==='xaccount'&&cloudConfigured())setTimeout(async()=>{try{const before=JSON.stringify(xAccountRows());await cloudPullKey(K.xAccounts);await cloudPullKey(K.handovers);if(before!==JSON.stringify(xAccountRows())&&document.body.dataset.mode==='back')render('xaccount')}catch(_e){}},0)}


let transactionCloudRefreshBusy=false;
async function refreshTransactionOperationalCloud(){
 if(transactionCloudRefreshBusy||!cloudConfigured())return;
 transactionCloudRefreshBusy=true;
 try{
  const keys=[K.sales,K.handovers,K.deposits];
  const before=keys.map(k=>JSON.stringify(load(k,null)));
  for(const k of keys)await cloudPullKey(k);
  const changed=keys.some((k,i)=>before[i]!==JSON.stringify(load(k,null)));
  if(changed&&document.querySelector('.tx-page-head'))render('transactions');
 }catch(_e){}finally{transactionCloudRefreshBusy=false}
}
async function refreshMemberSystemCloud({rerender=false}={}){
 if(!cloudConfigured())return false;
 const keys=[K.members,K.pointSettings,K.memberBonusCampaigns];
 const before=keys.map(k=>JSON.stringify(load(k,null)));
 const pulled=[];
 for(const k of keys)pulled.push(await cloudPullKey(k));
 const changed=keys.some((k,i)=>before[i]!==JSON.stringify(load(k,null)));
 if(changed&&rerender&&document.querySelector('[data-edit-member], [data-delete-member]'))render('members');
 return changed;
}
async function refreshMembersCloud(opts={}){return refreshMemberSystemCloud(opts)}

function dlg(title,body){document.querySelector('#dialogTitle').textContent=title;document.querySelector('#dialogBody').innerHTML=body;genericDialog.classList.add('page-dialog');if(!genericDialog.open)genericDialog.show()}
function saveAudit(a,d=''){audit(a,d);}
const permissionLabels={collectionServiceAccess:'代收服務',eobReceiving:'EOB 驗收',eobOrder:'EOB 訂購',eobReturn:'EOB 非 EC 退貨',eobStocktake:'EOB 盤點',eobStocktakePersonnel:'盤點人員專用',stocktakeUploadHeadOffice:'盤點資料上傳總部',scStocktake:'SC 盤點',mobilePosAccess:'行動 POS',patrolReceiving:'巡迴進貨',patrolReturn:'巡迴退貨',newspaperReceiving:'巡迴報紙驗收',stocktakeUploadHeadOffice:'盤點資料上傳總部',attendanceDelete:'刪除出勤紀錄',wasteQuery:'廢棄查詢／修改',orderAutoAI:'系統自動訂購',freshAIOrder:'鮮食 AI 輔助訂購',transferOut:'轉貨轉出',transferIn:'轉貨轉入',ecCancel:'EC取消寄件',storeAdd:'新增門市',storeCode:'轉換店號',employeeCredentials:'員工帳號密碼設定',systemShiftSettings:'班別設定',systemShiftTimeSettings:'各班時間設定',systemReserveCashSettings:'店舖預留金設定',memberBonusCampaignSettings:'會員贈點活動設定',systemSettingsAccess:'設定',employeeCreate:'新增員工',employeeManage:'員工設定',memberEdit:'修改會員',memberDelete:'刪除會員',memberPointSettings:'會員累點／折抵設定',productsAccess:'商品管理 2.0',storesAccess:'門市管理',revenueAccess:'營收管理',orderingAccess:'訂購管理',inventoryAccess:'盤點功能',qualityAccess:'品保／時控',qualityWasteCreate:'廢棄登錄',timeCreate:'新增時控商品',logisticsAccess:'物流管理',logisticsCreate:'建立物流批次',ecAccess:'EC管理',ecCreate:'新增EC包裹',attendanceAccess:'出勤管理',logisticsDelete:'刪除貨單',qualityOperate:'品保／時控操作',qualityDelete:'品保／時控刪除',cloudRemoteSync:'Supabase 遠端同步',systemVersion:'系統版本',employeeHistoryBlacklistQuery:'前一間離職店／黑名單查詢',employeeBadgePrint:'名牌列印',storeEdit:'修改門市',storeDelete:'刪除門市',storeSwitch:'切換門市',franchiseAreaAccess:'加盟專區',appSettingsAccess:'App設定'};
function hasPermission(key){
 const u=currentUser();if(!u)return false;
 if(PRODUCT_MANAGEMENT_2_KEYS.has(key))return productManagement2Allowed(u);
 if(u.role==='創辦人')return true;
 const founderOnlyStocktake=['inventoryAccess','inventoryChange','inventoryCount','inventoryPrint'];
 if(founderOnlyStocktake.includes(key))return u.role==='創辦人';
 const stored=load(K.permissions,{})[u.id];
 if(stored&&Object.prototype.hasOwnProperty.call(stored,key))return stored[key]===true;
 return userPermissions(u)[key]===true;
}
function requirePermission(key){if(hasPermission(key))return true;alert(`需要「${permissionLabels[key]||key}」權限`);return false}
function latestArrival(type,storeCode='001'){return load(K.logistics,[]).find(x=>x.type===type&&(x.storeCode||'001')===storeCode)}

async function scanCode({title='掃描條碼',onResult}={}){
 dlg(title,`<div id="reader" style="width:100%;min-height:260px"></div><p id="scanHint">請允許相機權限，將條碼放入畫面中央。</p><div class="toolbar"><button class="button" id="scanManual">手動輸入</button><button class="button" id="scanClose">關閉</button></div>`);
 let scanner=null,done=false;
 const finish=async code=>{if(done)return;done=true;try{if(scanner)await scanner.stop()}catch{}genericDialog.close();if(code&&onResult)onResult(String(code).trim())};
 setTimeout(async()=>{
  document.querySelector('#scanManual').onclick=()=>{const v=prompt('請輸入條碼／單號');if(v)finish(v)};
  document.querySelector('#scanClose').onclick=()=>finish('');
  if(!window.Html5Qrcode){document.querySelector('#scanHint').textContent='相機掃描元件尚未載入，請使用手動輸入。';return}
  try{scanner=new Html5Qrcode('reader');const cams=await Html5Qrcode.getCameras();if(!cams.length)throw Error('找不到相機');const back=cams.find(x=>/back|rear|environment|後置/i.test(x.label))||cams[cams.length-1];await scanner.start(back.id,{fps:10,qrbox:{width:280,height:150},aspectRatio:1.4},txt=>finish(txt),()=>{});}catch(e){document.querySelector('#scanHint').textContent='無法啟動相機：'+e.message+'。可改用手動輸入。'}
 },50);
}
function front(p){
 if(p==='pos')return posPage();
 if(p==='transactions-front')return transactionPage(true);
 if(p==='transfer-in')return`<div class="toolbar"><button class="button" data-page="front">← 返回</button></div><div class="panel"><h2>轉貨單過刷轉入</h2><div class="inline-field"><input id="transferNo" placeholder="掃描或輸入單號" style="width:100%;padding:11px"><button class="button" data-action="scan-transfer-no">📷 掃描</button></div><button class="primary" data-action="receive">確認轉入</button></div>`;
 return`${hero()}<div class="home-actions"><button class="home-action" data-page="pos"><span class="ico">🧾</span><span><strong>POS 收銀</strong>進入收銀結帳畫面</span></button><button class="home-action" data-scroll="manage"><span class="ico">⚙️</span><span><strong>管理</strong>門市日常作業</span></button></div><h3 class="section-title" id="manage">管理功能選單</h3><div class="manage-grid"><button class="manage-item" data-action="manual-close"><b>📅</b>手動日結</button><button class="manage-item" data-action="product-lookup"><b>🔍</b>商品查詢</button><button class="manage-item" data-action="member-lookup"><b>👤</b>會員</button><button class="manage-item" data-page="transactions-front"><b>🧾</b>交易查詢</button><button class="manage-item" data-action="ec-front"><b>📮</b>EC進離店</button><button class="manage-item" data-action="new-waste"><b>🗑️</b>廢棄登錄</button><button class="manage-item" data-action="time-lookup"><b>🕒</b>時控查詢</button><button class="manage-item" data-action="deposit"><b>💰</b>投庫</button><button class="manage-item" data-action="handover"><b>🤝</b>交班</button><button class="manage-item" data-action="logistics"><b>🚚</b>物流簽到</button><button class="manage-item" data-action="attendance-clock"><b>🕘</b>打卡</button><button class="manage-item" data-page="transfer-in"><b>📥</b>轉貨單轉入</button></div>`}
function posPage(){return`<div class="toolbar pos2-toolbar"><button class="button" data-page="front">← 前台首頁</button><span class="pos2-badge">POS 2.0 Beta 1</span></div>
<div class="pos2-shell">
 <section class="pos2-catalog panel">
  <div class="pos2-section-head"><div><small>商品區</small><h2>商品選擇</h2></div><button class="button" data-action="scan">📷 掃描條碼</button></div>
  <div class="search-row pos2-search"><input id="search" placeholder="商品名稱／商品代號／條碼" inputmode="search"></div>
  <div class="category-row">${['全部','常溫','鮮食','低溫','冷凍'].map((x,i)=>`<button class="category ${i?'':'active'}" data-category="${x}">${x}</button>`).join('')}</div>
  <div id="productGrid" class="product-grid pos2-product-grid"></div>
 </section>
 <section class="pos2-cart panel">
  <div class="pos2-section-head"><div><small>本筆交易</small><h2>購物車</h2></div><button class="button danger" data-action="clear">整筆取消</button></div>
  <div class="cart-cols pos2-cart-cols"><span>商品</span><span>單價</span><span>數量</span><span>小計</span></div>
  <div id="cartList" class="cart-list pos2-cart-list"></div>
  <label class="pos2-note">交易備註<input id="transactionNote" value="${esc(state.note||'')}" placeholder="選填，例如：客人少拿一瓶飲料"></label>
  <div class="pos2-cart-actions"><button class="pos-tool" data-action="hold">⏸ 暫停交易</button><button class="pos-tool" data-action="restore">▶ 恢復交易</button><button class="pos-tool" data-action="discount">％ 折扣</button><button class="pos-tool" data-action="manual-price">✎ 改價</button></div>
 </section>
 <aside class="pos2-pay panel">
  <div class="pos2-section-head"><div><small>結帳區</small><h2>應收金額</h2></div></div>
  <div id="totalBox" class="pos2-total-box"></div>
  ${posMemberPanel()}
  <div class="pos2-pay-title">付款方式</div>
  <div class="pos2-payment-grid">${['現金','信用卡','行動支付','電子票證','禮物卡','混合付款'].map((x,i)=>`<button class="payment ${i?'':'selected'}" data-pay="${x}"><b>${x==='現金'?'💵':x==='信用卡'?'💳':x==='行動支付'?'📱':x==='電子票證'?'🚇':x==='禮物卡'?'🎁':'🔀'}</b><span>${x}</span></button>`).join('')}</div>
  <button class="checkout pos2-checkout" data-action="checkout">結帳</button>
  <small class="pos2-print-hint">列印本筆交易明細會在結帳時選擇，預設不列印。</small>
 </aside>
</div>`}

function customerVoiceTypesFromConfig(cfg){
 const rows=Array.isArray(cfg?.voiceTypes)?cfg.voiceTypes:[];
 if(rows.length)return rows;
 return [
  {id:'voice-payment-processing',event:'payment-processing',name:'交易中',text:'交易中',repeats:2,intervalMs:3000,active:true},
  {id:'voice-take-card',event:'take-card',name:'請取卡',text:'請取卡',repeats:2,intervalMs:2000,active:true}
 ];
}
function openCustomerVoiceTypeForm(index=null){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=customerVoiceTypesFromConfig(cfg),x=index===null?{}:(rows[Number(index)]||{});
 dlg(index===null?'新增聲音種類':'修改聲音種類',`
  <label>名稱<input id="cvName" value="${esc(x.name||'')}"></label>
  <label>使用時機<select id="cvEvent"><option value="payment-processing" ${x.event==='payment-processing'?'selected':''}>付款交易中</option><option value="take-card" ${x.event==='take-card'?'selected':''}>請取卡</option><option value="custom" ${x.event==='custom'?'selected':''}>自訂</option></select></label>
  <label>播報文字<input id="cvText" value="${esc(x.text||'')}"></label>
  <label>播放次數<input id="cvRepeats" type="number" min="1" max="5" value="${Math.max(1,Number(x.repeats||2))}"></label>
  <label>間隔秒數<input id="cvInterval" type="number" min="0" max="30" step="0.5" value="${Number(x.intervalMs||3000)/1000}"></label>
  <label><input id="cvActive" type="checkbox" ${x.active===false?'':'checked'}> 啟用</label>
  <button class="primary" id="cvSave">儲存</button>`);
 setTimeout(()=>{const btn=document.querySelector('#cvSave');if(!btn)return;btn.onclick=()=>{
  const row={id:x.id||uid(),event:document.querySelector('#cvEvent')?.value||'custom',name:document.querySelector('#cvName')?.value.trim()||'未命名聲音',text:document.querySelector('#cvText')?.value.trim()||'',repeats:Math.max(1,Math.min(5,Number(document.querySelector('#cvRepeats')?.value||2))),intervalMs:Math.max(0,Math.min(30000,Number(document.querySelector('#cvInterval')?.value||0)*1000)),active:!!document.querySelector('#cvActive')?.checked,updatedAt:new Date().toISOString()};
  if(!row.text)return alert('請輸入播報文字');
  if(index===null)rows.push(row);else rows[Number(index)]=row;
  save(K.customerDisplaySettings,{...cfg,voiceTypes:rows});saveAudit(index===null?'新增客顯聲音種類':'修改客顯聲音種類',row.name);genericDialog.close();render('customer-display-settings');
 }},0);
}
function deleteCustomerVoiceType(index){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=customerVoiceTypesFromConfig(cfg),x=rows[Number(index)];if(!x)return;
 if(!confirm(`確定刪除聲音種類「${x.name||''}」？`))return;
 rows.splice(Number(index),1);save(K.customerDisplaySettings,{...cfg,voiceTypes:rows});saveAudit('刪除客顯聲音種類',x.name||'');render('customer-display-settings');
}
function deleteCustomerMusic(index){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=Array.isArray(cfg.music)?cfg.music:[],x=rows[Number(index)];if(!x)return;
 if(!confirm(`確定刪除音樂「${x.name||''}」？`))return;
 rows.splice(Number(index),1);save(K.customerDisplaySettings,{...cfg,music:rows});saveAudit('刪除客顯音樂',x.name||'');render('customer-display-settings');
}
function deleteCustomerGameActivity(index){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=customerGameActivitiesFromConfig(cfg),x=rows[Number(index)];if(!x)return;
 if(!confirm(`確定刪除客顯遊戲活動「${x.name||x.title||''}」？`))return;
 rows.splice(Number(index),1);save(K.customerDisplaySettings,{...cfg,gameActivities:rows});saveAudit('刪除客顯遊戲活動',x.name||x.title||'');render('customer-display-settings');
}
function customerDisplaySettingsPage(){
 if(currentUser()?.role!=='創辦人')return `<section class="page"><div class="notice danger">只有創辦人可以設定客顯、音樂與遊戲。</div></section>`;
 const cfg=load(K.customerDisplaySettings,{enabled:true,intervalSeconds:5,slides:[],music:[],voiceTypes:[],gameActivities:[],game:{}});
 const slides=Array.isArray(cfg.slides)?cfg.slides:[],music=Array.isArray(cfg.music)?cfg.music:[],voiceTypes=customerVoiceTypesFromConfig(cfg);
 const legacyGame=cfg.game&&Object.keys(cfg.game).length?cfg.game:null;
 setTimeout(bindCustomerSlideImageUploads,0);
 const gameActivities=Array.isArray(cfg.gameActivities)&&cfg.gameActivities.length
  ?cfg.gameActivities
  :(legacyGame?[{id:legacyGame.id||'legacy-game',name:legacyGame.title||'遊戲活動',title:legacyGame.title||'幸運四格抽抽樂',type:legacyGame.type||'grid',soundUrl:legacyGame.soundUrl||'',prizes:Array.isArray(legacyGame.prizes)?legacyGame.prizes:[],startDate:'',endDate:'',active:legacyGame.enabled!==false}]:[]);
 return `<section class="page customer-display-admin">
  <div class="page-head"><div><h2>📺 客顯設定</h2><p>輪播、POS／客顯音樂與遊戲皆為總部共用設定。</p></div><div class="toolbar"><button class="button" data-action="customer-storage-check">💾 查看瀏覽器儲存空間</button><span class="founder-only-badge">僅創辦人可設定</span></div></div>

  <section class="customer-config-section">
   <div class="page-head"><h3>輪播畫面</h3><button class="primary" data-action="customer-display-add-slide">新增輪播</button></div>
   <div class="customer-display-global"><label><input type="checkbox" id="customerDisplayEnabled" ${cfg.enabled!==false?'checked':''}> 啟用輪播</label><label>輪播秒數 <input type="number" id="customerDisplayInterval" min="2" max="60" value="${Number(cfg.intervalSeconds||5)}"></label></div>
   <div class="customer-slide-list">${slides.map((x,i)=>`<article class="customer-slide-card" data-slide-index="${i}">
    <div class="customer-slide-preview">${x.imageUrl?`<img src="${esc(x.imageUrl)}">`:`<div><strong>${esc(x.title||'輪播')}</strong><small>${esc(x.subtitle||'')}</small></div>`}</div>
    <label>標題<input data-slide-title="${i}" value="${esc(x.title||'')}"></label><label>副標題<input data-slide-subtitle="${i}" value="${esc(x.subtitle||'')}"></label>
    <label>圖片網址<input data-slide-image="${i}" value="${String(x.imageUrl||'').startsWith('data:')?'':esc(x.imageUrl||'')}" placeholder="https://..."></label>
    <label>上傳圖片<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.gif" data-slide-image-file="${i}"><small data-slide-image-status="${i}">${String(x.imageUrl||'').startsWith('data:')?'目前已有上傳圖片；不重新選擇就保留原圖。':'可直接從裝置選擇圖片；若同時輸入網址，以上傳圖片為準。'}</small></label><label><input type="checkbox" data-slide-active="${i}" ${x.active===false?'':'checked'}> 顯示</label>
    <div class="actions"><button class="button" data-slide-up="${i}">上移</button><button class="button" data-slide-down="${i}">下移</button><button class="danger" data-slide-delete="${i}">刪除</button></div>
   </article>`).join('')||'<div class="empty">尚未設定輪播</div>'}</div>
  </section>

  <section class="customer-config-section">
   <div class="page-head"><div><h3>🎵 音樂管理</h3><small>可使用音訊檔案或音樂網址新增；音量由 iPhone／iPad 實體音量鍵調整。</small></div><button class="primary" data-action="customer-music-add">＋ 新增音樂</button></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>音樂名稱</th><th>音樂檔案</th><th>POS主畫面</th><th>客顯畫面</th><th>循環</th><th>狀態</th><th>操作</th></tr></thead><tbody>
    ${music.map((x,i)=>`<tr><td>${esc(x.name||'未命名')}</td><td class="url-cell">${esc(x.fileName||x.name||'已上傳音訊')}</td><td>${x.pos?'✓':'—'}</td><td>${x.customer?'✓':'—'}</td><td>${x.loop===false?'否':'是'}</td><td>${x.active===false?'取消':'啟用'}</td><td><button class="button" data-music-edit="${i}">修改</button> <button class="button" data-music-cancel="${i}">${x.active===false?'恢復':'停用'}</button> <button class="button danger" data-music-delete="${i}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">尚未新增音樂</td></tr>'}
   </tbody></table></div>
  </section>

  <section class="customer-config-section">
   <div class="page-head"><div><h3>🔊 聲音種類</h3><small>交易語音由 TM／客顯讀取此設定；可新增、修改、刪除。</small></div><button class="primary" data-action="customer-voice-add">＋ 新增聲音種類</button></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>名稱</th><th>使用時機</th><th>播報文字</th><th>次數</th><th>間隔</th><th>狀態</th><th>操作</th></tr></thead><tbody>
    ${voiceTypes.map((x,i)=>`<tr><td><b>${esc(x.name||'未命名')}</b></td><td>${esc(x.event==='payment-processing'?'付款交易中':x.event==='take-card'?'請取卡':'自訂')}</td><td>${esc(x.text||'')}</td><td>${Number(x.repeats||2)} 次</td><td>${(Number(x.intervalMs||0)/1000).toFixed(Number(x.intervalMs||0)%1000?1:0)} 秒</td><td>${x.active===false?'停用':'啟用'}</td><td><button class="button" data-voice-edit="${i}">修改</button> <button class="button danger" data-voice-delete="${i}">刪除</button></td></tr>`).join('')}
   </tbody></table></div>
  </section>

  <section class="customer-config-section">
   <div class="page-head">
    <div><h3>🎮 客顯遊戲活動</h3><small>依活動日期自動顯示在客顯最上方輪播區；只有創辦人可以設定。</small></div>
    <button class="primary" data-action="customer-game-activity-add">＋ 新增活動</button>
   </div>
   <div class="customer-display-global"><label>小計後遊戲倒數秒數 <input type="number" id="customerGameCountdownSeconds" min="5" max="120" value="${Math.max(5,Math.min(120,Number(cfg.gameCountdownSeconds||15)))}"></label><small>POS 按小計後開始倒數；時間到仍未選擇時，POS 會詢問是否由電腦代抽。</small></div>
   <div class="table-wrap"><table class="table game-activity-table">
    <thead><tr><th>活動名稱</th><th>活動商品</th><th>啟動規則</th><th>遊戲方式</th><th>活動日期</th><th>音效</th><th>獎項</th><th>機率合計</th><th>狀態</th><th>操作</th></tr></thead>
    <tbody>
     ${gameActivities.map((g,i)=>{
      const ps=Array.isArray(g.prizes)?g.prizes:[];
      const total=ps.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.probability||0),0);
      const dateText=`${g.startDate||'不限'} ～ ${g.endDate||'不限'}`;
      return `<tr>
       <td><b>${esc(g.name||g.title||'未命名活動')}</b><br><small>${esc(g.title||'')}</small></td>
       <td>${Array.isArray(g.products)&&g.products.length?g.products.map(p=>esc(p.name||p.code||'')).join('、'):'未指定'}</td>
       <td>${g.triggerRule==='two-item-discount'?'2件打折':g.triggerRule==='second-item-discount'?'第二件打折':'指定商品數量'}<br><small>每 ${Math.max(1,Number(g.requiredQty||1))} 件 1 次</small></td>
       <td>${g.type==='wheel'?'幸運轉盤':'四格抽抽樂'}</td>
       <td>${esc(dateText)}</td>
       <td>${esc(g.soundFileName|| (g.soundUrl?'已設定':'—'))}</td>
       <td>${ps.length} 項</td>
       <td>${total.toFixed(2)}%</td>
       <td>${g.active===false?'<span class="muted">已取消</span>':'<b class="ok">啟用</b>'}</td>
       <td>
        <button class="button" data-game-activity-edit="${i}">活動設定／修改</button>
        <button class="button" data-game-activity-cancel="${i}">${g.active===false?'恢復':'停用'}</button>
        <button class="button danger" data-game-activity-delete="${i}">刪除</button>
       </td>
      </tr>`;
     }).join('')||'<tr><td colspan="10">尚未新增遊戲活動</td></tr>'}
    </tbody>
   </table></div>
  </section>
  <button class="primary customer-config-save" data-action="customer-display-save-global">儲存全部客顯設定</button>
 </section>`;
}

function bindCustomerSlideImageUploads(){
 document.querySelectorAll('[data-slide-image-file]').forEach(input=>{
  if(input.dataset.boundSlideImage==='1')return;
  input.dataset.boundSlideImage='1';
  input.addEventListener('change',()=>{
   const file=input.files?.[0]||null;if(!file)return;
   if(!String(file.type||'').startsWith('image/')&&!/\.(jpg|jpeg|png|webp|gif)$/i.test(file.name||''))return alert('請選擇圖片檔案');
   const r=new FileReader();
   r.onload=()=>{
    const i=input.dataset.slideImageFile||'';
    const urlInput=document.querySelector(`[data-slide-image="${i}"]`);
    const status=document.querySelector(`[data-slide-image-status="${i}"]`);
    const dataUrl=String(r.result||'');
    if(urlInput){urlInput._uploadedDataUrl=dataUrl;urlInput.value='';}
    if(status)status.textContent=`已選擇：${file.name||'圖片檔案'}；按「儲存全部客顯設定」後生效。`;
    const card=input.closest('.customer-slide-card');const preview=card?.querySelector('.customer-slide-preview');
    if(preview)preview.innerHTML=`<img src="${dataUrl}">`;
   };
   r.onerror=()=>alert('讀取圖片檔案失敗');
   r.readAsDataURL(file);
  });
 });
}

function formatStorageBytes(bytes){
 const n=Number(bytes||0);
 if(!Number.isFinite(n)||n<=0)return '0 B';
 const units=['B','KB','MB','GB','TB'];let v=n,i=0;
 while(v>=1024&&i<units.length-1){v/=1024;i++;}
 return `${v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2)} ${units[i]}`;
}
function approximateLocalStorageBytes(){
 let total=0;
 try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';const v=localStorage.getItem(k)||'';total+=(k.length+v.length)*2;}}catch(_){}
 return total;
}
async function showBrowserStorageEstimate(){
 if(!isFounder())return alert('只有創辦人可以查看');
 const localBytes=approximateLocalStorageBytes();
 try{
  if(!navigator.storage?.estimate){
   return alert(`此瀏覽器無法回報網站總儲存上限。\n\n目前 localStorage 約使用：${formatStorageBytes(localBytes)}\nSafari／iPadOS 的 localStorage 實際上限由系統決定，無法由網頁精確查出。`);
  }
  const est=await navigator.storage.estimate();
  const used=Number(est.usage||0),quota=Number(est.quota||0),remain=Math.max(0,quota-used),pct=quota?used/quota*100:0;
  alert(`瀏覽器網站儲存空間（系統估算）\n\n已使用：${formatStorageBytes(used)}\n預估上限：${formatStorageBytes(quota)}\n預估剩餘：${formatStorageBytes(remain)}\n使用率：${pct.toFixed(1)}%\n\n其中 localStorage 約使用：${formatStorageBytes(localBytes)}\n\n注意：Safari 回報的是網站整體儲存估算；localStorage 仍有自己的較小限制，因此大型音效即使總空間還有剩餘，也可能儲存失敗。`);
 }catch(err){
  alert(`無法取得瀏覽器儲存空間：${String(err?.message||err)}\n\n目前 localStorage 約使用：${formatStorageBytes(localBytes)}`);
 }
}
function saveCustomerDisplaySettingsFromDom(){
 if(currentUser()?.role!=='創辦人')return alert('只有創辦人可以設定');
 const btn=document.querySelector('[data-action="customer-display-save-global"]');
 const oldText=btn?.textContent||'儲存全部客顯設定';
 try{
  if(btn){btn.disabled=true;btn.textContent='儲存中…';}
  const next=customerDisplaySettingsFromDom();
  save(K.customerDisplaySettings,next);
  saveAudit('客顯全部設定','更新輪播、音樂、遊戲與倒數設定');
  alert('全部客顯設定已儲存');
  render('customer-display-settings');
 }catch(err){
  const msg=String(err?.message||err||'儲存失敗');
  if(/quota|storage|exceeded|space/i.test(msg))alert('儲存失敗：瀏覽器本機儲存空間不足。\n\n大型圖片／音效建議使用網址，或先刪除不需要的媒體檔案後再儲存。');
  else alert('儲存全部客顯設定失敗：'+msg);
 }finally{
  if(btn&&document.body.contains(btn)){btn.disabled=false;btn.textContent=oldText;}
 }
}

function readAudioFileAsDataUrl(file){
 return new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onload=()=>resolve(String(r.result||''));
  r.onerror=()=>reject(r.error||new Error('讀取音訊檔案失敗'));
  r.readAsDataURL(file);
 });
}

function openCustomerMusicForm(index=null){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=Array.isArray(cfg.music)?cfg.music:[],x=index===null?{}:(rows[Number(index)]||{});
 dlg(index===null?'新增音樂':'修改音樂',`
  <label>音樂名稱<input id="cmName" value="${esc(x.name||'')}"></label>
  <label>音樂檔案
   <input id="cmFile" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg">
   <small>${x.fileName?`目前檔案：${esc(x.fileName)}`:(String(x.url||'').startsWith('data:')?'目前已有音樂檔案；不重新選擇就保留原檔。':'可從裝置選擇音訊檔案')}</small>
  </label>
  <label>音樂網址（可與檔案二選一）
   <input id="cmUrl" type="url" inputmode="url" value="${String(x.url||'').startsWith('data:')?'':esc(x.url||'')}" placeholder="https://...">
   <small>使用網址可避免大型音樂檔案佔用瀏覽器儲存空間；若同時選檔案，將以檔案為準。</small>
  </label>
  <label><input id="cmPos" type="checkbox" ${x.pos?'checked':''}> POS主畫面</label>
  <label><input id="cmCustomer" type="checkbox" ${x.customer?'checked':''}> 客顯畫面</label>
  <label><input id="cmLoop" type="checkbox" ${x.loop===false?'':'checked'}> 循環播放</label>
  <button class="primary" id="cmSave">儲存</button>`);
 setTimeout(()=>{
  const saveBtn=document.querySelector('#cmSave');
  const nameInput=document.querySelector('#cmName');
  const fileInput=document.querySelector('#cmFile');
  const urlInput=document.querySelector('#cmUrl');
  const posInput=document.querySelector('#cmPos');
  const customerInput=document.querySelector('#cmCustomer');
  const loopInput=document.querySelector('#cmLoop');
  if(!saveBtn)return;
  const bindClassRemove=()=>{
   screenBody?.querySelectorAll('[data-screen-remove]').forEach(btn=>btn.onclick=()=>btn.closest('tr')?.remove());
   statusBody?.querySelectorAll('[data-status-remove]').forEach(btn=>btn.onclick=()=>btn.closest('tr')?.remove());
  };
  bindClassRemove();

  if(addScreen)addScreen.onclick=()=>{
   const idx=Date.now(),tr=document.createElement('tr');tr.dataset.screenGroupRow=String(idx);
   tr.innerHTML=`<td><select data-screen-kind="${idx}"><option value="fos">FOS訂購</option><option value="special">特殊品訂購</option><option value="use">用度品訂購</option><option value="group">品群訂購</option><option value="ledger">台帳訂購</option></select></td>
    <td><input data-screen-code="${idx}" style="width:90px"></td><td><input data-screen-name="${idx}"></td>
    <td><input data-screen-map="${idx}" placeholder="商品品群名稱，可用頓號分隔"></td><td><input data-screen-sort="${idx}" type="number" value="999" style="width:80px"></td>
    <td><input data-screen-enabled="${idx}" type="checkbox" checked></td><td><button class="button danger" data-screen-remove="${idx}">刪除</button></td>`;
   screenBody.appendChild(tr);bindClassRemove();
  };
  if(addStatus)addStatus.onclick=()=>{
   const idx=Date.now(),tr=document.createElement('tr');tr.dataset.statusGroupRow=String(idx);
   tr.innerHTML=`<td><input data-status-code="${idx}" style="width:90px"></td><td><input data-status-name="${idx}"></td>
    <td><input data-status-map="${idx}" placeholder="商品品群名稱，可用頓號分隔"></td><td><input data-status-sort="${idx}" type="number" value="999" style="width:80px"></td>
    <td><input data-status-enabled="${idx}" type="checkbox" checked></td><td><button class="button danger" data-status-remove="${idx}">刪除</button></td>`;
   statusBody.appendChild(tr);bindClassRemove();
  };
  if(saveClass)saveClass.onclick=async()=>{
   const screen=[...(screenBody?.querySelectorAll('tr[data-screen-group-row]')||[])].map((tr,i)=>{
    const idx=tr.dataset.screenGroupRow;
    return {
     id:`scr-${Date.now()}-${i}`,
     kind:tr.querySelector(`[data-screen-kind="${idx}"]`)?.value||'fos',
     code:String(tr.querySelector(`[data-screen-code="${idx}"]`)?.value||'').trim(),
     name:String(tr.querySelector(`[data-screen-name="${idx}"]`)?.value||'').trim(),
     productGroups:normalizeGroupNameList(tr.querySelector(`[data-screen-map="${idx}"]`)?.value||''),
     sort:Number(tr.querySelector(`[data-screen-sort="${idx}"]`)?.value||0),
     enabled:!!tr.querySelector(`[data-screen-enabled="${idx}"]`)?.checked
    };
   }).filter(x=>x.code&&x.name);
   const status=[...(statusBody?.querySelectorAll('tr[data-status-group-row]')||[])].map((tr,i)=>{
    const idx=tr.dataset.statusGroupRow;
    return {
     id:`sts-${Date.now()}-${i}`,
     code:String(tr.querySelector(`[data-status-code="${idx}"]`)?.value||'').trim(),
     name:String(tr.querySelector(`[data-status-name="${idx}"]`)?.value||'').trim(),
     productGroups:normalizeGroupNameList(tr.querySelector(`[data-status-map="${idx}"]`)?.value||''),
     sort:Number(tr.querySelector(`[data-status-sort="${idx}"]`)?.value||0),
     enabled:!!tr.querySelector(`[data-status-enabled="${idx}"]`)?.checked
    };
   }).filter(x=>x.code&&x.name);
   if(!screen.length&&!status.length)return alert('請至少保留一筆訂購分類設定');
   await saveOrderingClassificationConfig({screenGroups:screen,statusGroups:status});
   alert('訂購分類設定已儲存並同步。訂購畫面與訂購狀況一覽會直接套用新設定。');
   genericDialog.close();render('products');
  };
  if(syncClass)syncClass.onclick=async()=>{
   if(!cloudConfigured())return alert('目前尚未設定雲端');
   syncClass.disabled=true;syncClass.textContent='同步中…';
   try{await cloudPullKey(ORDERING_CLASSIFICATION_KEY);alert('已從雲端同步訂購分類設定');genericDialog.close();openProductGroupEditorDialog()}
   catch(e){alert('同步失敗：'+(e?.message||e))}
  };

  saveBtn.onclick=async()=>{
   try{
    const file=fileInput?.files?.[0]||null;
    const enteredUrl=urlInput?.value?.trim()||'';
    let url=x.url||'',fileName=x.fileName||'';
    if(enteredUrl){url=enteredUrl;fileName='網址音樂';}
    if(file){
     if(!String(file.type||'').startsWith('audio/')&&!/\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name||''))return alert('請選擇音訊檔案');
     url=await readAudioFileAsDataUrl(file);
     fileName=file.name||'音樂檔案';
    }
    if(!url)return alert('請選擇音樂檔案或輸入音樂網址');
    const row={
     id:x.id||uid(),
     name:nameInput?.value?.trim()||fileName||'未命名音樂',
     url,fileName,
     pos:!!posInput?.checked,
     customer:!!customerInput?.checked,
     loop:!!loopInput?.checked,
     active:x.active===false?false:true
    };
    if(index===null)rows.push(row);else rows[Number(index)]=row;
    save(K.customerDisplaySettings,{...cfg,music:rows});
    saveAudit('客顯音樂設定',`${row.name}｜${row.pos?'POS ':''}${row.customer?'客顯':''}`);
    alert('音樂已儲存');
    genericDialog.close();
    render('customer-display-settings');
   }catch(err){
    const msg=String(err?.message||err||'儲存失敗');
    if(/quota|storage|exceeded/i.test(msg))alert('儲存失敗：瀏覽器可用儲存空間不足。大型音樂建議改用網址。');
    else alert('儲存失敗：'+msg);
   }
  };
 },0);
}
function mutateCustomerMusic(index){
 const cfg=customerDisplaySettingsFromDom(),rows=Array.isArray(cfg.music)?cfg.music:[],x=rows[Number(index)];if(!x)return;
 x.active=x.active===false;save(K.customerDisplaySettings,{...cfg,music:rows});render('customer-display-settings');
}
function customerGameActivitiesFromConfig(cfg){
 if(Array.isArray(cfg?.gameActivities)&&cfg.gameActivities.length)return cfg.gameActivities;
 const g=cfg?.game;
 if(g&&Object.keys(g).length)return [{id:g.id||'legacy-game',name:g.title||'遊戲活動',title:g.title||'幸運四格抽抽樂',type:g.type||'grid',soundUrl:g.soundUrl||'',soundFileName:g.soundFileName||'',products:Array.isArray(g.products)?g.products:[],triggerRule:g.triggerRule||'quantity',requiredQty:Math.max(1,Number(g.requiredQty||1)),prizes:Array.isArray(g.prizes)?g.prizes:[],startDate:'',endDate:'',active:g.enabled!==false}];
 return [];
}
function openCustomerGameActivityForm(index=null){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=customerGameActivitiesFromConfig(cfg),x=index===null?{}:(rows[Number(index)]||{});
 const prizes=Array.isArray(x.prizes)?structuredClone(x.prizes):[];
 const productRows=products().filter(p=>p.active!==false&&p.status!=='停用');
 const selectedProducts=Array.isArray(x.products)?structuredClone(x.products):[];
 dlg(index===null?'新增客顯遊戲活動':'活動設定／修改',`
  <div class="game-activity-form">
   <label>活動名稱<input id="gaName" value="${esc(x.name||'')}"></label>
   <div class="settings-grid">
    <label>開始日期<input id="gaStart" type="date" value="${esc(x.startDate||'')}"></label>
    <label>結束日期<input id="gaEnd" type="date" value="${esc(x.endDate||'')}"></label>
   </div>
   <div class="settings-grid">
    <label>遊戲方式<select id="gaType"><option value="grid" ${x.type!=='wheel'?'selected':''}>四格抽抽樂</option><option value="wheel" ${x.type==='wheel'?'selected':''}>幸運轉盤</option></select></label>
    <label>遊戲畫面標題<input id="gaTitle" value="${esc(x.title||x.name||'幸運四格抽抽樂')}"></label>
   </div>
   <div class="settings-grid">
    <label>遊戲啟動規則<select id="gaTriggerRule">
     <option value="quantity" ${(x.triggerRule||'quantity')==='quantity'?'selected':''}>指定商品數量</option>
     <option value="two-item-discount" ${x.triggerRule==='two-item-discount'?'selected':''}>2件打折</option>
     <option value="second-item-discount" ${x.triggerRule==='second-item-discount'?'selected':''}>第二件打折</option>
    </select></label>
    <label>每滿幾件抽一次<select id="gaRequiredQty">${Array.from({length:99},(_,i)=>i+1).map(n=>`<option value="${n}" ${Math.max(1,Number(x.requiredQty||1))===n?'selected':''}>${n} 件</option>`).join('')}</select><small>例如設 2：活動商品買 2 件抽 1 次、4 件抽 2 次。</small></label>
   </div>
   <div class="setting-hint">「2件打折／第二件打折」會同時確認 POS 本筆交易確實套用對應的總部商品活動，再啟動遊戲。</div>

   <section class="game-activity-products">
    <div class="page-head"><h4>活動商品</h4><small>可加入多個品項</small></div>
    <div class="game-product-picker">
     <select id="gaProductSelect"><option value="">請選擇商品</option>${productRows.map(p=>`<option value="${esc(p.id)}">${esc(p.code||'')}｜${esc(p.name||'')}</option>`).join('')}</select>
     <button type="button" class="button" id="gaProductAdd">＋ 加入商品</button>
    </div>
    <div id="gaProductRows" class="game-product-selected"></div>
   </section>

   <label>遊戲音效檔案
    <div class="inline-field"><input id="gaSoundFile" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"><button type="button" class="button danger" id="gaSoundDelete" ${x.soundUrl?'':'disabled'}>刪除音效</button></div>
    <small id="gaSoundStatus">${x.soundFileName?`目前檔案：${esc(x.soundFileName)}`:(String(x.soundUrl||'').startsWith('data:')?'目前已有音效檔案；不重新選擇就保留原檔。':x.soundUrl?'目前已設定網址音效':'可從裝置選擇音訊檔案')}</small>
   </label>
   <label>遊戲音效網址（可與檔案二選一）
    <input id="gaSoundUrl" type="url" inputmode="url" value="${String(x.soundUrl||'').startsWith('data:')?'':esc(x.soundUrl||'')}" placeholder="https://...">
    <small>若同時選擇音效檔案，將以檔案為準。</small>
   </label>
   <label><input id="gaActive" type="checkbox" ${x.active===false?'':'checked'}> 啟用活動</label>
   <div class="page-head"><h4>獎項／中獎機率</h4><button type="button" class="button" id="gaPrizeAdd">＋ 新增獎項</button></div>
   <div id="gaPrizeRows" class="game-prize-admin"></div>
   <div id="gaProbTotal" class="game-prob-total"></div>
   <button class="primary" id="gaSave">儲存活動</button>
  </div>`);
 const redrawProducts=()=>{
  const box=document.querySelector('#gaProductRows');if(!box)return;
  box.innerHTML=selectedProducts.map((sp,i)=>`<div class="game-product-chip"><span>${esc(sp.code||'')}｜${esc(sp.name||'')}</span><button type="button" class="button danger" data-ga-product-delete="${i}">移除</button></div>`).join('')||'<div class="empty">尚未加入活動商品</div>';
  box.querySelectorAll('[data-ga-product-delete]').forEach(el=>el.onclick=()=>{selectedProducts.splice(Number(el.dataset.gaProductDelete),1);redrawProducts()});
 };
 let soundDeleteRequested=false;
 const redraw=()=>{
  const box=document.querySelector('#gaPrizeRows'),total=document.querySelector('#gaProbTotal');if(!box)return;
  box.innerHTML=prizes.map((p,i)=>`<div class="game-prize-row">
   <input data-ga-prize-name="${i}" value="${esc(p.name||'')}" placeholder="獎項">
   <select data-ga-prize-prob="${i}" aria-label="中獎機率">${Array.from({length:101},(_,n)=>`<option value="${n}" ${Number(p.probability||0)===n?'selected':''}>${n}%</option>`).join('')}</select>
   <label><input data-ga-prize-active="${i}" type="checkbox" ${p.active===false?'':'checked'}>啟用</label>
   <button type="button" class="button danger" data-ga-prize-delete="${i}">刪除</button>
  </div>`).join('')||'<div class="empty">尚未設定獎項</div>';
  if(total)total.innerHTML=`目前機率合計：<b>${prizes.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.probability||0),0).toFixed(2)}%</b>`;
  box.querySelectorAll('[data-ga-prize-name]').forEach(el=>el.oninput=()=>{prizes[Number(el.dataset.gaPrizeName)].name=el.value});
  box.querySelectorAll('[data-ga-prize-prob]').forEach(el=>el.onchange=()=>{prizes[Number(el.dataset.gaPrizeProb)].probability=Math.max(0,Number(el.value||0));if(total)total.innerHTML=`目前機率合計：<b>${prizes.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.probability||0),0).toFixed(2)}%</b>`});
  box.querySelectorAll('[data-ga-prize-active]').forEach(el=>el.onchange=()=>{prizes[Number(el.dataset.gaPrizeActive)].active=el.checked;redraw()});
  box.querySelectorAll('[data-ga-prize-delete]').forEach(el=>el.onclick=()=>{prizes.splice(Number(el.dataset.gaPrizeDelete),1);redraw()});
 };
 setTimeout(()=>{
  redraw();redrawProducts();
  const soundDelete=document.querySelector('#gaSoundDelete');
  if(soundDelete)soundDelete.onclick=()=>{
   soundDeleteRequested=true;
   const soundFileInput=document.querySelector('#gaSoundFile');if(soundFileInput)soundFileInput.value='';
   const soundUrlInput=document.querySelector('#gaSoundUrl');if(soundUrlInput)soundUrlInput.value='';
   const soundStatus=document.querySelector('#gaSoundStatus');if(soundStatus)soundStatus.textContent='已標記刪除；按「儲存活動」後生效。';
   soundDelete.disabled=true;
  };
  const productSelect=document.querySelector('#gaProductSelect');
  const productAdd=document.querySelector('#gaProductAdd');
  if(productAdd)productAdd.onclick=()=>{
   const p=productRows.find(v=>String(v.id)===String(productSelect?.value||''));
   if(!p)return alert('請先選擇商品');
   if(selectedProducts.some(v=>String(v.id)===String(p.id)))return alert('此商品已加入活動');
   selectedProducts.push({id:p.id,code:p.code||'',name:p.name||'',barcode:productBarcodes(p)[0]||''});
   if(productSelect)productSelect.value='';
   redrawProducts();
  };
  const prizeAdd=document.querySelector('#gaPrizeAdd');if(prizeAdd)prizeAdd.onclick=()=>{prizes.push({id:uid(),name:'新獎項',probability:0,active:true});redraw()};
  const saveBtn=document.querySelector('#gaSave');
  if(saveBtn)saveBtn.onclick=async()=>{
   try{
    const start=document.querySelector('#gaStart')?.value||'',end=document.querySelector('#gaEnd')?.value||'';
    if(start&&end&&start>end)return alert('結束日期不能早於開始日期');
    const activePrizes=prizes.filter(p=>p.active!==false);
    const probability=activePrizes.reduce((s,p)=>s+Number(p.probability||0),0);
    if(probability>100.0001)return alert('中獎機率合計不能超過 100%');
    const soundFile=document.querySelector('#gaSoundFile')?.files?.[0]||null;
    const enteredSoundUrl=document.querySelector('#gaSoundUrl')?.value?.trim()||'';
    let soundUrl=soundDeleteRequested?'':(x.soundUrl||''),soundFileName=soundDeleteRequested?'':(x.soundFileName||'');
    if(enteredSoundUrl){soundUrl=enteredSoundUrl;soundFileName='網址音效';soundDeleteRequested=false;}
    if(soundFile){
     if(!String(soundFile.type||'').startsWith('audio/')&&!/\.(mp3|m4a|aac|wav|ogg)$/i.test(soundFile.name||''))return alert('請選擇音訊檔案');
     soundUrl=await readAudioFileAsDataUrl(soundFile);
     soundFileName=soundFile.name||'遊戲音效';
    }
    const row={
     id:x.id||uid(),name:document.querySelector('#gaName')?.value.trim()||'未命名遊戲活動',startDate:start,endDate:end,
     type:document.querySelector('#gaType')?.value||'grid',title:document.querySelector('#gaTitle')?.value.trim()||document.querySelector('#gaName')?.value.trim()||'幸運抽抽樂',
     triggerRule:document.querySelector('#gaTriggerRule')?.value||'quantity',requiredQty:Math.max(1,Math.floor(Number(document.querySelector('#gaRequiredQty')?.value||1))),
     soundUrl,soundFileName,products:selectedProducts,active:!!document.querySelector('#gaActive')?.checked,prizes,
     updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''
    };
    if(index===null)rows.push(row);else rows[Number(index)]=row;
    save(K.customerDisplaySettings,{...cfg,gameActivities:rows});
    saveAudit(index===null?'新增客顯遊戲活動':'修改客顯遊戲活動',`${row.name}｜${start||'不限'}～${end||'不限'}｜活動商品 ${row.products.length} 項｜${row.triggerRule}｜每 ${row.requiredQty} 件 1 次`);
    alert('客顯遊戲活動已儲存');
    genericDialog.close();render('customer-display-settings');
   }catch(err){
    const msg=String(err?.message||err||'儲存失敗');
    if(/quota|storage|exceeded/i.test(msg))alert('儲存失敗：瀏覽器可用儲存空間不足。大型音效建議改用網址。');
    else alert('儲存失敗：'+msg);
   }
  };
 },0);
}
function toggleCustomerGameActivity(index){
 if(!isFounder())return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom(),rows=customerGameActivitiesFromConfig(cfg),x=rows[Number(index)];if(!x)return;
 x.active=x.active===false;
 x.updatedAt=new Date().toISOString();x.updatedBy=currentUser()?.name||'';
 save(K.customerDisplaySettings,{...cfg,gameActivities:rows});
 saveAudit(x.active?'恢復客顯遊戲活動':'取消客顯遊戲活動',x.name||x.title||x.id);
 render('customer-display-settings');
}
function customerDisplaySettingsFromDom(fallback=null){
 const cfg=fallback||load(K.customerDisplaySettings,{enabled:true,intervalSeconds:5,slides:[],music:[],gameActivities:[],game:{}});
 const slides=(Array.isArray(cfg.slides)?cfg.slides:[]).map((x,i)=>({...x,
  title:String(document.querySelector(`[data-slide-title="${i}"]`)?.value??x.title??'').trim(),
  subtitle:String(document.querySelector(`[data-slide-subtitle="${i}"]`)?.value??x.subtitle??'').trim(),
  imageUrl:(()=>{const el=document.querySelector(`[data-slide-image="${i}"]`);const uploaded=el?._uploadedDataUrl||'';const typed=String(el?.value??'').trim();return uploaded||typed||String(x.imageUrl||'').trim()})(),
  active:document.querySelector(`[data-slide-active="${i}"]`)?!!document.querySelector(`[data-slide-active="${i}"]`).checked:x.active!==false
 }));
 return {...cfg,
  enabled:document.querySelector('#customerDisplayEnabled')?!!document.querySelector('#customerDisplayEnabled').checked:cfg.enabled!==false,
  intervalSeconds:Math.max(2,Math.min(60,Number(document.querySelector('#customerDisplayInterval')?.value||cfg.intervalSeconds||5))),
  gameCountdownSeconds:Math.max(5,Math.min(120,Number(document.querySelector('#customerGameCountdownSeconds')?.value||cfg.gameCountdownSeconds||15))),
  slides,
  voiceTypes:customerVoiceTypesFromConfig(cfg),
  gameActivities:customerGameActivitiesFromConfig(cfg)
 };
}
function mutateCustomerSlide(action,index){
 if(currentUser()?.role!=='創辦人')return alert('只有創辦人可以設定');
 const cfg=customerDisplaySettingsFromDom();
 const slides=Array.isArray(cfg.slides)?cfg.slides:[];
 index=Number(index);
 if(action==='add')slides.push({id:uid(),title:'新活動',subtitle:'',imageUrl:'',active:true});
 if(action==='delete'&&slides[index])slides.splice(index,1);
 if(action==='up'&&index>0)[slides[index-1],slides[index]]=[slides[index],slides[index-1]];
 if(action==='down'&&index>=0&&index<slides.length-1)[slides[index+1],slides[index]]=[slides[index],slides[index+1]];
 save(K.customerDisplaySettings,{...cfg,slides});render('customer-display-settings');
}
function metrics(){return operationsMetricsHtml(localDateKey())}

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


const PRODUCT_GROUP_CODES_KEY='yj_product_group_codes';

const ORDERING_CLASSIFICATION_KEY='yj_ordering_classification_config';
function defaultOrderingClassificationConfig(){
 return {
  screenGroups:[
   {id:'fos-f01',kind:'fos',code:'F01',name:'飯糰',productGroups:['飯糰'],enabled:true,sort:10},
   {id:'fos-f02',kind:'fos',code:'F02',name:'壽司',productGroups:['壽司'],enabled:true,sort:20},
   {id:'fos-f03',kind:'fos',code:'F03',name:'便當',productGroups:['便當'],enabled:true,sort:30},
   {id:'fos-f04',kind:'fos',code:'F04',name:'麵食',productGroups:['麵食'],enabled:true,sort:40},
   {id:'fos-f05',kind:'fos',code:'F05',name:'三明治／漢堡',productGroups:['三明治／漢堡'],enabled:true,sort:50},
   {id:'fos-f06',kind:'fos',code:'F06',name:'沙拉／水果',productGroups:['沙拉／水果'],enabled:true,sort:60},
   {id:'fos-f07',kind:'fos',code:'F07',name:'鮮食甜點',productGroups:['鮮食甜點'],enabled:true,sort:70},
   {id:'fos-f08',kind:'fos',code:'F08',name:'其他鮮食',productGroups:['其他鮮食'],enabled:true,sort:80},

   {id:'special-s01',kind:'special',code:'S01',name:'特殊商品',productGroups:['特殊商品'],enabled:true,sort:10},
   {id:'special-s02',kind:'special',code:'S02',name:'預購商品',productGroups:['預購商品'],enabled:true,sort:20},
   {id:'special-s03',kind:'special',code:'S03',name:'節慶商品',productGroups:['節慶商品'],enabled:true,sort:30},
   {id:'special-s04',kind:'special',code:'S04',name:'陳列用品',productGroups:['陳列用品'],enabled:true,sort:40},
   {id:'special-s05',kind:'special',code:'S05',name:'活動商品',productGroups:['活動商品'],enabled:true,sort:50},
   {id:'special-s06',kind:'special',code:'S06',name:'門市用品',productGroups:['門市用品'],enabled:true,sort:60},

   {id:'use-086',kind:'use',code:'086',name:'便當備品',productGroups:['便當備品'],enabled:true,sort:10},
   {id:'use-726',kind:'use',code:'726',name:'其他辦公商品',productGroups:['其他辦公商品'],enabled:true,sort:20},
   {id:'use-796',kind:'use',code:'796',name:'觀光區用品',productGroups:['觀光區用品'],enabled:true,sort:30},
   {id:'use-975',kind:'use',code:'975',name:'鮮食行銷贈品',productGroups:['鮮食行銷贈品'],enabled:true,sort:40},
   {id:'use-977',kind:'use',code:'977',name:'行銷部贈品',productGroups:['行銷部贈品'],enabled:true,sort:50},
   {id:'use-a05',kind:'use',code:'A05',name:'常溫冷凍冷藏',productGroups:['常溫冷凍冷藏'],enabled:true,sort:60},
   {id:'use-a06',kind:'use',code:'A06',name:'咖啡用酒',productGroups:['咖啡用酒'],enabled:true,sort:70},
   {id:'use-a07',kind:'use',code:'A07',name:'咖啡物料商品',productGroups:['咖啡物料商品'],enabled:true,sort:80},
   {id:'use-a17',kind:'use',code:'A17',name:'咖啡物料商品',productGroups:['咖啡物料商品'],enabled:true,sort:90},
   {id:'use-a21',kind:'use',code:'A21',name:'茶飲',productGroups:['茶飲'],enabled:true,sort:100},
   {id:'use-a31',kind:'use',code:'A31',name:'冰沙',productGroups:['冰沙'],enabled:true,sort:110},
   {id:'use-a32',kind:'use',code:'A32',name:'微波冰沙',productGroups:['微波冰沙'],enabled:true,sort:120},
   {id:'use-a35',kind:'use',code:'A35',name:'袋裝冰沙',productGroups:['袋裝冰沙'],enabled:true,sort:130}
  ],
  statusGroups:[
   {id:'st001',code:'001',name:'FF商品',productGroups:['飯糰','壽司','便當','麵食','三明治／漢堡','沙拉／水果','鮮食甜點','其他鮮食'],enabled:true,sort:10},
   {id:'st002',code:'002',name:'麵包',productGroups:['麵包'],enabled:true,sort:20},
   {id:'st003',code:'003',name:'冷凍商品',productGroups:['冷凍商品'],enabled:true,sort:30},
   {id:'st004',code:'004',name:'日配品',productGroups:['日配品'],enabled:true,sort:40},
   {id:'st005',code:'005',name:'WALK IN飲料',productGroups:['WALK IN飲料'],enabled:true,sort:50},
   {id:'st006',code:'006',name:'加工食品',productGroups:['加工食品'],enabled:true,sort:60},
   {id:'st007',code:'007',name:'菓子',productGroups:['菓子'],enabled:true,sort:70},
   {id:'st008',code:'008',name:'酒、菸類',productGroups:['酒、菸類'],enabled:true,sort:80},
   {id:'st009',code:'009',name:'日用品',productGroups:['日用品'],enabled:true,sort:90},
   {id:'st010',code:'010',name:'紙類／衛生用品',productGroups:['紙類／衛生用品'],enabled:true,sort:100},
   {id:'st011',code:'011',name:'調度品',productGroups:['調度品'],enabled:true,sort:110},
   {id:'st012',code:'012',name:'福袋',productGroups:['福袋'],enabled:true,sort:120},
   {id:'st013',code:'013',name:'服務性商品',productGroups:['服務性商品'],enabled:true,sort:130},
   {id:'st014',code:'014',name:'包材、物料',productGroups:['包材、物料'],enabled:true,sort:140}
  ],
  updatedAt:'',
  updatedBy:''
 };
}
function orderingClassificationConfig(){
 const raw=load(ORDERING_CLASSIFICATION_KEY,null);
 if(!raw||!Array.isArray(raw.screenGroups)||!Array.isArray(raw.statusGroups)){
  const def=defaultOrderingClassificationConfig();
  save(ORDERING_CLASSIFICATION_KEY,def);
  return def;
 }
 return raw;
}
function normalizeGroupNameList(v){
 if(Array.isArray(v))return [...new Set(v.map(x=>String(x||'').trim()).filter(Boolean))];
 return [...new Set(String(v||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean))];
}
function orderingScreenGroups(kind){
 return orderingClassificationConfig().screenGroups
  .filter(x=>x.enabled!==false&&String(x.kind||'')===String(kind||''))
  .sort((a,b)=>Number(a.sort||0)-Number(b.sort||0)||String(a.code||'').localeCompare(String(b.code||'')));
}
function orderingStatusGroupsConfig(){
 return orderingClassificationConfig().statusGroups
  .filter(x=>x.enabled!==false)
  .sort((a,b)=>Number(a.sort||0)-Number(b.sort||0)||String(a.code||'').localeCompare(String(b.code||'')));
}
function productMappedToClassification(p,row){
 const targets=normalizeGroupNameList(row?.productGroups);
 if(!targets.length)return false;
 const values=[
  p?.group,p?.category,p?.orderGroup,p?.orderCategory,p?.subcategory,
  p?.groupCode,p?.orderGroupCode,p?.orderCategoryCode
 ].map(v=>String(v||'').trim()).filter(Boolean);
 return targets.some(t=>values.some(v=>v===t||v.includes(t)||t.includes(v)));
}
async function saveOrderingClassificationConfig(cfg){
 cfg={...cfg,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
 save(ORDERING_CLASSIFICATION_KEY,cfg);
 saveAudit('訂購畫面分類設定',`畫面分類 ${cfg.screenGroups?.length||0} 筆｜訂購狀況群 ${cfg.statusGroups?.length||0} 筆`);
 if(cloudConfigured()){
  try{await cloudPushKey(ORDERING_CLASSIFICATION_KEY,cfg)}
  catch(e){console.warn('訂購分類設定雲端同步失敗',e);alert('分類設定已儲存，但雲端同步失敗，請稍後重試');}
 }
 return cfg;
}

function productGroupCodeMap(){
 const x=load(PRODUCT_GROUP_CODES_KEY,{});
 return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
}
function splitLegacyProductGroup(raw,index=0){
 const name=String(raw||'').trim();
 const codes=productGroupCodeMap();
 if(codes[name])return {raw:name,code:String(codes[name]||'').trim(),name};
 const m=name.match(/^([A-Za-z]\d{2,3}|\d{3})(.+)$/);
 if(m)return {raw:name,code:m[1].toUpperCase(),name:String(m[2]||'').trim()||name};
 return {raw:name,code:`G${String(index+1).padStart(3,'0')}`,name};
}
function productGroupEditorRows(){
 return (load(K.productGroups,[])||[]).map((x,i)=>splitLegacyProductGroup(x,i));
}
async function saveProductGroupEditorRows(editorRows){
 if(!canEditGlobalProductMaster())return alert('只有總店具商品管理權限的人員可以修改品群');
 const rows=(Array.isArray(editorRows)?editorRows:[]).map(x=>({
  raw:String(x.raw||'').trim(),
  code:String(x.code||'').trim().toUpperCase(),
  name:String(x.name||'').trim()
 }));
 if(rows.some(x=>!x.code||!x.name))return alert('品群代碼與名稱都必須填寫');
 if(new Set(rows.map(x=>x.code)).size!==rows.length)return alert('品群代碼不可重複');
 if(new Set(rows.map(x=>x.name)).size!==rows.length)return alert('品群名稱不可重複');

 const rename=new Map(rows.map(x=>[x.raw,x.name]));
 const codeByName=Object.fromEntries(rows.map(x=>[x.name,x.code]));
 const productRows=load(K.products,[]);
 for(const p of productRows){
  const old=String(p.group||'').trim();
  if(rename.has(old))p.group=rename.get(old);
  const name=String(p.group||'').trim();
  if(codeByName[name]){
   p.groupCode=codeByName[name];
   if(!p.orderGroup||rename.has(String(p.orderGroup||'').trim())){
    if(rename.has(String(p.orderGroup||'').trim()))p.orderGroup=rename.get(String(p.orderGroup||'').trim());
   }
   if(String(p.orderGroup||'').trim()===name)p.orderGroupCode=codeByName[name];
  }
 }
 const orderRows=load(K.orders,[]);
 for(const o of orderRows)for(const item of (o.items||[])){
  const old=String(item.group||'').trim();
  if(rename.has(old))item.group=rename.get(old);
  const name=String(item.group||'').trim();
  if(codeByName[name])item.groupCode=codeByName[name];
 }
 const promoRows=load(K.promotionRules,[]);
 for(const r of promoRows){
  if(String(r.targetType||'')!=='品群')continue;
  const old=String(r.target||'').trim();
  if(rename.has(old)){
   r.target=rename.get(old);
   if(r.targetLabel)r.targetLabel=rename.get(old);
  }
 }
 const ruleCfg=load('yj_ordering_rules',{})||{};
 if(Array.isArray(ruleCfg.weekdays)){
  for(const r of ruleCfg.weekdays){
   if(!['品群','品類文字'].includes(String(r.scopeType||'')))continue;
   const parts=String(r.scopeValue||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);
   if(parts.length)r.scopeValue=parts.map(x=>rename.get(x)||x).join('、');
  }
 }

 const names=rows.map(x=>x.name);
 save(K.productGroups,names);
 save(PRODUCT_GROUP_CODES_KEY,codeByName);
 save(K.products,productRows);
 save(K.orders,orderRows);
 save(K.promotionRules,promoRows);
 save('yj_ordering_rules',ruleCfg);
 saveAudit('修改品群代碼／名稱',rows.map(x=>`${x.raw||'新增'}→${x.code} ${x.name}`).join('；'));

 if(cloudConfigured()){
  const results=await Promise.allSettled([
   cloudPushKey(K.productGroups,names),
   cloudPushKey(PRODUCT_GROUP_CODES_KEY,codeByName),
   cloudPushKey(K.products,productRows),
   cloudPushKey(K.promotionRules,promoRows),
   cloudPushKey('yj_ordering_rules',ruleCfg),
   cloudPushKey(K.orders,orderRows)
  ]);
  if(results.some(x=>x.status==='rejected'||x.value===false))alert('品群已儲存，但部分雲端同步失敗，請稍後重新同步');
 }
 return true;
}
function productGroupCodeForName(name){
 const n=String(name||'').trim(),map=productGroupCodeMap();
 if(map[n])return String(map[n]);
 const rows=productGroupEditorRows(),row=rows.find(x=>x.raw===n||x.name===n);
 return row?.code||'';
}

function openProductGroupEditorDialog(){
 if(!requirePermission('productGroup'))return;
 const rows=productGroupEditorRows(),cfg=orderingClassificationConfig(),allGroupNames=rows.map(x=>x.name);
 const kindLabel={fos:'FOS訂購',special:'特殊品訂購',use:'用度品訂購',group:'品群訂購',ledger:'台帳訂購'};
 const screenRows=(cfg.screenGroups||[]).slice().sort((a,b)=>String(a.kind||'').localeCompare(String(b.kind||''))||Number(a.sort||0)-Number(b.sort||0));
 const statusRows=(cfg.statusGroups||[]).slice().sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
 dlg('品群分類管理',`
  <p class="notice">品群代碼與名稱都可以修改。儲存後會同步更新相關商品與訂購資料。</p>
  <div class="table-wrap"><table class="table product-group-edit-table">
   <thead><tr><th>品群代碼</th><th>品群名稱</th><th>操作</th></tr></thead>
   <tbody id="productGroupEditRows">
    ${rows.map((x,i)=>`<tr data-group-edit-row="${i}" data-old-group-name="${esc(x.raw)}">
     <td><input data-group-code="${i}" value="${esc(x.code)}" maxlength="12"></td>
     <td><input data-group-name="${i}" value="${esc(x.name)}"></td>
     <td><button type="button" class="button danger" data-group-edit-remove="${i}">刪除</button></td>
    </tr>`).join('')}
   </tbody>
  </table></div>
  <div class="toolbar product-group-editor-actions">
   <button type="button" class="button" id="addProductGroupRow">＋ 新增品群</button>
   <button type="button" class="primary" id="saveProductGroupRows">儲存品群</button>
  </div>

  <hr style="margin:20px 0">
  <h3>訂購畫面分類設定</h3>
  <p class="notice">這裡控制 FOS／特殊品／用度品等訂購畫面的分類卡片。可修改代碼、名稱、排序、停用，並指定要同步哪些商品品群。</p>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>訂購畫面</th><th>代碼</th><th>分類名稱</th><th>對應商品品群</th><th>排序</th><th>啟用</th><th>操作</th></tr></thead>
   <tbody id="orderingScreenGroupRows">
    ${screenRows.map((x,i)=>`<tr data-screen-group-row="${i}">
      <td><select data-screen-kind="${i}">${['fos','special','use','group','ledger'].map(k=>`<option value="${k}" ${x.kind===k?'selected':''}>${kindLabel[k]}</option>`).join('')}</select></td>
      <td><input data-screen-code="${i}" value="${esc(x.code||'')}" style="width:90px"></td>
      <td><input data-screen-name="${i}" value="${esc(x.name||'')}"></td>
      <td><input data-screen-map="${i}" value="${esc(normalizeGroupNameList(x.productGroups).join('、'))}" placeholder="例如：飯糰、御飯糰"></td>
      <td><input data-screen-sort="${i}" type="number" value="${Number(x.sort||0)}" style="width:80px"></td>
      <td><input data-screen-enabled="${i}" type="checkbox" ${x.enabled!==false?'checked':''}></td>
      <td><button class="button danger" data-screen-remove="${i}">刪除</button></td>
    </tr>`).join('')}
   </tbody>
  </table></div>
  <div class="toolbar"><button class="button" id="addOrderingScreenGroupRow">＋ 新增訂購分類</button></div>

  <hr style="margin:20px 0">
  <h3>訂購狀況一覽分類設定</h3>
  <p class="notice">這裡控制「訂購狀況一覽」的 001、002… 分類。沒有使用的分類可以停用；分類會直接依你指定的商品品群統計。</p>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>代碼</th><th>分類名稱</th><th>對應商品品群</th><th>排序</th><th>啟用</th><th>操作</th></tr></thead>
   <tbody id="orderingStatusGroupRows">
    ${statusRows.map((x,i)=>`<tr data-status-group-row="${i}">
      <td><input data-status-code="${i}" value="${esc(x.code||'')}" style="width:90px"></td>
      <td><input data-status-name="${i}" value="${esc(x.name||'')}"></td>
      <td><input data-status-map="${i}" value="${esc(normalizeGroupNameList(x.productGroups).join('、'))}" placeholder="例如：飯糰、便當、麵食"></td>
      <td><input data-status-sort="${i}" type="number" value="${Number(x.sort||0)}" style="width:80px"></td>
      <td><input data-status-enabled="${i}" type="checkbox" ${x.enabled!==false?'checked':''}></td>
      <td><button class="button danger" data-status-remove="${i}">刪除</button></td>
    </tr>`).join('')}
   </tbody>
  </table></div>
  <div class="toolbar">
   <button class="button" id="addOrderingStatusGroupRow">＋ 新增狀況分類</button>
   <button class="primary" id="saveOrderingClassification">儲存訂購分類設定</button>
   <button class="button" id="syncOrderingClassificationCloud">🔄 從雲端同步</button>
  </div>`);
 setTimeout(()=>{
  const tbody=document.querySelector('#productGroupEditRows');
  const addBtn=document.querySelector('#addProductGroupRow');
  const saveBtn=document.querySelector('#saveProductGroupRows');
  const screenBody=document.querySelector('#orderingScreenGroupRows');
  const statusBody=document.querySelector('#orderingStatusGroupRows');
  const addScreen=document.querySelector('#addOrderingScreenGroupRow');
  const addStatus=document.querySelector('#addOrderingStatusGroupRow');
  const saveClass=document.querySelector('#saveOrderingClassification');
  const syncClass=document.querySelector('#syncOrderingClassificationCloud');
  if(!tbody||!addBtn||!saveBtn)return;
  const bindRemove=()=>tbody.querySelectorAll('[data-group-edit-remove]').forEach(btn=>{
   btn.onclick=()=>btn.closest('tr')?.remove();
  });
  bindRemove();
  addBtn.onclick=()=>{
   const idx=Date.now();
   const tr=document.createElement('tr');
   tr.dataset.groupEditRow=String(idx);
   tr.dataset.oldGroupName='';
   tr.innerHTML=`<td><input data-group-code="${idx}" placeholder="例如 086／A05"></td>
    <td><input data-group-name="${idx}" placeholder="品群名稱"></td>
    <td><button type="button" class="button danger" data-group-edit-remove="${idx}">刪除</button></td>`;
   tbody.appendChild(tr);
   bindRemove();
  };
  saveBtn.onclick=async()=>{
   const editor=[...tbody.querySelectorAll('tr[data-group-edit-row]')].map(tr=>{
    const idx=tr.dataset.groupEditRow;
    return {
     raw:tr.dataset.oldGroupName||'',
     code:tr.querySelector(`[data-group-code="${idx}"]`)?.value||'',
     name:tr.querySelector(`[data-group-name="${idx}"]`)?.value||''
    };
   });
   const ok=await saveProductGroupEditorRows(editor);
   if(!ok)return;
   genericDialog.close();
   render('products');
  };
 },0);
}

function productBarcodes(p){
 const rows=Array.isArray(p?.barcodes)?p.barcodes:[p?.barcode];
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
 return [p.code,p.name,p.shortName,p.spec,p.group,p.category,p.deliveryType,p.logistics,...productOrderTypes(p),...productBarcodes(p)]
  .some(v=>String(v||'').toLowerCase().includes(q));
}
function productRow(p){
 return `<tr>
  <td>${esc(p.code||'—')}</td>
  <td>${productDisplayIconHtml(p)} ${esc(p.name)}<small class="product-short-name">${esc(p.shortName||'')}</small></td>
  <td>${esc(p.spec||'—')}</td>
  <td>${esc(p.category||'')}</td>
  <td>${esc(p.group||'其他')}</td>
  <td>${esc(normalizeDeliveryLabel(p.deliveryType||p.logistics||''))}</td>
  <td><small>${productOrderTypes(p).map(esc).join('／')||'不可訂購'}</small></td>
  <td>${money(p.price)}</td>
  <td>${money(p.cost)}</td>
  <td>${productMargin(p).toFixed(1)}%</td>
  <td>${p.stock??0}</td>
  <td>${p.returnable===false?'N':'Y'}</td>
  <td class="product-negative-cell"><label class="table-check"><input type="checkbox" data-product-negative="${p.id}" ${p.allowNegativeStock?'checked':''} ${hasPermission('productEdit')?'':'disabled'}><span>${p.allowNegativeStock?'允許':'禁止'}</span></label></td>
  <td>1倍 ${Number(p.orderMultipleQty||1)} ${esc(p.orderMultipleUnit||'個')}</td>
  <td>${esc(productStatusLabel(p))}</td>
  <td>${canEditGlobalProductMaster()?`<button class="button" data-edit-product="${p.id}">修改</button> <button class="button danger" data-delete-product="${p.id}">刪除</button>`:'僅總店可設定'}</td>
 </tr>`;
}
function readProductForm(){
 const extra=String(document.querySelector('#pba')?.value||'')
  .split(/\n|,|，/).map(x=>x.trim()).filter(Boolean);
 const primary=String(document.querySelector('#pb')?.value||'').trim();
 const generatedPrimary=primary||numericProductBarcode();const barcodes=[...new Set([generatedPrimary,...extra].filter(Boolean))];
 const category=document.querySelector('#pc').value;
 const status=document.querySelector('#pstatus').value;
 return {
  code:document.querySelector('#pcode').value.trim(),
  name:document.querySelector('#pn').value.trim(),
  shortName:document.querySelector('#psn').value.trim(),
  spec:String(document.querySelector('#pspec')?.value||'').trim(),
  barcode:barcodes[0]||'',
  barcodes,
  category,
  group:document.querySelector('#pg').value,
  deliveryType:document.querySelector('#pl').value,
  logistics:document.querySelector('#pl').value,
  orderTypes:[...document.querySelectorAll('[data-product-order-type]:checked')].map(x=>x.value),
  price:Number(document.querySelector('#pp').value||0),
  priceType:document.querySelector('#pPriceType')?.value||'固定售價',
  marketPrice:(document.querySelector('#pPriceType')?.value||'固定售價')==='時價',
  cost:Number(document.querySelector('#pco').value||0),
  stock:Number(document.querySelector('#pst').value||0),
  safeStock:Number(document.querySelector('#psa').value||0),
  maxStock:Number(document.querySelector('#pmax').value||0),
  orderMultipleQty:Math.max(1,Number(document.querySelector('#pmultiple')?.value||1)),
  orderMultipleUnit:['個','包','箱'].includes(String(document.querySelector('#pmultipleUnit')?.value||''))?String(document.querySelector('#pmultipleUnit').value):'個',
  orderMultipleBoxes:(document.querySelector('#pmultipleUnit')?.value==='箱'?Math.max(1,Number(document.querySelector('#pmultiple')?.value||1)):1),
  orderMultiplePacks:(document.querySelector('#pmultipleUnit')?.value==='包'?Math.max(1,Number(document.querySelector('#pmultiple')?.value||1)):1),
  shelfLife:String(document.querySelector('#pshelfLife')?.value||'').trim(),
  returnable:(document.querySelector('#preturnable')?.value||'Y')!=='N',
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
 if(!/^\d+$/.test(String(item.barcode||'')))return '主要條碼只能輸入純數字';
 if(item.barcodes.some(x=>!/^\d+$/.test(String(x||''))))return '商品條碼只能輸入純數字';
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
 if(autoBarcode)autoBarcode.onclick=()=>{const input=document.querySelector('#pb');if(input)input.value=numericProductBarcode()};

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
  <td>${hasPermission('qualityOperate')?`<button class="button" data-fresh-edit="${batch.id}">修改</button> <button class="button danger" data-fresh-waste="${batch.id}">廢棄</button>`:''} ${hasPermission('qualityDelete')?`<button class="button danger" data-fresh-delete="${batch.id}">刪除</button>`:''}</td>
 </tr>`;
}

function normalizeFreshDeliveryType(value){
 const v=String(value||'').trim().toLowerCase();
 if(['fresh_1','鮮食一配','low_1','低溫一配','dairy','乳品'].includes(v))return 'one';
 if(['fresh_2','鮮食二配','low_2','低溫二配'].includes(v))return 'two';
 return '';
}
function isRiceBallProduct(product,item={}){
 const text=[product?.name,product?.category,product?.group,product?.productGroup,item?.product_name,item?.product_code].filter(Boolean).join('｜');
 return /飯糰/.test(text);
}
function freshExpiryByReceivingRule(receivedAt,deliveryType,riceBall){
 const d=new Date(receivedAt);
 if(Number.isNaN(d.getTime()))return null;
 const slot=normalizeFreshDeliveryType(deliveryType);
 if(!slot)return null;
 // 進貨當天算第 1 天：飯糰 +1 天；一配一般鮮食 +2 天；二配一般鮮食 +3 天。
 const addDays=riceBall?1:(slot==='one'?2:3);
 d.setDate(d.getDate()+addDays);
 d.setHours(slot==='one'?23:17,0,0,0);
 return d;
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
  <label>鮮食商品<select id="freshProductSelect" ${existing?.autoCreated?'disabled':''}>${freshProducts.map(p=>`<option value="${p.id}" ${existing?.productId===p.id?'selected':''}>${esc(p.code||'—')}｜${esc(p.name)}｜庫存 ${Number(p.stock||0)}｜${esc(productBarcodes(p)[0]||'無條碼')}</option>`).join('')}</select></label>
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

   const receivedDate=new Date(received.value),expiryDate=new Date(expiry.value);
   if(Number.isNaN(receivedDate.getTime())||Number.isNaN(expiryDate.getTime()))return alert('進貨時間或到期時間格式錯誤');
   const rows=freshBatches();
   if(rows.some(x=>x.id!==existing?.id&&x.batchNo===batchNo))return alert('批次號不可重複');

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

function printAllProductBarcodes(){
 if(!requirePermission('productPrint'))return;
 const rows=products();
 if(!rows.length)return alert('目前沒有商品可列印');
 const labels=[];
 rows.forEach(p=>{
  const bars=productBarcodes(p);
  bars.forEach((code,i)=>labels.push(`<section class="product-barcode-print-label"><div class="product-barcode-print-name">${esc(p.name||'未命名商品')}</div><div class="product-barcode-print-meta">商品代號：${esc(p.code||'—')}${bars.length>1?`　條碼 ${i+1}/${bars.length}`:''}</div><div class="product-barcode-print-svg">${autoBarcodeHtml(code,{height:58,moduleWidth:1.15,quiet:8,showText:false})}</div></section>`));
 });
 if(!labels.length)return alert('目前商品沒有可列印的條碼');
 const body=`<div class="product-barcode-print-summary">商品 ${rows.length} 項｜條碼 ${labels.length} 個</div><div class="product-barcode-print-grid">${labels.join('')}</div>`;
 printHTML('商品管理 2.0｜全部商品條碼',body);
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
function saleStatusClass(s){return ['已整筆退貨','已作廢'].includes(s.status)?'tx-closed':s.status==='已更正'?'tx-corrected':''}
function transactionItemRows(sale){
 return (sale.items||[]).map((x,i)=>{
  const returned=Number(x.returnedQty||0),remain=Math.max(0,Number(x.qty||0)-returned),changed=returned>0;
  return `<tr class="${changed?'tx-returned-item':''}"><td>${i+1}</td><td><span class="${changed?'tx-strike':''}">${esc(x.name)}</span>${changed?`<small class="tx-return-note">${remain<=0?'已退貨':`更正後數量：${remain}`}｜退貨 ${returned}</small>`:''}</td><td><span class="${changed?'tx-strike':''}">${x.qty}</span></td><td>${money(x.price)}</td><td>${money(Number(x.price||0)*Number(x.qty||0))}</td></tr>`;
 }).join('')||'<tr><td colspan="5">無商品</td></tr>';
}
function transactionHistoryHtml(sale){
 const rows=sale.correctionHistory||[];
 return rows.map(x=>`<div class="tx-history"><b>${esc(x.type)}</b><span>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user||'')}</span><span>原因：${esc(x.reason||'')} ${x.note?`｜${esc(x.note)}`:''}</span><span>退款：${money(x.refund||0)}（現金 ${money(x.cashRefund||0)}／非現金 ${money(x.nonCashRefund||0)}）</span></div>`).join('')||'<p>尚無更正／退貨紀錄</p>';
}

let transactionSelectedId='';
function isEcServiceSale(s){return !!(s&&(s.serviceSale===true||((s.items||[]).length===0&&Number(s.serviceAmount||0)>0)||(s.items||[]).some(i=>i.ecPickup)))}
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
  <td><b>${esc(s.status||'正常')}</b></td>
 </tr>`).join('')||'<tr><td colspan="8" class="empty">查無交易</td></tr>';
}
function transactionReceiptPreview(s,frontMode=false){
 if(!s)return `<div class="tx-receipt-empty"><b>交易明細預覽</b><span>點選交易清單任一筆即可查看完整明細</span></div>`;
 const corrected=s.status==='已更正';
 const itemHtml=(s.items||[]).map(x=>{
  const returned=Number(x.returnedQty||0),qty=Math.max(0,Number(x.qty||0)-returned),line=Number(x.price||0)*qty;
  return `<div class="tx-receipt-item ${returned?'is-corrected':''}">
   <div><b>${esc(x.name||'商品')}</b><small>${esc(x.code||x.barcode||'')}</small></div>
   <div>${money(x.price)} × ${qty}</div><strong>${money(line)}</strong>
   ${returned?`<small class="tx-receipt-return">原 ${x.qty}｜已退 ${returned}</small>`:''}
  </div>`;
 }).join('')||'<div class="tx-receipt-empty-line">無商品明細</div>';
 const promo=Number(s.promotionDiscount||0),manual=Number(s.manualDiscount||0),discount=Number((s.discountTotal??s.discount??(promo+manual))||0);
 const breakdown=(s.paymentBreakdown||[]).map(x=>`<div class="tx-receipt-line"><span>${esc(x.label||x.method||'付款')}</span><b>${money(x.amount||0)}</b></div>`).join('');
 const returnCode=makeReturnCode(s.id);
 let barcode='';try{barcode=code128Svg(returnCode||s.id,{height:45,moduleWidth:1.15,quiet:8,showText:true})}catch(e){barcode=`<div class="barcode-fallback">${esc(returnCode||s.id)}</div>`}
 return `<div class="tx-receipt-paper ${saleStatusClass(s)}">
  <div class="tx-receipt-brand"><b>億家 POS</b><span>交易明細預覽</span></div>
  <div class="tx-receipt-meta">
   <div><span>日期時間</span><b>${new Date(s.at).toLocaleString('zh-TW')}</b></div>
   <div><span>機號</span><b>${txMachineNo()}</b></div>
   <div><span>交易序號</span><b>${esc(s.id)}</b></div>
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
  <div class="tx-receipt-line"><span>付款方式</span><b>${esc([s.payment,s.paymentSubtype].filter(Boolean).join('｜')||'—')}</b></div>
  ${breakdown}
  ${s.payment==='現金'?`<div class="tx-receipt-line"><span>實收</span><b>${money(s.tendered||s.cashAmount||saleNet(s))}</b></div><div class="tx-receipt-line"><span>找零</span><b>${money(s.change||0)}</b></div>`:''}
  ${s.memberName?`<div class="tx-receipt-line"><span>會員</span><b>${esc(s.memberName)} ${esc(s.memberPhone||'')}</b></div>`:''}
  ${s.memberName?`<div class="tx-member-points">
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
   <button class="button tx-correct-btn" data-tx-correct="${esc(s.id)}" data-tx-front="0" ${s.locked?'disabled':''}>交易更正</button>
   <button class="button danger" data-tx-return="${esc(s.id)}" data-tx-front="0" ${s.locked?'disabled':''}>整筆退貨</button>
   <button class="button danger" data-tx-void="${esc(s.id)}" data-tx-front="0" ${s.locked?'disabled':''}>整筆作廢</button>
  </div>
  ${(s.correctionHistory||[]).length?`<details class="tx-receipt-history"><summary>更正／退貨紀錄（${s.correctionHistory.length}）</summary>${transactionHistoryHtml(s)}</details>`:''}
 </div>`;
}

function formatCashDifference(value){
 const n=Number(value||0);
 if(n>0)return `+${money(n)}`;
 if(n<0)return `-${money(Math.abs(n))}`;
 return '$0';
}
function handoverCloudSummaryPanel(){
 const rows=load(K.handovers,[]);
 const latest=rows[0]||null;
 if(!latest)return `<div class="panel" style="margin-bottom:14px"><div class="page-head"><h3>POS 交班同步</h3><span>尚無交班紀錄</span></div></div>`;
 return `<div class="panel" style="margin-bottom:14px"><div class="page-head"><h3>POS 交班同步</h3><span>${esc(new Date(latest.at).toLocaleString('zh-TW'))}</span></div>
  <div class="metric-grid">
   <div class="metric"><small>交班帳號</small><strong>${esc(latest.fromAccount||latest.from||'—')}</strong></div>
   <div class="metric"><small>投庫小計</small><strong>${money(latest.depositAmount||0)}</strong></div>
   <div class="metric"><small>交易筆數</small><strong>${Number(latest.transactionCount||0)}</strong></div>
   <div class="metric"><small>交易作廢張數</small><strong>${Number(latest.voidCount||0)}</strong></div>
   <div class="metric"><small>現金收入</small><strong>${money(latest.cashRevenue||0)}</strong></div>
   <div class="metric"><small>現金短溢收</small><strong>${formatCashDifference(latest.cashDifference||0)}</strong></div>
  </div></div>`;
}
function transactionMasterDetailPage(frontMode=false){
 const rows=load(K.sales,[]).filter(s=>!isEcServiceSale(s));
 const selected=rows.find(x=>x.id===transactionSelectedId)||rows[0]||null;
 transactionSelectedId=selected?.id||'';
 const statusOptions=['全部','正常','已更正','已整筆退貨','已作廢'];
 return `<div class="page-head tx-page-head"><div><h2>交易存根</h2><small>點選交易清單後直接顯示完整交易明細；EC 包裹取貨不列入交易查詢。</small></div></div>
 <div class="panel tx-filter-panel">
  <div class="tx-filter-grid">
   <label>類型<select id="transactionType">${statusOptions.map(x=>`<option>${x}</option>`).join('')}</select></label>
   <label>交易日期<input id="transactionDate" type="date"></label>
   <label>商品代碼／條碼<input id="transactionProduct" placeholder="商品代號、條碼或名稱"></label>
   <label>收銀員<input id="transactionCashier" placeholder="收銀員"></label>
   <label>發票號碼<input id="transactionInvoice" placeholder="有開立時可查"></label>
   <label>交易序號<input id="transactionNo" placeholder="例如 T178..."></label>
  </div>
  <div class="tx-filter-actions"><button class="primary" id="transactionQueryBtn">查詢</button><button class="button" id="transactionClearBtn">清除</button><button class="button" data-action="print-transactions">列印清單</button></div>
 </div>
 <div class="tx-master-detail">
  <div class="panel tx-master-panel"><div class="tx-master-summary"><b>交易清單</b><span id="transactionCount">${rows.length} 筆</span></div><div class="table-wrap tx-master-scroll"><table class="table tx-master-table"><thead><tr><th>選</th><th>機號</th><th>交易日期時間</th><th>交易序號</th><th>發票號碼</th><th>收銀員</th><th>銷售金額</th><th>狀態</th></tr></thead><tbody id="transactionRows">${transactionBackRowsHtml(rows,transactionSelectedId)}</tbody></table></div></div>
  <aside class="panel tx-detail-panel"><div id="transactionDetailPane">${transactionReceiptPreview(selected,false)}</div></aside>
 </div>`;
}
function transactionPage(frontMode=false){return transactionMasterDetailPage(frontMode)}

let transactionCloudPulledAt=0,transactionCloudPulling=false;
async function scheduleTransactionCloudRefresh(pageName){
 if(!cloudConfigured()||transactionCloudPulling||Date.now()-transactionCloudPulledAt<12000)return;
 transactionCloudPulling=true;transactionCloudPulledAt=Date.now();
 try{
  await cloudPullKey(K.sales);
  const target=String(pageName||'transactions');
  if(document.body.dataset.mode==='front'&&target==='transactions-front')render('transactions-front');
  else if(document.body.dataset.mode==='back'&&target==='transactions')render('transactions');
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
function openTransactionDetail(id){
 const s=load(K.sales,[]).find(x=>x.id===id);if(!s)return alert('找不到交易');
 dlg('交易明細',`<div class="tx-detail-head ${saleStatusClass(s)}"><p><b>交易編號：</b>${esc(s.id)}</p><p><b>時間：</b>${new Date(s.at).toLocaleString('zh-TW')}</p><p><b>狀態：</b>${esc(s.status||'正常')}</p><p><b>原交易金額：</b>${money(s.total)}　<b>目前淨額：</b>${money(saleNet(s))}</p></div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>商品</th><th>原數量</th><th>單價</th><th>原小計</th></tr></thead><tbody>${transactionItemRows(s)}</tbody></table></div><h3>更正／退貨紀錄</h3>${transactionHistoryHtml(s)}<p class="tx-no-print">更正與退貨完成後不另外產生退貨明細；補印時會列印目前交易狀態與更正後內容。</p>`);
}
function openTransactionCorrection(id,frontMode){
 const sale=load(K.sales,[]).find(x=>x.id===id);if(!sale)return alert('找不到交易');if(sale.locked)return alert('此交易已鎖定');
 const reasonOptions=['客人不要','商品瑕疵','收銀刷錯','重複刷到','店長核准','其他'];
 dlg('交易更正／部分退貨',`<p>交易：${esc(sale.id)}｜目前淨額 ${money(saleNet(sale))}</p><div class="tx-correction-list">${(sale.items||[]).map((x,i)=>{const available=Math.max(0,Number(x.qty||0)-Number(x.returnedQty||0));return `<label class="tx-correction-row"><span><b>${esc(x.name)}</b><small>原數量 ${x.qty}｜已退 ${x.returnedQty||0}｜可退 ${available}</small></span><input type="number" min="0" max="${available}" value="0" data-tx-return-qty="${x.lineId||`${sale.id}-L${i+1}`}"></label>`}).join('')}</div><label>更正原因<select id="txReason">${reasonOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><label>備註<input id="txReasonNote" placeholder="選填"></label><p class="tx-no-print">完成後不列印退貨／更正明細。</p><button class="primary" id="txCorrectionSave">確認交易更正</button>`);
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
      genericDialog.close();
      render(frontMode?'transactions-front':'transactions');
    }catch(err){alert(err.message)}
  };
},0);
}
function confirmWholeTransaction(id,type,frontMode){
 if(!frontMode){const key=type==='void'?'transactionBackVoid':'transactionBackCorrect';if(!requirePermission(key))return}
 const sale=load(K.sales,[]).find(x=>x.id===id);if(!sale)return alert('找不到交易');if(sale.locked)return alert('此交易已鎖定');
 const reasons=type==='void'?['誤刷','測試交易','收銀錯誤','系統異常','其他']:['客人取消','客訴退貨','商品瑕疵','系統異常','其他'];
 dlg(type==='void'?'整筆作廢':'整筆退貨',`<p>交易：${esc(sale.id)}｜目前淨額 ${money(saleNet(sale))}</p><label>原因<select id="txWholeReason">${reasons.map(x=>`<option>${x}</option>`).join('')}</select></label><label>備註<input id="txWholeNote" placeholder="選填"></label><p class="tx-warning">此操作會沖回庫存、鮮食批次、營收與送金；完成後交易鎖定，且不列印退貨明細。</p><button class="primary danger" id="txWholeConfirm">確認${type==='void'?'作廢':'整筆退貨'}</button>`);
 setTimeout(()=>document.querySelector('#txWholeConfirm').onclick=()=>{try{closeSale(id,type,txWholeReason.value,txWholeNote.value.trim());reconcileMemberPointsAfterReturn(id);genericDialog.close();render(frontMode?'transactions-front':'transactions')}catch(err){alert(err.message)}},0);
}

function linkedInventoryRules(){return load(K.linkedInventoryRules,[]).filter(Boolean)}
function linkedInventorySettingsPage(){
 if(!isFounder())return`<h2>組合／拆零商品設定</h2><div class="panel"><p>此功能只有創辦人可以使用。</p></div>`;
 const ps=products(),rules=linkedInventoryRules();
 const rows=rules.map(r=>{const parent=ps.find(p=>String(p.code||'').toUpperCase()===String(r.parentCode||'').toUpperCase()),component=ps.find(p=>String(p.code||'').toUpperCase()===String(r.componentCode||'').toUpperCase());return`<tr><td>${esc(r.parentCode||'—')}｜${esc(parent?.name||'找不到商品')}</td><td>${esc(r.componentCode||'—')}｜${esc(component?.name||'找不到商品')}</td><td>1：${Number(r.componentQty||0)}</td><td>${r.inboundSync!==false?'進貨同步':'不處理'}</td><td>${r.saleSync!==false?'整件銷售同步':'不處理'}</td><td>${r.active!==false?'啟用':'停用'}</td><td><button class="button" data-edit-linked-rule="${esc(r.id)}">修改</button> <button class="button danger" data-delete-linked-rule="${esc(r.id)}">刪除</button></td></tr>`}).join('')||'<tr><td colspan="7">尚未設定組合／拆零商品</td></tr>';
 return`<div class="page-head"><h2>🔗 組合／拆零商品設定</h2><div class="toolbar"><button class="button" data-nav="products">← 商品管理</button><button class="primary" data-action="new-linked-rule">＋ 新增設定</button></div></div><div class="notice"><strong>僅創辦人可操作</strong><br><small>訂購／進貨可使用整件商品，POS 可販售整件或拆零商品。拆零銷售只扣拆零商品，不反向扣整件商品。</small></div><div class="panel table-wrap"><table class="table"><thead><tr><th>訂購／整件商品</th><th>拆零商品</th><th>換算</th><th>進貨</th><th>整件銷售</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function openLinkedInventoryRuleForm(existing=null){
 if(!isFounder())return alert('此功能只有創辦人可以使用');
 const ps=products(),x=existing||{};
 const opts=(selected='')=>ps.map(p=>`<option value="${esc(p.code||'')}" ${String(p.code||'')===String(selected||'')?'selected':''}>${esc(p.code||'—')}｜${esc(p.name)}</option>`).join('');
 dlg(existing?'修改組合／拆零設定':'新增組合／拆零設定',`<label>訂購／整件商品<select id="lirParent">${opts(x.parentCode)}</select></label><label>拆零銷售商品<select id="lirComponent">${opts(x.componentCode)}</select></label><label>1 個整件等於幾個拆零商品<input id="lirQty" type="number" min="1" step="1" value="${Number(x.componentQty||1)}"></label><label><input id="lirInbound" type="checkbox" ${x.inboundSync!==false?'checked':''}> 整件進貨時，同步增加拆零商品庫存</label><label><input id="lirSale" type="checkbox" ${x.saleSync!==false?'checked':''}> POS 賣整件時，同步扣除拆零商品庫存</label><label><input id="lirActive" type="checkbox" ${x.active!==false?'checked':''}> 啟用此設定</label><label>備註<input id="lirNote" value="${esc(x.note||'')}"></label><button class="primary" id="lirSave">儲存設定</button>`);
 setTimeout(()=>document.querySelector('#lirSave').onclick=()=>{if(!isFounder())return alert('此功能只有創辦人可以使用');const parentCode=String(lirParent.value||'').trim().toUpperCase(),componentCode=String(lirComponent.value||'').trim().toUpperCase(),componentQty=Math.max(1,Math.floor(Number(lirQty.value||1)));if(!parentCode||!componentCode)return alert('請選擇商品');if(parentCode===componentCode)return alert('整件商品與拆零商品不能相同');const rows=linkedInventoryRules();const duplicate=rows.find(r=>r.id!==x.id&&String(r.parentCode||'').toUpperCase()===parentCode);if(duplicate)return alert('這個整件商品已經有連動設定');const row={id:x.id||uid(),parentCode,componentCode,componentQty,inboundSync:lirInbound.checked,saleSync:lirSale.checked,active:lirActive.checked,note:lirNote.value.trim(),updatedAt:new Date().toISOString(),updatedBy:currentUser().name};if(x.id){const i=rows.findIndex(r=>r.id===x.id);rows[i]=row}else rows.unshift(row);save(K.linkedInventoryRules,rows);saveAudit(existing?'修改組合／拆零設定':'新增組合／拆零設定',`${parentCode} → ${componentCode} ×${componentQty}`);genericDialog.close();render('linked-inventory-settings')},0);
}


function employeeHistoryRows(){return load(K.employeeHistory,[])}
function employeeBlacklistRows(){return load(K.employeeBlacklist,[])}
function employeePreviousStore(employee){
 const rows=employeeHistoryRows()
  .filter(x=>x.employeeId===employee?.id||String(x.account||'')===String(employee?.account||''))
  .sort((a,b)=>new Date(b.leftAt||b.at||0)-new Date(a.leftAt||a.at||0));
 const latest=rows[0];
 return latest?.storeName||latest?.storeCode||employee?.previousStore||employee?.lastStore||'尚無離職門市紀錄';
}
function employeeBlacklistRecord(employee){
 return employeeBlacklistRows().find(x=>x.employeeId===employee?.id||String(x.account||'')===String(employee?.account||''))||null;
}
function recordEmployeeStoreExit(employee){
 if(!employee)return;
 const rows=employeeHistoryRows();
 const s=store();
 rows.unshift({
  id:uid(),employeeId:employee.id,account:employee.account||'',name:employee.name||'',
  storeCode:s.code||'',storeName:s.name||'',leftAt:new Date().toISOString(),
  recordedBy:currentUser()?.name||''
 });
 save(K.employeeHistory,rows);
}
function openEmployeeHistoryBlacklistQuery(){
 if(!requirePermission('employeeHistoryBlacklistQuery'))return;
 const employees=load(K.employees,[]);
 dlg('員工前一間離職店／黑名單查詢',`
  <label>查詢員工
   <select id="ehbEmployee">
    <option value="">— 請選擇員工 —</option>
    ${employees.map(x=>`<option value="${x.id}">${esc(x.name)}｜${esc(x.account||'未設定帳號')}</option>`).join('')}
   </select>
  </label>
  <div id="ehbResult" class="panel" style="margin-top:12px"><p>請先選擇員工。</p></div>`);
 setTimeout(()=>{
  const select=document.querySelector('#ehbEmployee'),box=document.querySelector('#ehbResult');
  const draw=()=>{
   const e=employees.find(x=>x.id===select.value);
   if(!e){box.innerHTML='<p>請先選擇員工。</p>';return}
   const b=employeeBlacklistRecord(e);
   const prior=employeePreviousStore(e);
   box.innerHTML=`
    <div class="metric-grid">
     <div class="metric"><small>員工</small><strong>${esc(e.name)}</strong></div>
     <div class="metric"><small>帳號</small><strong>${esc(e.account||'—')}</strong></div>
     <div class="metric"><small>前一間離職的店</small><strong>${esc(prior)}</strong></div>
     <div class="metric"><small>黑名單</small><strong>${b?.active!==false?'是':'否'}</strong></div>
    </div>
    <div class="panel" style="margin-top:12px">
     <p><b>黑名單原因：</b>${esc(b?.reason||'—')}</p>
     <p><b>設定時間：</b>${b?.updatedAt?new Date(b.updatedAt).toLocaleString('zh-TW'):'—'}</p>
     <p><b>設定人：</b>${esc(b?.updatedBy||'—')}</p>
    </div>
    ${isFounder()?`<div class="panel" style="margin-top:12px">
      <h3>黑名單設定（僅創辦人）</h3>
      <label>狀態<select id="ehbBlacklistActive"><option value="1" ${b?.active!==false&&b?'selected':''}>列入黑名單</option><option value="0" ${!b||b.active===false?'selected':''}>解除黑名單</option></select></label>
      <label>原因<textarea id="ehbBlacklistReason" rows="3">${esc(b?.reason||'')}</textarea></label>
      <button class="primary" id="ehbBlacklistSave">儲存黑名單設定</button>
     </div>`:''}`;
   if(isFounder()){
    const saveBtn=document.querySelector('#ehbBlacklistSave');
    if(saveBtn)saveBtn.onclick=()=>{
     const rows=employeeBlacklistRows(),idx=rows.findIndex(x=>x.employeeId===e.id);
     const row={id:b?.id||uid(),employeeId:e.id,account:e.account||'',name:e.name||'',active:ehbBlacklistActive.value==='1',reason:ehbBlacklistReason.value.trim(),updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
     if(idx>=0)rows[idx]=row;else rows.unshift(row);
     save(K.employeeBlacklist,rows);
     saveAudit(row.active?'列入員工黑名單':'解除員工黑名單',`${e.name}｜${row.reason||'未填原因'}`);
     draw();
    };
   }
  };
  select.onchange=draw;
 },0);
}

let adminOrderingSelectedProductId='';
let adminOrderingPolicyProductId='';

function orangeOrderDraftQty(p,{ai=false}={}){
 return load(K.orders,[])
  .filter(o=>['未傳輸','已建立','部分傳輸'].includes(o.status||'已建立')&&!!o.aiGenerated===!!ai)
  .flatMap(o=>o.items||[])
  .filter(x=>String(x.productId)===String(p.id))
  .reduce((s,x)=>s+Number(x.qty||0),0);
}
function currentFosWeekOffset(){
 const raw=Number(sessionStorage.getItem('yj_sc_fos_week_offset')||0);
 const safe=Math.max(-1,Math.min(0,Number.isFinite(raw)?Math.trunc(raw):0));
 if(raw!==safe)sessionStorage.setItem('yj_sc_fos_week_offset',String(safe));
 return safe;
}
function adminOrderStatsForProduct(p){
 const fosDetail=currentAdminPage()==='ordering-fos-detail';
 const weekly=weeklyProductStats(p,fosDetail?currentFosWeekOffset():0);
 let recommendationQty=0;
 try{recommendationQty=Number(aiRecommendedQty(p,{fresh:isFosFreshProduct(p)})||0)}catch{recommendationQty=0}
 const draftQty=orangeOrderDraftQty(p,{ai:false});
 const systemDraftQty=orangeOrderDraftQty(p,{ai:true});
 const switches=productOrderSwitchState(p);
 const cfg=load(K.systemSettings,{})||{},all=(cfg.productOrderSwitches&&typeof cfg.productOrderSwitches==='object')?cfg.productOrderSwitches:{};
 const row=all[String(p?.id||'')]||{};
 const hasSystemOverride=Object.prototype.hasOwnProperty.call(row,'systemQtyOverride');
 const systemQty=!switches.system?0:(hasSystemOverride?Math.max(0,Math.floor(Number(row.systemQtyOverride||0))):(systemDraftQty||recommendationQty));
 return {weekly,recommendationQty,systemQty,draftQty,systemDraftQty,effectiveQty:draftQty>0?draftQty:systemQty,storeOverridesSystem:draftQty>0&&systemQty>0,hasSystemOverride};
}
function orangeDefaultOrderType(p){
 const allowed=ORDER_TYPES_V531.map(x=>x[0]).filter(type=>orderProductAllowedForType(p,type));
 if(isFosFreshProduct(p)&&allowed.includes('FOS鮮食訂購'))return 'FOS鮮食訂購';
 return allowed[0]||'台帳訂購';
}
function orangeOrderDraftItem(p,qty){
 return {
  productId:p.id,code:p.code||'',name:p.name,spec:String(p.spec||''),barcode:productBarcodes(p)[0]||'',
  group:p.group||'其他',category:p.category||'',
  deliveryType:normalizeDeliveryLabel(p.deliveryType||p.logistics||''),
  qty:Number(qty||0),multiple:orderMultipleCount(qty,p),packQty:orderPackQty(p),
  stock:Number(p.stock||0)
 };
}
function upsertOrangeOrderDraftQty(p,qty,{ai=false,audit=true}={}){
 if(!p)return false;
 const type=orangeDefaultOrderType(p),switches=productOrderSwitchState(p);
 if(!productOrderTypes(p).length||!orderProductAllowedForType(p,type)){alert('此商品已設定不可訂購');return false;}
 if(!productOrderingAllowedToday(p)){alert('此商品今日不可訂購');return false;}
 if(ai&&!switches.system){alert('此商品的系訂已關閉');return false;}
 if(!ai&&!switches.store){alert('此商品的店訂已關閉');return false;}
 qty=Math.max(0,Math.floor(Number(qty||0)));
 const rows=load(K.orders,[]);
 const candidates=rows.filter(o=>['未傳輸','已建立','部分傳輸'].includes(o.status||'已建立')&&!!o.aiGenerated===!!ai);
 let target=candidates.find(o=>(o.items||[]).some(x=>String(x.productId)===String(p.id)))||null;
 if(!target&&qty>0){
  target={
   id:`OR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,
   type,deliveryDate:'',items:[],note:ai?'系訂建議草稿':'店訂草稿',
   status:'未傳輸',at:new Date().toISOString(),user:currentUser()?.name||'',aiGenerated:!!ai
  };
  rows.unshift(target);
 }
 if(target){
  const idx=(target.items||[]).findIndex(x=>String(x.productId)===String(p.id));
  if(qty<=0){
   if(idx>=0)target.items.splice(idx,1);
  }else{
   const item=orangeOrderDraftItem(p,qty);
   if(idx>=0)target.items[idx]={...target.items[idx],...item}; else target.items.push(item);
  }
  if(!(target.items||[]).length){
   const orderIndex=rows.findIndex(x=>x.id===target.id);
   if(orderIndex>=0)rows.splice(orderIndex,1);
  }
  if(target)target.updatedAt=new Date().toISOString();
  save(K.orders,rows);
  if(audit)saveAudit(ai?'修改系訂建議草稿':'修改店訂草稿',`${p.code||''}｜${p.name}｜${qty}`);
 }
 return true;
}
let adminOrderingStripPage=0;
function orangeOrderStripHtml(selectable,selected){
 const pageSize=10,maxPage=Math.max(0,Math.ceil(selectable.length/pageSize)-1);
 adminOrderingStripPage=Math.max(0,Math.min(maxPage,adminOrderingStripPage));
 const start=adminOrderingStripPage*pageSize,visible=selectable.slice(start,start+pageSize);
 return `<button class="orange-order-arrow" type="button" data-orange-order-strip="-1" ${adminOrderingStripPage<=0?'disabled':''}>‹</button>
   ${visible.map(p=>`<button type="button" class="orange-order-thumb ${p.id===selected?.id?'active':''}" data-orange-order-product="${p.id}"><span class="orange-order-thumb-icon">${productDisplayIconHtml(p)}</span><small>${esc(p.name)}</small></button>`).join('')||'<span class="muted">目前沒有商品</span>'}
   <button class="orange-order-arrow" type="button" data-orange-order-strip="1" ${adminOrderingStripPage>=maxPage?'disabled':''}>›</button>`;
}
function productActivePromotionRows(p){
 const bars=productBarcodes(p),code=String(p?.code||''),id=String(p?.id||''),group=String(p?.group||'');
 return promotionRows().filter(productLookupPromoActive).filter(x=>{
  if(x.targetType==='品群')return String(x.target||'')===group;
  const targets=[];
  if(Array.isArray(x.productIds))targets.push(...x.productIds.map(String));
  if(Array.isArray(x.products))targets.push(...x.products.map(v=>String(v?.id||v?.code||v||'')));
  targets.push(String(x.target||''),String(x.productId||''),String(x.productCode||''));
  return targets.some(v=>v&&[id,code,...bars].includes(v));
 });
}
function productPendingArrivalDisplay(p,st=null){
 const type=normalizeDeliveryLabel(p?.deliveryType||p?.logistics||'');
 const orders=load(K.orders,[]).filter(o=>(o.items||[]).some(x=>String(x.productId)===String(p?.id))).sort((a,b)=>new Date(b.transmittedAt||b.at||0)-new Date(a.transmittedAt||a.at||0));
 for(const o of orders){
  if(['已取消','取消','已作廢'].includes(o.status))continue;
  const byType=o.deliveryDates?.[type]?.date;
  const d=String(byType||o.deliveryDate||'').trim();
  if(d){const today=localDateKey();if(d>=today||['未傳輸','已建立','部分傳輸'].includes(o.status||'未傳輸'))return d;}
 }
 const state=st||adminOrderStatsForProduct(p);
 if(Number(state?.effectiveQty||0)>0){const expected=orderingExpectedArrival(type,new Date(),{...p,deliveryType:type});if(expected.date)return expected.date;}
 return '—';
}
function isPromotionAutoArrivalOrder(o,item,p){
 const text=[o?.source,o?.type,o?.note,item?.source,item?.note].map(v=>String(v||'')).join('｜');
 return /活動商品自動到店|活動到店|promotion.?auto.?arrival/i.test(text);
}
const ORDER_RESERVATIONS_KEY='yj_order_reservations';
function orderReservationRows(){const x=load(ORDER_RESERVATIONS_KEY,[]);return Array.isArray(x)?x:[]}
function currentOrderDetailKind(){const p=currentAdminPage();return p==='ordering-fos-detail'?'fos':p==='ordering-group-detail'?'group':''}
function reservationEnabledForCurrentOrderDetail(){return ['fos','group'].includes(currentOrderDetailKind())}
function orderReservationQty(p){return orderReservationRows().filter(x=>x.status!=='取消'&&String(x.productId)===String(p?.id)&&String(x.kind||'')===currentOrderDetailKind()).reduce((a,x)=>a+Math.max(0,Number(x.qty||0)),0)}
function orderReservationQtyForLedger(p){
 return orderReservationRows().filter(x=>x.status!=='取消'&&String(x.productId)===String(p?.id)).reduce((a,x)=>a+Math.max(0,Number(x.qty||0)),0);
}
async function setLedgerReservationQty(p,qty){
 qty=Math.max(0,Math.floor(Number(qty||0)));
 const rows=orderReservationRows(),now=new Date().toISOString(),kind='ledger';
 const i=rows.findIndex(x=>x.status!=='取消'&&String(x.productId)===String(p.id)&&String(x.kind||'')===kind);
 if(qty<=0){
  if(i>=0)rows[i]={...rows[i],qty:0,status:'取消',updatedAt:now,updatedBy:currentUser()?.name||''};
 }else{
  const row={id:i>=0?rows[i].id:uid(),productId:p.id,code:p.code||'',name:p.name||'',spec:p.spec||'',qty,kind,source:'台帳訂購',status:'預訂',createdAt:i>=0?rows[i].createdAt:now,updatedAt:now,updatedBy:currentUser()?.name||''};
  if(i>=0)rows[i]=row;else rows.unshift(row);
 }
 save(ORDER_RESERVATIONS_KEY,rows);
 if(cloudConfigured()){try{await cloudPushKey(ORDER_RESERVATIONS_KEY,rows)}catch(e){console.warn('台帳預訂同步失敗',e)}}
 saveAudit('台帳預訂設定',`${p.code||''}｜${p.name}｜${qty}`);
 return true;
}
async function setOrderReservationQty(p,qty){
 qty=Math.max(0,Math.floor(Number(qty||0)));const rows=orderReservationRows(),kind=currentOrderDetailKind(),now=new Date().toISOString();
 let i=rows.findIndex(x=>x.status!=='取消'&&String(x.productId)===String(p.id)&&String(x.kind||'')===kind);
 if(qty<=0){if(i>=0)rows[i]={...rows[i],qty:0,status:'取消',updatedAt:now,updatedBy:currentUser()?.name||''};}
 else{const row={id:i>=0?rows[i].id:uid(),productId:p.id,code:p.code||'',name:p.name||'',spec:p.spec||'',qty,kind,source:kind==='fos'?'FOS訂購':'品群訂購',status:'預訂',createdAt:i>=0?rows[i].createdAt:now,updatedAt:now,updatedBy:currentUser()?.name||''};if(i>=0)rows[i]=row;else rows.unshift(row)}
 save(ORDER_RESERVATIONS_KEY,rows);if(cloudConfigured()){try{await cloudPushKey(ORDER_RESERVATIONS_KEY,rows)}catch(e){console.warn('預訂同步失敗',e)}}saveAudit('預訂設定',`${p.code||''}｜${p.name}｜${qty}`);return true;
}

function orderingSpecifiedDatePage(){
 const ps=products().filter(p=>productStatusLabel(p)!=='停用'&&productOrderTypes(p).length);
 return `${scOrderTabs('specified')}<div class="page-head"><div><h2>指定日訂購</h2><small>設定指定進貨日期後建立訂購草稿</small></div><button class="button" data-nav="ordering">← 返回訂購業務</button></div>
 <section class="panel specified-order-panel">
  <div class="settings-grid">
   <label>指定進貨日期<input id="specifiedOrderDate" type="date" min="${localDateKey()}"></label>
   <label>商品搜尋<input id="specifiedOrderSearch" placeholder="商品代號／條碼／名稱"></label>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr><th>商品代號</th><th>商品名稱</th><th>規格</th><th>配送別</th><th>數量</th><th>加入</th></tr></thead><tbody id="specifiedOrderRows">
   ${ps.map(p=>`<tr data-specified-row data-specified-search="${esc([p.code,p.name,p.spec,...productBarcodes(p)].join(' ').toLowerCase())}"><td>${esc(p.code||'')}</td><td>${esc(p.name||'')}</td><td>${esc(p.spec||'—')}</td><td>${esc(normalizeDeliveryLabel(p.deliveryType||p.logistics||''))}</td><td><input type="number" min="1" value="${orderPackQty(p)}" data-specified-qty="${esc(p.id)}"></td><td><button class="button" data-specified-add="${esc(p.id)}">加入指定日訂購</button></td></tr>`).join('')}
  </tbody></table></div>
 </section>`;
}
async function addSpecifiedDateOrder(p,qty,date){
 if(!p)return false;
 if(!date)return alert('請先選擇指定進貨日期');
 qty=Math.max(1,Math.floor(Number(qty||1)));
 const rows=load(K.orders,[]);
 const order={
  id:`OR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,
  type:'指定日訂購',
  deliveryType:normalizeDeliveryLabel(p.deliveryType||p.logistics||''),
  deliveryDate:date,
  specifiedArrivalDate:date,
  items:[orangeOrderDraftItem(p,qty)],
  status:'未傳輸',
  at:new Date().toISOString(),
  user:currentUser()?.name||'',
  note:'指定日訂購'
 };
 rows.unshift(order);save(K.orders,rows);
 if(cloudConfigured()){try{await cloudPushKey(K.orders,rows)}catch(e){console.warn('指定日訂購同步失敗',e)}}
 saveAudit('指定日訂購',`${p.code||''}｜${p.name}｜${qty}｜${date}`);
 alert(`已加入指定日訂購\n${p.name}\n數量：${qty}\n進貨日：${date}`);
 return true;
}

function orderingReservationsPage(){const rows=orderReservationRows().filter(x=>x.status!=='取消');return `${scOrderTabs('reservations')}<div class="page-head"><div><h2>預約訂購</h2><small>FOS／品群訂購預訂資料</small></div><button class="button" data-nav="ordering">← 返回訂購業務</button></div><div class="panel table-wrap"><table class="table"><thead><tr><th>來源</th><th>商品代號</th><th>商品名稱</th><th>規格</th><th>預訂數</th><th>狀態</th><th>更新時間</th><th>操作</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.source||'')}</td><td>${esc(x.code||'')}</td><td>${esc(x.name||'')}</td><td>${esc(x.spec||'—')}</td><td><b>${Number(x.qty||0)}</b></td><td>${esc(x.status||'預訂')}</td><td>${x.updatedAt?new Date(x.updatedAt).toLocaleString('zh-TW'):'—'}</td><td><button class="button danger" data-cancel-reservation="${esc(x.id)}">取消預訂</button></td></tr>`).join('')||'<tr><td colspan="8">目前沒有預訂資料</td></tr>'}</tbody></table></div>`}

function orangeOrderingProductDetail(p){
 if(!p)return `<div class="orange-order-empty">目前沒有可訂購商品</div>`;
 const st=adminOrderStatsForProduct(p),bars=productBarcodes(p),pack=orderPackQty(p),margin=productMargin(p).toFixed(2);
 const freshSystem=isFosFreshProduct(p);
 const systemPermission=freshSystem?'freshAIOrder':'orderAutoAI';
 const systemSettingsAction=freshSystem?'fresh-ai-settings':'auto-order-settings';
 const systemSettingsTitle=freshSystem?'鮮食 AI 設定':'系訂值設定';
 const orderable=productOrderTypes(p).length>0&&productStatusLabel(p)!=='停用';
 const dayState=productOrderingDayState(p),dayAllowed=dayState.allowed;
 const perProductSwitch=productOrderSwitchState(p),storeEnabled=orderable&&dayAllowed&&perProductSwitch.store,systemEnabled=orderable&&dayAllowed&&perProductSwitch.system;
 const displayStoreQty=dayAllowed?st.draftQty:0,displaySystemQty=dayAllowed?st.systemQty:0;
 const promos=productActivePromotionRows(p),arrivalDate=productPendingArrivalDisplay(p,st);
 return `<div class="orange-order-main">
  <div class="orange-order-image">
   <div class="orange-order-big-icon">${p.icon||'📦'}</div>
   <div class="orange-order-namebar">${esc(p.name)}</div>
  </div>
  <div class="orange-order-info">
   <h2>商品名稱：${esc(p.name)}</h2>
   <div class="orange-order-info-grid">
    <span>商品代號：</span><b>${esc(p.code||'—')}</b>
    <span>規格：</span><b>${esc(p.spec||p.specification||bars[0]||'—')}</b>
    <span>售價：</span><b>${money(p.price)}</b>
    <span>入數：</span><b>${pack}</b>
   </div>
   <label class="orange-order-promo"><span>商品活動</span><select disabled title="同步總部商品活動設定">${promos.length?promos.map(x=>`<option>${esc([x.name,x.summary].filter(Boolean).join('｜'))}</option>`).join(''):'<option>目前無符合活動</option>'}</select></label>
   <div class="orange-order-attr-grid">
    <span>毛利%：</span><b>${margin}</b>
    <span>不良退：</span><b>${p.returnable===false?'N':'Y'}</b>
    <span>保存期限：</span><b>${esc(p.shelfLife||(p.expiryDays?`D${p.expiryDays}`:'—'))}</b>
    <span>商品ABC：</span><b>${esc(p.abc||'—')}</b>
    <span>銷轉訂：</span><b>${p.salesToOrder?'銷轉訂':'非銷轉訂'}</b>
    <span>進貨日：</span><b>${esc(arrivalDate)}</b>
    <span>庫存數：</span><b>${Number(p.stock||0)}</b>
   </div>
   <div class="orange-order-mode-buttons">
    ${orderable?(ORDER_TYPES_V531.filter(([type])=>!['台帳訂購','品群訂購'].includes(type)&&orderProductAllowedForType(p,type)).map(([type,icon])=>`<button class="button" data-v531-order-type="${esc(type)}">${icon} ${esc(type)}</button>`).join('')||'<span class="muted">此商品目前沒有其他可訂購類型</span>'):'<span class="muted"><b>此商品已設定不可訂購</b></span>'}
   </div>
   <div class="orange-order-shortcuts"><button type="button" class="button order-favorite-toggle ${orderFavoriteHas(p.id)?'is-added':''}" data-action="order-favorite-toggle" data-order-favorite-id="${esc(p.id)}">${orderFavoriteHas(p.id)?'🩵 已加入常訂購商品':'＋ 加入常訂購商品'}</button></div>
   ${hasPermission('orderFacePrint')?`<div class="orange-order-face-wrap"><div><button type="button" class="orange-order-face-button" data-action="order-product-face" data-face-product-id="${esc(p.id)}" title="加入 FACE 卡列印清單">FACE</button><small class="orange-order-face-cart-hint">FACE清單：${faceCartLoad().ids.length}項／${faceCartLoad().ids.reduce((sum,x)=>sum+faceCardQty(x),0)}張</small></div></div>`:''}
  </div>
  <div class="orange-order-qty">
   <label class="orange-order-qty-card store ${storeEnabled?'':'is-disabled'}">
    <button type="button" class="orange-order-system-toggle ${storeEnabled?'is-on':'is-off'}" data-product-order-switch="store" data-product-order-id="${p.id}" data-product-order-value="${perProductSwitch.store?'0':'1'}" ${orderable&&dayAllowed?'':'disabled'} title="${!dayAllowed?'今日不可訂購':(perProductSwitch.store?'關閉此商品店訂':'開啟此商品店訂')}">${storeEnabled?'✅':'❌'}</button>
    <b>店訂</b><input type="number" min="0" inputmode="numeric" value="${displayStoreQty}" data-orange-order-store-qty="${p.id}" ${storeEnabled?'':'disabled'}><small>${!orderable?'此商品不可訂購':(!dayAllowed?'今日不可訂購':(!perProductSwitch.store?'此商品店訂已關閉':(st.draftQty>0?'✅ 店訂已輸入，傳輸時取代系訂':'店訂可獨立設定')))}</small>
   </label>
   ${reservationEnabledForCurrentOrderDetail()?`<label class="orange-order-qty-card reservation"><b>預訂</b><input type="number" min="0" inputmode="numeric" value="${orderReservationQty(p)}" data-orange-order-reservation-qty="${p.id}"><small>${currentOrderDetailKind()==='fos'?'FOS 預訂':'品群訂購預訂'}；獨立保存於預約訂購。</small></label>`:''}
   <label class="orange-order-qty-card system ${st.storeOverridesSystem?'is-overridden':''} ${systemEnabled?'':'is-disabled'}">
    <button type="button" class="orange-order-system-toggle ${systemEnabled?'is-on':'is-off'}" data-product-order-switch="system" data-product-order-id="${p.id}" data-product-order-value="${perProductSwitch.system?'0':'1'}" ${orderable&&dayAllowed&&hasPermission(systemPermission)?'':'disabled'} title="${!dayAllowed?'今日不可訂購':(perProductSwitch.system?'關閉此商品系訂':'開啟此商品系訂')}">${systemEnabled?'✅':'❌'}</button>
    <button type="button" class="orange-order-system-settings" data-action="${systemSettingsAction}" data-order-policy-product="${p.id}" ${hasPermission(systemPermission)?'':'disabled'} title="查看系訂值跟設定">！</button>
    <b>系訂</b><input type="number" min="0" inputmode="numeric" value="${displaySystemQty}" data-orange-order-system-qty="${p.id}" ${systemEnabled?'':'disabled'}><small>${!orderable?'此商品不可訂購':(!dayAllowed?'今日不可訂購':(!perProductSwitch.system?'此商品系訂已關閉':(st.storeOverridesSystem?'此數字不會傳出，已由店訂取代':(freshSystem?'鮮食 AI 輔助訂購':(st.systemDraftQty?'目前系訂草稿':'系訂建議，可直接調整')))))}</small>
   </label>
   <div class="orange-order-effective">本次傳輸數量：<b>${orderable&&dayAllowed?Number((storeEnabled&&st.draftQty>0)?st.draftQty:(systemEnabled?st.systemQty:0)):0}</b> ${!orderable?'（不可訂購）':(!dayAllowed?'（今日不可訂購）':(storeEnabled&&st.draftQty>0?'（店訂）':(systemEnabled?'（系訂）':'（未啟用）')))}</div>
   <div class="orange-order-average">平均銷售數：${((Number(st.weekly?.sales||0))/7).toFixed(1)}</div>
  </div>
 </div>`;
}
function orangeOrderingHistoryTable(p){
 if(!p)return '';
 const daily=adminOrderStatsForProduct(p).weekly?.daily||[];
 const orderQtyByDate={};
 load(K.orders,[]).forEach(o=>{
  const date=String(o.at||o.createdAt||'').slice(0,10);if(!date)return;
  const qty=(o.items||[]).filter(x=>String(x.productId)===String(p.id)&&!isPromotionAutoArrivalOrder(o,x,p)).reduce((s,x)=>s+Number(x.qty||0),0);
  orderQtyByDate[date]=(orderQtyByDate[date]||0)+qty;
 });
 return `<div class="orange-order-history"><table>
  <thead><tr><th>星期／日期</th>${daily.map(d=>`<th>${esc(d.date||'')}</th>`).join('')}</tr></thead>
  <tbody>
   <tr><th>訂購數</th>${daily.map(d=>`<td>${Number(orderQtyByDate[d.key||d.date]||0)}</td>`).join('')}</tr>
   <tr><th>進貨數</th>${daily.map(d=>`<td>${Number(d.in||0)}</td>`).join('')}</tr>
   <tr><th>銷售／推估數</th>${daily.map(d=>`<td>${Number(d.sales||0)}</td>`).join('')}</tr>
   <tr><th>廢棄數</th>${daily.map(d=>`<td>${Number(d.waste||0)}</td>`).join('')}</tr>
  </tbody>
 </table></div>`;
}
const ORDER_RULE_WEEKDAYS=[['1','一'],['2','二'],['3','三'],['4','四'],['5','五'],['6','六'],['0','日']];
function defaultOrderingRules(){
 return {
  delivery:[
   {id:'normal',name:'常溫',deliveryType:'常溫',cutoff:'22:00',arrivalDays:2,arrivalPeriod:'半夜',active:true},
   {id:'low2',name:'低溫二配',deliveryType:'低溫二配',cutoff:'10:00',arrivalDays:1,arrivalPeriod:'早上',active:true},
   {id:'fresh2',name:'鮮食二配',deliveryType:'鮮食二配',cutoff:'10:00',arrivalDays:2,arrivalPeriod:'早上',active:true},
   {id:'low1',name:'低溫一配',deliveryType:'低溫一配',cutoff:'22:00',arrivalDays:2,arrivalPeriod:'半夜',active:true},
   {id:'fresh1',name:'鮮食一配',deliveryType:'鮮食一配',cutoff:'22:00',arrivalDays:2,arrivalPeriod:'半夜',active:true},
   {id:'frozen',name:'冷凍',deliveryType:'冷凍',cutoff:'22:00',arrivalDays:2,arrivalPeriod:'半夜',active:true},
   {id:'yijiatong',name:'億家通',deliveryType:'億家通',cutoff:'22:00',arrivalDays:2,arrivalPeriod:'半夜',active:true,note:'一般商品／部分備品：2天後半夜；預購／團購／EC：依系統或訂單指定日期'}
  ],
  weekdays:[
   {id:'monwedfri',name:'餅乾／泡麵／備品／日用品',scopeType:'品類文字',scopeValue:'餅乾,泡麵,備品,日用品',days:['1','3','5'],active:true},
   {id:'tuethusun',name:'特殊用品／冰塊',scopeType:'品類文字',scopeValue:'特殊用品,冰塊',days:['2','4','0'],active:true},
   {id:'low-all',name:'低溫所有配別',scopeType:'配送別',scopeValue:'低溫一配,低溫二配',days:['0','1','2','3','4','5','6'],active:true},
   {id:'fresh-all',name:'鮮食所有配別',scopeType:'配送別',scopeValue:'鮮食一配,鮮食二配',days:['0','1','2','3','4','5','6'],active:true},
   {id:'drink-all',name:'飲料／酒／水',scopeType:'品類文字',scopeValue:'飲料,酒,水',days:['0','1','2','3','4','5','6'],active:true}
  ],
  mode:'framework',updatedAt:''
 };
}
function orderingRules(){
 const saved=load(K.orderRules,null),base=defaultOrderingRules();
 if(!saved||typeof saved!=='object')return base;
 const savedDelivery=Array.isArray(saved.delivery)?saved.delivery:[];
 // 新增配送別時不覆蓋既有使用者設定；以 id／配送別合併預設規則。
 const delivery=base.delivery.map(def=>{
  const old=savedDelivery.find(x=>String(x.id||'')===String(def.id)||normalizeDeliveryLabel(x.deliveryType||x.name||'')===normalizeDeliveryLabel(def.deliveryType));
  return old?{...def,...old}:def;
 });
 savedDelivery.forEach(x=>{if(!delivery.some(v=>String(v.id||'')===String(x.id||'')||normalizeDeliveryLabel(v.deliveryType||v.name||'')===normalizeDeliveryLabel(x.deliveryType||x.name||'')))delivery.push(x)});
 return {...base,...saved,delivery,weekdays:Array.isArray(saved.weekdays)?saved.weekdays:base.weekdays};
}
function orderingRuleTokens(value){return String(value||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean)}

function orderingSwitchState(now=new Date()){
 const mins=now.getHours()*60+now.getMinutes();
 if(mins>=21*60+59&&mins<22*60+2)return {phase:'statistics',locked:true,label:'系統訂購統計中，22:02 開放隔日訂購'};
 if(mins>=22*60+2){const d=new Date(now);d.setDate(d.getDate()+1);return {phase:'next-day',locked:false,label:'隔日訂購',date:d};}
 return {phase:'today',locked:false,label:'當日訂購',date:new Date(now)};
}
function orderingEffectiveDate(now=new Date()){
 const st=orderingSwitchState(now);return st.date?new Date(st.date):new Date(now);
}
function orderingDateKey(now=new Date()){return localDateKey(orderingEffectiveDate(now))}
function orderingIsStatisticsLock(now=new Date()){return orderingSwitchState(now).locked===true}
function orderingSwitchBanner(){
 const st=orderingSwitchState();
 if(st.locked)return `<div class="notice" style="border-color:#f0a000;background:#fff7df"><b>🔒 訂購統計中</b>｜21:59～22:01:59 禁止傳輸，22:02 後自動切換隔日訂購曆。</div>`;
 return `<div class="notice"><b>📅 訂購曆：${esc(orderingDateKey())}</b>｜${st.phase==='next-day'?'22:02 後已切換隔日訂購':'目前為當日訂購'}。</div>`;
}

function orderingRuleMatchesItem(rule,item){
 if(!rule||rule.active===false)return false;
 const tokens=orderingRuleTokens(rule.scopeValue);
 if(!tokens.length)return false;
 const type=String(rule.scopeType||'品類文字');
 const vals={
  delivery:String(normalizeDeliveryLabel(item?.deliveryType||'')).trim(),
  group:String(item?.group||'').trim(),
  category:String(item?.category||'').trim(),
  productId:String(item?.productId||'').trim(),
  code:String(item?.code||'').trim(),
  name:String(item?.name||'').trim()
 };
 if(type==='配送別')return tokens.includes(vals.delivery);
 if(type==='品群')return tokens.includes(vals.group);
 if(type==='類別')return tokens.includes(vals.category);
 if(type==='商品')return tokens.some(t=>[vals.productId,vals.code,vals.name].includes(t));
 // 品類文字：只比對已建入商品主檔的明確分類／品群；未建或未分類商品不會被誤擋。
 return tokens.some(t=>t===vals.category||t===vals.group);
}
function orderingWeekdayViolation(items,now=new Date()){
 const cfg=orderingRules(),effective=orderingEffectiveDate(now),today=String(effective.getDay()),bad=[];
 for(const item of items||[]){
  const matched=(cfg.weekdays||[]).filter(r=>orderingRuleMatchesItem(r,item));
  if(!matched.length)continue;
  if(matched.some(r=>(r.days||[]).map(String).includes(today)))continue;
  bad.push({item,rules:matched});
 }
 return bad;
}
function productOrderingDayState(p,now=new Date()){
 const item={productId:p?.id,code:p?.code||'',name:p?.name||'',group:p?.group||'',category:p?.category||'',deliveryType:normalizeDeliveryLabel(p?.deliveryType||p?.logistics||'')};
 const bad=orderingWeekdayViolation([item],now);
 return {allowed:bad.length===0,reason:bad.length?'今日不可訂購':''};
}
function productOrderingAllowedToday(p,now=new Date()){return productOrderingDayState(p,now).allowed}
function orderingDeliveryRule(deliveryType){
 const type=normalizeDeliveryLabel(deliveryType||'');
 return (orderingRules().delivery||[]).find(r=>r.active!==false&&normalizeDeliveryLabel(r.deliveryType||r.name||'')===type)||null;
}
function orderingCutoffViolation(items,now=new Date()){
 if(orderingIsStatisticsLock(now))return [{deliveryType:'全部訂購',rule:{cutoff:'22:02',note:'21:59～22:01:59 系統自動統計'}}];
 const rawMins=now.getHours()*60+now.getMinutes(),mins=rawMins>=22*60+2?-1:rawMins,bad=[];
 const seen=new Set();
 for(const item of items||[]){
  const type=normalizeDeliveryLabel(item?.deliveryType||'');
  if(seen.has(type))continue;seen.add(type);
  const r=orderingDeliveryRule(type);if(!r?.cutoff)continue;
  const [h,m]=String(r.cutoff).split(':').map(Number),limit=(Number(h)||0)*60+(Number(m)||0);
  if(mins>=limit)bad.push({deliveryType:type,rule:r});
 }
 return bad;
}
function isYijiaTongSpecifiedDateItem(item){
 if(normalizeDeliveryLabel(item?.deliveryType||'')!=='億家通')return false;
 const text=[item?.group,item?.category,item?.orderType,item?.productType,item?.fulfillmentType,item?.orderClass].map(v=>String(v||'')).join('｜');
 return /預購|團購|EC/i.test(text);
}
function yijiaTongSpecifiedArrivalDate(item){
 return String(item?.specifiedArrivalDate||item?.arrivalDate||item?.deliveryDate||item?.orderDeliveryDate||'').trim();
}
function isEcOrderingItem(item){
 const text=[
  item?.group,item?.category,item?.orderType,item?.productType,
  item?.fulfillmentType,item?.orderClass,item?.source,item?.sourceType
 ].map(v=>String(v||'')).join('｜');
 return /(^|[^A-Z])EC([^A-Z]|$)|EC取貨|EC物流|電商/i.test(text);
}
function adjustSundayNoDelivery(type,dateObj,item=null){
 const delivery=normalizeDeliveryLabel(type||'');
 const blocked=['常溫','冷凍','億家通'].includes(delivery);
 if(!blocked||dateObj.getDay()!==0)return dateObj;
 // EC 物流例外：星期日仍可進貨。
 if(delivery==='億家通'&&item&&isEcOrderingItem(item))return dateObj;
 const d=new Date(dateObj.getFullYear(),dateObj.getMonth(),dateObj.getDate());
 d.setDate(d.getDate()+1);
 return d;
}
function orderingExpectedArrival(deliveryType,base=new Date(),item=null){
 const type=normalizeDeliveryLabel(deliveryType);
 if(type==='億家通'&&item&&isYijiaTongSpecifiedDateItem(item)){
  const specified=yijiaTongSpecifiedArrivalDate(item);
  if(!specified)return {date:'',period:'依指定日期',specified:true};
  const parts=specified.split('-').map(Number);
  if(parts.length===3&&parts.every(Number.isFinite)){
   let d=new Date(parts[0],parts[1]-1,parts[2]);
   d=adjustSundayNoDelivery(type,d,item);
   return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,period:'依指定日期',specified:true};
  }
  return {date:specified,period:'依指定日期',specified:true};
 }
 const r=orderingDeliveryRule(deliveryType);if(!r)return {date:'',period:''};
 const effective=orderingEffectiveDate(base);let d=new Date(effective.getFullYear(),effective.getMonth(),effective.getDate());d.setDate(d.getDate()+Math.max(0,Number(r.arrivalDays||0)));
 d=adjustSundayNoDelivery(type,d,item);
 return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,period:String(r.arrivalPeriod||'')};
}
// Alpha 5.58：貨單分組只看「到貨日 + 溫層 + 真正配次/配送批次」。
// 供應商、活動、來源單號都不可以成為拆單條件。
function logisticsDeliveryRunKey(item=null,order=null){
 // Alpha 5.59：只有「明確的配次欄位」才能拆貨單。
 // routeCode / shipmentBatch / deliveryBatch 等來源或供應鏈識別碼，
 // 可能每個供應商都不同，不能拿來當貨單分組 key。
 const vals=[
  item?.deliveryRun,item?.deliveryRunCode,item?.distributionRun,item?.tripNo,
  order?.deliveryRun,order?.deliveryRunCode,order?.distributionRun,order?.tripNo
 ];
 const raw=vals.map(v=>String(v??'').trim()).find(Boolean)||'';
 if(!raw)return 'DEFAULT';
 return raw.replace(/\s+/g,' ').slice(0,80);
}
function logisticsSupplierIdentity(item={}){
 const code=String(item.supplierCode||item.supplier_code||item.vendorCode||item.vendor_code||item.supplierId||item.vendorId||'').trim();
 const name=String(item.supplierName||item.supplier_name||item.vendorName||item.vendor_name||item.supplier||item.vendor||'').trim();
 return {code,name,key:`${code}@@${name}`};
}
function logisticsRunLabel(run){return !run||run==='DEFAULT'?'一般配次':run}
function orderingTransmissionRuleErrors(items,now=new Date()){
 const cutoff=orderingCutoffViolation(items,now),weekday=orderingWeekdayViolation(items,now),messages=[];
 if(cutoff.length)messages.push(...cutoff.map(x=>`${x.deliveryType}：限 ${x.rule.cutoff} 前傳輸`));
 if(weekday.length){
  const names=[...new Set(weekday.map(x=>`${x.item.code||''} ${x.item.name||''}`.trim()))];
  messages.push(`今日不可訂購：${names.slice(0,8).join('、')}${names.length>8?` 等 ${names.length} 項`:''}`);
 }
 const missingSpecified=(items||[]).filter(x=>isYijiaTongSpecifiedDateItem(x)&&!yijiaTongSpecifiedArrivalDate(x));
 if(missingSpecified.length){
  const names=[...new Set(missingSpecified.map(x=>`${x.code||''} ${x.name||x.group||x.category||''}`.trim()))];
  messages.push(`億家通預購／團購／EC需有指定進貨日期：${names.slice(0,8).join('、')}${names.length>8?` 等 ${names.length} 項`:''}`);
 }
 return messages;
}

function openOrderingDetails(onlyIds=null,title='訂購明細'){
 const allRows=load(K.orders,[]);
 const idSet=Array.isArray(onlyIds)&&onlyIds.length?new Set(onlyIds.map(String)):null;
 const rows=idSet?allRows.filter(x=>idSet.has(String(x.id))):allRows;
 dlg(title,`<div class="orange-order-history-modal">
  <div class="toolbar"><button class="button" data-action="sync-order-logistics">🔄 同步物流狀態</button><button class="button" id="orderBatchSelectAll">☑️ 全選可刪除</button><button class="button danger" id="orderBatchDelete">🗑️ 刪除勾選</button></div>
  <div class="table-wrap"><table class="table"><thead><tr><th>選</th><th>訂單號</th><th>類型</th><th>預定到貨</th><th>品項數</th><th>總數量</th><th>狀態</th><th>物流批次</th><th>進貨單</th><th>操作</th></tr></thead><tbody>${v531OrderSummary(rows)}</tbody></table></div>
  <div class="notice"><small>批次刪除只開放「未傳輸／已建立」訂購單，已進入物流或已傳輸的資料不會被批次刪除。</small></div>
  <div style="text-align:right;margin-top:12px"><button class="button" data-action="close-dialog">離開</button></div>
 </div>`);
 setTimeout(()=>{
  const all=[...genericDialog.querySelectorAll('[data-v531-order-select]:not(:disabled)')];
  const selectAll=genericDialog.querySelector('#orderBatchSelectAll'),del=genericDialog.querySelector('#orderBatchDelete');
  if(selectAll)selectAll.onclick=()=>{const next=all.some(x=>!x.checked);all.forEach(x=>x.checked=next);selectAll.textContent=next?'☐ 取消全選':'☑️ 全選可刪除';};
  if(del)del.onclick=()=>{const ids=all.filter(x=>x.checked).map(x=>x.dataset.v531OrderSelect);if(!ids.length)return alert('請先勾選要刪除的訂購單');if(!confirm(`確定一次刪除 ${ids.length} 筆訂購單？\n刪除後無法復原。`))return;const current=load(K.orders,[]),targets=current.filter(x=>ids.includes(String(x.id)));const blocked=targets.filter(x=>!['未傳輸','已建立'].includes(x.status||'已建立'));if(blocked.length)return alert('勾選內容包含已傳輸資料，已取消刪除');save(K.orders,current.filter(x=>!ids.includes(String(x.id))));saveAudit('批次刪除訂購單',`${ids.length}筆｜${ids.join('、')}`);openOrderingDetails();};
 },0);
}
function openPostTransmitOrderDetailPrompt(orderIds=[]){
 const ids=[...new Set((orderIds||[]).map(String).filter(Boolean))];
 dlg('訂購傳輸完成',`<div class="panel"><p style="font-size:18px;font-weight:800">是否查看本次訂購傳輸明細？</p><div class="toolbar" style="justify-content:flex-end"><button class="button" id="postTransmitClose">否</button><button class="primary" id="postTransmitDetails">是，查看本次明細</button></div></div>`);
 setTimeout(()=>{
  document.querySelector('#postTransmitClose')?.addEventListener('click',()=>genericDialog.close());
  document.querySelector('#postTransmitDetails')?.addEventListener('click',()=>{
   genericDialog.close();
   openOrderingDetails(ids,'本次訂購傳輸明細');
  });
 },0);
}
function orderingRulesSettingsPage(){
 const cfg=orderingRules();
 return `<div class="ordering-rules-page">
  <div class="page-head"><div><h2>⚙️ 訂購規則設定</h2><small>規則已正式套用於訂購傳輸；尚未建入商品主檔的品項仍可先用「品類文字」保留。</small></div><button class="button" data-nav="ordering">← 返回訂購</button></div>
  <div class="notice">規則已套用於正式傳輸；尚未建入／尚未分類的商品不會被星期規則誤擋。<br><strong>星期日進貨：</strong>常溫、冷凍、億家通不進貨；若原預定日落在星期日，自動順延至星期一（例如星期五訂購、原兩日後到貨會改為星期一）。EC 物流除外。<br><strong>億家通：</strong>每日 22:00 前傳輸；一般商品／部分備品為 2 天後半夜進貨；預購、團購、EC 依系統／訂單指定進貨日期。</div>
  <section class="panel ordering-rule-section">
   <div class="page-head"><h3>配送別傳輸截止／預定進貨</h3></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>配送別</th><th>傳輸截止</th><th>幾天後進貨</th><th>時段</th><th>啟用</th></tr></thead><tbody>
   ${cfg.delivery.map((r,i)=>`<tr><td><b>${esc(r.deliveryType||r.name)}</b></td><td><input type="time" data-rule-delivery-cutoff="${i}" value="${esc(r.cutoff||'')}"></td><td><input type="number" min="0" max="7" data-rule-delivery-days="${i}" value="${Number(r.arrivalDays||0)}" style="width:80px"> 天後</td><td><select data-rule-delivery-period="${i}"><option ${r.arrivalPeriod==='早上'?'selected':''}>早上</option><option ${r.arrivalPeriod==='半夜'?'selected':''}>半夜</option><option ${r.arrivalPeriod==='下午'?'selected':''}>下午</option><option ${r.arrivalPeriod==='晚上'?'selected':''}>晚上</option></select></td><td><input type="checkbox" data-rule-delivery-active="${i}" ${r.active===false?'':'checked'}></td></tr>`).join('')}
   </tbody></table></div>
  </section>
  <section class="panel ordering-rule-section">
   <div class="page-head"><div><h3>品類／類別／商品可訂購星期</h3><small>商品還沒新增時可以先用文字設定；之後可改成品群／類別／商品。</small></div><button class="button" data-action="ordering-rule-add-weekday">＋ 新增規則</button></div>
   <div id="orderingWeekdayRules" class="ordering-weekday-rules">
   ${cfg.weekdays.map((r,i)=>orderingWeekdayRuleHtml(r,i)).join('')}
   </div>
  </section>
  <button class="primary ordering-rules-save" data-action="save-ordering-rules">儲存訂購規則</button>
 </div>`;
}
function orderingWeekdayRuleHtml(r,i){
 const days=new Set((r.days||[]).map(String));
 return `<div class="ordering-weekday-rule" data-ordering-weekday-row="${i}">
  <label>規則名稱<input data-rule-weekday-name="${i}" value="${esc(r.name||'')}"></label>
  <label>套用方式<select data-rule-weekday-scope="${i}">${['品類文字','配送別','品群','類別','商品'].map(v=>`<option ${r.scopeType===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label class="rule-scope-value">套用內容<input data-rule-weekday-value="${i}" value="${esc(r.scopeValue||'')}" placeholder="可先填：餅乾,泡麵,備品"></label>
  <div class="rule-days"><span>可訂購：</span>${ORDER_RULE_WEEKDAYS.map(([v,l])=>`<label><input type="checkbox" data-rule-weekday-day="${i}" value="${v}" ${days.has(v)?'checked':''}>${l}</label>`).join('')}</div>
  <label><input type="checkbox" data-rule-weekday-active="${i}" ${r.active===false?'':'checked'}>啟用</label>
  <button type="button" class="button danger" data-ordering-rule-delete="${i}">刪除</button>
 </div>`;
}
function readOrderingRulesFromDom(){
 const old=orderingRules();
 const delivery=old.delivery.map((r,i)=>({...r,
  cutoff:document.querySelector(`[data-rule-delivery-cutoff="${i}"]`)?.value||r.cutoff||'',
  arrivalDays:Math.max(0,Number(document.querySelector(`[data-rule-delivery-days="${i}"]`)?.value||0)),
  arrivalPeriod:document.querySelector(`[data-rule-delivery-period="${i}"]`)?.value||r.arrivalPeriod||'',
  active:!!document.querySelector(`[data-rule-delivery-active="${i}"]`)?.checked
 }));
 const weekdays=[];
 document.querySelectorAll('[data-ordering-weekday-row]').forEach((row,idx)=>{
  const i=Number(row.dataset.orderingWeekdayRow);
  weekdays.push({
   id:old.weekdays[i]?.id||uid(),
   name:document.querySelector(`[data-rule-weekday-name="${i}"]`)?.value.trim()||'未命名規則',
   scopeType:document.querySelector(`[data-rule-weekday-scope="${i}"]`)?.value||'品類文字',
   scopeValue:document.querySelector(`[data-rule-weekday-value="${i}"]`)?.value.trim()||'',
   days:[...document.querySelectorAll(`[data-rule-weekday-day="${i}"]:checked`)].map(x=>x.value),
   active:!!document.querySelector(`[data-rule-weekday-active="${i}"]`)?.checked
  });
 });
 return {delivery,weekdays,mode:'active',updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
}

const SC_ORDER_KIND_META={
 ledger:{label:'台帳訂購',permission:'orderLedger',types:['台帳訂購'],groups:[]},
 use:{label:'用度品訂購',permission:'orderSupplies',types:['用度品訂購'],groups:[['086','便當備品'],['726','其他辦公商品'],['796','觀光區用品'],['975','鮮食行銷贈品'],['977','行銷部贈品'],['A05','常溫冷凍冷藏'],['A06','咖啡用酒'],['A07','咖啡物料商品'],['A17','咖啡物料商品'],['A21','茶飲'],['A31','冰沙'],['A32','微波冰沙'],['A35','袋裝冰沙']]},
 special:{label:'特殊品訂購',permission:'orderSpecial',types:['特殊品訂購'],groups:[['S01','特殊商品'],['S02','預購商品'],['S03','節慶商品'],['S04','陳列用品'],['S05','活動商品'],['S06','門市用品']]},
 fos:{label:'FOS 鮮食訂購',permission:'orderFos',types:['FOS鮮食訂購'],groups:[['F01','飯糰'],['F02','壽司'],['F03','便當'],['F04','麵食'],['F05','三明治／漢堡'],['F06','沙拉／水果'],['F07','鮮食甜點'],['F08','其他鮮食']]},
 group:{label:'品群訂購',permission:'orderGroup',types:['品群訂購'],groups:[]}
};
function scOrderDynamicGroups(kind){
 const meta=SC_ORDER_KIND_META[kind];if(!meta)return [];
 const configured=orderingScreenGroups(kind).map(x=>[String(x.code||''),String(x.name||'')]).filter(x=>x[0]&&x[1]);
 if(configured.length)return configured;
 if(meta.groups?.length)return meta.groups;
 const seen=new Map();let n=1;
 products().filter(p=>productStatusLabel(p)!=='停用'&&meta.types.some(t=>orderProductAllowedForType(p,t))).forEach(p=>{
  const raw=String(p.orderGroup||p.group||p.category||'其他').trim()||'其他';
  const code=String(p.orderGroupCode||p.groupCode||productGroupCodeForName(raw)||String(n++).padStart(3,'0')).trim();
  if(!seen.has(raw))seen.set(raw,[code,raw]);
 });
 return [...seen.values()];
}
function scOrderTabs(active=''){
 const tabs=[
  ['ledger','台帳訂購','ordering-ledger'],
  ['fos','FOS訂購','ordering-fos'],
  ['special','特殊品訂購','ordering-special'],
  ['use','用度品訂購','ordering-use'],
  ['group','品群訂購','ordering-group'],
  ['specified','指定日訂購','ordering-specified-date'],
  ['reservations','預約訂購','ordering-reservations'],
  ['suggestion','建議訂購設定','ordering-suggestion-settings'],
  ['face','FACE卡列印','ordering-face']
 ];
 return `<div class="sc-order-tabs sc-order-tabs-green">${tabs.map(([k,l,page])=>`<button type="button" class="${active===k?'active':''}" data-nav="${page}">${esc(l)}</button>`).join('')}</div>`;
}
function fosOrderGroupCode(p){
 const values=fosProductTextValues(p),joined=values.join('｜');
 for(const code of ['F01','F02','F03','F04','F05','F06','F07','F08'])if(values.some(v=>v.toUpperCase()===code||v.toUpperCase().startsWith(code)))return code;
 if(/飯糰/.test(joined))return 'F01';
 if(/壽司/.test(joined))return 'F02';
 if(/便當/.test(joined))return 'F03';
 if(/麵食|麵類|炒麵|湯麵|涼麵/.test(joined))return 'F04';
 if(/三明治|漢堡/.test(joined))return 'F05';
 if(/沙拉|水果/.test(joined))return 'F06';
 if(/甜點|布丁|蛋糕|甜品/.test(joined))return 'F07';
 return 'F08';
}
function scOrderProductMatchesGroup(p,code,label){
 const c=String(code||'').trim(),l=String(label||'').trim();
 const configured=orderingClassificationConfig().screenGroups.find(x=>x.enabled!==false&&String(x.code||'')===c&&String(x.name||'')===l);
 if(configured&&normalizeGroupNameList(configured.productGroups).length)return productMappedToClassification(p,configured);
 if(/^F0[1-8]$/i.test(c))return fosOrderGroupCode(p)===c.toUpperCase();
 const values=[p.orderGroupCode,p.orderCategoryCode,p.groupCode,p.orderGroup,p.group,p.category,p.orderCategory,p.subcategory].map(v=>String(v||'').trim()).filter(Boolean);
 return values.some(v=>v===c||v===l||v.startsWith(c)||v.includes(l));
}
function scOrderGroupProducts(kind,groupCode='',groupLabel=''){
 const meta=SC_ORDER_KIND_META[kind]||SC_ORDER_KIND_META.use;
 let rows=products().filter(p=>productStatusLabel(p)!=='停用');
 if(kind==='fos')rows=rows.filter(isFosFreshProduct);
 rows=rows.filter(p=>meta.types.some(t=>orderProductAllowedForType(p,t)));
 if(groupCode||groupLabel)rows=rows.filter(p=>scOrderProductMatchesGroup(p,groupCode,groupLabel));
 return rows;
}
const ORDER_FAVORITES_KEY='yj_sc_favorite_order_products_v1';
function orderFavoritesLoad(){
 try{const x=JSON.parse(localStorage.getItem(ORDER_FAVORITES_KEY)||'[]');return Array.isArray(x)?[...new Set(x.map(String))]:[];}catch{return []}
}
function orderFavoritesSave(ids){
 const clean=[...new Set((Array.isArray(ids)?ids:[]).map(String).filter(Boolean))];
 localStorage.setItem(ORDER_FAVORITES_KEY,JSON.stringify(clean));return clean;
}
function orderFavoriteHas(id){return orderFavoritesLoad().includes(String(id||''))}
function orderFavoriteAdd(id){const set=new Set(orderFavoritesLoad());set.add(String(id));return orderFavoritesSave([...set])}
function orderFavoriteRemove(id){return orderFavoritesSave(orderFavoritesLoad().filter(x=>x!==String(id)))}
function orderFavoriteProducts(kind){
 const ids=new Set(orderFavoritesLoad());
 return scOrderGroupProducts(kind).filter(p=>ids.has(String(p.id)));
}
function orderingFavoritesPage(kind){
 const meta=SC_ORDER_KIND_META[kind]||SC_ORDER_KIND_META.use,rows=orderFavoriteProducts(kind);
 return `<div class="sc-order-reference-page order-favorite-page" data-order-favorite-page="${esc(kind)}">
  ${scOrderTabs(kind)}
  <div class="sc-order-reference-head"><div><b>億家</b><span>SuperApp Enterprise</span></div><div>${esc(store().name)}｜店號：${esc(currentStoreCode())}</div></div>
  <div class="order-page-actions"><button type="button" class="button" data-nav="ordering-${kind}">← 返回上一頁</button></div>
  <div class="order-favorite-title"><h2>常訂購商品🩵</h2><small>${esc(meta.label)}｜已加入 ${rows.length} 項</small></div>
  <div class="order-favorite-grid">${rows.map(p=>`<button type="button" class="order-favorite-card" data-order-favorite-open="${esc(p.id)}" data-order-favorite-kind="${esc(kind)}"><b>${esc(p.code||'—')}　${esc(p.name||'')}</b><span>售價 ${money(p.price)}</span><span>庫存 ${Number(p.stock||0)}</span><small>點擊進入訂購</small></button>`).join('')||'<div class="panel order-favorite-empty">目前還沒有常訂購商品。<br>進入商品訂購畫面後按「加入常訂購商品」即可加入。</div>'}</div>
 </div>`;
}
function orderingCategoryPage(kind){
 const meta=SC_ORDER_KIND_META[kind]||SC_ORDER_KIND_META.use;
 const groups=scOrderDynamicGroups(kind);
 const selected=Math.max(0,Math.min(Number(sessionStorage.getItem(`yj_sc_order_cat_${kind}`)||0),Math.max(0,groups.length-1)));
 return `<div class="sc-order-reference-page" data-order-category-page="${esc(kind)}">
  ${scOrderTabs(kind)}
  <div class="sc-order-reference-head"><div><b>億家</b><span>SuperApp Enterprise</span></div><div>${esc(store().name)}｜店號：${esc(currentStoreCode())}</div></div>
  <div class="order-page-actions"><button type="button" class="button" data-action="order-category-back">← 返回上一頁</button></div>
  <div class="sc-order-category-search"><button type="button" class="ref-side-btn favorite" data-nav="ordering-${kind}-favorites">常訂購商品🩵</button><div><label>商品代碼 <input placeholder="起始代碼"> ～ <input placeholder="結束代碼"></label><label>商品名稱 <input placeholder="輸入商品名稱"><button class="button">查詢</button></label></div></div>
  <div class="sc-order-category-grid">${groups.map(([code,label],i)=>{const count=scOrderGroupProducts(kind,code,label).length;return `<button type="button" class="sc-order-category-card ${i===selected?'active':''}" data-order-category-index="${i}" data-order-category-kind="${esc(kind)}" data-order-category-code="${esc(code)}" data-order-category-label="${esc(label)}"><b>${esc(code)}${esc(label)}</b><span>已訂購 0 筆</span><span>已傳輸 0 筆</span><small>可訂購商品 ${count} 項</small></button>`}).join('')||'<div class="panel">目前此訂購類型尚未設定商品分類。</div>'}</div>
  <div class="sc-order-key-hint">↑ 上一個　↓ 下一個　Enter 確認下一層${kind==='fos'?'　← / → 切換週別':''}</div>
 </div>`;
}
function orderingDetailPage(kind){
 const meta=SC_ORDER_KIND_META[kind]||SC_ORDER_KIND_META.use;
 const code=sessionStorage.getItem(`yj_sc_order_group_code_${kind}`)||'';
 const label=sessionStorage.getItem(`yj_sc_order_group_${kind}`)||'';
 const favoriteMode=sessionStorage.getItem(`yj_sc_order_favorite_mode_${kind}`)==='1';
 const selectable=favoriteMode?orderFavoriteProducts(kind):scOrderGroupProducts(kind,code,label);
 if(!adminOrderingSelectedProductId||!selectable.some(p=>p.id===adminOrderingSelectedProductId))adminOrderingSelectedProductId=selectable[0]?.id||'';
 const selected=selectable.find(p=>p.id===adminOrderingSelectedProductId)||selectable[0]||null;
 const week=kind==='fos'?currentFosWeekOffset():0;
 return `<div class="orange-order-page sc-order-detail-reference" data-order-detail-kind="${esc(kind)}">${orderingSwitchBanner()}
  ${scOrderTabs(kind)}
  <div class="orange-order-topline"><div class="orange-order-brand">⌂ 億家 <small>SuperApp Enterprise</small></div><div>${esc(store().name)}　｜　店號：${esc(currentStoreCode())}</div></div>
  <div class="sc-order-detail-title"><button type="button" class="button order-detail-back" data-nav="${favoriteMode?`ordering-${kind}-favorites`:`ordering-${kind}`}">← 返回上一頁</button><b>${esc(meta.label)}</b><span>${favoriteMode?'常訂購商品🩵':esc((code?code+' ':'')+(label||'全部分類'))}</span>${kind==='fos'?`<span class="fos-week-label">週別：${week===0?'本週':'上週'}</span>`:''}<button class="orange-order-exit" data-nav="ordering-${kind}">▣　離開</button></div>
  <div class="orange-order-strip">${orangeOrderStripHtml(selectable,selected)}</div>
  <div id="orangeOrderDetail">${orangeOrderingProductDetail(selected)}</div>
  <div id="orangeOrderHistory">${orangeOrderingHistoryTable(selected)}</div>
  <div class="sc-order-key-hint">↑ 上一個　↓ 下一個　Enter 確認並下一個${kind==='fos'?`　${week>-1?'← 上週':'← 上週（已到上週）'}　${week<0?'→ 本週':'→ 本週（已到本週）'}`:''}</div>
 </div>`;
}
function orderingLandingPage(){return orderingCategoryPage('ledger');}

const FACE_CART_KEY='yj_sc_face_cart_v1';
function faceCartLoad(){
 try{const raw=sessionStorage.getItem(FACE_CART_KEY),x=raw?JSON.parse(raw):null;if(x&&Array.isArray(x.ids)&&x.qty&&typeof x.qty==='object')return {ids:x.ids.map(String),qty:{...x.qty}};}catch{}
 return {ids:[],qty:{}};
}
function faceCartSave(cart){
 const clean={ids:[...new Set((cart?.ids||[]).map(String))],qty:{...(cart?.qty||{})}};
 try{sessionStorage.setItem(FACE_CART_KEY,JSON.stringify(clean));}catch{}
 window.__yjFaceSelected=clean.ids.slice();window.__yjFaceQty={...clean.qty};
 return clean;
}
function faceCartSyncMemory(){const cart=faceCartLoad();window.__yjFaceSelected=cart.ids.slice();window.__yjFaceQty={...cart.qty};return cart;}
function faceCartAdd(id,qty=1){id=String(id||'');if(!id)return faceCartLoad();const cart=faceCartLoad();if(!cart.ids.includes(id))cart.ids.push(id);cart.qty[id]=Math.max(1,Number(cart.qty[id]||qty||1)||1);return faceCartSave(cart);}
function faceCartRemove(id){id=String(id||'');const cart=faceCartLoad();cart.ids=cart.ids.filter(x=>x!==id);delete cart.qty[id];return faceCartSave(cart);}
function faceCartClear(){return faceCartSave({ids:[],qty:{}});}

function faceCardPrintableRows(query=''){
 const q=String(query||'').trim().toLowerCase();
 return products().filter(p=>productStatusLabel(p)!=='停用').filter(p=>{
  if(!q)return true;
  const bars=productBarcodes(p);
  return [p.code,p.name,p.group,p.category,...bars].some(v=>String(v||'').toLowerCase().includes(q));
 }).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''))||String(a.name||'').localeCompare(String(b.name||'')));
}
function faceCardQty(id){
 const map=faceCartLoad().qty||{};return Math.max(1,Math.min(999,Number(map[String(id)]||1)||1));
}
function orderingFacePage(){
 const q=String(window.__yjFaceQuery||'');
 const cart=faceCartSyncMemory(),selectedSet=new Set(cart.ids.map(String));
 const selectedRows=products().filter(p=>selectedSet.has(String(p.id)));
 const rows=(q?faceCardPrintableRows(q):selectedRows).slice(0,120);
 const allChecked=rows.length>0&&rows.every(x=>selectedSet.has(String(x.id)));
 const total=[...selectedSet].reduce((sum,id)=>sum+faceCardQty(id),0);
 return `<div class="sc-order-reference-page face-order-page">
  ${scOrderTabs('face')}
  <div class="sc-order-reference-head"><div><b>億家</b><span>SuperApp Enterprise</span></div><div>${esc(store().name)}｜店號：${esc(currentStoreCode())}</div></div>
  <div class="page-head" style="padding:18px 0 10px"><div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button type="button" class="button" data-action="face-card-back">← 返回上一頁</button><h2 style="margin:0">FACE卡列印</h2></div><small>A4 橫式 6 欄 × 7 列，每頁最多 42 張；超過 42 張會自動換頁。</small></div><div class="toolbar"><input id="faceCardQuery" placeholder="搜尋商品代號／名稱／條碼" value="${esc(q)}"><button class="button" data-action="face-card-search">查詢</button><button class="button" data-action="face-card-clear">清空FACE清單</button><button class="primary" data-action="face-card-print-selected">列印勾選 FACE卡（${total}張）</button></div></div>
  <section class="panel table-wrap"><table class="table"><thead><tr><th><input type="checkbox" id="faceCardSelectAll" ${allChecked?'checked':''}></th><th>商品代號</th><th>商品名稱</th><th>品群／類別</th><th>售價</th><th>主要條碼</th><th>張數</th><th>操作</th></tr></thead><tbody>${rows.map(p=>{const bars=productBarcodes(p),id=String(p.id),checked=selectedSet.has(id),qty=faceCardQty(id);return `<tr><td><input type="checkbox" data-face-card-id="${esc(id)}" ${checked?'checked':''}></td><td>${esc(p.code||'—')}</td><td>${esc(p.name||'')}</td><td>${esc(p.group||p.category||'—')}</td><td>${Number(p.price||0)}</td><td>${esc(bars[0]||'')}</td><td><input type="number" min="1" max="999" value="${qty}" data-face-card-qty="${esc(id)}" style="width:76px" ${checked?'':'disabled'}></td><td><button class="button" data-action="face-card-print-one" data-face-card-print-id="${esc(id)}">列印</button></td></tr>`}).join('')||'<tr><td colspan="8">目前 FACE 清單是空的。請回到訂購商品畫面按 FACE 加入商品，或使用上方搜尋。</td></tr>'}</tbody></table><p class="setting-hint">FACE 清單採購物車邏輯：從不同商品頁按 FACE 會持續累加；同一商品只保留一列。輸入各商品張數後可一次列印；每 42 張自動產生下一張 A4。</p></section>
 </div>`;
}

function orangeOrderingPage(){
 const selectable=products().filter(p=>productStatusLabel(p)!=='停用');
 if(!adminOrderingSelectedProductId||!selectable.some(p=>p.id===adminOrderingSelectedProductId))adminOrderingSelectedProductId=selectable[0]?.id||'';
 const selected=selectable.find(p=>p.id===adminOrderingSelectedProductId)||selectable[0]||null;
 return `<div class="orange-order-page">${orderingSwitchBanner()}
  <div class="orange-order-topline"><div class="orange-order-brand">⌂ 億家 <small>SuperApp Enterprise</small></div><div>${esc(store().name)}　｜　店號：${esc(currentStoreCode())}</div></div>
  <div class="orange-order-toolbar">
   <div class="orange-order-tools">
    ${orderingAiSwitchHtml()}
    <button class="button" data-nav="ordering-rules-settings">⚙️ 訂購規則</button>
    <button class="button" data-action="sync-order-logistics">🔄 同步物流</button>
    <button class="button" data-action="open-order-details">📋 訂購明細</button>
    <button class="button" data-action="fresh-ai-order" ${orderingAiSwitches().fresh?'':'disabled'}>🥪 鮮食 AI</button>
    <button class="primary" data-action="transmit-all-orders" ${orderingIsStatisticsLock()?'disabled title="21:59～22:01:59 系統訂購統計中"':''}>傳輸</button>
   </div>
   <button class="orange-order-exit" data-nav="home">▣　離開</button>
  </div>
  <div class="orange-order-strip">
   ${orangeOrderStripHtml(selectable,selected)}
  </div>
  <div id="orangeOrderDetail">${orangeOrderingProductDetail(selected)}</div>
  <div id="orangeOrderHistory">${orangeOrderingHistoryTable(selected)}</div>
 </div>`;
}
function openOrangeOrderHistory(){return openOrderingDetails()}

function noticeReadToken(){
 const u=currentUser()||{};return `${currentStoreCode()}:${u.id||u.account||u.name||'user'}`;
}
function noticeRows(){
 return (Array.isArray(load(K.notices,[]))?load(K.notices,[]):[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
}
function noticeIsRead(x){return Array.isArray(x?.readBy)&&x.readBy.includes(noticeReadToken())}
function noticeUnreadCounts(){
 const rows=noticeRows().filter(x=>!noticeIsRead(x));
 return {normal:rows.filter(x=>String(x.priority||'normal')!=='urgent').length,urgent:rows.filter(x=>String(x.priority||'normal')==='urgent').length,total:rows.length};
}
function rocDate(iso){
 const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return esc(iso||'—');
 return `${Number(m[1])-1911}/${m[2]}/${m[3]}`;
}
function noticeDefaultRange(){
 const rows=noticeRows(),end=rows[0]?.date||localDateKey(),d=new Date(`${end}T12:00:00`);d.setDate(d.getDate()-3);
 return {from:localDateKey(d),to:end};
}
function noticeFilteredRows(){
 const f=window.__yjNoticeFilter||noticeDefaultRange(),q=String(f.q||'').trim().toLowerCase();
 return noticeRows().filter(x=>(!f.from||String(x.date||'')>=f.from)&&(!f.to||String(x.date||'')<=f.to)&&(!q||String(x.subject||'').toLowerCase().includes(q)));
}



function noticeNo(x){return String(x?.noticeNo||x?.number||x?.id||'').trim()}
function noticeCategory(x){return String(x?.category||'一般通報').trim()||'一般通報'}
function noticeDepartment(x){return String(x?.department||x?.issuer||'').trim()||'—'}
function noticeArchive(x){return String(x?.archiveName||'一般通報').trim()||'一般通報'}
function noticeMd(x){return String(x?.responsibleMd||x?.md||'').trim()||'—'}
function noticeGreeting(x){return String(x?.greeting||'各位店長好：').trim()||'各位店長好：'}
function noticeHighlightText(body,highlight){
 const safe=esc(body||'').replace(/\n/g,'<br>');
 const h=String(highlight||'').trim();
 if(!h)return safe;
 const sh=esc(h);
 return safe.split(sh).join(`<mark class="notice-highlight">${sh}</mark>`);
}
function noticeProductRows(x){return Array.isArray(x?.products)?x.products:[]}
function noticeProductImage(p){
 const src=String(p?.imageUrl||p?.image||'').trim();
 return src?`<img src="${esc(src)}" alt="${esc(p?.name||'商品圖片')}" onerror="this.style.display='none'">`:'<span class="notice-product-noimg">商品圖片</span>';
}
function noticeFormalDetailHtml(x){
 const items=noticeProductRows(x);
 return `<article class="notice-paper" id="noticePrintArea">
  <table class="notice-info-table"><tbody>
   <tr><th>通報編號：</th><td>${esc(noticeNo(x)||'—')}</td><th>通報日期：</th><td>${rocDate(x.date)}</td><th>保存期限：</th><td>${x.expireDate?rocDate(x.expireDate):'—'}</td></tr>
   <tr><th>類別：</th><td>${esc(noticeCategory(x))}</td><th>發文單位：</th><td>${esc(noticeDepartment(x))}</td><th>歸檔檔案：</th><td>${esc(noticeArchive(x))}</td></tr>
   <tr><th>主旨：</th><td colspan="5">${esc(x.subject||'')}</td></tr>
  </tbody></table>
  <h3 class="notice-md">【負責 MD：${esc(noticeMd(x))}】</h3>
  <div class="notice-letter"><p>${esc(noticeGreeting(x))}</p><div class="notice-formal-body">${noticeHighlightText(x.body||x.subject||'',x.highlight)}</div></div>
  ${items.length?`<div class="notice-products-wrap"><table class="notice-products-table">
   <thead><tr><th>商品圖片</th><th>商品代號</th><th>商品名稱</th><th>售價</th><th>退貨區間</th><th>備註</th></tr></thead>
   <tbody>${items.map(p=>`<tr><td class="notice-product-image">${noticeProductImage(p)}</td><td>${esc(p.code||'')}</td><td>${esc(p.name||'')}</td><td>${p.price!==''&&p.price!=null?esc(String(p.price)):'—'}</td><td>${p.returnPeriod?`<mark class="notice-highlight">${esc(p.returnPeriod)}</mark>`:'—'}</td><td>${esc(p.note||'')}</td></tr>`).join('')}</tbody>
  </table></div>`:''}
 </article>`;
}
function noticeEditorProductRowsHtml(items=[]){
 const rows=Array.isArray(items)&&items.length?items:[{code:'',name:'',price:'',returnPeriod:'',note:'',imageUrl:''}];
 return rows.map(p=>`<tr data-notice-product-row>
  <td><input data-notice-product="imageUrl" value="${esc(p.imageUrl||p.image||'')}" placeholder="圖片網址"></td>
  <td><input data-notice-product="code" value="${esc(p.code||'')}" placeholder="商品代號"></td>
  <td><input data-notice-product="name" value="${esc(p.name||'')}" placeholder="商品名稱"></td>
  <td><input data-notice-product="price" value="${esc(String(p.price??''))}" inputmode="decimal" placeholder="售價"></td>
  <td><input data-notice-product="returnPeriod" value="${esc(p.returnPeriod||'')}" placeholder="例如 115/8/22~26"></td>
  <td><input data-notice-product="note" value="${esc(p.note||'')}" placeholder="備註"></td>
  <td><button type="button" class="button danger" data-action="notice-product-remove">刪除</button></td>
 </tr>`).join('');
}
function collectNoticeEditorProducts(){
 return [...document.querySelectorAll('[data-notice-product-row]')].map(tr=>{
  const get=k=>String(tr.querySelector(`[data-notice-product="${k}"]`)?.value||'').trim();
  return {imageUrl:get('imageUrl'),code:get('code'),name:get('name'),price:get('price'),returnPeriod:get('returnPeriod'),note:get('note')};
 }).filter(p=>p.code||p.name||p.imageUrl||p.returnPeriod||p.note);
}
function printNoticeDetail(){
 const el=document.querySelector('#noticePrintArea');if(!el)return;
 const w=window.open('','_blank','width=1100,height=900');if(!w)return alert('瀏覽器阻擋了列印視窗');
 w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>通報列印</title><link rel="stylesheet" href="style.css"></head><body class="notice-print-window">${el.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
 w.document.close();
}

function franchiseRows(key){
 const store=String(currentStoreCode()||'001');
 return (load(key,[])||[]).filter(x=>String(x.storeCode||store)===store);
}
function franchiseProfileCurrent(){
 const store=String(currentStoreCode()||'001');
 return (load(K.franchiseProfiles,[])||[]).find(x=>String(x.storeCode||'')===store)||{storeCode:store,storeName:(load(K.stores,[])||[]).find(x=>String(x.code)===store)?.name||'',franchiseType:'',ownerName:'',companyName:'',taxId:'',phone:'',email:'',contractNo:'',contractStart:'',contractEnd:'',contractStatus:'未設定',depositAmount:'',note:''};
}
function franchiseStatusClass(v){const s=String(v||'');return /有效|完成|啟用|正常/.test(s)?'good':/待|處理|審核|追蹤/.test(s)?'warn':/終止|停用|逾期|退件/.test(s)?'bad':''}
function franchiseAreaPage(){
 if(!isFounder()&&!hasPermission('franchiseAreaAccess'))return `<div class="page-head"><div><h2>加盟專區</h2><small>通報與調查｜加盟店專用</small></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><h3>權限不足</h3><p>需要「加盟專區」權限。</p></div>`;
 const f=franchiseProfileCurrent(),docs=franchiseRows(K.franchiseDocuments),fees=franchiseRows(K.franchiseFees),reqs=franchiseRows(K.franchiseRequests),contacts=franchiseRows(K.franchiseContacts),founder=isFounder();
 const totalFee=fees.filter(x=>x.active!==false).reduce((a,x)=>a+Number(x.amount||0),0);
 const pending=reqs.filter(x=>!['完成','取消','退件'].includes(String(x.status||''))).length;
 const end=f.contractEnd?new Date(f.contractEnd+'T00:00:00'):null;let remain='—';if(end&&!Number.isNaN(end.getTime()))remain=Math.ceil((end-new Date())/86400000);
 return `<div class="page-head"><div><h2>加盟專區</h2><small>加盟基本資料、合約文件、加盟費用、異動申請與聯絡窗口</small></div><div class="toolbar"><button class="button" data-action="franchise-refresh">↻ 同步</button><button class="button" data-nav="home">← 返回</button></div></div>
 <div class="metric-grid"><div class="metric"><small>合約狀態</small><strong class="${franchiseStatusClass(f.contractStatus)}">${esc(f.contractStatus||'未設定')}</strong></div><div class="metric"><small>合約剩餘</small><strong>${remain==='—'?'—':remain+' 天'}</strong></div><div class="metric"><small>待處理申請</small><strong>${pending}</strong></div><div class="metric"><small>目前費用項目合計</small><strong>${money(totalFee)}</strong></div></div>
 <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>加盟基本資料</h3><small>本店加盟合約與加盟主基本資訊</small></div>${founder?'<button class="primary" data-franchise-action="edit-profile">修改</button>':''}</div><div class="settings-grid"><div><b>店號／店名</b><p>${esc(f.storeCode||'')}　${esc(f.storeName||'')}</p></div><div><b>加盟型態</b><p>${esc(f.franchiseType||'—')}</p></div><div><b>加盟主</b><p>${esc(f.ownerName||'—')}</p></div><div><b>公司／商號</b><p>${esc(f.companyName||'—')}</p></div><div><b>統一編號</b><p>${esc(f.taxId||'—')}</p></div><div><b>聯絡電話</b><p>${esc(f.phone||'—')}</p></div><div><b>電子郵件</b><p>${esc(f.email||'—')}</p></div><div><b>合約編號</b><p>${esc(f.contractNo||'—')}</p></div><div><b>合約期間</b><p>${esc(f.contractStart||'—')} ～ ${esc(f.contractEnd||'—')}</p></div><div><b>保證金</b><p>${f.depositAmount!==''?money(f.depositAmount):'—'}</p></div></div>${f.note?`<p><b>備註：</b>${esc(f.note)}</p>`:''}</section>
 <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>合約與文件</h3><small>加盟合約、續約文件、補充協議與其他加盟文件</small></div>${founder?'<button class="primary" data-franchise-action="add-document">＋ 新增文件</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>類型</th><th>文件名稱</th><th>版本</th><th>生效日</th><th>到期日</th><th>狀態</th><th>備註</th><th>操作</th></tr></thead><tbody>${docs.map(x=>`<tr><td>${esc(x.type||'')}</td><td>${esc(x.title||'')}</td><td>${esc(x.version||'')}</td><td>${esc(x.effectiveDate||'')}</td><td>${esc(x.expiryDate||'')}</td><td><span class="${franchiseStatusClass(x.status)}">${esc(x.status||'')}</span></td><td>${esc(x.note||'')}</td><td>${founder?`<button class="button" data-franchise-action="edit-document" data-id="${esc(x.id)}">修改</button> <button class="button danger" data-franchise-action="delete-document" data-id="${esc(x.id)}">刪除</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="8">尚無加盟文件</td></tr>'}</tbody></table></div></section>
 <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>加盟費用設定</h3><small>只記錄加盟相關費用設定；實際帳務仍以營運報表／加盟款明細為準</small></div>${founder?'<button class="primary" data-franchise-action="add-fee">＋ 新增費用</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>費用名稱</th><th>金額</th><th>週期</th><th>繳款日</th><th>狀態</th><th>備註</th><th>操作</th></tr></thead><tbody>${fees.map(x=>`<tr><td>${esc(x.name||'')}</td><td>${money(x.amount||0)}</td><td>${esc(x.cycle||'')}</td><td>${esc(x.dueDay||'—')}</td><td>${x.active!==false?'啟用':'停用'}</td><td>${esc(x.note||'')}</td><td>${founder?`<button class="button" data-franchise-action="edit-fee" data-id="${esc(x.id)}">修改</button> <button class="button danger" data-franchise-action="delete-fee" data-id="${esc(x.id)}">刪除</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">尚無費用設定</td></tr>'}</tbody></table></div></section>
 <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>申請／異動紀錄</h3><small>加盟主資料、合約、匯款帳戶、設備與其他加盟事項申請</small></div><button class="primary" data-franchise-action="add-request">＋ 新增申請</button></div><div class="table-wrap"><table class="table"><thead><tr><th>日期</th><th>類型</th><th>主旨</th><th>申請人</th><th>狀態</th><th>內容</th><th>操作</th></tr></thead><tbody>${reqs.map(x=>`<tr><td>${esc(String(x.createdAt||'').slice(0,10))}</td><td>${esc(x.type||'')}</td><td>${esc(x.subject||'')}</td><td>${esc(x.createdBy||'')}</td><td><span class="${franchiseStatusClass(x.status)}">${esc(x.status||'待處理')}</span></td><td>${esc(x.detail||'')}</td><td>${founder?`<button class="button" data-franchise-action="request-status" data-id="${esc(x.id)}">更新狀態</button> <button class="button danger" data-franchise-action="delete-request" data-id="${esc(x.id)}">刪除</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">尚無申請紀錄</td></tr>'}</tbody></table></div></section>
 <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>加盟聯絡窗口</h3><small>加盟營運、帳務、設備與其他聯絡窗口</small></div>${founder?'<button class="primary" data-franchise-action="add-contact">＋ 新增窗口</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>類別</th><th>姓名／單位</th><th>電話</th><th>Email</th><th>備註</th><th>操作</th></tr></thead><tbody>${contacts.map(x=>`<tr><td>${esc(x.category||'')}</td><td>${esc(x.name||'')}</td><td>${esc(x.phone||'')}</td><td>${esc(x.email||'')}</td><td>${esc(x.note||'')}</td><td>${founder?`<button class="button" data-franchise-action="edit-contact" data-id="${esc(x.id)}">修改</button> <button class="button danger" data-franchise-action="delete-contact" data-id="${esc(x.id)}">刪除</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6">尚無聯絡窗口</td></tr>'}</tbody></table></div></section>`;
}
function franchiseField(id,label,value='',type='text',options=[]){
 if(type==='select')return `<label>${label}<select id="${id}">${options.map(x=>`<option value="${esc(x)}" ${String(value)===String(x)?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`;
 if(type==='textarea')return `<label>${label}<textarea id="${id}" rows="4">${esc(value||'')}</textarea></label>`;
 return `<label>${label}<input id="${id}" type="${type}" value="${esc(value??'')}"></label>`;
}
function franchiseOpenEditor(kind,id=''){
 const store=String(currentStoreCode()||'001');
 const map={document:K.franchiseDocuments,fee:K.franchiseFees,contact:K.franchiseContacts};
 const rows=map[kind]?load(map[kind],[]):[];const x=(rows||[]).find(v=>String(v.id)===String(id))||{};
 let html='',title='';
 if(kind==='profile'){
  const f=franchiseProfileCurrent();title='修改加盟基本資料';html=`<div class="settings-grid">${franchiseField('frStoreName','店名',f.storeName)}${franchiseField('frType','加盟型態',f.franchiseType,'select',['','委託加盟','特許加盟','合作加盟','其他'])}${franchiseField('frOwner','加盟主',f.ownerName)}${franchiseField('frCompany','公司／商號',f.companyName)}${franchiseField('frTaxId','統一編號',f.taxId)}${franchiseField('frPhone','聯絡電話',f.phone)}${franchiseField('frEmail','電子郵件',f.email,'email')}${franchiseField('frContractNo','合約編號',f.contractNo)}${franchiseField('frStart','合約開始日',f.contractStart,'date')}${franchiseField('frEnd','合約到期日',f.contractEnd,'date')}${franchiseField('frStatus','合約狀態',f.contractStatus,'select',['未設定','有效','待續約','已到期','終止'])}${franchiseField('frDeposit','保證金',f.depositAmount,'number')}</div>${franchiseField('frNote','備註',f.note,'textarea')}<button class="primary" id="frSaveEditor">儲存</button>`;
 }else if(kind==='document'){title=id?'修改加盟文件':'新增加盟文件';html=`<div class="settings-grid">${franchiseField('frDocType','文件類型',x.type,'select',['加盟合約','續約文件','補充協議','切結／同意書','其他'])}${franchiseField('frDocTitle','文件名稱',x.title)}${franchiseField('frDocVersion','版本',x.version)}${franchiseField('frDocEffective','生效日',x.effectiveDate,'date')}${franchiseField('frDocExpiry','到期日',x.expiryDate,'date')}${franchiseField('frDocStatus','狀態',x.status||'有效','select',['有效','待簽署','待更新','已到期','作廢'])}</div>${franchiseField('frDocNote','備註',x.note,'textarea')}<button class="primary" id="frSaveEditor">儲存</button>`;
 }else if(kind==='fee'){title=id?'修改加盟費用':'新增加盟費用';html=`<div class="settings-grid">${franchiseField('frFeeName','費用名稱',x.name)}${franchiseField('frFeeAmount','金額',x.amount,'number')}${franchiseField('frFeeCycle','週期',x.cycle||'每月','select',['一次性','每月','每季','每半年','每年','其他'])}${franchiseField('frFeeDue','繳款日／說明',x.dueDay)}${franchiseField('frFeeActive','狀態',x.active===false?'停用':'啟用','select',['啟用','停用'])}</div>${franchiseField('frFeeNote','備註',x.note,'textarea')}<button class="primary" id="frSaveEditor">儲存</button>`;
 }else if(kind==='contact'){title=id?'修改加盟聯絡窗口':'新增加盟聯絡窗口';html=`<div class="settings-grid">${franchiseField('frContactCategory','類別',x.category,'select',['加盟營運','帳務','設備','教育訓練','其他'])}${franchiseField('frContactName','姓名／單位',x.name)}${franchiseField('frContactPhone','電話',x.phone)}${franchiseField('frContactEmail','Email',x.email,'email')}</div>${franchiseField('frContactNote','備註',x.note,'textarea')}<button class="primary" id="frSaveEditor">儲存</button>`;
 }else if(kind==='request'){title='新增加盟申請／異動';html=`<div class="settings-grid">${franchiseField('frReqType','申請類型','加盟主資料變更','select',['加盟主資料變更','合約異動／續約','匯款帳戶變更','設備申請','其他'])}${franchiseField('frReqSubject','主旨','')}</div>${franchiseField('frReqDetail','申請內容','','textarea')}<button class="primary" id="frSaveEditor">送出申請</button>`;
 }
 dlg(title,html);
 setTimeout(()=>{const b=document.querySelector('#frSaveEditor');if(!b)return;b.onclick=()=>{
  const v=id=>document.querySelector('#'+id)?.value??'';const now=new Date().toISOString();
  if(kind==='profile'){
   const all=load(K.franchiseProfiles,[])||[],i=all.findIndex(y=>String(y.storeCode)===store),next={storeCode:store,storeName:v('frStoreName'),franchiseType:v('frType'),ownerName:v('frOwner'),companyName:v('frCompany'),taxId:v('frTaxId'),phone:v('frPhone'),email:v('frEmail'),contractNo:v('frContractNo'),contractStart:v('frStart'),contractEnd:v('frEnd'),contractStatus:v('frStatus'),depositAmount:Number(v('frDeposit')||0),note:v('frNote'),updatedAt:now,updatedBy:currentUser()?.name||''};if(i>=0)all[i]={...all[i],...next};else all.push(next);save(K.franchiseProfiles,all);saveAudit('加盟專區','修改加盟基本資料');
  }else if(kind==='document'){
   const all=load(K.franchiseDocuments,[])||[],i=all.findIndex(y=>String(y.id)===String(id)),next={id:id||uid(),storeCode:store,type:v('frDocType'),title:v('frDocTitle'),version:v('frDocVersion'),effectiveDate:v('frDocEffective'),expiryDate:v('frDocExpiry'),status:v('frDocStatus'),note:v('frDocNote'),updatedAt:now};if(!next.title)return alert('請輸入文件名稱');if(i>=0)all[i]={...all[i],...next};else all.unshift(next);save(K.franchiseDocuments,all);saveAudit('加盟專區',`${id?'修改':'新增'}加盟文件｜${next.title}`);
  }else if(kind==='fee'){
   const all=load(K.franchiseFees,[])||[],i=all.findIndex(y=>String(y.id)===String(id)),next={id:id||uid(),storeCode:store,name:v('frFeeName'),amount:Number(v('frFeeAmount')||0),cycle:v('frFeeCycle'),dueDay:v('frFeeDue'),active:v('frFeeActive')!=='停用',note:v('frFeeNote'),updatedAt:now};if(!next.name)return alert('請輸入費用名稱');if(i>=0)all[i]={...all[i],...next};else all.unshift(next);save(K.franchiseFees,all);saveAudit('加盟專區',`${id?'修改':'新增'}加盟費用｜${next.name}`);
  }else if(kind==='contact'){
   const all=load(K.franchiseContacts,[])||[],i=all.findIndex(y=>String(y.id)===String(id)),next={id:id||uid(),storeCode:store,category:v('frContactCategory'),name:v('frContactName'),phone:v('frContactPhone'),email:v('frContactEmail'),note:v('frContactNote'),updatedAt:now};if(!next.name)return alert('請輸入姓名／單位');if(i>=0)all[i]={...all[i],...next};else all.unshift(next);save(K.franchiseContacts,all);saveAudit('加盟專區',`${id?'修改':'新增'}加盟聯絡窗口｜${next.name}`);
  }else if(kind==='request'){
   const subject=v('frReqSubject').trim(),detail=v('frReqDetail').trim();if(!subject)return alert('請輸入主旨');const all=load(K.franchiseRequests,[])||[];all.unshift({id:uid(),storeCode:store,type:v('frReqType'),subject,detail,status:'待處理',createdAt:now,createdBy:currentUser()?.name||'',updatedAt:now});save(K.franchiseRequests,all);saveAudit('加盟專區',`新增加盟申請｜${subject}`);
  }
  genericDialog.close();render('franchise-area');
 };},0);
}
async function refreshFranchiseCloud({rerender=false}={}){
 if(!cloudConfigured())return false;const keys=[K.franchiseProfiles,K.franchiseDocuments,K.franchiseFees,K.franchiseRequests,K.franchiseContacts],before=keys.map(k=>JSON.stringify(load(k,null)));for(const k of keys){try{await cloudPullKey(k)}catch(_e){}}const changed=keys.some((k,i)=>before[i]!==JSON.stringify(load(k,null)));if(rerender&&changed&&currentAdminPage()==='franchise-area')render('franchise-area');return changed;
}
function bindFranchiseArea(){
 document.querySelector('[data-action="franchise-refresh"]')?.addEventListener('click',async()=>{await refreshFranchiseCloud({rerender:true});alert('加盟專區已同步')});
 document.querySelectorAll('[data-franchise-action]').forEach(b=>b.addEventListener('click',()=>{
  const a=b.dataset.franchiseAction,id=b.dataset.id||'';
  if(['edit-profile','add-document','edit-document','add-fee','edit-fee','add-contact','edit-contact'].includes(a)&&!isFounder())return alert('只有創辦人可以修改加盟主檔');
  if(a==='edit-profile')return franchiseOpenEditor('profile');if(a==='add-document')return franchiseOpenEditor('document');if(a==='edit-document')return franchiseOpenEditor('document',id);if(a==='add-fee')return franchiseOpenEditor('fee');if(a==='edit-fee')return franchiseOpenEditor('fee',id);if(a==='add-contact')return franchiseOpenEditor('contact');if(a==='edit-contact')return franchiseOpenEditor('contact',id);if(a==='add-request')return franchiseOpenEditor('request');
  const defs={
   'delete-document':[K.franchiseDocuments,'加盟文件'],'delete-fee':[K.franchiseFees,'加盟費用'],'delete-contact':[K.franchiseContacts,'聯絡窗口'],'delete-request':[K.franchiseRequests,'申請紀錄']
  };
  if(defs[a]){if(!isFounder())return alert('只有創辦人可以刪除');const [key,label]=defs[a],all=load(key,[])||[],x=all.find(v=>String(v.id)===String(id));if(!x)return;if(!confirm(`確定刪除這筆${label}？`))return;save(key,all.filter(v=>String(v.id)!==String(id)));saveAudit('加盟專區',`刪除${label}`);render('franchise-area');return;}
  if(a==='request-status'){if(!isFounder())return;const all=load(K.franchiseRequests,[])||[],x=all.find(v=>String(v.id)===String(id));if(!x)return;const next=prompt('更新狀態：待處理／處理中／完成／退件／取消',x.status||'待處理');if(next===null)return;x.status=String(next||'待處理').trim()||'待處理';x.updatedAt=new Date().toISOString();x.updatedBy=currentUser()?.name||'';save(K.franchiseRequests,all);saveAudit('加盟專區',`更新申請狀態｜${x.subject}｜${x.status}`);render('franchise-area');}
 }));
}

function noticeVerticalPager(total,page,size){
 const pages=Math.max(1,Math.ceil(total/size)),current=Math.min(Math.max(1,page),pages);
 let nums=[];
 if(pages<=5)nums=Array.from({length:pages},(_,i)=>i+1);
 else if(current<=3)nums=[1,2,3,4,5];
 else if(current>=pages-2)nums=[pages-4,pages-3,pages-2,pages-1,pages];
 else nums=[current-2,current-1,current,current+1,current+2];
 return `<aside class="notice-vertical-pager" aria-label="通報頁數">
  <button type="button" class="notice-page-arrow" data-notice-page="${Math.max(1,current-1)}" ${current===1?'disabled':''}>⌃</button>
  ${nums.map(n=>`<button type="button" class="notice-page-no ${n===current?'active':''}" data-notice-page="${n}">${n}</button>`).join('')}
  ${pages>5?'<span class="notice-page-more">⋮</span>':''}
  <button type="button" class="notice-page-arrow" data-notice-page="${Math.min(pages,current+1)}" ${current===pages?'disabled':''}>⌄</button>
 </aside>`;
}
function noticePageHtml(){
 const detailId=String(window.__yjNoticeDetailId||'');
 if(detailId){
  const x=noticeRows().find(v=>String(v.id)===detailId);
  if(!x){window.__yjNoticeDetailId='';return noticePageHtml()}
  return `<div class="notice-page notice-detail-page"><div class="page-head"><div><h2>通報詳細</h2><small>通報與調查 ＞ ${esc(noticeCategory(x))}</small></div><div class="toolbar"><button class="button" data-action="notice-print">🖨️ 列印</button><button class="button" data-action="notice-back">← 返回通報列表</button></div></div><section class="panel notice-detail-card formal">${noticeFormalDetailHtml(x)}</section></div>`;
 }
 const f=window.__yjNoticeFilter||noticeDefaultRange();window.__yjNoticeFilter=f;
 const all=noticeFilteredRows(),size=Number(window.__yjNoticePageSize||20)||20,pages=Math.max(1,Math.ceil(all.length/size));
 let page=Math.min(Math.max(1,Number(window.__yjNoticePage||1)||1),pages);window.__yjNoticePage=page;
 const slice=all.slice((page-1)*size,page*size);
 return `<div class="notice-page">
  <div class="page-head notice-title-head"><h2>通報</h2></div>
  <section class="panel notice-filter-panel">
   <div class="notice-date-row">
    <label>通報日期起<input id="noticeFrom" type="date" value="${esc(f.from||'')}"></label>
    <label>通報日期迄<input id="noticeTo" type="date" value="${esc(f.to||'')}"></label>
   </div>
   <div class="notice-subject-row"><label>通報主旨<input id="noticeQuery" value="${esc(f.q||'')}" placeholder="請輸入通報主旨關鍵字"></label><button class="primary notice-search-btn" data-action="notice-query">⌕　查詢</button></div>
  </section>
  <section class="panel notice-list-panel">
   <div class="notice-list-grid">
    <div class="notice-table-wrap"><table class="table notice-table"><thead><tr><th>通報主旨</th><th>通報日期</th></tr></thead><tbody>${slice.map(x=>`<tr class="${noticeIsRead(x)?'read':'unread'}"><td><button class="notice-subject-link ${String(x.priority)==='urgent'?'urgent':''}" data-notice-open="${esc(x.id)}"><span class="notice-megaphone">📣</span><span>${esc(x.subject||'')}</span>${noticeIsRead(x)?'':'<b class="notice-unread-dot" title="未讀"></b>'}</button></td><td>${rocDate(x.date)}</td></tr>`).join('')||'<tr><td colspan="2">目前條件下沒有通報</td></tr>'}</tbody></table></div>
    ${noticeVerticalPager(all.length,page,size)}
   </div>
   <div class="notice-page-size"><label>每頁 <select id="noticePageSize">${[10,20,30,50].map(n=>`<option value="${n}" ${size===n?'selected':''}>${n} 筆</option>`).join('')}</select></label></div>
  </section>
 </div>`;
}
function markNoticeRead(id){
 const rows=noticeRows(),x=rows.find(v=>String(v.id)===String(id));if(!x)return;
 x.readBy=Array.isArray(x.readBy)?x.readBy:[];const token=noticeReadToken();if(!x.readBy.includes(token)){x.readBy.push(token);save(K.notices,rows);saveAudit('閱讀通報',x.subject||id)}
 updateTopNoticeSummary();setTimeout(refreshTopTmRuntime,0);
}
function updateTopNoticeSummary(){
 const c=noticeUnreadCounts(),el=document.querySelector('.topnav-news span');
 if(el)el.textContent=`最新消息｜未讀取通報數：一般${c.normal}封／緊急${c.urgent}封`;
}
let noticeCloudBusy=false;
async function refreshNoticeCloud(){
 if(noticeCloudBusy||!cloudConfigured())return;noticeCloudBusy=true;
 try{const before=JSON.stringify(load(K.notices,[]));await cloudPullKey(K.notices);updateTopNoticeSummary();if(before!==JSON.stringify(load(K.notices,[]))&&currentAdminPage()==='notice')render('notice')}
 catch(_e){}finally{noticeCloudBusy=false}
}
function bindNoticePage(){
 document.querySelector('[data-action="notice-query"]')?.addEventListener('click',()=>{window.__yjNoticeFilter={from:document.querySelector('#noticeFrom')?.value||'',to:document.querySelector('#noticeTo')?.value||'',q:document.querySelector('#noticeQuery')?.value||''};window.__yjNoticePage=1;render('notice')});
 document.querySelector('#noticeQuery')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.querySelector('[data-action="notice-query"]')?.click()}});
 document.querySelectorAll('[data-notice-page]').forEach(b=>b.onclick=()=>{window.__yjNoticePage=Number(b.dataset.noticePage||1);render('notice')});
 document.querySelector('#noticePageSize')?.addEventListener('change',e=>{window.__yjNoticePageSize=Number(e.target.value||20);window.__yjNoticePage=1;render('notice')});
 document.querySelectorAll('[data-notice-open]').forEach(b=>b.onclick=()=>{const id=b.dataset.noticeOpen;markNoticeRead(id);window.__yjNoticeDetailId=id;render('notice')});
 document.querySelector('[data-action="notice-back"]')?.addEventListener('click',()=>{window.__yjNoticeDetailId='';render('notice')});
 document.querySelector('[data-action="notice-print"]')?.addEventListener('click',printNoticeDetail);
 updateTopNoticeSummary();
}

const TM_SC_LINK_KEY='yj_tm_sc_link';
function tmLinkRecord(){return load(TM_SC_LINK_KEY,null)||{};}
function tmLinkFresh(rec){const t=Date.parse(rec?.updatedAt||'');return Number.isFinite(t)&&(Date.now()-t)<=45000;}
async function refreshTopTmRuntime(){if(cloudConfigured())try{await cloudPullKey(TM_SC_LINK_KEY)}catch(_e){}const r=tmLinkRecord(),online=tmLinkFresh(r)&&r.tmOnline!==false&&r.tmState!=='restarting';const btn=document.querySelector('[data-top-tool="tm"]');if(btn){btn.classList.toggle('top-tool-abnormal',!online);btn.title=online?'TM 前台連線正常':'TM 未連線／日結中'}return online;}
function tmLinkPageHtml(){
 const r=tmLinkRecord(),fresh=tmLinkFresh(r),online=fresh&&r.tmOnline!==false&&r.tmState!=='restarting';
 return `<div class="page-head"><div><h2>TM 前台連線</h2><small>SC ↔ TM 即時連動</small></div><button class="button" data-action="tm-link-refresh">↻ 重新整理</button></div>
 <section class="panel tm-link-panel">
  <div class="metric-grid">
   <div class="metric"><small>連線狀態</small><strong class="${online?'ok':'bad'}">${online?'已連線':'未連線'}</strong></div>
   <div class="metric"><small>門市</small><strong>${esc(r.storeCode||currentStoreCode())}</strong></div>
   <div class="metric"><small>TM 版本</small><strong>${esc(r.tmVersion||'—')}</strong></div>
   <div class="metric"><small>最後回報</small><strong>${r.updatedAt?new Date(r.updatedAt).toLocaleTimeString('zh-TW',{hour12:false}):'—'}</strong></div>
  </div>
  <div class="tm-link-detail"><b>TM 狀態：</b>${r.cloudConfigured===false?'未設定雲端':online?'正常':'異常'}　｜　<b>操作員：</b>${esc(r.operator||'—')}　｜　<b>最後事件：</b>${esc(r.reason||'—')}</div>
  <p class="setting-hint">TM 前台開啟時會定期回報 SC 狀態；超過 45 秒未收到回報會顯示未連線。</p>
 </section>`;
}
async function refreshTmLinkPage(){
 if(cloudConfigured())try{await cloudPullKey(TM_SC_LINK_KEY)}catch(_e){}
 if(currentAdminPage()==='tm-link')render('tm-link');
}
function monthlyOperatingPreviewPage(){
 const now=new Date();
 const y=Number(sessionStorage.getItem('yj_monthly_operating_year')||now.getFullYear());
 const storeNo=currentStoreCode();
 const months=Array.from({length:12},(_,i)=>i+1);
 const revs=(load(K.revenue,[])||[]).filter(r=>String(r.date||'').startsWith(String(y)+'-')&&recordStoreCode(r)===storeNo);
 const txs=(load(K.sales,[])||load(K.transactions,[])||[]).filter(s=>{const d=new Date(s.at||s.date||0);return d.getFullYear()===y&&recordStoreCode(s)===storeNo&&s.status!=='作廢'});
 const monthly=months.map(m=>{
   const rs=revs.filter(r=>Number(String(r.date||'').slice(5,7))===m);
   const ss=txs.filter(t=>new Date(t.at||t.date||0).getMonth()+1===m);
   const revenue=rs.length?rs.reduce((a,r)=>a+Number(r.total||r.revenue||r.actualCash||0),0):ss.reduce((a,t)=>a+Number(t.netTotal??t.total??0),0);
   const cost=ss.reduce((a,t)=>a+(t.items||[]).reduce((z,it)=>z+Number(it.cost||0)*Math.max(0,Number(it.qty||0)-Number(it.returnedQty||0)),0),0);
   const labor=rs.reduce((a,r)=>a+Number(r.laborCost||r.personnelCost||0),0);
   const rent=rs.reduce((a,r)=>a+Number(r.rent||r.storeExpense||0),0);
   const utilities=rs.reduce((a,r)=>a+Number(r.utilities||r.operatingExpense||0),0);
   const otherIncome=rs.reduce((a,r)=>a+Number(r.otherIncome||0),0);
   const otherExpense=rs.reduce((a,r)=>a+Number(r.otherExpense||0),0);
   const gross=revenue-cost;
   const profit=gross+otherIncome-labor-rent-utilities-otherExpense;
   return {revenue,cost,gross,labor,rent,utilities,otherIncome,otherExpense,profit};
 });
 const defs=[['營業收入合計','revenue','收入'],['營業成本合計','cost','成本'],['毛利','gross','損益'],['人件費','labor','費用'],['租金／店舖費用','rent','費用'],['水電／營運費用','utilities','費用'],['其他收入','otherIncome','收入'],['其他費用','otherExpense','費用'],['營業利益','profit','損益']];
 const body=defs.map(([name,key,type])=>{const vals=monthly.map(x=>Number(x[key]||0));const total=vals.reduce((a,b)=>a+b,0);return `<tr><th><span>${esc(name)}</span><small>${esc(type)}</small></th>${vals.map(v=>`<td>${money(v)}</td>`).join('')}<td class="report-total">${money(total)}</td><td>—</td><td>—</td><td>${money(total)}</td></tr>`}).join('');
 return `<div class="page-head"><div><h2>📊 月度營運分析</h2><small>依目前 SC 營收與交易資料自動彙整；資料異動後重新進入此頁即自動更新。</small></div><div class="toolbar"><button class="button" data-action="monthly-operating-print">🖨️ 列印</button><button class="button" data-action="monthly-operating-export">匯出</button></div></div>
 <section class="panel monthly-operating-filters"><label>年度<select id="monthlyOperatingYear">${Array.from({length:7},(_,i)=>y-3+i).map(v=>`<option value="${v}" ${v===y?'selected':''}>${v}</option>`).join('')}</select></label><label>店號<input value="${esc(storeNo)}" readonly></label><label>資料狀態<input value="自動更新" readonly></label></section>
 <section class="panel"><div class="notice"><b>自動更新</b><br><small>營業收入會優先使用營收資料；有交易明細時同步計算商品成本與毛利。尚未建立正式來源的費用欄位維持 0／—，不會寫死假資料。</small></div><div class="table-wrap monthly-operating-wrap"><table class="table monthly-operating-table"><thead><tr><th>科目／項目</th>${months.map(m=>`<th>${m}月</th>`).join('')}<th>本期合計</th><th>預算</th><th>差異</th><th>累計</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function scSurfaceStockMap(){return load('yj_sc_surface_stock',{})||{}}
function scSurfaceStockValue(p){const m=scSurfaceStockMap();return Object.prototype.hasOwnProperty.call(m,String(p?.id||''))?Number(m[String(p.id)]||0):Number(p?.stock||0)}

function ensureCollectionDefaultProviders(){
 const key='yj_collection_service_providers',rows=load(key,[])||[];
 const defaults=[
  {id:'COL-TRAFFIC-FINE',name:'交通違規罰鍰',type:'政府規費',prefix:'',length:0,barcodeMode:'three',minAmount:1,maxAmount:0,feeMode:'custom',fee:7,paymentMethod:'現金',allowCash:true,allowNonCash:false,enabled:true,overduePolicy:'reprint',reprintMethod:'kiosk',reprintNote:'逾期可由多媒體機查詢補單；行政執行案件、須到案或不可線上繳款案件除外。'},
  {id:'COL-PARKING',name:'路邊停車費',type:'政府規費',prefix:'',length:0,barcodeMode:'single',minAmount:1,maxAmount:0,feeMode:'none',fee:0,paymentMethod:'現金',allowCash:true,allowNonCash:false,enabled:true,overduePolicy:'reprint',reprintMethod:'kiosk',reprintNote:'多數縣市可由超商多媒體機依車號查詢補單；可補期限依各縣市規定及查詢結果。'},
  {id:'COL-LOCAL-TAX',name:'地方稅繳款書',type:'政府規費',prefix:'',length:0,barcodeMode:'single',minAmount:1,maxAmount:30000,feeMode:'none',fee:0,paymentMethod:'現金',allowCash:true,allowNonCash:false,enabled:true,overduePolicy:'reprint',reprintMethod:'kiosk',reprintNote:'房屋稅、地價稅、使用牌照稅等於適用期間可由多媒體機補單；單筆超商代收上限依現行規定。'},
  {id:'COL-ENFORCEMENT',name:'行政執行／須到案案件',type:'政府規費',prefix:'',length:0,barcodeMode:'single',minAmount:1,maxAmount:0,feeMode:'inherit',fee:0,paymentMethod:'現金',allowCash:true,allowNonCash:false,enabled:true,overduePolicy:'reject',reprintMethod:'issuer',reprintNote:'不由 TM 自動補單受理，請依案件通知洽原機關／執行機關辦理。'}
 ];
 let changed=false;
 for(const d of defaults){
  if(!rows.some(x=>String(x.id||'')===d.id||String(x.name||'')===d.name)){rows.push({...d,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});changed=true}
 }
 if(changed)save(key,rows);
 return rows;
}

function collectionServicePage(){
 const cfg=load('yj_collection_service_config',{enabled:true,minAmount:1,maxAmount:50000,paymentMethod:'現金',allowCash:true,allowNonCash:false,fee:0})||{};
 const providers=ensureCollectionDefaultProviders();
 const feeLabel=x=>x.feeMode==='none'?'不收':x.feeMode==='custom'?money(Number(x.fee||0)):`依基本設定${Number(cfg.fee||0)>0?'（'+money(Number(cfg.fee||0))+'）':''}`;
 const paymentLabel=x=>String(x.paymentMethod||((x.allowCash!==false)?'現金':(x.allowNonCash===true?'信用卡':'現金')));
 const barcodeModeLabel=x=>({three:'三段式',two:'二段式',qr:'QR Code',single:'單一條碼'}[x.barcodeMode]||'三段式');
 const overdueLabel=x=>({accept:'逾期可直接收',reprint:'需補單',reject:'不可受理'}[x.overduePolicy]||'依發行單位');
 const reprintLabel=x=>({kiosk:'多媒體機台',issuer:'原發行單位',none:'不提供補單'}[x.reprintMethod]||'—');
 const rows=providers.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.name||'')}</td><td>${esc(x.type||'一般代收')}</td><td>${barcodeModeLabel(x)}</td><td>${esc(x.prefix||'—')}</td><td>${Number(x.length||0)||'不限'}</td><td>${Number(x.minAmount||0)>0?money(Number(x.minAmount||0)):'依全域'}</td><td>${Number(x.maxAmount||0)>0?money(Number(x.maxAmount||0)):'依全域'}</td><td>${feeLabel(x)}</td><td>${overdueLabel(x)}</td><td>${reprintLabel(x)}</td><td>${esc(paymentLabel(x))}</td><td>${x.enabled===false?'停用':'啟用'}</td><td><div class="toolbar" style="gap:6px"><button class="button" data-action="collection-provider-edit" data-provider-index="${i}">修改</button><button class="button danger" data-action="collection-provider-delete" data-provider-index="${i}">刪除</button></div></td></tr>`).join('')||'<tr><td colspan="14">尚未建立代收單位規則</td></tr>';
 return `<div class="page-head"><div><h2>代收服務</h2><small>營收業務｜TM 直接過刷帳單所使用的代收主檔與規則</small></div><button class="button" data-nav="home">← 返回首頁</button></div>
 <section class="panel"><h3>代收基本設定</h3><div class="settings-grid">
  <label>代收服務<select id="collectionEnabled"><option value="true" ${cfg.enabled!==false?'selected':''}>啟用</option><option value="false" ${cfg.enabled===false?'selected':''}>停用</option></select></label>
  <label>最低可收金額<input id="collectionMin" type="number" min="0" value="${Number(cfg.minAmount??1)}"></label>
  <label>最高可收金額<input id="collectionMax" type="number" min="0" value="${Number(cfg.maxAmount??50000)}"></label>
  <label>基本手續費<input id="collectionFee" type="number" min="0" value="${Number(cfg.fee||0)}"><small>只套用到設定為「依基本設定」的代收單位</small></label>
  <label>支付<select id="collectionPaymentMethod"><option value="現金" ${String(cfg.paymentMethod||((cfg.allowCash!==false)?'現金':'信用卡'))==='現金'?'selected':''}>現金</option><option value="信用卡" ${String(cfg.paymentMethod||((cfg.allowCash!==false)?'現金':'信用卡'))==='信用卡'?'selected':''}>信用卡</option><option value="億家Pay" ${String(cfg.paymentMethod||'')==='億家Pay'?'selected':''}>億家Pay</option></select></label>
 </div><div class="toolbar"><button class="primary" data-action="collection-service-save">儲存代收設定</button></div>
 <div class="notice" style="margin-top:12px">「基本手續費」只是預設值；每個代收單位可另外設定「依基本設定／不收手續費／自訂手續費」。SC 斷線時 TM 不得完成代收交易。</div></section>
 <section class="panel" style="margin-top:14px"><h3>代收單位／條碼規則</h3><input id="collectionProviderEditId" type="hidden" value=""><div class="settings-grid">
  <label>代收單位<input id="collectionProviderName" placeholder="例如：電力公司"></label>
  <label>代收類型<select id="collectionProviderType"><option>一般代收</option><option>水電瓦斯</option><option>電信</option><option>信用卡／金融</option><option>政府規費</option><option>其他</option></select></label>
  <label>條碼模式<select id="collectionProviderBarcodeMode"><option value="three">三段式</option><option value="two">二段式</option><option value="qr">QR Code</option><option value="single">單一條碼</option></select></label>
  <label>條碼開頭<input id="collectionProviderPrefix" placeholder="可留空"></label>
  <label>條碼長度<input id="collectionProviderLength" type="number" min="0" placeholder="0＝不限"></label>
  <label>最低金額<input id="collectionProviderMin" type="number" min="0" placeholder="0＝依代收基本設定"></label>
  <label>單筆上限<input id="collectionProviderMax" type="number" min="0" placeholder="0＝依代收基本設定"></label>
  <label>手續費方式<select id="collectionProviderFeeMode"><option value="inherit">依基本設定</option><option value="none">不收手續費</option><option value="custom">自訂手續費</option></select></label>
  <label>自訂手續費<input id="collectionProviderFee" type="number" min="0" placeholder="僅自訂手續費時使用"></label>
  <label>支付<select id="collectionProviderPaymentMethod"><option value="現金">現金</option><option value="信用卡">信用卡</option><option value="億家Pay">億家Pay</option></select></label>
  <label>逾期處理<select id="collectionProviderOverdue"><option value="reprint">需補單</option><option value="accept">逾期可直接收</option><option value="reject">不可受理</option></select></label>
  <label>補單方式<select id="collectionProviderReprint"><option value="kiosk">多媒體機台</option><option value="issuer">原發行單位</option><option value="none">不提供補單</option></select></label>
  <label>補單備註<input id="collectionProviderReprintNote" placeholder="例如：逾期可由多媒體機查詢補單"></label>
  <label>狀態<select id="collectionProviderEnabled"><option value="true">啟用</option><option value="false">停用</option></select></label>
 </div><div class="notice" style="margin:10px 0">一般帳單可設定三段式；EC 使用二段式；多媒體機補印單可設定 QR Code。逾期規則分為「可直接收／需補單／不可受理」，補單可指定多媒體機台或原發行單位。系統已預建交通罰鍰、路邊停車費、地方稅與行政執行／須到案案件的保守規則；實際仍以發行單位與即時查詢結果為準。</div><div class="toolbar"><button class="primary" data-action="collection-provider-save" id="collectionProviderSaveBtn">＋ 新增代收單位</button><button class="button" data-action="collection-provider-cancel-edit" id="collectionProviderCancelEdit" hidden>取消修改</button></div>
 <div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>#</th><th>代收單位</th><th>類型</th><th>條碼模式</th><th>條碼開頭</th><th>長度</th><th>最低金額</th><th>單筆上限</th><th>手續費</th><th>逾期</th><th>補單</th><th>支付</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></section>
 <section class="panel" style="margin-top:14px"><h3>代收作業</h3><div class="order-type-grid">
  <button class="order-type" type="button">代收交易查詢<small>交易紀錄入口</small></button>
  <button class="order-type" type="button">代收異常查詢<small>異常／拒收紀錄</small></button>
  <button class="order-type" type="button">代收日結／報表<small>日結與彙總</small></button>
 </div><div class="notice">以上查詢／報表入口先建立架構；待 TM 代收正式交易資料同步後接入正式資料。</div></section>`;
}

function back(p){
 if(!isStocktakeOperator()&&!String(p||'').startsWith('prebuild-')&&!scDirectPageAccessAllowed(p))return `<div class="page-head"><div><h2>權限不足</h2></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><p>此功能需要第一層、第二層與第三層權限。</p></div>`;
 const pagePerm=HOME_PAGE_PERMISSION[p]||'';
 const founderRecovery=isFounder()&&['employees','permissions'].includes(p);
 if(!isStocktakeOperator()&&pagePerm&&!founderRecovery&&!hasPermission(pagePerm))return `<div class="page-head"><div><h2>權限不足</h2></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><p>需要「${esc(permissionLabels[pagePerm]||pagePerm)}」權限。</p></div>`;
 if(p==='promotions'&&!isFounder())return `<h2>總部商品活動設定</h2><div class="panel"><p>此功能只有創辦人可以使用。</p></div>`;
 if(p==='app-settings'&&!canAccessHqAppSettings())return `<h2>App設定</h2><div class="panel"><p>此功能僅限總部 SC；創辦人預設可用，工程師／總部人員需由創辦人開啟「App設定」權限。</p></div>`;
 if(p==='notice-editor'&&!isFounder())return `<h2>通報編輯</h2><div class="panel"><p>只有創辦人帳號可以使用此功能。</p></div>`;

 const prebuildMeta=scPrebuildMeta(p);if(prebuildMeta){
  if(!scPrebuildOptionVisible(p))return `<div class="page-head"><div><h2>功能尚未開放</h2></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><p>此選項尚未正式接通，目前已隱藏。需要使用時請由創辦人到「權限設定 → 未接通選單顯示管理」開啟。</p></div>`;
  if(isStocktakeOperator()){
   if(!stocktakeScPageAllowed(p))return `<div class="page-head"><div><h2>權限不足</h2></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><p>此盤點功能尚未開啟權限。</p></div>`;
   return scPrebuildPage(p);
  }
  if(!scPrebuildAccessAllowed(p))return `<div class="page-head"><div><h2>權限不足</h2></div><button class="button" data-nav="home">← 返回</button></div><div class="panel"><p>此功能需要第一層、第二層與第三層權限。</p></div>`;
  return scPrebuildPage(p);
 }
 if(p==='home'){return isStocktakeOperator()?stocktakeOperatorHome():storeOperationsHome()}
 if(p==='stocktake-personnel-mode')return stocktakePersonnelModePage();
 if(p==='stocktake-upload-hq')return stocktakeUploadHqPage();
 if(p==='monthly-operating-preview')return monthlyOperatingPreviewPage();
 if(p==='stocktake-report')return stocktakeReportPage();
 if(p==='stocktake-personnel')return stocktakePersonnelPage();
 if(p==='engineer-personnel')return specialPersonnelPage('engineer');
 if(p==='engineer-personnel-permissions')return specialPersonnelPermissionsPage('engineer');
 if(p==='engineer-tm-permissions')return specialTmPermissionsPage('engineer');
 if(p==='stocktake-tm-permissions')return specialTmPermissionsPage('stocktake');
 if(p==='hq-personnel')return specialPersonnelPage('hq');
 if(p==='hq-personnel-permissions')return specialPersonnelPermissionsPage('hq');
 if(p==='hq-tm-permissions')return specialTmPermissionsPage('hq');
 if(p==='collection-service')return collectionServicePage();

 if(p==='products'){
  if(!productManagement2Allowed())return `<div class="panel"><h2>權限不足</h2><p>商品管理 2.0 僅限管理員、總部人員、工程師使用。</p></div>`;
  return`<div class="page-head"><div><div><h2>商品管理 2.0</h2><small>商品管理導頁修正版</small></div><small>商品主檔／條碼／售價／成本／庫存／訂購設定</small></div><div class="toolbar"><input id="productAdminSearch" placeholder="搜尋商品代號／名稱／條碼"><button class="button" data-action="print-all-product-barcodes">🖨️ 列印</button><button class="button" data-action="manage-groups">品群分類</button><button class="button" data-action="product-multiple-settings">商品倍數設定</button>${isFounder()?'<button class="button" data-action="linked-inventory-settings">🔗 組合／拆零商品設定</button>':''}${canEditGlobalProductMaster()?'<button class="primary" data-action="new-product">＋ 新增商品</button><button class="button" data-action="tm-hidden-products-settings">TM不顯示設定</button>':''}${canManageTmScreenCategories()?'<button class="button" data-action="tm-screen-categories-settings">TM畫面分類設定</button><button class="button" data-action="tm-quick-amount-settings">TM快速金額鍵設定</button><button class="button" data-action="self-anybuy-category-settings">自助模式分類設定</button><button class="button" data-action="self-anybuy-product-settings">隨買跨店取商品管理</button><span class="product-spec-hint">規格可在每個商品「修改」內設定</span>':''}</div></div><div class="panel table-wrap"><table class="table product-master-table"><thead><tr><th>商品代號</th><th>商品</th><th>規格</th><th>類別</th><th>品群</th><th>配送別</th><th>可訂購分類</th><th>售價</th><th>成本</th><th>毛利率</th><th>庫存</th><th>不良退</th><th>允許負庫存</th><th>訂購倍數</th><th>狀態</th><th>操作</th></tr></thead><tbody id="productAdminRows">${productRows()}</tbody></table></div>`;
 }
 if(p==='linked-inventory-settings')return linkedInventorySettingsPage();
 if(p==='ordering-suggestion-settings')return orderingSuggestionSettingsPage();
 if(p==='ordering-reservations')return orderingReservationsPage();
 if(p==='ordering-specified-date')return orderingSpecifiedDatePage();
 if(p==='ordering-auto-settings')return orderingAutoSettingsPage();
 if(p==='ordering-fresh-settings')return orderingFreshSettingsPage();
 if(p==='ordering-rules-settings')return orderingRulesSettingsPage();
 if(p==='ordering')return orderingCategoryPage('ledger');
 if(p==='ordering-ledger')return scLedgerPage();
 if(p==='ordering-use')return orderingCategoryPage('use');
 if(p==='ordering-special')return orderingCategoryPage('special');
 if(p==='ordering-frozen')return orderingCategoryPage('special');
 if(p==='ordering-fos')return orderingCategoryPage('fos');
 if(p==='ordering-group')return orderingCategoryPage('group');
 if(p==='ordering-fos-favorites')return orderingFavoritesPage('fos');
 if(p==='ordering-use-favorites')return orderingFavoritesPage('use');
 if(p==='ordering-special-favorites')return orderingFavoritesPage('special');
 if(p==='ordering-group-favorites')return orderingFavoritesPage('group');
 if(p==='ordering-face')return orderingFacePage();
 if(p==='ordering-ledger-detail')return orderingDetailPage('ledger');
 if(p==='ordering-use-detail')return orderingDetailPage('use');
 if(p==='ordering-special-detail')return orderingDetailPage('special');
 if(p==='ordering-frozen-detail')return orderingDetailPage('special');
 if(p==='ordering-fos-detail')return orderingDetailPage('fos');
 if(p==='ordering-group-detail')return orderingDetailPage('group');
 if(false&&p==='ordering'){const rows=load(K.orders,[]),types=['台帳訂購','FOS鮮食訂購','用度品訂購','特殊品訂購','品群訂購'];return`<div class="page-head"><h2>訂購管理</h2><div class="toolbar"><button class="primary" data-action="new-order">＋ 新增訂購單</button></div></div><div class="order-type-grid">${types.map(t=>`<button class="order-type" data-order-filter="${t}">${t}</button>`).join('')}</div><div class="panel table-wrap"><table class="table"><thead><tr><th>訂單號</th><th>類型</th><th>預定到貨</th><th>品項數</th><th>總數量</th><th>狀態</th><th>操作</th></tr></thead><tbody id="orderRows">${orderRows(rows)}</tbody></table></div>`}
 if(p==='inventory'){
 if(!isFounder()&&!hasPermission('scStocktake'))return `<h2>SC 盤點</h2><div class="panel"><p>需要「SC 盤點」權限。</p><p>SC 盤點只修正 SC 顯示帳面，不會改動店舖實際庫存。</p></div>`;
 const ps=products(),allMoves=load(K.inventoryMoves,[]),allBatches=load(K.stocktakeBatches,[]);
 const now=new Date(),nowMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 const stocktakeMonth=load(K.stocktakeMonth,nowMonth)||nowMonth,monthOf=v=>String(v||'').slice(0,7);
 const moves=allMoves.filter(x=>x.type!=='盤點'||(x.stocktakeMonth||monthOf(x.at))===stocktakeMonth);
 const batches=allBatches.filter(x=>(x.stocktakeMonth||monthOf(x.startedAt))===stocktakeMonth);
 const active=allBatches.find(x=>x.status==='進行中');
 const latestMoveByProduct={};
 moves.filter(x=>x.type==='盤點').forEach(x=>{
  if(latestMoveByProduct[x.product]===undefined)latestMoveByProduct[x.product]=x;
 });
 const counted=Object.keys(latestMoveByProduct).length,uncounted=Math.max(0,ps.length-counted);
 const batchRows=batches.map(x=>`<tr>
  <td>${esc(x.batchNo)}</td><td>${esc(x.status)}</td><td>${Number(x.itemCount||0)}</td>
  <td>${Number(x.diffTotal)>0?'+':''}${Number(x.diffTotal||0)}</td>
  <td>${new Date(x.startedAt).toLocaleString('zh-TW')}</td>
  <td>${x.completedAt?new Date(x.completedAt).toLocaleString('zh-TW'):'—'}</td>
  <td>${isFounder()?`<button class="button danger" data-delete-stocktake-batch="${x.id}">刪除</button>`:'—'}</td>
 </tr>`).join('')||'<tr><td colspan="7">尚無盤點批次</td></tr>';
 const recordRows=moves.filter(x=>x.type==='盤點').map(x=>`<tr>
  <td>${esc(x.batchNo||'—')}</td><td>${esc(x.product)}</td>
  <td>${Number(x.bookQty??(Number(x.actualQty||0)-Number(x.qty||0)))}</td>
  <td>${Number(x.actualQty??(Number(x.bookQty||0)+Number(x.qty||0)))}</td>
  <td>${Number(x.qty)>0?'+':''}${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td>
  <td>${new Date(x.at).toLocaleString('zh-TW')}</td>
  <td>${isFounder()?`<button class="button danger" data-delete-stocktake-record="${x.id}">刪除</button>`:'—'}</td>
 </tr>`).join('')||'<tr><td colspan="8">尚無盤點紀錄</td></tr>';
 const canOrderLimit=hasPermission('inventoryOrderLimitEdit');
 return `<div class="ref-stocktake-page-v303">
  <div class="ref-stocktake-title-v303">
   <div><h2>盤點管理 / 盤點表格模式</h2><small>可連續盤點，不會跳離此頁</small></div>
  </div>

  <section class="ref-stocktake-top-v303">
   <label><span>目前盤點單</span>
    <select id="stocktakeCurrentBatch" disabled>
     <option>${active?esc(active.batchNo):'目前無進行中盤點單'}</option>
    </select>
   </label>
   <label><span>盤點日期</span><input type="date" value="${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}" readonly></label>
   <label><span>月份設定</span><button class="button" data-action="inventory-month-setting">${esc(stocktakeMonth.replace('-','年')+'月')}</button></label>
   <div class="ref-stocktake-primary-actions-v303">
    ${active?`<button class="primary" data-action="stocktake-complete">完成盤點</button>`:`<button class="primary" data-action="stocktake-start">＋ 開始盤點</button>`}
    <button class="button" data-action="inventory-print">🖨️ 列印</button>
   </div>
  </section>

  <section class="ref-stocktake-summary-tools-v303">
   <div class="ref-stocktake-counts-v303">
    <b>商品總數：${ps.length}</b>
    <b>已盤點：${counted}</b>
    <b class="pending">未盤點：${uncounted}</b>
   </div>
   <div class="ref-stocktake-search-v303">
    <input id="stocktakeTableSearch" placeholder="請輸入商品名稱／條碼">
    <button class="primary" type="button" data-action="stocktake-scan">▥ 掃碼盤點</button>
   </div>
  </section>

  <section class="panel table-wrap ref-stocktake-main-v303">
   <table class="table stocktake-entry-table ref-stocktake-table-v303">
    <thead><tr>
     <th>商品</th><th>條碼</th><th>帳面庫存</th><th>實盤數</th><th>差異值</th>
     <th>差異原因／備註</th><th>儲存狀態</th><th>操作</th>
    </tr></thead>
    <tbody>
     ${ps.map(x=>{
      const latest=latestMoveByProduct[x.name],diff=latest===undefined?null:Number(latest.qty||0);
      const bar=productBarcodes(x)[0]||'—';
      const savedAt=latest?.at?new Date(latest.at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      return `<tr data-stocktake-row="${x.id}">
       <td><div class="ref-stocktake-product-v303"><span>${x.icon||'📦'}</span><div><b>${esc(x.name)}</b><small>${esc(x.code||'')}</small></div></div></td>
       <td class="stocktake-barcode">${esc(bar)}</td>
       <td data-stocktake-book="${x.id}">${scSurfaceStockValue(x)}</td>
       <td><input class="stocktake-actual-input" type="number" min="0" inputmode="numeric" data-stocktake-actual="${x.id}" placeholder="請輸入"></td>
       <td data-stocktake-diff="${x.id}" class="${diff===0?'diff-ok':diff>0?'diff-over':diff<0?'diff-short':''}">${diff===null?'—':`${diff>0?'+':''}${diff}`}</td>
       <td><input class="stocktake-reason-input" data-stocktake-reason="${x.id}" placeholder="請輸入備註（選填）"></td>
       <td><div class="ref-stocktake-saved-v303 ${latest?'saved':'pending'}" data-stocktake-status="${x.id}">${latest?`✓ 已儲存<small>${savedAt} ${esc(latest.user||'')}</small>`:'● 尚未儲存'}</div></td>
       <td><button class="primary" data-stocktake-save="${x.id}">儲存</button></td>
      </tr>`;
     }).join('')}
    </tbody>
   </table>
  </section>

  <details class="ref-stocktake-secondary-v303">
   <summary>盤點管理工具／歷程</summary>
   <div class="toolbar">
    <button class="button" data-action="inventory-order-limits" ${canOrderLimit?'':'disabled title="需開啟最大／最小訂購數設定權限"'}>⚙️ 最大／最小訂購數設定</button>
   </div>
   <div class="panel table-wrap">
    <h3>盤點批次／盤點單號</h3>
    <table class="table"><tr><th>盤點單號</th><th>狀態</th><th>品項數</th><th>差異合計</th><th>開始時間</th><th>完成時間</th><th>操作</th></tr>${batchRows}</table>
   </div>
   <div class="panel table-wrap" style="margin-top:12px">
    <h3>盤點紀錄</h3>
    <table class="table"><tr><th>盤點單號</th><th>商品</th><th>帳面數</th><th>實盤數</th><th>差異值</th><th>原因</th><th>時間</th><th>操作</th></tr>${recordRows}</table>
   </div>
  </details>
 </div>`;
} if(p==='quality'){const w=load(K.waste,[]),canWaste=hasPermission('qualityWasteCreate'),freshAdmin=['創辦人','管理員'].includes(currentUser()?.role);return`<div class="page-head"><div><h2>品保／時控</h2><small>品保與時控共用同一權限</small></div><div class="toolbar"><button class="button" data-nav="time-control">⏱ 時控</button><button class="button" data-action="waste-query">🔎 廢棄查詢／修改</button><button class="button" data-action="new-waste" ${canWaste?'':'disabled title="需開啟廢棄登錄權限"'}>＋ 廢棄登錄</button><button class="primary" data-action="new-fresh-batch" ${freshAdmin?'':'disabled title="只有管理員可新增鮮食批次"'}>＋ 新增鮮食批次</button></div></div><div class="panel"><h3>鮮食批次管理</h3><div class="table-wrap"><table class="table fresh-batch-table"><thead><tr><th>批次號</th><th>商品代號</th><th>商品名稱</th><th>商品條碼</th><th>進貨時間</th><th>到期時間</th><th>進貨數量</th><th>剩餘數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${freshBatches().map(freshBatchRow).join('')||'<tr><td colspan="10">尚無鮮食批次</td></tr>'}</tbody></table></div></div><div class="panel" style="margin-top:14px"><h3>廢棄紀錄</h3><div class="table-wrap"><table class="table"><tr><th>商品</th><th>數量</th><th>原因</th><th>操作人</th><th>時間</th><th>操作</th></tr>${w.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${esc(x.reason)}</td><td>${esc(x.user||'')}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td><button class="button" data-waste-edit="${x.id}">修改</button></td></tr>`).join('')||'<tr><td colspan="6">尚無廢棄紀錄</td></tr>'}</table></div></div>`}
 if(p==='time-control'){const q=load(K.quality,[]),canTime=hasPermission('timeCreate');return`<div class="page-head"><div><h2>品保／時控－時控</h2><small>品保與時控共用同一權限</small></div><div class="toolbar"><button class="button" data-nav="quality">← 品保</button><button class="primary" data-action="new-quality" ${canTime?'':'disabled title="需開啟新增時控商品權限"'}>＋ 新增時控商品</button></div></div><div class="panel"><div class="table-wrap"><table class="table"><tr><th>商品</th><th>日期</th><th>折扣價</th><th>數量</th><th>狀態</th><th>操作</th></tr>${q.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.date)}</td><td>${money(x.price)}</td><td>${x.qty}</td><td>${esc(x.status)}</td><td><button class="button" data-edit-quality="${x.id}">修改</button> <button class="button" data-print-quality="${x.id}">列印</button> <button class="button danger" data-delete-quality="${x.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="6">尚無時控商品</td></tr>'}</table></div></div>`}
 if(p==='members'){
  const rows=load(K.members,[]);
  const canEdit=hasPermission('memberEdit'),canDelete=hasPermission('memberDelete');
  const anomalies=memberDailyPointAnomalies();
  return `<div class="member-admin-page">
   <div class="page-head">
    <div><h2>會員管理</h2><small>☁️ 全門市共用會員主檔｜與 POS 同步</small></div>
    <div class="toolbar">
     <button class="button" data-action="member-cloud-refresh">↻ 同步會員</button>
     <button class="primary" data-action="new-member">＋ 新增會員</button>
    </div>
   </div>
   <section class="panel">
    <div class="member-admin-search">
     <input id="memberAdminSearch" placeholder="手機號碼／會員編號／姓名">
     <button class="primary" data-action="member-admin-search">查詢</button>
     <button class="button" data-action="member-admin-clear">清除</button>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>會員編號</th><th>姓名</th><th>手機</th><th>目前點數</th><th>加入日期</th><th>最近更新</th><th>操作</th></tr></thead>
     <tbody id="memberAdminRows">${memberAdminRowsHtml(rows,canEdit,canDelete)}</tbody></table></div>
   </section>
   ${memberPointLedgerPanel()}
   <section class="panel" style="margin-top:14px">
    <div class="page-head"><h3>異常累點紀錄</h3><small>同會員同日超過 10 筆正向累點／贈點交易</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>會員</th><th>日期</th><th>筆數</th><th>狀態</th></tr></thead><tbody>
     ${anomalies.map(x=>`<tr><td>${esc(x.memberName||x.memberId)}</td><td>${esc(x.date)}</td><td>${Number(x.count||0)}</td><td><b class="bad">需查核</b></td></tr>`).join('')||'<tr><td colspan="4">目前沒有異常累點</td></tr>'}
    </tbody></table></div>
   </section>
  </div>`;
 }
 if(p==='member-point-settings')return `<div class="page-head"><div><h2>會員累點／折抵設定</h2><small>店務管理｜獨立設定頁面</small></div><div class="toolbar">${canAccessHqAppSettings()?'<button class="button app-settings-entry" data-nav="app-settings">📱 App設定</button><button class="button app-settings-entry" data-nav="tm-anybuy-settings">🛍️ TM隨買跨店取活動設定</button><button class="button app-settings-entry" data-nav="point-reward-settings">🎁 點數兌換設定</button>':''}</div></div>${memberPointSettingsPanel()}`;
 if(p==='app-settings')return hqAppSettingsPage();
 if(p==='tm-anybuy-settings')return tmAnybuySettingsPage();
 if(p==='point-reward-settings')return pointRewardSettingsPage();
 if(p==='member-bonus-settings')return `<div class="page-head"><div><h2>會員贈點活動設定</h2><small>店務管理｜獨立設定頁面</small></div></div>${memberBonusCampaignPage()}`;
 if(p==='member-analysis'){const rows=load(K.members,[]),anomalies=memberDailyPointAnomalies();const total=rows.length,points=rows.reduce((a,x)=>a+Number(x.points||0),0);return`<div class="page-head"><div><h2>會員分析</h2><small>會員分析｜會員主檔管理已整併至同一功能群組</small></div></div><div class="metric-grid"><div class="metric"><small>會員總數</small><strong>${total}</strong></div><div class="metric"><small>會員點數合計</small><strong>${points}</strong></div><div class="metric"><small>異常累點</small><strong>${anomalies.length}</strong></div></div>${memberPointLedgerPanel()}<section class="panel" style="margin-top:14px"><div class="page-head"><h3>異常累點紀錄</h3><small>同會員同日超過 10 筆正向累點／贈點交易</small></div><div class="table-wrap"><table class="table"><thead><tr><th>會員</th><th>日期</th><th>筆數</th><th>狀態</th></tr></thead><tbody>${anomalies.map(x=>`<tr><td>${esc(x.memberName||x.memberId)}</td><td>${esc(x.date)}</td><td>${Number(x.count||0)}</td><td><b class="bad">需查核</b></td></tr>`).join('')||'<tr><td colspan="4">目前沒有異常累點</td></tr>'}</tbody></table></div></section>`}
 if(p==='notice')return noticePageHtml();
 if(p==='franchise-area')return franchiseAreaPage();
 if(p==='tm-link')return tmLinkPageHtml();
 if(p==='audit'){const r=load(K.audit,[]);return`<div class="page-head"><h2>業務紀錄</h2><button class="button" data-action="audit-print">🖨️ 列印</button></div><div class="panel">${r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user)}｜${esc(x.action)}｜${esc(x.detail)}</div><hr>`).join('')||'尚無紀錄'}</div>`}
 if(p==='updates'){const r=load(K.updates,[]);return`<h2>更新中心</h2><div class="toolbar"><button class="primary" data-update="POS">下傳 POS</button><button class="primary" data-update="後台">下傳後台</button><button class="primary" data-update="全部">全部下傳</button></div><div class="panel">${r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.target)}｜${esc(x.status)}</div><hr>`).join('')||'尚無更新紀錄'}</div>`}
 if(p==='transactions'){if(!hasPermission('transactionBackAccess'))return`<h2>交易存根</h2><div class="panel"><p>需要「後台交易查詢」權限。</p></div>`;return transactionPage(false)}
 if(p==='account-list')return accountListPage();
 if(p==='xaccount'){if(!hasPermission('revenueAccess'))return `<h2>權限不足</h2><div class="panel"><p>需要「營收管理」權限。</p></div>`;return xAccountPage();}
 if(p==='promotions')return promotionPage();
 if(p==='customer-display-settings')return customerDisplaySettingsPage();
 if(p==='system-settings')return systemSettingsPage();
 if(p==='revenue'){
  if(!hasPermission('revenueAccess'))return `<h2>權限不足</h2><div class="panel"><p>需要「營收管理」權限。</p></div>`;
  const today=localDateKey(),r=(load(K.revenue,[])||[]).slice().sort((a,b)=>{const ad=String(a.date||''),bd=String(b.date||'');if(ad===today&&bd!==today)return -1;if(bd===today&&ad!==today)return 1;return bd.localeCompare(ad)||String(b.at||'').localeCompare(String(a.at||''));}),defaultRevenueId=(r.find(x=>String(x.date||'')===today)||r[0]||{}).id||'',options=r.map(x=>`<option value="${x.id}" ${String(x.id)===String(defaultRevenueId)?'selected':''}>${esc(x.date)}｜${esc(x.status||'')}</option>`).join('');
  const reportButtons=Object.entries(REVENUE_REPORT_NAMES).map(([k,v])=>`<button class="button" data-action="revenue-report-current" data-report-type="${k}">${v}</button>`).join('');
  return `<div class="panel revenue-rule-note"><b>營收規則</b><p>00:00 營收速報自動切換新的一天；每日結只封存前一天營收。營收管理與營收報表已合併；報表只包含前一天交易，當天交易只顯示於營收速報／營運情報，隔天才能進入報表。</p></div>
  <h2>營收管理</h2>
  <div class="toolbar revenue-top-actions"><button class="primary" data-action="collect">營收收集</button><button class="button" data-action="revenue-prev-cash-handover">前一天投庫／交班查詢</button><select id="revenueTarget" class="revenue-target" aria-label="選擇營收日期">${defaultRevenueId?'':'<option value="">選擇日期</option>'}${options}</select><button class="button" data-action="revenue-print">列印</button><button class="button" data-action="revenue-correct-top">修正</button><button class="button danger" data-action="revenue-remove-top">移除</button></div>
  <div class="panel table-wrap"><table class="table"><tr><th>日期</th><th>總營收</th><th>現金收入</th><th>非現金收入</th><th>投庫</th><th>應送金</th><th>筆數</th><th>狀態</th></tr>${r.map(x=>`<tr data-revenue-row="${x.id}"><td>${x.date}</td><td>${money(x.total)}</td><td>${money(x.cashRevenue||0)}</td><td>${money(x.nonCashRevenue||0)}</td><td>${money(x.deposits||0)}</td><td>${money(x.sendAmount??x.actualCash??0)}</td><td>${x.count}</td><td>${x.status}</td></tr>`).join('')}</table></div>
  <section class="panel" style="margin-top:14px"><div class="page-head"><div><h3>營收報表</h3><small>先在上方選擇營業日，再開啟或列印各報表。X帳／交班不再設獨立入口。</small></div></div><div class="toolbar revenue-report-inline">${reportButtons}</div></section>`;
 }
 if(p==='logistics'){
  const today=localDateKey(),from=new Date();from.setDate(from.getDate()-7);
  const fromDate=localDateKey(from);
  return `<div class="logistics-ref-page">
   <div class="page-head logistics-ref-head"><div><h2>配送書確認驗收</h2><small>物流配送確認／驗收管理</small></div>
    <div class="toolbar">
     ${canConfigureLogisticsStoreSettings()?'<button class="button" data-action="logistics-visibility-settings">配送書顯示（更新）時間</button>':''}
     ${hasPermission('logisticsCreate')?'<button class="primary" data-action="admin-logistics-create">＋ 建立物流批次</button>':''}
     ${canConfigureLogisticsStoreSettings()?'<button class="button" data-action="logistics-schedule-edit">表定到店時間</button>':''}
    </div>
   </div>
   <section class="panel logistics-ref-filter">
    <div class="logistics-ref-filter-row">
     <label>驗收日：<input id="logisticsRefFrom" type="date" value="${fromDate}"> ～ <input id="logisticsRefTo" type="date" value="${today}"></label>
     <label>配別：
      <select id="logisticsRefType"><option value="">全部</option>
       <option value="ambient">常溫</option><option value="fresh_1">鮮食一配</option><option value="fresh_2">鮮食二配</option>
       <option value="dairy">低溫一配</option><option value="low_2">低溫二配</option><option value="frozen">冷凍</option><option value="yijiatong">億家通</option><option value="ec">EC</option>
      </select>
     </label>
     <label>狀態：<select id="logisticsRefStatus"><option value="">全部</option><option value="pending">未驗收</option><option value="accepted">已驗收</option></select></label>
     <label class="logistics-ref-check"><input id="logisticsRefCorrected" type="checkbox"> 物流修正</label>
     <div class="logistics-ref-filter-actions"><button class="primary" data-action="logistics-ref-query">查詢</button><button class="button" data-action="admin-logistics-refresh">重新整理</button></div>
    </div>
    <div class="logistics-ref-number">
     <label>配送確認書編號 <input id="logisticsRefNo" placeholder="批次號／配送確認編號"></label>
     <div class="logistics-ref-main-actions">
      <button class="button" data-action="logistics-open-receipt-detail">進貨明細</button>
      <button class="button" data-action="logistics-open-acceptance">驗收明細</button>
      <button class="button" data-action="logistics-print-receipt">進貨單＋確認書條碼列印</button>
     </div>
    </div>
   </section>
   <section class="panel logistics-ref-table-panel">
    <div id="cloudLogisticsList"><p>正在讀取物流批次…</p></div>
   </section>
   <details class="logistics-ref-detail">
    <summary>進貨單／驗收明細</summary>
    <div class="panel table-wrap"><div id="cloudInventoryReceipts"><p>讀取中…</p></div></div>
   </details>
  </div>`;
 }
 if(p==='ec'){return`<div class="page-head"><h2>EC管理</h2><div class="toolbar"><button class="primary" data-action="new-ec-cloud" ${hasPermission('ecCreate')?'':'disabled title="需開啟新增EC包裹權限"'}>＋ 新增 EC 包裹</button><button class="button" data-action="ec-cloud-refresh">↻ 重新整理</button></div></div><div class="panel"><p>EC 與 POS、億家物流共用 Supabase。溫層僅分常溫／冷凍；到店 7 天未取會進入待退貨。</p><div id="ecCloudSummary" class="metric-grid"><div class="metric"><small>預計進店</small><strong>—</strong></div><div class="metric"><small>待取貨</small><strong>—</strong></div><div class="metric"><small>待退貨</small><strong>—</strong></div><div class="metric"><small>退貨物流中</small><strong>—</strong></div></div></div><div class="panel table-wrap" style="margin-top:14px"><div class="page-head"><h3>☁️ EC 包裹</h3><span>${cloudConfigured()?'已連結 Supabase':'尚未設定 Supabase'}</span></div><div id="ecCloudList"><p>讀取中…</p></div></div><div class="panel table-wrap" style="margin-top:14px"><h3>EC 退貨批次</h3><div id="ecReturnBatchList"><p>讀取中…</p></div></div>`}
 if(p==='transfers'){const rows=load(K.transfers,[]),here=currentStoreCode();return`<div class="page-head"><h2>轉貨管理</h2><div class="toolbar"><button class="primary" data-action="transfer-out">轉出</button><button class="button" data-action="transfer-in-back">轉入</button></div></div><div class="panel table-wrap"><table class="table"><tr><th>轉貨單號</th><th>轉出店</th><th>轉入店</th><th>商品</th><th>日期</th><th>數量</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td><td>${x.items.map(i=>esc(i.name)).join('、')}</td><td>${x.items.map(i=>esc(i.date||'—')).join('、')}</td><td>${x.items.reduce((a,i)=>a+Number(i.qty),0)}</td><td>${esc(x.status)}</td><td>${x.status==='運送中'&&String(x.to)===here?`<button class="button" data-transfer-receive="${x.id}">轉入</button>`:x.status==='運送中'&&String(x.from)===here?`待 ${esc(x.to)} 店轉入`:''}</td></tr>`).join('')||'<tr><td colspan="8">尚無轉貨單</td></tr>'}</table></div>`}
 if(p==='stores'){const rows=load(K.stores,[]),founder=isFounder(),canEdit=hasPermission('storeEdit'),canDelete=hasPermission('storeDelete');return`<div class="page-head"><h2>門市管理</h2><div class="toolbar">${hasPermission('storeAdd')?'<button class="primary" data-action="store-add">＋ 新增門市</button>':''}${hasPermission('storeCode')?'<button class="button" data-action="store-code">轉換店號</button>':''}${hasPermission('storeQuery')?'<button class="button" data-action="store-query">查詢其他門市</button>':''}${founder?'<button class="button" data-action="store-day-change-settings">🗓️ 日替時間設定</button><button class="button" data-action="store-close-time-settings">🧾 日結時間設定</button><label class="founder-notice-editor-select"><span>通報編輯</span><select id="founderNoticeEditorMenu"><option value="">請選擇</option><option value="new">新增</option><option value="edit">修改</option><option value="delete">刪除</option></select></label>':''}</div></div><div class="panel table-wrap"><table class="table"><tr><th>門市名稱</th><th>店號</th><th>日替時間</th><th>日結時間</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.code)}</td><td>${esc(x.dayChangeTime||'00:00')}</td><td>${esc(x.autoCloseTime||'04:00')}</td><td>${x.active!==false?'啟用':'停用'}</td><td>${canEdit?`<button class="button" data-store-edit="${x.id}">修改</button>`:''}${canDelete?` <button class="button danger" data-store-delete="${x.id}">刪除</button>`:''}${!canEdit&&!canDelete?'—':''}</td></tr>`).join('')}</table></div>`}
 if(p==='employees')return employeesAdminPage();
 if(p==='employee-detail')return employeeDetailPage();
 if(p==='permissions')return permissionsAdminPage();
 if(p==='attendance')return attendanceAdminPage();
 if(p==='notice-editor')return noticeEditorPage();
 if(p==='operations')return operationsPage();
 const title=pages.find(x=>x[0]===p)?.[2]||'模組';return`<h2>${title}</h2><div class="panel"><p>此模組將在下一包完成。</p></div>`}


const ORDER_TYPES_V531=[
 ['台帳訂購','📦'],
 ['FOS鮮食訂購','🥪'],
 ['用度品訂購','🧴'],
 ['特殊品訂購','📋'],
 ['品群訂購','🏷️']
];

function normalizeDeliveryLabel(v){
 const x=String(v||'').trim();
 if(x==='乳品'||x==='dairy'||x==='low_1')return '低溫一配';
 if(x==='low_2')return '低溫二配';
 if(x==='lowfresh_1'||x==='低鮮一配')return '鮮食一配';
 if(x==='lowfresh_2'||x==='低鮮二配')return '鮮食二配';
 if(x==='yijiatong'||x==='yj_tong'||x==='億家通')return '億家通';
 return x;
}
const ORDER_ALLOWED_DELIVERY={
 '用度品訂購':['常溫','冷凍','億家通'],
 'FOS鮮食訂購':['低溫一配','低溫二配','鮮食一配','鮮食二配'],
 '特殊品訂購':['常溫','低溫一配','低溫二配','億家通'],
 '品群訂購':['常溫','鮮食一配','鮮食二配','低溫一配','低溫二配','冷凍','億家通'],
 '台帳訂購':['常溫','鮮食一配','鮮食二配','低溫一配','低溫二配','冷凍','億家通']
};
function orderAllowedDeliveryTypes(type){return ORDER_ALLOWED_DELIVERY[type]||ORDER_ALLOWED_DELIVERY['品群訂購']}
const PRODUCT_ORDER_TYPES=['台帳訂購','FOS鮮食訂購','用度品訂購','特殊品訂購','品群訂購'];
const FOS_DELIVERY_TYPES=['低溫一配','低溫二配','鮮食一配','鮮食二配'];
function rawProductOrderTypes(p){
 return Array.isArray(p?.orderTypes)?p.orderTypes.map(x=>x==='備品訂購'?'用度品訂購':x==='特殊用品訂購'?'特殊品訂購':x).filter(x=>PRODUCT_ORDER_TYPES.includes(x)):[];
}
function fosProductTextValues(p){
 return [p?.orderGroupCode,p?.orderCategoryCode,p?.groupCode,p?.orderGroup,p?.group,p?.productGroup,p?.category,p?.orderCategory,p?.subcategory,p?.name]
  .map(v=>String(v||'').trim()).filter(Boolean);
}
function inferLegacyFosFreshProduct(p){
 const values=fosProductTextValues(p).join('｜');
 return /鮮食|飯糰|壽司|便當|麵食|麵類|三明治|漢堡|沙拉|水果|甜點|F0[1-8]/i.test(values);
}
function isFosFreshProduct(p){
 const delivery=normalizeDeliveryLabel(p?.deliveryType||p?.logistics||'');
 if(!FOS_DELIVERY_TYPES.includes(delivery))return false;
 // 新版商品以「可訂購分類」勾選結果為準；舊資料沒有 orderTypes 時才沿用鮮食文字判斷。
 if(Object.prototype.hasOwnProperty.call(p||{},'orderTypes'))return rawProductOrderTypes(p).includes('FOS鮮食訂購');
 return inferLegacyFosFreshProduct(p);
}
function productOrderTypes(p){
 const delivery=normalizeDeliveryLabel(p?.deliveryType||p?.logistics||'');
 let types;
 if(Object.prototype.hasOwnProperty.call(p||{},'orderTypes'))types=rawProductOrderTypes(p);
 else types=PRODUCT_ORDER_TYPES.filter(type=>orderAllowedDeliveryTypes(type).includes(delivery));
 // FOS 不再要求商品總品群一定等於「鮮食」；已勾 FOS + 鮮食配送別即可。
 types=types.filter(type=>type!=='FOS鮮食訂購'||isFosFreshProduct(p));
 if(!Object.prototype.hasOwnProperty.call(p||{},'orderTypes')&&isFosFreshProduct(p)&&!types.includes('FOS鮮食訂購'))types.push('FOS鮮食訂購');
 return types;
}

function seasonalSweetPotatoOrderAllowed(p,date=new Date()){
 const name=String(p?.name||'').trim();
 const month=date.getMonth()+1;
 if(name.includes('去土蕃薯'))return month>=7&&month<=12;
 if(name.includes('冷凍蕃薯'))return month>=1&&month<=6;
 return true;
}
function seasonalSweetPotatoOrderNote(p,date=new Date()){
 const name=String(p?.name||'').trim(),month=date.getMonth()+1;
 if(name.includes('去土蕃薯'))return month>=7&&month<=12?'7月～12月可訂購':'1月～6月不可訂購';
 if(name.includes('冷凍蕃薯'))return month>=1&&month<=6?'1月～6月可訂購':'7月～12月不可訂購';
 return '';
}
function orderProductAllowedForType(p,type){
 if(productStatusLabel(p)==='停用')return false;
 if(!seasonalSweetPotatoOrderAllowed(p))return false;
 const types=productOrderTypes(p);
 if(type==='FOS鮮食訂購')return types.includes('FOS鮮食訂購')&&FOS_DELIVERY_TYPES.includes(normalizeDeliveryLabel(p.deliveryType||p.logistics||''));
 return types.includes(type)&&orderAllowedDeliveryTypes(type).includes(normalizeDeliveryLabel(p.deliveryType||p.logistics||''));
}
function orderingAiSwitches(){
 const cfg=load(K.systemSettings,{})||{};
 return {auto:cfg.orderAutoAIEnabled===true,fresh:cfg.freshAIOrderEnabled===true};
}
function productOrderSwitchState(p){
 const cfg=load(K.systemSettings,{})||{},all=(cfg.productOrderSwitches&&typeof cfg.productOrderSwitches==='object')?cfg.productOrderSwitches:{};
 const row=all[String(p?.id||'')]||{};
 return {store:row.store!==false,system:row.system!==false};
}
async function setProductOrderSwitch(productId,kind,enabled){
 const p=products().find(x=>String(x.id)===String(productId));if(!p)return alert('找不到商品'),false;
 if(!requirePermission('orderingAccess'))return false;
 if(kind==='system'){const perm=isFosFreshProduct(p)?'freshAIOrder':'orderAutoAI';if(!requirePermission(perm))return false;}
 const cfg=load(K.systemSettings,{})||{},all=(cfg.productOrderSwitches&&typeof cfg.productOrderSwitches==='object')?{...cfg.productOrderSwitches}:{};
 const old=all[String(p.id)]||{},next={...old,[kind]:!!enabled,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
 if(kind==='system'){
  if(enabled)delete next.systemQtyOverride;
  else next.systemQtyOverride=0;
 }
 all[String(p.id)]=next;
 cfg.productOrderSwitches=all;save(K.systemSettings,cfg);
 // 關閉單品系訂時，同步清除此商品所有尚未傳輸的系訂/AI 草稿，避免畫面重新計算後數字回彈。
 if(kind==='system'&&!enabled){
  const rows=load(K.orders,[]);let changed=false;
  for(let i=rows.length-1;i>=0;i--){
   const o=rows[i];if(!o.aiGenerated||!['未傳輸','已建立','部分傳輸'].includes(o.status||'已建立'))continue;
   const before=(o.items||[]).length;o.items=(o.items||[]).filter(x=>String(x.productId)!==String(p.id));
   if(o.items.length!==before)changed=true;
   if(!o.items.length){rows.splice(i,1);changed=true;}
  }
  if(changed)save(K.orders,rows);
 }
 if(cloudConfigured()){
  try{
   await cloudPushKey(K.systemSettings,cfg);
   if(kind==='system'&&!enabled)await cloudPushKey(K.orders,load(K.orders,[]));
  }catch(err){console.warn('商品訂購開關雲端同步失敗，已保留本機',err)}
 }
 saveAudit('商品訂購開關',`${p.code||''}｜${p.name}｜${kind==='store'?'店訂':'系訂'}：${enabled?'開啟':'關閉'}`);
 return true;
}
async function setProductSystemQtyOverride(productId,qty){
 const p=products().find(x=>String(x.id)===String(productId));if(!p)return false;
 qty=Math.max(0,Math.floor(Number(qty||0)));
 const cfg=load(K.systemSettings,{})||{},all=(cfg.productOrderSwitches&&typeof cfg.productOrderSwitches==='object')?{...cfg.productOrderSwitches}:{};
 const old=all[String(p.id)]||{};
 all[String(p.id)]={...old,systemQtyOverride:qty,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
 cfg.productOrderSwitches=all;save(K.systemSettings,cfg);
 if(cloudConfigured()){try{await cloudPushKey(K.systemSettings,cfg)}catch(err){console.warn('系訂數量覆寫雲端同步失敗，已保留本機',err)}}
 return true;
}
async function setOrderingAiSwitch(kind,enabled){
 const key=kind==='auto'?'orderAutoAI':'freshAIOrder';
 if(!requirePermission(key))return false;
 const cfg=load(K.systemSettings,{})||{};
 if(kind==='auto')cfg.orderAutoAIEnabled=!!enabled; else cfg.freshAIOrderEnabled=!!enabled;
 save(K.systemSettings,cfg);
 // 開關屬於店舖設定：明確等待雲端寫入完成，避免頁面重新整理時被舊雲端值蓋回。
 if(cloudConfigured()){
  const ok=await cloudPushKey(K.systemSettings,cfg);
  if(!ok)alert('開關已保存在此裝置，但雲端同步尚未完成；恢復連線後請再切換一次。');
 }
 saveAudit('訂購 AI 開關',`${kind==='auto'?'系統自動訂購':'鮮食 AI 輔助訂購'}：${enabled?'開啟':'關閉'}`);
 return true;
}
function orderingAiSwitchHtml(){
 const sw=orderingAiSwitches(),canFresh=hasPermission('freshAIOrder');
 return `<div class="ordering-ai-switches fresh-only">
  <div class="ordering-switch-block">
   <div class="ordering-switch-row ${canFresh?'':'locked'}">
    <span class="ordering-switch-title">🥪 鮮食 AI 輔助訂購</span>
    <div class="ordering-onoff">
     <button class="button ${sw.fresh?'active-on':''}" data-order-ai-set="fresh" data-order-ai-value="1" ${canFresh?'':'disabled'}>開</button>
     <button class="button ${!sw.fresh?'active-off':''}" data-order-ai-set="fresh" data-order-ai-value="0" ${canFresh?'':'disabled'}>關</button>
     <b class="ordering-current-state">目前：${sw.fresh?'開啟':'關閉'}</b>
    </div>
   </div>
   <button class="button ordering-policy-btn" data-action="fresh-ai-settings" ${canFresh?'':'disabled'}>⚙️ 鮮食 AI 設定</button>
  </div>
  <button class="button ordering-ai-refresh" data-action="refresh-order-suggestions" ${canFresh?'':'disabled title="需開啟鮮食 AI 權限"'}>🔄 重新整理建議</button>
 </div>`;
}
function clampNum(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function orderingPolicyConfig(p=null){
 const cfg=load(K.systemSettings,{})||{},baseA=cfg.orderAutoPolicy||{},baseF=cfg.freshAIPolicy||{};
 const per=(p&&cfg.productOrderPolicies&&typeof cfg.productOrderPolicies==='object')?(cfg.productOrderPolicies[String(p.id)]||{}):{};
 const a={...baseA,...(per.auto||{})},f={...baseF,...(per.fresh||{})};
 return {
  auto:{recommendPercent:clampNum(a.recommendPercent,0,300,100),triggerSafePercent:clampNum(a.triggerSafePercent,1,300,100),salesLookbackDays:Math.round(clampNum(a.salesLookbackDays,1,60,7)),forecastDays:clampNum(a.forecastDays,0.1,60,7),safeFallbackPercent:clampNum(a.safeFallbackPercent,0,500,200),safeAddPercent:clampNum(a.safeAddPercent,0,500,100),wasteDeductPercent:clampNum(a.wasteDeductPercent,0,500,0),useMaxStock:a.useMaxStock!==false},
  fresh:{recommendPercent:clampNum(f.recommendPercent,0,300,100),salesLookbackDays:Math.round(clampNum(f.salesLookbackDays,1,60,7)),forecastDays:clampNum(f.forecastDays,0.1,14,2.2),safeStockPercent:clampNum(f.safeStockPercent,0,500,50),wasteDeductPercent:clampNum(f.wasteDeductPercent,0,500,120),recentTrendPercent:clampNum(f.recentTrendPercent,0,100,0)}
 };
}
function orderingPolicyTargetProduct(){return adminOrderingPolicyProductId?products().find(x=>String(x.id)===String(adminOrderingPolicyProductId))||null:null}
function orderingSuggestionSettingsPage(){
 const auto=orderingPolicyConfig().auto,fresh=orderingPolicyConfig().fresh,sw=orderingAiSwitches();
 return `${scOrderTabs('suggestion')}<div class="page-head"><div><h2>建議訂購設定</h2><small>一般商品與鮮食建議訂購集中設定</small></div><button class="button" data-nav="ordering-ledger">← 返回台帳訂購</button></div>
 <div class="suggestion-settings-grid">
  <section class="panel suggestion-setting-card"><div class="page-head"><div><h3>一般商品訂購設定</h3><small>一般商品系訂／建議值</small></div><span class="badge">${sw.auto?'啟用':'關閉'}</span></div>
   <div class="suggestion-setting-summary"><span>建議比例 <b>${auto.recommendPercent}%</b></span><span>低庫存觸發 <b>${auto.triggerSafePercent}%</b></span><span>回看天數 <b>${auto.salesLookbackDays}日</b></span><span>預估需求 <b>${auto.forecastDays}日</b></span></div>
   <button class="primary" data-action="open-general-suggestion-settings">一般商品訂購設定</button>
  </section>
  <section class="panel suggestion-setting-card"><div class="page-head"><div><h3>鮮食建議訂購設定</h3><small>FOS／鮮食 AI 建議值</small></div><span class="badge">${sw.fresh?'啟用':'關閉'}</span></div>
   <div class="suggestion-setting-summary"><span>AI 建議比例 <b>${fresh.recommendPercent}%</b></span><span>回看天數 <b>${fresh.salesLookbackDays}日</b></span><span>需求覆蓋 <b>${fresh.forecastDays}日</b></span><span>近期趨勢 <b>${fresh.recentTrendPercent}%</b></span></div>
   <button class="primary" data-action="open-fresh-suggestion-settings">鮮食建議訂購設定</button>
  </section>
 </div>`;
}

function orderingAutoSettingsPage(){
 const target=orderingPolicyTargetProduct(),x=orderingPolicyConfig(target).auto;
 return `<div class="page-head"><h2>❗️ 系訂值設定${target?`｜${esc(target.name)}`:''}</h2><button class="button" data-action="back-ordering">← 回訂購業務</button></div>
 <div class="panel ordering-policy-page"><p class="notice">${target?`目前只設定商品「${esc(target.name)}」，不會影響其他商品。`:`此頁為全域預設值；從單一商品旁的 ⚙️ 進入時，會改為該商品獨立設定。`} 建議草稿不會直接下單，最後仍由人員確認後傳輸。</p>
 <div class="settings-grid">
  <label>系訂建議比例（%）<input id="oaRecommend" type="number" min="0" max="300" step="1" value="${x.recommendPercent}"><small>100%=原建議量；80%=建議量×0.8；120%=建議量×1.2。</small></label>
  <label>低庫存觸發比例（安全庫存 %）<input id="oaTrigger" type="number" min="1" max="300" step="1" value="${x.triggerSafePercent}"><small>100%=庫存低於安全庫存才進入系訂。</small></label>
  <label>銷售回看天數<input id="oaLookback" type="number" min="1" max="60" step="1" value="${x.salesLookbackDays}"></label>
  <label>預估需求天數<input id="oaForecast" type="number" min="0.1" max="60" step="0.1" value="${x.forecastDays}"></label>
  <label>無最大庫存時安全庫存目標（%）<input id="oaSafeFallback" type="number" min="0" max="500" step="1" value="${x.safeFallbackPercent}"><small>預設200%=至少補到安全庫存的2倍目標。</small></label>
  <label>銷售預估加安全庫存權重（%）<input id="oaSafeAdd" type="number" min="0" max="500" step="1" value="${x.safeAddPercent}"></label>
  <label>廢棄扣減權重（%）<input id="oaWaste" type="number" min="0" max="500" step="1" value="${x.wasteDeductPercent}"><small>0%=不扣；100%=依平均廢棄量等比例扣減需求。</small></label>
  <label class="check-setting"><input id="oaUseMax" type="checkbox" ${x.useMaxStock?'checked':''}> 商品有設定最大庫存時，優先以最大庫存作補貨目標</label>
 </div><div class="toolbar"><button class="primary" data-action="save-auto-order-settings">儲存系訂值設定</button><button class="button" data-action="reset-auto-order-settings">恢復預設值</button></div></div>`;
}
function orderingFreshSettingsPage(){
 const target=orderingPolicyTargetProduct(),x=orderingPolicyConfig(target).fresh;
 return `<div class="page-head"><h2>🥪 鮮食建議訂購設定${target?`｜${esc(target.name)}`:''}</h2><button class="button" data-action="back-ordering">← 回訂購業務</button></div>
 <div class="panel ordering-policy-page"><p class="notice">適用 FOS 鮮食品群：低溫一配／低溫二配／鮮食一配／鮮食二配。AI 只建立可修改草稿，不會自動傳輸。</p>
 <div class="settings-grid">
  <label>AI 建議比例（%）<input id="faRecommend" type="number" min="0" max="300" step="1" value="${x.recommendPercent}"><small>可作門市整體加減訂比例。</small></label>
  <label>銷售回看天數<input id="faLookback" type="number" min="1" max="60" step="1" value="${x.salesLookbackDays}"></label>
  <label>需求覆蓋天數<input id="faForecast" type="number" min="0.1" max="14" step="0.1" value="${x.forecastDays}"><small>預設2.2天，代表依平均銷量估算約2.2天需求。</small></label>
  <label>安全庫存權重（%）<input id="faSafe" type="number" min="0" max="500" step="1" value="${x.safeStockPercent}"></label>
  <label>廢棄扣減權重（%）<input id="faWaste" type="number" min="0" max="500" step="1" value="${x.wasteDeductPercent}"><small>廢棄越多，建議量會越往下修。</small></label>
  <label>近期3日銷售趨勢權重（%）<input id="faTrend" type="number" min="0" max="100" step="1" value="${x.recentTrendPercent}"><small>0%=只看整段平均；例如40%=40%採近期3日平均、60%採回看期間平均。</small></label>
 </div><div class="toolbar"><button class="primary" data-action="save-fresh-ai-settings">儲存鮮食 AI 設定</button><button class="button" data-action="reset-fresh-ai-settings">恢復預設值</button></div></div>`;
}
async function persistOrderingPolicy(kind,data){
 if(!requirePermission(kind==='auto'?'orderAutoAI':'freshAIOrder'))return false;
 const cfg=load(K.systemSettings,{})||{},target=orderingPolicyTargetProduct();
 if(target){
  const all=(cfg.productOrderPolicies&&typeof cfg.productOrderPolicies==='object')?{...cfg.productOrderPolicies}:{};
  const row={...(all[String(target.id)]||{})};row[kind]={...data,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};all[String(target.id)]=row;cfg.productOrderPolicies=all;
 }else if(kind==='auto')cfg.orderAutoPolicy=data;else cfg.freshAIPolicy=data;
 save(K.systemSettings,cfg);
 if(cloudConfigured())await cloudPushKey(K.systemSettings,cfg);
 saveAudit(kind==='auto'?'系訂值設定':'鮮食 AI 設定',`${target?`${target.code||''}｜${target.name}｜`:'全域｜'}${JSON.stringify(data)}`);
 return true;
}
function orderPackQty(p){return Math.max(1,Number(p?.orderMultipleQty||1))}
function roundOrderToPack(q,p){const pack=orderPackQty(p);return Math.max(pack,Math.ceil(Math.max(1,Number(q)||1)/pack)*pack)}
function orderMultipleCount(q,p){return Math.max(1,Math.ceil(Number(q||0)/orderPackQty(p)))}

function weekStartAt(daysAgo=6,weekOffset=0){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-daysAgo+(Math.min(0,Math.trunc(Number(weekOffset)||0))*7));return d.getTime()}
function weeklyProductStats(p,weekOffset=0){
 const offset=Math.min(0,Math.trunc(Number(weekOffset)||0));
 const since=weekStartAt(6,offset),until=since+7*86400000,keyIds=new Set([String(p.id||''),String(p.code||''),String(p.barcode||'')]);
 const daily=Array.from({length:7},(_,i)=>{const d=new Date(since+i*86400000);return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,date:d.toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'}),order:0,in:0,sales:0,waste:0}});
 const idx=at=>Math.floor((new Date(at).getTime()-since)/86400000);
 const inWindow=at=>{const t=new Date(at).getTime();return Number.isFinite(t)&&t>=since&&t<until};
 for(const sale of load(K.sales,[])){
  if(!sale.at||!inWindow(sale.at)||['作廢','已作廢'].includes(sale.status))continue;
  for(const it of (sale.items||[])){
   const match=String(it.id||it.productId||'')===String(p.id)||String(it.code||'')===String(p.code)||String(it.barcode||'')===String(p.barcode)||String(it.name||'')===String(p.name);
   const i=idx(sale.at);if(match&&i>=0&&i<7)daily[i].sales+=Math.max(0,Number(it.correctedQty??it.qty??0)-Number(it.returnedQty||0));
  }
 }
 for(const w of load(K.waste,[])){
  const i=w.at?idx(w.at):-1;
  const match=String(w.productId||'')===String(p.id)||String(w.name||'')===String(p.name);
  if(w.at&&inWindow(w.at)&&i>=0&&i<7&&match)daily[i].waste+=Number(w.qty||0);
 }
 for(const m of load(K.inventoryMoves,[])){
  const i=m.at?idx(m.at):-1;
  const match=String(m.productId||'')===String(p.id)||String(m.product||'')===String(p.name)||String(m.code||'')===String(p.code);
  if(m.at&&inWindow(m.at)&&i>=0&&i<7&&Number(m.qty||0)>0&&match)daily[i].in+=Number(m.qty||0);
 }
 for(const o of load(K.orders,[])){
  const at=o.transmittedAt||o.at||o.createdAt||'';
  const i=at?idx(at):-1;
  if(!at||!inWindow(at)||i<0||i>=7)continue;
  for(const it of (o.items||[])){
   const match=String(it.productId||it.id||'')===String(p.id)||String(it.code||'')===String(p.code)||String(it.barcode||'')===String(p.barcode)||String(it.name||'')===String(p.name);
   if(match)daily[i].order+=Math.max(0,Number(it.qty||0));
  }
 }
 const totals=daily.reduce((a,x)=>({order:a.order+x.order,in:a.in+x.in,sales:a.sales+x.sales,waste:a.waste+x.waste}),{order:0,in:0,sales:0,waste:0});
 return {daily,...totals,weekOffset:offset};
}
function productStatsForDays(p,days=7){
 const d=Math.max(1,Math.round(Number(days)||7)),since=Date.now()-d*86400000;let sales=0,waste=0;
 for(const sale of load(K.sales,[])){if(!sale.at||new Date(sale.at).getTime()<since||['作廢','已作廢'].includes(sale.status))continue;for(const it of (sale.items||[])){const match=String(it.id||it.productId||'')===String(p.id)||String(it.code||'')===String(p.code)||String(it.barcode||'')===String(p.barcode)||String(it.name||'')===String(p.name);if(match)sales+=Math.max(0,Number(it.correctedQty??it.qty??0)-Number(it.returnedQty||0));}}
 for(const w of load(K.waste,[]))if(w.at&&new Date(w.at).getTime()>=since&&(String(w.productId||'')===String(p.id)||String(w.name||'')===String(p.name)))waste+=Number(w.qty||0);
 return {days:d,sales,waste,avgSales:sales/d,avgWaste:waste/d};
}
function aiRecommendedQty(p,{fresh=false}={}){
 const stock=Number(p.stock||0),safe=Math.max(0,Number(p.safeStock||0)),max=Math.max(0,Number(p.maxStock||0)),policy=orderingPolicyConfig(p)[fresh?'fresh':'auto'];
 const st=productStatsForDays(p,policy.salesLookbackDays);let avgSales=st.avgSales,avgWaste=st.avgWaste,target=0;
 if(fresh){
  if(policy.recentTrendPercent>0){const recent=productStatsForDays(p,Math.min(3,policy.salesLookbackDays));const w=policy.recentTrendPercent/100;avgSales=avgSales*(1-w)+recent.avgSales*w;}
  target=Math.max(safe,Math.ceil(avgSales*policy.forecastDays + safe*(policy.safeStockPercent/100) - avgWaste*(policy.wasteDeductPercent/100)));
  if(max>0)target=Math.min(target,max);
 }else{
  const trigger=safe*(policy.triggerSafePercent/100);if(stock>=trigger)return 0;
  const salesTarget=Math.ceil(avgSales*policy.forecastDays + safe*(policy.safeAddPercent/100) - avgWaste*(policy.wasteDeductPercent/100));
  target=(policy.useMaxStock&&max>safe)?max:Math.max(safe*(policy.safeFallbackPercent/100),salesTarget);
  if(max>0&&!policy.useMaxStock)target=Math.min(target,max);
 }
 let need=Math.max(0,target-stock);
 need=need*(policy.recommendPercent/100);
 if(need<=0)return 0;
 let qty=roundOrderToPack(need,p);
 const minOrder=Math.max(0,Number(p.minOrderQty||0)),maxOrder=Math.max(0,Number(p.maxOrderQty||0));
 if(minOrder>0&&qty<minOrder)qty=roundOrderToPack(minOrder,p);
 if(maxOrder>0&&qty>maxOrder)qty=Math.max(0,Math.floor(maxOrder/Math.max(1,orderPackQty(p)))*Math.max(1,orderPackQty(p)));
 return qty;
}
function makeAutoOrder(type,items,note){
 if(!items.length)return null;
 const rows=load(K.orders,[]),now=new Date();
 const order={id:`OR-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,type,deliveryType:'自動依商品拆分',deliveryDate:'',note,items,status:'未傳輸',batchNo:'',at:now.toISOString(),user:currentUser()?.name||'',aiGenerated:true};
 rows.unshift(order);save(K.orders,rows);saveAudit('AI輔助建立訂購單',`${order.id}｜${type}｜${items.length}項`);return order;
}

let scLedgerSelectedProductId='';
let scLedgerWeekOffset=0;
function scLedgerProducts(){
 return products().filter(p=>
  productStatusLabel(p)!=='停用' &&
  orderProductAllowedForType(p,'台帳訂購') &&
  seasonalSweetPotatoOrderAllowed(p)
 );
}
function scLedgerDraftQty(p,ai=false){
 const rows=load(K.orders,[]).filter(o=>['未傳輸','已建立','部分傳輸'].includes(o.status||'已建立')&&!!o.aiGenerated===!!ai);
 for(const o of rows){
  const it=(o.items||[]).find(x=>String(x.productId)===String(p.id));
  if(it)return Math.max(0,Number(it.qty||0));
 }
 return 0;
}
function scLedgerTransmitFlag(p,orderDate=localDateKey()){
 const pid=String(p?.id||'');
 if(!pid)return 'N';
 const rows=load(K.orders,[])||[];
 const transmitted=rows.some(o=>{
  if(!['已傳輸','完成'].includes(String(o?.status||'')))return false;
  const raw=o?.transmittedAt||o?.at||o?.createdAt||'';
  let at='';
  if(raw){
   const d=new Date(raw);
   at=Number.isNaN(d.getTime())?String(raw).slice(0,10):localDateKey(d);
  }
  if(orderDate&&at&&at!==String(orderDate))return false;
  return (o?.items||[]).some(it=>String(it?.productId||'')===pid&&Number(it?.qty||0)>0);
 });
 return transmitted?'Y':'N';
}
function scLedgerWeatherText(index){
 const weather=['☀️','🌤️','⛅','🌦️','☁️','🌧️','☀️'];
 return weather[index%weather.length];
}
function scLedgerPage(){
 const ps=scLedgerProducts();
 if(!scLedgerSelectedProductId||!ps.some(p=>String(p.id)===String(scLedgerSelectedProductId)))scLedgerSelectedProductId=String(ps[0]?.id||'');
 const selected=ps.find(p=>String(p.id)===String(scLedgerSelectedProductId))||ps[0]||null;
 const st=selected?weeklyProductStats(selected,scLedgerWeekOffset):{daily:[]};
 const orderDate=localDateKey();
 const nextDate=(()=>{const d=new Date();d.setDate(d.getDate()+1);return localDateKey(d)})();
 const canStore=hasPermission('orderLedger')||hasPermission('orderingAccess');
 const selectedStoreQty=selected?scLedgerDraftQty(selected,false):0;
 const selectedSysQty=selected?scLedgerDraftQty(selected,true):0;
 const selectedTransmitQty=selectedStoreQty>0?selectedStoreQty:selectedSysQty;
 return `<div class="sc-ledger-page ref-ledger-v490">
  ${scOrderTabs('ledger')}
  <section class="ref-ledger-controls">
   <div class="ref-ledger-orderdate">
    <b>訂購日：</b>
    <span>${esc(orderDate)}（一訂）</span>
    <span>${esc(nextDate)}（二訂）</span>
   </div>
   <div class="ref-ledger-actions">
    <button class="button" data-action="ordering-rules-settings">規則設定</button>
    <button class="button" data-action="suggestion-settings">建議訂購設定</button>
    <button class="primary" data-action="transmit-all-orders">確認／傳輸</button>
   </div>
   <div class="ref-ledger-search-row">
    <label>商品代號／條碼：<input id="scLedgerSearch" placeholder="輸入商品代號、條碼或名稱"></label>
    <label>商品名稱：<input id="scLedgerNameSearch" placeholder="商品名稱"></label>
    <label>元入數：<input value="${selected?Number(selected.orderMultipleQty||1):0}" readonly></label>
    <label>店訂：<input value="${selectedStoreQty}" readonly></label>
    <label>預訂：<input value="0" readonly></label>
    <label>系訂：<input value="${selectedSysQty}" readonly></label>
   </div>
  </section>

  <div class="sc-ledger-main">
   <section class="panel table-wrap sc-ledger-table-wrap">
    <table class="table sc-ledger-table">
     <thead><tr>
      <th>#</th><th>品群</th><th>商品代號</th><th>商品名稱</th><th>規格</th><th>入數</th>
      <th>建議售價</th><th>店訂</th><th>系訂</th><th>預訂</th><th>訂購日</th><th>傳</th>
     </tr></thead>
     <tbody id="scLedgerRows">
     ${ps.map((p,i)=>{
       const sw=productOrderSwitchState(p),storeQty=scLedgerDraftQty(p,false),sysQty=scLedgerDraftQty(p,true),allowed=productOrderingAllowedToday(p);
       const spec=String(p.spec||'').trim()||'—',unit=`${Number(p.orderMultipleQty||1)} ${esc(p.orderMultipleUnit||'個')}`;
       const arrivalDate=productPendingArrivalDisplay(p);
       return `<tr class="${String(p.id)===String(selected?.id)?'selected':''}" data-ledger-row="${esc(p.id)}" data-ledger-select-row="${esc(p.id)}" tabindex="0" data-ledger-search="${esc([p.code,p.name,p.spec,p.group,...productBarcodes(p)].join(' ').toLowerCase())}" data-ledger-name="${esc(String(p.name||'').toLowerCase())}">
        <td>${i+1}</td>
        <td>${esc(p.group||'其他')}</td>
        <td>${esc(p.code||'')}</td>
        <td><button type="button" class="ledger-product-link" data-ledger-select="${esc(p.id)}">${productDisplayIconHtml(p)} <span>${esc(p.name)}</span></button></td>
        <td>${esc(spec)}</td>
        <td>${unit}</td>
        <td>${money(p.price||0)}</td>
        <td><input type="number" min="0" inputmode="numeric" data-orange-order-store-qty="${esc(p.id)}" value="${storeQty}" ${(!canStore||!sw.store||!allowed)?'disabled':''}></td>
        <td class="ledger-system-td">
         <div class="ledger-system-cell">
          <button type="button" class="ledger-system-toggle ${sw.system?'on':'off'}" data-ledger-system-toggle="${esc(p.id)}" title="${sw.system?'系訂已開啟，按一下關閉':'系訂已關閉，按一下開啟'}" aria-label="系訂開關">${sw.system?'✅':'❌'}</button>
          <input class="ledger-system-qty" type="number" min="0" inputmode="numeric" data-orange-order-system-qty="${esc(p.id)}" value="${sysQty}" ${(!hasPermission('orderAutoAI')||!sw.system||!allowed)?'disabled':''}>
         </div>
        </td>
        <td class="ledger-reservation-td"><input class="ledger-reservation-qty" type="number" min="0" inputmode="numeric" data-ledger-reservation-qty="${esc(p.id)}" value="${orderReservationQtyForLedger(p)}" title="預訂數量，會同步到預約訂購"></td>
        <td title="預定進貨日">${esc(arrivalDate)}</td>
        <td class="ledger-transmit-flag ${scLedgerTransmitFlag(p,orderDate)==='Y'?'yes':'no'}">${allowed?scLedgerTransmitFlag(p,orderDate):'—'}</td>
       </tr>`;
      }).join('')||'<tr><td colspan="12">目前沒有可訂購商品</td></tr>'}
     </tbody>
    </table>
   </section>

   <aside class="panel sc-ledger-detail" id="scLedgerDetail">
    ${selected?`
     <div class="ref-ledger-preview">${productDisplayIconHtml(selected)}</div>
     <div class="sc-ledger-detail-head">
      <div><h3>${esc(selected.name)}</h3><small>${esc(selected.code||'')}</small></div>
     </div>
     <div class="sc-ledger-info-grid ref-ledger-info-grid">
      <span>最大 <b>${Number(selected.maxStock||0)}</b></span>
      <span>最小 <b>${Number(selected.safeStock||0)}</b></span>
      <span>毛利% <b>${productMargin(selected).toFixed(1)}</b></span>
      <span>不良可退 <b>${selected.returnable===false?'N':'Y'}</b></span>
      <span>庫存 <b>${Number(selected.stock||0)}</b></span>
      <span>期限 <b>${esc(selected.shelfLife||'—')}</b></span>
     </div>
     <div class="sc-ledger-order-summary ref-ledger-order-summary">
      <div><small>店訂</small><strong>${selectedStoreQty}</strong></div>
      <div><small>系訂</small><strong>${selectedSysQty}</strong></div>
      <div><small>本次傳輸數量</small><strong>${selectedTransmitQty}</strong></div>
     </div>
     ${seasonalSweetPotatoOrderNote(selected)?`<div class="notice">${esc(seasonalSweetPotatoOrderNote(selected))}</div>`:''}
    `:'<p>請選擇商品</p>'}
   </aside>
  </div>

  <section class="panel table-wrap sc-ledger-history" id="scLedgerHistory">
   <div class="sc-ledger-history-head">
    <div><b>${selected?esc(selected.name):'商品歷史'}</b></div>
    <div class="toolbar">
     <button class="button" type="button" data-ledger-week="-1">← 上一週</button>
     <button class="button" type="button" data-ledger-week="0">本週</button>
    </div>
   </div>
   <table class="table ref-ledger-history-table">
    <thead><tr><th>星期／天氣</th>${(st.daily||[]).map((d,i)=>`<th><span>${scLedgerWeatherText(i)}</span><br>${esc(d.date)}</th>`).join('')}</tr></thead>
    <tbody>
     <tr><th>訂購數</th>${(st.daily||[]).map(d=>`<td>${d.order}</td>`).join('')}</tr>
     <tr><th>進貨數</th>${(st.daily||[]).map(d=>`<td>${d.in}</td>`).join('')}</tr>
     <tr><th>銷售／推估數</th>${(st.daily||[]).map(d=>`<td>${d.sales}</td>`).join('')}</tr>
     <tr><th>廢棄數</th>${(st.daily||[]).map(d=>`<td>${d.waste}</td>`).join('')}</tr>
    </tbody>
   </table>
  </section>

  <div class="sc-ledger-footer-note">
   一訂／二訂依目前訂購規則顯示；21:59～22:01:59 系統統計，22:02 起切換隔日訂購曆。
  </div>
 </div>`;
}
function rerenderScLedgerPreservePosition(){
 const wrap=document.querySelector('.sc-ledger-table-wrap');
 const tableTop=Number(wrap?.scrollTop||0),tableLeft=Number(wrap?.scrollLeft||0),pageY=window.scrollY||0;
 const searchValue=String(document.querySelector('#scLedgerSearch')?.value||'');
 const nameSearchValue=String(document.querySelector('#scLedgerNameSearch')?.value||'');
 const active=document.activeElement;
 let activeKind='',activeId='';
 if(active?.matches?.('[data-orange-order-store-qty]')){activeKind='store';activeId=active.dataset.orangeOrderStoreQty||''}
 else if(active?.matches?.('[data-orange-order-system-qty]')){activeKind='system';activeId=active.dataset.orangeOrderSystemQty||''}
 else if(active?.matches?.('[data-ledger-reservation-qty]')){activeKind='reservation';activeId=active.dataset.ledgerReservationQty||''}
 render('ordering-ledger');
 requestAnimationFrame(()=>{
  const nextWrap=document.querySelector('.sc-ledger-table-wrap');
  if(nextWrap){nextWrap.scrollTop=tableTop;nextWrap.scrollLeft=tableLeft;}
  const nextSearch=document.querySelector('#scLedgerSearch');
  const nextNameSearch=document.querySelector('#scLedgerNameSearch');
  if(nextSearch)nextSearch.value=searchValue;
  if(nextNameSearch)nextNameSearch.value=nameSearchValue;
  if(searchValue||nameSearchValue){
   const q=searchValue.trim().toLowerCase(),nq=nameSearchValue.trim().toLowerCase();
   document.querySelectorAll('[data-ledger-row]').forEach(tr=>{
    const a=!q||String(tr.dataset.ledgerSearch||'').includes(q);
    const b=!nq||String(tr.dataset.ledgerName||'').includes(nq);
    tr.hidden=!(a&&b);
   });
  }
  window.scrollTo({top:pageY,left:0,behavior:'auto'});
  const selected=document.querySelector(`[data-ledger-select-row="${CSS.escape(String(scLedgerSelectedProductId||''))}"]`);
  selected?.classList.add('selected');
  if(activeId){
   const selector=activeKind==='store'
    ?`[data-orange-order-store-qty="${CSS.escape(String(activeId))}"]`
    :activeKind==='system'
     ?`[data-orange-order-system-qty="${CSS.escape(String(activeId))}"]`
     :`[data-ledger-reservation-qty="${CSS.escape(String(activeId))}"]`;
   const nextInput=document.querySelector(selector);
   nextInput?.focus({preventScroll:true});
  }
 });
}
function bindScLedgerPage(){
 const search=document.querySelector('#scLedgerSearch');
 const nameSearch=document.querySelector('#scLedgerNameSearch');
 const applyFilters=()=>{
  const q=String(search?.value||'').trim().toLowerCase();
  const nq=String(nameSearch?.value||'').trim().toLowerCase();
  document.querySelectorAll('[data-ledger-row]').forEach(tr=>{
   const a=!q||String(tr.dataset.ledgerSearch||'').includes(q);
   const b=!nq||String(tr.dataset.ledgerName||'').includes(nq);
   tr.hidden=!(a&&b);
  });
 };
 search?.addEventListener('input',applyFilters);
 nameSearch?.addEventListener('input',applyFilters);
 const selectProduct=id=>{
  id=String(id||'');
  if(!id||id===String(scLedgerSelectedProductId||''))return;
  scLedgerSelectedProductId=id;
  rerenderScLedgerPreservePosition();
 };
 document.querySelectorAll('[data-orange-order-store-qty]').forEach(input=>{
  input.addEventListener('focus',()=>{scLedgerSelectedProductId=String(input.dataset.orangeOrderStoreQty||scLedgerSelectedProductId)});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();input.blur()}});
  input.addEventListener('change',()=>{
   const p=products().find(x=>String(x.id)===String(input.dataset.orangeOrderStoreQty));if(!p)return;
   scLedgerSelectedProductId=String(p.id);
   upsertOrangeOrderDraftQty(p,Math.max(0,Number(input.value||0)),{ai:false,audit:true});
   rerenderScLedgerPreservePosition();
  });
 });
 document.querySelectorAll('[data-orange-order-system-qty]').forEach(input=>{
  input.addEventListener('focus',()=>{scLedgerSelectedProductId=String(input.dataset.orangeOrderSystemQty||scLedgerSelectedProductId)});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();input.blur()}});
  input.addEventListener('change',()=>{
   const p=products().find(x=>String(x.id)===String(input.dataset.orangeOrderSystemQty));if(!p)return;
   scLedgerSelectedProductId=String(p.id);
   upsertOrangeOrderDraftQty(p,Math.max(0,Number(input.value||0)),{ai:true,audit:true});
   rerenderScLedgerPreservePosition();
  });
 });
 document.querySelectorAll('[data-ledger-system-toggle]').forEach(b=>b.addEventListener('click',async()=>{
  const p=products().find(x=>String(x.id)===String(b.dataset.ledgerSystemToggle));if(!p)return;
  const sw=productOrderSwitchState(p),next=!sw.system;
  b.disabled=true;
  try{
   const ok=await setProductOrderSwitch(p.id,'system',next);
   if(ok!==false){
    scLedgerSelectedProductId=String(p.id);
    rerenderScLedgerPreservePosition();
   }
  }finally{
   b.disabled=false;
  }
 }));
 document.querySelectorAll('[data-ledger-reservation-qty]').forEach(input=>{
  input.addEventListener('focus',()=>{scLedgerSelectedProductId=String(input.dataset.ledgerReservationQty||scLedgerSelectedProductId)});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();input.blur()}});
  input.addEventListener('change',async()=>{
   const p=products().find(x=>String(x.id)===String(input.dataset.ledgerReservationQty));if(!p)return;
   scLedgerSelectedProductId=String(p.id);
   await setLedgerReservationQty(p,input.value);
   rerenderScLedgerPreservePosition();
  });
 });
 document.querySelectorAll('[data-ledger-select]').forEach(b=>b.addEventListener('click',e=>{
  e.preventDefault();e.stopPropagation();
  selectProduct(b.dataset.ledgerSelect);
 }));
 document.querySelectorAll('[data-ledger-select-row]').forEach(tr=>{
  tr.addEventListener('click',e=>{
   if(e.target.closest('input,select,textarea,button,a'))return;
   selectProduct(tr.dataset.ledgerSelectRow);
  });
  tr.addEventListener('keydown',e=>{
   if(e.key!=='Enter'&&e.key!==' ')return;
   if(e.target.closest('input,select,textarea,button,a'))return;
   e.preventDefault();
   selectProduct(tr.dataset.ledgerSelectRow);
  });
 });
 document.querySelectorAll('[data-ledger-week]').forEach(b=>b.addEventListener('click',()=>{
  const step=Number(b.dataset.ledgerWeek||0);
  scLedgerWeekOffset=step===0?0:Math.min(0,Number(scLedgerWeekOffset||0)+step);
  rerenderScLedgerPreservePosition();
 }));
 const rulesBtn=document.querySelector('.ref-ledger-actions [data-action="ordering-rules-settings"]');
 if(rulesBtn)rulesBtn.addEventListener('click',e=>{
  e.preventDefault();e.stopPropagation();
  render('ordering-rules-settings');
 });
 const suggestionBtn=document.querySelector('.ref-ledger-actions [data-action="suggestion-settings"]');
 if(suggestionBtn)suggestionBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();adminOrderingPolicyProductId='';render('ordering-suggestion-settings')});
 const transmitBtn=document.querySelector('.ref-ledger-actions [data-action="transmit-all-orders"]');
 if(transmitBtn)transmitBtn.addEventListener('click',async e=>{
  e.preventDefault();e.stopPropagation();
  transmitBtn.disabled=true;
  const oldText=transmitBtn.textContent;
  transmitBtn.textContent='傳輸處理中…';
  try{
   await admin219TransmitAllOrders();
  }catch(err){
   console.error('台帳確認／傳輸失敗',err);
   alert('訂購傳輸失敗：'+(err?.message||err));
  }finally{
   if(document.body.contains(transmitBtn)){
    transmitBtn.disabled=false;
    transmitBtn.textContent=oldText;
   }
  }
 });
}

function autoOrderAI(){
 if(!requirePermission('orderAutoAI'))return;
 if(!orderingAiSwitches().auto)return alert('系統自動訂購目前為關閉，請先開啟開關');
 const items=products().filter(p=>productStatusLabel(p)!=='停用'&&productOrderSwitchState(p).system&&orderProductAllowedForType(p,'台帳訂購')&&productOrderingAllowedToday(p)).map(p=>{const qty=aiRecommendedQty(p);return qty?{productId:p.id,code:p.code||'',name:p.name,barcode:productBarcodes(p)[0]||'',group:p.group||'其他',category:p.category||'',deliveryType:normalizeDeliveryLabel(p.deliveryType||p.logistics||''),qty,multiple:orderMultipleCount(qty,p),packQty:orderPackQty(p),stock:Number(p.stock||0)}:null}).filter(Boolean);
 if(!items.length)return alert('目前沒有低於安全庫存且需要補貨的商品');
 const o=makeAutoOrder('台帳訂購',items,`系統自動訂購：依店舖策略設定（系訂 ${orderingPolicyConfig().auto.recommendPercent}%／回看 ${orderingPolicyConfig().auto.salesLookbackDays} 日）建立建議`);
 alert(`系訂建議草稿已建立 ${o.id}\n共 ${items.length} 項。可先按「修正」調整或刪除，不會強制訂購；確認後再按「傳輸」。`);render('ordering');
}
function freshAIOrder(){
 if(!requirePermission('freshAIOrder'))return;
 if(!orderingAiSwitches().fresh)return alert('鮮食 AI 輔助訂購目前為關閉，請先開啟開關');
 const items=products().filter(p=>productStatusLabel(p)!=='停用'&&isFosFreshProduct(p)&&productOrderSwitchState(p).system&&orderProductAllowedForType(p,'FOS鮮食訂購')&&productOrderingAllowedToday(p)).map(p=>{const qty=aiRecommendedQty(p,{fresh:true});return qty?{productId:p.id,code:p.code||'',name:p.name,barcode:productBarcodes(p)[0]||'',group:p.group||'其他',category:p.category||'',deliveryType:normalizeDeliveryLabel(p.deliveryType||p.logistics||''),qty,multiple:orderMultipleCount(qty,p),packQty:orderPackQty(p),stock:Number(p.stock||0)}:null}).filter(Boolean);
 if(!items.length)return alert(`依目前近 ${orderingPolicyConfig().fresh.salesLookbackDays} 日銷售／廢棄與庫存，暫無建議訂購量`);
 const o=makeAutoOrder('FOS鮮食訂購',items,`鮮食 AI 輔助：依店舖策略設定（AI ${orderingPolicyConfig().fresh.recommendPercent}%／回看 ${orderingPolicyConfig().fresh.salesLookbackDays} 日）建立建議`);
 alert(`鮮食系訂建議草稿已建立 ${o.id}\n共 ${items.length} 項。可先按「修正」調整或刪除，不會強制訂購；確認後再傳輸。`);render('ordering');
}
function freshWeekTable(p){const st=weeklyProductStats(p);return `<div class="fresh-week-mini"><table class="table"><tr><th>日期</th>${st.daily.map(d=>`<th>${d.date}</th>`).join('')}</tr><tr><th>進</th>${st.daily.map(d=>`<td>${d.in}</td>`).join('')}</tr><tr><th>銷</th>${st.daily.map(d=>`<td>${d.sales}</td>`).join('')}</tr><tr><th>廢</th>${st.daily.map(d=>`<td>${d.waste}</td>`).join('')}</tr></table></div>`}
// 台帳與其他訂購頁的「確認／傳輸」統一走同一個正式傳輸流程。
async function admin219TransmitAllOrders(){
 if(orderingIsStatisticsLock())return alert('21:59～22:01:59 為系統自動統計時間，暫停訂購傳輸。\n22:02 後會正式切換隔日訂購曆並恢復傳輸。');
 if(!cloudConfigured())return alert('後台尚未設定 Supabase，請先到「雲端與更新」完成設定');
 const rows=load(K.orders,[]);
 const pending=rows.filter(x=>['未傳輸','已建立','部分傳輸'].includes(x.status||'已建立'));
 if(!pending.length)return alert('目前沒有未傳輸訂購');

 const blocked=[];
 for(const order of pending)for(const item of (order.items||[])){
  const p=products().find(x=>String(x.id)===String(item.productId));if(!p)continue;
  const type=order.type||orangeDefaultOrderType(p);
  if(!orderProductAllowedForType(p,type))blocked.push(`${p.code||''} ${p.name||''}`.trim());
 }
 if(blocked.length)return alert(`以下商品已設定不可訂購，無法傳輸：\n${[...new Set(blocked)].slice(0,12).join('、')}`);

 // 店訂優先：同一商品只要店訂草稿有大於 0 的數量，所有系訂／AI 草稿都不再傳該商品。
 const storeOverrideQty=new Map();
 pending.filter(o=>!o.aiGenerated).forEach(o=>(o.items||[]).forEach(item=>{
  const product=products().find(x=>String(x.id)===String(item.productId));
  if(product&&!productOrderSwitchState(product).store)return;
  const qty=Math.max(0,Number(item.qty||0));
  if(qty>0)storeOverrideQty.set(String(item.productId),qty);
 }));
 const overrideCount=[...storeOverrideQty.keys()].length;

 const ruleCheckItems=[];
 for(const order of pending){
  for(const item of (order.items||[])){
   const product=products().find(x=>String(x.id)===String(item.productId));
   if(product){const sw=productOrderSwitchState(product);if(order.aiGenerated&&!sw.system)continue;if(!order.aiGenerated&&!sw.store)continue;}
   if(order.aiGenerated&&storeOverrideQty.has(String(item.productId)))continue;
   ruleCheckItems.push({...item,deliveryType:normalizeDeliveryLabel(item.deliveryType||order.deliveryType||'常溫'),orderType:order.type||'',orderDeliveryDate:order.deliveryDate||order.specifiedArrivalDate||''});
  }
 }
 const ruleErrors=orderingTransmissionRuleErrors(ruleCheckItems,new Date());
 if(ruleErrors.length)return alert(`目前不能傳輸：\n\n${ruleErrors.join('\n')}\n\n請依訂購規則於可訂購時間再傳輸。`);
 if(!confirm(`確定傳輸全部未傳輸訂購？\n共 ${pending.length} 張訂購單${overrideCount?`\n店訂將取代 ${overrideCount} 個商品的系訂數量`:''}\n\n同一門市、同一配送別、同一進貨日固定合併為同一張貨單；不同到貨時段也不拆單。`))return;

 const globalGroups=new Map();
 const orderGroupKeys=new Map();
 const activeOrders=[];
 let overriddenOrders=0;

 const addOrderGroupKey=(orderId,key)=>{
  if(!orderGroupKeys.has(String(orderId)))orderGroupKeys.set(String(orderId),new Set());
  orderGroupKeys.get(String(orderId)).add(key);
 };

 // 第一階段：整理所有訂購單，先依「配別＋到貨日＋到貨時段」跨訂單合併。
 for(const order of pending){
  const originalItems=(order.items||[]).map(x=>({...x}));
  let effectiveItems=originalItems.filter(item=>{
   if(Number(item.qty||0)<=0)return false;
   const product=products().find(x=>String(x.id)===String(item.productId));
   if(!product)return true;
   const sw=productOrderSwitchState(product);
   return order.aiGenerated?sw.system:sw.store;
  });

  if(order.aiGenerated){
   const overridden=effectiveItems.filter(item=>storeOverrideQty.has(String(item.productId)));
   effectiveItems=effectiveItems.filter(item=>!storeOverrideQty.has(String(item.productId)));
   if(overridden.length){
    order.storeOverrideItems=overridden.map(item=>({...item,storeQty:storeOverrideQty.get(String(item.productId))}));
    order.storeOverrideAt=new Date().toISOString();
    saveAudit('店訂取代系訂',overridden.map(item=>`${item.code||''} ${item.name||''}：系訂${Number(item.qty||0)}→店訂${storeOverrideQty.get(String(item.productId))}`).join('；'));
   }
   if(!effectiveItems.length){
    order.status='店訂取代';
    order.items=[];
    order.overriddenAt=new Date().toISOString();
    overriddenOrders++;
    continue;
   }
   if(overridden.length){
    order.originalAiItems=originalItems;
    order.items=effectiveItems;
   }
  }

  if(!effectiveItems.length){
   order.status=order.aiGenerated?'系訂關閉':'店訂關閉';
   order.skippedAt=new Date().toISOString();
   continue;
  }

  activeOrders.push(order);

  for(const item of effectiveItems){
   const deliveryType=normalizeDeliveryLabel(item.deliveryType||order.deliveryType||'常溫');
   const enriched={...item,deliveryType,orderType:order.type||'',orderDeliveryDate:order.deliveryDate||order.specifiedArrivalDate||'',sourceOrderId:order.id};
   const expected=orderingExpectedArrival(deliveryType,new Date(),enriched);
   // Alpha 5.59：同門市、同進貨日、同溫層、同「明確配次」才拆分；供應商/路線/來源批號不拆單。
   // 供應商 / 來源 / 活動名稱一律不參與拆單；真的有不同配送批次才拆。
   const deliveryRun=logisticsDeliveryRunKey(enriched,order);
   enriched.deliveryRun=deliveryRun;
   const key=`${deliveryType}@@${expected.date||''}@@${deliveryRun}`;
   if(!globalGroups.has(key)){
    globalGroups.set(key,{key,deliveryType,deliveryRun,expected:{...expected},contributions:new Map()});
   }
   const g=globalGroups.get(key);
   if(!g.contributions.has(String(order.id)))g.contributions.set(String(order.id),{order,items:[]});
   g.contributions.get(String(order.id)).items.push(enriched);
   addOrderGroupKey(order.id,key);
  }
 }

 const mergeItems=items=>{
  const map=new Map();
  for(const item of items){
   const productKey=String(item.productId||item.product_id||item.code||item.barcode||item.name||uid());
   const supplier=logisticsSupplierIdentity(item);
   // 同商品若來自不同供應商，仍保留兩條明細；但供應商不會造成拆貨單。
   const id=`${productKey}@@${supplier.key}`;
   if(!map.has(id))map.set(id,{...item,supplierCode:supplier.code||item.supplierCode||'',supplierName:supplier.name||item.supplierName||'',qty:0});
   const row=map.get(id);
   row.qty=Number(row.qty||0)+Number(item.qty||0);
  }
  return [...map.values()];
 };

 const orderHasGroupBatch=(order,deliveryType,date,deliveryRun='DEFAULT')=>{
  return (Array.isArray(order.batches)?order.batches:[]).some(x=>
   String(x.deliveryType||'')===String(deliveryType)&&
   String(x.deliveryDate||'')===String(date||'')&&
   String(x.deliveryRun||'DEFAULT')===String(deliveryRun||'DEFAULT')&&
   String(x.batchNo||'').trim()
  );
 };

 const stableHash=text=>{
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36).toUpperCase();
 };

 let okGroups=0,failed=[];
 const groupResults=new Map();

 // 第二階段：每個物流群組只建立一張物流批次／進貨單。
 for(const g of globalGroups.values()){
  const missing=[...g.contributions.values()].filter(c=>!orderHasGroupBatch(c.order,g.deliveryType,g.expected.date,g.deliveryRun));
  if(!missing.length){
   groupResults.set(g.key,{ok:true,reused:true});
   continue;
  }

  const sourceIds=missing.map(c=>String(c.order.id)).sort();
  const currentItems=missing.flatMap(c=>c.items);
  const historicalSameGroupItems=[];
  for(const existingOrder of rows){
   if(missing.some(c=>String(c.order.id)===String(existingOrder.id)))continue;
   for(const item of (existingOrder.items||[])){
    const deliveryType=normalizeDeliveryLabel(item.deliveryType||existingOrder.deliveryType||'常溫');
    if(deliveryType!==g.deliveryType)continue;
    const enriched={...item,deliveryType,orderType:existingOrder.type||'',orderDeliveryDate:existingOrder.deliveryDate||existingOrder.specifiedArrivalDate||'',sourceOrderId:existingOrder.id};
    const expected=orderingExpectedArrival(deliveryType,new Date(existingOrder.at||Date.now()),enriched);
    const deliveryRun=logisticsDeliveryRunKey(enriched,existingOrder);
    if(String(expected.date||'')===String(g.expected.date||'')&&String(deliveryRun)===String(g.deliveryRun||'DEFAULT'))historicalSameGroupItems.push({...enriched,deliveryRun});
   }
  }
  const mergedItems=mergeItems([...historicalSameGroupItems,...currentItems]);
  const dateKey=String(g.expected.date||localDateKey()).replaceAll('-','');
  // 同門市＋同配送別＋同進貨日固定使用同一個傳輸群組編號。
  // 即使分兩次按「傳輸」，第二次也會回到同一個物流群組，而不是再建立新 YJB。
  const runKey=String(g.deliveryRun||'DEFAULT');
  const runSuffix=runKey==='DEFAULT'?'':`-${stableHash(runKey).slice(0,6)}`;
  const groupId=`YJOG-${currentStoreCode()}-${orderDeliveryCode(g.deliveryType)}-${dateKey}${runSuffix}`;
  const cloudDeliveryType=logisticsCloudDeliveryTypeForOrder(g.deliveryType);

  try{
   const row=await adminTransmitOrderToLogistics({
    id:groupId,
    type:'合併訂購',
    deliveryType:cloudDeliveryType,
    items:mergedItems,
    deliveryDate:g.expected.date||'',
    deliveryRun:g.deliveryRun||'DEFAULT',
    note:`到貨日＋溫層＋配次合併貨單｜${g.expected.date||'未定日期'}｜${g.deliveryType}｜配次：${logisticsRunLabel(g.deliveryRun)}｜來源訂購單：${sourceIds.join('、')}｜物流代碼：${cloudDeliveryType}`
   },currentUser()?.name||'');

   if(!row?.batch_no)throw new Error('資料庫沒有回傳物流批次');

   // Alpha 5.26：物流批次建立成功後，將 SC 計算好的真正進貨日
   // 明確同步到 logistics_batches 與 inventory_receipts。
   // 避免資料庫只有 arrived_at（POS過刷時間），卻沒有 delivery_date。
   if(g.expected.date){
    try{
     await adminSetLogisticsDeliveryDate(row.batch_no,g.expected.date);
    }catch(e){
     throw new Error(`物流進貨日期同步失敗：${e.message}`);
    }
   }

   let receiptNo=row.receipt_no||'';
   let receiptBarcode=row.receipt_barcode||'';
   if(!receiptNo){
    try{
     const receipt=await adminGetInventoryReceiptByBatch(row.batch_no);
     receiptNo=receipt?.receipt_no||'';
     receiptBarcode=receipt?.receipt_barcode||'';
    }catch{}
   }

   try{await adminSyncInventoryReceiptItems(row.batch_no)}catch(e){console.warn('傳輸後進貨明細同步失敗',row.batch_no,e)}

   for(const c of missing){
    const order=c.order;
    const batches=Array.isArray(order.batches)?order.batches:[];
    const receipts=Array.isArray(order.receipts)?order.receipts:[];
    order.deliveryArrivals=Array.isArray(order.deliveryArrivals)?order.deliveryArrivals:[];

    if(!batches.some(x=>String(x.batchNo||'')===String(row.batch_no))){
     batches.push({
      deliveryType:g.deliveryType,
      cloudDeliveryType,
      batchNo:row.batch_no,
      deliveryDate:g.expected.date,
      deliveryRun:g.deliveryRun||'DEFAULT',
      arrivalPeriod:g.expected.period,
      sourceOrderId:order.id,
      transmitOrderNo:groupId,
      mergedShipment:true,
      mergedSourceOrders:sourceIds
     });
    }
    if(receiptNo&&!receipts.some(x=>String(x.receiptNo||'')===String(receiptNo))){
     receipts.push({
      deliveryType:g.deliveryType,
      cloudDeliveryType,
      receiptNo,
      receiptBarcode,
      deliveryDate:g.expected.date,
      deliveryRun:g.deliveryRun||'DEFAULT',
      batchNo:row.batch_no,
      sourceOrderId:order.id,
      transmitOrderNo:groupId,
      mergedShipment:true,
      mergedSourceOrders:sourceIds
     });
    }

    order.batches=batches;
    order.receipts=receipts;
    if(!order.deliveryDates?.[g.deliveryType])order.deliveryDates={...(order.deliveryDates||{}),[g.deliveryType]:{date:g.expected.date,period:g.expected.period}};
    if(!order.deliveryArrivals.some(x=>x.deliveryType===g.deliveryType&&x.date===g.expected.date&&String(x.deliveryRun||'DEFAULT')===String(g.deliveryRun||'DEFAULT')))order.deliveryArrivals.push({deliveryType:g.deliveryType,date:g.expected.date,deliveryRun:g.deliveryRun||'DEFAULT',period:g.expected.period});
    if(!order.deliveryDate&&g.expected.date)order.deliveryDate=g.expected.date;
   }

   groupResults.set(g.key,{ok:true,batchNo:row.batch_no,receiptNo});
   okGroups++;
  }catch(err){
   groupResults.set(g.key,{ok:false,error:err});
   failed.push(`${g.deliveryType}／${g.expected.date||'未定日期'}／${logisticsRunLabel(g.deliveryRun)}：${err.message}`);
  }
 }

 let transmittedOrders=0;
 const transmittedThisRun=[];
 const nowIso=new Date().toISOString();

 // 第三階段：依各訂購單所屬群組結果回寫狀態。
 for(const order of activeOrders){
  const keys=[...(orderGroupKeys.get(String(order.id))||[])];
  const allOk=keys.length&&keys.every(k=>groupResults.get(k)?.ok);
  order.batchNo=(Array.isArray(order.batches)?order.batches:[]).map(x=>x.batchNo).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('、');
  order.receiptNo=(Array.isArray(order.receipts)?order.receipts:[]).map(x=>x.receiptNo).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('、');
  order.status=allOk?'已傳輸':'部分傳輸';
  if(allOk){
   order.transmittedAt=nowIso;
   transmittedOrders++;
   transmittedThisRun.push(String(order.id));
  }else if(order.batchNo){
   transmittedThisRun.push(String(order.id));
  }
 }

 save(K.orders,rows);
 let orderCloudSyncError='';
 try{await cloudPushKey(K.orders,rows)}catch(e){orderCloudSyncError=String(e?.message||e);console.warn('訂購傳輸後雲端同步失敗',e)}
 if(!failed.length&&!orderCloudSyncError){
  localStorage.setItem('yj_ordering_last_successful_transmit_ms',String(Date.now()));
 }
 saveAudit('訂購統一傳輸',`${transmittedOrders}張訂購單｜${okGroups}張合併物流貨單｜店訂取代系訂${overrideCount}商品${orderCloudSyncError?'｜訂購雲端同步失敗':''}`);
 render('ordering');
 if(failed.length||orderCloudSyncError)alert(`傳輸完成，但有部分同步異常：\n${failed.slice(0,8).join('\n')}${orderCloudSyncError?`\n訂購雲端同步：${orderCloudSyncError}`:''}`);
 else openPostTransmitOrderDetailPrompt(transmittedThisRun);
}

function orderDeliveryCode(type){return {'常溫':'AMB','鮮食一配':'F1','鮮食二配':'F2','低溫一配':'L1','低溫二配':'L2','冷凍':'FRZ','億家通':'YJT'}[normalizeDeliveryLabel(type)]||'MIX'}
function logisticsCloudDeliveryTypeForOrder(type){
 const t=normalizeDeliveryLabel(type);
 // 訂購 → 物流 RPC 使用物流批次的正式配送代碼。
 // 億家通一般訂購屬 yijiatong；ec 是 EC 包裹共同貨單，不可拿來傳一般訂購單。
 const map={
  '常溫':'ambient',
  '鮮食一配':'fresh_1',
  '鮮食二配':'fresh_2',
  '低溫一配':'dairy',
  '低溫二配':'low_2',
  '冷凍':'frozen',
  '億家通':'yijiatong'
 };
 return map[t]||t;
}

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
 return rows.map(o=>{const canDelete=['未傳輸','已建立'].includes(o.status||'已建立');return `<tr>
  <td><input type="checkbox" data-v531-order-select="${esc(o.id)}" ${canDelete?'':'disabled title="已傳輸訂購單不可直接刪除"'}></td>
  <td>${esc(o.id)}</td><td>${esc(o.type)}${o.aiGenerated?' <small class="order-ai-badge">系訂建議</small>':''}</td><td>${esc(o.deliveryDate||'')}</td>
  <td>${o.items?.length||0}</td><td>${(o.items||[]).reduce((s,x)=>s+Number(x.qty||0),0)}</td>
  <td>${esc(o.status||'未傳輸')}</td><td>${esc(o.batchNo||'—')}</td><td>${esc(o.receiptNo||'—')}</td>
  <td><button class="button" data-v531-order-detail="${o.id}">訂購明細</button> <button class="button" data-v531-order-edit="${o.id}">修正</button> <button class="button" data-v531-order-print="${o.id}">列印</button> ${canDelete?`<button class="button danger" data-v531-order-delete="${o.id}">刪除</button>`:''}</td>
 </tr>`}).join('')||'<tr><td colspan="10">尚無訂購單</td></tr>';
}

function orderMultipleOptions(selected,max=20){
 selected=Math.max(1,Number(selected)||1);max=Math.max(max,selected);
 return Array.from({length:max},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===selected?'selected':''}>${n} 倍</option>`).join('');
}
function v531ItemHtml(item,index){
 const p=products().find(x=>x.id===item.productId)||{};
 const pack=orderPackQty(p),multiple=orderMultipleCount(item.qty,p),canMulti=hasPermission('orderMultipleUse');
 const weekExtra=freshWeekTable(p);
 return `<div class="order-product-card order-product-card-history">
  <div class="order-product-main"><strong>${esc(item.code)}｜${esc(item.name)}</strong>
   <small>${esc(item.group||'其他')}｜${esc(item.category||'')}｜${esc(normalizeDeliveryLabel(item.deliveryType||''))}</small>
   <small>目前庫存：<b>${Number(p.stock??item.stock??0)}</b>｜訂購倍數：1倍 ${pack} 個</small>${weekExtra}</div>
  <div class="order-product-control">${canMulti?`<label>倍數<select data-v531-order-multiple="${index}">${orderMultipleOptions(multiple)}</select><small>= ${multiple*pack} 個</small></label>`:`<label>數量<input type="number" min="1" value="${item.qty}" data-v531-order-qty="${index}"></label>`}</div>
  <button type="button" class="button danger order-product-delete" data-v531-order-remove="${index}">刪除</button>
 </div>`;
}

function v531OpenOrdering(){return openOrderingDetails()}

function v531OpenOrderDetail(order){
 const items=(order.items||[]).map(x=>`<tr><td>${esc(x.code||'')}</td><td>${esc(x.name||'')}</td><td>${esc(x.barcode||'')}</td><td>${esc(normalizeDeliveryLabel(x.deliveryType||''))}</td><td>${Number(x.qty||0)}</td></tr>`).join('')||'<tr><td colspan="5">無商品明細</td></tr>';
 dlg(`訂購明細｜${order.id}`,`<div class="panel"><p><b>訂購類型：</b>${esc(order.type||'')}</p><p><b>預定到貨：</b>${esc(order.deliveryDate||'—')}</p><p><b>狀態：</b>${esc(order.status||'未傳輸')}</p><p><b>物流批次：</b>${esc(order.batchNo||'—')}</p><p><b>進貨單：</b>${esc(order.receiptNo||'—')}</p><p><b>建立人員：</b>${esc(order.user||'—')}</p><p><b>建立時間：</b>${order.at?new Date(order.at).toLocaleString('zh-TW'):'—'}</p></div><div class="panel table-wrap"><table class="table"><tr><th>商品代號</th><th>商品名稱</th><th>條碼</th><th>配送別</th><th>數量</th></tr>${items}</table></div><div class="panel"><b>備註</b><p>${esc(order.note||'—')}</p></div>`);
}

function v531OpenOrderEdit(order){
 if(!['未傳輸','已建立','部分傳輸'].includes(order.status||'已建立'))return alert('此訂購單已完成傳輸／到貨，為避免物流與進貨資料不一致，不能直接修正。');
 let items=(order.items||[]).map(x=>({...x}));
 dlg(`修正訂購單｜${order.id}`,`<div id="v531EditOrderItems"></div><label>預定到貨日<input id="v531EditOrderDate" type="date" value="${esc(order.deliveryDate||'')}"></label><label>備註<textarea id="v531EditOrderNote" rows="3">${esc(order.note||'')}</textarea></label><button type="button" class="primary" id="v531EditOrderSave">儲存修正</button>`);
 const redraw=()=>{const box=document.querySelector('#v531EditOrderItems');if(box)box.innerHTML=items.map((x,i)=>{const p=products().find(v=>v.id===x.productId)||{};const pack=orderPackQty(p),multi=orderMultipleCount(x.qty,p);return `<div class="order-product-card order-product-card-history"><div class="order-product-main"><strong>${esc(x.code||'')}｜${esc(x.name||'')}</strong><small>${esc(x.group||p.group||'其他')}｜${esc(x.category||p.category||'')}｜${esc(normalizeDeliveryLabel(x.deliveryType||''))}</small><small>目前庫存：<b>${Number(p.stock??x.stock??0)}</b>｜訂購倍數：1倍 ${pack} 個</small>${freshWeekTable(p)}</div><div class="order-product-control">${hasPermission('orderMultipleUse')?`<label>倍數<select data-v531-edit-multiple="${i}">${orderMultipleOptions(multi)}</select><small>= ${multi*pack} 個</small></label>`:`<label>數量<input type="number" min="1" value="${Number(x.qty||1)}" data-v531-edit-qty="${i}"></label>`}</div><button type="button" class="button danger order-product-delete" data-v531-edit-remove="${i}">刪除</button></div>`}).join('')||'<p>此訂購單目前沒有商品</p>';};
 setTimeout(()=>{
  redraw();
  const box=document.querySelector('#v531EditOrderItems');
  box.onclick=e=>{const r=e.target.closest('[data-v531-edit-remove]');if(r){items.splice(Number(r.dataset.v531EditRemove),1);redraw();}};
  box.oninput=e=>{const q=e.target.closest('[data-v531-edit-qty]');if(q)items[Number(q.dataset.v531EditQty)].qty=Math.max(1,Number(q.value)||1);const m=e.target.closest('[data-v531-edit-multiple]');if(m){const i=Number(m.dataset.v531EditMultiple),p=products().find(v=>v.id===items[i].productId);items[i].multiple=Math.max(1,Number(m.value)||1);items[i].packQty=orderPackQty(p);items[i].qty=items[i].multiple*items[i].packQty;redraw();}};
  document.querySelector('#v531EditOrderSave').onclick=()=>{if(!items.length)return alert('訂購單至少需保留一項商品');const rows=load(K.orders,[]),target=rows.find(x=>x.id===order.id);if(!target)return alert('找不到訂購單');target.items=items.map(x=>({...x}));target.deliveryDate=document.querySelector('#v531EditOrderDate').value;target.note=document.querySelector('#v531EditOrderNote').value.trim();target.correctedAt=new Date().toISOString();target.correctedBy=currentUser()?.name||'';save(K.orders,rows);saveAudit('修正訂購單',`${target.id}｜${target.items.length}項`);genericDialog.close();render('ordering');alert('訂購單已修正');};
 },0);
}

function v531PrintOrder(order){
 const body=(order.items||[]).map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.barcode||'')}</td><td>${esc(x.group||'')}</td><td>${esc(x.category||'')}</td><td>${esc(normalizeDeliveryLabel(x.deliveryType||''))}</td><td>${x.qty}</td></tr>`).join('');
 printHTML(`訂購單 ${order.id}`,`<p>類型：${esc(order.type)}</p><p>預定到貨日：${esc(order.deliveryDate||'')}</p><table><tr><th>商品代號</th><th>商品名稱</th><th>條碼</th><th>品群</th><th>類別</th><th>配送別</th><th>數量</th></tr>${body}</table><p>備註：${esc(order.note||'')}</p>`);
}

function orderRows(rows){return rows.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.type)}</td><td>${esc(o.deliveryDate||'')}</td><td>${o.items.length}</td><td>${o.items.reduce((a,x)=>a+Number(x.qty),0)}</td><td>${esc(o.status)}</td><td><button class="button" data-view-order="${o.id}">查看</button> <button class="button danger" data-delete-order="${o.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">尚無訂購單</td></tr>'}
function orderForm(){return`<label>訂購類型<select id="orderType">${['台帳訂購','FOS鮮食訂購','用度品訂購','特殊品訂購','品群訂購'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>預定到貨日<input id="orderDate" type="date"></label><div class="panel"><h3>商品明細</h3><div class="inline-field"><input id="orderBarcode" placeholder="掃描或輸入商品條碼"><button type="button" class="button" id="scanOrderBarcode">📷 掃描</button><button type="button" class="button" id="addOrderItem">加入</button></div><div id="orderItemList"></div></div><label>備註<textarea id="orderNote"></textarea></label><button class="primary" id="saveOrder">建立訂購單</button>`}



function employeeEmploymentStatus(u){
 const raw=String(u?.employmentStatus||((u?.active===false)?'停用':'在職'));
 return raw||'在職';
}
function employeePositionOptions(selected=''){
 const opts=['店長','副店長','店員','正職','兼職','總部支援'];
 if(selected&&!opts.includes(selected))opts.unshift(selected);
 return opts.map(x=>`<option ${String(selected)===x?'selected':''}>${esc(x)}</option>`).join('');
}

function stocktakeReportPage(){
 const batches=(load(K.stocktakeBatches,[])||[]).filter(x=>String(x.status||'')==='已完成').slice().sort((a,b)=>String(b.completedAt||b.startedAt||'').localeCompare(String(a.completedAt||a.startedAt||'')));
 if(!window.__yjStocktakeReportBatchId||!batches.some(x=>String(x.id)===String(window.__yjStocktakeReportBatchId)))window.__yjStocktakeReportBatchId=batches[0]?.id||'';
 const selected=batches.find(x=>String(x.id)===String(window.__yjStocktakeReportBatchId))||null;
 const allMoves=(load(K.inventoryMoves,[])||[]).filter(x=>x.type==='盤點');
 const moves=selected?allMoves.filter(x=>String(x.batchId||'')===String(selected.id)||(!x.batchId&&String(x.batchNo||'')===String(selected.batchNo||''))):[];
 const over=moves.filter(x=>Number(x.qty||0)>0).length,short=moves.filter(x=>Number(x.qty||0)<0).length,match=moves.filter(x=>Number(x.qty||0)===0).length,diff=moves.reduce((a,x)=>a+Number(x.qty||0),0);
 const rows=moves.map(x=>`<tr><td>${esc(x.product||'')}</td><td>${Number(x.bookQty??(Number(x.actualQty||0)-Number(x.qty||0)))}</td><td>${Number(x.actualQty??(Number(x.bookQty||0)+Number(x.qty||0)))}</td><td class="${Number(x.qty||0)===0?'diff-ok':Number(x.qty||0)>0?'diff-over':'diff-short'}">${Number(x.qty||0)>0?'+':''}${Number(x.qty||0)}</td><td>${esc(x.reason||'—')}</td><td>${esc(x.user||'')}</td><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td></tr>`).join('')||'<tr><td colspan="7">此盤點單沒有盤點結果。</td></tr>';
 return `<div class="page-head"><div><h2>盤點報告書</h2><small>顯示已完成盤點單的實際盤點結果。</small></div><div class="toolbar"><select id="stocktakeReportBatch">${batches.map(x=>`<option value="${esc(x.id)}" ${selected&&String(x.id)===String(selected.id)?'selected':''}>${esc(x.batchNo||'未命名盤點單')}｜${x.completedAt?new Date(x.completedAt).toLocaleString('zh-TW'):'已完成'}</option>`).join('')||'<option value="">目前沒有已完成盤點單</option>'}</select><button class="primary" data-action="stocktake-report-query" ${batches.length?'':'disabled'}>查詢</button><button class="button" data-action="stocktake-report-print" ${selected?'':'disabled'}>列印</button></div></div>
 ${selected?`<section class="panel"><div class="metric-grid"><div class="metric"><small>盤點單號</small><strong style="font-size:18px">${esc(selected.batchNo||'—')}</strong></div><div class="metric"><small>盤點品項</small><strong>${moves.length}</strong></div><div class="metric"><small>相符</small><strong>${match}</strong></div><div class="metric"><small>盤盈</small><strong>${over}</strong></div><div class="metric"><small>盤虧</small><strong>${short}</strong></div><div class="metric"><small>差異合計</small><strong>${diff>0?'+':''}${diff}</strong></div></div><p class="meta">開始：${selected.startedAt?new Date(selected.startedAt).toLocaleString('zh-TW'):'—'}｜完成：${selected.completedAt?new Date(selected.completedAt).toLocaleString('zh-TW'):'—'}｜完成者：${esc(selected.completedBy||'—')}</p></section><section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>商品</th><th>帳面數</th><th>實盤數</th><th>差異值</th><th>原因／備註</th><th>盤點人員</th><th>時間</th></tr></thead><tbody>${rows}</tbody></table></section>`:'<section class="panel"><p>目前沒有已完成的盤點結果。</p></section>'}`;
}

function stocktakeRoleOptions(selected='盤點人員'){
 const opts=['總部人員','盤點人員'];
 if(selected&&!opts.includes(selected))opts.push(selected);
 return opts.map(x=>`<option ${String(selected)===x?'selected':''}>${esc(x)}</option>`).join('');
}
function stocktakePositionOptions(selected='盤點人員'){
 const opts=['總部人員','盤點課長','盤點人員'];
 if(selected&&!opts.includes(selected))opts.push(selected);
 return opts.map(x=>`<option ${String(selected)===x?'selected':''}>${esc(x)}</option>`).join('');
}
function employeeIdentityOptions(selected=''){
 const opts=['正職','兼職','支援','其他'];
 if(selected&&!opts.includes(selected))opts.unshift(selected);
 return opts.map(x=>`<option ${String(selected)===x?'selected':''}>${esc(x)}</option>`).join('');
}
function employeeStatusOptions(selected='在職'){
 const normalized=String(selected||'在職');
 return [
  ['在職','在職／啟用'],
  ['停用','停用'],
  ['離職','離職'],
  ['離店','離店']
 ].map(([value,label])=>`<option value="${value}" ${normalized===value?'selected':''}>${label}</option>`).join('');
}
function employeesAdminPage(){
 const rows=storeEmployees();
 const dirty=localStorage.getItem('yj_employee_master_dirty')==='1';
 return `<div class="page-head"><div><h2>人員基本資料</h2><small>員工基本資料／帳密／任職狀態</small></div><div class="toolbar">${canManageSelfCheckoutAccount()?'<button class="button" data-action="self-checkout-account-settings">自助結帳帳號 99999</button>':''}${isHeadOffice()&&isFounder()?'<button class="button" data-nav="hq-personnel">總部人員基本資料</button><button class="button" data-nav="engineer-personnel">工程師人員基本資料</button>':''}<button class="button" data-nav="permissions">權限設定</button>${isHeadOffice()?'<button class="button" data-nav="stocktake-personnel">盤點人員基本資料</button>':''}${hasPermission('employeeCreate')?'<button class="primary" data-action="new-employee">＋ 新增員工</button>':''}<button class="button" data-update="POS">下傳 TM</button><button class="button" data-update-sc="employees">下傳 SC</button></div></div>
 <section class="panel table-wrap"><table class="table"><thead><tr><th>姓名</th><th>帳號</th><th>身份</th><th>職位</th><th>角色</th><th>報到日</th><th>入社日</th><th>狀態</th><th>通訊電話</th><th>操作</th></tr></thead><tbody>${rows.map(u=>{
  const editable=isFounderSelf(currentUser(),u)||canEditEmployeeTarget(currentUser(),u);
  return `<tr><td>${esc(u.name||'')}</td><td>${esc(u.account||'—')}</td><td>${esc(u.employmentType||'—')}</td><td>${esc(u.position||u.role||'—')}</td><td>${esc(u.role||'—')}</td><td>${esc(u.reportDate||'—')}</td><td>${esc(u.joinDate||'—')}</td><td>${esc(employeeEmploymentStatus(u))}</td><td>${esc(u.contactPhone||u.phone||'—')}</td><td>${editable?`<button class="button" data-employee-settings="${u.id}">設定</button> <button class="button" data-employee-credentials="${u.id}">帳密</button>${u.role!=='創辦人'?` <button class="button ${u.active===false?'':'danger'}" data-toggle-employee="${u.id}">${u.active===false?'啟用':'停用'}</button>`:''}`:'—'}</td></tr>`;
 }).join('')||'<tr><td colspan="10">目前沒有員工資料</td></tr>'}</tbody></table></section>`;
}
function employeeDetailPage(){
 const dirty=localStorage.getItem('yj_employee_master_dirty')==='1';
 const selectedId=String(window.__yjEmployeePageSelected||'');
 const u=employees().find(x=>String(x.id)===selectedId)||null;
 const isStocktake=!!u?.isStocktakePersonnel;
 const specialKind=u?.isEngineerPersonnel?'engineer':u?.isHeadOfficePersonnel?'hq':'';
 const specialMeta=specialKind?specialPersonnelMeta(specialKind):null;
 if(!u)return `<div class="page-head"><div><h2>員工基本資料</h2><small>找不到指定員工</small></div><button class="button" data-nav="employees">← 返回人員基本資料</button></div>`;
 const status=employeeEmploymentStatus(u),role=u?.role||'',position=u?.position||u?.role||'',identity=u?.employmentType||'正職';
 const canEdit=u&&(isFounderSelf(currentUser(),u)||canEditEmployeeTarget(currentUser(),u));
 const ro=canEdit?'':'disabled';
 const loginEnabled=u.loginEnabled!==false&&u.active!==false&&!['離職','離店','停用'].includes(status);
 return `<div class="page-head"><div><h2>${isStocktake?'盤點人員基本資料':specialMeta?specialMeta.label+'基本資料':'員工基本資料'}</h2><small>${esc(u.name||'')}｜${esc(u.account||'')}</small></div><button class="button" data-nav="${isStocktake?'stocktake-personnel':specialMeta?specialMeta.page:'employees'}">← 返回${isStocktake?'盤點人員基本資料':specialMeta?specialMeta.label+'基本資料':'人員基本資料'}</button></div><div class="employee-master-original">
  <section class="panel employee-master-section">
   <div class="employee-master-title">👤 員工基本資料</div>
   <div class="employee-master-toolbar">${isStocktake?`<button class="button" data-action="stocktake-personnel-permissions" data-person-id="${esc(u.id)}">盤點人員權限設定</button><button class="button" data-update="POS">下傳 TM</button><button class="button" data-update-sc="employees">下傳 SC</button><button class="button" data-print-employee-number="${esc(u.id)}">列印員工編號</button>`:specialMeta?`<button class="button" data-nav="${specialMeta.permPage}">${specialMeta.label}權限設定</button><button class="button" data-update="POS">下傳 TM</button><button class="button" data-update-sc="employees">下傳 SC</button><button class="button" data-print-employee-number="${esc(u.id)}">列印員工編號</button>`:`<button class="button" data-nav="permissions">權限設定</button><button class="button" data-update="POS">下傳 TM</button><button class="button" data-update-sc="employees">下傳 SC</button><button class="button" data-print-employee-number="${esc(u.id)}">列印員工編號</button>`}</div>
   <div class="employee-master-topgrid">
    <label><span>* 角色</span>${isFounderSelf(currentUser(),u)?`<input id="empRoleLocked" value="創辦人" readonly>`:`<select id="empRole" ${ro}>${isStocktake?stocktakeRoleOptions(role):employeeRoleOptions(role)}</select>`}</label>
    <label><span>* 職位</span><select id="empPosition" ${ro}>${isStocktake?stocktakePositionOptions(position):employeePositionOptions(position)}</select></label>
    <label><span>名牌職稱</span><input id="empBadgeTitle" value="${esc(u.badgeTitle||position||'')}" ${ro}></label>
    <label><span>員工編號</span><input id="empCode" value="${esc(u.employeeCode||u.account||'')}" ${ro}></label>
    <label><span>身分證字號</span><input id="empNationalId" value="${esc(u.nationalId||u.idNumber||'')}" ${ro}></label>
    <label><span>店號</span><input id="empStoreCode" value="${esc(u.storeCode||currentStoreCode())}" ${ro}>${hasPermission('employeeHistoryBlacklistQuery')?'<button type="button" class="button employee-under-field" data-action="employee-history-blacklist-query">前店／黑名單查詢</button>':''}</label>
    <label><span>店名</span><input id="empStoreName" value="${esc(u.storeName||store().name||'')}" ${ro}></label>
    <label><span>* 狀態</span><select id="empStatus" ${ro}>${employeeStatusOptions(status)}</select></label>
   </div>
  </section>
  <section class="panel employee-master-section" style="margin-top:14px">
   <div class="employee-master-title">👤 基本資料</div>
   <div class="employee-master-basicgrid">
    <label><span>* 姓名</span><input id="empName" value="${esc(u.name||'')}" ${ro}></label>
    <label><span>* 出生日期</span><input id="empBirth" type="date" value="${esc(u.birthDate||'')}" ${ro}></label>
    <label><span>* 身份</span><select id="empIdentity" ${ro}>${employeeIdentityOptions(identity)}</select></label>
    <label><span>* 報到日</span><input id="empReport" type="date" value="${esc(u.reportDate||'')}" ${ro}></label>
    <label class="wide"><span>* 戶籍地址</span><input id="empHouseholdAddress" value="${esc(u.householdAddress||'')}" ${ro}></label>
    <label><span>* 入社日</span><input id="empJoin" type="date" value="${esc(u.joinDate||'')}" ${ro}></label>
    <label><span>戶籍電話</span><input id="empHouseholdPhone" value="${esc(u.householdPhone||u.homePhone||'')}" ${ro}></label>
    <label><span>行動電話</span><input id="empPhone" value="${esc(u.phone||'')}" ${ro}></label>
    <label><span>* 通訊電話</span><input id="empContactPhone" value="${esc(u.contactPhone||'')}" ${ro}></label>
    <label class="wide"><span>通訊地址</span><input id="empContactAddress" value="${esc(u.contactAddress||u.correspondenceAddress||'')}" ${ro}></label>
    <label><span>聯絡人姓名</span><input id="empEmergencyName" value="${esc(u.emergencyName||u.emergencyContactName||'')}" ${ro}></label>
    <label><span>聯絡人電話</span><input id="empEmergencyPhone" value="${esc(u.emergencyPhone||u.emergencyContactPhone||'')}" ${ro}></label>
    <label><span>最高學歷</span><input id="empEducation" value="${esc(u.education||'')}" ${ro}></label>
    <label><span>薪資匯款</span><input id="empPayrollBank" value="${esc(u.payrollBank||u.salaryRemit||'')}" ${ro}></label>
    <label><span>Email</span><input id="empEmail" type="email" value="${esc(u.email||'')}" ${ro}></label>
    <label><span>暱稱</span><input id="empNickname" value="${esc(u.nickname||u.nickName||'')}" ${ro}></label>
   </div>
  </section>
  <section class="panel employee-master-section employee-auth-section" style="margin-top:14px">
   <div class="employee-master-title">🔐 SC 帳號設定</div>
   <div class="employee-master-basicgrid">
    <label><span>* SC 登入帳號</span><input id="empLoginAccount" value="${esc(u.account||'')}" autocapitalize="none" ${ro}></label>
    <label><span>SC 密碼／重設密碼</span><input id="empNewPassword" type="password" placeholder="不修改可留空" ${ro}></label>
    <label><span>確認 SC 密碼</span><input id="empConfirmPassword" type="password" placeholder="再次輸入新密碼" ${ro}></label>
    <label><span>SC 帳號狀態</span><select id="empAccountStatus" ${ro}><option value="enabled" ${loginEnabled?'selected':''}>啟用</option><option value="disabled" ${loginEnabled?'':'selected'}>停用</option></select></label>
   </div>
   <div class="hint">SC 帳號密碼完全獨立；修改這裡不會改動 EOB。</div>
  </section>
  <section class="panel employee-master-section employee-auth-section" style="margin-top:14px">
   <div class="employee-master-title">📱 EOB 帳號設定</div>
   <div class="employee-master-basicgrid">
    <label><span>EOB 登入帳號</span><input id="empEobAccount" value="${esc(eobAccountOf(u))}" autocapitalize="none" ${ro}></label>
    <label><span>EOB Email</span><input id="empEobEmail" type="email" value="${esc(eobEmailOf(u))}" ${ro}></label>
    ${isFounderSelf(currentUser(),u)?'<label><span>目前 EOB 管理密碼</span><input id="empEobCurrentPassword" type="password" placeholder="僅首次授權／授權失效時需要" autocomplete="current-password" '+ro+'></label>':''}
    <label><span>EOB 密碼／重設密碼</span><input id="empEobPassword" type="password" placeholder="不修改可留空" ${ro}></label>
    <label><span>確認 EOB 密碼</span><input id="empEobConfirm" type="password" placeholder="再次輸入 EOB 密碼" ${ro}></label>
    <label><span>EOB 帳號狀態</span><select id="empEobStatus" ${ro}><option value="enabled" ${u.eobLoginEnabled!==false?'selected':''}>啟用</option><option value="disabled" ${u.eobLoginEnabled===false?'selected':''}>停用</option></select></label>
   </div>
   <div class="notice" style="margin-top:10px">SC 與 EOB 帳密互相獨立；你可以把兩邊都設成 01、密碼也設一樣，但之後可各自自由修改。SC 儲存 EOB 設定／權限後仍會自動同步 Supabase。</div>
   <div class="hint">店舖人員權限由「人事作業 → 權限設定」管理；盤點人員的 EOB 盤點、盤點人員專用、盤點資料上傳總部由創辦人在「店務管理 → 盤點人員權限設定」管理。</div>
  </section>
  <div class="employee-master-actions">${canEdit?'<button class="primary" data-action="employee-master-save">儲存員工資料</button>':''}<button class="button" data-employee-credentials="${esc(u.id)}">快速重設帳密</button></div>
 </div>`;
}

function stocktakePersonnelPage(){
 if(!isHeadOffice())return `<div class="page-head"><h2>盤點人員基本資料</h2></div><div class="panel"><p>此功能只有總店可使用。</p></div>`;
 const rows=stocktakePersonnelEmployees();
 return `<div class="page-head"><div><h2>盤點人員基本資料</h2><small>由總店建立；建立後可在所有店舖登入。盤點人員相關權限只有創辦人可以在「店務管理 → 盤點人員權限設定」設定。</small></div><div class="toolbar"><button class="button" data-nav="employees">← 返回人員基本資料</button><button class="button" data-nav="stocktake-tm-permissions">盤點人員 TM權限</button><button class="primary" data-action="new-stocktake-personnel">＋ 新增盤點人員</button></div></div>
 <section class="panel table-wrap"><table class="table"><thead><tr><th>姓名</th><th>帳號</th><th>身分</th><th>狀態</th><th>跨店登入</th><th>EOB盤點</th><th>盤點人員專用</th><th>上傳總部</th><th>操作</th></tr></thead><tbody>${rows.map(u=>{const pm=userPermissions(u);return `<tr><td>${esc(u.name||'')}</td><td>${esc(u.account||'')}</td><td>盤點人員</td><td>${u.active===false?'停用':'啟用'}</td><td>全店</td><td>${pm.eobStocktake?'開啟':'關閉'}</td><td>${pm.eobStocktakePersonnel?'開啟':'關閉'}</td><td>${pm.stocktakeUploadHeadOffice?'開啟':'關閉'}</td><td><button class="button" data-employee-settings="${esc(u.id)}">設定</button> <button class="button" data-action="stocktake-personnel-permissions" data-person-id="${esc(u.id)}">盤點人員權限設定</button></td></tr>`}).join('')||'<tr><td colspan="9">尚無盤點人員資料</td></tr>'}</tbody></table></section>`;
}


function specialPersonnelMeta(kind){return kind==='engineer'?{label:'工程師',flag:'isEngineerPersonnel',page:'engineer-personnel',permPage:'engineer-personnel-permissions'}:{label:'總部人員',flag:'isHeadOfficePersonnel',page:'hq-personnel',permPage:'hq-personnel-permissions'}}
const SPECIAL_TM_PERMISSION_ITEMS={
 posAccess:'進入 TM',posCheckout:'結帳',posDiscount:'折扣',posManualPrice:'手動改價',
 posCancel:'取消交易',manualClose:'手動日結',attendanceClock:'打卡',productLookup:'商品查詢',
 memberLookup:'會員查詢',transactionPrint:'列印交易',wasteCreate:'廢棄登錄',timeLookup:'時控查詢',
 deposit:'投庫',handover:'交班',logisticsSign:'物流簽到',transferInPos:'轉貨單轉入',
 tmReadAccount:'TM 讀帳',tmDonation:'TM 零錢捐'
};
function specialTmPersonnelMeta(kind){
 if(kind==='stocktake')return {label:'盤點人員',page:'stocktake-personnel',rows:stocktakePersonnelEmployees()};
 if(kind==='engineer')return {label:'工程師',page:'engineer-personnel',rows:engineerPersonnelEmployees()};
 return {label:'總部人員',page:'hq-personnel',rows:headOfficePersonnelEmployees()};
}
const HQ_SPECIAL_TM_PERMISSIONS_KEY='yj_hq_special_tm_permissions';
function hqSpecialTmPermissionMap(){
 const all=permissionStore(),out={};
 const people=[...stocktakePersonnelEmployees(),...engineerPersonnelEmployees(),...headOfficePersonnelEmployees()];
 for(const u of people){
  const src=all[u.id]||{},row={};
  for(const key of Object.keys(SPECIAL_TM_PERMISSION_ITEMS))row[key]=src[key]===true;
  row.employeeCode=String(u.employeeCode||u.account||'');
  row.account=String(u.account||'');
  row.role=String(u.role||'');
  out[String(u.id)]=row;
 }
 return out;
}

function specialTmPermissionsPage(kind){
 const meta=specialTmPersonnelMeta(kind);
 if(!isHeadOffice()||!isFounder())return `<div class="page-head"><h2>${meta.label} TM 權限</h2></div><div class="panel"><p>此功能只有總店創辦人可以設定。</p></div>`;
 const all=permissionStore();
 const rows=meta.rows||[];
 const checks=u=>Object.entries(SPECIAL_TM_PERMISSION_ITEMS).map(([key,label])=>`<label style="display:flex;gap:8px;align-items:center;border:1px solid #eee;border-radius:10px;padding:10px"><input type="checkbox" data-special-tm-perm="${esc(key)}" ${(all[u.id]||{})[key]?'checked':''}>${esc(label)}</label>`).join('');
 return `<div class="page-head"><div><h2>${meta.label} TM 權限</h2><small>${meta.label}由總部建檔，可跨店使用 TM；實際 TM 功能由創辦人逐項開啟。</small></div><div class="toolbar"><button class="button" data-nav="permissions">← 返回權限設定</button><button class="button" data-nav="${meta.page}">${meta.label}基本資料</button></div></div><section class="panel">${rows.map(u=>`<div data-special-tm-row="${esc(u.id)}" data-special-tm-kind="${esc(kind)}" style="border:1px solid #ddd;border-radius:14px;padding:14px;margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b style="font-size:18px">${esc(u.name||'')}</b><small style="display:block">員工編號：${esc(u.employeeCode||u.account||'—')}｜帳號：${esc(u.account||'')}</small></div><button class="primary" data-action="save-special-tm-permissions" data-person-id="${esc(u.id)}" data-special-tm-kind="${esc(kind)}">儲存 TM 權限</button></div><h3 style="margin:14px 0 8px">TM 權限</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px">${checks(u)}</div></div>`).join('')||`<p>尚無${meta.label}資料</p>`}</section>`;
}
function specialPersonnelPage(kind){
 const meta=specialPersonnelMeta(kind);
 if(!isHeadOffice()||!isFounder())return `<div class="page-head"><h2>${meta.label}基本資料</h2></div><div class="panel"><p>此功能只有總店創辦人可以設定。</p></div>`;
 const rows=specialPersonnelEmployees(kind);
 return `<div class="page-head"><div><h2>${meta.label}基本資料</h2><small>由總部建檔，可跨店登入、操作與打卡；權限僅由創辦人設定。</small></div><div class="toolbar"><button class="button" data-nav="employees">← 返回人員基本資料</button><button class="button" data-nav="${meta.permPage}">${meta.label}權限設定</button><button class="button" data-nav="${kind==='engineer'?'engineer-tm-permissions':'hq-tm-permissions'}">${meta.label} TM權限</button><button class="primary" data-action="new-special-personnel" data-special-kind="${kind}">＋ 新增${meta.label}</button><button class="button" data-update="POS">下傳 TM</button><button class="button" data-update-sc="employees">下傳 SC</button></div></div>
 <section class="panel table-wrap"><table class="table"><thead><tr><th>姓名</th><th>員工編號</th><th>帳號</th><th>身分</th><th>狀態</th><th>跨店</th><th>EOB</th><th>操作</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.name||'')}</td><td>${esc(u.employeeCode||u.account||'—')}</td><td>${esc(u.account||'')}</td><td>${meta.label}</td><td>${u.active===false?'停用':'啟用'}</td><td>全店</td><td>${u.eobLoginEnabled!==false?'啟用':'停用'}</td><td><button class="button" data-employee-settings="${esc(u.id)}">設定</button> <button class="button" data-nav="${meta.permPage}">權限設定</button> <button class="button" data-print-employee-number="${esc(u.id)}">列印員工編號</button></td></tr>`).join('')||`<tr><td colspan="8">尚無${meta.label}資料</td></tr>`}</tbody></table></section>`;
}
function specialPersonnelPermissionsPage(kind){
 const meta=specialPersonnelMeta(kind);
 if(!isHeadOffice()||!isFounder())return `<div class="page-head"><h2>${meta.label}權限設定</h2></div><div class="panel"><p>此功能只有總店創辦人可以設定。</p></div>`;
 const rows=specialPersonnelEmployees(kind),all=permissionStore();
 const categoryHtml=u=>{
  const standard=Object.entries(PERMISSION_CATEGORIES).map(([cat,c])=>`<fieldset style="border:1px solid #ead7c7;border-radius:12px;padding:10px"><legend><b>${esc(c.icon||'')} ${esc(c.label)}</b></legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">${Object.entries(c.items).map(([key,label])=>`<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" data-special-perm="${esc(key)}" ${(all[u.id]||{})[key]?'checked':''}>${esc(label)}</label>`).join('')}</div></fieldset>`).join('');
  const appPerm=`<fieldset style="border:1px solid #f0b37d;border-radius:12px;padding:10px;background:#fffaf6"><legend><b>📱 App 後台</b></legend><label style="display:flex;gap:7px;align-items:center"><input type="checkbox" data-special-perm="appSettingsAccess" ${(all[u.id]||{}).appSettingsAccess?'checked':''}>App設定（僅總部 SC）</label><small style="display:block;margin-top:6px">只有創辦人可授權；開啟後此${esc(meta.label)}可進入 TM 面板、自助模式面板與 App 後台設定。</small></fieldset>`;
  return standard+appPerm;
 };
 return `<div class="page-head"><div><h2>${meta.label}權限設定</h2><small>${meta.label}為總部獨立人員；可跨店登入與打卡，實際可操作功能依創辦人勾選權限。</small></div><div class="toolbar"><button class="button" data-nav="${meta.page}">← 返回${meta.label}基本資料</button></div></div><section class="panel">${rows.map(u=>`<div data-special-perm-row="${esc(u.id)}" data-special-kind="${kind}" style="border:1px solid #ddd;border-radius:14px;padding:14px;margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b style="font-size:18px">${esc(u.name||'')}</b><small style="display:block">員工編號：${esc(u.employeeCode||u.account||'—')}｜帳號：${esc(u.account||'')}</small></div><button class="primary" data-action="save-special-personnel-permissions" data-person-id="${esc(u.id)}" data-special-kind="${kind}">儲存權限</button></div><div style="display:grid;gap:10px;margin-top:12px">${categoryHtml(u)}</div></div>`).join('')||`<p>尚無${meta.label}資料</p>`}</section>`;
}

function faceCardUnitLabel(p){
 const raw=String(p?.unit||p?.salesUnit||p?.packageUnit||'').trim();
 return raw||'個';
}
function faceCardNameLines(name){
 const s=String(name||'未命名商品').trim();
 const m=s.match(/^(.*?)(\d+(?:\.\d+)?\s*(?:ml|mL|ML|L|g|G|kg|KG|入|包|瓶|罐|盒|個))$/);
 return m?[m[1].trim(),m[2].replace(/\s+/g,'')]:[s,''];
}
function printFaceCards(rows){
 rows=(Array.isArray(rows)?rows:[]).filter(Boolean);
 if(!rows.length)return alert('沒有可列印的 FACE 卡資料');
 const expanded=[];
 for(const p of rows){const qty=faceCardQty(p.id);for(let i=0;i<qty;i++)expanded.push(p);}
 if(!expanded.length)return alert('列印張數必須至少 1 張');
 const pages=[];for(let i=0;i<expanded.length;i+=42)pages.push(expanded.slice(i,i+42));
 const cardHtml=p=>{const code=productBarcodes(p)[0]||'',parts=faceCardNameLines(p.name),unit=faceCardUnitLabel(p);return `<section class="face-card-print-item"><div class="face-card-product"><div class="face-card-brand">億家</div><div class="face-card-name">${esc(parts[0])}</div>${parts[1]?`<div class="face-card-size">${esc(parts[1])}</div>`:''}</div><div class="face-card-price"><strong>${Number(p.price||0)}</strong><span>元／${esc(unit)}</span></div><div class="face-card-barcode">${labelBarcodeHtml(code,{height:35,moduleWidth:1.08})}</div></section>`;};
 const pageHtml=pages.map((page,pi)=>`<section class="face-a4-page"><div class="face-a4-grid">${page.map(cardHtml).join('')}${Array.from({length:42-page.length},()=>'<section class="face-card-print-item face-card-empty"><div class="face-card-price"></div></section>').join('')}</div><div class="face-page-no no-print">第 ${pi+1}/${pages.length} 頁</div></section>`).join('');
 const w=window.open('','_blank');
 if(!w)return alert('瀏覽器阻擋列印視窗，請允許彈出式視窗');
 w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>FACE卡列印</title><style>@page{size:A4 landscape;margin:5mm}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;color:#000;background:#eee;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.print-toolbar{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#fff;position:sticky;top:0;z-index:5;border-bottom:1px solid #ccc}.print-toolbar button{padding:9px 15px}.print-toolbar b{margin-left:auto}.face-a4-page{width:287mm;height:200mm;margin:8mm auto;background:#fff;position:relative;break-after:page;page-break-after:always;overflow:hidden}.face-a4-page:last-of-type{break-after:auto;page-break-after:auto}.face-a4-grid{width:100%;height:100%;display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(7,1fr);gap:0}.face-card-print-item{position:relative;overflow:hidden;background:#fff200;border:.35mm solid #fff;padding:2.1mm 1.9mm 1.5mm;min-width:0;min-height:0}.face-card-product{position:absolute;left:2.2mm;top:2mm;right:19mm;bottom:10.5mm;overflow:hidden}.face-card-brand{font-size:3.3mm;font-weight:900;line-height:1.05}.face-card-name{font-size:3.4mm;font-weight:900;line-height:1.1;margin-top:.8mm;max-height:8mm;overflow:hidden}.face-card-size{font-size:3.2mm;font-weight:800;line-height:1.05;margin-top:.7mm}.face-card-price{position:absolute;right:1.4mm;top:1.2mm;width:18mm;height:12.5mm;background:#ff9933;border-radius:1.5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:.95}.face-card-price strong{font-size:8mm;font-weight:900}.face-card-price span{font-size:2.7mm;font-weight:800;margin-top:.7mm;white-space:nowrap;align-self:flex-end;padding-right:1mm}.face-card-barcode{position:absolute;left:.15mm;right:.15mm;bottom:1.25mm;height:8.6mm;overflow:visible;display:flex;align-items:flex-end;justify-content:center}.face-card-barcode svg{display:block;max-width:none;width:108%!important;height:8.4mm!important;background:transparent!important;transform:scaleX(1.04);transform-origin:center bottom}.face-card-barcode svg>rect:first-child{fill:transparent!important}.face-card-empty .face-card-price{display:block}.face-page-no{position:absolute;right:2mm;bottom:1mm;font-size:10px;background:rgba(255,255,255,.8);padding:1px 4px}@media print{html,body{background:#fff}.no-print,.print-toolbar{display:none!important}.face-a4-page{margin:0;width:287mm;height:200mm}}</style></head><body><div class="print-toolbar no-print"><button onclick="window.close()">← 返回</button><button onclick="window.print()">🖨️ 列印</button><span>A4 橫式｜6 × 7＝每頁 42 張</span><b>共 ${expanded.length} 張｜${pages.length} 頁</b></div>${pageHtml}</body></html>`);
 w.document.close();
}

function printEmployeeBadge(u){
 const title=esc(u.badgeTitle||u.position||u.role||'員工');
 const name=esc(u.name||'');
 const w=window.open('','_blank');
 if(!w)return alert('瀏覽器阻擋名牌列印視窗，請允許彈出式視窗');
 w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>名牌 ${name}</title><style>
 @page{size:86mm 54mm;margin:0}
 *{box-sizing:border-box}
 html,body{margin:0;padding:0;background:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
 .toolbar{display:flex;gap:10px;padding:10px;background:#fff;position:sticky;top:0;z-index:5;border-bottom:1px solid #ccc}
 .toolbar button{padding:8px 14px;font-size:14px}
 .badge-page{width:86mm;height:54mm;margin:12mm auto;background:#caffcf;position:relative;overflow:hidden;color:#111}
 .badge-watermark{position:absolute;left:14mm;top:4mm;font-size:26mm;line-height:1;font-weight:700;letter-spacing:-1.5mm;color:rgba(255,244,176,.28);white-space:nowrap;z-index:0;pointer-events:none}
 .badge-title{position:absolute;left:2.8mm;top:2.4mm;z-index:2;font-size:6.2mm;line-height:1.05;font-weight:500;white-space:nowrap}
 .badge-name{position:absolute;left:0;right:0;top:13.5mm;z-index:2;text-align:center;font-size:23mm;line-height:1;font-weight:400;letter-spacing:-.7mm;white-space:nowrap;overflow:hidden;text-overflow:clip;padding:0 2mm}
 @media print{html,body{background:#fff}.toolbar{display:none!important}.badge-page{margin:0;width:86mm;height:54mm}}
 </style></head><body><div class="toolbar"><button onclick="window.close()">← 返回</button><button onclick="window.print()">🖨️ 列印</button></div><section class="badge-page"><div class="badge-watermark">Yijia</div><div class="badge-title">${title}</div><div class="badge-name">${name}</div></section></body></html>`);
 w.document.close();
 saveAudit('名牌列印',`${u.name||''}｜${u.employeeCode||u.account||''}`);
}

function printEmployeeNumber(u){
 const code=String(u?.employeeCode||u?.account||'').trim();
 if(!u)return alert('找不到員工基本資料');
 if(!code)return alert('此員工尚未設定員工編號');
 const name=esc(u.name||'');
 const role=esc(u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員'?'盤點人員':(u.position||u.role||'員工'));
 const w=window.open('','_blank');
 if(!w)return alert('瀏覽器阻擋員工編號列印視窗，請允許彈出式視窗');
 const barcode=labelBarcodeHtml(code,{height:72,moduleWidth:1.5});
 w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>員工編號 ${esc(code)}</title><style>
 @page{size:86mm 54mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#ececec;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.toolbar{display:flex;gap:10px;padding:10px;background:#fff;position:sticky;top:0;border-bottom:1px solid #ccc}.toolbar button{padding:8px 14px}.card{width:86mm;height:54mm;margin:12mm auto;background:#fff;padding:5mm 6mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}.brand{font-size:4mm;font-weight:900;color:#087942}.name{margin-top:1.5mm;font-size:6mm;font-weight:900}.role{font-size:3.2mm;margin-top:.7mm}.barcode{width:72mm;margin-top:2.5mm}.code{font-size:4.2mm;font-weight:900;letter-spacing:.7mm;margin-top:1mm}.label{font-size:3mm;margin-top:.5mm;color:#555}@media print{html,body{background:#fff}.toolbar{display:none!important}.card{margin:0}}
 </style></head><body><div class="toolbar"><button onclick="window.close()">← 返回</button><button onclick="window.print()">🖨️ 列印</button></div><section class="card"><div class="brand">億家 Yijia</div><div class="name">${name}</div><div class="role">${role}</div><div class="barcode">${barcode}</div><div class="code">${esc(code)}</div><div class="label">員工編號</div></section></body></html>`);
 w.document.close();
 saveAudit('列印員工編號',`${u.name||''}｜${code}`);
}

let SC_PERMISSION_DIRECTORY={
 '100000':{label:'訂購業務',children:{'110000':{label:'訂購作業',items:[['111000','台帳訂購','orderLedger'],['112000','FOS鮮食訂購','orderFos'],['113000','用度品訂購','orderSupplies'],['114000','特殊品訂購','orderSpecial'],['115000','品群訂購','orderGroup'],['116000','EOB訂購','eobOrder']]}}},
 '200000':{label:'營收業務',children:{'210000':{label:'營收作業',items:[['211000','營收管理','revenueAccess'],['212000','交易存根','transactionBackAccess'],['213000','營收修正','revenueCorrect']]}}},
 '300000':{label:'分析業務',children:{'310000':{label:'營運分析',items:[['311000','日銷售時間帶速報','operationsAccess'],['312000','會員分析','memberLookup']]}}},
 '400000':{label:'庫存業務',children:{'410000':{label:'進貨作業',items:[['411000','配送書確認驗收','logisticsCreate'],['413000','巡迴進貨','patrolReceiving'],['415000','EC驗收修改','ecAccess'],['416000','EC進店驗收刷','ecAccess'],['417000','EOB進店箱驗收','eobReceiving']]},'420000':{label:'退貨作業',items:[['421000','下架商品退貨','eobReturn'],['422000','不良品／空箱瓶退貨','eobReturn'],['423000','巡迴退貨','patrolReturn']]},'430000':{label:'轉貨作業',items:[['431000','轉出','transferOut'],['432000','轉入','transferIn']]},'440000':{label:'變價作業',items:[['441000','變價下傳收銀機','productPrice']]},'450000':{label:'廢棄作業',items:[['451000','廢棄','qualityWasteCreate']]},'460000':{label:'存貨盤點作業',items:[['461000','SC盤點','scStocktake']]},'480000':{label:'服務性商品',items:[['481000','EC商品查詢','ecAccess']]},'490000':{label:'庫存查詢',items:[['491000','庫存查詢','productsAccess']]},'4A0000':{label:'巡迴報紙驗收',items:[['4A1000','巡迴報紙驗收','newspaperReceiving']]}}},
 '500000':{label:'店務管理',children:{'510000':{label:'一般店務',items:[['511000','門市管理','storesAccess'],['512000','行動 POS','mobilePosAccess'],['513000','EOB驗收','eobReceiving'],['514000','EOB非 EC 退貨','eobReturn']]}}},
 '700000':{label:'營運報表',children:{'710000':{label:'營運六表',items:[['711000','商品A報','reportPrint'],['712000','商品B報','reportPrint'],['713000','匯款金額','reportPrint']]}}},
 '800000':{label:'人事作業',children:{'810000':{label:'人員管理作業',items:[['811000','人員基本資料','employeesAccess'],['812000','權限設定','permissionsAccess'],['813000','出勤管理','attendanceAccess']]}}},
 '900000':{label:'通報與調查',children:{'910000':{label:'通報管理',items:[['911000','通報內容檢視','auditAccess'],['912000','教育訓練','auditAccess'],['913000','設備報修維修','auditAccess']]}}}
};
const SC_HOME_GROUP_CODES={
 '訂購業務':'100000','營收業務':'200000','分析業務':'300000','庫存業務':'400000',
 '店務管理':'500000','營運報表':'700000','人事作業':'800000','通報與調查':'900000'
};
function scHomeGroupAllowed(label,u=currentUser()){
 if(!u)return false;
 if(u.role==='創辦人')return true;
 const code=SC_HOME_GROUP_CODES[String(label||'')];if(!code)return true;
 const stored=load(K.permissions,{})[u.id];
 if(stored&&Object.prototype.hasOwnProperty.call(stored,`__dir_l1_${code}`))return stored[`__dir_l1_${code}`]===true;
 // 舊資料尚未儲存第一層旗標時，依既有第三層權限推定，避免升級後整排選單消失。
 const effective=stored||userPermissions(u)||{};
 return scPermissionBranchKeys(1,code).some(k=>effective[k]===true);
}
let scPermissionTargetId='',scPermissionL1='100000',scPermissionL2='110000',scPermissionDraftTargetId='',scPermissionDraft=null;
function scPermissionTarget(){const rows=permissionTargetEmployees();return rows.find(x=>String(x.id)===String(scPermissionTargetId))||rows.find(x=>canManageTarget(currentUser(),x))||rows[0]||null}
function scPermissionDraftFor(target){
 if(!target)return {};
 if(String(scPermissionDraftTargetId)!==String(target.id)||!scPermissionDraft){
  const stored=load(K.permissions,{})[target.id]||{};
  scPermissionDraftTargetId=target.id;scPermissionDraft={...stored};
  delete scPermissionDraft.eobStocktake;
  delete scPermissionDraft.eobStocktakePersonnel;
  delete scPermissionDraft.stocktakeUploadHeadOffice;
  // Alpha 4.00：向上補齊父層。既有資料若第三層已勾，第二層與第一層必須成立；
  // 第二層已勾時，第一層也必須成立。父層勾選不會反向自動勾子層。
  for(const [l1code,l1] of Object.entries(SC_PERMISSION_DIRECTORY)){
   let l1Required=false;
   for(const [l2code,l2] of Object.entries(l1.children||{})){
    const l2k=`__dir_l2_${l2code}`;
    const hasChild=(l2.items||[]).some(r=>scPermissionDraft[r[2]]===true);
    if(hasChild)scPermissionDraft[l2k]=true;
    if(scPermissionDraft[l2k]===true)l1Required=true;
   }
   if(l1Required)scPermissionDraft[`__dir_l1_${l1code}`]=true;
  }
 }
 return scPermissionDraft;
}
function scPermissionBranchKeys(level,code){
 const out=[];
 if(level===1){const l1=SC_PERMISSION_DIRECTORY[code];Object.values(l1?.children||{}).forEach(x=>(x.items||[]).forEach(row=>out.push(row[2])));}
 else {for(const l1 of Object.values(SC_PERMISSION_DIRECTORY)){const l2=l1.children?.[code];if(l2){(l2.items||[]).forEach(row=>out.push(row[2]));break;}}}
 return [...new Set(out)].filter(Boolean);
}
function scPermissionParentKey(level,code){return level===1?`__dir_l1_${code}`:`__dir_l2_${code}`}
function scPermissionL1ForL2(code){for(const [l1code,l1] of Object.entries(SC_PERMISSION_DIRECTORY))if(l1.children?.[code])return l1code;return ''}
function scPermissionBranchState(draft,level,code,target){
 const checked=draft[scPermissionParentKey(level,code)]===true;
 let disabled=!target||!canManageTarget(currentUser(),target);
 if(!disabled&&level===2){
  const l1code=scPermissionL1ForL2(code);
  disabled=draft[`__dir_l1_${l1code}`]!==true;
 }
 return {checked,partial:false,disabled};
}
function scPermissionSetBranch(level,code,checked){
 const target=scPermissionTarget();if(!target||!canManageTarget(currentUser(),target))return false;
 const draft=scPermissionDraftFor(target),pk=scPermissionParentKey(level,code);
 if(level===1){
  const l1=SC_PERMISSION_DIRECTORY[code];
  draft[pk]=!!checked;
  // Alpha 4.01：勾第一層時，先把其下第二／第三層全部勾上；之後仍可手動取消子層。
  // 取消第一層時，第二／第三層全部一併取消，避免殘留無效子權限。
  for(const [l2code,l2] of Object.entries(l1?.children||{})){
   draft[`__dir_l2_${l2code}`]=!!checked;
   for(const row of (l2.items||[]))draft[row[2]]=!!checked;
  }
  return true;
 }
 const l1code=scPermissionL1ForL2(code);
 // 第一層未勾選時，第二層不可勾選。
 if(checked&&draft[`__dir_l1_${l1code}`]!==true)return false;
 draft[pk]=!!checked;
 // 勾第二層時，先把該第二層所有第三層勾上；之後第三層仍可逐項取消。
 // 取消第二層時，該第二層所有第三層一併取消。
 for(const l1 of Object.values(SC_PERMISSION_DIRECTORY)){
  const l2=l1.children?.[code];
  if(l2){for(const row of (l2.items||[]))draft[row[2]]=!!checked;break;}
 }
 return true;
}
function scPermissionSetLeaf(key,checked){
 const target=scPermissionTarget();if(!target||!canManageTarget(currentUser(),target))return false;
 const draft=scPermissionDraftFor(target);
 let parentL1='',parentL2='';
 for(const [l1code,l1] of Object.entries(SC_PERMISSION_DIRECTORY)){
  for(const [l2code,l2] of Object.entries(l1.children||{})){
   if((l2.items||[]).some(row=>row[2]===key)){parentL1=l1code;parentL2=l2code;break;}
  }
  if(parentL2)break;
 }
 // 第三層只能在第一層＋第二層都已勾選時勾選；不再自動補父層。
 if(checked&&(draft[`__dir_l1_${parentL1}`]!==true||draft[`__dir_l2_${parentL2}`]!==true))return false;
 draft[key]=!!checked;
 return true;
}
function permissionsAdminPage(){
 const rows=permissionTargetEmployees(),target=scPermissionTarget();if(target)scPermissionTargetId=target.id;
 const l1=SC_PERMISSION_DIRECTORY[scPermissionL1]||SC_PERMISSION_DIRECTORY['100000'];const l2=l1.children?.[scPermissionL2]||Object.values(l1.children||{})[0]||{items:[]};
 const permissions=target?scPermissionDraftFor(target):{};
 const col1=Object.entries(SC_PERMISSION_DIRECTORY).map(([code,x],i)=>{const st=scPermissionBranchState(permissions,1,code,target);return `<div class="perm-dir-row perm-dir-group ${code===scPermissionL1?'active':''}"><input type="checkbox" data-perm-l1-toggle="${code}" ${st.checked?'checked':''} ${st.disabled?'disabled':''}><button type="button" class="perm-dir-select" data-perm-l1="${code}"><i>${i+1}</i><u>${code}</u><b>${esc(x.label)}</b></button></div>`}).join('');
 const col2=Object.entries(l1.children||{}).map(([code,x],i)=>{const st=scPermissionBranchState(permissions,2,code,target);return `<div class="perm-dir-row perm-dir-group ${code===scPermissionL2?'active':''}"><input type="checkbox" data-perm-l2-toggle="${code}" ${st.checked?'checked':''} ${st.disabled?'disabled':''}><button type="button" class="perm-dir-select" data-perm-l2="${code}"><i>${i+1}</i><u>${code}</u><b>${esc(x.label)}</b></button></div>`}).join('');
 const parentL1Checked=permissions[`__dir_l1_${scPermissionL1}`]===true;
 const parentL2Checked=permissions[`__dir_l2_${scPermissionL2}`]===true;
 const col3=(l2.items||[]).map(([code,label,key],i)=>{const checked=permissions[key]===true;const hqOnly=['eobStocktake','eobStocktakePersonnel','stocktakeUploadHeadOffice'].includes(key);const grant=canGrantPermission(currentUser(),key)&&(!hqOnly||isFounder());const disabled=!grant||!parentL1Checked||!parentL2Checked;return `<label class="perm-dir-row perm-dir-check ${disabled?'locked':''}"><input type="checkbox" data-perm-dir-key="${esc(key)}" ${checked?'checked':''} ${disabled?'disabled':''}><i>${i+1}</i><u>${code}</u><b>${esc(label)}</b>${hqOnly?'<em>僅創辦人可設定</em>':''}</label>`}).join('')||'<div class="perm-dir-empty">此層目前沒有細項</div>';
 return `<div class="page-head"><div><h2>權限設定</h2><small>階層規則：勾第一層會先全選其第二、第三層；勾第二層會先全選其第三層。子層可再手動取消；取消父層會一併取消其所有子層。第一層未勾時第二層不可勾，第二層未勾時第三層不可勾。</small></div><div class="toolbar">${isHeadOffice()&&isFounder()?'<button class="button" data-nav="stocktake-tm-permissions">盤點人員 TM權限</button><button class="button" data-nav="hq-tm-permissions">總部人員 TM權限</button><button class="button" data-nav="engineer-tm-permissions">工程師 TM權限</button><button class="button" data-nav="hq-personnel">總部人員</button><button class="button" data-nav="hq-personnel-permissions">總部權限</button><button class="button" data-nav="engineer-personnel">工程師人員</button><button class="button" data-nav="engineer-personnel-permissions">工程師權限</button>':''}<button class="button" data-nav="employees">← 返回</button><label>人員 <select id="permissionDirectoryTarget">${rows.map(u=>`<option value="${esc(u.id)}" ${target&&String(u.id)===String(target.id)?'selected':''}>${esc(u.name||u.account)}｜${esc(u.role||'')}</option>`).join('')}</select></label></div></div>
 <section class="panel permission-directory-page"><div class="permission-directory-tabs"><button class="active">SC選單設定</button><button disabled>SAT選單設定</button></div><div class="permission-directory-grid"><div><h3>第一層目錄</h3><div class="perm-dir-head"><span>#</span><span>代碼</span><span>選單名稱</span></div>${col1}</div><div><h3>第二層目錄</h3><div class="perm-dir-head"><span>#</span><span>代碼</span><span>選單名稱</span></div>${col2}</div><div><h3>第三層目錄</h3><div class="perm-dir-head"><span>#</span><span>代碼</span><span>選單名稱</span></div>${col3}</div></div><div class="modal-actions"><button class="primary" data-action="permission-directory-save" ${target?'':'disabled'}>儲存權限</button></div></section>${scPrebuildVisibilityAdminHtml()}`;
}
function stocktakePermissionsAdminPage(){
 if(!isHeadOffice())return `<div class="page-head"><h2>盤點人員權限設定</h2><button class="button" data-nav="stocktake-personnel">← 返回</button></div><div class="panel"><p>盤點人員權限只有總店可以查看。</p></div>`;
 if(!isFounder())return `<div class="page-head"><h2>盤點人員權限設定</h2><button class="button" data-nav="stocktake-personnel">← 返回</button></div><div class="panel"><p>盤點人員權限只有創辦人可以設定。</p></div>`;
 let rows=stocktakePermissionTargetEmployees();
 const focus=String(window.__yjStocktakePermissionFocus||'');
 if(focus)rows=[...rows].sort((a,b)=>String(a.id)===focus?-1:String(b.id)===focus?1:0);
 const all=permissionStore();
 return `<div class="page-head"><div><h2>盤點人員權限設定</h2><small>盤點人員為獨立角色，不使用 SC 首頁八大分類。僅設定盤點專用權限。</small></div><button class="button" data-nav="stocktake-personnel">← 返回</button></div>
 <section class="panel">${rows.map(u=>{const pm=all[u.id]||{};return `<div data-stocktake-perm-row="${esc(u.id)}" style="border:1px solid #ead7c7;border-radius:14px;padding:14px;margin-bottom:14px;${String(u.id)===focus?'outline:2px solid #ef9d45;outline-offset:2px;':''}"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><div><b style="font-size:18px">${esc(u.name||'')}</b><small style="display:block;color:#777">帳號：${esc(u.account||'')}</small></div><button class="primary" data-action="save-stocktake-person-permissions" data-person-id="${esc(u.id)}">儲存權限</button></div><h3 style="margin:8px 0">盤點專用權限</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px"><label style="display:flex;align-items:center;gap:8px;border:1px solid #eee;border-radius:10px;padding:12px"><input type="checkbox" data-stocktake-perm="eobStocktake" disabled>EOB盤點 <em style="color:#a66">🔒 盤點人員不可使用 SC 標準盤點</em></label><label style="display:flex;align-items:center;gap:8px;border:1px solid #eee;border-radius:10px;padding:12px"><input type="checkbox" data-stocktake-perm="eobStocktakePersonnel" ${pm.eobStocktakePersonnel?'checked':''}>盤點人員專用</label><label style="display:flex;align-items:center;gap:8px;border:1px solid #eee;border-radius:10px;padding:12px"><input type="checkbox" data-stocktake-perm="stocktakeUploadHeadOffice" ${pm.stocktakeUploadHeadOffice?'checked':''}>盤點資料上傳總部</label></div><p class="setting-hint">此三項不會開啟訂購／營收／分析／庫存／店務／報表／人事／通報等一般 SC 八大分類。</p></div>`}).join('')||'<p>尚無盤點人員基本資料</p>'}</section>`;
}

function attendancePairRows(includeStocktake=false){
 const raw=load(K.attendance,[]).filter(x=>includeStocktake?true:recordStoreCode(x)===currentStoreCode());
 const stockIds=new Set(stocktakePersonnelEmployees().map(x=>String(x.id)));
 const stockAccounts=new Set(stocktakePersonnelEmployees().map(x=>String(x.account||'').toLowerCase()));
 const isStock=x=>x.isStocktakePersonnel===true||stockIds.has(String(x.userId||''))||stockAccounts.has(String(x.userAccount||'').toLowerCase());
 const filtered=raw.filter(x=>includeStocktake?isStock(x):!isStock(x));
 const map=new Map();
 for(const x of filtered){
  const d=new Date(x.at||Date.now()),date=String(x.workDate||localDateKey(d)),user=String(x.user||x.userName||x.userAccount||'—');
  const key=`${x.userId||x.userAccount||user}|${date}|${recordStoreCode(x)}`;
  if(!map.has(key))map.set(key,{key,user,date,storeCode:recordStoreCode(x),signIn:null,signOut:null,source:[]});
  const row=map.get(key);row.source.push(x);
  const k=String(x.kind||'');
  if(/簽退|下班|退/.test(k)){if(!row.signOut||Date.parse(x.at)>Date.parse(row.signOut.at))row.signOut=x;}
  else {if(!row.signIn||Date.parse(x.at)<Date.parse(row.signIn.at))row.signIn=x;}
 }
 return [...map.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.user.localeCompare(b.user));
}
function attendanceTimeValue(x){return x?.at?new Date(x.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'—'}
function attendanceConfirmValue(x){const iso=x?.confirmedAt||x?.confirmAt||x?.at;return iso?new Date(iso).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):''}
function attendancePairMeta(r){
 const src=[...(r?.source||[])];
 const pick=(k)=>{const x=src.find(v=>v&&v[k]);return x?.[k]||''};
 const reason=String(pick('confirmReason')||pick('modifyReason')||'');
 return {
  confirmIn:pick('confirmedSignInAt')||attendanceConfirmValue(r?.signIn),
  confirmOut:pick('confirmedSignOutAt')||attendanceConfirmValue(r?.signOut),
  reason
 };
}
function attendanceRowsHtml(rows,editable){
 return rows.map((r,i)=>{const sin=r.signIn,sout=r.signOut,meta=attendancePairMeta(r),reason=String(meta.reason||'');const forgotten=/忘記打卡/.test(reason);const other=reason.replace(/(^|[、，,\s]*)忘記打卡([、，,\s]*|$)/g,'').trim();return `<tr data-attendance-pair="${esc(r.key)}"><td>${esc(r.user)}</td><td>${esc(r.date.replaceAll('-','/'))}</td><td>${attendanceTimeValue(sin)}</td><td>${attendanceTimeValue(sout)}</td><td><input type="time" data-att-confirm-in value="${esc(meta.confirmIn)}" ${editable?'':'disabled'}></td><td><input type="time" data-att-confirm-out value="${esc(meta.confirmOut)}" ${editable?'':'disabled'}></td><td><label class="attendance-reason-check"><input type="checkbox" data-att-forgotten ${forgotten?'checked':''} ${editable?'':'disabled'}>忘記打卡</label><input data-att-other placeholder="其他" value="${esc(other)}" ${editable?'':'disabled'}></td></tr>`}).join('')||'<tr><td colspan="7">目前沒有出勤紀錄</td></tr>';
}
function attendanceAdminPage(){
 const stockMode=String(sessionStorage.getItem('yj_attendance_mode')||'store')==='stocktake';
 if(stockMode&&(!isHeadOffice()||!isFounder()))sessionStorage.setItem('yj_attendance_mode','store');
 const mode=String(sessionStorage.getItem('yj_attendance_mode')||'store');
 const isStock=mode==='stocktake';
 const editable=isStock?isHeadOffice()&&isFounder():hasPermission('attendanceEdit');
 const rows=attendancePairRows(isStock);
 return `<div class="page-head"><div><h2>每日工時處理</h2><small>${isStock?'盤點人員出勤管理｜總店／創辦人限定':'店舖人員｜實際簽到簽退不可修改；確認時間可修正'}</small></div><div class="toolbar"><button class="${!isStock?'primary':'button'}" data-action="attendance-mode-store">店舖人員</button>${isHeadOffice()&&isFounder()?`<button class="${isStock?'primary':'button'}" data-action="attendance-mode-stocktake">盤點人員出勤管理</button>`:''}<button class="button" data-action="attendance-print">列印</button>${editable?'<button class="primary" data-action="attendance-save-confirm">儲存</button>':''}</div></div>
 <section class="panel table-wrap"><table class="table attendance-confirm-table"><thead><tr><th rowspan="2">員工</th><th rowspan="2">日期</th><th colspan="2">實際</th><th colspan="2">確認</th><th rowspan="2">原因</th></tr><tr><th>簽到</th><th>簽退</th><th>簽到</th><th>簽退</th></tr></thead><tbody>${attendanceRowsHtml(rows,editable)}</tbody></table></section>
 <div class="notice">實際簽到／簽退時間為原始打卡紀錄，不能修改。需要修正工時計算時只修改「確認」時間；原因可勾選「忘記打卡」，「其他」可直接輸入。</div>`;
}
function noticeEditorRows(){return noticeRows()}
function noticeEditorPage(){
 if(!isFounder())return `<h2>通報編輯</h2><div class="panel"><p>只有創辦人帳號可以使用此功能。</p></div>`;
 const mode=String(window.__yjNoticeEditorMode||'new'),rows=noticeEditorRows();
 let selected=rows.find(x=>String(x.id)===String(window.__yjNoticeEditorSelected||''))||rows[0]||null;
 if(selected)window.__yjNoticeEditorSelected=selected.id;
 const selector=mode==='new'?'':`<label>選擇通報<select id="noticeEditorSelect">${rows.map(x=>`<option value="${esc(x.id)}" ${selected&&String(selected.id)===String(x.id)?'selected':''}>${rocDate(x.date)}｜${esc(x.subject||'')}</option>`).join('')}</select></label>`;
 const item=mode==='new'?{}:(selected||{});
 return `<div class="page-head"><div><h2>通報編輯</h2><small>創辦人限定｜新增、修改、刪除後與通報頁同步</small></div><button class="button" data-nav="stores">← 返回門市管理</button></div>
 <section class="panel notice-editor-page"><div class="notice-editor-tabs"><button class="${mode==='new'?'primary':'button'}" data-notice-editor-mode="new">新增</button><button class="${mode==='edit'?'primary':'button'}" data-notice-editor-mode="edit">修改</button><button class="${mode==='delete'?'primary danger':'button danger'}" data-notice-editor-mode="delete">刪除</button></div>
 ${selector}
 ${mode==='delete'?`<div class="notice-editor-delete-preview"><h3>${esc(item.subject||'尚無通報')}</h3><p>${esc(item.body||'')}</p><p>日期：${rocDate(item.date)}</p><button class="button danger" data-action="notice-editor-delete" ${selected?'':'disabled'}>確認刪除此通報</button></div>`:`<div class="notice-editor-form">
 <h3>通報基本資料</h3>
 <div class="settings-grid notice-editor-grid">
  <label>通報編號<input id="noticeEditorNo" value="${esc(noticeNo(item)||'')}" placeholder="例如 N115080166"></label>
  <label>通報日期<input id="noticeEditorDate" type="date" value="${esc(item.date||localDateKey())}"></label>
  <label>保存期限<input id="noticeEditorExpireDate" type="date" value="${esc(item.expireDate||'')}"></label>
  <label>類別<input id="noticeEditorCategory" value="${esc(item.category||'商品')}"></label>
  <label>發文單位<input id="noticeEditorDepartment" value="${esc(item.department||'')}" placeholder="例如 一般食品課"></label>
  <label>歸檔檔案<input id="noticeEditorArchiveName" value="${esc(item.archiveName||'一般通報')}"></label>
  <label>等級<select id="noticeEditorPriority"><option value="normal" ${String(item.priority||'normal')==='normal'?'selected':''}>一般</option><option value="urgent" ${String(item.priority)==='urgent'?'selected':''}>緊急</option></select></label>
  <label>負責 MD<input id="noticeEditorMd" value="${esc(item.responsibleMd||'')}" placeholder="例如 商品部／一般食品課"></label>
 </div>
 <label>通報主旨<input id="noticeEditorSubject" value="${esc(item.subject||'')}"></label>
 <div class="settings-grid notice-editor-grid">
  <label>開頭稱呼<input id="noticeEditorGreeting" value="${esc(item.greeting||'各位店長好：')}"></label>
  <label>醒目文字<input id="noticeEditorHighlight" value="${esc(item.highlight||'')}" placeholder="例如 全店收退作業"></label>
 </div>
 <label>通報內容<textarea id="noticeEditorBody" rows="8">${esc(item.body||'')}</textarea></label>
 <h3>商品明細</h3>
 <p class="setting-hint">圖片可填商品圖片網址；退貨區間會自動以黃底紅字顯示。</p>
 <div class="table-wrap"><table class="table notice-editor-products"><thead><tr><th>商品圖片</th><th>商品代號</th><th>商品名稱</th><th>售價</th><th>退貨區間</th><th>備註</th><th></th></tr></thead><tbody id="noticeEditorProductRows">${noticeEditorProductRowsHtml(item.products||[])}</tbody></table></div>
 <div class="toolbar"><button type="button" class="button" data-action="notice-product-add">＋ 新增商品</button><button class="primary" data-action="notice-editor-save">${mode==='new'?'新增通報':'儲存修改'}</button></div>
 </div>`}
 </section>`;
}
function employeeRoleOptions(selected=''){
 const actor=currentUser();
 if(selected==='創辦人')return '<option selected>創辦人</option>';
 const roles=actor?.role==='創辦人'
  ? ['店長','副店長','正職','兼職','總部支援']
  : ['副店長','正職','兼職'].filter(r=>(ROLE_RANK[r]||0)<(ROLE_RANK[actor?.role]||0));
 return roles.map(x=>`<option ${selected===x?'selected':''}>${x}</option>`).join('');
}

function validateEmployeeRoleChange(originalRole,newRole){
 const actor=currentUser();
 if(originalRole==='創辦人'||newRole==='創辦人'){
  alert('創辦人為系統最高權限角色，不能新增、修改、取消或變更');
  return false;
 }
 if(newRole==='總部支援'&&actor?.role!=='創辦人'){
  alert('只有創辦人可以建立或設定總部支援');
  return false;
 }
 if(originalRole==='總部支援'&&actor?.role!=='創辦人'){
  alert('只有創辦人可以修改總部支援人員');
  return false;
 }
 const originalRank=ROLE_RANK[originalRole]||0,newRank=ROLE_RANK[newRole]||0,actorRank=ROLE_RANK[actor?.role]||0;
 if(actor?.role!=='創辦人'&&(originalRank>=actorRank||newRank>=actorRank)){
  alert('不能修改同級或上級角色');
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
 const storedForTarget=all[target.id]||{};
 const current={...roleTemplate(target.role),...storedForTarget};
 if(categoryKey==='general'){
  if(!Object.prototype.hasOwnProperty.call(storedForTarget,'eobReceiving'))current.eobReceiving=target.role==='創辦人'||target.eobEnabled===true;
  if(!Object.prototype.hasOwnProperty.call(storedForTarget,'eobOrder'))current.eobOrder=target.role==='創辦人'||target.eobOrder===true;
  if(!Object.prototype.hasOwnProperty.call(storedForTarget,'eobReturn'))current.eobReturn=target.role==='創辦人'||target.eobReturn===true;
  if(!Object.prototype.hasOwnProperty.call(storedForTarget,'mobilePosAccess'))current.mobilePosAccess=target.role==='創辦人'||target.mobilePosEnabled===true;
 }

 dlg(`${category.label}－${target.name}`,`
  ${categoryKey==='general'?'<div class="notice" style="margin-bottom:12px">EOB 驗收＝允許登入行動 EOB 並執行驗收；訂購與非 EC 退貨為額外權限。行動 POS 為獨立權限。</div>':categoryKey==='stocktake'?'<div class="notice" style="margin-bottom:12px">盤點相關三項權限只有創辦人可以授予；儲存後會同步 EOB。</div>':''}
  <div class="permission-detail">
   ${Object.entries(category.items).map(([key,label])=>{
    const stocktakeTarget=target.isStocktakePersonnel===true||String(target.role||'')==='盤點人員'||String(target.employmentType||'')==='盤點人員';
    const blockedStandardStocktake=categoryKey==='stocktake'&&stocktakeTarget&&key==='eobStocktake';
    const grantable=canGrantPermission(currentUser(),key)&&!blockedStandardStocktake;
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
  throw new Error('不能修改同級或上級人員的權限');
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

 if(categoryKey==='stocktake'&&(target.isStocktakePersonnel===true||String(target.role||'')==='盤點人員'||String(target.employmentType||'')==='盤點人員'))next.eobStocktake=false;
 all[target.id]=next;
 save(K.permissions,all);

 if(categoryKey==='general'){
  const employeesRows=load(K.employees,[]),emp=employeesRows.find(x=>x.id===target.id);
  if(emp){
   const off=['離職','離店','停用'].includes(employeeEmploymentStatus(emp));
   const founder=emp.role==='創辦人';
   emp.eobEnabled=!off&&(founder||next.eobReceiving===true);
   emp.eobOrder=!off&&(founder||next.eobOrder===true);
   emp.eobReturn=!off&&(founder||next.eobReturn===true);
   emp.mobilePosEnabled=!off&&(founder||next.mobilePosAccess===true);
   save(K.employees,employeesRows);
  }
 }

 if(categoryKey==='stocktake'&&isFounder()&&cloudConfigured()){
  const actor=employees().find(x=>String(x.id)===String(currentUser()?.id));
  const callerAccount=String(actor?.account||currentUser()?.account||'').trim().toLowerCase();
  const callerPassword=String(actor?.password||'');
  if(callerAccount&&callerPassword&&target?.account){
   adminSyncStocktakeAccess({callerAccount,callerPassword,username:String(target.account||'').trim().toLowerCase(),canStocktake:!!next.eobStocktake,canPersonnel:!!next.eobStocktakePersonnel,canUploadHq:!!next.stocktakeUploadHeadOffice})
    .catch(err=>console.warn('盤點權限同步 EOB 失敗',err));
  }
 }

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
 render('employees');
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

function submitPosSearch(){
 const input=document.querySelector('#search');
 const q=String(input?.value||'').trim();
 if(!q)return;
 if(handleReturnCode(q)){if(input)input.value='';return}
 const byBarcode=products().find(x=>productBarcodes(x).includes(q));
 const byCode=products().find(x=>String(x.code||'')===q);
 const p=byBarcode||byCode;
 if(!p)return alert('找不到商品或退貨條碼');
 try{
  add(p.id,byBarcode?'barcode':'code');
  if(input)input.value='';
  drawPOS();
 }catch(err){alert(err.message)}
}


function printSaleDetail(sale){
 const corrected=(sale.items||[]).some(x=>Number(x.returnedQty||0)>0)||sale.status==='已更正'||sale.locked;
 const rows=(sale.items||[]).map(x=>{
  const returned=Number(x.returnedQty||0),remain=Math.max(0,Number(x.qty||0)-returned),changed=returned>0;
  const qtyText=changed?`${remain}${remain<=0?'（已退貨）':`（原 ${x.qty}，退 ${returned}）`}`:String(x.qty);
  const subtotal=Number(x.price||0)*remain;
  return `<tr${changed?' style="color:#c62828"':''}><td>${changed?`<span style="text-decoration:line-through">${esc(x.name)} ×${x.qty}</span><br><small>【交易更正】${remain<=0?'已退貨':`退貨 ×${returned}／更正後 ×${remain}`}</small>`:esc(x.name)}</td><td>${changed?remain:x.qty}</td><td>${money(x.price)}</td><td>${money(subtotal)}</td></tr>`;
 }).join('');
 const pay=(sale.paymentBreakdown||[]).map(x=>`${esc(x.method)} ${money(x.amount)}`).join('、')||esc(sale.payment||'');
 const currentTotal=saleNet(sale);
 const history=(sale.correctionHistory||[]).map(x=>`<p style="font-size:12px;margin:4px 0">${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.type)}｜${esc(x.reason||'')}${x.note?`｜${esc(x.note)}`:''}</p>`).join('');
 printHTML(corrected?'本筆交易明細（已更正）':'本筆交易明細',`<p>交易序號：${esc(sale.id)}</p><p>退貨條碼：${esc(sale.returnCode||makeReturnCode(sale.id))}</p>${autoBarcodeHtml(sale.returnCode||makeReturnCode(sale.id),{height:52,moduleWidth:1.5})}<p>交易時間：${new Date(sale.at).toLocaleString('zh-TW')}</p><p>收銀人員：${esc(sale.user||'')}</p><p>交易狀態：<b>${esc(sale.status||'正常')}</b></p><table style="width:100%"><thead><tr><th>商品</th><th>目前數量</th><th>單價</th><th>目前小計</th></tr></thead><tbody>${rows}</tbody></table>${corrected?`<p>原交易金額：${money(sale.total)}</p>`:''}<h3>目前應收 ${money(currentTotal)}</h3><p>付款：${pay}</p>${!corrected&&sale.cashAmount?`<p>客人付：${money(sale.tendered)}　找零：${money(sale.change)}</p>`:''}${sale.note?`<p>備註：${esc(sale.note)}</p>`:''}${history?`<hr><h4>更正紀錄</h4>${history}`:''}`);
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
 const total=totals().total;
 if(!state.cart.length)return alert('購物車是空的');
 const selected=state.payment||'現金';
 const mobileOptions=['億家 Pay','LINE Pay','Apple Pay','Google Pay','Samsung Wallet','全盈+PAY','街口支付','悠遊付','其他'];
 const storedOptions=['悠遊卡','一卡通','icash 2.0','其他'];
 const giftOptions=['億家禮物卡','電子禮物卡','其他'];

 dlg('POS 2.0 結帳',`
  <div class="checkout-amount"><small>本筆應收</small><strong>${money(total)}</strong></div>
  <label>付款方式<select id="checkoutMethod">${['現金','信用卡','行動支付','電子票證','禮物卡','混合付款'].map(x=>`<option ${selected===x?'selected':''}>${x}</option>`).join('')}</select></label>
  <div id="checkoutPaymentFields"></div>
  <label class="print-choice"><input id="printCurrentDetail" type="checkbox"><span><b>列印本筆交易明細</b><small>預設不列印；只列印這一筆完成的交易。</small></span></label>
  <button class="primary checkout-confirm" id="checkoutConfirm">確認付款並完成交易</button>`);

 setTimeout(()=>{
  const method=document.querySelector('#checkoutMethod');
  const fields=document.querySelector('#checkoutPaymentFields');
  const confirmBtn=document.querySelector('#checkoutConfirm');
  const renderFields=()=>{
   const m=method.value;state.payment=m;
   if(m==='現金'){
    fields.innerHTML=`<label>客人付<input id="cashTendered" type="number" min="0" inputmode="decimal" placeholder="輸入實收金額"></label><div class="quick-cash"><button type="button" data-cash-exact>收到剛好</button>${[100,500,1000,2000,3000,5000,10000].map(v=>`<button type="button" data-cash-quick="${v}">${v.toLocaleString('zh-TW')}</button>`).join('')}</div><div class="checkout-change"><span>找零</span><strong id="cashChange">${money(0)}</strong></div><div id="cashShortage" class="cash-shortage"></div>`;
    const input=document.querySelector('#cashTendered'),change=document.querySelector('#cashChange'),shortage=document.querySelector('#cashShortage');
    const calc=()=>{const paid=Number(input.value||0),diff=paid-total;change.textContent=money(Math.max(0,diff));shortage.textContent=paid>0&&diff<0?`尚差 ${money(Math.abs(diff))}`:'';};
    input.oninput=calc;fields.querySelector('[data-cash-exact]').onclick=()=>{input.value=total;calc()};fields.querySelectorAll('[data-cash-quick]').forEach(b=>b.onclick=()=>{input.value=b.dataset.cashQuick;calc()});setTimeout(()=>input.focus(),0);
   }else if(m==='行動支付')fields.innerHTML=`<label>行動支付<select id="paymentSubtype">${mobileOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><p class="payment-note">請在外部支付設備完成付款後，再按確認。</p>`;
   else if(m==='電子票證')fields.innerHTML=`<label>電子票證<select id="paymentSubtype">${storedOptions.map(x=>`<option>${x}</option>`).join('')}</select></label><p class="payment-note">請確認讀卡完成後再按確認。</p>`;
   else if(m==='禮物卡')fields.innerHTML=`<label>禮物卡<select id="paymentSubtype">${giftOptions.map(x=>`<option>${x}</option>`).join('')}</select></label>`;
   else if(m==='混合付款'){
    fields.innerHTML=`<label>現金金額<input id="mixedCash" type="number" min="0" max="${total}" value="0" inputmode="decimal"></label><label>其餘付款方式<select id="mixedMethod"><option>信用卡</option><option>行動支付</option><option>電子票證</option><option>禮物卡</option></select></label><div class="checkout-change"><span>其餘應付</span><strong id="mixedRemain">${money(total)}</strong></div><div id="mixedWarning" class="cash-shortage"></div>`;
    const cash=document.querySelector('#mixedCash'),remain=document.querySelector('#mixedRemain'),warn=document.querySelector('#mixedWarning');
    cash.oninput=()=>{const v=Number(cash.value||0);remain.textContent=money(Math.max(0,total-v));warn.textContent=v>total?'現金金額不可超過應收金額':''};
   }else fields.innerHTML='<p class="payment-note">請依刷卡機結果完成付款後，再按確認。</p>';
  };
  method.onchange=renderFields;renderFields();

  confirmBtn.onclick=async()=>{
   if(scDependentCart()&&!(await refreshScRuntimeState())){showScDisconnectedNotice('目前與 SC 斷開。EC 包裹可繼續查詢，但無法完成取貨結帳；繳帳單也暫時不能結帳。');return;}
   const m=method.value;let detail={method:m,cashAmount:0,nonCashAmount:0,tendered:0,change:0,subtype:'',breakdown:[],note:state.note||''};
   if(m==='現金'){
    const tendered=Number(document.querySelector('#cashTendered').value||0);if(tendered<total)return alert(`金額不足，尚差 ${money(total-tendered)}`);
    detail={...detail,cashAmount:total,tendered,change:tendered-total,breakdown:[{method:'現金',amount:total}]};
   }else if(m==='混合付款'){
    const cash=Number(document.querySelector('#mixedCash').value||0);if(cash<0||cash>total)return alert('混合付款的現金金額不可超過應收金額');
    const other=total-cash,otherMethod=document.querySelector('#mixedMethod').value;detail={...detail,cashAmount:cash,nonCashAmount:other,subtype:otherMethod,breakdown:[{method:'現金',amount:cash},{method:otherMethod,amount:other}]};
   }else{detail.nonCashAmount=total;detail.subtype=document.querySelector('#paymentSubtype')?.value||m;detail.breakdown=[{method:detail.subtype,amount:total}];}
   try{
    const shouldPrint=document.querySelector('#printCurrentDetail').checked;const sale=checkout(detail);genericDialog.close();drawPOS();
    if(shouldPrint)printSaleDetail(sale);
    alert(`結帳完成\n交易編號：${sale.id}\n應收：${money(sale.total)}${sale.change>0?`\n找零：${money(sale.change)}`:''}\n本筆明細：${shouldPrint?'已開啟列印':'未列印'}`);
   }catch(err){alert(err.message)}
  };
 },0);
}

function ecActionDialog(action=null,frontMode=false){
 const fixed=action;
 const labels={arrival:'進貨',pickup:'取件',leave:'離店'};
 dlg(fixed?`EC${labels[fixed]}`:'EC進離店',`
  ${fixed?'':`<label>作業類型<select id="ecActionType"><option value="arrival">進貨</option><option value="pickup">取件</option><option value="leave">離店</option></select></label>`}
  <label>包裹編號<div class="inline-field"><input id="ecActionNo" placeholder="輸入或掃描包裹編號"><button class="button" type="button" id="ecActionLookup">查詢</button></div></label>
  <div id="ecActionLookupResult" class="setting-hint">斷線時仍可查詢 EC 包裹；取貨結帳必須與 SC 連線。</div>
  <div id="ecLeaveReasonWrap" style="display:${fixed==='leave'?'block':'none'}"><label>離店原因<select id="ecLeaveReason"><option>退回物流</option><option>轉運</option><option>逾期未取</option><option>其他</option></select></label></div>
  <button class="primary" id="ecActionSave">確認</button>`);
 setTimeout(async()=>{
  const typeSel=document.querySelector('#ecActionType'),wrap=document.querySelector('#ecLeaveReasonWrap'),lookup=document.querySelector('#ecActionLookup'),result=document.querySelector('#ecActionLookupResult');
  if(typeSel)typeSel.onchange=()=>wrap.style.display=typeSel.value==='leave'?'block':'none';
  if(lookup)lookup.onclick=async()=>{
   const no=document.querySelector('#ecActionNo')?.value.trim()||'';if(!no)return alert('請輸入包裹編號');
   if(!cloudConfigured()){if(result)result.textContent='目前未設定雲端，無法查詢 EC 包裹。';return;}
   try{
    const rows=await adminListEcPackages({storeCode:currentStoreCode()});
    const x=(rows||[]).find(v=>String(v.package_no||'').trim()===no);
    if(result)result.innerHTML=x?`<b>${esc(x.recipient_name||'—')}</b>｜末三碼 ${esc(x.recipient_last3||'—')}｜${esc(ecCloudStatusLabels[x.status]||x.status||'—')}｜包裹 ${esc(x.package_no||no)}`:'查無此 EC 包裹';
   }catch(err){if(result)result.textContent=`查詢失敗：${err?.message||err}`;}
  };
  if(fixed==='pickup'&&!(await refreshScRuntimeState()))showScDisconnectedNotice();
  document.querySelector('#ecActionSave').onclick=async()=>{
   const no=document.querySelector('#ecActionNo').value.trim(),kind=fixed||(typeSel?.value||'arrival');
   if(!no)return alert('請輸入包裹編號');
   if(kind==='pickup'&&!(await refreshScRuntimeState())){showScDisconnectedNotice();return;}
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

function openSaleInCorrectionMode(sale){
 try{
  beginCorrectionMode(sale);
  state.cart=[];
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

function labelBarcodeHtml(code,opts={}){
 const html=autoBarcodeHtml(code,opts);
 return `<div style="width:100%;max-width:100%;overflow:hidden">${html.replace('<svg ','<svg style="max-width:100%;height:auto;display:block" ')}</div>`;
}
function ecRouteOptions(rows=[]){
 const known=[...new Set((rows||[]).map(x=>String(x.route_code||'').trim()).filter(Boolean))];
 const defaults=['北區','中區','南區','東區','離島'];
 return ['未設定',...known,...defaults.filter(x=>!known.includes(x))];
}
function logisticsSourceRefOptions(source,type,ecRows=[]){
 const blank='<option value="">無／不指定</option>';
 if(source==='manual')return blank;
 if(type==='ec'){
  const rows=(ecRows||[]).filter(x=>x.status==='expected'&&!String(x.inbound_batch_no||'').trim());
  const ambient=rows.filter(x=>x.temperature==='ambient').length;
  const frozen=rows.filter(x=>x.temperature==='frozen').length;
  const opts=[];
  if(ambient)opts.push(`<option value="__EC_GROUP__:ambient">EC 常溫｜待進店 ${ambient} 件</option>`);
  if(frozen)opts.push(`<option value="__EC_GROUP__:frozen">EC 冷凍｜待進店 ${frozen} 件</option>`);
  return blank+(opts.length?opts.join(''):'<option value="" disabled>目前沒有未歸類 EC 包裹</option>');
 }
 if(source==='backend'){
  const refs=load(K.orders,[]).map(x=>x.id).filter(Boolean);
  return blank+refs.map(x=>`<option value="${esc(x)}">訂購單｜${esc(x)}</option>`).join('');
 }
 return blank+'<option value="" disabled>目前沒有可選商城單號</option>';
}


const CASH_DENOMS=[1000,500,100,50,10,5,1];

function shiftRows(){return load(K.shifts,[])}
function xAccountRows(){
 const formal=load(K.xAccounts,[]);
 const handovers=load(K.handovers,[]);
 const formalKeys=new Set(formal.map(x=>String(x.shiftId||x.handoverId||x.id||'')));
 const mapped=handovers
  .filter(h=>!formalKeys.has(String(h.id||'')))
  .map((h,i)=>{
   const at=h.at||h.end||h.closedAt||new Date().toISOString();
   const d=new Date(at);
   const date=Number.isNaN(d.getTime())?localDateKey():localDateKey(d);
   const deposit=Number(h.depositAmount??h.totalAmount??0);
   const cash=Number(h.cashRevenue||0);
   const diff=Number(h.cashDifference??(deposit-cash));
   return {
    id:`HANDOVER-${h.id||i}`,
    handoverId:h.id||'',
    xNo:h.xNo||`POS-${String(h.id||Date.now()).slice(-6)}`,
    date,
    shiftId:h.shiftId||'',
    shiftType:h.shiftType||'POS交班',
    cashier:h.fromAccount||h.from||'—',
    cashierName:h.from||'',
    openedAt:h.start||h.openedAt||'',
    closedAt:h.end||h.at||h.closedAt||'',
    transactionCount:Number(h.transactionCount||0),
    net:Number(h.salesAmount??h.net??0),
    expectedCash:cash,
    countedCash:deposit,
    difference:diff,
    deposits:deposit,
    voidCount:Number(h.voidCount||0),
    source:'POS交班同步',
    status:'已完成',
    createdAt:h.at||h.end||new Date().toISOString()
   };
  });
 return [...formal,...mapped].sort((a,b)=>new Date(b.closedAt||b.createdAt||b.at||0)-new Date(a.closedAt||a.createdAt||a.at||0));
}

function nextXNo(dateStr=new Date().toISOString().slice(0,10)){
 const compact=dateStr.replaceAll('-','');
 const same=xAccountRows().filter(x=>x.date===dateStr);
 return `X${compact}-${String(same.length+1).padStart(4,'0')}`;
}

function shiftSales(shift){
 const start=new Date(shift.openedAt).getTime();
 const end=shift.closedAt?new Date(shift.closedAt).getTime():Date.now();
 return load(K.sales,[]).filter(s=>{
  const t=new Date(s.at).getTime();
  return t>=start&&t<=end;
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
 const gross=normal.reduce((sum,s)=>sum+Number(s.total||0),0);
 const net=normal.reduce((sum,s)=>sum+Number(typeof saleNet==='function'?saleNet(s):s.total||0),0);
 const pay=paymentBreakdownForSales(normal);
 const voided=sales.filter(s=>s.status==='已作廢').reduce((sum,s)=>sum+Number(s.total||0),0);
 const returned=sales.filter(s=>s.status==='已整筆退貨').reduce((sum,s)=>sum+Number(s.total||0),0);
 const corrected=sales.filter(s=>Array.isArray(s.corrections)&&s.corrections.length)
  .reduce((sum,s)=>sum+Math.max(0,Number(s.total||0)-Number(typeof saleNet==='function'?saleNet(s):s.total||0)),0);
 const deposits=load(K.deposits,[]).filter(d=>{
  const t=new Date(d.at).getTime();
  const start=new Date(shift.openedAt).getTime();
  const end=shift.closedAt?new Date(shift.closedAt).getTime():Date.now();
  return t>=start&&t<=end;
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

function currentOpenShift(){
 return shiftRows().find(x=>x.status==='開班中')||null;
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
   render('xaccount');
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
 return `<div class="page-head"><div><button class="button" data-nav="revenue">← 返回營收管理</button><h2 style="margin-top:10px">X帳／交班</h2></div><div class="toolbar">
  ${shift?`<button class="primary" data-action="close-shift">完成交班／X帳</button>`:''}
 </div></div>
 ${handoverCloudSummaryPanel()}
 ${shift?`<div class="panel shift-active"><h3>目前班次：${esc(shift.type)}</h3><p>${esc(shift.cashier)}｜${new Date(shift.openedAt).toLocaleString('zh-TW')} 開班</p></div>`:''}
 <div class="panel table-wrap" style="margin-top:14px"><table class="table">
  <tr><th>X帳號</th><th>日期</th><th>班別</th><th>收銀人員</th><th>淨營收</th><th>應有現金</th><th>實際現金</th><th>差額</th><th>來源</th><th>操作</th></tr>
  ${xs.map(x=>`<tr><td>${esc(x.xNo)}</td><td>${esc(x.date)}</td><td>${esc(x.shiftType)}</td><td>${esc(x.cashier)}</td><td>${money(x.net)}</td><td>${money(x.expectedCash)}</td><td>${money(x.countedCash)}</td><td class="${x.difference===0?'diff-ok':x.difference>0?'diff-over':'diff-short'}">${x.difference===0?'相符':x.difference>0?`+${money(x.difference)}`:`-${money(Math.abs(x.difference))}`}</td><td>${esc(x.source||'正式X帳')}</td><td>${x.source==='POS交班同步'?'—':`<button class="button" data-x-print="${x.id}">列印X帳</button>`}</td></tr>`).join('')||'<tr><td colspan="10">尚無X帳／交班資料</td></tr>'}
 </table></div>`;
}


function storeMetricsForDate(date=localDateKey()){
 const sales=load(K.sales,[]).filter(s=>{
  const d=new Date(s.at);
  return recordStoreCode(s)===currentStoreCode()&&!Number.isNaN(d.getTime())&&localDateKey(d)===date;
 });
 const valid=sales.filter(s=>!['已作廢','已整筆退貨','作廢'].includes(s.status));
 // 純 EC 服務交易不列商品日商；商品＋EC 混合交易仍以商品金額列日商。
 const isPureService=s=>s.serviceSale===true||((s.items||[]).length===0&&Number(s.serviceAmount||0)>0);
 const standard=valid.filter(s=>!isPureService(s));
 const net=s=>Number(typeof saleNet==='function'?saleNet(s):s.total||0);
 const revenue=standard.reduce((a,s)=>a+net(s),0);
 const customers=standard.length;
 // EC 金額／來客數獨立統計；混合交易中的 EC 也要算服務性。
 const serviceAmount=valid.reduce((a,s)=>a+Number(s.serviceAmount||0),0);
 const serviceCustomers=valid.filter(s=>Number(s.serviceAmount||0)>0).length;
 const member=standard.filter(s=>s.memberId||s.member||s.memberPhone||s.memberName);
 const memberRevenue=member.reduce((a,s)=>a+net(s),0);
 const cost=standard.reduce((sum,s)=>sum+(s.items||[]).reduce((a,i)=>
  a+Number(i.cost||0)*Math.max(0,Number(i.qty||0)-Number(i.returnedQty||0)),0),0);
 return {
  date,revenue,customers,avg:customers?Math.round(revenue/customers):0,
  memberRevenue,memberCustomers:member.length,
  memberAvg:member.length?Math.round(memberRevenue/member.length):0,
  memberRate:revenue?Math.round(memberRevenue/revenue*100):0,
  serviceAmount,serviceCustomers,
  cost,marginRate:revenue?((revenue-cost)/revenue*100):0
 };
}
function storeHomeMetrics(){
 // 首頁營收速報與營運情報共用 storeMetricsForDate()，避免兩邊算法不同。
 return storeMetricsForDate(localDateKey());
}
let operationsSelectedDate='';
function operationsDateKey(){
 return operationsSelectedDate||localDateKey();
}
function shiftLocalDate(date,delta){
 const [y,m,d]=String(date).split('-').map(Number);
 const x=new Date(y,m-1,d);x.setDate(x.getDate()+delta);
 return localDateKey(x);
}
function storeSwitchSelectHtml(extraClass=''){
 if(!hasPermission('storeSwitch'))return '';
 const rows=load(K.stores,[]).filter(x=>x.active!==false);
 const current=currentStoreCode();
 return `<label class="store-switch-inline ${extraClass}"><span>店號</span><select data-store-switch-select aria-label="切換門市">${rows.map(x=>`<option value="${esc(x.code)}" ${String(x.code)===current?'selected':''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select></label>`;
}
async function switchStoreDirect(code,selectEl){
 if(!hasPermission('storeSwitch'))return;
 const rows=load(K.stores,[]).filter(x=>x.active!==false),current=currentStoreCode();
 const target=rows.find(x=>String(x.code)===String(code));
 if(!target){if(selectEl)selectEl.value=current;return alert('找不到門市');}
 if(String(target.code)===current)return;
 const returnPage=currentAdminPage()||'home';
 if(selectEl)selectEl.disabled=true;
 if(!setCurrentStore(target)){if(selectEl){selectEl.disabled=false;selectEl.value=current;}return alert('門市切換失敗，請再試一次');}
 if(cloudConfigured()){
  try{await cloudPullAll();}
  catch(err){const old=rows.find(x=>String(x.code)===String(current));if(old)setCurrentStore(old);if(selectEl){selectEl.disabled=false;selectEl.value=current;}return alert('切換門市雲端資料載入失敗，已返回原門市：'+String(err?.message||err));}
 }
 saveAudit('切換門市',`${current}→${target.code} ${target.name}`);
 render(returnPage);
}
function bindStoreSwitchSelect(root=document){
 root.querySelectorAll('[data-store-switch-select]').forEach(sel=>sel.addEventListener('change',()=>switchStoreDirect(sel.value,sel)));
}
function operationsHourlyRows(date=operationsDateKey()){
 const sales=load(K.sales,[]).filter(s=>{const d=new Date(s.at);return recordStoreCode(s)===currentStoreCode()&&!Number.isNaN(d.getTime())&&localDateKey(d)===date&&!['已作廢','已整筆退貨','作廢'].includes(s.status)});
 const isPureService=s=>s.serviceSale===true||((s.items||[]).length===0&&Number(s.serviceAmount||0)>0);
 const net=s=>Number(typeof saleNet==='function'?saleNet(s):s.total||0);
 const today=localDateKey(),currentHour=new Date().getHours(),isToday=String(date)===String(today);
 let amountCum=0,custCum=0,svcCum=0;
 return Array.from({length:24},(_,h)=>{
  // 當日只顯示到目前時段；尚未到的時間帶與累計全部為 0。
  if(isToday&&h>currentHour)return {hour:h,amount:0,amountCum:0,customers:0,custCum:0,avg:0,serviceCustomers:0,svcCum:0};
  const rows=sales.filter(s=>new Date(s.at).getHours()===h),standard=rows.filter(s=>!isPureService(s));
  const amount=standard.reduce((a,x)=>a+net(x),0),customers=standard.length,serviceCustomers=rows.filter(x=>Number(x.serviceAmount||0)>0).length;
  amountCum+=amount;custCum+=customers;svcCum+=serviceCustomers;
  return {hour:h,amount,amountCum,customers,custCum,avg:customers?Math.round(amount/customers):0,serviceCustomers,svcCum};
 });
}
function operationsTableHtml(date=operationsDateKey()){
 const rows=operationsHourlyRows(date),m=storeMetricsForDate(date);
 return `<div class="operations-summary-grid">
  <div><strong class="operations-summary-kicker" aria-hidden="true">&nbsp;</strong><span>銷售金額合計</span><b>${money(m.revenue)}</b></div>
  <div><strong class="operations-summary-kicker">本日速報</strong><span>銷售來客數合計</span><b>${m.customers}</b></div>
  <div><strong class="operations-summary-kicker" aria-hidden="true">&nbsp;</strong><span>純服務性商品來客數合計</span><b>${m.serviceCustomers}</b></div>
 </div>
 <div class="operations-table-wrap"><table class="operations-speed-table"><thead><tr><th>時間帶</th><th>銷售金額</th><th>銷售金額累計</th><th>銷售來客數</th><th>銷售來客數累計</th><th>銷售客單價</th><th>純服務性商品來客數</th><th>純服務性商品來客數累計</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.hour}</td><td>${money(r.amount)}</td><td>${money(r.amountCum)}</td><td>${r.customers}</td><td>${r.custCum}</td><td>${money(r.avg)}</td><td>${r.serviceCustomers}</td><td>${r.svcCum}</td></tr>`).join('')}</tbody></table></div>`;
}
function operationsChartHtml(date=operationsDateKey()){
 const rows=operationsHourlyRows(date),max=Math.max(1,...rows.map(r=>r.amount));
 return `<div class="operations-chart"><div class="operations-chart-title">各時間帶銷售金額</div><div class="operations-bars">${rows.map(r=>`<div class="operations-bar-col" title="${r.hour}:00｜${money(r.amount)}"><div class="operations-bar" style="height:${Math.max(2,Math.round(r.amount/max*180))}px"></div><span>${r.hour}</span></div>`).join('')}</div></div>`;
}
let operationsViewMode='table';
function operationsPage(){
 const date=operationsDateKey(),today=localDateKey(),yesterday=shiftLocalDate(today,-1);
 if(!canViewCurrentStoreAcross())return `<div class="page-head"><h2>日銷售時間帶速報</h2></div><div class="panel"><p>查看其他門市需要「跨店查看」權限。</p></div>`;
 return `<div class="operations-legacy-page">
  <div class="operations-top-actions">
   <div class="operations-day-view-buttons"><button class="ops-mini ${date===yesterday?'primary':''}" data-operations-yesterday>前日</button><button class="ops-mini ${date===today?'primary':''}" data-operations-today="1">當日</button><button class="ops-mini ${operationsViewMode==='chart'?'primary':''}" data-operations-view="chart">圖片</button><button class="ops-mini ${operationsViewMode==='table'?'primary':''}" data-operations-view="table">表格</button></div>
   <div class="operations-right-tools">${storeSwitchSelectHtml('operations-store-select')}<button class="ops-green" data-action="operations-print">列印</button><button class="ops-green" data-action="operations-refresh">重新整理</button></div>
  </div>
  <div class="operations-date-line">資料日期：${esc(date)}｜店號：${esc(currentStoreCode())}</div>
  <div id="operationsBody">${operationsViewMode==='chart'?operationsChartHtml(date):operationsTableHtml(date)}</div>
 </div>`;
}
function bindOperationsPage(){
 bindStoreSwitchSelect();
 const redraw=()=>render('operations');
 document.querySelector('[data-operations-yesterday]')?.addEventListener('click',()=>{operationsSelectedDate=shiftLocalDate(localDateKey(),-1);redraw()});
 document.querySelector('[data-operations-today]')?.addEventListener('click',()=>{operationsSelectedDate=localDateKey();redraw()});
 document.querySelectorAll('[data-operations-view]').forEach(b=>b.addEventListener('click',()=>{operationsViewMode=b.dataset.operationsView==='chart'?'chart':'table';redraw()}));
 document.querySelector('[data-action="operations-refresh"]')?.addEventListener('click',async e=>{
  const btn=e.currentTarget;btn.disabled=true;const old=btn.textContent;btn.textContent='整理中…';
  try{
   if(cloudConfigured()){
    await Promise.allSettled([cloudPullKey(K.sales),cloudPullKey(K.stores)]);
   }
   saveAudit('重新整理日銷售時間帶速報',`${operationsDateKey()}｜${currentStoreCode()}`);
  }finally{render('operations')}
 });
 document.querySelector('[data-action="operations-print"]')?.addEventListener('click',()=>{
  const d=operationsDateKey();
  printHTML(`日銷售時間帶速報 ${d}`,`<h2 style="text-align:center;margin:0 0 8px">日銷售時間帶速報</h2><p style="text-align:center">店號 ${esc(currentStoreCode())}｜${esc(d)}</p>${operationsTableHtml(d)}`);
  saveAudit('列印日銷售時間帶速報',`${d}｜${currentStoreCode()}`);
 });
 if(cloudConfigured())Promise.allSettled([cloudPullKey(K.sales),cloudPullKey(K.stores)]).then(()=>{if(document.body.dataset.mode==='back'&&document.querySelector('#operationsBody'))render('operations')}).catch(()=>{});
}
const HOME_PAGE_PERMISSION={
 home:null,ordering:'orderingAccess','ordering-ledger':'orderLedger','ordering-fos':'orderFos','ordering-use':'orderSupplies','ordering-special':'orderSpecial','ordering-group':'orderGroup','ordering-fos-favorites':'orderFos','ordering-use-favorites':'orderSupplies','ordering-special-favorites':'orderSpecial','ordering-group-favorites':'orderGroup','ordering-face':'orderFacePrint',revenue:'revenueAccess',transactions:'transactionBackAccess',
 products:'productsAccess',quality:'qualityAccess',inventory:'inventoryAccess',
 'system-settings':'systemSettingsAccess',xaccount:'revenueAccess',audit:'auditAccess','member-analysis':null,'time-control':'qualityAccess',notice:null,
 logistics:'logisticsAccess',ec:'ecAccess',transfers:'transfersAccess',attendance:'attendanceAccess',
 employees:'employeesAccess',stores:'storesAccess',permissions:'permissionsAccess',promotions:'promotionsAccess'
};

const STOCKTAKE_SC_GROUP_PERMISSIONS={
 '訂購業務':'stocktakeScGroupOrdering',
 '營收業務':'stocktakeScGroupRevenue',
 '分析業務':'stocktakeScGroupAnalysis',
 '庫存業務':'stocktakeScGroupInventory',
 '店務管理':'stocktakeScGroupStore',
 '營運報表':'stocktakeScGroupReports',
 '人事作業':'stocktakeScGroupHr',
 '通報與調查':'stocktakeScGroupNotice'
};
const STOCKTAKE_SC_GROUP_LABELS=Object.entries(STOCKTAKE_SC_GROUP_PERMISSIONS);
function scPageGroup(page){
 page=String(page||'');
 const meta=scPrebuildMeta(page);if(meta?.group)return meta.group;
 const direct={
  'ordering':'訂購業務','ordering-ledger':'訂購業務','ordering-fos':'訂購業務','ordering-use':'訂購業務','ordering-special':'訂購業務','ordering-group':'訂購業務','ordering-fos-favorites':'訂購業務','ordering-use-favorites':'訂購業務','ordering-special-favorites':'訂購業務','ordering-group-favorites':'訂購業務','ordering-face':'訂購業務','products':'訂購業務','promotions':'訂購業務',
  'revenue':'營收業務','transactions':'營收業務','xaccount':'營收業務','collection-service':'營收業務',
  'operations':'分析業務','member-analysis':'分析業務','members':'分析業務',
  'inventory':'庫存業務','quality':'庫存業務','time-control':'庫存業務','logistics':'庫存業務','transfers':'庫存業務','ec':'庫存業務',
  'audit':'店務管理','member-point-settings':'店務管理','member-bonus-settings':'店務管理','stores':'店務管理','customer-display-settings':'店務管理','system-settings':'店務管理',
  'monthly-operating-preview':'營運報表','stocktake-report':'營運報表',
  'employees':'人事作業','attendance':'人事作業','permissions':'人事作業','stocktake-personnel':'人事作業','engineer-personnel':'人事作業','engineer-personnel-permissions':'人事作業','engineer-tm-permissions':'人事作業','stocktake-tm-permissions':'人事作業','hq-personnel':'人事作業','hq-personnel-permissions':'人事作業','hq-tm-permissions':'人事作業',
  'notice':'通報與調查'
 };
 return direct[page]||'';
}
function stocktakeScGroupAllowed(group){
 const key=STOCKTAKE_SC_GROUP_PERMISSIONS[group];
 return !!key&&hasPermission(key);
}

function isStocktakeOperator(){
 const u=currentUser();
 return !!(u&&(u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員'||String(u.employmentType||'')==='盤點人員'));
}
function stocktakeScPageAllowed(page){
 if(!isStocktakeOperator())return true;
 page=String(page||'');
 if(page==='home')return true;
 if(page==='stocktake-personnel-mode')return hasPermission('eobStocktakePersonnel');
 if(page==='stocktake-upload-hq')return hasPermission('stocktakeUploadHeadOffice');
 const meta=scPrebuildMeta(page);
 if(meta?.label==='EOB盤點')return hasPermission('eobStocktake');
 return false;
}
function scHomeGroupForPage(page){
 page=String(page||'');
 const meta=scPrebuildMeta(page);if(meta?.group)return meta.group;
 const map={
  'ordering-ledger':'訂購業務','ordering-fos':'訂購業務','ordering-use':'訂購業務','ordering-special':'訂購業務','ordering-group':'訂購業務','ordering-suggestion-settings':'訂購業務','ordering-reservations':'訂購業務','ordering-fresh-settings':'訂購業務','products':'訂購業務','promotions':'訂購業務',
  'xaccount':'營收業務','transactions':'營收業務','revenue':'營收業務','collection-service':'營收業務',
  'operations':'分析業務','member-analysis':'分析業務','members':'分析業務',
  'inventory':'庫存業務','quality':'庫存業務','time-control':'庫存業務','logistics':'庫存業務','transfers':'庫存業務','ec':'庫存業務',
  'audit':'店務管理','member-point-settings':'店務管理','member-bonus-settings':'店務管理','stores':'店務管理','customer-display-settings':'店務管理','system-settings':'店務管理',
  'monthly-operating-preview':'營運報表','stocktake-report':'營運報表',
  'employees':'人事作業','attendance':'人事作業','permissions':'人事作業','stocktake-personnel':'人事作業','engineer-personnel':'人事作業','engineer-personnel-permissions':'人事作業','engineer-tm-permissions':'人事作業','stocktake-tm-permissions':'人事作業','hq-personnel':'人事作業','hq-personnel-permissions':'人事作業','hq-tm-permissions':'人事作業',
  'notice':'通報與調查'
 };
 return map[page]||'';
}
function navPageVisible(page){
 if(!currentUser())return false;
 if(isStocktakeOperator())return stocktakeScPageAllowed(page);
 const homeGroup=scHomeGroupForPage(page);if(homeGroup&&!scHomeGroupAllowed(homeGroup))return false;
 if(String(page||'').startsWith('prebuild-'))return scPrebuildAccessAllowed(page);
 if(!scDirectPageAccessAllowed(page))return false;
 if(page==='products')return productManagement2Allowed();
 if(page==='promotions')return isFounder()||hasPermission('promotionsAccess');
 const perm=HOME_PAGE_PERMISSION[page]||'';
 return !perm||hasPermission(perm);
}
function latestCompletedOrderTransmissionMs(){
 const rows=load(K.orders,[])||[];
 let latest=Number(localStorage.getItem('yj_ordering_last_successful_transmit_ms')||0);
 for(const o of rows){
  if(!['已傳輸','完成'].includes(String(o?.status||'')))continue;
  const raw=o?.transmittedAt||'';
  const ms=raw?new Date(raw).getTime():0;
  if(Number.isFinite(ms)&&ms>latest)latest=ms;
 }
 return latest;
}
function hasPendingOrderTransmission(){
 const rows=load(K.orders,[])||[];
 const lastDone=latestCompletedOrderTransmissionMs();
 return rows.some(o=>{
  const status=String(o?.status||'').trim();
  if(!['未傳輸','已建立','部分傳輸'].includes(status||'已建立'))return false;
  if(!(o?.items||[]).some(it=>Number(it?.qty||0)>0))return false;
  const raw=o?.updatedAt||o?.at||o?.createdAt||'';
  const changedMs=raw?new Date(raw).getTime():0;
  // 離開訂購頁只提醒「上次成功傳輸後新建／修改」的訂購資料。
  // 舊的部分傳輸歷史不再讓已完成傳輸後一直跳提醒。
  return !lastDone||!Number.isFinite(changedMs)||changedMs>lastDone;
 });
}
function goAdminPage(page,permission=''){
 if(!page)return;
 if(isStocktakeOperator()&&!stocktakeScPageAllowed(page)){alert('盤點人員無此 SC 功能權限');return}
 if(!isStocktakeOperator()&&String(page).startsWith('prebuild-')&&!scPrebuildAccessAllowed(page)){alert('此功能需要第一層、第二層與第三層權限');return}
 if(!isStocktakeOperator()&&!scDirectPageAccessAllowed(page)){alert('此功能需要第一層、第二層與第三層權限');return}
 const homeGroup=scHomeGroupForPage(page);if(!isStocktakeOperator()&&homeGroup&&!scHomeGroupAllowed(homeGroup)){alert(`需要「${homeGroup}」首頁分類權限`);return}
 const mergedTarget=scMergedConnectedTarget(page);if(mergedTarget)page=mergedTarget;
 if(page==='products'&&!productManagement2Allowed()){alert('商品管理 2.0 僅限管理員、總部人員、工程師使用');return}
 if(page==='promotions'&&!isFounder()){alert('總部商品活動設定只有創辦人可以使用');return}
 const perm=permission||HOME_PAGE_PERMISSION[page]||'';
 if(perm&&!hasPermission(perm)){alert(`需要「${permissionLabels[perm]||perm}」權限`);return}
 const current=currentAdminPage();
 if(String(current).startsWith('ordering')&&!String(page).startsWith('ordering')&&hasPendingOrderTransmission()){
  const answer=confirm(`是否進行訂購傳輸？\n\n確定＝先進行訂購傳輸\n取消＝不傳輸，直接離開`)
  if(answer){
   if(orderingIsStatisticsLock())return alert('系統訂購統計中，22:02 開放隔日訂購');
   Promise.resolve(admin219TransmitAllOrders()).then(()=>{document.body.dataset.mode='back';render(page)}).catch(e=>alert('訂購傳輸失敗：'+(e?.message||e)));
   return;
  }
 }
 document.body.dataset.mode='back';
 render(page);
}
function adminNavOpenState(){
 try{return new Set(JSON.parse(sessionStorage.getItem('yj_admin_nav_open')||'[]'))}catch{return new Set()}
}
function setAdminNavGroupOpen(label,open){
 const set=adminNavOpenState();if(open)set.add(label);else set.delete(label);
 sessionStorage.setItem('yj_admin_nav_open',JSON.stringify([...set]));
}
function currentAdminPage(){
 return String(window.__yjCurrentAdminPage||'home');
}
function refreshOrderingCurrentView(){
 const page=currentAdminPage();
 render(String(page).startsWith('ordering')?page:'ordering');
}
function deferRefreshOrderingCurrentView(){
 setTimeout(()=>{
  if(String(currentAdminPage()).startsWith('ordering'))refreshOrderingCurrentView();
 },0);
}

const SC_PREBUILD_MENU_GROUPS={
 '訂購業務':[
  ['訂購作業',['台帳訂購','FOS訂購','用度品訂購','特殊品訂購','商品管理','訂購資料清除','指定日訂購','FACE卡列印','建議訂購設定','時價／異常庫存查詢']],
  ['他店代訂',['台帳訂購','FOS訂購','他店USB訂購']],
  ['訂購查詢',['訂購狀況一覽','預約訂購','品群訂購統計','訂購提醒登錄','訂購明細查詢']]
 ],
 '營收業務':[
  ['營收作成',['帳表一覽（當日）','營收明細','代收服務']],
  ['營收歷史查詢',['營收查詢','營收明細查詢','累點查詢','異常帳日時間序列','中獎發票查詢','送金計算歷程']],
  ['缺失單作業',['缺失單查詢','通知單查詢']],
  ['發票管理',['發票存根聯','發票下傳USB','發票庫存查詢']]
 ],
 '分析業務':[
  ['營運分析',['日銷售時間帶速報','長期銷售時間帶分析','常模分析']],
  ['商品分析',['商品進銷存時序列','商品進銷廢星期別','組促活動查詢','組促活動銷售','組促活動銷售時間帶','節慶活動品群銷售']],
  ['稽核性分析',['收銀員操作異常分析']],
  ['基本設定',['自訂群組商品設定']],
  ['商品預售分析',['預售實際兌換明細']],
  ['會員分析',['會員分析','會員管理']],
  ['銷售總動員分析',['獎勵案銷售統計','獎勵案銷售排名分析']],
  ['OA素訂使用分析',['PBOA素訂使用分析','NBOA素訂使用分析','PBOA無素訂品項明細查詢','PB商品銷售排行分析']],
  ['數位渠道分析',['數位渠道銷售時序列','數位渠道時間帶分析','全+1社群電商銷售排行','全+1社群電商上架分析','全+1社群電商庫存檢視']]
 ],
 '庫存業務':[
  ['進貨作業',['配送確認書驗收','巡迴進貨','EC儲位修改','EC進店緩衝刷','EOB進店箱驗收']],
  ['退貨作業',['總下架商品退貨','下架商品歷史查詢','不良品／空箱瓶退貨','巡迴退貨','允收查詢','EOB離店','退貨查詢']],
  ['轉貨作業',['轉出','轉入','他店代轉','轉貨管理']],
  ['變價作業',['變價下傳收銀機','變價單作成']],
  ['廢棄作業',['廢棄','廢棄單作成','廢棄類別分析','品保／時控']],
  ['存貨盤點作業',['EOB盤點','高單價盤點輸入','庫存盤點值輸入','盤點管理','EOB盤點EC']],
  ['服務性商品',['EC商品查詢','EC異常計訂','EC管理']]
 ],
 '店務管理':[
  ['資料維護',['系統關機','POP海報','盤點人員權限設定','EOB尋機響鈴','雲端單店折扣設定','會員累點／折抵設定','會員贈點活動設定','門市管理','客顯設定','雲端與更新']],
  ['作業紀錄',['業務紀錄','庫存修正歷程','歷史報表查詢']],
  ['列管商品',['列管查詢']],
  ['品保管理',['品保管理','EOB品保','過期品盤點情報','實架分配表','實架複檢登錄','FF商品條碼列印','即期商品條碼列印']],
  ['商品查詢',['商品查詢']],
  ['店舖評鑑',['SQC評鑑','店舖評鑑系統']],
  ['職安環檢課程報名',['職安／體檢梯次報名','職安／體檢梯次報名結果查詢']],
  ['清潔業務',['制服送洗']],
  ['自設提醒',['自動登出時間設定','TM自設提醒','總部提醒']]
 ],
 '營運報表':[
  ['營運六表',['商品A報','商品B報','最低保證返還金','盤點報告書','營運報告書','月度營運分析','往來帳及保證金餘額表','匯款金額明細表','資產負債表','營業月報表','營運報告書時序列','特約清算表']],
  ['加盟款明細',['代售商品存貨推移表','找零金明細表','空瓶明細表','多（少）送金明細表','廢資源扣款明細表']],
  ['管銷費用及其他收入',['電費明細','電話費明細','調整值明細表','營收代售明細表','進退轉變廢核對表','消耗品明細表']],
  ['加盟店進銷項電子發票接收',['基本資料維護','收入發票確認','費用／支出發票接收','發票使用明細表']],
  ['銀行存摺明細表',['銀行存摺明細']]
 ],
 '人事作業':[
  ['人員管理作業',['人員基本資料','權限設定','每日工時處理','盤點人員基本資料','薪資上下限設定','班表上班時間設定','排班表人員順序設定','排班表設定','名牌列印','支援派遣單申請','排班表設定（新）']],
  ['薪資作業',['薪資結算']]
 ],
 '通報與調查':[
  ['商品聯絡書',['新商品檔','販促活動','單品活動','聯絡事項','特殊陳列','刪除商品','預購DM','整合台帳','WEB修正']],
  ['店舖調查統計',['店舖調查統計','店舖調查統計回填查詢']],
  ['通報管理',['通報內容檢視','加盟專區']],
  ['教育訓練',['店舖選課報名作業','報名選課結果查詢','店舖學習記錄瀏覽']],
  ['庶務作業',['線上表格','設備報修維修','菸酒販售關閉提醒']],
  ['課題管理與勞檢法規',['資訊公告','商品管理','進階學習','機器設備','店務管理','訂購作業','營收帳務','勞檢法規內容查詢']]
 ]
};
const SC_CONNECTED_PERMISSION_BY_PATH={
 '營收業務|營收作成|代收服務':'collectionServiceAccess','營收業務|營收歷史查詢|營收查詢':'revenueAccess','營收業務|發票管理|發票存根聯':'transactionBackAccess',
 '店務管理|資料維護|雲端單店折扣設定':'promotionsAccess',
 '分析業務|營運分析|日銷售時間帶速報':'operationsAccess','分析業務|會員分析|會員分析':'memberLookup',
 '訂購業務|訂購作業|台帳訂購':'orderLedger','訂購業務|訂購作業|FOS訂購':'orderFos','訂購業務|訂購作業|用度品訂購':'orderSupplies','訂購業務|訂購作業|特殊品訂購':'orderSpecial','訂購業務|訂購作業|商品管理':'productsAccess','訂購業務|訂購作業|訂購資料清除':'orderClearAccess','訂購業務|訂購作業|FACE卡列印':'orderFacePrint','訂購業務|訂購作業|建議訂購設定':'orderAutoAI','訂購業務|訂購作業|鮮食建議訂購設定':'freshAIOrder',
 '庫存業務|進貨作業|配送確認書驗收':'logisticsAccess','庫存業務|進貨作業|巡迴進貨':'patrolReceiving','庫存業務|進貨作業|EOB進店箱驗收':'eobReceiving','庫存業務|退貨作業|總下架商品退貨':'productShelfReturn','庫存業務|退貨作業|巡迴退貨':'patrolReturn','庫存業務|轉貨作業|轉出':'transferOut','庫存業務|轉貨作業|轉入':'transferIn','庫存業務|轉貨作業|轉貨管理':'transfersAccess','庫存業務|廢棄作業|廢棄':'qualityWasteCreate','庫存業務|廢棄作業|品保／時控':'qualityAccess','庫存業務|存貨盤點作業|EOB盤點':'eobStocktake','庫存業務|存貨盤點作業|盤點管理':'inventoryAccess','庫存業務|服務性商品|EC商品查詢':'ecAccess','庫存業務|服務性商品|EC管理':'ecAccess',
 '店務管理|作業紀錄|業務紀錄':'auditAccess','店務管理|資料維護|盤點人員權限設定':'permissionsAccess','店務管理|資料維護|EOB尋機響鈴':'eobReceiving','店務管理|資料維護|會員累點／折抵設定':'memberPointSettings','店務管理|資料維護|會員贈點活動設定':'memberBonusCampaignSettings','店務管理|資料維護|門市管理':'storesAccess','店務管理|資料維護|客顯設定':'customerDisplaySettingsAccess','店務管理|資料維護|雲端與更新':'systemSettingsAccess',
 '營運報表|營運六表|月度營運分析':'monthlyOperatingPreviewAccess',
 '人事作業|人員管理作業|人員基本資料':'employeesAccess','人事作業|人員管理作業|權限設定':'permissionsAccess','人事作業|人員管理作業|每日工時處理':'attendanceAccess','人事作業|人員管理作業|盤點人員基本資料':'stocktakePersonnelAccess','人事作業|人員管理作業|名牌列印':'employeeBadgePrint',
 '通報與調查|通報管理|通報內容檢視':'noticeAccess',
 '通報與調查|通報管理|加盟專區':'franchiseAreaAccess'
};
function scGeneratedPermissionKey(groupIndex,sectionIndex,itemIndex){return `scMenu_${groupIndex+1}_${sectionIndex+1}_${itemIndex+1}`}
const SC_DIRECT_MENU_ITEMS={};
const SC_DIRECT_EXISTING_PATH={
 'ordering-ledger':['訂購業務','訂購作業','台帳訂購'],'ordering-fos':['訂購業務','訂購作業','FOS訂購'],'ordering-use':['訂購業務','訂購作業','用度品訂購'],'ordering-special':['訂購業務','訂購作業','特殊品訂購'],'ordering-face':['訂購業務','訂購作業','FACE卡列印'],
 'products':['訂購業務','訂購作業','商品管理'],
 'collection-service':['營收業務','營收作成','代收服務'],
 'inventory':['庫存業務','存貨盤點作業','盤點管理'],'quality':['庫存業務','廢棄作業','品保／時控'],'time-control':['庫存業務','廢棄作業','品保／時控'],'logistics':['庫存業務','進貨作業','配送確認書驗收'],'transfers':['庫存業務','轉貨作業','轉貨管理'],'ec':['庫存業務','服務性商品','EC管理'],
 'audit':['店務管理','作業紀錄','業務紀錄'],'member-point-settings':['店務管理','資料維護','會員累點／折抵設定'],'member-bonus-settings':['店務管理','資料維護','會員贈點活動設定'],'stores':['店務管理','資料維護','門市管理'],'customer-display-settings':['店務管理','資料維護','客顯設定'],'system-settings':['店務管理','資料維護','雲端與更新'],
 'monthly-operating-preview':['營運報表','營運六表','月度營運分析'],
 'employees':['人事作業','人員管理作業','人員基本資料'],'permissions':['人事作業','人員管理作業','權限設定'],'attendance':['人事作業','人員管理作業','每日工時處理'],'stocktake-personnel':['人事作業','人員管理作業','盤點人員基本資料'],'engineer-personnel':['人事作業','人員管理作業','人員基本資料'],'engineer-personnel-permissions':['人事作業','人員管理作業','權限設定'],'engineer-tm-permissions':['人事作業','人員管理作業','權限設定'],'stocktake-tm-permissions':['人事作業','人員管理作業','權限設定'],'hq-personnel':['人事作業','人員管理作業','人員基本資料'],'hq-personnel-permissions':['人事作業','人員管理作業','權限設定'],'hq-tm-permissions':['人事作業','人員管理作業','權限設定'],
 'notice':['通報與調查','通報管理','通報內容檢視'],'franchise-area':['通報與調查','通報管理','加盟專區']
};
const SC_DIRECT_PERMISSION_META={};
function rebuildScPermissionDirectory(){
 const codes=['100000','200000','300000','400000','500000','700000','800000','900000'];
 const next={};Object.entries(SC_PREBUILD_MENU_GROUPS).forEach(([group,sections],gi)=>{
  const l1code=codes[gi]||`${gi+1}00000`;const children={};
  sections.forEach(([section,items],si)=>{const l2code=`${l1code[0]}${String(si+1)}0000`;children[l2code]={label:section,items:items.map((label,ii)=>{const code=`${l1code[0]}${String(si+1)}${String(ii+1).padStart(2,'0')}00`;const key=SC_CONNECTED_PERMISSION_BY_PATH[`${group}|${section}|${label}`]||scGeneratedPermissionKey(gi,si,ii);permissionLabels[key]=label;return [code,label,key]})};});
  next[l1code]={label:group,children};
 });SC_PERMISSION_DIRECTORY=next;
 for(const [page,[group,section,label]] of Object.entries(SC_DIRECT_EXISTING_PATH)){const gi=Object.keys(SC_PREBUILD_MENU_GROUPS).indexOf(group),si=(SC_PREBUILD_MENU_GROUPS[group]||[]).findIndex(x=>x[0]===section),ii=si>=0?SC_PREBUILD_MENU_GROUPS[group][si][1].indexOf(label):-1;if(gi>=0&&si>=0&&ii>=0){const l1=Object.keys(next)[gi],l2=Object.keys(next[l1].children)[si],row=next[l1].children[l2].items[ii];SC_DIRECT_PERMISSION_META[page]={l1,l2,key:row[2]};}}
}
rebuildScPermissionDirectory();
function scDirectPageAccessAllowed(page,u=currentUser()){
 if(!u)return false;if(u.role==='創辦人')return true;const pm=SC_DIRECT_PERMISSION_META[String(page||'')];if(!pm)return true;return hasPermission(`__dir_l1_${pm.l1}`)&&hasPermission(`__dir_l2_${pm.l2}`)&&hasPermission(pm.key);
}
function scMenuPermissionMeta(meta){
 if(!meta)return null;const gi=Object.keys(SC_PREBUILD_MENU_GROUPS).indexOf(meta.group);const sections=SC_PREBUILD_MENU_GROUPS[meta.group]||[];const si=sections.findIndex(x=>x[0]===meta.section);const ii=si>=0?sections[si][1].indexOf(meta.label):-1;if(gi<0||si<0||ii<0)return null;
 const l1=Object.keys(SC_PERMISSION_DIRECTORY)[gi],l2=Object.keys(SC_PERMISSION_DIRECTORY[l1]?.children||{})[si],row=SC_PERMISSION_DIRECTORY[l1]?.children?.[l2]?.items?.[ii];return {l1,l2,key:row?.[2]||''};
}
function scPrebuildAccessAllowed(page,u=currentUser()){
 if(!u)return false;if(u.role==='創辦人')return true;const meta=scPrebuildMeta(page),pm=scMenuPermissionMeta(meta);if(!pm)return false;return hasPermission(`__dir_l1_${pm.l1}`)&&hasPermission(`__dir_l2_${pm.l2}`)&&hasPermission(pm.key);
}
function scPrebuildSlug(group,section,label,index){return `prebuild-${encodeURIComponent(group)}-${encodeURIComponent(section)}-${index}`}
function scPrebuildChildren(group){
 const out=[];(SC_PREBUILD_MENU_GROUPS[group]||[]).forEach(([section,items])=>items.forEach((label,i)=>out.push([scPrebuildSlug(group,section,label,i),label,section])));return out;
}
function scPrebuildChild(group,section,label){
 return scPrebuildChildren(group).find(([,l,s])=>l===label&&s===section)||null;
}
function orderingConnectedShortcutChildren(){
 const rows=[],push=x=>{if(x&&!rows.some(([p])=>p===x[0]))rows.push(x)};
 // 已正式接通的訂購作業
 push(scPrebuildChild('訂購業務','訂購作業','台帳訂購'));
 push(scPrebuildChild('訂購業務','訂購作業','FOS訂購'));
 push(scPrebuildChild('訂購業務','訂購作業','用度品訂購'));
 push(scPrebuildChild('訂購業務','訂購作業','特殊品訂購'));
 push(['ordering-group','品群訂購','訂購作業']);
 push(scPrebuildChild('訂購業務','訂購作業','商品管理'));
 push(scPrebuildChild('訂購業務','訂購作業','訂購資料清除'));
 push(scPrebuildChild('訂購業務','訂購作業','指定日訂購'));
 push(scPrebuildChild('訂購業務','訂購作業','FACE卡列印'));
 push(scPrebuildChild('訂購業務','訂購作業','建議訂購設定'));
 push(scPrebuildChild('訂購業務','訂購作業','時價／異常庫存查詢'));
 // 訂購查詢中目前已正式接通的功能
 push(scPrebuildChild('訂購業務','訂購查詢','預約訂購'));

 // Alpha 5.32：未接通項目雖預設隱藏，但創辦人在權限設定開啟後，
 // 也必須真正加入「訂購業務」選單來源，之後再由 scPrebuildOptionVisible() 控制顯示。
 for(const entry of scPrebuildChildren('訂購業務'))push(entry);
 return rows;
}
// 頂部快捷列只顯示「已接功能」；同名的他店代訂預做入口不重複顯示。

function scPrebuildMeta(page){
 for(const [group,sections] of Object.entries(SC_PREBUILD_MENU_GROUPS))for(const [section,items] of sections)for(let i=0;i<items.length;i++)if(scPrebuildSlug(group,section,items[i],i)===page)return {group,section,label:items[i]};
 return null;
}

const SC_PREBUILD_VISIBILITY_KEY='yj_sc_prebuild_visibility';
const SC_PREBUILD_CONNECTED_LABELS=new Set([
 '帳表一覽（當日）','時價／異常庫存查詢','EC商品查詢','收銀員操作異常分析','EOB盤點',
 '盤點人員權限設定','權限設定','系統關機','EOB尋機響鈴','自動登出時間設定','TM自設提醒',
 '總部提醒','總下架商品退貨','下架商品歷史查詢','廢棄','轉出','轉入','不良品／空箱瓶退貨',
 '名牌列印','支援派遣單申請','菸酒販售關閉提醒','訂購資料清除','訂購狀況一覽','品群訂購統計','訂購提醒登錄','訂購明細查詢'
]);
function scPrebuildIsConnected(page){
 const m=scPrebuildMeta(page);if(!m)return true;
 if(SC_PREBUILD_CONNECTED_LABELS.has(m.label))return true;
 return !!scMergedConnectedTarget(page);
}
function scPrebuildVisibilityMap(){return load(SC_PREBUILD_VISIBILITY_KEY,{})||{}}
function scPrebuildOptionVisible(page){
 if(!scPrebuildMeta(page)||scPrebuildIsConnected(page))return true;
 return scPrebuildVisibilityMap()[page]===true;
}
function scPrebuildVisibilityAdminHtml(){
 if(!isFounder())return '';
 const flags=scPrebuildVisibilityMap(),rows=[];
 for(const [group,sections] of Object.entries(SC_PREBUILD_MENU_GROUPS)){
  for(const [section,items] of sections){
   items.forEach((label,i)=>{
    const page=scPrebuildSlug(group,section,label,i);
    if(scPrebuildIsConnected(page))return;
    rows.push(`<label class="prebuild-visibility-row"><input type="checkbox" data-prebuild-visibility="${esc(page)}" ${flags[page]===true?'checked':''}><b>${esc(group)}｜${esc(section)}｜${esc(label)}</b><em>${flags[page]===true?'已顯示':'預設隱藏'}</em></label>`);
   });
  }
 }
 return `<section class="panel prebuild-visibility-panel" style="margin-top:14px"><div class="page-head"><div><h3>未接通選單顯示管理</h3><small>SC 八大選單中尚未正式接通的功能預設全部隱藏。只有創辦人可以在此開啟；正式接通的功能不受此開關影響。</small></div><button class="primary" data-action="save-prebuild-visibility">儲存顯示設定</button></div><div class="prebuild-visibility-list">${rows.join('')||'<p>目前沒有未接通項目。</p>'}</div></section>`;
}
function scMergedConnectedTarget(page){
 const m=scPrebuildMeta(page);if(!m)return '';
 const k=`${m.group}|${m.section}|${m.label}`;
 return {
  '營收業務|營收作成|代收服務':'collection-service',
  '營收業務|營收歷史查詢|營收查詢':'xaccount',
  '營收業務|發票管理|發票存根聯':'transactions',
  '店務管理|資料維護|雲端單店折扣設定':'promotions',
  '分析業務|營運分析|日銷售時間帶速報':'operations',
  '分析業務|會員分析|會員分析':'member-analysis',
  '分析業務|會員分析|會員管理':'members',
  '訂購業務|訂購作業|台帳訂購':'ordering-ledger',
  '訂購業務|訂購作業|FOS訂購':'ordering-fos',
  '訂購業務|訂購作業|用度品訂購':'ordering-use',
  '訂購業務|訂購作業|特殊品訂購':'ordering-special',
  '訂購業務|訂購作業|FACE卡列印':'ordering-face',
  '訂購業務|訂購作業|指定日訂購':'ordering-specified-date',
  '訂購業務|訂購作業|建議訂購設定':'ordering-suggestion-settings',
  '訂購業務|訂購查詢|預約訂購':'ordering-reservations',
  '訂購業務|訂購作業|商品管理':'products',
  '庫存業務|存貨盤點作業|盤點管理':'inventory',
  '庫存業務|廢棄作業|品保／時控':'quality',
  '庫存業務|進貨作業|配送確認書驗收':'logistics',
  '庫存業務|轉貨作業|轉貨管理':'transfers',
  '庫存業務|服務性商品|EC管理':'ec',
  '店務管理|作業紀錄|業務紀錄':'audit',
  '店務管理|資料維護|會員累點／折抵設定':'member-point-settings',
  '店務管理|資料維護|會員贈點活動設定':'member-bonus-settings',
  '店務管理|資料維護|門市管理':'stores',
  '店務管理|資料維護|客顯設定':'customer-display-settings',
  '店務管理|資料維護|雲端與更新':'system-settings',
  '營運報表|營運六表|盤點報告書':'stocktake-report',
  '營運報表|營運六表|月度營運分析':'monthly-operating-preview',
  '人事作業|人員管理作業|人員基本資料':'employees',
  '人事作業|人員管理作業|權限設定':'permissions',
  '人事作業|人員管理作業|每日工時處理':'attendance',
  '人事作業|人員管理作業|盤點人員基本資料':'stocktake-personnel',
  '通報與調查|通報管理|通報內容檢視':'notice',
  '通報與調查|通報管理|加盟專區':'franchise-area'
 }[k]||'';
}

let eobStocktakeCloudRows=[];
let eobStocktakeCloudError='';
let eobStocktakeCloudLoading=false;

function eobStocktakeTypeLabel(v){
 const x=String(v||'standard');
 return x==='personnel'?'盤點人員專用（盲盤）':'SC 標準盤點';
}
function eobStocktakeItemSummary(payload={}){
 const items=Array.isArray(payload?.items)?payload.items:[];
 let match=0,over=0,short=0,diffTotal=0;
 for(const x of items){
  const book=Number(x?.book||0),actual=Number(x?.actual||0),d=actual-book;
  diffTotal+=d;if(d===0)match++;else if(d>0)over++;else short++;
 }
 return {items,match,over,short,diffTotal};
}
function eobStocktakeRecordIsPersonnelOperator(row){
 const account=String(row?.operator_account||'').trim().toLowerCase();
 const name=String(row?.operator_name||'').trim();
 return stocktakePersonnelEmployees().some(u=>{
  const aliases=[String(u.account||''),String(eobAccountOf(u)||'')].map(v=>v.trim().toLowerCase()).filter(Boolean);
  return (account&&aliases.includes(account)) || (name&&String(u.name||'').trim()===name);
 });
}
function eobStocktakePageHtml(){
 const rows=Array.isArray(eobStocktakeCloudRows)?eobStocktakeCloudRows:[];
 const latest=rows[0]||null;
 const standard=rows.filter(x=>String(x.stocktake_type||x.payload?.stocktake_type||'standard')!=='personnel').length;
 const personnel=rows.filter(x=>String(x.stocktake_type||x.payload?.stocktake_type||'standard')==='personnel').length;
 const listHtml=rows.map((x,idx)=>{
   const payload=x.payload||{};
   const sum=eobStocktakeItemSummary(payload);
   const type=String(x.stocktake_type||payload.stocktake_type||'standard');
   const mode=String(x.mode||payload.mode||'—');
   const who=x.operator_name||x.operator_account||'EOB使用者';
   const when=x.created_at?new Date(x.created_at).toLocaleString('zh-TW'):'—';
   const canCorrect=isFounder()&&type!=='personnel'&&eobStocktakeRecordIsPersonnelOperator(x)&&!!x.id;
   const itemRows=sum.items.map(i=>{
     const book=Number(i?.book||0),actual=Number(i?.actual||0),d=actual-book;
     return `<tr><td>${esc(i?.product_code||'—')}</td><td>${esc(i?.name||'')}</td><td>${esc(i?.barcode||'')}</td><td>${type==='personnel'?'盲盤':book}</td><td>${actual}</td><td class="${d===0?'diff-ok':d>0?'diff-over':'diff-short'}">${type==='personnel'?'完成':(d>0?'+':'')+d}</td></tr>`;
   }).join('')||'<tr><td colspan="6">此筆沒有商品明細</td></tr>';
   return `<details class="panel" ${idx===0?'open':''} style="margin-top:12px">
     <summary style="cursor:pointer"><b>${esc(eobStocktakeTypeLabel(type))}</b>｜${esc(mode)}｜${when}｜${esc(who)}｜${sum.items.length} 項</summary>
     ${canCorrect?`<div class="notice" style="margin-top:10px">偵測到此筆由盤點人員送出，但被記成「SC 標準盤點」。<button class="button" style="margin-left:8px" data-correct-eob-stocktake="${esc(x.id)}">更正為盤點人員專用</button></div>`:''}
     <div class="metric-grid" style="margin-top:12px">
       <div class="metric"><small>品項</small><strong>${sum.items.length}</strong></div>
       ${type==='personnel'
         ?`<div class="metric"><small>模式</small><strong style="font-size:18px">盲盤</strong></div>`
         :`<div class="metric"><small>相符</small><strong>${sum.match}</strong></div><div class="metric"><small>盤盈</small><strong>${sum.over}</strong></div><div class="metric"><small>盤虧</small><strong>${sum.short}</strong></div><div class="metric"><small>差異合計</small><strong>${sum.diffTotal>0?'+':''}${sum.diffTotal}</strong></div>`}
     </div>
     <div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>商品代號</th><th>商品</th><th>條碼</th><th>帳面數</th><th>實盤數</th><th>差異／狀態</th></tr></thead><tbody>${itemRows}</tbody></table></div>
   </details>`;
 }).join('');
 const cloudState=!cloudConfigured()
   ?'<span class="badge">尚未設定 Supabase</span>'
   :eobStocktakeCloudLoading?'<span class="badge">同步中…</span>'
   :eobStocktakeCloudError?'<span class="badge" style="background:#ffe3df;color:#a6291f">同步失敗</span>'
   :'<span class="badge">已接通 EOB</span>';
 return `<div class="page-head"><div><h2>EOB盤點</h2><small>庫存業務｜存貨盤點作業｜EOB 即時盤點結果</small></div><div class="toolbar">${cloudState}<button class="button" data-action="eob-stocktake-refresh">↻ 重新整理</button><button class="button" data-nav="${isStocktakeOperator()?'home':'inventory'}">← 返回</button></div></div>
 <section class="panel">
   <div class="metric-grid">
     <div class="metric"><small>讀取筆數</small><strong>${rows.length}</strong></div>
     <div class="metric"><small>SC 標準盤點</small><strong>${standard}</strong></div>
     <div class="metric"><small>盤點人員專用</small><strong>${personnel}</strong></div>
     <div class="metric"><small>最後同步</small><strong style="font-size:16px">${latest?.created_at?new Date(latest.created_at).toLocaleString('zh-TW'):'—'}</strong></div>
   </div>
   <p class="setting-hint">EOB「SC 標準盤點」會顯示帳面、實盤與差異；「盤點人員專用」為盲盤，SC 可查看其實盤結果。此頁直接讀取 EOB 已送出的雲端盤點紀錄。</p>
   ${eobStocktakeCloudError?`<div class="notice">讀取失敗：${esc(eobStocktakeCloudError)}<br>如果顯示 RPC 不存在，請先執行本版附帶的 EOB 盤點接通 SQL。</div>`:''}
 </section>
 ${listHtml||'<section class="panel" style="margin-top:14px"><p>目前尚沒有 EOB 盤點紀錄。</p></section>'}`;
}
async function refreshEobStocktakeCloud({rerender=true}={}){
 if(eobStocktakeCloudLoading)return;
 if(!cloudConfigured()){eobStocktakeCloudError='尚未設定 Supabase';if(rerender)render(currentAdminPage());return;}
 eobStocktakeCloudLoading=true;eobStocktakeCloudError='';
 // Alpha 4.45: 立即重繪，讓使用者確實看到「同步中…」，避免像按鈕沒反應。
 if(rerender&&scPrebuildMeta(currentAdminPage())?.label==='EOB盤點')render(currentAdminPage());
 try{
   const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('EOB盤點同步逾時（10 秒），請檢查網路或 EOB 管理授權')),10000));
   eobStocktakeCloudRows=await Promise.race([adminListEobStocktakes(150),timeout]);
 }catch(e){
   eobStocktakeCloudError=String(e?.message||e||'同步失敗');
 }finally{
   eobStocktakeCloudLoading=false;
   if(rerender&&scPrebuildMeta(currentAdminPage())?.label==='EOB盤點')render(currentAdminPage());
 }
}


let ecServiceQueryRows=[];
let ecServiceQueryLoading=false;
let ecServiceQueryError='';
function ecServiceEventTime(x,kind){
 const fields=kind==='進貨'?['arrived_at','arrival_at','received_at','inbound_at']:kind==='取貨'?['picked_at','pickup_at','collected_at']:['left_at','returned_at','return_at','return_created_at'];
 for(const k of fields){if(x&&x[k])return x[k]}
 return '';
}
function ecServiceQueryPage(){
 const filter=window.__yjEcServiceFilter||'全部',q=String(window.__yjEcServiceQ||'').trim().toLowerCase();
 const rows=ecServiceQueryRows.filter(x=>(filter==='全部'||x.kind===filter)&&(!q||[x.packageNo,x.name,x.last3,x.batchNo,x.status].some(v=>String(v||'').toLowerCase().includes(q))));
 const status=ecServiceQueryLoading?'讀取中…':ecServiceQueryError?`讀取失敗：${esc(ecServiceQueryError)}`:`共 ${rows.length} 筆`;
 return `<div class="page-head"><div><h2>EC商品查詢</h2><small>庫存業務｜服務性商品｜TM 的 EC 進貨／取貨／退貨紀錄</small></div><div class="toolbar"><select id="ecServiceFilter"><option ${filter==='全部'?'selected':''}>全部</option><option ${filter==='進貨'?'selected':''}>進貨</option><option ${filter==='取貨'?'selected':''}>取貨</option><option ${filter==='退貨'?'selected':''}>退貨</option></select><input id="ecServiceSearch" value="${esc(window.__yjEcServiceQ||'')}" placeholder="包裹編號／姓名／末三碼／批次"><button class="button" data-action="ec-service-query-refresh">↻ 重新整理</button></div></div>
 <section class="panel"><div class="metrics"><div class="metric"><small>進貨</small><strong>${ecServiceQueryRows.filter(x=>x.kind==='進貨').length}</strong></div><div class="metric"><small>取貨</small><strong>${ecServiceQueryRows.filter(x=>x.kind==='取貨').length}</strong></div><div class="metric"><small>退貨</small><strong>${ecServiceQueryRows.filter(x=>x.kind==='退貨').length}</strong></div></div><p class="setting-hint">${esc(status)}</p></section>
 <section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>作業</th><th>時間</th><th>包裹編號／退貨批次</th><th>收件人</th><th>末三碼</th><th>金額</th><th>狀態</th><th>來源</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.kind)}</b></td><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td><td>${esc(x.packageNo||x.batchNo||'—')}</td><td>${esc(x.name||'—')}</td><td>${esc(x.last3||'—')}</td><td>${x.amount!=null?money(Number(x.amount||0)):'—'}</td><td>${esc(x.status||'—')}</td><td>${esc(x.source||'TM / EC')}</td></tr>`).join('')||`<tr><td colspan="8">${ecServiceQueryLoading?'正在讀取 EC 紀錄…':'目前沒有符合條件的 EC 紀錄'}</td></tr>`}</tbody></table></section>`;
}
async function refreshEcServiceQuery({rerender=true}={}){
 if(ecServiceQueryLoading||!cloudConfigured())return;
 ecServiceQueryLoading=true;ecServiceQueryError='';
 try{
  const [packages,returnBatches]=await Promise.all([adminListEcPackages(500),adminListEcReturnBatches(200)]);
  const out=[];
  for(const x of (Array.isArray(packages)?packages:[])){
   const base={packageNo:x.package_no||x.packageNo||'',name:x.recipient_name||x.name||'',last3:x.recipient_last3||x.last3||'',amount:Number(x.cod_amount??x.value??x.amount??0),status:x.status||'',source:'TM / EC'};
   const a=ecServiceEventTime(x,'進貨');if(a)out.push({...base,kind:'進貨',at:a});
   const p=ecServiceEventTime(x,'取貨');if(p)out.push({...base,kind:'取貨',at:p});
   const r=ecServiceEventTime(x,'退貨');if(r)out.push({...base,kind:'退貨',at:r});
   if(!a&&!p&&!r&&/待取|已到店|arriv|received/i.test(String(x.status||'')))out.push({...base,kind:'進貨',at:x.updated_at||x.created_at||''});
   if(/已取|picked|pickup/i.test(String(x.status||''))&&!p)out.push({...base,kind:'取貨',at:x.updated_at||x.created_at||''});
   if(/退貨|退回|return|left/i.test(String(x.status||''))&&!r)out.push({...base,kind:'退貨',at:x.updated_at||x.created_at||''});
  }
  for(const x of (Array.isArray(returnBatches)?returnBatches:[])){
   out.push({kind:'退貨',at:x.left_at||x.departed_at||x.completed_at||x.updated_at||x.created_at||'',batchNo:x.batch_no||x.batchNo||'',packageNo:'',name:'EC退貨批次',last3:'',amount:null,status:x.status||'退貨',source:'TM EC離店'});
  }
  const seen=new Set();ecServiceQueryRows=out.filter(x=>{const k=[x.kind,x.at,x.packageNo,x.batchNo].join('|');if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
 }catch(e){ecServiceQueryError=e.message||String(e)}finally{ecServiceQueryLoading=false}
 if(rerender&&scPrebuildMeta(currentAdminPage())?.label==='EC商品查詢')render(currentAdminPage());
}
let cashierAnomalyCloudLoaded=false;
let cashierAnomalyCloudLoading=false;
let cashierAnomalyCloudError='';
function cashierAnomalyRows(){
 const auditRows=Array.isArray(load(K.audit,[]))?load(K.audit,[]):[];
 const saleRows=Array.isArray(load(K.sales,[]))?load(K.sales,[]):[];
 const out=[];
 const suspicious=/(取消交易|交易取消|整筆取消|作廢|退貨|更正|折扣|手動改價|改價|刪除暫存|刪除掛單|取消代收|退款)/;
 for(const a of auditRows){
  const action=String(a?.action||''),detail=String(a?.detail||'');
  if(!suspicious.test(action+' '+detail))continue;
  const tx=(detail.match(/T\d{8,}/)||detail.match(/(?:交易|單號|序號)[：:\s]*([A-Za-z0-9_-]+)/i)||[]);
  out.push({at:a.at||'',user:a.user||'—',type:action||'異常操作',txNo:tx[1]||tx[0]||'—',amount:null,detail,source:'操作紀錄'});
 }
 for(const x of saleRows){
  const status=String(x?.status||'');
  const discount=Number(x?.discountTotal??x?.discount??x?.manualDiscount??0);
  const corrected=!!(x?.correctedAt||x?.voidedAt||x?.cancelledAt||x?.returnOf||x?.correctionOf);
  if(!/(取消|作廢|退貨|更正|退款)/.test(status)&&discount<=0&&!corrected)continue;
  const flags=[];
  if(status)flags.push(status);
  if(discount>0)flags.push(`折扣 ${money(discount)}`);
  if(corrected)flags.push('交易曾修正');
  out.push({at:x.at||x.completedAt||x.createdAt||'',user:x.cashier||x.user||x.cashierName||'—',type:flags.join('／')||'交易異常',txNo:x.id||x.transactionId||x.transactionNo||'—',amount:Number(x.total||0),detail:x.note||x.reason||'',source:'交易存根'});
 }
 const seen=new Set();
 return out.filter(x=>{const k=[x.at,x.user,x.type,x.txNo,x.source].join('|');if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
}
function cashierOperationAnomalyPage(){
 const rows=cashierAnomalyRows();
 const byUser=new Map();for(const r of rows)byUser.set(r.user,(byUser.get(r.user)||0)+1);
 const top=[...byUser.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
 const status=cashierAnomalyCloudLoading?'同步中…':cashierAnomalyCloudError?`同步失敗：${cashierAnomalyCloudError}`:`共 ${rows.length} 筆異常操作`;
 return `<div class="page-head"><div><h2>收銀員操作異常分析</h2><small>分析業務｜稽核性分析｜交易取消、作廢、退貨、更正、折扣與手動改價</small></div><div class="toolbar"><button class="button" data-action="cashier-anomaly-refresh">↻ 重新整理</button></div></div>
 <section class="panel"><div class="metrics"><div class="metric"><small>異常操作</small><strong>${rows.length}</strong></div><div class="metric"><small>涉及收銀員</small><strong>${byUser.size}</strong></div></div><p class="setting-hint">${esc(status)}</p>${top.length?`<p class="setting-hint">異常次數較高：${top.map(([u,n])=>`${esc(u)} ${n}筆`).join('｜')}</p>`:''}</section>
 <section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>時間</th><th>收銀員</th><th>異常類型</th><th>交易序號</th><th>金額</th><th>內容</th><th>來源</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.at?new Date(r.at).toLocaleString('zh-TW'):'—'}</td><td>${esc(r.user)}</td><td><b>${esc(r.type)}</b></td><td>${esc(r.txNo)}</td><td>${r.amount==null?'—':money(r.amount)}</td><td>${esc(r.detail||'—')}</td><td>${esc(r.source)}</td></tr>`).join('')||'<tr><td colspan="7">目前沒有偵測到收銀員異常操作紀錄</td></tr>'}</tbody></table></section>`;
}
async function refreshCashierAnomalyCloud({rerender=true}={}){
 if(cashierAnomalyCloudLoading)return;
 cashierAnomalyCloudLoading=true;cashierAnomalyCloudError='';
 try{if(cloudConfigured()){await cloudPullKey(K.audit);await cloudPullKey(K.sales)}cashierAnomalyCloudLoaded=true}catch(e){cashierAnomalyCloudError=String(e?.message||e||'同步失敗')}finally{cashierAnomalyCloudLoading=false}
 if(rerender&&scPrebuildMeta(currentAdminPage())?.label==='收銀員操作異常分析')render(currentAdminPage());
}
function orderingDetailQueryDateOf(order){
 const raw=String(order?.at||order?.transmittedAt||order?.createdAt||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
 const d=raw?new Date(raw):null;
 if(d&&Number.isFinite(d.getTime()))return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 return '';
}
function rocDateLabel(dateKey){
 const m=String(dateKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!m)return dateKey||'—';
 return `${Number(m[1])-1911}/${m[2]}/${m[3]}`;
}
function orderingDetailQueryTabs(currentPage){
 const statusPage=scPrebuildChild('訂購業務','訂購查詢','訂購狀況一覽')?.[0]||'';
 const groupPage=scPrebuildChild('訂購業務','訂購查詢','品群訂購統計')?.[0]||'';
 const reminderPage=scPrebuildChild('訂購業務','訂購查詢','訂購提醒登錄')?.[0]||'';
 const detailPage=scPrebuildChild('訂購業務','訂購查詢','訂購明細查詢')?.[0]||'';
 const items=[
  ['訂購狀況一覽',statusPage],
  ['品群訂購統計',groupPage],
  ['訂購提醒登錄',reminderPage],
  ['訂購明細查詢',detailPage]
 ].filter(([,page])=>!!page);
 return `<div class="panel" style="padding:10px 12px;margin-bottom:12px;background:#d8f0dc"><div style="display:flex;gap:8px;overflow:auto;white-space:nowrap">${items.map(([label,page])=>{const active=page===currentPage;return `<button class="button" ${active?'disabled':''} data-nav="${esc(page)}" style="${active?'background:#2c7a3d;color:#fff;border-color:#2c7a3d;font-weight:800;':''}">${esc(label)}</button>`}).join('')}</div></div>`;
}
function orderingDetailQueryState(){
 const rows=load(K.orders,[]).filter(x=>Array.isArray(x?.items)&&x.items.length);
 const options=[...new Set(rows.map(orderingDetailQueryDateOf).filter(Boolean))].sort().reverse();
 const today=localDateKey();
 let selected=String(window.__yjScOrderingDetailQueryDate||'').trim();
 if(!selected)selected=options[0]||today;
 if(selected&&!options.includes(selected)&&rows.length)options.unshift(selected);
 return {rows,options:(options.length?options:[today]),selected};
}
function orderingDetailQueryData(dateKey){
 const state=orderingDetailQueryState();
 const selected=String(dateKey||state.selected||'').trim();
 const productRows=products();
 const productIndex=new Map(productRows.map(p=>[String(p.id),p]));
 const aggregate=new Map();
 const orders=state.rows.filter(o=>orderingDetailQueryDateOf(o)===selected);
 for(const order of orders){
  for(const item of (order.items||[])){
   const qty=Math.max(0,Number(item?.qty||0));
   if(!qty)continue;
   const p=productIndex.get(String(item.productId||''))||productRows.find(v=>String(v.code||'')===String(item.code||''))||{};
   const key=String(item.productId||p.id||item.code||item.barcode||item.name||uid());
   if(!aggregate.has(key))aggregate.set(key,{key,code:item.code||p.code||'',brand:p.brand||item.brand||'',name:item.name||p.name||'',spec:item.spec||p.spec||'',price:Number(item.price??p.price??0),packQty:Number(item.packQty||orderPackQty(p)||1),scQty:0,deliveryQty:0,statuses:new Set(),types:new Set(),orders:new Set(),deliveryTypes:new Set()});
   const row=aggregate.get(key);
   row.scQty+=qty;
   row.deliveryQty+=qty;
   row.statuses.add(String(order.status||'已建立'));
   row.types.add(String(order.type||''));
   row.orders.add(String(order.id||''));
   row.deliveryTypes.add(normalizeDeliveryLabel(item.deliveryType||order.deliveryType||p.deliveryType||p.logistics||'常溫'));
  }
 }
 const flat=[...aggregate.values()].sort((a,b)=>String(a.code||a.name).localeCompare(String(b.code||b.name),'zh-Hant')).map((row,i)=>({seq:i+1,code:row.code||'—',brand:row.brand||'—',name:row.name||'—',spec:row.spec||'—',price:row.price,packQty:row.packQty||1,scQty:row.scQty,deliveryQty:row.deliveryQty,status:[...row.statuses].join('／')||'—',orderType:[...row.types].join('／')||'—',deliveryType:[...row.deliveryTypes].join('／')||'—',orderCount:row.orders.size}));
 return {selected,options:state.options,rows:flat,orderCount:orders.length,totalQty:flat.reduce((a,x)=>a+Number(x.scQty||0),0)};
}

function orderingStatusGroupForProduct(p,item={}){
 const cfg=orderingStatusGroupsConfig();
 for(const row of cfg){
  if(productMappedToClassification(p,row))return {code:String(row.code||''),label:String(row.name||'')};
 }
 return {code:'999',label:'其他'};
}
function orderingStatusRoundStats(round){
 const ps=products(),orders=load(K.orders,[])||[],cfg=orderingStatusGroupsConfig();
 const map=new Map(cfg.map(x=>[String(x.code||''),{code:String(x.code||''),label:String(x.name||''),available:0,registered:new Set(),transmitted:new Set(),corrected:new Set()}]));
 map.set('999',{code:'999',label:'其他',available:0,registered:new Set(),transmitted:new Set(),corrected:new Set()});

 for(const p of ps){
  if(productStatusLabel(p)==='停用')continue;
  const sample={deliveryType:p.deliveryType||p.logistics||''};
  if(orderClearGroupOfItem(sample)!==round)continue;
  const g=orderingStatusGroupForProduct(p,sample),row=map.get(g.code)||map.get('999');
  row.available++;
 }
 for(const o of orders){
  for(const it of (o.items||[])){
   if(orderClearGroupOfItem(it)!==round)continue;
   const p=ps.find(x=>String(x.id)===String(it.productId))||{};
   const g=orderingStatusGroupForProduct(p,it),row=map.get(g.code)||map.get('999');
   const itemKey=String(it.productId||it.code||it.barcode||it.name||'');
   if(Number(it.qty||0)>0)row.registered.add(itemKey);
   if(['已傳輸','完成'].includes(String(o.status||'')))row.transmitted.add(itemKey);
   if(o.correctedAt||Array.isArray(o.storeOverrideItems)&&o.storeOverrideItems.some(x=>String(x.productId||x.code||x.name)===itemKey))row.corrected.add(itemKey);
  }
 }
 return map;
}
function orderingStatusOverviewPage(page){
 const first=orderingStatusRoundStats('first'),second=orderingStatusRoundStats('second');
 const codes=[...orderingStatusGroupsConfig().map(x=>String(x.code||'')),'999'];
 const rows=codes.map(code=>{
  const a=first.get(code),b=second.get(code);
  if(!a&&!b)return '';
  const label=(a||b).label;
  const showOther=code!=='999'||((a?.available||0)+(b?.available||0)+(a?.registered.size||0)+(b?.registered.size||0)>0);
  if(!showOther)return '';
  return `<tr><td>${esc(code)}</td><td>${esc(label)}</td>
   <td>${a?.available||0}</td><td>${a?.registered.size||0}</td><td>${a?.transmitted.size||0}</td><td class="${(a?.corrected.size||0)>0?'bad-text':''}">${a?.corrected.size||0}</td>
   <td>${b?.available||0}</td><td>${b?.registered.size||0}</td><td>${b?.transmitted.size||0}</td><td class="${(b?.corrected.size||0)>0?'bad-text':''}">${b?.corrected.size||0}</td></tr>`;
 }).join('');
 const today=localDateKey(),tomorrow=(()=>{const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})();
 return `${orderingDetailQueryTabs(page)}
 <div class="page-head"><div><h2>訂購狀況一覽</h2><small>訂購業務｜訂購查詢</small></div><div class="toolbar"><button class="button" data-action="ordering-status-refresh">↻ 重新整理</button></div></div>
 <section class="panel"><p class="setting-hint"><b>訂購日：</b>${esc(rocDateLabel(today))}（一訂）　${esc(rocDateLabel(tomorrow))}（二訂）</p></section>
 <section class="panel table-wrap" style="margin-top:14px">
  <table class="table ordering-status-overview-table">
   <thead>
    <tr><th rowspan="2">訂購群</th><th rowspan="2">訂購群名稱</th><th colspan="4">一訂訂購資料</th><th colspan="4">二訂訂購資料</th></tr>
    <tr><th>可訂購數</th><th>登錄數</th><th>傳輸數</th><th>修正數</th><th>可訂購數</th><th>登錄數</th><th>傳輸數</th><th>修正數</th></tr>
   </thead>
   <tbody>${rows||'<tr><td colspan="10">目前沒有訂購狀況資料</td></tr>'}</tbody>
  </table>
 </section>`;
}

function orderingGroupStatsPage(page){
 const orders=load(K.orders,[])||[], ps=products();
 const stats=new Map();
 for(const o of orders){
  for(const it of (o.items||[])){
   const p=ps.find(x=>String(x.id)===String(it.productId))||{};
   const group=String(it.group||p.group||it.category||p.category||'未分類');
   if(!stats.has(group))stats.set(group,{group,orders:new Set(),items:new Set(),qty:0,amount:0,transmitted:0});
   const r=stats.get(group);
   r.orders.add(String(o.id||''));
   r.items.add(String(it.productId||it.code||it.name||''));
   r.qty+=Number(it.qty||0);
   r.amount+=Number(it.qty||0)*Number(it.price??p.price??0);
   if(String(o.status||'')==='已傳輸')r.transmitted+=Number(it.qty||0);
  }
 }
 const rows=[...stats.values()].sort((a,b)=>b.qty-a.qty);
 return `${orderingDetailQueryTabs(page)}
 <div class="page-head"><div><h2>品群訂購統計</h2><small>訂購業務｜訂購查詢</small></div><div class="toolbar"><button class="button" data-action="ordering-group-stats-refresh">↻ 重新整理</button><button class="button" data-action="ordering-group-stats-print">🖨️ 列印</button></div></div>
 <section class="panel table-wrap"><table class="table"><thead><tr><th>品群</th><th>訂購單數</th><th>商品數</th><th>訂購總數</th><th>已傳輸數</th><th>估計金額</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.group)}</b></td><td>${r.orders.size}</td><td>${r.items.size}</td><td>${r.qty}</td><td>${r.transmitted}</td><td>${money(r.amount)}</td></tr>`).join('')||'<tr><td colspan="6">目前沒有可統計的品群訂購資料</td></tr>'}</tbody></table></section>`;
}

const ORDERING_REMINDERS_KEY='yj_ordering_reminders';
function orderingReminderRows(){return load(ORDERING_REMINDERS_KEY,[])||[]}
function orderingReminderToTmRecord(x){
 const date=String(x?.date||'').trim(),time=String(x?.time||'').trim()||'00:00';
 const startAt=(date&&time)?new Date(`${date}T${time}:00`).toISOString():'';
 return {
  id:String(x?.tmReminderId||`ORD-TMR-${x?.id||Date.now()}`),
  title:`訂購提醒｜${String(x?.type||'訂購作業')}`,
  message:String(x?.message||'').trim(),
  scope:'today',
  createdLocalDate:date||localDateKey(),
  startAt,
  endAt:'',
  enabled:x?.enabled!==false,
  source:'ordering',
  sourceReminderId:String(x?.id||''),
  updatedAt:String(x?.updatedAt||x?.createdAt||new Date().toISOString()),
  updatedBy:String(x?.user||currentUser()?.name||'SC')
 };
}
async function syncOrderingRemindersToTm(){
 const source=orderingReminderRows(),sourceIds=new Set(source.map(x=>String(x.id||'')));
 const tm=load('yj_tm_custom_reminders',[])||[];
 const keep=tm.filter(x=>String(x?.source||'')!=='ordering'||sourceIds.has(String(x?.sourceReminderId||'')));
 const bySource=new Map(keep.filter(x=>String(x?.source||'')==='ordering').map(x=>[String(x.sourceReminderId||''),x]));
 for(const x of source){
  let rec=orderingReminderToTmRecord(x);
  const old=bySource.get(String(x.id||''));
  if(old)rec={...old,...rec,id:old.id||rec.id};
  x.tmReminderId=rec.id;
  const i=keep.findIndex(v=>String(v?.source||'')==='ordering'&&String(v?.sourceReminderId||'')===String(x.id||''));
  if(i>=0)keep[i]=rec;else keep.unshift(rec);
 }
 save(ORDERING_REMINDERS_KEY,source);
 save('yj_tm_custom_reminders',keep);
 if(cloudConfigured()){
  try{
   await cloudPushKey(ORDERING_REMINDERS_KEY,source);
   await cloudPushKey('yj_tm_custom_reminders',keep);
  }catch(e){console.warn('訂購提醒同步 TM 失敗',e)}
 }
 return keep;
}
function orderingReminderRegistrationPage(page){
 const rows=orderingReminderRows().slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.time||'').localeCompare(String(b.time||'')));
 return `${orderingDetailQueryTabs(page)}
 <div class="page-head"><div><h2>訂購提醒登錄</h2><small>訂購業務｜訂購查詢｜已接通 TM 主動畫面提醒</small></div><div class="toolbar"><button class="button" data-action="ordering-reminder-sync-tm">🔄 同步 TM</button></div></div>
 <section class="panel">
  <div class="settings-grid">
   <label>提醒日期<input id="orderingReminderDate" type="date" value="${localDateKey()}"></label>
   <label>提醒時間<input id="orderingReminderTime" type="time" value="21:30"></label>
   <label>提醒類型<select id="orderingReminderType"><option>訂購傳輸</option><option>台帳訂購</option><option>FOS訂購</option><option>用度品訂購</option><option>特殊品訂購</option><option>品群訂購</option><option>其他</option></select></label>
   <label>狀態<select id="orderingReminderEnabled"><option value="true">啟用</option><option value="false">停用</option></select></label>
  </div>
  <label>提醒內容<input id="orderingReminderMessage" placeholder="例如：21:55 前確認常溫訂購並完成傳輸"></label>
  <div class="toolbar"><button class="primary" data-action="ordering-reminder-save">＋ 新增提醒</button></div>
 </section>
 <section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>日期</th><th>時間</th><th>類型</th><th>提醒內容</th><th>狀態</th><th>建立人員</th><th>操作</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(x.time||'—')}</td><td>${esc(x.type||'—')}</td><td>${esc(x.message||'—')}</td><td>${x.enabled===false?'停用':'啟用'}</td><td>${esc(x.user||'—')}</td><td><button class="button danger" data-ordering-reminder-delete="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">目前沒有訂購提醒</td></tr>'}</tbody></table></section>`;
}

function orderingDetailQueryPage(page){
 const data=orderingDetailQueryData(window.__yjScOrderingDetailQueryDate||'');
 const selectOptions=(data.options.length?data.options:[localDateKey()]).map(d=>`<option value="${esc(d)}" ${d===data.selected?'selected':''}>${esc(rocDateLabel(d))}</option>`).join('');
 const rowsHtml=data.rows.map(r=>`<tr><td>${r.seq}</td><td>${esc(r.code)}</td><td>${esc(r.brand)}</td><td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td>${money(Number(r.price||0))}</td><td>${Number(r.packQty||1)}</td><td><b>${Number(r.scQty||0)}</b></td><td>${Number(r.deliveryQty||0)}</td><td>${esc(r.deliveryType)}</td><td>${esc(r.status)}</td></tr>`).join('')||'<tr><td colspan="11">此訂購日期目前沒有訂購明細資料</td></tr>';
 const info=data.rows.length?`共 ${data.rows.length} 項商品／${data.orderCount} 張訂購單／訂購總數 ${data.totalQty}`:'目前沒有明細資料';
 return `${orderingDetailQueryTabs(page)}<div class="page-head"><div><h2>訂購明細查詢</h2><small>訂購業務｜訂購查詢</small></div><div class="toolbar"><label>訂購日期：<select id="scOrderingDetailQueryDate">${selectOptions}</select></label><button class="button" data-action="ordering-detail-query-refresh">↻ 重新整理</button><button class="button" data-action="ordering-detail-query-print">🖨️ 列印</button></div></div><section class="panel"><p class="setting-hint">${esc(info)}。此頁已正式接通，會依所選訂購日期顯示 SC 訂購明細。</p></section><section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>序號</th><th>商品代號</th><th>品牌</th><th>商品名稱</th><th>規格</th><th>售價</th><th>入數</th><th>SC訂購總數</th><th>總配送數</th><th>配送別</th><th>訂單狀態</th></tr></thead><tbody>${rowsHtml}</tbody></table></section>`;
}

function scPrebuildPage(page){
 const m=scPrebuildMeta(page);if(!m)return'';
 if(m.label==='帳表一覽（當日）')return accountListPage(true);
 if(m.label==='時價／異常庫存查詢')return marketAbnormalInventoryPage();
 if(m.label==='EC商品查詢')return ecServiceQueryPage();
 if(m.label==='收銀員操作異常分析')return cashierOperationAnomalyPage();
 if(m.label==='EOB盤點')return eobStocktakePageHtml();
 if(m.label==='盤點人員權限設定')return stocktakePermissionsAdminPage();
 if(m.label==='權限設定')return permissionsAdminPage();
 if(m.label==='系統關機'){
  return `<div class="page-head"><div><h2>系統關機</h2><small>店務管理｜系統電源作業</small></div></div><div class="panel"><h3>重新啟動系統</h3><p>重新載入 SC 介面，不刪除交易與設定資料。</p><button class="danger" data-action="system-restart">重新啟動系統</button></div>`;
 }
 if(m.label==='EOB尋機響鈴'){
  const sig=load('yj_eob_find_signal',null);
  return `<div class="page-head"><div><h2>EOB尋機響鈴</h2><small>店務管理｜尋找行動 EOB 裝置</small></div></div><div class="panel"><p>按下後會送出尋機訊號給本店 EOB 裝置。</p><p>最後送出：${sig?.at?new Date(sig.at).toLocaleString('zh-TW'):'—'}｜${esc(sig?.by||'—')}</p><button class="primary" data-action="eob-find-ring">🔔 EOB尋機響鈴</button></div>`;
 }
 if(m.label==='自動登出時間設定'){
  const minutes=Number(load('yj_sc_auto_logout_minutes',15));
  return `<div class="page-head"><div><h2>自動登出時間設定</h2><small>店務管理｜自設提醒</small></div></div><div class="panel"><h3>無操作自動登出</h3><label>自動登出時間<select id="scAutoLogoutMinutes">${[[5,'5 分鐘'],[10,'10 分鐘'],[15,'15 分鐘'],[30,'30 分鐘'],[0,'永不自動登出']].map(([v,l])=>`<option value="${v}" ${minutes===v?'selected':''}>${l}</option>`).join('')}</select></label><p class="setting-hint">滑動、點擊、鍵盤輸入等操作都會重新計時。選擇「永不自動登出」後不會因閒置而登出。</p><button class="primary" data-action="save-auto-logout">儲存設定</button></div>`;
 }
 if(m.label==='TM自設提醒'){
  const rows=load('yj_tm_custom_reminders',[])||[];
  return `<div class="page-head"><div><h2>TM自設提醒</h2><small>店務管理｜自設提醒｜新增／修改／刪除</small></div></div>
  <section class="panel"><input id="tmReminderEditId" type="hidden"><div class="settings-grid"><label>標題<input id="tmReminderTitle" placeholder="例如：交班提醒"></label><label>提醒週期<select id="tmReminderScope"><option value="daily">每天</option><option value="today">本日</option><option value="month">本月</option></select></label><label>狀態<select id="tmReminderEnabled"><option value="true">啟用</option><option value="false">停用</option></select></label><label>開始時間<input id="tmReminderStart" type="datetime-local"></label><label>結束時間<input id="tmReminderEnd" type="datetime-local"></label></div><label>提醒內容<textarea id="tmReminderMessage" placeholder="TM 要跳出的提醒內容"></textarea></label><div class="toolbar"><button class="primary" data-action="tm-reminder-save">＋ 新增提醒</button><button class="button" data-action="tm-reminder-cancel">取消修改</button></div><p class="setting-hint">「每天」會每天重新提醒一次；「本日」只在建立當日有效；「本月」只在建立當月有效。</p></section>
  <section class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>標題</th><th>週期</th><th>內容</th><th>開始</th><th>結束</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.title||'')}</td><td>${x.scope==='today'?'本日':x.scope==='month'?'本月':'每天'}</td><td>${esc(x.message||'')}</td><td>${x.startAt?new Date(x.startAt).toLocaleString('zh-TW'):'立即'}</td><td>${x.endAt?new Date(x.endAt).toLocaleString('zh-TW'):'持續'}</td><td>${x.enabled===false?'停用':'啟用'}</td><td><button class="button" data-action="tm-reminder-edit" data-id="${esc(x.id)}">修改</button> <button class="button danger" data-action="tm-reminder-delete" data-id="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">尚未建立 TM 視窗提醒</td></tr>'}</table></section>`;
 }
 if(m.label==='總部提醒'){
  if(!isFounder())return `<div class="page-head"><div><h2>總部提醒</h2><small>僅創辦人可設定</small></div></div><div class="panel"><p>此功能只有創辦人可新增、修改、刪除。</p></div>`;
  const rows=load('yj_hq_tm_reminders',[])||[];
  return `<div class="page-head"><div><h2>總部提醒</h2><small>總部｜TM 視窗提醒｜僅創辦人可設定</small></div></div>
  <section class="panel"><input id="hqReminderEditId" type="hidden"><div class="settings-grid"><label>標題<input id="hqReminderTitle" placeholder="例如：總部緊急通知"></label><label>提醒週期<select id="hqReminderScope"><option value="daily">每天</option><option value="today">本日</option><option value="month">本月</option></select></label><label>狀態<select id="hqReminderEnabled"><option value="true">啟用</option><option value="false">停用</option></select></label><label>開始時間<input id="hqReminderStart" type="datetime-local"></label><label>結束時間<input id="hqReminderEnd" type="datetime-local"></label></div><label>提醒內容<textarea id="hqReminderMessage" placeholder="所有門市 TM 要跳出的總部提醒"></textarea></label><div class="toolbar"><button class="primary" data-action="hq-reminder-save">＋ 新增總部提醒</button><button class="button" data-action="hq-reminder-cancel">取消修改</button></div><p class="setting-hint">總部提醒同步所有門市 TM；只有創辦人可以新增、修改、刪除。</p></section>
  <section class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>標題</th><th>週期</th><th>內容</th><th>開始</th><th>結束</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.title||'')}</td><td>${x.scope==='today'?'本日':x.scope==='month'?'本月':'每天'}</td><td>${esc(x.message||'')}</td><td>${x.startAt?new Date(x.startAt).toLocaleString('zh-TW'):'立即'}</td><td>${x.endAt?new Date(x.endAt).toLocaleString('zh-TW'):'持續'}</td><td>${x.enabled===false?'停用':'啟用'}</td><td><button class="button" data-action="hq-reminder-edit" data-id="${esc(x.id)}">修改</button> <button class="button danger" data-action="hq-reminder-delete" data-id="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="7">尚未建立總部提醒</td></tr>'}</table></section>`;
 }
 if(m.label==='總下架商品退貨'){
  const rules=load('yj_total_shelf_return_rules',[])||[],ps=load(K.products,[])||[],founder=isFounder();
  return `<div class="page-head"><div><h2>總下架商品退貨</h2><small>總部指定下架商品；設定僅創辦人可維護</small></div></div>
  ${founder?`<section class="panel"><h3>總下架商品設定</h3><div class="settings-grid"><label>設定作業<select id="totalShelfManageAction"><option value="new">新增</option><option value="edit">修改</option><option value="delete">刪除</option></select></label><label>既有設定<select id="totalShelfRuleSelect"><option value="">— 請選擇 —</option>${rules.map(x=>`<option value="${esc(x.id)}">${esc(x.code||'')} ${esc(x.name||'')}</option>`).join('')}</select></label><label>商品<select id="totalShelfProduct"><option value="">— 請選擇商品 —</option>${ps.map(x=>`<option value="${esc(x.id)}">${esc(x.code||'')}｜${esc(x.name||'')}</option>`).join('')}</select></label><label>原因<input id="totalShelfReason" placeholder="總部通知／食安／包裝異常…"></label><label>生效日<input id="totalShelfStart" type="date"></label><label>截止日<input id="totalShelfEnd" type="date"></label></div><button class="primary" data-action="total-shelf-rule-apply">執行設定作業</button></section>`:''}
  <section class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>商品</th><th>原因</th><th>生效</th><th>截止</th><th>狀態</th><th>退貨</th></tr>${rules.map(x=>`<tr><td>${esc(x.code||'')}｜${esc(x.name||'')}</td><td>${esc(x.reason||'')}</td><td>${esc(x.startDate||'—')}</td><td>${esc(x.endDate||'—')}</td><td>${x.active===false?'停用':'有效'}</td><td><button class="primary" data-action="total-shelf-return-create" data-id="${esc(x.id)}">建立退貨</button></td></tr>`).join('')||'<tr><td colspan="6">目前沒有總下架商品設定</td></tr>'}</table></section>`;
 }
 if(m.label==='下架商品歷史查詢'){
  const rules=load('yj_total_shelf_return_rules',[])||[];
  const returns=(load('yj4_product_returns',[])||[]).filter(x=>x.type==='總下架商品'||x.label==='總下架商品退貨');
  return `<div class="page-head"><div><h2>下架商品歷史查詢</h2><small>接通總部總下架商品設定｜總部規則全部門市共用</small></div></div>
  <section class="panel table-wrap"><h3>總部總下架設定</h3><table class="table"><tr><th>商品</th><th>原因</th><th>生效</th><th>截止</th><th>狀態</th><th>最後更新</th></tr>${rules.map(x=>`<tr><td>${esc(x.code||'')}｜${esc(x.name||'')}</td><td>${esc(x.reason||'')}</td><td>${esc(x.startDate||'—')}</td><td>${esc(x.endDate||'—')}</td><td>${x.active===false?'停用':'有效'}</td><td>${x.updatedAt?new Date(x.updatedAt).toLocaleString('zh-TW'):'—'}</td></tr>`).join('')||'<tr><td colspan="6">目前沒有總部總下架設定</td></tr>'}</table></section>
  <section class="panel table-wrap" style="margin-top:14px"><h3>本店總下架退貨紀錄</h3><table class="table"><tr><th>時間</th><th>商品</th><th>數量</th><th>原因</th><th>操作員</th><th>狀態</th></tr>${returns.map(x=>`<tr><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td><td>${esc(x.code||'')}｜${esc(x.name||'')}</td><td>${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.user||'')}</td><td>${esc(x.status||'已建立')}</td></tr>`).join('')||'<tr><td colspan="6">本店尚無總下架退貨紀錄</td></tr>'}</table></section>`;
 }

 if(m.label==='廢棄'){
  const rows=(load(K.waste,[])||[]).filter(x=>recordStoreCode(x)===currentStoreCode()||!x.storeCode);
  return `<div class="page-head"><div><h2>廢棄</h2><small>庫存業務｜廢棄作業｜正式接通</small></div><div class="toolbar"><button class="primary" data-action="new-waste">＋ 廢棄登錄</button><button class="button" data-action="waste-query">廢棄查詢／修改</button></div></div>
  <section class="panel table-wrap"><table class="table"><tr><th>時間</th><th>商品</th><th>數量</th><th>原因</th><th>操作員</th><th>庫存</th></tr>${rows.map(x=>`<tr><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td><td>${esc(x.productCode||'')} ${esc(x.name||'')}</td><td>${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.user||'')}</td><td>${x.stockBefore!=null?`${Number(x.stockBefore)} → ${Number(x.stockAfter||0)}`:'—'}</td></tr>`).join('')||'<tr><td colspan="6">尚無廢棄紀錄</td></tr>'}</table></section>`;
 }
 if(m.label==='轉出'){
  const rows=(load(K.transfers,[])||[]).filter(x=>String(x.from)===currentStoreCode());
  return `<div class="page-head"><div><h2>轉出</h2><small>庫存業務｜轉貨作業｜目前店號 ${esc(currentStoreCode())}</small></div><button class="primary" data-action="transfer-out">＋ 建立轉出單</button></div>
  <section class="panel table-wrap"><table class="table"><tr><th>轉貨單號</th><th>轉入店</th><th>商品</th><th>數量</th><th>日期</th><th>狀態</th></tr>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.to)}</td><td>${x.items.map(i=>esc(i.name)).join('、')}</td><td>${x.items.reduce((a,i)=>a+Number(i.qty||0),0)}</td><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td><td>${x.status==='運送中'?`待 ${esc(x.to)} 店轉入`:esc(x.status||'')}</td></tr>`).join('')||'<tr><td colspan="6">本店尚無轉出單</td></tr>'}</table></section>`;
 }
 if(m.label==='轉入'){
  const here=currentStoreCode(),rows=(load(K.transfers,[])||[]).filter(x=>String(x.to)===here);
  return `<div class="page-head"><div><h2>轉入</h2><small>庫存業務｜轉貨作業｜只有轉入店可 Key</small></div></div>
  <section class="panel"><h3>轉貨單過刷／Key 轉入</h3><div class="inline-field"><input id="transferNoPrebuild" placeholder="掃描或輸入轉貨單號" style="width:100%;padding:11px"><button class="button" data-action="scan-transfer-prebuild">📷 掃描</button></div><button class="primary" data-action="receive-transfer-prebuild">確認轉入</button><p class="setting-hint">轉出店不可將自己建立的轉貨單 Key 成轉入；系統會核對目前店號與轉入店號。</p></section>
  <section class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>轉貨單號</th><th>轉出店</th><th>商品</th><th>數量</th><th>狀態</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.from)}</td><td>${x.items.map(i=>esc(i.name)).join('、')}</td><td>${x.items.reduce((a,i)=>a+Number(i.qty||0),0)}</td><td>${esc(x.status||'')}</td><td>${x.status==='運送中'?`<button class="button" data-transfer-receive="${esc(x.id)}">轉入</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6">目前沒有指定轉入本店的轉貨單</td></tr>'}</table></section>`;
 }
 if(m.label==='不良品／空箱瓶退貨'){
  const ps=load(K.products,[])||[];
  return `<div class="page-head"><h2>不良品／空箱瓶退貨</h2></div><div class="panel"><p>原「下架商品退貨」已合併到此處。一般不良品是否可退，依商品管理「不良退 Y/N」判斷。</p><label>退貨類別<select id="badReturnKind" onchange="document.getElementById('emptyContainerWrap').hidden=this.value!=='空箱瓶';document.getElementById('badReturnProductWrap').hidden=this.value==='空箱瓶'"><option>不良品</option><option>下架商品</option><option>空箱瓶</option></select></label><label id="badReturnProductWrap">商品<select id="badReturnProduct">${ps.map(x=>`<option value="${esc(x.id)}">${esc(x.code||'')}｜${esc(x.name||'')}｜不良退 ${x.returnable===false?'N':'Y'}</option>`).join('')}</select></label><label id="emptyContainerWrap" hidden>空箱瓶類型<select id="emptyContainerType"><option>金牌玻璃瓶</option><option>紅標料理米酒玻璃瓶</option><option>啤酒空箱</option></select></label><label>數量<input id="badReturnQty" type="number" min="1" value="1"></label><label>備註<input id="badReturnNote" placeholder="選填"></label><button class="primary" data-action="bad-empty-return-create">建立退貨</button></div>`;
 }
 if(m.label==='名牌列印'){
  const rows=storeEmployees().filter(u=>u&&u.active!==false&&u.loginEnabled!==false&&!['離職','離店','停用'].includes(employeeEmploymentStatus(u)));
  return `<div class="page-head"><div><h2>名牌列印</h2><small>直接同步「員工基本資料」，不另外維護名牌名單。</small></div></div><section class="panel table-wrap"><table class="table"><thead><tr><th>員工編號</th><th>姓名</th><th>職位</th><th>名牌職稱</th><th>門市</th><th>操作</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.employeeCode||u.account||'—')}</td><td>${esc(u.name||'')}</td><td>${esc(u.position||u.role||'—')}</td><td>${esc(u.badgeTitle||u.position||u.role||'員工')}</td><td>${esc(u.storeName||store().name||'')}</td><td><button class="primary" data-badge-employee="${esc(u.id)}">列印名牌</button></td></tr>`).join('')||'<tr><td colspan="6">目前沒有可列印名牌的在職人員</td></tr>'}</tbody></table></section>`;
 }
 if(m.label==='訂購資料清除')return orderingClearPage();
 if(m.label==='支援派遣單申請'){
  const rows=load('yj_support_dispatch_requests',[])||[];
  return `<div class="page-head"><div><h2>支援派遣單申請</h2><small>人事作業｜支援人力申請</small></div></div>
  <section class="panel"><div class="settings-grid"><label>申請店舖<input id="sdStore" value="${esc(currentStoreCode())}" readonly></label><label>申請人<input id="sdApplicant" value="${esc(currentUser()?.name||'')}" readonly></label><label>* 支援日期<input id="sdDate" type="date"></label><label>* 開始時間<input id="sdStart" type="time"></label><label>* 結束時間<input id="sdEnd" type="time"></label><label>* 人數<input id="sdCount" type="number" min="1" value="1"></label><label>班別<select id="sdShift"><option>早班</option><option>晚班</option><option>大夜</option><option>自訂時段</option></select></label><label>原因<select id="sdReason"><option>臨時缺員</option><option>請假</option><option>離職缺額</option><option>活動支援</option><option>盤點支援</option><option>其他</option></select></label><label>急件<select id="sdUrgent"><option value="false">否</option><option value="true">是</option></select></label></div><label>工作內容／需求說明<textarea id="sdWork"></textarea></label><label>備註<textarea id="sdNote"></textarea></label><div class="toolbar"><button class="primary" data-action="support-dispatch-submit">送出申請</button><button class="button" data-action="support-dispatch-clear">清除重填</button></div></section>
  <section class="panel table-wrap" style="margin-top:14px"><h3>歷史申請</h3><table class="table"><tr><th>申請時間</th><th>支援日期</th><th>時段</th><th>人數</th><th>原因</th><th>狀態</th></tr>${rows.map(x=>`<tr><td>${esc(new Date(x.createdAt).toLocaleString('zh-TW'))}</td><td>${esc(x.date)}</td><td>${esc(x.start)}～${esc(x.end)}</td><td>${Number(x.count||1)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.status||'申請中')}</td></tr>`).join('')||'<tr><td colspan="6">尚無申請紀錄</td></tr>'}</table></section>`;
 }
 if(m.label==='菸酒販售關閉提醒'){
  const state=load('yj_alcohol_reminder_state',{enabled:true,updatedAt:'',updatedBy:''})||{};
  const hist=load('yj_alcohol_reminder_history',[])||[];
  return `<div class="page-head"><div><h2>菸酒販售關閉提醒</h2><small>TM 管理開關紀錄</small></div><button class="button" data-action="alcohol-history-refresh">↻ 同步</button></div>
  <div class="panel"><p>目前狀態：<b class="${state.enabled===false?'bad-text':'ok-text'}">${state.enabled===false?'關閉':'開啟'}</b></p><p>最後異動：${state.updatedAt?new Date(state.updatedAt).toLocaleString('zh-TW'):'—'}｜${esc(state.updatedBy||'—')}</p></div>
  <div class="panel table-wrap" style="margin-top:14px"><table class="table"><tr><th>時間</th><th>動作</th><th>操作員</th><th>員編</th><th>來源</th></tr>${hist.map(x=>`<tr><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${x.enabled===false?'關閉':'開啟'}</td><td>${esc(x.operatorName||'—')}</td><td>${esc(x.operatorAccount||'—')}</td><td>${esc(x.source||'TM')}</td></tr>`).join('')||'<tr><td colspan="5">尚無紀錄</td></tr>'}</table></div>`;
 }
 if(m.label==='訂購狀況一覽')return orderingStatusOverviewPage(page);
 if(m.label==='品群訂購統計')return orderingGroupStatsPage(page);
 if(m.label==='訂購提醒登錄')return orderingReminderRegistrationPage(page);
 if(m.label==='訂購明細查詢')return orderingDetailQueryPage(page);
 return `<div class="page-head"><div><h2>${esc(m.label)}</h2><small>${esc(m.group)}｜${esc(m.section)}</small></div><span class="badge">預做</span></div><div class="panel"><h3>功能入口已建立</h3><p>此頁先依參考店舖系統建立選單與入口，實際作業流程、資料欄位與串接功能將於後續版本接續製作。</p><p><b>目前不會寫入或修改任何正式資料。</b></p></div>`;
}

function renderAuthorizedNav(){
 const nav=document.querySelector('#nav'),sub=document.querySelector('#navSub');
 if(!nav||!currentUser())return;
 const brandHome=document.querySelector('.topnav-brand-home');
 if(brandHome){
  brandHome.classList.toggle('active',currentAdminPage()==='home');
  brandHome.onclick=e=>{e.preventDefault();e.stopPropagation();goAdminPage('home');};
  const u=currentUser()||{},st=store();
  const op=document.querySelector('#topOperatorName'),sl=document.querySelector('#topStoreLabel'),dt=document.querySelector('#topDateTime');
  if(op)op.textContent=(u.isStocktakePersonnel===true||u.role==='盤點人員')?'盤點人員':(u.name||u.username||'未登入');
  if(sl)sl.textContent=`${st.code||currentStoreCode()} ${st.name||load('yj_store_name','億家門市')}`;
  if(dt){const n=new Date(),wd='日一二三四五六'[n.getDay()];dt.textContent=`${n.getFullYear()-1911}年${String(n.getMonth()+1).padStart(2,'0')}月${String(n.getDate()).padStart(2,'0')}日(週${wd}) ${n.toLocaleTimeString('zh-TW',{hour12:false})}`;}
 }
 const groups=[
  {label:'訂購業務',icon:'🛒',children:orderingConnectedShortcutChildren()},
  {label:'營收業務',icon:'💰',children:[...(()=>{const rows=scPrebuildChildren('營收業務').filter(([,label])=>label!=='代收服務');const idx=Math.max(0,rows.findIndex(([,label])=>label==='營收明細')+1);rows.splice(idx,0,['collection-service','代收服務']);return rows;})()]},
  {label:'分析業務',icon:'📊',children:[...scPrebuildChildren('分析業務')]},
  {label:'庫存業務',icon:'📦',children:[...scPrebuildChildren('庫存業務')]},
  {label:'店務管理',icon:'🏪',children:[...scPrebuildChildren('店務管理')]},
  {label:'營運報表',icon:'📋',children:[...scPrebuildChildren('營運報表')]},
  {label:'人事作業',icon:'👥',children:[...scPrebuildChildren('人事作業')]},
  {label:'通報與調查',icon:'🔔',children:[...scPrebuildChildren('通報與調查')]}
 ];
 const stocktakeSession=isStocktakeOperator();
 const stocktakePerms=userPermissions(currentUser()||{});
 const stocktakeChildren=[];
 if(stocktakePerms.eobStocktake){
  const eobEntry=scPrebuildChildren('庫存業務').find(([,label])=>label==='EOB盤點');
  if(eobEntry)stocktakeChildren.push(eobEntry);
 }
 if(stocktakePerms.eobStocktakePersonnel)stocktakeChildren.push(['stocktake-personnel-mode','盤點人員專用']);
 if(stocktakePerms.stocktakeUploadHeadOffice)stocktakeChildren.push(['stocktake-upload-hq','盤點資料上傳總部']);
 const stocktakeGroups=[{label:'盤點',icon:'📋',children:stocktakeChildren}];
 const visibleGroups=(stocktakeSession?stocktakeGroups:groups
  .filter(g=>scHomeGroupAllowed(g.label))
  .map(g=>({...g,children:(g.children||[]).filter(([p])=>navPageVisible(p)&&scPrebuildOptionVisible(p)) })));
 nav.innerHTML=visibleGroups.map(g=>`<button type="button" class="nav-item ref-nav-parent" data-nav-parent-toggle="${esc(g.label)}"><b>${g.icon}</b><span>${g.label}</span><i>⌄</i></button>`).join('');
 document.querySelectorAll('[data-top-tool]').forEach(btn=>{btn.hidden=stocktakeSession;});
 const collapse=()=>{nav.querySelectorAll('.ref-nav-parent').forEach(b=>b.classList.remove('active'));if(sub){sub.innerHTML='';sub.hidden=true;}sessionStorage.removeItem('yj_admin_nav_active');};
 nav.querySelectorAll('[data-nav-parent-toggle]').forEach(toggle=>toggle.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const label=String(toggle.dataset.navParentToggle||''),g=visibleGroups.find(x=>x.label===label);
  const already=toggle.classList.contains('active');collapse();
  if(already||!g)return;
  toggle.classList.add('active');sessionStorage.setItem('yj_admin_nav_active',label);
  if(sub){sub.hidden=false;sub.innerHTML=(g.children.length?g.children.map(([p,label])=>`<button class="topnav-subitem" data-nav="${p}">${label}</button>`).join(''):'<span class="topnav-subempty">此分類目前沒有功能項目</span>');
   sub.querySelectorAll('[data-nav]').forEach(btn=>btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation();const page=String(btn.dataset.nav||'');collapse();goAdminPage(page);});
  }
 });
 // 右上固定工具：TM / UPS / 通報先預作；Audit Log 僅放在『通報與調查』。
 document.querySelectorAll('[data-top-tool]').forEach(btn=>btn.onclick=e=>{e.preventDefault();const tool=String(btn.dataset.topTool||'');if(tool==='notice')return goAdminPage('notice');if(tool==='tm')return goAdminPage('tm-link');alert(`${btn.textContent.trim()} 功能預作中`);});
 updateTopNoticeSummary();
}


function stocktakeOperatorHome(){
 // 盤點人員首頁沿用一般 SC 首頁資訊版型，但上方只保留「盤點」單一選單。
 // 首頁內若點到一般 SC 業務入口，仍由 stocktakeScPageAllowed 擋下，不會取得八大分類權限。
 return storeOperationsHome();
}
function stocktakePersonnelModePage(){
 if(!hasPermission('eobStocktakePersonnel'))return '<div class="panel"><p>未開啟盤點人員專用權限。</p></div>';
 const rows=(eobStocktakeCloudRows||[]).filter(x=>String(x.stocktake_type||x.stocktakeType||x.type||'').toLowerCase()==='personnel');
 return `<div class="page-head"><div><h2>盤點人員專用</h2><small>盲盤模式｜EOB 盤點資料</small></div><button class="button" data-nav="home">← 返回</button></div><section class="panel"><p>盤點人員專用模式不顯示帳面數量與差異；完成後由 SC／總部端檢視差異。</p><div class="table-wrap"><table class="table"><tr><th>時間</th><th>人員</th><th>店號</th><th>項目數</th></tr>${rows.map(x=>`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString('zh-TW'):'—'}</td><td>${esc(x.display_name||x.user_name||x.user||'—')}</td><td>${esc(x.store_code||x.storeCode||'—')}</td><td>${Array.isArray(x.items)?x.items.length:Array.isArray(x.payload?.items)?x.payload.items.length:0}</td></tr>`).join('')||'<tr><td colspan="4">目前沒有盤點人員專用資料</td></tr>'}</table></div></section>`;
}
function stocktakeUploadHqPage(){
 const rows=Array.isArray(eobStocktakeCloudRows)?eobStocktakeCloudRows:[];
 const pending=rows.filter(x=>!x?.payload?.hq_uploaded_at);
 const uploaded=rows.filter(x=>!!x?.payload?.hq_uploaded_at);
 const list=rows.map(x=>{
  const payload=x.payload||{},done=!!payload.hq_uploaded_at;
  const type=String(x.stocktake_type||payload.stocktake_type||'standard').toLowerCase()==='personnel'?'盤點人員專用':'SC 標準盤點';
  const when=x.created_at?new Date(x.created_at).toLocaleString('zh-TW'):'—';
  const who=x.operator_name||x.display_name||x.operator_account||'—';
  const count=Number(x.item_count||Array.isArray(payload.items)&&payload.items.length||0);
  return `<tr><td>${done?'':`<input type="checkbox" data-hq-stocktake-id="${esc(x.id||'')}">`}</td><td>${when}</td><td>${esc(who)}</td><td>${esc(type)}</td><td>${count}</td><td>${done?`<span class="badge">已上傳</span><small style="display:block;margin-top:4px">${payload.hq_uploaded_at?new Date(payload.hq_uploaded_at).toLocaleString('zh-TW'):''}</small>`:'<span class="badge" style="background:#fff3cd;color:#8a5a00">待上傳</span>'}</td></tr>`;
 }).join('')||'<tr><td colspan="6">目前沒有 EOB 盤點資料</td></tr>';
 return `<div class="page-head"><div><h2>盤點資料上傳總部</h2><small>EOB 雲端盤點同步／總部確認</small></div><button class="button" data-nav="home">← 返回</button></div>
 <section class="panel"><div class="metric-grid"><div class="metric"><small>總筆數</small><strong>${rows.length}</strong></div><div class="metric"><small>待上傳</small><strong>${pending.length}</strong></div><div class="metric"><small>已上傳</small><strong>${uploaded.length}</strong></div></div>
 <div class="toolbar" style="margin-top:12px"><button class="button" data-action="stocktake-hq-refresh">↻ 重新整理</button><button class="primary" data-action="stocktake-hq-upload" ${pending.length?'':'disabled'}>☁️ 上傳總部</button></div>
 <p class="setting-hint">勾選尚未上傳的盤點紀錄後送總部；成功後會標記「已上傳」，同一筆不會重複送。</p></section>
 <section class="panel table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th><input type="checkbox" id="stocktakeHqSelectAll" ${pending.length?'':'disabled'}></th><th>盤點時間</th><th>盤點人員</th><th>盤點類型</th><th>品項數</th><th>總部狀態</th></tr></thead><tbody>${list}</tbody></table></section>`;
}
function marketAbnormalInventoryPage(){
 const rows=products();
 const anomalies=[];
 for(const p of rows){
  const stock=Number(p.stock||0),safe=Number(p.safeStock||0),max=Number(p.maxStock||0),price=Number(p.price||0),cost=Number(p.cost||0),flags=[];
  if(p.marketPrice===true||String(p.priceType||'')==='時價'||String(p.status||'')==='時價')flags.push('時價商品');
  if(price<=0)flags.push('售價為 0');
  if(price>0&&cost>price)flags.push('成本高於售價');
  if(stock<0)flags.push('負庫存');
  if(safe>0&&stock<safe)flags.push(`低於安全庫存 ${safe}`);
  if(max>0&&stock>max)flags.push(`超過最大庫存 ${max}`);
  if(flags.length)anomalies.push({p,flags});
 }
 return `<div class="page-head"><div><h2>時價／異常庫存查詢</h2><small>直接讀取商品管理主檔的售價、成本、實際庫存、安全庫存與最大庫存</small></div><div class="toolbar"><input id="marketAbnormalSearch" placeholder="商品代號／名稱／條碼"><button class="button" data-action="market-abnormal-refresh">↻ 重新整理</button></div></div><section class="panel"><div class="metrics"><div class="metric"><small>商品總數</small><strong>${rows.length}</strong></div><div class="metric"><small>異常／時價</small><strong>${anomalies.length}</strong></div></div></section><section class="panel table-wrap"><table class="table"><thead><tr><th>商品</th><th>條碼</th><th>售價</th><th>成本</th><th>庫存</th><th>安全／最大</th><th>判定</th></tr></thead><tbody id="marketAbnormalRows">${anomalies.map(({p,flags})=>`<tr data-market-abnormal-search="${esc([p.code,p.name,...productBarcodes(p)].join(' ').toLowerCase())}"><td>${esc(p.code||'—')}｜${esc(p.name||'')}</td><td>${esc(productBarcodes(p)[0]||'—')}</td><td>${money(p.price)}</td><td>${money(p.cost)}</td><td>${Number(p.stock||0)}</td><td>${Number(p.safeStock||0)}／${Number(p.maxStock||0)}</td><td>${flags.map(x=>`<span class="tag">${esc(x)}</span>`).join(' ')}</td></tr>`).join('')||'<tr><td colspan="7">目前沒有時價或異常庫存商品</td></tr>'}</tbody></table></section>`;
}
function pendingOrderItemsFor(deliveryLabels){
 const labels=new Set(deliveryLabels);
 let count=0;
 for(const o of load(K.orders,[])){
  if(['已傳輸','完成'].includes(o.status))continue;
  for(const it of (o.items||[]))if(labels.has(normalizeDeliveryLabel(it.deliveryType||'')))count++;
 }
 return count;
}
function homeOrderReminder(){
 const now=new Date(),mins=now.getHours()*60+now.getMinutes();
 const first=pendingOrderItemsFor(['低溫二配','鮮食二配']);
 const second=pendingOrderItemsFor(['常溫','鮮食一配','低溫一配','冷凍']);
 const alerts=[];
 if(mins>=8*60+30&&first>0)alerts.push(`${mins>=10*60?'一訂已逾時':'一訂未傳輸'} ${first} 項`);
 if(mins>=20*60+30&&second>0)alerts.push(`${mins>=22*60?'二訂已逾時':'二訂未傳輸'} ${second} 項`);
 const pending=load(K.orders,[]).filter(x=>!['已傳輸','完成'].includes(x.status)).length;
 if(!alerts.length&&pending>0)alerts.push(`訂購未完成 ${pending} 筆`);
 return {text:alerts.length?alerts.join('／'):'目前無訂購提醒',warn:alerts.length>0};
}
function homeEcReturnPendingCount(){
 const cloud=(typeof __ecCloudRows!=='undefined'&&Array.isArray(__ecCloudRows))?__ecCloudRows:[];
 const cloudCount=cloud.filter(x=>x.status==='return_due').length;
 const local=load(K.ec,[]).filter(x=>['待退貨','待退','return_due'].includes(String(x.status||''))).length;
 return Math.max(cloudCount,local);
}

function memberPointLedgerEntries(){
 const out=[];
 for(const m of load(K.members,[])){
  for(const x of (Array.isArray(m.pointLedger)?m.pointLedger:[])){
   out.push({...x,memberId:m.id,memberName:m.name||'',memberPhone:m.phone||'',memberCode:m.code||m.memberNo||''});
  }
 }
 return out.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
}
function memberDailyPointAnomalies(){
 const by=new Map();
 for(const row of memberPointLedgerEntries()){
  if(Number(row.points||0)<=0||!['消費累點','贈點'].includes(String(row.type||'')))continue;
  if(!/^交易\s+T/.test(String(row.source||'')))continue;
  const date=String(row.at||'').slice(0,10),tx=String(row.source||'').replace(/^交易\s+/,'');
  const key=`${row.memberId}|${date}`;if(!by.has(key))by.set(key,{memberId:row.memberId,memberName:row.memberName,date,tx:new Set()});
  by.get(key).tx.add(tx);
 }
 return [...by.values()].map(x=>({...x,count:x.tx.size})).filter(x=>x.count>10).sort((a,b)=>b.count-a.count);
}
function memberAnomalyHomeRow(){
 const a=memberDailyPointAnomalies();
 if(!a.length)return ['會員累點','目前未發現單日超過 10 筆','正常','ok','members','查詢'];
 const top=a[0];
 return ['異常累點',`${a.length} 筆異常｜${top.memberName||top.memberId} ${top.date} 共 ${top.count} 筆`,'需查核','warn','members','查看'];
}
function memberPointLedgerPanel(){
 const members=load(K.members,[]);
 const rows=memberPointLedgerEntries();
 return `<div class="panel member-ledger-panel" style="margin-top:14px">
  <div class="page-head"><div><h3>累點紀錄查詢</h3><small>與 POS 點數異動同步；可查消費累點、活動贈點、折抵、退貨扣回與折抵退回。</small></div></div>
  <div class="member-ledger-filters">
   <label>會員<select id="memberLedgerMember"><option value="">全部會員</option>${members.map(m=>`<option value="${esc(m.id)}">${esc(m.name||m.code||m.id)}｜${esc(m.phone||'')}</option>`).join('')}</select></label>
   <label>日期<input id="memberLedgerDate" type="date"></label>
   <label>類型<select id="memberLedgerType"><option value="">全部類型</option>${['消費累點','贈點','折抵','退貨扣回累點','退貨扣回加贈','退貨退回折抵'].map(x=>`<option>${x}</option>`).join('')}</select></label>
   <label>交易序號<input id="memberLedgerTx" placeholder="例如 T178..."></label>
  </div>
  <div class="toolbar"><button class="primary" id="memberLedgerQuery">查詢</button><button class="button" id="memberLedgerClear">清除</button></div>
  <div class="table-wrap"><table class="table"><thead><tr><th>日期時間</th><th>會員</th><th>類型</th><th>點數</th><th>金額</th><th>活動</th><th>來源／交易</th></tr></thead><tbody id="memberLedgerRows">${memberPointLedgerRowsHtml(rows)}</tbody></table></div>
 </div>`;
}
function memberPointLedgerRowsHtml(rows){
 return rows.map(x=>`<tr class="${Number(x.points||0)<0?'tx-closed':''}">
  <td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td>
  <td>${esc(x.memberName||x.memberCode||x.memberId)}<br><small>${esc(x.memberPhone||'')}</small></td>
  <td>${esc(x.type||'')}</td><td><b>${Number(x.points||0)>0?'+':''}${Number(x.points||0)}</b></td>
  <td>${x.amount!==undefined&&x.amount!==null?money(Number(x.amount||0)):'—'}</td>
  <td>${esc(x.campaignName||'—')}</td><td>${esc(x.source||'—')}</td>
 </tr>`).join('')||'<tr><td colspan="7">尚無點數異動紀錄</td></tr>';
}
function bindMemberPointLedger(){
 const run=()=>{
  const mid=document.querySelector('#memberLedgerMember')?.value||'',date=document.querySelector('#memberLedgerDate')?.value||'',
   type=document.querySelector('#memberLedgerType')?.value||'',tx=(document.querySelector('#memberLedgerTx')?.value||'').trim().toLowerCase();
  const rows=memberPointLedgerEntries().filter(x=>(!mid||x.memberId===mid)&&(!date||String(x.at||'').slice(0,10)===date)&&(!type||x.type===type)&&(!tx||String(x.source||'').toLowerCase().includes(tx)));
  const box=document.querySelector('#memberLedgerRows');if(box)box.innerHTML=memberPointLedgerRowsHtml(rows);
 };
 document.querySelector('#memberLedgerQuery')?.addEventListener('click',run);
 document.querySelector('#memberLedgerClear')?.addEventListener('click',()=>{['memberLedgerMember','memberLedgerDate','memberLedgerType','memberLedgerTx'].forEach(id=>{const el=document.querySelector('#'+id);if(el)el.value=''});run()});
}
async function refreshMemberAnomalyCloud(){
 if(!cloudConfigured())return;
 try{await cloudPullKey(K.members);const el=document.querySelector('#memberAnomalyMessage');if(el){const r=memberAnomalyHomeRow();el.innerHTML=`<span class="message-tag">${esc(r[0])}</span><span>${esc(r[1])}</span><span class="message-state ${r[3]}">${esc(r[2])}</span><button class="home-query ${r[3]}" data-nav="members">${esc(r[5])}</button>`;el.querySelector('[data-nav]')?.addEventListener('click',()=>render('members'))}}catch(_e){}
}

function homeStatusRows(){
 const quality=load(K.quality,[]);
 const pendingQuality=quality.filter(x=>!['完成','已下架'].includes(x.status)).length;
 const order=homeOrderReminder();
 const ecReturn=homeEcReturnPendingCount();
 const now=new Date(),mins=now.getHours()*60+now.getMinutes();
 const today=localDateKey();
 const todayRevenue=load(K.revenue,[]).find(x=>x.date===today);
 const revenueDone=!!todayRevenue&&todayRevenue.status==='已傳輸';
 const revenueDue=mins>=10*60&&!revenueDone;
 return [memberAnomalyHomeRow(),
  ['訂購',order.warn?`提醒：${order.text}`:'訂購目前無待處理提醒',order.warn?'未訂／未傳':'正常',order.warn?'warn':'ok','ordering-ledger','訂購業務','orderingAccess'],
  ['營收',revenueDue?'提醒：營收尚未確認傳輸':'10:00 起提醒營收傳輸',revenueDue?'未傳輸':'正常',revenueDue?'warn':'ok','revenue','營收管理','revenueAccess'],
  ['物流',ecReturn?`EC 待退 ${ecReturn} 件尚未處理`:'目前沒有 EC 待退未處理',ecReturn?'待退未處理':'正常',ecReturn?'warn':'ok','ec','EC管理','ecAccess'],
  ['品保',pendingQuality?`品保／時控 ${pendingQuality} 筆尚未處理`:'目前沒有品保待處理',pendingQuality?'品保未處理':'正常',pendingQuality?'warn':'ok','quality','品保／時控','qualityAccess']
 ];
}

function homeDateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function homePlannerEvents(week){
 const dates=new Map(week.map((d,i)=>[homeDateKey(d),i+1]));
 const rows=[];
 for(const n of noticeRows()){
  const col=dates.get(String(n.date||'').slice(0,10)); if(!col)continue;
  rows.push({col,kind:n.priority==='urgent'?'tan':'green',text:n.subject||'通報',type:'notice',id:n.id});
 }
 const vendors=load('yj_vendor_visits',[]); // 廠商到店人員共用資料來源
 for(const v of vendors){const col=dates.get(String(v.date||v.visitDate||'').slice(0,10));if(!col)continue;rows.push({col,kind:'green',text:v.subject||v.vendorName||v.name||'廠商到店',type:'vendor',id:v.id});}
 const perCol={};return rows.map(e=>({...e,row:(perCol[e.col]=(perCol[e.col]||0)+1)}));
}
function homeDateFromKey(key){
 const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!m)return new Date();
 const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
 return Number.isNaN(d.getTime())?new Date():d;
}
function homeSelectedDate(){
 const raw=sessionStorage.getItem('yj_home_selected_date');
 return raw?homeDateFromKey(raw):new Date();
}
function homeCalendarMode(){
 return sessionStorage.getItem('yj_home_calendar_mode')==='day'?'day':'week';
}
function homeWeekForDate(base){
 const start=new Date(base);
 start.setDate(base.getDate()-base.getDay());
 return Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d});
}
function storeOperationsHome(){
 const m=storeHomeMetrics(),today=new Date(),selected=homeSelectedDate(),mode=homeCalendarMode();
 const displayDays=mode==='day'?[new Date(selected)]:homeWeekForDate(selected);
 const week=homeWeekForDate(selected);
 const monthDays=Array.from({length:42},(_,i)=>{const first=new Date(selected.getFullYear(),selected.getMonth(),1),offset=first.getDay();return new Date(selected.getFullYear(),selected.getMonth(),i-offset+1)});
 const events=homePlannerEvents(displayDays);
 const weather=d=>['☁️','☀️','☀️','☀️','☀️','🌦️','☀️'][d.getDay()]||'☀️';
 const selectedKey=homeDateKey(selected), todayKey=homeDateKey(today);
 const monthTitle=`${selected.getMonth()+1} 月`;
 const weekTitle=`${week[0].getMonth()+1}/${week[0].getDate()}－${week[6].getMonth()+1}/${week[6].getDate()}`;
 return `<div class="ref-home-page">
  <div class="ref-home-layout">
   <aside class="ref-home-left">
    <section class="ref-home-card ref-speed-card" data-home-open="operations"><h3>◉ 營收速報</h3><div class="speed-table"><div class="speed-head"><span>欄位</span><span>全店</span><span>會員</span></div><div><span>日商</span><b>${money(m.revenue)}</b><b>${money(m.memberRevenue)}</b></div><div><span>來客數</span><b>${m.customers}人</b><b>${m.memberCustomers}人</b></div><div><span>客單價</span><b>${money(m.avg)}</b><b>${money(m.memberAvg)}</b></div><div class="speed-rate"><span>佔比</span><b>－</b><b>${m.memberRate}%</b></div></div></section>
    <section class="ref-home-card ref-message-card"><h3 data-home-open="notice">◈ 訊息</h3>${homeStatusRows().map(r=>`<div class="ref-home-msg" data-home-open="${r[4]||'notice'}"><b>${esc(r[0])}</b><span>${esc(r[1])}</span><em class="${r[3]}">${esc(r[2])}</em></div>`).join('')}</section>
    <section class="ref-home-card ref-system-card"><h3>◉ 系統訊息 <span class="ref-system-arrows">⌃　⌄</span></h3><div class="ref-system-body">${scHomeSystemMessageHtml()}</div></section>
   </aside>
   <main class="ref-home-center ${mode==='day'?'day-mode':'week-mode'}">
    <div class="ref-home-calendar-tools">
      <div class="ref-home-month-title">${mode==='day'?monthTitle:monthTitle}</div>
      <div class="ref-home-week-tools">
        <button data-home-shift="prev">‹</button>
        <button data-home-shift="next">›</button>
        <button class="${mode==='week'?'active':''}" data-home-mode="week" title="${esc(weekTitle)}">本週</button>
        <button class="${mode==='day'?'active':''}" data-home-mode="day">本日</button>
      </div>
    </div>
    <div class="ref-home-week">${displayDays.map(d=>`<button class="ref-home-day ${homeDateKey(d)===selectedKey?'selected':''}" data-home-date="${homeDateKey(d)}"><small class="weather">${weather(d)}</small><b>${d.getDate()}</b><span>（${'日一二三四五六'[d.getDay()]}）</span><small>農曆${d.getMonth()+1}月${d.getDate()}日　✎</small></button>`).join('')}</div>
    <div class="ref-home-planner">${events.map(e=>`<button class="planner-event ${e.kind}" data-home-event-type="${e.type}" data-home-event-id="${esc(e.id||'')}" style="grid-column:${e.col};grid-row:${e.row}">${esc(e.text)}</button>`).join('')}</div>
    <div class="ref-home-bottom-actions"><button data-home-prebuild="週期性作業">週期性作業</button><button data-home-prebuild="自設提醒">自設提醒</button><button data-home-prebuild="庶務">庶務</button></div>
   </main>
   <aside class="ref-home-right">
    <section class="ref-home-card calendar"><h3>‹　${selected.getMonth()+1}月 ${selected.getFullYear()-1911}　›</h3><div class="calendar-grid">${['日','一','二','三','四','五','六'].map(x=>`<b>${x}</b>`).join('')}${monthDays.map(d=>{const key=homeDateKey(d);return `<button data-home-date="${key}" class="${d.getMonth()===selected.getMonth()?'':'muted'} ${key===todayKey?'today':''} ${key===selectedKey?'selected':''}">${d.getDate()}</button>`}).join('')}</div></section>
    <section class="ref-home-card ref-logistics-card"><h3>◉ 物流到店時間</h3><div id="cloudLogisticsSchedules"><p>讀取中…</p></div></section>
   </aside>
  </div>
 </div>`;
}


function posMemberRows(){return load((typeof K!=='undefined'&&K.members)?K.members:'yj_members',[])}
function posFindMember(q){
 q=String(q||'').trim(); if(!q)return null;
 return posMemberRows().find(m=>[m.phone,m.id,m.memberNo,m.barcode].some(v=>String(v||'').trim()===q))||null;
}
function posMemberPanel(){
 const m=state.member||null;
 return `<div class="pos-member-panel"><div class="pos2-pay-title">會員</div>
 <div class="pos-member-input-row"><input id="posMemberInput" placeholder="手機號碼／會員編號／會員條碼"><button type="button" class="button" id="posMemberSearch">查詢</button></div>
 <div id="posMemberResult">${m?`<b>${esc(m.name||'會員')}</b>　${esc(m.phone||m.memberNo||m.id||'')}`:'本筆尚未綁定會員'}</div>
 ${m?'<button type="button" class="button" id="posMemberClear">移除會員</button>':''}</div>`;
}
function bindPosMemberPanel(){
 const input=document.querySelector('#posMemberInput'), search=document.querySelector('#posMemberSearch');
 if(search)search.onclick=()=>{const m=posFindMember(input?input.value:'');if(!m){alert('找不到會員');return}state.member=m;drawPOS();bindPosMemberPanel()};
 const clear=document.querySelector('#posMemberClear');
 if(clear)clear.onclick=()=>{state.member=null;drawPOS();bindPosMemberPanel()};
 if(input)input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(search)search.click()}};
}



function memberAdminRowsHtml(rows,canEdit=hasPermission('memberEdit'),canDelete=hasPermission('memberDelete')){
 return rows.map(m=>`<tr>
  <td><b>${esc(m.code||m.memberNo||m.id||'')}</b></td>
  <td>${esc(m.name||'')}</td><td>${esc(m.phone||'')}</td><td>${Number(m.points||0)}</td>
  <td>${m.createdAt?new Date(m.createdAt).toLocaleDateString('zh-TW'):'—'}</td>
  <td>${m.updatedAt?new Date(m.updatedAt).toLocaleString('zh-TW'):'—'}</td>
  <td>${canEdit?`<button class="button" data-edit-member="${m.id}">修改</button>`:''} ${canDelete?`<button class="button danger" data-delete-member="${m.id}">刪除</button>`:''}</td>
 </tr>`).join('')||'<tr><td colspan="7">目前沒有會員資料</td></tr>';
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
 const s=pointSettings(),can=hasPermission('memberPointSettings');
 if(!can)return '';
 return `<div class="panel" style="margin-bottom:14px">
  <div class="page-head"><h3>會員累點／折抵設定</h3></div>
  <div class="settings-grid">
   <label>消費金額（元）<input id="pointEarnAmount" type="number" min="1" value="${s.earnAmount}" ${can?'':'disabled'}></label>
   <label>累積點數<input id="pointEarnPoints" type="number" min="0" value="${s.earnPoints}" ${can?'':'disabled'}></label>
   <label>折抵所需點數<input id="pointRedeemPoints" type="number" min="1" value="${s.redeemPoints}" ${can?'':'disabled'}></label>
   <label>可折抵金額（元）<input id="pointRedeemAmount" type="number" min="0" value="${s.redeemAmount}" ${can?'':'disabled'}></label>
  </div>
  <p class="setting-hint">目前規則：${s.earnAmount} 元集 ${s.earnPoints} 點；${s.redeemPoints} 點折抵 ${s.redeemAmount} 元。</p>
  <button class="primary" data-action="save-point-settings" ${can?'':'disabled title="需開啟會員累點／折抵設定權限"'}>儲存點數設定</button>
 </div>`;
}

function allPromotionRows(){return load(K.promotionRules,[])}
function promotionRows(){return allPromotionRows()}
function productLookupPromoActive(row){
 if(!row||row.active===false)return false;
 const today=localDateKey();
 if(row.startDate&&today<String(row.startDate))return false;
 if(row.endDate&&today>String(row.endDate))return false;
 return true;
}
function promotionAutoArrivalOptions(){
 const raw=load(K.promotionAutoArrivalOptions,[]);
 if(Array.isArray(raw))return raw;
 // 舊版／雲端同步異常時，資料可能被包成物件；統一轉回陣列，避免 .filter/.find/.map 直接中斷物流頁。
 if(Array.isArray(raw?.rows))return raw.rows;
 if(Array.isArray(raw?.items))return raw.items;
 if(Array.isArray(raw?.data))return raw.data;
 if(raw&&typeof raw==='object'){
  const rows=Object.values(raw).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  if(rows.length)return rows;
 }
 return [];
}
function normalizePromotionAutoArrivalStorage(){
 const raw=load(K.promotionAutoArrivalOptions,[]);
 if(Array.isArray(raw))return;
 const rows=promotionAutoArrivalOptions();
 save(K.promotionAutoArrivalOptions,rows);
}
normalizePromotionAutoArrivalStorage();

function promotionPage(){
 if(!isFounder()&&!hasPermission('promotionsAccess'))return `<h2>總部商品活動設定</h2><div class="panel"><p>需要「總部商品活動設定」權限。</p></div>`;
 const rows=promotionRows(),canManage=isFounder()||hasPermission('promotionsManage');
 return `<div class="page-head"><div><h2>總部商品活動設定</h2><small>☁️ 全門市共用</small></div><div class="toolbar">${isFounder()?'<button class="button" data-action="promotion-auto-arrival-settings">活動商品自動到店選項設定</button>':''}${canManage?'<button class="primary" data-action="new-promotion">＋ 新增活動</button>':''}</div></div>
 <div class="panel table-wrap"><table class="table"><thead><tr><th>活動名稱</th><th>活動類型</th><th>商品／品群</th><th>條件</th><th>自動到店</th><th>期間</th><th>狀態</th><th>操作</th></tr></thead><tbody>
 ${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.type)}</td><td>${esc(x.targetLabel||'')}</td><td>${esc(x.summary||'')}</td><td>${esc(x.autoArrivalOptionLabel||'不套用')}</td><td>${esc(x.startDate||'')}～${esc(x.endDate||'')}</td><td>${x.active===false?'停用':'啟用'}</td><td>${canManage?`<button class="button" data-edit-promotion="${x.id}">修改</button> <button class="button danger" data-delete-promotion="${x.id}">刪除</button>`:'僅查看'}</td></tr>`).join('')||'<tr><td colspan="8">尚無活動</td></tr>'}
 </tbody></table></div>`;
}
function openPromotionForm(existing=null){
 const x=existing||{};
 const ps=products().filter(p=>p.active!==false&&p.status!=='停用');
 const groups=load(K.productGroups,[]);
 const targetOptions=(targetType,current='')=>{
  const list=targetType==='品群'
   ?groups.map(g=>({value:g,label:g}))
   :ps.map(p=>({value:String(p.code||''),label:`${p.code||''}｜${p.name||''}`}));
  const hasCurrent=list.some(o=>String(o.value)===String(current||''));
  return `${current&&!hasCurrent?`<option value="${esc(current)}" selected>${esc(current)}（既有設定）</option>`:''}<option value="">請選擇${targetType==='品群'?'品群':'商品'}</option>${list.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(current||'')?'selected':''}>${esc(o.label)}</option>`).join('')}`;
 };
 const initialTargetType=x.targetType==='品群'?'品群':'商品';
 dlg(existing?'修改商品活動':'新增商品活動',`
  <label>活動名稱<input id="promoName" value="${esc(x.name||'')}"></label>
  <label>活動類型<select id="promoType">${['買一送一','第2件折扣','多件折扣','固定組合價'].map(v=>`<option ${x.type===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label>套用範圍<select id="promoTargetType"><option ${initialTargetType==='商品'?'selected':''}>商品</option><option ${initialTargetType==='品群'?'selected':''}>品群</option></select></label>
  <label>商品代號／品群<select id="promoTarget">${targetOptions(initialTargetType,x.target||'')}</select></label>
  <div class="settings-grid">
   <label>購買件數<input id="promoQty" type="number" min="1" value="${x.qty||2}"></label>
   <label>折扣比例（例如 0.6=6折）<input id="promoRate" type="number" min="0" max="1" step="0.01" value="${x.rate??1}"></label>
   <label>固定優惠價（選填）<input id="promoFixed" type="number" min="0" value="${x.fixedPrice??''}"></label>
  </div>
  <div class="settings-grid">
   <label>開始日期<input id="promoStart" type="date" value="${esc(x.startDate||'')}"></label>
   <label>結束日期<input id="promoEnd" type="date" value="${esc(x.endDate||'')}"></label>
  </div>
  <label>活動商品自動到店<select id="promoAutoArrival" ${isFounder()?'':'disabled title="只有創辦人可以設定"'}><option value="">不套用</option>${promotionAutoArrivalOptions().map(o=>`<option value="${esc(o.id)}" ${String(x.autoArrivalOptionId||'')===String(o.id)?'selected':''}>${esc(o.name)}</option>`).join('')}</select>${isFounder()?'':'<small>只有創辦人可以修改自動到店設定</small>'}</label>
  <label class="check-field"><input id="promoActive" type="checkbox" ${x.active===false?'':'checked'}>啟用活動</label>
  <button class="primary" id="promoSave">儲存活動</button>`);
 setTimeout(()=>{
  const refreshTargetOptions=()=>{
   const keep=promoTarget.value;
   promoTarget.innerHTML=targetOptions(promoTargetType.value,keep);
   if(![...promoTarget.options].some(o=>o.value===keep))promoTarget.value='';
  };
  promoTargetType.onchange=()=>{promoTarget.innerHTML=targetOptions(promoTargetType.value,'');};
  promoSave.onclick=()=>{
   const rows=allPromotionRows();
   const type=promoType.value,qty=Math.max(1,Number(promoQty.value||1)),rate=Number(promoRate.value||1),fixed=promoFixed.value===''?null:Number(promoFixed.value);
   const summary= type==='買一送一'?`買 ${qty} 件，其中 1 件免費`
    : type==='第2件折扣'?`第 2 件 ${Math.round(rate*10)} 折`
    : type==='多件折扣'?`${qty} 件 ${Math.round(rate*10)} 折`
    : `${qty} 件 ${money(fixed||0)}`;
   const row={
    id:x.id||uid(),name:promoName.value.trim()||'未命名活動',type,targetType:promoTargetType.value,
    target:promoTarget.value.trim(),targetLabel:`${promoTargetType.value}：${promoTarget.value.trim()}`,
    qty,rate,fixedPrice:fixed,startDate:promoStart.value,endDate:promoEnd.value,active:promoActive.checked,summary,
    autoArrivalOptionId:promoAutoArrival.value,autoArrivalOptionLabel:(promotionAutoArrivalOptions().find(o=>o.id===promoAutoArrival.value)?.name||'不套用'),
    updatedAt:new Date().toISOString(),user:currentUser()?.name||''
   };
   const i=rows.findIndex(r=>r.id===row.id);if(i>=0)rows[i]=row;else rows.unshift(row);
   save(K.promotionRules,rows);saveAudit('商品活動設定',`${row.name}｜${row.summary}`);
   genericDialog.close();render('promotions');
  };
 },0);
}


function promotionAutoArrivalDelivery(product,selected){
 const label=selected==='依商品配送別'?normalizeDeliveryLabel(product?.deliveryType||product?.logistics||'常溫'):normalizeDeliveryLabel(selected||'常溫');
 return label||'常溫';
}
function promotionAutoArrivalGroupInfo(row,product){
 const storeCode=String(getCloudConfig?.()?.storeId||'001').trim()||'001';
 const delivery=promotionAutoArrivalDelivery(product,row?.deliveryType);
 const timing=String(row?.timingLabel||(row?.timing==='before_start'?`活動開始前 ${Math.max(0,Number(row?.beforeDays||0))} 天到店`:'活動開始日到店')).trim();
 const activity=String(row?.name||'活動商品').trim()||'活動商品';
 const arrivalDate=String(row?.arrivalDate||localDateKey()).trim()||localDateKey();
 const deliveryRun=String(row?.deliveryRun||'DEFAULT').trim()||'DEFAULT';
 // Alpha 5.59：活動名稱、供應商、routeCode、來源批號只留在來源/明細，不再當拆單 key。
 const groupKey=[storeCode,arrivalDate,delivery,deliveryRun].join('|');
 return {storeCode,delivery,timing,activity,arrivalDate,deliveryRun,groupKey,externalRef:`活動到店｜${activity}｜${arrivalDate}｜${delivery}｜${logisticsRunLabel(deliveryRun)}`};
}
async function syncPromotionAutoArrivalToLogistics(row,product){
 if(!isFounder())throw new Error('此功能只有創辦人可以使用');
 if(!cloudConfigured())throw new Error('尚未設定 Supabase，無法同步物流／庫存');
 const group=promotionAutoArrivalGroupInfo(row,product);
 const delivery=group.delivery;
 const multiple=Math.max(1,Number(product?.orderMultipleQty||1));
 const multipleCount=Math.max(1,Number(row.multipleCount||row.qty||1));
 const actualQty=multiple*multipleCount;
 const notes=`活動商品自動到店；自動歸類完成；群組 ${group.groupKey}；商品 ${product?.code||''} ${product?.name||''}；${multipleCount}倍 × 每倍${multiple}個 = ${actualQty}個；${group.timing}；同步物流與庫存；不列入一般訂購單`;
 const r=await adminCreatePromotionAutoArrival({
  activityName:row.name,deliveryType:delivery,deliveryDate:group.arrivalDate,deliveryRun:group.deliveryRun,externalRef:group.externalRef,notes,
  productId:product?.id||'',productCode:product?.code||'',barcode:product?.barcode||'',productName:product?.name||'',qty:actualQty,
  supplierCode:product?.supplierCode||product?.supplier_code||product?.vendorCode||'',supplierName:product?.supplierName||product?.supplier_name||product?.vendorName||product?.supplier||'',
  storeCode:group.storeCode,operator:currentUser()?.name||''
 });
 return {batchNo:r?.batch_no||'',receiptNo:r?.receipt_no||'',deliveryType:delivery,arrivalDate:group.arrivalDate,deliveryRun:group.deliveryRun,syncedAt:new Date().toISOString(),multiple,multipleCount,actualQty,groupKey:group.groupKey,groupExternalRef:group.externalRef,groupStatus:'自動歸類完成'};
}
function openPromotionAutoArrivalSettings(){
 if(!isFounder())return alert('此功能只有創辦人可以使用');
 const rows=promotionAutoArrivalOptions();
 dlg('活動商品自動到店選項設定',`
  <div class="toolbar" style="margin-bottom:12px"><button class="primary" id="promoArrivalAdd">＋ 新增活動到店設定</button></div>
  <div class="panel table-wrap"><table class="table"><thead><tr><th>活動名稱</th><th>商品</th><th>到店時點</th><th>到店倍數</th><th>實際數量</th><th>配送別</th><th>物流／進貨</th><th>操作</th></tr></thead><tbody>
  ${rows.map(o=>`<tr><td>${esc(o.name)}</td><td>${esc(o.productLabel||o.productCode||'—')}</td><td>${esc(o.timingLabel||'活動開始日到店')}</td><td>${Number(o.multipleCount||o.qty||1)} 倍</td><td>${Number(o.actualQty||0)} 個</td><td>${esc(o.deliveryType||'依商品配送別')}</td><td>${esc(o.batchNo||'尚未同步')}${o.receiptNo?`<br><small>${esc(o.receiptNo)}</small>`:''}${o.groupStatus?`<br><small>✅ ${esc(o.groupStatus)}</small>`:''}</td><td><button class="button" data-arrival-edit="${o.id}">修改</button> <button class="button danger" data-arrival-delete="${o.id}">刪除</button></td></tr>`).join('')||'<tr><td colspan="8">尚無活動商品自動到店設定</td></tr>'}
  </tbody></table></div><p class="setting-hint">此功能直接同步物流，不會建立一般訂購單。只有創辦人可以新增、修改、刪除。</p>`);
 setTimeout(()=>{
  promoArrivalAdd.onclick=()=>openPromotionAutoArrivalForm();
  genericDialog.querySelectorAll('[data-arrival-edit]').forEach(b=>b.onclick=()=>{const o=promotionAutoArrivalOptions().find(x=>x.id===b.dataset.arrivalEdit);if(o)openPromotionAutoArrivalForm(o)});
  genericDialog.querySelectorAll('[data-arrival-delete]').forEach(b=>b.onclick=async()=>{
   if(!isFounder())return alert('此功能只有創辦人可以使用');
   if(!confirm('確定刪除此活動商品自動到店設定？既有活動會改為不套用。'))return;
   const id=b.dataset.arrivalDelete;
   const old=promotionAutoArrivalOptions().find(x=>x.id===id);
   if(old?.batchNo&&cloudConfigured()){
    try{await adminDeleteInvalidLogisticsBatch(old.batchNo)}catch(e){if(!confirm(`物流批次 ${old.batchNo} 無法自動刪除（可能已簽到或已有關聯）。\n仍要只刪除活動到店設定嗎？`))return;}
   }
   save(K.promotionAutoArrivalOptions,promotionAutoArrivalOptions().filter(x=>x.id!==id));
   const promos=promotionRows();let changed=false;
   promos.forEach(p=>{if(p.autoArrivalOptionId===id){p.autoArrivalOptionId='';p.autoArrivalOptionLabel='不套用';changed=true}});
   if(changed)save(K.promotionRules,promos);
   saveAudit('活動商品自動到店設定刪除',`${old?.name||id}｜${old?.productLabel||''}｜${old?.batchNo||''}`);
   openPromotionAutoArrivalSettings();
  });
 },0);
}
function openPromotionAutoArrivalForm(existing=null){
 if(!isFounder())return alert('此功能只有創辦人可以使用');
 const x=existing||{};
 const timing=x.timing||'start_day';
 // 活動自動到店不看商品訂購日，也不經訂購傳輸；只排除已停用商品。
 const ps=products().filter(p=>p.active!==false&&p.status!=='停用');
 const productPicker=existing
  ?`<label>商品<select id="arrivalProduct"><option value="">請選擇商品</option>${ps.map(p=>`<option value="${esc(p.id)}" ${String(x.productId||'')===String(p.id)?'selected':''}>${esc(p.code||'')}｜${esc(p.name||'')}</option>`).join('')}</select></label>`
  :`<div class="panel" style="padding:14px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>商品（可一次勾選多個）</b><span id="arrivalSelectedCount" style="font-weight:700;color:#d96b00">已選 0 項</span></div><input id="arrivalProductSearch" placeholder="搜尋商品代號或名稱" style="width:100%;margin:10px 0 8px"><div class="toolbar" style="margin:0 0 10px"><button type="button" class="button" id="arrivalSelectAll">全選目前結果</button><button type="button" class="button" id="arrivalClearAll">清除全部</button></div><div id="arrivalProductList" style="max-height:360px;overflow:auto;border:1px solid #e8e2dc;border-radius:12px;background:#fff">${ps.map(p=>`<label data-arrival-product-row="${esc(p.id)}" data-arrival-search="${esc(`${p.code||''} ${p.name||''}`.toLowerCase())}" style="display:grid;grid-template-columns:30px minmax(90px,120px) minmax(180px,1fr) minmax(100px,140px) minmax(90px,120px) minmax(90px,120px);gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid #f0ece8;cursor:pointer"><input type="checkbox" data-arrival-product-check="${esc(p.id)}"><b>${esc(p.code||'—')}</b><span>${esc(p.name||'—')}</span><small>${esc(normalizeDeliveryLabel(p.deliveryType||p.logistics||'未設定配送別'))}</small><small>1倍 ${Math.max(1,Number(p.orderMultipleQty||1))} 個</small><small>庫存 ${Number(p.stock??p.inventory??0)}</small></label>`).join('')}</div><small style="display:block;margin-top:8px;color:#777">已選商品會自動移到最上方；清單可上下滑動。</small></div>`;
 dlg(existing?'修改活動商品自動到店設定':'新增活動商品自動到店設定',`
  <label>活動名稱<input id="arrivalName" value="${esc(x.name||'')}"></label>
  ${productPicker}
  <label>到店時點<select id="arrivalTiming">
   <option value="start_day" ${timing==='start_day'?'selected':''}>活動開始日到店</option>
   <option value="before_start" ${timing==='before_start'?'selected':''}>活動開始前 N 天到店</option>
  </select></label>
  <div class="settings-grid">
   <label>實際到貨日<input id="arrivalDate" type="date" value="${esc(x.arrivalDate||localDateKey())}"></label>
   <label>配次／配送批次<input id="arrivalRun" value="${esc(x.deliveryRun&&x.deliveryRun!=='DEFAULT'?x.deliveryRun:'')}" placeholder="無特殊配次可留空"></label>
   <label>提前天數<input id="arrivalBeforeDays" type="number" min="0" value="${Number(x.beforeDays||0)}"></label>
   <label>到店倍數<input id="arrivalQty" type="number" min="1" value="${Math.max(1,Number(x.multipleCount||x.qty||1))}"><small>每個勾選商品各自依商品管理的「1倍數量」計算</small></label>
  </div>
  <div class="notice" id="arrivalProductSyncInfo">活動商品不受可訂購日限制，不建立訂購單、不經訂購傳輸，儲存後直接同步物流；同門市／同活動／同到店時點／同溫層會自動歸類在同一張貨單。</div>
  <label>配送別<select id="arrivalDeliveryType">${['依商品配送別','常溫','鮮食一配','鮮食二配','低溫一配','低溫二配','冷凍','億家通'].map(v=>`<option ${String(x.deliveryType||'依商品配送別')===v?'selected':''}>${v}</option>`).join('')}</select></label>
  ${x.batchNo?`<div class="notice">目前物流批次：<b>${esc(x.batchNo)}</b><br><small>修改並儲存後會重新同步此商品；舊批次若仍為無關聯待簽到狀態會先嘗試移除。</small></div>`:''}
  <button class="primary" id="arrivalSave">${existing?'儲存並同步物流':'一次新增並同步物流'}</button>`);
 setTimeout(()=>{
  const syncDays=()=>{arrivalBeforeDays.disabled=arrivalTiming.value!=='before_start'};syncDays();arrivalTiming.onchange=syncDays;
  const checks=[...genericDialog.querySelectorAll('[data-arrival-product-check]')];
  const selectAll=genericDialog.querySelector('#arrivalSelectAll'),clearAll=genericDialog.querySelector('#arrivalClearAll');
  const productSearch=genericDialog.querySelector('#arrivalProductSearch'),productList=genericDialog.querySelector('#arrivalProductList'),selectedCount=genericDialog.querySelector('#arrivalSelectedCount');
  const refreshProductPicker=()=>{
   const q=String(productSearch?.value||'').trim().toLowerCase();
   const rows=[...(productList?.querySelectorAll('[data-arrival-product-row]')||[])];
   rows.forEach(row=>{row.style.display=!q||String(row.dataset.arrivalSearch||'').includes(q)?'grid':'none'});
   rows.sort((a,b)=>{
    const ac=a.querySelector('[data-arrival-product-check]')?.checked?1:0,bc=b.querySelector('[data-arrival-product-check]')?.checked?1:0;
    if(ac!==bc)return bc-ac;
    return String(a.querySelector('b')?.textContent||'').localeCompare(String(b.querySelector('b')?.textContent||''),'zh-Hant');
   }).forEach(row=>productList?.appendChild(row));
   if(selectedCount)selectedCount.textContent=`已選 ${checks.filter(x=>x.checked).length} 項`;
  };
  if(productSearch)productSearch.oninput=refreshProductPicker;
  if(selectAll)selectAll.onclick=()=>{checks.forEach(x=>{const row=x.closest('[data-arrival-product-row]');if(!row||row.style.display!=='none')x.checked=true});refreshProductPicker();refreshProductSyncInfo?.()};
  if(clearAll)clearAll.onclick=()=>{checks.forEach(x=>x.checked=false);refreshProductPicker();refreshProductSyncInfo?.()};
  const refreshProductSyncInfo=()=>{
   const selected=existing?[ps.find(v=>String(v.id)===String(genericDialog.querySelector('#arrivalProduct')?.value||''))].filter(Boolean):checks.filter(x=>x.checked).map(x=>ps.find(p=>String(p.id)===String(x.dataset.arrivalProductCheck))).filter(Boolean);
   if(!selected.length){arrivalProductSyncInfo.innerHTML='活動商品不受可訂購日限制，不建立訂購單、不經訂購傳輸，儲存後直接同步物流；同溫層自動歸類同一張貨單。';return;}
   const c=Math.max(1,Number(arrivalQty.value||1));
   arrivalProductSyncInfo.innerHTML=`已選 ${selected.length} 個商品｜${selected.map(p=>`${esc(p.code||'')} ${esc(p.name||'')}：${c}倍 = <b>${Math.max(1,Number(p.orderMultipleQty||1))*c}</b>個`).join('<br>')}<br><small>儲存後直接同步物流；不受可訂購日／傳輸截止影響。</small>`;
  };
  if(existing)arrivalProduct.onchange=refreshProductSyncInfo;else checks.forEach(x=>x.onchange=()=>{refreshProductPicker();refreshProductSyncInfo()});
  arrivalQty.oninput=refreshProductSyncInfo;refreshProductSyncInfo();refreshProductPicker();
  arrivalSave.onclick=async()=>{
   if(!isFounder())return alert('此功能只有創辦人可以使用');
   const selectedProducts=existing?[ps.find(p=>String(p.id)===String(genericDialog.querySelector('#arrivalProduct')?.value||''))].filter(Boolean):checks.filter(x=>x.checked).map(x=>ps.find(p=>String(p.id)===String(x.dataset.arrivalProductCheck))).filter(Boolean);
   if(!arrivalName.value.trim())return alert('請輸入活動名稱');
   if(!selectedProducts.length)return alert('請至少選擇一個商品');
   const btn=arrivalSave;btn.disabled=true;btn.textContent=`同步物流中（0/${selectedProducts.length}）…`;
   const timing=arrivalTiming.value,beforeDays=Math.max(0,Number(arrivalBeforeDays.value||0)),multipleCount=Math.max(1,Number(arrivalQty.value||1));
   let success=0;const allRows=promotionAutoArrivalOptions();
   try{
    if(existing&&x.batchNo&&cloudConfigured()){try{await adminDeleteInvalidLogisticsBatch(x.batchNo)}catch{}}
    for(const product of selectedProducts){
     const productMultiple=Math.max(1,Number(product.orderMultipleQty||1)),actualQty=multipleCount*productMultiple;
     const row={id:existing?(x.id||uid()):uid(),name:arrivalName.value.trim(),productId:product.id,productCode:product.code||'',productName:product.name||'',productLabel:`${product.code||''}｜${product.name||''}`,timing,beforeDays,multipleCount,qty:multipleCount,productMultiple,actualQty,deliveryType:arrivalDeliveryType.value,arrivalDate:String(genericDialog.querySelector('#arrivalDate')?.value||localDateKey()),deliveryRun:String(genericDialog.querySelector('#arrivalRun')?.value||'').trim()||'DEFAULT',timingLabel:timing==='before_start'?`活動開始前 ${beforeDays} 天到店`:'活動開始日到店',updatedAt:new Date().toISOString(),user:currentUser()?.name||'',batchNo:existing?(x.batchNo||''):'',receiptNo:existing?(x.receiptNo||''):'',logisticsDeliveryType:existing?(x.logisticsDeliveryType||''):'',logisticsSyncedAt:existing?(x.logisticsSyncedAt||''):''};
     const sync=await syncPromotionAutoArrivalToLogistics(row,product);
     row.batchNo=sync.batchNo;row.receiptNo=sync.receiptNo;row.logisticsDeliveryType=sync.deliveryType;row.arrivalDate=sync.arrivalDate||row.arrivalDate;row.deliveryRun=sync.deliveryRun||row.deliveryRun;row.logisticsSyncedAt=sync.syncedAt;row.productMultiple=sync.multiple;row.multipleCount=sync.multipleCount;row.actualQty=sync.actualQty;row.groupKey=sync.groupKey||'';row.groupExternalRef=sync.groupExternalRef||'';row.groupStatus=sync.groupStatus||'自動歸類完成';
     const i=allRows.findIndex(r=>r.id===row.id);if(i>=0)allRows[i]=row;else allRows.unshift(row);save(K.promotionAutoArrivalOptions,allRows);
     success++;btn.textContent=`同步物流中（${success}/${selectedProducts.length}）…`;
    }
    saveAudit(existing?'活動商品自動到店設定修改':'活動商品自動到店批次新增',`${arrivalName.value.trim()}｜${success}個商品｜${timing==='before_start'?`提前${beforeDays}天`:'活動開始日'}｜${multipleCount}倍｜不經訂購傳輸｜同溫層自動歸類`);
    alert(`${success} 個商品已完成活動到店設定並直接同步物流。`);openPromotionAutoArrivalSettings();
   }catch(e){alert(`儲存／物流同步失敗：${e.message}\n已完成 ${success}/${selectedProducts.length} 個商品，成功的項目已保留。`);btn.disabled=false;btn.textContent=existing?'儲存並同步物流':'一次新增並同步物流';}
  };
 },0);
}

function systemSettingsPage(){
 const s=load(K.systemSettings,{shifts:{早班:{start:'07:00',end:'15:00'},晚班:{start:'15:00',end:'23:00'},大夜班:{start:'23:00',end:'07:00'}},reserveCash:0,powerSavingIdleMinutes:5});
 const shifts=s.shifts||{},canShift=hasPermission('systemShiftSettings'),canTime=hasPermission('systemShiftTimeSettings'),canReserve=hasPermission('systemReserveCashSettings'),canCloud=hasPermission('cloudRemoteSync'),canVersion=hasPermission('systemVersion'),canPowerSaving=isFounder();
 const powerSavingIdle=Math.min(120,Math.max(1,Number(s.powerSavingIdleMinutes||5)));
 return `<div class="page-head"><h2>雲端與更新</h2></div>
 ${(canShift||canTime)?`<div class="panel" style="margin-top:14px"><h3>班別設定</h3><div class="settings-grid">${['早班','晚班','大夜班'].map(n=>`<fieldset><legend>${n}</legend>${canShift?`<label>班別名稱<input data-shift-name="${n}" value="${n}"></label>`:''}${canTime?`<label>開始<input type="time" data-shift-start="${n}" value="${esc(shifts[n]?.start||'')}"></label><label>結束<input type="time" data-shift-end="${n}" value="${esc(shifts[n]?.end||'')}"></label>`:''}</fieldset>`).join('')}</div></div>`:''}
 ${canReserve?`<div class="panel" style="margin-top:14px"><h3>店舖預留金</h3><label>預留金額<input id="reserveCashSetting" type="number" min="0" value="${Number(s.reserveCash||0)}"></label></div>`:''}
 ${canPowerSaving?`<div class="panel" style="margin-top:14px"><h3>TM 省電模式時間</h3><p class="setting-hint">只有創辦人可設定。X Mode 開啟省電模式後，TM 無操作達到此時間才暗屏；客顯上半部切換廣告輪播。</p><label>閒置時間（分鐘）<input id="powerSavingIdleMinutesSetting" type="number" min="1" max="120" step="1" value="${powerSavingIdle}"></label></div>`:''}
 ${(canShift||canTime||canReserve||canPowerSaving)?'<div class="toolbar" style="margin-top:14px"><button class="primary" data-action="save-system-settings">儲存系統設定</button></div>':''}
 ${canCloud?cloudSyncPanel():''}
 ${canVersion?`<div class="panel" style="margin-top:14px"><h3>系統版本</h3><p>SC版本：<b>${esc(window.YIJIA_BUILD?.version||'v5.5.0 SC Alpha 4.63')}</b></p><p class="setting-hint">網站版本由 GitHub → Vercel 自動部署。</p><button class="button" data-action="reload-latest">重新載入最新版</button></div>`:''}`;
}
async function saveSystemSettings(){
 const old=load(K.systemSettings,{shifts:{早班:{start:'07:00',end:'15:00'},晚班:{start:'15:00',end:'23:00'},大夜班:{start:'23:00',end:'07:00'}},reserveCash:0,powerSavingIdleMinutes:5});
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
 let powerSavingIdleMinutes=Number(old.powerSavingIdleMinutes||5);
 if(isFounder()){
  powerSavingIdleMinutes=Math.round(Number(document.querySelector('#powerSavingIdleMinutesSetting')?.value||5));
  if(!Number.isFinite(powerSavingIdleMinutes)||powerSavingIdleMinutes<1||powerSavingIdleMinutes>120)return alert('省電模式閒置時間請設定 1～120 分鐘');
 }
 const s={...old,shifts,reserveCash,powerSavingIdleMinutes,updatedAt:new Date().toISOString()};
 save(K.systemSettings,s);
 if(cloudConfigured()){try{await cloudPushKey(K.systemSettings,s)}catch(err){console.warn('省電模式時間同步 TM 失敗，已保留本機設定',err)}}
 saveAudit('系統設定',`班別／時間／店舖預留金依權限異動${isFounder()?`｜TM省電 ${powerSavingIdleMinutes} 分鐘`:''}`);
 alert(isFounder()?`系統設定已儲存\nTM 省電模式：閒置 ${powerSavingIdleMinutes} 分鐘`:'系統設定已儲存');
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
  <fieldset class="member-bonus-payment-box"><legend>指定支付方式</legend>
   <div class="member-bonus-payment-options">
    ${(()=>{const current=Array.isArray(x.paymentMethods)&&x.paymentMethods.length?x.paymentMethods:[x.paymentMethod||'不限'];return ['不限','億家Pay','現金','信用卡','行動支付','電子票證','禮物卡'].map(v=>`<label class="check-field member-bonus-payment-option"><input type="checkbox" data-mb-payment="${esc(v)}" ${current.includes(v)?'checked':''}>${esc(v)}</label>`).join('')})()}
   </div>
   <small class="setting-hint">可同時勾選多個支付方式；勾選「不限」時代表所有支付方式都適用。</small>
  </fieldset>
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
 setTimeout(()=>{
  document.querySelectorAll('[data-mb-payment]').forEach(el=>el.addEventListener('change',()=>{
   const v=String(el.dataset.mbPayment||'');
   if(v==='不限'&&el.checked)document.querySelectorAll('[data-mb-payment]').forEach(x=>{if(x!==el)x.checked=false});
   else if(v!=='不限'&&el.checked){const all=document.querySelector('[data-mb-payment="不限"]');if(all)all.checked=false}
  }));
  mbSave.onclick=async()=>{
  const rows=memberBonusCampaignRows();
  const category=mbCategory.value;
  const minSpend=Math.max(0,Number(mbMinSpend.value||0));
  const bonusPoints=Math.max(0,Number(mbBonusPoints.value||0));
  let paymentMethods=[...document.querySelectorAll('[data-mb-payment]:checked')].map(el=>String(el.dataset.mbPayment||'').trim()).filter(Boolean);
  if(paymentMethods.includes('不限'))paymentMethods=['不限'];
  if(!paymentMethods.length)paymentMethods=['不限'];
  const paymentMethod=paymentMethods.length===1?paymentMethods[0]:paymentMethods.join('、');
  const target=mbTarget.value.trim();
  let summary='';
  if(category==='新會員加入') summary=`新會員加入加贈 ${bonusPoints} 點`;
  else if(category==='指定支付方式滿額') summary=`${paymentMethods.join('／')} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else if(category==='指定商品消費') summary=`商品 ${target||'未指定'} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else if(category==='指定品群消費') summary=`品群 ${target||'未指定'} 消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;
  else summary=`消費滿 ${money(minSpend)} 加贈 ${bonusPoints} 點`;

  const row={
   id:x.id||uid(),
   name:mbName.value.trim()||'未命名贈點活動',
   category,startDate:mbStart.value,endDate:mbEnd.value,minSpend,bonusPoints,
   paymentMethods,paymentMethod,target,expiryType:mbExpiryType.value,
   expiryDays:Math.max(1,Number(mbExpiryDays.value||30)),
   expiryDate:mbExpiryDate.value,note:mbNote.value.trim(),active:mbActive.checked,
   summary,updatedAt:new Date().toISOString(),user:currentUser()?.name||''
  };
  const i=rows.findIndex(r=>r.id===row.id);if(i>=0)rows[i]=row;else rows.unshift(row);
  save(K.memberBonusCampaigns,rows);
  if(cloudConfigured()){
   try{await cloudPushKey(K.memberBonusCampaigns,rows)}
   catch(err){console.warn('會員贈點活動同步失敗',err);alert('活動已儲存在本機，但雲端同步失敗，請稍後重新同步')}
  }
  saveAudit('會員贈點活動設定',`${row.name}｜${row.summary}`);
  genericDialog.close();render('member-bonus-settings');
  };
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



function saleRemainingForMemberRules(sale){
 const total=Math.max(0,Number(sale?.netTotal??sale?.total??0));
 const items=(sale?.items||[]).map(x=>({...x,qty:Math.max(0,Number(x.qty||0)-Number(x.returnedQty||0))})).filter(x=>Number(x.qty||0)>0);
 return {...sale,total,netTotal:total,items};
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
  <p class="setting-hint">同步店號自動跟隨目前門市。全店共用：商品管理 2.0 主檔（庫存除外）、總部商品活動、會員管理；其餘資料各店獨立。本機仍保留離線快取。</p>
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


const logisticsCloudLabels={ambient:'常溫',fresh_1:'鮮食一配',fresh_2:'鮮食二配',dairy:'低溫一配',low_1:'低溫一配',low_2:'低溫二配',frozen:'冷凍',ec:'EC（億家通）',yijiatong:'億家通','億家通':'億家通'};
const logisticsStatusLabels={
 pending:'待簽到',
 expected:'預計進貨',
 inbound:'進貨中',
 transmitted:'已傳輸',
 transmit:'已傳輸',
 synced:'已同步',
 arrived:'已到店',
 received:'已收貨',
 accepted:'已驗收',
 checked:'已驗收',
 completed:'已完成',
 done:'已完成',
 cancelled:'已取消',
 canceled:'已取消',
 rejected:'已退回',
 returning:'退貨中',
 returned:'已退貨'
};
function logisticsStatusZh(value){
 const raw=String(value??'').trim();
 if(!raw)return '—';
 const key=raw.toLowerCase();
 return logisticsStatusLabels[key]||ecCloudStatusLabels?.[raw]||raw;
}

let __adminLogisticsReferenceRows=[];
let __adminLogisticsReferenceReceipts=[];
let __adminLogisticsReferenceEcPackages=[];
let __adminSelectedLogisticsBatch='';
function logisticsReferenceStats(batch,receipt){
 receipt=receipt||fallbackReceiptForBatch(batch);
 const items=receipt?receiptDetailItems(receipt,batch?.batch_no||'',receipt?.receipt_no||''):[];
 const lineCount=items.length;
 let corrected=0,total=0,taxable=null,exempt=null;
 if(items.length){
  let taxSum=0,exemptSum=0,hasTaxInfo=false;
  items.forEach(item=>{
   const p=receiptItemProduct(item);
   const qty=Number(receiptVal(item,['accepted_qty','received_qty','checked_qty','actual_qty','notice_qty','ordered_qty','qty'],0))||0;
   const notified=Number(receiptVal(item,['notice_qty','logistics_qty','shipped_qty','ordered_qty','qty'],qty))||0;
   if(qty!==notified)corrected++;
   const price=Number(receiptVal(item,['price','sale_price','unit_price'],p.price||0))||0;
   const amount=price*qty; total+=amount;
   const tax=String(item.taxType||item.tax_type||p.taxType||p.tax_type||'').toLowerCase();
   if(tax){
    hasTaxInfo=true;
    if(/免|exempt|zero/.test(tax))exemptSum+=amount;else taxSum+=amount;
   }
  });
  if(hasTaxInfo){taxable=taxSum;exempt=exemptSum}
 }
 return {lineCount,corrected,total,taxable,exempt};
}

const LOGISTICS_RECEIPT_VISIBILITY_KEY='yj_logistics_receipt_visibility_settings';

function logisticsReceiptVisibilityDefaults(){
 return {
  ambient:{label:'常溫',showDay:'previous',time:'00:00'},
  frozen:{label:'冷凍',showDay:'previous',time:'00:00'},
  low_2:{label:'低溫二配',showDay:'previous',time:'00:00'},
  fresh_2:{label:'鮮食二配',showDay:'previous',time:'00:00'},
  dairy:{label:'低溫一配',showDay:'same',time:'00:00'},
  fresh_1:{label:'鮮食一配',showDay:'same',time:'00:00'},
  yijiatong:{label:'億家通',showDay:'same',time:'00:00'}
 };
}
function logisticsReceiptVisibilityAllSettings(){
 const raw=load(LOGISTICS_RECEIPT_VISIBILITY_KEY,{})||{};
 // Alpha 5.05 舊格式是直接以配別為 key；升級時保留為總店 001 設定。
 const legacyKeys=Object.keys(logisticsReceiptVisibilityDefaults());
 if(!raw.stores&&legacyKeys.some(k=>raw[k]))return {stores:{'001':raw}};
 return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{stores:{}};
}
function logisticsReceiptVisibilitySettings(storeCode=currentStoreCode()){
 const defaults=logisticsReceiptVisibilityDefaults();
 const all=logisticsReceiptVisibilityAllSettings();
 const saved=(all.stores&&all.stores[String(storeCode||'001')])||{};
 const out={};
 for(const [type,base] of Object.entries(defaults)){
  const row=saved[type]||{};
  out[type]={
   ...base,
   showDay:['previous','same'].includes(String(row.showDay||''))?String(row.showDay):base.showDay,
   time:/^\d{2}:\d{2}$/.test(String(row.time||''))?String(row.time):base.time
  };
 }
 return out;
}
function logisticsSettingStoreRows(){
 const rows=(load(K.stores,[])||[]).filter(x=>x&&x.active!==false&&String(x.code||'').trim());
 if(rows.length)return rows.sort((a,b)=>String(a.code).localeCompare(String(b.code)));
 return [{code:currentStoreCode(),name:store()?.name||'目前門市',active:true}];
}
function canConfigureLogisticsStoreSettings(){
 return isHeadOffice()&&hasPermission('logisticsEdit');
}
function logisticsBatchLinkedOrder(batchRow,receipt=null){
 return findReceiptLinkedOrder(receipt||{},batchRow?.batch_no||'',receipt?.receipt_no||'');
}
function logisticsBatchDeliveryDate(batchRow,receipt=null){
 const order=logisticsBatchLinkedOrder(batchRow,receipt);
 if(!order)return '';
 const batchNo=String(batchRow?.batch_no||'');
 const type=String(batchRow?.delivery_type||receipt?.delivery_type||'');
 const batchInfo=(Array.isArray(order.batches)?order.batches:[]).find(x=>String(x?.batchNo||x?.batch_no||'')===batchNo);
 if(batchInfo?.deliveryDate)return String(batchInfo.deliveryDate).slice(0,10);
 const label=logisticsCloudLabels[type]||type;
 const arrival=(Array.isArray(order.deliveryArrivals)?order.deliveryArrivals:[]).find(x=>String(x?.deliveryType||'')===String(label));
 if(arrival?.date)return String(arrival.date).slice(0,10);
 return String(order.deliveryDate||order.specifiedArrivalDate||'').slice(0,10);
}
function logisticsReceiptVisibleNow(batchRow,receipt=null,now=new Date()){
 const type=String(batchRow?.delivery_type||receipt?.delivery_type||'');
 const storeCode=String(batchRow?.store_code||batchRow?.storeCode||receipt?.store_code||receipt?.storeCode||currentStoreCode()||'001');
 const settings=logisticsReceiptVisibilitySettings(storeCode);
 const rule=settings[type]||(type==='ec'?settings.yijiatong:null);
 if(!rule)return true;
 const deliveryDate=logisticsBatchDeliveryDate(batchRow,receipt);
 // 人工建立、舊資料或尚無訂購到貨日的貨單，不強制隱藏。
 if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate))return true;
 const [y,m,d]=deliveryDate.split('-').map(Number);
 const showDate=new Date(y,m-1,d,0,0,0,0);
 if(rule.showDay==='previous')showDate.setDate(showDate.getDate()-1);
 const [hh,mm]=String(rule.time||'00:00').split(':').map(Number);
 showDate.setHours(Number.isFinite(hh)?hh:0,Number.isFinite(mm)?mm:0,0,0);
 return now.getTime()>=showDate.getTime();
}
function logisticsReceiptVisibilityText(type,storeCode=currentStoreCode()){
 const r=logisticsReceiptVisibilitySettings(storeCode)[String(type||'')];
 if(!r)return '立即顯示';
 return `${r.showDay==='previous'?'進貨前一天':'進貨當天'} ${r.time} 更新`;
}
async function openLogisticsReceiptVisibilitySettings(){
 if(!canConfigureLogisticsStoreSettings())return alert('配送書顯示時間只有總部可以設定');
 const stores=logisticsSettingStoreRows();
 let selectedStore=String(stores[0]?.code||'001');
 const tableHtml=(storeCode)=>{
  const cfg=logisticsReceiptVisibilitySettings(storeCode);
  return Object.entries(cfg).map(([type,r])=>`<tr>
   <td><b>${esc(r.label)}</b></td>
   <td><select data-logistics-visible-day="${esc(type)}">
    <option value="previous" ${r.showDay==='previous'?'selected':''}>進貨前一天</option>
    <option value="same" ${r.showDay==='same'?'selected':''}>進貨當天</option>
   </select></td>
   <td><input type="time" data-logistics-visible-time="${esc(type)}" value="${esc(r.time||'00:00')}"></td>
  </tr>`).join('');
 };
 dlg('配送書顯示（更新）時間',`
  <div class="notice"><b>僅總部可設定，各門市可使用不同顯示時間。</b><br>
  預設：常溫／冷凍／低溫二配／鮮食二配於進貨前一天顯示；低溫一配／鮮食一配／億家通於進貨當天顯示。</div>
  <label>設定門市<select id="logisticsVisibilityStore">${stores.map(x=>`<option value="${esc(x.code)}">${esc(x.code)}｜${esc(x.name||'')}</option>`).join('')}</select></label>
  <div class="table-wrap"><table class="table logistics-visibility-setting-table">
   <thead><tr><th>配別</th><th>顯示日</th><th>更新時間</th></tr></thead>
   <tbody id="logisticsVisibilityRows">${tableHtml(selectedStore)}</tbody>
  </table></div>
  <div class="toolbar" style="justify-content:flex-end;margin-top:14px">
   <button class="button" id="logisticsVisibilityReset">此店恢復預設</button>
   <button class="primary" id="logisticsVisibilitySave">儲存此店設定</button>
  </div>`);
 setTimeout(()=>{
  const storeEl=document.querySelector('#logisticsVisibilityStore'),body=document.querySelector('#logisticsVisibilityRows');
  const redraw=()=>{selectedStore=String(storeEl?.value||'001');if(body)body.innerHTML=tableHtml(selectedStore)};
  storeEl?.addEventListener('change',redraw);
  document.querySelector('#logisticsVisibilityReset')?.addEventListener('click',()=>{
   const d=logisticsReceiptVisibilityDefaults();
   for(const [type,r] of Object.entries(d)){
    const day=document.querySelector(`[data-logistics-visible-day="${type}"]`);
    const time=document.querySelector(`[data-logistics-visible-time="${type}"]`);
    if(day)day.value=r.showDay;if(time)time.value=r.time;
   }
  });
  document.querySelector('#logisticsVisibilitySave')?.addEventListener('click',async()=>{
   const nextStore={};
   for(const [type,r] of Object.entries(logisticsReceiptVisibilityDefaults())){
    nextStore[type]={label:r.label,showDay:document.querySelector(`[data-logistics-visible-day="${type}"]`)?.value||r.showDay,time:document.querySelector(`[data-logistics-visible-time="${type}"]`)?.value||r.time};
   }
   const all=logisticsReceiptVisibilityAllSettings();
   all.stores=all.stores&&typeof all.stores==='object'?all.stores:{};
   all.stores[selectedStore]=nextStore;
   save(LOGISTICS_RECEIPT_VISIBILITY_KEY,all);
   if(cloudConfigured()){
    try{await cloudPushKey(LOGISTICS_RECEIPT_VISIBILITY_KEY,all)}
    catch(e){console.warn('配送書顯示時間雲端同步失敗',e);return alert('本機已儲存，但雲端同步失敗：'+e.message)}
   }
   const st=stores.find(x=>String(x.code)===selectedStore);
   saveAudit('配送書顯示時間設定',`${selectedStore} ${st?.name||''}｜`+Object.entries(nextStore).map(([k,v])=>`${v.label}:${v.showDay==='previous'?'前一天':'當天'} ${v.time}`).join('｜'));
   alert(`門市 ${selectedStore} 的配送書顯示（更新）時間已儲存`);
  });
 },0);
}

function logisticsReferenceFilteredRows(){
 const from=document.querySelector('#logisticsRefFrom')?.value||'';
 const to=document.querySelector('#logisticsRefTo')?.value||'';
 const type=document.querySelector('#logisticsRefType')?.value||'';
 const status=document.querySelector('#logisticsRefStatus')?.value||'';
 const no=(document.querySelector('#logisticsRefNo')?.value||'').trim().toLowerCase();
 const correctedOnly=!!document.querySelector('#logisticsRefCorrected')?.checked;
 const receiptByBatch=new Map(__adminLogisticsReferenceReceipts.map(r=>[String(r.batch_no||''),r]));
 return __adminLogisticsReferenceRows.filter(x=>{
  if(isEcReturnLogisticsBatch(x))return false;
  const receipt=receiptByBatch.get(String(x.batch_no||''))||fallbackReceiptForBatch(x);
  if(!logisticsReceiptVisibleNow(x,receipt))return false;
  const dt=String(receipt?.received_at||receipt?.accepted_at||x.arrived_at||logisticsBatchDeliveryDate(x,receipt)||x.created_at||'').slice(0,10);
  const stats=logisticsReferenceStats(x,receipt);
  const eobAccepted=logisticsEobAccepted(receipt);
  const statusMatch=!status||(status==='accepted'?eobAccepted:status==='pending'?!eobAccepted:true);
  return (!from||!dt||dt>=from)&&(!to||!dt||dt<=to)&&(!type||x.delivery_type===type)&&statusMatch&&
   (!no||[x.batch_no,x.external_ref,receipt?.receipt_no].some(v=>String(v||'').toLowerCase().includes(no)))&&(!correctedOnly||stats.corrected>0);
 });
}
function logisticsSignBarcode(batchNo){return String(batchNo||'').trim()}
function logisticsSignQrHtml(code,size=112){
 const value=String(code||'').trim();if(!value)return '';
 return `<div class="logistics-sign-qr" data-logistics-sign-qr="${encodeURIComponent(value)}" data-size="${Number(size)||112}" style="width:${Number(size)||112}px;height:${Number(size)||112}px;margin:6px auto;background:#fff;display:flex;align-items:center;justify-content:center"></div>`;
}
function drawLogisticsSignQrs(root=document){
 if(!window.QRCode)return;
 root.querySelectorAll?.('[data-logistics-sign-qr]').forEach(el=>{
  if(el.dataset.qrReady==='1')return;
  let text='';try{text=decodeURIComponent(el.dataset.logisticsSignQr||'')}catch{text=el.dataset.logisticsSignQr||''}
  if(!text)return;
  const size=Math.max(84,Math.min(220,Number(el.dataset.size||112)));
  el.innerHTML='';new QRCode(el,{text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});el.dataset.qrReady='1';
 });
}
function logisticsSignBarcodeLabel(batchNo){
 const code=logisticsSignBarcode(batchNo);
 if(!code)return '<span>—</span>';
 return `<div style="min-width:190px;text-align:center">${labelBarcodeHtml(code,{height:42,moduleWidth:.9})}<small style="display:block;text-align:center;overflow-wrap:anywhere">${esc(code)}</small>${logisticsSignQrHtml(code,96)}<small style="display:block">iPhone 相機請掃 QR</small><button class="button" data-logistics-sign-barcode="${esc(code)}" style="margin-top:5px;width:100%">列印簽到碼</button></div>`;
}
function bindLogisticsSignBarcodeButtons(){
 drawLogisticsSignQrs(document);
 document.querySelectorAll('[data-logistics-sign-barcode]').forEach(btn=>btn.onclick=()=>{
  const code=btn.dataset.logisticsSignBarcode||'';if(!code)return;
  printHTML(`物流貨單簽到碼 ${code}`,`<div style="width:76mm;padding:8mm 5mm;box-sizing:border-box;text-align:center;font-family:Arial,'Noto Sans TC',sans-serif"><div style="font-size:18px;font-weight:800;margin-bottom:8px">億家物流｜貨單專用簽到碼</div><div style="font-size:12px;font-weight:700;margin:4px 0">條碼槍：Code128</div>${labelBarcodeHtml(code,{height:72,moduleWidth:1.15})}<div style="font-size:16px;font-weight:700;margin-top:6px;overflow-wrap:anywhere">${esc(code)}</div><div style="font-size:12px;font-weight:700;margin-top:12px">POS iPhone 相機：掃描下方 QR Code</div><div class="print-qr" data-qr="${encodeURIComponent(code)}" style="width:180px;height:180px;margin:8px auto"></div><div style="font-size:12px;margin-top:8px">兩種簽到碼都對應同一張貨單</div></div>`);
 });
}
function selectedLogisticsRow(){
 const batch=String(__adminSelectedLogisticsBatch||'');
 const row=__adminLogisticsReferenceRows.find(x=>String(x.batch_no||'')===batch)||null;
 const receipt=__adminLogisticsReferenceReceipts.find(x=>String(x.batch_no||'')===batch)||null;
 return {row,receipt};
}
function bindLogisticsRowSelection(){
 document.querySelectorAll('[data-logistics-select]').forEach(r=>r.onchange=()=>{if(r.checked)__adminSelectedLogisticsBatch=String(r.value||'')});
}
function logisticsEobDownStatus(receipt){
 if(!receipt)return '—';
 const items=Array.isArray(receipt.items)?receipt.items:[];
 if(receipt.virtual_order_fallback||receipt.virtual_ec_fallback)return '待同步';
 if(items.length)return '已下傳';
 return '已建立';
}
function logisticsEobUpStatus(receipt){
 if(!receipt)return '—';
 const at=receipt.eob_uploaded_at||receipt.accepted_at||receipt.checked_at||'';
 return at?'已上傳':'—';
}
function logisticsEobAccepted(receipt){
 if(!receipt)return false;
 const status=String(receipt.status||'').trim().toLowerCase();
 return !!(receipt.accepted_at||receipt.checked_at||receipt.eob_uploaded_at||['accepted','checked','completed','done'].includes(status));
}
function logisticsPosSwipeStatus(batchRow){
 const at=batchRow?.arrived_at||'';
 if(!at)return '—';
 let text='已過刷';
 try{
  const d=new Date(at);
  if(!Number.isNaN(d.getTime()))text+=` ${d.toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
 }catch{}
 return text;
}
function renderLogisticsReferenceTable(){
 const el=document.querySelector('#cloudLogisticsList');if(!el)return;
 const receiptByBatch=new Map(__adminLogisticsReferenceReceipts.map(r=>[String(r.batch_no||''),r]));
 const rows=logisticsReferenceFilteredRows();
 if(rows.length&&!rows.some(x=>String(x.batch_no||'')===String(__adminSelectedLogisticsBatch||'')))__adminSelectedLogisticsBatch=String(rows[0].batch_no||'');
 el.innerHTML=rows.length?`<div class="table-wrap logistics-ref-table-wrap"><table class="table logistics-ref-table">
  <thead><tr>
   <th>選取</th><th>配送確認書編號</th><th>配別</th><th>進貨品項</th><th>修正品項</th><th>售價合計</th>
   <th>驗收日</th><th>EOB下傳</th><th>EOB上傳</th><th>狀態</th><th>POS過刷</th>
  </tr></thead><tbody>
  ${rows.map(x=>{
   const receipt=receiptByBatch.get(String(x.batch_no||''))||fallbackReceiptForBatch(x),st=logisticsReferenceStats(x,receipt);
   const linkedOrder=findReceiptLinkedOrder(receipt,String(x.batch_no||''),String(receipt?.receipt_no||''));
   const linkedBatch=(Array.isArray(linkedOrder?.batches)?linkedOrder.batches:[]).find(b=>String(b?.batchNo||b?.batch_no||'')===String(x.batch_no||''))||null;
   const linkedReceipt=(Array.isArray(linkedOrder?.receipts)?linkedOrder.receipts:[]).find(r=>String(r?.receiptNo||r?.receipt_no||'')===String(receipt?.receipt_no||''))||null;
   const linkedDeliveryType=normalizeDeliveryLabel(linkedBatch?.deliveryType||linkedReceipt?.deliveryType||receipt?.delivery_type||x?.delivery_type||linkedOrder?.deliveryType||'');
   const linkedDeliveryDate=linkedOrder?.deliveryDates?.[linkedDeliveryType]?.date||'';
   const accepted=receipt?.accepted_at||receipt?.checked_at||receipt?.eob_uploaded_at||'';
   const inboundDate=String(
    receipt?.delivery_date||
    receipt?.expected_date||
    receipt?.arrival_date||
    x?.delivery_date||
    x?.expected_date||
    linkedBatch?.deliveryDate||
    linkedReceipt?.deliveryDate||
    linkedDeliveryDate||
    linkedOrder?.deliveryDate||
    ''
   ).slice(0,10);
   const status=logisticsEobAccepted(receipt)?'已驗收':'未驗收';
   return `<tr class="${st.corrected?'corrected':''}">
    <td><input type="radio" name="logisticsSelectedBatch" data-logistics-select value="${esc(x.batch_no||'')}" ${String(__adminSelectedLogisticsBatch||'')===String(x.batch_no||'')?'checked':''}></td>
    <td><b>${esc(receipt?.receipt_no||x.external_ref||x.batch_no||'—')}</b><small>${esc(x.batch_no||'')}</small></td>
    <td>${esc(logisticsCloudLabels[x.delivery_type]||x.delivery_type||'—')}</td>
    <td>${st.lineCount||'—'}</td><td>${st.corrected||0}</td><td>${st.total?money(st.total):'—'}</td>
    <td>${esc(inboundDate||'—')}</td>
    <td>${esc(logisticsEobDownStatus(receipt))}</td>
    <td>${esc(logisticsEobUpStatus(receipt))}</td>
    <td><span class="logistics-status ${status==='已驗收'?'arrived':'pending'}">${status}</span></td>
    <td>${esc(logisticsPosSwipeStatus(x))}</td>
   </tr>`;
  }).join('')}
  </tbody></table></div>`:'<div class="notice">目前條件下沒有配送／驗收資料。EC 退貨／離店批次不會顯示在此頁，請至 EC 管理查看。</div>';
 bindLogisticsRowSelection();
}
async function openSelectedLogisticsReceipt(){
 const {row,receipt}=selectedLogisticsRow();if(!row)return alert('請先選擇一張貨單');
 return openInventoryReceiptDetail(row.batch_no,receipt?.receipt_no||'');
}
async function printSelectedLogisticsReceipt(){
 const {row,receipt}=selectedLogisticsRow();if(!row)return alert('請先選擇一張貨單');
 await openInventoryReceiptDetail(row.batch_no,receipt?.receipt_no||'');
 setTimeout(()=>document.querySelector('#receiptDetailPrint')?.click(),120);
}
async function openSelectedLogisticsAcceptance(){
 const {row,receipt:cached}=selectedLogisticsRow();if(!row)return alert('請先選擇一張貨單');
 if(!cloudConfigured())return alert('尚未設定 Supabase');
 dlg('驗收明細','<div class="notice">讀取驗收資料中…</div>');
 try{
  const receipt=(await adminGetInventoryReceiptByBatch(row.batch_no))||cached;if(!receipt)throw new Error('找不到進貨單');
  const items=receiptDetailItems(receipt,row.batch_no,receipt.receipt_no||'');
  const body=items.map((item,i)=>{const p=receiptItemProduct(item),expected=Number(receiptVal(item,['notice_qty','ordered_qty','qty'],0))||0,current=Number(receiptVal(item,['accepted_qty','actual_qty','received_qty'],expected))||0;return `<tr><td>${i+1}</td><td>${esc(receiptVal(item,['product_code','code'],p.code||'—'))}</td><td>${esc(receiptVal(item,['product_name','name'],p.name||'—'))}</td><td>${expected}</td><td><input type="number" min="0" step="1" value="${current}" data-accept-qty data-item-id="${esc(item.id||'')}" data-product-code="${esc(receiptVal(item,['product_code','code'],p.code||''))}" style="width:90px"></td></tr>`}).join('')||'<tr><td colspan="5">無商品明細</td></tr>';
  document.querySelector('#dialogBody').innerHTML=`<div class="acceptance-editor"><div class="notice"><b>貨單：</b>${esc(receipt.receipt_no||row.batch_no)}<br><small>此處為獨立驗收作業，不會取代物流簽到。</small></div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>商品代號</th><th>品名</th><th>通知數</th><th>驗收量</th></tr></thead><tbody>${body}</tbody></table></div><div class="toolbar" style="justify-content:flex-end;margin-top:12px"><button class="button" id="acceptanceAllMatch">全部符合</button><button class="primary" id="acceptanceComplete">完成驗收</button><button class="button" id="acceptanceClose">離開</button></div></div>`;
  document.querySelector('#acceptanceAllMatch').onclick=()=>document.querySelectorAll('[data-accept-qty]').forEach((el,i)=>{const item=items[i],expected=Number(receiptVal(item,['notice_qty','ordered_qty','qty'],0))||0;el.value=expected});
  document.querySelector('#acceptanceClose').onclick=()=>genericDialog.close();
  document.querySelector('#acceptanceComplete').onclick=async()=>{const btn=document.querySelector('#acceptanceComplete');btn.disabled=true;btn.textContent='驗收儲存中…';try{const quantities=[...document.querySelectorAll('[data-accept-qty]')].map((el,i)=>({itemId:el.dataset.itemId||items[i]?.id||'',productCode:el.dataset.productCode||'',qty:Math.max(0,Number(el.value||0))}));await adminAcceptInventoryReceipt(row.batch_no,quantities,currentUser()?.name||'');genericDialog.close();await refreshLogisticsCloud();alert('驗收完成，狀態已更新為已驗收');}catch(e){alert('驗收儲存失敗：'+e.message);btn.disabled=false;btn.textContent='完成驗收';}};
 }catch(e){document.querySelector('#dialogBody').innerHTML=`<div class="notice">驗收資料讀取失敗：${esc(e.message)}</div>`}
}

async function refreshLogisticsCloud(){
 const el=document.querySelector('#cloudLogisticsList');if(!el)return;
 if(!cloudConfigured()){el.innerHTML='<div class="notice">請先到「雲端與更新」設定 Supabase。</div>';return}
 el.innerHTML='<p>正在讀取物流批次…</p>';
 try{
  // 先同步訂購、商品主檔與配送書顯示時間設定。
  try{
   await cloudPullKey(K.orders);
   await cloudPullKey(K.products);
   await cloudPullKey(LOGISTICS_RECEIPT_VISIBILITY_KEY);
  }catch(e){console.warn('物流頁訂購/商品/配送書時間同步失敗',e)}
  const [rows,receipts,ecPackages]=await Promise.all([
   adminListLogisticsBatches(200),
   adminListInventoryReceipts(200),
   adminListEcPackages(500).catch(()=>[])
  ]);
  __adminLogisticsReferenceRows=Array.isArray(rows)?rows:[];
  __adminLogisticsReferenceReceipts=Array.isArray(receipts)?receipts:[];
  __adminLogisticsReferenceEcPackages=Array.isArray(ecPackages)?ecPackages:[];
  // EOB 下傳／上傳狀態直接以雲端進貨單為準；有選取批次時再補抓最新明細。
  if(__adminSelectedLogisticsBatch){
   try{
    const latest=await adminGetInventoryReceiptByBatch(__adminSelectedLogisticsBatch);
    if(latest){
     const i=__adminLogisticsReferenceReceipts.findIndex(x=>String(x.batch_no||'')===String(__adminSelectedLogisticsBatch));
     if(i>=0)__adminLogisticsReferenceReceipts[i]=latest;else __adminLogisticsReferenceReceipts.push(latest);
    }
   }catch(e){console.warn('EOB 進貨單即時狀態同步失敗',e)}
  }
  renderLogisticsReferenceTable();
 }catch(e){el.innerHTML=`<div class="notice">物流批次讀取失敗：${esc(e.message)}</div>`}
}

async function refreshLogisticsSchedulesCloud(){
 const el=document.querySelector('#cloudLogisticsSchedules');if(!el)return;
 if(!cloudConfigured()){el.innerHTML='<div class="notice">請先到「雲端與更新」設定 Supabase。</div>';return}
 el.innerHTML='<p>正在讀取表定時間…</p>';
 try{
  const rows=await adminListLogisticsSchedules();
  el.innerHTML=rows.length?`<div class="logistics-home-list"><div class="logistics-home-head"><span>配別</span><span>本日到店時間</span><span>表定到店時間</span></div>${rows.map(x=>`<button class="logistics-home-row" data-nav="logistics"><b>${esc(logisticsCloudLabels[x.delivery_type]||x.delivery_type)}</b><span>${x.actual_arrived_at?new Date(x.actual_arrived_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}):'尚未到店'}</span><span>${esc(x.scheduled_time||'未設定')}</span></button>`).join('')}</div>`:'<p>目前沒有表定時間設定。</p>';
 }catch(e){el.innerHTML=`<div class="notice">表定時間讀取失敗：${esc(e.message)}</div>`}
}
async function openLogisticsScheduleEdit(){
 if(!canConfigureLogisticsStoreSettings())return alert('表定到店時間只有總部可以設定');
 if(!cloudConfigured())return alert('請先到「雲端與更新」設定 Supabase');
 const stores=logisticsSettingStoreRows();
 const types=Object.entries(logisticsReceiptVisibilityDefaults()).map(([delivery_type,x])=>({delivery_type,label:x.label}));
 let selectedStore=String(stores[0]?.code||'001'),rows=[];
 const loadStore=async(storeCode)=>{
  try{rows=await adminListLogisticsSchedules(storeCode)}catch(e){rows=[];throw e}
 };
 try{await loadStore(selectedStore)}catch(e){return alert('讀取表定時間失敗：'+e.message)}
 dlg('表定到店時間設定',`
  <div class="notice"><b>僅總部可設定，各門市表定到店時間可不同。</b></div>
  <label>設定門市<select id="lseStore">${stores.map(x=>`<option value="${esc(x.code)}">${esc(x.code)}｜${esc(x.name||'')}</option>`).join('')}</select></label>
  <label>配別<select id="lseType">${types.map(x=>`<option value="${esc(x.delivery_type)}">${esc(x.label)}</option>`).join('')}</select></label>
  <label>表定到店時間<input id="lseTime" placeholder="例如 06:30～08:30 或 依物流通知"></label>
  <label>備註<input id="lseNote" placeholder="選填"></label>
  <button class="primary" id="lseSave">儲存到雲端</button>`);
 const fill=()=>{
  const type=document.querySelector('#lseType')?.value||'';
  const x=rows.find(v=>String(v.delivery_type||'')===String(type));
  const time=document.querySelector('#lseTime'),note=document.querySelector('#lseNote');
  if(time)time.value=x?.scheduled_time||'';if(note)note.value=x?.note||'';
 };
 setTimeout(()=>{
  const storeEl=document.querySelector('#lseStore'),typeEl=document.querySelector('#lseType');
  storeEl.onchange=async()=>{
   selectedStore=String(storeEl.value||'001');
   storeEl.disabled=true;
   try{await loadStore(selectedStore);fill()}catch(e){alert('讀取此門市表定時間失敗：'+e.message)}finally{storeEl.disabled=false}
  };
  typeEl.onchange=fill;fill();
  document.querySelector('#lseSave').onclick=async()=>{
   const btn=document.querySelector('#lseSave'),type=typeEl.value,time=document.querySelector('#lseTime').value.trim(),note=document.querySelector('#lseNote').value.trim();
   if(!time)return alert('請輸入表定到店時間');
   btn.disabled=true;btn.textContent='儲存中…';
   try{
    await adminUpsertLogisticsSchedule({deliveryType:type,scheduledTime:time,note,storeCode:selectedStore});
    const st=stores.find(x=>String(x.code)===selectedStore);
    saveAudit('修改物流表定時間',`${selectedStore} ${st?.name||''}｜${logisticsCloudLabels[type]||type}｜${time}`);
    await loadStore(selectedStore);fill();
    alert(`門市 ${selectedStore} 的表定到店時間已更新`);
   }catch(e){alert('儲存失敗：'+e.message)}finally{btn.disabled=false;btn.textContent='儲存到雲端'}
  };
 },0);
}

async function openAdminLogisticsCreate(){
 let ecRows=[],batches=[];
 try{ecRows=await adminListEcPackages(300)}catch{}
 try{batches=await adminListLogisticsBatches(200)}catch{}
 dlg('建立物流批次',`<label>物流類型<select id="algType"><option value="ambient">常溫</option><option value="fresh_1">鮮食一配</option><option value="fresh_2">鮮食二配</option><option value="dairy">低溫一配</option><option value="low_2">低溫二配</option><option value="frozen">冷凍</option><option value="yijiatong">億家通</option><option value="ec">EC</option></select></label><div class="settings-grid"><label>到貨日<input id="algDate" type="date" value="${localDateKey()}"></label><label>配次／配送批次<input id="algRun" placeholder="無特殊配次可留空"></label></div><label>來源<select id="algSource"><option value="backend">後台下傳</option><option value="manual">人工建立</option><option value="mall">商城訂單</option></select></label><label>來源單號<select id="algRef"></select><small id="algRefHint"></small></label><label>備註<input id="algNote" placeholder="選填"></label><button class="primary" id="algSave">建立／合併並下傳物流</button>`);
 setTimeout(()=>{
  const typeEl=document.querySelector('#algType'),sourceEl=document.querySelector('#algSource'),refEl=document.querySelector('#algRef'),hint=document.querySelector('#algRefHint');
  const fillRefs=()=>{refEl.innerHTML=logisticsSourceRefOptions(sourceEl.value,typeEl.value,ecRows);hint.textContent=typeEl.value==='ec'?'EC 來源依溫層合併，不再一件一件建立來源單號。':''};
  typeEl.onchange=fillRefs;sourceEl.onchange=fillRefs;fillRefs();
  document.querySelector('#algSave').onclick=async()=>{
   const btn=document.querySelector('#algSave');btn.disabled=true;btn.textContent='建立中…';
   try{
    const ref=refEl.value||'';
    if(typeEl.value==='ec'&&ref.startsWith('__EC_GROUP__:')){
      const temp=ref.split(':')[1];
      const label=ecTempLabels[temp]||temp;
      const wantedDate=document.querySelector('#algDate')?.value||localDateKey();
      const wantedRun=`EC-${temp}-${String(document.querySelector('#algRun')?.value||'DEFAULT').trim()||'DEFAULT'}`;
      const linkedRows=ecRows.filter(x=>x.status==='expected'&&x.temperature===temp&&x.inbound_batch_no);
      let reusable=batches.find(b=>b.delivery_type==='ec'&&b.status==='pending'&&String(b.delivery_date||'')===wantedDate&&String(b.delivery_run||'DEFAULT')===wantedRun&&linkedRows.some(x=>x.inbound_batch_no===b.batch_no));
      if(!reusable)reusable=batches.find(b=>b.delivery_type==='ec'&&b.status==='pending'&&String(b.delivery_date||'')===wantedDate&&String(b.delivery_run||'DEFAULT')===wantedRun&&String(b.external_ref||'').includes(`EC${label}共同貨單`));
      let batch=reusable;
      if(!batch)batch=await adminCreateLogisticsBatch({deliveryType:'ec',deliveryDate:document.querySelector('#algDate')?.value||localDateKey(),deliveryRun:`EC-${temp}-${String(document.querySelector('#algRun')?.value||'DEFAULT').trim()||'DEFAULT'}`,source:'backend',externalRef:`EC${label}共同貨單`,notes:`億家通配送｜EC ${label}共同貨單`});
      const result=await adminBindEcGroupToBatch({batchNo:batch.batch_no,temperature:temp});
      const count=Number(result?.package_count||0);
      saveAudit('EC物流合批',`${label}｜${batch.batch_no}｜${count}件`);
      genericDialog.close();
      alert(`${reusable?'已使用既有':'物流批次建立成功'}\n${batch.batch_no}\n${label} EC 已歸類 ${count} 件`);
      await refreshLogisticsCloud();
      return;
    }
    const r=await adminCreateLogisticsBatch({deliveryType:typeEl.value,deliveryDate:document.querySelector('#algDate')?.value||localDateKey(),deliveryRun:String(document.querySelector('#algRun')?.value||'').trim()||'DEFAULT',source:sourceEl.value,externalRef:ref,notes:document.querySelector('#algNote').value.trim()});
    saveAudit('建立物流批次',`${logisticsCloudLabels[r.delivery_type]||r.delivery_type}｜${r.batch_no}`);genericDialog.close();alert(`物流批次建立成功\n${r.batch_no}`);await refreshLogisticsCloud();
   }catch(e){alert('建立物流批次失敗：'+e.message);btn.disabled=false;btn.textContent='建立並下傳物流'}
  };
 },0);
}


const ecCloudStatusLabels={expected:'預計進店',arrived:'已到店／待取貨',picked_up:'已取貨',return_due:'待退貨',returning:'退貨物流中',returned:'已退回',cancelled:'已取消'};
const ecTempLabels={ambient:'常溫',frozen:'冷凍'};
let __ecCloudRows=[];
function fmtCloudTime(v){return v?new Date(v).toLocaleString('zh-TW'):'—'}
function ecShippingLabelHtml(x){
 const store=x.pickup_store_name||'總店',code=x.pickup_store_code||'001',temp=ecTempLabels[x.temperature]||x.temperature||'常溫';
 const barcode=x.package_barcode||x.package_no;
 return `<div style="width:76mm;border:2px solid #111;font-family:Arial,'Noto Sans TC',sans-serif;padding:5mm;box-sizing:border-box;color:#111;overflow:hidden"><div style="text-align:center;font-size:16px;font-weight:700;border-bottom:1px solid #111;padding-bottom:4px">億家物流 EC 寄取件單</div><div style="display:grid;grid-template-columns:19mm minmax(0,1fr);border-bottom:1px solid #111"><b style="padding:8px 4px;border-right:1px solid #111">寄件專用</b><div style="padding:6px;min-width:0;overflow:hidden"><div>寄件人：${esc(x.sender_name||'—')}</div><div style="overflow-wrap:anywhere">包裹編號：${esc(x.package_no)}</div>${labelBarcodeHtml(barcode,{height:42,moduleWidth:.72})}</div></div><div style="display:grid;grid-template-columns:19mm minmax(0,1fr);border-bottom:1px solid #111"><b style="padding:8px 4px;border-right:1px solid #111">物流專用</b><div style="padding:6px;min-width:0"><div style="font-size:22px;font-weight:800">${esc(temp)}｜${esc(x.route_code||'—')}</div><div style="overflow-wrap:anywhere">進店批次：${esc(x.inbound_batch_no||'—')}</div></div></div><div style="display:grid;grid-template-columns:19mm minmax(0,1fr)"><b style="padding:8px 4px;border-right:1px solid #111">取件專用</b><div style="padding:6px;min-width:0;overflow:hidden"><div style="font-size:20px;font-weight:800">${esc(x.recipient_name||'—')}｜末三碼 ${esc(x.recipient_last3||'—')}</div><div>${esc(store)}（${esc(code)}）</div>${labelBarcodeHtml(barcode,{height:52,moduleWidth:.78})}<div style="text-align:center;overflow-wrap:anywhere">${esc(barcode)}</div></div></div></div>`;
}
async function refreshEcCloud(){
 const list=document.querySelector('#ecCloudList');if(!list)return;
 if(!cloudConfigured()){list.innerHTML='<div class="notice">請先到「雲端與更新」設定 Supabase。</div>';return}
 try{
  const [rows,returns]=await Promise.all([adminListEcPackages(300),adminListEcReturnBatches(100)]);__ecCloudRows=rows;
  const count=s=>rows.filter(x=>x.status===s).length;
  const sum=document.querySelector('#ecCloudSummary');if(sum)sum.innerHTML=`<div class="metric"><small>預計進店</small><strong>${count('expected')}</strong></div><div class="metric"><small>待取貨</small><strong>${count('arrived')}</strong></div><div class="metric"><small>待退貨</small><strong>${count('return_due')}</strong></div><div class="metric"><small>退貨物流中</small><strong>${count('returning')}</strong></div>`;
  list.innerHTML=rows.length?`<table class="table"><tr><th>溫層</th><th>收件人</th><th>末三碼</th><th>包裹編號</th><th>狀態</th><th>到店</th><th>取貨期限</th><th>退貨批次</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(ecTempLabels[x.temperature]||x.temperature)}</td><td>${esc(x.recipient_name||'—')}</td><td>${esc(x.recipient_last3||'—')}</td><td>${esc(x.package_no)}</td><td>${esc(ecCloudStatusLabels[x.status]||x.status)}</td><td>${fmtCloudTime(x.arrived_at)}</td><td>${esc(x.pickup_deadline||'—')}</td><td>${esc(x.return_batch_no||'—')}</td><td><button class="button" data-ec-cloud-print="${x.id}">寄件單</button></td></tr>`).join('')}</table>`:'<p>目前沒有 EC 包裹。</p>';
  const rb=document.querySelector('#ecReturnBatchList');if(rb)rb.innerHTML=returns.length?`<table class="table"><tr><th>退貨單</th><th>物流批次</th><th>溫層</th><th>件數</th><th>狀態</th><th>建立時間</th></tr>${returns.map(x=>`<tr><td>${esc(x.return_no)}</td><td>${esc(x.logistics_batch_no||'—')}</td><td>${esc(ecTempLabels[x.temperature]||x.temperature)}</td><td>${Number(x.package_count||0)}</td><td>${esc(x.status||'')}</td><td>${fmtCloudTime(x.created_at)}</td></tr>`).join('')}</table>`:'<p>目前沒有退貨批次。</p>';
  document.querySelectorAll('[data-ec-cloud-print]').forEach(b=>b.onclick=()=>{const x=__ecCloudRows.find(v=>v.id===b.dataset.ecCloudPrint);if(x)printHTML(`EC寄件單 ${x.package_no}`,ecShippingLabelHtml(x))});
 }catch(e){list.innerHTML=`<div class="notice">EC 雲端資料讀取失敗：${esc(e.message)}</div>`}
}
async function openCloudEcCreate(){
 let batches=[];
 try{batches=(await adminListLogisticsBatches(200)).filter(x=>x.delivery_type==='ec'&&x.status==='pending')}catch{}
 const routes=ecRouteOptions(__ecCloudRows);
 const tempForBatch=batchNo=>{const p=(__ecCloudRows||[]).find(x=>x.inbound_batch_no===batchNo);return p?.temperature||''};
 const batchLabel=x=>{const t=tempForBatch(x.batch_no);return `${x.batch_no}｜${t?(ecTempLabels[t]||t)+'共同貨單':esc(x.external_ref||x.source||'EC')}`};
 const makeBatchOptions=temp=>'<option value="__AUTO__">＋ 自動使用同溫層共同貨單</option>'+batches.filter(x=>{const t=tempForBatch(x.batch_no);return !t||t===temp}).map(x=>`<option value="${esc(x.batch_no)}">${esc(batchLabel(x))}</option>`).join('');
 dlg('新增 EC 包裹',`<label>溫層<select id="cecTemp"><option value="ambient">常溫</option><option value="frozen">冷凍</option></select></label><label>收件人姓名<input id="cecName"></label><label>收件人手機<input id="cecPhone" inputmode="tel"></label><label>寄件人姓名<input id="cecSender"></label><label>寄件人電話<input id="cecSenderPhone" inputmode="tel"></label><label>預計進店時間<input id="cecExpected" type="datetime-local"></label><label>物流批次／貨單<select id="cecBatch">${makeBatchOptions('ambient')}</select><small>同溫層會自動共用同一筆待簽到貨單；貨單完成簽到後才會開新貨單。</small></label><label>路線／區碼<select id="cecRoute">${routes.map(x=>`<option value="${x==='未設定'?'':esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>取貨碼<input id="cecPickup" placeholder="選填"></label><label>包裹價值<input id="cecValue" type="number" value="0"></label><label>備註<input id="cecNotes"></label><button class="primary" id="cecSave">建立包裹並產生寄件單</button>`);
 setTimeout(()=>{
  const tempEl=document.querySelector('#cecTemp'),batchEl=document.querySelector('#cecBatch');
  tempEl.onchange=()=>{batchEl.innerHTML=makeBatchOptions(tempEl.value)};
  document.querySelector('#cecSave').onclick=async()=>{
   const btn=document.querySelector('#cecSave');const name=document.querySelector('#cecName').value.trim(),phone=document.querySelector('#cecPhone').value.trim();if(!name||!phone)return alert('請輸入收件人姓名與手機');btn.disabled=true;btn.textContent='建立中…';
   try{
    const temp=tempEl.value;
    let batchNo=batchEl.value;
    if(batchNo==='__AUTO__'){
     const expectedRaw=String(document.querySelector('#cecExpected')?.value||'').trim();
     const ecDate=expectedRaw?expectedRaw.slice(0,10):localDateKey();
     const ecRoute=String(document.querySelector('#cecRoute')?.value||'').trim()||'DEFAULT';
     const expectedRun=`EC-${temp}-${ecRoute}`;
     const reusable=batches.find(x=>tempForBatch(x.batch_no)===temp&&String(x.delivery_date||'')===ecDate&&String(x.delivery_run||'DEFAULT')===expectedRun);
     if(reusable){batchNo=reusable.batch_no}
     else{
      const expectedRaw=String(document.querySelector('#cecExpected')?.value||'').trim();
      const ecDate=expectedRaw?expectedRaw.slice(0,10):localDateKey();
      const ecRoute=String(document.querySelector('#cecRoute')?.value||'').trim()||'DEFAULT';
      const b=await adminCreateLogisticsBatch({deliveryType:'ec',deliveryDate:ecDate,deliveryRun:`EC-${temp}-${ecRoute}`,source:'backend',externalRef:`EC${ecTempLabels[temp]||temp}共同貨單`,notes:`億家通配送｜EC ${ecTempLabels[temp]||temp}共同貨單`});
      batchNo=b?.batch_no||'';
      if(!batchNo)throw new Error('EC物流批次建立失敗');
      batches.unshift(b);
     }
    }
    const chosenTemp=tempForBatch(batchNo);
    if(chosenTemp&&chosenTemp!==temp)throw new Error(`此貨單屬於${ecTempLabels[chosenTemp]||chosenTemp}，不能加入${ecTempLabels[temp]||temp}包裹`);
    const r=await adminCreateEcPackage({recipientName:name,recipientPhone:phone,temperature:temp,storeName:store().name||'總店',expectedArrivalAt:document.querySelector('#cecExpected').value?new Date(document.querySelector('#cecExpected').value).toISOString():null,batchNo,routeCode:document.querySelector('#cecRoute').value,senderName:document.querySelector('#cecSender').value.trim(),senderPhone:document.querySelector('#cecSenderPhone').value.trim(),pickupCode:document.querySelector('#cecPickup').value.trim(),value:document.querySelector('#cecValue').value,notes:document.querySelector('#cecNotes').value.trim()});
    saveAudit('建立EC包裹',`${r.package_no}｜${ecTempLabels[r.temperature]||r.temperature}｜共同貨單 ${batchNo}`);genericDialog.close();await refreshEcCloud();const x=__ecCloudRows.find(v=>v.package_no===r.package_no);const sameCount=__ecCloudRows.filter(v=>v.inbound_batch_no===batchNo&&v.temperature===temp).length;if(x&&confirm(`EC包裹建立成功\n${r.package_no}\n共同貨單：${batchNo}\n本貨單目前 ${sameCount} 件\n\n是否立即列印此包裹寄件單？`))printHTML(`EC寄件單 ${x.package_no}`,ecShippingLabelHtml(x));
   }catch(e){alert('建立EC包裹失敗：'+e.message);btn.disabled=false;btn.textContent='建立包裹並產生寄件單'}
  };
 },0);
}
function orderClearGroupOfItem(item){const t=normalizeDeliveryLabel(item?.deliveryType||'');return ['低溫二配','鮮食二配'].includes(t)?'first':['常溫','鮮食一配','低溫一配','冷凍','億家通'].includes(t)?'second':''}
function orderingClearStats(group){
 let ordered=0,transmitted=0;for(const o of load(K.orders,[])){for(const it of (o.items||[])){if(orderClearGroupOfItem(it)!==group)continue;if(['已傳輸','完成'].includes(o.status))transmitted++;else if(Number(it.qty||0)>0)ordered++;}}
 return {ordered,transmitted};
}
function rocOrderDate(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()-1911}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`}
function orderingClearPage(){const a=orderingClearStats('first'),b=orderingClearStats('second');return `<div class="page-head"><div><h2>訂購資料清除</h2><small>只清除尚未傳輸的訂購數量；已傳輸歷程永久保留。</small></div></div><section class="panel" style="max-width:620px;margin:auto"><button class="primary" style="width:100%;padding:18px;margin-bottom:18px" data-action="order-clear" data-order-clear-group="first"><b>一訂訂購數清除</b><br><small>訂購日 ${rocOrderDate(0)}　已訂 ${a.ordered} 筆　已傳輸 ${a.transmitted} 筆</small></button><button class="button" style="width:100%;padding:18px" data-action="order-clear" data-order-clear-group="second"><b>二訂訂購數清除</b><br><small>訂購日 ${rocOrderDate(1)}　已訂 ${b.ordered} 筆　已傳輸 ${b.transmitted} 筆</small></button><p class="notice danger" style="margin-top:22px">請注意：執行訂購數清除，將所選擇訂購別之尚未傳輸訂購數量歸 0；不刪除任何已傳輸資料。</p><p style="text-align:center">一訂於 10:00 前訂購；二訂於 22:00 前訂購。</p></section>`}
function clearPendingOrderQuantities(group){
 const rows=load(K.orders,[]);let changed=0;for(const o of rows){if(['已傳輸','完成'].includes(o.status))continue;for(const it of (o.items||[])){if(orderClearGroupOfItem(it)===group&&Number(it.qty||0)!==0){it.qty=0;changed++;}}if((o.items||[]).every(it=>Number(it.qty||0)<=0))o.status='已清除';}save(K.orders,rows);saveAudit(group==='first'?'一訂訂購數清除':'二訂訂購數清除',`${changed}筆歸0｜已傳輸歷程保留`);return changed;
}
function productReturnRows(){return load('yj4_product_returns',[])||[]}
function openProductReturn(type='general'){
 const frozen=type==='frozen',label=frozen?'冷凍':'一般常溫';const ps=products().filter(p=>productStatusLabel(p)!=='停用'&&(frozen?normalizeDeliveryLabel(p.deliveryType||p.logistics||'')==='冷凍':normalizeDeliveryLabel(p.deliveryType||p.logistics||'')!=='冷凍'));
 dlg(`建立${label}商品退貨`,`<p class="notice">此為商品退貨，不會建立 EC 包裹退貨。</p><label>商品<select id="productReturnProduct">${ps.map(p=>`<option value="${esc(p.id)}">${esc(p.code||'')}｜${esc(p.name)}｜庫存 ${Number(p.stock||0)}</option>`).join('')}</select></label><label>退貨數量<input id="productReturnQty" type="number" min="1" value="1"></label><label>原因<select id="productReturnReason"><option>下架退貨</option><option>不良品</option><option>空箱瓶</option><option>其他</option></select></label><button class="primary" id="saveProductReturn">建立${label}退貨</button>`);
 setTimeout(()=>{const btn=document.querySelector('#saveProductReturn');if(btn)btn.onclick=()=>{const rows=load(K.products,[]),p=rows.find(x=>String(x.id)===String(document.querySelector('#productReturnProduct')?.value||'')),qty=Math.max(1,Number(document.querySelector('#productReturnQty')?.value||1));if(!p)return alert('找不到商品');if(qty>Number(p.stock||0)&&!p.allowNegativeStock)return alert(`退貨數量不可大於目前庫存 ${Number(p.stock||0)}`);const before=Number(p.stock||0);p.stock=Math.max(0,before-qty);save(K.products,rows);const rr=productReturnRows(),rec={id:`RT-${Date.now()}`,type,label,productId:p.id,code:p.code||'',name:p.name,qty,reason:document.querySelector('#productReturnReason')?.value||'',status:'已建立',storeCode:currentStoreCode(),user:currentUser()?.name||'',at:new Date().toISOString(),stockBefore:before,stockAfter:p.stock};rr.unshift(rec);save('yj4_product_returns',rr);saveAudit(`建立${label}商品退貨`,`${p.name}×${qty}｜${before}→${p.stock}`);genericDialog.close();alert(`${label}商品退貨建立成功\n退貨單：${rec.id}`);render(currentAdminPage());};},0);
}
async function createEcReturn(temp){
 try{const r=await adminCreateEcReturnBatch(temp,currentUser()?.name||'');saveAudit('建立EC退貨批次',`${r.return_no}｜${r.logistics_batch_no}｜${r.package_count}件`);alert(`EC退貨批次建立成功\n退貨單：${r.return_no}\n物流批次：${r.logistics_batch_no}\n件數：${r.package_count}`);await refreshEcCloud()}catch(e){alert('建立 EC 退貨失敗：'+e.message)}
}
async function refreshInventoryReceiptsCloud(){
 const el=document.querySelector('#cloudInventoryReceipts');if(!el)return;
 if(!cloudConfigured()){el.innerHTML='<div class="notice">尚未設定 Supabase。</div>';return}
 try{
  const rows=await adminListInventoryReceipts(100);
  el.innerHTML=rows.length?`<table class="table ref-receipt-list-v305"><tr><th>進貨單</th><th>條碼</th><th>訂購單</th><th>物流批次</th><th>配別</th><th>狀態</th><th>到店／驗收</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.receipt_no)}</td><td>${esc(x.receipt_barcode)}</td><td>${esc(x.order_no||'—')}</td><td>${esc(x.batch_no||'—')}</td><td>${esc(logisticsCloudLabels[x.delivery_type]||x.delivery_type)}</td><td>${esc(logisticsEobAccepted(x)?'已驗收':'未驗收')}</td><td>${fmtCloudTime(x.accepted_at||x.checked_at||x.received_at)}</td><td><button class="button" data-receipt-detail="${esc(x.batch_no||'')}" data-receipt-no="${esc(x.receipt_no||'')}">明細</button></td></tr>`).join('')}</table>`:'<p>目前沒有進貨單。</p>';
  bindReceiptDetailButtons();
 }catch(e){el.innerHTML=`<div class="notice">進貨單讀取失敗：${esc(e.message)}</div>`}
}

function receiptArray(value){
 if(Array.isArray(value))return value;
 if(typeof value==='string'){
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[]}catch{return []}
 }
 return [];
}

function orderBatchValues(order){
 const out=[];
 const add=v=>{const x=String(v||'').trim();if(x&&!out.includes(x))out.push(x)};
 String(order?.batchNo||order?.batch_no||'').split('、').forEach(add);
 for(const x of (Array.isArray(order?.batches)?order.batches:[]))add(x?.batchNo||x?.batch_no);
 return out;
}
function orderReceiptValues(order){
 const out=[];
 const add=v=>{const x=String(v||'').trim();if(x&&!out.includes(x))out.push(x)};
 String(order?.receiptNo||order?.receipt_no||'').split('、').forEach(add);
 for(const x of (Array.isArray(order?.receipts)?order.receipts:[]))add(x?.receiptNo||x?.receipt_no);
 return out;
}
function findOrderByExternalReference(ref){
 const value=String(ref||'').trim();if(!value)return null;
 const rows=load(K.orders,[]);
 const exact=rows.find(o=>String(o.id||'').trim()===value);if(exact)return exact;
 return rows.filter(o=>value.startsWith(`${String(o.id||'').trim()}-`)).sort((a,b)=>String(b.id||'').length-String(a.id||'').length)[0]||null;
}

function isEcReturnLogisticsBatch(batchRow){
 if(!batchRow)return false;
 const type=String(batchRow.delivery_type||batchRow.deliveryType||'').trim().toLowerCase();
 if(type!=='ec')return false;
 const ext=String(batchRow.external_ref||batchRow.externalRef||'').trim();
 const text=[
  ext,batchRow.source_ref,batchRow.sourceRef,batchRow.notes,batchRow.note,
  batchRow.source,batchRow.batch_type,batchRow.batchType
 ].map(v=>String(v||'')).join(' ');
 return /^YJRET/i.test(ext)||/退貨|return|returned|returning|leave|離店/i.test(text);
}
function ecInboundPackagesForBatch(batchNo){
 const batch=String(batchNo||'').trim();if(!batch)return [];
 return (__adminLogisticsReferenceEcPackages||[]).filter(x=>
  String(x.inbound_batch_no||x.inboundBatchNo||'').trim()===batch
 );
}
function ecInboundReceiptForBatch(batchRow,receiptNo=''){
 if(!batchRow||String(batchRow.delivery_type||'').trim().toLowerCase()!=='ec'||isEcReturnLogisticsBatch(batchRow))return null;
 const batch=String(batchRow.batch_no||batchRow.batchNo||'').trim();
 const packs=ecInboundPackagesForBatch(batch);
 if(!packs.length)return null;
 const items=packs.map((x,i)=>({
  line_no:i+1,
  product_code:String(x.package_no||x.packageNo||x.package_barcode||`EC-${i+1}`),
  product_name:`EC包裹｜${String(x.recipient_name||x.name||'收件人未填')}`,
  spec:`${ecTempLabels[x.temperature]||x.temperature||'常溫'}${x.recipient_last3?`｜末三碼 ${x.recipient_last3}`:''}`,
  price:Number(x.value??x.cod_amount??x.amount??0)||0,
  ordered_qty:1,notice_qty:1,
  accepted_qty:/arrived|picked_up|received|已到店|已取貨/i.test(String(x.status||''))?1:0,
  logistics_status:ecCloudStatusLabels[x.status]||x.status||'預計進店'
 }));
 return {
  batch_no:batch,
  receipt_no:String(receiptNo||batchRow.external_ref||batch).trim(),
  order_no:String(batchRow.external_ref||'EC共同貨單'),
  delivery_type:'ec',
  status:batchRow.status||'pending',
  source:batchRow.source||'ec',
  external_ref:batchRow.external_ref||'',
  virtual_ec_fallback:true,
  items
 };
}
function fallbackReceiptForBatch(batchRow,receiptNo=''){
 if(!batchRow)return null;
 const ecReceipt=ecInboundReceiptForBatch(batchRow,receiptNo);
 if(ecReceipt)return ecReceipt;
 const batch=String(batchRow.batch_no||batchRow.batchNo||'').trim();
 const ref=String(batchRow.external_ref||batchRow.source_ref||'').trim();
 const order=findOrderByExternalReference(ref)||load(K.orders,[]).find(o=>orderBatchValues(o).includes(batch))||null;
 if(!order)return null;
 const items=(order.items||[]).filter(x=>Number(x.qty||0)>0).map((x,i)=>({
  ...x,
  line_no:i+1,
  product_id:x.productId||x.product_id||'',
  product_code:x.code||x.product_code||'',
  product_name:x.name||x.product_name||'',
  ordered_qty:Number(x.qty||0),
  notice_qty:Number(x.qty||0),
  logistics_status:batchRow.status||'pending'
 }));
 const linkedBatch=(Array.isArray(order.batches)?order.batches:[]).find(x=>String(x?.batchNo||x?.batch_no||'')===batch)||null;
 return {
  batch_no:batch,
  receipt_no:String(receiptNo||'').trim(),
  order_no:String(order.id||'').trim(),
  delivery_type:batchRow.delivery_type||linkedBatch?.cloudDeliveryType||linkedBatch?.deliveryType||order.deliveryType||'',
  delivery_date:linkedBatch?.deliveryDate||order?.deliveryDates?.[normalizeDeliveryLabel(linkedBatch?.deliveryType||order.deliveryType||'')]?.date||order.deliveryDate||'',
  status:batchRow.status||'pending',
  items,
  source:batchRow.source||'ordering',
  external_ref:ref,
  virtual_order_fallback:true
 };
}
function findReceiptLinkedOrder(receipt,batchNo='',receiptNo=''){
 const orders=load(K.orders,[]);
 const batch=String(batchNo||receipt?.batch_no||receipt?.batchNo||'').trim();
 const rno=String(receiptNo||receipt?.receipt_no||receipt?.receiptNo||'').trim();
 const explicitOrderNo=String(receipt?.order_no||receipt?.orderNo||receipt?.order_id||receipt?.orderId||'').trim();
 if(explicitOrderNo){
  const x=findOrderByExternalReference(explicitOrderNo);
  if(x)return x;
 }
 if(batch){
  const x=orders.find(o=>orderBatchValues(o).includes(batch));
  if(x)return x;
 }
 if(rno){
  const x=orders.find(o=>orderReceiptValues(o).includes(rno));
  if(x)return x;
 }
 // 物流批次的來源單號通常就是訂購單號；用已載入的物流資料再做一次精準對應。
 if(batch&&Array.isArray(__adminLogisticsReferenceRows)){
  const logistics=__adminLogisticsReferenceRows.find(x=>String(x.batch_no||'').trim()===batch);
  const ref=String(logistics?.external_ref||logistics?.source_ref||'').trim();
  if(ref){
   const x=findOrderByExternalReference(ref);
   if(x)return x;
  }
 }
 return null;
}
function receiptOrderItemMatch(item,order){
 if(!order)return null;
 const id=String(item?.product_id||item?.productId||'').trim();
 const code=String(item?.product_code||item?.code||'').trim();
 const barcode=String(item?.barcode||'').trim();
 return (order.items||[]).find(x=>
  (id&&String(x.productId||x.product_id||'').trim()===id)||
  (code&&String(x.code||x.product_code||'').trim()===code)||
  (barcode&&String(x.barcode||'').trim()===barcode)
 )||null;
}
function promotionAutoArrivalReceiptItems(batchNo=''){
 const batch=String(batchNo||'').trim();
 if(!batch)return [];
 return promotionAutoArrivalOptions().filter(x=>String(x.batchNo||'').trim()===batch).map((x,i)=>{
  const p=products().find(y=>String(y.id)===String(x.productId||'')||String(y.code||'')===String(x.productCode||''))||{};
  const qty=Math.max(0,Number(x.actualQty||((x.multipleCount||x.qty||1)*(x.productMultiple||p.orderMultipleQty||1))||0));
  return {
   line_no:i+1,
   product_id:x.productId||p.id||'',
   product_code:x.productCode||p.code||'',
   barcode:p.barcode||'',
   product_name:x.productName||p.name||'',
   spec:p.spec||p.specification||'',
   price:Number(p.price||0),
   ordered_qty:qty,
   notice_qty:qty,
   qty,
   logistics_status:'expected',
   source:'promotion_auto_arrival'
  };
 });
}
function receiptDetailItems(receipt,batchNo='',receiptNo=''){
 const order=findReceiptLinkedOrder(receipt,batchNo,receiptNo);
 const direct=[
  receipt?.items,receipt?.lines,receipt?.details,receipt?.receipt_items,
  receipt?.inventory_items,receipt?.item_rows
 ].map(receiptArray).find(x=>x.length);
 if(direct?.length){
  // 進貨資料已有列資料時，也用訂購商品補齊品名／規格／售價／訂購數，避免只顯示半套物流欄位。
  return direct.map((item,i)=>{
   const oi=receiptOrderItemMatch(item,order)||{};
   return {
    ...oi,...item,
    line_no:item.line_no??item.line??item.row_no??item.seq??(i+1),
    productId:item.productId??item.product_id??oi.productId,
    product_id:item.product_id??item.productId??oi.productId,
    code:item.code??item.product_code??oi.code,
    product_code:item.product_code??item.code??oi.code,
    name:item.name??item.product_name??oi.name,
    product_name:item.product_name??item.name??oi.name,
    barcode:item.barcode??oi.barcode,
    ordered_qty:item.ordered_qty??item.order_qty??oi.qty??0,
    notice_qty:item.notice_qty??item.logistics_qty??item.shipped_qty??item.ordered_qty??item.order_qty??oi.qty??0
   };
  });
 }
 // 進貨單尚未產生商品 rows 時，訂購單先用訂購商品；活動自動到店則用活動設定補顯。
 if(order?.items?.length)return (order.items||[]).map((x,i)=>({
  ...x,
  line_no:i+1,
  product_id:x.productId||x.product_id||'',
  product_code:x.code||x.product_code||'',
  product_name:x.name||x.product_name||'',
  ordered_qty:Number(x.qty||0),
  notice_qty:Number(x.qty||0)
 }));
 return promotionAutoArrivalReceiptItems(batchNo);
}
function receiptItemProduct(item){
 const id=String(item?.product_id||item?.productId||'');
 const code=String(item?.product_code||item?.code||'');
 const barcode=String(item?.barcode||'');
 return products().find(p=>(id&&String(p.id)===id)||(code&&String(p.code||'')===code)||(barcode&&productBarcodes(p).includes(barcode)))||{};
}
function receiptVal(item,keys,fallback='—'){
 for(const k of keys){
  if(item?.[k]!==undefined&&item?.[k]!==null&&String(item[k])!=='')return item[k];
 }
 return fallback;
}
async function openInventoryReceiptDetail(batchNo,receiptNo=''){
 if(!cloudConfigured())return alert('尚未設定 Supabase');
 if(!batchNo)return alert('此進貨單沒有物流批次編號，無法讀取明細');
 dlg('貨單明細／進貨明細','<div class="notice">讀取進貨明細中…</div>');
 try{
  let receipt=await adminGetInventoryReceiptByBatch(batchNo);
  if(!receipt){
   receipt=(__adminLogisticsReferenceReceipts||[]).find(x=>String(x.batch_no||'')===String(batchNo))||null;
  }
  if(!receipt){
   const batchRow=(__adminLogisticsReferenceRows||[]).find(x=>String(x.batch_no||'')===String(batchNo))||null;
   receipt=fallbackReceiptForBatch(batchRow,receiptNo);
  }
  if(!receipt)throw new Error('找不到此物流批次的進貨單，也找不到可回復的訂購明細');
  const promoRepairRows=promotionAutoArrivalOptions().filter(x=>String(x.batchNo||'').trim()===String(batchNo||'').trim());
  const directBefore=[receipt?.items,receipt?.lines,receipt?.details,receipt?.receipt_items,receipt?.inventory_items,receipt?.item_rows].map(receiptArray).find(x=>x.length)||[];
  let promotionRepairAttempted=false;
  if(!directBefore.length&&promoRepairRows.length){
   promotionRepairAttempted=true;
   for(const row of promoRepairRows){
    const p=products().find(y=>String(y.id)===String(row.productId||'')||String(y.code||'')===String(row.productCode||''));
    if(!p)continue;
    try{await syncPromotionAutoArrivalToLogistics(row,p)}catch(e){console.warn('活動到店貨單明細自動補同步失敗',e)}
   }
   try{receipt=(await adminGetInventoryReceiptByBatch(batchNo))||receipt}catch{}
  }
  const linkedOrder=findReceiptLinkedOrder(receipt,batchNo,receiptNo);
  const batchRow=(__adminLogisticsReferenceRows||[]).find(x=>String(x.batch_no||'')===String(batchNo))||null;
  const linkedBatch=(Array.isArray(linkedOrder?.batches)?linkedOrder.batches:[]).find(x=>String(x?.batchNo||x?.batch_no||'')===String(batchNo))||null;
  const items=receiptDetailItems(receipt,batchNo,receiptNo);
  const acceptedAt=receipt.received_at||receipt.accepted_at||receipt.checked_at||'';
  const orderNo=receipt.order_no||receipt.orderNo||linkedOrder?.id||'—';
  const rawDelivery=receipt.delivery_type||batchRow?.delivery_type||linkedBatch?.cloudDeliveryType||linkedBatch?.deliveryType||linkedOrder?.deliveryType||'';
  const delivery=logisticsCloudLabels[rawDelivery]||normalizeDeliveryLabel(rawDelivery)||rawDelivery||'—';
  const rows=items.map((item,i)=>{
   const p=receiptItemProduct(item);
   const code=receiptVal(item,['product_code','code'],p.code||'—');
   const name=receiptVal(item,['product_name','name'],p.name||'—');
   const spec=receiptVal(item,['spec','specification','size','unit'],p.spec||p.specification||'—');
   const price=Number(receiptVal(item,['price','sale_price','unit_price'],p.price||0))||0;
   const ordered=Number(receiptVal(item,['ordered_qty','order_qty','qty'],0))||0;
   const notified=Number(receiptVal(item,['notice_qty','logistics_qty','shipped_qty','ordered_qty','qty'],ordered))||0;
   const accepted=Number(receiptVal(item,['accepted_qty','received_qty','checked_qty','actual_qty'],receipt.status==='arrived'?notified:0))||0;
   const line=receiptVal(item,['line_no','line','row_no','seq'],i+1);
   const lineReceived=receiptVal(item,['received_at','accepted_at','checked_at'],acceptedAt);
   const logisticsState=logisticsStatusZh(receiptVal(item,['logistics_status','status'],receipt.status||'—'));
   return `<tr>
    <td>${esc(receipt.receipt_no||receiptNo||'—')}</td>
    <td>${esc(line)}</td>
    <td>${esc(code)}</td>
    <td>${esc(name)}</td>
    <td>${esc(spec)}</td>
    <td>${money(price)}</td>
    <td>${ordered}</td>
    <td>${notified}</td>
    <td>${accepted}</td>
    <td>${lineReceived?fmtCloudTime(lineReceived):'—'}</td>
    <td>${esc(logisticsState)}</td>
   </tr>`;
  }).join('')||'<tr><td colspan="11">此進貨單目前沒有商品明細。</td></tr>';
  document.querySelector('#dialogBody').innerHTML=`<div class="ref-receipt-detail-v305">
   <div class="ref-receipt-meta-v305">
    <label><span>進貨單／實單編號</span><b>${esc(receipt.receipt_no||receiptNo||'—')}</b></label>
    <label><span>訂購單號</span><b>${esc(orderNo)}</b></label>
    <label><span>物流批次</span><b>${esc(receipt.batch_no||batchNo)}</b></label>
    <label><span>貨單簽到條碼</span><b>${esc(logisticsSignBarcode(receipt.batch_no||batchNo))}</b></label>
    <label><span>配送別</span><b>${esc(delivery)}</b></label>
    <label><span>驗收日</span><b>${acceptedAt?fmtCloudTime(acceptedAt):'尚未驗收'}</b></label>
    <label><span>狀態</span><b>${esc(logisticsEobAccepted(receipt)?'已驗收':'未驗收')}</b></label>
   </div>
   <div class="panel" style="margin:10px 0;text-align:center"><strong>貨單專用簽到碼</strong><div style="max-width:560px;margin:8px auto">${labelBarcodeHtml(logisticsSignBarcode(receipt.batch_no||batchNo),{height:72,moduleWidth:1.15})}</div><small>實體條碼槍：刷 Code128</small>${logisticsSignQrHtml(logisticsSignBarcode(receipt.batch_no||batchNo),180)}<small style="display:block">POS iPhone 相機：請掃上方 QR Code</small></div>
   ${receipt.virtual_ec_fallback?`<div class="notice ref-receipt-order-sync-note"><b>億家通 EC 共同貨單已接通。</b><br>目前直接依 EC 包裹 inbound_batch_no 還原 ${items.length} 件進貨包裹明細。</div>`:''}
   ${receipt.virtual_order_fallback?`<div class="notice ref-receipt-order-sync-note"><b>訂購／物流已找到關聯。</b><br>目前雲端尚未產生正式 inventory_receipts 明細，因此先以訂購單 ${esc(linkedOrder?.id||receipt.order_no||'')} 的商品還原貨單明細；進貨單＋確認書條碼仍可列印。</div>`:''}
   ${linkedOrder&&!receipt.virtual_order_fallback&&!(receiptArray(receipt.items).length||receiptArray(receipt.lines).length||receiptArray(receipt.details).length||receiptArray(receipt.receipt_items).length||receiptArray(receipt.inventory_items).length||receiptArray(receipt.item_rows).length)?`<div class="notice ref-receipt-order-sync-note">此進貨單尚未回傳商品明細，以下先同步顯示訂購單 ${esc(linkedOrder.id)} 的商品。</div>`:''}
   ${!linkedOrder&&promotionAutoArrivalReceiptItems(batchNo).length?`<div class="notice ref-receipt-order-sync-note">${promotionRepairAttempted?'已嘗試自動補同步活動商品明細。':'活動商品明細已同步。'} 活動自動到店舊貨單若尚未有明細，會先依活動設定補顯並嘗試回寫；Alpha 3.44 起所有貨單統一從進貨明細表同步讀取。</div>`:''}
   <div class="table-wrap ref-receipt-grid-wrap-v305">
    <table class="table ref-receipt-grid-v305">
     <thead><tr>
      <th>實單編號</th><th>行號</th><th>商品代號</th><th>品名</th><th>規格</th>
      <th>售價</th><th>進貨數</th><th>物流通知數</th><th>店鋪驗收量</th><th>驗收日</th><th>物流狀態</th>
     </tr></thead>
     <tbody>${rows}</tbody>
    </table>
   </div>
   <div class="ref-receipt-detail-actions-v305">
    <button class="button" id="receiptDetailSignPrint">🖨️ 列印簽到碼</button>
    <button class="button" id="receiptDetailPrint">🖨️ 進貨單＋確認書條碼列印</button>
    <button class="button" id="receiptDetailClose">離開</button>
   </div>
  </div>`;
  drawLogisticsSignQrs(document);
  document.querySelector('#receiptDetailClose').onclick=()=>genericDialog.close();
  document.querySelector('#receiptDetailSignPrint').onclick=()=>{const code=logisticsSignBarcode(receipt.batch_no||batchNo);printHTML(`物流貨單簽到碼 ${code}`,`<div style="width:76mm;padding:8mm 5mm;text-align:center"><h3>億家物流｜貨單專用簽到碼</h3>${labelBarcodeHtml(code,{height:72,moduleWidth:1.15})}<div style="font-size:16px;font-weight:700;margin:8px">${esc(code)}</div>${logisticsSignQrHtml(code,180)}</div>`);};
  document.querySelector('#receiptDetailPrint').onclick=()=>{
   const confirmCode=String(receipt.receipt_no||receiptNo||receipt.batch_no||batchNo||'').trim();
   const detail=document.querySelector('.ref-receipt-detail-v305')?.innerHTML||'';
   const confirmBlock=`<div style="page-break-before:always;padding:18mm;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC',sans-serif"><h1>億家｜配送確認書條碼</h1><p>進貨單／確認書編號：<b>${esc(confirmCode)}</b></p><div style="max-width:150mm;margin:16mm auto 6mm">${labelBarcodeHtml(confirmCode,{height:92,moduleWidth:1.25})}</div><div style="font-size:22px;font-weight:800;letter-spacing:1px">${esc(confirmCode)}</div><p style="margin-top:12mm">此條碼對應本張進貨單／配送數確認驗收資料。</p></div>`;
   printHTML(`進貨單＋確認書條碼 ${confirmCode}`,detail+confirmBlock);
  };
 }catch(e){
  document.querySelector('#dialogBody').innerHTML=`<div class="notice">進貨明細讀取失敗：${esc(e.message)}</div>`;
 }
}
function bindReceiptDetailButtons(){
 document.querySelectorAll('[data-receipt-detail]').forEach(btn=>{
  btn.onclick=()=>openInventoryReceiptDetail(btn.dataset.receiptDetail,btn.dataset.receiptNo||'');
 });
}

function bindInventoryPage(){
 const stockSearch=document.querySelector('#stocktakeTableSearch');
 if(stockSearch)stockSearch.oninput=()=>{
  const q=stockSearch.value.trim().toLowerCase();
  document.querySelectorAll('[data-stocktake-row]').forEach(row=>row.style.display=!q||row.textContent.toLowerCase().includes(q)?'':'none');
 };
 const stockScan=document.querySelector('[data-action="stocktake-scan"]');
 if(stockScan)stockScan.onclick=()=>scanCode({title:'掃碼盤點',onResult:code=>{
  const q=String(code||'').trim();
  const p=products().find(x=>productBarcodes(x).includes(q)||String(x.code||'')===q);
  if(!p)return alert('找不到此商品');
  const row=document.querySelector(`[data-stocktake-row="${p.id}"]`);
  document.querySelectorAll('[data-stocktake-row]').forEach(x=>x.style.display=x===row?'':'none');
  if(stockSearch)stockSearch.value=q;
  row?.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>document.querySelector(`[data-stocktake-actual="${p.id}"]`)?.focus(),250);
 }});


 document.querySelectorAll(
  '[data-action="inventory-month-setting"],[data-action="inventory-print"],[data-action="inventory-order-limits"],'+
  '[data-action="stocktake-start"],[data-action="stocktake-complete"],[data-action="stocktake-scan"],'+
  '[data-delete-stocktake-batch],[data-delete-stocktake-record]'
 ).forEach(b=>{b.dataset.inventoryBound='1'});

 const updatePreview=id=>{
  const ps=load(K.products,[]),p=ps.find(x=>x.id===id);
  const input=document.querySelector(`[data-stocktake-actual="${id}"]`);
  const diffEl=document.querySelector(`[data-stocktake-diff="${id}"]`);
  if(!p||!input||!diffEl)return;
  if(input.value===''){return}
  const actual=Math.max(0,Number(input.value||0)),book=scSurfaceStockValue(p),diff=actual-book;
  diffEl.textContent=`${diff>0?'+':''}${diff}`;
  diffEl.classList.toggle('diff-ok',diff===0);
  diffEl.classList.toggle('diff-over',diff>0);
  diffEl.classList.toggle('diff-short',diff<0);
 };

 document.querySelectorAll('[data-stocktake-actual]').forEach(input=>{
  input.oninput=()=>updatePreview(input.dataset.stocktakeActual);
 });

 document.querySelectorAll('[data-stocktake-save]').forEach(btn=>{
  btn.onclick=async()=>{
   const id=btn.dataset.stocktakeSave;
   const input=document.querySelector(`[data-stocktake-actual="${id}"]`);
   const reasonEl=document.querySelector(`[data-stocktake-reason="${id}"]`);
   const statusEl=document.querySelector(`[data-stocktake-status="${id}"]`);
   if(!input||input.value==='')return alert('請輸入實際盤點數');

   const ps=load(K.products,[]),p=ps.find(x=>x.id===id);
   if(!p)return alert('找不到商品');

   const book=scSurfaceStockValue(p);
   const actual=Math.max(0,Number(input.value||0));
   const diff=actual-book;
   const surface=scSurfaceStockMap();surface[String(p.id)]=actual;save('yj_sc_surface_stock',surface);

   const moves=load(K.inventoryMoves,[]);
   const batches=load(K.stocktakeBatches,[]);
   const active=batches.find(x=>x.status==='進行中');
   const month=active?.stocktakeMonth||load(K.stocktakeMonth,new Date().toISOString().slice(0,7))||new Date().toISOString().slice(0,7);
   moves.unshift({
    id:uid(),product:p.name,qty:diff,bookQty:book,actualQty:actual,type:'盤點',
    stocktakeMonth:month,batchId:active?.id||'',batchNo:active?.batchNo||'',
    reason:reasonEl?.value||'',user:currentUser().name,at:new Date().toISOString()
   });
   save(K.inventoryMoves,moves);

   if(active){
    active.itemCount=Number(active.itemCount||0)+1;
    active.diffTotal=Number(active.diffTotal||0)+diff;
    save(K.stocktakeBatches,batches);
    const summary=document.querySelector('#activeStocktakeSummary small');
    if(summary)summary.textContent=`狀態：進行中・已盤 ${Number(active.itemCount||0)} 項・開始 ${new Date(active.startedAt).toLocaleString('zh-TW')}`;
   }

   saveAudit('盤點',`${p.name} 帳面 ${book}｜實盤 ${actual}｜差異 ${diff>0?'+':''}${diff}`);

   const bookEl=document.querySelector(`[data-stocktake-book="${id}"]`);
   const diffEl=document.querySelector(`[data-stocktake-diff="${id}"]`);
   if(bookEl)bookEl.textContent=String(actual);
   if(diffEl)diffEl.textContent=`${diff>0?'+':''}${diff}`;
   input.value='';
   if(reasonEl)reasonEl.value='';
   if(statusEl){
    statusEl.className='ref-stocktake-saved-v303 saved';
    statusEl.innerHTML=`✓ 已儲存<small>${new Date().toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} ${esc(currentUser().name||'')}</small>`;
   }

   const total=ps.reduce((sum,x)=>sum+scSurfaceStockValue(x),0);
   const totalEl=document.querySelector('#inventoryMetricBookTotal');
   if(totalEl)totalEl.textContent=String(total);
   const latestMoves=load(K.inventoryMoves,[]).filter(x=>x.type==='盤點'&&(x.stocktakeMonth||String(x.at||'').slice(0,7))===month);
   const latestByProduct={};
   latestMoves.forEach(x=>{if(latestByProduct[x.product]===undefined)latestByProduct[x.product]=Number(x.qty||0)});
   const diffTotal=Object.values(latestByProduct).reduce((sum,x)=>sum+Number(x||0),0);
   const metricDiff=document.querySelector('#inventoryMetricDiff');
   if(metricDiff)metricDiff.textContent=`${diffTotal>0?'+':''}${diffTotal}`;

   // 商品主檔共用、庫存層分店；直接同步目前商品資料，不做整頁 render。
   if(cloudConfigured()){
    try{await cloudPushKey('yj_sc_surface_stock',scSurfaceStockMap());await cloudPushKey(K.inventoryMoves,moves);if(active)await cloudPushKey(K.stocktakeBatches,batches)}
    catch(err){console.warn('盤點表格雲端同步失敗，已保留本機資料',err)}
   }
  };
 });
}
function bindStoreOperationsHome(){
 document.querySelectorAll('[data-home-open]').forEach(el=>el.addEventListener('click',()=>render(el.dataset.homeOpen||'home')));

 // 首頁日期只負責切換目前顯示日期／週別，不再跳出另一個行事曆頁或明細視窗。
 document.querySelectorAll('[data-home-date]').forEach(el=>el.addEventListener('click',()=>{
  const date=String(el.dataset.homeDate||'');
  if(!date)return;
  sessionStorage.setItem('yj_home_selected_date',date);
  render('home');
 }));

 // 本週＝切回今天所在的一整週；本日＝只顯示今天。
 document.querySelectorAll('[data-home-mode]').forEach(el=>el.addEventListener('click',()=>{
  const mode=el.dataset.homeMode==='day'?'day':'week';
  sessionStorage.setItem('yj_home_calendar_mode',mode);
  sessionStorage.setItem('yj_home_selected_date',homeDateKey(new Date()));
  render('home');
 }));

 // 左右鍵依目前模式切換：本日為前/後一天；本週為前/後一週。
 document.querySelectorAll('[data-home-shift]').forEach(el=>el.addEventListener('click',()=>{
  const d=homeSelectedDate();
  const delta=homeCalendarMode()==='day'?1:7;
  d.setDate(d.getDate()+(el.dataset.homeShift==='prev'?-delta:delta));
  sessionStorage.setItem('yj_home_selected_date',homeDateKey(d));
  render('home');
 }));

 document.querySelectorAll('[data-home-event-type="notice"]').forEach(el=>el.addEventListener('click',()=>{window.__yjNoticeDetailId=el.dataset.homeEventId;render('notice')}));
 document.querySelectorAll('[data-home-event-type="vendor"]').forEach(el=>el.addEventListener('click',()=>alert('廠商到店人員：'+el.textContent.trim())));
 document.querySelectorAll('[data-home-prebuild]').forEach(el=>el.addEventListener('click',()=>{const label=el.dataset.homePrebuild;if(label==='自設提醒'){const p=scPrebuildChildren('店務管理').find(x=>x[1]==='自動登出時間設定');if(p)return render(p[0])} alert(`${label}功能入口已接通，請由對應選單進入。`)}));
 document.querySelectorAll('.logistics-home-row[data-nav]').forEach(el=>el.addEventListener('click',()=>render(el.dataset.nav)));
}

function bind(p){
 if(p==='home')setTimeout(bindStoreOperationsHome,0);
 const employeeReferenceSelect=document.querySelector('#employeeReferenceSelect');
 if(employeeReferenceSelect)employeeReferenceSelect.onchange=()=>{
  document.querySelectorAll('[data-employee-ref-view]').forEach(x=>x.classList.toggle('active',x.dataset.employeeRefView===employeeReferenceSelect.value));
 };
 document.querySelectorAll('[data-employee-permission-scroll]').forEach(btn=>btn.onclick=()=>{
  document.querySelector('#employeePermissionSection')?.scrollIntoView({behavior:'smooth',block:'start'});
 });
 document.querySelectorAll('[data-employee-edit-selected]').forEach(btn=>btn.onclick=()=>{
  const id=document.querySelector('#employeeReferenceSelect')?.value;
  const target=load(K.employees,[]).find(x=>x.id===id);
  if(!target)return alert('請先選擇員工');
  if(!canEditEmployeeTarget(currentUser(),target))return alert('不能修改此人員');
  openEmployeeSettings(target);
 });

 if(p==='inventory')bindInventoryPage();
 if(p==='operations')bindOperationsPage();
 if(p==='monthly-operating-preview'){
  document.querySelector('#monthlyOperatingYear')?.addEventListener('change',e=>{sessionStorage.setItem('yj_monthly_operating_year',String(e.target.value||''));});
  document.querySelector('[data-action="monthly-operating-query"]')?.addEventListener('click',()=>render('monthly-operating-preview'));
  document.querySelector('[data-action="monthly-operating-print"]')?.addEventListener('click',()=>{
   const table=document.querySelector('.monthly-operating-table')?.outerHTML||'';
   printHTML('月度營運分析',`<p>店號：${esc(currentStoreCode())}</p>${table}`);
  });
  document.querySelector('[data-action="monthly-operating-export"]')?.addEventListener('click',()=>{const table=document.querySelector('.monthly-operating-table');if(!table)return;const csv=[...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>'\"'+String(td.innerText||'').replace(/\"/g,'\"\"')+'\"').join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`月度營運分析_${currentStoreCode()}_${document.querySelector('#monthlyOperatingYear')?.value||''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);});
 }
 if(p==='notice')bindNoticePage();
 if(p==='franchise-area')bindFranchiseArea();
 if(p==='stores'){
  const menu=document.querySelector('#founderNoticeEditorMenu');
  if(menu)menu.onchange=()=>{if(!isFounder())return;const mode=String(menu.value||'');if(!mode)return;window.__yjNoticeEditorMode=mode;window.__yjNoticeEditorSelected='';render('notice-editor');};
 }
 if(p==='notice-editor'){
  document.querySelector('#noticeEditorSelect')?.addEventListener('change',e=>{window.__yjNoticeEditorSelected=e.target.value;render('notice-editor')});
 }

 if(p==='home')bindStoreSwitchSelect();
 if(p==='home'||p==='dashboard'){setTimeout(()=>{refreshMemberAnomalyCloud();refreshHomeSystemMessages()},0);clearInterval(window.__yjHomeClock);window.__yjHomeClock=setInterval(()=>{const n=new Date(),el=document.querySelector('#homeLiveClock'),dt=document.querySelector('#topDateTime');if(el)el.textContent=n.toLocaleTimeString('zh-TW',{hour12:false});if(dt){const wd='日一二三四五六'[n.getDay()];dt.textContent=`${n.getFullYear()-1911}年${String(n.getMonth()+1).padStart(2,'0')}月${String(n.getDate()).padStart(2,'0')}日(週${wd}) ${n.toLocaleTimeString('zh-TW',{hour12:false})}`;}refreshHomeSystemMessages()},1000)}
 document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>render(b.dataset.page));document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>document.querySelector('#'+b.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));if(p==='pos'){state.category='全部';drawPOS();bindPosMemberPanel();document.querySelectorAll('[data-pos-correction-qty]').forEach(el=>el.oninput=()=>el.closest('.correction-pos-row')?.classList.toggle('active',Number(el.value||0)>0));const posSearch=document.querySelector('#search');posSearch.oninput=drawPOS;posSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitPosSearch()}};setTimeout(checkFreshExpiryAlerts,100)}if(p==='app-settings')bindAppAnybuyImageUploads();if(p==='tm-anybuy-settings')bindTmAnybuyImageUploads();if(p==='ordering-ledger')bindScLedgerPage();
 if(p==='ordering-specified-date'){
  const q=document.querySelector('#specifiedOrderSearch');
  q?.addEventListener('input',()=>{const v=String(q.value||'').trim().toLowerCase();document.querySelectorAll('[data-specified-row]').forEach(tr=>tr.hidden=!!v&&!String(tr.dataset.specifiedSearch||'').includes(v))});
  document.querySelectorAll('[data-specified-add]').forEach(b=>b.addEventListener('click',async()=>{
   const p=products().find(x=>String(x.id)===String(b.dataset.specifiedAdd));if(!p)return;
   const qty=document.querySelector(`[data-specified-qty="${p.id}"]`)?.value||1;
   const date=document.querySelector('#specifiedOrderDate')?.value||'';
   await addSpecifiedDateOrder(p,qty,date);
  }));
 }
if(String(p).startsWith('ordering')&&p!=='ordering-ledger'){
 document.querySelectorAll('[data-order-filter]').forEach(b=>b.onclick=()=>{const rows=load(K.orders,[]).filter(x=>x.type===b.dataset.orderFilter);document.querySelector('#orderRows').innerHTML=orderRows(rows)});
 const bindQty=(selector,ai)=>{
  document.querySelectorAll(selector).forEach(input=>{
   input.onfocus=()=>input.select();
   if(!ai){
    input.oninput=()=>{
     const id=input.dataset.orangeOrderStoreQty;
     const product=products().find(x=>String(x.id)===String(id));
     if(!product||!productOrderingAllowedToday(product)||!productOrderSwitchState(product).store)return;
     // Alpha 4.65：所有 ordering-* 詳細頁都綁定店訂輸入事件；輸入當下即保存，切換商品後仍可讀回。
     upsertOrangeOrderDraftQty(product,input.value,{ai:false,audit:false});
    };
   }
   input.onchange=async()=>{
    const id=ai?input.dataset.orangeOrderSystemQty:input.dataset.orangeOrderStoreQty;
    const p=products().find(x=>String(x.id)===String(id));if(!p)return alert('找不到商品');
    if(!productOrderingAllowedToday(p)){input.value='0';alert('此商品今日不可訂購');deferRefreshOrderingCurrentView();return;}
    if(ai){
     const sw=productOrderSwitchState(p);if(!sw.system){input.value='0';deferRefreshOrderingCurrentView();return;}
     await setProductSystemQtyOverride(p.id,input.value);
    }
    if(upsertOrangeOrderDraftQty(p,input.value,{ai}))deferRefreshOrderingCurrentView();
   };
   input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();input.blur()}};
  });
 };
 bindQty('[data-orange-order-store-qty]',false);
 bindQty('[data-orange-order-system-qty]',true);
 document.querySelectorAll('[data-orange-order-reservation-qty]').forEach(input=>{
  input.onfocus=()=>input.select();
  input.onchange=async()=>{const p=products().find(x=>String(x.id)===String(input.dataset.orangeOrderReservationQty));if(!p)return alert('找不到商品');await setOrderReservationQty(p,input.value);deferRefreshOrderingCurrentView()};
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();input.blur()}};
 });
}if(p==='ordering'||p==='logistics')bindReceiptDetailButtons();if(p==='products'){
 const s=document.querySelector('#productAdminSearch'),rows=document.querySelector('#productAdminRows');
 const bindProductTableQuickActions=()=>{
  document.querySelectorAll('[data-product-negative]').forEach(el=>{
   el.onchange=async()=>{
    if(!hasPermission('productEdit')){el.checked=!el.checked;return alert('需要「修改商品」權限')}
    const ps=load(K.products,[]),p=ps.find(x=>x.id===el.dataset.productNegative);
    if(!p){el.checked=!el.checked;return alert('找不到商品')}
    const before=p.allowNegativeStock===true;
    p.allowNegativeStock=el.checked===true;
    save(K.products,ps);
    const label=el.closest('label')?.querySelector('span');if(label)label.textContent=p.allowNegativeStock?'允許':'禁止';
    saveAudit('快速設定負庫存',`${p.code||''}｜${p.name}｜${before?'允許':'禁止'}→${p.allowNegativeStock?'允許':'禁止'}`);
    if(cloudConfigured()){
     try{await cloudPushKey(K.products,ps)}
     catch(err){console.warn('負庫存設定雲端同步失敗，已保留本機',err)}
    }
   };
  });
 };
 if(s&&rows)s.oninput=()=>{rows.innerHTML=products().filter(x=>productMatches(x,s.value)).map(productRow).join('')||'<tr><td colspan="16">查無商品</td></tr>';bindProductTableQuickActions()};
 bindProductTableQuickActions();
 document.querySelectorAll('[data-action="manage-groups"],[data-action="product-multiple-settings"],[data-action="linked-inventory-settings"],[data-action="new-product"],[data-edit-product],[data-delete-product]').forEach(x=>x.dataset.productBound='1');
}if(p==='members'||p==='member-analysis'){bindMemberPointLedger();}if(p==='transactions'||p==='transactions-front'){
 bindTransactionMasterDetail(p==='transactions-front');
 scheduleTransactionCloudRefresh(p);
}}
function drawPOS(){
 const search=document.querySelector('#search');
 const q=(search?.value||'').toLowerCase();
 document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===state.category));
 document.querySelectorAll('[data-pay]').forEach(b=>b.classList.toggle('selected',b.dataset.pay===state.payment));
 const rows=products().filter(x=>{const matchCategory=state.category==='全部'||x.category===state.category;const matchSearch=[x.name,x.shortName,x.code,x.category,...productBarcodes(x)].some(v=>String(v||'').toLowerCase().includes(q));return matchCategory&&matchSearch;});
 const pg=document.querySelector('#productGrid');if(pg)pg.innerHTML=rows.map(x=>`<button class="product-card" data-product="${x.id}"><div class="pic">${x.icon||'📦'}</div><strong>${esc(x.name)}</strong><b>${money(x.price)}</b><small>${esc(x.code||'')}｜庫存 ${x.stock}</small></button>`).join('')||'<div class="empty">此分類沒有商品</div>';
 document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>{try{add(b.dataset.product,'browse');drawPOS()}catch(e){alert(e.message)}});
 const cl=document.querySelector('#cartList');if(cl)cl.innerHTML=state.cart.map(x=>`<div class="cart-row pos2-cart-row ${state.selected===x.id?'selected':''}" data-cart="${x.id}"><strong>${esc(x.name)}<small class="cart-code">${esc(x.code||'')}</small>${x.freshDiscounted?'<small class="fresh-discount-label">鮮食效期 5 折</small>':''}</strong><span>${money(x.price)}${x.freshDiscounted?`<small class="original-price">${money(x.originalPrice)}</small>`:''}</span><span class="qty"><button data-minus="${x.id}">−</button><input data-qty-input="${x.id}" value="${x.qty}" inputmode="numeric" aria-label="數量"><button data-plus="${x.id}">＋</button></span><span class="cart-subtotal">${money(x.price*x.qty)} <button data-remove="${x.id}" aria-label="刪除">×</button></span></div>`).join('')||'<div class="empty">購物車是空的</div>';
 const t=totals(),tb=document.querySelector('#totalBox');if(tb)tb.innerHTML=`<div class="total-row"><span>小計</span><span>${money(t.subtotal)}</span></div><div class="total-row"><span>折扣</span><span>-${money(state.discount)}</span></div><div class="total-row grand"><span>應收</span><span>${money(t.total)}</span></div><div class="total-count">共 ${state.cart.reduce((s,x)=>s+Number(x.qty||0),0)} 件商品</div>`;
 document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=e=>{e.stopPropagation();try{qty(b.dataset.plus,1);drawPOS()}catch(err){alert(err.message)}});
 document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=e=>{e.stopPropagation();try{qty(b.dataset.minus,-1);drawPOS()}catch(err){alert(err.message)}});
 document.querySelectorAll('[data-qty-input]').forEach(i=>{i.onclick=e=>e.stopPropagation();i.onchange=()=>{try{setQty(i.dataset.qtyInput,Number(i.value));drawPOS()}catch(err){alert(err.message);drawPOS()}}});
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=e=>{e.stopPropagation();state.cart=state.cart.filter(x=>x.id!==b.dataset.remove);drawPOS()});
 document.querySelectorAll('[data-cart]').forEach(r=>r.onclick=()=>{state.selected=r.dataset.cart;drawPOS()});
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;drawPOS()});
 document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{state.payment=b.dataset.pay;drawPOS()});
 const note=document.querySelector('#transactionNote');if(note){note.value=state.note||'';note.oninput=()=>state.note=note.value;}
}
function openProductMultipleSettings(){
 if(!requirePermission('productMultipleEdit'))return;
 const ps=products();
 dlg('商品倍數設定',`<p>設定商品訂購倍數：數量與單位分開選擇，例如「1倍 3包」、「1倍 2箱」。</p><div class="table-wrap"><table class="table"><tr><th>商品</th><th>配送別</th><th>倍數設定</th></tr>${ps.map(p=>`<tr><td>${esc(p.code||'')}｜${esc(p.name)}</td><td>${esc(normalizeDeliveryLabel(p.deliveryType||p.logistics||''))}</td><td><div class="order-multiple-combo"><span>1倍</span><select data-multiple-product="${p.id}" class="order-multiple-select">${orderMultipleSelectOptions(orderPackQty(p))}</select><select data-multiple-unit="${p.id}" class="order-multiple-select">${orderMultipleUnitOptions(p.orderMultipleUnit||'個')}</select></div></td></tr>`).join('')}</table></div><button class="primary" id="saveProductMultiples">儲存倍數設定</button>`);
 setTimeout(()=>{document.querySelector('#saveProductMultiples').onclick=()=>{const rows=load(K.products,[]);document.querySelectorAll('[data-multiple-product]').forEach(el=>{
     const p=rows.find(x=>x.id===el.dataset.multipleProduct);if(!p)return;
     p.orderMultipleQty=Math.max(1,Number(el.value)||1);
     const unit=document.querySelector(`[data-multiple-unit="${p.id}"]`)?.value||'個';
     p.orderMultipleUnit=['個','包','箱'].includes(unit)?unit:'個';
     p.orderMultiplePacks=p.orderMultipleUnit==='包'?p.orderMultipleQty:1;
     p.orderMultipleBoxes=p.orderMultipleUnit==='箱'?p.orderMultipleQty:1;
    });
    save(K.products,rows);saveAudit('商品倍數設定',`${rows.length}項商品`);genericDialog.close();render('products')}},0);
}




function tmQuickAmountKeys(){
 const rows=load(TM_QUICK_AMOUNT_KEYS_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
async function saveTmQuickAmountKeys(rows,action,detail=''){
 save(TM_QUICK_AMOUNT_KEYS_KEY,rows);
 saveAudit(action,detail);
 if(cloudConfigured()){
  const ok=await cloudPushKey(TM_QUICK_AMOUNT_KEYS_KEY,rows);
  if(!ok)alert('快速金額鍵已儲存於 SC，但同步所有門市 TM 失敗，請檢查雲端連線');
 }
}
function openTmQuickAmountEditor(existingId=''){
 if(!canManageTmScreenCategories())return alert('TM快速金額鍵只有總部的創辦人、總部人員、工程師可以設定');
 const rows=tmQuickAmountKeys(),cur=existingId?rows.find(x=>String(x.id)===String(existingId)):null;
 const ps=load(K.products,[]).filter(x=>x.active!==false&&x.tmHidden!==true);
 dlg(cur?'修改 TM 快速金額鍵':'新增 TM 快速金額鍵',`
  <div class="panel">
   <label>按鍵名稱<input id="tmQuickKeyName" value="${esc(cur?.name||'')}" placeholder="例如：蕃薯 $45"></label>
   <label>金額<input id="tmQuickKeyAmount" type="number" min="0" step="1" value="${Number(cur?.amount||0)}"></label>
   <label>對應商品 1<select id="tmQuickKeyProduct1"><option value="">請選擇商品</option>${ps.map(p=>`<option value="${esc(p.id)}" ${String(cur?.productId1||cur?.productId||'')===String(p.id)?'selected':''}>${esc(p.code||'')}｜${esc(p.name||'')}</option>`).join('')}</select></label>
   <label>對應商品 2<select id="tmQuickKeyProduct2"><option value="">不設定第二商品</option>${ps.map(p=>`<option value="${esc(p.id)}" ${String(cur?.productId2||'')===String(p.id)?'selected':''}>${esc(p.code||'')}｜${esc(p.name||'')}</option>`).join('')}</select><small>設定兩個商品後，TM 按下此快速金額鍵時會先讓收銀員選擇要帶入哪一個商品。</small></label>
   <label>排列順序<input id="tmQuickKeySort" type="number" min="1" value="${Number(cur?.sort||rows.length+1)}"></label>
   <label class="check-field"><input id="tmQuickKeyActive" type="checkbox" ${cur?.active===false?'':'checked'}>啟用</label>
   <button class="primary" id="tmQuickKeySave">儲存</button>
  </div>`);
 setTimeout(()=>document.querySelector('#tmQuickKeySave')?.addEventListener('click',async()=>{
  const name=String(document.querySelector('#tmQuickKeyName')?.value||'').trim();
  const amount=Math.max(0,Number(document.querySelector('#tmQuickKeyAmount')?.value||0));
  const productId1=String(document.querySelector('#tmQuickKeyProduct1')?.value||'');
  const productId2=String(document.querySelector('#tmQuickKeyProduct2')?.value||'');
  const sort=Math.max(1,Number(document.querySelector('#tmQuickKeySort')?.value||1));
  if(!name)return alert('請輸入按鍵名稱');
  if(!productId1)return alert('請選擇對應商品 1');
  if(productId2&&productId1===productId2)return alert('對應商品 1 與對應商品 2 不可相同');
  if(amount<=0)return alert('金額必須大於 0');
  const next={id:cur?.id||uid(),name,amount,productId1,productId2,productId:productId1,sort,active:!!document.querySelector('#tmQuickKeyActive')?.checked,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
  if(cur)Object.assign(cur,next);else rows.push(next);
  rows.sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
  await saveTmQuickAmountKeys(rows,cur?'修改 TM 快速金額鍵':'新增 TM 快速金額鍵',`${name}｜${amount}元｜全門市同步`);
  genericDialog.close();openTmQuickAmountSettings();
 }),0);
}
function openTmQuickAmountSettings(){
 if(!canManageTmScreenCategories())return alert('TM快速金額鍵只有總部的創辦人、總部人員、工程師可以設定');
 const rows=tmQuickAmountKeys(),ps=load(K.products,[]);
 dlg('TM快速金額鍵設定',`
  <div class="page-head"><div><h3>TM 快速金額鍵</h3><small>例如蕃薯依售價直接按 $35／$45／$55；不修改商品主檔售價。</small></div><button class="primary" id="tmQuickKeyAdd">＋ 新增</button></div>
  <div class="table-wrap"><table class="table"><thead><tr><th>順序</th><th>按鍵名稱</th><th>金額</th><th>對應商品</th><th>狀態</th><th>操作</th></tr></thead><tbody>
  ${rows.map(x=>{const p1=ps.find(p=>String(p.id)===String(x.productId1||x.productId));const p2=ps.find(p=>String(p.id)===String(x.productId2||''));return `<tr><td>${Number(x.sort||0)}</td><td>${esc(x.name||'')}</td><td>${money(x.amount||0)}</td><td>${esc(p1?.name||'找不到商品')}${p2?`<br><small>＋ ${esc(p2.name||'')}</small>`:''}</td><td>${x.active===false?'停用':'啟用'}</td><td><button class="button" data-tm-quick-edit="${esc(x.id)}">修改</button> <button class="button danger" data-tm-quick-delete="${esc(x.id)}">刪除</button></td></tr>`}).join('')||'<tr><td colspan="6">尚未設定快速金額鍵</td></tr>'}
  </tbody></table></div>`);
 setTimeout(()=>{
  document.querySelector('#tmQuickKeyAdd')?.addEventListener('click',()=>openTmQuickAmountEditor());
  document.querySelectorAll('[data-tm-quick-edit]').forEach(b=>b.addEventListener('click',()=>openTmQuickAmountEditor(b.dataset.tmQuickEdit)));
  document.querySelectorAll('[data-tm-quick-delete]').forEach(b=>b.addEventListener('click',async()=>{
   const id=String(b.dataset.tmQuickDelete||''),all=tmQuickAmountKeys(),row=all.find(x=>String(x.id)===id);if(!row)return;
   if(!confirm(`確定刪除「${row.name}」？`))return;
   await saveTmQuickAmountKeys(all.filter(x=>String(x.id)!==id),'刪除 TM 快速金額鍵',`${row.name}｜全門市同步`);
   openTmQuickAmountSettings();
  }));
 },0);
}

function tmScreenCategories(){
 const rows=load(TM_SCREEN_CATEGORIES_KEY,[]);
 return Array.isArray(rows)?rows:[];
}
async function saveTmScreenCategories(rows,action,detail=''){
 save(TM_SCREEN_CATEGORIES_KEY,rows);
 saveAudit(action,detail);
 if(cloudConfigured()){
  const ok=await cloudPushKey(TM_SCREEN_CATEGORIES_KEY,rows);
  if(!ok)alert('分類已儲存於 SC，但同步所有門市 TM 失敗，請檢查雲端連線');
 }
}
function openTmScreenCategoryEditor(existingId=''){
 if(!canManageTmScreenCategories())return alert('TM畫面分類只有總部的創辦人、總部人員、工程師可以設定');
 const rows=tmScreenCategories();
 const current=existingId?rows.find(x=>String(x.id)===String(existingId)):null;
 const ps=load(K.products,[]).filter(x=>x.active!==false&&x.tmHidden!==true);
 const selected=new Set(Array.isArray(current?.productIds)?current.productIds.map(String):[]);
 const assignedByOther=new Map();
 for(const row of rows){
  if(current&&String(row.id)===String(current.id))continue;
  for(const id of (row.productIds||[]))assignedByOther.set(String(id),String(row.name||'其他分類'));
 }
 dlg(current?'修改 TM 畫面分類':'新增 TM 畫面分類',`
  <div class="tm-screen-category-editor">
   <section class="panel tm-screen-category-basic">
    <h3>① 分類名稱</h3>
    <label>分類名稱<input id="tmScreenCategoryName" value="${esc(current?.name||'')}" placeholder="例如：飲料／零食／生活用品"></label>
   </section>
   <section class="panel tm-screen-category-products">
    <div class="page-head">
     <div><h3>② 指定此分類要顯示的商品</h3><small>可以先建立空分類，再從「商品設定」指定商品；勾選後儲存會同步所有門市 TM。</small></div>
     <b id="tmScreenCategorySelectedCount">已選 ${selected.size} 項</b>
    </div>
    <div class="tm-screen-category-searchbar">
     <input id="tmScreenCategorySearch" placeholder="搜尋商品代號／名稱／條碼">
     <button type="button" class="button" id="tmScreenCategorySelectAllVisible">全選目前顯示</button>
     <button type="button" class="button" id="tmScreenCategoryClearAll">全部取消</button>
    </div>
    <div class="tm-screen-category-product-table-wrap">
     <table class="table tm-screen-category-product-table">
      <thead><tr><th>選擇</th><th>商品代號</th><th>商品名稱</th><th>目前分類</th></tr></thead>
      <tbody>
       ${ps.map(p=>{
        const pid=String(p.id),other=assignedByOther.get(pid)||'未分類';
        return `<tr data-tm-screen-product-row="${esc([p.code,p.name,...productBarcodes(p)].join(' ').toLowerCase())}">
         <td><input type="checkbox" data-tm-screen-product="${esc(pid)}" ${selected.has(pid)?'checked':''}></td>
         <td>${esc(p.code||'')}</td><td><b>${esc(p.name||'')}</b></td>
         <td>${selected.has(pid)?esc(current?.name||'目前分類'):esc(other)}</td>
        </tr>`;
       }).join('')||'<tr><td colspan="4">目前沒有可設定商品</td></tr>'}
      </tbody>
     </table>
    </div>
   </section>
   <div class="tm-screen-category-savebar"><button class="primary" id="tmScreenCategorySave">儲存分類與商品</button></div>
  </div>`);
 setTimeout(()=>{
  const search=document.querySelector('#tmScreenCategorySearch'),count=document.querySelector('#tmScreenCategorySelectedCount');
  const updateCount=()=>{if(count)count.textContent=`已選 ${document.querySelectorAll('[data-tm-screen-product]:checked').length} 項`};
  document.querySelectorAll('[data-tm-screen-product]').forEach(el=>el.addEventListener('change',updateCount));
  search?.addEventListener('input',()=>{
   const q=String(search.value||'').trim().toLowerCase();
   document.querySelectorAll('[data-tm-screen-product-row]').forEach(el=>el.hidden=!!q&&!String(el.dataset.tmScreenProductRow||'').includes(q));
  });
  document.querySelector('#tmScreenCategorySelectAllVisible')?.addEventListener('click',()=>{
   document.querySelectorAll('[data-tm-screen-product-row]').forEach(tr=>{if(!tr.hidden){const box=tr.querySelector('[data-tm-screen-product]');if(box)box.checked=true}});updateCount();
  });
  document.querySelector('#tmScreenCategoryClearAll')?.addEventListener('click',()=>{document.querySelectorAll('[data-tm-screen-product]').forEach(box=>box.checked=false);updateCount()});
  document.querySelector('#tmScreenCategorySave')?.addEventListener('click',async()=>{
   const name=String(document.querySelector('#tmScreenCategoryName')?.value||'').trim();
   if(!name)return alert('請輸入分類名稱');
   if(rows.some(x=>String(x.id)!==String(current?.id||'')&&String(x.name||'').trim()===name))return alert('分類名稱不可重複');
   const productIds=[...document.querySelectorAll('[data-tm-screen-product]:checked')].map(x=>String(x.dataset.tmScreenProduct));
   // 分類可先建立，再從「商品設定」補商品；不再要求新增分類時一定先勾商品。
   for(const row of rows){
    if(current&&String(row.id)===String(current.id))continue;
    row.productIds=(Array.isArray(row.productIds)?row.productIds:[]).map(String).filter(id=>!productIds.includes(id));
   }
   const next={id:current?.id||uid(),name,productIds,active:true,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
   if(current)Object.assign(current,next);else rows.push(next);
   await saveTmScreenCategories(rows,current?'修改 TM 畫面分類':'新增 TM 畫面分類',`${name}｜${productIds.length}項｜全門市同步`);
   openTmScreenCategoriesSettings();
  });
  updateCount();
 },0);
}
function openTmScreenCategoriesSettings(){
 if(!canManageTmScreenCategories())return alert('TM畫面分類只有總部的創辦人、總部人員、工程師可以設定');
 const rows=tmScreenCategories();
 dlg('TM畫面分類設定',`
  <div class="page-head"><div><h3>TM 畫面分類</h3><small>自助結帳左側分類不再依溫層顯示，改用此處設定。</small></div><button class="primary" id="tmScreenCategoryAdd">＋ 新增</button></div>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>順序</th><th>分類名稱</th><th>商品數</th><th>操作</th></tr></thead>
   <tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name||'')}</b></td><td>${(x.productIds||[]).length}</td><td><button class="button" data-tm-screen-category-edit="${esc(x.id)}">修改</button> <button class="button" data-tm-screen-category-products="${esc(x.id)}">商品設定</button> <button class="button danger" data-tm-screen-category-delete="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="4">尚未設定分類</td></tr>'}</tbody>
  </table></div>`);
 setTimeout(()=>{
  document.querySelector('#tmScreenCategoryAdd')?.addEventListener('click',()=>openTmScreenCategoryEditor());
  document.querySelectorAll('[data-tm-screen-category-edit]').forEach(b=>b.addEventListener('click',()=>openTmScreenCategoryEditor(b.dataset.tmScreenCategoryEdit)));
  document.querySelectorAll('[data-tm-screen-category-products]').forEach(b=>b.addEventListener('click',()=>openTmScreenCategoryEditor(b.dataset.tmScreenCategoryProducts)));
  document.querySelectorAll('[data-tm-screen-category-delete]').forEach(b=>b.addEventListener('click',async()=>{
   const id=String(b.dataset.tmScreenCategoryDelete||''),all=tmScreenCategories(),row=all.find(x=>String(x.id)===id);if(!row)return;
   if(!confirm(`確定刪除分類「${row.name}」？`))return;
   await saveTmScreenCategories(all.filter(x=>String(x.id)!==id),'刪除 TM 畫面分類',`${row.name}｜全門市同步`);
   openTmScreenCategoriesSettings();
  }));
 },0);
}


const SELF_ANYBUY_CATEGORIES_KEY='yj_self_anybuy_categories';
const SELF_ANYBUY_PRODUCTS_KEY='yj_self_anybuy_products';
function selfAnybuyCategories(){const rows=load(SELF_ANYBUY_CATEGORIES_KEY,[]);return Array.isArray(rows)?rows:[]}
function selfAnybuyProducts(){const rows=load(SELF_ANYBUY_PRODUCTS_KEY,[]);return Array.isArray(rows)?rows:[]}
async function saveSelfAnybuyConfig(key,rows,action,detail){save(key,rows);saveAudit(action,detail);if(cloudConfigured()){const ok=await cloudPushKey(key,rows);if(!ok)alert('設定已儲存於 SC，但同步所有門市 TM 失敗，請檢查雲端連線')}}
function openSelfAnybuyCategoryEditor(existingId=''){
 if(!canManageTmScreenCategories())return alert('自助模式分類設定只有總部的創辦人、總部人員、工程師可以設定');
 const rows=selfAnybuyCategories(),cur=existingId?rows.find(x=>String(x.id)===String(existingId)):null;
 dlg(cur?'修改自助模式分類':'新增自助模式分類',`<div class="panel"><label>分類名稱<input id="selfAnybuyCatName" value="${esc(cur?.name||'')}" placeholder="例如：咖啡／茶飲"></label><label>顯示順序<input id="selfAnybuyCatSort" type="number" min="0" value="${Number(cur?.sort||rows.length+1)}"></label><label class="check-field"><input id="selfAnybuyCatActive" type="checkbox" ${cur?.active===false?'':'checked'}>啟用</label><button class="primary" id="selfAnybuyCatSave">儲存</button></div>`);
 setTimeout(()=>document.querySelector('#selfAnybuyCatSave')?.addEventListener('click',async()=>{const name=String(document.querySelector('#selfAnybuyCatName')?.value||'').trim();if(!name)return alert('請輸入分類名稱');if(rows.some(x=>String(x.id)!==String(cur?.id||'')&&String(x.name||'').trim()===name))return alert('分類名稱不可重複');const item=cur||{id:`SAC-${Date.now()}-${Math.random().toString(36).slice(2,6)}`};Object.assign(item,{name,sort:Number(document.querySelector('#selfAnybuyCatSort')?.value||0),active:!!document.querySelector('#selfAnybuyCatActive')?.checked,updatedAt:new Date().toISOString()});if(!cur)rows.push(item);await saveSelfAnybuyConfig(SELF_ANYBUY_CATEGORIES_KEY,rows,cur?'修改自助模式分類':'新增自助模式分類',name);genericDialog.close();openSelfAnybuyCategorySettings()}),0);
}
function openSelfAnybuyCategorySettings(){
 if(!canManageTmScreenCategories())return alert('自助模式分類設定只有總部的創辦人、總部人員、工程師可以設定');
 const rows=selfAnybuyCategories().slice().sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
 dlg('自助模式分類設定',`<div class="page-head"><div><h3>自助模式分類設定</h3><small>供自助模式「隨買跨店取兌換」畫面分組顯示。</small></div><button class="primary" id="selfAnybuyCatAdd">＋ 新增</button></div><div class="table-wrap"><table class="table"><thead><tr><th>順序</th><th>分類</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${Number(x.sort||0)}</td><td><b>${esc(x.name||'')}</b></td><td>${x.active===false?'停用':'啟用'}</td><td><button class="button" data-self-anybuy-cat-edit="${esc(x.id)}">修改</button> <button class="button danger" data-self-anybuy-cat-delete="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="4">尚未設定分類</td></tr>'}</tbody></table></div>`);
 setTimeout(()=>{document.querySelector('#selfAnybuyCatAdd')?.addEventListener('click',()=>openSelfAnybuyCategoryEditor());document.querySelectorAll('[data-self-anybuy-cat-edit]').forEach(b=>b.onclick=()=>openSelfAnybuyCategoryEditor(b.dataset.selfAnybuyCatEdit));document.querySelectorAll('[data-self-anybuy-cat-delete]').forEach(b=>b.onclick=async()=>{const id=String(b.dataset.selfAnybuyCatDelete),all=selfAnybuyCategories(),row=all.find(x=>String(x.id)===id);if(!row||!confirm(`確定刪除分類「${row.name}」？`))return;const products=selfAnybuyProducts();if(products.some(x=>String(x.categoryId)===id))return alert('此分類仍有隨買跨店取商品，請先修改或刪除商品設定');await saveSelfAnybuyConfig(SELF_ANYBUY_CATEGORIES_KEY,all.filter(x=>String(x.id)!==id),'刪除自助模式分類',row.name||id);openSelfAnybuyCategorySettings()})},0);
}
function openSelfAnybuyProductEditor(existingId=''){
 if(!canManageTmScreenCategories())return alert('隨買跨店取商品管理只有總部的創辦人、總部人員、工程師可以設定');
 const rows=selfAnybuyProducts(),cur=existingId?rows.find(x=>String(x.id)===String(existingId)):null,cats=selfAnybuyCategories().filter(x=>x.active!==false),ps=load(K.products,[]).filter(x=>x.active!==false);
 if(!cats.length)return alert('請先建立至少一個自助模式分類');
 dlg(cur?'修改隨買跨店取商品':'新增隨買跨店取商品',`<div class="panel"><label>自助模式分類<select id="selfAnybuyProductCat">${cats.map(x=>`<option value="${esc(x.id)}" ${String(cur?.categoryId||'')===String(x.id)?'selected':''}>${esc(x.name||'')}</option>`).join('')}</select></label><label>兌換品項<select id="selfAnybuyProductId"><option value="">請選擇商品</option>${ps.map(x=>`<option value="${esc(x.id)}" ${String(cur?.productId||'')===String(x.id)?'selected':''}>${esc(x.code||'')}｜${esc(x.name||'')}</option>`).join('')}</select></label><label>自助顯示名稱<input id="selfAnybuyProductName" value="${esc(cur?.displayName||'')}" placeholder="留空使用商品名稱"></label><label>對應來源（選填）<input id="selfAnybuyMatchKey" value="${esc(cur?.matchKey||'')}" placeholder="商品ID／商品代號／名稱；留空代表皆可兌換"><small>若只想讓特定隨買商品兌換此品項，可填 App 隨買商品代號、商品ID或名稱。</small></label><label>顯示順序<input id="selfAnybuyProductSort" type="number" min="0" value="${Number(cur?.sort||rows.length+1)}"></label><label class="check-field"><input id="selfAnybuyProductActive" type="checkbox" ${cur?.active===false?'':'checked'}>啟用</label><button class="primary" id="selfAnybuyProductSave">儲存</button></div>`);
 setTimeout(()=>document.querySelector('#selfAnybuyProductSave')?.addEventListener('click',async()=>{const categoryId=String(document.querySelector('#selfAnybuyProductCat')?.value||''),productId=String(document.querySelector('#selfAnybuyProductId')?.value||'');if(!categoryId||!productId)return alert('請選擇分類與商品');const product=ps.find(x=>String(x.id)===productId);const item=cur||{id:`SAP-${Date.now()}-${Math.random().toString(36).slice(2,6)}`};Object.assign(item,{categoryId,productId,displayName:String(document.querySelector('#selfAnybuyProductName')?.value||'').trim(),matchKey:String(document.querySelector('#selfAnybuyMatchKey')?.value||'').trim(),sort:Number(document.querySelector('#selfAnybuyProductSort')?.value||0),active:!!document.querySelector('#selfAnybuyProductActive')?.checked,updatedAt:new Date().toISOString()});if(!cur)rows.push(item);await saveSelfAnybuyConfig(SELF_ANYBUY_PRODUCTS_KEY,rows,cur?'修改隨買跨店取商品':'新增隨買跨店取商品',`${product?.name||productId}｜自助模式`);genericDialog.close();openSelfAnybuyProductSettings()}),0);
}
function openSelfAnybuyProductSettings(){
 if(!canManageTmScreenCategories())return alert('隨買跨店取商品管理只有總部的創辦人、總部人員、工程師可以設定');
 const rows=selfAnybuyProducts().slice().sort((a,b)=>Number(a.sort||0)-Number(b.sort||0)),cats=selfAnybuyCategories(),ps=load(K.products,[]);
 dlg('隨買跨店取商品管理',`<div class="page-head"><div><h3>隨買跨店取商品管理</h3><small>設定自助模式可讓顧客選擇的咖啡／茶飲等兌換品項。</small></div><button class="primary" id="selfAnybuyProductAdd">＋ 新增</button></div><div class="table-wrap"><table class="table"><thead><tr><th>順序</th><th>分類</th><th>兌換品項</th><th>來源對應</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map(x=>{const c=cats.find(v=>String(v.id)===String(x.categoryId)),p=ps.find(v=>String(v.id)===String(x.productId));return `<tr><td>${Number(x.sort||0)}</td><td>${esc(c?.name||'未分類')}</td><td><b>${esc(x.displayName||p?.name||'找不到商品')}</b><br><small>${esc(p?.code||'')}</small></td><td>${esc(x.matchKey||'全部')}</td><td>${x.active===false?'停用':'啟用'}</td><td><button class="button" data-self-anybuy-product-edit="${esc(x.id)}">修改</button> <button class="button danger" data-self-anybuy-product-delete="${esc(x.id)}">刪除</button></td></tr>`}).join('')||'<tr><td colspan="6">尚未設定自助兌換商品</td></tr>'}</tbody></table></div>`);
 setTimeout(()=>{document.querySelector('#selfAnybuyProductAdd')?.addEventListener('click',()=>openSelfAnybuyProductEditor());document.querySelectorAll('[data-self-anybuy-product-edit]').forEach(b=>b.onclick=()=>openSelfAnybuyProductEditor(b.dataset.selfAnybuyProductEdit));document.querySelectorAll('[data-self-anybuy-product-delete]').forEach(b=>b.onclick=async()=>{const id=String(b.dataset.selfAnybuyProductDelete),all=selfAnybuyProducts(),row=all.find(x=>String(x.id)===id);if(!row||!confirm('確定刪除此自助兌換商品設定？'))return;await saveSelfAnybuyConfig(SELF_ANYBUY_PRODUCTS_KEY,all.filter(x=>String(x.id)!==id),'刪除隨買跨店取商品',id);openSelfAnybuyProductSettings()})},0);
}

function tmHiddenProducts(){
 return load(K.products,[]).filter(x=>x.tmHidden===true);
}
async function saveTmHiddenProducts(rows,action,detail){
 save(K.products,rows);
 saveAudit(action,detail);
 if(cloudConfigured()){
  try{await cloudPushKey(K.products,rows)}catch(err){alert('設定已儲存於 SC，但同步 TM 失敗：'+err.message)}
 }
}
function openTmHiddenProductEditor(existingId=''){
 if(!canEditGlobalProductMaster())return alert('TM不顯示設定只有總店可以新增、修改、刪除');
 const rows=load(K.products,[]);
 const current=existingId?rows.find(x=>String(x.id)===String(existingId)):null;
 const choices=rows.filter(x=>x.active!==false&&(current||x.tmHidden!==true));
 dlg(current?'修改 TM 不顯示商品':'新增 TM 不顯示商品',`
  <div class="panel">
   <label>商品
    <select id="tmHiddenProductSelect">
     <option value="">請選擇商品</option>
     ${choices.map(x=>`<option value="${esc(x.id)}" ${current&&String(current.id)===String(x.id)?'selected':''}>${esc(x.code||'')}｜${esc(x.name||'')}</option>`).join('')}
    </select>
   </label>
   <p class="setting-hint">設定後此商品仍保留在 SC 商品主檔，但不會在 TM 顯示、搜尋或掃碼販售。</p>
   <button class="primary" id="tmHiddenProductSave">${current?'儲存修改':'新增'}</button>
  </div>`);
 setTimeout(()=>document.querySelector('#tmHiddenProductSave')?.addEventListener('click',async()=>{
  const id=String(document.querySelector('#tmHiddenProductSelect')?.value||'');
  if(!id)return alert('請選擇商品');
  if(current&&String(current.id)!==id)current.tmHidden=false;
  const target=rows.find(x=>String(x.id)===id);
  if(!target)return alert('找不到商品');
  target.tmHidden=true;
  target.tmHiddenUpdatedAt=new Date().toISOString();
  target.tmHiddenUpdatedBy=currentUser()?.name||'';
  await saveTmHiddenProducts(rows,current?'修改 TM 不顯示商品':'新增 TM 不顯示商品',`${target.code||''}｜${target.name||''}`);
  genericDialog.close();openTmHiddenProductsSettings();
 }),0);
}
function openTmHiddenProductsSettings(){
 if(!canEditGlobalProductMaster())return alert('TM不顯示設定只有總店可以新增、修改、刪除');
 const hidden=tmHiddenProducts();
 dlg('TM不顯示設定',`
  <div class="page-head"><div><h3>TM不顯示商品</h3><small>此清單內商品僅在 SC 保留，TM 不顯示。</small></div><button class="primary" id="tmHiddenAdd">＋ 新增</button></div>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>商品代號</th><th>商品名稱</th><th>類別</th><th>狀態</th><th>操作</th></tr></thead>
   <tbody>${hidden.map(x=>`<tr><td>${esc(x.code||'')}</td><td>${esc(x.name||'')}</td><td>${esc(x.category||'')}</td><td>TM不顯示</td><td><button class="button" data-tm-hidden-edit="${esc(x.id)}">修改</button> <button class="button danger" data-tm-hidden-delete="${esc(x.id)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="5">目前沒有設定 TM 不顯示商品</td></tr>'}</tbody>
  </table></div>`);
 setTimeout(()=>{
  document.querySelector('#tmHiddenAdd')?.addEventListener('click',()=>openTmHiddenProductEditor());
  document.querySelectorAll('[data-tm-hidden-edit]').forEach(b=>b.addEventListener('click',()=>openTmHiddenProductEditor(b.dataset.tmHiddenEdit)));
  document.querySelectorAll('[data-tm-hidden-delete]').forEach(b=>b.addEventListener('click',async()=>{
   const rows=load(K.products,[]),p=rows.find(x=>String(x.id)===String(b.dataset.tmHiddenDelete));if(!p)return;
   if(!confirm(`確定將「${p.name}」從 TM 不顯示清單刪除？\n刪除後此商品會重新在 TM 顯示。`))return;
   p.tmHidden=false;p.tmHiddenUpdatedAt=new Date().toISOString();p.tmHiddenUpdatedBy=currentUser()?.name||'';
   await saveTmHiddenProducts(rows,'刪除 TM 不顯示商品',`${p.code||''}｜${p.name||''}`);
   openTmHiddenProductsSettings();
  }));
 },0);
}

function orderMultipleSelectOptions(value=1,max=100){
 const current=Math.max(1,Number(value)||1);
 const nums=Array.from({length:Math.max(max,current)},(_,i)=>i+1);
 return nums.map(n=>`<option value="${n}" ${n===current?'selected':''}>${n}</option>`).join('');
}

function orderMultipleUnitOptions(value='個'){
 const current=['個','包','箱'].includes(String(value||''))?String(value):'個';
 return ['個','包','箱'].map(x=>`<option value="${x}" ${x===current?'selected':''}>${x}</option>`).join('');
}

function productForm(p={}){
 const bars=productBarcodes(p),extra=bars.slice(1).join('\n');
 return `<div class="product-form-grid">
 <label>商品代號<input id="pcode" value="${esc(p.code||'')}" placeholder="例如 FS00125"></label>
 <label>商品名稱<input id="pn" value="${esc(p.name||'')}"></label>
 <label>商品簡稱<input id="psn" value="${esc(p.shortName||'')}"></label>
 <label>規格<input id="pspec" value="${esc(p.spec||'')}" placeholder="例如：330ml×6入／113g×1／10包×1條"></label>
 <label>主要條碼<div class="inline-field"><input id="pb" inputmode="numeric" pattern="[0-9]*" value="${esc(bars[0]||'')}" placeholder="留空即自動產生純數字條碼"><button type="button" class="button" id="scanProductBarcode">📷 掃描</button><button type="button" class="button" id="autoProductBarcode">自動生成</button></div></label>
 <label class="full-field">其他條碼（每行一個，限純數字）<textarea id="pba" inputmode="numeric" rows="3">${esc(extra)}</textarea></label>
 <label>商品類別<select id="pc">${['常溫','鮮食','低溫','冷凍'].map(x=>`<option ${p.category===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <label>品群分類<select id="pg">${load(K.productGroups,['其他']).map(x=>`<option ${p.group===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
 <label>配送別<select id="pl">${['常溫','鮮食一配','鮮食二配','低溫一配','低溫二配','冷凍','億家通'].map(x=>`<option ${normalizeDeliveryLabel(p.deliveryType||p.logistics)===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <div class="full-field product-order-types"><strong>可訂購分類（可複選）</strong><div class="order-type-checks">${PRODUCT_ORDER_TYPES.map(x=>`<label class="check-field"><input type="checkbox" data-product-order-type value="${x}" ${productOrderTypes(p).includes(x)?'checked':''}>${x}</label>`).join('')}</div><small>未勾選代表此商品不可訂購；FOS 鮮食訂購以本欄勾選為準；配送別需為低溫一配／低溫二配／鮮食一配／鮮食二配，並會依 F01～F08 分類顯示。</small></div>
 <label>售價<input id="pp" type="number" min="0" value="${p.price??0}"></label>
 <label>價格類型<select id="pPriceType"><option value="固定售價" ${(p.priceType||'固定售價')==='固定售價'&&!p.marketPrice?'selected':''}>固定售價</option><option value="時價" ${(p.priceType==='時價'||p.marketPrice===true)?'selected':''}>時價</option></select></label>
 <label>成本<input id="pco" type="number" min="0" value="${p.cost??0}"></label>
 <label>毛利率<div class="readonly-value" id="marginPreview">0.0%</div></label>
 <label>庫存<input id="pst" type="number" min="0" value="${p.stock??0}"></label>
 <label>安全庫存<input id="psa" type="number" min="0" value="${p.safeStock??5}"></label>
 <label>最大庫存<input id="pmax" type="number" min="0" value="${p.maxStock??0}"></label>
 <label>訂購倍數
  <div class="order-multiple-combo">
   <span>1倍</span>
   <select id="pmultiple" ${hasPermission('productMultipleEdit')?'':'disabled'}>${orderMultipleSelectOptions(p.orderMultipleQty??1)}</select>
   <select id="pmultipleUnit" ${hasPermission('productMultipleEdit')?'':'disabled'}>${orderMultipleUnitOptions(p.orderMultipleUnit||'個')}</select>
  </div>
  <small>${hasPermission('productMultipleEdit')?'例如：1倍 3 包／1倍 2 箱':'需「商品倍數設定」權限'}</small>
 </label>
 <label>商品保存期限<input id="pshelfLife" list="productShelfLifeOptions" value="${esc(p.shelfLife||(p.expiryDays?`D${p.expiryDays}`:''))}" placeholder="可選擇或直接輸入，例如 D7／30天／永久"><datalist id="productShelfLifeOptions">${['D1','D2','D3','D4','D5','D7','D14','D30','D60','D90','D180','D365','永久'].map(x=>`<option value="${x}"></option>`).join('')}</datalist><small>可直接輸入自訂保存期限。</small></label>
 <label>不良退<select id="preturnable"><option value="Y" ${p.returnable===false?'':'selected'}>Y</option><option value="N" ${p.returnable===false?'selected':''}>N</option></select></label>
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


function previousDayLocalKey(){
 const d=new Date();d.setDate(d.getDate()-1);return localDateKey(d);
}
function previousDayDeposits(){
 const day=previousDayLocalKey();
 return load(K.deposits,[]).filter(x=>{
  const d=new Date(x.at);return !Number.isNaN(d.getTime())&&localDateKey(d)===day;
 });
}
function previousDayHandovers(){
 const day=previousDayLocalKey();
 return load(K.handovers,[]).filter(x=>{
  const d=new Date(x.at);return !Number.isNaN(d.getTime())&&localDateKey(d)===day;
 });
}
function openPreviousDayDepositQuery(){
 const day=previousDayLocalKey(),rows=previousDayDeposits(),total=rows.reduce((s,x)=>s+Number(x.amount||0),0);
 dlg(`前一天投庫查詢－${day}`,`
  <div class="metric-grid" style="margin-bottom:14px">
   <div class="metric"><small>營業日</small><strong>${esc(day)}</strong></div>
   <div class="metric"><small>投庫筆數</small><strong>${rows.length} 筆</strong></div>
   <div class="metric"><small>投庫小計</small><strong>${money(total)}</strong></div>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr><th>時間</th><th>投庫單號</th><th>操作帳號</th><th>操作人員</th><th>金額</th></tr></thead><tbody>
   ${rows.map(x=>`<tr><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.depositNo||x.id||'—')}</td><td>${esc(x.userAccount||'—')}</td><td>${esc(x.user||'—')}</td><td><b>${money(x.amount||0)}</b></td></tr>`).join('')||'<tr><td colspan="5">前一天沒有投庫紀錄</td></tr>'}
  </tbody></table></div>`);
}
function openPreviousDayHandoverQuery(){
 const day=previousDayLocalKey(),rows=previousDayHandovers();
 dlg(`收銀員交接班明細表－${day}`,`
  <div class="page-head"><div><h3>${esc(day)} 收銀員交接班明細</h3><small>只顯示前一天交班資料</small></div></div>
  <div class="table-wrap"><table class="table"><thead><tr>
   <th>交班時間</th><th>收銀員帳號</th><th>收銀員姓名</th><th>投庫筆數</th><th>投庫小計</th><th>現金收入</th><th>短溢收</th><th>交易筆數</th><th>交易作廢張數</th>
  </tr></thead><tbody>
   ${rows.map(x=>`<tr>
    <td>${new Date(x.at).toLocaleString('zh-TW')}</td>
    <td>${esc(x.fromAccount||'—')}</td>
    <td>${esc(x.from||'—')}</td>
    <td>${Number(x.depositCount||0)}</td>
    <td><b>${money(x.depositAmount||0)}</b></td>
    <td>${money(x.cashRevenue||0)}</td>
    <td>${formatCashDifference(x.cashDifference||0)}</td>
    <td>${Number(x.transactionCount||0)}</td>
    <td>${Number(x.voidCount||0)}</td>
   </tr>`).join('')||'<tr><td colspan="9">前一天沒有交班紀錄</td></tr>'}
  </tbody></table></div>`);
}

function openPreviousDayCashHandoverQuery(){
 const day=previousDayLocalKey(),deposits=previousDayDeposits(),handovers=previousDayHandovers();
 const depositTotal=deposits.reduce((s,x)=>s+Number(x.amount||0),0);
 dlg(`前一天投庫／交班查詢－${day}`,`
  <div class="metric-grid" style="margin-bottom:14px">
   <div class="metric"><small>營業日</small><strong>${esc(day)}</strong></div>
   <div class="metric"><small>投庫筆數</small><strong>${deposits.length} 筆</strong></div>
   <div class="metric"><small>投庫小計</small><strong>${money(depositTotal)}</strong></div>
   <div class="metric"><small>交班筆數</small><strong>${handovers.length} 筆</strong></div>
  </div>
  <h3>前一天投庫</h3>
  <div class="table-wrap"><table class="table"><thead><tr><th>時間</th><th>投庫單號</th><th>操作帳號</th><th>操作人員</th><th>金額</th></tr></thead><tbody>
   ${deposits.map(x=>`<tr><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.depositNo||x.id||'—')}</td><td>${esc(x.userAccount||'—')}</td><td>${esc(x.user||'—')}</td><td><b>${money(x.amount||0)}</b></td></tr>`).join('')||'<tr><td colspan="5">前一天沒有投庫紀錄</td></tr>'}
  </tbody></table></div>
  <h3 style="margin-top:20px">收銀員交接班明細表</h3>
  <div class="table-wrap"><table class="table"><thead><tr><th>交班時間</th><th>收銀員帳號</th><th>收銀員姓名</th><th>投庫筆數</th><th>投庫小計</th><th>現金收入</th><th>短溢收</th><th>交易筆數</th><th>交易作廢張數</th></tr></thead><tbody>
   ${handovers.map(x=>`<tr><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.fromAccount||'—')}</td><td>${esc(x.from||'—')}</td><td>${Number(x.depositCount||0)}</td><td><b>${money(x.depositAmount||0)}</b></td><td>${money(x.cashRevenue||0)}</td><td>${formatCashDifference(x.cashDifference||0)}</td><td>${Number(x.transactionCount||0)}</td><td>${Number(x.voidCount||0)}</td></tr>`).join('')||'<tr><td colspan="9">前一天沒有交班紀錄</td></tr>'}
  </tbody></table></div>`);
}
function revenueSalesForDate(record){
 const date=String(record?.date||'');
 return load(K.sales,[]).filter(x=>{
  const d=new Date(x.at);
  return !Number.isNaN(d.getTime())&&localDateKey(d)===date;
 });
}
function revenueReportDateAllowed(record){
 return !!record?.date&&String(record.date)!==localDateKey();
}
function requireRevenueReportDate(record){
 if(revenueReportDateAllowed(record))return true;
 alert('當天交易不會進入營收報表。請於隔天再進行營收收集；報表只會使用前一天交易資料。');
 return false;
}
function revenueSaleNet(s){return Number(s.netTotal??s.total??0)}
function revenueCash(s){return Number(s.netCashAmount??s.cashAmount??(s.payment==='現金'?revenueSaleNet(s):0))}
function revenueNonCash(s){return Number(s.netNonCashAmount??s.nonCashAmount??(s.payment==='現金'?0:revenueSaleNet(s)))}
function revenuePayName(s){return String(s.paymentSubtype||s.payment||'其他')}
function revenueReportTable(headers,rows,empty='本日無資料'){
 return `<table style="width:100%;border-collapse:collapse"><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table>`;
}
function scAnybuySaleLines(sale){
 return (Array.isArray(sale?.items)?sale.items:[]).filter(x=>x?.appAnybuyPayment===true||x?.appAnybuyDeposit===true||x?.appAnybuyRedeem===true);
}
function scSaleConsignmentAmount(sale){
 return Math.max(0,Number(sale?.consignmentNetAmount??sale?.consignmentAmount??sale?.deferredRevenueAmount??0));
}
function scSaleRecognizedRevenue(sale){
 const net=Math.max(0,Number(revenueSaleNet(sale)||0));
 return Math.max(0,Math.round((net-scSaleConsignmentAmount(sale))*100)/100);
}
function revenueReportBody(record,type){
 const sales=revenueSalesForDate(record);
 const isEc=s=>!!(s&&((s.items||[]).some(i=>i.ecPickup)||(s.ecItems||[]).length||s.ecPickup===true||s.serviceType==='EC'||s.collectionType==='EC'));
 const isCollectionBill=s=>!!(s&&!isEc(s)&&(s.collectionSale===true||s.billPayment===true||s.collectionService===true||s.collectionProvider||s.collectionProviderName||s.collectionType==='bill'||s.serviceType==='代收繳費'));
 const isService=s=>s.serviceSale===true||isEc(s)||isCollectionBill(s);
 const valid=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status)&&!isService(s));
 const serviceRows=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status)&&isService(s)).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),isEc(s)?((s.ecItems||s.items||[]).filter(i=>i.ecPickup).map(i=>esc(i.ecPackageNo||i.code||i.name||'EC')).join('<br>')||'EC'):(esc(s.collectionProviderName||s.collectionProvider||s.providerName||s.serviceName||'代收繳費')),money(s.serviceAmount??s.collectionAmount??s.netTotal??s.total??0),esc(s.user||'')]);
 const collectionBillRows=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status)&&isCollectionBill(s)).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),esc(s.collectionProviderName||s.collectionProvider||s.providerName||s.serviceName||'代收單位'),esc(s.collectionCategory||s.providerType||s.collectionType||'代收繳費'),money(s.collectionAmount??s.serviceAmount??s.netTotal??s.total??0),esc(revenuePayName(s)),esc(s.user||'')]);
 const collectionEcRows=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status)&&isEc(s)).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),(s.ecItems||s.items||[]).filter(i=>i.ecPickup).map(i=>esc(i.ecPackageNo||i.code||i.name||'EC')).join('<br>')||esc(s.ecPackageNo||'EC'),money(s.serviceAmount??s.collectionAmount??s.netTotal??s.total??0),esc(revenuePayName(s)),esc(s.user||'')]);
 const cashRows=valid.filter(s=>revenueCash(s)>0).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),money(revenueCash(s)),esc(s.user||'')]);
 const nonCashRows=valid.filter(s=>revenueNonCash(s)>0).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),esc(revenuePayName(s)),money(revenueNonCash(s)),esc(s.user||'')]);
 const voidRows=sales.filter(s=>s.status==='已作廢').map(s=>{const h=(s.correctionHistory||[])[0]||{};return[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),money(s.total||0),esc(h.reason||''),esc(h.user||s.user||'')]});
 const discountRows=valid.filter(s=>Number(s.discount||0)>0).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),money(s.subtotal||0),money(s.discount||0),money(revenueSaleNet(s))]);
 const saleRows=valid.map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),(s.items||[]).map(i=>`${esc(i.name)}×${Number(i.qty||0)}`).join('<br>'),money(s.subtotal||s.total||0),money(s.discount||0),money(revenueSaleNet(s)),esc(revenuePayName(s))]);
 const ipassRows=valid.filter(s=>revenuePayName(s).includes('一卡通')).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),money(revenueNonCash(s)),esc(s.user||'')]);
 const cardRows=valid.filter(s=>revenuePayName(s).includes('信用')).map(s=>[esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),money(revenueNonCash(s)),esc(s.user||'')]);
 const consignmentRows=sales.filter(s=>!['已作廢','已整筆退貨'].includes(s.status)&&scAnybuySaleLines(s).length).map(s=>{
  const lines=scAnybuySaleLines(s);
  const kind=lines.some(x=>x.appAnybuyRedeem)?'兌換／取': '購買／寄杯';
  const items=lines.map(x=>{
   const acquired=Number(x.acquiredQuantity??x.actualQuantity??x.qty??0);
   const groups=Number(x.cartQuantity??x.qty??0);
   return `${esc(x.name||'隨買商品')}｜購買 ${groups} 組／取得 ${acquired} 件`;
  }).join('<br>');
  return [esc(s.id),new Date(s.at).toLocaleTimeString('zh-TW'),kind,items,money(scSaleConsignmentAmount(s)),money(scSaleRecognizedRevenue(s)),esc(revenuePayName(s)),esc(s.user||'')];
 });
 const base=`<p>營業日：<b>${esc(record.date)}</b></p><p><b>報表資料範圍：</b>${esc(record.date)} 00:00～23:59:59（不包含當天即時交易）</p>`;
 if(type==='z')return base+`<h3>Z帳號：${esc(record.zNo||'尚未產生')}</h3><p>總營收：${money(record.total)}</p><p>現金收入：${money(record.cashRevenue||0)}</p><p>非現金收入：${money(record.nonCashRevenue||0)}</p><p>投庫：${money(record.deposits||0)}</p><p>應送金：${money(record.sendAmount||0)}</p><p>實際現金：${money(record.actualCash||0)}</p><p>現金差額：${money(record.cashDifference||0)}</p><p>差額原因：${esc(record.reason||'—')}</p><p>送金方式：${esc(record.method||'—')}</p><p>送金銀行／郵局：${esc(record.bankName||'—')}</p><p>送金帳號：${esc(record.remittanceAccount||'—')}</p><p>交易筆數：${Number(record.count||0)}</p>`;
 if(type==='x')return base+`<h3>現金明細</h3>${revenueReportTable(['交易編號','時間','現金金額','收銀人員'],cashRows)}<h3 style="margin-top:22px">非現金明細</h3>${revenueReportTable(['交易編號','時間','支付方式','金額','收銀人員'],nonCashRows)}`;
 if(type==='void')return base+revenueReportTable(['交易編號','時間','原金額','作廢原因','處理人員'],voidRows,'本日無作廢交易');
 if(type==='discount')return base+revenueReportTable(['交易編號','時間','原小計','POS折扣','實收'],discountRows,'本日無POS折扣');
 if(type==='sales')return base+revenueReportTable(['交易編號','時間','商品','原小計','折扣','淨額','付款方式'],saleRows,'本日無銷售');
 if(type==='ipass')return base+revenueReportTable(['交易編號','時間','一卡通金額','收銀人員'],ipassRows,'本日無一卡通交易');
 if(type==='card')return base+revenueReportTable(['交易編號','時間','信用卡金額','收銀人員'],cardRows,'本日無信用卡交易');
 if(type==='collection')return base+`<h3>代收繳費</h3>${revenueReportTable(['交易編號','時間','代收單位','代收類別','代收金額','支付方式','收銀人員'],collectionBillRows,'本日無代收繳費交易')}<h3 style="margin-top:22px">EC</h3>${revenueReportTable(['交易編號','時間','EC包裹／服務','代收金額','支付方式','收銀人員'],collectionEcRows,'本日無 EC 代收交易')}`;
 if(type==='service')return base+revenueReportTable(['交易編號','時間','EC包裹／服務','代收金額','收銀人員'],serviceRows,'本日無服務性交易');
 if(type==='consignment')return base+revenueReportTable(['交易編號','時間','類型','隨買商品','代銷金額','本筆認列日商','付款方式','收銀人員'],consignmentRows,'本日無隨買代銷／兌換交易');
 return base;
}
const REVENUE_REPORT_NAMES={z:'Z帳表',x:'X帳表',void:'作廢明細表',discount:'POS折扣明細',sales:'銷售總表',ipass:'一卡通結帳明細表',card:'信用卡結帳明細表',collection:'代收明細表',service:'服務性明細表',consignment:'代銷明細表'};
function revenueReportHasData(record,type){
 const sales=revenueSalesForDate(record);
 const isEc=s=>!!(s&&((s.items||[]).some(i=>i.ecPickup)||(s.ecItems||[]).length||s.ecPickup===true||s.serviceType==='EC'||s.collectionType==='EC'));
 const isCollectionBill=s=>!!(s&&!isEc(s)&&(s.collectionSale===true||s.billPayment===true||s.collectionService===true||s.collectionProvider||s.collectionProviderName||s.collectionType==='bill'||s.serviceType==='代收繳費'));
 const isService=s=>s.serviceSale===true||isEc(s)||isCollectionBill(s);
 const active=s=>!['已作廢','已整筆退貨'].includes(s.status);
 const valid=sales.filter(s=>active(s)&&!isService(s));
 if(type==='z')return !!record?.zNo;
 if(type==='x')return valid.some(s=>revenueCash(s)>0||revenueNonCash(s)>0);
 if(type==='void')return sales.some(s=>s.status==='已作廢');
 if(type==='discount')return valid.some(s=>Number(s.discount||0)>0);
 if(type==='sales')return valid.length>0;
 if(type==='ipass')return valid.some(s=>revenuePayName(s).includes('一卡通'));
 if(type==='card')return valid.some(s=>revenuePayName(s).includes('信用'));
 if(type==='collection')return sales.some(s=>active(s)&&(isCollectionBill(s)||isEc(s)));
 if(type==='service')return sales.some(s=>active(s)&&isService(s));
 if(type==='consignment')return sales.some(s=>active(s)&&scAnybuySaleLines(s).length);
 return false;
}
const REVENUE_NONEMPTY_PRINT_ROLLOUT_BUSINESS_DATE='2026-08-23';
function revenueUsesNonEmptyPrintRule(record){
 const d=String(record?.date||'').slice(0,10);
 return !!d&&d>=REVENUE_NONEMPTY_PRINT_ROLLOUT_BUSINESS_DATE;
}
function revenuePrintableReportKeys(record){
 const keys=Object.keys(REVENUE_REPORT_NAMES);
 // 2026/08/24 04:00 日結開始啟用新版；
 // 該次日結封存的營業日是 2026/08/23，因此從 2026/08/23 營業日起套用。
 if(!revenueUsesNonEmptyPrintRule(record))return keys;
 return keys.filter(type=>revenueReportHasData(record,type));
}
function printRevenueReport(record,type){
 if(!requireRevenueReportDate(record))return;
 if(type==='z'&&!record.zNo)return alert('請先完成營收修正');
 if(revenueUsesNonEmptyPrintRule(record)&&!revenueReportHasData(record,type)){
  return alert(`${REVENUE_REPORT_NAMES[type]||'此報表'}目前沒有資料，不會列印空白報表。`);
 }
 printHTML(REVENUE_REPORT_NAMES[type]||'營收報表',revenueReportBody(record,type));
}
function openRevenueReportCenter(id){
 const record=load(K.revenue,[]).find(x=>x.id===id);if(!record)return alert('找不到營收紀錄');
 if(!requireRevenueReportDate(record))return;
 const keys=revenuePrintableReportKeys(record);
 const newRule=revenueUsesNonEmptyPrintRule(record);
 dlg(`營收報表－${record.date}`,`<p>${newRule?'新版列印規則：只顯示本營業日有資料的報表；沒有資料的報表不會列出，也不會印出空白頁。':'舊版歷史報表：維持原報表項目顯示方式。'}${newRule?'<br><small>此規則自 2026/08/24 04:00 日結（營業日 2026/08/23）起生效。</small>':''}</p><div class="toolbar" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${keys.map(k=>`<button class="button" data-revenue-report-type="${k}" data-revenue-report-id="${record.id}">${REVENUE_REPORT_NAMES[k]}</button>`).join('')||'<div class="notice" style="grid-column:1/-1">本營業日目前沒有可列印的營收報表。</div>'}</div>`);
}

function printAllRevenueReports(record){
 if(!requireRevenueReportDate(record))return;
 if(!record?.zNo)return alert('請先完成營收修正並傳輸');
 const reportKeys=revenuePrintableReportKeys(record);
 const pages=reportKeys.map((type,i)=>`<section class="revenue-print-page"><h2>${i+1}. ${REVENUE_REPORT_NAMES[type]}</h2>${revenueReportBody(record,type)}</section>`).join('');
 const remit=`<section class="revenue-print-page remittance-page">${remittanceSlipBody(record)}</section>`;
 if(!pages&&!remit)return alert('本營業日沒有可列印資料');
 printHTML(`營收報表－${record.date}`,`${pages}${remit}`);
}

function remittanceQrMarkup(record){
 if(!record?.remittanceAccount)return '';
 const payload=encodeURIComponent(record.remittanceAccount);
 return `<div style="display:flex;align-items:flex-start;gap:22px;margin-top:18px"><div><b>送金二維碼</b><div class="print-qr" data-qr="${payload}" style="width:168px;height:168px;margin-top:8px"></div><small>掃描內容：${esc(record.remittanceAccount)}</small></div></div>`;
}
function remittanceSlipBody(record){
 const bankLine=record.method==='銀行送金'?`<p>金融機構：<b>${esc(record.bankName||'—')}</b>（銀行代碼 ${esc(record.bankCode||'—')}）</p><p>送金帳號：<b style="font-size:20px">${esc(record.remittanceAccount||'—')}</b></p>`:`<p>收款方式：<b>總部收款</b></p>`;
 return `<h2>送金單</h2><p>營業日：${esc(record.date||'')}</p><p>送金方式：${esc(record.method||'—')}</p>${bankLine}<p>送金金額：<b>${money(record.actualCash??record.sendAmount??0)}</b></p>${remittanceQrMarkup(record)}`;
}

function printHTML(title,body){
 const w=open('','_blank');
 if(!w){alert('無法開啟列印視窗，請允許此網站開啟彈出式視窗後再試一次');return}
 w.document.write(`<div style="padding:15mm;font-family:sans-serif"><div class="no-print" style="display:flex;gap:10px;margin-bottom:18px;position:sticky;top:0;background:#fff;padding:8px 0;z-index:5"><button onclick="window.close()" style="padding:10px 16px">← 返回</button><button onclick="window.print()" style="padding:10px 16px">🖨️ 列印</button></div><h1>億家 SuperApp Enterprise</h1><h2>${title}</h2><p>列印時間：${new Date().toLocaleString('zh-TW')}</p>${body}</div><style>table,th,td{border:1px solid #aaa;border-collapse:collapse;padding:7px}.product-barcode-print-summary{font-size:12px;margin:0 0 10px}.product-barcode-print-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6mm}.product-barcode-print-label{border:1px solid #999;padding:5mm 4mm;break-inside:avoid;page-break-inside:avoid;text-align:center;min-height:33mm;box-sizing:border-box}.product-barcode-print-name{font-size:15px;font-weight:800;line-height:1.25;margin-bottom:2mm}.product-barcode-print-meta{font-size:11px;margin-bottom:2mm}.product-barcode-print-svg svg{display:block;max-width:100%;height:58px;margin:0 auto}.revenue-print-page{break-after:page;page-break-after:always}.revenue-print-page:last-child{break-after:auto;page-break-after:auto}.print-qr{border:1px solid #ddd;display:flex;align-items:center;justify-content:center;background:#fff}.print-qr canvas,.print-qr img{display:block!important}@media print{.no-print{display:none!important}.revenue-print-page{break-after:page;page-break-after:always}.revenue-print-page:last-child{break-after:auto;page-break-after:auto}}</style><script src="https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js"></script><script>function drawYijiaQr(){document.querySelectorAll('[data-qr]').forEach(function(el){var text='';try{text=decodeURIComponent(el.dataset.qr||'');if(window.QRCode&&text){el.innerHTML='';new QRCode(el,{text:text,width:160,height:160,correctLevel:QRCode.CorrectLevel.M});}else if(text){el.innerHTML='<div style=\"font-size:12px;word-break:break-all;padding:8px\">二維碼載入中…<br>'+text+'</div>';}}catch(e){el.innerHTML='<div style=\"font-size:12px;word-break:break-all;padding:8px\">QR 產生失敗<br>'+text+'</div>';}});}window.addEventListener('load',function(){setTimeout(drawYijiaQr,150);setTimeout(drawYijiaQr,900);});<\/script>`);
 w.document.close()
}
async function runScEmployeeUpdate(){
 if(!cloudConfigured())return alert('尚未設定 Supabase，無法下傳 SC 人員主檔');
 if(!isHeadOffice()||!isFounder())return alert('下傳 SC 人員主檔只有總店創辦人可以操作');
 try{
  const empOk=await cloudPushKey(K.employees,load(K.employees,[]));if(!empOk)throw new Error('人員主檔同步失敗');
  const permOk=await cloudPushKey(K.permissions,load(K.permissions,{}));if(!permOk)throw new Error('人員權限同步失敗');
  const signal={id:uid(),kind:'sc-employee-master',revision:Date.now(),at:new Date().toISOString(),by:currentUser()?.name||'',storeCode:currentStoreCode(),status:'ready'};
  const sigOk=await cloudPushKey('yj_sc_employee_master_update',signal);if(!sigOk)throw new Error('SC 更新通知發送失敗');
  saveAudit('下傳 SC 人員主檔',`revision ${signal.revision}`);
  alert('SC 人員主檔已下傳；其他 SC 將自動接收最新跨店人員與權限。');
 }catch(err){alert('下傳 SC 失敗：'+err.message)}
}

let scMasterUpdateLockActive=false;
let scMasterUpdateLockText='';

function scMasterUpdateOverlay(){
 let el=document.querySelector('#scMasterUpdateLock');
 if(el)return el;
 el=document.createElement('div');
 el.id='scMasterUpdateLock';
 el.className='sc-master-update-lock';
 el.innerHTML=`
  <div class="sc-master-update-dialog" role="alertdialog" aria-modal="true" aria-label="主檔更新">
   <div class="sc-master-update-title">錯誤</div>
   <div class="sc-master-update-content">
    <div class="sc-master-update-x">×</div>
    <div class="sc-master-update-message" id="scMasterUpdateMessage">主檔更新執行中。</div>
   </div>
   <button type="button" class="button" disabled>確定</button>
  </div>`;
 document.body.appendChild(el);
 return el;
}
function setScMasterUpdateLock(active,text='主檔更新執行中。'){
 scMasterUpdateLockActive=!!active;
 scMasterUpdateLockText=active?String(text||'主檔更新執行中。'):'';
 const el=scMasterUpdateOverlay();
 const msg=el.querySelector('#scMasterUpdateMessage');
 if(msg)msg.textContent=scMasterUpdateLockText||'主檔更新執行中。';
 el.classList.toggle('show',scMasterUpdateLockActive);
 document.documentElement.classList.toggle('sc-master-update-locked',scMasterUpdateLockActive);
 refreshHomeSystemMessages();
}
function scHomeSystemMessageRows(){
 const rows=[];
 const now=new Date(),mins=now.getHours()*60+now.getMinutes();
 if(scMasterUpdateLockActive)rows.push({tag:'系統',text:scMasterUpdateLockText||'主檔更新執行中',kind:'danger'});
 // 二訂日替：21:55 起預告；21:59～22:02 為統計/切換期間。
 if(mins>=21*60+55&&mins<21*60+59)rows.push({tag:'系統',text:'即將進行二訂日替',kind:'warn'});
 if(mins>=21*60+59&&mins<=22*60+2)rows.push({tag:'系統',text:'二訂日替執行中',kind:'danger'});
 if(!rows.length)rows.push({tag:'系統',text:cloudConfigured()?'SC 雲端連線正常':'SC 雲端尚未連線',kind:cloudConfigured()?'ok':'warn'});
 return rows;
}
function scHomeSystemMessageHtml(){
 return scHomeSystemMessageRows().map(x=>`<div class="ref-system-msg ${x.kind||''}"><b>${esc(x.tag||'系統')}</b><span>${esc(x.text||'')}</span></div>`).join('');
}
function refreshHomeSystemMessages(){
 const box=document.querySelector('.ref-system-body');
 if(box)box.innerHTML=scHomeSystemMessageHtml();
}

async function checkScEmployeeMasterUpdate(){
 if(document.hidden||!cloudConfigured()||scMasterUpdateLockActive)return;
 try{
  const signal=await cloudPullKey('yj_sc_employee_master_update');
  if(signal?.kind!=='sc-employee-master')return;
  const rev=Number(signal.revision||0),last=Number(localStorage.getItem('yj_sc_employee_master_revision')||0);
  if(!rev||rev<=last)return;
  setScMasterUpdateLock(true,'主檔更新執行中。');
  try{
   await cloudPullKey(K.employees);
   await cloudPullKey(K.permissions);
   await cloudPullKey(HQ_SPECIAL_TM_PERMISSIONS_KEY);
   localStorage.setItem('yj_sc_employee_master_revision',String(rev));
   saveAudit('接收 SC 人員主檔',`revision ${rev}`);
   try{if(['employees','employee-detail','stocktake-personnel','engineer-personnel','hq-personnel','permissions'].includes(currentAdminPage()))render(currentAdminPage())}catch(_e){}
  }finally{
   setScMasterUpdateLock(false);
  }
 }catch(err){
  setScMasterUpdateLock(false);
  console.warn('SC 人員主檔更新檢查失敗',err);
  alert('主檔更新失敗：'+(err?.message||err));
 }
}
async function runUpdate(target){
 const o=document.querySelector('#updateOverlay'),bar=document.querySelector('#updateBar'),pct=document.querySelector('#updatePct'),title=document.querySelector('#updateTitle'),detail=document.querySelector('#updateDetail');
 if(target==='POS'&&!cloudConfigured())return alert('尚未設定 Supabase，無法下傳 POS 主檔');
 title.textContent=target==='POS'?'下傳 POS 主檔中':target+'更新中';detail.textContent=target==='POS'?'正在同步員工主檔，POS 收到後會顯示「主檔更新中」並暫停操作。':'準備更新中…';
 o.classList.add('show');bar.style.width='10%';pct.textContent='10%';
 try{
  if(target==='POS'||target==='全部'){
   const ok=await cloudPushKey(K.employees,load(K.employees,[]));if(!ok)throw new Error('員工主檔同步失敗');
   const permOk=await cloudPushKey(K.permissions,load(K.permissions,{}));if(!permOk)throw new Error('員工權限同步失敗');
   await cloudPushKey(HQ_SPECIAL_TM_PERMISSIONS_KEY,hqSpecialTmPermissionMap());
   bar.style.width='65%';pct.textContent='65%';detail.textContent='員工主檔、權限與 HQ 特殊人員 TM 權限已送出，正在發送 TM 更新通知…';
   const signal={id:uid(),kind:'employee-master',revision:Date.now(),at:new Date().toISOString(),by:currentUser()?.name||'',storeCode:currentStoreCode(),status:'ready'};
   const signalOk=await cloudPushKey(K.masterUpdate,signal);if(!signalOk)throw new Error('POS 更新通知發送失敗');try{localStorage.removeItem('yj_employee_master_dirty')}catch{}
  }
  bar.style.width='100%';pct.textContent='100%';detail.textContent='下傳完成';
  const rows=load(K.updates,[]);rows.unshift({id:uid(),target,status:'成功',kind:target==='POS'?'員工主檔下傳':'系統更新',at:new Date().toISOString()});save(K.updates,rows);saveAudit('更新',target==='POS'?'下傳 POS 員工主檔':target);
  setTimeout(()=>{o.classList.remove('show');alert(target==='POS'?'POS 主檔已下傳。POS 端會自動進入「主檔更新中」，完成後解除鎖定。':target+'更新完成')},500);
 }catch(err){o.classList.remove('show');alert('更新失敗：'+err.message)}
}



document.addEventListener('click',e=>{
 if(!scMasterUpdateLockActive)return;
 if(e.target.closest('#scMasterUpdateLock')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return}
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
},true);
document.addEventListener('keydown',e=>{
 if(!scMasterUpdateLockActive)return;
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
},true);

// Alpha 2.90：非左側按鈕的 data-nav 後備導頁（首頁訊息、X帳／交班、返回鍵）。
document.body.addEventListener('click',e=>{
 const nav=e.target.closest('[data-nav]');
 if(!nav||nav.classList.contains('nav-item'))return;
 e.preventDefault();
 e.stopPropagation();
 goAdminPage(String(nav.dataset.nav||''),String(nav.dataset.navPermission||''));
});


// Alpha 2.71：商品管理專用操作事件。
document.body.addEventListener('click',e=>{
 const b=e.target.closest('button');
 if(!b)return;
 const handled=
  b.dataset.action==='print-all-product-barcodes'||
  b.dataset.action==='manage-groups'||
  b.dataset.action==='product-multiple-settings'||
  b.dataset.action==='linked-inventory-settings'||
  b.dataset.action==='tm-hidden-products-settings'||
  b.dataset.action==='tm-screen-categories-settings'||
  b.dataset.action==='tm-quick-amount-settings'||
  b.dataset.action==='self-anybuy-category-settings'||
  b.dataset.action==='self-anybuy-product-settings'||
  b.dataset.action==='new-product'||
  b.dataset.editProduct!==undefined||
  b.dataset.deleteProduct!==undefined||
  b.dataset.removeGroup!==undefined;
 if(!handled)return;
 e.preventDefault();
 e.stopPropagation();
 e.stopImmediatePropagation();

 if(b.dataset.action==='print-all-product-barcodes'){printAllProductBarcodes();return;}

 if(b.dataset.action==='manage-groups'){
  openProductGroupEditorDialog();
  return;
 }
 if(b.dataset.removeGroup!==undefined){
  return;
 }
 if(b.dataset.action==='product-multiple-settings'){openProductMultipleSettings();return}
 if(b.dataset.action==='linked-inventory-settings'){
  if(!isFounder())return alert('此功能只有創辦人可以使用');
  render('linked-inventory-settings');return;
 }
 if(b.dataset.action==='tm-hidden-products-settings'){openTmHiddenProductsSettings();return}
 if(b.dataset.action==='tm-screen-categories-settings'){openTmScreenCategoriesSettings();return}
 if(b.dataset.action==='tm-quick-amount-settings'){openTmQuickAmountSettings();return}
 if(b.dataset.action==='self-anybuy-category-settings'){openSelfAnybuyCategorySettings();return}
 if(b.dataset.action==='self-anybuy-product-settings'){openSelfAnybuyProductSettings();return}
 if(b.dataset.action==='new-product'){
  if(!canEditGlobalProductMaster())return alert('商品新增只有總店可以設定');
  if(!requirePermission('productCreate'))return;
  dlg('新增商品',productForm());
  setTimeout(()=>{
   bindProductFreshFields();
   const saveBtn=document.querySelector('#saveProduct');if(!saveBtn)return;
   saveBtn.onclick=()=>{
    const rows=load(K.products,[]),item={id:uid(),...readProductForm()};
    const err=validateProductItem(item,rows);if(err)return alert(err);
    rows.unshift(item);save(K.products,rows);
    saveAudit('新增商品',`${item.code}｜${item.name}｜總店同步所有門市`);
    if(cloudConfigured())cloudPushKey(K.products,rows).catch(()=>{});
    genericDialog.close();render('products');
   };
  },0);
  return;
 }
 if(b.dataset.editProduct!==undefined){
  if(!canEditGlobalProductMaster())return alert('商品修改只有總店可以設定');
  if(!requirePermission('productEdit'))return;
  const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.editProduct);
  if(!p)return alert('找不到商品資料');
  dlg('修改商品',productForm(p));
  setTimeout(()=>{
   bindProductFreshFields();
   const saveBtn=document.querySelector('#saveProduct');if(!saveBtn)return;
   saveBtn.onclick=()=>{
    const next=readProductForm(),err=validateProductItem(next,rows,p.id);if(err)return alert(err);
    const before=`${p.code||''}｜${p.name}`;
    Object.assign(p,next);save(K.products,rows);
    saveAudit('修改商品',`${before}→${p.code}｜${p.name}｜總店同步所有門市`);
    if(cloudConfigured())cloudPushKey(K.products,rows).catch(()=>{});
    genericDialog.close();render('products');
   };
  },0);
  return;
 }
 if(b.dataset.deleteProduct!==undefined){
  if(!canEditGlobalProductMaster())return alert('商品刪除只有總店可以設定');
  if(!requirePermission('productDelete'))return;
  const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.deleteProduct);
  if(!p)return alert('找不到商品資料');
  if(!confirm(`確定刪除「${p.name}」？`))return;
  const nextRows=rows.filter(x=>x.id!==p.id);
  save(K.products,nextRows);
  saveAudit('刪除商品',`${p.name}｜總店同步所有門市`);
  if(cloudConfigured())cloudPushKey(K.products,nextRows).catch(()=>{});
  render('products');
  return;
 }
},true);

document.body.addEventListener('click',async e=>{
 if(e.target.closest('[data-order-favorite-open]')){const c=e.target.closest('[data-order-favorite-open]'),kind=String(c.dataset.orderFavoriteKind||''),id=String(c.dataset.orderFavoriteOpen||'');if(!kind||!id)return;adminOrderingSelectedProductId=id;sessionStorage.setItem(`yj_sc_order_favorite_mode_${kind}`,'1');goAdminPage(`ordering-${kind}-detail`);return;}
 if(e.target.closest('[data-order-category-kind]')){const c=e.target.closest('[data-order-category-kind]'),kind=c.dataset.orderCategoryKind,idx=Number(c.dataset.orderCategoryIndex||0);sessionStorage.setItem(`yj_sc_order_favorite_mode_${kind}`,'0');sessionStorage.setItem(`yj_sc_order_cat_${kind}`,String(idx));sessionStorage.setItem(`yj_sc_order_group_code_${kind}`,String(c.dataset.orderCategoryCode||''));sessionStorage.setItem(`yj_sc_order_group_${kind}`,String(c.dataset.orderCategoryLabel||''));goAdminPage(`ordering-${kind}-detail`);return;}
 if(e.target.closest('[data-perm-l1-toggle]')){const box=e.target.closest('[data-perm-l1-toggle]');e.stopPropagation();if(scPermissionSetBranch(1,box.dataset.permL1Toggle,box.checked))render('permissions');return;}
 if(e.target.closest('[data-perm-l2-toggle]')){const box=e.target.closest('[data-perm-l2-toggle]');e.stopPropagation();if(scPermissionSetBranch(2,box.dataset.permL2Toggle,box.checked))render('permissions');return;}
 if(e.target.closest('[data-perm-l1]')){scPermissionL1=e.target.closest('[data-perm-l1]').dataset.permL1;const x=SC_PERMISSION_DIRECTORY[scPermissionL1];scPermissionL2=Object.keys(x?.children||{})[0]||'';render('permissions');return;}
 if(e.target.closest('[data-perm-l2]')){scPermissionL2=e.target.closest('[data-perm-l2]').dataset.permL2;render('permissions');return;}
 if(window.__yjDayReplacementLock){e.preventDefault();e.stopPropagation();return}const b=e.target.closest('button');if(!b)return;
 if(b.dataset.action==='save-prebuild-visibility'){
 if(!isFounder())return alert('只有創辦人可以修改未接通選單的顯示設定');
 const next={};
 document.querySelectorAll('[data-prebuild-visibility]').forEach(el=>{next[String(el.dataset.prebuildVisibility||'')]=!!el.checked});
 save(SC_PREBUILD_VISIBILITY_KEY,next);
 saveAudit('SC未接通選單顯示設定',`已開啟 ${Object.values(next).filter(Boolean).length} 項`);
 alert('未接通選單顯示設定已儲存，已同步更新八大選單');
 renderAuthorizedNav();
 render('permissions');
 return;
}
if(b.dataset.action==='permission-directory-save'){const target=scPermissionTarget();if(!target||!canManageTarget(currentUser(),target))return alert('不能修改此人員權限');const all=permissionStore(),next={...(all[target.id]||{})},draft=scPermissionDraftFor(target);const directoryKeys=[];for(const [l1code,l1] of Object.entries(SC_PERMISSION_DIRECTORY)){directoryKeys.push(`__dir_l1_${l1code}`);for(const [l2code,l2] of Object.entries(l1.children||{})){directoryKeys.push(`__dir_l2_${l2code}`);for(const row of (l2.items||[]))directoryKeys.push(row[2]);}}for(const key of [...new Set(directoryKeys)]){if(key.startsWith('__dir_')||canGrantPermission(currentUser(),key))next[key]=draft[key]===true;}all[target.id]=next;save(K.permissions,all);scPermissionDraft=null;scPermissionDraftTargetId='';saveAudit('權限設定',`${target.name||target.account}｜三層權限獨立保存`);alert('權限已儲存');render('permissions');return;}
 if(b.dataset.action==='order-category-back'){goAdminPage('home');return}
 if(b.dataset.action==='order-favorite-toggle'){const id=String(b.dataset.orderFavoriteId||'');if(!id)return;const added=orderFavoriteHas(id);added?orderFavoriteRemove(id):orderFavoriteAdd(id);b.textContent=added?'＋ 加入常訂購商品':'🩵 已加入常訂購商品';b.classList.toggle('is-added',!added);return}
 if(b.dataset.action==='order-product-face'){const id=String(b.dataset.faceProductId||'');const row=products().find(x=>String(x.id)===id);if(!row)return alert('找不到商品資料');if(!hasPermission('orderFacePrint'))return alert('沒有 FACE卡列印權限');const cart=faceCartAdd(id,1);b.textContent='已加入';b.classList.add('added');setTimeout(()=>{if(document.body.contains(b)){b.textContent='FACE';b.classList.remove('added');}},900);const hint=document.querySelector('.orange-order-face-cart-hint');if(hint)hint.textContent=`FACE清單：${cart.ids.length}項／${cart.ids.reduce((sum,x)=>sum+faceCardQty(x),0)}張`;return}
 if(b.dataset.action==='face-card-back'){goAdminPage('ordering');return}
 if(b.dataset.action==='face-card-search'){window.__yjFaceQuery=document.querySelector('#faceCardQuery')?.value||'';render('ordering-face');return}
 if(b.dataset.action==='face-card-clear'){window.__yjFaceQuery='';faceCartClear();render('ordering-face');return}
 if(b.dataset.action==='face-card-print-one'){const row=products().find(x=>String(x.id)===String(b.dataset.faceCardPrintId));if(!row)return alert('找不到商品資料');printFaceCards([row]);return}
 if(b.dataset.action==='face-card-print-selected'){const ids=faceCartLoad().ids.map(String),rows=products().filter(x=>ids.includes(String(x.id)));if(!rows.length)return alert('FACE 清單目前沒有商品');printFaceCards(rows);return}
 if(b.dataset.action==='collection-service-save'){
  const paymentMethod=String(document.querySelector('#collectionPaymentMethod')?.value||'現金');const cfg={enabled:document.querySelector('#collectionEnabled')?.value!=='false',minAmount:Number(document.querySelector('#collectionMin')?.value||0),maxAmount:Number(document.querySelector('#collectionMax')?.value||0),fee:Number(document.querySelector('#collectionFee')?.value||0),paymentMethod,allowCash:paymentMethod==='現金',allowNonCash:paymentMethod!=='現金',updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
  if(cfg.maxAmount>0&&cfg.maxAmount<cfg.minAmount)return alert('最高可收金額不可低於最低可收金額');
  save('yj_collection_service_config',cfg);saveAudit('代收服務設定','更新代收基本規則');alert('代收設定已儲存');render('collection-service');return;
 }
 if(b.dataset.action==='collection-provider-save'){
  const name=String(document.querySelector('#collectionProviderName')?.value||'').trim();if(!name)return alert('請輸入代收單位');
  const minAmount=Number(document.querySelector('#collectionProviderMin')?.value||0),maxAmount=Number(document.querySelector('#collectionProviderMax')?.value||0);if(maxAmount>0&&maxAmount<minAmount)return alert('單筆上限不可低於最低金額');
  const feeMode=String(document.querySelector('#collectionProviderFeeMode')?.value||'inherit'),fee=Number(document.querySelector('#collectionProviderFee')?.value||0);if(feeMode==='custom'&&fee<0)return alert('自訂手續費不可小於 0');
  const rows=load('yj_collection_service_providers',[])||[],editId=String(document.querySelector('#collectionProviderEditId')?.value||'');
  const data={name,type:String(document.querySelector('#collectionProviderType')?.value||'一般代收'),barcodeMode:String(document.querySelector('#collectionProviderBarcodeMode')?.value||'three'),prefix:String(document.querySelector('#collectionProviderPrefix')?.value||'').trim(),length:Number(document.querySelector('#collectionProviderLength')?.value||0),minAmount,maxAmount,feeMode,fee:feeMode==='custom'?fee:0,paymentMethod:String(document.querySelector('#collectionProviderPaymentMethod')?.value||'現金'),allowCash:String(document.querySelector('#collectionProviderPaymentMethod')?.value||'現金')==='現金',allowNonCash:String(document.querySelector('#collectionProviderPaymentMethod')?.value||'現金')!=='現金',overduePolicy:String(document.querySelector('#collectionProviderOverdue')?.value||'reprint'),reprintMethod:String(document.querySelector('#collectionProviderReprint')?.value||'kiosk'),reprintNote:String(document.querySelector('#collectionProviderReprintNote')?.value||'').trim(),enabled:document.querySelector('#collectionProviderEnabled')?.value!=='false',updatedAt:new Date().toISOString()};
  if(editId){const i=rows.findIndex(x=>String(x.id)===editId);if(i<0)return alert('找不到要修改的代收單位');rows[i]={...rows[i],...data};saveAudit('代收單位管理',`修改｜${name}`)}else{rows.push({id:'COL'+Date.now(),...data,createdAt:new Date().toISOString()});saveAudit('代收單位管理',`新增｜${name}｜最低${minAmount||'依全域'}｜上限${maxAmount||'依全域'}`)}
  save('yj_collection_service_providers',rows);render('collection-service');return;
 }
 if(b.dataset.action==='collection-provider-edit'){
  const i=Number(b.dataset.providerIndex),rows=load('yj_collection_service_providers',[])||[],x=rows[i];if(!x)return;
  const set=(q,v)=>{const el=document.querySelector(q);if(el)el.value=v??''};set('#collectionProviderEditId',x.id);set('#collectionProviderName',x.name);set('#collectionProviderType',x.type||'一般代收');set('#collectionProviderBarcodeMode',x.barcodeMode||'three');set('#collectionProviderPrefix',x.prefix||'');set('#collectionProviderLength',Number(x.length||0));set('#collectionProviderMin',Number(x.minAmount||0));set('#collectionProviderMax',Number(x.maxAmount||0));set('#collectionProviderFeeMode',x.feeMode||'inherit');set('#collectionProviderFee',Number(x.fee||0));set('#collectionProviderPaymentMethod',String(x.paymentMethod||((x.allowCash!==false)?'現金':(x.allowNonCash===true?'信用卡':'現金'))));set('#collectionProviderOverdue',x.overduePolicy||'reprint');set('#collectionProviderReprint',x.reprintMethod||'kiosk');set('#collectionProviderReprintNote',x.reprintNote||'');set('#collectionProviderEnabled',x.enabled===false?'false':'true');
  const saveBtn=document.querySelector('#collectionProviderSaveBtn'),cancelBtn=document.querySelector('#collectionProviderCancelEdit');if(saveBtn)saveBtn.textContent='儲存修改';if(cancelBtn)cancelBtn.hidden=false;document.querySelector('#collectionProviderName')?.scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(b.dataset.action==='collection-provider-cancel-edit'){render('collection-service');return}
 if(b.dataset.action==='collection-provider-delete'){
  const i=Number(b.dataset.providerIndex);const rows=load('yj_collection_service_providers',[])||[];if(!rows[i])return;if(!confirm(`確定刪除「${rows[i].name||''}」？`))return;const name=rows[i].name||'';rows.splice(i,1);save('yj_collection_service_providers',rows);saveAudit('代收單位管理',`刪除｜${name}`);render('collection-service');return;
 }
 if(b.dataset.action==='open-order-details'){if(genericDialog?.open)genericDialog.close();openOrderingDetails();return}
 if(b.dataset.action==='ordering-rule-add-weekday'){
  const cfg=readOrderingRulesFromDom();cfg.weekdays.push({id:uid(),name:'新規則',scopeType:'品類文字',scopeValue:'',days:[],active:true});save(K.orderRules,cfg);render('ordering-rules-settings');return;
 }
 if(b.dataset.orderingRuleDelete!==undefined){
  const cfg=readOrderingRulesFromDom(),i=Number(b.dataset.orderingRuleDelete);if(cfg.weekdays[i])cfg.weekdays.splice(i,1);save(K.orderRules,cfg);render('ordering-rules-settings');return;
 }
 if(b.dataset.action==='save-ordering-rules'){
  const cfg=readOrderingRulesFromDom();save(K.orderRules,cfg);saveAudit('訂購規則設定',`配送規則${cfg.delivery.length}條｜星期規則${cfg.weekdays.length}條｜已啟用`);alert('訂購規則已儲存並啟用。\n已能辨識的商品會套用星期限制；尚未分類／尚未建入的商品不會被誤擋。');render('ordering-rules-settings');return;
 }
 bindCustomerSlideImageUploads();
 if(b.dataset.action==='customer-storage-check'){await showBrowserStorageEstimate();return}
 if(b.dataset.action==='customer-game-activity-add'){openCustomerGameActivityForm();return}
 if(b.dataset.gameActivityEdit!==undefined){openCustomerGameActivityForm(Number(b.dataset.gameActivityEdit));return}
 if(b.dataset.gameActivityCancel!==undefined){toggleCustomerGameActivity(Number(b.dataset.gameActivityCancel));return}
 if(b.dataset.action==='member-admin-search'){
  const q=(document.querySelector('#memberAdminSearch')?.value||'').trim().toLowerCase();
  const rows=load(K.members,[]).filter(m=>!q||[m.name,m.phone,m.code,m.memberNo,m.id].some(v=>String(v||'').toLowerCase().includes(q)));
  const el=document.querySelector('#memberAdminRows');if(el)el.innerHTML=memberAdminRowsHtml(rows);return;
 }
 if(b.dataset.action==='member-admin-clear'){const i=document.querySelector('#memberAdminSearch');if(i)i.value='';const el=document.querySelector('#memberAdminRows');if(el)el.innerHTML=memberAdminRowsHtml(load(K.members,[]));return}
 if(b.dataset.action==='customer-music-add'){openCustomerMusicForm();return}
 if(b.dataset.musicEdit!==undefined){openCustomerMusicForm(Number(b.dataset.musicEdit));return}
 if(b.dataset.musicCancel!==undefined){mutateCustomerMusic(Number(b.dataset.musicCancel));return}
 if(b.dataset.musicDelete!==undefined){deleteCustomerMusic(Number(b.dataset.musicDelete));return}
 if(b.dataset.action==='customer-voice-add'){openCustomerVoiceTypeForm();return}
 if(b.dataset.voiceEdit!==undefined){openCustomerVoiceTypeForm(Number(b.dataset.voiceEdit));return}
 if(b.dataset.voiceDelete!==undefined){deleteCustomerVoiceType(Number(b.dataset.voiceDelete));return}
 if(b.dataset.gameActivityDelete!==undefined){deleteCustomerGameActivity(Number(b.dataset.gameActivityDelete));return}
 if(b.dataset.action==='customer-display-add-slide'){mutateCustomerSlide('add',0);return}
 if(b.dataset.action==='customer-display-save-global'){saveCustomerDisplaySettingsFromDom();return}
 if(b.dataset.slideDelete!==undefined){mutateCustomerSlide('delete',b.dataset.slideDelete);return}
 if(b.dataset.slideUp!==undefined){mutateCustomerSlide('up',b.dataset.slideUp);return}
 if(b.dataset.slideDown!==undefined){mutateCustomerSlide('down',b.dataset.slideDown);return}
 if(b.dataset.action==='revenue-report-current'){
  const id=document.querySelector('#revenueTarget')?.value||'';
  if(!id)return alert('請先選擇要查看的營收日期');
  const record=load(K.revenue,[]).find(x=>String(x.id)===String(id));
  if(!record)return alert('找不到營收紀錄');
  printRevenueReport(record,String(b.dataset.reportType||''));
  return;
 }
 if(b.dataset.revenueReportType){
  const record=load(K.revenue,[]).find(x=>String(x.id)===String(b.dataset.revenueReportId||''));
  if(!record)return alert('找不到營收紀錄');
  printRevenueReport(record,b.dataset.revenueReportType);
  return;
 }
 if(b.dataset.orangeOrderStrip){
  const selectable=products().filter(p=>productStatusLabel(p)!=='停用');
  const maxPage=Math.max(0,Math.ceil(selectable.length/10)-1);
  adminOrderingStripPage=Math.max(0,Math.min(maxPage,adminOrderingStripPage+Number(b.dataset.orangeOrderStrip||0)));
  refreshOrderingCurrentView();return;
 }
 if(b.dataset.orangeOrderProduct){
  adminOrderingSelectedProductId=b.dataset.orangeOrderProduct;
  refreshOrderingCurrentView();
  return;
 }
 if(b.dataset.action==='orange-order-open-history'){openOrangeOrderHistory();return}


 // Alpha 2.71：商品管理所有操作優先處理，避免其他模組事件造成按鍵無反應。
 if(b.dataset.action==='manage-groups'){
  openProductGroupEditorDialog();
  return;
 }
 if(b.dataset.action==='product-multiple-settings'){openProductMultipleSettings();return}
 if(b.dataset.action==='linked-inventory-settings'){
  if(!isFounder())return alert('此功能只有創辦人可以使用');
  render('linked-inventory-settings');return;
 }
 if(b.dataset.action==='new-product'){
  dlg('新增商品',productForm());
  setTimeout(()=>{
   bindProductFreshFields();
   const saveBtn=document.querySelector('#saveProduct');if(!saveBtn)return;
   saveBtn.onclick=()=>{
    const rows=load(K.products,[]),item={id:uid(),...readProductForm()};
    const error=validateProductItem(item,rows);if(error)return alert(error);
    rows.unshift(item);save(K.products,rows);
    saveAudit('新增商品',`${item.code}｜${item.name}`);
    genericDialog.close();render('products');
   };
  },0);
  return;
 }
 if(b.dataset.editProduct){
  const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.editProduct);
  if(!p)return alert('找不到商品資料');
  dlg('修改商品',productForm(p));
  setTimeout(()=>{
   bindProductFreshFields();
   const saveBtn=document.querySelector('#saveProduct');if(!saveBtn)return;
   saveBtn.onclick=()=>{
    const next=readProductForm(),error=validateProductItem(next,rows,p.id);if(error)return alert(error);
    const before=`${p.code||''}｜${p.name}`;
    Object.assign(p,next);save(K.products,rows);
    saveAudit('修改商品',`${before}→${p.code}｜${p.name}`);
    genericDialog.close();render('products');
   };
  },0);
  return;
 }
 if(b.dataset.deleteProduct){
  const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.deleteProduct);
  if(!p)return alert('找不到商品資料');
  if(confirm(`確定刪除「${p.name}」？`)){
   save(K.products,rows.filter(x=>x.id!==p.id));
   saveAudit('刪除商品',p.name);render('products');
  }
  return;
 }
 if(b.dataset.nav){
  const perm=b.dataset.navPermission||HOME_PAGE_PERMISSION[b.dataset.nav]||'';
  if(perm&&!hasPermission(perm)){alert('你沒有此類別的操作權限');return}
  render(b.dataset.nav);return;
 }

 if(b.dataset.action==='stocktake-report-query'){window.__yjStocktakeReportBatchId=document.querySelector('#stocktakeReportBatch')?.value||'';render('stocktake-report');return;}
 if(b.dataset.action==='stocktake-report-print'){
  const id=window.__yjStocktakeReportBatchId||document.querySelector('#stocktakeReportBatch')?.value||'',batch=(load(K.stocktakeBatches,[])||[]).find(x=>String(x.id)===String(id));if(!batch)return alert('請先選擇盤點單');const moves=(load(K.inventoryMoves,[])||[]).filter(x=>x.type==='盤點'&&(String(x.batchId||'')===String(batch.id)||(!x.batchId&&String(x.batchNo||'')===String(batch.batchNo||''))));const rows=moves.map(x=>`<tr><td>${esc(x.product||'')}</td><td>${Number(x.bookQty??(Number(x.actualQty||0)-Number(x.qty||0)))}</td><td>${Number(x.actualQty??(Number(x.bookQty||0)+Number(x.qty||0)))}</td><td>${Number(x.qty||0)>0?'+':''}${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.user||'')}</td></tr>`).join('')||'<tr><td colspan="6">無盤點結果</td></tr>';const w=window.open('','_blank');if(!w)return alert('瀏覽器阻擋列印視窗，請允許彈出式視窗');w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>盤點報告書</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:7px}th{background:#f2f2f2}.no-print{margin-bottom:16px}@media print{.no-print{display:none!important}}</style></head><body><div class="no-print"><button onclick="window.close()">← 返回</button> <button onclick="window.print()">🖨️ 列印</button></div><h1>億家｜盤點報告書</h1><p>盤點單號：${esc(batch.batchNo||'—')}｜完成時間：${batch.completedAt?new Date(batch.completedAt).toLocaleString('zh-TW'):'—'}｜完成者：${esc(batch.completedBy||'—')}</p><table><tr><th>商品</th><th>帳面數</th><th>實盤數</th><th>差異值</th><th>原因／備註</th><th>盤點人員</th></tr>${rows}</table></body></html>`);w.document.close();return;
 }
 // Alpha 2.63：盤點／庫存管理按鍵優先處理。
 // 避免後續模組事件或錯誤攔截，造成畫面有按鍵但點擊無反應。
 if(b.dataset.action==='inventory-month-setting'){
  const nowMonth=new Date().toISOString().slice(0,7),current=load(K.stocktakeMonth,nowMonth)||nowMonth;
  dlg('盤點月份設定',`<p class="meta">設定盤點管理目前要查看／作業的月份。</p><label>盤點月份<input id="stocktakeMonthInput" type="month" value="${esc(current)}"></label><button class="primary" id="saveStocktakeMonth">儲存月份</button>`);
  setTimeout(()=>{const btn=document.querySelector('#saveStocktakeMonth');if(!btn)return;btn.onclick=()=>{const v=document.querySelector('#stocktakeMonthInput')?.value;if(!v)return alert('請選擇月份');save(K.stocktakeMonth,v);saveAudit('盤點月份設定',v);genericDialog.close();render('inventory');};},0);
  return;
 }
 if(b.dataset.action==='stocktake-start'){const batches=load(K.stocktakeBatches,[]);if(batches.some(x=>x.status==='進行中'))return alert('目前已有進行中的盤點單');const now=new Date(),pad=n=>String(n).padStart(2,'0'),batchNo=`YJST${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;batches.unshift({id:uid(),batchNo,status:'進行中',stocktakeMonth:load(K.stocktakeMonth,now.toISOString().slice(0,7))||now.toISOString().slice(0,7),itemCount:0,diffTotal:0,startedAt:now.toISOString(),startedBy:currentUser().name,completedAt:null,completedBy:''});save(K.stocktakeBatches,batches);saveAudit('開始盤點',batchNo);render('inventory');return}
 if(b.dataset.action==='stocktake-complete'){const batches=load(K.stocktakeBatches,[]),x=batches.find(v=>v.status==='進行中');if(!x)return alert('目前沒有進行中的盤點單');if(!confirm(`確定完成盤點單 ${x.batchNo}？完成後將不可再加入品項。`))return;x.status='已完成';x.completedAt=new Date().toISOString();x.completedBy=currentUser().name;save(K.stocktakeBatches,batches);saveAudit('完成盤點',`${x.batchNo}｜${x.itemCount||0} 項｜差異 ${Number(x.diffTotal)>0?'+':''}${Number(x.diffTotal||0)}`);render('inventory');return}
 if(b.dataset.action==='inventory-print'){const stocktakeMonth=load(K.stocktakeMonth,new Date().toISOString().slice(0,7))||new Date().toISOString().slice(0,7),moves=load(K.inventoryMoves,[]).filter(x=>x.type==='盤點'&&(x.stocktakeMonth||String(x.at||'').slice(0,7))===stocktakeMonth),rows=moves.map(x=>`<tr><td>${esc(x.product)}</td><td>${Number(x.bookQty??(Number(x.actualQty||0)-Number(x.qty||0)))}</td><td>${Number(x.actualQty??(Number(x.bookQty||0)+Number(x.qty||0)))}</td><td>${Number(x.qty)>0?'+':''}${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td></tr>`).join('')||'<tr><td colspan="6">尚無盤點紀錄</td></tr>';const w=window.open('','_blank');if(!w)return alert('瀏覽器阻擋列印視窗，請允許彈出式視窗');w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>盤點差異值列表</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;padding:24px;color:#111}h1{font-size:24px;margin:0 0 6px}p{margin:0 0 18px;color:#555}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#f1f4f2}@media print{.print-toolbar,button{display:none!important}}</style></head><body><div class="print-toolbar" style="display:flex;gap:10px;margin-bottom:18px"><button onclick="window.close()" style="padding:10px 16px">← 返回</button><button onclick="window.print()" style="padding:10px 16px">🖨️ 列印</button></div><h1>億家小舖｜盤點差異值列表</h1><p>盤點月份：${stocktakeMonth}｜列印時間：${new Date().toLocaleString('zh-TW')}</p><table><tr><th>商品</th><th>帳面數</th><th>實盤數</th><th>差異值</th><th>原因</th><th>時間</th></tr>${rows}</table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();return}
 if(b.dataset.action==='inventory-order-limits'){
  if(!requirePermission('inventoryOrderLimitEdit'))return;
  const ps=products();
  dlg('最大／最小訂購數設定',`<p class="meta">0 代表不限制。最大訂購數不可小於最小訂購數。</p><div class="table-wrap"><table class="table"><tr><th>商品</th><th>最小訂購數</th><th>最大訂購數</th></tr>${ps.map(x=>`<tr><td>${x.icon||'📦'} ${esc(x.name)}</td><td><input type="number" min="0" inputmode="numeric" data-min-order="${x.id}" value="${Number(x.minOrderQty||0)}" style="min-width:95px"></td><td><input type="number" min="0" inputmode="numeric" data-max-order="${x.id}" value="${Number(x.maxOrderQty||0)}" style="min-width:95px"></td></tr>`).join('')}</table></div><button class="primary" id="saveInventoryOrderLimits">儲存設定</button>`);
  setTimeout(()=>{const saveBtn=document.querySelector('#saveInventoryOrderLimits');if(!saveBtn)return;saveBtn.onclick=()=>{const rows=load(K.products,[]);for(const p of rows){const minEl=document.querySelector(`[data-min-order="${p.id}"]`),maxEl=document.querySelector(`[data-max-order="${p.id}"]`);const min=Math.max(0,Number(minEl?.value||0)),max=Math.max(0,Number(maxEl?.value||0));if(max>0&&max<min)return alert(`${p.name}：最大訂購數不可小於最小訂購數`);p.minOrderQty=min;p.maxOrderQty=max;}save(K.products,rows);saveAudit('訂購上下限設定',`更新 ${rows.length} 項商品最大／最小訂購數`);genericDialog.close();render('inventory');};},0);
  return;
 }
 if(b.dataset.action==='inventory-adjust'){const ps0=products();dlg('盤點',`<label>商品<select id="iap">${ps0.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><div class="meta" id="iabook" style="margin:8px 0 14px">SC 顯示帳面：${scSurfaceStockValue(ps0[0])}</div><label>實際盤點數<input id="iaq" type="number" min="0" inputmode="numeric" placeholder="輸入實際數量"></label><div class="meta" id="iadiff" style="margin:8px 0 14px">盤點差異值：—</div><label>差異原因／備註<input id="iar" placeholder="選填"></label><button class="primary" id="ias">盤點</button>`);setTimeout(()=>{const updatePreview=()=>{const p=load(K.products,[]).find(x=>x.id===iap.value),book=scSurfaceStockValue(p),raw=iaq.value; iabook.textContent=`SC 顯示帳面：${book}`; if(raw===''){iadiff.textContent='盤點差異值：—';return} const actual=Math.max(0,Number(raw||0)),d=actual-book;iadiff.textContent=`盤點差異值：${d>0?'+':''}${d}`};iap.onchange=()=>{iaq.value='';updatePreview()};iaq.oninput=updatePreview;ias.onclick=()=>{const ps=load(K.products,[]),p=ps.find(x=>x.id===iap.value);if(!p)return alert('請選擇商品');if(iaq.value==='')return alert('請輸入實際盤點數');const book=scSurfaceStockValue(p),actual=Math.max(0,Number(iaq.value||0)),diff=actual-book;const surface=scSurfaceStockMap();surface[String(p.id)]=actual;save('yj_sc_surface_stock',surface);const moves=load(K.inventoryMoves,[]);const batches=load(K.stocktakeBatches,[]),active=batches.find(x=>x.status==='進行中');moves.unshift({id:uid(),product:p.name,qty:diff,bookQty:book,actualQty:actual,type:'盤點',stocktakeMonth:active?.stocktakeMonth||load(K.stocktakeMonth,new Date().toISOString().slice(0,7))||new Date().toISOString().slice(0,7),batchId:active?.id||'',batchNo:active?.batchNo||'',reason:iar.value,user:currentUser().name,at:new Date().toISOString()});save(K.inventoryMoves,moves);if(active){active.itemCount=Number(active.itemCount||0)+1;active.diffTotal=Number(active.diffTotal||0)+diff;save(K.stocktakeBatches,batches);}saveAudit('盤點',`${p.name} 帳面 ${book}｜實盤 ${actual}｜差異 ${diff>0?'+':''}${diff}`);genericDialog.close();render('inventory')};updatePreview()},0)}
 if(b.dataset.stock){const ps0=products(),selectedId=b.dataset.stock,sel=ps0.find(x=>x.id===selectedId);dlg('盤點',`<label>商品<select id="iap">${ps0.map(x=>`<option value="${x.id}" ${x.id===selectedId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><div class="meta" id="iabook" style="margin:8px 0 14px">帳面庫存：${Number(sel?.stock||0)}</div><label>實際盤點數<input id="iaq" type="number" min="0" inputmode="numeric" placeholder="輸入實際數量"></label><div class="meta" id="iadiff" style="margin:8px 0 14px">盤點差異值：—</div><label>差異原因／備註<input id="iar" placeholder="選填"></label><button class="primary" id="ias">盤點</button>`);setTimeout(()=>{const updatePreview=()=>{const p=load(K.products,[]).find(x=>x.id===iap.value),book=scSurfaceStockValue(p),raw=iaq.value;iabook.textContent=`SC 顯示帳面：${book}`;if(raw===''){iadiff.textContent='盤點差異值：—';return}const actual=Math.max(0,Number(raw||0)),d=actual-book;iadiff.textContent=`盤點差異值：${d>0?'+':''}${d}`};iap.onchange=()=>{iaq.value='';updatePreview()};iaq.oninput=updatePreview;ias.onclick=()=>{const ps=load(K.products,[]),p=ps.find(x=>x.id===iap.value);if(!p)return alert('請選擇商品');if(iaq.value==='')return alert('請輸入實際盤點數');const book=scSurfaceStockValue(p),actual=Math.max(0,Number(iaq.value||0)),diff=actual-book;const surface=scSurfaceStockMap();surface[String(p.id)]=actual;save('yj_sc_surface_stock',surface);const moves=load(K.inventoryMoves,[]);const batches=load(K.stocktakeBatches,[]),active=batches.find(x=>x.status==='進行中');moves.unshift({id:uid(),product:p.name,qty:diff,bookQty:book,actualQty:actual,type:'盤點',stocktakeMonth:active?.stocktakeMonth||load(K.stocktakeMonth,new Date().toISOString().slice(0,7))||new Date().toISOString().slice(0,7),batchId:active?.id||'',batchNo:active?.batchNo||'',reason:iar.value,user:currentUser().name,at:new Date().toISOString()});save(K.inventoryMoves,moves);if(active){active.itemCount=Number(active.itemCount||0)+1;active.diffTotal=Number(active.diffTotal||0)+diff;save(K.stocktakeBatches,batches);}saveAudit('盤點',`${p.name} 帳面 ${book}｜實盤 ${actual}｜差異 ${diff>0?'+':''}${diff}`);genericDialog.close();render('inventory')};updatePreview()},0)}

 if(b.dataset.action==='reload-latest'){if(!requirePermission('systemVersion'))return;location.reload();return}
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

 if(b.dataset.action==='linked-inventory-settings'){if(!isFounder())return alert('此功能只有創辦人可以使用');render('linked-inventory-settings');return}
 if(b.dataset.action==='new-linked-rule'){openLinkedInventoryRuleForm();return}
 if(b.dataset.editLinkedRule){if(!isFounder())return alert('此功能只有創辦人可以使用');const x=linkedInventoryRules().find(r=>r.id===b.dataset.editLinkedRule);if(x)openLinkedInventoryRuleForm(x);return}
 if(b.dataset.deleteLinkedRule){if(!isFounder())return alert('此功能只有創辦人可以使用');const x=linkedInventoryRules().find(r=>r.id===b.dataset.deleteLinkedRule);if(!x)return;if(!confirm(`確定刪除 ${x.parentCode} → ${x.componentCode} 的組合／拆零設定？`))return;save(K.linkedInventoryRules,linkedInventoryRules().filter(r=>r.id!==x.id));saveAudit('刪除組合／拆零設定',`${x.parentCode} → ${x.componentCode}`);render('linked-inventory-settings');return}

 if(b.dataset.action==='new-member-bonus'){openMemberBonusCampaignForm();return}
 if(b.dataset.editMemberBonus){const x=memberBonusCampaignRows().find(v=>v.id===b.dataset.editMemberBonus);if(x)openMemberBonusCampaignForm(x);return}
 if(b.dataset.disableMemberBonus){
  if(!requirePermission('memberBonusCampaignSettings'))return;
  const rows=memberBonusCampaignRows(),x=rows.find(v=>v.id===b.dataset.disableMemberBonus);
  if(x){
   x.active=x.active===false;save(K.memberBonusCampaigns,rows);
   if(cloudConfigured())try{await cloudPushKey(K.memberBonusCampaigns,rows)}catch(err){console.warn('會員贈點活動狀態同步失敗',err)}
   saveAudit('會員贈點活動狀態',`${x.name}｜${x.active?'啟用':'停用'}`);render('member-bonus-settings')
  }
  return;
 }

 if(b.dataset.action==='save-point-settings'){if(!requirePermission('memberPointSettings'))return;savePointSettings();return}
 if(b.dataset.action==='promotion-auto-arrival-settings'){if(!isFounder())return alert('此功能只有創辦人可以使用');if(!isFounder())return alert('此功能只有創辦人可以使用');openPromotionAutoArrivalSettings();return}
 if(b.dataset.action==='new-promotion'){if(!isFounder()&&!requirePermission('promotionsManage'))return;openPromotionForm();return}
 if(b.dataset.editPromotion){if(!isFounder()&&!requirePermission('promotionsManage'))return;const x=promotionRows().find(v=>v.id===b.dataset.editPromotion);if(x)openPromotionForm(x);return}
 if(b.dataset.deletePromotion){if(!isFounder()&&!requirePermission('promotionsManage'))return;const all=allPromotionRows(),x=promotionRows().find(v=>v.id===b.dataset.deletePromotion);if(x&&confirm('確定刪除此活動？')){save(K.promotionRules,all.filter(v=>v.id!==x.id));render('promotions')}return}
 if(b.dataset.action==='save-system-settings'){saveSystemSettings();return}
 if(b.dataset.action==='system-restart'){if(confirm('確定重新啟動系統介面？'))location.reload();return}
 if(b.dataset.action==='view-x-history'){render('xaccount');return}


 if(b.dataset.action==='close-shift'){closeShift();return}
 if(b.dataset.xPrint){const x=xAccountRows().find(v=>v.id===b.dataset.xPrint);if(x)printXAccount(x);return}

 if(b.dataset.action==='cancel-correction-mode'){endCorrectionMode();render('pos');return}
 if(b.dataset.action==='confirm-pos-correction'){
  const mode=state.correctionMode;
  if(!mode)return;
  const adjustments=(mode.selections||[])
   .map((x,i)=>({...x,returnQty:Number(document.querySelector(`[data-pos-correction-qty="${i}"]`)?.value||0)}))
   .filter(x=>x.returnQty>0)
   .map(x=>({lineId:x.productId,productId:x.productId,returnQty:x.returnQty}));
  if(!adjustments.length)return alert('請至少輸入一項退貨數量');
  const reason=document.querySelector('#posCorrectionReason')?.value||'交易更正';
  const note=document.querySelector('#posCorrectionNote')?.value?.trim()||'';
  try{
   correctSale(mode.saleId,adjustments,reason,note);reconcileMemberPointsAfterReturn(mode.saleId);
   alert('交易更正完成');
   endCorrectionMode();
   render('pos');
  }catch(err){alert(err.message)}
  return;
 }

 if(b.dataset.action==='ec-front'){ecActionDialog(null,true);return}
 if(b.dataset.action==='logistics-open-receipt-detail'){openSelectedLogisticsReceipt();return}
 if(b.dataset.action==='logistics-open-acceptance'){openSelectedLogisticsAcceptance();return}
 if(b.dataset.action==='logistics-print-receipt'){printSelectedLogisticsReceipt();return}
 if(b.dataset.action==='ec-arrival'){ecActionDialog('arrival');return}
 if(b.dataset.action==='ec-pickup'){ecActionDialog('pickup');return}
 if(b.dataset.action==='ec-leave'){ecActionDialog('leave');return}

 if(b.dataset.action==='new-fresh-batch'){if(!['創辦人','管理員'].includes(currentUser()?.role))return alert('新增鮮食批次只有管理員可以使用');openFreshBatchForm();return}
 if(b.dataset.freshEdit){if(!requirePermission('qualityOperate'))return;const item=freshBatches().find(x=>x.id===b.dataset.freshEdit);if(item)openFreshBatchForm(item);return}
 if(b.dataset.freshWaste){if(!requirePermission('qualityOperate'))return;
  const rows=freshBatches(),item=rows.find(x=>x.id===b.dataset.freshWaste);
  if(!item)return;
  if(!confirm(`確定將批次 ${item.batchNo} 登錄為已廢棄？`))return;
  const wasteQty=Math.max(0,Number(item.remainingQty||0));
  item.status='已廢棄';item.remainingQty=0;item.updatedAt=new Date().toISOString();
  save(K.freshBatches,rows);
  const ps=load(K.products,[]),prod=ps.find(x=>x.id===item.productId)||ps.find(x=>x.name===item.productName);
  if(prod&&wasteQty>0){prod.stock=Math.max(0,Number(prod.stock||0)-wasteQty);save(K.products,ps);const wr=load(K.waste,[]);wr.unshift({id:uid(),productId:prod.id,productCode:prod.code||'',barcode:prod.barcode||'',name:prod.name,qty:wasteQty,reason:'鮮食批次廢棄',batchNo:item.batchNo,user:currentUser().name,at:new Date().toISOString()});save(K.waste,wr);}
  saveAudit('廢棄鮮食批次',`${item.batchNo}｜${item.productName}｜${wasteQty}件｜庫存同步`);
  render('quality');return;
 }
 if(b.dataset.freshDelete){if(!requirePermission('qualityDelete'))return;
  const rows=freshBatches(),item=rows.find(x=>x.id===b.dataset.freshDelete);
  if(!item)return;
  if(!confirm(`確定刪除鮮食批次 ${item.batchNo}？\n刪除後無法復原。`))return;
  save(K.freshBatches,rows.filter(x=>x.id!==b.dataset.freshDelete));
  saveAudit('刪除鮮食批次',`${item.batchNo}｜${item.productName}`);
  render('quality');return;
 }

 if(b.dataset.v531OrderType){v531OpenOrdering(b.dataset.v531OrderType);return}
 if(b.dataset.v531OrderDetail){const o=load(K.orders,[]).find(x=>x.id===b.dataset.v531OrderDetail);if(o)v531OpenOrderDetail(o);return}
 if(b.dataset.v531OrderEdit){const o=load(K.orders,[]).find(x=>x.id===b.dataset.v531OrderEdit);if(o)v531OpenOrderEdit(o);return}
 if(b.dataset.v531OrderPrint){const o=load(K.orders,[]).find(x=>x.id===b.dataset.v531OrderPrint);if(o)v531PrintOrder(o);return}
 if(b.dataset.v531OrderDelete){
  const rows=load(K.orders,[]),o=rows.find(x=>x.id===b.dataset.v531OrderDelete);
  if(o&&!['未傳輸','已建立'].includes(o.status||'已建立'))return alert('已傳輸的訂購單不可直接刪除');
  if(!confirm('確定刪除此訂購單？'))return;
  save(K.orders,rows.filter(x=>x.id!==b.dataset.v531OrderDelete));
  saveAudit('刪除訂購單',o?.id||b.dataset.v531OrderDelete);render('ordering');return;
 }


 if(b.dataset.action==='employee-master-save'){
  const rows=load(K.employees,[]),id=String(window.__yjEmployeePageSelected||''),u=rows.find(x=>String(x.id)===id);
  if(!u)return alert('找不到員工資料');
  if(!(isFounderSelf(currentUser(),u)||canEditEmployeeTarget(currentUser(),u)))return alert('不能修改此員工');
  const founderSelf=isFounderSelf(currentUser(),u);
  const name=document.querySelector('#empName')?.value.trim()||'',role=founderSelf?'創辦人':document.querySelector('#empRole')?.value||u.role,status=founderSelf?'在職':document.querySelector('#empStatus')?.value||'在職';
  const position=document.querySelector('#empPosition')?.value||'',identity=document.querySelector('#empIdentity')?.value||'',birthDate=document.querySelector('#empBirth')?.value||'',reportDate=document.querySelector('#empReport')?.value||'',joinDate=document.querySelector('#empJoin')?.value||'',householdAddress=document.querySelector('#empHouseholdAddress')?.value.trim()||'',contactPhone=document.querySelector('#empContactPhone')?.value.trim()||'';
  const account=document.querySelector('#empLoginAccount')?.value.trim().toLowerCase()||'',newPassword=document.querySelector('#empNewPassword')?.value||'',confirmPassword=document.querySelector('#empConfirmPassword')?.value||'',eobAccount=document.querySelector('#empEobAccount')?.value.trim().toLowerCase()||'',eobEmail=document.querySelector('#empEobEmail')?.value.trim().toLowerCase()||'',eobCurrentPassword=document.querySelector('#empEobCurrentPassword')?.value||'',eobNewPassword=document.querySelector('#empEobPassword')?.value||'',eobConfirmPassword=document.querySelector('#empEobConfirm')?.value||'',eobLoginEnabled=(document.querySelector('#empEobStatus')?.value||'enabled')==='enabled';
  const missing=[];if(!name)missing.push('姓名');if(!role)missing.push('角色');if(!position)missing.push('職位');if(!identity)missing.push('身份');if(!birthDate)missing.push('出生日期');if(!reportDate)missing.push('報到日');if(!joinDate)missing.push('入社日');if(!householdAddress)missing.push('戶籍地址');if(!contactPhone)missing.push('通訊電話');if(!account)missing.push('登入帳號');
  if(missing.length)return alert(`以下 * 必填欄位尚未填寫：\n${missing.join('、')}`);
  if(!/^[a-z0-9_][a-z0-9_.-]{1,29}$/i.test(account))return alert('登入帳號請使用 2～30 碼英數字、_、.、-');
  if(rows.some(x=>x.id!==u.id&&String(x.account||'').toLowerCase()===account))return alert('登入帳號已被使用');
  if(newPassword&&newPassword.length<4)return alert('新密碼至少 4 碼');
  if(newPassword!==confirmPassword)return alert('兩次新密碼不一致');
  if(eobAccount&&!/^[a-z0-9_][a-z0-9_.-]{1,29}$/i.test(eobAccount))return alert('EOB 登入帳號請使用 2～30 碼英數字、_、.、-');
  if(eobNewPassword&&eobNewPassword.length<4)return alert('EOB 新密碼至少 4 碼');
  if(eobNewPassword!==eobConfirmPassword)return alert('兩次 EOB 新密碼不一致');
  if(!founderSelf&&!u.isStocktakePersonnel&&!u.isEngineerPersonnel&&!u.isHeadOfficePersonnel&&!validateEmployeeRoleChange(u.role,role))return;
  const beforeStatus=employeeEmploymentStatus(u),isOff=['離職','離店','停用'].includes(status),previousEobAccount=eobAccountOf(u),previousEobPassword=eobPasswordOf(u),previousEobEmail=eobEmailOf(u);
  let loginEnabled=(document.querySelector('#empAccountStatus')?.value||'enabled')==='enabled';
  if(isOff)loginEnabled=false;
  if(role==='創辦人'&&!isOff)loginEnabled=true;
  const next={name,role,position,employmentType:identity,birthDate,reportDate,joinDate,householdAddress,contactPhone,employmentStatus:status,active:!isOff&&loginEnabled,loginEnabled,account,crossStore:!!(u.isStocktakePersonnel||u.isEngineerPersonnel||u.isHeadOfficePersonnel),isStocktakePersonnel:!!u.isStocktakePersonnel,isEngineerPersonnel:!!u.isEngineerPersonnel,isHeadOfficePersonnel:!!u.isHeadOfficePersonnel,badgeTitle:document.querySelector('#empBadgeTitle')?.value.trim()||'',employeeCode:document.querySelector('#empCode')?.value.trim()||account,nationalId:document.querySelector('#empNationalId')?.value.trim()||'',storeCode:document.querySelector('#empStoreCode')?.value.trim()||u.storeCode||currentStoreCode(),storeName:document.querySelector('#empStoreName')?.value.trim()||u.storeName||'',householdPhone:document.querySelector('#empHouseholdPhone')?.value.trim()||'',phone:document.querySelector('#empPhone')?.value.trim()||'',contactAddress:document.querySelector('#empContactAddress')?.value.trim()||'',emergencyName:document.querySelector('#empEmergencyName')?.value.trim()||'',emergencyPhone:document.querySelector('#empEmergencyPhone')?.value.trim()||'',education:document.querySelector('#empEducation')?.value.trim()||'',payrollBank:document.querySelector('#empPayrollBank')?.value.trim()||'',email:document.querySelector('#empEmail')?.value.trim()||'',nickname:document.querySelector('#empNickname')?.value.trim()||'',eobAccount:eobAccount||String(u.eobAccount||''),eobEmail:eobEmail||String(u.eobEmail||''),eobLoginEnabled};
  if(newPassword)next.password=newPassword;
  if(eobNewPassword)next.eobPassword=eobNewPassword;
  Object.assign(u,next);
  if(beforeStatus==='在職'&&isOff)recordEmployeeStoreExit(u);
  save(K.employees,rows);localStorage.setItem('yj_employee_master_dirty','1');if(u.isStocktakePersonnel===true)await syncStocktakePersonnelRegistry();if(cloudConfigured())try{await cloudPushKey(K.employees,rows)}catch(_e){};
  let cloudMsg='';
  const hasEobAccount=!!eobAccountOf(u);
  if(cloudConfigured()&&isFounder()&&hasEobAccount){
   try{
    const callerOverride=isFounderSelf(currentUser(),u)?{callerAccount:previousEobAccount||eobAccountOf(u),callerEmail:previousEobEmail||eobEmail,callerPassword:eobCurrentPassword||previousEobPassword,previousEobAccount}: {previousEobAccount};
    // Alpha 4.54：已經取得過 EOB founder session 後，不再要求每次輸入 EOB 管理密碼。
    // 若 session 尚未建立，sync.js 會在需要時才用這裡提供的 EOB Email/帳號＋密碼做一次性授權。
    await syncEmployeeCloudAccount(u,eobNewPassword,callerOverride);
    if(u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員')await syncStocktakePersonnelCloudAccount(u,eobNewPassword,callerOverride);
    cloudMsg='\nEOB 帳號／權限已自動同步';
   }catch(err){cloudMsg='\n但 EOB 雲端同步失敗：'+String(err?.message||err);}
  }else if(!hasEobAccount){
   cloudMsg='\nEOB 尚未設定，SC 資料已獨立儲存';
  }
  saveAudit('員工基本資料',`${u.name}｜${beforeStatus}→${status}｜SC帳號 ${loginEnabled?'啟用':'停用'}${newPassword?'｜SC密碼已更新':''}`);render('employee-detail');setTimeout(()=>{alert('員工資料已儲存'+cloudMsg);if(confirm('是否列印名牌？'))printEmployeeBadge(u)},50);return;
 }
 if(b.dataset.noticeEditorMode){if(!isFounder())return alert('只有創辦人可以使用');window.__yjNoticeEditorMode=String(b.dataset.noticeEditorMode);window.__yjNoticeEditorSelected='';render('notice-editor');return}
 if(b.dataset.action==='app-coupon-add'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tbody=document.querySelector('#appCouponRows');if(!tbody)return;
  if(tbody.children.length===1&&tbody.textContent.includes('尚未建立優惠券'))tbody.innerHTML='';
  const id=`CPN-${Date.now()}`,tr=document.createElement('tr');tr.dataset.appCouponRow=id;
  tr.innerHTML=`<td><input data-cpn="code"></td><td><input data-cpn="name"></td><td><select data-cpn="type">${['折價券','折扣券','商品券','贈品券','免運券','其他'].map(v=>`<option>${v}</option>`).join('')}</select></td><td><input data-cpn="value" type="number" min="0" value="0"></td><td><input data-cpn="minSpend" type="number" min="0" value="0"></td><td><input data-cpn="startDate" type="date"></td><td><input data-cpn="endDate" type="date"></td><td><input data-cpn="imageUrl" placeholder="https://..."></td><td><input data-cpn="active" type="checkbox" checked></td><td><input data-cpn="note"></td><td><button class="button danger" data-action="app-coupon-delete" data-id="${id}">刪除</button></td>`;
  tbody.appendChild(tr);return;
 }
 if(b.dataset.action==='app-coupon-delete'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tr=b.closest('[data-app-coupon-row]');if(!tr)return;
  const name=tr.querySelector('[data-cpn="name"]')?.value||String(b.dataset.id||'');
  if(!confirm(`確定刪除優惠券「${name}」？`))return;
  tr.remove();saveAudit('App優惠券','刪除 '+name);return;
 }
 if(b.dataset.action==='app-coupon-save'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const rows=collectAppCouponRows();
  if(rows.some(x=>!x.code||!x.name))return alert('優惠券代碼與名稱必填');
  const bad=rows.find(x=>x.startDate&&x.endDate&&x.startDate>x.endDate);
  if(bad)return alert(`優惠券「${bad.name}」的結束日不能早於開始日`);
  await saveAppCoupons(rows);
  saveAudit('App優惠券',`儲存 ${rows.length} 筆`);
  alert('優惠券已儲存並同步');
  render('app-settings');return;
 }
 if(b.dataset.action==='tm-anybuy-add'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tbody=document.querySelector('#tmAnybuyRows');if(!tbody)return;
  if(tbody.children.length===1&&tbody.textContent.includes('尚未建立 TM 隨買跨店取活動'))tbody.innerHTML='';
  const id=`TMP-${Date.now()}`,tr=document.createElement('tr');tr.dataset.tmAnybuyRow=id;
  tr.innerHTML=`<td><input data-tmp="code"></td><td><input data-tmp="name"></td><td><input data-tmp="category" value="隨買"></td><td><input data-tmp="originalPrice" type="number" min="0" value="0"></td><td><input data-tmp="price" type="number" min="0" value="0"></td><td><input data-tmp="groupCount" type="number" min="1" step="1" value="1" title="例如 1 組"></td><td><input data-tmp="quantity" type="number" min="0" step="1" value="0" title="例如 3 杯"></td><td><input data-tmp="maxPurchaseGroups" type="number" min="0" step="1" value="0" title="0 表示不限購"></td><td><input data-tmp="validityDays" type="number" min="0" step="1" value="0" title="0 表示未設定固定效期"></td><td><input data-tmp="activityStartDate" type="date"></td><td><input data-tmp="activityEndDate" type="date"></td><td><textarea data-tmp="activityContent" rows="2" placeholder="例如：買2送1、任選2件折10元"></textarea></td><td>
   <div class="app-anybuy-image-cell"><div class="app-anybuy-image-preview" data-tmp-image-preview="${id}"><span>尚未上傳</span></div><input type="hidden" data-tmp="imageUrl" value=""><input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" data-tmp-image-file="${id}"><small data-tmp-image-status="${id}">請從裝置選擇圖片</small></div>
  </td><td><input data-tmp="active" type="checkbox" checked></td><td><input data-tmp="note"></td><td><button class="button danger" data-action="tm-anybuy-delete">刪除</button></td>`;
  tbody.appendChild(tr);bindTmAnybuyImageUploads();return;
 }
 if(b.dataset.action==='tm-anybuy-delete'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tr=b.closest('[data-tm-anybuy-row]');if(!tr)return;
  const name=tr.querySelector('[data-tmp="name"]')?.value||'此商品';
  if(!confirm(`確定刪除 TM 隨買活動「${name}」？`))return;
  tr.remove();return;
 }
 if(b.dataset.action==='tm-anybuy-save'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const rows=collectTmAnybuyRows();
  if(rows.some(x=>!x.code||!x.name))return alert('商品代號與商品名稱必填');
  const badDate=rows.find(x=>x.activityStartDate&&x.activityEndDate&&x.activityStartDate>x.activityEndDate);
  if(badDate)return alert(`TM 隨買商品「${badDate.name}」的活動結束日不能早於開始日`);
  await saveTmAnybuyProducts(rows);
  saveAudit('TM隨買跨店取活動',`儲存 ${rows.length} 筆`);
  alert('TM 隨買跨店取活動已儲存並同步');
  render('tm-anybuy-settings');return;
 }
 if(b.dataset.action==='tm-anybuy-cloud-refresh'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  if(!cloudConfigured())return alert('目前尚未設定雲端');
  try{await cloudPullKey(TM_ANYBUY_PRODUCTS_KEY);alert('TM 隨買跨店取活動已從雲端同步');render('tm-anybuy-settings')}catch(e){alert('同步失敗：'+(e?.message||e))}
  return;
 }
 if(b.dataset.action==='point-reward-refresh'){
  pointRewardCloudLoaded=false;await refreshPointRewardSettingsCloud({rerender:true});return;
 }
 if(b.dataset.action==='point-reward-save-enabled'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  try{await adminSetPointRewardEnabled(!!document.querySelector('#pointRewardEnabled')?.checked);pointRewardCloudLoaded=false;await refreshPointRewardSettingsCloud();saveAudit('點數兌換設定',`App 點數兌換 ${document.querySelector('#pointRewardEnabled')?.checked?'啟用':'停用'}`);alert('點數兌換啟用狀態已儲存');render('point-reward-settings')}catch(e){alert('儲存失敗：'+(e?.message||e))}return;
 }
 if(b.dataset.action==='point-reward-add'){if(!canAccessHqAppSettings())return alert('沒有 App設定權限');openPointRewardEditor(null);return;}
 if(b.dataset.action==='point-reward-edit'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');const row=pointRewardCloudRows.find(x=>String(x.id)===String(b.dataset.id));if(!row)return alert('找不到兌換設定');openPointRewardEditor(row);return;
 }
 if(b.dataset.action==='point-reward-save-modal'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const code=String(document.querySelector('#prCode')?.value||'').trim(),name=String(document.querySelector('#prName')?.value||'').trim(),points=Number(document.querySelector('#prPoints')?.value||0);
  if(!code||!name)return alert('兌換代碼與兌換名稱必填');if(!Number.isFinite(points)||points<=0)return alert('所需點數必須大於 0');
  const start=String(document.querySelector('#prStart')?.value||''),end=String(document.querySelector('#prEnd')?.value||'');if(start&&end&&start>end)return alert('活動結束日不能早於開始日');
  let payload={};try{payload=JSON.parse(String(document.querySelector('#prPayload')?.value||'{}'))}catch{return alert('payload JSON 格式錯誤')}
  const stockRaw=String(document.querySelector('#prStock')?.value||'').trim();
  try{
   await adminUpsertPointReward({id:String(document.querySelector('#prId')?.value||'')||null,rewardCode:code,name,description:String(document.querySelector('#prDesc')?.value||'').trim(),rewardType:String(document.querySelector('#prType')?.value||'other'),pointsCost:points,stockLimit:stockRaw===''?null:Math.max(0,Math.floor(Number(stockRaw)||0)),perMemberLimit:Math.max(0,Math.floor(Number(document.querySelector('#prPerMember')?.value||0))),imageUrl:String(document.querySelector('#prImage')?.value||'').trim(),payload,startsAt:start?`${start}T00:00:00+08:00`:null,endsAt:end?`${end}T23:59:59+08:00`:null,active:!!document.querySelector('#prActive')?.checked,sortOrder:Number(document.querySelector('#prSort')?.value||0)});
   saveAudit('點數兌換設定',`${document.querySelector('#prId')?.value?'修改':'新增'}｜${code}｜${name}｜${points}點`);genericDialog.close();pointRewardCloudLoaded=false;await refreshPointRewardSettingsCloud();alert('點數兌換設定已儲存');render('point-reward-settings');
  }catch(e){alert('儲存失敗：'+(e?.message||e))}return;
 }
 if(b.dataset.action==='point-reward-delete'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');const row=pointRewardCloudRows.find(x=>String(x.id)===String(b.dataset.id));if(!row)return alert('找不到兌換設定');if(!confirm(`確定刪除「${row.name||row.reward_code}」？\n既有會員兌換歷史會保留。`))return;
  try{await adminDeletePointReward(String(row.id));saveAudit('點數兌換設定',`刪除｜${row.reward_code||''}｜${row.name||''}`);pointRewardCloudLoaded=false;await refreshPointRewardSettingsCloud();alert('已刪除');render('point-reward-settings')}catch(e){alert('刪除失敗：'+(e?.message||e))}return;
 }
 if(b.dataset.action==='app-feature-add'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tbody=document.querySelector('#appFeatureRows');if(!tbody)return;
  const tr=document.createElement('tr');tr.dataset.appFeatureRow='';
  tr.innerHTML=`<td><input data-app-feature="code" placeholder="例如 memberTasks"></td><td><input data-app-feature="name" placeholder="功能名稱"></td><td style="text-align:center"><input data-app-feature="hidden" type="checkbox" checked></td><td><input data-app-feature="sortOrder" type="number" step="10" value="${(tbody.children.length+1)*10}" style="width:90px"></td><td><input data-app-feature="note" value="預做功能"></td><td><button class="button danger" data-action="app-feature-delete">刪除</button></td>`;
  tbody.appendChild(tr);return;
 }
 if(b.dataset.action==='app-feature-delete'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const tr=b.closest('[data-app-feature-row]');if(!tr)return;
  const name=tr.querySelector('[data-app-feature="name"]')?.value||'此功能';
  if(!confirm(`確定刪除「${name}」的 App 功能控制設定？`))return;
  tr.remove();return;
 }
 if(b.dataset.action==='app-anybuy-add'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');const tbody=document.querySelector('#appAnybuyRows');if(!tbody)return;if(tbody.children.length===1&&tbody.textContent.includes('尚未建立隨買商品'))tbody.innerHTML='';const id=`ABP-${Date.now()}`,tr=document.createElement('tr');tr.dataset.appAnybuyRow=id;tr.innerHTML=`<td><input data-abp="code"></td><td><input data-abp="name"></td><td><input data-abp="category" value="隨買"></td><td><input data-abp="originalPrice" type="number" min="0" value="0"></td><td><input data-abp="price" type="number" min="0" value="0"></td><td><input data-abp="groupCount" type="number" min="1" step="1" value="1" title="例如 1 組"></td><td><input data-abp="quantity" type="number" min="0" step="1" value="0" title="例如 3 杯"></td><td><input data-abp="maxPurchaseGroups" type="number" min="0" step="1" value="0" title="0 表示不限購"></td><td><input data-abp="validityDays" type="number" min="0" step="1" value="0" title="0 表示未設定固定效期"></td><td><input data-abp="activityStartDate" type="date"></td><td><input data-abp="activityEndDate" type="date"></td><td><textarea data-abp="activityContent" rows="2" placeholder="例如：買2送1、任選2件折10元"></textarea></td><td>
 <div class="app-anybuy-image-cell">
  <div class="app-anybuy-image-preview" data-abp-image-preview="${id}"><span>尚未上傳</span></div>
  <input type="hidden" data-abp="imageUrl" value="">
  <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" data-abp-image-file="${id}">
  <small data-abp-image-status="${id}">請從裝置選擇圖片</small>
 </div>
</td><td><input data-abp="active" type="checkbox" checked></td><td><input data-abp="note"></td><td><button class="button danger" data-action="app-anybuy-delete">刪除</button></td>`;tbody.appendChild(tr);bindAppAnybuyImageUploads();return
 }
 if(b.dataset.action==='app-anybuy-delete'){if(!canAccessHqAppSettings())return alert('沒有 App設定權限');const tr=b.closest('[data-app-anybuy-row]');if(!tr)return;const name=tr.querySelector('[data-abp="name"]')?.value||'此商品';if(!confirm(`確定刪除「${name}」？`))return;tr.remove();return}
 if(b.dataset.action==='app-anybuy-save'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const rows=collectAppAnybuyRows();
  if(rows.some(x=>!x.code||!x.name))return alert('商品代號與商品名稱必填');
  const badDate=rows.find(x=>x.activityStartDate&&x.activityEndDate&&x.activityStartDate>x.activityEndDate);
  if(badDate)return alert(`隨買商品「${badDate.name}」的活動結束日不能早於開始日`);
  await saveAppAnybuyProducts(rows);
  saveAudit('App隨買商品',`儲存 ${rows.length} 筆`);
  alert('隨買商品已儲存並同步');
  render('app-settings');return
 }
 if(b.dataset.action==='yijiapay-sc-refresh'){if(!canAccessHqAppSettings())return alert('沒有 App設定權限');yijiaPayScLoaded=false;await refreshYijiaPayScCloud({rerender:true});return}
 if(b.dataset.action==='yijiapay-sc-save'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');const limit=Number(document.querySelector('#yjPayMonthlyLimit')?.value||0);if(!Number.isFinite(limit)||limit<0)return alert('每月現金儲值上限需為 0 以上');
  try{await scUpdateYijiaPaySettings(!!document.querySelector('#yjPayEnabled')?.checked,!!document.querySelector('#yjPayCashReloadEnabled')?.checked,limit);saveAudit('億家Pay設定',`啟用:${!!document.querySelector('#yjPayEnabled')?.checked}｜現金儲值:${!!document.querySelector('#yjPayCashReloadEnabled')?.checked}｜月限額:${limit}`);yijiaPayScLoaded=false;await refreshYijiaPayScCloud({rerender:true});alert('億家Pay設定已儲存')}catch(e){alert('億家Pay設定儲存失敗：'+(e?.message||e))}return;
 }
 if(b.dataset.action==='save-hq-app-settings'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  const val=id=>String(document.querySelector(id)?.value||'').trim();
  const cashLimitRaw=Number(document.querySelector('#appBackendYijiaPayCashLimit')?.value||0);
  if(!Number.isFinite(cashLimitRaw)||cashLimitRaw<0)return alert('億家Pay 當月現金儲值額度請輸入 0 以上的金額');
  const featureRows=[...document.querySelectorAll('[data-app-feature-row]')];
  const featureCodes=featureRows.map(tr=>String(tr.querySelector('[data-app-feature="code"]')?.value||'').trim()).filter(Boolean);
  const duplicateCode=featureCodes.find((code,i)=>featureCodes.indexOf(code)!==i);
  if(duplicateCode)return alert(`App 功能代碼不可重複：${duplicateCode}`);
  if(featureRows.some(tr=>!String(tr.querySelector('[data-app-feature="code"]')?.value||'').trim()||!String(tr.querySelector('[data-app-feature="name"]')?.value||'').trim()))return alert('App 功能管理的「功能代碼」與「功能名稱」都必填');
  const next={
   tmPanel:{enabled:!!document.querySelector('#appTmEnabled')?.checked,title:val('#appTmTitle')||'TM 面板',welcome:val('#appTmWelcome'),showMember:!!document.querySelector('#appTmMember')?.checked,showNotices:!!document.querySelector('#appTmNotices')?.checked},
   selfPanel:{enabled:!!document.querySelector('#appSelfEnabled')?.checked,title:val('#appSelfTitle')||'自助結帳',welcome:val('#appSelfWelcome'),crossStoreRedeem:!!document.querySelector('#appSelfCrossStore')?.checked,ecSend:!!document.querySelector('#appSelfEcSend')?.checked,ecPickup:!!document.querySelector('#appSelfEcPickup')?.checked},
   appBackend:{
    enabled:!!document.querySelector('#appBackendEnabled')?.checked,
    maintenance:!!document.querySelector('#appBackendMaintenance')?.checked,
    announcement:val('#appBackendAnnouncement'),
    pointsSync:!!document.querySelector('#appBackendPoints')?.checked,
    crossStoreRedeem:!!document.querySelector('#appBackendRedeem')?.checked,
    yijiaPayMonthlyCashTopupLimit:cashLimitRaw,
    featureManagement:(()=>{
     const rows=[...document.querySelectorAll('[data-app-feature-row]')];
     const list=rows.map((tr,i)=>({
      code:String(tr.querySelector('[data-app-feature="code"]')?.value||'').trim(),
      name:String(tr.querySelector('[data-app-feature="name"]')?.value||'').trim(),
      hidden:!!tr.querySelector('[data-app-feature="hidden"]')?.checked,
      sortOrder:Number(tr.querySelector('[data-app-feature="sortOrder"]')?.value||((i+1)*10)),
      note:String(tr.querySelector('[data-app-feature="note"]')?.value||'').trim()
     })).filter(x=>x.code);
     const dup=list.find((x,i)=>list.some((y,j)=>j<i&&y.code===x.code));
     if(dup)throw new Error(`App 功能代碼重複：${dup.code}`);
     return list.sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'zh-Hant'));
    })(),
    prebuiltHidden:(()=>{
     const out={};
     [...document.querySelectorAll('[data-app-feature-row]')].forEach(tr=>{const code=String(tr.querySelector('[data-app-feature="code"]')?.value||'').trim();if(code)out[code]=!!tr.querySelector('[data-app-feature="hidden"]')?.checked});
     return out;
    })()
   }
  };
  await saveHqAppSettings(next);
  alert('App設定已儲存並同步');
  render('app-settings');return;
 }
 if(b.dataset.action==='app-settings-cloud-refresh'){
  if(!canAccessHqAppSettings())return alert('沒有 App設定權限');
  if(!cloudConfigured())return alert('目前尚未設定雲端');
  try{await cloudPullKey(HQ_APP_SETTINGS_KEY);alert('App設定已從雲端同步');render('app-settings')}catch(e){alert('同步失敗：'+(e?.message||e))}
  return;
 }
 if(b.dataset.action==='notice-product-add'){
  if(!isFounder())return alert('只有創辦人可以使用');
  const tbody=document.querySelector('#noticeEditorProductRows');if(!tbody)return;
  const temp=document.createElement('tbody');temp.innerHTML=noticeEditorProductRowsHtml([{code:'',name:'',price:'',returnPeriod:'',note:'',imageUrl:''}]);
  const tr=temp.firstElementChild;if(tr)tbody.appendChild(tr);return;
 }
 if(b.dataset.action==='notice-product-remove'){
  if(!isFounder())return alert('只有創辦人可以使用');
  b.closest('[data-notice-product-row]')?.remove();return;
 }
 if(b.dataset.action==='notice-editor-save'){
  if(!isFounder())return alert('只有創辦人可以使用');
  const mode=String(window.__yjNoticeEditorMode||'new'),rows=load(K.notices,[]);
  const val=id=>String(document.querySelector(id)?.value||'').trim();
  const date=val('#noticeEditorDate')||localDateKey(),priority=val('#noticeEditorPriority')||'normal',subject=val('#noticeEditorSubject'),body=val('#noticeEditorBody');
  const payload={noticeNo:val('#noticeEditorNo'),date,expireDate:val('#noticeEditorExpireDate'),category:val('#noticeEditorCategory')||'一般通報',department:val('#noticeEditorDepartment'),archiveName:val('#noticeEditorArchiveName')||'一般通報',priority,responsibleMd:val('#noticeEditorMd'),subject,greeting:val('#noticeEditorGreeting')||'各位店長好：',highlight:val('#noticeEditorHighlight'),body,products:collectNoticeEditorProducts()};
  if(!subject)return alert('請輸入通報主旨');
  if(mode==='new'){
   const x={id:`NT-${Date.now()}`,...payload,readBy:[],createdAt:new Date().toISOString(),createdBy:currentUser()?.name||''};rows.unshift(x);save(K.notices,rows);window.__yjNoticeEditorSelected=x.id;saveAudit('新增通報',`${rocDate(date)}｜${subject}`);
  }else{
   const x=rows.find(v=>String(v.id)===String(window.__yjNoticeEditorSelected||''));if(!x)return alert('找不到通報');Object.assign(x,payload,{readBy:[],updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''});save(K.notices,rows);saveAudit('修改通報',`${rocDate(date)}｜${subject}`);
  }
  if(cloudConfigured())cloudPushKey(K.notices,rows).catch(e=>console.warn('通報雲端同步失敗',e));
  updateTopNoticeSummary();alert(mode==='new'?'通報已新增':'通報已修改');render('notice-editor');return;
 }
 if(b.dataset.action==='notice-editor-delete'){
  if(!isFounder())return alert('只有創辦人可以使用');const id=String(window.__yjNoticeEditorSelected||''),rows=load(K.notices,[]),x=rows.find(v=>String(v.id)===id);if(!x)return alert('找不到通報');if(!confirm(`確定刪除通報「${x.subject}」？`))return;save(K.notices,rows.filter(v=>String(v.id)!==id));saveAudit('刪除通報',x.subject||id);window.__yjNoticeEditorSelected='';updateTopNoticeSummary();render('notice-editor');return;
 }
 if(b.dataset.employeeSettings){
  const u=load(K.employees,[]).find(x=>String(x.id)===String(b.dataset.employeeSettings));
  if(!u)return alert('找不到員工資料');
  if(!(isFounderSelf(currentUser(),u)||canEditEmployeeTarget(currentUser(),u)))return alert('不能修改此員工');
  window.__yjEmployeePageSelected=u.id;render('employee-detail');return;
 }
 if(b.dataset.permissionPerson){openPermissionCategories(b.dataset.permissionPerson);return}
 if(b.dataset.permissionCategory){openPermissionDetail(b.dataset.permissionTarget,b.dataset.permissionCategory);return}

 if(b.dataset.action==='back')requestMode('back');if(b.dataset.action==='front')requestMode('front');if(b.dataset.action==='logout'){logout();showLogin('back')}if(b.dataset.action==='close-dialog')genericDialog.close();
 if(b.dataset.pay){state.payment=b.dataset.pay;document.querySelectorAll('.payment').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}
 if(b.dataset.action==='clear'){if(state.cart.length&&!confirm('確定取消本筆交易？'))return;state.cart=[];state.discount=0;state.note='';state.selected='';drawPOS()}
 if(b.id==='scanProductBarcode'){scanCode({title:'掃描商品條碼',onResult:code=>{const el=document.querySelector('#pb');if(el)el.value=code}})}
 if(b.dataset.action==='scan-transfer-no'){scanCode({title:'掃描轉貨單',onResult:code=>{const el=document.querySelector('#transferNo');if(el)el.value=code}})}
 if(b.dataset.action==='scan'){scanCode({title:'掃描商品條碼',onResult:code=>{if(handleReturnCode(code))return;const p=products().find(x=>productBarcodes(x).includes(code));p?add(p.id,'barcode'):alert('找不到商品或退貨條碼');drawPOS()}})}
 if(b.dataset.action==='discount'){const v=Number(prompt('折扣金額',state.discount));if(!Number.isNaN(v))state.discount=Math.max(0,v);drawPOS()}
 if(b.dataset.action==='manual-price'){const c=state.cart.find(x=>x.id===state.selected);if(!c)return alert('請先點選購物車商品');const v=Number(prompt('輸入新單價',c.price));if(!Number.isNaN(v)&&v>=0){c.price=v;drawPOS()}}
 if(b.dataset.action==='manual-qty'){const c=state.cart.find(x=>x.id===state.selected);if(!c)return alert('請先點選購物車商品');const v=Number(prompt('輸入數量',c.qty));if(v>0){c.qty=Math.floor(v);drawPOS()}}
 if(b.dataset.action==='hold'){if(!state.cart.length)return alert('購物車是空的');const rows=load(K.held,[]);const name=prompt('暫停交易名稱／備註（可留白）','')||'';const id=uid();rows.unshift({id,name,items:structuredClone(state.cart),discount:state.discount,payment:state.payment,note:state.note||'',at:new Date().toISOString()});save(K.held,rows);state.cart=[];state.discount=0;state.note='';state.selected='';drawPOS();saveAudit('掛單',id)}
 if(b.dataset.action==='restore'){openHeldTransactionsDialog();return}
 if(b.dataset.action==='checkout'){openCheckoutDialog();return}
 if(b.dataset.action==='manage-groups'){openProductGroupEditorDialog();return}
 if(b.dataset.removeGroup!==undefined){return}
 if(b.dataset.action==='transmit-all-orders'){await admin219TransmitAllOrders();return}
 if(b.dataset.orderAiSet){
  const kind=b.dataset.orderAiSet,enabled=b.dataset.orderAiValue==='1';
  if(await setOrderingAiSwitch(kind,enabled)){refreshOrderingCurrentView()}
  return;
 }
 if(b.dataset.productOrderSwitch!==undefined){
  const kind=b.dataset.productOrderSwitch==='system'?'system':'store',enabled=b.dataset.productOrderValue==='1';
  if(await setProductOrderSwitch(b.dataset.productOrderId,kind,enabled)){refreshOrderingCurrentView()}
  return;
 }
 if(b.dataset.orderSystemToggle!==undefined){
  const enabled=b.dataset.orderSystemToggle==='1';
  const kind=b.dataset.orderSystemKind==='fresh'?'fresh':'auto';
  if(await setOrderingAiSwitch(kind,enabled)){refreshOrderingCurrentView()}
  return;
 }
 if(b.dataset.action==='auto-order-ai'){autoOrderAI();return}
 if(b.dataset.action==='fresh-ai-order'){freshAIOrder();return}
 if(b.dataset.action==='suggestion-settings'){adminOrderingPolicyProductId='';render('ordering-suggestion-settings');return}
 if(b.dataset.action==='open-general-suggestion-settings'){adminOrderingPolicyProductId='';render('ordering-auto-settings');return}
 if(b.dataset.action==='open-fresh-suggestion-settings'){adminOrderingPolicyProductId='';render('ordering-fresh-settings');return}
 if(b.dataset.cancelReservation!==undefined){const rows=orderReservationRows(),row=rows.find(x=>String(x.id)===String(b.dataset.cancelReservation));if(!row)return;row.status='取消';row.qty=0;row.updatedAt=new Date().toISOString();row.updatedBy=currentUser()?.name||'';save(ORDER_RESERVATIONS_KEY,rows);if(cloudConfigured())try{await cloudPushKey(ORDER_RESERVATIONS_KEY,rows)}catch{}saveAudit('取消預訂',`${row.code||''}｜${row.name||''}`);render('ordering-reservations');return}
 if(b.dataset.action==='auto-order-settings'){if(!requirePermission('orderAutoAI'))return;adminOrderingPolicyProductId=String(b.dataset.orderPolicyProduct||'');render('ordering-auto-settings');return}
 if(b.dataset.action==='fresh-ai-settings'){if(!requirePermission('freshAIOrder'))return;adminOrderingPolicyProductId=String(b.dataset.orderPolicyProduct||'');render('ordering-fresh-settings');return}
 if(b.dataset.action==='back-ordering'){adminOrderingPolicyProductId='';render('ordering');return}
 if(b.dataset.action==='save-auto-order-settings'){
  const q=id=>document.querySelector('#'+id);const data={recommendPercent:clampNum(q('oaRecommend')?.value,0,300,100),triggerSafePercent:clampNum(q('oaTrigger')?.value,1,300,100),salesLookbackDays:Math.round(clampNum(q('oaLookback')?.value,1,60,7)),forecastDays:clampNum(q('oaForecast')?.value,0.1,60,7),safeFallbackPercent:clampNum(q('oaSafeFallback')?.value,0,500,200),safeAddPercent:clampNum(q('oaSafeAdd')?.value,0,500,100),wasteDeductPercent:clampNum(q('oaWaste')?.value,0,500,0),useMaxStock:!!q('oaUseMax')?.checked};
  if(await persistOrderingPolicy('auto',data)){alert('系訂值設定已儲存');render('ordering-auto-settings')}return;
 }
 if(b.dataset.action==='save-fresh-ai-settings'){
  const q=id=>document.querySelector('#'+id);const data={recommendPercent:clampNum(q('faRecommend')?.value,0,300,100),salesLookbackDays:Math.round(clampNum(q('faLookback')?.value,1,60,7)),forecastDays:clampNum(q('faForecast')?.value,0.1,14,2.2),safeStockPercent:clampNum(q('faSafe')?.value,0,500,50),wasteDeductPercent:clampNum(q('faWaste')?.value,0,500,120),recentTrendPercent:clampNum(q('faTrend')?.value,0,100,0)};
  if(await persistOrderingPolicy('fresh',data)){alert('鮮食 AI 設定已儲存');render('ordering-fresh-settings')}return;
 }
 if(b.dataset.action==='reset-auto-order-settings'){if(!confirm('恢復系訂值預設值？'))return;if(await persistOrderingPolicy('auto',{recommendPercent:100,triggerSafePercent:100,salesLookbackDays:7,forecastDays:7,safeFallbackPercent:200,safeAddPercent:100,wasteDeductPercent:0,useMaxStock:true}))render('ordering-auto-settings');return}
 if(b.dataset.action==='reset-fresh-ai-settings'){if(!confirm('恢復鮮食 AI 預設值？'))return;if(await persistOrderingPolicy('fresh',{recommendPercent:100,salesLookbackDays:7,forecastDays:2.2,safeStockPercent:50,wasteDeductPercent:120,recentTrendPercent:0}))render('ordering-fresh-settings');return}
 if(b.dataset.action==='product-multiple-settings'){openProductMultipleSettings();return}
 if(b.dataset.action==='sync-order-logistics'){await admin217SyncOrderLogistics();return}
 if(b.dataset.action==='new-order'){let items=[];dlg('新增訂購單',orderForm());const redraw=()=>{const el=document.querySelector('#orderItemList');if(el)el.innerHTML=items.map((x,i)=>`<div class="order-item"><span>${esc(x.name)}</span><input type="number" min="1" value="${x.qty}" data-order-qty="${i}"><button class="button danger" data-order-remove="${i}">刪除</button></div>`).join('')||'<p>尚未加入商品</p>'};setTimeout(()=>{redraw();scanOrderBarcode.onclick=()=>scanCode({title:'掃描訂購商品',onResult:code=>{orderBarcode.value=code}});addOrderItem.onclick=()=>{const p=products().find(x=>x.barcode===orderBarcode.value.trim());if(!p)return alert('找不到商品');const old=items.find(x=>x.productId===p.id);old?old.qty++:items.push({productId:p.id,name:p.name,barcode:p.barcode,group:p.group||'其他',qty:1});orderBarcode.value='';redraw()};dialogBody.onclick=e=>{const q=e.target.closest('[data-order-qty]'),r=e.target.closest('[data-order-remove]');if(q){items[Number(q.dataset.orderQty)].qty=Math.max(1,Number(q.value)||1)}if(r){items.splice(Number(r.dataset.orderRemove),1);redraw()}};saveOrder.onclick=()=>{if(!items.length)return alert('請至少加入一項商品');const rows=load(K.orders,[]),o={id:`OR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(4,'0')}`,type:orderType.value,deliveryDate:orderDate.value,items,note:orderNote.value.trim(),status:'已建立',at:new Date().toISOString(),user:currentUser().name};rows.unshift(o);save(K.orders,rows);saveAudit('建立訂購單',`${o.id}｜${o.type}`);genericDialog.close();render('ordering')}} ,0)}
 if(b.dataset.viewOrder){const o=load(K.orders,[]).find(x=>x.id===b.dataset.viewOrder);dlg('訂購單 '+o.id,`<p>類型：${esc(o.type)}</p><p>預定到貨：${esc(o.deliveryDate||'')}</p><table class="table"><tr><th>商品</th><th>品群</th><th>數量</th></tr>${o.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.group||'其他')}</td><td>${x.qty}</td></tr>`).join('')}</table><p>備註：${esc(o.note||'')}</p><button class="button" id="printOrder">列印</button>`);setTimeout(()=>printOrder.onclick=()=>printHTML('訂購單 '+o.id,document.querySelector('#dialogBody').innerHTML),0)}
 if(b.dataset.deleteOrder){const rows=load(K.orders,[]),o=rows.find(x=>x.id===b.dataset.deleteOrder);if(confirm(`刪除訂購單 ${o.id}？`)){save(K.orders,rows.filter(x=>x.id!==o.id));saveAudit('刪除訂購單',o.id);render('ordering')}}
 if(b.dataset.action==='new-product'){dlg('新增商品',productForm());setTimeout(()=>{bindProductFreshFields();document.querySelector('#saveProduct').onclick=()=>{const rows=load(K.products,[]),item={id:uid(),...readProductForm()};const error=validateProductItem(item,rows);if(error)return alert(error);rows.unshift(item);save(K.products,rows);saveAudit('新增商品',`${item.code}｜${item.name}`);genericDialog.close();render('products')}},0)}
 if(b.dataset.editProduct){const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.editProduct);dlg('修改商品',productForm(p));setTimeout(()=>{bindProductFreshFields();document.querySelector('#saveProduct').onclick=()=>{const next=readProductForm(),error=validateProductItem(next,rows,p.id);if(error)return alert(error);const before=`${p.code||''}｜${p.name}`;Object.assign(p,next);save(K.products,rows);saveAudit('修改商品',`${before}→${p.code}｜${p.name}`);genericDialog.close();render('products')}},0)}
 if(b.dataset.deleteProduct){const rows=load(K.products,[]),p=rows.find(x=>x.id===b.dataset.deleteProduct);if(confirm(`確定刪除「${p.name}」？`)){save(K.products,rows.filter(x=>x.id!==p.id));saveAudit('刪除商品',p.name);render('products')}}
 if(b.dataset.action==='new-quality'){if(!requirePermission('timeCreate'))return;dlg('新增時控商品',`<label>商品<select id="qp">${products().map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>日期<input id="qd" type="date"></label><label>折扣價<input id="qpr" type="number"></label><label>數量<input id="qq" type="number" value="1"></label><button class="primary" id="qs">建立</button>`);setTimeout(()=>qs.onclick=()=>{const p=products().find(x=>x.id===qp.value),rows=load(K.quality,[]);rows.unshift({id:uid(),productId:p.id,name:p.name,date:qd.value,price:Number(qpr.value),qty:Number(qq.value),status:'有效',createdBy:currentUser().name,createdAt:new Date().toISOString()});save(K.quality,rows);saveAudit('新增時控商品',p.name);genericDialog.close();render('time-control')},0)}
 if(b.dataset.editQuality){const rows=load(K.quality,[]),x=rows.find(v=>v.id===b.dataset.editQuality);dlg('修改時控商品',`<label>日期<input id="eqd" type="date" value="${x.date}"></label><label>折扣價<input id="eqp" type="number" value="${x.price}"></label><label>數量<input id="eqq" type="number" value="${x.qty}"></label><label>狀態<select id="eqs"><option ${x.status==='有效'?'selected':''}>有效</option><option ${x.status==='停售'?'selected':''}>停售</option></select></label><button class="primary" id="eqsave">儲存</button>`);setTimeout(()=>eqsave.onclick=()=>{Object.assign(x,{date:eqd.value,price:Number(eqp.value),qty:Number(eqq.value),status:eqs.value});save(K.quality,rows);saveAudit('修改時控商品',x.name);genericDialog.close();render('time-control')},0)}
 if(b.dataset.deleteQuality){const rows=load(K.quality,[]),x=rows.find(v=>v.id===b.dataset.deleteQuality);if(confirm(`刪除時控商品「${x.name}」？`)){save(K.quality,rows.filter(v=>v.id!==x.id));saveAudit('刪除時控商品',x.name);render('time-control')}}
 if(b.dataset.printQuality){const x=load(K.quality,[]).find(v=>v.id===b.dataset.printQuality);printHTML('時控商品貼紙',`<h1>${esc(x.name)}</h1><p>折扣價：${money(x.price)}</p><p>日期：${esc(x.date)}</p><p>數量：${x.qty}</p>`)}
 if(b.dataset.action==='new-waste'){if(document.body.dataset.mode==='back'&&!requirePermission('qualityWasteCreate'))return;dlg('廢棄登錄',`<label>商品<select id="wp">${products().map(x=>`<option value="${x.id}">${esc(x.code||'—')}｜${esc(x.name)}｜庫存 ${Number(x.stock||0)}</option>`).join('')}</select></label><label>數量<input id="wq" type="number" min="1" value="1"></label><label>原因<select id="wr"><option>過期</option><option>破損</option><option>品質異常</option><option>其他</option></select></label><button class="primary" id="ws">確認廢棄</button>`);setTimeout(()=>ws.onclick=()=>{const ps=load(K.products,[]),p=ps.find(x=>x.id===wp.value),q=Math.max(1,Number(wq.value||1));if(!p)return alert('找不到商品');if(q>Number(p.stock||0)&&!p.allowNegativeStock)return alert(`廢棄數量不可大於目前庫存 ${Number(p.stock||0)}`);const before=Number(p.stock||0);p.stock=Math.max(0,before-q);save(K.products,ps);const rows=load(K.waste,[]);rows.unshift({id:uid(),storeCode:currentStoreCode(),productId:p.id,productCode:p.code||'',barcode:p.barcode||'',name:p.name,qty:q,reason:wr.value,user:currentUser().name,at:new Date().toISOString(),stockBefore:before,stockAfter:p.stock});save(K.waste,rows);saveAudit('廢棄登錄',`${p.name}×${q}｜庫存 ${before}→${p.stock}`);genericDialog.close();render(document.body.dataset.mode==='front'?'front':'quality')},0)}

 if(b.dataset.action==='refresh-order-suggestions'){
  if(!(hasPermission('orderAutoAI')||hasPermission('freshAIOrder')))return alert('需要系統自動訂購或鮮食 AI 輔助訂購權限');
  try{await cloudPullAll()}catch(e){console.warn('訂購建議重新整理：雲端同步失敗，改用目前本機資料',e)}
  saveAudit('重新整理訂購建議','重讀最新庫存／銷售／廢棄資料；未建立訂單');
  alert('訂購建議資料已重新整理\n不會自動建立或傳輸訂單');render('ordering');return;
 }
 if(b.dataset.action==='waste-query'){
  const rows=load(K.waste,[]);
  dlg('廢棄查詢／修改',`<div class="table-wrap"><table class="table"><tr><th>商品</th><th>數量</th><th>原因</th><th>操作人</th><th>時間</th><th>操作</th></tr>${rows.map(x=>`<tr><td>${esc(x.productCode||'')} ${esc(x.name||'')}</td><td>${Number(x.qty||0)}</td><td>${esc(x.reason||'')}</td><td>${esc(x.user||'')}</td><td>${x.at?new Date(x.at).toLocaleString('zh-TW'):'—'}</td><td><button class="button" data-waste-edit="${x.id}">修改</button></td></tr>`).join('')||'<tr><td colspan="6">尚無廢棄紀錄</td></tr>'}</table></div>`);return;
 }
 if(b.dataset.wasteEdit){
  if(!requirePermission('wasteQuery'))return;
  const rows=load(K.waste,[]),x=rows.find(v=>v.id===b.dataset.wasteEdit);if(!x)return alert('找不到廢棄紀錄');
  if(genericDialog.open)genericDialog.close();
  const ps=load(K.products,[]),oldProduct=ps.find(p=>p.id===x.productId)||ps.find(p=>p.name===x.name);
  dlg('修改廢棄紀錄',`<label>商品<select id="weProduct">${ps.map(p=>`<option value="${p.id}" ${(oldProduct?.id===p.id)?'selected':''}>${esc(p.code||'—')}｜${esc(p.name)}｜庫存 ${Number(p.stock||0)}</option>`).join('')}</select></label><label>廢棄數量<input id="weQty" type="number" min="1" value="${Number(x.qty||1)}"></label><label>原因<select id="weReason">${['過期','破損','品質異常','鮮食批次廢棄','其他'].map(r=>`<option ${x.reason===r?'selected':''}>${r}</option>`).join('')}</select></label><label>修改原因<input id="weModifyReason" placeholder="例如：POS 多 key／數量輸入錯誤"></label><button class="primary" id="weSave">儲存修改</button>`);
  setTimeout(()=>document.querySelector('#weSave').onclick=()=>{
   const newProduct=ps.find(p=>p.id===document.querySelector('#weProduct').value),newQty=Math.max(1,Number(document.querySelector('#weQty').value||1)),why=document.querySelector('#weModifyReason').value.trim();if(!newProduct||!why)return alert('商品與修改原因必填');
   const oldQty=Math.max(0,Number(x.qty||0));
   if(oldProduct)oldProduct.stock=Number(oldProduct.stock||0)+oldQty;
   if(newQty>Number(newProduct.stock||0)&&!newProduct.allowNegativeStock){if(oldProduct)oldProduct.stock=Math.max(0,Number(oldProduct.stock||0)-oldQty);return alert(`修改後廢棄數量不可大於可用庫存 ${Number(newProduct.stock||0)}`)}
   newProduct.stock=Math.max(0,Number(newProduct.stock||0)-newQty);save(K.products,ps);
   const before=`${x.name}×${oldQty}`;Object.assign(x,{productId:newProduct.id,productCode:newProduct.code||'',barcode:newProduct.barcode||'',name:newProduct.name,qty:newQty,reason:document.querySelector('#weReason').value,modifiedBy:currentUser().name,modifiedAt:new Date().toISOString(),modifyReason:why});save(K.waste,rows);
   saveAudit('修改廢棄紀錄',`${before}→${newProduct.name}×${newQty}｜${why}｜庫存同步`);genericDialog.close();render('quality');
  },0);return;
 }
 if(false&&b.dataset.attendanceDelete){
  if(!requirePermission('attendanceDelete')||!requireCrossStoreManage())return;
  const rows=load(K.attendance,[]),x=rows.find(v=>v.id===b.dataset.attendanceDelete&&recordStoreCode(v)===currentStoreCode());if(!x)return alert('找不到此門市的出勤紀錄');
  if(!confirm(`確定刪除 ${x.user} 的${x.kind}紀錄？\n${new Date(x.at).toLocaleString('zh-TW')}\n刪除後無法復原。`))return;
  save(K.attendance,rows.filter(v=>v.id!==x.id));saveAudit('刪除出勤紀錄',`${x.user}｜${x.kind}｜${new Date(x.at).toLocaleString('zh-TW')}`);render('attendance');return;
 }

 if(b.dataset.action==='employee-history-blacklist-query'){openEmployeeHistoryBlacklistQuery();return}
 if(b.dataset.employeeView){
  document.querySelectorAll('[data-employee-view]').forEach(x=>x.classList.toggle('selected',x.dataset.employeeView===b.dataset.employeeView));
  document.querySelectorAll('[data-employee-detail]').forEach(x=>x.classList.toggle('show',x.dataset.employeeDetail===b.dataset.employeeView));
  return;
 }
 if(b.dataset.action==='stocktake-personnel-permissions'){
  if(!isFounder())return alert('盤點人員權限只有創辦人可以設定');
  const id=String(b.dataset.personId||'');window.__yjStocktakePermissionFocus=id;
  const page=scPrebuildChildren('店務管理').find(x=>x[1]==='盤點人員權限設定')?.[0];
  if(!page)return alert('找不到盤點人員權限設定入口');
  render(page);return;
 }
 if(b.dataset.action==='new-stocktake-personnel'){
  if(!isHeadOffice())return alert('盤點人員基本資料只有總店可以建立');
  dlg('新增盤點人員基本資料',`<div class="settings-grid"><label>* 姓名<input id="spName"></label><label>* SC 登入帳號<input id="spAccount" autocapitalize="none"></label><label>* SC 初始密碼<input id="spPassword" type="password" placeholder="至少4碼"></label><label>EOB 登入帳號<input id="spEobAccount" autocapitalize="none" placeholder="可與 SC 相同"></label><label>EOB 初始密碼<input id="spEobPassword" type="password" placeholder="可與 SC 相同"></label><label>EOB Email<input id="spEmail" type="email"></label><label>* 角色<select id="spRole">${stocktakeRoleOptions('盤點人員')}</select></label><label>* 職位<select id="spPosition">${stocktakePositionOptions('盤點人員')}</select></label><label>通訊電話<input id="spPhone"></label></div><div class="notice">SC 與 EOB 帳密互相獨立；如果 EOB 欄位留空，建立時先沿用 SC 帳密，之後仍可各自修改。盤點權限請建立後由總店創辦人開啟。</div><button class="primary" id="spSave">儲存</button>`);
  setTimeout(()=>{spSave.onclick=()=>{const name=spName.value.trim(),account=spAccount.value.trim().toLowerCase(),password=spPassword.value,eobAccount=(spEobAccount.value.trim().toLowerCase()||account),eobPassword=(spEobPassword.value||password),eobEmail=spEmail.value.trim().toLowerCase();if(!name||!account||!password)return alert('姓名、SC 登入帳號、SC 初始密碼為必填');if(password.length<4)return alert('SC 初始密碼至少4碼');if(eobPassword&&eobPassword.length<4)return alert('EOB 初始密碼至少4碼');const rows=load(K.employees,[]);if(rows.some(x=>String(x.account||'').toLowerCase()===account))return alert('SC 帳號已被使用');const u={id:uid(),name,account,password,role:spRole.value||'盤點人員',position:spPosition.value||'盤點人員',employmentType:'盤點人員',employmentStatus:'在職',active:true,loginEnabled:true,isStocktakePersonnel:true,storeCode:'001',storeName:'總店',contactPhone:spPhone.value.trim(),eobAccount,eobPassword,eobEmail,eobLoginEnabled:true,reportDate:new Date().toISOString().slice(0,10),joinDate:new Date().toISOString().slice(0,10)};rows.push(u);save(K.employees,rows);const all=load(K.permissions,{});all[u.id]={eobStocktake:false,eobStocktakePersonnel:false,stocktakeUploadHeadOffice:false};save(K.permissions,all);syncStocktakePersonnelRegistry();syncStocktakePersonnelCloudAccount(u,eobPassword).catch(err=>console.warn('新盤點人員 EOB 帳號建立失敗',err));saveAudit('新增盤點人員',`${u.name}｜${u.account}｜可跨店登入`);genericDialog.close();render('stocktake-personnel');alert('盤點人員基本資料已建立；EOB 帳號將同步建立，目前尚未開啟盤點權限。')};},0);return;
 }
 if(b.dataset.action==='new-employee'){
  if(!requirePermission('employeeCreate')||!requireCrossStoreManage())return;
  dlg('新增員工',`<div class="settings-grid"><label>* 姓名<input id="en"></label><label>* 登入帳號<input id="ea" autocapitalize="none"></label><label>* 初始密碼<input id="epw" type="password" placeholder="至少4碼"></label><label>* 角色<select id="er">${employeeRoleOptions()}</select></label><label>* 職位<select id="ePosition">${employeePositionOptions('店員')}</select></label><label>* 身份<select id="eIdentity">${employeeIdentityOptions('正職')}</select></label><label>* 出生日期<input id="eBirth" type="date"></label><label>* 報到日<input id="eReport" type="date"></label><label>* 入社日<input id="eJoin" type="date"></label><label>* 通訊電話<input id="eContactPhone"></label></div><label>* 戶籍地址<input id="eHousehold"></label><label>行動電話<input id="ep"></label><label>Email<input id="ee" type="email"></label><label>* 狀態<select id="eStatus">${employeeStatusOptions('在職')}</select></label><label>帳號狀態<select id="eAccountStatus"><option value="enabled" selected>啟用</option><option value="disabled">停用</option></select></label><div class="notice">EOB 驗收／訂購／非 EC 退貨／EOB 盤點／行動 POS 請在建立員工後到「權限設定」設定。盤點人員專用權限僅總店可設定。</div><button class="primary" id="es">儲存</button>`);
  setTimeout(()=>es.onclick=async()=>{
   const rows=load(K.employees,[]),status=eStatus.value,role=er.value,isOff=['離職','離店','停用'].includes(status),account=ea.value.trim().toLowerCase(),pw=epw.value;
   const accountEnabled=!isOff&&(document.querySelector('#eAccountStatus')?.value||'enabled')==='enabled';
   const u={id:uid(),storeCode:currentStoreCode(),storeName:store().name,name:en.value.trim(),account,password:pw,phone:ep.value.trim(),email:ee.value.trim(),role,position:ePosition.value,employmentType:eIdentity.value,birthDate:eBirth.value,reportDate:eReport.value,joinDate:eJoin.value,contactPhone:eContactPhone.value.trim(),householdAddress:eHousehold.value.trim(),employmentStatus:status,loginEnabled:accountEnabled,eobAccount:'',eobPassword:'',eobEmail:'',eobLoginEnabled:false,eobEnabled:false,eobOrder:false,eobReturn:false,mobilePosEnabled:false,active:accountEnabled};
   const missing=[];if(!u.name)missing.push('姓名');if(!account)missing.push('登入帳號');if(!pw)missing.push('初始密碼');if(!u.role)missing.push('角色');if(!u.position)missing.push('職位');if(!u.employmentType)missing.push('身份');if(!u.birthDate)missing.push('出生日期');if(!u.reportDate)missing.push('報到日');if(!u.joinDate)missing.push('入社日');if(!u.householdAddress)missing.push('戶籍地址');if(!u.contactPhone)missing.push('通訊電話');if(missing.length)return alert(`以下 * 必填欄位尚未填寫：\n${missing.join('、')}`);if(pw.length<4)return alert('初始密碼至少4碼');if(!/^[a-z0-9_][a-z0-9_.-]{1,29}$/i.test(account))return alert('登入帳號格式不正確');if(rows.some(x=>String(x.account||'').toLowerCase()===account))return alert('帳號已被使用');if(!validateEmployeeRoleChange('',u.role))return;
   if(role==='創辦人'&&!isOff){u.loginEnabled=true;u.eobEnabled=true;u.eobOrder=true;u.eobReturn=true;u.mobilePosEnabled=true;u.active=true}
   rows.push(u);save(K.employees,rows);if(u.role==='總部支援'){const perms=load(K.permissions,{});perms[u.id]={};save(K.permissions,perms)}saveAudit('新增員工',`${u.name}｜${u.role}｜${u.employmentStatus}`);genericDialog.close();render('employees');alert('員工資料已建立；SC 帳號已建立，EOB 帳號可在員工基本資料另外設定並自動同步');setTimeout(()=>{if(confirm('是否列印名牌？'))printEmployeeBadge(u)},50)
  },0);return;
 }
 if(b.dataset.employeeInlineSave){
  const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.employeeInlineSave);
  if(!u)return alert('找不到員工資料');
  const selfFounder=isFounderSelf(currentUser(),u);
  if(!selfFounder&&(!requirePermission('employeeManage')||!requireCrossStoreManage()))return;
  if(founderImmutable(u))return alert('創辦人只能由本人修改');
  if(!canEditEmployeeTarget(currentUser(),u))return alert('不能修改同級或上級帳號');
  const get=(name)=>document.querySelector(`[data-employee-inline-${name}="${u.id}"]`);
  const name=get('name')?.value.trim()||'',account=get('account')?.value.trim()||u.account||'',role=selfFounder?'創辦人':(get('role')?.value||u.role),position=get('position')?.value||u.position||u.role||'',employmentStatus=selfFounder?'在職':(get('status')?.value||employeeEmploymentStatus(u));
  const birthDate=get('birth')?.value||'',employmentType=get('identity')?.value||'',reportDate=get('report')?.value||'',householdAddress=get('household')?.value.trim()||'',joinDate=get('join')?.value||'',contactPhone=get('contactphone')?.value.trim()||'';
  const missing=[];if(!role)missing.push('角色');if(!position)missing.push('職位');if(!name)missing.push('姓名');if(!birthDate)missing.push('出生日期');if(!employmentType)missing.push('身份');if(!reportDate)missing.push('報到日');if(!householdAddress)missing.push('戶籍地址');if(!joinDate)missing.push('入社日');if(!contactPhone)missing.push('通訊電話');
  if(missing.length)return alert(`以下 * 必填欄位尚未填寫：\n${missing.join('、')}`);
  if(!account)return alert('員工編號／帳號不可空白');
  if(rows.some(x=>x.id!==u.id&&String(x.account||'')===account))return alert('帳號已被使用');
  if(!selfFounder&&!validateEmployeeRoleChange(u.role,role))return;
  const wasActive=u.active!==false,beforeStatus=employeeEmploymentStatus(u),active=employmentStatus==='在職';
  const selectedStore=get('store')?.value||u.storeCode||currentStoreCode(),storeRow=load(K.stores,[]).find(x=>String(x.code)===String(selectedStore));
  Object.assign(u,{
   name,account,role,position,employmentStatus,active,birthDate,employmentType,reportDate,householdAddress,joinDate,contactPhone,
   badgeTitle:get('badge')?.value.trim()||'',idNumber:get('idno')?.value.trim()||'',storeCode:selectedStore,storeName:get('storename')?.value.trim()||storeRow?.name||'',
   homePhone:get('homephone')?.value.trim()||'',phone:get('phone')?.value.trim()||'',correspondenceAddress:get('correspondence')?.value.trim()||'',
   emergencyContactName:get('emergency-name')?.value.trim()||'',emergencyContactPhone:get('emergency-phone')?.value.trim()||'',education:get('education')?.value.trim()||'',salaryRemit:get('salary')?.value.trim()||''
  });
  if(wasActive&&!active)recordEmployeeStoreExit(u);
  save(K.employees,rows);
  saveAudit('員工資料儲存',`${u.name}｜${u.role}｜${beforeStatus}→${employmentStatus}`);
  alert('員工資料已儲存');
  render('employees');
  return;
 }
 if(b.dataset.employeeSettings){
  const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.employeeSettings);
  if(!u)return alert('找不到員工資料');
  const selfFounder=isFounderSelf(currentUser(),u);
  if(!selfFounder&&(!requirePermission('employeeManage')||!requireCrossStoreManage()))return;
  if(founderImmutable(u))return alert('創辦人只能由本人修改');
  if(!canEditEmployeeTarget(currentUser(),u))return alert('不能修改同級或上級帳號');
  const stores=load(K.stores,[]),selectedStore=String(u.storeCode||currentStoreCode());
  const statusNow=employeeEmploymentStatus(u);
  dlg('員工設定',`
   <div class="employee-basic-settings">
    <h3>員工基本資料</h3>
    <div class="settings-grid employee-basic-grid">
     <label>* 姓名<input id="uesName" value="${esc(u.name||'')}"></label>
     <label>暱稱<input id="uesNickname" value="${esc(u.nickname||u.nickName||'')}"></label>
     <label>* 帳號<input id="uesAccount" value="${esc(u.account||'')}"></label>
     <label>手機<input id="uesPhone" value="${esc(u.phone||'')}"></label>
     <label>新密碼（不修改可留空）<input id="uesPassword" type="password" placeholder="至少1碼"></label>
     <label>確認新密碼<input id="uesConfirm" type="password"></label>
     <label>* 報到日<input id="uesReport" type="date" value="${esc(u.reportDate||'')}"></label>
     <label>* 入社日<input id="uesJoin" type="date" value="${esc(u.joinDate||'')}"></label>
     <label>* 身分<select id="uesIdentity">${employeeIdentityOptions(u.employmentType||'正職')}</select></label>
     <label>* 職位<select id="uesPosition">${employeePositionOptions(u.position||u.role||'店員')}</select></label>
     <label>* 角色>${selfFounder?`<input value="創辦人" readonly>`:`<select id="uesRole">${employeeRoleOptions(u.role)}</select>`}</label>
     <label>* 狀態>${selfFounder?`<input value="在職／啟用" readonly>`:`<select id="uesStatus">${employeeStatusOptions(statusNow)}</select>`}</label>
     <label>通訊電話<input id="uesContactPhone" value="${esc(u.contactPhone||'')}"></label>
     <label>Email<input id="uesEmail" value="${esc(u.email||'')}"></label>
     <label>生日<input id="uesBirth" type="date" value="${esc(u.birthDate||'')}"></label>
     <label>* 店舖<select id="uesStore">${stores.map(st=>`<option value="${esc(st.code)}" ${String(st.code)===selectedStore?'selected':''}>${esc(st.code)} ${esc(st.name||'')}</option>`).join('')}</select></label>
    </div>
    <button class="primary" id="uesSave">儲存員工設定</button>
   </div>`);
  setTimeout(()=>document.querySelector('#uesSave').onclick=async()=>{
   const name=uesName.value.trim(),account=uesAccount.value.trim(),pw=uesPassword.value,role=selfFounder?'創辦人':uesRole.value;
   const status=selfFounder?'在職':uesStatus.value;
   const reportDate=uesReport.value,joinDate=uesJoin.value,employmentType=uesIdentity.value,position=uesPosition.value,storeCode=uesStore.value;
   const missing=[];
   if(!name)missing.push('姓名');if(!account)missing.push('帳號');if(!reportDate)missing.push('報到日');if(!joinDate)missing.push('入社日');if(!employmentType)missing.push('身分');if(!position)missing.push('職位');if(!role)missing.push('角色');if(!storeCode)missing.push('店舖');
   if(missing.length)return alert(`以下 * 必填欄位尚未填寫：\n${missing.join('、')}`);
   if(rows.some(x=>x.id!==u.id&&x.account===account))return alert('帳號已被使用');
   if(pw!==uesConfirm.value)return alert('兩次新密碼不一致');
   if(!selfFounder&&!validateEmployeeRoleChange(u.role,role))return;
   const wasActive=u.active!==false,beforeStatus=employeeEmploymentStatus(u),storeRow=stores.find(x=>String(x.code)===String(storeCode));
   Object.assign(u,{name,nickname:uesNickname.value.trim(),account,phone:uesPhone.value.trim(),contactPhone:uesContactPhone.value.trim(),email:uesEmail.value.trim(),role,position,employmentType,reportDate,joinDate,birthDate:uesBirth.value,employmentStatus:status,active:status==='在職',storeCode,storeName:storeRow?.name||u.storeName||''});
   if(wasActive&&u.active===false)recordEmployeeStoreExit(u);
   if(pw)u.password=pw;
   save(K.employees,rows);
   localStorage.setItem('yj_employee_master_dirty','1');
   let cloudMsg='';
   // Alpha 4.49：此頁只管理 SC 員工設定，不觸發 EOB / Supabase Auth。
   // EOB 帳號與權限只在「員工基本資料 → EOB 帳號設定」或盤點權限頁同步。
   saveAudit('員工設定',`${u.name}｜${u.role}｜${beforeStatus}→${status}${pw?'｜密碼已更新':''}`);
   genericDialog.close();render('employees');alert('員工設定已儲存'+cloudMsg);
  },0);
  return;
 }
 if(b.dataset.editEmployee){const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.editEmployee);if(!u||founderImmutable(u)||!canEditEmployeeTarget(currentUser(),u))return alert('不能修改創辦人、同級或上級帳號');dlg('修改員工',`<label>姓名<input id="men" value="${esc(u.name)}"></label><label>帳號<input id="mea" value="${esc(u.account)}"></label><label>手機<input id="mep" value="${esc(u.phone||'')}"></label><label>Email<input id="mee" value="${esc(u.email||'')}"></label><label>角色<select id="mer">${employeeRoleOptions(u.role)}</select></label><button class="primary" id="mes">儲存</button>`);setTimeout(()=>mes.onclick=()=>{const oldRole=u.role,newRole=mer.value;if(!validateEmployeeRoleChange(oldRole,newRole))return;Object.assign(u,{name:men.value.trim(),account:mea.value.trim(),phone:mep.value.trim(),email:mee.value.trim(),role:newRole});save(K.employees,rows);if(newRole==='總部支援'&&oldRole!=='總部支援'){const perms=load(K.permissions,{});perms[u.id]={};save(K.permissions,perms)}saveAudit('修改員工',`${u.name}｜${oldRole}→${u.role}`);genericDialog.close();render('employees')},0)}

 if(b.dataset.employeeCredentials){
  const rows=load(K.employees,[]),u=rows.find(x=>String(x.id)===String(b.dataset.employeeCredentials));
  if(!u)return alert('找不到員工資料');
  const selfFounder=isFounderSelf(currentUser(),u);
  if(!selfFounder&&!requirePermission('employeeCredentials'))return;
  if(founderImmutable(u)||!canEditEmployeeTarget(currentUser(),u))return alert('不能修改創辦人、同級或上級帳號');
  const founder=selfFounder&&u.role==='創辦人';
  dlg('快速重設帳密',`<p class="hint">只修改 SC 登入帳號／密碼；不會變更 EOB。EOB 帳密請在員工資料的「EOB 帳號設定」修改。</p><label>登入帳號<input id="credAccount" value="${esc(u.account||'')}" autocapitalize="none"></label><label>新密碼<input id="credPassword" type="password" placeholder="不修改密碼可留空"></label><label>確認新密碼<input id="credConfirm" type="password" placeholder="再次輸入新密碼"></label><label>帳號狀態<select id="credStatus" ${founder?'disabled':''}><option value="enabled" ${u.loginEnabled!==false?'selected':''}>啟用</option><option value="disabled" ${u.loginEnabled===false?'selected':''}>停用</option></select></label>${founder?'<div class="notice">創辦人帳號固定為啟用，但可以修改帳號與密碼。</div>':''}<button class="primary" id="credSave">儲存帳密</button>`);
  setTimeout(()=>credSave.onclick=async()=>{
    const account=credAccount.value.trim().toLowerCase(),pw=credPassword.value,confirmPw=credConfirm.value;
    if(!account)return alert('登入帳號不可空白');
    if(!/^[a-z0-9_][a-z0-9_.-]{1,29}$/i.test(account))return alert('登入帳號請使用 2～30 碼英數字、_、.、-');
    if(rows.some(x=>x.id!==u.id&&String(x.account||'').toLowerCase()===account))return alert('登入帳號已被使用');
    if(pw&&pw.length<4)return alert('新密碼至少 4 碼');
    if(pw!==confirmPw)return alert('兩次新密碼不一致');
    u.account=account;
    if(pw)u.password=pw;
    u.loginEnabled=founder?true:(credStatus.value==='enabled');
    if(founder){u.active=true;u.employmentStatus='在職'}
    save(K.employees,rows);
    localStorage.setItem('yj_employee_master_dirty','1');
    if(u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員')await syncStocktakePersonnelRegistry();
    let cloudMsg='';
    if(cloudConfigured()){
      try{await cloudPushKey(K.employees,rows)}catch(_e){}
    }
    saveAudit('重設員工帳密',`${u.name||u.account}｜帳號 ${account}${pw?'｜密碼已更新':''}`);
    genericDialog.close();render(document.body.dataset.page==='employee-detail'?'employee-detail':'employees');
    alert('帳號密碼已儲存'+cloudMsg);
  },0);return;
 }
 if(b.dataset.toggleEmployee){const rows=load(K.employees,[]),u=rows.find(x=>x.id===b.dataset.toggleEmployee);if(!u||u.role==='創辦人'||founderImmutable(u)||!canEditEmployeeTarget(currentUser(),u))return alert('創辦人帳號不能停用；其他同級或上級帳號也不能修改');const wasActive=u.active!==false;u.active=u.active===false;u.loginEnabled=u.active;if(!u.active){u.eobEnabled=false;u.eobOrder=false;u.eobReturn=false;u.employmentStatus='停用'}else if(u.employmentStatus==='停用'){u.employmentStatus='在職'}if(wasActive&&u.active===false)recordEmployeeStoreExit(u);save(K.employees,rows);if(u.isStocktakePersonnel===true||String(u.role||'')==='盤點人員')syncStocktakePersonnelRegistry();saveAudit(u.active?'啟用員工':'停用員工',u.name);render('employees')}
 if(b.dataset.action==='clock-in'){attendance('簽到');render(document.body.dataset.mode==='front'?'front':'attendance')}if(b.dataset.action==='clock-out'){attendance('簽退');render(document.body.dataset.mode==='front'?'front':'attendance')}
 if(false&&b.dataset.action==='attendance-edit'){if(!requirePermission('attendanceEdit')||!requireCrossStoreManage())return;const allRows=load(K.attendance,[]),rows=scopedRows(K.attendance);dlg('工時修改',`<label>紀錄<select id="aeid">${rows.map(x=>`<option value="${x.id}">${esc(x.user)}｜${esc(x.kind)}｜${new Date(x.at).toLocaleString('zh-TW')}</option>`).join('')}</select></label><label>修改日期時間<input id="aetime" type="datetime-local"></label><label>修改原因<input id="aereason"></label><button class="primary" id="aesave">儲存</button>`);setTimeout(()=>aesave.onclick=()=>{const x=rows.find(v=>v.id===aeid.value);if(!x)return;const reason=aereason.value.trim();if(!reason||!aetime.value)return alert('時間與原因必填');const before=x.at;x.at=new Date(aetime.value).toISOString();x.modifyReason=reason;x.modifiedBy=currentUser().name;x.modifiedAt=new Date().toISOString();save(K.attendance,allRows);saveAudit('工時修改',`${x.user}｜${new Date(before).toLocaleString('zh-TW')}→${new Date(x.at).toLocaleString('zh-TW')}｜${reason}`);genericDialog.close();render('attendance')},0)}
 if(false&&b.dataset.attendanceEdit){if(!requirePermission('attendanceEdit')||!requireCrossStoreManage())return;const rows=load(K.attendance,[]),x=rows.find(v=>v.id===b.dataset.attendanceEdit&&recordStoreCode(v)===currentStoreCode());if(!x)return alert('找不到此門市的出勤紀錄');dlg('工時修改',`<p>${esc(x.user)}｜${esc(x.kind)}</p><label>修改日期時間<input id="aetime2" type="datetime-local" value="${nowInput(x.at)}"></label><label>修改原因<input id="aereason2"></label><button class="primary" id="aesave2">儲存</button>`);setTimeout(()=>aesave2.onclick=()=>{if(!aereason2.value.trim())return alert('請輸入原因');const before=x.at;x.at=new Date(aetime2.value).toISOString();x.modifyReason=aereason2.value.trim();x.modifiedBy=currentUser().name;x.modifiedAt=new Date().toISOString();save(K.attendance,rows);saveAudit('工時修改',`${x.user}｜${new Date(before).toLocaleString('zh-TW')}→${new Date(x.at).toLocaleString('zh-TW')}`);genericDialog.close();render('attendance')},0)}
 if(b.dataset.action==='attendance-print'){const rows=scopedRows(K.attendance);printHTML('出勤報表',`<table style="width:100%;border-collapse:collapse"><tr><th>員工</th><th>類型</th><th>時間</th><th>修改原因</th></tr>${rows.map(x=>`<tr><td>${esc(x.user)}</td><td>${esc(x.kind)}</td><td>${new Date(x.at).toLocaleString('zh-TW')}</td><td>${esc(x.modifyReason||'')}</td></tr>`).join('')}</table>`)}
 if(b.dataset.action==='member-cloud-refresh'){await refreshMembersCloud({rerender:false});alert('會員、累點／折抵規則、贈點活動已與前台 POS 同步');render('members');return}
 if(b.dataset.action==='new-member'){dlg('新增會員',`<label>姓名<input id="mn"></label><label>手機<input id="mp" inputmode="tel"></label><label>會員編號<input id="mc" value="M${Date.now().toString().slice(-8)}"></label><label>初始點數<input id="mpts" type="number" value="0"></label><button class="primary" id="ms">儲存</button>`);setTimeout(()=>ms.onclick=()=>{const rows=load(K.members,[]),phone=mp.value.trim(),code=mc.value.trim();if(!phone)return alert('手機號碼必填');if(rows.some(x=>String(x.phone||'')===phone))return alert('手機號碼已存在');if(rows.some(x=>String(x.code||x.memberNo||'')===code))return alert('會員編號已存在');const pts=Number(mpts.value||0),m={id:uid(),name:mn.value.trim()||'會員',phone,code,memberNo:code,points:pts,pointLedger:pts?[{id:'PT'+Date.now(),type:'初始點數',points:pts,source:'後台新增會員',at:new Date().toISOString()}]:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.unshift(m);save(K.members,rows);grantSignupBonus(m);saveAudit('新增會員',`${m.name}｜${m.code}`);genericDialog.close();render('members')},0)}
 if(b.dataset.editMember){if(!requirePermission('memberEdit'))return;const rows=load(K.members,[]),m=rows.find(x=>x.id===b.dataset.editMember);dlg('修改會員',`<label>姓名<input id="emn" value="${esc(m.name)}"></label><label>手機<input id="emp" value="${esc(m.phone)}"></label><label>會員編號<input id="emc" value="${esc(m.code)}"></label><label>點數<input id="empts" type="number" value="${m.points||0}"></label><button class="primary" id="ems">儲存</button>`);setTimeout(()=>ems.onclick=()=>{Object.assign(m,{name:emn.value.trim(),phone:emp.value.trim(),code:emc.value.trim(),memberNo:emc.value.trim(),points:Number(empts.value),updatedAt:new Date().toISOString()});save(K.members,rows);saveAudit('修改會員',m.name);genericDialog.close();render('members')},0)}
 if(b.dataset.deleteMember){if(!requirePermission('memberDelete'))return;const rows=load(K.members,[]),m=rows.find(x=>x.id===b.dataset.deleteMember);if(confirm(`刪除會員「${m.name}」？`)){save(K.members,rows.filter(x=>x.id!==m.id));saveAudit('刪除會員',m.name);render('members')}}
 if(b.dataset.action==='product-lookup'){const q=prompt('輸入商品名稱或條碼','');if(q!==null){const r=products().filter(x=>productMatches(x,q));alert(r.length?r.map(x=>`${x.code||'—'}｜${x.name}｜${productBarcodes(x).join('、')}｜${money(x.price)}｜庫存${x.stock}`).join('\n'):'找不到商品')}}
 if(b.dataset.action==='member-lookup'){const q=prompt('輸入會員手機或編號','');if(q!==null){const m=load(K.members,[]).find(x=>x.phone===q||x.code===q);alert(m?`${m.name}｜點數 ${m.points||0}`:'找不到會員')}}
 if(b.dataset.action==='time-lookup'){const r=load(K.quality,[]);alert(r.length?r.map(x=>`${x.name}｜${x.date}｜${money(x.price)}｜${x.status}`).join('\n'):'沒有時控商品')}
 if(b.dataset.action==='print-transactions'){const r=load(K.sales,[]);printHTML('交易明細',r.map(x=>`<div>${x.id}｜${new Date(x.at).toLocaleString('zh-TW')}｜${money(x.total)}｜${x.payment}</div><hr>`).join('')||'無交易')}
 if(b.dataset.txView){if(b.dataset.txFront!=='1'&&!hasPermission('transactionBackAccess'))return alert('需要「後台交易查詢」權限');openTransactionDetail(b.dataset.txView);return}
 if(b.dataset.txPrint){
  const sale=load(K.sales,[]).find(x=>x.id===b.dataset.txPrint);
  if(!sale){alert('找不到交易');return}
  try{printSaleDetail(sale)}catch(err){console.error(err);alert('交易明細列印失敗：'+err.message)}
  return
}
 if(b.dataset.txCorrect){const s=load(K.sales,[]).find(x=>x.id===b.dataset.txCorrect);if(s)openSaleInCorrectionMode(s);return}
 if(b.dataset.txReturn){confirmWholeTransaction(b.dataset.txReturn,'return',b.dataset.txFront==='1');return}
 if(b.dataset.txVoid){confirmWholeTransaction(b.dataset.txVoid,'void',b.dataset.txFront==='1');return}
 if(b.dataset.action==='deposit'){const v=Number(prompt('投庫金額'));if(v>0){const r=load(K.deposits,[]);r.unshift({id:uid(),amount:v,user:currentUser().name,at:new Date().toISOString()});save(K.deposits,r);saveAudit('投庫',money(v));alert('投庫完成')}}
 if(b.dataset.action==='handover'){const to=prompt('接班人姓名');if(to){const r=load(K.handovers,[]);r.unshift({id:uid(),from:currentUser().name,to,at:new Date().toISOString()});save(K.handovers,r);saveAudit('交班',`${currentUser().name}→${to}`);alert('交班完成')}}
 if(b.dataset.action==='logistics'){dlg('物流到店簽到',`<label>物流<select id="lt">${logisticsTypes.map(x=>`<option>${x}</option>`).join('')}</select></label><button class="primary" id="lts">確認</button>`);setTimeout(()=>lts.onclick=()=>{logistics(lt.value);genericDialog.close();alert('物流簽到完成')},0)}
 if(b.dataset.action==='receive'){try{receiveTransfer(document.querySelector('#transferNo').value);if(cloudConfigured()){cloudPushKey(K.transfers,load(K.transfers,[])).catch(()=>{});cloudPushKey(K.products,load(K.products,[])).catch(()=>{})}alert('轉入完成');render('front')}catch(err){alert(err.message)}}
 if(b.dataset.action==='attendance-clock'){dlg('員工打卡',`<p>操作人：${esc(currentUser().name)}</p><div class="clock-actions"><button class="primary" id="clockInBtn">🟢 簽到</button><button class="button" id="clockOutBtn">🔴 簽退</button></div>`);setTimeout(()=>{clockInBtn.onclick=()=>{attendance('簽到');genericDialog.close();alert('簽到完成')};clockOutBtn.onclick=()=>{attendance('簽退');genericDialog.close();alert('簽退完成')}},0)}
 if(b.dataset.action==='manual-close'){
  const target=previousDateKey();
  if(!confirm(`確定執行 ${target} 手動日結？\n只會封存前一天營收，不會產生任何報表。`))return;
  const r=autoCloseBusinessDay(target);
  saveAudit('手動日結',`${r.date}｜${money(r.total)}｜未產生報表`);
  alert(`手動日結完成\n營業日：${r.date}\n營收：${money(r.total)}\n交易：${r.count}筆\n\n尚未產生報表；需要時請到營收管理按「營收收集」。`)
 }
 if(b.dataset.action==='logistics-ref-query'){renderLogisticsReferenceTable();return}
 if(b.dataset.action==='admin-logistics-refresh'){await refreshLogisticsCloud();return}
 if(b.dataset.action==='logistics-visibility-settings'){if(!canConfigureLogisticsStoreSettings())return alert('配送書顯示時間只有總部可以設定');await openLogisticsReceiptVisibilitySettings();return}
 if(b.dataset.action==='admin-logistics-create'){if(!requirePermission('logisticsCreate'))return;if(!cloudConfigured())return alert('請先到「雲端與更新」設定 Supabase');openAdminLogisticsCreate();return}
 if(b.dataset.action==='delete-invalid-logistics-batch'){if(!requirePermission('logisticsDelete'))return;const no=b.dataset.batchNo||'';if(!no)return;if(!confirm(`確定要刪除物流批次 ${no}？\n只有待簽到且沒有任何訂購、進貨或 EC 包裹關聯的無效貨單可以刪除。`))return;try{const r=await adminDeleteInvalidLogisticsBatch(no);saveAudit('刪除無效物流批次',no);alert(`已刪除無效貨單\n${r?.batch_no||no}`);await refreshLogisticsCloud()}catch(e){alert('無法刪除：'+e.message)}return}
 if(b.dataset.action==='logistics-query'){alert('畫面已顯示今日預定與實際到店時間；前台物流簽到後會立即同步更新。')}
 if(b.dataset.action==='logistics-schedule-edit'){if(!canConfigureLogisticsStoreSettings())return alert('表定到店時間只有總部可以設定');await openLogisticsScheduleEdit();return}
 if(b.dataset.action==='new-ec-cloud'){if(!requirePermission('ecCreate'))return;openCloudEcCreate();return}
 if(b.dataset.action==='ec-cloud-refresh'){refreshEcCloud();return}
 if(b.dataset.action==='product-return-selected'){const t=b.dataset.returnType||document.querySelector('#shelfReturnType')?.value||'general';openProductReturn(t==='frozen'?'frozen':'general');return}
 if(b.dataset.action==='order-clear'){const g=b.dataset.orderClearGroup==='first'?'first':'second',label=g==='first'?'一訂':'二訂';if(!confirm(`確定執行${label}訂購數清除？\n只會把尚未傳輸的${label}訂購數量歸 0，已傳輸歷程不會刪除。`))return;const n=clearPendingOrderQuantities(g);alert(`${label}訂購數清除完成\n共 ${n} 筆訂購數量歸 0`);render(currentAdminPage());return}
 if(b.dataset.badgeEmployee){const u=employees().find(x=>String(x.id)===String(b.dataset.badgeEmployee));if(!u)return alert('找不到員工基本資料');printEmployeeBadge(u);return}
 if(b.dataset.printEmployeeNumber){const u=employees().find(x=>String(x.id)===String(b.dataset.printEmployeeNumber));if(!u)return alert('找不到員工基本資料');printEmployeeNumber(u);return}
 if(b.dataset.action==='ec-return-selected'){const t=document.querySelector('#shelfReturnType')?.value||'general';createEcReturn(t==='frozen'?'frozen':'ambient');return}
 if(b.dataset.action==='ec-return-ambient'){createEcReturn('ambient');return}
 if(b.dataset.action==='ec-return-frozen'){createEcReturn('frozen');return}
 if(b.dataset.action==='new-ec'){if(!requirePermission('ecCreate'))return;
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
 if(b.dataset.action==='scan-transfer-prebuild'){scanCode({title:'掃描轉貨單',onResult:no=>{const el=document.querySelector('#transferNoPrebuild');if(el)el.value=no||''}});return}
 if(b.dataset.action==='receive-transfer-prebuild'){const no=String(document.querySelector('#transferNoPrebuild')?.value||'').trim();if(!no)return alert('請掃描或輸入轉貨單號');try{receiveTransfer(no);if(cloudConfigured()){cloudPushKey(K.transfers,load(K.transfers,[])).catch(()=>{});cloudPushKey(K.products,load(K.products,[])).catch(()=>{})}alert('轉入完成');render(currentAdminPage())}catch(err){alert(err.message)}return}
 if(b.dataset.action==='transfer-out'){if(!requirePermission('transferOut'))return;dlg('建立轉出單',`<label>轉入店號<input id="toStore"></label><label>商品條碼<div class="inline-field"><input id="trBarcode" placeholder="掃描商品條碼"><button type="button" class="button" id="scanTransferProduct">📷 掃描</button></div></label><label>商品<select id="trProduct">${products().map(x=>`<option value="${x.id}">${esc(x.name)}｜庫存${x.stock}</option>`).join('')}</select></label><label>鮮食日期<input id="trDate" type="date"></label><label>數量<input id="trQty" type="number" value="1"></label><button class="primary" id="trSave">確認轉出</button>`);setTimeout(()=>{scanTransferProduct.onclick=()=>scanCode({title:'掃描轉貨商品',onResult:code=>{trBarcode.value=code;const p=products().find(x=>x.barcode===code);if(p)trProduct.value=p.id;else alert('找不到商品')}});trSave.onclick=()=>{try{const p=products().find(x=>x.id===trProduct.value);createTransfer(toStore.value.trim(),p,Number(trQty.value),trDate.value);if(cloudConfigured()){cloudPushKey(K.transfers,load(K.transfers,[])).catch(()=>{});cloudPushKey(K.products,load(K.products,[])).catch(()=>{})}genericDialog.close();render('transfers')}catch(err){alert(err.message)}}},0)}
 if(b.dataset.action==='transfer-in-back'){if(!requirePermission('transferIn'))return;scanCode({title:'掃描轉貨單',onResult:no=>{if(!no)return;try{receiveTransfer(no.trim());if(cloudConfigured()){cloudPushKey(K.transfers,load(K.transfers,[])).catch(()=>{});cloudPushKey(K.products,load(K.products,[])).catch(()=>{})}alert('轉入完成');render('transfers')}catch(err){alert(err.message)}}});return}
 if(b.dataset.transferReceive){if(!requirePermission('transferIn'))return;try{receiveTransfer(b.dataset.transferReceive);render('transfers')}catch(err){alert(err.message)}}
 if(b.dataset.correctEobStocktake){
  if(!isFounder())return alert('只有創辦人可以更正 EOB 盤點類型');
  const id=String(b.dataset.correctEobStocktake||'').trim();
  if(!id)return;
  if(!confirm('確定把這筆誤選的「SC 標準盤點」更正為「盤點人員專用（盲盤）」？\n只更正盤點類型，商品實盤數不會變更。'))return;
  try{
   b.disabled=true;b.textContent='更正中…';
   await adminCorrectEobStocktakeType(id,'personnel');
   saveAudit('更正 EOB 盤點類型',`${id}｜SC 標準盤點 → 盤點人員專用`);
   await refreshEobStocktakeCloud({rerender:false});
   alert('已更正為盤點人員專用（盲盤）');
   render(currentAdminPage());
  }catch(err){alert('更正失敗：'+String(err?.message||err));render(currentAdminPage())}
  return;
 }
 if(b.dataset.deleteStocktakeBatch){if(!isFounder())return alert('此功能只有創辦人可以使用');const rows=load(K.stocktakeBatches,[]),x=rows.find(v=>v.id===b.dataset.deleteStocktakeBatch);if(!x)return alert('找不到盤點批次');if(!confirm(`確定刪除盤點批次／盤點單號 ${x.batchNo}？\n盤點紀錄會保留。`))return;save(K.stocktakeBatches,rows.filter(v=>v.id!==x.id));saveAudit('刪除盤點批次',`${x.batchNo}｜僅刪除批次，盤點紀錄保留`);render('inventory');return}
 if(b.dataset.deleteStocktakeRecord){if(!isFounder())return alert('此功能只有創辦人可以使用');const rows=load(K.inventoryMoves,[]),x=rows.find(v=>v.id===b.dataset.deleteStocktakeRecord&&v.type==='盤點');if(!x)return alert('找不到盤點紀錄');if(!confirm(`確定刪除這筆盤點紀錄？\n${x.batchNo||'無盤點單號'}｜${x.product}｜差異 ${Number(x.qty)>0?'+':''}${Number(x.qty||0)}\n此操作只刪除紀錄，不會回復商品庫存。`))return;save(K.inventoryMoves,rows.filter(v=>v.id!==x.id));saveAudit('刪除盤點紀錄',`${x.batchNo||'—'}｜${x.product}｜差異 ${Number(x.qty||0)}`);render('inventory');return}
 if(b.dataset.action==='store-day-change-settings'){if(!isFounder())return alert('此功能只有創辦人可以使用');const rows=load(K.stores,[]);dlg('日替時間設定',`<p class="hint">只有創辦人可以設定。到達設定時間後，系統切換新的營業日。</p>${rows.map((x,i)=>`<label>${esc(x.name)}（${esc(x.code)}）<input type="time" id="dayChange_${i}" value="${esc(x.dayChangeTime||'00:00')}"></label>`).join('')}<button class="primary" id="saveDayChangeTimes">儲存</button>`);setTimeout(()=>saveDayChangeTimes.onclick=()=>{rows.forEach((x,i)=>x.dayChangeTime=document.querySelector(`#dayChange_${i}`).value||'00:00');save(K.stores,rows);saveAudit('設定日替時間',rows.map(x=>`${x.code}:${x.dayChangeTime}`).join('｜'));genericDialog.close();render('stores')},0);return}
 if(b.dataset.action==='store-close-time-settings'){if(!isFounder())return alert('此功能只有創辦人可以使用');const rows=load(K.stores,[]);dlg('日結時間設定',`<p class="hint">只有創辦人可以設定。到達設定時間後，系統自動日結前一營業日。</p>${rows.map((x,i)=>`<label>${esc(x.name)}（${esc(x.code)}）<input type="time" id="autoClose_${i}" value="${esc(x.autoCloseTime||'04:00')}"></label>`).join('')}<button class="primary" id="saveAutoCloseTimes">儲存</button>`);setTimeout(()=>saveAutoCloseTimes.onclick=()=>{rows.forEach((x,i)=>x.autoCloseTime=document.querySelector(`#autoClose_${i}`).value||'04:00');save(K.stores,rows);saveAudit('設定日結時間',rows.map(x=>`${x.code}:${x.autoCloseTime}`).join('｜'));genericDialog.close();render('stores')},0);return}
 if(b.dataset.action==='switch-store'){
  if(!requirePermission('storeSwitch'))return;
  const rows=load(K.stores,[]).filter(x=>x.active!==false);
  const current=currentStoreCode();
  const returnPage=String(document.querySelector('.nav-item.active')?.dataset.nav||'home');
  dlg('切換門市',`<p>目前門市：<b>${esc(store().name)}（${esc(current)}）</b></p>
   <label>切換至<select id="switchStoreCode">${rows.map(x=>`<option value="${esc(x.code)}" ${String(x.code)===current?'selected':''}>${esc(x.name)}｜${esc(x.code)}</option>`).join('')}</select></label>
   <button class="primary" id="switchStoreConfirm">確認切換</button>`);
  setTimeout(()=>switchStoreConfirm.onclick=async()=>{
   const target=rows.find(x=>String(x.code)===String(switchStoreCode.value));
   if(!target)return alert('找不到門市');
   if(String(target.code)===current){genericDialog.close();return}
   if(!setCurrentStore(target))return alert('門市切換失敗，請再試一次');
   const switched=currentStoreCode();
   if(switched!==String(target.code))return alert(`門市切換失敗：預期 ${target.code}，目前仍為 ${switched}`);
   if(cloudConfigured()){
    try{
     switchStoreConfirm.disabled=true;
     switchStoreConfirm.textContent='切換並同步中…';
     await cloudPullAll();
    }catch(err){
     const oldStore=rows.find(x=>String(x.code)===String(current));
     if(oldStore)setCurrentStore(oldStore);
     return alert('切換門市雲端資料載入失敗，已返回原門市：'+String(err?.message||err));
    }
   }
   saveAudit('切換門市',`${current}→${target.code} ${target.name}`);
   genericDialog.close();
   // 從哪個頁面切換，就留在哪個頁面；營運情報不再跳回首頁。
   render(returnPage);
  },0);
  return;
 }
 if(b.dataset.storeEdit){
  if(!requirePermission('storeEdit'))return;
  const rows=load(K.stores,[]),x=rows.find(v=>v.id===b.dataset.storeEdit);
  if(!x)return alert('找不到門市資料');
  dlg('修改門市',`
   <label>門市名稱<input id="editStoreName" value="${esc(x.name||'')}"></label>
   <label>店號<input id="editStoreCode" value="${esc(x.code||'')}"></label>
   <label>狀態<select id="editStoreActive"><option value="1" ${x.active!==false?'selected':''}>啟用</option><option value="0" ${x.active===false?'selected':''}>停用</option></select></label>
   <button class="primary" id="editStoreSave">儲存修改</button>`);
  setTimeout(()=>editStoreSave.onclick=()=>{
   const name=editStoreName.value.trim(),code=editStoreCode.value.trim();
   if(!name||!code)return alert('門市名稱與店號必填');
   if(rows.some(v=>v.id!==x.id&&String(v.code)===code))return alert('店號已存在');
   const before=`${x.name}（${x.code}）`;
   Object.assign(x,{name,code,active:editStoreActive.value==='1'});
   save(K.stores,rows);
   saveAudit('修改門市',`${before}→${x.name}（${x.code}）｜${x.active!==false?'啟用':'停用'}`);
   genericDialog.close();render('stores');
  },0);
  return;
 }
 if(b.dataset.storeDelete){
  if(!requirePermission('storeDelete'))return;
  const rows=load(K.stores,[]),x=rows.find(v=>v.id===b.dataset.storeDelete);
  if(!x)return alert('找不到門市資料');
  if(rows.length<=1)return alert('至少必須保留一間門市，不能刪除最後一間門市');
  if(!confirm(`確定刪除門市？\n${x.name}（${x.code}）\n\n此操作無法復原。`))return;
  save(K.stores,rows.filter(v=>v.id!==x.id));
  saveAudit('刪除門市',`${x.name}（${x.code}）`);
  render('stores');
  return;
 }
 if(b.dataset.action==='store-add'){if(!requirePermission('storeAdd'))return;dlg('新增門市',`<label>門市名稱<input id="storeName"></label><label>店號<input id="storeCode"></label><button class="primary" id="storeSave">新增</button>`);setTimeout(()=>storeSave.onclick=()=>{const rows=load(K.stores,[]),code=storeCode.value.trim();if(!storeName.value.trim()||!code)return alert('門市名稱與店號必填');if(rows.some(x=>x.code===code))return alert('店號已存在');rows.push({id:uid(),name:storeName.value.trim(),code,dayChangeTime:'00:00',autoCloseTime:'04:00',active:true});save(K.stores,rows);saveAudit('新增門市',`${storeName.value.trim()}｜${code}`);genericDialog.close();render('stores')},0)}
 if(b.dataset.action==='store-code'){if(!requirePermission('storeCode'))return;const rows=load(K.stores,[]);dlg('轉換店號',`<label>門市<select id="scStore">${rows.map(x=>`<option value="${x.id}">${esc(x.name)}｜${esc(x.code)}</option>`).join('')}</select></label><label>新店號<input id="scCode"></label><label>原因<input id="scReason"></label><button class="primary" id="scSave">確認轉換</button>`);setTimeout(()=>scSave.onclick=()=>{const x=rows.find(v=>v.id===scStore.value),old=x.code,n=scCode.value.trim();if(!n||!scReason.value.trim())return alert('新店號與原因必填');if(rows.some(v=>v.id!==x.id&&v.code===n))return alert('店號已存在');x.code=n;save(K.stores,rows);saveAudit('轉換店號',`${x.name}｜${old}→${n}｜${scReason.value.trim()}`);genericDialog.close();render('stores')},0)}
 if(b.dataset.action==='store-query'){const q=prompt('輸入門市名稱或店號','');if(q===null)return;const rows=load(K.stores,[]).filter(x=>x.name.includes(q)||x.code.includes(q));alert(rows.length?rows.map(x=>`${x.name}（${x.code}）｜${x.active!==false?'啟用':'停用'}`).join('\n'):'找不到門市')}
 if(b.dataset.updateSc==='employees'){runScEmployeeUpdate();return}
 if(b.dataset.update)runUpdate(b.dataset.update)
 if(b.dataset.action==='self-checkout-account-settings'){openSelfCheckoutAccountSettings();return}
 if(b.dataset.action==='audit-print'){const r=load(K.audit,[]);printHTML('業務紀錄',r.map(x=>`<div>${new Date(x.at).toLocaleString('zh-TW')}｜${esc(x.user)}｜${esc(x.action)}｜${esc(x.detail)}</div><hr>`).join(''))}
 if(b.dataset.action==='revenue-correct-top'){const id=document.querySelector('#revenueTarget')?.value||'';if(!id)return alert('請先選擇要修正的營收日期');const rev=load(K.revenue,[]).find(x=>x.id===id);if(!rev)return alert('找不到營收紀錄');b.dataset.correct=id;}
if(b.dataset.action==='revenue-remove-top'){const id=document.querySelector('#revenueTarget')?.value||'';if(!id)return alert('請先選擇要移除的營收日期');b.dataset.removeRevenue=id;}
if(b.dataset.removeRevenue){const rows=load(K.revenue,[]),r=rows.find(x=>x.id===b.dataset.removeRevenue);if(!r)return alert('找不到營收紀錄');if(!confirm(`確定移除 ${r.date} 的營收紀錄？\n總營收：${money(r.total)}\n此操作無法復原。`))return;save(K.revenue,rows.filter(x=>x.id!==r.id));saveAudit('移除營收紀錄',`${r.date}｜${money(r.total)}｜${r.id}`);render('revenue');return;}if(b.dataset.action==='revenue-prev-cash-handover'){
  if(cloudConfigured()){try{await cloudPullKey(K.deposits);await cloudPullKey(K.handovers)}catch(_e){}}
  openPreviousDayCashHandoverQuery();return;
 }
 if(b.dataset.action==='revenue-prev-deposits'){
  if(cloudConfigured()){try{await cloudPullKey(K.deposits)}catch(_e){}}
  openPreviousDayDepositQuery();return;
 }
 if(b.dataset.action==='revenue-prev-handovers'){
  if(cloudConfigured()){try{await cloudPullKey(K.handovers)}catch(_e){}}
  openPreviousDayHandoverQuery();return;
 }
 if(b.dataset.action==='collect'){
  const target=previousDateKey();
  if(!confirm(`營收收集只會整理 ${target}（前一天）的交易資料。\n當天交易不會進入營收報表。\n是否繼續？`))return;
  const r=collect();
  saveAudit('營收收集',`${r.date}｜${money(r.total)}｜報表資料建立`);
  render('revenue');
  alert(`已完成 ${r.date} 營收收集。\n現在可進行修正／傳輸／列印報表。`)
 }if(b.dataset.action==='revenue-print'){const rows=load(K.revenue,[]);if(!rows.length)return alert('目前沒有可列印的營收資料');const selected=document.querySelector('#revenueTarget')?.value||'';const r=(selected?rows.find(x=>String(x.id)===String(selected)):null)||rows.find(x=>x.status==='已傳輸'&&x.zNo)||rows.find(x=>x.zNo)||rows[0];printAllRevenueReports(r);return}if(b.dataset.correct){const revId=b.dataset.correct,rev=load(K.revenue,[]).find(x=>x.id===revId);const bankOptions=Object.keys(REMITTANCE_BANKS).map(x=>`<option ${rev?.bankName===x?'selected':''}>${x}</option>`).join('');dlg('營收修正',`<p>營業日：<b>${esc(rev?.date||'')}</b>｜應送金：<b>${money(rev?.sendAmount||0)}</b></p><label>實際現金<input id="rc" type="number" value="${Number(rev?.actualCash??rev?.sendAmount??0)}"></label><label>差額原因<input id="rr" value="${esc(rev?.reason||'')}" placeholder="若有差額請填寫原因"></label><label>送金方式<select id="rm"><option ${rev?.method==='銀行送金'?'selected':''}>銀行送金</option><option ${rev?.method==='總部收款'?'selected':''}>總部收款</option></select></label><label id="bankWrap">送金銀行／郵局<select id="rb">${bankOptions}</select></label><p class="hint">銀行送金帳號會依門市店號與該金融機構固定代號自動產生；傳輸後自動產生 Z 帳與 7 張營收報表。</p><button class="primary" id="rs">傳輸</button>`);setTimeout(()=>{const toggle=()=>bankWrap.style.display=rm.value==='銀行送金'?'block':'none';rm.onchange=toggle;toggle();rs.onclick=()=>{const expected=Number(rev?.sendAmount||0),actual=Number(rc.value||0);if(actual!==expected&&!rr.value.trim())return alert('實際現金與應送金有差額，請填寫差額原因');try{const saved=correct(revId,actual,rr.value.trim(),rm.value,rm.value==='銀行送金'?rb.value:'');genericDialog.close();render('revenue');setTimeout(()=>openRevenueReportCenter(saved.id),50)}catch(err){alert(err.message)}}},0)}if(b.dataset.z){try{z(b.dataset.z);render('revenue')}catch(err){alert(err.message)}}
});

function localDateKey(d=new Date()){
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function previousDateKey(){
 const d=new Date();d.setDate(d.getDate()-1);return localDateKey(d)
}

const TM_CUSTOM_REMINDER_KEY='yj_tm_custom_reminders';
const HQ_TM_REMINDER_KEY='yj_hq_tm_reminders';
let __yjScLastActivityAt=Date.now();
function resetScAutoLogoutActivity(){__yjScLastActivityAt=Date.now()}
['pointerdown','keydown','touchstart','wheel'].forEach(ev=>document.addEventListener(ev,resetScAutoLogoutActivity,{passive:true}));
clearInterval(window.__yjScAutoLogoutTimer);window.__yjScAutoLogoutTimer=setInterval(()=>{
 const min=Number(load('yj_sc_auto_logout_minutes',15)||0);if(!min||!currentUser())return;
 if(Date.now()-__yjScLastActivityAt>=min*60000){try{logout()}catch(_e){};__yjScLastActivityAt=Date.now();showLogin('back');}
},15000);
async function saveTmReminderRows(rows){save(TM_CUSTOM_REMINDER_KEY,rows);if(cloudConfigured())try{await cloudPushKey(TM_CUSTOM_REMINDER_KEY,rows)}catch(_e){} }
async function saveHqReminderRows(rows){save(HQ_TM_REMINDER_KEY,rows);if(cloudConfigured())try{await cloudPushKey(HQ_TM_REMINDER_KEY,rows)}catch(_e){} }
async function saveTotalShelfRuleRows(rows){save('yj_total_shelf_return_rules',rows);if(cloudConfigured())try{await cloudPushKey('yj_total_shelf_return_rules',rows)}catch(_e){console.warn('總部總下架規則同步失敗',_e)} }
function productReturnRows427(){return load('yj4_product_returns',[])||[]}
async function saveReturnRecord427(rec){const rows=productReturnRows427();rows.unshift(rec);save('yj4_product_returns',rows);if(cloudConfigured())try{await cloudPushKey('yj4_product_returns',rows)}catch(_e){};saveAudit('建立商品退貨',`${rec.type}｜${rec.name}×${rec.qty}`)}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
 if(a==='save-auto-logout'){const v=Number(document.querySelector('#scAutoLogoutMinutes')?.value||0);save('yj_sc_auto_logout_minutes',v);resetScAutoLogoutActivity();saveAudit('自動登出時間設定',v?`${v} 分鐘`:'永不自動登出');alert(v?`已設定 ${v} 分鐘無操作自動登出`:'已設定永不自動登出');return}
 if(a==='tm-reminder-save'){
   const title=document.querySelector('#tmReminderTitle')?.value.trim()||'',message=document.querySelector('#tmReminderMessage')?.value.trim()||'';if(!title||!message)return alert('請輸入提醒標題與內容');
   const id=document.querySelector('#tmReminderEditId')?.value||'',rows=load(TM_CUSTOM_REMINDER_KEY,[])||[],rec={id:id||`TMR-${Date.now()}`,title,message,scope:document.querySelector('#tmReminderScope')?.value||'daily',createdLocalDate:localDateKey(),startAt:document.querySelector('#tmReminderStart')?.value?new Date(document.querySelector('#tmReminderStart').value).toISOString():'',endAt:document.querySelector('#tmReminderEnd')?.value?new Date(document.querySelector('#tmReminderEnd').value).toISOString():'',enabled:document.querySelector('#tmReminderEnabled')?.value!=='false',updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
   const i=rows.findIndex(x=>x.id===rec.id);if(i>=0)rows[i]=rec;else rows.unshift(rec);await saveTmReminderRows(rows);saveAudit(i>=0?'修改TM自設提醒':'新增TM自設提醒',title);render(currentAdminPage());return;
 }
 if(a==='tm-reminder-edit'){
   const x=(load(TM_CUSTOM_REMINDER_KEY,[])||[]).find(v=>v.id===b.dataset.id);if(!x)return;document.querySelector('#tmReminderEditId').value=x.id;document.querySelector('#tmReminderTitle').value=x.title||'';document.querySelector('#tmReminderMessage').value=x.message||'';document.querySelector('#tmReminderScope').value=x.scope||'daily';document.querySelector('#tmReminderEnabled').value=x.enabled===false?'false':'true';document.querySelector('#tmReminderStart').value=x.startAt?new Date(x.startAt).toISOString().slice(0,16):'';document.querySelector('#tmReminderEnd').value=x.endAt?new Date(x.endAt).toISOString().slice(0,16):'';document.querySelector('#tmReminderTitle').scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(a==='tm-reminder-cancel'){render(currentAdminPage());return}
 if(a==='tm-reminder-delete'){const rows=load(TM_CUSTOM_REMINDER_KEY,[])||[],x=rows.find(v=>v.id===b.dataset.id);if(!x||!confirm(`刪除提醒「${x.title}」？`))return;await saveTmReminderRows(rows.filter(v=>v.id!==x.id));saveAudit('刪除TM自設提醒',x.title);render(currentAdminPage());return}
 if(a==='hq-reminder-save'){
   if(!isFounder())return alert('只有創辦人可以設定總部提醒');
   const title=document.querySelector('#hqReminderTitle')?.value.trim()||'',message=document.querySelector('#hqReminderMessage')?.value.trim()||'';if(!title||!message)return alert('請輸入提醒標題與內容');
   const id=document.querySelector('#hqReminderEditId')?.value||'',rows=load(HQ_TM_REMINDER_KEY,[])||[],rec={id:id||`HQR-${Date.now()}`,title,message,scope:document.querySelector('#hqReminderScope')?.value||'daily',createdLocalDate:localDateKey(),startAt:document.querySelector('#hqReminderStart')?.value?new Date(document.querySelector('#hqReminderStart').value).toISOString():'',endAt:document.querySelector('#hqReminderEnd')?.value?new Date(document.querySelector('#hqReminderEnd').value).toISOString():'',enabled:document.querySelector('#hqReminderEnabled')?.value!=='false',source:'HQ',updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};
   const i=rows.findIndex(x=>x.id===rec.id);if(i>=0)rows[i]=rec;else rows.unshift(rec);await saveHqReminderRows(rows);saveAudit(i>=0?'修改總部提醒':'新增總部提醒',title);render(currentAdminPage());return;
 }
 if(a==='hq-reminder-edit'){
   if(!isFounder())return alert('只有創辦人可以設定總部提醒');const x=(load(HQ_TM_REMINDER_KEY,[])||[]).find(v=>v.id===b.dataset.id);if(!x)return;document.querySelector('#hqReminderEditId').value=x.id;document.querySelector('#hqReminderTitle').value=x.title||'';document.querySelector('#hqReminderMessage').value=x.message||'';document.querySelector('#hqReminderScope').value=x.scope||'daily';document.querySelector('#hqReminderEnabled').value=x.enabled===false?'false':'true';document.querySelector('#hqReminderStart').value=x.startAt?new Date(x.startAt).toISOString().slice(0,16):'';document.querySelector('#hqReminderEnd').value=x.endAt?new Date(x.endAt).toISOString().slice(0,16):'';document.querySelector('#hqReminderTitle').scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(a==='hq-reminder-cancel'){if(!isFounder())return;render(currentAdminPage());return}
 if(a==='hq-reminder-delete'){if(!isFounder())return alert('只有創辦人可以設定總部提醒');const rows=load(HQ_TM_REMINDER_KEY,[])||[],x=rows.find(v=>v.id===b.dataset.id);if(!x||!confirm(`刪除總部提醒「${x.title}」？`))return;await saveHqReminderRows(rows.filter(v=>v.id!==x.id));saveAudit('刪除總部提醒',x.title);render(currentAdminPage());return}
 if(a==='total-shelf-rule-apply'){
   if(!isFounder())return alert('只有創辦人可以維護總下架商品設定');const op=document.querySelector('#totalShelfManageAction')?.value||'new',rows=load('yj_total_shelf_return_rules',[])||[],rid=document.querySelector('#totalShelfRuleSelect')?.value||'';
   if(op==='delete'){const x=rows.find(v=>v.id===rid);if(!x)return alert('請選擇要刪除的設定');if(!confirm(`刪除「${x.name}」總下架設定？`))return;await saveTotalShelfRuleRows(rows.filter(v=>v.id!==rid));saveAudit('刪除總下架設定',x.name);render(currentAdminPage());return}
   const ps=load(K.products,[])||[],pid=document.querySelector('#totalShelfProduct')?.value||'',p=ps.find(v=>String(v.id)===String(pid));if(!p)return alert('請選擇商品');let rec={id:op==='edit'&&rid?rid:`TSR-${Date.now()}`,productId:p.id,code:p.code||'',name:p.name,reason:document.querySelector('#totalShelfReason')?.value.trim()||'總部下架',startDate:document.querySelector('#totalShelfStart')?.value||'',endDate:document.querySelector('#totalShelfEnd')?.value||'',active:true,updatedAt:new Date().toISOString(),updatedBy:currentUser()?.name||''};const i=rows.findIndex(v=>v.id===rec.id);if(op==='edit'&&i<0)return alert('請選擇要修改的設定');if(i>=0)rows[i]=rec;else rows.unshift(rec);await saveTotalShelfRuleRows(rows);saveAudit(i>=0?'修改總下架設定':'新增總下架設定',p.name);render(currentAdminPage());return;
 }
 if(a==='total-shelf-return-create'){
   const rule=(load('yj_total_shelf_return_rules',[])||[]).find(v=>v.id===b.dataset.id);if(!rule)return;const ps=load(K.products,[])||[],p=ps.find(v=>String(v.id)===String(rule.productId));if(!p)return alert('商品主檔不存在');const q=Number(prompt(`總下架退貨：${p.name}\n請輸入數量`,'1')||0);if(q<=0)return;const before=Number(p.stock||0);if(q>before&&!p.allowNegativeStock)return alert(`退貨數量不可大於目前庫存 ${before}`);p.stock=Math.max(0,before-q);save(K.products,ps);await saveReturnRecord427({id:`RT-${Date.now()}`,type:'總下架商品',label:'總下架商品退貨',productId:p.id,code:p.code||'',name:p.name,qty:q,reason:rule.reason||'總部下架',status:'已建立',storeCode:currentStoreCode(),user:currentUser()?.name||'',at:new Date().toISOString(),stockBefore:before,stockAfter:p.stock,totalShelfRuleId:rule.id});alert('總下架商品退貨已建立');render(currentAdminPage());return;
 }
 if(a==='bad-empty-return-create'){
   const kind=document.querySelector('#badReturnKind')?.value||'不良品',qty=Math.max(1,Number(document.querySelector('#badReturnQty')?.value||1)),note=document.querySelector('#badReturnNote')?.value.trim()||'';
   if(kind==='空箱瓶'){const name=document.querySelector('#emptyContainerType')?.value||'';await saveReturnRecord427({id:`RT-${Date.now()}`,type:'空箱瓶',label:'不良品／空箱瓶退貨',productId:'',code:'',name,qty,reason:'空箱瓶',note,status:'已建立',storeCode:currentStoreCode(),user:currentUser()?.name||'',at:new Date().toISOString()});alert(`${name}退貨已建立`);render(currentAdminPage());return}
   const ps=load(K.products,[])||[],p=ps.find(v=>String(v.id)===String(document.querySelector('#badReturnProduct')?.value||''));if(!p)return alert('找不到商品');if(kind==='不良品'&&p.returnable===false)return alert('此商品在商品管理設定為「不良退 N」，不可做不良品退貨');const before=Number(p.stock||0);if(qty>before&&!p.allowNegativeStock)return alert(`退貨數量不可大於目前庫存 ${before}`);p.stock=Math.max(0,before-qty);save(K.products,ps);await saveReturnRecord427({id:`RT-${Date.now()}`,type:kind,label:'不良品／空箱瓶退貨',productId:p.id,code:p.code||'',name:p.name,qty,reason:kind,note,status:'已建立',storeCode:currentStoreCode(),user:currentUser()?.name||'',at:new Date().toISOString(),stockBefore:before,stockAfter:p.stock});alert(`${kind}退貨已建立`);render(currentAdminPage());return;
 }
});

const SC_RUNTIME_KEY='yj_sc_runtime_state';
async function publishScRuntime(status='online',reason='heartbeat',until=''){
 const payload={storeCode:currentStoreCode(),status,reason,until,updatedAt:new Date().toISOString()};save(SC_RUNTIME_KEY,payload);
 if(cloudConfigured())try{await cloudPushKey(SC_RUNTIME_KEY,payload)}catch(_e){}return payload;
}
function scRestartScreen(seconds=120,reason='日替'){
 const end=Date.now()+seconds*1000;window.__yjScRestarting=true;publishScRuntime('restarting','day-change',new Date(end).toISOString());
 let overlay=document.querySelector('#scRestartOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='scRestartOverlay';overlay.className='system-restart-overlay';document.body.appendChild(overlay)}
 const tick=()=>{const left=Math.max(0,Math.ceil((end-Date.now())/1000));overlay.innerHTML=`<div class="system-restart-card"><div class="system-restart-spinner"></div><h1>SC 正在重新啟動</h1><p>${esc(reason)}處理中，請勿關閉或操作系統</p><strong>約 ${Math.ceil(left/60)} 分鐘</strong><small>${left} 秒</small></div>`;if(left<=0){clearInterval(timer);window.__yjScRestarting=false;publishScRuntime('online','restart-complete','');try{localStorage.removeItem('yj_day_replacement_active');logout()}catch(_e){}overlay.remove();showLogin('back')}};tick();const timer=setInterval(tick,1000);
}
function schedulerState(){return load(K.scheduler,{lastDayChange:'',lastAutoClose:'',lastDayChangeAt:'',lastAutoCloseAt:''})}
function saveSchedulerState(s){save(K.scheduler,s)}
function dayReplacementBusinessDate(now=new Date()){
 const d=new Date(now);if(now.getHours()===23&&now.getMinutes()>=59)d.setDate(d.getDate()+1);return localDateKey(d);
}
function performDayChange(){
 const s=schedulerState(),target=dayReplacementBusinessDate();if(s.lastDayChange===target||window.__yjDayReplacementLock)return false;
 window.__yjDayReplacementLock=true;s.lastDayChange=target;s.lastDayChangeAt=new Date().toISOString();saveSchedulerState(s);saveAudit('SC 日替',`${target}｜2 分鐘重新啟動`);
 try{localStorage.setItem('yj_current_business_date',target);localStorage.setItem('yj_day_replacement_active','1')}catch{}scRestartScreen(120,'日替');return true;
}
function performAutoClose(){
 const s=schedulerState(),today=localDateKey();if(s.lastAutoClose===today)return false;const target=previousDateKey();autoCloseBusinessDay(target);s.lastAutoClose=today;s.lastAutoCloseAt=new Date().toISOString();saveSchedulerState(s);saveAudit('自動日結',`前一營業日 ${target} 已封存｜未產生報表`);return true
}
function scheduleTimeReached(now,timeText){const [hh,mm]=String(timeText||'00:00').split(':').map(Number);return now.getHours()>hh||(now.getHours()===hh&&now.getMinutes()>=mm)}
function currentStoreSchedule(){const s=store();return {dayChangeTime:'23:59',autoCloseTime:s.autoCloseTime||'04:00'}}
function checkSchedules(){
 const now=new Date(),cfg=currentStoreSchedule(),s=schedulerState(),target=dayReplacementBusinessDate(now);
 if(scheduleTimeReached(now,cfg.dayChangeTime)&&s.lastDayChange!==target)performDayChange();
 if(scheduleTimeReached(now,cfg.autoCloseTime)&&s.lastAutoClose!==localDateKey())performAutoClose();
 const orderState=orderingSwitchState(now),orderKey=orderingDateKey(now),prevPhase=localStorage.getItem('yj_order_switch_phase')||'';
 if(orderState.phase==='statistics'&&prevPhase!=='statistics'){localStorage.setItem('yj_order_switch_phase','statistics');saveAudit('訂購主檔更新','21:59 訂購傳輸鎖定｜系統自動統計中')}
 if(orderState.phase==='next-day'&&(prevPhase!=='next-day'||localStorage.getItem('yj_order_calendar_date')!==orderKey)){localStorage.setItem('yj_order_switch_phase','next-day');localStorage.setItem('yj_order_calendar_date',orderKey);saveAudit('訂購曆切換',`${orderKey}｜22:02 正式切換隔日訂購`)}
 if(orderState.phase==='today'&&prevPhase!=='today'){localStorage.setItem('yj_order_switch_phase','today');localStorage.setItem('yj_order_calendar_date',orderKey)}
 if(document.body.dataset.mode==='back'&&document.querySelector('.orange-order-page')){const phase=orderState.phase;if(window.__lastOrderingClockKey!==orderKey+'|'+phase){window.__lastOrderingClockKey=orderKey+'|'+phase;refreshOrderingCurrentView()}}
}
checkSchedules();setInterval(checkSchedules,15000);
clearInterval(window.__yjScEmployeeMasterTimer);window.__yjScEmployeeMasterTimer=setInterval(checkScEmployeeMasterUpdate,5000);setTimeout(checkScEmployeeMasterUpdate,1200);

clearInterval(window.__yjScTmStatusTimer);window.__yjScTmStatusTimer=setInterval(()=>{if(!document.hidden)refreshTopTmRuntime()},5000);setTimeout(refreshTopTmRuntime,800);setTimeout(()=>publishScRuntime('online','startup',''),500);
clearInterval(window.__yjScRuntimeHeartbeat);window.__yjScRuntimeHeartbeat=setInterval(()=>{if(!document.hidden&&!window.__yjScRestarting)publishScRuntime('online','heartbeat','')},15000);
document.addEventListener('visibilitychange',()=>{if(window.__yjScRestarting)return;if(document.hidden)publishScRuntime('background','visibility-hidden',new Date(Date.now()+10*60*1000).toISOString());else publishScRuntime('online','visibility-resume','')});
window.addEventListener('pageshow',()=>{if(!document.hidden&&!window.__yjScRestarting)publishScRuntime('online','pageshow','');if(currentUser())setTimeout(stabilizeScViewportAfterLogin,60)},{passive:true});
document.querySelector('#loginPerson').onchange=syncLoginAccount;

document.querySelector('#toggleLoginPassword').onclick=()=>{
 const input=document.querySelector('#loginPassword');
 input.type=input.type==='password'?'text':'password';
};

loginDialog.addEventListener('cancel',e=>e.preventDefault());

function stabilizeScViewportAfterLogin(){
 try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch(_e){}
 const fix=()=>{
  try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch(_e){window.scrollTo(0,0)}
  try{document.documentElement.scrollTop=0;document.documentElement.scrollLeft=0}catch(_e){}
  try{document.body.scrollTop=0;document.body.scrollLeft=0}catch(_e){}
  // iPad/iPhone 關閉登入鍵盤後，強制 Safari 重新計算 visual viewport 與 sticky/topnav。
  try{void document.body.offsetHeight}catch(_e){}
  try{window.dispatchEvent(new Event('resize'))}catch(_e){}
 };
 requestAnimationFrame(()=>requestAnimationFrame(fix));
 setTimeout(fix,80);
 setTimeout(fix,220);
 setTimeout(fix,500);
}

document.querySelector('#loginForm').onsubmit=async e=>{
 e.preventDefault();

 const personId=document.querySelector('#loginPerson')?.value||'';
 const accountInput=document.querySelector('#loginAccount');
 const passwordInput=document.querySelector('#loginPassword');
 const account=accountInput?.value.trim()||'';
 const password=passwordInput?.value||'';
 const normalize=v=>String(v||'').trim().toLowerCase();

 if(!account)return alert('請選擇帳號或手動輸入登入帳號');
 if(!password)return alert('請輸入密碼');

 // 先使用目前本機主檔驗證；若失敗，再向 Supabase 拉取最新版人員主檔後重試。
 // 這樣舊版離線帳密仍可登入，同時新建立／新修改的正式 SC 帳密也能在登入前同步。
 let people=availableLoginPeople();
 let allPeople=employees();
 let selectedByList=personId?people.find(x=>String(x.id)===String(personId)):null;
 let selectedByAccount=account?people.find(x=>normalize(x.account)===normalize(account)):null;
 let selectedAny=account?allPeople.find(x=>normalize(x.account)===normalize(account)):null;

 if(selectedByList&&normalize(account)!==normalize(selectedByList.account||'')){
  return alert('手動輸入的帳號與下拉選取人員不相符；請改成正確帳號，或把下拉選單切回空白後直接輸入帳號');
 }

 let loginOk=login(account,password);
 let cloudRefreshTried=false;

 if(!loginOk&&cloudConfigured()){
  cloudRefreshTried=true;
  try{
   await cloudPullKey(K.employees);
   people=availableLoginPeople();
   allPeople=employees();
   selectedByList=personId?people.find(x=>String(x.id)===String(personId)):null;
   selectedByAccount=account?people.find(x=>normalize(x.account)===normalize(account)):null;
   selectedAny=account?allPeople.find(x=>normalize(x.account)===normalize(account)):null;
   loginOk=login(account,password);
  }catch(err){
   console.warn('登入前同步 SC 人員主檔失敗',err);
  }
 }

 if(loginOk){
  try{document.activeElement?.blur?.()}catch(_e){}
  loginDialog.close();
  const selected=selectedByList||selectedByAccount||selectedAny||null;
  saveAudit('登入SC',selected?.name||account);
  const lp=document.querySelector('#loginPerson'),la=document.querySelector('#loginAccount'),pw=document.querySelector('#loginPassword');
  if(lp)lp.value='';if(la)la.value='';if(pw)pw.value='';
  requestAnimationFrame(()=>{
   mode('back');
   stabilizeScViewportAfterLogin();
  });
  setTimeout(checkSchedules,100);
 }else{
  const pw=document.querySelector('#loginPassword');if(pw)pw.value='';
  if(selectedAny&&selectedAny.active===false)return alert('此帳號目前已停用');
  if(cloudRefreshTried)return alert('帳號或密碼錯誤（已同步最新 SC 人員主檔後重新驗證）');
  alert('帳號或密碼錯誤');
 }
};
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 if(b.dataset.action==='market-abnormal-refresh'){if(cloudConfigured())try{await cloudPullKey(K.products)}catch(_e){}render(currentAdminPage());return;}
 if(b.dataset.action==='support-dispatch-submit'){const date=document.querySelector('#sdDate')?.value||'',start=document.querySelector('#sdStart')?.value||'',end=document.querySelector('#sdEnd')?.value||'';if(!date||!start||!end)return alert('支援日期、開始時間、結束時間為必填');const rows=load('yj_support_dispatch_requests',[])||[];const rec={id:uid(),storeCode:currentStoreCode(),applicant:currentUser()?.name||'',date,start,end,count:Math.max(1,Number(document.querySelector('#sdCount')?.value||1)),shift:document.querySelector('#sdShift')?.value||'',reason:document.querySelector('#sdReason')?.value||'',urgent:document.querySelector('#sdUrgent')?.value==='true',work:document.querySelector('#sdWork')?.value||'',note:document.querySelector('#sdNote')?.value||'',status:'申請中',createdAt:new Date().toISOString()};rows.unshift(rec);save('yj_support_dispatch_requests',rows);saveAudit('支援派遣單申請',`${rec.date}｜${rec.start}-${rec.end}｜${rec.count}人｜${rec.reason}`);alert('支援派遣單已送出');render(currentAdminPage());return;}
 if(b.dataset.action==='support-dispatch-clear'){render(currentAdminPage());return;}
 if(b.dataset.action==='attendance-mode-store'){sessionStorage.setItem('yj_attendance_mode','store');render('attendance');return;}
 if(b.dataset.action==='attendance-mode-stocktake'){if(!isHeadOffice()||!isFounder())return alert('盤點人員出勤管理只有總店創辦人可以使用');sessionStorage.setItem('yj_attendance_mode','stocktake');render('attendance');return;}
 if(b.dataset.action==='attendance-save-confirm'){
  const isStock=String(sessionStorage.getItem('yj_attendance_mode')||'store')==='stocktake';
  if(isStock&&(!isHeadOffice()||!isFounder()))return alert('盤點人員出勤只有總店創辦人可以修改');
  if(!isStock&&!hasPermission('attendanceEdit'))return alert('沒有工時修改權限');
  const rows=load(K.attendance,[]),pairs=attendancePairRows(isStock);let changed=0;
  const timeIso=(date,time)=>{const m=String(time||'').match(/^(\d{2}):(\d{2})$/);if(!m)return'';const d=new Date(`${date}T00:00:00`);d.setHours(Number(m[1]),Number(m[2]),0,0);return d.toISOString();};
  document.querySelectorAll('[data-attendance-pair]').forEach(tr=>{
   const key=tr.dataset.attendancePair,pair=pairs.find(x=>x.key===key);if(!pair)return;
   const forgotten=!!tr.querySelector('[data-att-forgotten]')?.checked,other=tr.querySelector('[data-att-other]')?.value.trim()||'';
   const reason=[forgotten?'忘記打卡':'',other].filter(Boolean).join('、');
   const confirmIn=timeIso(pair.date,tr.querySelector('[data-att-confirm-in]')?.value),confirmOut=timeIso(pair.date,tr.querySelector('[data-att-confirm-out]')?.value);
   const targets=(pair.source||[]).map(src=>rows.find(x=>String(x.id)===String(src.id))).filter(Boolean);
   if(!targets.length)return;
   for(const target of targets){
    target.confirmedSignInAt=confirmIn;target.confirmedSignOutAt=confirmOut;target.confirmReason=reason;
    target.modifyReason=reason;target.modifiedBy=currentUser()?.name||'';target.modifiedAt=new Date().toISOString();
   }
   if(pair.signIn){const target=rows.find(x=>String(x.id)===String(pair.signIn.id));if(target)target.confirmedAt=confirmIn||target.confirmedAt||'';}
   if(pair.signOut){const target=rows.find(x=>String(x.id)===String(pair.signOut.id));if(target)target.confirmedAt=confirmOut||target.confirmedAt||'';}
   changed++;
  });
  save(K.attendance,rows);
  if(cloudConfigured())cloudPushKey(K.attendance,rows).catch(err=>console.warn('工時確認雲端同步失敗',err));
  saveAudit(isStock?'盤點人員工時確認':'每日工時確認',`${changed} 列｜確認時間與原因已保存｜實際時間未修改`);
  alert('已儲存確認工時與原因；缺少原始簽到／簽退的日期也會保留補登內容');render('attendance');return;
 }
 if(b.dataset.action==='new-special-personnel'){
  if(!isHeadOffice()||!isFounder())return alert('此功能只有總店創辦人可以設定');
  const kind=String(b.dataset.specialKind||''),meta=specialPersonnelMeta(kind);if(!['engineer','hq'].includes(kind))return;
  dlg(`新增${meta.label}`,`<div class="settings-grid"><label>* 姓名<input id="specialName"></label><label>* 員工編號<input id="specialCode" inputmode="numeric"></label><label>* SC 登入帳號<input id="specialAccount" autocapitalize="none"></label><label>* SC 初始密碼<input id="specialPassword" type="password"></label><label>EOB 登入帳號<input id="specialEobAccount" autocapitalize="none"></label><label>EOB 初始密碼<input id="specialEobPassword" type="password"></label><label>EOB Email<input id="specialEobEmail" type="email"></label><label>通訊電話<input id="specialPhone"></label></div><div class="notice">${meta.label}由總部建檔，可跨店登入、操作與打卡；權限建立後由創辦人在「${meta.label}權限設定」開啟。</div><button class="primary" id="specialSave">儲存</button>`);
  setTimeout(()=>{document.querySelector('#specialSave').onclick=async()=>{const name=specialName.value.trim(),employeeCode=specialCode.value.trim(),account=specialAccount.value.trim().toLowerCase(),password=specialPassword.value,eobAccount=(specialEobAccount.value.trim().toLowerCase()||account),eobPassword=(specialEobPassword.value||password),eobEmail=specialEobEmail.value.trim().toLowerCase();if(!name||!employeeCode||!account||!password)return alert('姓名、員工編號、SC 登入帳號、SC 初始密碼為必填');if(password.length<4)return alert('SC 初始密碼至少 4 碼');const rows=load(K.employees,[]),byAccount=rows.find(x=>String(x.account||'').toLowerCase()===account),byCode=rows.find(x=>String(x.employeeCode||'')===employeeCode);if(byAccount&&byCode&&String(byAccount.id)!==String(byCode.id))return alert(`SC 帳號與員工編號分別已被不同人員使用，請確認後再建立。`);let u=byAccount||byCode||null;const sameKind=x=>kind==='engineer'?!!(x&&(x.isEngineerPersonnel===true||String(x.role||'')==='工程師'||String(x.employmentType||'')==='工程師')):!!(x&&(x.isHeadOfficePersonnel===true||String(x.role||'')==='總部人員'||String(x.employmentType||'')==='總部人員'));if(u&&!sameKind(u)){const who=[u.name,u.employeeCode||u.account,u.role||u.employmentType].filter(Boolean).join('｜');return alert(`${byAccount?'SC 帳號':'員工編號'}已被其他人員使用：${who}`)}let recovered=!!u;if(!u){u={id:uid(),reportDate:new Date().toISOString().slice(0,10),joinDate:new Date().toISOString().slice(0,10)};rows.push(u)}Object.assign(u,{name,employeeCode,account,password,role:meta.label,position:meta.label,employmentType:meta.label,employmentStatus:'在職',active:true,loginEnabled:true,crossStore:true,storeCode:'001',storeName:'總店',contactPhone:specialPhone.value.trim(),eobAccount,eobPassword,eobEmail,eobLoginEnabled:true,isEngineerPersonnel:kind==='engineer',isHeadOfficePersonnel:kind==='hq'});save(K.employees,rows);const all=load(K.permissions,{});if(!all[u.id])all[u.id]={};save(K.permissions,all);localStorage.setItem('yj_employee_master_dirty','1');const warnings=[];if(cloudConfigured()){try{await cloudPushKey(K.employees,rows)}catch(err){warnings.push('SC 人員主檔雲端同步失敗：'+String(err?.message||err))}}if(kind==='engineer'&&cloudConfigured())try{await syncEmployeeCloudAccount(u,eobPassword)}catch(err){warnings.push('工程師 EOB 帳號同步失敗：'+String(err?.message||err))}saveAudit(recovered?`續建${meta.label}`:`新增${meta.label}`,`${u.name}｜${u.employeeCode}｜可跨店`);genericDialog.close();render(meta.page);if(warnings.length)alert(`${meta.label}資料已保留，可在基本資料清單繼續修改。\n\n${warnings.join('\n')}\n\n請修正後再下傳 TM／SC。`);else alert(recovered?`已找到先前未完成的${meta.label}資料並續建完成，請設定權限後下傳 TM／SC。`:`${meta.label}已建立，請設定權限後下傳 TM／SC。`)}},0);return;
 }
 if(b.dataset.action==='save-special-tm-permissions'){
  if(!isHeadOffice()||!isFounder())return alert('特殊人員 TM 權限只有總店創辦人可以設定');
  const id=String(b.dataset.personId||''),kind=String(b.dataset.specialTmKind||''),row=b.closest('[data-special-tm-row]');if(!id||!row)return;
  const all=permissionStore(),next={...(all[id]||{})};
  for(const key of Object.keys(SPECIAL_TM_PERMISSION_ITEMS))next[key]=false;
  row.querySelectorAll('[data-special-tm-perm]').forEach(x=>next[x.dataset.specialTmPerm]=!!x.checked);
  all[id]=next;save(K.permissions,all);
  if(cloudConfigured())try{
   await cloudPushKey(K.permissions,all);
   await cloudPushKey(HQ_SPECIAL_TM_PERMISSIONS_KEY,hqSpecialTmPermissionMap());
   await cloudPushKey(K.employees,load(K.employees,[]));
   const signal={id:uid(),kind:'employee-master',revision:Date.now(),at:new Date().toISOString(),by:currentUser()?.name||'',storeCode:currentStoreCode(),status:'ready'};
   await cloudPushKey(K.masterUpdate,signal)
  }catch(err){alert('TM 權限已儲存，但雲端同步失敗：'+err.message);return}
  localStorage.setItem('yj_employee_master_dirty','1');
  const meta=specialTmPersonnelMeta(kind),u=(meta.rows||[]).find(x=>String(x.id)===id);
  saveAudit(`${meta.label} TM權限設定`,`${u?.name||id}｜已更新`);alert('TM 權限已儲存並同步；各店 TM 收到主檔更新後套用。');render(currentAdminPage());return;
 }
 if(b.dataset.action==='save-special-personnel-permissions'){
  if(!isHeadOffice()||!isFounder())return alert('特殊人員權限只有總店創辦人可以設定');const id=String(b.dataset.personId||''),kind=String(b.dataset.specialKind||''),row=b.closest('[data-special-perm-row]');if(!id||!row)return;const all=permissionStore(),next={...(all[id]||{})};row.querySelectorAll('[data-special-perm]').forEach(x=>next[x.dataset.specialPerm]=!!x.checked);all[id]=next;save(K.permissions,all);const u=specialPersonnelEmployees(kind).find(x=>String(x.id)===id);if(u&&kind==='engineer'&&cloudConfigured())try{await syncEmployeeCloudAccount(u)}catch(err){alert('SC 權限已儲存，但工程師 EOB 權限同步失敗：'+err.message)}if(cloudConfigured())try{await cloudPushKey(K.employees,load(K.employees,[]));await cloudPushKey(K.permissions,all)}catch(_e){}localStorage.setItem('yj_employee_master_dirty','1');saveAudit(`${specialPersonnelMeta(kind).label}權限設定`,`${u?.name||id}｜已更新`);alert('權限已儲存；請下傳 TM 讓各店取得最新主檔。');render(currentAdminPage());return;
 }
 if(b.dataset.action==='save-stocktake-person-permissions'){
  if(!isHeadOffice()||!isFounder())return alert('盤點人員權限只有總店創辦人可以設定');const id=b.dataset.personId,row=b.closest('[data-stocktake-perm-row]');if(!id||!row)return;
  const all=permissionStore(),next={...(all[id]||{})};row.querySelectorAll('[data-stocktake-perm]').forEach(x=>next[x.dataset.stocktakePerm]=!!x.checked);
  // Alpha 4.56：盤點人員只能使用「盤點人員專用」；SC 標準 EOB 盤點永久鎖定。
  next.eobStocktake=false;
  for(const [,k] of STOCKTAKE_SC_GROUP_LABELS)delete next[k];all[id]=next;save(K.permissions,all);await syncStocktakePersonnelRegistry();const u=stocktakePersonnelEmployees().find(x=>String(x.id)===String(id));try{if(u)await syncStocktakePersonnelCloudAccount(u)}catch(err){alert('SC 權限已儲存，但 EOB 雲端權限同步失敗：'+err.message);render(currentAdminPage());return;}saveAudit('盤點人員權限設定',`${id}｜EOB盤點:${!!next.eobStocktake}｜盤點專用:${!!next.eobStocktakePersonnel}｜上傳總部:${!!next.stocktakeUploadHeadOffice}`);alert('盤點人員權限已儲存並同步 EOB');render(currentAdminPage());return;
 }
});
document.addEventListener('input',e=>{if(e.target?.id!=='marketAbnormalSearch')return;const q=String(e.target.value||'').trim().toLowerCase();document.querySelectorAll('[data-market-abnormal-search]').forEach(tr=>tr.hidden=!!q&&!String(tr.dataset.marketAbnormalSearch||'').includes(q));});

// Alpha 4.53：iOS/Safari 偶發同一數字鍵在極短時間內送出多次 beforeinput。
// 僅阻擋同一欄位、同一數字、55ms 內的重複事件；貼上、中文輸入與正常連續按鍵不受影響。
const __yjNumericBeforeInputState=new WeakMap();
document.addEventListener('beforeinput',e=>{
 const el=e.target;
 if(!(el instanceof HTMLInputElement))return;
 if(e.inputType!=='insertText'||!/^[0-9]$/.test(String(e.data||'')))return;
 const now=performance.now(),prev=__yjNumericBeforeInputState.get(el);
 if(prev&&prev.data===e.data&&(now-prev.at)<55){e.preventDefault();return;}
 __yjNumericBeforeInputState.set(el,{data:e.data,at:now});
},true);

document.addEventListener('keydown',e=>{if(e.key!=='Enter'||document.body.dataset.mode!=='front'||!document.querySelector('#cartList'))return;const tag=(e.target?.tagName||'').toLowerCase();if(['input','textarea','select','button'].includes(tag))return;e.preventDefault();openCheckoutDialog();});
setInterval(()=>document.querySelectorAll('[data-clock]').forEach(x=>x.textContent=clock().time),1000);

function adminRuntimeWiringSelfCheck(){
 const issues=[];
 const requiredFunctions=[
  'productLookupPromoActive','orangeOrderingPage','upsertOrangeOrderDraftQty',
  'bindInventoryPage','customerDisplaySettingsPage','saveCustomerDisplaySettingsFromDom',
  'openRevenueReportCenter','printRevenueReport','openEmployeeSettings'
 ];
 for(const name of requiredFunctions){
  if(typeof globalThis[name]!=='function'){
   // module-scoped functions are not on globalThis; evaluate by explicit map below instead.
  }
 }
 const map={
  productLookupPromoActive:typeof productLookupPromoActive,
  orangeOrderingPage:typeof orangeOrderingPage,
  upsertOrangeOrderDraftQty:typeof upsertOrangeOrderDraftQty,
  bindInventoryPage:typeof bindInventoryPage,
  customerDisplaySettingsPage:typeof customerDisplaySettingsPage,
  saveCustomerDisplaySettingsFromDom:typeof saveCustomerDisplaySettingsFromDom,
  openRevenueReportCenter:typeof openRevenueReportCenter,
  printRevenueReport:typeof printRevenueReport,
  openEmployeeSettings:typeof openEmployeeSettings
 };
 Object.entries(map).forEach(([k,v])=>{if(v!=='function')issues.push(k)});
 if(issues.length)console.error('SC wiring self-check missing:',issues);
 else console.info('SC wiring self-check OK');
 return issues;
}

async function mergeMemberM0143946Once(){
 const MIG='yj_merge_M44580538_into_M0143946_v1';
 if(localStorage.getItem(MIG)==='done')return;
 const rows=load(K.members,[]);if(!Array.isArray(rows)||!rows.length)return;
 const code=x=>String(x?.code||x?.memberNo||x?.id||'').trim().toUpperCase();
 const target=rows.find(x=>code(x)==='M0143946'),source=rows.find(x=>code(x)==='M44580538');
 if(!target){console.warn('會員合併：找不到主會員 M0143946');return;}
 if(!source){localStorage.setItem(MIG,'done');return;}
 target.points=Number(target.points||0)+Number(source.points||0);
 target.pointLedger=[...(Array.isArray(target.pointLedger)?target.pointLedger:[]),...(Array.isArray(source.pointLedger)?source.pointLedger:[])];
 for(const k of ['name','phone','email','birthday','address'])if(!target[k]&&source[k])target[k]=source[k];
 target.updatedAt=new Date().toISOString();target.mergedFrom=[...(Array.isArray(target.mergedFrom)?target.mergedFrom:[]),'M44580538'];
 const next=rows.filter(x=>x!==source);save(K.members,next);
 const sales=load(K.sales,[]);let salesChanged=false;
 for(const sale of sales){if([String(source.id||''),String(source.code||''),String(source.memberNo||'')].includes(String(sale.memberId||''))){sale.memberId=target.id;salesChanged=true;}}
 if(salesChanged)save(K.sales,sales);
 saveAudit('會員合併','M44580538 → M0143946；來源會員已刪除');
 try{if(cloudConfigured()){await cloudPushKey(K.members,next);if(salesChanged)await cloudPushKey(K.sales,sales)}}catch(e){console.warn('會員合併雲端同步失敗，已保留本機結果',e)}
 localStorage.setItem(MIG,'done');
}

async function startEnterprise(){
 // Alpha 2.90：雲端初始化不能阻斷整個後台啟動。
 // Supabase 失敗或逾時時，先使用本機資料啟動，登入後再由各頁自行同步。
 let cloudReady=false;
 try{
  await Promise.race([
   cloudBootstrap().then(()=>{cloudReady=true}),
   new Promise((_,reject)=>setTimeout(()=>reject(new Error('Supabase 初始化逾時')),5000))
  ]);
 }catch(err){
  console.warn('cloudBootstrap skipped:',err);
 }
 try{
  seed();
  await mergeMemberM0143946Once();
 }catch(err){
  console.error('seed failed:',err);
 }
 try{
  if('serviceWorker'in navigator){
   navigator.serviceWorker.register('./sw.js?v=v5.5.0-sc-alpha.5.51',{updateViaCache:'none'})
    .then(r=>r.update())
    .catch(err=>console.warn('service worker:',err));
  }
 }catch(err){
  console.warn('service worker unavailable:',err);
 }

 try{
  logout();
  showLogin('back');
  window.__YJ_BOOT_OK=true;
  try{sessionStorage.removeItem('yj_sc_boot_retry_551')}catch(_e){}
 }catch(err){
  console.error('login boot failed:',err);
  app.innerHTML=`<div class="panel render-error-panel"><h2>系統啟動失敗</h2><p>${esc(err?.message||String(err))}</p><button class="button" onclick="location.reload()">重新載入</button></div>`;
 }
 if(!cloudReady)console.warn('SC 已以本機模式啟動，稍後可再同步 Supabase');
 setTimeout(()=>{try{checkSchedules()}catch(err){console.warn('schedule check:',err)}},300);
}
setTimeout(adminRuntimeWiringSelfCheck,0);
startEnterprise().catch(err=>{
 console.error('startEnterprise fatal:',err);
 try{
  seed();
  logout();
  showLogin('back');
  window.__YJ_BOOT_OK=true;
 }catch(e){
  console.error('fallback boot failed:',e);
  setTimeout(()=>window.__yjBootRecover?.('SC 主程式啟動失敗'),100);
 }
});

setInterval(checkFreshExpiryAlerts,60000);
setTimeout(checkFreshExpiryAlerts,1500);


try{
 localStorage.removeItem('yijia_remember_login');
 localStorage.removeItem('rememberLogin');
 localStorage.removeItem('remember_login');
 localStorage.removeItem('rememberUser');
 localStorage.removeItem('lastLoginUser');
}catch(e){}



// Alpha 3.56 TM live-link refresh
document.addEventListener('click',e=>{const b=e.target.closest('[data-action="tm-link-refresh"]');if(b){e.preventDefault();refreshTmLinkPage();}});


document.body.addEventListener('change',e=>{
 if(e.target?.matches?.('[data-perm-dir-key]')){const target=scPermissionTarget();if(target){const key=e.target.dataset.permDirKey;if(['eobStocktake','eobStocktakePersonnel','stocktakeUploadHeadOffice'].includes(key)&&!isFounder()){e.target.checked=false;return alert('盤點人員相關權限只有創辦人可以設定');}if(key&&scPermissionSetLeaf(key,!!e.target.checked))render('permissions');}return;}
 if(e.target?.matches?.('#faceCardSelectAll')){const checked=!!e.target.checked,q=String(window.__yjFaceQuery||'');let cart=faceCartLoad();const visible=(q?faceCardPrintableRows(q):products().filter(p=>cart.ids.includes(String(p.id)))).slice(0,120),selected=new Set(cart.ids.map(String));visible.forEach(p=>{const id=String(p.id);checked?selected.add(id):selected.delete(id);if(!cart.qty[id])cart.qty[id]=1;});cart.ids=[...selected];faceCartSave(cart);render('ordering-face');return;}
 if(e.target?.matches?.('[data-face-card-id]')){const id=String(e.target.dataset.faceCardId||'');if(e.target.checked)faceCartAdd(id,1);else faceCartRemove(id);render('ordering-face');return;}
 if(e.target?.matches?.('[data-face-card-qty]')){const id=String(e.target.dataset.faceCardQty||'');const cart=faceCartLoad();cart.qty[id]=Math.max(1,Math.min(999,Number(e.target.value||1)||1));if(!cart.ids.includes(id))cart.ids.push(id);faceCartSave(cart);return;}
 if(e.target?.id==='permissionDirectoryTarget'){scPermissionTargetId=e.target.value;scPermissionDraft=null;scPermissionDraftTargetId='';render('permissions');}
});
document.addEventListener('keydown',e=>{
 const page=currentAdminPage();
 const catMatch=page.match(/^ordering-(ledger|fos|use|special|group)$/);
 const detailMatch=page.match(/^ordering-(ledger|fos|use|special|group)-detail$/);
 if(catMatch){
  const kind=catMatch[1],groups=scOrderDynamicGroups(kind),max=Math.max(0,groups.length-1);let idx=Number(sessionStorage.getItem(`yj_sc_order_cat_${kind}`)||0);
  if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();idx=Math.max(0,Math.min(max,idx+(e.key==='ArrowUp'?-1:1)));sessionStorage.setItem(`yj_sc_order_cat_${kind}`,String(idx));render(page);return;}
  if(e.key==='Enter'){e.preventDefault();const g=groups[idx]||groups[0];if(!g)return;sessionStorage.setItem(`yj_sc_order_group_code_${kind}`,g?.[0]||'');sessionStorage.setItem(`yj_sc_order_group_${kind}`,g?.[1]||'');goAdminPage(`ordering-${kind}-detail`);return;}
  if(kind==='fos'&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();let w=Number(sessionStorage.getItem('yj_sc_fos_week_offset')||0);w=e.key==='ArrowLeft'?Math.max(-1,w-1):Math.min(0,w+1);sessionStorage.setItem('yj_sc_fos_week_offset',String(w));render(page);return;}
 }
 if(detailMatch){
  const kind=detailMatch[1],code=sessionStorage.getItem(`yj_sc_order_group_code_${kind}`)||'',label=sessionStorage.getItem(`yj_sc_order_group_${kind}`)||'',rows=scOrderGroupProducts(kind,code,label);if(!rows.length)return;let idx=Math.max(0,rows.findIndex(p=>p.id===adminOrderingSelectedProductId));
  if(e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='Enter'){if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)&&e.key!=='Enter')return;e.preventDefault();idx=(idx+(e.key==='ArrowUp'?-1:1)+rows.length)%rows.length;adminOrderingSelectedProductId=rows[idx].id;render(page);return;}
  if(kind==='fos'&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();let w=Number(sessionStorage.getItem('yj_sc_fos_week_offset')||0);w=e.key==='ArrowLeft'?Math.max(-1,w-1):Math.min(0,w+1);sessionStorage.setItem('yj_sc_fos_week_offset',String(w));render(page);return;}
 }
});


document.addEventListener('click',async e=>{const b=e.target.closest('[data-action="eob-find-ring"]');if(!b)return;e.preventDefault();
 const payload={storeCode:currentStoreCode(),storeName:store()?.name||'',at:new Date().toISOString(),by:currentUser()?.name||'',account:currentUser()?.account||'',nonce:'EOBF-'+Date.now()};
 save('yj_eob_find_signal',payload);saveAudit('EOB尋機響鈴',`${payload.storeCode}｜${payload.by}`);
 if(cloudConfigured())try{await adminSendEobFindSignal(payload);alert('EOB 尋機響鈴訊號已送出');}catch(err){alert(`EOB 尋機訊號送出失敗：${err?.message||err}`);}else alert('EOB 尋機訊號已建立；目前未連接雲端。');render(currentAdminPage());
});

document.addEventListener('click',async e=>{const b=e.target.closest('[data-action="ec-service-query-refresh"]');if(!b)return;e.preventDefault();await refreshEcServiceQuery({rerender:true});});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action="cashier-anomaly-refresh"]');if(!b)return;e.preventDefault();cashierAnomalyCloudLoaded=false;await refreshCashierAnomalyCloud({rerender:true});});
document.addEventListener('change',e=>{if(e.target?.id==='ecServiceFilter'){window.__yjEcServiceFilter=e.target.value||'全部';render(currentAdminPage())}});
document.addEventListener('keydown',e=>{if(e.target?.id==='ecServiceSearch'&&e.key==='Enter'){e.preventDefault();window.__yjEcServiceQ=e.target.value||'';render(currentAdminPage())}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action="alcohol-history-refresh"]');if(!b)return;e.preventDefault();if(cloudConfigured())try{await cloudPullKey('yj_alcohol_reminder_state');await cloudPullKey('yj_alcohol_reminder_history')}catch(_e){}render(currentAdminPage());});


// SC Alpha 5.58 - 訂購查詢其餘三頁正式接通
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action="ordering-status-refresh"],[data-action="ordering-group-stats-refresh"]');
 if(!b)return;e.preventDefault();render(currentAdminPage());
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action="ordering-group-stats-print"]');if(!b)return;e.preventDefault();
 const orders=load(K.orders,[])||[],ps=products(),stats=new Map();
 for(const o of orders)for(const it of (o.items||[])){
  const p=ps.find(x=>String(x.id)===String(it.productId))||{},group=String(it.group||p.group||it.category||p.category||'未分類');
  if(!stats.has(group))stats.set(group,{group,orders:new Set(),items:new Set(),qty:0,transmitted:0,amount:0});
  const r=stats.get(group);r.orders.add(String(o.id||''));r.items.add(String(it.productId||it.code||it.name||''));r.qty+=Number(it.qty||0);r.amount+=Number(it.qty||0)*Number(it.price??p.price??0);if(String(o.status||'')==='已傳輸')r.transmitted+=Number(it.qty||0);
 }
 const rows=[...stats.values()].sort((a,b)=>b.qty-a.qty);
 printHTML('品群訂購統計',`<h2>品群訂購統計</h2><table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr><th>品群</th><th>訂購單數</th><th>商品數</th><th>訂購總數</th><th>已傳輸數</th><th>估計金額</th></tr>${rows.map(r=>`<tr><td>${esc(r.group)}</td><td>${r.orders.size}</td><td>${r.items.size}</td><td>${r.qty}</td><td>${r.transmitted}</td><td>${money(r.amount)}</td></tr>`).join('')}</table>`);
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action="ordering-reminder-save"]');if(!b)return;e.preventDefault();
 const date=document.querySelector('#orderingReminderDate')?.value||'',time=document.querySelector('#orderingReminderTime')?.value||'',type=document.querySelector('#orderingReminderType')?.value||'其他',message=document.querySelector('#orderingReminderMessage')?.value?.trim()||'',enabled=document.querySelector('#orderingReminderEnabled')?.value!=='false';
 if(!date||!time)return alert('提醒日期與時間必填');
 if(!message)return alert('請輸入提醒內容');
 const now=new Date().toISOString(),rows=orderingReminderRows();rows.push({id:uid(),date,time,type,message,enabled,user:currentUser()?.name||'',createdAt:now,updatedAt:now});save(ORDERING_REMINDERS_KEY,rows);await syncOrderingRemindersToTm();saveAudit('新增訂購提醒',`${date} ${time}｜${type}｜${message}｜已同步TM`);render(currentAdminPage());
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-ordering-reminder-delete]');if(!b)return;e.preventDefault();
 const id=String(b.dataset.orderingReminderDelete||''),rows=orderingReminderRows(),row=rows.find(x=>String(x.id)===id);
 if(!row)return;if(!confirm('確定刪除這筆訂購提醒？'))return;
 save(ORDERING_REMINDERS_KEY,rows.filter(x=>String(x.id)!==id));await syncOrderingRemindersToTm();saveAudit('刪除訂購提醒',`${row.date||''} ${row.time||''}｜${row.message||''}｜已同步TM`);render(currentAdminPage());
});

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action="ordering-reminder-sync-tm"]');if(!b)return;e.preventDefault();
 b.disabled=true;b.textContent='同步中…';
 try{
  await syncOrderingRemindersToTm();
  saveAudit('訂購提醒同步TM',`${orderingReminderRows().length}筆`);
  alert('訂購提醒已同步到 TM；到達設定時間後，TM 會跳出提醒視窗。');
 }finally{render(currentAdminPage())}
});
// Alpha 5.36：舊版已建立的訂購提醒也自動補同步到 TM。
setTimeout(()=>{if(orderingReminderRows().length)syncOrderingRemindersToTm().catch(()=>{})},1800);

// SC Alpha 5.58 - 訂購明細查詢接通
document.addEventListener('change',e=>{
 if(e.target?.id==='scOrderingDetailQueryDate'){window.__yjScOrderingDetailQueryDate=e.target.value||'';render(currentAdminPage());}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action="ordering-detail-query-refresh"]');
 if(!b)return;
 e.preventDefault();
 render(currentAdminPage());
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action="ordering-detail-query-print"]');
 if(!b)return;
 e.preventDefault();
 const data=orderingDetailQueryData(window.__yjScOrderingDetailQueryDate||'');
 const title=`訂購明細查詢｜${rocDateLabel(data.selected||localDateKey())}`;
 const body=`<h2>${title}</h2><p>商品 ${data.rows.length} 項｜訂購單 ${data.orderCount} 張｜訂購總數 ${data.totalQty}</p><table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><thead><tr><th>序號</th><th>商品代號</th><th>品牌</th><th>商品名稱</th><th>規格</th><th>售價</th><th>入數</th><th>SC訂購總數</th><th>總配送數</th><th>配送別</th><th>訂單狀態</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td>${r.seq}</td><td>${esc(r.code)}</td><td>${esc(r.brand)}</td><td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td>${money(Number(r.price||0))}</td><td>${Number(r.packQty||1)}</td><td>${Number(r.scQty||0)}</td><td>${Number(r.deliveryQty||0)}</td><td>${esc(r.deliveryType)}</td><td>${esc(r.status)}</td></tr>`).join('')||'<tr><td colspan="11">此訂購日期目前沒有訂購明細資料</td></tr>'}</tbody></table>`;
 printHTML(title,body);
});

// SC Alpha 4.58 - 盤點資料上傳總部
let stocktakeHqBusy=false;
document.addEventListener('change',e=>{
 if(e.target?.id==='stocktakeHqSelectAll')document.querySelectorAll('[data-hq-stocktake-id]').forEach(x=>x.checked=e.target.checked);
});
document.addEventListener('click',async e=>{
 const refresh=e.target.closest('[data-action="stocktake-hq-refresh"]');
 if(refresh){e.preventDefault();if(stocktakeHqBusy)return;stocktakeHqBusy=true;refresh.disabled=true;refresh.textContent='讀取中…';try{await refreshEobStocktakeCloud({rerender:false});}finally{stocktakeHqBusy=false;render(currentAdminPage());}return;}
 const upload=e.target.closest('[data-action="stocktake-hq-upload"]');
 if(!upload)return;e.preventDefault();
 if(stocktakeHqBusy)return;
 const ids=[...document.querySelectorAll('[data-hq-stocktake-id]:checked')].map(x=>String(x.dataset.hqStocktakeId||'')).filter(Boolean);
 if(!ids.length)return alert('請先勾選要上傳總部的盤點紀錄');
 if(!confirm(`確定上傳 ${ids.length} 筆盤點資料到總部？\n已上傳的紀錄不會重複送。`))return;
 stocktakeHqBusy=true;upload.disabled=true;upload.textContent='上傳中…';
 try{
  const result=await adminUploadEobStocktakesHq(ids,currentUser()?.name||currentUser()?.account||'SC');
  await refreshEobStocktakeCloud({rerender:false});
  saveAudit('盤點資料上傳總部',`${ids.length} 筆`);
  alert(`已完成上傳總部：${Number(result?.uploaded_count??ids.length)} 筆`);
 }catch(err){alert('上傳總部失敗：'+String(err?.message||err));}
 finally{stocktakeHqBusy=false;render(currentAdminPage());}
});

// SC Alpha 4.28 - EOB盤點重新整理
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action="eob-stocktake-refresh"]');
 if(!b)return;
 e.preventDefault();
 if(eobStocktakeCloudLoading)return;
 b.disabled=true;
 b.textContent='同步中…';
 try{
   await refreshEobStocktakeCloud({rerender:true});
 }finally{
   // 頁面重繪後舊按鈕可能已不存在；若仍存在則恢復。
   if(b&&b.isConnected){b.disabled=false;b.textContent='↻ 重新整理';}
 }
});
