
import { ShaderRenderer } from "./shader_renderer.js"
import { WaterDerivShaderRenderer } from "./water_derivatives_sr.js";
import { WaterHeightShaderRenderer } from "./water_height_sr.js"
import { WaterSpectrumShaderRenderer } from "./water_spectrum_sr.js";
import { WaterFoamShaderRenderer } from "./water_foam_sr.js";

/**
 * Wraps regl so that every buffer, texture and framebuffer created through it is recorded
 * in `resources`, to be able to free them all with destroy().
 */
function track_resources(regl, resources) {
    const tracked = ['buffer', 'elements', 'texture', 'framebuffer'];
    return new Proxy(regl, {
        get(target, property) {
            if (tracked.includes(property)) {
                return (...args) => {
                    const resource = target[property](...args);
                    resources.push(resource);
                    return resource;
                };
            }
            return target[property];
        },
    });
}


export class WaterShaderRenderer extends ShaderRenderer {

    /**
     * @param {*} untracked_regl
     * @param {ResourceManager} resource_manager
     * @param {number} size resolution of the first cascade's FFT (power of two)
     * @param {number} foam_size resolution of the foam texture
     */
    constructor(untracked_regl, resource_manager, size, foam_size){
        const resources = [];
        const regl = track_resources(untracked_regl, resources);
        super(
            regl,
            resource_manager,
            `water_displacement.vert.glsl`,
            `water_displacement.frag.glsl`
        );

        this.resources = resources;
        this.size = size;
        this.foam_size = foam_size;

        // Ocean parameters, in meters and seconds

        // Physical size covered by one water chunk (its uv go from 0 to 1)
        this.plane_size = 50.;

        // JONSWAP spectrum from the wind: stronger wind / longer fetch = bigger and longer waves.
        // The dominant wavelength must stay well below the first cascade's length (130 m),
        // otherwise the biggest waves can't be simulated and the water gets flatter
        const wind_speed = 25.;  // m/s
        const fetch = 40000.;    // distance over which the wind has been blowing (m)
        const wind_angle = 0.;   // direction the wind blows towards (radians, 0 = +x)
        const wind_alignment = 0.75;  // 0 = waves in all directions, 1 = all waves follow the wind

        // Stylization (1 = physical)
        const height_scale = 1.45;
        this.choppiness = 1.2;     // horizontal displacement: sharper crests, wider troughs, more foam

        const G = 9.81;
        const spectrum_params = {
            alpha: 0.076 * Math.pow(wind_speed * wind_speed / (fetch * G), 0.22),
            peak_omega: 22. * Math.pow(G * G / (wind_speed * fetch), 1. / 3.),
            gamma: 3.3,
            wind_direction: [Math.cos(wind_angle), Math.sin(wind_angle)],
            wind_alignment: wind_alignment,
        };
        const peak_wavelength = 2. * Math.PI * G / (spectrum_params.peak_omega * spectrum_params.peak_omega);

        if (peak_wavelength > 100.) {
            console.warn(`Dominant wavelength ${peak_wavelength.toFixed(0)} m is too long for the first cascade, lower the fetch or wind speed`);
        }

        this.cascades = [
            { size: size,     length: 130. },
            { size: size / 2, length: 23. },
            { size: size / 4, length: 5.7 },   // ripples (normals and foam only, too small for the mesh)
        ];

        // Band boundaries: cascade i keeps the waves that are too small for cascade i-1,
        // starting a few wavelengths above its own tile size
        const boundary = (cascade) => 2. * Math.PI / cascade.length * 6.;
        this.cascades.forEach((cascade, i) => {
            cascade.uv_scale = this.plane_size / cascade.length;
            cascade.uniforms = {
                ...spectrum_params,
                tile_length: cascade.length,
                k_min: i == 0 ? 0. : boundary(this.cascades[i]),
                k_max: i == this.cascades.length - 1 ? 1e9 : boundary(this.cascades[i + 1]),
                // the inverse FFT divides by size^2, and heights are converted from meters to mesh units
                amplitude_scale: cascade.size * cascade.size / this.plane_size * height_scale,
                seed: i * 101.,
            };
        });
        this.cascade_uv_scales = this.cascades.map(c => c.uv_scale);

        this.shader_renderers = [];
        this.buffers = [];
        for (const cascade of this.cascades) {
            const n = cascade.size;
            let spectrum_sr = new WaterSpectrumShaderRenderer(regl, resource_manager, n);
            let height_sr = new WaterHeightShaderRenderer(regl, resource_manager, n, this.choppiness);
            let deriv_sr = new WaterDerivShaderRenderer(regl, resource_manager, n, cascade.uv_scale, this.choppiness);
            this.shader_renderers.push([spectrum_sr, height_sr, deriv_sr]);

            let spectrum = regl.framebuffer({
                color: regl.texture({usage: 'stream', width: n, height: n, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'repeat'}),
                depth: false,
            })

            let heightmap_buffer = regl.framebuffer({
                color: regl.texture({usage: 'stream', width: n, height: n, type: 'float', format: 'rgba', min: 'linear', mag: 'linear', wrap: 'repeat'}),
                depth: false,
            })

            let height_deriv_buffer = regl.framebuffer({
                color: regl.texture({usage: 'stream', width: n, height: n, type: 'float', format: 'rgba', min: 'linear', mag: 'linear', wrap: 'repeat'}),
                depth: false,
            })

            let displacement_deriv_buffer = regl.framebuffer({
                color: regl.texture({usage: 'stream', width: n, height: n, type: 'float', format: 'rgba', min: 'linear', mag: 'linear', wrap: 'repeat'}),
                depth: false,
            })

            this.buffers.push([spectrum, heightmap_buffer, height_deriv_buffer, displacement_deriv_buffer]);
        }

        // Uploaded once: with plain arrays, regl would upload the quad again for every pass
        const quad = this.create_mesh_quad();
        this.mesh_quad_2d = {
            vertex_positions: regl.buffer(quad.vertex_positions),
            faces: regl.elements(quad.faces),
        };

        this.foam_sr = new WaterFoamShaderRenderer(regl, resource_manager, size, foam_size, this.cascade_uv_scales);
        // The foam of the previous frame is read from one buffer while the new one is written in the other,
        // then they are swapped
        this.foam_buffers = [0, 1].map(() => regl.framebuffer({
            color: regl.texture({usage: 'stream', width: foam_size, height: foam_size, type: 'float', format: 'rgba', min: 'linear', mag: 'linear', wrap: 'repeat'}),
            depth: false,
        }));
        this.foam_buffer = this.foam_buffers[0];
    }

