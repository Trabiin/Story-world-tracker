/**
 * MP-3: tiled rendering of large pinned images. Tiles are cut lazily from the source image
 * at a pyramid level that matches the zoom, and cached, so huge maps stay smooth.
 */
export const TILE = 512;

export class TiledImage {
  readonly levels: number;
  private cache = new Map<string, ImageBitmap | 'loading'>();
  private order: string[] = [];
  private maxCached = 400;
  ready = false;

  constructor(public img: HTMLImageElement, private onTile: () => void) {
    const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
    this.levels = Math.max(1, Math.ceil(Math.log2(maxDim / TILE)) + 1);
    this.ready = true;
  }

  get width() {
    return this.img.naturalWidth;
  }
  get height() {
    return this.img.naturalHeight;
  }

  /** Pick the pyramid level for a given screen-pixels-per-image-pixel ratio. */
  levelFor(screenPerImagePx: number): number {
    const lvl = Math.floor(Math.log2(1 / Math.max(screenPerImagePx, 1e-6)));
    return Math.max(0, Math.min(this.levels - 1, lvl));
  }

  /** Tile at level/col/row covers source rect of size TILE*2^level image pixels. */
  get(level: number, col: number, row: number): ImageBitmap | undefined {
    const key = `${level}/${col}/${row}`;
    const c = this.cache.get(key);
    if (c && c !== 'loading') return c;
    if (!c) this.load(key, level, col, row);
    return undefined;
  }

  private load(key: string, level: number, col: number, row: number) {
    const span = TILE * 2 ** level;
    const sx = col * span, sy = row * span;
    const sw = Math.min(span, this.width - sx), sh = Math.min(span, this.height - sy);
    if (sw <= 0 || sh <= 0) return;
    this.cache.set(key, 'loading');
    createImageBitmap(this.img, sx, sy, sw, sh, { resizeWidth: Math.max(1, Math.round(sw / 2 ** level)), resizeHeight: Math.max(1, Math.round(sh / 2 ** level)), resizeQuality: 'high' })
      .then((bmp) => {
        this.cache.set(key, bmp);
        this.order.push(key);
        while (this.order.length > this.maxCached) {
          const old = this.order.shift()!;
          const b = this.cache.get(old);
          if (b && b !== 'loading') b.close();
          this.cache.delete(old);
        }
        this.onTile();
      })
      .catch(() => this.cache.delete(key));
  }

  dispose() {
    for (const b of this.cache.values()) if (b !== 'loading') b.close();
    this.cache.clear();
  }
}
