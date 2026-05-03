#!/usr/bin/env python3
"""
Claude Skill Manager — Desktop GUI
Downloads GitHub skills to a local library, tracks origins and deployments,
checks for updates, and cascades updates to projects.
"""

import json
import re
import shutil
import subprocess
import threading
import tkinter as tk
from datetime import datetime, timezone
from tkinter import filedialog, messagebox
from pathlib import Path

import customtkinter as ctk

CONFIG_PATH = Path.home() / ".claude" / "skill-manager.json"
LIBRARY_PATH = Path.home() / ".claude" / "skills"

# ── Colors ──
BG = "#1c1c1e"
CARD = "#2c2c2e"
BORDER = "#3a3a3c"
TEXT = "#e5e5e5"
MUTED = "#8e8e93"
BLUE = "#3b82f6"
BLUE_HOVER = "#2563eb"


# ═══════════════════════════════════════════════════════════
#  Config — load, save, migrate, reconcile
# ═══════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def load_config() -> dict:
    """Load config, auto-migrating from old format if needed."""
    raw = {}
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            raw = json.load(f)

    # Already new format
    if "skills" in raw:
        return raw

    # Migrate old format: installed_skills[] → skills{}
    config = {
        "last_project": raw.get("last_project", ""),
        "skills": {},
    }
    for entry in raw.get("installed_skills", []):
        name = entry.get("name", "")
        if name:
            config["skills"][name] = {
                "url": entry.get("url"),
                "commit": None,
                "installed_at": _now_iso(),
                "updated_at": _now_iso(),
                "projects": [],
            }
    return config


def save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def reconcile_config(config: dict):
    """Sync config with what's actually on disk. Add missing, remove stale."""
    skills = config.setdefault("skills", {})

    if LIBRARY_PATH.exists():
        for item in LIBRARY_PATH.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                if item.name not in skills:
                    skills[item.name] = {
                        "url": None,
                        "commit": None,
                        "installed_at": _now_iso(),
                        "updated_at": None,
                        "projects": [],
                    }

    # Remove config entries whose dirs no longer exist
    for name in list(skills.keys()):
        if not (LIBRARY_PATH / name).is_dir():
            del skills[name]

    # Prune dead project paths
    for info in skills.values():
        info["projects"] = [
            p for p in info.get("projects", [])
            if Path(p).is_dir()
        ]

    save_config(config)


# ═══════════════════════════════════════════════════════════
#  Skill operations — clone, copy, update, check
# ═══════════════════════════════════════════════════════════

def parse_skill_frontmatter(skill_md_path: Path) -> dict:
    """Parse YAML frontmatter from a SKILL.md or AGENTS.md file.

    Returns dict with name, description, license, compatibility, metadata.
    Returns empty dict if no frontmatter or file doesn't exist.
    """
    if not skill_md_path.is_file():
        return {}
    try:
        text = skill_md_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}

    # Extract YAML frontmatter between --- delimiters
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    yaml_text = text[3:end].strip()

    # Simple YAML parser (avoids PyYAML dependency)
    # Handles flat key: value, multiline >- and |, and indented continuations
    result = {}
    current_key = None
    current_lines = []
    fields = {"name", "description", "license", "compatibility"}

    def _flush():
        if current_key and current_key in fields:
            result[current_key] = " ".join(current_lines).strip()

    for line in yaml_text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # Indented continuation line (part of a multiline value)
        if line[0] in (" ", "\t") and current_key:
            current_lines.append(stripped)
            continue

        # New top-level key
        if ":" in stripped and not stripped.startswith("-"):
            _flush()
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # Skip YAML multiline indicators
            if value in (">-", ">", "|", "|-"):
                current_key = key
                current_lines = []
            else:
                current_key = key
                current_lines = [value] if value else []

    _flush()
    return result


def get_skill_info(skill_dir: Path) -> dict:
    """Get frontmatter info for a skill directory. Checks SKILL.md then AGENTS.md."""
    for filename in ("SKILL.md", "AGENTS.md"):
        info = parse_skill_frontmatter(skill_dir / filename)
        if info:
            return info
    return {}


# Primary skill identifiers (files that definitively say "this is a skill")
SKILL_IDENTIFIERS = ("SKILL.md", "AGENTS.md")
# Supporting content (doesn't make something a skill alone, but enriches one)
SKILL_CONTENT = ("references", "scripts", "data", "commands")
# Dirs to skip during recursive scanning
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "dist", "build"}


