import os
import json
import csv
import pandas as pd

def process_durations(input_dir, mvp_list_path, output_file):
    # 1. 讀取 Excel/CSV 清單並建立篩選過後的合法檔名集合
    # 根據需求：只針對 prompt_emb = 1 且 video_emb = 1 且 audio_emb = 1 的檔案
    try:
        # 使用 pandas 讀取，因為原檔是 xlsx 轉出的 csv
        df = pd.read_csv(mvp_list_path)
        
        # 篩選條件
        mask = (df['prompt_emb'] == 1) & (df['video_emb'] == 1) & (df['audio_emb'] == 1)
        # 取得所有符合條件的 expected_filename，轉成 set 加快查詢速度
        valid_filenames = set(df[mask]['expected_filename'].tolist())
        print(f"篩選條件完成，共計 {len(valid_filenames)} 個目標檔案需處理。")
    except Exception as e:
        print(f"讀取篩選清單時發生錯誤: {e}")
        return

    results = []

    # 2. 遍歷資料夾中的所有 JSON 檔案
    if not os.path.exists(input_dir):
        print(f"錯誤：找不到資料夾 {input_dir}")
        return

    for filename in os.listdir(input_dir):
        if filename.endswith(".json"):
            file_path = os.path.join(input_dir, filename)
            person_name = os.path.splitext(filename)[0]
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    # 遍歷 JSON 內的所有物件
                    for key, content in data.items():
                        if isinstance(content, dict):
                            v_name = content.get('videoName')
                            
                            # 3. 對照清單：檢查 videoName 是否在篩選過的集合中
                            if v_name in valid_filenames:
                                # 取得 videoDuration
                                # 根據 JSON 結構，它在 low_inference_observations -> basic_metadata 內
                                try:
                                    duration = content['low_inference_observations']['basic_metadata']['videoDuration']
                                    results.append([person_name, v_name, duration])
                                except KeyError:
                                    print(f"警告：檔案 {v_name} 找不到 videoDuration 欄位")
            except Exception as e:
                print(f"處理檔案 {filename} 時發生錯誤: {e}")

    # 4. 寫入結果
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['person', 'videonsame', 'videoDuration'])
        writer.writerows(results)

    print(f"處理完成！結果已存至 {output_file}，共計找出 {len(results)} 筆相符資料。")

if __name__ == "__main__":
    # 設定路徑
    input_folder = r'.\data\json_description'  # 存放 JSON 的資料夾
    mvp_csv = 'mvp_file_list.csv' # 你的清單檔案
    output_csv = 'duration_result.csv'
    
    process_durations(input_folder, mvp_csv, output_csv)