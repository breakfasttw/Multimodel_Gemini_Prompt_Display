// all_video.js
import { APP_CONFIG } from "./config.js";
import {
    cleanHeader,
    splitCsvRow,
    stripCsvValue,
    splitCsvText,
    parseCsvObjectRows,
    parseCsvBoolean,
    parseFlexibleArrayTokens,
    flexibleTokensInclude,
    parseNumberOrDefault,
    truncateText,
    yieldToBrowser,
    runAfterFirstPaint,
    cssEscape,
} from "./all_video_utils.js";
import { renderVideoDashboard } from "./all_video_dashboard.js";

const container = document.getElementById("cluster-container");

// ==========================================
// 原本資料狀態
// ==========================================
let influencerData = [];
let nameMapping = {}; // 儲存 ig_id / tag_id -> person_name 的對照
let cachedDetails = {}; // 快取已下載的網紅影片詳情：{ ig_id: mergedJson }

// ==========================================
// 搜尋 / 篩選功能狀態
// ==========================================
let globalMediaData = []; // all_infleuncer_media_id.csv 解析後的全量影片資料
let mediaIdIndex = new Map(); // media_id -> media record，用於模式 1 O(1) 搜尋
// json_description_summary.csv 解析後的影片描述摘要資料。
let jsonDescriptionSummaryData = []; // 目前用於 endorsement 篩選，未來可繼續擴充其他 description 欄位。
let isJsonDescriptionSummaryLoaded = false; // 摘要 CSV 是否已成功載入。
let jsonDescriptionSummaryLoadPromise = null; // 避免短時間內重複 fetch 同一份摘要 CSV。
let jsonDescriptionSummaryLoadError = null; // 保留載入錯誤，避免資料載入失敗後仍誤以為是查無結果。
let isFilterActive = false; // 是否正在套用模式 2 條件篩選
let matchedMediaIds = new Set(); // 模式 2：符合條件的 media_id
let matchedInfluencerIds = new Set(); // 模式 2：符合條件的 post_owner.username；對應 influencer_all_info.csv 的 ig_id
let activeFilterMode = null; // 篩選模式："video" 代表影片層級篩選；"category" 代表網紅類別篩選

// 分群欄位設定與空值常數
const UNCLUSTERED_LABEL_VALUE = "__unclustered__";
const UNCLUSTERED_LABEL_TEXT = "未分群";

const CLUSTER_FILTER_CONFIG = {
    visual_kmeans_labels: {
        label: "Visual",
        column: "visual_kmeans_labels",
        selectId: "filter-visual-cluster-select",
    },
    audio_kmeans_labels: {
        label: "Audio",
        column: "audio_kmeans_labels",
        selectId: "filter-audio-cluster-select",
    },
};

// ==========================================
// 效能優化：模組層級快取
// ==========================================
let isBaseDataLoaded = false; // influencer_all_info.csv + ownerid_mapping.csv 是否已載入
let baseDataLoadPromise = null; // 避免短時間重複呼叫 renderVideoView 時重複 fetch

let isGlobalMediaDataLoaded = false; // all_infleuncer_media_id.csv 是否已載入
let globalMediaDataLoadPromise = null; // 避免搜尋 / 篩選時重複 fetch
let globalMediaDataLoadError = null; // 背景載入失敗時保留錯誤訊息

let cachedVideoViewHTML = ""; // 保存 Videos 頁籤目前 DOM，用於切回頁籤時還原
let videoSnapshotObserver = null; // 監聽 Videos DOM 變化，自動更新 cachedVideoViewHTML
let videoSnapshotTimer = null; // 避免 MutationObserver 連續觸發時大量 outerHTML 序列化

let videoCsvCache = {}; // 快取第二層單一網紅影片 CSV 解析結果：{ ig_id: videos[] }

/**
 * 核心進入點：渲染網紅列表視圖。
 *
 * 效能優化重點：
 * 1. 第一次進入 Videos：只等待必要資料，也就是 influencer_all_info.csv 與 ownerid_mapping.csv。
 * 2. all_infleuncer_media_id.csv 改成背景載入，不阻塞初始畫面。
 * 3. 從其他頁籤切回 Videos：若已有 cachedVideoViewHTML，直接還原 DOM，不重新 fetch / parse / render。
 */
export async function renderVideoView() {
    // 若先前已經渲染過 Videos，而且 DOM 快照存在，直接還原。
    // 這樣從 Cluster / Contents 切回 Videos 時，不會重新載入，也不會重置展開狀態。
    if (cachedVideoViewHTML && isBaseDataLoaded) {
        container.innerHTML = cachedVideoViewHTML;

        syncHeaderMediaIdSearch();

        // innerHTML 還原後，addEventListener 綁定會消失，因此需要重新綁定搜尋 / 篩選 UI。
        bindSearchEvents();

        // innerHTML 還原後，to top 按鈕事件也會消失，因此需要重新綁定。
        bindVideoTopButton();

        // 重新啟動 DOM 快照監聽，確保後續展開手風琴、篩選、搜尋後都能保存狀態。
        startVideoDomSnapshotObserver();

        // 若全量 media 資料尚未完成，繼續背景載入。
        loadGlobalMediaDataInBackground();

        return;
    }

    container.innerHTML = `<div class="p-10 text-center animate-pulse text-slate-500 font-mono">LOADING INFLUENCER DATA...</div>`;

    try {
        // 第一次進入只等待必要資料，讓 200 個網紅手風琴先顯示。
        await loadBaseVideoData();

        // 第一次進入 Videos 時，回到初始搜尋狀態。
        resetSearchStateOnly();

        renderMainLayout();
        startVideoDomSnapshotObserver();

        // 全量 media_id 對照表改成背景載入，不阻塞第一畫面。
        loadGlobalMediaDataInBackground();
    } catch (err) {
        console.error("[VideoView 渲染出錯]", err);
        container.innerHTML = `<div class="p-10 text-red-400">載入失敗: ${err.message}</div>`;
    }
}

/**
 * 載入 Videos 第一畫面必要資料。
 *
 * 只包含：
 * - influencer_all_info.csv
 * - ownerid_mapping.csv
 *
 * 不包含 all_infleuncer_media_id.csv，因為初始畫面不需要用到它。
 */
async function loadBaseVideoData() {
    if (isBaseDataLoaded) return;

    if (baseDataLoadPromise) {
        await baseDataLoadPromise;
        return;
    }

    baseDataLoadPromise = (async () => {
        const [infRes, mapRes] = await Promise.all([
            fetch(APP_CONFIG.DATA_PATHS.all_influencers),
            fetch(APP_CONFIG.DATA_PATHS.ig_names),
        ]);

        if (!infRes.ok) throw new Error("找不到 influencer_all_info.csv");
        if (!mapRes.ok) throw new Error("找不到 ownerid_mapping.csv");

        const infText = await infRes.text();
        const mapText = await mapRes.text();

        // 避免熱重載或重複呼叫時殘留舊資料。
        nameMapping = {};
        influencerData = [];

        parseNameMapping(mapText);
        parseInfluencerData(infText);

        isBaseDataLoaded = true;
    })();

    try {
        await baseDataLoadPromise;
    } finally {
        baseDataLoadPromise = null;
    }
}

