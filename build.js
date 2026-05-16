// Build script: reads .env and injects secrets into source files → dist/
const fs = require("fs");
const path = require("path");

// Parse .env file
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    console.error(
      "❌ .env file not found. Copy .env.example to .env and fill in your keys.",
    );
    process.exit(1);
  }

  const env = {};
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const [key, ...rest] = trimmed.split("=");
      // Strip inline comments (anything after unquoted ' #' or ' //')
      const raw = rest.join("=").trim();
      env[key.trim()] = raw
        .replace(/\s+#.*$/, "")
        .replace(/\s+\/\/.*$/, "")
        .trim();
    });
  return env;
}

const env = loadEnv(path.join(__dirname, ".env"));

const GEMINI_API_KEY = env.GEMINI_API_KEY || "";
const GITHUB_TOKEN = env.GITHUB_TOKEN || "";
const MIN_SEVERITY_TO_BLOCK = env.MIN_SEVERITY_TO_BLOCK || "medium";
const POST_REVIEW_COMMENT = env.POST_REVIEW_COMMENT !== "false";
const POSTHOG_API_KEY = env.POSTHOG_API_KEY || "";
const POSTHOG_PERSONAL_API_KEY = env.POSTHOG_PERSONAL_API_KEY || "";
const POSTHOG_PROJECT_ID = env.POSTHOG_PROJECT_ID || "";
const POSTHOG_HOST = env.POSTHOG_HOST || "https://us.i.posthog.com";
const AI_DISPLAY_NAME = env.AI_DISPLAY_NAME || "Nipun AI";

if (!GEMINI_API_KEY) console.warn("⚠️  GEMINI_API_KEY is not set.");
if (!GITHUB_TOKEN)
  console.warn("⚠️  GITHUB_TOKEN is not set (optional for public repos).");
if (!POSTHOG_API_KEY)
  console.warn(
    "⚠️  POSTHOG_API_KEY is not set (previous review comparison will be disabled).",
  );
if (!POSTHOG_PERSONAL_API_KEY)
  console.warn(
    "⚠️  POSTHOG_PERSONAL_API_KEY is not set (previous review fetch will be disabled).",
  );
if (!POSTHOG_PROJECT_ID)
  console.warn(
    "⚠️  POSTHOG_PROJECT_ID is not set (previous review fetch will be disabled).",
  );

const VALID_SEVERITIES = ["critical", "major", "medium", "minor", "suggestion"];
if (!VALID_SEVERITIES.includes(MIN_SEVERITY_TO_BLOCK)) {
  console.warn(
    `⚠️  Invalid MIN_SEVERITY_TO_BLOCK "${MIN_SEVERITY_TO_BLOCK}". Defaulting to "medium".`,
  );
}

// Files to copy into dist/ (all extension files)
const FILES_TO_COPY = [
  { src: "src/services/api.js", dest: "dist/api.js" },
  { src: "src/scripts/background.js", dest: "dist/background.js" },
  { src: "src/services/github-api.js", dest: "dist/github-api.js" },
  { src: "src/scripts/github-review.js", dest: "dist/github-review.js" },
  { src: "src/services/posthog.js", dest: "dist/posthog.js" },
  { src: "src/ui/popup/popup.js", dest: "dist/popup.js" },
  { src: "src/ui/sidepanel/sidepanel.js", dest: "dist/sidepanel.js" },
  { src: "src/scripts/content.js", dest: "dist/content.js" },
  { src: "src/ui/popup/popup.html", dest: "dist/popup.html" },
  { src: "src/ui/sidepanel/sidepanel.html", dest: "dist/sidepanel.html" },
  { src: "src/ui/popup/popup.css", dest: "dist/popup.css" },
  { src: "src/ui/sidepanel/sidepanel.css", dest: "dist/sidepanel.css" },
  { src: "src/scripts/github-review.css", dest: "dist/github-review.css" },
  { src: "src/scripts/widget.css", dest: "dist/widget.css" },
  { src: "src/manifest.json", dest: "dist/manifest.json" },
  { src: "src/review-config.json", dest: "dist/review-config.json" },
  { src: "src/assets/icon.png", dest: "dist/icon.png" },
];

// Replacements to apply in JS files
const REPLACEMENTS = [
  {
    pattern: /const GEMINI_API_KEY\s*=\s*"[^"]*"/g,
    replacement: `const GEMINI_API_KEY = "${GEMINI_API_KEY}"`,
  },
  {
    pattern: /var GITHUB_TOKEN\s*=\s*"[^"]*"/g,
    replacement: `var GITHUB_TOKEN = "${GITHUB_TOKEN}"`,
  },
  {
    pattern: /const MIN_SEVERITY_TO_BLOCK\s*=\s*"[^"]*"/g,
    replacement: `const MIN_SEVERITY_TO_BLOCK = "${MIN_SEVERITY_TO_BLOCK}"`,
  },
  {
    pattern: /const POST_REVIEW_COMMENT\s*=\s*(true|false)/g,
    replacement: `const POST_REVIEW_COMMENT = ${POST_REVIEW_COMMENT}`,
  },
  {
    pattern: /var POSTHOG_API_KEY\s*=\s*"[^"]*"/g,
    replacement: `var POSTHOG_API_KEY = "${POSTHOG_API_KEY}"`,
  },
  {
    pattern: /var POSTHOG_PERSONAL_API_KEY\s*=\s*"[^"]*"/g,
    replacement: `var POSTHOG_PERSONAL_API_KEY = "${POSTHOG_PERSONAL_API_KEY}"`,
  },
  {
    pattern: /var POSTHOG_PROJECT_ID\s*=\s*"[^"]*"/g,
    replacement: `var POSTHOG_PROJECT_ID = "${POSTHOG_PROJECT_ID}"`,
  },
  {
    pattern: /var POSTHOG_HOST\s*=\s*"[^"]*"/g,
    replacement: `var POSTHOG_HOST = "${POSTHOG_HOST}"`,
  },
  {
    pattern: /const AI_DISPLAY_NAME\s*=\s*"[^"]*"/g,
    replacement: `const AI_DISPLAY_NAME = "${AI_DISPLAY_NAME}"`,
  },
];

// Ensure dist/ exists
const distDir = path.join(__dirname, "dist");
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

// Process and copy each file
FILES_TO_COPY.forEach((file) => {
  const src = path.join(__dirname, file.src);
  const dest = path.join(__dirname, file.dest);

  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Skipping missing file: ${file.src}`);
    return;
  }

  // Only apply replacements to JS files
  if (file.src.endsWith(".js")) {
    let content = fs.readFileSync(src, "utf8");
    REPLACEMENTS.forEach(({ pattern, replacement }) => {
      content = content.replace(pattern, replacement);
    });
    fs.writeFileSync(dest, content, "utf8");
  } else {
    fs.copyFileSync(src, dest);
  }

  console.log(`✅ ${file.src} → ${file.dest}`);
});

console.log(
  "\n🎉 Build complete. Load the 'dist/' folder as your unpacked extension.",
);
