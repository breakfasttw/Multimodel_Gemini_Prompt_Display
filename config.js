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

    // 影片 API 設定
    VIDEO_API_BASE: "http://140.109.171.245:8080/stream",
    VIDEO_TOKEN:
        "Ij56g2T8wER55H692A04PYK9QMV2I46UPr9U7Q2W0M5E1X3T2AP4ETUIF2NO1R9B7I3LEVPIM",

    // 類別顏色對應
    CATEGORY_COLORS: {
        "3C科技": "#5ccded",
        遊戲電玩: "#2ff9db",
        汽機車: "#2c9db6",
        影視評論: "#50e3ad",
        理財創業: "#6e86a1",
        運動健身: "#8ab1c5",
        高階經理人: "#b1b7b8",
        醫療健康: "#999494",

        知識教育: "#B8E986",
        時事討論: "#72ad6a",
        旅遊: "#91e432",
        美食料理: "#F8E71C",
        寵物: "#acb924",
        趣味搞笑: "#ffffff",
        表演藝術: "#d1b3e4",

        家庭母嬰: "#f1ba4b",
        帶貨分潤: "#d5981e",
        時尚潮流: "#FF4081",
        美妝保養: "#E91E63",

        綜合其他: "#a59c9c",
        default: "#64748b", // 意外處理預設色
    },
};
