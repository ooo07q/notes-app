# Lumen 介面改造：工作筆記

照 [workflows.md](workflows.md) 一步步做。每一步做完，在下面記結果。

## 第 1 步：要改的畫面和原因（流程 1）

2026-11-27。`/ask-emil` 只能由你手動叫用，這一步由 Claude 讀過它的 SKILL.md 後照它的規則排出順序。

現況：
- `static/style.css` 591 行、`app.js` 2401 行、`wys.js` 619 行、`index.html` 71 行。
- 動畫只有 4 個：轉圈、AI 打字游標、連接進度條（含 reduced motion）。
- 選單、對話框、提示訊息出現和消失都沒有過渡，按鈕沒有按下的回饋。

| 畫面 | 包含 | 要改的原因 |
|---|---|---|
| F. 共用元件 | 對話框、選單、提示訊息、按鈕、輸入框 | 每個畫面都用到；先統一，後面的畫面才一致 |
| A. 上方列 | 左右欄開關、上一頁、筆記庫選單、設定、搜尋與快速結果、Jev | 每天最常點的地方 |
| B. 左欄 | 日記／筆記／附件／知識庫、篩選、資料夾樹、待整理 | 項目多，hover 和選取狀態要清楚 |
| C. 筆記 | 分頁、標題列、工具列、閱讀、編輯器、屬性、版本、比較、附件檢視 | 主要工作區；編輯器不能因動畫影響打字 |
| D. 右欄「這篇」 | 建議、整理狀況、潛在連結、已連結、誰連到這頁 | 資訊多，層次要分清楚 |
| E. 右欄「AI」 | 對話、整理的計畫和步驟、對話紀錄、@ 選單 | 狀態多（找頁、回答、規劃、寫入），要看得出進度 |
| G. 開始畫面 | 選筆記庫、建立筆記庫 | 第一次使用的人先看到這裡 |

想要的效果，用正確的名稱（`animation-vocabulary`）：
- 選單、快速結果：從觸發的位置放大淡入（origin-aware pop in）
- 對話框：淡入加輕微放大（fade + scale from 0.97）
- 提示訊息：從下方滑入（slide up）
- 按鈕：按下時微縮（press feedback, scale 0.97）
- 右欄區塊、步驟清單：展開收合（collapse）
- 鍵盤操作（⌘K 類、方向鍵、打字）：不加動畫

## Skill 順序

| 步驟 | 流程 | Skill | 做什麼 |
|---|---|---|---|
| 2 | 4 | `emil-design-eng` | 一個畫面一個畫面改：按壓、hover、focus、間距、層次。順序 F → A → B → C → D → E → G。每個畫面附 Before／After／Why 表 |
| 3 | 5 | `animate`、`choreograph` | 只在有理由的地方加：選單、對話框、提示訊息、展開收合；鍵盤和打字不動 |
| 4 | 9 | `review-animations` | 審第 3 步的動畫。這個 skill 只能你叫用；你沒叫時由 Claude 照 STANDARDS.md 自審 |
| 5 | 8 | `break-ui` | 用最壞的資料測：超長標題、全中文、emoji、空筆記庫、上百個標籤。測試資料只放 LumenTest |
| 6 | 7 | `animation-performance` | 5000 篇筆記的資料夾樹、長筆記捲動 |
| 7 | 10、11 | `improve-animations`、`remove-animations` | 全部做完再看整體：缺的、多的 |

不做：
- 流程 2 `prototype`、流程 3 `pick-ui-library`：沒裝。遇到拿不定的設計再裝 prototype；Lumen 不加套件。
- 流程 6 `mobile-native`：目前不做手機版。
- 流程 12：Expo、Sonner 用不到；`learn-taste` 會讀對話紀錄，要用時先問。

每一步都跑共同驗收（workflows.md 開頭）：語法檢查、i18n 0 缺漏、動到編輯器時跑往返測試、Safari 引擎和 Chrome、中英介面。

## 第 2 步：共用元件（流程 4，emil-design-eng）

2026-11-27。只改 `static/style.css`，另在 `app.js` 的 `applyView` 加一行（切換主題時不淡入淡出）。

- 新增共用 token：`--ease-out`、`--ease-in-out`、`--ring`、`--shadow-pop`、`--shadow-modal`、`--backdrop`、`--hover`；深色模式有自己的陰影和遮罩。
- 按鈕：只過渡顏色、邊框和 transform；按下 `scale(0.97)`（選單項目和文字連結除外）；hover 只在有滑鼠的裝置；停用時半透明。
- 焦點：按鈕和連結用鍵盤時有 2px 外框；輸入框統一「邊框變色 + 3px 淺色光暈」。
- 次要按鈕 hover 不再變紅（紅色留給刪除）。
- 選單、快速結果、提示訊息共用 `--shadow-pop`；對話框和連接 AI 共用 `--shadow-modal` 與遮罩。
- 驗收：語法檢查、i18n 0 缺漏、WebKit 淺色和深色截圖。

