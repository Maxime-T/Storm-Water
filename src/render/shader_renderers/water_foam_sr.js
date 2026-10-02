import { ResourceManager } from "../../scene_resources/resource_manager.js";
import { ShaderRenderer } from "./shader_renderer.js";

export class WaterFoamShaderRenderer extends ShaderRenderer {
    constructor(regl, resource_manager, size, foam_size, cascade_uv_scales) {
        super(regl, resource_manager, `water_foam.vert.glsl`, `water_foam.frag.glsl`);

        this.size = size;
        this.cascade_uv_scales = cascade_uv_scales;

        this.foam_command = this.foam_pipeline();
    }

    /**
     * @param {number[]} foam_area first chunk of the grid (xy) and number of chunks covered (zw)
     */
    render(scene_state, mesh_quad_2d, displacement_deriv, displacement_deriv2, displacement_deriv3, prev_foam, foam_area) {
        // Simulation time step (0 while paused: the foam neither grows nor fades).
        // Clamped so a frame hitch (or switching tabs) doesn't inject a burst of foam
        const delta_time = Math.min(scene_state.dt, 0.1);
        this.foam_command([{
            mesh_quad_2d: mesh_quad_2d,
            displacement_deriv: displacement_deriv,
            displacement_deriv2: displacement_deriv2,
            displacement_deriv3: displacement_deriv3,
            fft_size: this.size,
            cascade_uv_scales: this.cascade_uv_scales,
            prev_foam: prev_foam,
            delta_time: delta_time,
            foam_area: foam_area,
        }]);
    }


    foam_pipeline() {
        const regl = this.regl;
        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions')
            },

            elements: regl.prop('mesh_quad_2d.faces'),
            
            uniforms: {
                displacement_deriv: regl.prop('displacement_deriv'),
                displacement_deriv2: regl.prop('displacement_deriv2'),
                displacement_deriv3: regl.prop('displacement_deriv3'),
                fft_size: regl.prop('fft_size'),
                cascade_uv_scales: regl.prop('cascade_uv_scales'),
                prev_foam: regl.prop('prev_foam'),
                delta_time: regl.prop('delta_time'),
                foam_area: regl.prop('foam_area'),
            },

            vert: this.vert_shader,
            frag: this.frag_shader,
        });
    }
}
