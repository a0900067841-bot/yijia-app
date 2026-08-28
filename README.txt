億家 App v0.10.15.7 Guide Rights Formal Content Flow

正式接通：
- 隨買跨店取「操作教學」
- 隨買跨店取「權益公告」

App 正式讀取 yijia_app_state：
- store_id = 001
- data_key = yj_app_anybuy_guide
- data_key = yj_app_anybuy_rights

資料格式：
yj_app_anybuy_guide：
[
  {
    "title":"購買隨買商品",
    "description":"說明文字",
    "steps":["步驟1","步驟2","步驟3"],
    "active":true
  }
]

yj_app_anybuy_rights：
[
  {
    "title":"退貨／退款",
    "content":"權益規則文字",
    "active":true
  }
]

若總部尚未建立上述兩個 key：
- App 不會空白
- 會繼續顯示目前內建的正式操作教學 / 權益規則

SC 後續只要開始寫入這兩個 key，App 就會自動切成總部正式內容。
SC App State 每次更新也會即時重新渲染。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
