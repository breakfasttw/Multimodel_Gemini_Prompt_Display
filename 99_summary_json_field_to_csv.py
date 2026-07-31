import csv
import json
from pathlib import Path
from typing import Any


# ============================================================
# 使用者參數
# ============================================================

# JSON 根目錄。
# 程式會遞迴搜尋此目錄及所有子資料夾中的 .json 檔案。
input_json_dir = Path(
    r"T:\Code\Task\Multimodel_Gemini_Prompt_Display\data\analysis"
)

# False：
#   重新掃描所有 JSON，建立一份全新的 CSV。
#
# True：
#   讀取既有 CSV，新增或更新 new_target_fieldname 欄位。
#   不會重建 influencer、json_name、media_id 基礎清單。
is_output_csv_exist = False

# CSV 輸出資料夾。
# 注意：Python raw string 不能以單一反斜線結尾。
output_csv_dir = Path(
    r"T:\Code\Task\Multimodel_Gemini_Prompt_Display\data"
)

# CSV 輸出檔名。
output_csv_filename = "json_description_summary.csv"

# 要建立或更新的 CSV 欄位名稱。
new_target_fieldname = "is_endorsement"

# 目標欄位在 JSON 內的絕對路徑。
# 每一層 key 以英文句點「.」分隔。
new_target_json_location = (
    "high_inference.endorsement_analysis.isEndorsement"
)


# ============================================================
# 固定設定
# ============================================================

# CSV 的三個基礎欄位。
BASE_FIELDNAMES = [
    "influencer",
    "json_name",
    "media_id",
]

# 找不到 JSON 欄位時，CSV 中要填入的值。
# 使用空字串可區分：
#   欄位不存在：空白
#   欄位存在且為 false：False
MISSING_VALUE = ""


def find_json_files(root_dir: Path) -> list[Path]:
    """
    遞迴搜尋 root_dir 下所有副檔名為 .json 的檔案。

    使用 suffix.lower()，因此也能辨識：
    .json、.JSON、.Json 等大小寫形式。
    """
    return sorted(
        path
        for path in root_dir.rglob("*")
        if path.is_file() and path.suffix.lower() == ".json"
    )


def load_json_file(json_path: Path) -> Any:
    """
    讀取並解析一份 JSON。

    預設以 UTF-8-SIG 讀取：
    - 可正常讀取一般 UTF-8 JSON
    - 也可處理含有 BOM 的 UTF-8 JSON
    """
    with json_path.open(
        mode="r",
        encoding="utf-8-sig",
    ) as file:
        return json.load(file)


def get_nested_json_value(
    json_data: Any,
    json_location: str,
) -> tuple[bool, Any]:
    """
    依照「a.b.c」形式的 JSON 路徑，逐層取得目標值。

    例如：
        json_location =
        "high_inference.endorsement_analysis.isEndorsement"

    等同於：
        json_data["high_inference"]
                 ["endorsement_analysis"]
                 ["isEndorsement"]

    回傳：
        (True, value)
            成功找到目標欄位。

        (False, None)
            任一層不存在，或中間節點不是 dict。
    """
    if not json_location.strip():
        return False, None

    keys = [
        key.strip()
        for key in json_location.split(".")
        if key.strip()
    ]

    if not keys:
        return False, None

    current_value = json_data

    for key in keys:
        # 只有 dict 才能繼續依照 key 向下搜尋。
        if not isinstance(current_value, dict):
            return False, None

        if key not in current_value:
            return False, None

        current_value = current_value[key]

    return True, current_value


def convert_value_for_csv(value: Any) -> Any:
    """
    將 JSON 欄位值轉換成適合寫入 CSV 的格式。

    處理原則：
    - None：
        寫成空白。
    - bool：
        保留為 True / False，與範例 CSV 一致。
    - str、int、float：
        直接寫入。
    - list、dict：
        轉成合法 JSON 字串，保留完整結構。
    - 其他特殊型別：
        轉成一般字串。
    """
    if value is None:
        return ""

    if isinstance(value, bool):
        return value

    if isinstance(value, (str, int, float)):
        return value

    if isinstance(value, (list, dict)):
        return json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    return str(value)


def get_influencer_name(
    json_path: Path,
    root_dir: Path,
) -> str:
    """
    取得 JSON 相對於 input_json_dir 的第一層子資料夾名稱。

    例如：
        root_dir:
            T:\\...\\data\\analysis

        json_path:
            T:\\...\\data\\analysis\\5inana\\example.json

        回傳：
            5inana

    即使未來 JSON 位於更深層：
        analysis\\5inana\\subfolder\\example.json

    仍會回傳：
        5inana
    """
    relative_path = json_path.relative_to(root_dir)

    # relative_path.parts 範例：
    # ("5inana", "example.json")
    if len(relative_path.parts) < 2:
        # JSON 直接放在 analysis 根目錄時，
        # 因為沒有第一層網紅資料夾，所以留空。
        return ""

    return relative_path.parts[0]


