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
from typing import Any

from PyPDF2 import PdfReader


OCR_WHITESPACE = r"[ \t\u00A0\u2000-\u200B\u202F\u205F\u3000]"
OCR_INLINE_SPACING = rf"(?:{OCR_WHITESPACE}+)"
OCR_MULTI_SPACING = rf"(?:{OCR_WHITESPACE}{{2,}})"
OCR_WORD_GAP_MARKER = "\u0000"
CONTROL_NOISE_PATTERN = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]")
REPLACEMENT_CHAR_PATTERN = re.compile(r"\uFFFD")
CID_ARTIFACT_PATTERN = re.compile(r"\(\s*c\s*i\s*d\s*:\s*\d+\s*\)", re.I)
CID_INLINE_PATTERN = re.compile(r"\bC\s*I\s*D\s*:\s*\d+\b", re.I)
CID_TOKEN_PATTERN = re.compile(r"\(cid:\d+\)", re.I)
NON_PRINTABLE_PATTERN = re.compile(r"[^\x09\x0A\x0D\x20-\x7E]")

DEFAULT_NOISE_THRESHOLDS: dict[str, int | float] = {
    "cid_count_threshold": 16,
    "replacement_count_threshold": 3,
    "min_length_for_ratio_check": 80,
    "min_alnum_ratio": 0.22,
}


def resolve_noise_thresholds(thresholds: dict[str, int | float] | None = None) -> dict[str, int | float]:
    merged = {
        "cid_count_threshold": int(DEFAULT_NOISE_THRESHOLDS["cid_count_threshold"]),
        "replacement_count_threshold": int(DEFAULT_NOISE_THRESHOLDS["replacement_count_threshold"]),
        "min_length_for_ratio_check": int(DEFAULT_NOISE_THRESHOLDS["min_length_for_ratio_check"]),
        "min_alnum_ratio": float(DEFAULT_NOISE_THRESHOLDS["min_alnum_ratio"]),
    }
    source = thresholds if isinstance(thresholds, dict) else {}
    for key in merged:
        if key not in source:
            continue
        value = source[key]
        if key == "min_alnum_ratio":
            merged[key] = float(value)
        else:
            merged[key] = int(value)
    return merged


def log_debug(message: str, details: dict[str, Any] | None = None) -> None:
    payload = details or {}
    print(
        f"[extract_report_pdf] {message} {json.dumps(payload, ensure_ascii=False)}",
        file=sys.stderr,
    )


def compute_text_health_snapshot(
    text: str,
    thresholds: dict[str, int | float] | None = None,
) -> dict[str, int | float | bool]:
    resolved = resolve_noise_thresholds(thresholds)
    source = str(text or "")
    total_chars = len(source)
    cid_count = len(CID_TOKEN_PATTERN.findall(source))
    replacement_count = len(REPLACEMENT_CHAR_PATTERN.findall(source))
    non_printable_count = len(NON_PRINTABLE_PATTERN.findall(source))
    alnum_count = len(re.findall(r"[A-Za-z0-9]", source))
    alnum_ratio = (alnum_count / total_chars) if total_chars > 0 else 0.0

    cid_noise = cid_count >= max(1, int(resolved["cid_count_threshold"]))
    replacement_noise = replacement_count >= max(1, int(resolved["replacement_count_threshold"]))
    low_alnum_noise = (
        total_chars >= int(resolved["min_length_for_ratio_check"])
        and alnum_ratio < float(resolved["min_alnum_ratio"])
    )
    is_noisy = cid_noise or replacement_noise or low_alnum_noise

    return {
        "is_noisy": is_noisy,
        "cid_count": cid_count,
        "replacement_count": replacement_count,
        "non_printable_count": non_printable_count,
        "alnum_count": alnum_count,
        "total_chars": total_chars,
        "alnum_ratio": round(alnum_ratio, 4),
        "cid_noise": cid_noise,
        "replacement_noise": replacement_noise,
        "low_alnum_noise": low_alnum_noise,
    }


def is_text_noisy(
    text: str,
    thresholds: dict[str, int | float] | None = None,
) -> bool:
    """Return True when extracted text quality is likely corrupted."""

    snapshot = compute_text_health_snapshot(text, thresholds=resolve_noise_thresholds(thresholds))
    return bool(snapshot.get("is_noisy"))


def extract_text_with_pdfplumber(pdf_path: Path) -> list[str]:
    import pdfplumber

    with pdfplumber.open(str(pdf_path)) as pdf:
        return [(page.extract_text() or "") for page in pdf.pages]


