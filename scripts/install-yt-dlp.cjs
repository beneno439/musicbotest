const fs = require("node:fs");
const path = require("node:path");

const fileName =
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp_linux";
const filePath = path.join(process.cwd(), "bin", fileName);

if (process.env.YT_DLP_PATH) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(filePath), { recursive: true });
const downloadUrl =
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`;

fetch(downloadUrl)
  .then((response) => {
    if (!response.ok || !response.body) {
      throw new Error(`yt-dlp download failed with HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  })
  .then((data) => {
    fs.writeFileSync(filePath, Buffer.from(data));
    if (process.platform !== "win32") {
      fs.chmodSync(filePath, 0o755);
    }
    console.log(`yt-dlp standalone binary installed at ${filePath}`);
  })
  .catch((error) => {
    console.error("Failed to install yt-dlp:", error);
    process.exitCode = 1;
  });
