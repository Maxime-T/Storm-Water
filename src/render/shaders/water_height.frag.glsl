precision highp float;

uniform sampler2D spectrum;
uniform float fft_stage;      // Current stage: 0 ... log2(N) - 1
uniform float fft_direction;  // 0.0 = horizontal, 1.0 = vertical
uniform float fft_size;
uniform float fft_max_stage;

varying vec2 v2f_tex_coords;

const float PI = 3.14159265359;

// Complex multiplication: (a + bi) * (c + di) = (ac - bd) + (ad + bc)i
vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

void main() {

    float N = fft_size;
    float span = pow(2.0, fft_stage + 1.0);
    float halfSpan = span * 0.5;

    // Compute current index (0 to N-1)
    float index = fft_direction == 0.0
        ? floor(v2f_tex_coords.x * N)
        : floor(v2f_tex_coords.y * N);

    // Compute position within current butterfly block
    float groupBase = floor(index / span) * span;
    float offset = mod(index, halfSpan);

    float evenIndex = groupBase + offset;
    float oddIndex = evenIndex + halfSpan;

    // Sample positions
    vec2 evenUV = fft_direction == 0.0
        ? vec2((evenIndex + 0.5) / N, v2f_tex_coords.y)
        : vec2(v2f_tex_coords.x, (evenIndex + 0.5) / N);

    vec2 oddUV = fft_direction == 0.0
        ? vec2((oddIndex + 0.5) / N, v2f_tex_coords.y)
        : vec2(v2f_tex_coords.x, (oddIndex + 0.5) / N);

    // Dual-complex FFT: RG = first complex, BA = second complex
    vec4 evenSample = texture2D(spectrum, evenUV);
    vec4 oddSample = texture2D(spectrum, oddUV);

    vec2 even1 = evenSample.rg;
    vec2 odd1 = oddSample.rg;
    vec2 even2 = evenSample.ba;
    vec2 odd2 = oddSample.ba;

    // Compute twiddle factor (same for both complex numbers)
    float k = mod(index, halfSpan);
    float theta = 2.0 * PI * k / span;
    vec2 twiddle = vec2(cos(theta), sin(theta));

    // Apply twiddle to both complex numbers
    vec2 oddTwiddled1 = cmul(odd1, twiddle);
    vec2 oddTwiddled2 = cmul(odd2, twiddle);

    // Output result based on whether this is the even or odd output index
    bool isOdd = mod(index, span) >= halfSpan;

    vec2 result1 = isOdd ? (even1 - oddTwiddled1) : (even1 + oddTwiddled1);
    vec2 result2 = isOdd ? (even2 - oddTwiddled2) : (even2 + oddTwiddled2);

    vec4 result = vec4(result1, result2);

    // Normalize at final stage
    if (fft_stage == log2(N)-1.) {
        result /= N;
    }

    gl_FragColor = result;
}