/**
 * 背景載入 all_infleuncer_media_id.csv。
 *
 * 載入期間搜尋 / 篩選區塊顯示 loading。
 * 載入完成後自動換回正式搜尋 / 篩選 UI。
 */
function loadGlobalMediaDataInBackground() {
    // 若已載入完成，直接確保畫面是正式表單。
    if (isGlobalMediaDataLoaded) {
        refreshSearchFilterPanel();
        return;
    }

    // 只要還沒完成，就確保目前顯示 loading panel。
    refreshSearchFilterPanel();

    // 不要在第一層手風琴剛 render 完就立刻解析大型 CSV。
    // 先讓瀏覽器完成 paint 與使用者點擊事件，再利用 idle time 背景載入。
    runAfterFirstPaint(() => {
        ensureGlobalMediaDataLoaded({ showMessage: false })
            .then(() => {
                refreshSearchFilterPanel();
            })
            .catch((err) => {
                console.warn(
                    "[背景載入 all_infleuncer_media_id.csv 失敗]",
                    err,
                );
                refreshSearchFilterPanel();
            });
    });
}

/**
 * 確保 all_infleuncer_media_id.csv 已載入。
 *
 * 搜尋與篩選會 await 這個函式。
 * 若背景資料尚未完成，會等待同一個 globalMediaDataLoadPromise，
 * 不會重複 fetch。
 */
async function ensureGlobalMediaDataLoaded({ showMessage = false } = {}) {
    if (isGlobalMediaDataLoaded) return;

    if (globalMediaDataLoadError) {
        throw globalMediaDataLoadError;
    }

    if (globalMediaDataLoadPromise) {
        if (showMessage) setSearchMessage("搜尋資料載入中，請稍候...", "info");
        await globalMediaDataLoadPromise;
        if (showMessage) clearSearchMessage();
        return;
    }

    if (showMessage) setSearchMessage("搜尋資料載入中，請稍候...", "info");

    globalMediaDataLoadPromise = (async () => {
        try {
            const mediaRes = await fetch(
                APP_CONFIG.DATA_PATHS.all_media_ids ||
                    "./input/all_infleuncer_media_id.csv",
            );

            if (!mediaRes.ok) {
                throw new Error("找不到 all_infleuncer_media_id.csv");
            }

            const mediaText = await mediaRes.text();

            // 關鍵修正：
            // 使用 async 分批解析，避免長時間佔用主執行緒，讓下方手風琴仍可互動。
            await parseGlobalMediaData(mediaText);

            isGlobalMediaDataLoaded = true;
            globalMediaDataLoadError = null;
        } catch (err) {
            globalMediaDataLoadError = err;
            throw err;
        }
    })();

    try {
        await globalMediaDataLoadPromise;
    } finally {
        globalMediaDataLoadPromise = null;
        if (showMessage) clearSearchMessage();

        // 成功：loading -> 正式表單
        // 失敗：loading -> 錯誤提示
        refreshSearchFilterPanel();
    }
}

/**
 * 解析 influencer_all_info.csv。
 */

function parseInfluencerData(infText) {
    influencerData = parseCsvObjectRows(infText)
        .filter((item) => item.ig_id)
        .sort(
            (a, b) =>
                parseInt(a.Aisa_Order || 999, 10) -
                parseInt(b.Aisa_Order || 999, 10),
        );
}

/**
 * 解析 Mapping CSV。
 */
function parseNameMapping(csvText) {
    const rows = splitCsvText(csvText);

    if (rows.length < 2) {
        return;
    }

    const headers = rows[0].split(",").map(cleanHeader);
    const idIdx = headers.indexOf("ig_id");
    const tagIdIdx = headers.indexOf("tag_id");
    const nameIdx = headers.indexOf("person_name");

    if (nameIdx === -1) {
        console.warn("ownerid_mapping.csv 缺少 person_name 欄位");
        return;
    }

    rows.slice(1).forEach((row) => {
        const cols = splitCsvRow(row).map(stripCsvValue);
        const name = cols[nameIdx];

        if (!name) {
            return;
        }

        if (idIdx !== -1 && cols[idIdx]) {
            nameMapping[cols[idIdx]] = name;
        }

        if (tagIdIdx !== -1 && cols[tagIdIdx]) {
            nameMapping[cols[tagIdIdx]] = name;
        }
    });
}

/**
 * 解析 all_infleuncer_media_id.csv。
 */
async function parseGlobalMediaData(csvText) {
    const rows = splitCsvText(csvText);

    if (rows.length < 2) {
        globalMediaData = [];
        mediaIdIndex = new Map();
        return;
    }

    const headers = rows[0].split(",").map(cleanHeader);
    const ownerIdx = headers.indexOf("post_owner.username");
    const mediaIdx = headers.indexOf("media_id");
    const commentIdx = headers.indexOf("statistics.comment_count");
    const likeIdx = headers.indexOf("statistics.like_count");
    const durationIdx = headers.indexOf("duration");
    const createIdx = headers.indexOf("creation_time_tw");
    const modifyIdx = headers.indexOf("modified_time_tw");

    if (ownerIdx === -1 || mediaIdx === -1) {
        console.error("all_infleuncer_media_id.csv 缺少必要欄位", headers);
        globalMediaData = [];
        mediaIdIndex = new Map();
        return;
    }

    const parsed = [];
    const nextMediaIdIndex = new Map();
    const dataRows = rows.slice(1);

    // 每批處理筆數。
    // 若你覺得仍然卡，可以改小，例如 100。
    // 若你覺得載入太慢，可以改大，例如 500 或 1000。
    const CHUNK_SIZE = 200;

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const cols = splitCsvRow(row);

        const item = {
            owner_ig_id: stripCsvValue(cols[ownerIdx]),
            media_id: stripCsvValue(cols[mediaIdx]),
            comment_count: parseNumberOrDefault(cols[commentIdx]),
            like_count: parseNumberOrDefault(cols[likeIdx]),
            duration: parseNumberOrDefault(cols[durationIdx]),
            creation_time_tw: stripCsvValue(cols[createIdx]),
            modified_time_tw: stripCsvValue(cols[modifyIdx]),
        };

        if (item.owner_ig_id && item.media_id) {
            parsed.push(item);
            nextMediaIdIndex.set(String(item.media_id), item);
        }

        if (i > 0 && i % CHUNK_SIZE === 0) {
            await yieldToBrowser();
        }
    }

    globalMediaData = parsed;
    mediaIdIndex = nextMediaIdIndex;
}

function normalizeClusterLabel(value) {
    const normalized = stripCsvValue(value).trim();

    if (
        !normalized ||
        normalized.toLowerCase() === "null" ||
        normalized.toLowerCase() === "none"
    ) {
        return UNCLUSTERED_LABEL_VALUE;
    }

    return normalized;
}

