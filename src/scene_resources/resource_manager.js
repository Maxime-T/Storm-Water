import { cg_mesh_load_obj_into_regl, mesh_upload_to_buffer } from "../cg_libraries/cg_mesh.js"
import { load_text, load_texture } from "../cg_libraries/cg_web.js"

export class ResourceManager{

    /**
     * This class handles all the resources need by the render process
     * - shader file content
     * - mesh description
     * - texture data
     * - heigth map
     * @param {*} regl
     */
    constructor(regl){
        this.regl = regl;
        this.resources = null;
    }

    /**
     * Function to call right after creation. It will start loading
     * all the wanted resources from the folder
     * @returns
     */
    async load_resources(){
        const regl = this.regl;

        const path_to_meshes_folder = './assets/meshes';
        const path_to_textures_folder = "./assets/textures";
        const path_to_shaders_folder = './src/render/shaders';

        // Start downloads in parallel
        const resource_promises = {};

        // load textures
        for (const texture_name of this.textures_to_load()) {
            resource_promises[texture_name] = load_texture(regl, `${path_to_textures_folder}/${texture_name}`);
        }
        // load shaders
        for (const shader_name of this.shaders_to_load()) {
            resource_promises[shader_name] = load_text(`${path_to_shaders_folder}/${shader_name}`);
        }
        // load meshes
        for (const mesh_name of this.meshes_to_load()) {
          resource_promises[mesh_name] = cg_mesh_load_obj_into_regl(regl, `${path_to_meshes_folder}/${mesh_name}`);
        }

        // Wait for all downloads to complete
        const resources = {}
        for (const [key, promise] of Object.entries(resource_promises)) {
            resources[key] = await promise;
        }

        this.resources = resources;
        return this;
    }

    /**
     * Get the shader_name shader data from the resources
     * @param {*} shader_name
     * @returns the shader_name file content
     */
    get_shader(shader_name){
        return this.get(shader_name);
    }

    /**
     * Test wether this mesh exists in the resources and returns it
     * @param {*} mesh_reference
     * @returns
     */
    get_mesh(mesh_reference){
        return this.get(mesh_reference);
    }

    /**
     * Test wether this texture exists in the resources and returns it
     * @param {*} texture_name
     * @returns
     */
    get_texture(texture_name){
      return this.get(texture_name);
    }

    /**
     * Try to get a resource based on its name
     * @param {*} name the name of the resource to get
     * @returns
     */
    get(name){
        if(!name){
          throw new Error(`Bad resource name ${name}`);
        }

        const resource_content = this.resources[name]
        if(!resource_content){
            throw new ReferenceError(`No resource "${resource_content}"`+
                " 1. check the name is correct" +
                " 2. check the file is correctly loaded"
            );
        }
        return resource_content;
    }

    /**
     * Add a newly computed mesh to this resources manager
     * @param {*} name the name that will be used to retrieve the mesh data
     * @param {*} mesh the vertices, normals, faces, uv_coord arrays
     */
    add_procedural_mesh(name, mesh){
      this.resources[name] = mesh_upload_to_buffer(this.regl, mesh);
    }

    /**
     * Fetch the height map from the resources array
     * @param {*} heigtmap_name
     * @returns
     */
    get_heightmap(heigtmap_name){
      return this.get(heigtmap_name);
    }

    // Resources to be loaded

    textures_to_load(){
        return [
            'overcast_soil_puresky.jpg',
          ];
    }

    shaders_to_load(){
        return [
            'flat_color.vert.glsl', 'flat_color.frag.glsl',

            'water_spectrum.vert.glsl', 'water_spectrum.frag.glsl',
            'water_height.vert.glsl', 'water_height.frag.glsl',
            'water_fft_bit_reversal.frag.glsl',
            'water_displacement.vert.glsl', 'water_displacement.frag.glsl',
            'water_foam.vert.glsl', 'water_foam.frag.glsl',
          ];
    }

    meshes_to_load() {
        return [];
    }

}
