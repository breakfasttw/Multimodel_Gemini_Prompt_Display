import os
import json
import csv

def process_json_files(input_dir, output_file):
    # 準備儲存結果的列表
    results = []
    
    # 檢查資料夾是否存在
    if not os.path.exists(input_dir):
        print(f"錯誤：找不到資料夾 {input_dir}")
        return

    # 遍歷資料夾中的所有檔案
    for filename in os.listdir(input_dir):
        if filename.endswith(".json"):
            file_path = os.path.join(input_dir, filename)
            person_name = os.path.splitext(filename)[0] # 取得檔名作為 person
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    # 根據需求：videoName 出現在第二層
                    # 結構為 { "ID": { "videoName": "..." }, "ID2": { ... } }
                    for key, content in data.items():
                        if isinstance(content, dict) and 'videoName' in content:
                            video_name = content['videoName']
                            results.append([person_name, video_name])
            except Exception as e:
                print(f"處理檔案 {filename} 時發生錯誤: {e}")

    # 寫入 CSV 檔案
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.writer(csvfile)
        # 寫入表頭
        writer.writerow(['person', 'videoname'])
        # 寫入資料
        writer.writerows(results)

    print(f"處理完成！結果已存至 {output_file}")

if __name__ == "__main__":
    # 設定輸入資料夾路徑與輸出檔名
    input_folder = r'.\data\json_description'  # 請確保此資料夾存在
    output_csv = 'result.csv'
    
    process_json_files(input_folder, output_csv)