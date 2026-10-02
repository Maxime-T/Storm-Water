precision highp float;

uniform sampler2D spectrum;
uniform float fft_size;
uniform float fft_direction;  // 0.0 = horizontal, 1.0 = vertical
uniform int bits;

#define MAX_BITS 16

varying vec2 v2f_tex_coords;

float bit_reverse(float x) {
    float result = 0.0;
    float power = pow(2.0, float(bits - 1));

    for (int i = 0; i < MAX_BITS; i++) {
        if (i >= bits) break;
        float bit = floor(mod(x / pow(2.0, float(i)), 2.0));
        result += bit * power;
        power /= 2.0;
    }

    return result;
}

void main() {
    float N = fft_size;

    // Determine which index this pixel represents
    float index = fft_direction == 0.0
        ? floor(v2f_tex_coords.x * N)
        : floor(v2f_tex_coords.y * N);

    // Compute bit-reversed index normalized to [0.0, 1.0)
    float reversed = bit_reverse(index);

    // Normalize bit-reversed index into UV space (center of pixel)
    float normalized = (reversed + 0.5) / N;

    vec2 sampleUV = fft_direction == 0.0
        ? vec2(normalized, v2f_tex_coords.y)
        : vec2(v2f_tex_coords.x, normalized);

    // Fetch bit-reversed sample
    gl_FragColor = texture2D(spectrum, sampleUV);
}
