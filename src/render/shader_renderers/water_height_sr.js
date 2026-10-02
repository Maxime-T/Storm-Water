import { ResourceManager } from "../../scene_resources/resource_manager.js";
import { FFTShaderRenderer } from "./fft_sr.js";
import { ShaderRenderer } from "./shader_renderer.js";
import { WaterSpectrumShaderRenderer } from "./water_spectrum_sr.js";

export class WaterHeightShaderRenderer extends ShaderRenderer {
    /**
     * @param {number} choppiness multiplier of the horizontal displacement
     */
    constructor(regl, resource_manager, size, choppiness) {
        super(regl, resource_manager, `water_height.vert.glsl`, `water_height.frag.glsl`);

        this.size = size;
        this.choppiness = choppiness;
        this.fft_sr = new FFTShaderRenderer(regl, resource_manager, size);

        // Combined X+Y slope spectrum (RG = X slope complex, BA = Y slope complex)
        this.slope_spectrum_combined = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.height_result = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        // Combined slope result (R = X slope, G = Y slope after FFT)
        this.slope_result_combined = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.horizontal_spectrum_combined_command = this.horizontal_spectrum_combined_pipeline();
        this.merge_result_command = this.merge_results_pipeline();
    }

    render(scene_state, spectrum, mesh_quad_2d) {

        //height fft
        this.draw_in(this.height_result, () => {
            this.fft_sr.render(scene_state, spectrum, mesh_quad_2d);
        });

        // Combined X+Y Slope spectrum (packs both into RGBA for single FFT)
        this.horizontal_spectrum_combined_command([{
            target: this.slope_spectrum_combined,
            mesh_quad_2d: mesh_quad_2d,
            fft_size: this.size,
            choppiness: this.choppiness,
            spectrum: spectrum,
        }]);

        // Single FFT for both X and Y slopes
        this.draw_in(this.slope_result_combined, () => {
            this.fft_sr.render(scene_state, this.slope_spectrum_combined, mesh_quad_2d);
        });

        this.merge_result_command([{
            mesh_quad_2d: mesh_quad_2d,
            height_result: this.height_result,
            slope_result_combined: this.slope_result_combined,
        }])

    }


    merge_results_pipeline() {
        const regl = this.regl;
        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                height_result: regl.prop('height_result'),
                slope_result_combined: regl.prop('slope_result_combined'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D height_result;
                uniform sampler2D slope_result_combined;
                varying vec2 v2f_tex_coords;

                void main() {
                    float height = texture2D(height_result, v2f_tex_coords).r;
                    // slope_result_combined: R = X slope, G = Y slope (from dual-complex FFT)
                    vec2 slopes = texture2D(slope_result_combined, v2f_tex_coords).rg;

                    gl_FragColor = vec4(height, slopes.x, slopes.y, 1.0);
                }
            `
        });
    }


    // Combined pipeline: computes both X and Y slope spectra in a single pass
    // RG = X slope complex, BA = Y slope complex
    horizontal_spectrum_combined_pipeline() {
        const regl = this.regl;
        return regl({
            framebuffer: regl.prop('target'),
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                spectrum: regl.prop('spectrum'),
                fft_size: regl.prop('fft_size'),
                choppiness: regl.prop('choppiness'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D spectrum;
                uniform float fft_size;
                uniform float choppiness;
                varying vec2 v2f_tex_coords;

                const float PI = 3.14159265359;

                void main() {
                    vec2 h = texture2D(spectrum, v2f_tex_coords).rg; // complex spectrum: h = a + ib

                    // Compute k-space coordinates (range: -N/2 ... N/2 - 1)
                    float N = fft_size;
                    vec2 k = floor(v2f_tex_coords * N) - N / 2.0;

                    float k_length = sqrt(k.x*k.x + k.y*k.y);

                    // Avoid division by zero at DC component
                    if (k_length < 0.0001) {
                        gl_FragColor = vec4(0.0);
                        return;
                    }

                    // X slope: multiply by i * kx / |k|
                    // i * (a + ib) = -b + ia
                    vec2 slopeSpecX = vec2(-h.y, h.x) * (k.x / k_length) * choppiness;

                    // Y slope: multiply by i * ky / |k|
                    vec2 slopeSpecY = vec2(-h.y, h.x) * (k.y / k_length) * choppiness;

                    // Pack both complex numbers: RG = X slope, BA = Y slope
                    gl_FragColor = vec4(slopeSpecX, slopeSpecY);
                }
            `
        });
    }
}