    /**
     * Frees all the GPU memory of this renderer (it can't be used afterwards)
     */
    destroy(){
        for (const resource of this.resources) {
            resource.destroy();
        }
        this.resources = [];
    }

    /**
     * Render the objects of the scene_state with its shader
     * @param {*} scene_state
     */
    render(scene_state){

        for (let i = 0; i < this.cascades.length; i++) {
            this.render_cascade(scene_state, i);
        }

        // The foam texture is stretched over the whole grid of water chunks
        const water_chunks = scene_state.scene.objects.filter(obj => !this.exclude_object(obj));
        const offsets = water_chunks.map(obj => obj.chunk_offset || [0, 0]);
        const first = [Math.min(...offsets.map(o => o[0])), Math.min(...offsets.map(o => o[1]))];
        const last = [Math.max(...offsets.map(o => o[0])), Math.max(...offsets.map(o => o[1]))];
        const foam_area = [first[0], first[1], last[0] - first[0] + 1, last[1] - first[1] + 1];

        //update sea foam
        const prev_foam_buffer = this.foam_buffer;
        this.foam_buffer = this.foam_buffers[this.foam_buffer === this.foam_buffers[0] ? 1 : 0];
        this.draw_in(this.foam_buffer, () => {
            //passing diplacement derivatives of each cascade
            this.foam_sr.render(scene_state, this.mesh_quad_2d, this.buffers[0][3], this.buffers[1][3], this.buffers[2][3], prev_foam_buffer, foam_area)
        });

        const scene = scene_state.scene;
        const inputs = [];

        const sky = scene.objects.find(obj => obj.material.properties.includes("environment"));
        const sky_texture = this.resource_manager.get_texture(sky.material.texture);

        for (const obj of scene.objects) {

            if(this.exclude_object(obj)) continue;

            const mesh = this.resource_manager.get_mesh(obj.mesh_reference);

            const {
                mat_model_view,
                mat_model_view_projection,
                mat_normals_model_view
            } = scene.camera.object_matrices.get(obj);


            inputs.push({
                mesh: mesh,

                light_direction: scene.sun.direction,
                light_color: scene.sun.color,
                material_base_color: obj.material.color,
                material_shininess: obj.material.shininess,
                ambient_factor : scene.ambient_factor,

                mat_model_view_projection: mat_model_view_projection,
                mat_model_view: mat_model_view,
                mat_normals_model_view: mat_normals_model_view,
                mat_view: scene.camera.mat.view,

                sky_texture: sky_texture,
                sky_center: sky.translation,
                sky_radius: sky.scale[0],

                heightmap: this.buffers[0][1],
                deriv: this.buffers[0][2],
                displacement_deriv: this.buffers[0][3],

                heightmap2: this.buffers[1][1],
                deriv2: this.buffers[1][2],
                displacement_deriv2: this.buffers[1][3],

                heightmap3: this.buffers[2][1],
                deriv3: this.buffers[2][2],
                displacement_deriv3: this.buffers[2][3],

                foam: this.foam_buffer,

                fft_size: this.size,
                plane_size: this.plane_size,
                cascade_uv_scales: this.cascade_uv_scales,
                chunk_offset: obj.chunk_offset || [0, 0],
                foam_area: foam_area,
            });
        }

        this.pipeline(inputs);
    }

