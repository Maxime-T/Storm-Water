attribute vec3 vertex_positions;
attribute vec2 vertex_tex_coords;

varying vec3 v2f_frag_pos;
varying vec3 v2f_normal;
varying vec2 v2f_tex_coords;
varying vec2 v2f_tex_coords2;
varying vec2 v2f_tex_coords3;
varying vec2 v2f_foam_uv;
varying vec2 v2f_ocean_uv;
varying float v2f_wave_height;

uniform mat4 mat_model_view;
uniform mat4 mat_model_view_projection;
uniform mat3 mat_normals_model_view;

uniform sampler2D heightmap;
uniform sampler2D deriv;

uniform sampler2D heightmap2;
uniform sampler2D deriv2;

uniform sampler2D heightmap3;
uniform sampler2D deriv3;

uniform float fft_size;
uniform float plane_size;        // meters covered by one chunk
uniform vec3 cascade_uv_scales;  // how many times each cascade's texture repeats across one chunk
uniform vec2 chunk_offset;
uniform vec4 foam_area;          // xy = first chunk of the grid, zw = number of chunks covered by the foam texture

const float skirt_depth = 0.1;

vec3 get_displacement(sampler2D _heightmap, vec2 uv) {
	vec4 heightmap_color = texture2D(_heightmap, uv);
	float height = heightmap_color.r;
	float x_displacement = heightmap_color.g;
	float y_displacement = heightmap_color.b;
	return vec3(x_displacement, y_displacement, height);
}


void main() {
	vec2 ocean_uv = vertex_tex_coords + chunk_offset;
	v2f_ocean_uv = ocean_uv;
	v2f_foam_uv = (ocean_uv - foam_area.xy) / foam_area.zw;

	// The value at position j/N of a cascade is stored at the center of texel j, so shift by half a texel
	v2f_tex_coords = ocean_uv * cascade_uv_scales.x + 0.5/fft_size;
	v2f_tex_coords2 = ocean_uv * cascade_uv_scales.y + 0.5/(fft_size/2.);
	v2f_tex_coords3 = ocean_uv * cascade_uv_scales.z + 0.5/(fft_size/4.);

	vec3 displacement = vec3(0);
	displacement += get_displacement(heightmap, v2f_tex_coords);
	displacement += get_displacement(heightmap2, v2f_tex_coords2);

	// Skirt vertices (z = -1) follow the edge they hang from, lowered by skirt_depth
	float skirt = -vertex_positions.z;
	vec4 position_v4 = vec4(vertex_positions.xy, -skirt * skirt_depth, 1) + vec4(displacement, 0);

	v2f_wave_height = displacement.z * plane_size;

	gl_Position = mat_model_view_projection * position_v4;

	v2f_frag_pos = (mat_model_view * vec4(position_v4)).xyz;
}