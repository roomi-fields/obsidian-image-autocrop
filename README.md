# Image Autocrop for Obsidian

Automatically crop, square, and resize PNG images in specified folders. Perfect for processing DALL-E generated enluminures.

## Features

- **Auto-watch folder**: Monitors a specified folder for new PNG images
- **Smart cropping**: Removes transparent/empty edges
- **Square output**: Centers content in a square canvas
- **Resize**: Scales to your target size (default: 200x200)
- **Manual processing**: Commands to process current image or all images in folder

## Installation

### Prerequisites

This plugin requires **Sharp**, a native image processing library. You need to install it in your vault's plugin folder:

```bash
cd /path/to/your/vault/.obsidian/plugins/image-autocrop
npm install sharp
```

### Manual Installation

1. Create a folder `image-autocrop` in your vault's `.obsidian/plugins/` directory
2. Copy `main.js`, `manifest.json`, and `styles.css` to this folder
3. Install Sharp: `npm install sharp` in the plugin folder
4. Enable the plugin in Obsidian Settings → Community plugins

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Enable auto-processing | Auto-process new images | On |
| Watched folder | Folder to monitor | `_Assets/Enluminures` |
| Target size | Final size in pixels | 200 |
| Trim threshold | Edge detection sensitivity (0-50) | 10 |
| Background color | Padding color | transparent |

## Commands

- **Autocrop current image**: Process the currently open image
- **Autocrop all images in watched folder**: Batch process all PNGs

## How it works

When a new PNG is added to the watched folder:

1. **Trim**: Removes transparent/near-transparent edges
2. **Square**: Centers the content in a square canvas with padding
3. **Resize**: Scales to target size using Lanczos resampling
4. **Save**: Overwrites the original with the processed version

## Use with Surfing / Local REST API

This plugin is designed to work with the Surfing plugin. When you save DALL-E images via the Local REST API to `_Assets/Enluminures/`, they will be automatically processed.

## Troubleshooting

### Sharp installation issues

If you see "Failed to load image processing library":

1. Make sure Node.js is installed
2. Navigate to the plugin folder
3. Run `npm install sharp`
4. Restart Obsidian

### Images not being processed

- Check that the watched folder path is correct
- Ensure the file is a PNG
- Check the console (Ctrl+Shift+I) for errors

## License

MIT
