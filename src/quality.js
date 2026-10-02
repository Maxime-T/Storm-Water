/**
 * Quality levels, from the cheapest to the most expensive:
 * - render_scale: resolution of the canvas relative to the window (the image is stretched to fill it)
 * - fft_size: resolution of the first wave cascade's FFT (the two others are 2 and 4 times smaller)
 * - foam_size: resolution of the foam texture covering the whole ocean
 * - lod_resolutions: vertices per side of the chunks of each ring around the center (see final_scene.js)
 */
export const QUALITY_LEVELS = [
    { name: "Low",    render_scale: 0.5,  fft_size: 128, foam_size: 1024, lod_resolutions: [61, 61, 31, 31] },
    { name: "Medium", render_scale: 0.75, fft_size: 256, foam_size: 2048, lod_resolutions: [121, 121, 61, 31] },
    { name: "High",   render_scale: 1,    fft_size: 512, foam_size: 2048, lod_resolutions: [241, 121, 61, 31] },
    { name: "Ultra",  render_scale: 1,    fft_size: 512, foam_size: 4096, lod_resolutions: [241, 241, 121, 61] },
];

const DEFAULT_LEVEL = 2;
const STORAGE_KEY = "storm_water_quality";

// The chosen level is remembered in the browser (storage can be unavailable, e.g. in private mode)
export function load_quality_level() {
    try {
        const level = parseInt(localStorage.getItem(STORAGE_KEY));
        if (level >= 0 && level < QUALITY_LEVELS.length) return level;
    } catch (e) {}
    return DEFAULT_LEVEL;
}

export function save_quality_level(level) {
    try {
        localStorage.setItem(STORAGE_KEY, String(level));
    } catch (e) {}
}