function renderClusterLabelOptions(columnName) {
    const labels = [
        ...new Set(
            jsonDescriptionSummaryData.map((item) =>
                normalizeClusterLabel(item[columnName]),
            ),
        ),
    ];

    labels.sort((a, b) => {
        if (a === UNCLUSTERED_LABEL_VALUE) return 1;
        if (b === UNCLUSTERED_LABEL_VALUE) return -1;

        const numA = Number(a);
        const numB = Number(b);

        if (Number.isFinite(numA) && Number.isFinite(numB)) {
            return numA - numB;
        }

        return String(a).localeCompare(String(b), "zh-Hant");
    });

    return labels
        .map((label) => {
            const text =
                label === UNCLUSTERED_LABEL_VALUE
                    ? UNCLUSTERED_LABEL_TEXT
                    : label;

            return `<option value="${label}">${text}</option>`;
        })
        .join("");
}

/**
 * 解析 json_description_summary.csv。
 *
 * 預期欄位：
 * - influencer
 * - json_name
 * - media_id
 * - is_endorsement
 * - endorsement_method
 *
 * endorsement_method 會透過 parseFlexibleArrayTokens() 轉成
 * 可直接進行大小寫無關比對的小寫 token 陣列。
 *
 * 例如：
 * ["Implicit","Integrated"]
 *
 * 會轉為：
 * ["implicit", "integrated"]
 */

function parseJsonDescriptionSummary(csvText) {
    const rows = splitCsvText(csvText);

    if (rows.length < 2) {
        jsonDescriptionSummaryData = [];
        return;
    }

    const headers = rows[0].split(",").map(cleanHeader);

    const influencerIdx = headers.indexOf("influencer");
    const jsonNameIdx = headers.indexOf("json_name");
    const mediaIdIdx = headers.indexOf("media_id");
    const endorsementIdx = headers.indexOf("is_endorsement");
    const endorsementMethodIdx = headers.indexOf("endorsement_method");
    const visualClusterIdx = headers.indexOf("visual_kmeans_labels");
    const audioClusterIdx = headers.indexOf("audio_kmeans_labels");

    const missingHeaders = [];

    if (influencerIdx === -1) missingHeaders.push("influencer");
    if (mediaIdIdx === -1) missingHeaders.push("media_id");
    if (endorsementIdx === -1) missingHeaders.push("is_endorsement");
    if (endorsementMethodIdx === -1) missingHeaders.push("endorsement_method");
    if (visualClusterIdx === -1) missingHeaders.push("visual_kmeans_labels");
    if (audioClusterIdx === -1) missingHeaders.push("audio_kmeans_labels");

    if (missingHeaders.length > 0) {
        throw new Error(
            `json_description_summary.csv 缺少必要欄位：${missingHeaders.join(", ")}`,
        );
    }

    const parsedData = [];
    let invalidBooleanCount = 0;

    rows.slice(1).forEach((row) => {
        const cols = splitCsvRow(row);

        const influencer = stripCsvValue(cols[influencerIdx]);
        const jsonName =
            jsonNameIdx !== -1 ? stripCsvValue(cols[jsonNameIdx]) : "";
        const mediaId = stripCsvValue(cols[mediaIdIdx]);
        const isEndorsement = parseCsvBoolean(cols[endorsementIdx]);
        const endorsementMethodTokens = parseFlexibleArrayTokens(
            cols[endorsementMethodIdx],
        );

        if (!influencer || !mediaId) {
            return;
        }

        if (isEndorsement === null) {
            invalidBooleanCount++;
            return;
        }

        parsedData.push({
            influencer,
            json_name: jsonName,
            media_id: String(mediaId),
            is_endorsement: isEndorsement,
            endorsement_method_tokens: endorsementMethodTokens,
            visual_kmeans_labels: normalizeClusterLabel(cols[visualClusterIdx]),
            audio_kmeans_labels: normalizeClusterLabel(cols[audioClusterIdx]),
        });
    });

    jsonDescriptionSummaryData = parsedData;

    if (invalidBooleanCount > 0) {
        console.warn(
            `[json_description_summary.csv] 有 ${invalidBooleanCount} 筆 is_endorsement 無法辨識，已排除。`,
        );
    }
}

/**
 * 確保 json_description_summary.csv 已載入。
 *
 * 採用 lazy loading：
 * - 不增加 Videos 初始載入時間。
 * - 第一次使用 endorsement 篩選時才 fetch。
 * - 成功載入後保留在記憶體中，後續不會重複 fetch。
 */
async function ensureJsonDescriptionSummaryLoaded({
    showMessage = false,
} = {}) {
    if (isJsonDescriptionSummaryLoaded) {
        return;
    }

    if (jsonDescriptionSummaryLoadError) {
        throw jsonDescriptionSummaryLoadError;
    }

    if (jsonDescriptionSummaryLoadPromise) {
        if (showMessage) {
            setSearchMessage("計算中，請稍候...", "info");
        }

        await jsonDescriptionSummaryLoadPromise;

        if (showMessage) {
            clearSearchMessage();
        }

        return;
    }

    if (showMessage) {
        setSearchMessage("計算中，請稍候...", "info");
    }

    jsonDescriptionSummaryLoadPromise = (async () => {
        try {
            const response = await fetch(
                APP_CONFIG.DATA_PATHS.json_description_summary ||
                    "./data/json_description_summary.csv",
            );

            if (!response.ok) {
                throw new Error("找不到 json_description_summary.csv");
            }

            const csvText = await response.text();
            parseJsonDescriptionSummary(csvText);

            isJsonDescriptionSummaryLoaded = true;
            jsonDescriptionSummaryLoadError = null;
        } catch (err) {
            jsonDescriptionSummaryLoadError = err;
            throw err;
        }
    })();

    try {
        await jsonDescriptionSummaryLoadPromise;
    } finally {
        jsonDescriptionSummaryLoadPromise = null;

        if (showMessage) {
            clearSearchMessage();
        }
    }
}

/**
 * 渲染主 Layout。
 */
function renderMainLayout() {
    container.innerHTML = `
    <div id="video-view-root" class="w-full p-6 space-y-6">
        ${renderSearchFilterPanel()}
        <div id="influencer-list-container"></div>

        <button id="btn-video-to-top" class="video-to-top-btn" type="button" title="回到頂部" aria-label="回到頂部">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M5 15l7-7 7 7"></path>
            </svg>
        </button>
    </div>`;

    syncHeaderMediaIdSearch();

    if (isGlobalMediaDataLoaded) {
        bindSearchEvents();
    }

    bindVideoTopButton();

    renderInfluencerList();
    cacheVideoViewSnapshot();
}

/**
 * 渲染上方搜尋 / 篩選區塊。
 */
