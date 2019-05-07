#include <fog_pars_fragment>
#include <alphamap_pars_fragment>

precision highp float;
precision highp int;

#define PI 3.1415926538

#define FAST_CIRCLE 1
#define FAST_SQUARE 2
#define FAST_ARROW 3
#define FAST_CROSS 4

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
float smooth_circle(in float radius, in vec2 pixel_position) {
    // This function does not use the ellipse function for optimization purpose
    // Circle equation: x^2 + y^2 = radius^2
    float d = dot(pixel_position, pixel_position);
    float r1 = pow(radius - SMOOTH_PIXELS, 2.0);
    float r2 = pow(radius + SMOOTH_PIXELS, 2.0);
    return 1.0 - smoothstep(r1, r2, d);
}

/*
 * Returns 1.0 if pixel inside of an ellipse (0.0 otherwise) given the ellipse radius and the
 * pixel position.
 */
float smooth_ellipse(in float a, in float b, in vec2 pixel_position) {
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
float smooth_rectangle(in vec2 size, in vec2 pixel_position) {
    vec2 rec = smoothstep(vec2(-SMOOTH_PIXELS), vec2(SMOOTH_PIXELS), size - abs(pixel_position));
    return rec.x * rec.y;
}

/*
 * Returns 1.0 if pixel inside of a rectangle (0.0 otherwise) given the rectangle half-size
 * on the x and y axes and the pixel position.
 */
float rectangle(in vec2 size, in vec2 pixel_position) {
    vec2 rec = step(0.0, size - abs(pixel_position));
    return rec.x * rec.y;
}

/*
 * Returns 1.0 if pixel inside of a square (0.0 otherwise) given the square half-size
 * and the pixel position.
 */
float smooth_square(in float size, in vec2 pixel_position) {
    return smooth_rectangle(vec2(size), pixel_position);
}

float smooth_isosceles_triangle(in float angle, in float height, in vec2 pixel_position) {
    float half_angle = angle / 2.0;

    // The triangle center is on vec2(0.0, -height/3.0)
    vec2 translated_pixel = vec2(pixel_position.x, pixel_position.y - height / 3.0);

    vec2 pixel_left = rotate_xy(translated_pixel, -half_angle);
    vec2 pixel_right = rotate_xy(translated_pixel, half_angle);

    float half_height = height * 0.5;

    float half_bottom = half_height * tan(half_angle);

    return smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, half_bottom + pixel_left.x) *
           smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, half_bottom - pixel_right.x) *
           smoothstep(-SMOOTH_PIXELS, SMOOTH_PIXELS, translated_pixel.y + half_height);
}


/*
 * Returns 1.0 if pixel inside of a cross shape (0.0 otherwise) given the cross half-size
 * on the x and y axes and the pixel position.
 */
float cross(in vec2 size, in vec2 pixel_position) {
    float cross_shape = rectangle(size.xy, pixel_position) +
                        rectangle(size.yx, pixel_position);
    return step(1.0, cross_shape); // equivalent of `cross_shape >= 1.0 ? 1.0 : 0.0`;
}


void main(void) {
    // pixel is the pixel position relatively to the marker,
    // e.g. vec2(0.) would be the center of the square marker
    // e.g. vec2(marker_size + 2.0 * stroke_width) would be the top-right pixel of the square marker
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

    float inner_size = marker_size/2.0 - stroke_width;
    float outer_size = marker_size/2.0 + stroke_width;

    float inner_shape = 0.0;
    float outer_shape = 0.0;

#if FAST_DRAW == FAST_CIRCLE

    inner_shape = smooth_circle(inner_size, pixel);
    outer_shape = smooth_circle(outer_size, pixel);

#elif FAST_DRAW == FAST_SQUARE

    inner_shape = smooth_square(inner_size, pixel);
    outer_shape = 1.0; // Always in the outer_shape

#elif FAST_DRAW == FAST_CROSS

    inner_shape = cross(vec2(inner_size, inner_size/3.0), pixel);
    outer_shape = cross(vec2(outer_size/3.0, outer_size), pixel);

#elif FAST_DRAW == FAST_ARROW

    float angle = 20. * PI / 180.;

    inner_shape = smooth_isosceles_triangle(angle, inner_size, pixel);
    outer_shape = smooth_isosceles_triangle(angle, outer_size, pixel);

#endif

    // `inner_shape` is the shape without the stroke, `outer_shape` is the shape with the stroke
    // note that the stroke is always drawn, only that it has the `fill_color` if stroke is None
    fill_weight = inner_shape;
    stroke_weight = (1.0 - inner_shape) * outer_shape;

    fill_weight *= (fill ? 1.0 : 0.0);

    gl_FragColor = fill_color * fill_weight + stroke_color * stroke_weight;
}
