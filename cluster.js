// cluster.js
import { APP_CONFIG } from "./config.js";

let clusterMembersMap = {};
let nameMapping = {}; // 全域存放 ig_id -> person_name 的對照表
const normalizeId = (id) => String(id).trim().split("_").pop();

/**
 *  讀取名稱對照表 (ownerid_mapping.csv)
 */
async function fetchNameMapping() {
    if (Object.keys(nameMapping).length > 0) return;
    try {
        const response = await fetch(APP_CONFIG.DATA_PATHS.ig_names);
        const text = await response.text();
        const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
        if (rows.length < 2) return;

        // 清除 BOM 並清洗標題
        const headers = rows[0].split(",").map((h) =>
            h
                .replace(/^\uFEFF/, "")
                .trim()
                .replace(/"/g, ""),
        );
        const igIdIdx = headers.indexOf("ig_id");
        const personNameIdx = headers.indexOf("person_name");

        if (igIdIdx === -1 || personNameIdx === -1) {
            console.error("Mapping CSV 標題不匹配:", headers);
            return;
        }

        rows.slice(1).forEach((row) => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length <= Math.max(igIdIdx, personNameIdx)) return;
            const igId = cols[igIdIdx].trim().replace(/"/g, "");
            const personName = cols[personNameIdx].trim().replace(/"/g, "");
            if (igId) nameMapping[igId] = personName;
        });
    } catch (e) {
        console.error("fetchNameMapping Error:", e);
    }
}

/**
 * 讀取成員名單 (增加 ID 標準化)
 */
async function fetchMembers(type) {
    try {
        await fetchNameMapping();
        const csvPath = APP_CONFIG.DATA_PATHS[`${type}_members`];
        const response = await fetch(csvPath);
        const text = await response.text();
        clusterMembersMap = {};

        const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
        if (rows.length < 2) return;

        const headers = rows[0].split(",").map((h) =>
            h
                .replace(/^\uFEFF/, "")
                .trim()
                .replace(/"/g, ""),
        );
        let idIdx = headers.indexOf("owner_id");
        if (idIdx === -1) idIdx = 0;
        let labelIdx = headers.indexOf("cluster_label");
        if (labelIdx === -1) labelIdx = headers.length - 1;

        rows.slice(1).forEach((row) => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length <= Math.max(idIdx, labelIdx)) return;

            const rawId = cols[idIdx].trim().replace(/"/g, "");
            const displayName = nameMapping[rawId] || rawId;

            // 使用標準化處理 Label
            const label = normalizeId(cols[labelIdx].replace(/"/g, ""));

            if (!clusterMembersMap[label]) clusterMembersMap[label] = new Set();
            clusterMembersMap[label].add(displayName);
        });
    } catch (e) {
        console.error("fetchMembers Error:", e);
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
    container.innerHTML = `<div class="p-20 text-slate-500 animate-pulse text-center">正在解析數據與成員名單...</div>`;

    try {
        // 1. 先讀取 CSV 成員數據與名稱轉換
        await fetchMembers(type);

        // 2. 讀取 JSON 統計數據
        const response = await fetch(APP_CONFIG.DATA_PATHS[type]);
        if (!response.ok) throw new Error("JSON 數據讀取失敗");
        const jsonData = await response.json();

        // 取得所有群組 ID 並進行排序
        const clusterIds = Object.keys(jsonData).sort(
            (a, b) => Number(normalizeId(a)) - Number(normalizeId(b)),
        );

        // 彙整所有可用的統計路徑 (避免跨群組欄位缺失問題)
        let allLeafPaths = {};
        clusterIds.forEach((id) => {
            const paths = getLeafPaths(jsonData[id].statistics);
            Object.assign(allLeafPaths, paths);
        });

        // 處理子層名稱重複邏輯
        const leafKeyCounts = {};
        Object.values(allLeafPaths).forEach((info) => {
            leafKeyCounts[info.leafKey] =
                (leafKeyCounts[info.leafKey] || 0) + 1;
        });

        let html = `<div class="inline-block min-w-full">`;

        // --- 表頭渲染 (置頂卡片與 Tooltip) ---
        html += `<div class="flex sticky-row-header bg-slate-950 border-b border-slate-700 shadow-xl">
                    <div class="w-[120px] shrink-0 p-4 bg-slate-950 font-bold text-slate-500 uppercase text-[13px] flex items-end">特徵指標 (子層)</div>`;

        clusterIds.forEach((id) => {
            const stats = jsonData[id];
            const normalizedId = normalizeId(id);
            const membersSet = clusterMembersMap[normalizedId] || new Set();
            const membersArr = Array.from(membersSet);

            /** * 【關鍵修正】
             * 在 JSON 結構中，video_count 位於 metadata 物件內
             */
            const videoCount =
                stats.metadata && stats.metadata.video_count !== undefined
                    ? stats.metadata.video_count
                    : stats.video_count || 0;

            html += `
                <div class="cluster-card w-[240px] shrink-0 p-4 border-l border-slate-800 relative group cursor-help">
                    <div class="text-blue-400 font-bold text-lg">Group ${normalizedId}</div>
                    <div class="text-[13px] text-slate-200">${videoCount} 支影片 / ${membersArr.length} 位網紅</div>
                    
                    <div class="member-tooltip">
                        <div class="text-blue-400 font-bold mb-2 border-b border-slate-700 pb-1 text-xs">成員名單 </div>
                        <div class="text-slate-300 leading-relaxed text-[13px] max-h-[200px] overflow-y-auto custom-scrollbar">
                            ${membersArr.join("、") || '<span class="text-slate-600">暫無成員名單</span>'}
                        </div>
                    </div>
                </div>`;
        });
        html += `</div>`;

        // --- 數據行渲染 (平舖展開) ---
        for (const [fullPath, info] of Object.entries(allLeafPaths)) {
            const displayName =
                leafKeyCounts[info.leafKey] > 1
                    ? fullPath.split(".").slice(-2).join(".")
                    : info.leafKey;

            html += `<div class="flex border-b border-slate-800/50 hover:bg-slate-800/20 transition">
                        <div class="w-[120px] shrink-0 p-4 sticky-col-header break-words font-medium text-slate-400 text-sm border-r border-slate-800 bg-slate-900/90 shadow-sm">${displayName}</div>`;

            clusterIds.forEach((id) => {
                const groupStats = jsonData[id].statistics;
                const cellData = fullPath
                    .split(".")
                    .reduce((o, i) => (o ? o[i] : null), groupStats);

                html += `<div class="w-[240px] shrink-0 p-3 border-l border-slate-800/30">`;

                if (!cellData) {
                    html += `<span class="text-slate-700 italic text-xs">-</span>`;
                } else if (info.type === "numeric") {
                    html += `
                        <div class="p-2 bg-slate-800/40 rounded border border-slate-800/50">
                            <table class="w-full font-mono text-[13px]">
                                <tr><td class="text-blue-300">平均 </td><td class="text-right text-emerald-400 font-bold">${Number(cellData.avg).toFixed(2)}</td></tr>
                                <tr><td class="text-blue-300">中位數</td><td class="text-right text-slate-100">${Number(cellData.mean).toFixed(2)}</td></tr>
                                <tr class="border-t border-slate-700/30"><td class="text-blue-300 pt-1">區間</td><td class="text-right text-slate-100 pt-1">${cellData.min} - ${cellData.max}</td></tr>
                            </table>
                        </div>`;
                } else if (info.type === "categorical") {
                    const sortedItems = Object.entries(cellData)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10);

                    html += `<table class="w-full text-[13px]">`;
                    sortedItems.forEach(([label, count]) => {
                        html += `
                            <tr class="border-b border-slate-800/20 last:border-0">
                                <td class="py-1 text-blue-300 truncate max-w-[200px]" title="${label}">${label}</td>
                                <td class="text-right text-slate-100 font-mono pl-2">${count}</td>
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
        console.error("[渲染出錯]", error);
        container.innerHTML = `<div class="p-20 text-red-500 text-center font-mono">載入失敗: ${error.message}</div>`;
    }
}