function renderHeaderMediaIdSearch() {
    return `
        <div id="header-media-id-search" class="ml-auto flex flex-wrap items-center justify-end gap-3">
            <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                <span class="text-sm font-bold text-slate-300">Media ID 搜尋</span>
            </div>
            <input type="text" id="search-media-id" placeholder="請輸入完整的 media_id"
                class="bg-slate-900 border border-slate-700/80 rounded-lg px-4 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition w-64 font-mono">
            <button id="btn-mode1-search" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-5 py-1.5 rounded-lg font-medium transition shadow-md shadow-blue-900/20">搜 尋</button>
        </div>`;
}

function syncHeaderMediaIdSearch() {
    const existingSearch = document.getElementById("header-media-id-search");

    if (!isGlobalMediaDataLoaded || globalMediaDataLoadError) {
        existingSearch?.remove();
        return;
    }

    if (existingSearch) {
        existingSearch.outerHTML = renderHeaderMediaIdSearch();
        return;
    }

    const header = document.querySelector("body > header");
    if (!header) return;

    header.insertAdjacentHTML("beforeend", renderHeaderMediaIdSearch());
}
function renderSearchFilterPanel() {
    if (globalMediaDataLoadError) {
        return `
        <div id="search-filter-panel" class="bg-slate-950/60 border border-rose-800/80 rounded-xl p-5 shadow-xl backdrop-blur-md">
            <div class="flex items-center gap-4">
                <div class="w-5 h-5 rounded-full border-2 border-rose-500/30 border-t-rose-500"></div>
                <div>
                    <div class="text-rose-400 font-bold text-sm">條件篩選資料載入失敗</div>
                    <div class="text-slate-400 text-xs mt-1">${globalMediaDataLoadError.message || "請確認 all_infleuncer_media_id.csv 路徑與檔案是否正確。"}</div>
                </div>
            </div>
        </div>`;
    }

    if (!isGlobalMediaDataLoaded) {
        return `
        <div id="search-filter-panel" class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 shadow-xl backdrop-blur-md">
            <div class="flex items-center justify-center gap-4 min-h-[96px]">
                <div class="w-7 h-7 rounded-full border-2 border-slate-700 border-t-blue-500 animate-spin"></div>
                <div class = "text-center">
                    <div class="text-slate-200 font-bold text-sm leading-relaxed">資料載入中，請稍後...</div>
                    <div class="text-slate-300 text-xs mt-1 leading-relaxed">大約等個二十秒，手風琴稍後才能展開，閒著也是閒著，來看優美的台語詩
                        <br> <i class="leading-relaxed">温若喬 《日花閃爍》🌠</i>
                        <br> <i class="leading-relaxed">暗暝的飛行機親像一隻船，寬寬仔流過天頂的河溪</i>
                        <br> <i class="leading-relaxed">滿路的星光若船尾淡出的水花，閃爍咧相送</i>
                        <br> <i class="leading-relaxed">望漂浪的人平安去到好風日的勝地</i>
                    </div>
                </div>
            </div>
        </div>`;
    }

    return `
        <div id="search-filter-panel" class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 shadow-xl backdrop-blur-md">
            <div class="flex flex-wrap items-center gap-4">
                <div class="flex items-center gap-2 min-w-[130px]">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span class="text-sm font-bold text-slate-300">條件篩選目標</span>
                </div>
                <select id="filter-condition-select" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-emerald-400 outline-none focus:border-emerald-500 transition cursor-pointer">
                    <option value="" selected>-- 請選擇條件 --</option>
                    <option value="duration">依【影片長度】 篩選</option>
                    <option value="comment_count">依【留言數量】篩選</option>
                    <option value="like_count">依【按讚數量】 篩選</option>
                    <option value="creation_time_tw">依【建立時間】 篩選</option>
                    <option value="modified_time_tw">依【修改時間】 篩選</option>
                    <option value="category">依【網紅類別】 篩選</option>
                    <option value="is_endorsement">只看【是業配】影片</option>
                    <option value="not_endorsement">只看【非業配】影片</option>
                    <option value="visual_kmeans_labels">依【Visual】分群</option>
                    <option value="audio_kmeans_labels">依【Audio】分群</option>
                    </select>

                <div id="filter-input-wrapper" class="flex items-center gap-2"></div>

                <button id="btn-mode2-filter" class="bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-7 py-1.5 rounded-lg font-medium transition shadow-md shadow-emerald-900/20">篩 選</button>
                <button id="btn-search-reset" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm px-3 py-1.5 rounded-lg font-medium transition border border-slate-700">♻️ 清除重設</button>
                
                <span id="search-error-msg" class="text-rose-500 font-bold text-sm hidden">⚠️ 查無結果</span>
            </div>
        </div>`;
}

/**
 * 重新整理上方搜尋 / 篩選區塊。
 */
function refreshSearchFilterPanel() {
    const panel = document.getElementById("search-filter-panel");
    if (!panel) return;

    panel.outerHTML = renderSearchFilterPanel();

    syncHeaderMediaIdSearch();

    if (isGlobalMediaDataLoaded) {
        bindSearchEvents();
    }

    cacheVideoViewSnapshot();
}

/**
 * 啟動 Videos DOM 快照監聽。
 */
function startVideoDomSnapshotObserver() {
    if (videoSnapshotObserver) {
        videoSnapshotObserver.disconnect();
        videoSnapshotObserver = null;
    }

    const root = document.getElementById("video-view-root");
    if (!root) return;

    videoSnapshotObserver = new MutationObserver(() => {
        scheduleVideoViewSnapshot();
    });

    videoSnapshotObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
    });

    cacheVideoViewSnapshot();
}

/**
 * 延遲保存目前 Videos DOM。
 */
function scheduleVideoViewSnapshot() {
    if (videoSnapshotTimer) {
        clearTimeout(videoSnapshotTimer);
    }

    videoSnapshotTimer = setTimeout(() => {
        videoSnapshotTimer = null;
        cacheVideoViewSnapshot();
    }, 250);
}

/**
 * 保存目前 Videos DOM。
 */
function cacheVideoViewSnapshot() {
    const root = document.getElementById("video-view-root");
    if (!root) return;
    cachedVideoViewHTML = root.outerHTML;
}

/**
 * 綁定搜尋 / 篩選 UI 的事件。
 */