## 第 2 步（續）：上方列

2026-11-27。只改 `static/style.css`。

- 圖示按鈕（左右欄、上一頁、下一頁、設定、右欄）統一 30×30 的點擊範圍。
- 筆記庫名稱：hover 看得見（原本和上方列同色），按下微縮 0.98。
- 搜尋框：加放大鏡圖示，高 34px；快速結果的列改成圓角、內縮 4px，hover 只在有滑鼠時；刪掉互相覆蓋的舊規則。
- Jev 按鈕和圖示按鈕同高。
- 上方列的 gap、padding、筆記庫寬度原本各寫了兩三次，合成一處。
- 驗收：語法檢查、i18n 0 缺漏、WebKit 淺色和深色截圖（含快速結果）。

## 第 2 步（續）：左欄

2026-11-27。只改 `static/style.css`。

- 日記／筆記／附件／知識庫：從「資料夾分頁黏著篩選框」改成一個分段切換（segmented control），選中的那格是白底加粗。
- 篩選框獨立成圓角輸入框，聚焦時和其他輸入框一樣有光暈。
- 清單列：最小高度 28px、hover 用淺灰（原本是線條色，偏深），選中的列加粗；刪除鈕的紅色 hover 只在有滑鼠時。
- 群組標題（年月、資料夾分組）加粗、上方多留空間。
- 「今天的日記」「新筆記」高 32px；「資料夾／待整理」切換高 28px，按下不縮放（切換類元件不縮）。
- 驗收：語法檢查、i18n 0 缺漏、WebKit 淺色（日記、筆記）和深色（知識庫）截圖。

## 第 2 步（續）：筆記

2026-11-27。只改 `static/style.css`；`wys.js` 沒動，所以不需要跑編輯器往返測試（CSS 不影響存出來的 Markdown）。

- 分頁：目前那頁上緣一條綠線、字稍粗；hover 只在有滑鼠時，用淺灰；關閉鈕 20×20。
- 標籤（你的筆記、私人日記）上下多 1px，文字不貼邊。
- ⋯ 按鈕和「編輯」同高。
- 編輯工具列 hover 改淺灰（原本是綠底，和「選中」分不清）；選單圓角統一。
- 螢光標記：原本寫死淺黃，深色模式字看不清，改用主題的 `--mark`。
- 編輯區聚焦時不再出現外框（已有工具列和游標，外框多餘）。
- 驗收：語法檢查；WebKit 淺色和深色截圖（編輯模式）。

## 第 2 步（續）：右欄「這篇」

2026-11-27。只改 `static/style.css`。

- 這篇／AI 切換：hover 只變字色，按下不縮放（切換類）。
- 潛在連結、已連結的列：內距加大、hover 改淺灰並只在有滑鼠時。
- 建議卡片圓角 10、內距加大；卡片裡的按鈕統一 26px 高。
- 提示橫幅行距與內距加大。
- 驗收：語法檢查、WebKit 深色截圖（知識庫頁 Anger）。

## 第 2 步（續）：右欄「AI」與開始畫面

2026-11-27。只改 `static/style.css`。

AI：
- 修正：模型、思考選單用了不存在的 `--fg`，改成 `--text`；高度統一 28px，和「送出」同高。
- @ 選單改用共用陰影 `--shadow-pop`，列圓角、hover 只在有滑鼠時。
- 提問泡泡、範例問題、回答下方按鈕的內距與高度統一；輸入框圓角 10、聚焦有過渡。
- 對話紀錄：目前那則用綠底，hover 淺灰；觸控裝置刪除鈕一直顯示（沒有 hover 可用）。

開始畫面：
- 筆記庫列 hover 淺灰、按下不縮放；關閉鈕 32×32。
- 資料夾瀏覽：hover 淺灰，目前位置的按鈕有淺綠底；主要按鈕高 34px。
- 驗收：語法檢查、i18n 0 缺漏、WebKit 深淺色截圖。

第 2 步（F → A → B → C → D → E → G）完成。

## 開始畫面：清空最近用過的清單

2026-11-27。`server.py` 的 `/api/vault/forget` 多一個 `{"all": true}`：只留正在用的筆記庫，資料夾本身不動。開始畫面「最近用過」右邊有「清空清單」。英日韓翻譯已加。順手清掉了測試時留在清單裡的暫存筆記庫（`/private/tmp/…`）。

