attribute vec2 vertex_positions;

varying vec2 v2f_tex_coords;

void main() {
	vec2 local_coord = (vertex_positions+1.)/2.;
	v2f_tex_coords = local_coord;

	gl_Position = vec4(vertex_positions, 0.0, 1.0);
}