function bindSearchEvents() {
    const condSelect = document.getElementById("filter-condition-select");
    const inputWrapper = document.getElementById("filter-input-wrapper");
    const errorMsg = document.getElementById("search-error-msg");
    const btnMode1 = document.getElementById("btn-mode1-search");
    const searchInput = document.getElementById("search-media-id");
    const btnMode2 = document.getElementById("btn-mode2-filter");
    const btnReset = document.getElementById("btn-search-reset");

    if (!condSelect || !inputWrapper || !errorMsg) return;

    condSelect.addEventListener("change", async () => {
        const val = condSelect.value;
        clearSearchMessage();

        if (!val) {
            inputWrapper.innerHTML = "";
            cacheVideoViewSnapshot();
            return;
        }

        if (val === "is_endorsement") {
            /*
             * 只有「是業配」才提供明確性與時長的細部篩選。
             * 兩個選單預設值皆為空字串，代表不限制該條件。
             */
            inputWrapper.innerHTML = `
        <select
            id="filter-endorsement-clarity"
            class="bg-slate-900 border border-emerald-700/80 rounded-lg px-3 py-1.5 text-sm text-emerald-400 outline-none focus:border-emerald-500 transition cursor-pointer min-w-[190px]"
            title="明確性"
        >
            <option value="" selected>明確性：不篩選</option>
            <option value="explicit">明確 (Explicit) </option>
            <option value="implicit">隱含 (Implicit) </option>
        </select>

        <select
            id="filter-endorsement-duration"
            class="bg-slate-900 border border-emerald-700/80 rounded-lg px-3 py-1.5 text-sm text-emerald-400 outline-none focus:border-emerald-500 transition cursor-pointer min-w-[190px]"
            title="業配時長"
        >
            <option value="" selected>歷時：不篩選</option>
            <option value="integrated">中插 (Integrated) </option>
            <option value="full">全篇 (Full)</option>
        </select>
    `;
        } else if (val === "not_endorsement") {
            // 非業配通常對應 endorsement_method = ["None"]，
            // 不需要額外提供明確性與時長篩選。
            inputWrapper.innerHTML = "";
        } else if (val === "creation_time_tw" || val === "modified_time_tw") {
            inputWrapper.innerHTML = `
                <input type="date" id="filter-date-start" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition w-36">
                <span class="text-slate-500 text-xs">到</span>
                <input type="date" id="filter-date-end" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition w-36">
            `;
        } else if (CLUSTER_FILTER_CONFIG[val]) {
            const config = CLUSTER_FILTER_CONFIG[val];

            inputWrapper.innerHTML = `
                <span class="text-blue-400 text-sm">讀取分群中...</span>
            `;

            try {
                await ensureJsonDescriptionSummaryLoaded({
                    showMessage: true,
                });

                const options = renderClusterLabelOptions(config.column);

                inputWrapper.innerHTML = `
                    <select
                        id="${config.selectId}"
                        class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition cursor-pointer min-w-[160px]"
                    >
                        <option value="" selected>-- 請選擇 ${config.label} 分群 --</option>
                        ${options}
                    </select>
                `;
            } catch (err) {
                console.error("[分群資料載入失敗]", err);
                inputWrapper.innerHTML = "";
                setSearchMessage(
                    `⚠️ 分群資料載入失敗：${err.message || "json_description_summary.csv 載入失敗"}`,
                    "error",
                );
            }
        } else if (val === "category") {
            const categoryOptions = Object.keys(APP_CONFIG.CATEGORY_COLORS)
                .filter((key) => key !== "default")
                .map((key) => `<option value="${key}">${key}</option>`)
                .join("");

            inputWrapper.innerHTML = `
                <select id="filter-category-select" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition cursor-pointer min-w-[160px]">
                    <option value="" selected>-- 請選擇網紅類別 --</option>
                    ${categoryOptions}
                </select>
            `;
        } else {
            inputWrapper.innerHTML = `
                <input type="number" id="filter-val-min" placeholder="Min" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition w-24">
                <span class="text-slate-500 text-xs">到</span>
                <input type="number" id="filter-val-max" placeholder="Max" class="bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 transition w-24">
            `;
        }

        cacheVideoViewSnapshot();
    });

    if (btnMode1) {
        btnMode1.addEventListener("click", handleMediaIdSearch);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") handleMediaIdSearch();
        });
    }

    if (btnMode2) {
        btnMode2.addEventListener("click", handleConditionFilter);
    }

    if (btnReset) {
        btnReset.addEventListener("click", () => {
            const searchInputNow = document.getElementById("search-media-id");
            const condSelectNow = document.getElementById(
                "filter-condition-select",
            );
            const inputWrapperNow = document.getElementById(
                "filter-input-wrapper",
            );

            if (searchInputNow) searchInputNow.value = "";
            if (condSelectNow) condSelectNow.value = "";
            if (inputWrapperNow) inputWrapperNow.innerHTML = "";

            clearSearchMessage();

            resetSearchStateOnly();
            renderInfluencerList();
            cacheVideoViewSnapshot();
        });
    }
}

/**
 * 綁定右下角 To Top 按鈕。
 *
 * 注意：
 * - 頁面主要捲動容器是 #cluster-container，不是 window。
 * - 因此這裡讓 #cluster-container 回到頂部。
 * - 若未來結構改變，才 fallback 到 nav-video。
 */
function bindVideoTopButton() {
    const btn = document.getElementById("btn-video-to-top");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const scrollContainer = document.getElementById("cluster-container");

        if (scrollContainer) {
            scrollContainer.scrollTo({
                top: 0,
                behavior: "smooth",
            });
            return;
        }

        const navVideo = document.getElementById("nav-video");
        if (navVideo) {
            navVideo.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }
    });
}

/**
 * 清空搜尋狀態，但不動到 DOM 欄位。
 */
function resetSearchStateOnly() {
    isFilterActive = false;
    activeFilterMode = null;
    matchedMediaIds.clear();
    matchedInfluencerIds.clear();
}

/**
 * 顯示搜尋 / 篩選訊息。
 *
 * type：
 * - info：資料載入中
 * - success：成功套用條件
 * - error：套用失敗或資料錯誤
 */
function setSearchMessage(message, type = "error") {
    const msg = document.getElementById("search-error-msg");
    if (!msg) return;

    msg.textContent = message;

    msg.classList.remove(
        "hidden",
        "text-rose-500",
        "text-blue-400",
        "text-emerald-400",
    );

    if (type === "info") {
        msg.classList.add("text-blue-400");
    } else if (type === "success") {
        msg.classList.add("text-emerald-400");
    } else {
        msg.classList.add("text-rose-500");
    }

    cacheVideoViewSnapshot();
}

/**
 * 清除搜尋 / 篩選訊息。
 */
function clearSearchMessage() {
    const msg = document.getElementById("search-error-msg");
    if (!msg) return;

    msg.textContent = "";

    msg.classList.add("hidden");

    msg.classList.remove("text-blue-400", "text-emerald-400", "text-rose-500");

    cacheVideoViewSnapshot();
}

/**
 * 顯示或隱藏一般查無結果訊息。
 *
 * 此函式主要保留給 Media ID 搜尋使用。
 * 條件篩選會直接顯示更明確的「套用失敗」原因。
 */
function setSearchErrorVisible(isVisible) {
    if (isVisible) {
        setSearchMessage("⚠️ 查無結果", "error");
    } else {
        clearSearchMessage();
    }
}

