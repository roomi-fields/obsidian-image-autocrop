import { App, Menu, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";

// Sharp is loaded dynamically to handle native module issues
let sharp: typeof import("sharp") | null = null;

interface ImageAutocropSettings {
  watchedFolder: string;
  targetSize: number;
  enabled: boolean;
  trimThreshold: number;
  keepBackup: boolean;
}

const DEFAULT_SETTINGS: ImageAutocropSettings = {
  watchedFolder: "_Assets/Enluminures",
  targetSize: 200,
  enabled: true,
  trimThreshold: 10,
  keepBackup: true,
};

export default class ImageAutocropPlugin extends Plugin {
  settings!: ImageAutocropSettings;
  private processing: Set<string> = new Set();
  private fileCreatedHandler: ((file: TFile) => void) | null = null;

  override async onload() {
    await this.loadSettings();
    await this.loadSharp();
    this.registerFileWatcher();

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

    this.addCommand({
      id: "autocrop-all-in-folder",
      name: "Autocrop all images in watched folder",
      callback: () => {
        void this.processAllInFolder();
      },
    });

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

    this.addSettingTab(new ImageAutocropSettingTab(this.app, this));

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

  async restoreFromBackup(file: TFile): Promise<boolean> {
    const backupPath = this.getBackupPath(file.path);
    const backup = this.app.vault.getAbstractFileByPath(backupPath);

    if (!(backup instanceof TFile)) {
      new Notice(`No backup found for: ${file.name}`);
      return false;
    }

    try {
      const backupData = await this.app.vault.readBinary(backup);
      await this.app.vault.modifyBinary(file, backupData);
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

  private async refreshImageCache(file: TFile): Promise<void> {
    const leaves: any[] = [];

    this.app.workspace.iterateAllLeaves((leaf) => {
      const viewState = leaf.getViewState();
      if (viewState.state?.file === file.path) {
        leaves.push(leaf);
      }
    });

    for (const leaf of leaves) {
      leaf.detach();
      await new Promise(resolve => setTimeout(resolve, 50));
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  private async loadSharp(): Promise<void> {
    try {
      const pluginDir = (this.app.vault.adapter as any).basePath +
        "/.obsidian/plugins/image-autocrop/node_modules/sharp";
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharp = require(pluginDir);
      console.log("Sharp loaded successfully");
    } catch (error) {
      console.error("Failed to load sharp:", error);
      new Notice("Image Autocrop: Failed to load image processing library.");
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

  private getBackupPath(filePath: string): string {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    const filename = filePath.substring(filePath.lastIndexOf("/") + 1);
    return `${dir}/_originals/${filename}`;
  }

  private isInWatchedFolder(filePath: string): boolean {
    const watchedFolder = this.settings.watchedFolder.replace(/^\/|\/$/g, "");
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.startsWith(watchedFolder + "/") || normalizedPath === watchedFolder;
  }

  private isImageFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.includes("/_originals/")) {
      return false;
    }
    const ext = lowerPath.split(".").pop();
    return ext === "png";
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

      const data = await this.app.vault.readBinary(file);
      const buffer = Buffer.from(data);

      if (this.settings.keepBackup) {
        const backupPath = this.getBackupPath(file.path);
        const existingBackup = this.app.vault.getAbstractFileByPath(backupPath);
        if (!existingBackup) {
          const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
          const folderExists = this.app.vault.getAbstractFileByPath(backupDir);
          if (!folderExists) {
            await this.app.vault.createFolder(backupDir);
          }
          await this.app.vault.createBinary(backupPath, data);
          console.log(`Backup created: ${backupPath}`);
        }
      }

      const processedBuffer = await this.autocropImage(buffer);

      if (processedBuffer) {
        const arrayBuffer = new Uint8Array(processedBuffer).buffer;
        await this.app.vault.modifyBinary(file, arrayBuffer);
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
      setTimeout(() => {
        this.processing.delete(file.path);
      }, 2000);
    }
  }

  private async autocropImage(inputBuffer: Buffer): Promise<Buffer | null> {
    if (!sharp) return null;

    try {
      // Get raw pixels with alpha
      const { data: rawPixels, info } = await sharp(inputBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const pixels = Buffer.from(rawPixels);

      // Detect background color from corners and make it transparent
      const bgColor = this.detectBackgroundColor(pixels, width, height);
      if (bgColor) {
        this.makeBackgroundTransparent(pixels, bgColor, 30);
      }

      // Find content bounds based on alpha
      const bounds = this.findContentBounds(pixels, width, height);

      // Crop to content bounds, then resize (keeping aspect ratio)
      const result = await sharp(pixels, {
        raw: { width, height, channels: 4 }
      })
        .extract({
          left: bounds.left,
          top: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        })
        .resize(this.settings.targetSize, this.settings.targetSize, {
          fit: "inside",
          kernel: "lanczos3",
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
        })
        .toBuffer();

      return result;
    } catch (error) {
      console.error("Autocrop failed:", error);
      return this.resizeOnly(inputBuffer);
    }
  }

  private detectBackgroundColor(pixels: Buffer, width: number, height: number): { r: number; g: number; b: number } | null {
    const sampleSize = 20;
    let r = 0, g = 0, b = 0, count = 0;

    // Sample corners, but only opaque pixels
    const corners = [
      { x: 0, y: 0 },
      { x: width - sampleSize, y: 0 },
      { x: 0, y: height - sampleSize },
      { x: width - sampleSize, y: height - sampleSize },
    ];

    for (const corner of corners) {
      for (let dy = 0; dy < sampleSize; dy++) {
        for (let dx = 0; dx < sampleSize; dx++) {
          const x = corner.x + dx;
          const y = corner.y + dy;
          if (x >= width || y >= height) continue;
          const idx = (y * width + x) * 4;
          // Only count opaque pixels
          if (pixels[idx + 3] < 128) continue;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          count++;
        }
      }
    }

    // If corners are mostly transparent, sample edges instead
    if (count < 100) {
      // Sample top and bottom edges
      for (let x = 0; x < width; x += 10) {
        for (const y of [0, height - 1]) {
          const idx = (y * width + x) * 4;
          if (pixels[idx + 3] < 128) continue;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          count++;
        }
      }
      // Sample left and right edges
      for (let y = 0; y < height; y += 10) {
        for (const x of [0, width - 1]) {
          const idx = (y * width + x) * 4;
          if (pixels[idx + 3] < 128) continue;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          count++;
        }
      }
    }

    if (count === 0) return null;
    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
  }

  private makeBackgroundTransparent(pixels: Buffer, bg: { r: number; g: number; b: number }, tolerance: number): void {
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = Math.abs(pixels[i] - bg.r);
      const dg = Math.abs(pixels[i + 1] - bg.g);
      const db = Math.abs(pixels[i + 2] - bg.b);
      if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
        pixels[i + 3] = 0;
      }
    }
  }

  private findContentBounds(
    pixels: Buffer,
    width: number,
    height: number
  ): { top: number; bottom: number; left: number; right: number } {
    const threshold = this.settings.trimThreshold;
    let top = 0, bottom = height, left = 0, right = width;

    topLoop: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha > threshold) {
          top = y;
          break topLoop;
        }
      }
    }

    bottomLoop: for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha > threshold) {
          bottom = y + 1;
          break bottomLoop;
        }
      }
    }

    leftLoop: for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha > threshold) {
          left = x;
          break leftLoop;
        }
      }
    }

    rightLoop: for (let x = width - 1; x >= 0; x--) {
      for (let y = 0; y < height; y++) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha > threshold) {
          right = x + 1;
          break rightLoop;
        }
      }
    }

    return { top, bottom, left, right };
  }

  private async resizeOnly(inputBuffer: Buffer): Promise<Buffer | null> {
    if (!sharp) return null;

    const result = await sharp(inputBuffer)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .toBuffer();

    return result;
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
      .setDesc("Maximum image size in pixels")
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
      .setDesc("Alpha threshold for detecting transparent edges (0-255)")
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
      .setName("Keep backup")
      .setDesc("Save original in _originals folder before processing")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.keepBackup).onChange(async (value) => {
          this.plugin.settings.keepBackup = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Actions").setHeading();

    new Setting(containerEl)
      .setName("Process all images")
      .setDesc("Process all existing images in the watched folder")
      .addButton((button) =>
        button.setButtonText("Process All").onClick(async () => {
          button.setButtonText("Processing...");
          button.setDisabled(true);
          await this.plugin.processAllInFolder();
          button.setButtonText("Process All");
          button.setDisabled(false);
        })
      );
  }
}
