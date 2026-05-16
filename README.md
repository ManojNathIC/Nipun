# Nipun Chrome Extension

Nipun is an AI-powered text improvement and code review assistant for developers using Google Gemini.

## Features

- **✏️ Smart Writer**: Improve PR descriptions, emails, and documentation directly from any text area.
- **🔍 PR Reviewer**: Automated AI reviews for GitHub Pull Requests with multi-batch support.
- **🚀 Incremental Reviews**: Tracks previous reviews and only flags new issues or verifies fixes.
- **📊 PostHog Integration**: Persistent review history and comparisons.

---

## Getting API Keys

### Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API key"
4. Copy the generated key

### GitHub Token (optional — only needed for private repos or posting PR comments)

1. Go to [GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens/new)
2. Give it a name (e.g. `nipun`)
3. Select scopes:
   - `public_repo` — for public repos only
   - `repo` — if you need access to private repos
4. Click "Generate token" and copy it immediately (it won't be shown again)

---

## Setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Fill in your `.env`:

   ```
   GEMINI_API_KEY=your_gemini_key
   GITHUB_TOKEN=your_github_token

   MIN_SEVERITY_TO_BLOCK=medium
   POST_REVIEW_COMMENT=true
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

---

## 🔍 Behavioral Insights & Incremental Reviews

Nipun is designed to be a continuous partner in your development lifecycle. Unlike standard AI reviewers that start from scratch every time, Nipun provides:

- **Verification of Fixes**: When you push a fix for an issue flagged in a previous review, Nipun specifically checks the new code to confirm the fix is correct and hasn't introduced regressions.
- **Still-Open Tracking**: If a previous issue remains unaddressed in the latest commit, Nipun keeps it visible as "STILL OPEN" instead of letting it drop off the radar.
- **Strict Isolation**: By comparing your current HEAD against the last reviewed commit, Nipun ensures it only comments on your *new* changes, preventing it from "hallucinating" or re-flagging issues in untouched parts of the codebase.

## 📊 PostHog Integration

Nipun uses PostHog to maintain a persistent memory of your Pull Requests. This allows the extension to retrieve previous review findings even across different sessions or browser restarts.

### Why PostHog?
- **Persistence**: Store and retrieve review metadata securely.
- **Comparison**: Enables the "Incremental Review" mode by comparing the current PR state with the last known review stored in PostHog.

### Setup PostHog
To enable these features, you'll need a PostHog project:
1. Create a project at [PostHog.com](https://posthog.com).
2. Get your **Project API Key** from Settings.
3. Get your **Personal API Key** (for data retrieval) from your User Settings.
4. Get your **Project ID** from the URL when viewing your project.

## 💾 Data Storage

Nipun uses a dual-storage strategy to ensure speed and persistence:

- **Chrome Local Storage**: Used for **instant UI updates** and **user preferences**. It stores your current review config, UI theme settings, and a temporary cache of the latest review so it loads immediately when you open the sidepanel.
- **PostHog**: Used for **long-term persistence** and **incremental comparisons**. It stores the history of your PR reviews (text and commit SHAs), allowing Nipun to perform "Incremental Reviews" even if you clear your browser cache or switch machines.

---

## Configuration

All configuration lives in `.env`. Run `npm run build` after any change.

| Variable                   | Status    | Default  | Description                                                                                                                                                                            |
| -------------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`           | Mandatory | —        | Google Gemini API key (Required for all AI reviews).                                                                                                                                   |
| `GITHUB_TOKEN`             | Optional  | —        | GitHub personal access token (Required for private repos and posting PR comments).                                                                                                     |
| `POSTHOG_API_KEY`          | Mandatory | —        | Your PostHog Project API Key (Required for persistence and history).                                                                                                                   |
| `POSTHOG_PERSONAL_API_KEY` | Mandatory | —        | Your PostHog Personal API Key (Required for history retrieval).                                                                                                                        |
| `POSTHOG_PROJECT_ID`       | Mandatory | —        | Your PostHog Project ID.                                                                                                                                                               |
| `MIN_SEVERITY_TO_BLOCK`    | Optional  | `medium` | Minimum severity included in the PR comment posted to GitHub. Options: `critical`, `major`, `medium`, `minor`, `suggestion`.                                                           |
| `POST_REVIEW_COMMENT`      | Optional  | `true`   | Whether to auto-post the review summary as a PR comment.                                                                                                                               |
| `AI_DISPLAY_NAME`          | Optional  | `Nipun`  | The persona name used in PR comment headers and signatures.                                                                                                                            |
| `POSTHOG_HOST`             | Optional  | `...`    | Your PostHog host (usually `https://us.i.posthog.com` or `https://eu.i.posthog.com`).                                                                                                  |

---

## Review Config

The review prompt and checklist are defined in `review-config.json`. This file is committed to the repo and acts as the default for all reviews.

To customise for your project, either:

- Edit `review-config.json` directly before building, or
- Paste a custom config JSON in the sidepanel "⚙ Review Config" section at runtime (saved to local storage, overrides the bundled default)

---

## Development

- Source files are in the root directory
- `dist/` is the built output — load this folder as the unpacked extension
- Run `npm run build` after any changes to source files or `.env`
- Never commit `.env` or `dist/` to git

## Security

- `.env` is gitignored — never commit it
- Only commit `.env.example` as a template
- `dist/` contains built files with injected secrets — also gitignored
