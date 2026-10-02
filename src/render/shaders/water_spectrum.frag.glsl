precision highp float;

uniform sampler2D first_spectrum;
uniform float time;
uniform bool first;
uniform float fft_size;

// Cascade parameters
uniform float tile_length;      // meters
uniform float k_min;            // this cascade only keeps waves with k_min <= |k| < k_max
uniform float k_max;
uniform float amplitude_scale;  // FFT normalization and meters -> model units
uniform float seed;

// JONSWAP parameters (derived from wind speed and fetch in water_displacement_sr.js)
uniform float alpha;            // energy scale
uniform float peak_omega;       // angular frequency of the dominant waves
uniform float gamma;            // peak enhancement factor
uniform vec2 wind_direction;    // unit vector the wind blows towards
uniform float wind_alignment;   // 0 = waves in all directions, 1 = only along the wind

varying vec2 v2f_tex_coords;

const float PI = 3.14159265359;
const float G = 9.81;

// Wave vector (rad/m) of this texel. The FFT expects the zero frequency in the middle of the texture.
vec2 wave_vector() {
    vec2 m = floor(v2f_tex_coords * fft_size) - fft_size / 2.0;
    return m * 2.0 * PI / tile_length;
}

// JONSWAP frequency spectrum S(omega)
float jonswap(float omega) {
    float sigma = omega <= peak_omega ? 0.07 : 0.09;
    float r = exp(-pow(omega - peak_omega, 2.0) / (2.0 * sigma * sigma * peak_omega * peak_omega));
    return alpha * G * G / pow(omega, 5.0) * exp(-1.25 * pow(peak_omega / omega, 4.0)) * pow(gamma, r);
}

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 gaussian(vec2 p) {
    float u1 = max(hash(p), 1e-6);
    float u2 = hash(p + 17.31);
    return sqrt(-2.0 * log(u1)) * vec2(cos(2.0 * PI * u2), sin(2.0 * PI * u2));
}

void init_spectrum() {
    vec2 k = wave_vector();
    float k_len = length(k);

    // Outside of this cascade's band (also removes the zero frequency)
    if (k_len < max(k_min, 1e-4) || k_len >= k_max) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Deep water dispersion
    float omega = sqrt(G * k_len);
    float d_omega_dk = G / (2.0 * omega);

    // Directional spreading (integrates to 1 over all angles): mix of an isotropic sea
    // and waves within 90 degrees of the wind, concentrated around its direction
    float cos_angle = dot(k / k_len, wind_direction);
    float along_wind = 2.0 / PI * pow(max(cos_angle, 0.0), 2.0);
    float spreading = mix(1.0 / (2.0 * PI), along_wind, wind_alignment);

    // Convert S(omega) into a density over the 2D wave vector plane
    float S = jonswap(omega) * spreading * d_omega_dk / k_len;

    // Each texel represents a dk * dk area of the spectrum
    float dk = 2.0 * PI / tile_length;
    float amplitude = sqrt(2.0 * S * dk * dk);

    vec2 h0 = gaussian(floor(v2f_tex_coords * fft_size) + seed) / sqrt(2.0) * amplitude * amplitude_scale;

    gl_FragColor = vec4(h0, 0.0, 1.0);
}

void update_spectrum() {
    vec2 h0 = texture2D(first_spectrum, v2f_tex_coords).rg;

    float omega = sqrt(G * length(wave_vector()));

    // Evolve spectrum: h(t) = h0 * e^(-i omega t) (mat2 is column-major). The inverse FFT uses
    // e^(+i k.x), so each wave travels along its k: the waves move in the wind direction
    float phase = omega * time;
    mat2 rot = mat2(cos(phase), -sin(phase), sin(phase), cos(phase));

    gl_FragColor = vec4(rot * h0, 0.0, 1.0);
}

void main() {
    if (first) {
        init_spectrum();
    } else {
        update_spectrum();
    }
}
