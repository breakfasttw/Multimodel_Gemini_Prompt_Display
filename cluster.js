// cluster.js
import { APP_CONFIG } from "./config.js";

let clusterMembersMap = {};
let nameMapping = {}; // 全域存放 ig_id -> person_name 的對照表

/**
 * [驗證版] 讀取名稱對照表 (ownerid_mapping.csv)
 */
async function fetchNameMapping() {
    // 若已有資料則跳過，提升效能
    if (Object.keys(nameMapping).length > 0) return;

    try {
        const response = await fetch(APP_CONFIG.DATA_PATHS.ig_names);
        const text = await response.text();
        // 處理不同作業系統的換行符號
        const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
        if (rows.length < 2) return;

        // 動態尋找標題索引
        const headers = rows[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));
        const igIdIdx = headers.indexOf("ig_id");
        const personNameIdx = headers.indexOf("person_name");

        if (igIdIdx === -1 || personNameIdx === -1) {
            console.error(
                "[對照表] CSV 標題格式錯誤，找不到 ig_id 或 person_name",
            );
            return;
        }

        rows.slice(1).forEach((row) => {
            // 處理包含引號與逗號的複雜 CSV 格式
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length <= Math.max(igIdIdx, personNameIdx)) return;

            const igId = cols[igIdIdx].trim().replace(/"/g, "");
            const personName = cols[personNameIdx].trim().replace(/"/g, "");

            if (igId) nameMapping[igId] = personName;
        });
        console.log(
            `[對照表] 成功載入 ${Object.keys(nameMapping).length} 筆名稱對應數據`,
        );
    } catch (e) {
        console.error("[對照表] 讀取失敗", e);
    }
}

/**
 * [驗證版] 讀取成員名單並執行 Person Name 轉換
 */
async function fetchMembers(type) {
    try {
        // 1. 確保對照表已載入
        await fetchNameMapping();

        // 2. 讀取指定類別的群組結果
        const csvPath = APP_CONFIG.DATA_PATHS[`${type}_members`];
        const response = await fetch(csvPath);
        const text = await response.text();

        clusterMembersMap = {}; // 重置全域名單

        const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
        if (rows.length < 2) return;

        // 3. 動態偵測成員名單 CSV 的標題
        const headers = rows[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));

        // 偵測 Influencer ID 欄位 (可能是 owner_id 或第一欄)
        let idIdx = headers.indexOf("owner_id");
        if (idIdx === -1) idIdx = 0;

        // 偵測 Cluster Label 欄位 (可能是最後一欄或 cluster_label)
        let labelIdx = headers.indexOf("cluster_label");
        if (labelIdx === -1) labelIdx = headers.length - 1;

        rows.slice(1).forEach((row) => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length <= Math.max(idIdx, labelIdx)) return;

            // 取得原始 ID 並進行 Mapping 轉換
            const rawId = cols[idIdx].trim().replace(/"/g, "");
            const displayName = nameMapping[rawId] || rawId; // 若找不到對應則顯示原始 ID

            // 處理 Label (確保轉換為純數字字串，對應 JSON ID)
            let label = cols[labelIdx].trim().replace(/"/g, "");
            if (label.includes("_")) label = label.split("_").pop();

            if (!clusterMembersMap[label]) {
                clusterMembersMap[label] = new Set();
            }
            clusterMembersMap[label].add(displayName);

            console.log("displayName = ", displayName);
        });

        // 驗證輸出
        const totalGroups = Object.keys(clusterMembersMap).length;
        console.log(
            `[成員驗證] ${type.toUpperCase()} 解析完成: 找到 ${totalGroups} 個群組`,
        );
    } catch (e) {
        console.error(`[成員驗證] ${type} 解析出錯`, e);
        clusterMembersMap = {};
    }
}

/**
 * 遞迴尋找所有統計數據的「葉子節點」
 * 邏輯：遇到有 avg 的物件視為數值統計，遇到純計數物件視為類別統計
 */
function getLeafPaths(obj, currentPath = "", leafNodes = {}) {
    for (let key in obj) {
        if (key === "metadata" || key === "video_count") continue;

        const val = obj[key];
        if (val === null || val === undefined) continue;

        const newPath = currentPath ? `${currentPath}.${key}` : key;

        // 偵測數值統計節點 (Numeric: 具有 avg, min, max 等)
        const isNumeric = typeof val === "object" && val.avg !== undefined;

        // 偵測類別統計節點 (Categorical: 物件且其值皆為數字/基本型態)
        let isCategorical = false;
        if (typeof val === "object" && !isNumeric && !Array.isArray(val)) {
            const values = Object.values(val);
            if (
                values.length > 0 &&
                values.every((v) => typeof v !== "object")
            ) {
                isCategorical = true;
            }
        }

        if (isNumeric || isCategorical) {
            leafNodes[newPath] = {
                type: isNumeric ? "numeric" : "categorical",
                leafKey: key,
            };
        } else if (typeof val === "object" && !Array.isArray(val)) {
            getLeafPaths(val, newPath, leafNodes);
        }
    }
    return leafNodes;
}

