#!/usr/bin/env python3
"""Extract dashboard-ready metadata from an iEQ9-style PDF.

Usage:
  python3 scripts/extract_report_pdf.py "/path/to/report.pdf"
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PyPDF2 import PdfReader


OCR_WHITESPACE = r"[ \t\u00A0\u2000-\u200B\u202F\u205F\u3000]"
OCR_INLINE_SPACING = rf"(?:{OCR_WHITESPACE}+)"
OCR_MULTI_SPACING = rf"(?:{OCR_WHITESPACE}{{2,}})"
OCR_WORD_GAP_MARKER = "\u0000"


def strip_control_noise_characters(text: str) -> str:
    return re.sub(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]", " ", str(text or ""))


def collapse_ocr_word_fragments(text: str) -> str:
    source = str(text or "")

    def collapse_letter_match(match: re.Match[str]) -> str:
        candidate = str(match.group(0) or "")
        marked = re.sub(OCR_MULTI_SPACING, OCR_WORD_GAP_MARKER, candidate)
        collapsed = re.sub(OCR_INLINE_SPACING, "", marked)
        if OCR_WORD_GAP_MARKER not in collapsed and len(collapsed) >= 24:
            return re.sub(OCR_INLINE_SPACING, " ", candidate).strip()
        return collapsed.replace(OCR_WORD_GAP_MARKER, " ")

    # Repair OCR splits like "M A I N  T Y P E" -> "MAIN TYPE" and "S X" -> "SX".
    source = re.sub(
        rf"\b(?:[A-Za-z]{OCR_INLINE_SPACING}){{2,}}[A-Za-z]\b",
        collapse_letter_match,
        source,
    )

    # Repair OCR splits like "2 0 2 6" -> "2026".
    source = re.sub(
        rf"\b(?:\d{OCR_INLINE_SPACING}){{2,}}\d\b",
        lambda match: re.sub(OCR_INLINE_SPACING, "", str(match.group(0) or "")),
        source,
    )
    source = source.replace(OCR_WORD_GAP_MARKER, " ")

    # Repair merged OCR boundaries such as "BenRussellReportDate".
    source = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", source)
    source = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", source)
    source = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", source)

    return source


def normalize(text: str) -> str:
    cleaned = strip_control_noise_characters(text)
    return re.sub(r"\s+", " ", collapse_ocr_word_fragments(cleaned)).strip()


def clean_metadata_value(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = normalize(value)
    cleaned = re.sub(r"^[\s:=\-–—,]+", "", cleaned).strip()
    cleaned = re.sub(r"\[\s*Page\s*\d{1,3}\s*\]", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\bPage\s*\d{1,3}(?:\s*(?:of|/)\s*\d{1,3})?\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(
        r"\s*(?:Main\s*Type|MainType|Type\s*Profile|TypeProfile|Report\s*Date|ReportDate|Date\s*of\s*Report|DateofReport|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence)\b.*$",
        "",
        cleaned,
        flags=re.I,
    ).strip()
    cleaned = normalize(cleaned)
    cleaned = re.sub(r"(?<=\d)\s*(?:[/.\-])\s*(?=\d)", lambda m: str(m.group(0)).strip().replace(" ", ""), cleaned)
    cleaned = re.sub(r"(?<=\d)\s+(?=\d)", "", cleaned)
    lowered = cleaned.lower()
    if lowered in {"", "not detected", "unknown", "n/a", "na", "none", "null"}:
        return None
    if "copyright" in lowered:
        return None
    return cleaned or None


def clean_client_name(value: str | None) -> str | None:
    cleaned = clean_metadata_value(value)
    if not cleaned:
        return None
    if len(cleaned) > 60:
        return None
    words = [token for token in re.split(r"\s+", cleaned) if token]
    if len(words) == 0 or len(words) > 4:
        return None
    if re.search(r"[.!?/:;@#\d]", cleaned):
        return None
    lowered = cleaned.lower()
    if re.search(
        r"\b(feeling|thinking|strain|integration|ennea|type|level|report|center|centre|intelligence|copyright|page)\b",
        lowered,
        flags=re.I,
    ):
        return None
    if not re.search(r"[A-Za-z]{2,}", cleaned):
        return None
    return cleaned


def normalize_type_number(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"[1-9]", value)
    return match.group(0) if match else None


def extract_type(text: str) -> tuple[str | None, str]:
    score = {str(i): 0 for i in range(1, 10)}
    patterns = [
        (
            r"\bM\s*A\s*I\s*N\s*T\s*Y\s*P\s*E\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:T\s*Y\s*P\s*E\s*)?([1-9])\b",
            28,
            "mainTypeLetterSpaced",
            1,
        ),
        (r"Main\s*Type\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:Type\s*)?([1-9])\b", 26, "mainTypeHash", 1),
        (r"Main\s*Type\s*[:\-]?\s*Type\s*([1-9])\b", 24, "mainType", 1),
        (r"\bMain\s*Type\b[^0-9]{0,24}([1-9])\b", 18, "mainTypeLoose", 1),
        (r"\bA\s+deeper\s+understanding\s+of\s+the\s+(?:SX|SO|SP)\s*[—-]\s*([1-9])\b", 22, "deeperUnderstanding", 1),
        (r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*([1-9])\b", 16, "resonanceSentence", 1),
        (r"main\s+type\s+as\s+an\s+Ennea\s*([1-9])\b", 14, "mainTypeAsEnnea", 1),
        (r"type\s*([1-9])\s+which\s+is\s+also\s+known\s+as", 12, "typeKnownAs", 1),
        (r"Your\s*Type\s*[:\-#]?\s*([1-9])\b", 12, "yourType", 1),
        (r"\bType\s*([1-9])\s*[·•|]\s*(?:SX|SO|SP)\b", 10, "typeWithInstinctTag", 1),
        (r"Enneagram\s+type\s*([1-9])\b", 10, "enneagramType", 1),
        (r"\bEnnea\s*([1-9])\b", 3, "ennea", 1),
    ]
    blacklisted_context = re.compile(r"(all\s+9\s+types?|9\s+Enneagram\s+styles?)", re.I)
    score_table_context = re.compile(r"(type\s*1\b.*type\s*2\b.*type\s*3\b)|(type\s*7\b.*type\s*8\b.*type\s*9\b)", re.I)
    strongest_source = "none"
    strongest_weight = 0

    for pattern, weight, source, group_index in patterns:
        for match in re.finditer(pattern, text, re.I):
            type_num = normalize_type_number(match.group(group_index))
            if type_num not in score:
                continue
            start = max(0, match.start() - 36)
            end = min(len(text), match.end() + 54)
            ctx = text[start:end]
            if blacklisted_context.search(ctx):
                continue
            if score_table_context.search(ctx):
                continue
            score[type_num] += weight
            if weight > strongest_weight:
                strongest_weight = weight
                strongest_source = source

    winner = max(score.items(), key=lambda item: item[1])
    if winner[1] <= 0:
        return None, "none"
    return winner[0], strongest_source


def extract_type_from_filename(file_name: str) -> tuple[str | None, str]:
    normalized_name = normalize(file_name)
    if not normalized_name:
        return None, "none"
    patterns = [
        r"\btype[\s._-]*([1-9])\b",
        r"\bennea[\s._-]*([1-9])\b",
        r"\bieq9[\s._-]*([1-9])\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized_name, re.I)
        if match:
            detected = normalize_type_number(match.group(1))
            if detected:
                return detected, "fileNameTypePattern"
    return None, "none"


def instinct_label(code: str | None) -> str | None:
    c = (code or "").upper().strip()
    if c == "SX":
        return "SX — One-on-One"
    if c == "SO":
        return "SO — Social"
    if c == "SP":
        return "SP — Self-Preservation"
    return None


def extract_first(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match and match.group(1):
            candidate = clean_metadata_value(match.group(1))
            if candidate:
                return candidate
    return None


def title_case_level(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().lower()
    return value[:1].upper() + value[1:]


def cleanup_type_name(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(
        r"\b(Assertive|Decisive|Protective|Independent|Influential)\b.*$",
        "",
        normalize(value),
        flags=re.I,
    ).strip()
    cleaned = re.sub(r"^[^A-Za-z]+", "", cleaned).strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if "copyright" in lowered:
        return None
    return cleaned


def normalize_trifix(value: str | None) -> str | None:
    cleaned = clean_metadata_value(value)
    if not cleaned:
        return None
    digits = re.findall(r"[1-9]", cleaned)
    if len(digits) >= 3:
        return "-".join(digits[:3])
    return cleaned


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/extract_report_pdf.py \"/path/to/report.pdf\"")
        return 1

    pdf_path = Path(sys.argv[1]).expanduser()
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    reader = PdfReader(str(pdf_path))
    text = normalize("\n".join((page.extract_text() or "") for page in reader.pages))
    detected_type, detected_type_source = extract_type(text)
    if not detected_type:
        detected_type, detected_type_source = extract_type_from_filename(pdf_path.name)

    instinct_code = extract_first(text, [r"\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])"])
    instinct = instinct_label(instinct_code) or extract_first(
        text,
        [r"\b(SO|SP|SX)\s*[—-]\s*(Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b"],
    )
    type_name = extract_first(
        text,
        [
            r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*[1-9]\s+which\s+is\s+also\s+known\s+as\s*the\s*([A-Za-z][A-Za-z\s-]{2,40})",
            r"Main\s*Type\s*[:\-]?\s*Type\s*[1-9]\s*[—-]\s*([^.;\n]{3,80})",
        ],
    )
    if type_name:
        type_name = re.sub(r"([a-z])([A-Z])", r"\1 \2", type_name)
        type_name = cleanup_type_name(type_name)

    client_name = clean_client_name(
        extract_first(
        text,
        [
            r"\bClient\s*Name\s*[:\-]?\s*([^:]{2,80}?)(?=\s*(?:Report\s*Date|ReportDate|Date\s*of\s*Report|DateofReport|Main\s*Type|MainType|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
            r"\bName\s*[:\-]?\s*([^:]{2,80}?)(?=\s*(?:Report\s*Date|ReportDate|Main\s*Type|MainType|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
        ],
        )
    )
    report_date = extract_first(
        text,
        [
            r"\bReport\s*Date\s*[:\-]?\s*([^:]{3,60}?)(?=\s*(?:Client\s*Name|ClientName|Main\s*Type|MainType|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
            r"\bDate\s*of\s*Report\s*[:\-]?\s*([^:]{3,60}?)(?=\s*(?:Client\s*Name|ClientName|Main\s*Type|MainType|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
            r"\bDate\s*[:\-]?\s*([^:]{3,60}?)(?=\s*(?:Client\s*Name|ClientName|Main\s*Type|MainType|Trifix|Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
        ],
    )
    wing = extract_first(
        text,
        [
            r"\bWing\s*[:\-]?\s*([^:]{2,40}?)(?=\s*(?:Trifix|Level\s*of\s*Development|LevelofDevelopment|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
        ],
    )
    trifix = normalize_trifix(
        extract_first(
            text,
            [
                r"\bTrifix\s*[:\-]?\s*([^:]{2,40}?)(?=\s*(?:Level\s*of\s*Development|LevelofDevelopment|Wing|Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|$))",
            ],
        )
    )
    level_of_development = extract_first(
        text,
        [
            r"\bLevel\s*of\s*Development\s*[:\-]?\s*([^:]{2,50}?)(?=\s*(?:Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|Wing|Trifix|$))",
            r"\bDevelopment\s*Level\s*[:\-]?\s*([^:]{2,50}?)(?=\s*(?:Center\s*of\s*Intelligence|CenterofIntelligence|Centre\s*of\s*Intelligence|CentreofIntelligence|Wing|Trifix|$))",
        ],
    )
    centre_of_intelligence = extract_first(
        text,
        [
            r"\b(?:Centre|Center)\s*of\s*Intelligence\s*[:\-]?\s*([^:]{2,50}?)(?=\s*(?:Level\s*of\s*Development|LevelofDevelopment|Wing|Trifix|$))",
        ],
    )
    integration_level = extract_first(
        text,
        [
            r"Integration\s*Level\s*[:\-]?\s*(High|Moderate|Low)\b",
            r"\b(High|Moderate|Low)\s+Integration\b",
        ],
    )
    integration_level = title_case_level(integration_level)
    level_of_development = clean_metadata_value(level_of_development)

    payload = {
        "source": "python_extract_report_pdf",
        "fileName": pdf_path.name,
        "pageCount": len(reader.pages),
        "detectedType": detected_type,
        "detectedTypeSource": detected_type_source,
        "typeName": type_name,
        "instinct": instinct,
        "integrationLevel": integration_level,
        "clientName": client_name,
        "reportDate": report_date,
        "wing": wing,
        "trifix": trifix,
        "levelOfDevelopment": level_of_development,
        "centreOfIntelligence": centre_of_intelligence,
        "containsMarkers": {
            "resonanceSentence": bool(
                re.search(r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*[1-9]\b", text, re.I)
            ),
            "mainTypeAsEnnea": bool(re.search(r"main\s+type\s+as\s+an\s+Ennea\s*[1-9]\b", text, re.I)),
            "instinctSentence": bool(re.search(r"\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])", text, re.I)),
            "clientName": bool(client_name),
            "reportDate": bool(report_date),
            "trifix": bool(trifix),
            "levelOfDevelopment": bool(level_of_development),
        },
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
