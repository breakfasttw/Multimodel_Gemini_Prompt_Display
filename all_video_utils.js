/**
 * 清除 CSV header 可能出現的 BOM、引號與空白。
 */
export function cleanHeader(header) {
    return String(header || "")
        .replace(/^[\uFEFF\xEF\xBB\xBF]+/, "")
        .replace(/^uFEFF/, "")
        .trim()
        .replace(/"/g, "");
}

/**
 * 簡易 CSV row parser：保留原本專案使用的正則切法，處理欄位內逗號。
 */
export function splitCsvRow(row) {
    return row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
}

/**
 * 讓出主執行緒給瀏覽器。
 *
 * 用於大量 CSV parsing 時，避免長時間卡住 UI，
 * 讓使用者仍然可以點擊下方手風琴。
 */
export function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 等第一畫面真正 paint 出來後，再開始背景處理大型 CSV。
 * 這可以避免「手風琴剛出現但點不動」的感覺。
 */
export function runAfterFirstPaint(callback) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if ("requestIdleCallback" in window) {
                window.requestIdleCallback(callback, { timeout: 1200 });
            } else {
                setTimeout(callback, 80);
            }
        });
    });
}

/**
 * CSS selector escape。
 */
export function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(String(value));
    }
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1");
}

/**
 * 清理一般 CSV 欄位值。
 *
 * 處理：
 * - null / undefined
 * - 前後空白
 * - 欄位最外層的雙引號
 *
 * 注意：
 * 只移除欄位最外層引號，不會移除文字內容中的引號。
 */
export function stripCsvValue(value) {
    return String(value ?? "")
        .trim()
        .replace(/^"|"$/g, "");
}

/**
 * 將整份 CSV 文字拆成資料列。
 *
 * 支援：
 * - 移除 UTF-8 BOM
 * - Windows / Linux 換行
 * - CSV 欄位中的逗號
 * - 排除空白列
 */
export function splitCsvText(csvText) {
    return String(csvText ?? "")
        .replace(/^\uFEFF/, "")
        .split(/\r?\n(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .filter((row) => row.trim() !== "");
}

/**
 * 將 CSV 文字解析為物件陣列。
 *
 * 第一列會作為欄位名稱，後續每一列會轉換為：
 * {
 *     header1: value1,
 *     header2: value2,
 * }
 *
 * 若 CSV 沒有資料列，回傳空陣列。
 */
export function parseCsvObjectRows(csvText) {
    const rows = splitCsvText(csvText);

    if (rows.length < 2) {
        return [];
    }

    const headers = rows[0].split(",").map(cleanHeader);

    return rows.slice(1).map((row) => {
        const cols = splitCsvRow(row);
        const item = {};

        headers.forEach((header, index) => {
            item[header] = stripCsvValue(cols[index]);
        });

        return item;
    });
}

/**
 * 將 CSV 讀取到的布林文字轉換為 JavaScript Boolean。
 *
 * 支援：
 * - true / false
 * - True / False
 * - TRUE / FALSE
 * - 1 / 0
 *
 * 無法辨識、空值、None、NA 等資料回傳 null。
 */
export function parseCsvBoolean(value) {
    const normalized = stripCsvValue(value).toLowerCase();

    if (normalized === "true" || normalized === "1") {
        return true;
    }

    if (normalized === "false" || normalized === "0") {
        return false;
    }

    return null;
}

/**
 * 將 CSV 欄位轉為數字。
 *
 * 無法轉換時回傳 defaultValue。
 */
export function parseNumberOrDefault(value, defaultValue = 0) {
    const normalized = stripCsvValue(value);

    if (normalized === "") {
        return defaultValue;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * 截短文字並補上省略號。
 *
 * value 為空值時回傳 fallback。
 */
export function truncateText(value, maxLength, fallback = "") {
    const text = String(value ?? "");

    if (text === "") {
        return fallback;
    }

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.substring(0, maxLength)}...`;
}
