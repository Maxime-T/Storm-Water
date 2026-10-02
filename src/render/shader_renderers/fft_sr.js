import { ResourceManager } from "../../scene_resources/resource_manager.js";
import { ShaderRenderer } from "./shader_renderer.js";

export class FFTShaderRenderer extends ShaderRenderer {
    constructor(regl, resource_manager, size) {
        super(regl, resource_manager, `water_height.vert.glsl`, `water_height.frag.glsl`);

        this.size = size;
        this.fftStages = Math.log2(size);

        this.pingpong = [
            regl.framebuffer({
                color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
                depth: false,
            }),
            regl.framebuffer({
                color: regl.texture({usage: 'stream', width: size, height: size, type: 'float', format: 'rgba', min: 'nearest', mag: 'nearest', wrap: 'clamp'}),
                depth: false,
            }),
        ];

        this.bit_reversal_command = this.bit_reversal_pipeline();
        this.copy_command = this.copy_pipeline();
        this.fft_command = this.fft_pipeline();
        this.pipeline_command = this.init_pipeline();
        this.brute_fourrier_command = this.brute_fourrier();
    }

    render(scene_state, spectrum, mesh_quad_2d) {
        const result = this.compute_fft(spectrum, mesh_quad_2d)

        this.pipeline_command([{
            mesh_quad_2d: mesh_quad_2d,
            final_result: result,
            fft_size: this.size
        }]);
    }

    init_pipeline() {
        const regl = this.regl;

        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            depth: { enable: false },
            blend: false,
            cull: { enable: false },
            stencil: { enable: false },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                final_result: regl.prop('final_result'),
                fft_size: regl.prop('fft_size'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;
                uniform sampler2D final_result;
                uniform float fft_size;
                varying vec2 v2f_tex_coords;

                void main() {
                    // Dual-complex FFT output: RG = first result, BA = second result
                    vec4 texColor = texture2D(final_result, v2f_tex_coords);
                    vec2 k = floor(v2f_tex_coords * fft_size);

                    float sign = mod(floor(k.x) + floor(k.y), 2.0) < 1.0 ? -1.0 : 1.0;

                    // Apply sign flip to both real components
                    float flipped1 = texColor.r * sign;
                    float flipped2 = texColor.b * sign;

                    gl_FragColor = vec4(flipped1, flipped2, 0., 1.);
                }
            `
        });
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
                spectrum: regl.prop('spectrum'),
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;
                uniform sampler2D spectrum;
                varying vec2 v2f_tex_coords;

                void main() {
                    gl_FragColor = texture2D(spectrum, v2f_tex_coords);
                }
            `
        });
    }

    bit_reversal_pipeline() {
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
                spectrum: regl.prop('spectrum'),
                fft_direction: regl.prop('fft_direction'),
                fft_size: regl.prop('fft_size'),
                bits: regl.prop('bits')
            },
            vert: this.vert_shader,
            frag: this.resource_manager.get('water_fft_bit_reversal.frag.glsl'),
        });
    }

    fft_pipeline() {
        const regl = this.regl;
        return regl({
            depth: { enable: false },
            blend: false,
            cull: { enable: false },
            stencil: { enable: false },
            framebuffer: regl.prop('target'),
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                spectrum: regl.prop('spectrum'),
                fft_stage: regl.prop('fft_stage'),
                fft_direction: regl.prop('fft_direction'),
                fft_size: regl.prop('fft_size'),
                fft_max_stage: regl.prop('fft_max_stage')
            },
            vert: this.vert_shader,
            frag: this.frag_shader,
        });
    }

    /**
     * @returns the framebuffer holding the result (one of the two ping-pong buffers)
     */
    compute_fft(input, mesh_quad_2d) {
        let readIndex = 0;
        let writeIndex = 1;

        // Step 1: Bit reversal (horizontal), reading the input directly
        this.bit_reversal_command({
            mesh_quad_2d,
            spectrum: input,
            fft_direction: 0.0,
            fft_size: this.size,
            bits: this.fftStages,
            target: this.pingpong[writeIndex],
        });
        [readIndex, writeIndex] = [writeIndex, readIndex];

        // Step 2: Horizontal FFT passes
        for (let stage = 0; stage < this.fftStages; stage++) {
            this.fft_command({
                mesh_quad_2d,
                spectrum: this.pingpong[readIndex],
                fft_stage: stage,
                fft_direction: 0.0,
                fft_size: this.size,
                fft_max_stage: this.fftStages - 1,
                target: this.pingpong[writeIndex],
            });
            [readIndex, writeIndex] = [writeIndex, readIndex];
        }

        // Step 3: Bit reversal (vertical)
        this.bit_reversal_command({
            mesh_quad_2d,
            spectrum: this.pingpong[readIndex],
            fft_direction: 1.0,
            fft_size: this.size,
            bits: this.fftStages,
            target: this.pingpong[writeIndex],
        });
        [readIndex, writeIndex] = [writeIndex, readIndex];

        // Step 4: Vertical FFT passes
        for (let stage = 0; stage < this.fftStages; stage++) {
            this.fft_command({
                mesh_quad_2d,
                spectrum: this.pingpong[readIndex],
                fft_stage: stage,
                fft_direction: 1.0,
                fft_size: this.size,
                fft_max_stage: this.fftStages - 1,
                target: this.pingpong[writeIndex],
            });
            [readIndex, writeIndex] = [writeIndex, readIndex];
        }

        return this.pingpong[readIndex];
    }

    brute_fourrier() {
        const regl = this.regl;

        return regl({
            attributes: {
                vertex_positions: regl.prop('mesh_quad_2d.vertex_positions'),
            },
            depth: { enable: false },
            blend: false,
            cull: { enable: false },
            stencil: { enable: false },
            elements: regl.prop('mesh_quad_2d.faces'),
            uniforms: {
                final_result: regl.prop('final_result'),
                size: regl.prop('size')
            },
            vert: this.vert_shader,
            frag: `
                precision highp float;
                uniform sampler2D final_result;
                uniform float size;
                varying vec2 v2f_tex_coords;

                const float PI = 3.14159265359;

                void main() {
                    float N = size;
                    vec2 k = floor(v2f_tex_coords * N); // frequency index (kx, ky)

                    vec2 sum = vec2(0.0);
                    for (float y = 0.0; y < 512.0; y++) {
                        if (y >= N) break;
                        for (float x = 0.0; x < 512.0; x++) {
                            if (x >= N) break;

                            vec2 sampleUV = (vec2(x, y) + 0.5) / N;
                            vec2 sample = texture2D(final_result, sampleUV).rg;

                            float angle = -2.0 * PI * (k.x * x + k.y * y) / N;
                            vec2 twiddle = vec2(cos(angle), sin(angle));

                            sum += vec2(
                                sample.x * twiddle.x - sample.y * twiddle.y,
                                sample.x * twiddle.y + sample.y * twiddle.x
                            );
                        }
                    }

                    // Normalize
                    sum /= (N * N);

                    float sign = mod(floor(k.x) + floor(k.y), 2.0) < 1.0 ? -1.0 : 1.0;
                    sum *= sign;

                    gl_FragColor = vec4(sum.x, sum.x, sum.x, 1.0) * 100.;
                    //gl_FragColor = texture2D(final_result, v2f_tex_coords);
                }
            `
        });
    }
}