    render_cascade(scene_state, i) {
        let [spectrum, heightmap_buffer, height_deriv_buffer, displacement_deriv_buffer] = this.buffers[i];
        let [spectrum_sr, height_sr, deriv_sr] = this.shader_renderers[i];

        //compute the frequency spectrum representation of the waves
        this.draw_in(spectrum, () => {
            spectrum_sr.render(scene_state, this.mesh_quad_2d, this.cascades[i].uniforms)
        });

        //apply IFFT on spectrum to retreive spatial representaion of waves (height, displacement in x direction, displacement in y direction)
        this.draw_in(heightmap_buffer, () => {
            height_sr.render(scene_state, spectrum, this.mesh_quad_2d)
        });

        //compute the x and y derivatives of the height by using frequency derivation then using IFFT
        this.draw_in(height_deriv_buffer, () => {
            deriv_sr.render(scene_state, spectrum, this.mesh_quad_2d, 1)
        });

        //same but for the x and y derivatives of the x and y displacement (x/dx, x/dy, y/dx, y/dy)
        this.draw_in(displacement_deriv_buffer, () => {
            deriv_sr.render(scene_state, spectrum, this.mesh_quad_2d, 0)
        });
    }

    exclude_object(obj){
        // We only consider object that have a water material
        return !obj.material.properties.includes("water");
    }

    depth(){
        return {
            enable: true,
            mask: true,
            func: '<=',
        };
    }

    uniforms(regl){
        return {
            light_direction: regl.prop('light_direction'),
            light_color: regl.prop('light_color'),
            material_base_color: regl.prop('material_base_color'),
            material_shininess: regl.prop('material_shininess'),
            ambient_factor: regl.prop('ambient_factor'),

            // View (camera) related matrix
            mat_model_view_projection: regl.prop('mat_model_view_projection'),
            mat_model_view: regl.prop('mat_model_view'),
            mat_normals_model_view: regl.prop('mat_normals_model_view'),
            mat_view: regl.prop('mat_view'),

            sky_texture: regl.prop('sky_texture'),
            sky_center: regl.prop('sky_center'),
            sky_radius: regl.prop('sky_radius'),

            heightmap: regl.prop('heightmap'),
            deriv: regl.prop('deriv'),
            displacement_deriv: regl.prop('displacement_deriv'),

            heightmap2: regl.prop('heightmap2'),
            deriv2: regl.prop('deriv2'),
            displacement_deriv2: regl.prop('displacement_deriv2'),

            heightmap3: regl.prop('heightmap3'),
            deriv3: regl.prop('deriv3'),
            displacement_deriv3: regl.prop('displacement_deriv3'),

            foam: regl.prop('foam'),

            fft_size: regl.prop('fft_size'),
            plane_size: regl.prop('plane_size'),
            cascade_uv_scales: regl.prop('cascade_uv_scales'),
            chunk_offset: regl.prop('chunk_offset'),
            foam_area: regl.prop('foam_area'),
        };
    }

    /**
     * Create the simple square mesh on which a texture can be displayed
     * @returns
     */
    create_mesh_quad(){
        return {
            vertex_positions: [
                // 4 vertices with 2 coordinates each
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
            ],
            faces: [
                [0, 1, 2], // top right
                [0, 2, 3], // bottom left
            ],
        };
    }

    copy_pipeline() {
        const regl = this.regl;
        return regl({
            framebuffer: regl.prop('target'),
            depth: { enable: false },
            blend: false,
            cull: { enable: false },
            stencil: { enable: false },
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                source: regl.prop('source'),
            },
            vert: `
                attribute vec2 vertex_positions;
                varying vec2 v2f_tex_coords;

                void main() {
                    v2f_tex_coords = (vertex_positions+1.)/2.;

                    gl_Position = vec4(vertex_positions, 0.0, 1.0);
                }
            `,
            frag: `
                precision highp float;
                uniform sampler2D source;
                varying vec2 v2f_tex_coords;

                void main() {
                    gl_FragColor = texture2D(source, v2f_tex_coords);
                }
            `
        });
    }

    get_heightmaps() {
        return [this.buffers[0][1], this.buffers[1][1], this.buffers[2][1]]
    }

}

