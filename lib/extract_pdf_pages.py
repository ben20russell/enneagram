#!/usr/bin/env python3
import json
import sys

from pypdf import PdfReader


def main():
  if len(sys.argv) < 2:
    print(json.dumps({"error": "Missing PDF path"}))
    return 1

  pdf_path = sys.argv[1]
  reader = PdfReader(pdf_path)
  pages = []
  for index, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    pages.append(
      {
        "pageNumber": index,
        "extractedText": text,
      }
    )

  print(json.dumps({"pages": pages}, ensure_ascii=False))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
