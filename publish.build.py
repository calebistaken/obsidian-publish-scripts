#!/usr/bin/env python3
# build_publish.py — config-first Obsidian -> Publish builder
# - Config keys: vault, publish, always_root, include_hidden, dry_run, debug, list_selected
#                 media_exts, apply_filters_to_filenames, apply_filters_to_dirs,
#                 md_folderpath_rewrite (Markdown folders only),
#                 global_contents_filter (Markdown body content),
#                 css_hoist_imports_top (imports hoisted to top; @charset always stripped)
# - Resolves links case-insensitively. Media **embeds only** are rewritten to FULL paths under md_root_dir.
# - Expands media paths even when the reference is a bare filename by recording ref->file mapping at resolve time.
# - Applies global_contents_filter to content; optionally to filenames/dirs via apply_filters_to_*.
# - Note links rewritten to new note paths under md_root_dir/<rewritten-folders>/<renamed-file>.md

import argparse, os, re, shutil, unicodedata, time, json
from collections import defaultdict
from pathlib import Path, PurePosixPath
from tqdm import tqdm

try:
    import yaml  # optional
except Exception:
    yaml = None

# ================= Safety guard: never modify outside publish root =================
def assert_in_publish_root(publish_root: Path, target: Path):
    target = Path(target).resolve()
    pub = Path(publish_root).resolve()
    try:
        target.relative_to(pub)
    except Exception:
        raise RuntimeError(f"Refusing to modify outside publish_root: {target} (publish_root={pub})")

# ================= Config loading =================
CFG_DEFAULTS = {
    "vault": "..",
    "publish": "../../Publish Vault",
    "always_root": [],

    # Execution controls
    "include_hidden": False,
    "dry_run": False,
    "debug": False,
    "list_selected": False,

    # Media handling
    "media_exts": [
        ".png",".jpg",".jpeg",".jpe",".webp",".gif",".svg",
        ".heic",".bmp",".tiff",".tif",".pdf",".mp4",".mov",".m4v",
        ".mp3",".wav",".m4a"
    ],

    # Apply content redactions to filenames/dirs too?
    "apply_filters_to_filenames": True,
    "apply_filters_to_dirs": True,

    # Markdown-only path rewriting (folders only; empty replacement flattens)
    "md_folderpath_rewrite": [],

    # Markdown content redactions (body text)
    # list of {pattern, replacement, flags: [IGNORECASE, MULTILINE, DOTALL, VERBOSE]}
    "global_contents_filter": [],

    # CSS behavior
    "css_hoist_imports_top": True,   # @charset is ALWAYS stripped
}

def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out

def load_config(config_path: Path | None) -> dict:
    if config_path is None:
        for cand in ("publish.build.yaml", "publish.build.yml", "publish.build.json"):
            if Path(cand).exists():
                config_path = Path(cand)
                break

    if config_path is None:
        tqdm.write("[cfg] No config file found; using built-in defaults")
        return dict(CFG_DEFAULTS)

    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    text = config_path.read_text(encoding="utf-8")
    data = None
    ext = config_path.suffix.lower()
    try:
        if ext in (".yaml", ".yml"):
            if yaml is None:
                raise RuntimeError("PyYAML not installed, but YAML config was provided.")
            data = yaml.safe_load(text) or {}
        elif ext == ".json":
            data = json.loads(text)
        else:
            if yaml is not None:
                data = yaml.safe_load(text) or {}
            else:
                data = json.loads(text)
    except Exception as e:
        raise RuntimeError(f"Failed to parse config {config_path}: {e}")

    cfg = _deep_merge(CFG_DEFAULTS, data)
    if cfg.get("scope") and cfg["scope"] not in ("subtree","vault"):
        raise ValueError("config.scope must be 'subtree' or 'vault' if provided")
    # default scope if not provided
    cfg.setdefault("scope", "subtree")
    # export root dir (name inside publish vault)
    cfg.setdefault("md_root_dir", "content")
    return cfg

# regex flags mapping
_FLAG_MAP = {
    "IGNORECASE": re.IGNORECASE, "I": re.IGNORECASE,
    "MULTILINE": re.MULTILINE,   "M": re.MULTILINE,
    "DOTALL": re.DOTALL,         "S": re.DOTALL,
    "VERBOSE": re.VERBOSE,       "X": re.VERBOSE,
}

def compile_regex_list(items: list[dict], field_name: str) -> list[tuple[re.Pattern, str]]:
    compiled = []
    for i, item in enumerate(items or []):
        pat = item.get("pattern")
        repl = item.get("replacement", "")
        flags_list = item.get("flags", [])
        if pat is None:
            raise ValueError(f"{field_name}[{i}] missing 'pattern'")
        flags = 0
        for f in (flags_list or []):
            f = str(f).upper()
            if f in _FLAG_MAP:
                flags |= _FLAG_MAP[f]
            else:
                raise ValueError(f"{field_name}[{i}] unknown flag: {f}")
        try:
            rx = re.compile(pat, flags)
        except re.error as e:
            raise ValueError(f"{field_name}[{i}] invalid regex: {e}")
        compiled.append((rx, repl))
    return compiled

# ================== Reused helpers & regexes ==================
FM_BLOCK_RE = re.compile(r'^---\s*\n(.*?)\n---\s*', re.DOTALL)
WIKILINK_ALL = re.compile(r'(!?)\[\[([^\]]+)\]\]')
MD_LINK       = re.compile(r'(!?)\[(.*?)\]\(([^)]+)\)')

def nfc_cf(s): return unicodedata.normalize("NFC", s).casefold()

