
precision highp float;

uniform sampler2D displacement_deriv;
uniform sampler2D displacement_deriv2;
uniform sampler2D displacement_deriv3;
uniform sampler2D prev_foam;
uniform float delta_time;

varying vec2 v2f_tex_coords;
varying vec2 v2f_tex_coords2;
varying vec2 v2f_tex_coords3;
varying vec2 v2f_foam_tex_coords;

// Foam forms where the surface is compressed (jacobian below foam_threshold, 1 = flat water);
// the steady foam amount on a crest is about foam_rate * (foam_threshold - jacobian) / foam_decay
const float foam_threshold = 0.7;
const float foam_rate = 8.;
const float foam_decay = 2.5;


//get horizontal displacement derivatives
vec4 get_displacement_derivatives() {
    vec4 derivatives = vec4(0.);
    derivatives += texture2D(displacement_deriv, v2f_tex_coords);
    derivatives += texture2D(displacement_deriv2, v2f_tex_coords2);
    derivatives += texture2D(displacement_deriv3, v2f_tex_coords3);

    return derivatives;
}

void main() {
    vec4 disp_der = get_displacement_derivatives();
    float det_jacobian = (1.+disp_der.r)*(1.+disp_der.a) - (disp_der.g)*(disp_der.b);
    float foam = max(foam_threshold - det_jacobian, 0.) * foam_rate * delta_time;

    vec4 prev = texture2D(prev_foam, v2f_foam_tex_coords) * exp(-foam_decay * delta_time);

    gl_FragColor = vec4(foam) + prev;
}