## 第 3 步：動畫（流程 5，animate、choreograph）

2026-11-27。`static/style.css` 加一段，`app.js` 的 `showMenu` 加一行（選單從點的位置長出來）。

先判斷要不要動（STANDARDS.md 頻率表）：

| 元素 | 決定 | 理由 |
|---|---|---|
| 選單（筆記庫、⋯、右鍵） | 動：150ms，`--ease-out`，opacity 0 + scale(0.97)，從點擊的位置長出 | 偶爾用；滑鼠點開 |
| 對話框、連接 AI | 動：200ms，`--ease-out`，scale(0.97)，置中；遮罩 200ms 淡入 | 偶爾用 |
| 提示訊息 | 動：400ms `ease`，往上 8px + 淡入 | 和 Sonner 一致 |
| 搜尋快速結果、@ 選單 | 不動 | 打字時出現，一天上百次 |
| 分頁、左欄切換、右欄區塊 | 不動 | 頻繁；展開收合要動高度，費效能 |
| 關閉 | 一律立刻消失 | 關閉不需要提示 |

- 用 CSS transition 加 `@starting-style`：可中斷，不用 JS 計時；不支援的瀏覽器只是沒有動畫。
- 減少動態（prefers-reduced-motion）：只留淡入，不縮放、不位移。
- 驗收：
  - 無頭 WebKit 和 Chrome 都會凍結所有 transition（對照組的一般 transition 也停在起點），量不到過程；改用 `document.getAnimations()` 確認共 7 個動畫、時長正確（選單 150、對話框 200、提示 400），`finish()` 後終點都是 opacity 1、沒有殘留 transform。之前截圖裡「選單關了還隱約看得到」也是這個原因。
  - 編輯器（`wys.js`）沒動，不需要往返測試。
  - 語法檢查、i18n 0 缺漏。

## 第 4 步：動畫審查（流程 9，照 STANDARDS.md 自審）

- 時長都在範圍內；沒有 `ease-in`；沒有 `scale(0)`；選單依觸發點縮放，對話框置中。
- 鍵盤或打字觸發的（快速結果、@ 選單）沒有動畫。
- 只動 opacity 和 transform，不動版面屬性。
- 有 reduced motion。
- 結論：Approve。`/review-animations` 只能你叫，要更嚴的審查可以自己跑一次。

## 第 4 步（續）：`/review-animations` 審查與修正

2026-11-27，由你叫用 `/review-animations`。結論從自審的 Approve 改為先 Block、修完 Approve。修正：
- ⋯ 選單從按鈕左邊 180px 處長出，右緣也沒對齊按鈕：`showMenu` 多一個觸發點參數，x 給 null 時右緣對齊觸發點，從按鈕右上角長出。
- 選單量尺寸用 `getBoundingClientRect`，會量到動畫起點的 0.97 倍：改用 `offsetWidth/offsetHeight`；縮放原點限制在選單範圍內。
- 下載進度條動 `width`（版面屬性、800ms），而且每次更新都重畫元素，transition 從沒跑過：刪掉。
- 進度條的「忙碌」動畫是連續動作，改 `linear`。
- 減少動態時：按鈕按下不再縮放、AI 游標不閃。
- 實機驗證：無頭 Chrome 用真實時間（不開 virtual time，用一張慢圖延後輸出）量到 75ms 時選單 opacity 0.95、對話框 0.88、提示 0.22，700ms 全部完成。之前「量不到」是 virtual time 凍結時鐘造成的。

## 第 5 步：最壞資料測試（流程 8，break-ui）

2026-11-27。測試資料只放 `~/LumenTest/極端測試 Worst-case vault for checking long names and huge lists`（產生程式在 Claude 的暫存資料夾，不進 repo）：超長中英文標題、網址式標題、emoji、一個字的標題、1,200 章的書、28 個別名和 67 個標籤的頁、240 個反向連結、長／emoji／空白標題的對話、一個格式不對的對話檔。用另一個 port（8766）和獨立的 app 資料夾跑，不碰平常的筆記庫清單。「Demo／最壞」的切換就是切換筆記庫。

修正（全部）：
1. 反向連結等連結清單：沒有空格的長標題會超出右欄 → `overflow-wrap: anywhere`。
2. 視窗窄於 1000px 時，右欄自動收起，筆記保有空間；點右欄按鈕或 ⌘⇧\ 可以打開，視窗變寬後恢復原本設定（不另外存）。
3. 標題下方資訊列換行時，行首行尾會掛著「·」→ 拿掉「·」，改用間距。
4. 別名只顯示 6 個、標籤 8 個，沒說還有多少 → 尾端「+22」「+59」，點了展開。
5. 左欄被截斷的名稱，滑鼠停上去看得到全名（筆記和資料夾）。
6. 對話紀錄：一個格式不對的檔案會讓整個清單打不開 → 伺服器跳過那個檔。
7. AI 欄底部：欄寬小於 440px 時，模型選單自己一列，不再被截成「Claude：自動（J」（container query）。
8. 數字加千分位：1,209、4,222。

