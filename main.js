// main.js
import { APP_CONFIG } from "./config.js";
import { renderClusterView } from "./cluster.js";
import { renderFeaturesView } from "./cluster_text.js";

document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("type-selector");
    const navCluster = document.getElementById("nav-cluster");
    const navFeatures = document.getElementById("nav-features");

    // 目前所在的視圖狀態: 'cluster' 或 'features'
    let currentView = "cluster";

    /**
     * 更新 UI 按鈕樣式
     */
    function updateNavUI() {
        if (currentView === "cluster") {
            navCluster.classList.add("bg-blue-600", "text-white", "shadow-lg");
            navCluster.classList.remove("text-slate-400");
            navFeatures.classList.remove(
                "bg-blue-600",
                "text-white",
                "shadow-lg",
            );
            navFeatures.classList.add("text-slate-400");
        } else {
            navFeatures.classList.add("bg-blue-600", "text-white", "shadow-lg");
            navFeatures.classList.remove("text-slate-400");
            navCluster.classList.remove(
                "bg-blue-600",
                "text-white",
                "shadow-lg",
            );
            navCluster.classList.add("text-slate-400");
        }
    }

    /**
     * 依照目前狀態切換渲染內容
     */
    function refreshContent() {
        const type = selector.value;
        if (currentView === "cluster") {
            renderClusterView(type);
        } else {
            renderFeaturesView(type);
        }
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
