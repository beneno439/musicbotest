const fs = require("node:fs");
const path = require("node:path");
const YTDlpWrap = require("yt-dlp-wrap").default;

const fileName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const filePath = path.join(process.cwd(), "bin", fileName);

if (process.env.YT_DLP_PATH || fs.existsSync(filePath)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(filePath), { recursive: true });
YTDlpWrap.downloadFromGithub(filePath, undefined, process.platform)
  .then(() => console.log(`yt-dlp installed at ${filePath}`))
  .catch((error) => {
    console.error("Failed to install yt-dlp:", error);
    process.exitCode = 1;
  });
