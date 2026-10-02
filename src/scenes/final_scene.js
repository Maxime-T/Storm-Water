import * as MATERIALS from "../render/materials.js"
import { cg_mesh_make_uv_sphere } from "../cg_libraries/cg_mesh.js"
import { TurntableCamera } from "../scene_resources/camera.js"
import { ResourceManager } from "../scene_resources/resource_manager.js"

export class FinalScene {

  /**
   * @param {ResourceManager} resource_manager
   */
  constructor(resource_manager){
    this.resource_manager = resource_manager;

    // Scene-specific parameters that can be modified from the UI
    this.ui_params = {};

    // A list of all the objects that will be rendered on the screen
    this.objects = [];

    // A set of key-value pairs, each entry represents an object that evolves with time
    this.actors = {};

    this.camera = new TurntableCamera();

    this.ambient_factor = 0.5;

    this.sun = null;

    this.initialize_scene();
  }

  /**
   * Scene setup
   */
  initialize_scene(){
    const water_center = [0, 0, 1];
    const chunk_size = 10;     // world units, one chunk covers plane_size meters of ocean (see water_displacement_sr.js)
    const chunk_radius = 3;    // grid of (2 * radius + 1)^2 chunks

    this.water_chunks = [];
    for (let i = -chunk_radius; i <= chunk_radius; i++) {
      for (let j = -chunk_radius; j <= chunk_radius; j++) {
        const chunk = {
          translation: [water_center[0] + i * chunk_size, water_center[1] + j * chunk_size, water_center[2]],
          scale: [chunk_size, chunk_size, chunk_size],
          mesh_reference: null,
          material: MATERIALS.water,
          chunk_offset: [i, j],
          ring: Math.max(Math.abs(i), Math.abs(j)),
        };
        this.water_chunks.push(chunk);
        this.objects.push(chunk);
      }
    }
    this.set_lod_resolutions([241, 241, 121, 61]);

    this.resource_manager.add_procedural_mesh("mesh_sphere_env_map", cg_mesh_make_uv_sphere(16));
    this.objects.push({
      translation: [0, 0, 0],
      scale: [80., 80., 80.],
      mesh_reference: 'mesh_sphere_env_map',
      material: MATERIALS.overcast_sky,
    });

    this.sun = {
      direction: [0.7, -1.0, 0.5],
      color: [1.0, 0.95, 0.85]
    };
  }

  /**
   * Sets the mesh of each water chunk from its ring around the center. Each resolution n is a mesh of n x n
   * vertices: n - 1 must divide the finer level's n - 1 so the vertices on shared edges line up, and
   * meshes are limited to 65536 vertices by uint16 indices.
   * @param {number[]} lod_resolutions vertices per side for each ring (the last one is used for the rest)
   */
  set_lod_resolutions(lod_resolutions){
    for (const chunk of this.water_chunks) {
      const n = lod_resolutions[Math.min(chunk.ring, lod_resolutions.length - 1)];
      const name = `water_mesh_${n}`;
      if (!this.resource_manager.resources[name]) {
        this.resource_manager.add_procedural_mesh(name, build_plane(n));
      }
      chunk.mesh_reference = name;
    }
  }

  /**
   * Initialize custom scene-specific UI parameters.
   * This function is called in main() if the scene is active.
   */
  initialize_ui_params(){}

}



function build_plane(n) {

    const vertices = [];
    const faces = [];
    const uvs = [];

    // Map a 2D grid index (x, y) into a 1D index into the output vertex array.
    function xy_to_v_index(x, y) {
        return x*n + y;
    }

    for(let gy = 0; gy < n; gy++) {
        for(let gx = 0; gx < n; gx++) {
            const u = gx / (n - 1);
            const v = gy / (n - 1);
            vertices[xy_to_v_index(gx, gy)] = [u - 0.5, v - 0.5, 0.];
            uvs[xy_to_v_index(gx, gy)] = [u, v];
        }
    }

    for(let gy = 0; gy < n - 1; gy++) {
        for(let gx = 0; gx < n - 1; gx++) {
            // Triangulate the grid cell whose lower lefthand corner is grid index (gx, gy)
            const va = xy_to_v_index(gx, gy);
            const vb = xy_to_v_index(gx+1, gy);
            const vc = xy_to_v_index(gx, gy+1);
            const vd = xy_to_v_index(gx+1, gy+1);

            faces.push([va, vb, vc]);
            faces.push([vb, vd, vc]);
        }
    }

    // Skirt
    const border = [];
    for (let k = 0; k < n - 1; k++) border.push([k, 0]);
    for (let k = 0; k < n - 1; k++) border.push([n - 1, k]);
    for (let k = n - 1; k > 0; k--) border.push([k, n - 1]);
    for (let k = n - 1; k > 0; k--) border.push([0, k]);

    const skirt_start = vertices.length;
    for (const [gx, gy] of border) {
        const top = vertices[xy_to_v_index(gx, gy)];
        vertices.push([top[0], top[1], -1.]);
        uvs.push(uvs[xy_to_v_index(gx, gy)]);
    }
    for (let k = 0; k < border.length; k++) {
        const next = (k + 1) % border.length;
        const top_a = xy_to_v_index(...border[k]);
        const top_b = xy_to_v_index(...border[next]);
        const bottom_a = skirt_start + k;
        const bottom_b = skirt_start + next;
        faces.push([top_a, top_b, bottom_a]);
        faces.push([top_b, bottom_b, bottom_a]);
    }

    return {
        vertex_positions: vertices,
        vertex_normals: vertices.map(() => [0, 0, 1]),  // unused normals
        faces: faces,
        vertex_tex_coords: uvs
    }
}