def detect_skill_type(path: Path) -> dict:
    """Analyze a directory and return what skill content it has.

    Returns dict with:
      identifiers: list of primary skill files found (SKILL.md, AGENTS.md)
      content: list of supporting dirs found (references/, scripts/, etc)
      nested: list of (name, path) for skills found inside (bundles)
      is_skill: True if this dir IS a skill (has identifiers at root)
      is_bundle: True if this dir CONTAINS skills (nested SKILL.md/AGENTS.md)
    """
    identifiers = []
    content = []

    for f in SKILL_IDENTIFIERS:
        p = path / f
        if p.is_file() or (p.is_symlink() and p.exists()):
            identifiers.append(f)

    for d in SKILL_CONTENT:
        if (path / d).is_dir():
            content.append(f"{d}/")

    # Recursively find nested skills (SKILL.md or AGENTS.md deeper in the tree)
    nested = []
    seen = set()
    for identifier in SKILL_IDENTIFIERS:
        for found in path.rglob(identifier):
            skill_dir = found.parent
            if skill_dir == path:
                continue  # skip root — that's the parent, not nested
            # Skip junk dirs
            try:
                rel_parts = skill_dir.relative_to(path).parts
            except ValueError:
                continue
            if any(p in SKIP_DIRS for p in rel_parts):
                continue
            # Skip if this is inside a "resources" or "docs" example collection
            if any(p in ("resources", "docs", "i18n", "test", "tests") for p in rel_parts):
                continue
            name = skill_dir.name
            if name not in seen:
                seen.add(name)
                nested.append((name, skill_dir))

    return {
        "identifiers": identifiers,
        "content": content,
        "nested": nested,
        "is_skill": bool(identifiers),
        "is_bundle": len(nested) > 0 and not identifiers,
    }


def describe_skill(path: Path) -> str:
    """Return a short description for the library list display."""
    info = detect_skill_type(path)

    if info["is_bundle"]:
        return f"{len(info['nested'])} skills"
    elif info["identifiers"] or info["content"]:
        parts = info["identifiers"] + info["content"]
        return ", ".join(parts)
    else:
        return ""


def extract_skill_name(url: str) -> str:
    """Extract a skill name from a GitHub URL."""
    url = url.rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    return url.split("/")[-1]


def _clone_to_library(url: str, repo_name: str, on_status):
    """Clone a repo as a single library entry. Returns (success, commit, error)."""
    dest = LIBRARY_PATH / repo_name
    LIBRARY_PATH.mkdir(parents=True, exist_ok=True)

    tmp = Path("/tmp") / f"skill-download-{repo_name}"
    if tmp.exists():
        shutil.rmtree(tmp)

    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", url, str(tmp)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return False, None, result.stderr.strip() or "Unknown git error"
    except subprocess.TimeoutExpired:
        return False, None, "Git clone timed out after 60s"
    except FileNotFoundError:
        return False, None, "Git not found — install with: brew install git"

    # Grab commit SHA before we lose .git
    sha_result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=str(tmp), capture_output=True, text=True,
    )
    commit = sha_result.stdout.strip() if sha_result.returncode == 0 else None

    try:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(
            tmp, dest,
            ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__"),
        )
    except OSError as e:
        return False, None, f"Could not install to library:\n{e}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return True, commit, ""


def clone_skill(url: str, on_status, on_done, on_error):
    """Clone a GitHub repo into the skill library (background thread)."""
    repo_name = extract_skill_name(url)
    on_status(f"Installing {repo_name}...")

    ok, commit, err = _clone_to_library(url, repo_name, on_status)
    if not ok:
        on_error("Install failed", err)
        return

    # Report what we found inside
    info = detect_skill_type(LIBRARY_PATH / repo_name)
    if info["is_bundle"]:
        on_status(f"Installed '{repo_name}' — {len(info['nested'])} skills inside")
    else:
        on_status(f"Installed '{repo_name}' to library")

    on_done(repo_name, commit)


def update_skill(name: str, url: str, project_paths: list[str],
                 on_status, on_done, on_error):
    """Re-clone a skill and cascade the update to all tracked projects (background thread)."""
    repo_name = extract_skill_name(url)
    on_status(f"Updating {name}...")

    ok, commit, err = _clone_to_library(url, repo_name, on_status)
    if not ok:
        on_error("Update failed", err)
        return

    # Cascade to projects
    src = LIBRARY_PATH / name
    updated_projects = []
    for project_path in project_paths:
        dest = Path(project_path) / ".claude" / "skills" / name
        if not Path(project_path).is_dir():
            continue
        project_name = Path(project_path).name
        on_status(f"Updating {name} in {project_name}...")
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() or dest.is_symlink():
                if dest.is_symlink() or dest.is_file():
                    dest.unlink()
                else:
                    shutil.rmtree(dest)
            shutil.copytree(src, dest)
            updated_projects.append(project_path)
        except OSError:
            pass  # skip failed projects, don't abort the whole update

    on_done(name, commit, updated_projects)