def get_json_name(json_path: Path) -> str:
    """
    取得不包含副檔名的 JSON 檔名。

    例如：
        5inana-20250508064327-1231918062400462.json

    回傳：
        5inana-20250508064327-1231918062400462
    """
    return json_path.stem


def get_media_id(json_name: str) -> str:
    """
    取得 json_name 最右側最後一個 dash「-」後面的字串。

    例如：
        5inana-20250508064327-1231918062400462

    回傳：
        1231918062400462

    使用 rsplit("-", 1)，只從最右邊切割一次。

    回傳型別固定為 str，避免：
    - 開頭的 0 消失
    - 超長整數被試算表轉成科學記號
    """
    if "-" not in json_name:
        return ""

    return json_name.rsplit("-", 1)[-1]


def make_json_lookup_key(
    influencer: str,
    json_name: str,
) -> tuple[str, str]:
    """
    建立 JSON 與既有 CSV 之間的比對鍵。

    使用 influencer + json_name，而不是依賴列順序，
    可避免檔案排序不同而把結果寫入錯誤的資料列。
    """
    return (
        str(influencer).strip(),
        str(json_name).strip(),
    )


def scan_json_files(
    json_files: list[Path],
    root_dir: Path,
    target_json_location: str,
) -> tuple[list[dict[str, Any]], dict[str, int], list[str]]:
    """
    掃描所有 JSON 並建立結果資料。

    每份成功辨識的 JSON 會產生：
        influencer
        json_name
        media_id
        target_value

    即使目標欄位不存在，仍會保留該 JSON 的基礎資料，
    只是 target_value 會留空。

    回傳：
        results：
            每份 JSON 的解析結果。

        statistics：
            執行統計。

        error_messages：
            JSON 解析失敗或路徑異常的詳細訊息。
    """
    results: list[dict[str, Any]] = []
    error_messages: list[str] = []

    statistics = {
        "found_json_count": len(json_files),
        "json_parse_success_count": 0,
        "json_parse_failed_count": 0,
        "target_found_count": 0,
        "target_missing_count": 0,
        "missing_influencer_count": 0,
        "missing_media_id_count": 0,
    }

    for index, json_path in enumerate(
        json_files,
        start=1,
    ):
        influencer = get_influencer_name(
            json_path=json_path,
            root_dir=root_dir,
        )

        json_name = get_json_name(json_path)
        media_id = get_media_id(json_name)

        if not influencer:
            statistics["missing_influencer_count"] += 1

        if not media_id:
            statistics["missing_media_id_count"] += 1

        try:
            json_data = load_json_file(json_path)
            statistics["json_parse_success_count"] += 1

        except (
            json.JSONDecodeError,
            UnicodeDecodeError,
            OSError,
        ) as error:
            statistics["json_parse_failed_count"] += 1

            error_messages.append(
                f"[JSON 讀取失敗] {json_path} | "
                f"{type(error).__name__}: {error}"
            )

            # JSON 無法解析時，仍保留該檔案的基礎資訊，
            # 但目標欄位留空。
            results.append(
                {
                    "influencer": influencer,
                    "json_name": json_name,
                    "media_id": media_id,
                    "target_value": MISSING_VALUE,
                }
            )
            continue

        target_exists, target_value = get_nested_json_value(
            json_data=json_data,
            json_location=target_json_location,
        )

        if target_exists:
            statistics["target_found_count"] += 1
            csv_value = convert_value_for_csv(target_value)
        else:
            statistics["target_missing_count"] += 1
            csv_value = MISSING_VALUE

            error_messages.append(
                f"[找不到目標欄位] {json_path} | "
                f"JSON 路徑：{target_json_location}"
            )

        results.append(
            {
                "influencer": influencer,
                "json_name": json_name,
                "media_id": media_id,
                "target_value": csv_value,
            }
        )

        # 每處理 100 份檔案印一次進度。
        if index % 100 == 0 or index == len(json_files):
            print(
                f"[進度] 已處理 "
                f"{index}/{len(json_files)} 份 JSON"
            )

    return results, statistics, error_messages