def extract_text_with_pypdf(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    return [(page.extract_text() or "") for page in reader.pages]


def extract_text_primary_attempt(pdf_path: Path) -> tuple[list[str], str]:
    """Primary text extraction using pdfplumber first, then PyPDF2 fallback."""

    errors: list[str] = []
    try:
        pages = extract_text_with_pdfplumber(pdf_path)
        return pages, "pdfplumber"
    except Exception as error:  # pragma: no cover - environment-dependent
        errors.append(f"pdfplumber:{error}")
        log_debug(
            "Primary extraction with pdfplumber failed. Falling back to PyPDF2.",
            {"file": str(pdf_path), "details": str(error)},
        )

    try:
        pages = extract_text_with_pypdf(pdf_path)
        return pages, "pypdf2"
    except Exception as error:
        errors.append(f"pypdf2:{error}")
        raise RuntimeError(
            f"Unable to extract PDF text with primary engines for {pdf_path}: {' | '.join(errors)}"
        ) from error


def extract_text_with_tesseract_ocr(
    pdf_path: Path,
    page_numbers: list[int],
    *,
    dpi: int = 350,
    language: str = "eng",
    tesseract_config: str = "--oem 3 --psm 6",
) -> dict[int, str]:
    """OCR selected pages via pdf2image + pytesseract."""

    if not page_numbers:
        return {}

    from pdf2image import convert_from_path
    import pytesseract

    ocr_text_by_page: dict[int, str] = {}
    unique_pages = sorted({int(page) for page in page_numbers if int(page) > 0})
    for page_number in unique_pages:
        images = convert_from_path(
            str(pdf_path),
            dpi=dpi,
            first_page=page_number,
            last_page=page_number,
            fmt="png",
            grayscale=True,
        )
        if not images:
            continue
        ocr_text = pytesseract.image_to_string(
            images[0],
            lang=language,
            config=tesseract_config,
        )
        ocr_text_by_page[page_number] = str(ocr_text or "")
    return ocr_text_by_page


def extract_page_texts_with_ocr_fallback(
    pdf_path: Path,
    *,
    thresholds: dict[str, int | float] | None = None,
    ocr_dpi: int = 350,
    ocr_language: str = "eng",
    ocr_tesseract_config: str = "--oem 3 --psm 6",
) -> tuple[list[str], dict[str, Any]]:
    """Extract page text; fallback to OCR when text health is noisy."""

    primary_pages, primary_engine = extract_text_primary_attempt(pdf_path)
    pages = [str(page or "") for page in primary_pages]

    resolved_thresholds = resolve_noise_thresholds(thresholds)
    page_health = [compute_text_health_snapshot(page, thresholds=resolved_thresholds) for page in pages]
    noisy_page_numbers = [
        index + 1
        for index, health in enumerate(page_health)
        if bool(health.get("is_noisy"))
    ]

    joined_primary = "\n".join(pages)
    overall_health = compute_text_health_snapshot(joined_primary, thresholds=resolved_thresholds)
    fallback_triggered = bool(noisy_page_numbers) or bool(overall_health.get("is_noisy"))

    diagnostics: dict[str, Any] = {
        "primaryEngine": primary_engine,
        "primaryPageCount": len(pages),
        "fallbackTriggered": fallback_triggered,
        "noisyPageNumbers": noisy_page_numbers,
        "overallPrimaryHealth": overall_health,
        "heuristics": resolved_thresholds,
        "ocrAppliedPageNumbers": [],
        "ocrFailedPageNumbers": [],
        "fallbackError": None,
    }

    if not fallback_triggered:
        return pages, diagnostics

    target_pages = noisy_page_numbers if noisy_page_numbers else list(range(1, len(pages) + 1))
    try:
        ocr_pages = extract_text_with_tesseract_ocr(
            pdf_path,
            target_pages,
            dpi=ocr_dpi,
            language=ocr_language,
            tesseract_config=ocr_tesseract_config,
        )
    except Exception as error:  # pragma: no cover - dependency/environment dependent
        diagnostics["fallbackError"] = str(error)
        diagnostics["ocrFailedPageNumbers"] = target_pages
        log_debug(
            "OCR fallback failed. Returning primary text layer.",
            {"file": str(pdf_path), "details": str(error), "targetPages": target_pages},
        )
        return pages, diagnostics

    for page_number in target_pages:
        page_index = page_number - 1
        ocr_text = str(ocr_pages.get(page_number, "") or "")
        if page_index < 0 or page_index >= len(pages):
            continue
        if normalize(ocr_text):
            pages[page_index] = ocr_text
            diagnostics["ocrAppliedPageNumbers"].append(page_number)
        else:
            diagnostics["ocrFailedPageNumbers"].append(page_number)

    return pages, diagnostics


def extract_clean_text_with_ocr_fallback(
    pdf_path: Path,
    *,
    thresholds: dict[str, int | float] | None = None,
    ocr_dpi: int = 350,
    ocr_language: str = "eng",
    ocr_tesseract_config: str = "--oem 3 --psm 6",
) -> tuple[str, dict[str, Any]]:
    """Return a normalized clean string for downstream hydration logic."""

    page_texts, diagnostics = extract_page_texts_with_ocr_fallback(
        pdf_path,
        thresholds=thresholds,
        ocr_dpi=ocr_dpi,
        ocr_language=ocr_language,
        ocr_tesseract_config=ocr_tesseract_config,
    )
    clean_text = normalize("\n".join(str(page or "") for page in page_texts))
    return clean_text, diagnostics


def strip_control_noise_characters(text: str) -> str:
    source = str(text or "")
    cleaned = CONTROL_NOISE_PATTERN.sub(" ", source)
    return REPLACEMENT_CHAR_PATTERN.sub(" ", cleaned)


def strip_cid_artifacts(text: str) -> str:
    source = str(text or "")
    source = CID_ARTIFACT_PATTERN.sub(" ", source)
    source = CID_INLINE_PATTERN.sub(" ", source)
    return source


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
    source = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", source)
    source = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", source)
    source = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", source)

    return source


def normalize(text: str) -> str:
    cleaned = strip_control_noise_characters(strip_cid_artifacts(text))
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


def extract_type_from_preferred_page(text: str) -> tuple[str | None, str]:
    normalized = normalize(text)
    if not normalized:
        return None, "none"

    # Page 6 contains the deterministic resonance header in iEQ9 reports.
    # Prioritize this line before running broader page-level scoring.
    direct_patterns = [
        (
            r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*([1-9])\s+which\s+is\s+also\s+known\s+as",
            "resonanceSentence",
        ),
        (
            r"\bM\s*A\s*I\s*N\s*T\s*Y\s*P\s*E\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:T\s*Y\s*P\s*E\s*)?([1-9])\b",
            "mainTypeLetterSpaced",
        ),
        (r"Main\s*Type\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:Type\s*)?([1-9])\b", "mainTypeHash"),
        (r"\bMain\s*Type\b[^0-9]{0,24}([1-9])\b", "mainTypeLoose"),
    ]
    for pattern, source in direct_patterns:
        match = re.search(pattern, normalized, re.I)
        if not match:
            continue
        detected = normalize_type_number(match.group(1))
        if detected:
            return detected, source

    return extract_type(normalized)


def extract_type_from_pages(page_texts: list[str], preferred_page_number: int = 6) -> tuple[str | None, str]:
    pages = page_texts if isinstance(page_texts, list) else []
    if preferred_page_number > 0:
        preferred_index = preferred_page_number - 1
        if preferred_index < len(pages):
            preferred_type, preferred_source = extract_type_from_preferred_page(pages[preferred_index])
            if preferred_type:
                return preferred_type, f"page{preferred_page_number}:{preferred_source}"

    combined_text = normalize("\n".join(str(page or "") for page in pages))
    return extract_type(combined_text)


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


def extract_instinct_code(text: str) -> tuple[str | None, str]:
    normalized = normalize(text)
    if not normalized:
        return None, "none"

    code_patterns = [
        (r"\bDominant\s*Instinct\s*[:\-]?\s*(SO|SP|SX)\b", "dominantInstinctLabel"),
        (r"\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])", "instinctSentence"),
        (r"\b(SO|SP|SX)\s*[—-]\s*(Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b", "instinctCodeLabel"),
    ]

    for pattern, source in code_patterns:
        match = re.search(pattern, normalized, re.I)
        if not match or not match.group(1):
            continue
        code = str(match.group(1) or "").upper().strip()
        if code in {"SO", "SP", "SX"}:
            return code, source

    return None, "none"


def extract_instinct_from_preferred_page(text: str) -> tuple[str | None, str]:
    normalized = normalize(text)
    if not normalized:
        return None, "none"

    instinct_code, instinct_source = extract_instinct_code(normalized)
    if instinct_code:
        return instinct_label(instinct_code) or instinct_code, instinct_source

    dominant_label_match = re.search(
        r"\bDominant\s*Instinct\s*[:\-]?\s*([A-Za-z]{2,4}\s*[—-]\s*[A-Za-z][A-Za-z\s-]{2,40})",
        normalized,
        re.I,
    )
    if dominant_label_match and dominant_label_match.group(1):
        candidate = clean_metadata_value(dominant_label_match.group(1))
        if candidate:
            return candidate, "dominantInstinctLabel"

    return None, "none"


def extract_instinct_from_pages(page_texts: list[str], preferred_page_number: int = 10) -> tuple[str | None, str]:
    pages = page_texts if isinstance(page_texts, list) else []
    if preferred_page_number > 0:
        preferred_index = preferred_page_number - 1
        if preferred_index < len(pages):
            preferred_instinct, preferred_source = extract_instinct_from_preferred_page(pages[preferred_index])
            if preferred_instinct:
                return preferred_instinct, f"page{preferred_page_number}:{preferred_source}"

    combined_text = normalize("\n".join(str(page or "") for page in pages))
    fallback_instinct, fallback_source = extract_instinct_from_preferred_page(combined_text)
    if fallback_instinct:
        return fallback_instinct, fallback_source
    return None, "none"


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


def compute_text_noise_metrics(page_texts: list[str]) -> dict[str, int | float | str]:
    pages = page_texts if isinstance(page_texts, list) else []
    joined_text = "\n".join(str(page or "") for page in pages)
    total_chars = len(joined_text)
    control_noise_chars = len(CONTROL_NOISE_PATTERN.findall(joined_text))
    replacement_chars = len(REPLACEMENT_CHAR_PATTERN.findall(joined_text))
    total_noise_chars = control_noise_chars + replacement_chars
    pages_with_control_noise = 0

    for page in pages:
        page_text = str(page or "")
        if CONTROL_NOISE_PATTERN.search(page_text) or REPLACEMENT_CHAR_PATTERN.search(page_text):
            pages_with_control_noise += 1

    if total_chars > 0:
        control_noise_per_10k_chars = round((total_noise_chars / total_chars) * 10000, 2)
        score = max(0, min(100, int(round(control_noise_per_10k_chars))))
    else:
        control_noise_per_10k_chars = 0.0
        score = 0

    if total_chars <= 0:
        severity = "unknown"
    elif control_noise_per_10k_chars < 1:
        severity = "minimal"
    elif control_noise_per_10k_chars < 5:
        severity = "low"
    elif control_noise_per_10k_chars < 20:
        severity = "moderate"
    else:
        severity = "high"

    return {
        "score": score,
        "severity": severity,
        "controlNoiseChars": control_noise_chars,
        "replacementChars": replacement_chars,
        "totalNoiseChars": total_noise_chars,
        "totalChars": total_chars,
        "controlNoisePer10kChars": control_noise_per_10k_chars,
        "pagesWithControlNoise": pages_with_control_noise,
        "pageCount": len(pages),
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/extract_report_pdf.py \"/path/to/report.pdf\"")
        return 1

    pdf_path = Path(sys.argv[1]).expanduser()
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    page_texts, extraction_diagnostics = extract_page_texts_with_ocr_fallback(pdf_path)
    text = normalize("\n".join(page_texts))
    detected_type, detected_type_source = extract_type_from_pages(page_texts, preferred_page_number=6)
    if not detected_type:
        detected_type, detected_type_source = extract_type_from_filename(pdf_path.name)

    instinct, _instinct_source = extract_instinct_from_pages(page_texts, preferred_page_number=10)
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
    text_noise = compute_text_noise_metrics(page_texts)
    extraction_diagnostics = {
        **(extraction_diagnostics if isinstance(extraction_diagnostics, dict) else {}),
        "finalPageCount": len(page_texts),
        "ocrApplied": bool(
            (extraction_diagnostics or {}).get("fallbackTriggered")
            and len((extraction_diagnostics or {}).get("ocrAppliedPageNumbers", [])) > 0
        ),
    }
    if extraction_diagnostics.get("fallbackTriggered"):
        log_debug(
            "OCR fallback decision complete.",
            {
                "fileName": pdf_path.name,
                "noisyPageNumbers": extraction_diagnostics.get("noisyPageNumbers", []),
                "ocrAppliedPageNumbers": extraction_diagnostics.get("ocrAppliedPageNumbers", []),
                "ocrFailedPageNumbers": extraction_diagnostics.get("ocrFailedPageNumbers", []),
                "fallbackError": extraction_diagnostics.get("fallbackError"),
            },
        )

    payload = {
        "source": "python_extract_report_pdf",
        "fileName": pdf_path.name,
        "pageCount": len(page_texts),
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
        "textNoise": text_noise,
        "extractionDiagnostics": extraction_diagnostics,
        "containsMarkers": {
            "resonanceSentence": bool(
                re.search(r"you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*[1-9]\b", text, re.I)
            ),
            "mainTypeAsEnnea": bool(re.search(r"main\s+type\s+as\s+an\s+Ennea\s*[1-9]\b", text, re.I)),
            "instinctSentence": bool(re.search(r"\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])", text, re.I)),
            "dominantInstinctLabel": bool(re.search(r"\bDominant\s*Instinct\s*[:\-]?\s*(SO|SP|SX)\b", text, re.I)),
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