def read_text(p: Path) -> str:
    try: return p.read_text(encoding="utf-8")
    except: return p.read_text(encoding="utf-8", errors="ignore")

def split_frontmatter_and_body(content: str):
    m = FM_BLOCK_RE.match(content)
    if not m: return None, content
    return m.group(1), content[m.end():]

def parse_frontmatter_yaml(md_path: Path) -> tuple[dict, str]:
    content = read_text(md_path)
    fm_text, body = split_frontmatter_and_body(content)
    if fm_text is None: return {}, body
    if yaml:
        try:
            data = yaml.safe_load(fm_text) or {}
            if isinstance(data, dict): return data, body
        except Exception:
            pass
    data={}
    for line in fm_text.splitlines():
        if ":" not in line: continue
        k,v=line.split(":",1)
        k=k.strip(); v=v.strip().strip('"').strip("'")
        low=v.lower()
        if   low in ("true","yes","on","1"):  v=True
        elif low in ("false","no","off","0"): v=False
        data[k]=v
    return data, body

def is_hidden(rel: Path) -> bool:
    return any(part.startswith(".") for part in rel.parts)

def should_publish(md_path: Path, debug: bool=False) -> bool:
    fm, _ = parse_frontmatter_yaml(md_path)
    ok = isinstance(fm, dict) and bool(fm.get("publish") is True)
    if debug:
        print(f"[sel] {'PASS' if ok else 'skip'} {md_path.name}: publish={fm.get('publish')!r}")
    return ok

# ================= Content regex =================
def apply_text_filters(text: str, regexes: list[tuple[re.Pattern,str]]) -> str:
    if not regexes:
        return text
    for pattern, repl in regexes:
        text = pattern.sub(repl, text)
    return text

# ================= Filename/dir filters (reuse global_contents_filter if toggled) =================
def apply_name_filters(name: str, regexes: list[tuple[re.Pattern,str]], enabled: bool=True) -> str:
    if not enabled or not regexes:
        return name
    out = name
    for rx, repl in regexes:
        out = rx.sub(repl, out)
    return out

# ================= Reference extraction =================
def extract_media_refs_from_text(text: str) -> list[tuple[str,bool]]:
    refs=[]
    # Obsidian wiki embeds/links
    for m in re.findall(r'!\[\[\s*([^\]|#]+.*?)\s*\]\]|\[\[\s*([^\]|#]+.*?)\s*\]\]', text):
        inner = (m[0] or m[1]).strip()
        target = inner.split('|',1)[0].split('#',1)[0].strip()
        refs.append((target, Path(target).suffix!=""))
    # Markdown images/links
    for m in MD_LINK.findall(text):
        href = (m[2] or "").strip()
        if not href or href.lower().startswith(("http:","https:", "data:", "mailto:", "#")):
            continue
        if " " in href and not Path(href).exists():
            href = href.split(" ")[0]
        refs.append((href, Path(href).suffix!=""))
    return refs

def extract_media_refs(md_path: Path, debug: bool=False) -> list[tuple[str,bool]]:
    text = read_text(md_path)
    refs = extract_media_refs_from_text(text)
    if debug:
        print(f"[refs] {md_path.name}: {len(refs)} refs")
    return refs

# ================= Search helpers =================
def iter_scope_ordered_for_media(note_dir: Path, vault_root: Path, include_hidden: bool, scope: str):
    """
    Priority order for media resolution:
      1) files in note_dir
      2) then deeper in note_dir subtree
      3) (if scope == 'vault') climb ancestors to vault_root (files, then subtree per ancestor)
      4) everything else in the vault
    """
    yielded = set()
    def _ok(rel: Path) -> bool:
        return include_hidden or not is_hidden(rel)

    # 1) direct files
    try:
        for p in note_dir.iterdir():
            if p.is_file():
                try:
                    rel = p.relative_to(vault_root)
                    if _ok(rel) and p not in yielded:
                        yielded.add(p); yield p
                except Exception:
                    pass
    except Exception:
        pass

    # 2) subtree
    for p in note_dir.rglob("*"):
        if not p.is_file(): continue
        try:
            rel = p.relative_to(vault_root)
            if _ok(rel) and p not in yielded:
                yielded.add(p); yield p
        except Exception:
            continue

    if scope != "vault":
        return

    # 3) climb ancestors
    cur = note_dir
    while True:
        parent = cur.parent
        try:
            _ = parent.relative_to(vault_root)
        except Exception:
            break

        try:
            for p in parent.iterdir():
                if p.is_file():
                    rel = p.relative_to(vault_root)
                    if _ok(rel) and p not in yielded:
                        yielded.add(p); yield p
        except Exception:
            pass
        for p in parent.rglob("*"):
            if not p.is_file(): continue
            try:
                rel = p.relative_to(vault_root)
                if _ok(rel) and p not in yielded:
                    yielded.add(p); yield p
            except Exception:
                continue
        cur = parent
        if cur == vault_root:
            break

    # 4) everything else
    for p in vault_root.rglob("*"):
        if not p.is_file(): continue
        if p in yielded: continue
        try:
            rel = p.relative_to(vault_root)
            if _ok(rel):
                yielded.add(p); yield p
        except Exception:
            continue

