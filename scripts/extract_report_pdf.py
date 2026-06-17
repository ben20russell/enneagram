#!/usr/bin/env python3
"""Extract Docling markdown from an iEQ9 PDF.

Usage:
  python3 scripts/extract_report_pdf.py "/path/to/report.pdf"

Install dependency:
  pip install docling
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def build_success_payload(markdown: str) -> dict[str, Any]:
    return {
        "source": "docling_markdown",
        "markdown": str(markdown or ""),
    }


def build_error_payload(message: str) -> dict[str, Any]:
    return {
        "source": "docling_markdown",
        "markdown": "",
        "error": str(message or "unknown_error"),
    }


def extract_markdown_with_docling(pdf_path: Path, converter: Any | None = None) -> str:
    active_converter = converter
    if active_converter is None:
        # Local import keeps script resilient if docling is not installed.
        from docling.document_converter import DocumentConverter

        active_converter = DocumentConverter()

    result = active_converter.convert(str(pdf_path))
    document = getattr(result, "document", None)
    if document is None or not hasattr(document, "export_to_markdown"):
        raise RuntimeError("Docling did not return a document with export_to_markdown().")

    markdown = document.export_to_markdown()
    return str(markdown or "")


def extract_payload_from_pdf(pdf_path: Path) -> dict[str, Any]:
    try:
        markdown = extract_markdown_with_docling(pdf_path)
        return build_success_payload(markdown)
    except Exception as error:  # pragma: no cover - runtime dependency / IO path
        return build_error_payload(str(error))


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: python3 scripts/extract_report_pdf.py "/path/to/report.pdf"')
        return 1

    pdf_path = Path(sys.argv[1]).expanduser()
    if not pdf_path.exists():
        print(json.dumps(build_error_payload(f"File not found: {pdf_path}"), ensure_ascii=False))
        return 0

    payload = extract_payload_from_pdf(pdf_path)
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