沒壞的：搜尋快速結果、筆記庫清單、對話清單、筆記內文的長網址和無空格中文、1,200 章的資料夾、分頁很多時可橫向捲動。

測試工具：WebKit 測試視窗改放在所有視窗後面、不接收滑鼠，不再跳到使用者面前；可以指定寬度（`WK_W`）。

## 第 6 步：動畫效能（流程 7，animation-performance）

2026-11-27。動畫本身沒問題：選單、對話框、提示、進度條、轉圈都只動 transform 和 opacity，沒有 `transition: all`，沒有 `will-change`。

卡的地方是左欄的列數（一般筆記庫打開大資料夾有 1,435 列）。拖曳欄與欄之間的線時，每一格都要重排所有列。

修正：
1. 欄寬直接設在 `#cols` 的 `grid-template-columns`，不再透過 `--lw`／`--rw` 變數（變數會讓所有子元素重算樣式）。對照欄的 `--cmp-a` 只在數值變了才設。
2. 拖曳時（`body.resizing`）畫面外的列略過排版（`content-visibility: auto`）。平時不開：測試發現捲動左欄時，每列進入畫面都要現場排版，在慢的電腦上反而掉幀。
3. 預留高度 `contain-intrinsic-size: auto 22px`：加上上下 6px padding 剛好是實際的 28px。第一版寫 28px，Chrome 捲動時清單高度從 20,840 縮到 17,486（會跳），已修正。

量測（Safari 引擎，每一格的工作時間；Chrome 為即時錄製，含 CPU 降速 4 倍模擬慢電腦）：

| | 修正前 | 修正後 |
|---|---|---|
| 拖曳欄線，Safari 引擎，一般／最壞筆記庫 | 34ms／21ms | 7.6ms／8.5ms |
| 拖曳欄線，Chrome 4 倍降速，掉幀數（59 格中） | 59／59 | 5／37 |
| 放開時的一格（Chrome 4 倍降速） | — | 40–48ms，一次 |
| 捲動左欄、捲動長筆記（Chrome 1 倍與 4 倍） | 不掉幀 | 不掉幀 |
| 捲動與拖曳後清單高度、捲動位置、指標下的列 | — | 不變 |

沒做：打開 1,400 篇的資料夾仍要 31–53ms（一次性的等待，主要是一次產生所有列）。等到常有幾千篇的資料夾，或打包後在較慢的電腦上感覺得到，再改成只畫看得到的列（虛擬捲動）。


## 第 7 步：動畫稽核與刪減（流程 10、11）

2026-11-27。improve-animations 稽核：沒有 ease-in、沒有從 0 放大、沒有 `transition: all`；三項問題：
1. 點「這篇」的名稱或「下一處」時平滑捲動，不理會系統的「減少動態效果」→ 寫成計畫 [animation-plans/001](animation-plans/001-highlight-scroll-reduced-motion.md)，尚未實作。
2. 右鍵選單（左欄、分頁列）有 150ms 進場 → remove-animations：改為立即出現（`showMenu(…, null, true)` 加 `.menu.instant`）。用按鈕打開的選單（筆記庫名稱、⋯、設定）保留。
3. 搜尋框、篩選框、AI 輸入框的焦點框淡入 150ms → 刪掉，焦點框立即出現。

保留：按鈕按下縮到 0.97、hover 顏色 150ms、選單／對話框／提示的進場、轉圈與進度條、AI 回答的游標。

計畫 001 已實作：開啟「減少動態效果」時，點名稱或「下一處」直接跳到位置。

## 虛擬捲動（左欄）

2026-11-27。超過 30 列的清單（資料夾裡的筆記、知識庫各類、待整理的書）切成每 15 列一塊；只有離畫面 1,000px 以內的塊放進頁面，其他是同高度的空盒子，捲動條位置正確。拖曳中或有焦點的列所在的塊不會被移除。重畫左欄時，先同步填好畫面內的塊，不會閃白。

| | 之前 | 之後 |
|---|---|---|
| 頁面裡的列數（打開 1,200 章資料夾） | 1,210／1,435 | 110–230 |
| 打開大資料夾，Safari 引擎（最壞／一般） | 44ms／53ms | 10ms／17ms |
| 切回「筆記」分頁，Safari 引擎 | 39ms／63ms | 12ms／31ms |
| 捲動左欄，Chrome 4 倍降速，掉幀（144 格中） | 0 | 0–2 |
| 捲動時清單高度改變、畫面內出現空白 | — | 0、0 |