# ================= Media & Note resolvers =================
def resolve_media(note_dir: Path, vault_root: Path, raw_ref: str, has_ext: bool,
                  include_hidden: bool, scope: str, MEDIA_EXTS:set[str]) -> Path|None:
    ref_path = Path(raw_ref)

    # If the ref includes path parts, attempt case-insensitive walk from note_dir
    if len(ref_path.parts) > 1:
        base = note_dir
        for i, part in enumerate(ref_path.parts):
            if i < len(ref_path.parts)-1:
                found = None
                try:
                    for child in base.iterdir():
                        if child.is_dir() and nfc_cf(child.name) == nfc_cf(part):
                            found = child; break
                except Exception:
                    pass
                if not found:
                    break
                base = found
            else:
                try:
                    for child in base.iterdir():
                        if child.is_file() and nfc_cf(child.name) == nfc_cf(part):
                            return child
                except Exception:
                    pass
        # fall back to global search

    target_name_cf = nfc_cf(ref_path.name)
    target_stem_cf = nfc_cf(ref_path.stem)
    for p in iter_scope_ordered_for_media(note_dir, vault_root, include_hidden, scope):
        if not p.is_file(): continue
        name_cf = nfc_cf(p.name)
        stem_cf = nfc_cf(p.stem)
        ext_cf  = p.suffix.lower()
        if has_ext:
            if name_cf == target_name_cf:
                return p
        else:
            if stem_cf == target_stem_cf and ext_cf in MEDIA_EXTS:
                return p
    return None

def resolve_note(note_dir: Path, vault_root: Path, raw_ref: str, has_ext: bool,
                 include_hidden: bool, scope: str) -> Path|None:
    ref_path = Path(raw_ref)
    target_stem_cf=nfc_cf(ref_path.stem); target_name_cf=nfc_cf(ref_path.name)

    if len(ref_path.parts)>1:
        cand=(note_dir/ref_path).resolve()
        try:
            rel = cand.relative_to(vault_root)
            if (not include_hidden) and is_hidden(rel):
                cand = None
        except Exception:
            pass
        if cand and cand.exists(): return cand

    cand2=(note_dir/ref_path.name).resolve()
    try:
        rel2 = cand2.relative_to(vault_root)
        if (not include_hidden) and is_hidden(rel2):
            cand2 = None
    except Exception:
        pass
    if cand2 and cand2.exists(): return cand2

    for p in iter_scope_ordered_for_media(note_dir, vault_root, include_hidden, scope):
        if not p.is_file() or p.suffix.lower() != ".md": continue
        name_cf = nfc_cf(p.name); stem_cf = nfc_cf(p.stem)
        if has_ext:
            if name_cf == target_name_cf:
                return p
        else:
            if stem_cf == target_stem_cf:
                return p
    return None

# ================= Asset helpers (CSS/JS) =================
def _fmt_mtime(p: Path) -> str:
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(p.stat().st_mtime))
    except Exception:
        return "n/a"

def _is_url_like(s: str) -> bool:
    s = s.strip().lower()
    return s.startswith(("http://", "https://", "//"))

def _resolve_rel(base_file: Path, target: str) -> Path:
    base_dir = base_file.parent
    if target.startswith("/"):
        return (base_dir / target.lstrip("/")).resolve()
    return (base_dir / target).resolve()

def _resolve_js_rel(base_file: Path, target: str) -> Path | None:
    p = _resolve_rel(base_file, target)
    if p.is_file():
        return p
    if not Path(target).suffix:
        for ext in (".js", ".mjs"):
            p2 = _resolve_rel(base_file, target + ext)
            if p2.is_file():
                return p2
    return None

def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as e:
        tqdm.write(f"[warn] Could not read {path}: {e}")
        return ""

# ---- CSS parser: strip @charset, inline one-level relative @import, hoist others; ignore comments/strings ----
CSS_CHARSET_RE = re.compile(r'@charset\s+["\'][^"\']*["\']\s*;', re.IGNORECASE)

def _parse_import_path(import_stmt: str) -> tuple[str|None, bool]:
    s = import_stmt.strip()
    if not s.lower().startswith("@import"):
        return None, False
    s = s[len("@import"):].strip()

    if s.lower().startswith("url("):
        inside = s[4:].strip()
        if inside.endswith(";"):
            inside = inside[:-1].rstrip()
        if inside.endswith(")"):
            inside = inside[:-1].rstrip()
        if (inside.startswith('"') and inside.endswith('"')) or (inside.startswith("'") and inside.endswith("'")):
            inside = inside[1:-1]
        return inside.strip(), True

    if s and s[0] in ("'", '"'):
        q = s[0]
        try:
            j = s.index(q, 1)
        except ValueError:
            return None, False
        path = s[1:j]
        return path.strip(), False

    return None, False

