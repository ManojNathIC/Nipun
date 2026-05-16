// Nipun - GitHub API Helper

var GITHUB_TOKEN = "";

/**
 * Parses a GitHub PR URL into its parts.
 * Supports: https://github.com/owner/repo/pull/123
 * @param {string} url
 * @returns {{ owner: string, repo: string, number: string } | null}
 */
function parsePRUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: match[3] };
}

/**
 * Fetches all changed files for a PR from the GitHub API.
 * Handles pagination automatically (up to 300 files).
 * @param {string} owner
 * @param {string} repo
 * @param {string} prNumber
 * @param {string} token - GitHub personal access token (optional for public repos)
 * @returns {Promise<Array<{ filename: string, patch: string, status: string }>>}
 */
async function fetchPRFiles(owner, repo, prNumber) {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;

  let files = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `GitHub API error: ${res.status}`);
    }

    const batch = await res.json();
    files = files.concat(batch);

    // Stop if last page
    if (batch.length < 100) break;
    // Cap at 300 files to stay within Gemini token limits
    if (files.length >= 300) break;
    page++;
  }

  return files;
}

/**
 * Fetches the PR metadata (title, body) from GitHub API.
 * @param {string} owner
 * @param {string} repo
 * @param {string} prNumber
 * @param {string} token
 * @returns {Promise<{ title: string, body: string }>}
 */
async function fetchPRMeta(owner, repo, prNumber) {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    { headers },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    title: data.title || "",
    body: data.body || "",
    author: data.user?.login || "unknown",
    headSha: data.head?.sha || "",
  };
}

/**
 * Converts the GitHub files array into a readable diff string for Gemini.
 * Skips binary files and files without patches (e.g. renamed with no changes).
 * @param {Array} files
 * @returns {string}
 */
function buildDiffText(files) {
  return files
    .filter((f) => f.patch) // skip binary / no-diff files
    .map((f) => `### ${f.status.toUpperCase()}: ${f.filename}\n${f.patch}`)
    .join("\n\n");
}

/**
 * Splits files into chunks so each chunk fits within Gemini's context.
 * Targets ~60 000 chars per chunk (safe for 1M token models).
 * @param {Array} files
 * @returns {Array<Array>} - array of file-batches
 */
function chunkFiles(files, maxChars = 60000) {
  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const file of files) {
    const size = (file.patch || "").length + file.filename.length;
    if (currentSize + size > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Posts a comment to a GitHub PR.
 * @param {string} owner
 * @param {string} repo
 * @param {string} prNumber
 * @param {string} body - The markdown body of the comment.
 * @returns {Promise<any>}
 */
async function postPRComment(owner, repo, prNumber, body) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  return await res.json();
}

/**
 * Fetches the diff between two commits/branches.
 * Used for incremental reviews.
 * @param {string} owner
 * @param {string} repo
 * @param {string} base
 * @param {string} head
 * @returns {Promise<Array<{ filename: string, patch: string, status: string }>>}
 */
async function fetchCommitRangeDiff(owner, repo, base, head) {
  const headers = { Accept: "application/vnd.github+json" };
  if (typeof GITHUB_TOKEN !== "undefined" && GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `GitHub Compare API error: ${res.status}`);
  }

  const data = await res.json();
  // 'files' in comparison response contains the changed files since the base commit
  return data.files || [];
}
