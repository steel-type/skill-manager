# Claude Skill Manager

A small macOS desktop app for managing [Claude](https://claude.ai) skills — those `SKILL.md` / `AGENTS.md` folders that Claude Code, Cowork, and the Claude Agent SDK pull in.

It gives you a real GUI for the things you'd otherwise do by hand:

- **Install** a skill from any GitHub URL (shallow `git clone`, captures commit SHA).
- **Track** every skill's source URL, install/update timestamps, and which projects you've copied it to.
- **Check for updates** across your whole library in parallel (`git ls-remote`).
- **Update** a skill — and cascade that update into every project where it's deployed.
- **Deploy** a library skill into any project's `.claude/skills/` directory.
- **Export / Import** your whole library as a markdown bullet list, so you can share your skill set with someone else (or your future self).
- Detects bundles (repos containing multiple `SKILL.md` files) and shows what's inside.

Library lives at `~/.claude/skills/`. Config lives at `~/.claude/skill-manager.json`.

## Requirements

- macOS (uses Tk + the system `open` command for Finder integration; Linux probably works for the GUI parts)
- Python 3.10+
- `git` on your PATH

## Install & run

```bash
git clone https://github.com/YOUR-USERNAME/skill-manager.git
cd skill-manager
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 skill-manager.py
```

That's it. A window should open.

## Optional: clickable macOS app

If you want to launch it from Finder/Dock instead of the terminal:

```bash
./build_app.sh
```

This produces `skill-manager.app` in the current folder. Drag it to `/Applications` or anywhere you want.

## How to use it

1. Paste a GitHub URL (e.g. `https://github.com/anthropic/anthropic-skills`) and click **Install from GitHub**.
2. Pick a project folder with **Browse**, select a skill in the list, hit **Copy to Project** — it lands in `<project>/.claude/skills/<skill-name>/`.
3. Click **Check All for Updates** whenever; if anything's behind, you'll see `[UPDATE]` badges and an **Update All** button. Updates cascade to every project copy automatically.
4. **Export** to share your whole library with someone else as a markdown file. They use **Import** on their end to bulk-install everything.

## License

MIT — see `LICENSE`.
