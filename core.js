import{K,load,save,uid}from'./db.js';
export const currentUser=()=>load(K.session,null);
export const employees=()=>load(K.employees,[]);
function loginStoreCode(){
 const raw=localStorage.getItem('yj_store_no');
 if(raw==null||raw==='')return '001';
 try{return String(JSON.parse(raw)||'001').trim()||'001'}
 catch{return String(raw||'001').replace(/^"|"$/g,'').trim()||'001'}
}
function crossStoreEmployee(x){return !!(x&&(x.crossStore===true||x.isStocktakePersonnel===true||x.isEngineerPersonnel===true||x.isHeadOfficePersonnel===true||['盤點人員','工程師','總部人員'].includes(String(x.role||''))))}
export function login(account,password){
 const storeCode=loginStoreCode();
 const u=employees().find(x=>
  x.active!==false&&x.loginEnabled!==false&&
  (x.role==='創辦人'||crossStoreEmployee(x)||String(x.storeCode||'001')===storeCode)&&
  String(x.account||'').trim()===String(account||'').trim()
 );
 if(!u||String(u.password||'')!==String(password||''))return false;
 save(K.session,{...u,password:undefined,storeCode});
 return true
}
export function logout(){localStorage.removeItem(K.session)}
export function audit(action,detail=''){
 const a=load(K.audit,[]);
 a.unshift({id:uid(),action,detail,user:currentUser()?.name||'未登入',at:new Date().toISOString()});
 save(K.audit,a)
}
