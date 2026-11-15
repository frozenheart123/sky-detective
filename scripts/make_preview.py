"""Make a Claude-artifact preview page from web/index.html.

The artifact host wraps the page in its own <html>/<head>/<body> (with charset and viewport tags),
so the preview keeps only the head's own tags and the body's content.
Usage: python scripts/make_preview.py OUT.html

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import re
import sys
from pathlib import Path

src = (Path(__file__).resolve().parent.parent / "web" / "index.html").read_text(encoding="utf-8")
head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", src, re.S).group(1)
head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', "", head)
Path(sys.argv[1]).write_text(head.strip() + "\n" + body.strip() + "\n", encoding="utf-8")
print("wrote", sys.argv[1])