def write_new_csv(
    output_csv_path: Path,
    scan_results: list[dict[str, Any]],
    target_fieldname: str,
) -> int:
    """
    建立全新的 CSV。

    欄位順序固定為：
        influencer
        json_name
        media_id
        new_target_fieldname

    如果既有同名 CSV，會直接覆寫。
    """
    fieldnames = BASE_FIELDNAMES + [target_fieldname]

    with output_csv_path.open(
        mode="w",
        encoding="utf-8-sig",
        newline="",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
            extrasaction="ignore",
        )

        writer.writeheader()

        for item in scan_results:
            writer.writerow(
                {
                    "influencer": item["influencer"],
                    "json_name": item["json_name"],
                    "media_id": item["media_id"],
                    target_fieldname: item["target_value"],
                }
            )

    return len(scan_results)


def read_existing_csv(
    csv_path: Path,
) -> tuple[list[dict[str, str]], list[str]]:
    """
    讀取既有 CSV。

    csv 模組讀取的所有內容均為字串，
    因此 media_id 不會被自動轉成數字。

    回傳：
        rows：
            CSV 所有資料列。

        fieldnames：
            原始 CSV 欄位順序。
    """
    with csv_path.open(
        mode="r",
        encoding="utf-8-sig",
        newline="",
    ) as file:
        reader = csv.DictReader(file)

        if reader.fieldnames is None:
            raise ValueError(
                f"CSV 沒有表頭：{csv_path}"
            )

        fieldnames = list(reader.fieldnames)
        rows = [dict(row) for row in reader]

    return rows, fieldnames


def update_existing_csv(
    output_csv_path: Path,
    scan_results: list[dict[str, Any]],
    target_fieldname: str,
) -> dict[str, int]:
    """
    在既有 CSV 中新增或更新目標欄位。

    比對鍵：
        influencer + json_name

    處理原則：
    - 目標欄位不存在：
        加到 CSV 最右側。
    - 目標欄位已存在：
        直接更新，不重複建立同名欄位。
    - CSV 有對應 JSON：
        寫入掃描結果。
    - CSV 找不到對應 JSON：
        該列目標欄位留空或保留原值。
    - JSON 不存在於既有 CSV：
        不自動新增資料列，因為使用者指定此模式只擴充既有 CSV。
    """
    existing_rows, fieldnames = read_existing_csv(
        output_csv_path
    )

    missing_required_fields = [
        fieldname
        for fieldname in ("influencer", "json_name")
        if fieldname not in fieldnames
    ]

    if missing_required_fields:
        raise ValueError(
            "既有 CSV 缺少比對所需欄位："
            + ", ".join(missing_required_fields)
        )

    # 若目標欄位尚不存在，新增到最右側。
    if target_fieldname not in fieldnames:
        fieldnames.append(target_fieldname)

    # 建立：
    # (influencer, json_name) -> target_value
    json_value_lookup: dict[tuple[str, str], Any] = {}

    for item in scan_results:
        lookup_key = make_json_lookup_key(
            influencer=item["influencer"],
            json_name=item["json_name"],
        )

        json_value_lookup[lookup_key] = item["target_value"]

    matched_csv_rows = 0
    unmatched_csv_rows = 0
    csv_keys: set[tuple[str, str]] = set()

    for row in existing_rows:
        lookup_key = make_json_lookup_key(
            influencer=row.get("influencer", ""),
            json_name=row.get("json_name", ""),
        )

        csv_keys.add(lookup_key)

        if lookup_key in json_value_lookup:
            row[target_fieldname] = json_value_lookup[lookup_key]
            matched_csv_rows += 1
        else:
            unmatched_csv_rows += 1

            # 當 CSV 沒有對應 JSON 時：
            # 若目標欄位原本不存在，就填空白；
            # 若欄位原本存在，則保留其原值。
            row.setdefault(target_fieldname, MISSING_VALUE)

    json_not_in_csv_count = sum(
        1
        for lookup_key in json_value_lookup
        if lookup_key not in csv_keys
    )

    # 以寫入模式覆蓋原 CSV。
    # 資料列與原始 CSV 相同，只新增或更新目標欄位。
    with output_csv_path.open(
        mode="w",
        encoding="utf-8-sig",
        newline="",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
            extrasaction="ignore",
        )

        writer.writeheader()
        writer.writerows(existing_rows)

    return {
        "existing_csv_row_count": len(existing_rows),
        "matched_csv_rows": matched_csv_rows,
        "unmatched_csv_rows": unmatched_csv_rows,
        "json_not_in_csv_count": json_not_in_csv_count,
        "written_csv_rows": len(existing_rows),
    }