def _process_css(css_text: str,
                 base_file: Path,
                 inline_one_level: bool,
                 strip_charset: bool,
                 hoist_imports: bool) -> tuple[list[str], str]:
    i = 0
    n = len(css_text)
    out_body = []
    hoisted: list[str] = []
    in_comment = False
    in_string = False
    quote_ch = ""
    while i < n:
        ch = css_text[i]

        if in_comment:
            out_body.append(ch)
            if ch == "*" and i+1 < n and css_text[i+1] == "/":
                out_body.append("/")
                i += 2
                in_comment = False
            else:
                i += 1
            continue

        if ch == "/" and i+1 < n and css_text[i+1] == "*":
            in_comment = True
            out_body.append("/*")
            i += 2
            continue

        if in_string:
            out_body.append(ch)
            if ch == "\\" and i+1 < n:
                out_body.append(css_text[i+1])
                i += 2
                continue
            if ch == quote_ch:
                in_string = False
            i += 1
            continue

        if ch in ("'", '"'):
            in_string = True
            quote_ch = ch
            out_body.append(ch)
            i += 1
            continue

        if ch == "@":
            rest = css_text[i:].lower()
            if rest.startswith("@charset"):
                j = i
                while j < n and css_text[j] != ";":
                    if css_text[j] in ("'", '"'):
                        q = css_text[j]; j += 1
                        while j < n:
                            if css_text[j] == "\\" and j+1 < n:
                                j += 2; continue
                            if css_text[j] == q:
                                j += 1; break
                            j += 1
                        continue
                    j += 1
                if j < n and css_text[j] == ";":
                    j += 1
                if not strip_charset:
                    out_body.append(css_text[i:j])
                i = j
                continue

            if rest.startswith("@import"):
                j = i
                paren_depth = 0
                while j < n:
                    c = css_text[j]
                    if c in ("'", '"'):
                        q = c; j += 1
                        while j < n:
                            if css_text[j] == "\\" and j+1 < n:
                                j += 2; continue
                            if css_text[j] == q:
                                j += 1; break
                            j += 1
                        continue
                    if c == "(":
                        paren_depth += 1
                    elif c == ")":
                        paren_depth = max(paren_depth - 1, 0)
                    elif c == ";" and paren_depth == 0:
                        j += 1; break
                    j += 1
                stmt = css_text[i:j]

                path, _ = _parse_import_path(stmt)
                did_handle = False
                if hoist_imports:
                    if path and inline_one_level and (path.startswith((".", "..", "/")) and not _is_url_like(path)):
                        target_path = _resolve_rel(base_file, path)
                        if target_path.is_file():
                            sub_text = _read_text(target_path)
                            sub_imports, sub_body = _process_css(
                                sub_text, base_file=target_path,
                                inline_one_level=False, strip_charset=True, hoist_imports=True
                            )
                            hoisted.extend(sub_imports)
                            out_body.append(sub_body)
                            did_handle = True
                        else:
                            tqdm.write(f"[styles] Skipped unresolved import: {path} from {base_file}")
                    if not did_handle:
                        hoisted.append(stmt.strip()); did_handle = True
                else:
                    if path and inline_one_level and (path.startswith((".", "..", "/")) and not _is_url_like(path)):
                        target_path = _resolve_rel(base_file, path)
                        if target_path.is_file():
                            sub_text = _read_text(target_path)
                            sub_imports, sub_body = _process_css(
                                sub_text, base_file=target_path,
                                inline_one_level=False, strip_charset=True, hoist_imports=False
                            )
                            if sub_imports:
                                out_body.append("\n".join(sub_imports) + "\n")
                            out_body.append(sub_body)
                            did_handle = True
                if not did_handle:
                    out_body.append(stmt)
                i = j
                continue

        out_body.append(ch)
        i += 1

    if hoist_imports:
        seen = set(); uniq=[]
        for s in hoisted:
            if s not in seen:
                uniq.append(s); seen.add(s)
        hoisted = uniq

    return hoisted, "".join(out_body)

def _inline_css_once(css_file: Path, inline_debug: bool=False, hoist_imports: bool=True) -> str:
    raw = _read_text(css_file)
    imports, body = _process_css(
        raw, base_file=css_file,
        inline_one_level=True, strip_charset=True, hoist_imports=hoist_imports,
    )
    if inline_debug:
        for imp in imports:
            tqdm.write(f"[styles] Hoisted: {imp}")
    if imports:
        return "\n".join(imports) + "\n\n" + body.strip() + "\n"
    return body.strip() + "\n"

# JS inliner
JS_IMPORT_RE = re.compile(
    r'^\s*(?:'
    r'import\s+[^"\']*\s+from\s+["\']([^"\']+)["\']'
    r'|import\s*["\']([^"\']+)["\']'
    r'|export\s+\*\s+from\s+["\']([^"\']+)["\']'
    r'|export\s+\{[^}]*\}\s+from\s+["\']([^"\']+)["\']'
    r'|const\s+\w+\s*=\s*require\(\s*["\']([^"\']+)["\']\s*\)'
    r')\s*;?\s*(?:\/\/.*)?$'
)

def _inline_js_once(js_file: Path, inline_debug: bool=False) -> str:
    try:
        text = js_file.read_text(encoding="utf-8")
    except Exception as e:
        tqdm.write(f"[warn] Could not read {js_file}: {e}")
        return ""

    out_lines = []
    for raw in text.splitlines():
        line = raw.rstrip()
        m = JS_IMPORT_RE.match(line)
        if not m:
            out_lines.append(raw); continue
        target = next((g for g in m.groups() if g), "").strip()
        if not target or _is_url_like(target) or not target.startswith((".", "/", "..")):
            out_lines.append(raw); continue
        target_path = _resolve_js_rel(js_file, target)
        if target_path:
            try:
                inlined = target_path.read_text(encoding="utf-8")
                if inline_debug:
                    tqdm.write(f"[scripts] Inlined {target} -> from {target_path}")
                out_lines.append(inlined)
            except Exception as e:
                tqdm.write(f"[warn] Could not read imported JS {target_path}: {e}")
                out_lines.append(raw)
        else:
            out_lines.append(raw)
    return "\n".join(out_lines)

