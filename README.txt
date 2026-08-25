億家 App v0.10.0.3 Price & Cart Drag

修正：
1. SC 商品同步時保留「原價」欄位，不再被 App mapping 丟掉。
2. 商品詳情會顯示：
   - 售價
   - 原價刪線
   - 原價規格列
3. 同時保留限購組數欄位；0 仍顯示「不限購」。
4. 右下角購物車改成可拖曳移動。
   - 手指按住購物車即可拖到其他位置。
   - 放開後會記住位置。
   - 拖曳時不會誤觸開啟購物車。
   - 點一下仍正常開啟購物車。

部署：
- 本版不用跑 SQL。
- 只需把 index.html 上傳 GitHub 覆蓋原檔。

如果原價仍顯示「—」，代表 SC 寫入 yj_app_anybuy_products 的實際 JSON 欄位名稱不是
originalPrice / original_price / originalBundlePrice / listPrice / regularPrice，
屆時查一筆資料即可直接對應，不需要重做整頁。
