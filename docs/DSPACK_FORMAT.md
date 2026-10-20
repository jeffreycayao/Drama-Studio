# Drama Studio pack format (`.dspack`)

A `.dspack` is a zip file that creators use to share ComfyUI workflows, prompt
templates, shot lists and reference media with Drama Studio users. It is
**declarative only**: it describes files, it never contains code that Drama
Studio runs.

Drama Studio also opens ordinary `.zip` packs (the ones creators already trade).
A `.dspack` adds a manifest so the pack has a proper name, credits and titles.

Users import a pack from **Generate › My Workflows › Import pack…**, from the
command palette ("Import a workflow pack"), or by dropping the file on the app.
A review screen lists everything in the pack before anything is kept.

## Layout

```
noir-rain.dspack            (a zip; the .zip extension works too)
├── manifest.json           required for a .dspack
├── README.md               optional; shown in the review and kept with the pack
├── workflows/
│   └── noir-rain.json      ComfyUI workflow, API or editor (UI) format
├── prompts/
│   ├── noir-prompts.md     prompt template
│   └── shot-list.csv       shot list
├── covers/
│   └── noir-rain.png       cover image for a workflow (becomes its thumbnail)
├── refs/
│   └── street.jpg          reference media, imported to Assets
└── luts/
    └── noir.cube           LUT, imported to the LUT library
```

Folders are free-form. The manifest may sit at the root or inside one top
folder; paths in `contents` are relative to the manifest.

## `manifest.json`

```json
{
  "format": "dspack",
  "formatVersion": 1,
  "name": "Rainy Noir Shots",
  "author": "Mika",
  "version": "1.2.0",
  "license": "CC-BY-4.0",
  "description": "Wet streets at night, three camera moves.",
  "homepage": "https://example.com/noir",
  "contents": [
    {
      "path": "workflows/noir-rain.json",
      "type": "workflow",
      "title": "Noir rain shot",
      "description": "Image to video, 5 s, slow push-in.",
      "cover": "covers/noir-rain.png"
    },
    { "path": "prompts/noir-prompts.md", "type": "template", "title": "Noir prompt set" },
    { "path": "prompts/shot-list.csv", "type": "shot-list", "title": "12-shot noir sequence" },
    { "path": "refs/street.jpg", "type": "media", "title": "Street reference" }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `format` | yes | Always `"dspack"`. A `manifest.json` without it is treated as an ordinary file (a Chrome extension manifest is recognized by `manifest_version` and never run). |
| `formatVersion` | no | `1` (default). Readers ignore fields they do not know. |
| `name` | yes | Pack name, up to 120 characters. Workflows are saved under **My Workflows › name**; media under **Assets › name**. |
| `author` | no | Shown as "by …" in the review. |
| `version` | no | Free text, e.g. `1.2.0`. |
| `license` | no | SPDX id or short text, e.g. `CC-BY-4.0`, `MIT`, `All rights reserved`. |
| `description` | no | Up to 1000 characters, shown in the review. |
| `homepage` | no | `https://` only; anything else is dropped. |
| `contents` | no | List of entries (below). Files not listed are still found and classified. |

### `contents` entries

| Field | Notes |
| --- | --- |
| `path` | File path inside the pack, relative to the manifest. |
| `type` | `workflow`, `template`, `shot-list`, `media` or `readme`. Advisory: Drama Studio classifies every file by its content, so a manifest cannot turn a script into a workflow. |
| `title` | Display name (up to 120 characters). Defaults to the file name. |
| `description` | Shown under the title (up to 600 characters). |
| `cover` | Workflows only: an image in the pack used as the workflow's thumbnail. Cover images are not imported as assets. |

Reserved for later versions (ignored today): workflow **bindings** (which nodes
take the prompt, the input image and the output), and declared model downloads.
Until then, title the prompt, input and output nodes with the `DRAMA_STUDIO`
node-title contract (`CUSTOM_KEYFRAME_ENDPOINTS` / `CUSTOM_VIDEO_ENDPOINTS` in
`src/services/comfyui.js`) so a workflow can be promoted into a Director custom
slot.

## What is imported, and where

| File | Recognized by | Goes to |
| --- | --- | --- |
| ComfyUI workflow | `.json` in API format (every top-level value has a `class_type`) or editor format (`nodes` plus `links`) | My Workflows › *pack name* (dependency check in the review) |
| Prompt template | `.txt`, `.md`, `.markdown`, `.fountain`, other `.json` | Kept with the pack (below) |
| Shot list | `.csv`, `.tsv` | Kept with the pack |
| Read-me | `README`, `README.md`, `readme.txt`… (the shallowest one) | Shown in the review; kept with the pack |
| Image, audio, video | `.png .jpg .jpeg .webp .gif`, `.mp3 .wav .ogg .m4a .aac .flac`, `.mp4 .webm .mov .m4v` | Assets › *pack name* (needs an open project) |
| LUT | `.cube` | LUT library (Inspector › Color) |

Kept files go to `<userData>/imported-packs/<pack-slug>/` with a `pack.json`
that records the pack name, source file, manifest credits, import date, what
was imported and what was not.

## What is never imported

Packs must not contain code, and Drama Studio never runs or installs any.
These are listed in the review with a plain explanation, and are not even
extracted to disk:

- Chrome extensions (a `manifest.json` with `manifest_version`, and every file in its folder)
- Scripts: `.js .mjs .cjs .ts .sh .lua .rb .pl .php .wasm`…
- Windows scripts: `.bat .cmd .ps1 .vbs .wsf .hta .reg .lnk`…
- Python, including ComfyUI custom nodes: `.py .pyc .ipynb .whl`
- Programs and installers: `.exe .dll .so .dylib .jar .msi .msix .dmg .pkg .deb .rpm .apk`…
- Web pages: `.html .htm .svg`
- Packaged extensions: `.crx .xpi .vsix`
- Model weights (`.safetensors .ckpt .pt .pth .bin .gguf .onnx`): pickled weights can run code when loaded. Models come from Workflow Setup, from their source.
- Packs inside the pack (`.zip .rar .7z .tar .gz`…): not opened.

When a code tool's manifest or the pack's read-me says what it does, the review
points to the built-in equivalent (for example, chaining clips into a long
video → Short Film Creation and Continue from last frame) and warns when a tool
says it gets around a service's limits.

## Safety limits

The importer (`electron/packImport.cjs`) refuses or trims hostile zips:

| Check | Limit | Result |
| --- | --- | --- |
| Paths outside the pack (`..`, `/abs`, `C:\`) | none allowed | whole pack refused |
| Symbolic links | none followed | entry skipped |
| Password-protected entries | not supported | entry skipped |
| Files in the pack | 5,000 | whole pack refused |
| Unpacked total | 2 GB | whole pack refused |
| One media file | 512 MB | entry skipped |
| One text or workflow file | 8 MB | entry skipped |
| Compression ratio (entries over 1 MB) | 200× | whole pack refused (zip bomb) |
| Bytes read beyond the declared size | none | whole pack refused |

Extraction happens in a fresh temporary folder that is deleted when the review
closes, when the app quits, or after six hours.