def build_assets_from_script_dir(publish_root: Path, debug: bool=False, css_hoist_imports_top: bool=True):
    publish_root.mkdir(parents=True, exist_ok=True)
    script_dir = Path(__file__).resolve().parent

    # CSS
    css_src = script_dir / "publish.css"
    css_dst = publish_root / "publish.css"
    assert_in_publish_root(publish_root, css_dst)
    if css_src.is_file():
        css_text = _inline_css_once(css_src, inline_debug=debug, hoist_imports=css_hoist_imports_top)
        css_dst.write_text(css_text, encoding="utf-8")
        if debug:
            tqdm.write(f"[assets] publish.css: {css_src} -> {css_dst}")
    else:
        if css_dst.exists():
            assert_in_publish_root(publish_root, css_dst)
            css_dst.unlink()
            if debug:
                tqdm.write(f"[assets] removed stale publish.css at {css_dst}")

    # JS
    js_src = script_dir / "publish.js"
    js_dst = publish_root / "publish.js"
    assert_in_publish_root(publish_root, js_dst)
    if js_src.is_file():
        js_text = _inline_js_once(js_src, inline_debug=debug)
        js_dst.write_text(js_text, encoding="utf-8")
        if debug:
            tqdm.write(f"[assets] publish.js: {js_src} -> {js_dst}")
    else:
        if js_dst.exists():
            assert_in_publish_root(publish_root, js_dst)
            js_dst.unlink()
            if debug:
                tqdm.write(f"[assets] removed stale publish.js at {js_dst}")

    # logo.* (verbatim)
    for logo in script_dir.glob("logo.*"):
        if logo.is_file():
            dst = publish_root / logo.name
            assert_in_publish_root(publish_root, dst)
            shutil.copy2(logo, dst)
            if debug:
                tqdm.write(f"[assets] logo: {logo} -> {dst}")

    # favicon(s)
    for fav in ("favicon.ico", "favicon.png"):
        src = script_dir / fav
        if src.exists() and src.is_file():
            dst = publish_root / fav
            assert_in_publish_root(publish_root, dst)
            shutil.copy2(src, dst)
            if debug:
                tqdm.write(f"[assets] Copied {fav} -> {dst.relative_to(publish_root)}")

# ================= Flatten + naming =================
_ILLEGAL = '<>:"/\\|?*' + "\x00"
_TRANS = str.maketrans({c: "-" for c in _ILLEGAL})

def safe_filename(name: str) -> str:
    s = name.translate(_TRANS)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.rstrip(".") or "untitled"
    return s

# ================= Path transforms =================
def apply_folderpath_rewrite(folder_posix: str, rules: list[tuple[re.Pattern,str]]) -> str:
    """Apply ordered regex rewrites to the folder path string (posix, no leading slash)."""
    out = folder_posix
    for rx, repl in rules:
        out = rx.sub(repl, out)
    out = re.sub(r"/+", "/", out).strip("/")
    return out

def transform_media_rel_path(rel: Path,
                             name_filters: list[tuple[re.Pattern,str]],
                             apply_to_names: bool,
                             apply_to_dirs: bool) -> Path:
    parts = list(rel.parts)
    new_parts = []
    for i, part in enumerate(parts):
        if i < len(parts) - 1:
            if apply_to_dirs:
                base = apply_name_filters(part, name_filters, enabled=apply_to_dirs)
                base = safe_filename(base)
                new_parts.append(base)
            else:
                new_parts.append(part)
        else:
            stem = Path(part).stem
            ext  = Path(part).suffix
            if apply_to_names:
                stem = apply_name_filters(stem, name_filters, enabled=True)
                stem = safe_filename(stem)
            new_parts.append(stem + ext)
    return Path(*new_parts)

# ================= Link rewriting helpers =================
def _strip_md_ext(s: str) -> str:
    return s[:-3] if s.lower().endswith(".md") else s

def _split_target_alias(inner: str):
    if '|' in inner:
        left, alias = inner.split('|', 1)
        return left.strip(), alias.strip()
    return inner.strip(), None

def _split_target_heading(left: str):
    if '#' in left:
        target, heading = left.split('#', 1)
        return target.strip(), heading.strip()
    return left.strip(), None

def _normalize_target_for_match(target: str) -> tuple[str, str]:
    t = target.replace('\\', '/').strip()
    t = _strip_md_ext(t).strip('/').strip()
    stem = t.split('/')[-1]
    return (t.lower(), stem.lower())

def _collapse_rel_path(base_rel_md: str, target_path: str) -> str:
    base_dir = PurePosixPath(base_rel_md).parent
    raw = PurePosixPath(target_path)
    p = raw if raw.is_absolute() else (base_dir / raw)
    stack = []
    for part in p.parts:
        if part in ('', '.'): continue
        if part == '..':
            if stack: stack.pop()
            continue
        stack.append(part)
    return '/'.join(stack)

def _media_ref_key(current_rel_noext: str, raw_ref: str) -> str:
    """Normalize a media reference into a lookup key used during rewrite."""
    ref = (raw_ref or "").split("#", 1)[0].strip()
    if "/" in ref or "\\" in ref or ref.startswith((".", "..")):
        ref = _collapse_rel_path(current_rel_noext + ".md", ref)
    else:
        ref = Path(ref).name
    return ref.lower()

def _resolve_note_newpath(target0: str,
                          current_rel_noext: str,
                          map_by_rel_noext: dict[str, str],
                          map_by_unique_stem: dict[str, str],
                          MEDIA_EXTS:set[str]) -> tuple[str|None, bool]:
    """Return new *note* path without extension under md_root_dir, or (None, False) if media."""
    if any(target0.lower().endswith(ext) for ext in MEDIA_EXTS):
        return None, False
    t_for_rel = target0
    if '/' in target0 or '\\' in target0 or target0.startswith(('.', '..')):
        t_for_rel = _collapse_rel_path(current_rel_noext + ".md", target0)
    t_rel_key, t_stem_key = _normalize_target_for_match(t_for_rel)
    t_key_direct_rel, _   = _normalize_target_for_match(target0)
    new_noext = (
        map_by_rel_noext.get(t_rel_key) or
        map_by_rel_noext.get(t_key_direct_rel) or
        map_by_unique_stem.get(t_stem_key)
    )
    return new_noext, True

