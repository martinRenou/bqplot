#include <fog_pars_fragment>
#include <alphamap_pars_fragment>

precision highp float;
precision highp int;

#define PI 3.1415926538

#define FAST_CIRCLE 1
#define FAST_SQUARE 2
#define FAST_ARROW 3

// This parameter is used for reducing aliasing
#define SMOOTH_PIXELS 1.0

varying vec4 fill_color;
varying vec4 stroke_color;
varying vec3 vertex_position;
varying vec2 vertex_uv;
varying vec2 vUv;
varying float marker_size;

uniform bool fill;
uniform float stroke_width;


/*
 * Rotate a point in the 2-D plane, given an angle in radians
 */
vec2 rotate_xy(vec2 x, float angle) {
    float sina = sin(angle);
    float cosa = cos(angle);
    mat2 m = mat2(cosa, -sina, sina, cosa);
    return m * x.xy;
}

/*
 * Returns 1.0 if pixel inside of a circle (0.0 otherwise) given the circle radius and the
 * pixel position.
 */
float circle(in float radius, in vec2 pixel_position) {
    // This function does not use the ellipse function for optimization purpose
    // Circle equation: x^2 + y^2 = radius^2
    float d = pow(pixel_position.x, 2.0) + pow(pixel_position.y, 2.0);
    float r1 = pow(radius - SMOOTH_PIXELS, 2.0);
    float r2 = pow(radius + SMOOTH_PIXELS, 2.0);
    return 1.0 - smoothstep(r1, r2, d);
}

/*
 * Returns 1.0 if pixel inside of an ellipse (0.0 otherwise) given the ellipse radius and the
 * pixel position.
 */
float ellipse(in float a, in float b, in vec2 pixel_position) {
    // Ellipse equation: b^2 * x^2 + a^2 * y^2 = a^2 * b^2
    float r_x = pow(a, 2.0);
    float r_y = pow(b, 2.0);
    float d = r_y * pow(pixel_position.x, 2.0) + r_x * pow(pixel_position.y, 2.0);
    float r1 = pow(a - SMOOTH_PIXELS, 2.0) * pow(b - SMOOTH_PIXELS, 2.0);
    float r2 = pow(a + SMOOTH_PIXELS, 2.0) * pow(b + SMOOTH_PIXELS, 2.0);
    return 1.0 - smoothstep(r1, r2, d);
}

/*
 * Returns 1.0 if pixel inside of a rectangle (0.0 otherwise) given the rectangle half-size
 * on the x and y axes and the pixel position.
 */
float rectangle(in vec2 size, in vec2 pixel_position) {
    vec2 rec = smoothstep(vec2(-SMOOTH_PIXELS), vec2(SMOOTH_PIXELS), size - abs(pixel_position));
    return rec.x * rec.y;
}

/*
 * Returns 1.0 if pixel inside of a square (0.0 otherwise) given the square half-size
 * and the pixel position.
 */
float square(in float size, in vec2 pixel_position) {
    return rectangle(vec2(size), pixel_position);
}


void main(void) {
    // pixel is the pixel position relatively to the marker,
    // e.g. vec2(0.) would be the center of the marker
    // e.g. vec2(marker_size + 2.0 * stroke_width) would be the top-right pixel of the marker
    vec2 pixel = (vUv - 0.5) * (marker_size + 2.0 * stroke_width);

    // fill_weight and stroke_weight are color factors
    // e.g. if fill_weight == 1.0 then the pixel color will be fill_color
    // e.g. if stroke_weight == 1.0 then the pixel color will be stroke_color
    float fill_weight = 0.0;
    float stroke_weight = 0.0;

    // Note for the reader: In the following code,
    // - `1.0`     -> True
    // - `0.0`     -> False
    // - `1.0 - A` -> NOT A
    // - `A + B`   -> A OR B
    // - `A * B`   -> A AND B

#if FAST_DRAW == FAST_CIRCLE
    float inner_radius = marker_size/2.0 - stroke_width;
    float outer_radius = marker_size/2.0 + stroke_width;

    float inner_circle = circle(inner_radius, pixel);
    float outer_circle = circle(outer_radius, pixel);

    fill_weight = inner_circle;
    stroke_weight = (1.0 - inner_circle) * outer_circle;

#elif FAST_DRAW == FAST_SQUARE
    float inner_square_size = marker_size/2.0 - stroke_width;

    fill_weight = square(inner_square_size, pixel);

    stroke_weight = 1.0 - fill_weight;

#elif FAST_DRAW == FAST_ARROW
    // take 2 rotated coordinate systems
    float angle = 10. * PI / 180.;
    vec2 pixel_left = (rotate_xy(vUv - vec2(0.5, 1.0), -angle) + vec2(0.0, 0.5)) * (marker_size + 2.0 * stroke_width);
    vec2 pixel_right = (rotate_xy(vUv - 1.0, angle) + 0.5) * (marker_size + 2.0 * stroke_width);

    if (fill) {
        fill_weight = smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, pixel.y + marker_size/2.0 - stroke_width/2.) *
                      smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, pixel_left.x - stroke_width/2.) *
                      smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, -pixel_right.x - stroke_width/2.);
    }

    float bottom_width = tan(angle) * marker_size;
    float edge_weight_bottom = (1.0 - smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, abs(pixel.y + marker_size/2.0) - stroke_width/2.0))
                             * (1.0 - smoothstep(bottom_width - SMOOTH_PIXELS, bottom_width + SMOOTH_PIXELS, abs(pixel.x)));
    float edge_weight_left  = (1.0 - smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, abs(pixel_left.x) - stroke_width/2.0));
    float edge_weight_right = (1.0 - smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, abs(pixel_right.x) - stroke_width/2.0));

    stroke_weight = 1.0 - (1.0 - edge_weight_bottom) * (1.0 - edge_weight_left) * (1.0 - edge_weight_right);
#endif

    fill_weight *= (fill ? 1.0 : 0.0);

    gl_FragColor = fill_color * fill_weight + stroke_color * stroke_weight;
}