def print_execution_summary(
    output_csv_path: Path,
    statistics: dict[str, int],
    error_messages: list[str],
    update_statistics: dict[str, int] | None = None,
) -> None:
    """
    打印執行結果摘要及異常檔案。
    """
    print()
    print("=" * 70)
    print("執行摘要")
    print("=" * 70)

    print(
        f"找到 JSON 檔案數："
        f"{statistics['found_json_count']}"
    )
    print(
        f"JSON 解析成功："
        f"{statistics['json_parse_success_count']}"
    )
    print(
        f"JSON 解析失敗："
        f"{statistics['json_parse_failed_count']}"
    )
    print(
        f"成功找到目標欄位："
        f"{statistics['target_found_count']}"
    )
    print(
        f"找不到目標欄位："
        f"{statistics['target_missing_count']}"
    )
    print(
        f"無法取得 influencer："
        f"{statistics['missing_influencer_count']}"
    )
    print(
        f"無法取得 media_id："
        f"{statistics['missing_media_id_count']}"
    )

    if update_statistics is not None:
        print("-" * 70)
        print(
            f"既有 CSV 資料列數："
            f"{update_statistics['existing_csv_row_count']}"
        )
        print(
            f"成功匹配並更新的 CSV 列數："
            f"{update_statistics['matched_csv_rows']}"
        )
        print(
            f"CSV 中找不到對應 JSON 的列數："
            f"{update_statistics['unmatched_csv_rows']}"
        )
        print(
            f"JSON 中存在但 CSV 沒有的檔案數："
            f"{update_statistics['json_not_in_csv_count']}"
        )
        print(
            f"最後寫入 CSV 的列數："
            f"{update_statistics['written_csv_rows']}"
        )

    print("-" * 70)
    print(f"輸出檔案：{output_csv_path}")

    if error_messages:
        print()
        print("=" * 70)
        print("異常與提醒")
        print("=" * 70)

        for message in error_messages:
            print(message)

    print()
    print("程式執行完成。")


def validate_parameters(
    root_dir: Path,
    output_dir: Path,
    target_fieldname: str,
    target_json_location: str,
) -> None:
    """
    在正式執行前檢查必要參數。
    """
    if not root_dir.exists():
        raise FileNotFoundError(
            f"input_json_dir 不存在：{root_dir}"
        )

    if not root_dir.is_dir():
        raise NotADirectoryError(
            f"input_json_dir 不是資料夾：{root_dir}"
        )

    if not target_fieldname.strip():
        raise ValueError(
            "new_target_fieldname 不可為空。"
        )

    if not target_json_location.strip():
        raise ValueError(
            "new_target_json_location 不可為空。"
        )

    # output_csv_dir 若不存在就自動建立。
    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


def main() -> None:
    """
    主執行流程。
    """
    validate_parameters(
        root_dir=input_json_dir,
        output_dir=output_csv_dir,
        target_fieldname=new_target_fieldname,
        target_json_location=new_target_json_location,
    )

    output_csv_path = (
        output_csv_dir / output_csv_filename
    )

    # 更新模式下，既有 CSV 必須存在。
    if (
        is_output_csv_exist
        and not output_csv_path.exists()
    ):
        raise FileNotFoundError(
            "is_output_csv_exist=True，"
            "但找不到既有 CSV："
            f"{output_csv_path}"
        )

    print("=" * 70)
    print("JSON description 摘要程式")
    print("=" * 70)
    print(f"JSON 根目錄：{input_json_dir}")
    print(f"輸出 CSV：{output_csv_path}")
    print(f"CSV 目標欄位：{new_target_fieldname}")
    print(
        f"JSON 目標路徑："
        f"{new_target_json_location}"
    )
    print(
        "執行模式："
        + (
            "更新既有 CSV"
            if is_output_csv_exist
            else "建立全新 CSV"
        )
    )
    print()

    json_files = find_json_files(input_json_dir)

    if not json_files:
        print(
            "找不到任何 .json 檔案，"
            "程式不會建立或修改 CSV。"
        )
        return

    scan_results, statistics, error_messages = (
        scan_json_files(
            json_files=json_files,
            root_dir=input_json_dir,
            target_json_location=(
                new_target_json_location
            ),
        )
    )

    if is_output_csv_exist:
        update_statistics = update_existing_csv(
            output_csv_path=output_csv_path,
            scan_results=scan_results,
            target_fieldname=new_target_fieldname,
        )

    else:
        written_row_count = write_new_csv(
            output_csv_path=output_csv_path,
            scan_results=scan_results,
            target_fieldname=new_target_fieldname,
        )

        update_statistics = {
            "existing_csv_row_count": 0,
            "matched_csv_rows": 0,
            "unmatched_csv_rows": 0,
            "json_not_in_csv_count": 0,
            "written_csv_rows": written_row_count,
        }

    print_execution_summary(
        output_csv_path=output_csv_path,
        statistics=statistics,
        error_messages=error_messages,
        update_statistics=update_statistics,
    )


if __name__ == "__main__":
    main()