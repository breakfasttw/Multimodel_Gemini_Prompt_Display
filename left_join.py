import pandas as pd

# 1. 讀取 CSV 檔案
df_left = pd.read_csv(r'.\data\ownerid_mapping.csv')
df_right = pd.read_csv(r'.\data\ownerid_mapping_id.csv')

# 2. 進行 Left Join
# how='left' 表示保留左側表所有列
# on='id' 表示使用 'id' 欄位作為 key
merged_df = pd.merge(df_left, df_right, how='left', on='ig_id')

# 3. 處理結果（選做：將 NaN 替換為指定值，例如 0 或 "Unknown"）
# merged_df = merged_df.fillna(0)

# 4. 匯出結果
merged_df.to_csv('merged_output.csv', index=False, encoding='utf-8')

print(merged_df)