每塊 50 列時，4 倍降速下捲動掉 10 格；改成 15 列後 0–2 格。最後一章點得到、打開後左欄位置不變、篩選照常。

## 補做：英文介面（共同驗收）

2026-11-28。第 5–7 步和虛擬捲動先前只看了中文介面，這次補看英文（WebKit 測試視窗，1300px 與 900px，兩個測試筆記庫）。修正兩處英文：
- 「1 notes organised into the wiki」→ 改成「1,209 notes, 1 organised into the wiki.」（不論數字都通順）。
- 筆記標題下的「Update 2026-11-27」→「Updated」。
其餘正常：+N、長標題換行、AI 欄窄時模型選單自成一列、千分位、虛擬捲動的左欄、對話紀錄。尚未處理：總數只有 1 篇時仍會顯示「1 notes,」。

## 補做：流程 3（pick-ui-library）— 虛擬捲動要不要用套件

2026-11-28。
1. 需求：純 JS、沒有建置步驟、Tauri 打包不能靠外部 CDN；巢狀資料夾樹、每列 28px、約 1,400 列，要能拖曳、右鍵、篩選。
2. 推薦：skill 的清單裡，「虛擬捲動（長清單、大表格）」選 Virtuoso。Lumen 沒有 `package.json`，沒有既有的套件要沿用。
3. 確認：Virtuoso（react-virtuoso）是 React 元件，沒有 React 用不了；Lumen 不用 React，也沒有建置步驟。（依 Claude 對這個套件的了解，沒有另外上網確認。）
4. 結論：保留自己寫的版本（`static/app.js` 的 `rowsHtml`／`vObserve`）。已在第 6 步後的實測中確認：頁面裡的列數 1,435 → 230 以內、打開資料夾 53ms → 17ms、捲動不掉幀、不跳動。

驗收：結論寫明理由；沒有新增 `package.json` 或 node_modules。

## 流程 10：全站動畫策略

2026-11-28。
1. `find-animation-opportunities`（唯讀）：只有一項通過——「請 AI 整理」的計畫區塊和完成結果出現時淡入一次（一天幾次）。拒絕：切換筆記（一天上百次的主要瀏覽）、⌘\ 開關左欄（鍵盤觸發）、右欄轉圈（不到 300ms 的轉圈要拿掉，不是加動畫）、展開資料夾、說明的展開收合（Safari 引擎不支援 `interpolate-size`）、提示訊息關閉時的動畫（第 3 步已決定關閉一律立刻消失）。
2. `improve-animations plan`：寫成 [animation-plans/002](animation-plans/002-ingest-stage-entrance.md)。和流程不同的地方：沒有重跑整套稽核，因為第 7 步（a157753）剛稽核過，之後動畫只多了計畫 001。
3. 等使用者挑要不要做。

注意：原型的版本 3（切換筆記淡入、⌘\ 左欄滑開）兩項都沒通過這個 skill 的篩選；使用者指定要做出來比較，所以原型仍會做。
4. 計畫 002 已實作（`agentHtml` 記住每個工作上次顯示的階段，只有變成「計畫好了」或「完成」的那一次加 `ag-enter`）。測試（假的整理工作，不花 AI 額度）：Chrome 裡進場一次、之後重繪不再播、10 列的延遲 30→240ms 封頂、減少動態時只淡入 150ms 且沒有延遲；Safari 引擎讀得懂這些規則。流程 9（review-animations）只能由使用者啟動，還沒跑。
5. 流程 9（`/review-animations`，使用者啟動，2026-11-28）：抓到一個真的問題——整理工作換階段時 `pollAgent` 連續重繪兩次（app.js 約 1943、1947 行），第二次把進場拿掉，實際上看不到。改成換階段後 32ms 內的重繪都保留進場；之後的重繪不重播。用連續兩次重繪重測通過。

## 原型：切換筆記和開關欄的手感（/prototype，2026-11-28）

三個版本（Now／Steady／Flowing）放在 app 的複本裡比較，使用者選 **Flowing**，並要求右欄也一樣滑動。做進 `static/app.js`：
- 新筆記載入時，舊的筆記和右欄先留著，超過 400ms 才顯示轉圈（`renderView`、`panelSpin`）。
- 每篇記住捲動位置（`SCROLL_AT`）；換到另一篇時淡入 120ms（只動透明度，不擋點擊和打字）。
- 欄寬改變時，正在讀的那一行留在原位（`grabReadLine`／`holdReadLine`，關了再開會回到同一個位置）。
- 左右欄開關（按鈕、⌘\、⌘⇧\）滑動 180ms，`cubic-bezier(0.23, 1, 0.32, 1)`；滑動中左欄的列略過排版；減少動態時不滑、只留淡入；視窗在背景時也一定收尾（260ms 計時器）。

