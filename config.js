// config.js
export const APP_CONFIG = {
    // 數據來源路徑
    DATA_PATHS: {
        visual: "./data/cluster_compare_visual.json",
        audio: "./data/cluster_compare_audio.json", // 預留未來擴充
        text: "./data/cluster_compare_text.json", // 預留未來擴充
        mix: "./data/cluster_compare_mix.json", // 預留未來擴充
        visual_members: "./data/visual_cluster_results_pca_umap.csv", // 存放成員名單的 CSV
        audio_members: "./data/audio_cluster_results.csv",
        text_members: "./data/text_cluster_results.csv",
        mix_members: "./data/mix_cluster_results.csv",
        ig_names: "./data/ownerid_mapping.csv",
    },
    // 下拉選單選項
    MODES: [
        { key: "visual", label: "Visual" },
        { key: "audio", label: "Audio" },
        { key: "text", label: "Text" },
        { key: "mix", label: "Mix" },
    ],
    // 數值統計的 Key
    NUMERIC_KEYS: ["min", "max", "mean", "avg", "std"],
    // 排除不顯示的欄位 (例如中繼資料)
    EXCLUDE_PATHS: ["metadata"],
};