/**
 * 主要渲染函式
 */
export async function renderClusterView(type) {
    const container = document.getElementById("cluster-container");
    container.innerHTML = `<div class="p-10 text-slate-500 animate-pulse">解析數據中...</div>`;

    try {
        await fetchMembers(type);
        const response = await fetch(APP_CONFIG.DATA_PATHS[type]);
        const jsonData = await response.json();

        // 取得所有群組 ID
        const clusterIds = Object.keys(jsonData).sort((a, b) => a - b);

        // 掃描所有群組以彙整出完整的欄位清單 (避免某些群組缺少特定欄位)
        let allLeafPaths = {};
        clusterIds.forEach((id) => {
            const paths = getLeafPaths(jsonData[id].statistics);
            Object.assign(allLeafPaths, paths);
        });

        // 檢查子層名稱是否有重複
        const leafKeyCounts = {};
        Object.values(allLeafPaths).forEach((info) => {
            leafKeyCounts[info.leafKey] =
                (leafKeyCounts[info.leafKey] || 0) + 1;
        });

        let html = `<div class="inline-block min-w-full">`;

        // --- 表頭渲染 (Sticky Header) ---
        html += `<div class="flex sticky-row-header bg-slate-950 border-b border-slate-700 shadow-xl">
                    <div class="w-[120px] shrink-0 p-4 bg-slate-950 font-bold text-slate-500 uppercase text-[10px] flex items-end">特徵指標 (子層)</div>`;

        clusterIds.forEach((id) => {
            const count = jsonData[id].video_count || 0;
            const membersSet = clusterMembersMap[id] || new Set();
            const membersArr = Array.from(membersSet);
            html += `
                <div class="cluster-card w-[320px] shrink-0 p-4 border-l border-slate-800 relative group">
                    <div class="text-blue-400 font-bold text-lg">Group ${id}</div>
                    <div class="text-[12px] text-slate-500">${count} 支影片</div>
                    <div class="member-tooltip">
                        <div class="text-blue-400 font-bold mb-2 border-b border-slate-700 pb-1 text-xs">成員名單 (${membersArr.length})</div>
                        <div class="text-slate-300 leading-relaxed text-[12px]">${membersArr.join("、") || "無名單"}</div>
                    </div>
                </div>`;
        });
        html += `</div>`;

        // --- 數據行渲染 (平舖展開) ---
        for (const [fullPath, info] of Object.entries(allLeafPaths)) {
            // 重複名稱處理：若 key 重複則顯示「父層.子層」
            const displayName =
                leafKeyCounts[info.leafKey] > 1
                    ? fullPath.split(".").slice(-2).join(".")
                    : info.leafKey;

            html += `<div class="flex border-b border-slate-800/50 hover:bg-slate-800/20 transition">
                        <div class="w-[120px] shrink-0 p-4 sticky-col-header font-medium break-words text-slate-400 text-sm border-r border-slate-800 bg-slate-900/90 shadow-sm">${displayName}</div>`;

            clusterIds.forEach((id) => {
                // 安全取得深層數值
                const stats = jsonData[id].statistics;
                const cellData = fullPath
                    .split(".")
                    .reduce((o, i) => (o ? o[i] : null), stats);

                html += `<div class="w-[320px] shrink-0 p-3 border-l border-slate-800/30">`;

                if (!cellData) {
                    html += `<span class="text-slate-700 italic text-xs">-</span>`;
                } else if (info.type === "numeric") {
                    // 數值統計展示
                    html += `
                        <div class="p-2 bg-slate-800/40 rounded border border-slate-800/50">
                            <table class="w-full font-mono text-[12px]">
                                <tr><td class="text-blue-200">平均</td><td class="text-right text-emerald-400 font-bold">${Number(cellData.avg).toFixed(3)}</td></tr>
                                <tr><td class="text-blue-200">中位數</td><td class="text-right text-white-400">${Number(cellData.mean).toFixed(3)}</td></tr>
                                <tr class="border-t border-slate-700/30"><td class="text-blue-200 pt-1">區間</td><td class="text-right text-white-500 pt-1">${cellData.min} - ${cellData.max}</td></tr>
                            </table>
                        </div>`;
                } else if (info.type === "categorical") {
                    // 計數統計展示 (Top 10)
                    const sortedItems = Object.entries(cellData)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10);

                    html += `<table class="w-full text-[12px]">`;
                    sortedItems.forEach(([label, count]) => {
                        html += `
                            <tr class="border-b border-slate-800/20 last:border-0">
                                <td class="py-1 text-blue-200 truncate max-w-[200px]" title="${label}">${label}</td>
                                <td class="text-right text-slate-300 font-mono pl-2">${count}</td>
                            </tr>`;
                    });
                    html += `</table>`;
                }
                html += `</div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
        container.innerHTML = html;
    } catch (error) {
        console.error("Render Error:", error);
        container.innerHTML = `<div class="p-10 text-red-500 font-mono text-sm">數據讀取錯誤：${error.message}</div>`;
    }
}