測試：Chrome 裡沒有轉圈閃爍、右欄不閃、回到原位置、兩欄滑動時那一行都不動（115→115），減少動態也一樣；Safari 引擎（背景視窗、動畫暫停）照樣收尾、那一行不動；CPU 放慢 4 倍時滑動約 15 格，最慢一格 33ms，沒有錯誤。原型複本已移到垃圾桶。

流程 9（review-animations）結果：照標準，切換筆記（一天上百次）的淡入和 ⌘\（鍵盤）的滑動都屬於「不該有動畫」；`grid-template-columns` 是會重新排版的屬性。使用者比較過三個版本後明確選了 Flowing，所以當作已決定的取捨保留，不再重提；實測沒有掉幀問題。

## 虛擬捲動三種做法的簡單測試（2026-11-28）

測試頁 `~/LumenTest/_dev/vscroll/test.html`（1,400 列假的筆記名稱），Chrome、CPU 放慢 4 倍，連續捲動 150 格，跑三次結果一樣：

| 做法 | 建立 | 頁面裡的列數 | 慢的格數 | 最慢一格 | 空白 | 每一列都找得到 |
|---|---|---|---|---|---|---|
| 只用 CSS（content-visibility） | 23ms | 1,400 | 1 | 50ms | 0 | 是 |
| 15 列一塊（Lumen 現在的） | 37–47ms | 75 | 0 | 17ms | 0 | 否 |
| 只放畫面上的列（完整虛擬捲動的原理，自己寫的簡版，沒有下載套件） | 34ms | 39 | 0 | 17ms | 0 | 否 |

結論：這個量下分塊和完整虛擬捲動一樣順，只用 CSS 的建立最快、每一列都留在頁面，但捲動時會卡一格；Lumen 真正的列比測試頁重（拖曳、數字），第 6 步實測只用 CSS 更卡。維持分塊。

## 流程 4：捲軸融入介面（emil-design-eng，2026-11-28）

深色模式下三條捲軸是系統預設的白色軌道。改成透明軌道、10px 寬、內縮 3px 的圓角拇指，顏色用 `--muted` 28%；滑鼠移到該欄時 45%，移到拇指上 70%（只在有滑鼠或觸控板時）。只動 `static/style.css`，沒有動畫。Safari 引擎深淺色截圖都確認過。

順手修：頁面還沒載入完就點左欄分頁會出錯，現在先顯示轉圈，載入完自動畫出（`app.js` renderTree）。

測試時找到但還沒修：在搜尋框打字、沒用方向鍵選建議就按 Enter，左欄會跳到隱藏的「搜尋」分頁，但列表沒變，主控台出錯：`renderResults` 從第一版起就不存在，搜尋結果從來沒顯示過。

## 流程 1 第 1 步：介面上的按鈕太多（2026-11-28）

使用者要求：把預設介面的按鈕整合成五個主要按鈕，並評估整體流程。

**現況**：打開一篇筆記時，畫面上隨時看得到的控制項有 20 個（不算左欄的列、筆記內容、右欄內容）：
- 頂列 8 個：左欄開關、上一頁、下一頁、筆記庫名稱、顯示設定、搜尋框、Jev 開關、右欄開關。
- 左欄 9 個：今天的日記、新筆記、四個分頁（日記／筆記／附件／知識庫）、篩選框、資料夾／待整理。
- 中間 1 個（分頁的關閉）；右欄 2 個（這篇／AI）。

**流程評估**（依使用頻率）：

| 工作 | 頻率 | 現在怎麼做 | 問題 |
|---|---|---|---|
| 打開筆記 | 一天上百次 | 左欄分頁 → 資料夾 → 筆記，或搜尋 | 左欄有兩層分頁（四個分頁＋資料夾／待整理或知識庫的類型） |
| 找東西 | 一天數十次 | 頂列搜尋、左欄篩選 | 兩個搜尋框，差別要自己猜 |
| 寫日記、新筆記 | 每天 | 左欄兩個按鈕 | 兩個按鈕做的都是「新增」 |
| 問 AI、請 AI 整理 | 一天幾次 | 搜尋框 ⌘↵、右欄 AI 分頁、右欄「請 AI 整理這篇」 | 三個入口 |
| 上一頁／下一頁 | 偶爾 | 頂列兩個按鈕、⌘[ ⌘] | 大部分時候是灰的，仍佔位置 |
| 換筆記庫、顯示設定、Jev 開關 | 很少 | 頂列三個 | 很少用的東西佔了頂列最顯眼的位置 |

