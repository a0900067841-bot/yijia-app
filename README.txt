億家 App v0.8 — SC 後台同步版

讀取 public.yijia_app_state，store_id=001

data_key:
- yj_hq_app_settings
- yj_app_coupons
- yj_app_anybuy_products

App 會直接同步：
- 啟用 App 服務
- 維護模式
- 會員點數同步
- 跨店取／兌換功能
- App 公告
- 億家Pay 當月現金儲值額度
- 優惠券
- 隨買商品

使用順序：
1. Supabase SQL Editor 執行 setup_v0_8.sql
2. 把 index.html 覆蓋 GitHub Pages
3. 重新整理 App
