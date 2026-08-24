億家 App v0.9.4 — 億家Pay + 退貨

新增：
1. 結帳付款方式：
   - 億家Pay 錢包
   - 億家Pay 綁定信用卡
   - 店舖結帳
2. 我的商品退貨：
   - 完全未兌換才顯示退貨
   - 有兌換過任何數量即不可退貨
   - 付款/購買完成後 7 天內才可申請
   - 超過 7 天 App 不顯示退貨按鈕
   - 店舖結帳只能回原付款門市
3. 退貨申請共用：
   HQ / yj_app_return_requests

億家Pay資料：
HQ / yj_app_yijiapay_wallets
HQ / yj_app_payment_methods
HQ / yj_app_yijiapay_orders

重要：
信用卡正式綁卡/扣款不能直接把卡號或CVV存進 Supabase。
需接合法金流服務商，由服務商回傳 token，再由後端完成正式扣款。
目前 App 已完成付款方式 UI、安全 RPC、訂單建立與退貨流程；真正信用卡/錢包扣款仍需下一步接支付服務。

更新：
1. Supabase SQL Editor 執行 setup_v0_9_4_pay_return.sql
2. GitHub yijia-app 覆蓋 index.html
