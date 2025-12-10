import { App, Menu, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";

// Sharp is loaded dynamically to handle native module issues
let sharp: typeof import("sharp") | null = null;

interface ImageAutocropSettings {
  watchedFolder: string;
  targetSize: number;
  enabled: boolean;
  processExisting: boolean;
  trimThreshold: number;
  backgroundColor: string;
  removeBackground: boolean;
  backgroundTolerance: number;
  keepBackup: boolean;
}

const DEFAULT_SETTINGS: ImageAutocropSettings = {
  watchedFolder: "_Assets/Enluminures",
  targetSize: 200,
  enabled: true,
  processExisting: false,
  trimThreshold: 10,
  backgroundColor: "transparent",
  removeBackground: false,
  backgroundTolerance: 30,
  keepBackup: true,
};

export default class ImageAutocropPlugin extends Plugin {
  settings!: ImageAutocropSettings;
  private processing: Set<string> = new Set();
  private fileCreatedHandler: ((file: TFile) => void) | null = null;

  override async onload() {
    await this.loadSettings();

    // Try to load sharp
    await this.loadSharp();

    this.registerFileWatcher();

    // Add command to manually process a file
    this.addCommand({
      id: "autocrop-current-image",
      name: "Autocrop current image",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isImageFile(file.path)) {
          if (!checking) {
            void this.processImage(file);
          }
          return true;
        }
        return false;
      },
    });

    // Add command to process all images in watched folder
    this.addCommand({
      id: "autocrop-all-in-folder",
      name: "Autocrop all images in watched folder",
      callback: () => {
        void this.processAllInFolder();
      },
    });

    // Add command to restore current image from backup
    this.addCommand({
      id: "restore-current-image",
      name: "Restore current image from backup",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isImageFile(file.path)) {
          if (!checking) {
            void this.restoreFromBackup(file);
          }
          return true;
        }
        return false;
      },
    });

    // Add settings tab
    this.addSettingTab(new ImageAutocropSettingTab(this.app, this));

    // Add context menu for files
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
        if (file instanceof TFile && this.isImageFile(file.path)) {
          menu.addItem((item) => {
            item
              .setTitle("Autocrop image")
              .setIcon("crop")
              .onClick(() => {
                void this.processImage(file);
              });
          });

          // Add restore option if backup exists
          const backupPath = this.getBackupPath(file.path);
          const backup = this.app.vault.getAbstractFileByPath(backupPath);
          if (backup instanceof TFile) {
            menu.addItem((item) => {
              item
                .setTitle("Restore original image")
                .setIcon("rotate-ccw")
                .onClick(() => {
                  void this.restoreFromBackup(file);
                });
            });
          }
        }
      })
    );

    console.log("Image Autocrop plugin loaded");
  }

  /**
   * Restore an image from its backup
   */
  async restoreFromBackup(file: TFile): Promise<boolean> {
    const backupPath = this.getBackupPath(file.path);
    console.log(`Looking for backup at: ${backupPath}`);
    const backup = this.app.vault.getAbstractFileByPath(backupPath);
    console.log(`Backup found: ${backup !== null}, is TFile: ${backup instanceof TFile}`);

    if (!(backup instanceof TFile)) {
      new Notice(`No backup found at: ${backupPath}`);
      return false;
    }

    try {
      const backupData = await this.app.vault.readBinary(backup);
      await this.app.vault.modifyBinary(file, backupData);
      // Force refresh by updating the file's mtime
      await this.refreshImageCache(file);
      new Notice(`Restored: ${file.name}`);
      return true;
    } catch (error) {
      console.error("Failed to restore:", error);
      new Notice(`Failed to restore: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    }
  }

  override onunload() {
    console.log("Image Autocrop plugin unloaded");
  }

  /**
   * Force Obsidian to refresh the image by closing and reopening the tab
   */
  private async refreshImageCache(file: TFile): Promise<void> {
    const leaves: any[] = [];

    // Find all leaves showing this file
    this.app.workspace.iterateAllLeaves((leaf) => {
      const viewState = leaf.getViewState();
      if (viewState.state?.file === file.path) {
        leaves.push(leaf);
      }
    });

    // Close and reopen each leaf
    for (const leaf of leaves) {
      const state = leaf.getViewState();
      leaf.detach();
      await new Promise(resolve => setTimeout(resolve, 50));
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  private async loadSharp(): Promise<void> {
    try {
      // Get the plugin's base path
      const pluginDir = (this.app.vault.adapter as any).basePath +
        "/.obsidian/plugins/image-autocrop/node_modules/sharp";

      console.log("Trying to load sharp from:", pluginDir);

      // Dynamic import for sharp with absolute path
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharp = require(pluginDir);
      console.log("Sharp loaded successfully");
    } catch (error) {
      console.error("Failed to load sharp:", error);
      new Notice("Image Autocrop: Failed to load image processing library. Check console for details.");
      sharp = null;
    }
  }

  private registerFileWatcher(): void {
    // Ignore create events for 5 seconds after startup to avoid reprocessing existing files
    let ready = false;
    setTimeout(() => { ready = true; }, 5000);

    this.fileCreatedHandler = (file: TFile) => {
      if (!ready) return;
      if (!this.settings.enabled) return;
      if (!this.isInWatchedFolder(file.path)) return;
      if (!this.isImageFile(file.path)) return;

      setTimeout(() => {
        void this.processImage(file);
      }, 1000);
    };

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.fileCreatedHandler) {
          this.fileCreatedHandler(file);
        }
      })
    );
  }

  /**
   * Get the backup path for an image
   */
  private getBackupPath(filePath: string): string {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    const filename = filePath.substring(filePath.lastIndexOf("/") + 1);
    return `${dir}/_originals/${filename}`;
  }

  /**
   * Check if a backup already exists for this image (means it was already processed)
   */
  private hasBackup(filePath: string): boolean {
    const backupPath = this.getBackupPath(filePath);
    return this.app.vault.getAbstractFileByPath(backupPath) !== null;
  }

  private isInWatchedFolder(filePath: string): boolean {
    const watchedFolder = this.settings.watchedFolder.replace(/^\/|\/$/g, "");
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.startsWith(watchedFolder + "/") || normalizedPath === watchedFolder;
  }

  private isImageFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    // Exclude files in _originals folder
    if (lowerPath.includes("/_originals/")) {
      return false;
    }
    const ext = lowerPath.split(".").pop();
    return ext === "png"; // Only PNG for transparency support
  }

  async processImage(file: TFile): Promise<boolean> {
    if (!sharp) {
      new Notice("Image processing library not available");
      return false;
    }

    if (this.processing.has(file.path)) {
      return false;
    }

    this.processing.add(file.path);

    try {
      console.log(`Processing image: ${file.path}`);

      // Read the file as binary
      const data = await this.app.vault.readBinary(file);
      const buffer = Buffer.from(data);

      // Keep backup if enabled
      if (this.settings.keepBackup) {
        const backupPath = this.getBackupPath(file.path);
        const existingBackup = this.app.vault.getAbstractFileByPath(backupPath);
        if (!existingBackup) {
          // Ensure _originals folder exists
          const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
          const folderExists = this.app.vault.getAbstractFileByPath(backupDir);
          if (!folderExists) {
            await this.app.vault.createFolder(backupDir);
          }
          // Create backup
          await this.app.vault.createBinary(backupPath, data);
          console.log(`Backup created: ${backupPath}`);
        }
      }

      // Process with sharp
      const processedBuffer = await this.autocropImage(buffer);

      if (processedBuffer) {
        // Write back to vault - convert Buffer to ArrayBuffer
        const arrayBuffer = new Uint8Array(processedBuffer).buffer;
        await this.app.vault.modifyBinary(file, arrayBuffer);
        // Force refresh
        await this.refreshImageCache(file);
        console.log(`Successfully processed: ${file.path}`);
        new Notice(`Image autocropped: ${file.name}`);
        return true;
      } else {
        console.log(`No processing needed for: ${file.path}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to process ${file.path}:`, error);
      new Notice(`Failed to process ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    } finally {
      // Remove from processing set after a delay
      setTimeout(() => {
        this.processing.delete(file.path);
      }, 2000);
    }
  }

  private async autocropImage(inputBuffer: Buffer): Promise<Buffer | null> {
    if (!sharp) return null;

    try {
      let workingBuffer = inputBuffer;

      // Step 0: Remove background color if enabled
      if (this.settings.removeBackground) {
        workingBuffer = await this.removeBackgroundColor(workingBuffer);
      }

      // Get image info
      const image = sharp(workingBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error("Could not read image dimensions");
      }

      // Step 1: Trim transparent/near-transparent edges
      // Sharp's trim() removes borders based on the top-left pixel
      const trimmed = await image
        .trim({
          threshold: this.settings.trimThreshold,
        })
        .toBuffer({ resolveWithObject: true });

      // Step 2: Make it square by adding padding
      const { width, height } = trimmed.info;
      const maxSide = Math.max(width, height);

      // Calculate padding to center the image
      const padLeft = Math.floor((maxSide - width) / 2);
      const padTop = Math.floor((maxSide - height) / 2);
      const padRight = maxSide - width - padLeft;
      const padBottom = maxSide - height - padTop;

      // Step 3: Add padding and resize to target size
      const background = this.settings.backgroundColor === "transparent"
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : this.parseColor(this.settings.backgroundColor);

      const result = await sharp(trimmed.data)
        .extend({
          top: padTop,
          bottom: padBottom,
          left: padLeft,
          right: padRight,
          background,
        })
        .resize(this.settings.targetSize, this.settings.targetSize, {
          fit: "fill",
          kernel: "lanczos3",
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
        })
        .toBuffer();

      return result;
    } catch (error) {
      // If trim fails (e.g., solid image), try just resizing
      if (error instanceof Error && error.message.includes("trim")) {
        console.log("Trim failed, trying resize only");
        return this.resizeOnly(inputBuffer);
      }
      throw error;
    }
  }

  private async resizeOnly(inputBuffer: Buffer): Promise<Buffer | null> {
    if (!sharp) return null;

    const result = await sharp(inputBuffer)
      .resize(this.settings.targetSize, this.settings.targetSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: "lanczos3",
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .toBuffer();

    return result;
  }

  /**
   * Remove background color by sampling the corners and replacing similar colors with transparency
   */
  private async removeBackgroundColor(inputBuffer: Buffer): Promise<Buffer> {
    if (!sharp) return inputBuffer;

    try {
      const image = sharp(inputBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        return inputBuffer;
      }

      const width = metadata.width;
      const height = metadata.height;
      const sampleSize = 20; // Sample 20x20 pixels from each corner

      // Get raw pixel data to sample corners
      const rawImage = await sharp(inputBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixels = rawImage.data;
      const imgWidth = rawImage.info.width;

      // Sample from all 4 corners
      const cornerRegions = [
        { x: 0, y: 0 }, // Top-left
        { x: width - sampleSize, y: 0 }, // Top-right
        { x: 0, y: height - sampleSize }, // Bottom-left
        { x: width - sampleSize, y: height - sampleSize }, // Bottom-right
      ];

      let totalR = 0, totalG = 0, totalB = 0;
      let pixelCount = 0;

      for (const corner of cornerRegions) {
        for (let dy = 0; dy < sampleSize && corner.y + dy < height; dy++) {
          for (let dx = 0; dx < sampleSize && corner.x + dx < width; dx++) {
            const x = corner.x + dx;
            const y = corner.y + dy;
            const idx = (y * imgWidth + x) * 4;

            // Skip if pixel is already transparent
            if (pixels[idx + 3] < 128) continue;

            totalR += pixels[idx];
            totalG += pixels[idx + 1];
            totalB += pixels[idx + 2];
            pixelCount++;
          }
        }
      }

      if (pixelCount === 0) {
        return inputBuffer;
      }

      const bgR = Math.round(totalR / pixelCount);
      const bgG = Math.round(totalG / pixelCount);
      const bgB = Math.round(totalB / pixelCount);

      console.log(`Detected background color: RGB(${bgR}, ${bgG}, ${bgB})`);

      // We already have rawImage from corner sampling, reuse it
      const tolerance = this.settings.backgroundTolerance;

      // Replace background color with transparency
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        // Check if this pixel is close to the background color
        const diffR = Math.abs(r - bgR);
        const diffG = Math.abs(g - bgG);
        const diffB = Math.abs(b - bgB);

        if (diffR <= tolerance && diffG <= tolerance && diffB <= tolerance) {
          // Make transparent
          pixels[i + 3] = 0;
        }
      }

      // Reconstruct the image
      const result = await sharp(pixels, {
        raw: {
          width: rawImage.info.width,
          height: rawImage.info.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();

      return result;
    } catch (error) {
      console.error("Failed to remove background:", error);
      return inputBuffer;
    }
  }

  private parseColor(color: string): { r: number; g: number; b: number; alpha: number } {
    // Parse hex color
    const hex = color.replace("#", "");
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        alpha: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        alpha: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
    // Default to transparent
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }

  async processAllInFolder(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(this.settings.watchedFolder);

    if (!folder || !(folder instanceof TFolder)) {
      new Notice(`Folder not found: ${this.settings.watchedFolder}`);
      return;
    }

    const files = this.getAllImagesInFolder(folder);

    if (files.length === 0) {
      new Notice("No PNG images found in watched folder");
      return;
    }

    new Notice(`Processing ${files.length} images...`);

    let processed = 0;
    let failed = 0;

    for (const file of files) {
      const success = await this.processImage(file);
      if (success) {
        processed++;
      } else {
        failed++;
      }
      // Small delay between files
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    new Notice(`Processed ${processed} images, ${failed} skipped/failed`);
  }

  private getAllImagesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile && this.isImageFile(child.path)) {
        files.push(child);
      } else if (child instanceof TFolder) {
        files.push(...this.getAllImagesInFolder(child));
      }
    }

    return files;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ImageAutocropSettingTab extends PluginSettingTab {
  plugin: ImageAutocropPlugin;

  constructor(app: App, plugin: ImageAutocropPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable auto-processing")
      .setDesc("Automatically process new images added to the watched folder")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Watched folder")
      .setDesc("Folder to watch for new images (relative to vault root)")
      .addText((text) =>
        text
          .setPlaceholder("_Assets/Enluminures")
          .setValue(this.plugin.settings.watchedFolder)
          .onChange(async (value) => {
            this.plugin.settings.watchedFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Target size")
      .setDesc("Final image size in pixels (square)")
      .addText((text) =>
        text
          .setPlaceholder("200")
          .setValue(String(this.plugin.settings.targetSize))
          .onChange(async (value) => {
            const size = parseInt(value, 10);
            if (!isNaN(size) && size > 0 && size <= 2000) {
              this.plugin.settings.targetSize = size;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Trim threshold")
      .setDesc("Sensitivity for detecting edges to trim (0-255, lower = more aggressive)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 50, 1)
          .setValue(this.plugin.settings.trimThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.trimThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Background color")
      .setDesc('Color for padding (use "transparent" or hex like "#FFFFFF")')
      .addText((text) =>
        text
          .setPlaceholder("transparent")
          .setValue(this.plugin.settings.backgroundColor)
          .onChange(async (value) => {
            this.plugin.settings.backgroundColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Background Removal").setHeading();

    new Setting(containerEl)
      .setName("Remove background color")
      .setDesc("Detect the center background color and make it transparent")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.removeBackground).onChange(async (value) => {
          this.plugin.settings.removeBackground = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Background tolerance")
      .setDesc("Color difference tolerance for background removal (higher = more aggressive)")
      .addSlider((slider) =>
        slider
          .setLimits(5, 100, 5)
          .setValue(this.plugin.settings.backgroundTolerance)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backgroundTolerance = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Keep backup")
      .setDesc("Save original as .original.png before processing (allows restore)")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.keepBackup).onChange(async (value) => {
          this.plugin.settings.keepBackup = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Actions").setHeading();

    new Setting(containerEl)
      .setName("Process all images")
      .setDesc("Manually process all existing images in the watched folder")
      .addButton((button) =>
        button.setButtonText("Process All").onClick(async () => {
          button.setButtonText("Processing...");
          button.setDisabled(true);
          await this.plugin.processAllInFolder();
          button.setButtonText("Process All");
          button.setDisabled(false);
        })
      );

    // Info section
    containerEl.createEl("h3", { text: "How it works" });
    containerEl.createEl("p", {
      text: "This plugin watches the specified folder for new PNG images. When a new image is added, it automatically:",
    });
    const list = containerEl.createEl("ol");
    list.createEl("li", { text: "Trims transparent/empty edges" });
    list.createEl("li", { text: "Centers the content in a square canvas" });
    list.createEl("li", { text: "Resizes to the target size" });

    containerEl.createEl("p", {
      text: "You can also use the command palette to manually process the current image or all images in the folder.",
      cls: "setting-item-description",
    });
  }
}
