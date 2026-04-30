import os
import json

def merge_influencer_jsons(input_dir, output_dir):
    """
    遍歷各個網紅資料夾，將其中的影片 JSON 合併
    結構：input_dir / {influencer_id} / {influencer_id}-timestamp-mediaid.json
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"建立輸出目錄: {output_dir}")

    # 1. 取得 input_dir 下所有的網紅資料夾
    influencer_folders = [f for f in os.listdir(input_dir) if os.path.isdir(os.path.join(input_dir, f))]
    
    print(f"找到 {len(influencer_folders)} 個網紅資料夾。")

    for ig_id in influencer_folders:
        folder_path = os.path.join(input_dir, ig_id)
        merged_videos = {} # 用來存放該網紅的所有影片詳情

        # 2. 遍歷該網紅資料夾內的所有 JSON
        for filename in os.listdir(folder_path):
            if filename.endswith(".json"):
                # 解析 media_id (從檔名最後一段取得)
                # 範例檔名：0_shufen-20250305064036-766487259340008.json
                # parts[-1] = 766487259340008.json
                parts = filename.split('-')
                if len(parts) < 3:
                    continue
                
                media_id = parts[-1].replace(".json", "")
                file_path = os.path.join(folder_path, filename)
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = json.load(f)
                    
                    # 以 media_id 為 Key 存入
                    merged_videos[media_id] = content
                    
                except Exception as e:
                    print(f"讀取錯誤 {filename}: {e}")

        # 3. 如果該網紅有成功讀取到影片，寫出合併檔
        if merged_videos:
            output_path = os.path.join(output_dir, f"{ig_id}.json")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(merged_videos, f, ensure_ascii=False, indent=2)
            print(f"✅ 已完成合併：{ig_id}.json (共 {len(merged_videos)} 部影片)")
        else:
            print(f"⚠️ 跳過：{ig_id} 資料夾內沒有找到 JSON 檔案。")

# ==========================================
# 請設定你的路徑
# ==========================================
if __name__ == "__main__":
    # 這是你包含多個網紅資料夾的根目錄
    SOURCE_DIR = r".\data\analysis" 
    # 這是你要產出給前端使用的合併檔目錄 (對應 all_video.js 的讀取路徑)
    TARGET_DIR = r"D:\SINCA\Project\Multimodel_Gemini_Prompt_Display\data\json_description" 
    
    merge_influencer_jsons(SOURCE_DIR, TARGET_DIR)