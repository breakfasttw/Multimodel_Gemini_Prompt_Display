// config.js
// 讀取全域變數，若 window.ENV 不存在 (GitHub Pages 環境)，則設為空字串
const env = window.ENV || { VIDEO_API_BASE: "", VIDEO_TOKEN: "" };

export const APP_CONFIG = {
    // 數據來源路徑
    DATA_PATHS: {
        visual: "./data/cluster_compare_visual-8.json",
        audio: "./data/cluster_compare_audio-6.json", // 預留未來擴充
        text: "./data/cluster_compare_text-10.json", // 預留未來擴充
        mix: "./data/cluster_compare_mix-8.json", // 預留未來擴充
        visual_members: "./data/visual_cluster_pca-umap-8.csv", // 存放成員名單的 CSV
        audio_members: "./data/audio_cluster_pca-umap-6.csv",
        text_members: "./data/text_cluster_pca-umap-10.csv",
        mix_members: "./data/mix_cluster_pca-umap-8.csv",
        ig_names: "./data/ownerid_mapping.csv",

        all_influencers: "./data/influencer_all_info.csv", // 或你的 xlsx 轉出的 csv
        video_info_dir: "./data/Top200_VideoInfo", // 存放 {ig_id}-FullVideoInfo.csv 的資料夾
        video_details_dir: "./data/json_description", // 存放合併後 {ig_id}.json 的資料夾
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
    HIDE_FIELDS: [
        "low_inference_observations.basic_metadata.location.country",
        "low_inference_observations.basic_metadata.location.city",
        "low_inference_observations.visual_scene_and_style.season",
        "low_inference_observations.visual_scene_and_style.textOverlay.language",
        "low_inference_observations.visual_objects_and_brands.animalDetect",
        "low_inference_observations.visual_objects_and_brands.foodsDetect",
        "low_inference_observations.visual_objects_and_brands.trafficDetect",
        "low_inference_observations.visual_objects_and_brands.techDetect",
        "low_inference_observations.audio_vocal_characterization.vocal_qualities.language",
    ],

    // 影片 API 設定 (從 envConfig 讀取)
    VIDEO_API_BASE: env.VIDEO_API_BASE || "REPLACE_ME_API_BASE",
    VIDEO_TOKEN: env.VIDEO_TOKEN || "REPLACE_ME_TOKEN",
};
