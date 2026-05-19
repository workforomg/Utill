import os
import json

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
                    # 파일명으로 author를 강제 주입하는 코드를 삭제했습니다.
                    # 유저가 JSON 안에 적은 name과 author가 그대로 병합됩니다.
                    merged_data.append(data)
        except Exception as e:
            print(f"오류 발생 ({filename}): {e}")

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(merged_data, f, ensure_ascii=False, indent=2)

print("유저가 입력한 작성자 정보와 함께 성공적으로 병합되었습니다.")
