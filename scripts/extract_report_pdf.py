#!/usr/bin/env python3
"""Extract layout-aware markdown/HTML from an iEQ9 PDF.

Usage:
  python3 scripts/extract_report_pdf.py "/path/to/report.pdf"

Install dependency:
  pip install pymupdf4llm pymupdf
"""

from __future__ import annotations

import html
import inspect
import io
import json
import os
import re
import sys
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any, Callable

SOURCE_LABEL = "layout_html_markdown"
TABLE_FORMAT = "html"
PIPE_TABLE_SEPARATOR_PATTERN = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")


def build_success_payload(structured_document: str) -> dict[str, Any]:
    normalized = str(structured_document or "")
    return {
        "source": SOURCE_LABEL,
        "table_format": TABLE_FORMAT,
        "structured_document": normalized,
        # Compatibility key retained for existing Node parser reads.
        "markdown": normalized,
    }


def build_error_payload(message: str) -> dict[str, Any]:
    return {
        "source": SOURCE_LABEL,
        "table_format": TABLE_FORMAT,
        "structured_document": "",
        # Compatibility key retained for existing Node parser reads.
        "markdown": "",
        "error": str(message or "unknown_error"),
    }


def normalize_layout_markdown(markdown_text: str) -> str:
    lines = [line.rstrip() for line in str(markdown_text or "").splitlines()]
    return "\n".join(lines).strip()


def parse_pipe_table_row(line: str) -> list[str]:
    normalized = str(line or "").strip()
    if normalized.startswith("|"):
        normalized = normalized[1:]
    if normalized.endswith("|"):
        normalized = normalized[:-1]
    return [cell.strip() for cell in normalized.split("|")]


def render_html_table(header_cells: list[str], body_rows: list[list[str]]) -> str:
    column_count = max(1, len(header_cells), *(len(row) for row in body_rows if row))
    safe_headers = (header_cells + [""] * column_count)[:column_count]
    safe_rows = [((row or []) + [""] * column_count)[:column_count] for row in body_rows]

    header_html = "".join(f"<th>{html.escape(cell, quote=False)}</th>" for cell in safe_headers)
    body_html = "\n".join(
        "<tr>" + "".join(f"<td>{html.escape(cell, quote=False)}</td>" for cell in row) + "</tr>"
        for row in safe_rows
    )
    if body_html:
        return f"<table>\n<thead><tr>{header_html}</tr></thead>\n<tbody>\n{body_html}\n</tbody>\n</table>"
    return f"<table>\n<thead><tr>{header_html}</tr></thead>\n<tbody></tbody>\n</table>"


def ensure_html_tables(markdown_text: str) -> str:
    lines = str(markdown_text or "").splitlines()
    if not lines:
        return ""

    output_lines: list[str] = []
    index = 0
    while index < len(lines):
        current_line = lines[index]
        if (
            "|" in current_line
            and index + 1 < len(lines)
            and PIPE_TABLE_SEPARATOR_PATTERN.match(lines[index + 1] or "")
        ):
            header_cells = parse_pipe_table_row(current_line)
            body_rows: list[list[str]] = []
            index += 2
            while index < len(lines) and "|" in lines[index]:
                row_cells = parse_pipe_table_row(lines[index])
                if len(row_cells) == 1 and row_cells[0] == "":
                    break
                body_rows.append(row_cells)
                index += 1
            output_lines.append(render_html_table(header_cells, body_rows))
            continue

        output_lines.append(current_line)
        index += 1

    return "\n".join(output_lines).strip()


def normalize_markdown_output(raw_output: Any) -> str:
    if raw_output is None:
        return ""
    if isinstance(raw_output, str):
        return raw_output
    if isinstance(raw_output, dict):
        for candidate_key in ("markdown", "content", "text"):
            candidate = raw_output.get(candidate_key)
            if isinstance(candidate, str):
                return candidate
        return json.dumps(raw_output, ensure_ascii=False)
    if isinstance(raw_output, list):
        parts = [normalize_markdown_output(entry) for entry in raw_output]
        return "\n\n".join([part for part in parts if part]).strip()
    return str(raw_output)


def supports_kwargs(callable_obj: Callable[..., Any]) -> bool:
    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return True
    return any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )


def filter_supported_kwargs(callable_obj: Callable[..., Any], kwargs: dict[str, Any]) -> dict[str, Any]:
    if supports_kwargs(callable_obj):
        return dict(kwargs)

    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return dict(kwargs)

    accepted_names = set(signature.parameters.keys())
    return {key: value for key, value in kwargs.items() if key in accepted_names}

@contextmanager
def suppress_native_stdout_stderr() -> Any:
    """Suppress native/library writes to process stdout/stderr file descriptors."""
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    original_stdout_fd = os.dup(1)
    original_stderr_fd = os.dup(2)
    try:
        os.dup2(devnull_fd, 1)
        os.dup2(devnull_fd, 2)
        yield
    finally:
        os.dup2(original_stdout_fd, 1)
        os.dup2(original_stderr_fd, 2)
        os.close(original_stdout_fd)
        os.close(original_stderr_fd)
        os.close(devnull_fd)


def call_to_markdown_with_fallbacks(
    to_markdown_fn: Callable[..., Any],
    pdf_path: Path,
) -> Any:
    candidate_kwargs = [
        {"table_strategy": "lines_strict", "extract_tables": True, "table_output": "html"},
        {"table_strategy": "lines_strict", "extract_tables": True},
        {"extract_tables": True},
        {},
    ]

    attempted_signatures: set[tuple[tuple[str, Any], ...]] = set()
    for kwargs in candidate_kwargs:
        supported = filter_supported_kwargs(to_markdown_fn, kwargs)
        signature_key = tuple(sorted(supported.items()))
        if signature_key in attempted_signatures:
            continue
        attempted_signatures.add(signature_key)
        try:
            return to_markdown_fn(str(pdf_path), **supported)
        except TypeError:
            continue

    return to_markdown_fn(str(pdf_path))


def extract_markdown_with_pymupdf4llm(
    pdf_path: Path,
    to_markdown_fn: Callable[..., Any] | None = None,
) -> str:
    active_to_markdown = to_markdown_fn
    if active_to_markdown is None:
        # Local import keeps script resilient if pymupdf4llm is not installed.
        import pymupdf4llm  # type: ignore

        active_to_markdown = getattr(pymupdf4llm, "to_markdown", None)
        if not callable(active_to_markdown):
            raise RuntimeError("pymupdf4llm.to_markdown is not available.")

    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()
    # pymupdf4llm may emit parser diagnostics directly to stdout/stderr.
    # Capture them so this script always returns JSON-only stdout.
    with suppress_native_stdout_stderr(), redirect_stdout(captured_stdout), redirect_stderr(captured_stderr):
        raw_markdown = call_to_markdown_with_fallbacks(active_to_markdown, pdf_path)
    normalized_markdown = normalize_layout_markdown(normalize_markdown_output(raw_markdown))
    return ensure_html_tables(normalized_markdown)


def extract_payload_from_pdf(pdf_path: Path) -> dict[str, Any]:
    try:
        structured_document = extract_markdown_with_pymupdf4llm(pdf_path)
        return build_success_payload(structured_document)
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
