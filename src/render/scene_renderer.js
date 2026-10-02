import { FlatColorShaderRenderer } from "./shader_renderers/flat_color_sr.js"
import { ResourceManager } from "../scene_resources/resource_manager.js"
import { WaterShaderRenderer } from "./shader_renderers/water_displacement_sr.js"

export class SceneRenderer {

    /**
     * Create a new scene render to display a scene on the screen
     * @param {*} regl the canvas to draw on
     * @param {ResourceManager} resource_manager
     */
    constructor(regl, resource_manager, quality) {
        this.regl = regl;
        this.resource_manager = resource_manager;

        // Creates the renderer object for each shader kind
        this.flat_color = new FlatColorShaderRenderer(regl, resource_manager);
        this.water = null;
        this.set_quality(quality);
    }

    /**
     * Rebuilds the water simulation with the FFT and foam resolutions of the quality level
     * @param {*} quality one of QUALITY_LEVELS (quality.js)
     */
    set_quality(quality) {
        if (this.water && this.water.size === quality.fft_size && this.water.foam_size === quality.foam_size) return;

        if (this.water) this.water.destroy();
        this.water = new WaterShaderRenderer(this.regl, this.resource_manager, quality.fft_size, quality.foam_size);
    }

    /**
     * Core function to render a scene
     * @param {*} scene_state the description of the scene, time, dynamically modified parameters, etc.
     */
    render(scene_state) {

        const scene = scene_state.scene;
        const frame = scene_state.frame;

        // Update the camera ratio in case the windows size changed
        scene.camera.update_format_ratio(frame.framebufferWidth, frame.framebufferHeight);

        // Compute the objects matrices at the beginning of each frame
        scene.camera.compute_objects_transformation_matrices(scene.objects);

        // Render the water (FFT simulation + displaced surface)
        this.water.render(scene_state);

        // Render the background
        this.flat_color.render(scene_state);
    }
}
