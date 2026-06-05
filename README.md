# MP3 Auto Tag

![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Language](https://img.shields.io/badge/language-Typescript-blue)
![License](https://img.shields.io/badge/license-MIT-purple)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)

A Node/TypeScript tool that scans folders, detects MP3 files without covers, extracts ID3 information, fetches the correct artwork using a robust pipeline (**MusicBrainz → iTunes → DuckDuckGo**), and embeds it directly into the file. It also attempts to fetch missing metadata (Artist, Album, Title) from the web based on the filename if the ID3 tags are empty.

### Features

- **Recursive Directory Scanning**: Finds all MP3s within a target folder.
- **Metadata Reconstruction**: Parses filenames (e.g., `Artist - Title`) and searches for missing tags.
- **Multi-Service Pipeline**:
  - **Metadata**: MusicBrainz (Primary) → iTunes (Fallback)
  - **Covers**: MusicBrainz/CoverArtArchive → iTunes (High-quality 600x600 artwork) → DuckDuckGo (Final fallback)
- **ID3 Management**: Full support for reading/writing ID3v2 tags.
- **Local Cover Cache**: Saves downloaded images locally to speed up subsequent runs.
- **Audio Fingerprinting**: Integration with **ACRCloud** to identify music by listening to audio snippets, with automatic fallback to **AcoustID** (Chromaprint) when ACRCloud hits its limit.
- **Duplicate Detection**: Fast standalone duplicate scan based on local metadata, with three action modes: log, delete, or move.
- **Smart File Renaming**: Automatically renames files to a normalized `Title - Artist` format with collision handling.
- **Concurrency**: Processes up to **3 files simultaneously** by default using `p-queue`. Configurable via `--concurrency`.
- **Professional Build**: Clean TypeScript architecture with compilation to `/dist`.

---

## 🚀 Installation

```bash
git clone <your-repo-url>
cd mp3-auto-cover
npm install
```

---

## 🔧 Available Scripts

### **Development (with hot reload)**

```bash
npm run dev
```

### **Build to `/dist`**

```bash
npm run build
```

### **Run compiled version**

```bash
npm start
```

This executes: `node dist/index.js`

---

## ▶️ Usage

### **Scan a full directory (recursive)**

```bash
node dist/index.js ./my/music/folder
```

If no parameter is provided, it defaults to `./music`.

### **Advanced features (Parameters)**

The tool supports several flags to customize its behavior:

| Flag             | Alias        | Description                                                                                                                                                                                                       |
| :--------------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--recognize`    | `-recognize` | **Audio Recognition**: Uses [ACRCloud](https://www.acrcloud.com/) to identify music by listening to a 12s snippet. If ACRCloud fails or hits its rate limit, automatically falls back to **AcoustID** (Chromaprint fingerprinting). |
| `--force`        | `-force`     | **Force Mode**: Re-processes files even if they already have embedded cover art. Useful for replacing low-quality covers.                                                                                         |
| `--rename`       | `-rename`    | **Auto Rename**: Renames the file to `Title - Artist.mp3` after resolving metadata. Cleans illegal characters.                                                                                                    |
| `--concurrency <num>` | `-concurrency <num>` | **Concurrency**: Number of files to process simultaneously. Defaults to `3`. Increase to `4` or `5` on fast networks for a speed boost. |
| `--dedup-standalone-log`    | `-dedup-standalone-log` | **Standalone Dedup (Log)**: Fast standalone pass that only checks for duplicate tracks based on local ID3 metadata. Skips all cover/metadata fetching. Logs duplicates to `duplicates.txt`. |
| `--dedup-standalone-delete` | `-dedup-standalone-delete` | **Standalone Dedup (Delete)**: Same fast standalone pass, but permanently **deletes** duplicate files. The first copy encountered is always kept. Logs deletions to `duplicates.txt`. Use with caution. |
| `--dedup-standalone-move`   | `-dedup-standalone-move` | **Standalone Dedup (Move)**: Same fast standalone pass, but **moves** duplicates into a `duplicates/` subfolder inside your target directory instead of deleting them. When duplicate filenames differ only by a trailing number like `(1)`, the unnumbered filename is kept in the main folder. Logs moves to `duplicates.txt`. |

---

## ▶️ Examples

**1. Recognize music using audio fingerprinting (ACRCloud → AcoustID fallback):**

```bash
# Using the npm dev script
npm run dev -- --recognize ./my/songs

# Or with the compiled build
node dist/index.js --recognize ./my/songs
```

> **Note:** ACRCloud requires `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET`, and optionally `ACRCLOUD_HOST` in your environment. AcoustID fallback requires `ACOUSTID_API_KEY` in your environment and uses the bundled `bin/fpcalc.exe` to generate fingerprints.

**2. Force update covers for all files:**

```bash
node dist/index.js --force ./my/songs
```

**3. Recognize and Force combined:**

```bash
node dist/index.js --recognize --force ./my/songs
```

This will fingerprint every song, find accurate metadata, and embed a fresh cover for every file, even if they already have one.

**4. Process 5 files at once for maximum speed:**

```bash
node dist/index.js --concurrency 5 ./my/songs
```

**5. Find and log duplicates without touching any files:**

```bash
node dist/index.js --dedup-standalone-log ./my/songs
```

**6. Move all duplicates to a `duplicates/` folder for manual review:**

```bash
node dist/index.js --dedup-standalone-move ./my/songs
```

**7. Permanently delete duplicates (keeps the first copy of each track):**

```bash
node dist/index.js --dedup-standalone-delete ./my/songs
```

---

## 📁 Project Structure

```
mp3-auto-cover/
│
├── bin/
│   └── fpcalc.exe        # Bundled Chromaprint binary for AcoustID fingerprinting
│
├── config/
│   ├── defaults.ts
│   └── sources.ts
│
├── src/
│   ├── scanner/          # File system scanning and cache
│   ├── metadata/         # ID3 reading/writing, ACRCloud, AcoustID
│   ├── cover/            # MusicBrainz, iTunes, and DDG services
│   ├── utils/            # Logger and filename parser
│   └── types/            # Custom TypeScript declaration files
│
├── cache/                # Local image storage
├── dist/                 # Compiled JavaScript
├── duplicates.txt        # Log of all duplicate detection actions (auto-created)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧠 How it Works

### 1. **Scanning**

Searches for `.mp3` files in the target directory recursively.

### 2. **Duplicate Detection (Standalone)**

When using any `--dedup-standalone-*` flag, the tool runs a fast metadata-only scan first:
- Reads local ID3 tags (Artist + Title) from every file.
- Identifies duplicates by comparing `artist - title` keys (case-insensitive).
- The **first** copy of every track is always kept safe.
- Subsequent copies are either **logged**, **deleted**, or **moved** to a `duplicates/` folder, depending on the flag used.
- In move mode, if one duplicate filename ends with a number like `(1)`, `(2)`, etc. and another does not, the unnumbered filename remains in the main folder.
- All actions are appended to `duplicates.txt` in the current working directory.

### 3. **Metadata Recovery**

If the file is missing Artist or Album tags, the tool parses the filename and searches MusicBrainz/iTunes to reconstruct the missing information.

### 4. **Audio Recognition Pipeline (with `--recognize`)**

1. **ACRCloud**: Extracts a 12-second audio snippet via `ffmpeg` and sends it to ACRCloud for identification.
2. **AcoustID** *(automatic fallback)*: If ACRCloud fails or hits its rate limit, the tool uses the bundled `fpcalc.exe` (Chromaprint) to generate a local audio fingerprint and queries the free AcoustID API using `ACOUSTID_API_KEY`.
3. **Filename Parsing** *(final fallback)*: If both audio recognition services fail, the tool falls back to parsing the filename and searching MusicBrainz/iTunes by text.

### 5. **Cover Resolution Pipeline**

1.  **MusicBrainz/CoverArtArchive**: Searches for original releases.
2.  **iTunes**: Fetches official, high-quality artwork (600x600).
3.  **DuckDuckGo**: Fallback image search for rare or non-commercial tracks.

### 6. **Local Cache**

Each image is hashed and stored in `/cache/covers` to prevent redundant downloads.

### 7. **ID3 Embedding**

The normalized image is embedded into the MP3 file as the official front cover.

### 8. **Smart Renaming (Optional)**

If `--rename` is used, the file is renamed to `Title - Artist.mp3`. If a file with that name already exists, the tool appends a counter (e.g., `(1)`, `(2)`) to avoid overwrites.

---

## ⚡ Concurrency

The tool uses `p-queue` to process files in parallel. The default is **3 concurrent tasks**, which balances speed and API rate limits. You can customize this with `--concurrency <num>`.

```bash
# Run 5 files at once
node dist/index.js --concurrency 5 ./my/songs
```

---

## 🔑 Environment Variables

| Variable               | Required | Description                                                   |
| :--------------------- | :------- | :------------------------------------------------------------ |
| `ACRCLOUD_ACCESS_KEY`  | For `--recognize` | Your ACRCloud project access key.                  |
| `ACRCLOUD_ACCESS_SECRET` | For `--recognize` | Your ACRCloud project access secret.             |
| `ACRCLOUD_HOST`        | Optional | ACRCloud endpoint. Defaults to `identify-us-west-2.acrcloud.com`. |
| `ACOUSTID_API_KEY`     | For `--recognize` | Your AcoustID application API key. Get one for free at [acoustid.org/new-application](https://acoustid.org/new-application). Used as a fallback when ACRCloud fails. |

> **Tip:** You can set these in a `.env` file or export them in your shell before running the tool.

---

## 📝 License

MIT — use it, modify it, improve it.
