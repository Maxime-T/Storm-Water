precision highp float;

uniform vec3 light_color;
uniform vec3 light_direction; // world space
uniform float ambient_factor;
uniform sampler2D deriv;
uniform sampler2D displacement_deriv;
uniform sampler2D deriv2;
uniform sampler2D displacement_deriv2;
uniform sampler2D deriv3;
uniform sampler2D displacement_deriv3;
uniform mat3 mat_normals_model_view;
uniform mat4 mat_view;

uniform sampler2D foam;
uniform sampler2D sky_texture;
uniform vec3 sky_center;
uniform float sky_radius;
uniform vec4 foam_area;    // xy = first chunk of the grid, zw = number of chunks

varying vec3 v2f_frag_pos;
varying vec2 v2f_tex_coords;
varying vec2 v2f_tex_coords2;
varying vec2 v2f_tex_coords3;
varying vec2 v2f_foam_uv;
varying vec2 v2f_ocean_uv;
varying float v2f_wave_height;

const vec3 deep_water_color = vec3(0.008, 0.055, 0.08);
const vec3 shallow_scatter_color = vec3(0.03, 0.13, 0.15);
const vec3 foam_color = vec3(0.85, 0.88, 0.9);
const float shininess = 150.0; // very glossy for water
const vec3 F0 = vec3(0.02);    // low reflectivity at normal incidence
const float PI = 3.14159265359;

// Fog: the water fades into the sky around the edge of the grid of chunks, and a light haze with distance
const float fog_edge_start = 0.6;   // fraction of the grid's half size where the edge fade starts
const float fog_edge_end = 0.95;    // fully faded (circular, so the corners are hidden too)
const float haze_density = 0.004;   // per world unit from the camera

// Fake subsurface scattering
const vec3 sss_color = vec3(0.08, 0.32, 0.28);
const float sss_backlight_strength = 1.5;
const float sss_view_strength = 0.15;
const float sss_diffuse_strength = 0.1;

//get heightmap derivatives
vec2 get_derivatives() {
    vec2 derivatives = vec2(0.);
    derivatives += texture2D(deriv, v2f_tex_coords).xy;
    derivatives += texture2D(deriv2, v2f_tex_coords2).xy;
    derivatives += texture2D(deriv3, v2f_tex_coords3).xy;

    return derivatives;
}

//get horizontal displacement derivatives
vec4 get_displacement_derivatives() {
    vec4 derivatives = vec4(0.);
    derivatives += texture2D(displacement_deriv, v2f_tex_coords);
    derivatives += texture2D(displacement_deriv2, v2f_tex_coords2);
    derivatives += texture2D(displacement_deriv3, v2f_tex_coords3);

    return derivatives;
}

vec3 get_normal(vec2 height_derivatives, vec4 disp_der) {
    vec3 tangent1 = vec3(1.+disp_der.r, disp_der.b, height_derivatives.x);
    vec3 tangent2 = vec3(disp_der.g, 1.+disp_der.a, height_derivatives.y);

    vec3 n = cross(tangent1, tangent2);
    return normalize(mat_normals_model_view * n);
}

vec3 fresnel_schlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// Transform a direction from camera space back to world space
// (the inverse of the view rotation is its transpose)
vec3 view_to_world_dir(vec3 d) {
    return vec3(dot(mat_view[0].xyz, d), dot(mat_view[1].xyz, d), dot(mat_view[2].xyz, d));
}

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

vec2 sky_uv(vec3 dir) {
    vec3 d = normalize(dir);
    float u = atan(d.y, d.x) / (2.0 * PI);
    if (u < 0.0) u += 1.0;
    return vec2(u, acos(clamp(d.z, -1.0, 1.0)) / PI);
}

vec3 sample_sky(vec3 dir) {
    vec3 d = normalize(vec3(dir.xy, max(dir.z, 0.02)));
    return texture2D(sky_texture, sky_uv(d)).rgb;
}

void main() {
    vec2 height_derivatives = get_derivatives();
    vec4 disp_der = get_displacement_derivatives();

    vec3 n = get_normal(height_derivatives, disp_der);
    vec3 v = normalize(-v2f_frag_pos);
    vec3 l = normalize((mat_view * vec4(light_direction, 0.0)).xyz);
    vec3 h = normalize(v + l);

    float NdotV = clamp(dot(n, v), 0.0, 1.0);

    // Fresnel: how much light is reflected vs transmitted into the water
    vec3 fresnel = fresnel_schlick(NdotV, F0);

    vec3 reflect_dir = view_to_world_dir(reflect(-v, n));
    vec3 sky_reflection = sample_sky(reflect_dir);

    // Light coming out of the water: deep water tint + ambient scattering
    vec3 water_body = mix(deep_water_color, shallow_scatter_color, clamp(v2f_wave_height * 0.5 + 0.5, 0.0, 1.0));
    water_body += ambient_factor * shallow_scatter_color;

    // Fake subsurface scattering
    float crest = max(v2f_wave_height, 0.0);
    float backlight = pow(clamp(dot(v, -l), 0.0, 1.0), 4.0) * pow(0.5 - 0.5 * dot(l, n), 3.0);
    float sss = sss_backlight_strength * crest * backlight
              + sss_view_strength * pow(NdotV, 2.0)
              + sss_diffuse_strength * max(dot(l, n), 0.0);
    water_body += sss * sss_color * light_color;

    // Specular highlight (Blinn-Phong)
    float spec_intensity = pow(max(dot(n, h), 0.0), shininess);
    vec3 specular = light_color * spec_intensity;

    vec3 color = mix(water_body, sky_reflection, fresnel) + specular;

    // Foam covers the water and is lit like a rough diffuse surface, so it doesn't glow under a dark sky
    float foam_amount = clamp(texture2D(foam, v2f_foam_uv).r, 0.0, 1.0);
    vec3 foam_lit = foam_color * (ambient_factor + 0.5 * max(dot(n, l), 0.0) * light_color);
    color = mix(color, foam_lit, foam_amount);

    // Fog color: the sky exactly behind this point
    vec3 cam_translation = mat_view[3].xyz;
    vec3 camera_world = view_to_world_dir(-cam_translation);
    vec3 frag_world = view_to_world_dir(v2f_frag_pos - cam_translation);
    vec3 ray = normalize(frag_world - camera_world);
    vec3 from_center = camera_world - sky_center;
    float b = dot(ray, from_center);
    float s = -b + sqrt(max(b * b - dot(from_center, from_center) + sky_radius * sky_radius, 0.0));
    vec3 fog_color = sky_color(sky_texture, sky_uv(from_center + s * ray));

    vec2 grid_center = foam_area.xy + foam_area.zw * 0.5;
    float grid_half_size = min(foam_area.z, foam_area.w) * 0.5;
    float edge_fog = smoothstep(fog_edge_start, fog_edge_end, length(v2f_ocean_uv - grid_center) / grid_half_size);
    float haze = 1.0 - exp(-haze_density * length(v2f_frag_pos));
    color = mix(color, fog_color, max(edge_fog, haze));

    gl_FragColor = vec4(color, 1.0);
}
