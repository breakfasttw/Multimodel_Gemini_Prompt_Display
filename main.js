// main.js
import { APP_CONFIG } from "./config.js";
import { renderClusterView } from "./cluster.js";
import { renderFeaturesView } from "./cluster_text.js";
import { renderVideoView } from "./all_video.js"; // 新增載入

document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("type-selector");
    const navCluster = document.getElementById("nav-cluster");
    const navFeatures = document.getElementById("nav-features");
    const navVideo = document.getElementById("nav-video");

    // 目前所在的視圖狀態: 'cluster' 或 'features'
    let currentView = "video";

    /**
     * 更新 UI 按鈕樣式
     */
    function updateNavUI() {
        [navCluster, navFeatures, navVideo].forEach((btn) => {
            btn.classList.remove("bg-blue-600", "text-white", "shadow-lg");
            btn.classList.add("text-slate-400");
        });

        const activeBtn = document.getElementById(`nav-${currentView}`);
        if (activeBtn) {
            activeBtn.classList.add("bg-blue-600", "text-white", "shadow-lg");
            activeBtn.classList.remove("text-slate-400");
        }
    }

    /**
     * 依照目前狀態切換渲染內容
     */
    function refreshContent() {
        const type = selector.value;
        if (currentView === "cluster") {
            renderClusterView(type);
        } else if (currentView === "features") {
            renderFeaturesView(type);
        } else if (currentView === "video") {
            renderVideoView(); // 新增調用
        }

        navVideo.addEventListener("click", () => {
            if (currentView === "video") return;
            currentView = "video";
            updateNavUI();
            refreshContent();
        });
    }

    // 初始化下拉選單
    APP_CONFIG.MODES.forEach((mode) => {
        const opt = document.createElement("option");
        opt.value = mode.key;
        opt.innerText = mode.label;
        selector.appendChild(opt);
    });

    // 監聽 Type 切換
    selector.addEventListener("change", () => {
        refreshContent();
    });

    // 監聽導覽按鈕：切換到 Cluster
    navCluster.addEventListener("click", () => {
        if (currentView === "cluster") return;
        currentView = "cluster";
        updateNavUI();
        refreshContent();
    });

    // 監聽導覽按鈕：切換到 Features
    navFeatures.addEventListener("click", () => {
        if (currentView === "features") return;
        currentView = "features";
        updateNavUI();
        refreshContent();
    });

    // 預設執行
    refreshContent();
});
