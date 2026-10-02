import { ResourceManager } from "../../scene_resources/resource_manager.js";
import { ShaderRenderer } from "./shader_renderer.js";

export class WaterSpectrumShaderRenderer extends ShaderRenderer {
    constructor(regl, resource_manager, size) {
        super(regl, resource_manager, `water_spectrum.vert.glsl`, `water_spectrum.frag.glsl`);

        this.size = size;

        this.first_spectrum = regl.framebuffer({
            color: regl.texture({ width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
            depth: false,
        })

        this.spectrum_command = this.spectrum_pipeline();
        this.initialized = false;
    }

    render(scene_state, mesh_quad_2d, cascade) {

        // The initial spectrum is computed once, on the first render (also after a quality change)
        const first = !this.initialized;
        this.initialized = true;
        if (first) {
            this.draw_in(this.first_spectrum, () => {
                this.spectrum_command([{
                    ...cascade,
                    mesh_quad_2d: mesh_quad_2d,
                    fft_size: this.size,
                    time: 0,
                    first_spectrum: this.regl.texture(), // dummy, not used
                    first: true,
                }]);
            });
        }

        this.spectrum_command([{
            ...cascade,
            mesh_quad_2d: mesh_quad_2d,
            fft_size: this.size,
            time: scene_state.time, // stops while paused
            first_spectrum: this.first_spectrum, // Reuse the first spectrum
            first: first,
        }]);
    }


    spectrum_pipeline() {
        const regl = this.regl;

        return regl({

            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions')
            },

            elements: regl.prop('mesh_quad_2d.faces'),

            uniforms: {
                time: regl.prop('time'),
                first_spectrum: regl.prop('first_spectrum'),
                first: regl.prop('first'),
                fft_size: regl.prop('fft_size'),

                tile_length: regl.prop('tile_length'),
                k_min: regl.prop('k_min'),
                k_max: regl.prop('k_max'),
                amplitude_scale: regl.prop('amplitude_scale'),
                seed: regl.prop('seed'),

                alpha: regl.prop('alpha'),
                peak_omega: regl.prop('peak_omega'),
                gamma: regl.prop('gamma'),
                wind_direction: regl.prop('wind_direction'),
                wind_alignment: regl.prop('wind_alignment'),
            },

            vert: this.vert_shader,
            frag: this.frag_shader,
        });
    }
}
