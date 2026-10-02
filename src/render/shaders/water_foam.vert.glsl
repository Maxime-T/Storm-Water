// Vertex attributes, specified in the "attributes" entry of the pipeline
attribute vec2 vertex_positions;
attribute vec2 vertex_tex_coords;

varying vec2 v2f_tex_coords;
varying vec2 v2f_tex_coords2;
varying vec2 v2f_tex_coords3;
varying vec2 v2f_foam_tex_coords;

uniform float fft_size;
uniform vec3 cascade_uv_scales;  // how many times each cascade's texture repeats across one chunk
uniform vec4 foam_area;


void main() {
    v2f_foam_tex_coords = (vertex_positions+1.)/2.;
	gl_Position = vec4(vertex_positions, 0.0, 1.0);

	// The foam texture covers the whole grid of chunks
	vec2 ocean_uv = foam_area.xy + v2f_foam_tex_coords * foam_area.zw;

	v2f_tex_coords = ocean_uv * cascade_uv_scales.x + 0.5/fft_size;
	v2f_tex_coords2 = ocean_uv * cascade_uv_scales.y + 0.5/(fft_size/2.);
	v2f_tex_coords3 = ocean_uv * cascade_uv_scales.z + 0.5/(fft_size/4.);
}