/**
 * 完成一次條件篩選，統一更新：
 * - 篩選狀態
 * - 顯示模式
 * - 手風琴清單
 * - 常駐成功／失敗訊息
 *
 * @param {Object} options
 * @param {"video"|"category"} options.mode
 *        video：影片層級篩選
 *        category：網紅層級篩選
 * @param {number} options.matchCount
 *        顯示在訊息中的符合筆數。
 * @param {string} options.emptyReason
 *        沒有結果時顯示的原因。
 *
 * @returns {boolean} 是否成功找到資料。
 */
function finalizeConditionFilter({
    mode,
    matchCount,
    emptyReason = "查無符合條件的資料",
}) {
    if (matchCount <= 0) {
        isFilterActive = false;
        activeFilterMode = null;

        renderInfluencerList();

        setSearchMessage(`⚠️ 套用失敗，${emptyReason}`, "error");

        cacheVideoViewSnapshot();
        return false;
    }

    isFilterActive = true;
    activeFilterMode = mode;

    renderInfluencerList();

    const videoCount = mode === "video" ? matchedMediaIds.size : matchCount;

    const influencerCount = matchedInfluencerIds.size;

    setSearchMessage(
        `合計 ${videoCount.toLocaleString("en-US")} 部影片，${influencerCount.toLocaleString("en-US")} 個網紅`,
        "success",
    );

    cacheVideoViewSnapshot();
    return true;
}

/**
 * 模式 1：media_id 精確搜尋。
 */
async function handleMediaIdSearch() {
    clearSearchMessage();

    const mediaIdInput = document
        .getElementById("search-media-id")
        ?.value.trim();

    if (!mediaIdInput) return;

    try {
        await ensureGlobalMediaDataLoaded({ showMessage: true });
    } catch (err) {
        console.error("[media_id 搜尋資料載入失敗]", err);
        setSearchMessage(`⚠️ 搜尋資料載入失敗：${err.message}`, "error");
        return;
    }

    const matchedRecord = mediaIdIndex.get(String(mediaIdInput));

    if (!matchedRecord) {
        setSearchErrorVisible(true);
        return;
    }

    resetSearchStateOnly();
    renderInfluencerList();
    cacheVideoViewSnapshot();

    setTimeout(() => {
        const targetHeader = document.querySelector(
            `.accordion-header[data-ig-id="${cssEscape(matchedRecord.owner_ig_id)}"]`,
        );

        if (!targetHeader) {
            setSearchErrorVisible(true);
            return;
        }

        const targetContent = document.getElementById(
            `content-${matchedRecord.owner_ig_id}`,
        );

        if (targetContent && targetContent.classList.contains("hidden")) {
            window.toggleInfluencer(matchedRecord.owner_ig_id, targetHeader);
        }

        targetHeader.scrollIntoView({ behavior: "smooth", block: "center" });

        let checkTicks = 0;
        const timer = setInterval(() => {
            const videoItem = document.querySelector(
                `.video-item[data-media-id="${cssEscape(mediaIdInput)}"]`,
            );

            if (videoItem) {
                clearInterval(timer);

                videoItem.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });

                videoItem.classList.add(
                    "ring-2",
                    "ring-blue-500",
                    "bg-blue-500/10",
                );

                const videoHeader =
                    videoItem.querySelector(".video-row-header");
                const detailBox = videoItem.querySelector(".video-detail-box");

                if (videoHeader && detailBox?.classList.contains("hidden")) {
                    videoHeader.click();
                }

                setTimeout(() => {
                    videoItem.classList.remove(
                        "ring-2",
                        "ring-blue-500",
                        "bg-blue-500/10",
                    );
                    cacheVideoViewSnapshot();
                }, 2500);

                cacheVideoViewSnapshot();
                return;
            }

            if (++checkTicks > 60) {
                clearInterval(timer);
                setSearchErrorVisible(true);
            }
        }, 100);
    }, 80);
}

/**
 * 模式 2：條件式篩選。
 *
 * 篩選完成後：
 * - 成功：
 *   ✔ 已套用選項，共 N 筆符合
 *
 * - 失敗：
 *   ⚠️ 套用失敗，{錯誤原因}
 */