# ================= Link rewriting (wikilinks + md links) =================
def rewrite_wikilinks(text: str, current_rel_noext: str,
                      map_note_relnoext_to_new_noext: dict[str, str],
                      map_by_unique_stem: dict[str, str],
                      MEDIA_EXTS:set[str],
                      media_map_by_rel: dict[str, str],
                      media_ref_to_newrel: dict[str, str],
                      md_root_dir: str) -> str:
    def _repl(m: re.Match):
        bang = m.group(1)
        inner = m.group(2)
        left, alias = _split_target_alias(inner)
        target0, heading = _split_target_heading(left)

        is_media = any(target0.lower().endswith(ext) for ext in MEDIA_EXTS)
        if is_media:
            # ONLY rewrite EMBEDS
            if bang != "!":
                return m.group(0)
            # try ref-based mapping first (covers bare filenames)
            ref_key = _media_ref_key(current_rel_noext, target0)
            new_rel = media_ref_to_newrel.get(ref_key)
            if not new_rel:
                # fallback to path-collapsed key
                t_for_rel = target0
                if '/' in target0 or '\\' in target0 or target0.startswith(('.', '..')):
                    t_for_rel = _collapse_rel_path(current_rel_noext + ".md", target0)
                key = t_for_rel.lower()
                new_rel = media_map_by_rel.get(key)
            if new_rel:
                rebuilt_left = f"{md_root_dir}/{new_rel}"
                inner_new = rebuilt_left + (f"#{heading}" if heading else "")
                inner_new = inner_new + (f"|{alias}" if alias else "")
                return f"{bang}[[{inner_new}]]"
            return m.group(0)

        new_noext, is_note = _resolve_note_newpath(
            target0, current_rel_noext,
            map_note_relnoext_to_new_noext, map_by_unique_stem, MEDIA_EXTS
        )
        if not is_note:
            return m.group(0)
        if new_noext:
            rebuilt_left = new_noext + (f"#{heading}" if heading else "")
            inner_new = rebuilt_left + (f"|{alias}" if alias else "")
            return f"{bang}[[{inner_new}]]"
        else:
            if bang:
                return ""
            display = alias if alias else (target0 + (f"#{heading}" if heading else ""))
            return display
    return WIKILINK_ALL.sub(_repl, text)

def rewrite_md_links(text: str, current_rel_noext: str,
                     map_note_relnoext_to_new_noext: dict[str, str],
                     map_by_unique_stem: dict[str, str],
                     md_root_dir: str,
                     MEDIA_EXTS:set[str],
                     media_map_by_rel: dict[str, str],
                     media_ref_to_newrel: dict[str, str]) -> str:
    def _repl(m: re.Match):
        bang  = m.group(1)
        label = m.group(2)
        href  = (m.group(3) or "").strip()

        if href.lower().startswith(("http:", "https:", "mailto:", "data:", "#")):
            return m.group(0)

        heading = ""
        href_nohash = href
        if "#" in href:
            href_nohash, heading = href.split("#", 1)
            heading = "#" + heading

        if any(href_nohash.lower().endswith(ext) for ext in MEDIA_EXTS):
            if bang != "!":
                return m.group(0)
            # try ref-based mapping first
            ref_key = _media_ref_key(current_rel_noext, href_nohash)
            new_rel = media_ref_to_newrel.get(ref_key)
            if not new_rel:
                t_for_rel = href_nohash
                if '/' in href_nohash or '\\' in href_nohash or href_nohash.startswith(('.', '..')):
                    t_for_rel = _collapse_rel_path(current_rel_noext + ".md", href_nohash)
                key = t_for_rel.lower()
                new_rel = media_map_by_rel.get(key)
            if new_rel:
                return f"{bang}[{label}]({md_root_dir}/{new_rel}{heading})"
            return m.group(0)

        target_noext = _strip_md_ext(href_nohash)
        new_noext, is_note = _resolve_note_newpath(
            target_noext, current_rel_noext,
            map_note_relnoext_to_new_noext, map_by_unique_stem, MEDIA_EXTS
        )
        if not is_note:
            return m.group(0)
        if new_noext:
            return f"{bang}[{label}]({md_root_dir}/{new_noext}.md{heading})"
        else:
            if bang:
                return ""
            return label
    return MD_LINK.sub(_repl, text)