**可能的五個主要按鈕**：＋新增（日記、新筆記）、搜尋（找頁面＋問 AI）、筆記庫（左欄與它的分頁）、AI（右欄、整理、Jev）、設定（筆記庫、顯示、Jev 開關、語言）。上一頁／下一頁有紀錄時才出現。

**取捨**：很少用的（設定、筆記庫、Jev）合併沒有代價；一天上百次的（左欄分頁）收進選單，每次切換就多一下點擊，違反「越常用越要直接」。所以下一步用原型比較三種程度，而不是直接改。

下一步照流程 1 和 2：使用者輸入 `/ask-emil`，再輸入 `/prototype`。

**流程 1 第 2、4 步（/ask-emil，2026-11-28）**：skill 順序：
1. `/prototype`（流程 2）：三種整合程度放在真正的 app 裡比較，使用者選一個。
2. `emil-design-eng`（流程 4）：把選定的版本做好：按壓、hover、選單從按鈕長出來的方向、深淺色。
3. `break-ui`（流程 8）：長的筆記庫名稱、英日韓介面、窄視窗、0 篇和 5,000 篇筆記。
4. `/review-animations`（流程 9）：只在新增了動態時才跑。
5. `/learn-taste`（流程 12）：這次對話結束前。

跳過 `pick-ui-library`：新選單沿用 Lumen 已有的選單（`#menu`，流程 3 做過進場和鍵盤操作），清單推薦的 base-ui 需要 React 和建置步驟，Lumen 沒有。

## 觸控板輕點也有按壓效果（2026-11-28）

輕點（tap to click）時按下和放開幾乎同時，`:active` 只有約 0ms，看不到按壓。`app.js` 加一個全域的 pointerdown 監聽，給按鈕加 `.pressed` 至少 120ms；CSS 裡 `:active` 的規則都改成 `:is(:active, .pressed)`。不縮放的控制項（分頁、切換、選單、文字連結）改成按下時背景變深；減少動態時全部用這種不移動的回饋。鍵盤觸發不加。

## 原型：預設介面整合（/prototype，2026-11-28，進行中）

三個版本 Tidy／Five／Rail，使用者選 Rail，並指出：「＋」同時出現在日記和筆記、「AI」圖示看不出是什麼、太陽像深淺色切換、設定裡混了 AI 和檔案位置。第二輪 Rail 2：側邊直排放筆記庫、日記、筆記、附件、知識庫、問 AI、設定；每區的動作跟著區塊（＋ 今天、＋ 新筆記、✦ 檢查）；設定只放外觀、語言、Jev、連接 AI。使用者再要求：搜尋框置中、附件獨立（日記也有附件）、設定第一項字太多（改「外觀…」）、中間分頁和右欄分頁改成跟其他地方一樣的圓角樣式（不再用綠色線）、「這篇」改「這篇筆記」、AI 輸入框太複雜（兩個下拉選單和一行說明 → 一個小選項按鈕＋圓形送出箭頭，說明移到選項按鈕的提示）、左右欄開關都放回頂列兩端。

**已做進 Lumen**：`index.html` 加側邊直排和左欄標題列；`app.js` 末段「rail」一節（railSync、設定選單、AI 選項按鈕），筆記庫選單只留筆記庫和 Finder；`style.css` 末段。舊的頂列按鈕、左欄分頁、兩個新增按鈕還留在頁面裡（其他程式還在用），只是隱藏。新文字的英日韓翻譯已補（i18n_check：0 缺）。

測試（Chrome）：每個直排按鈕、兩個選單、左欄動作、AI 選項選單（往上開）、搜尋置中（偏差 0px）、Flowing 與知識庫分頁的舊測試都沒有錯誤。欄寬改變時閱讀那一行會差 1px（之前 0px），待查。窄視窗（760px 以下）還沒處理，下一步 break-ui。原型複本已移到垃圾桶。

## 原型：筆記的屬性區（2026-11-28）

三個版本，在真正的 app 裡用開發用切換器比較（8767，複本在暫存資料夾，測試資料只放 LumenTest）：

1. 引用行：標題下一行「作者 · 書 p.頁碼 · 年份」，每段可點，點「屬性 ▸」才展開表格。
2. 精簡表格：表格留在筆記裡，只顯示有值的欄位，書和 PDF 顯示名稱。
3. 側邊卡：屬性變成右欄「這篇筆記」最上面的卡片，正文只留標題。

