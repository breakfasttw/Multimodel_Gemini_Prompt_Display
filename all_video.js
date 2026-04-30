// all_video.js
import { APP_CONFIG } from "./config.js";

const container = document.getElementById("cluster-container");
let influencerData = [];
let nameMapping = {}; // 用於儲存 ID -> person_name 的對照
let cachedDetails = {}; // 快取已下載的網紅影片詳情 (合併後的 JSON)

/**
 * 核心進入點：渲染網紅列表視圖
 */
export async function renderVideoView() {
    container.innerHTML = `<div class="p-10 text-center animate-pulse text-slate-500 font-mono">LOADING INFLUENCER DATA...</div>`;

    try {
        // 1. 同步抓取網紅總表與名稱對照表
        const [infRes, mapRes] = await Promise.all([
            fetch(APP_CONFIG.DATA_PATHS.all_influencers),
            fetch(APP_CONFIG.DATA_PATHS.ig_names),
        ]);

        const infText = await infRes.text();
        const mapText = await mapRes.text();

        // 2. 解析名稱對照表 (ownerid_mapping.csv)
        parseNameMapping(mapText);

        // 3. 解析網紅清單
        const rows = infText
            .split(/\r?\n(?=(?:(?:[^"]*"){2})*[^"]*$)/)
            .filter((r) => r.trim() !== "");
        const headers = rows[0].split(",").map((h) =>
            h
                .trim()
                .replace(/^uFEFF/, "")
                .replace(/"/g, ""),
        );

        influencerData = rows
            .slice(1)
            .map((row) => {
                const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                let obj = {};
                headers.forEach((h, i) => {
                    let val = (cols[i] || "").trim();
                    obj[h] = val.replace(/^"|"$/g, "");
                });
                return obj;
            })
            .sort(
                (a, b) =>
                    parseInt(a.Aisa_Order || 999) -
                    parseInt(b.Aisa_Order || 999),
            );

        renderInfluencerList();
    } catch (err) {
        console.error("[VideoView 渲染出錯]", err);
        container.innerHTML = `<div class="p-10 text-red-400">載入失敗: ${err.message}</div>`;
    }
}

/**
 * 解析 Mapping CSV
 */
function parseNameMapping(csvText) {
    const rows = csvText
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((r) => r.trim() !== "");
    if (rows.length < 2) return;
    const headers = rows[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const idIdx = headers.indexOf("ig_id");
    const tagIdIdx = headers.indexOf("tag_id");
    const nameIdx = headers.indexOf("person_name");

    rows.slice(1).forEach((row) => {
        const cols = row
            .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
            .map((v) => v.trim().replace(/"/g, ""));
        const name = cols[nameIdx];
        if (cols[idIdx]) nameMapping[cols[idIdx]] = name;
        if (cols[tagIdIdx]) nameMapping[cols[tagIdIdx]] = name;
    });
}

/**
 * 第一層：渲染網紅手風琴清單
 */
function renderInfluencerList() {
    let html = `<div class="p-6 space-y-4 max-w-7xl mx-auto">`;

    influencerData.forEach((inf) => {
        html += `
            <div class="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/50 shadow-sm">
                <div class="accordion-header flex justify-between items-center p-4 cursor-pointer hover:bg-slate-800/80 transition" 
                     onclick="toggleInfluencer('${inf.ig_id}', this)">
                    <div class="flex items-center gap-3">
                        <span class="text-blue-500 font-mono font-bold">${inf.Aisa_Order}</span>
                        <span class="font-bold text-blue-300 text-lg">${inf.person_name}</span>
                        <a href="${inf.ig_url}" target="_blank" class="text-slate-300 hover:text-blue-400 text-sm transition" onclick="event.stopPropagation()">
                            ${inf.ig_id}
                        </a>
                        <span class="text-slate-700">|</span>
                        <span class="text-slate-200 text-sm bg-slate-800 px-2 py-0.5 rounded">${inf.category || "未分類"}</span>
                    </div>
                    <div class="text-slate-300 text-sm flex items-center gap-2">
                        <span> ${Math.floor(inf.posts).toLocaleString("en-US", { maximumFractionDigits: 0 })} 貼文, </span>
                        <span>${Math.floor(inf.Followers).toLocaleString("en-US", { maximumFractionDigits: 0 })} 粉絲, </span>
                        <span>${Math.floor(inf.Following).toLocaleString("en-US", { maximumFractionDigits: 0 })}追蹤</span>
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

    html += `</div>`;
    container.innerHTML = html;
}

/**
 * 第二層：展開網紅，載入影片 CSV
 */
window.toggleInfluencer = async (ig_id, el) => {
    const content = document.getElementById(`content-${ig_id}`);
    const icon = el.querySelector("svg");
    const isHidden = content.classList.contains("hidden");

    if (isHidden) {
        content.classList.remove("hidden");
        icon.classList.add("rotate-180");

        const listDiv = content.querySelector(".video-list");
        if (listDiv.innerHTML === "") {
            try {
                const res = await fetch(
                    `${APP_CONFIG.DATA_PATHS.video_info_dir}/${ig_id}-FullVideoInfo.csv`,
                );
                if (!res.ok) throw new Error("找不到影片資訊檔案");
                const csvText = await res.text();

                // 使用正則切割，處理描述內的換行
                const csvRows = csvText
                    .replace(/^\uFEFF/, "")
                    .split(/\r?\n(?=(?:(?:[^"]*"){2})*[^"]*$)/)
                    .filter((r) => r.trim() !== "");
                const headers = csvRows[0]
                    .split(",")
                    .map((h) => h.trim().replace(/"/g, ""));
                const videos = csvRows
                    .slice(1)
                    .map((row) => {
                        const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                        let obj = {};
                        headers.forEach(
                            (h, i) =>
                                (obj[h] = (cols[i] || "").replace(
                                    /^"|"$/g,
                                    "",
                                )),
                        );
                        return obj;
                    })
                    .sort(
                        (a, b) =>
                            new Date(a.creation_time_tw) -
                            new Date(b.creation_time_tw),
                    );

                content.querySelector(".loading-status").innerHTML =
                    `Found ${videos.length} videos`;

                listDiv.innerHTML = videos
                    .map((v) => {
                        // 標題文字預覽處理 (前 20 字)
                        const previewText = v.text
                            ? v.text.length > 50
                                ? v.text.substring(0, 50) + "..."
                                : v.text
                            : "(無文字內容)";

                        return `
                    <div class="border border-slate-800/40 rounded-md bg-slate-900">
                        <div class="p-3 cursor-pointer hover:bg-slate-800/40 flex justify-between items-center text-sm transition" 
                             onclick="toggleVideoDetail('${ig_id}', '${v.media_id}', '${v.modified_time_tw}', this)">
                            <div class="flex items-center gap-6 overflow-hidden">
                                <span class="text-slate-300 font-mono shrink-0">${(v.creation_time_tw || "").split("+")[0]}</span>
                                <span class="text-blue-300 font-mono shrink-0">${v.media_id}</span>
                                <span class="text-slate-300 shrink-0 ">${v.duration}s</span>
                                <span class="text-slate-200 truncate italic">| ${previewText.replace(/\n/g, " ")}</span>
                            </div>
                            <svg class="w-4 h-4 text-slate-600 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
                        </div>
                        <div id="detail-${v.media_id}" class="hidden bg-slate-900/40 border-t border-slate-800/60 overflow-hidden">
                            <div class="animate-pulse p-10 text-center text-slate-700 font-mono">FETCHING JSON...</div>
                        </div>
                    </div>
                `;
                    })
                    .join("");
            } catch (err) {
                content.querySelector(".loading-status").innerHTML =
                    `<span class="text-rose-900 font-bold">Error: ${err.message}</span>`;
            }
        }
    } else {
        content.classList.add("hidden");
        icon.classList.remove("rotate-180");
    }
};

/**
 * 第三層：展開影片詳情 (Dashboard)
 */
window.toggleVideoDetail = async (ig_id, media_id, modified_time_tw, el) => {
    const detailDiv = document.getElementById(`detail-${media_id}`);
    const icon = el.querySelector("svg");
    const isHidden = detailDiv.classList.contains("hidden");

    if (isHidden) {
        detailDiv.classList.remove("hidden");
        icon.classList.add("rotate-180");

        let csvInfo = {};
        let jsonData = null;
        let jsonError = null;

        // 1. 優先嘗試取得 CSV 資料 (Metadata 來源)
        try {
            csvInfo = await getCsvInfo(ig_id, media_id);
        } catch (csvErr) {
            console.error("CSV Metadata 載入失敗", csvErr);
        }

        // 2. 嘗試取得 JSON 資料 (Description 來源)
        try {
            if (!cachedDetails[ig_id]) {
                const res = await fetch(
                    `${APP_CONFIG.DATA_PATHS.video_details_dir}/${ig_id}.json`,
                );
                if (!res.ok) throw new Error("找不到合併 JSON 檔案");
                cachedDetails[ig_id] = await res.json();
            }
            jsonData = cachedDetails[ig_id][media_id];
            if (!jsonData) throw new Error("JSON 內缺少此影片數據");
        } catch (err) {
            jsonError = err.message;
        }

        // 3. 呼叫渲染函式，將 jsonError 傳入
        renderVideoDashboard(
            detailDiv,
            ig_id,
            media_id,
            csvInfo,
            jsonData,
            jsonError,
        );
    } else {
        detailDiv.classList.add("hidden");
        icon.classList.remove("rotate-180");
    }
};
/**
 * 輔助函式：從 CSV 取得特定影片的原始欄位
 */
async function getCsvInfo(ig_id, media_id) {
    try {
        const res = await fetch(
            `${APP_CONFIG.DATA_PATHS.video_info_dir}/${ig_id}-FullVideoInfo.csv`,
        );
        if (!res.ok) throw new Error("CSV fetch failed");
        const text = await res.text();
        const rows = text
            .replace(/^\uFEFF/, "")
            .split(/\r?\n(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const headers = rows[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));

        // 尋找包含 media_id 的行
        const targetRow = rows.find((r) => r.includes(media_id));
        if (!targetRow) return {};

        const cols = targetRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let obj = {};
        headers.forEach(
            (h, i) => (obj[h] = (cols[i] || "").replace(/^"|"$/g, "")),
        );
        return obj;
    } catch (e) {
        console.warn("getCvInfo error:", e);
        return {};
    }
}
/**
 * 渲染影片儀表板 (Metadata + Description + Table)
 */
function renderVideoDashboard(
    container,
    ig_id,
    media_id,
    csv,
    json,
    jsonError = null,
) {
    // 處理標記網紅 Mapping
    let tagNames = [];
    if (csv.tags) {
        const valueMatches = csv.tags.match(/(?<=:\s*['"])\d+/g) || [];
        tagNames = valueMatches.map((id) => nameMapping[id] || id);
    }

    // 組合影片連結
    const timeKey = (csv.modified_time_tw || "")
        .replace(/[- :+]/g, "")
        .substring(0, 14);
    const videoName = `${ig_id}-${timeKey}-${media_id}.mp4`;
    const videoUrl = `${APP_CONFIG.VIDEO_API_BASE}/${ig_id}/${videoName}?token=${APP_CONFIG.VIDEO_TOKEN}`;

    // 判斷 JSON 內容
    const hasJson = json && !jsonError;
    const logs = hasJson
        ? json.low_inference_observations.perceptual_narrative_logs
        : null;

    container.innerHTML = `
        <div class="max-h-[80vh] flex flex-col overflow-y-auto custom-scrollbar text-slate-200 bg-[#0f172a]">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-800 shrink-0">
                <div class="bg-[#0f172a] p-6 border-b border-slate-800 md:border-b-0">
                    <h4 class="text-blue-500 font-bold mb-4 flex items-center gap-2">
                        <span class="w-1 h-4 bg-blue-500 rounded-full"></span> Metadata
                    </h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">外部連結：</span><span>${csv.short_code || ""}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">內部連結：</span><a href="${videoUrl}" target="_blank" class="text-blue-400 hover:underline truncate">link</a></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">建立日期：</span><span class="font-mono text-slate-300">${csv.creation_time_tw}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">最後更新：</span><span class="font-mono text-slate-300">${csv.modified_time_tw}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">留言數量：</span><span class="font-mono text-emerald-400">${Math.floor(csv["statistics.comment_count"]).toLocaleString("en-US", { maximumFractionDigits: 0 }) || 0}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">按讚數量：</span><span class="font-mono text-emerald-400">${Math.floor(csv["statistics.like_count"]).toLocaleString("en-US", { maximumFractionDigits: 0 }) || 0}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">觀看次數：</span><span class="font-mono text-emerald-400">${Math.floor(csv["statistics.views"]).toLocaleString("en-US", { maximumFractionDigits: 0 }) || 0}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">影片長度：</span><span class="font-mono">${csv.duration}s</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">標記數量：</span><span>${tagNames.length}</span></div>
                        <div class="flex border-b border-slate-800/50 py-1"><span class="text-slate-500 w-24 shrink-0">標記網紅：</span><div class="flex flex-wrap gap-1">${tagNames.map((t) => `<span class="bg-blue-900/30 text-blue-300 px-1.5 rounded text-xs border border-blue-800/50">${t}</span>`).join("")}</div></div>
                        <div class="pt-3">

                            <span class="text-slate-500 block text-xs mb-1">文字內容：</span>
                            <p class="text-slate-300 leading-relaxed whitespace-pre-wrap text-s bg-slate-950/50 p-3 rounded border border-slate-800">${csv.text || "(無內文)"}</p>
                        </div>
                    </div>
                </div>

                <div class="bg-[#0f172a] p-6 border-l border-slate-800">
                    <h4 class="text-blue-500 font-bold mb-4 flex items-center gap-2">
                        <span class="w-1 h-4 bg-blue-500 rounded-full"></span> Description
                    </h4>
                    ${
                        hasJson
                            ? `
                        <div class="space-y-5 text-sm">
                            <div class="group">
                                <span class="text-slate-500 block text-[10px] uppercase tracking-widest mb-1">Visual Narrative</span>
                                <p class="text-slate-200 leading-relaxed pl-3 border-l border-slate-800">${logs.visual_narrative_log}</p>
                            </div>
                            <div class="group">
                                <span class="text-slate-500 block text-[10px] uppercase tracking-widest mb-1">Audio Narrative</span>
                                <p class="text-slate-200 leading-relaxed pl-3 border-l border-slate-800">${logs.audio_narrative_log}</p>
                            </div>
                            <div class="group">
                                <span class="text-slate-500 block text-[10px] uppercase tracking-widest mb-1">Text Narrative</span>
                                <p class="text-slate-200 leading-relaxed pl-3 border-l border-slate-800">${logs.text_narrative_log}</p>
                            </div>
                            <div class="group">
                                <span class="text-slate-500 block text-[10px] uppercase tracking-widest mb-1">Main Purpose</span>
                                <p class="text-blue-200/80 italic bg-blue-900/10 p-2 rounded border border-blue-900/20">${json.high_inference_interpretations.narrative_and_purpose.mainPurpose}</p>
                            </div>
                        </div>
                    `
                            : `
                        <div class="p-10 border border-dashed border-slate-800 rounded text-center text-slate-600 italic text-sm">
                            JSON 解析錯誤: ${jsonError || "無資料"}
                        </div>
                    `
                    }
                </div>
            </div>

            <div class="p-6 bg-[#0f172a] border-t border-slate-800">
                <h4 class="text-blue-500 font-bold mb-4 flex items-center gap-2">
                    <span class="w-1 h-4 bg-blue-500 rounded-full"></span> Json Description
                </h4>
                ${
                    hasJson
                        ? `
                    <div class="border border-slate-800 rounded overflow-hidden">
                        <table class="w-full border-collapse">
                            <thead class="bg-slate-900 shadow-md">
                                <tr class="text-left text-[10px] uppercase tracking-tighter text-slate-500 border-b border-slate-800">
                                    <th class="p-3 w-[10%] border-r border-slate-800/50">L1</th>
                                    <th class="p-3 w-[10%] border-r border-slate-800/50">L2</th>
                                    <th class="p-3 w-[10%] border-r border-slate-800/50">L3</th>
                                    <th class="p-3 w-[10%] border-r border-slate-800/50">L4</th>
                                    <th class="p-3 w-[60%]">Value</th>
                                </tr>
                            </thead>
                            <tbody class="text-xs font-mono">
                                ${renderJsonTableRows(json)}
                            </tbody>
                        </table>
                    </div>
                `
                        : `
                    <div class="p-10 border border-dashed border-slate-800 rounded text-center text-slate-600 italic text-sm">
                        JSON 表格資料載入失敗
                    </div>
                `
                }
            </div>
        </div>
    `;
}

/**
 * 展平 JSON 並產出表格行 (維持 zebra 特效與原始文字)
 */
function renderJsonTableRows(json) {
    let rows = [];

    function flatten(obj, path = []) {
        for (let key in obj) {
            const currentPath = [...path, key];
            const value = obj[key];

            if (
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value)
            ) {
                flatten(value, currentPath);
            } else {
                rows.push({
                    l1: currentPath[0] || "",
                    l2: currentPath[1] || "",
                    l3: currentPath[2] || "",
                    l4: currentPath[3] || "",
                    value: value,
                });
            }
        }
    }

    flatten(json);

    return rows
        .map(
            (r) => `
        <tr class="border-b border-slate-800/30 hover:bg-blue-500/5 transition-colors group">
            <td class="p-2 border-r border-slate-800/50 text-slate-500">${r.l1}</td>
            <td class="p-2 border-r border-slate-800/50 text-slate-400">${r.l2}</td>
            <td class="p-2 border-r border-slate-800/50 text-slate-300">${r.l3}</td>
            <td class="p-2 border-r border-slate-800/50 text-slate-200">${r.l4}</td>
            <td class="p-2 group-hover:text-blue-300 transition-colors">${formatValue(r.value)}</td>
        </tr>
    `,
        )
        .join("");
}

/**
 * 格式化表格中的 Value (保留原本 Boolean/Array 的美化邏輯)
 */
function formatValue(val) {
    if (val === undefined || val === null)
        return `<span class="text-slate-700">—</span>`;
    if (typeof val === "boolean") {
        return val
            ? `<span class="text-emerald-500 font-bold">YES</span>`
            : `<span class="text-rose-500 font-bold">NO</span>`;
    }
    if (Array.isArray(val)) {
        if (val.length === 0)
            return `<span class="text-slate-700">Empty</span>`;
        return val
            .map(
                (v) =>
                    `<span class="inline-block bg-slate-800 border border-slate-700 text-blue-200 px-1.5 py-0.5 rounded-sm m-0.5 text-[10px]">${v}</span>`,
            )
            .join("");
    }
    return `<span class="text-slate-300 break-all">${val}</span>`;
}
