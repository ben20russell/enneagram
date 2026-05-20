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


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def extract_type(text: str) -> tuple[str | None, str]:
    score = {str(i): 0 for i in range(1, 10)}
    patterns = [
        (r"Main\s*Type\s*[:\-]?\s*Type\s*([1-9])\b", 18, "mainType"),
        (r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*([1-9])\b", 16, "resonanceSentence"),
        (r"main\s+type\s+as\s+an\s+Ennea\s*([1-9])\b", 14, "mainTypeAsEnnea"),
        (r"Enneagram\s+type\s*([1-9])\b", 10, "enneagramType"),
        (r"type\s*([1-9])\s+which\s+is\s+also\s+known\s+as", 10, "typeKnownAs"),
        (r"\bEnnea\s*([1-9])\b", 3, "ennea"),
    ]
    blacklisted_context = re.compile(r"(all\s+9\s+types?|9\s+Enneagram\s+styles?)", re.I)
    strongest_source = "none"
    strongest_weight = 0

    for pattern, weight, source in patterns:
        for match in re.finditer(pattern, text, re.I):
            type_num = match.group(1)
            if type_num not in score:
                continue
            start = max(0, match.start() - 36)
            end = min(len(text), match.end() + 54)
            ctx = text[start:end]
            if blacklisted_context.search(ctx):
                continue
            score[type_num] += weight
            if weight > strongest_weight:
                strongest_weight = weight
                strongest_source = source

    winner = max(score.items(), key=lambda item: item[1])
    if winner[1] <= 0:
        return None, "none"
    return winner[0], strongest_source


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
            return normalize(match.group(1))
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
    return cleaned or None


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
    integration_level = extract_first(
        text,
        [
            r"Integration\s*Level\s*[:\-]?\s*(High|Moderate|Low)\b",
            r"\b(High|Moderate|Low)\s+Integration\b",
        ],
    )
    integration_level = title_case_level(integration_level)

    payload = {
        "fileName": pdf_path.name,
        "pageCount": len(reader.pages),
        "detectedType": detected_type,
        "detectedTypeSource": detected_type_source,
        "typeName": type_name,
        "instinct": instinct,
        "integrationLevel": integration_level,
        "containsMarkers": {
            "resonanceSentence": bool(
                re.search(r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*[1-9]\b", text, re.I)
            ),
            "mainTypeAsEnnea": bool(re.search(r"main\s+type\s+as\s+an\s+Ennea\s*[1-9]\b", text, re.I)),
            "instinctSentence": bool(re.search(r"\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])", text, re.I)),
        },
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
