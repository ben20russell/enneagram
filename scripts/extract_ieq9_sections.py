#!/usr/bin/env python3
"""Extract structured iEQ9 Individual Professional sections with a 4-step pipeline.

Steps:
1) Layout-aware page parsing with pdfplumber (column-sensitive reconstruction).
2) Page-targeted extraction using canonical section->pages mapping.
3) Regex bounding to remove standard footer noise and anchor from section headers.
4) LLM-assisted strict JSON structuring using OpenAI JSON Schema response format.

Usage:
  python3 scripts/extract_ieq9_sections.py /path/to/report.pdf -o /path/to/output.json
  python3 scripts/extract_ieq9_sections.py /path/to/report.pdf --skip-llm

Environment:
  OPENAI_API_KEY=<key>             # required unless --skip-llm
  OPENAI_MODEL=gpt-4o-mini         # optional
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover - import-time safety for local script usage
    raise SystemExit(
        "Missing dependency: pdfplumber. Install with `pip install pdfplumber`."
    ) from exc


DEFAULT_FOOTER_PATTERN = (
    r"Copyright\s+\d{4}-\d{4}\s+Integrative\s+Enneagram\s+Solutions[\s\S]*?\b\d+\s+of\s+42\b"
)
SHARED_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "ieq9_targeted_extraction_config.json"


def load_shared_config() -> dict[str, Any]:
    try:
        raw = json.loads(SHARED_CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(
            f"Missing shared extraction config file: {SHARED_CONFIG_PATH}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"Invalid JSON in shared extraction config file: {SHARED_CONFIG_PATH}"
        ) from exc

    if not isinstance(raw, dict):
        raise SystemExit(f"Unexpected shared config format (expected object): {SHARED_CONFIG_PATH}")
    return raw


SHARED_CONFIG = load_shared_config()
SECTION_PAGE_MAP = {
    str(key): [int(page) for page in (value if isinstance(value, list) else [])]
    for key, value in (SHARED_CONFIG.get("section_page_map") or {}).items()
}
DEVELOPMENT_EXERCISE_CONTEXT_PAGES = {
    str(key): [int(page) for page in (value if isinstance(value, list) else [])]
    for key, value in (SHARED_CONFIG.get("development_exercise_context_pages") or {}).items()
}
SECTION_HEADER_TITLES = {
    str(key): [str(title) for title in (value if isinstance(value, list) else [])]
    for key, value in (SHARED_CONFIG.get("section_header_titles") or {}).items()
}
FOOTER_PATTERN = re.compile(
    str(SHARED_CONFIG.get("footer_pattern") or DEFAULT_FOOTER_PATTERN),
    flags=re.IGNORECASE,
)
OUTPUT_SCHEMA = SHARED_CONFIG.get("output_schema") or {}


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="[%(levelname)s] %(message)s")


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _join_words_to_lines(words: list[dict[str, Any]], line_tolerance: float = 3.2) -> list[str]:
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (float(w.get("top", 0.0)), float(w.get("x0", 0.0))))
    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_top: float | None = None

    for word in sorted_words:
        top = float(word.get("top", 0.0))
        if current_top is None or abs(top - current_top) <= line_tolerance:
            current.append(word)
            if current_top is None:
                current_top = top
            else:
                current_top = (current_top + top) / 2.0
            continue
        lines.append(current)
        current = [word]
        current_top = top

    if current:
        lines.append(current)

    line_strings: list[str] = []
    for line_words in lines:
        parts = [str(w.get("text", "")).strip() for w in sorted(line_words, key=lambda w: float(w.get("x0", 0.0)))]
        joined = normalize_spaces(" ".join(parts))
        if joined:
            line_strings.append(joined)
    return line_strings


def _split_words_into_columns(words: list[dict[str, Any]], page_width: float) -> list[list[dict[str, Any]]]:
    if len(words) < 30:
        return [words]

    candidates = [page_width * 0.45, page_width * 0.5, page_width * 0.55]
    for split_x in candidates:
        left = [w for w in words if ((float(w.get("x0", 0.0)) + float(w.get("x1", 0.0))) / 2.0) < split_x]
        right = [w for w in words if ((float(w.get("x0", 0.0)) + float(w.get("x1", 0.0))) / 2.0) >= split_x]
        if len(left) < 15 or len(right) < 15:
            continue
        left_max_x1 = max(float(w.get("x1", 0.0)) for w in left)
        right_min_x0 = min(float(w.get("x0", 0.0)) for w in right)
        if right_min_x0 - left_max_x1 >= page_width * 0.04:
            return [left, right]

    return [words]


def extract_page_layout_aware_text(page: Any) -> str:
    words = page.extract_words(
        x_tolerance=2,
        y_tolerance=3,
        keep_blank_chars=False,
        use_text_flow=False,
    )
    if not words:
        return (page.extract_text(layout=True) or "").strip()

    columns = _split_words_into_columns(words, float(page.width))
    column_texts: list[str] = []
    for idx, column_words in enumerate(columns, start=1):
        lines = _join_words_to_lines(column_words)
        reconstructed = "\n".join(lines).strip()
        logging.debug("Reconstructed page column %s with %s lines", idx, len(lines))
        if reconstructed:
            column_texts.append(reconstructed)

    return "\n\n".join(column_texts).strip()


def strip_footer(text: str) -> str:
    without_footer = FOOTER_PATTERN.sub("", text or "")
    return without_footer.strip()


def anchor_from_header(section_name: str, text: str) -> str:
    source = normalize_spaces(text)
    if not source:
        return ""

    for header in SECTION_HEADER_TITLES.get(section_name, []):
        escaped_header = re.escape(header)
        pattern = re.compile(rf"(?<={escaped_header})[\s\S]*", flags=re.IGNORECASE)
        match = pattern.search(source)
        if match:
            anchored = normalize_spaces(match.group(0))
            if anchored:
                logging.debug("Applied header anchor '%s' for section '%s'", header, section_name)
                return anchored

    return source


def collect_target_pages() -> list[int]:
    pages: set[int] = set()
    for page_numbers in SECTION_PAGE_MAP.values():
        pages.update(int(p) for p in page_numbers)
    return sorted(pages)


def extract_target_page_text(pdf_path: Path) -> tuple[dict[int, str], int]:
    target_pages = collect_target_pages()
    page_text: dict[int, str] = {}
    with pdfplumber.open(str(pdf_path)) as pdf:
        page_count = len(pdf.pages)
        logging.info("Opened PDF '%s' with %s pages", pdf_path.name, page_count)
        for page_number in target_pages:
            if page_number < 1 or page_number > page_count:
                logging.warning(
                    "Skipping page %s because it is outside document range 1-%s",
                    page_number,
                    page_count,
                )
                continue
            page = pdf.pages[page_number - 1]
            layout_text = extract_page_layout_aware_text(page)
            page_text[page_number] = layout_text
            logging.info("Step 1+2 extracted page %s (%s chars)", page_number, len(layout_text))
    return page_text, page_count


def build_cleaned_sections(page_text: dict[int, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for section_name, pages in SECTION_PAGE_MAP.items():
        chunks: list[str] = []
        for page in pages:
            raw = page_text.get(page, "")
            if not raw:
                continue
            page_clean = strip_footer(raw)
            if page_clean:
                chunks.append(f"[Page {page}] {page_clean}")
        section_raw = "\n\n".join(chunks).strip()
        section_bounded = anchor_from_header(section_name, section_raw)
        cleaned[section_name] = section_bounded
        logging.info(
            "Step 3 bounded section '%s' from pages %s (%s chars)",
            section_name,
            ",".join(str(p) for p in pages),
            len(section_bounded),
        )
    return cleaned


def build_development_context_text(page_text: dict[int, str]) -> dict[str, str]:
    context_text: dict[str, str] = {}
    for key, pages in DEVELOPMENT_EXERCISE_CONTEXT_PAGES.items():
        chunks = []
        for page in pages:
            text = strip_footer(page_text.get(page, ""))
            if text:
                chunks.append(f"[Page {page}] {text}")
        context_text[key] = anchor_from_header("development_exercises", "\n\n".join(chunks))
    return context_text


def build_llm_prompt_payload(cleaned_sections: dict[str, str], development_context: dict[str, str]) -> str:
    prompt_object = {
        "instructions": {
            "rules": [
                "Return valid JSON only.",
                "Match the schema exactly.",
                "Do not invent missing facts.",
                "Use empty strings or empty arrays when no evidence exists.",
                "Respect section boundaries and source pages.",
            ]
        },
        "sections": cleaned_sections,
        "development_exercise_context": development_context,
    }
    return json.dumps(prompt_object, ensure_ascii=False, indent=2)


def structure_with_openai(
    cleaned_sections: dict[str, str],
    development_context: dict[str, str],
    model: str,
) -> dict[str, Any]:
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - import-time safety for local script usage
        raise SystemExit("Missing dependency: openai. Install with `pip install openai`.") from exc

    client = OpenAI()
    system_prompt = (
        "You transform extracted iEQ9 report text into strict structured JSON. "
        "Never include markdown, comments, or prose."
    )
    user_prompt = build_llm_prompt_payload(cleaned_sections, development_context)

    request_payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "ieq9_individual_professional_sections",
                "strict": True,
                "schema": OUTPUT_SCHEMA,
            },
        },
    }

    logging.info("Step 4 calling OpenAI model '%s' with strict JSON schema", model)
    response = client.chat.completions.create(**request_payload)
    content = response.choices[0].message.content
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("OpenAI returned an empty response content.")

    parsed = json.loads(content)
    logging.info("Step 4 structured output parsed successfully")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract structured sections from iEQ9 Individual Professional PDF reports.")
    parser.add_argument("pdf_path", type=Path, help="Path to the iEQ9 PDF report file.")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output JSON path. Defaults to <input>_structured.json")
    parser.add_argument("--model", default="gpt-4o-mini", help="OpenAI model name (default: gpt-4o-mini).")
    parser.add_argument("--skip-llm", action="store_true", help="Skip OpenAI structuring and output cleaned section text only.")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)

    pdf_path: Path = args.pdf_path.expanduser()
    if not pdf_path.exists():
        logging.error("PDF file not found: %s", pdf_path)
        return 1

    output_path = args.output.expanduser() if args.output else pdf_path.with_name(f"{pdf_path.stem}_structured.json")
    logging.info("Starting extraction pipeline for '%s'", pdf_path)
    logging.info("Configured section pages: %s", SECTION_PAGE_MAP)

    page_text, page_count = extract_target_page_text(pdf_path)
    cleaned_sections = build_cleaned_sections(page_text)
    development_context = build_development_context_text(page_text)

    if args.skip_llm:
        output_payload: dict[str, Any] = {
            "meta": {
                "file_name": pdf_path.name,
                "page_count": page_count,
                "section_page_map": SECTION_PAGE_MAP,
                "development_context_pages": DEVELOPMENT_EXERCISE_CONTEXT_PAGES,
            },
            "cleaned_sections": cleaned_sections,
            "development_exercise_context": development_context,
        }
        logging.info("LLM step skipped; writing cleaned extraction payload.")
    else:
        output_payload = structure_with_openai(
            cleaned_sections=cleaned_sections,
            development_context=development_context,
            model=args.model,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Done. Wrote output JSON to %s", output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
