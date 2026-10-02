precision mediump float;

// Texture coordinates passed from vertex shader
varying vec2 v2f_uv;

// Global variables specified in "uniforms" entry of the pipeline
uniform sampler2D material_texture; // Texture to sample color from
uniform bool is_textured;
uniform vec3 material_base_color;

// Sky color at sphere coordinates uv (v = 0 at the top, 0.5 at the horizon). Below the horizon the
// texture shows the ground, so it is replaced by fog: the horizon color averaged over a wide angle,
// fading to the average of the whole horizon further down.
// (identical in flat_color.frag.glsl and water_displacement.frag.glsl, so the fog matches the sky)
const float horizon_v = 0.4936;  // acos(0.02) / pi

vec3 sky_color(sampler2D sky, vec2 uv) {
    vec3 local_horizon = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        local_horizon += texture2D(sky, vec2(fract(uv.x + (float(i) - 3.5) * 0.03), horizon_v)).rgb;
    }
    local_horizon /= 8.0;

    vec3 whole_horizon = vec3(0.0);
    for (int i = 0; i < 16; i++) {
        whole_horizon += texture2D(sky, vec2((float(i) + 0.5) / 16.0, horizon_v)).rgb;
    }
    whole_horizon /= 16.0;

    vec3 fog = mix(local_horizon, whole_horizon, smoothstep(horizon_v, horizon_v + 0.15, uv.y));
    vec3 above = texture2D(sky, vec2(uv.x, min(uv.y, horizon_v))).rgb;
    return mix(above, fog, smoothstep(horizon_v - 0.02, horizon_v + 0.02, uv.y));
}

void main()
{
    vec3 material_color = material_base_color;

    // check wether the color to display is a base color or comes from a texture
    if (is_textured){
        material_color = sky_color(material_texture, v2f_uv);
    }

	gl_FragColor = vec4(material_color, 1.); // output: RGBA in 0..1 range
}