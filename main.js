// main.js
import { APP_CONFIG } from "./config.js";
import { renderClusterView } from "./cluster.js";

document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("type-selector");

    // 初始化下拉選單
    APP_CONFIG.MODES.forEach((mode) => {
        const opt = document.createElement("option");
        opt.value = mode.key;
        opt.innerText = mode.label;
        selector.appendChild(opt);
    });

    // 監聽切換
    selector.addEventListener("change", (e) => {
        renderClusterView(e.target.value);
    });

    // 預設執行
    renderClusterView("visual");
});
