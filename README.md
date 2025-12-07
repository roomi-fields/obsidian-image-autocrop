# Image Autocrop for Obsidian

An Obsidian plugin that automatically crops, squares, and resizes PNG images. Perfect for processing AI-generated illustrations (like DALL-E enluminures) into consistent, web-ready thumbnails.

## Features

- **Auto-crop**: Trims transparent/empty edges from images
- **Auto-square**: Centers content in a square canvas
- **Auto-resize**: Scales to your target size (default 200x200px)
- **Folder watching**: Automatically processes new images added to a watched folder
- **Backup system**: Saves originals in `_originals/` subfolder for easy restoration
- **Context menu**: Right-click any PNG to manually crop or restore

## Installation

### Manual Installation

1. Download the latest release
2. Extract to your vault's `.obsidian/plugins/image-autocrop/` folder
3. Run `npm install` in the plugin folder (required for Sharp image library)
4. Enable the plugin in Obsidian settings

### Requirements

- Obsidian Desktop (not mobile - requires native Node.js modules)
- Node.js installed on your system

## Usage

### Automatic Processing

1. Configure the watched folder in settings (default: `_Assets/Enluminures`)
2. Drop a PNG image into that folder
3. The plugin automatically crops, squares, and resizes it

### Manual Processing

- **Right-click an image** → "Autocrop image"
- **Command palette** → "Autocrop current image" or "Autocrop all images in watched folder"

### Restore Original

If you're not happy with the result:
- **Right-click the image** → "Restore original image"
- **Command palette** → "Restore current image from backup"

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable auto-processing | Watch folder for new images | On |
| Watched folder | Folder to monitor | `_Assets/Enluminures` |
| Target size | Final image size in pixels (square) | 200 |
| Trim threshold | Edge detection sensitivity (0-50) | 10 |
| Background color | Padding color (`transparent` or hex) | transparent |
| Keep backup | Save originals before processing | On |

## How It Works

1. **Trim**: Removes transparent or near-transparent borders
2. **Square**: Adds padding to make the image square, centering the content
3. **Resize**: Scales to the target size using high-quality Lanczos resampling
4. **Save**: Overwrites the original (backup saved in `_originals/` if enabled)

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
