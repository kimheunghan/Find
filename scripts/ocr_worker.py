"""FindInside용 상주 PaddleOCR 작업자. stdin/stdout은 한 줄당 JSON 한 개를 사용한다."""

import json
import os
import sys
import traceback

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLEOCR_HOME", os.path.join(os.path.dirname(__file__), "..", ".ocr-models"))


def as_plain(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def result_dict(result):
    value = getattr(result, "json", result)
    if callable(value):
        value = value()
    if isinstance(value, str):
        value = json.loads(value)
    if isinstance(value, dict) and isinstance(value.get("res"), dict):
        return value["res"]
    return value if isinstance(value, dict) else {}


def make_chunks(results):
    lines = []
    for result in results:
        data = result_dict(result)
        texts = as_plain(data.get("rec_texts", [])) or []
        scores = as_plain(data.get("rec_scores", [])) or []
        boxes = as_plain(data.get("rec_boxes", [])) or []
        for index, text in enumerate(texts):
            text = str(text).strip()
            score = float(scores[index]) if index < len(scores) else 1.0
            if not text or score < 0.45:
                continue
            box = boxes[index] if index < len(boxes) else []
            y = float(box[1]) if len(box) >= 2 else len(lines)
            x = float(box[0]) if len(box) >= 1 else 0
            lines.append((y, x, score, text))
    lines.sort(key=lambda item: (item[0], item[1]))
    return [
        {"location": {"ocr": True, "line": index + 1, "confidence": round(item[2], 3)}, "text": item[3]}
        for index, item in enumerate(lines)
    ]


def main():
    from paddleocr import PaddleOCR

    # PP-OCRv5 한국어 모델을 쓴다. (가벼운 mobile 검출 모델은 한글 줄을 놓쳐서 쓰지 않는다.)
    # 문서 펴기(왜곡 보정)·방향 판별은 한 장에 20초 넘게 걸려 기본으로 끈다.
    # 사진으로 찍은 문서가 많으면 FINDINSIDE_OCR_ACCURATE=1 로 켤 수 있다.
    accurate = os.environ.get("FINDINSIDE_OCR_ACCURATE") == "1"
    ocr = PaddleOCR(
        lang="korean",
        use_doc_orientation_classify=accurate,
        use_doc_unwarping=accurate,
        use_textline_orientation=accurate,
    )
    for line in sys.stdin:
        try:
            request = json.loads(line)
            results = ocr.predict(request["path"])
            response = {"id": request["id"], "ok": True, "chunks": make_chunks(results)}
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            response = {"id": request.get("id"), "ok": False, "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
