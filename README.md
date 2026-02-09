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
- **Audio Fingerprinting**: Integration with **ACRCloud** to identify music by listening to audio snippets.
- **Smart File Renaming**: Automatically renames files to a normalized `Title - Artist` format with collision handling.
- **Concurrency Control**: Uses `p-queue` for efficient simultaneous tasks.
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

| Flag          | Alias        | Description                                                                                                                                                                                                       |
| :------------ | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--recognize` | `-recognize` | **Audio Recognition**: Uses [ACRCloud](https://www.acrcloud.com/) to identify music by listening to a 12s snippet. This avoids skipping files that already have metadata, allowing you to "fix" or update labels. |
| `--force`     | `-force`     | **Force Mode**: Re-processes files even if they already have embedded cover art. Useful for replacing low-quality covers.                                                                                         |
| `--rename`    | `-rename`    | **Auto Rename**: Renames the file to `Title - Artist.mp3` after resolving metadata. Cleans illegal characters.                                                                                                    |

#### **Examples**

**1. Recognize music using audio fingerprinting (ACRCloud):**

```bash
# Uses npm script
npm run recognize

# Or directly with node
node dist/index.js --recognize ./my/songs
```

_Note: Requires `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET`, and optionally `ACRCLOUD_HOST` in your environment._

**2. Force update covers for all files:**

```bash
node dist/index.js --force ./my/songs
```

**3. Recognize and Force combined:**

```bash
node dist/index.js --recognize --force ./my/songs
```

This will listen to every song to find accurate metadata and search for/embed a new cover for every file, even if they already have them.

---

## 📁 Project Structure

```
mp3-auto-cover/
│
├── config/
│   ├── defaults.ts
│   └── sources.ts
│
├── src/
│   ├── scanner/      # File system scanning and cache
│   ├── metadata/     # ID3 reading and writing
│   ├── cover/        # MusicBrainz, iTunes, and DDG services
│   ├── utils/        # Logger and filename parser
│   └── index.ts      # Main logic entry point
│
├── cache/            # Local image storage
├── dist/             # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧠 How it Works

### 1. **Scanning**

Searches for `.mp3` files in the target directory recursively.

### 2. **Metadata Recovery**

If the file is missing Artist or Album tags, the tool parses the filename and searches MusicBrainz/iTunes to reconstruct the missing information.

### 3. **Cover Resolution Pipeline**

1.  **MusicBrainz/CoverArtArchive**: Searches for original releases.
2.  **iTunes**: Fetches official, high-quality artwork (600x600).
3.  **DuckDuckGo**: Fallback image search for rare or non-commercial tracks.

### 4. **Local Cache**

Each image is hashed and stored in `/cache/covers` to prevent redundant downloads.

### 5. **ID3 Embedding**

The normalized image is embedded into the MP3 file as the official front cover.

### 6. **Smart Renaming (Optional)**

If `--rename` is used, the file is renamed to `Title - Artist.mp3`. If a file with that name already exists, the tool appends a counter (e.g., `(1)`, `(2)`) to avoid overwrites.

---

## ⚡ Concurrency

The tool uses `PQueue` with **3 concurrent tasks** to optimize network requests and cover downloads.

---

## 📝 License

MIT — use it, modify it, improve it.
