import os
import json

# 파이썬 스크립트와 같은 위치(command list)에 있으므로 바로 폴더명만 씁니다.
INPUT_DIR = 'preset'
OUTPUT_FILE = 'total.json'

merged_data = []

if not os.path.exists(INPUT_DIR):
    os.makedirs(INPUT_DIR)

for filename in os.listdir(INPUT_DIR):
    if filename.endswith('.json'):
        filepath = os.path.join(INPUT_DIR, filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                if isinstance(data, dict):
                    author_name = filename.replace('.json', '')
                    data['author'] = author_name
                    merged_data.append(data)
        except Exception as e:
            print(f"오류 발생 ({filename}): {e}")

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(merged_data, f, ensure_ascii=False, indent=2)

print("성공적으로 command list/total.json 파일이 생성되었습니다.")
