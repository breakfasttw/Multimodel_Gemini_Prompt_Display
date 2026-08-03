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
 * 將可能包含陣列內容的 CSV 欄位，轉換為可比對的小寫 token 陣列。
 *
 * 支援格式範例：
 * - ["Implicit","Integrated"]
 * - [""Implicit"",""Integrated""]
 * - ["Explicit Integrated"]
 * - ["Explicit/Integrated"]
 * - ["Explicit\\Integrated"]
 * - ["Explicit and Integrated"]
 * - Explicit Integrated
 *
 * 處理原則：
 * 1. 優先嘗試使用 JSON.parse()。
 * 2. 若 JSON 解析失敗，退回一般字串處理。
 * 3. 如果解析後只有一個非 None 元素，才使用分隔符號進一步切割。
 * 4. 所有 token 都會：
 *    - 去除引號與前後空白
 *    - 轉為小寫
 *    - 排除空字串
 *    - 排除 None
 *    - 去除重複值
 *
 * @param {*} value 原始 CSV 欄位值。
 * @param {Object} options 自訂解析設定。
 * @param {RegExp} options.singleValueSeparators
 *        單一元素需要再次拆分時使用的分隔規則。
 *        未來若有其他符號，可從呼叫端覆寫。
 * @param {string[]} options.emptyTokens
 *        視為無內容的 token。
 *
 * @returns {string[]} 正規化後的小寫 token 陣列。
 */
export function parseFlexibleArrayTokens(
    value,
    {
        singleValueSeparators = /[\s/\\|,;、，；]+/,
        emptyTokens = ["none", "null", "na", "n/a"],
    } = {},
) {
    let rawValue = stripCsvValue(value).trim();

    if (!rawValue) {
        return [];
    }

    // CSV 內嵌雙引號通常會以兩個雙引號表示。
    // 例如：[""Implicit"",""Integrated""]
    rawValue = rawValue.replace(/""/g, '"');

    let parsedValues = null;

    // 優先嘗試解析真正的 JSON 陣列。
    try {
        const parsed = JSON.parse(rawValue);

        if (Array.isArray(parsed)) {
            parsedValues = parsed;
        } else if (parsed !== null && parsed !== undefined) {
            parsedValues = [parsed];
        }
    } catch (error) {
        // JSON 解析失敗時，交由下方的寬鬆字串規則處理。
    }

    // 非標準 JSON 格式的 fallback。
    if (!parsedValues) {
        const withoutBrackets = rawValue
            .replace(/^\s*\[/, "")
            .replace(/\]\s*$/, "");

        parsedValues = withoutBrackets
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
    }

    // 先清除每個元素外圍的引號與空白。
    let cleanedValues = parsedValues
        .map((item) =>
            String(item ?? "")
                .trim()
                .replace(/^["']+|["']+$/g, "")
                .trim(),
        )
        .filter((item) => item !== "");

    /*
     * 只有一個有效元素，而且不是 None 時，
     * 才使用空格、正反斜線等符號再次拆分。
     *
     * 標準陣列 ["Implicit","Integrated"] 不會在此處被重新拆解。
     */
    if (cleanedValues.length === 1) {
        const singleValue = cleanedValues[0];
        const normalizedSingleValue = singleValue.toLowerCase();

        if (!emptyTokens.includes(normalizedSingleValue)) {
            cleanedValues = singleValue
                .split(singleValueSeparators)
                .map((item) => item.trim())
                .filter((item) => item !== "");
        }
    }

    const normalizedEmptyTokens = new Set(
        emptyTokens.map((item) => String(item).trim().toLowerCase()),
    );

    const normalizedTokens = cleanedValues
        .map((item) =>
            String(item)
                .trim()
                .replace(/^["']+|["']+$/g, "")
                .trim()
                .toLowerCase(),
        )
        .filter((item) => item !== "" && !normalizedEmptyTokens.has(item));

    return [...new Set(normalizedTokens)];
}

/**
 * 判斷正規化 token 陣列是否包含指定目標。
 *
 * target 也會統一轉為小寫，因此比對不受大小寫影響。
 *
 * @param {string[]} tokens parseFlexibleArrayTokens() 的結果。
 * @param {*} target 要尋找的目標字串。
 * @returns {boolean}
 */
export function flexibleTokensInclude(tokens, target) {
    const normalizedTarget = String(target ?? "")
        .trim()
        .toLowerCase();

    if (!normalizedTarget || !Array.isArray(tokens)) {
        return false;
    }

    return tokens.includes(normalizedTarget);
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
