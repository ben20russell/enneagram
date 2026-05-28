from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from PyPDF2 import PdfReader


@dataclass
class _Page:
    _page: object

    @property
    def width(self) -> float:
      mediabox = getattr(self._page, "mediabox", None)
      if mediabox is None:
          return 612.0
      try:
          return float(mediabox.width)
      except Exception:
          return 612.0

    def extract_words(self, *args, **kwargs):
        return []

    def extract_text(self, layout: bool = False):
        try:
            return self._page.extract_text() or ""
        except Exception:
            return ""


class _PdfPlumberDoc:
    def __init__(self, path: str):
        self._path = str(path)
        self._reader = None
        self.pages = []

    def __enter__(self):
        self._reader = PdfReader(self._path)
        self.pages = [_Page(p) for p in self._reader.pages]
        return self

    def __exit__(self, exc_type, exc, tb):
        self._reader = None
        self.pages = []
        return False


def open(path: str | Path):
    return _PdfPlumberDoc(str(path))
