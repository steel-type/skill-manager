// Two post-pack passes on the .app:
//   1. Strip non-en locales from the bundled Electron Framework
//      (electron-builder's `electronLanguages` only touches the top-level
//      Resources/*.lproj — the framework's own copies are missed).
//   2. Ad-hoc codesign the .app so macOS Sequoia+ doesn't flag it as
//      "damaged" on first open. This is NOT real code-signing — it's
//      `codesign -s -` (empty identity), which produces a self-signed
//      bundle that satisfies Gatekeeper enough to surface the normal
//      "Open Anyway" button in System Settings instead of a dead-end
//      "damaged" dialog. Real notarization still requires a paid
//      Developer ID; this is the free midpoint.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const KEEP = new Set(["en.lproj", "en_GB.lproj"]);

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // 1) Locale strip
  const frameworkResources = path.join(
    appPath,
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
  );
  if (fs.existsSync(frameworkResources)) {
    let removed = 0;
    for (const entry of fs.readdirSync(frameworkResources)) {
      if (!entry.endsWith(".lproj") || KEEP.has(entry)) continue;
      fs.rmSync(path.join(frameworkResources, entry), { recursive: true, force: true });
      removed++;
    }
    console.log(`afterPack: removed ${removed} locale folders from Electron Framework`);
  }

  // 2) Ad-hoc codesign (macOS only)
  if (process.platform !== "darwin" || !fs.existsSync(appPath)) return;
  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
      { stdio: "inherit" },
    );
    console.log(`afterPack: ad-hoc codesigned ${appName}.app`);
  } catch (err) {
    console.warn(`afterPack: codesign failed (${err.message}) — DMG will still build but may trigger 'damaged' on Sequoia+`);
  }
};