async function handleConditionFilter() {
    clearSearchMessage();

    const condSelect = document.getElementById("filter-condition-select");

    const activeKey = condSelect?.value;

    if (!activeKey) {
        setSearchMessage("⚠️ 套用失敗，請先選擇篩選條件", "error");
        return;
    }

    matchedMediaIds.clear();
    matchedInfluencerIds.clear();

    // ==========================================
    // Description 層級條件：業配 / 非業配
    // ==========================================
    if (activeKey === "is_endorsement" || activeKey === "not_endorsement") {
        try {
            await ensureJsonDescriptionSummaryLoaded({
                showMessage: true,
            });
        } catch (err) {
            console.error("[影片描述摘要載入失敗]", err);

            setSearchMessage(
                `⚠️ 套用失敗，${err.message || "影片描述摘要載入失敗"}`,
                "error",
            );

            return;
        }

        const targetEndorsementValue = activeKey === "is_endorsement";

        /*
         * 只有「是業配」才會取得這兩個選單。
         * 空字串代表不限制該條件。
         */
        const selectedClarity =
            document.getElementById("filter-endorsement-clarity")?.value || "";

        const selectedDuration =
            document.getElementById("filter-endorsement-duration")?.value || "";

        jsonDescriptionSummaryData.forEach((item) => {
            // 第一層交集：是否為業配。
            if (item.is_endorsement !== targetEndorsementValue) {
                return;
            }

            /*
             * 第二層交集：業配明確性。
             *
             * 不篩選時 selectedClarity 為空字串，
             * 因此所有明確性均可通過。
             */
            if (
                selectedClarity &&
                !flexibleTokensInclude(
                    item.endorsement_method_tokens,
                    selectedClarity,
                )
            ) {
                return;
            }

            /*
             * 第三層交集：業配時長。
             *
             * 不篩選時 selectedDuration 為空字串，
             * 因此所有業配時長均可通過。
             */
            if (
                selectedDuration &&
                !flexibleTokensInclude(
                    item.endorsement_method_tokens,
                    selectedDuration,
                )
            ) {
                return;
            }

            matchedMediaIds.add(String(item.media_id));
            matchedInfluencerIds.add(String(item.influencer));
        });

        finalizeConditionFilter({
            mode: "video",
            matchCount: matchedMediaIds.size,
            emptyReason:
                activeKey === "is_endorsement"
                    ? "查無符合目前業配條件的影片"
                    : "查無非業配影片",
        });

        return;
    }
    // ==========================================
    // 分群結果篩選
    // ==========================================
    if (CLUSTER_FILTER_CONFIG[activeKey]) {
        const config = CLUSTER_FILTER_CONFIG[activeKey];

        try {
            await ensureJsonDescriptionSummaryLoaded({
                showMessage: true,
            });
        } catch (err) {
            console.error("[分群資料載入失敗]", err);

            setSearchMessage(
                `⚠️ 套用失敗，${err.message || "分群資料載入失敗"}`,
                "error",
            );

            return;
        }

        const selectedCluster =
            document.getElementById(config.selectId)?.value || "";

        if (!selectedCluster) {
            setSearchMessage(
                `⚠️ 套用失敗，請選擇 ${config.label} 分群`,
                "error",
            );
            return;
        }

        jsonDescriptionSummaryData.forEach((item) => {
            if (
                normalizeClusterLabel(item[config.column]) !== selectedCluster
            ) {
                return;
            }

            matchedMediaIds.add(String(item.media_id));
            matchedInfluencerIds.add(String(item.influencer));
        });

        finalizeConditionFilter({
            mode: "video",
            matchCount: matchedMediaIds.size,
            emptyReason: `沒有符合 ${config.label} 分群條件的影片`,
        });

        return;
    }

    // ==========================================
    // 網紅類別篩選
    // ==========================================
    if (activeKey === "category") {
        const selectedCategory =
            document.getElementById("filter-category-select")?.value || "";

        if (!selectedCategory) {
            setSearchMessage("⚠️ 套用失敗，請選擇網紅類別", "error");
            return;
        }

        influencerData.forEach((inf) => {
            const categories = String(inf.category || "")
                .split(",")
                .map((cat) => cat.trim())
                .filter((cat) => cat !== "");

            if (categories.includes(selectedCategory)) {
                matchedInfluencerIds.add(String(inf.ig_id));
            }
        });

        /*
         * 類別篩選是網紅層級，因此此處的 N
         * 代表符合的網紅筆數，不是影片筆數。
         */
        finalizeConditionFilter({
            mode: "category",
            matchCount: matchedInfluencerIds.size,
            emptyReason: `查無「${selectedCategory}」類別的網紅`,
        });

        return;
    }

    // ==========================================
    // 一般影片 Metadata 條件
    // ==========================================
    try {
        await ensureGlobalMediaDataLoaded({
            showMessage: true,
        });
    } catch (err) {
        console.error("[條件篩選資料載入失敗]", err);

        setSearchMessage(
            `⚠️ 套用失敗，${err.message || "篩選資料載入失敗"}`,
            "error",
        );

        return;
    }

    // 日期篩選。
    if (activeKey === "creation_time_tw" || activeKey === "modified_time_tw") {
        const startInput =
            document.getElementById("filter-date-start")?.value || "";

        const endInput =
            document.getElementById("filter-date-end")?.value || "";

        if (!startInput && !endInput) {
            setSearchMessage("⚠️ 套用失敗，請至少填寫一個日期範圍", "error");
            return;
        }

        if (startInput && endInput && startInput > endInput) {
            setSearchMessage("⚠️ 套用失敗，開始日期不可晚於結束日期", "error");
            return;
        }

        globalMediaData.forEach((item) => {
            const rowDate = String(item[activeKey] || "").substring(0, 10);

            if (!rowDate) {
                return;
            }

            let isMatch = true;

            if (startInput && rowDate < startInput) {
                isMatch = false;
            }

            if (endInput && rowDate > endInput) {
                isMatch = false;
            }

            if (isMatch) {
                matchedMediaIds.add(String(item.media_id));

                matchedInfluencerIds.add(String(item.owner_ig_id));
            }
        });

        finalizeConditionFilter({
            mode: "video",
            matchCount: matchedMediaIds.size,
            emptyReason: "指定日期範圍內沒有符合的影片",
        });

        return;
    }

    // 數值篩選。
    const minInput = document.getElementById("filter-val-min")?.value || "";

    const maxInput = document.getElementById("filter-val-max")?.value || "";

    if (minInput === "" && maxInput === "") {
        setSearchMessage("⚠️ 套用失敗，請至少填寫最小值或最大值", "error");
        return;
    }

    const minBound = minInput !== "" ? Number(minInput) : -Infinity;

    const maxBound = maxInput !== "" ? Number(maxInput) : Infinity;

    if (!Number.isFinite(minBound) && minBound !== -Infinity) {
        setSearchMessage("⚠️ 套用失敗，最小值格式不正確", "error");
        return;
    }

    if (!Number.isFinite(maxBound) && maxBound !== Infinity) {
        setSearchMessage("⚠️ 套用失敗，最大值格式不正確", "error");
        return;
    }

    if (minBound > maxBound) {
        setSearchMessage("⚠️ 套用失敗，最小值不可大於最大值", "error");
        return;
    }

    globalMediaData.forEach((item) => {
        const currentNum = Number(item[activeKey]);

        if (!Number.isFinite(currentNum)) {
            return;
        }

        if (currentNum >= minBound && currentNum <= maxBound) {
            matchedMediaIds.add(String(item.media_id));

            matchedInfluencerIds.add(String(item.owner_ig_id));
        }
    });

    finalizeConditionFilter({
        mode: "video",
        matchCount: matchedMediaIds.size,
        emptyReason: "指定數值範圍內沒有符合的影片",
    });
}

/**
 * 第一層：渲染網紅手風琴清單。
 */
function renderInfluencerList() {
    const listContainer = document.getElementById("influencer-list-container");
    if (!listContainer) return;

    let html = `<div class="p-6 space-y-4 max-w-7xl mx-auto">`;
    let visibleCount = 0;

    influencerData.forEach((inf) => {
        if (isFilterActive && !matchedInfluencerIds.has(String(inf.ig_id))) {
            return;
        }

        visibleCount++;

        const categoryHtml = String(inf.category || "未分類")
            .split(",")
            .filter((c) => c.trim() !== "")
            .map((cat) => {
                const cleanCat = cat.trim();
                const color =
                    APP_CONFIG.CATEGORY_COLORS[cleanCat] ||
                    APP_CONFIG.CATEGORY_COLORS["default"];

                return `
                <span class="px-2 py-0.5 rounded-full border text-[12px] whitespace-nowrap transition-all" 
                    style="border-color: ${color}; color: ${color};">
                    ${cleanCat}
                </span>`;
            })
            .join("");

        html += `
            <div class="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/50 shadow-sm">
                <div class="accordion-header flex justify-between items-center p-4 cursor-pointer hover:bg-slate-800/80 transition" 
                     data-ig-id="${inf.ig_id}"
                     onclick="toggleInfluencer('${inf.ig_id}', this)">
                    <div class="flex items-center gap-4">
                        <span class="text-blue-500 font-mono font-bold">${inf.Aisa_Order}</span>
                        <span class="font-bold text-blue-300 text-lg">${inf.person_name}</span>
                        <a href="${inf.ig_url}" target="_blank" class="text-slate-300 hover:text-blue-400 text-sm transition" onclick="event.stopPropagation()">
                            ${inf.ig_id}
                        </a>
                        <div class="flex gap-1 items-center">
                            ${categoryHtml}
                        </div>
                    </div>
                    <div class="text-slate-300 text-sm flex items-center gap-2">
                        <span> ${Math.floor(inf.posts || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} 貼文, </span>
                        <span>${Math.floor(inf.Followers || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} 粉絲, </span>
                        <span>${Math.floor(inf.Following || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}追蹤</span>
                        <svg class="w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </div>
                </div>
                <div id="content-${inf.ig_id}" class="hidden bg-[#213815] border-t border-slate-800 p-4">
                    <div class="loading-status text-slate-200 text-sm mb-4 italic"></div>
                    <div class="video-list space-y-3"></div>
                </div>
            </div>
        `;
    });

    if (visibleCount === 0) {
        html += `<div class="p-10 text-center text-slate-500 font-mono">查無任何網紅符合此過濾條件。</div>`;
    }

    html += `</div>`;
    listContainer.innerHTML = html;
    cacheVideoViewSnapshot();
}

