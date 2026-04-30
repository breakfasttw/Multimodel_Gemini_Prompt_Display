import json
import csv
import os

def process_meta_json(input_file, output_file):
    # 準備儲存結果的列表
    results = []
    
    # 檢查檔案是否存在
    if not os.path.exists(input_file):
        print(f"錯誤：找不到檔案 {input_file}")
        return

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            # 根據需求：裡面是一個陣列，包含多個物件
            for item in data:
                if isinstance(item, dict) and 'path' in item:
                    full_path = item['path']
                    # 只提取最終的檔名 (basename)
                    file_name = os.path.basename(full_path)
                    results.append([file_name])
    except Exception as e:
        print(f"處理檔案時發生錯誤: {e}")
        return

    # 寫入 CSV 檔案
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.writer(csvfile)
        # 寫入表頭
        writer.writerow(['filename'])
        # 寫入資料
        writer.writerows(results)

    print(f"處理完成！結果已存至 {output_file}，共計 {len(results)} 筆資料。")

if __name__ == "__main__":
    # 設定輸入與輸出路徑
    input_json = 'meta.json'
    output_csv = 'npy_result.csv'
    
    process_meta_json(input_json, output_csv)