// Strip non-en locales from the bundled Electron Framework. electron-builder's
// `electronLanguages` option only handles the top-level Resources/*.lproj
// folders — the framework's own copies under
// Frameworks/Electron Framework.framework/Versions/A/Resources/ are not touched
// by that option, so we delete them here.
const fs = require("fs");
const path = require("path");

const KEEP = new Set(["en.lproj", "en_GB.lproj"]);

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const frameworkResources = path.join(
    context.appOutDir,
    `${appName}.app`,
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
  );
  if (!fs.existsSync(frameworkResources)) return;
  let removed = 0;
  for (const entry of fs.readdirSync(frameworkResources)) {
    if (!entry.endsWith(".lproj") || KEEP.has(entry)) continue;
    fs.rmSync(path.join(frameworkResources, entry), { recursive: true, force: true });
    removed++;
  }
  console.log(`afterPack: removed ${removed} locale folders from Electron Framework`);
};
