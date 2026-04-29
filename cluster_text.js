// cluster_text.js
import { APP_CONFIG } from "./config.js";

window.openVideo = async (influencer, videoName) => {
    // 檢查是否有設定 API 路徑 (判斷是否在本地/有效環境)
    if (!APP_CONFIG.VIDEO_API_BASE) {
        alert("此環境不支援影片播放 (缺少 env.js 設定)。");
        return;
    }

    try {
        const ticketUrl = APP_CONFIG.VIDEO_API_BASE.replace(
            "/stream",
            "/get_ticket",
        );
        const response = await fetch(ticketUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: APP_CONFIG.VIDEO_TOKEN }),
        });

        const data = await response.json();
        if (data.ticket) {
            // 拿到臨時通行證後開啟影片
            const finalUrl = `${APP_CONFIG.VIDEO_API_BASE}/${influencer}/${videoName}?ticket=${data.ticket}`;
            window.open(finalUrl, "_blank");
        } else {
            alert("驗證失敗");
        }
    } catch (err) {
        console.error("影片服務連線失敗:", err);
        alert("無法連線至影片伺服器，請確保您在公司網域內。");
    }
};

/**
 * 根據不同的 Type 映射對應的文字欄位名稱
 */
const TEXT_FIELD_MAP = {
    visual: "visual_text",
    audio: "audio_text",
    mix: "main_purpose",
    text: "text_text",
};

/**
 * 核心渲染函式：Features 頁面 (手風琴文字列表)
 */
export async function renderFeaturesView(type) {
    const container = document.getElementById("cluster-container");
    container.innerHTML = `
        <div class="flex items-center justify-center h-full">
            <p class="text-slate-500 animate-pulse font-mono tracking-widest">LOADING FEATURES CONTENT...</p>
        </div>`;

    try {
        const csvPath = APP_CONFIG.DATA_PATHS[`${type}_members`];
        const response = await fetch(csvPath);
        if (!response.ok) throw new Error(`無法讀取檔案: ${csvPath}`);

        const text = await response.text();
        const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
        if (rows.length < 2) return;

        // 解析 CSV Header
        const headers = rows[0].split(",").map((h) =>
            h
                .replace(/^\uFEFF/, "")
                .trim()
                .replace(/"/g, ""),
        );

        const videoNameIdx = headers.indexOf("videoName");
        const clusterLabelIdx = headers.indexOf("cluster_label");
        const textContentIdx = headers.indexOf(TEXT_FIELD_MAP[type]);

        // 新增：取得 Influencer 的索引
        const influencerIdx = headers.indexOf("Influencer");

        if (
            videoNameIdx === -1 ||
            clusterLabelIdx === -1 ||
            textContentIdx === -1
        ) {
            console.error("CSV 欄位不匹配，請檢查 CSV 標題與 TEXT_FIELD_MAP");
            return;
        }

        // 資料分組 (By cluster_label)
        const groups = {};
        rows.slice(1).forEach((row) => {
            // 使用正則處理包含逗號的引號內容
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length < headers.length) return;

            const label = cols[clusterLabelIdx].trim().replace(/"/g, "");
            const videoName = cols[videoNameIdx].trim().replace(/"/g, "");
            const desc = cols[textContentIdx].trim().replace(/"/g, "");

            // 新增：取得該列的網紅名稱
            const influencer = cols[influencerIdx].trim().replace(/"/g, "");

            if (!groups[label]) groups[label] = [];
            // 將 influencer 一併存入 group 中
            groups[label].push({ videoName, desc, influencer });
        });

        // 渲染 HTML
        let html = `<div class="max-w-6xl mx-auto p-6 space-y-4">`;

        // 依群組編號排序 (Group 0, Group 1...)
        const sortedLabels = Object.keys(groups).sort(
            (a, b) => Number(a) - Number(b),
        );

        sortedLabels.forEach((label) => {
            const members = groups[label];
            // 群組內依 videoName 字典序排列
            members.sort((a, b) => a.videoName.localeCompare(b.videoName));

            html += `
                <div class="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
                    <div class="accordion-header flex justify-between items-center px-6 py-4 cursor-pointer hover:bg-slate-800/80 transition select-none bg-slate-800/40" data-label="${label}">
                        <div class="flex items-center space-x-4">
                            <span class="px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-sm font-bold border border-blue-500/30">Group ${label}</span>
                            <span class="text-slate-300 text-sm">${members.length}</span> <span class="text-slate-400 text-sm">Videos</span>
                        </div>
                        <svg class="w-5 h-5 text-slate-500 transform transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                    
                    <div class="accordion-content hidden border-t border-slate-800">
                        <div class="max-h-[600px] overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-950/30">
                            ${members
                                .map((m) => {
                                    // 核心修改：生成帶有 Token 的影片連結
                                    const videoUrl = `${APP_CONFIG.VIDEO_API_BASE}/${m.influencer}/${m.videoName}?token=${APP_CONFIG.VIDEO_TOKEN}`;

                                    return `
                                    <div class="space-y-2 group">
                                        <h4 class="text-blue-300 font-mono text-md group-hover:text-blue-200 transition">
                                            <a href="${videoUrl}" 
                                               target="_blank" 
                                               class="hover:underline flex items-center gap-2"
                                               title="點擊預覽影片">
                                               <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                   <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                   <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                               </svg>
                                               # [${m.videoName}]
                                            </a>
                                        </h4>
                                        <p class="text-slate-200 text-[16px] leading-relaxed pl-4 border-l-2 border-slate-800 group-hover:border-blue-500/50 transition">
                                            ${m.desc.replace(/\\n/g, "<br>")}
                                        </p>
                                    </div>
                                `;
                                })
                                .join("")}
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;

        // 綁定點擊事件
        document.querySelectorAll(".accordion-header").forEach((header) => {
            header.addEventListener("click", () => {
                const content = header.nextElementSibling;
                const icon = header.querySelector("svg");
                const isHidden = content.classList.contains("hidden");

                // 切換顯示/隱藏
                if (isHidden) {
                    content.classList.remove("hidden");
                    icon.classList.add("rotate-180");
                } else {
                    content.classList.add("hidden");
                    icon.classList.remove("rotate-180");
                }
            });
        });
    } catch (error) {
        console.error("[Features 渲染出錯]", error);
        container.innerHTML = `<div class="p-10 text-red-400">載入失敗: ${error.message}</div>`;
    }
}
