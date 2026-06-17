#!/usr/bin/env python3
"""Extract PDF page text with heuristic OCR fallback for noisy text layers.

Output JSON shape:
{
  "pages": [{"pageNumber": 1, "extractedText": "..."}, ...],
  "diagnostics": {...}
}
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any

try:  # pragma: no cover - optional dependency
  from pypdf import PdfReader
except Exception:  # pragma: no cover - dependency/environment dependent
  PdfReader = None


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

COMMON_BINARY_DIRECTORIES = (
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/opt/local/bin",
)


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
    merged[key] = float(value) if key == "min_alnum_ratio" else int(value)
  return merged


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

  source = re.sub(
    rf"\b(?:[A-Za-z]{OCR_INLINE_SPACING}){{2,}}[A-Za-z]\b",
    collapse_letter_match,
    source,
  )
  source = re.sub(
    rf"\b(?:\d{OCR_INLINE_SPACING}){{2,}}\d\b",
    lambda match: re.sub(OCR_INLINE_SPACING, "", str(match.group(0) or "")),
    source,
  )
  source = source.replace(OCR_WORD_GAP_MARKER, " ")

  source = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", source)
  source = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", source)
  source = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", source)
  source = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", source)
  return source


def normalize_page_text(text: str) -> str:
  cleaned = collapse_ocr_word_fragments(
    strip_control_noise_characters(
      strip_cid_artifacts(text),
    ),
  )
  lines = [re.sub(r"\s+", " ", line).strip() for line in str(cleaned or "").splitlines()]
  lines = [line for line in lines if line]
  return "\n".join(lines).strip()


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
  snapshot = compute_text_health_snapshot(text, thresholds=resolve_noise_thresholds(thresholds))
  return bool(snapshot.get("is_noisy"))


def extract_pages_with_pdfplumber(pdf_path: Path) -> list[str]:
  import pdfplumber

  with pdfplumber.open(str(pdf_path)) as pdf:
    return [(page.extract_text() or "") for page in pdf.pages]


def extract_pages_with_pypdf(pdf_path: Path) -> list[str]:
  if PdfReader is None:
    raise RuntimeError("pypdf is not installed")
  reader = PdfReader(str(pdf_path))
  return [(page.extract_text() or "") for page in reader.pages]


def extract_primary_pages(pdf_path: Path) -> tuple[list[str], str]:
  errors: list[str] = []
  try:
    return extract_pages_with_pdfplumber(pdf_path), "pdfplumber"
  except Exception as error:  # pragma: no cover - dependency/environment dependent
    errors.append(f"pdfplumber:{error}")

  try:
    return extract_pages_with_pypdf(pdf_path), "pypdf"
  except Exception as error:
    errors.append(f"pypdf:{error}")
    raise RuntimeError(
      f"Unable to extract PDF text with primary engines for {pdf_path}: {' | '.join(errors)}"
    ) from error


def ensure_ocr_dependencies() -> dict[str, Any]:
  def resolve_binary(binary_name: str) -> str | None:
    discovered = shutil.which(binary_name)
    if discovered:
      return discovered
    for directory in COMMON_BINARY_DIRECTORIES:
      candidate = Path(directory) / binary_name
      if candidate.exists() and candidate.is_file():
        return str(candidate)
    return None

  pdftoppm_path = resolve_binary("pdftoppm")
  pdftocairo_path = resolve_binary("pdftocairo")
  tesseract_path = resolve_binary("tesseract")

  missing: list[str] = []
  if not pdftoppm_path and not pdftocairo_path:
    missing.append("poppler")
  if not tesseract_path:
    missing.append("tesseract")

  return {
    "available": len(missing) == 0,
    "missing": missing,
    "pdftoppm_path": pdftoppm_path,
    "pdftocairo_path": pdftocairo_path,
    "tesseract_path": tesseract_path,
    "poppler_bin_dir": (
      str(Path(pdftoppm_path).parent)
      if pdftoppm_path
      else (str(Path(pdftocairo_path).parent) if pdftocairo_path else None)
    ),
  }


def extract_text_with_tesseract_ocr(
  pdf_path: Path,
  page_numbers: list[int],
  *,
  dependencies: dict[str, Any] | None = None,
  dpi: int = 350,
  language: str = "eng",
  tesseract_config: str = "--oem 3 --psm 6",
) -> dict[int, str]:
  if not page_numbers:
    return {}

  from pdf2image import convert_from_path
  import pytesseract

  dependency_info = dependencies if isinstance(dependencies, dict) else {}
  poppler_bin_dir = (
    str(dependency_info.get("poppler_bin_dir"))
    if dependency_info.get("poppler_bin_dir")
    else None
  )
  tesseract_path = (
    str(dependency_info.get("tesseract_path"))
    if dependency_info.get("tesseract_path")
    else None
  )
  if tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = tesseract_path

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
      poppler_path=poppler_bin_dir,
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


def extract_pages_with_ocr_fallback(
  pdf_path: Path,
  *,
  thresholds: dict[str, int | float] | None = None,
  ocr_dpi: int = 350,
  ocr_language: str = "eng",
  ocr_tesseract_config: str = "--oem 3 --psm 6",
) -> tuple[list[str], dict[str, Any]]:
  primary_pages, primary_engine = extract_primary_pages(pdf_path)
  pages = [str(page or "") for page in primary_pages]
  resolved_thresholds = resolve_noise_thresholds(thresholds)

  page_health = [compute_text_health_snapshot(page, thresholds=resolved_thresholds) for page in pages]
  noisy_page_numbers = [
    index + 1
    for index, health in enumerate(page_health)
    if bool(health.get("is_noisy"))
  ]
  overall_health = compute_text_health_snapshot("\n".join(pages), thresholds=resolved_thresholds)
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
    "ocrDependencies": None,
  }

  if not fallback_triggered:
    return [normalize_page_text(page) for page in pages], diagnostics

  dependencies = ensure_ocr_dependencies()
  diagnostics["ocrDependencies"] = dependencies
  if not bool(dependencies.get("available")):
    missing = ", ".join(dependencies.get("missing") or ["unknown"])
    message = (
      "OCR fallback required for noisy PDF text, but required OCR dependencies are missing: "
      f"{missing}. Install Poppler (pdftoppm or pdftocairo) and Tesseract."
    )
    diagnostics["fallbackError"] = message
    raise RuntimeError(message)

  target_pages = noisy_page_numbers if noisy_page_numbers else list(range(1, len(pages) + 1))
  try:
    ocr_pages = extract_text_with_tesseract_ocr(
      pdf_path,
      target_pages,
      dependencies=dependencies,
      dpi=ocr_dpi,
      language=ocr_language,
      tesseract_config=ocr_tesseract_config,
    )
  except Exception as error:
    diagnostics["fallbackError"] = str(error)
    diagnostics["ocrFailedPageNumbers"] = target_pages
    raise RuntimeError(f"OCR fallback failed for noisy pages in {pdf_path}: {error}") from error

  for page_number in target_pages:
    page_index = page_number - 1
    if page_index < 0 or page_index >= len(pages):
      continue
    ocr_text = normalize_page_text(ocr_pages.get(page_number, ""))
    if ocr_text:
      pages[page_index] = ocr_text
      diagnostics["ocrAppliedPageNumbers"].append(page_number)
    else:
      diagnostics["ocrFailedPageNumbers"].append(page_number)

  if not diagnostics["ocrAppliedPageNumbers"]:
    message = (
      "OCR fallback was triggered for noisy PDF text, but no pages were recovered. "
      "Review Poppler/Tesseract installation and OCR runtime access."
    )
    diagnostics["fallbackError"] = message
    raise RuntimeError(message)

  return [normalize_page_text(page) for page in pages], diagnostics


def main() -> int:
  if len(sys.argv) < 2:
    print(json.dumps({"error": "Missing PDF path"}))
    return 1

  pdf_path = Path(sys.argv[1]).expanduser()
  if not pdf_path.exists():
    print(json.dumps({"error": f"File not found: {pdf_path}"}))
    return 1

  try:
    pages, diagnostics = extract_pages_with_ocr_fallback(pdf_path)
  except Exception as error:
    print(
      json.dumps(
        {
          "error": str(error),
          "pages": [],
        },
        ensure_ascii=False,
      ),
      file=sys.stderr,
    )
    return 2

  payload = {
    "pages": [
      {
        "pageNumber": index + 1,
        "extractedText": text,
      }
      for index, text in enumerate(pages)
    ],
    "diagnostics": diagnostics,
  }
  print(json.dumps(payload, ensure_ascii=False))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