/**
 * 第二層：展開網紅，載入影片 CSV。
 *
 * 保留 old 版本 fetch 單一網紅 CSV 的流程；
 * 額外加入：
 * - 模式 2 的影片層級過濾
 * - 單一網紅影片 CSV 快取，避免同一個網紅反覆展開時重抓與重 parse
 */
window.toggleInfluencer = async (ig_id, el) => {
    const content = document.getElementById(`content-${ig_id}`);
    if (!content) return;

    const icon = el.querySelector("svg");
    const isHidden = content.classList.contains("hidden");

    if (isHidden) {
        content.classList.remove("hidden");
        if (icon) icon.classList.add("rotate-180");

        const listDiv = content.querySelector(".video-list");

        if (listDiv && listDiv.innerHTML === "") {
            try {
                const videos = await getVideosForInfluencer(ig_id);

                let displayVideos = videos;

                // 模式 2：只顯示符合篩選條件的影片。
                // 注意：條件6「網紅類別」只篩選第一層網紅，不篩選影片。
                if (isFilterActive && activeFilterMode === "video") {
                    displayVideos = videos.filter((v) =>
                        matchedMediaIds.has(String(v.media_id)),
                    );
                }

                content.querySelector(".loading-status").innerHTML =
                    `Found ${displayVideos.length} videos`;

                if (displayVideos.length === 0) {
                    listDiv.innerHTML = `<div class="text-rose-400 text-sm italic p-2">該網紅下無符合篩選條件的影片。</div>`;
                    cacheVideoViewSnapshot();
                    return;
                }

                listDiv.innerHTML = displayVideos
                    .map((v) => {
                        const previewText = truncateText(
                            v.text,
                            50,
                            "(無文字內容)",
                        );

                        return `
                    <div class="video-item border border-slate-800/40 rounded-md bg-slate-900" data-media-id="${v.media_id}">
                        <div class="video-row-header p-3 cursor-pointer hover:bg-slate-800/40 flex justify-between items-center text-sm transition" 
                             onclick="toggleVideoDetail('${ig_id}', '${v.media_id}', '${v.modified_time_tw}', this)">
                            <div class="flex items-center gap-6 overflow-hidden">
                                <span class="text-slate-300 font-mono shrink-0">${(v.creation_time_tw || "").split("+")[0]}</span>
                                <span class="text-blue-300 font-mono shrink-0">${v.media_id}</span>
                                <span class="text-slate-300 shrink-0 ">${v.duration}s</span>
                                ${isFilterActive && activeFilterMode === "video" ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] border border-emerald-500/20 shrink-0">✔</span>` : ""}
                                <span class="text-slate-200 truncate italic">| ${previewText.replace(/\n/g, " ")}</span>
                            </div>
                            <svg class="w-4 h-4 text-slate-600 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
                        </div>
                        <div id="detail-${v.media_id}" class="video-detail-box hidden bg-slate-900/40 border-t border-slate-800/60 overflow-hidden">
                            <div class="animate-pulse p-10 text-center text-slate-700 font-mono">FETCHING JSON...</div>
                        </div>
                    </div>
                `;
                    })
                    .join("");

                cacheVideoViewSnapshot();
            } catch (err) {
                content.querySelector(".loading-status").innerHTML =
                    `<span class="text-rose-900 font-bold">Error: ${err.message}</span>`;
                cacheVideoViewSnapshot();
            }
        }
    } else {
        content.classList.add("hidden");
        if (icon) icon.classList.remove("rotate-180");
        cacheVideoViewSnapshot();
    }
};

/**
 * 取得單一網紅的影片清單。
 */

async function getVideosForInfluencer(ig_id) {
    if (videoCsvCache[ig_id]) {
        return videoCsvCache[ig_id];
    }

    const res = await fetch(
        `${APP_CONFIG.DATA_PATHS.video_info_dir}/${ig_id}-FullVideoInfo.csv`,
    );

    if (!res.ok) {
        throw new Error("找不到影片資訊檔案");
    }

    const csvText = await res.text();

    const videos = parseCsvObjectRows(csvText)
        .filter((video) => video.media_id)
        .sort(
            (a, b) =>
                new Date(a.creation_time_tw) - new Date(b.creation_time_tw),
        );

    videoCsvCache[ig_id] = videos;

    return videos;
}

/**
 * 第三層：展開影片詳情 Dashboard。
 */
window.toggleVideoDetail = async (ig_id, media_id, modified_time_tw, el) => {
    const detailDiv = document.getElementById(`detail-${media_id}`);
    if (!detailDiv) return;

    const icon = el.querySelector("svg");
    const isHidden = detailDiv.classList.contains("hidden");

    if (isHidden) {
        detailDiv.classList.remove("hidden");
        if (icon) icon.classList.add("rotate-180");

        let csvInfo = {};
        let jsonData = null;
        let jsonError = null;

        try {
            csvInfo = await getCsvInfo(ig_id, media_id);
        } catch (csvErr) {
            console.error("CSV Metadata 載入失敗", csvErr);
        }

        try {
            if (!cachedDetails[ig_id]) {
                const res = await fetch(
                    `${APP_CONFIG.DATA_PATHS.video_details_dir}/${ig_id}.json`,
                );
                if (!res.ok) throw new Error("找不到合併 JSON 檔案");
                cachedDetails[ig_id] = await res.json();
            }
            jsonData = cachedDetails[ig_id][media_id];
            if (!jsonData)
                throw new Error("缺少此影片數據，或片長超過 300 秒未生成 json");
        } catch (err) {
            jsonError = err.message;
        }

        renderVideoDashboard(
            detailDiv,
            ig_id,
            media_id,
            csvInfo,
            jsonData,
            jsonError,
            nameMapping,
        );

        cacheVideoViewSnapshot();
    } else {
        detailDiv.classList.add("hidden");
        if (icon) icon.classList.remove("rotate-180");
        cacheVideoViewSnapshot();
    }
};

/**
 * 從單一網紅 CSV 取得指定 media_id 的原始 metadata 欄位。
 */
async function getCsvInfo(ig_id, media_id) {
    try {
        const videos = await getVideosForInfluencer(ig_id);
        const target = videos.find(
            (v) => String(v.media_id) === String(media_id),
        );
        return target || {};
    } catch (e) {
        console.warn("getCsvInfo error:", e);
        return {};
    }
}