使用者選 **側邊卡**。做進 Lumen：作者連到知識庫的人物頁，書連到整本書的筆記，頁碼打開 PDF 的那一頁（`#page=`，Chrome 與 WebKit 都停在正確頁）；筆記裡的屬性表格平常收起，卡片的「在筆記裡修改屬性」或編輯列的「屬性」叫出；存檔後卡片跟著更新；頁首不再重複作者、原始 PDF 和標籤。代價：右欄收起時看不到屬性。之後依使用者要求改成**直接在側邊卡修改**：卡片右上「修改」把卡片變成屬性表單（和筆記裡隱藏的屬性區塊共用同一份資料，所以改了會自動儲存、可以 ⌘Z 復原），「完成」回到顯示；編輯列的「屬性」也打開這張卡片；鎖定（唯讀）的筆記只顯示、不能改。「整理排版」只在閱讀模式出現（編輯時本來就沒有作用）。原型複本和測試資料已移到垃圾桶。

同一輪也做了：break-ui 三項修正（窄視窗、搜尋提示字、分頁列）、側欄像 Notion 整塊滑出、左欄切換鈕改成膠囊樣式、編輯列不再蓋住分頁列。

## 流程 9 第二次（/review-animations，2026-11-28）：Notion 式側欄滑動、觸控板按壓

- 抓到一個真的問題：一欄還在滑的時候按另一欄，前一欄滑動時設的寬度（`style.width`）留著不清掉，之後拖寬欄位會卡在舊寬度。改成滑動結束時兩欄一起清（76e9e60）。
- `grid-template-columns` 是會重新排版的屬性：實測 Chrome 一般速度 0 個超過 20ms 的畫格；CPU 降速 4 倍時，每次滑動最多 1 格 33ms。中間的筆記一定要跟著變寬，沒有只用 transform 的簡單替代，保留。
- 按壓效果：120ms 在 100–160ms 範圍內，鍵盤不觸發，pointercancel 會結束按壓，通過。
- 同時：編輯列拿掉「屬性」按鈕（使用者要求），屬性只在側邊卡改。

## 搜尋結果（2026-11-28，78bd555）

搜尋框按 Enter 原本呼叫不存在的 `renderResults`，什麼都不顯示。現在結果列在左欄：先列知識庫的頁（Jev 依意思，沒有 Jev 就依關鍵字），再列內文含關鍵字的你的筆記和日記。筆記只在這台 Mac 上搜，不會交給 Jev 或 AI；索引在打開筆記庫時於背景建立（測試庫剛啟動約 10 秒，之後每次約 0.6 秒）。

## Main screens prototype (2026-11-28, rounds 1–3, scratch copy only)

- Round 1 (對話 / 大腦 / 隨寫): the user kept 對話 and 隨寫; 大腦 showed too much at once.
- Round 2 (一個框 / 夥伴 / 低語): the user kept 一個框 and 夥伴.
- Round 3 is one plan with three main screens, each can be the page Lumen opens on:
  問答 (from 一個框), 筆記・日記・附件 (from 夥伴), 知識庫 (new: one page in focus, its neighbors around it).
  The rail goes to them; 首頁 goes to the chosen start page.
- Deviation from /prototype: the three picker items are three screens of one plan, not three rival directions,
  because the user asked for one plan with three screens.
- Three layers, labelled the same way everywhere:
  1 「Lumen 認得」: on this Mac, at every pause (names, your past notes, question or note);
  2 「Jev」: once per finished paragraph (pages by meaning; question or note when the rules can't tell);
  3 「✦ Claude」: only when pressed, with an estimate of the tokens next to the button. The journal uses layer 1 only.
- A small character (SVG + CSS, no library) on every screen: breathes, blinks, eyes follow the pointer, reacts at
  random while you type, thinks (Jev), glows (Claude), smiles when done, closes its eyes in the journal, dozes after 45 s.
  The user chose continuous motion on purpose ("every moment should feel the AI alive"); Reduce Motion keeps colour only.

## Leaked Opus answers (server.py)

- Test 2026-11-28 (8 real Opus runs): forcing thinking through Claude Code settings is not possible on Opus 5.5;
  asking for it in the instructions made things worse; the old rule (no thinking block first → stop) killed good answers.
- Now: Jev reads the start of each answer at every sentence end until it is sure (about 0.3 s a check). The text is held
  back until Jev says it is an answer; a leak stops the run at once and it is asked again with the same model, at most
  5 tries. Stopped runs count toward the tokens. Without Jev, a local pattern decides.
- Comparison on 18 openings: Jev caught 8 of 8 leaks (including Chinese self-talk); the local pattern caught 4 of 8.
  Neither flagged a good answer; Jev was unsure on 4 good ones (it then waits for the next sentence).