# ================= Main =================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="Path to YAML/JSON config (default: publish.build.yaml|yml|json if present)")
    ap.add_argument("--vault", help="Override config.vault")
    ap.add_argument("--publish", help="Override config.publish")
    ap.add_argument("--dry-run", action="store_true", help="Force dry run (overrides config)")
    ap.add_argument("--debug",   action="store_true", help="Force debug (overrides config)")
    args = ap.parse_args()

    cfg = load_config(Path(args.config) if args.config else None)

    if args.vault:   cfg["vault"]   = args.vault
    if args.publish: cfg["publish"] = args.publish
    if args.dry_run: cfg["dry_run"] = True
    if args.debug:   cfg["debug"]   = True

    vault_root   = Path(cfg["vault"]).resolve()
    publish_root = Path(cfg["publish"]).resolve()
    MD_ROOT_DIR  = cfg.get("md_root_dir", "content")

    MEDIA_EXTS = set(e.lower() for e in cfg.get("media_exts", []))
    global_contents_filter = compile_regex_list(cfg.get("global_contents_filter", []), "global_contents_filter")
    MD_FOLDERPATH_REWRITE = compile_regex_list(cfg.get("md_folderpath_rewrite", []), "md_folderpath_rewrite")

    APPLY_NAME = bool(cfg.get("apply_filters_to_filenames", True))
    APPLY_DIRS = bool(cfg.get("apply_filters_to_dirs", True))

    md_root = publish_root / MD_ROOT_DIR
    publish_root.mkdir(parents=True, exist_ok=True)
    md_root.mkdir(parents=True, exist_ok=True)

    print(f"[start] vault_root = {vault_root}")
    print(f"[start] publish_root = {publish_root}")
    print(f"[start] md_root_dir  = {md_root}")

    # 0) styles, scripts, logos FROM SCRIPT DIR ONLY
    build_assets_from_script_dir(
        publish_root,
        debug=cfg["debug"],
        css_hoist_imports_top=cfg.get("css_hoist_imports_top", True),
    )

    # 1) collect md files (skip hidden unless asked)
    md_files=[]
    for p in vault_root.rglob("*.md"):
        try:
            rel = p.relative_to(vault_root)
        except Exception:
            continue
        if not cfg["include_hidden"] and is_hidden(rel): 
            continue
        if p.is_file(): 
            md_files.append(p)
    print(f"[scan] md files found (after hidden filter): {len(md_files)}")

    # 2) select publish:true
    publish_notes=[]
    for md in md_files:
        if should_publish(md, debug=cfg["debug"]):
            publish_notes.append(md)
    print(f"[scan] publish:true selected: {len(publish_notes)}")
    if cfg["list_selected"] and publish_notes:
        for n in sorted(publish_notes, key=lambda p: p.relative_to(vault_root).as_posix()):
            print(" -", n.relative_to(vault_root))

    allowed_note_paths = set(p.resolve() for p in publish_notes)

    # 3) keep assets copied earlier
    keep_paths:set[Path]=set()
    for core in ("publish.css","publish.js"):
        cand = publish_root / core
        if cand.exists(): keep_paths.add(cand)
    for logo in publish_root.glob("logo.*"):
        keep_paths.add(logo)

    # copy user-specified extras (root-relative)
    root_srcs:set[Path]=set()
    for a in (cfg.get("always_root") or []):
        cand = (vault_root / a)
        if cand.exists() and cand.is_file():
            root_srcs.add(cand)
    for src in sorted(root_srcs):
        rel = src.relative_to(vault_root)
        dst = publish_root / rel.name
        keep_paths.add(dst)
        if cfg["dry_run"]:
            tqdm.write(f"[dry] copy (root) {rel} -> {dst.relative_to(publish_root)}")
        else:
            assert_in_publish_root(publish_root, dst)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # 4) resolve refs for notes (collect required files)
    required_srcs:set[Path]=set()
    # For media: record how it was referenced so we can expand bare names later
    ref_links_by_hit: dict[Path, set[str]] = defaultdict(set)

    for note in tqdm(publish_notes, desc="Resolving notes", unit="note"):
        required_srcs.add(note)
        refs = extract_media_refs(note, debug=cfg["debug"])
        current_rel_noext = note.relative_to(vault_root).as_posix()[:-3]
        for ref, has_ext in refs:
            suffix = Path(ref).suffix.lower()
            hit = None
            # try media first if looks like media (or no ext — stem match later)
            if suffix in MEDIA_EXTS or (not has_ext):
                hit = resolve_media(
                    note_dir=note.parent, vault_root=vault_root, raw_ref=ref, has_ext=has_ext,
                    include_hidden=cfg["include_hidden"], scope=cfg["scope"], MEDIA_EXTS=MEDIA_EXTS
                )
                if hit and hit.suffix.lower() != ".md":
                    # Record reference key -> this media file
                    ref_key = _media_ref_key(current_rel_noext, ref)
                    ref_links_by_hit[hit].add(ref_key)
            if not hit:
                hit = resolve_note(
                    note_dir=note.parent, vault_root=vault_root, raw_ref=ref, has_ext=has_ext,
                    include_hidden=cfg["include_hidden"], scope=cfg["scope"]
                )
            if hit:
                if hit.suffix.lower() == ".md" and hit.resolve() not in allowed_note_paths:
                    continue
                try:
                    rel = hit.relative_to(vault_root)
                    if not cfg["include_hidden"] and is_hidden(rel):
                        continue
                except Exception:
                    pass
                required_srcs.add(hit)

    # 5) Build NOTE path mapping (folder rewrite + filename filters)
    # map: original note rel-noext (posix, lowercase) -> new note rel-noext under md_root_dir
    note_new_noext_by_relnoext: dict[str, str] = {}
    stem_to_relnoext: dict[str, list[str]] = {}

    md_folder_rules = MD_FOLDERPATH_REWRITE  # compiled

    for src in publish_notes:
        rel = src.relative_to(vault_root)           # e.g., "Trips/Italy/Day1.md"
        folder_posix = rel.parent.as_posix()        # e.g., "Trips/Italy"
        # 5a) folder path rewrite (markdown-only)
        folder_rewritten = apply_folderpath_rewrite(folder_posix, md_folder_rules)
        # 5b) pass dir segments through name filters if enabled (to keep redactions aligned)
        if folder_rewritten:
            parts = [safe_filename(apply_name_filters(seg, global_contents_filter, enabled=APPLY_DIRS)) for seg in folder_rewritten.split("/")]
            new_folder = "/".join([p for p in parts if p])
        else:
            new_folder = ""  # flatten
        # 5c) filename transform
        stem = src.stem
        stem = apply_name_filters(stem, global_contents_filter, enabled=APPLY_NAME)
        stem = safe_filename(stem)
        new_noext = f"{new_folder + '/' if new_folder else ''}{stem}"

        rel_noext = rel.as_posix()[:-3].lower()
        note_new_noext_by_relnoext[rel_noext] = new_noext

        stem_key = src.stem.lower()
        stem_to_relnoext.setdefault(stem_key, []).append(rel_noext)

    unique_stem_to_new_noext: dict[str, str] = {}
    for stem, rels in stem_to_relnoext.items():
        if len(rels) == 1:
            unique_stem_to_new_noext[stem] = note_new_noext_by_relnoext[rels[0]]

    # 6) Build MEDIA path mapping (original rel -> NEW rel under md_root_dir)
    media_dst_by_rel: dict[str, str] = {}
    media_ref_to_newrel: dict[str, str] = {}

    for src in sorted(required_srcs):
        if src.suffix.lower() == ".md":
            continue
        rel = src.relative_to(vault_root)
        new_rel = transform_media_rel_path(
            rel,
            name_filters=global_contents_filter,
            apply_to_names=APPLY_NAME,
            apply_to_dirs=APPLY_DIRS
        )
        new_rel_s = new_rel.as_posix()
        media_dst_by_rel[rel.as_posix().lower()] = new_rel_s

        # Also map every ref-string that resolved to this src
        for ref_key in (ref_links_by_hit.get(src) or ()):
            media_ref_to_newrel[ref_key] = new_rel_s

    # 7) copy notes & media under md_root_dir + rewrite links
    for src in tqdm(sorted(required_srcs), desc="Copying content", unit="file"):
        rel = src.relative_to(vault_root)
        if src.suffix.lower()==".md":
            rel_noext = rel.as_posix()[:-3].lower()
            new_noext = note_new_noext_by_relnoext[rel_noext]  # path-within-root, no extension
            dst = (publish_root / MD_ROOT_DIR / f"{new_noext}.md")
            keep_paths.add(dst)
            if cfg["dry_run"]:
                tqdm.write(f"[dry] copy (note) {rel} -> {dst.relative_to(publish_root)}")
            else:
                content = read_text(src)
                # Apply content redaction first
                content = apply_text_filters(content, regexes=global_contents_filter)
                current_rel_noext = rel.as_posix()[:-3]
                # Rewrite links (notes -> md_root_dir/<new_noext>.md; media EMBEDS -> md_root_dir/<mapped>)
                content = rewrite_wikilinks(
                    content,
                    current_rel_noext=current_rel_noext,
                    map_note_relnoext_to_new_noext=note_new_noext_by_relnoext,
                    map_by_unique_stem=unique_stem_to_new_noext,
                    MEDIA_EXTS=MEDIA_EXTS,
                    media_map_by_rel=media_dst_by_rel,
                    media_ref_to_newrel=media_ref_to_newrel,
                    md_root_dir=MD_ROOT_DIR
                )
                content = rewrite_md_links(
                    content,
                    current_rel_noext=current_rel_noext,
                    map_note_relnoext_to_new_noext=note_new_noext_by_relnoext,
                    map_by_unique_stem=unique_stem_to_new_noext,
                    md_root_dir=MD_ROOT_DIR,
                    MEDIA_EXTS=MEDIA_EXTS,
                    media_map_by_rel=media_dst_by_rel,
                    media_ref_to_newrel=media_ref_to_newrel
                )
                assert_in_publish_root(publish_root, dst)
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
        else:
            rel = src.relative_to(vault_root)
            new_rel = Path(media_dst_by_rel.get(rel.as_posix().lower(), rel.as_posix()))
            dst = publish_root / MD_ROOT_DIR / new_rel
            keep_paths.add(dst)
            if cfg["dry_run"]:
                tqdm.write(f"[dry] copy (media) {rel} -> {dst.relative_to(publish_root)}")
            else:
                assert_in_publish_root(publish_root, dst)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

    # 8) prune anything not needed (protect .obsidian/)
    prune_extraneous(publish_root, keep_paths, dry=cfg["dry_run"])

    # 9) summary
    print("\n=== Publish vault build ===")
    print(f"Main vault:     {vault_root}")
    print(f"Publish vault:  {publish_root}")
    print(f"Root dir:       {MD_ROOT_DIR}/")
    print(f"Notes scanned:  {len(md_files)}")
    print(f"Selected:       {len(publish_notes)} notes (publish:true only)")
    print(f"Files kept:     {len(keep_paths)} (notes + media + root assets)")
    print("Hidden files:   " + ("INCLUDED" if cfg["include_hidden"] else "SKIPPED"))
    print("Styles:         " + ("publish.css present" if (publish_root/'publish.css').exists() else "none"))
    print("Scripts:        " + ("publish.js present" if (publish_root/'publish.js').exists() else "none"))
    print("Logos:          " + ("logo.* present" if any(publish_root.glob('logo.*')) else "none"))
    print("Done.")

def prune_extraneous(dest_root: Path, keep_paths: set[Path], dry: bool=False):
    def _is_protected(p: Path) -> bool:
        try:
            rel = p.relative_to(dest_root)
        except ValueError:
            return False
        return rel.parts and rel.parts[0] == ".obsidian"

    for p in dest_root.rglob("*"):
        if _is_protected(p):
            continue
        if p.is_file() and p not in keep_paths:
            if dry: tqdm.write(f"[dry] delete {p.relative_to(dest_root)}")
            else:
                assert_in_publish_root(dest_root, p)
                p.unlink()
    for d in sorted([x for x in dest_root.rglob("*") if x.is_dir()], key=lambda x: len(x.parts), reverse=True):
        if _is_protected(d):
            continue
        try:
            next(d.iterdir())
        except StopIteration:
            if dry: tqdm.write(f"[dry] rmdir  {d.relative_to(dest_root)}")
            else:
                assert_in_publish_root(dest_root, d)
                d.rmdir()

if __name__ == "__main__":
    main()