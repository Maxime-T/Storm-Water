import { createREGL } from "../lib/regljs_2.1.0/regl.module.js"

// UI functions
import {
  DOM_loaded_promise,
  clear_overlay,
  create_hotkey_action,
  create_slider,
  toggle_overlay_visibility
} from "./cg_libraries/cg_web.js"

import { QUALITY_LEVELS, load_quality_level, save_quality_level } from "./quality.js"

// Render
import { SceneRenderer } from "./render/scene_renderer.js"
import { ResourceManager } from "./scene_resources/resource_manager.js"

// Scenes
import { FinalScene } from "./scenes/final_scene.js";

DOM_loaded_promise.then(main)

async function main() {

  /*---------------------------------------------------------------
    1. Canvas Setup
  ---------------------------------------------------------------*/

  // REGL creates their own canvas
  const regl = createREGL({
    profile: true, // Can be useful to measure the size of buffers/textures in memory
    extensions: [  // Activate some WebGL extensions to access advanced features that are not part of the core WebGL specification
      'OES_texture_float', 'OES_texture_float_linear', 'WEBGL_color_buffer_float',
      'OES_vertex_array_object', 'OES_element_index_uint', 'WEBGL_depth_texture'
    ],
  })

  let quality_level = load_quality_level();

  // The <canvas> object (HTML element for drawing graphics) was created by REGL: we take a handle to it
  const canvas_elem = document.getElementsByTagName('canvas')[0]
  // Resize canvas to fit the window. Lower qualities render less pixels, the canvas is stretched to the window
  function resize_canvas() {
    const scale = QUALITY_LEVELS[quality_level].render_scale;
    canvas_elem.width = Math.round(window.innerWidth * scale)
    canvas_elem.height = Math.round(window.innerHeight * scale)
  }
  resize_canvas()
  window.addEventListener('resize', resize_canvas)

  /*---------------------------------------------------------------
    2. UI Setup
  ---------------------------------------------------------------*/

  /**
   * Object used to propagate parameters that the user can change in the interface.
   * Define here your parameters.
   */
  const ui_global_params = {
    is_paused: false,
  }

  function initialize_ui_params(){

    // Bind a hotkey to hide the overlay
    create_hotkey_action("Hide overlay", "h", ()=>{toggle_overlay_visibility()});

    // Create a pause button
    create_hotkey_action("Pause", "p", () => {
      ui_global_params.is_paused = !ui_global_params.is_paused;
    });

    const quality_title = (level) => `Quality: ${QUALITY_LEVELS[level].name}`;
    const quality_text = create_slider(quality_title(quality_level), [0, QUALITY_LEVELS.length - 1], (value) => {
      set_quality(parseInt(value));
      quality_text.textContent = quality_title(quality_level);
    }, quality_level);
    quality_text.classList.add("slider-label-fixed");

  }

  function set_quality(level) {
    quality_level = level;
    save_quality_level(level);
    resize_canvas();
    active_scene.set_lod_resolutions(QUALITY_LEVELS[level].lod_resolutions);
    scene_renderer.set_quality(QUALITY_LEVELS[level]);
  }

  /*---------------------------------------------------------------
    3. Camera Listeners
  ---------------------------------------------------------------*/

  // Rotate camera position by dragging with the mouse
  canvas_elem.addEventListener('mousemove', (event) => {
    // If left or middle button is pressed
    if (event.buttons & 1) {
      active_scene.camera.rotate_action(event.movementX, event.movementY);
    }
    else if (event.buttons & 4) {
      active_scene.camera.move_action(event.movementX, event.movementY);
    }
  })

  // zoom
  canvas_elem.addEventListener('wheel', (event) => {
    active_scene.camera.zoom_action(event.deltaY);
  })

  /*---------------------------------------------------------------
    4. Resources and Scene Instantiation
  ---------------------------------------------------------------*/

  // Instantiate the resources manager
  const resource_manager = await new ResourceManager(regl).load_resources();

  // Instantiate the scene renderer, i.e. the entry point for rendering a scene
  const scene_renderer = new SceneRenderer(regl, resource_manager, QUALITY_LEVELS[quality_level]);

  const active_scene = new FinalScene(resource_manager);
  active_scene.set_lod_resolutions(QUALITY_LEVELS[quality_level].lod_resolutions);

  /*---------------------------------------------------------------
    5. UI Instantiation
  ---------------------------------------------------------------*/

  clear_overlay();
  initialize_ui_params();  // add general UI controls
  active_scene.initialize_ui_params();  // add scene-specific UI controls

  /*---------------------------------------------------------------
    6. Rendering Loop
  ---------------------------------------------------------------*/

  // Time variable
  let dt = 0;
  let prev_regl_time = 0;
  // Simulation time: only advances while not paused (use it instead of frame.time for anything animated)
  let sim_time = 0;

  regl.frame((frame) => {

    // Reset canvas
    const background_color = [0.0, 0.0, 0.0, 1];
    regl.clear({ color: background_color, depth: 1 });

    /*---------------------------------------------------------------
      Update the current frame data
    ---------------------------------------------------------------*/

    // Compute the time elapsed since last frame
    dt = frame.time - prev_regl_time;
    prev_regl_time = frame.time;

    const sim_dt = ui_global_params.is_paused ? 0 : dt;
    sim_time += sim_dt;

    // If the time is not paused, iterate over all actors and call their evolve function
    if (!ui_global_params.is_paused){
      for (const name in active_scene.actors){
        active_scene.actors[name].evolve(dt);
      }
    }

    // The scene state contains all information necessary to render the scene in this frame
    const scene_state = {
      scene: active_scene,
      frame: frame,
      time: sim_time,   // stops while paused
      dt: sim_dt,       // 0 while paused
      background_color: background_color,
      ui_params: { ...ui_global_params, ...active_scene.ui_params },
    }

    /*---------------------------------------------------------------
      Render the scene
    ---------------------------------------------------------------*/

    scene_renderer.render(scene_state);

  })


}