def check_remote_sha(url: str) -> str | None:
    """Get the latest commit SHA from a remote repo. Returns short SHA or None."""
    try:
        result = subprocess.run(
            ["git", "ls-remote", url, "HEAD"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split()[0][:7]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def copy_to_project(skill_name: str, project_path: str) -> bool:
    """Copy a skill from library into a project's .claude/skills/ directory."""
    src = LIBRARY_PATH / skill_name
    if not src.exists():
        messagebox.showerror("Not found", f"Skill '{skill_name}' not in library")
        return False

    dest = Path(project_path) / ".claude" / "skills" / skill_name
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() or dest.is_symlink():
        if not messagebox.askyesno(
            "Replace skill?",
            f"'{skill_name}' already exists in {Path(project_path).name}.\n\nReplace it?",
        ):
            return False
        if dest.is_symlink() or dest.is_file():
            dest.unlink()
        else:
            shutil.rmtree(dest)

    try:
        shutil.copytree(src, dest)
    except OSError as e:
        messagebox.showerror("Copy failed", f"Could not copy skill:\n{e}")
        return False
    return True


# ═══════════════════════════════════════════════════════════
#  Export / Import
# ═══════════════════════════════════════════════════════════

def export_skill_list(config: dict) -> str:
    """Generate a markdown skill list for sharing."""
    skills = config.get("skills", {})
    lines = ["# My Claude Skills", ""]
    for name in sorted(skills):
        info = skills[name]
        url = info.get("url")
        if url:
            lines.append(f"- [{name}]({url})")
        else:
            lines.append(f"- {name} *(local)*")
    lines.append("")
    lines.append(f"*Exported {_now_iso()[:10]} — "
                 f"{len(skills)} skill{'s' if len(skills) != 1 else ''}*")
    lines.append("")
    return "\n".join(lines)


def parse_skill_list(text: str) -> list[dict]:
    """Parse a markdown skill list. Returns list of {name, url}."""
    results = []
    # Match markdown links: [name](url)
    for match in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', text):
        name, url = match.group(1).strip(), match.group(2).strip()
        if url:
            results.append({"name": name, "url": url})
    return results


# ═══════════════════════════════════════════════════════════
#  GUI (CustomTkinter)
# ═══════════════════════════════════════════════════════════

# Widget helpers
def _btn(parent, text, command, accent=False, **kw):
    """Create a styled button."""
    return ctk.CTkButton(
        parent, text=text, command=command,
        fg_color=BLUE if accent else BORDER,
        hover_color=BLUE_HOVER if accent else "#4a4a4c",
        text_color="white" if accent else TEXT,
        font=ctk.CTkFont(family="SF Pro Text", size=13,
                         weight="bold" if accent else "normal"),
        corner_radius=8, height=34, **kw,
    )


def _label(parent, text="", font_size=13, color=TEXT, bold=False, **kw):
    """Create a styled label."""
    return ctk.CTkLabel(
        parent, text=text, text_color=color,
        font=ctk.CTkFont(family="SF Pro Text", size=font_size,
                         weight="bold" if bold else "normal"),
        anchor="w", **kw,
    )


def _sep(parent):
    """Horizontal separator line."""
    f = ctk.CTkFrame(parent, height=1, fg_color=BORDER)
    f.pack(fill="x", padx=16, pady=10)
    return f


class SkillManagerApp:
    def __init__(self, root: ctk.CTk):
        self.root = root
        self.root.title("Claude Skill Manager")
        self.root.geometry("680x860")
        self.root.minsize(680, 860)

        self.config = load_config()
        reconcile_config(self.config)

        self.status_var = tk.StringVar(value="Select a skill to get started")
        self.update_available = {}

        self._build_ui()
        self.refresh_library()

    def _build_ui(self):
        px = 20  # horizontal padding

        # ══════════════════════════════════════════════════
        #  HEADER
        # ══════════════════════════════════════════════════
        header = ctk.CTkFrame(self.root, fg_color="transparent")
        header.pack(fill="x", padx=px, pady=(18, 0))

        _label(header, "Claude Skill Manager", font_size=20,
               color="#ffffff", bold=True).pack(side="left")
        _btn(header, "Import", self.import_skill_list, width=80).pack(
            side="right", padx=(6, 0))
        _btn(header, "Export", self.export_skill_list, width=80).pack(side="right")

        self.library_count_label = _label(
            self.root, "Loading...", font_size=12, color=MUTED)
        self.library_count_label.pack(padx=px, anchor="w", pady=(2, 0))

        _sep(self.root)

        # ══════════════════════════════════════════════════
        #  SECTION 1: Get Skills
        # ══════════════════════════════════════════════════
        _label(self.root, "Get Skills", font_size=14, bold=True).pack(
            padx=px, anchor="w", pady=(0, 4))

        get_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        get_frame.pack(fill="x", padx=px, pady=(0, 4))

        self.url_entry = ctk.CTkEntry(
            get_frame, placeholder_text="https://github.com/user/skill-repo",
            font=ctk.CTkFont(family="SF Mono", size=13),
            fg_color=CARD, border_color=BORDER, text_color=TEXT, height=34)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.download_btn = _btn(
            get_frame, "Install from GitHub", self.download_skill, accent=True)
        self.download_btn.pack(side="right")

        _sep(self.root)

        # ══════════════════════════════════════════════════
        #  SECTION 2: Your Library
        # ══════════════════════════════════════════════════
        lib_header = ctk.CTkFrame(self.root, fg_color="transparent")
        lib_header.pack(fill="x", padx=px, pady=(0, 4))

        _label(lib_header, "Your Library", font_size=14, bold=True).pack(side="left")

        self.update_all_btn = _btn(
            lib_header, "Update All", self.update_all_skills, accent=True, width=110)
        # Hidden by default — shown only when updates are found
        self.check_updates_btn = _btn(
            lib_header, "Check All for Updates", self.check_for_updates, width=170)
        self.check_updates_btn.pack(side="right")

        # Listbox (keeping tk.Listbox — CTk doesn't have a good list widget)
        list_frame = ctk.CTkFrame(self.root, fg_color=CARD, corner_radius=8)
        list_frame.pack(fill="both", expand=True, padx=px, pady=(0, 4))

        self.skill_listbox = tk.Listbox(
            list_frame, bg=CARD, fg=TEXT, selectbackground=BLUE,
            selectforeground="white", font=("SF Mono", 13), borderwidth=0,
            highlightthickness=0, activestyle="none", height=8,
        )
        self.skill_listbox.pack(side="left", fill="both", expand=True, padx=4, pady=4)
        self.skill_listbox.bind("<<ListboxSelect>>", self._on_selection_change)
        self.skill_listbox.bind("<Double-Button-1>", lambda _: self.open_skill_folder())

        scrollbar = ctk.CTkScrollbar(list_frame, command=self.skill_listbox.yview)
        scrollbar.pack(side="right", fill="y", padx=(0, 4), pady=4)
        self.skill_listbox.config(yscrollcommand=scrollbar.set)

        _sep(self.root)

        # ══════════════════════════════════════════════════
        #  SECTION 3: Selected Skill
        # ══════════════════════════════════════════════════
        self.selection_label = _label(
            self.root, "No skill selected", font_size=14, color=BLUE, bold=True)
        self.selection_label.pack(padx=px, anchor="w", pady=(0, 0))

        self.detail_desc_label = _label(
            self.root, "", font_size=12, color=TEXT, wraplength=600)
        self.detail_desc_label.pack(padx=px + 4, anchor="w", pady=(0, 2))

        self.detail_source_label = _label(
            self.root, "", font_size=12, color=MUTED)
        self.detail_source_label.pack(padx=px + 4, anchor="w")
        self.detail_dates_label = _label(
            self.root, "", font_size=12, color=MUTED)
        self.detail_dates_label.pack(padx=px + 4, anchor="w")
        self.detail_projects_label = _label(
            self.root, "", font_size=12, color=MUTED)
        self.detail_projects_label.pack(padx=px + 4, anchor="w", pady=(0, 6))

        skill_actions = ctk.CTkFrame(self.root, fg_color="transparent")
        skill_actions.pack(fill="x", padx=px, pady=(0, 4))

        self.browse_skill_btn = _btn(
            skill_actions, "Browse Files", self.open_skill_folder, width=120)
        self.browse_skill_btn.pack(side="left", padx=(0, 6))
        self.update_btn = _btn(
            skill_actions, "Update This Skill", self.update_skill_action, width=150)
        self.update_btn.pack(side="left", padx=(0, 6))
        self.delete_btn = _btn(
            skill_actions, "Remove", self.delete_skill, width=90)
        self.delete_btn.pack(side="left")

        _sep(self.root)

        # ══════════════════════════════════════════════════
        #  SECTION 4: Deploy to Project
        # ══════════════════════════════════════════════════
        _label(self.root, "Deploy to Project", font_size=14, bold=True).pack(
            padx=px, anchor="w", pady=(0, 4))

        deploy_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        deploy_frame.pack(fill="x", padx=px, pady=(0, 4))

        self.project_entry = ctk.CTkEntry(
            deploy_frame, textvariable=tk.StringVar(value=""),
            font=ctk.CTkFont(family="SF Mono", size=12),
            fg_color=CARD, border_color=BORDER, text_color=TEXT, height=34)
        self.project_var = tk.StringVar(value=self.config.get("last_project", ""))
        self.project_entry.configure(textvariable=self.project_var)
        self.project_entry.pack(side="left", fill="x", expand=True, padx=(0, 6))

        _btn(deploy_frame, "Browse", self.browse_project, width=80).pack(
            side="left", padx=(0, 6))
        self.copy_btn = _btn(
            deploy_frame, "Copy to Project", self.copy_to_project_action,
            accent=True, width=140)
        self.copy_btn.pack(side="left")

        # Bottom utility row
        util_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        util_frame.pack(fill="x", padx=px, pady=(8, 4))
        _btn(util_frame, "Open Library Folder", self.open_library, width=160).pack(
            side="left", padx=(0, 6))
        _btn(util_frame, "Refresh List", self.refresh_library, width=110).pack(
            side="left")

        # Disable selection-dependent buttons
        for btn in (self.copy_btn, self.delete_btn, self.update_btn,
                    self.browse_skill_btn):
            btn.configure(state="disabled")

        # ══════════════════════════════════════════════════
        #  STATUS BAR
        # ══════════════════════════════════════════════════
        self.status_label = _label(
            self.root, "", font_size=12, color=MUTED)
        self.status_label.pack(fill="x", padx=px, pady=(4, 12), side="bottom")
        # Bind status_var to update the label
        self.status_var.trace_add("write", lambda *_: self.status_label.configure(
            text=self.status_var.get()))

    # ── Selection handling ──

    def _on_selection_change(self, event=None):
        """Update detail panel and enable/disable action buttons."""
        skill = self._selected_skill(quiet=True)
        if not skill:
            self.selection_label.configure(text="No skill selected")
            self.detail_desc_label.configure(text="")
            self.detail_source_label.configure(text="")
            self.detail_dates_label.configure(text="")
            self.detail_projects_label.configure(text="")
            self.copy_btn.configure(state="disabled")
            self.delete_btn.configure(state="disabled")
            self.update_btn.configure(state="disabled")
            self.browse_skill_btn.configure(state="disabled")
            return

        # Parse frontmatter for display name and description
        skill_path = LIBRARY_PATH / skill
        fm = get_skill_info(skill_path)
        display_name = fm.get("name", skill)
        self.selection_label.configure(text=display_name)

        desc = fm.get("description", "")
        self.detail_desc_label.configure(text=desc)

        self.copy_btn.configure(state="normal")
        self.delete_btn.configure(state="normal")
        self.browse_skill_btn.configure(state="normal")

        info = self.config.get("skills", {}).get(skill, {})
        url = info.get("url")
        commit = info.get("commit")

        if url:
            short = url.replace("https://", "").replace("http://", "").rstrip("/")
            if short.endswith(".git"):
                short = short[:-4]
            source = short
            if commit:
                source += f" @ {commit}"
            self.detail_source_label.configure(text=source)
            self.update_btn.configure(state="normal")
        else:
            self.detail_source_label.configure(text="Local skill — no remote URL")
            self.update_btn.configure(state="disabled")

        installed = info.get("installed_at", "")
        updated = info.get("updated_at", "")
        parts = []
        if installed:
            parts.append(f"Installed {installed[:10]}")
        if updated:
            parts.append(f"Updated {updated[:10]}")
        dates_text = "  ·  ".join(parts)

        # Skill content awareness
        skill_path = LIBRARY_PATH / skill
        type_info = detect_skill_type(skill_path)

        if type_info["is_bundle"]:
            # Show nested skill names with descriptions
            nested_parts = []
            for n, p in type_info["nested"]:
                nfm = get_skill_info(p)
                ndesc = nfm.get("description", "")
                if ndesc and len(ndesc) > 60:
                    ndesc = ndesc[:57] + "..."
                nested_parts.append(f"{n}" + (f" — {ndesc}" if ndesc else ""))
            dates_text += ("  ·  " if dates_text else "") + f"{len(type_info['nested'])} skills"
            self.detail_projects_label.configure(
                text="Contains: " + ", ".join(n for n, _ in type_info["nested"]))
        elif type_info["is_skill"]:
            self.detail_projects_label.configure(text="")
        elif type_info["content"]:
            # Has supporting content but no SKILL.md/AGENTS.md
            self.detail_projects_label.configure(text="")
        else:
            dates_text += ("  ·  " if dates_text else "") + "⚠ No skill markers found"
            self.detail_projects_label.configure(text="")

        self.detail_dates_label.configure(text=dates_text)

        # Deployment info (append to projects label if bundle info isn't there)
        projects = info.get("projects", [])
        if projects:
            names = [Path(p).name for p in projects]
            deploy_text = f"Deployed to: {', '.join(names)}"
            existing = self.detail_projects_label.cget("text")
            if existing:
                self.detail_projects_label.configure(text=f"{existing}\n{deploy_text}")
            else:
                self.detail_projects_label.configure(text=deploy_text)
        elif not self.detail_projects_label.cget("text"):
            self.detail_projects_label.configure(text="Not deployed to any project")

    # ── Library ──

    def refresh_library(self):
        reconcile_config(self.config)
        prev_skill = self._selected_skill(quiet=True)

        self.skill_listbox.delete(0, "end")
        count = 0
        reselect_idx = None
        skills = self.config.get("skills", {})

        if LIBRARY_PATH.exists():
            for item in sorted(LIBRARY_PATH.iterdir()):
                if not item.is_dir() or item.name.startswith("."):
                    continue
                name = item.name
                desc = describe_skill(item)
                detail = f"  ({desc})" if desc else ""
                type_info = detect_skill_type(item)

                info = skills.get(name, {})
                if name in self.update_available:
                    badge = "  [UPDATE]"
                elif not type_info["is_skill"] and not type_info["is_bundle"]:
                    badge = "  [resource]"
                elif not info.get("url"):
                    badge = "  [local]"
                else:
                    badge = ""

                self.skill_listbox.insert("end", f"{name}{detail}{badge}")
                if name == prev_skill:
                    reselect_idx = count
                count += 1

        self.library_count_label.configure(text=
            f"{count} skill{'s' if count != 1 else ''} in library")

        # Show/hide Update All button
        if self.update_available:
            self.update_all_btn.pack(side="right", padx=(6, 0))
        else:
            self.update_all_btn.pack_forget()

        if reselect_idx is not None:
            self.skill_listbox.selection_set(reselect_idx)
            self.skill_listbox.see(reselect_idx)
        self._on_selection_change()

    def _selected_skill(self, quiet=False) -> str | None:
        selection = self.skill_listbox.curselection()
        if not selection:
            if not quiet:
                messagebox.showwarning("No selection", "Select a skill from the list")
            return None
        text = self.skill_listbox.get(selection[0])
        return text.split("  (")[0].split("  [")[0].strip()

    def _valid_project(self) -> str | None:
        project = self.project_var.get().strip()
        if not project or not Path(project).is_dir():
            messagebox.showwarning("No project",
                                   "Choose a project directory with Browse first")
            return None
        return project

    # ── Install ──

    def download_skill(self):
        url = self.url_entry.get().strip()
        if not url or "github.com" not in url:
            messagebox.showwarning("Invalid URL", "Enter a valid GitHub URL")
            return

        name = extract_skill_name(url)
        dest = LIBRARY_PATH / name
        if dest.exists():
            if not messagebox.askyesno(
                "Re-install?",
                f"'{name}' is already in your library.\n\nDownload again and replace it?",
            ):
                return

        self.download_btn.configure(state="disabled")
        self.download_btn.configure(text="Installing...")

        def on_status(msg):
            self.root.after(0, lambda: self.status_var.set(msg))

        def on_done(repo_name, commit):
            def _finish():
                self.download_btn.configure(state="normal")
                self.download_btn.configure(text="Install from GitHub")
                now = _now_iso()
                skills = self.config.setdefault("skills", {})
                existing = skills.get(repo_name, {})
                skills[repo_name] = {
                    "url": url,
                    "commit": commit,
                    "installed_at": existing.get("installed_at", now),
                    "updated_at": now,
                    "projects": existing.get("projects", []),
                }
                self.update_available.pop(repo_name, None)
                save_config(self.config)
                self.refresh_library()

                type_info = detect_skill_type(LIBRARY_PATH / repo_name)
                if type_info["is_bundle"]:
                    names = ", ".join(n for n, _ in type_info["nested"])
                    self.status_var.set(
                        f"Installed '{repo_name}' — {len(type_info['nested'])} skills: {names}")
                else:
                    self.status_var.set(
                        f"Installed '{repo_name}' ({commit or '?'})")
            self.root.after(0, _finish)

        def on_error(title, msg):
            def _show():
                self.download_btn.configure(state="normal")
                self.download_btn.configure(text="Install from GitHub")
                self.status_var.set(f"Install failed: {title}")
                messagebox.showerror(title, msg)
            self.root.after(0, _show)

        threading.Thread(
            target=clone_skill, args=(url, on_status, on_done, on_error),
            daemon=True,
        ).start()

    # ── Deploy to project ──

    def browse_project(self):
        path = filedialog.askdirectory(
            title="Select project root",
            initialdir=self.project_var.get() or str(Path.home() / "Projects"),
        )
        if path:
            self.project_var.set(path)
            self.config["last_project"] = path
            save_config(self.config)

    def copy_to_project_action(self):
        skill_name = self._selected_skill()
        project = self._valid_project()
        if not skill_name or not project:
            return

        project_name = Path(project).name
        if copy_to_project(skill_name, project):
            skills = self.config.setdefault("skills", {})
            info = skills.setdefault(skill_name, {})
            projects = info.setdefault("projects", [])
            if project not in projects:
                projects.append(project)
            self.config["last_project"] = project
            save_config(self.config)
            self._on_selection_change()
            self.status_var.set(
                f"Deployed '{skill_name}' to {project_name}")

    # ── Check for updates (all at once) ──

    def check_for_updates(self):
        # Re-scan library first — picks up new markers, reconciles config
        reconcile_config(self.config)
        self.refresh_library()

        skills = self.config.get("skills", {})
        remote_skills = {n: i for n, i in skills.items() if i.get("url")}
        if not remote_skills:
            self.status_var.set("Library refreshed — no remote skills to check")
            return

        self.check_updates_btn.configure(state="disabled")
        self.check_updates_btn.configure(text="Checking...")
        self.update_available.clear()
        total = len(remote_skills)
        checked = {"count": 0}

        def check_one(name, info):
            remote = check_remote_sha(info["url"])
            current = info.get("commit")

            def _handle():
                checked["count"] += 1
                if remote and current and remote != current:
                    self.update_available[name] = remote

                if checked["count"] >= total:
                    self.check_updates_btn.configure(state="normal")
                    self.check_updates_btn.configure(text="Check All for Updates")
                    self.refresh_library()
                    n = len(self.update_available)
                    if n:
                        self.status_var.set(
                            f"{n} update{'s' if n != 1 else ''} available — "
                            "click Update All")
                    else:
                        self.status_var.set("All skills up to date")
                else:
                    self.status_var.set(
                        f"Checking... ({checked['count']}/{total})")
            self.root.after(0, _handle)

        for name, info in remote_skills.items():
            threading.Thread(target=check_one, args=(name, info), daemon=True).start()
        self.status_var.set(f"Checking {total} skills...")

    # ── Update single skill ──

    def update_skill_action(self):
        skill_name = self._selected_skill()
        if not skill_name:
            return

        info = self.config.get("skills", {}).get(skill_name, {})
        url = info.get("url")
        if not url:
            messagebox.showwarning(
                "No remote",
                f"'{skill_name}' is a local skill — no URL to update from.")
            return

        project_paths = info.get("projects", [])
        n = len([p for p in project_paths if Path(p).is_dir()])
        msg = f"Update '{skill_name}' from GitHub?"
        if n:
            msg += f"\n\nAlso updates copies in {n} project{'s' if n != 1 else ''}."

        if not messagebox.askyesno("Update skill?", msg):
            return

        self._run_update(skill_name, url, project_paths)

    # ── Update all skills with available updates ──

    def update_all_skills(self):
        if not self.update_available:
            self.status_var.set("No updates available")
            return

        names = sorted(self.update_available.keys())
        if not messagebox.askyesno(
            "Update all?",
            f"Update {len(names)} skill{'s' if len(names) != 1 else ''}?\n\n"
            + "\n".join(f"  - {n}" for n in names)
            + "\n\nThis also updates all project copies.",
        ):
            return

        self._update_queue = []
        for name in names:
            info = self.config.get("skills", {}).get(name, {})
            url = info.get("url")
            if url:
                self._update_queue.append((name, url, info.get("projects", [])))
        self._update_total = len(self._update_queue)
        self._update_done_count = 0
        self.update_all_btn.configure(state="disabled")
        self.update_all_btn.configure(text="Updating...")
        self._run_next_update()

    def _run_next_update(self):
        if not self._update_queue:
            self.update_all_btn.configure(state="normal")
            self.update_all_btn.configure(text="Update All")
            self.refresh_library()
            self.status_var.set(
                f"Updated {self._update_total} skills")
            return

        name, url, project_paths = self._update_queue.pop(0)
        self._update_done_count += 1
        self.status_var.set(
            f"Updating {name}... ({self._update_done_count}/{self._update_total})")

        def on_status(msg):
            self.root.after(0, lambda: self.status_var.set(msg))

        def on_done(n, commit, updated_projects):
            def _finish():
                now = _now_iso()
                skills = self.config.setdefault("skills", {})
                info = skills.setdefault(n, {})
                info["commit"] = commit
                info["updated_at"] = now
                save_config(self.config)
                self.update_available.pop(n, None)
                self._run_next_update()
            self.root.after(0, _finish)

        def on_error(title, msg):
            def _show():
                self.status_var.set(f"Failed to update {name}, continuing...")
                self._run_next_update()
            self.root.after(0, _show)

        threading.Thread(
            target=update_skill,
            args=(name, url, project_paths, on_status, on_done, on_error),
            daemon=True,
        ).start()

    def _run_update(self, skill_name, url, project_paths):
        """Run a single skill update (used by Update This Skill button)."""
        self.update_btn.configure(state="disabled")
        self.update_btn.configure(text="Updating...")

        def on_status(msg):
            self.root.after(0, lambda: self.status_var.set(msg))

        def on_done(name, commit, updated_projects):
            def _finish():
                self.update_btn.configure(state="normal")
                self.update_btn.configure(text="Update This Skill")
                now = _now_iso()
                skills = self.config.setdefault("skills", {})
                info = skills.setdefault(name, {})
                info["commit"] = commit
                info["updated_at"] = now
                save_config(self.config)
                self.update_available.pop(name, None)
                self.refresh_library()
                parts = [f"Updated '{name}'"]
                if commit:
                    parts[0] += f" to {commit}"
                if updated_projects:
                    names = [Path(p).name for p in updated_projects]
                    parts.append(f"+ {', '.join(names)}")
                self.status_var.set(" ".join(parts))
            self.root.after(0, _finish)

        def on_error(title, msg):
            def _show():
                self.update_btn.configure(state="normal")
                self.update_btn.configure(text="Update This Skill")
                self.status_var.set(f"Update failed: {title}")
                messagebox.showerror(title, msg)
            self.root.after(0, _show)

        threading.Thread(
            target=update_skill,
            args=(skill_name, url, project_paths, on_status, on_done, on_error),
            daemon=True,
        ).start()

    # ── Delete ──

    def delete_skill(self):
        skill_name = self._selected_skill()
        if not skill_name:
            return

        info = self.config.get("skills", {}).get(skill_name, {})
        projects = info.get("projects", [])
        msg = f"Remove '{skill_name}' from your library?"
        if projects:
            names = [Path(p).name for p in projects if Path(p).is_dir()]
            if names:
                msg += f"\n\nCopies in {', '.join(names)} will NOT be removed."

        if messagebox.askyesno("Remove skill?", msg):
            dest = LIBRARY_PATH / skill_name
            try:
                if dest.exists():
                    shutil.rmtree(dest)
            except OSError as e:
                messagebox.showerror("Remove failed",
                                     f"Could not remove '{skill_name}':\n{e}")
                return
            self.config.get("skills", {}).pop(skill_name, None)
            self.update_available.pop(skill_name, None)
            save_config(self.config)
            self.refresh_library()
            self.status_var.set(f"Removed '{skill_name}'")

    # ── Finder ──

    def open_skill_folder(self):
        skill_name = self._selected_skill(quiet=True)
        if not skill_name:
            return
        path = LIBRARY_PATH / skill_name
        if path.is_dir():
            subprocess.Popen(["open", str(path)])

    def open_library(self):
        LIBRARY_PATH.mkdir(parents=True, exist_ok=True)
        subprocess.Popen(["open", str(LIBRARY_PATH)])

    # ── Export / Import ──

    def export_skill_list(self):
        path = filedialog.asksaveasfilename(
            title="Export skill list",
            defaultextension=".md",
            filetypes=[("Markdown", "*.md"), ("All files", "*.*")],
            initialfile="my-claude-skills.md",
            initialdir=str(Path.home() / "Desktop"),
        )
        if not path:
            return
        md = export_skill_list(self.config)
        try:
            with open(path, "w") as f:
                f.write(md)
            self.root.clipboard_clear()
            self.root.clipboard_append(md)
            self.status_var.set(
                f"Exported to {Path(path).name} (copied to clipboard)")
        except OSError as e:
            messagebox.showerror("Export failed", str(e))

    def import_skill_list(self):
        path = filedialog.askopenfilename(
            title="Import skill list",
            filetypes=[("Markdown", "*.md"), ("All files", "*.*")],
            initialdir=str(Path.home() / "Desktop"),
        )
        if not path:
            return
        try:
            with open(path) as f:
                text = f.read()
        except OSError as e:
            messagebox.showerror("Import failed", str(e))
            return

        entries = parse_skill_list(text)
        if not entries:
            messagebox.showinfo("Nothing to import",
                                "No skill links found in that file.\n\n"
                                "Expected: - [skill-name](https://github.com/...)")
            return

        existing = set(self.config.get("skills", {}).keys())
        new_entries = [e for e in entries if e["name"] not in existing]

        if not new_entries:
            messagebox.showinfo("All installed",
                                f"All {len(entries)} skills are already in your library.")
            return

        if not messagebox.askyesno(
            "Import skills?",
            f"Install {len(new_entries)} new skill{'s' if len(new_entries) != 1 else ''}?\n\n"
            + "\n".join(f"  - {e['name']}" for e in new_entries),
        ):
            return

        self._import_queue = list(new_entries)
        self._import_total = len(new_entries)
        self._install_next_import()

    def _install_next_import(self):
        if not self._import_queue:
            self.refresh_library()
            self.status_var.set(f"Imported {self._import_total} skills")
            return

        entry = self._import_queue.pop(0)
        remaining = len(self._import_queue)
        self.status_var.set(
            f"Installing {entry['name']}... "
            f"({self._import_total - remaining}/{self._import_total})")

        def on_status(msg):
            self.root.after(0, lambda: self.status_var.set(msg))

        def on_done(repo_name, commit):
            def _finish():
                now = _now_iso()
                skills = self.config.setdefault("skills", {})
                skills[repo_name] = {
                    "url": entry["url"], "commit": commit,
                    "installed_at": now, "updated_at": now, "projects": [],
                }
                save_config(self.config)
                self._install_next_import()
            self.root.after(0, _finish)

        def on_error(title, msg):
            self.root.after(0, lambda: (
                self.status_var.set(f"Skipped {entry['name']}: {title}"),
                self._install_next_import(),
            ))

        threading.Thread(
            target=clone_skill,
            args=(entry["url"], on_status, on_done, on_error),
            daemon=True,
        ).start()


if __name__ == "__main__":
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    root = ctk.CTk()
    app = SkillManagerApp(root)
    root.mainloop()
