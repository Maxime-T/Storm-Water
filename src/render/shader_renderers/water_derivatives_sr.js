import { ResourceManager } from "../../scene_resources/resource_manager.js";
import { FFTShaderRenderer } from "./fft_sr.js";
import { ShaderRenderer } from "./shader_renderer.js";
import { WaterSpectrumShaderRenderer } from "./water_spectrum_sr.js";

export class WaterDerivShaderRenderer extends ShaderRenderer {
    /**
     * @param {number} uv_scale how many times this cascade's texture repeats across one chunk,
     * used to output derivatives with respect to the mesh coordinates
     */
    constructor(regl, resource_manager, size, uv_scale, choppiness) {
        super(regl, resource_manager, `water_height.vert.glsl`, `water_height.frag.glsl`);

        this.size = size;
        this.uv_scale = uv_scale;
        this.choppiness = choppiness;
        this.fft_sr = new FFTShaderRenderer(regl, resource_manager, size);

        // Combined derivative spectrum (RG = X deriv complex, BA = Y deriv complex)
        this.deriv_spectrum_combined = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        // For displacement: need to store horizontal spectrum before taking derivatives
        this.horiz_spectrum_x = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.horiz_spectrum_y = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        // Combined result buffer (R = X deriv, G = Y deriv after FFT)
        this.deriv_result_combined = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        // For displacement derivatives: dx/dx, dx/dy in one FFT, dy/dx, dy/dy in another
        this.deriv_result_dx = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.deriv_result_dy = regl.framebuffer({
            color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.deriv_spectrum_combined_command = this.deriv_spectrum_combined_pipeline();
        this.horizontal_spectrum_command = this.horizontal_spectrum_pipeline();
        this.merge_result_height_command = this.merge_results_height_pipeline();
        this.merge_result_displacement_command = this.merge_results_displacement_pipeline();
    }

    render(scene_state, spectrum, mesh_quad_2d, height_or_displacement) {

        if (height_or_displacement == 1) {
            // Height derivatives: combine X and Y into single FFT
            this.deriv_spectrum_combined_command([{
                target: this.deriv_spectrum_combined,
                mesh_quad_2d: mesh_quad_2d,
                fft_size: this.size,
                uv_scale: this.uv_scale,
                spectrum: spectrum,
            }]);

            this.draw_in(this.deriv_result_combined, () => {
                this.fft_sr.render(scene_state, this.deriv_spectrum_combined, mesh_quad_2d);
            });

            // Merge into output
            this.merge_result_height_command([{
                mesh_quad_2d: mesh_quad_2d,
                deriv_result_combined: this.deriv_result_combined,
            }]);
        }
        else {
            // Displacement derivatives: need 2 FFTs instead of 4

            // First compute horizontal displacement spectra
            this.horizontal_spectrum_command([{
                target: this.horiz_spectrum_x,
                mesh_quad_2d: mesh_quad_2d,
                fft_size: this.size,
                spectrum: spectrum,
                compute_direction: 0,
                choppiness: this.choppiness,
            }]);

            this.horizontal_spectrum_command([{
                target: this.horiz_spectrum_y,
                mesh_quad_2d: mesh_quad_2d,
                fft_size: this.size,
                spectrum: spectrum,
                compute_direction: 1,
                choppiness: this.choppiness,
            }]);

            // X displacement derivatives (dx/dx, dx/dy) - combined into one FFT
            this.deriv_spectrum_combined_command([{
                target: this.deriv_spectrum_combined,
                mesh_quad_2d: mesh_quad_2d,
                fft_size: this.size,
                uv_scale: this.uv_scale,
                spectrum: this.horiz_spectrum_x,
            }]);

            this.draw_in(this.deriv_result_dx, () => {
                this.fft_sr.render(scene_state, this.deriv_spectrum_combined, mesh_quad_2d);
            });

            // Y displacement derivatives (dy/dx, dy/dy) - combined into one FFT
            this.deriv_spectrum_combined_command([{
                target: this.deriv_spectrum_combined,
                mesh_quad_2d: mesh_quad_2d,
                fft_size: this.size,
                uv_scale: this.uv_scale,
                spectrum: this.horiz_spectrum_y,
            }]);

            this.draw_in(this.deriv_result_dy, () => {
                this.fft_sr.render(scene_state, this.deriv_spectrum_combined, mesh_quad_2d);
            });

            // Merge all 4 derivatives into output
            this.merge_result_displacement_command([{
                mesh_quad_2d: mesh_quad_2d,
                deriv_result_dx: this.deriv_result_dx,
                deriv_result_dy: this.deriv_result_dy,
            }]);
        }
    }


    merge_results_height_pipeline() {
        const regl = this.regl;
        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                deriv_result_combined: regl.prop('deriv_result_combined'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D deriv_result_combined;
                varying vec2 v2f_tex_coords;

                void main() {
                    // deriv_result_combined: R = X deriv, G = Y deriv
                    vec2 derivs = texture2D(deriv_result_combined, v2f_tex_coords).rg;
                    gl_FragColor = vec4(derivs.x, derivs.y, 0., 0.);
                }
            `
        });
    }


    merge_results_displacement_pipeline() {
        const regl = this.regl;
        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                deriv_result_dx: regl.prop('deriv_result_dx'),
                deriv_result_dy: regl.prop('deriv_result_dy'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D deriv_result_dx;
                uniform sampler2D deriv_result_dy;
                varying vec2 v2f_tex_coords;

                void main() {
                    // deriv_result_dx: R = dx/dx, G = dx/dy
                    // deriv_result_dy: R = dy/dx, G = dy/dy
                    vec2 dx_derivs = texture2D(deriv_result_dx, v2f_tex_coords).rg;
                    vec2 dy_derivs = texture2D(deriv_result_dy, v2f_tex_coords).rg;

                    // Output: (dx/dx, dx/dy, dy/dx, dy/dy)
                    gl_FragColor = vec4(dx_derivs.x, dx_derivs.y, dy_derivs.x, dy_derivs.y);
                }
            `
        });
    }


    // Combined derivative spectrum: computes both X and Y derivatives in one pass
    // RG = X derivative complex, BA = Y derivative complex
    deriv_spectrum_combined_pipeline() {
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
                uv_scale: regl.prop('uv_scale'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D spectrum;
                uniform float fft_size;
                uniform float uv_scale;
                varying vec2 v2f_tex_coords;

                const float PI = 3.14159265359;

                void main() {
                    vec2 h = texture2D(spectrum, v2f_tex_coords).rg; // complex spectrum: h = a + ib

                    // Compute k-space coordinates (range: -N/2 ... N/2 - 1)
                    float N = fft_size;
                    vec2 k = floor(v2f_tex_coords * N) - N / 2.0;

                    // Frequency in radians per unit of mesh uv, so the derivatives are
                    // with respect to the mesh coordinates and all cascades can be summed directly
                    k *= 2.0 * PI * uv_scale;

                    // X derivative: multiply by i * kx
                    // i * (a + ib) = -b + ia
                    vec2 derivSpecX = vec2(-h.y, h.x) * k.x;

                    // Y derivative: multiply by i * ky
                    vec2 derivSpecY = vec2(-h.y, h.x) * k.y;

                    // Pack both: RG = X deriv, BA = Y deriv
                    gl_FragColor = vec4(derivSpecX, derivSpecY);
                }
            `
        });
    }

    horizontal_spectrum_pipeline() {
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
                compute_direction: regl.prop('compute_direction'),
                choppiness: regl.prop('choppiness'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;

                uniform sampler2D spectrum;
                uniform float fft_size;
                uniform int compute_direction;   // x = 0, y = 1
                uniform float choppiness;
                varying vec2 v2f_tex_coords;

                const float PI = 3.14159265359;

                void main() {
                    vec2 h = texture2D(spectrum, v2f_tex_coords).rg; // complex spectrum: h = a + ib

                    // Compute k-space coordinates (range: -N/2 ... N/2 - 1)
                    float N = fft_size;
                    vec2 k = floor(v2f_tex_coords * N) - N / 2.0;

                    float k_length = sqrt(k.x*k.x + k.y*k.y);

                    // Avoid division by zero
                    if (k_length < 0.0001) {
                        gl_FragColor = vec4(0.0);
                        return;
                    }

                    float k_dir = (compute_direction == 0) ? k.x : k.y;

                    // Multiply by i * k_dir / |k|:
                    // i * (a + ib) = -b + ia
                    vec2 slopeSpec = vec2(-h.y, h.x) * (k_dir / k_length) * choppiness;

                    gl_FragColor = vec4(slopeSpec, 0.0, 1.0);
                }
            `
        });
    }
}
