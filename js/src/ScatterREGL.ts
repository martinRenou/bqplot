/* Copyright 2015 Bloomberg Finance L.P.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Mark } from './Mark';
import * as d3 from 'd3';
import * as markers from './Markers';
import * as _ from 'underscore';
// import { deepCopy } from './utils';
import { ScatterREGLModel } from './ScatterREGLModel';
import { Scale } from './Scale';
import * as THREE from 'three';
import regl from 'regl';


type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;

const bqSymbol = markers.symbol;

const to_float_array = function (value: any) {
  if (value instanceof Float32Array) {
    return value;
  }
  if (typeof value[Symbol.iterator] === 'function') {
    const N = value.length;
    const array32 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      array32[i] = value[i];
    }
    return array32;
  }
  return new Float32Array(value);
};

const color_to_array_rgba = function (color, default_color?) {
  const color_name = color || default_color || [0, 0, 0, 0];
  if (color_name == 'none') {
    return [0, 0, 0, 0];
  } else {
    const color = new THREE.Color(color_name);
    return [color.r, color.g, color.b, 1.0];
  }
};

const create_colormap = function (scale) {
  // convert the d3 color scale to a texture
  const colors = scale ? scale.model.color_range : ['#ff0000', '#ff0000'];
  const color_scale = d3
    .scaleLinear()
    .range(colors)
    .domain(_.range(colors.length).map((i) => i / (colors.length - 1)));
  const colormap_array = [];
  const N = 256;
  _.map(_.range(N), (i) => {
    const index = i / (N - 1);
    const rgb = d3.color(String(color_scale(index))).hex();
    const rgb_str = String(rgb);
    const rgb_arr = [
      parseInt('0x' + rgb_str.substring(1, 3)),
      parseInt('0x' + rgb_str.substring(3, 5)),
      parseInt('0x' + rgb_str.substring(5, 7)),
    ];
    colormap_array.push(rgb_arr[0], rgb_arr[1], rgb_arr[2]);
  });
  const colormap_arr = new Uint8Array(colormap_array);
  const colormap_texture = new THREE.DataTexture(
    colormap_arr,
    N,
    1,
    THREE.RGBFormat,
    THREE.UnsignedByteType
  );
  colormap_texture.needsUpdate = true;

  return colormap_texture;
};

export class ScatterREGL extends Mark {
  async render() {
    const base_render_promise = super.render();

    this.dot = bqSymbol().type(this.model.get('marker'));

    this.initializeAttributeBuffers();

    return base_render_promise;
  }

  render_gl() {
    this.updateAttributeBuffers();

    const x_scale = this.scales.x ? this.scales.x : this.parent.scale_x;
    const y_scale = this.scales.y ? this.scales.y : this.parent.scale_y;

    const range_x = this.parent.padded_range('x', x_scale.model);
    const range_y = this.parent.padded_range('y', y_scale.model);

    this.parent.reglContext({
      vert: this.vertexShader,
      frag: this.fragmentShader,

      attributes: {
        // Shared accross elements
        position: this.positionAttr,
        uv: this.uvAttr,

        // Per-element attributes
        x: this.xAttr,
        y: this.yAttr,
      },

      uniforms: {
        domain_x: x_scale.scale.domain(),
        domain_y: y_scale.scale.domain(),
        domain_z: [0, 1],
        range_x,
        range_y: [range_y[1], range_y[0]],
        range_z: [0, 1],
        stroke_width: this.model.get('stroke_width'),
        marker_scale: 1 / Math.sqrt(Math.PI), // TODO Make this dependent on the shape (circle hardcoded)
      },

      elements: this.indices,
      instances: this.numberMarkers,
    });
  }

  initializeAttributeBuffers(): void {
    this.xAttr =
  }

  updateAttributeBuffers(): void {
    // Is this really needed?
  }

  set_positional_scales() {
    this.x_scale = this.scales.x;
    this.y_scale = this.scales.y;
    // If no scale for "x" or "y" is specified, figure scales are used.
    if (!this.x_scale) {
      this.x_scale = this.parent.scale_x;
    }
    if (!this.y_scale) {
      this.y_scale = this.parent.scale_y;
    }
    this.listenTo(this.x_scale, 'domain_changed', function () {
      if (!this.model.dirty) {
        const animate = true;
        this.update_position(animate);
      }
    });
    this.listenTo(this.y_scale, 'domain_changed', function () {
      if (!this.model.dirty) {
        const animate = true;
        this.update_position(animate);
      }
    });
  }

  initialize_additional_scales() {
    const color_scale = this.scales.color;
    const size_scale = this.scales.size;
    const opacity_scale = this.scales.opacity;
    const rotation_scale = this.scales.rotation;
    // the following handlers are for changes in data that does not
    // impact the position of the elements
    if (color_scale) {
      // this.listenTo(color_scale, 'all', this.update_color_map);
      // this.listenTo(this.model, 'change:color', this.update_color_map);
      // this.update_color_map();
    }
    if (size_scale) {
      this.listenTo(size_scale, 'domain_changed', () => {
        // this.update_scene();
      });
    }
    if (opacity_scale) {
      this.listenTo(opacity_scale, 'domain_changed', () => {
        // this.update_scene();
      });
    }
    if (rotation_scale) {
      this.listenTo(rotation_scale, 'domain_changed', () => {
        // this.update_scene();
      });
    }
  }

  set_ranges() {
    const x_scale = this.scales.x,
      y_scale = this.scales.y,
      size_scale = this.scales.size,
      opacity_scale = this.scales.opacity,
      skew_scale = this.scales.skew,
      rotation_scale = this.scales.rotation;
    if (x_scale) {
      x_scale.set_range(this.parent.padded_range('x', x_scale.model));
    }
    if (y_scale) {
      y_scale.set_range(this.parent.padded_range('y', y_scale.model));
    }
    if (size_scale) {
      size_scale.set_range([0, this.model.get('default_size')]);
    }
    if (opacity_scale) {
      opacity_scale.set_range([0.2, 1]);
    }
    if (skew_scale) {
      skew_scale.set_range([0, 1]);
    }
    if (rotation_scale) {
      rotation_scale.set_range([0, Math.PI]); // TODO: this mirrors the 180 from the normal scatter, but why not 360?
    }
  }

  draw_legend(elem, x_disp, y_disp, inter_x_disp, inter_y_disp) {
    this.legend_el = elem.selectAll('.legend' + this.uuid).data([{}]);
    const colors = this.model.get('colors'),
      len = colors.length;

    const that = this;
    const rect_dim = inter_y_disp * 0.8;
    const el_added = this.legend_el
      .enter()
      .append('g')
      .attr('class', 'legend' + this.uuid)
      .attr('transform', (d, i) => {
        return 'translate(0, ' + (i * inter_y_disp + y_disp) + ')';
      });

    this.draw_legend_elements(el_added, rect_dim);

    this.legend_el
      .append('text')
      .attr('class', 'legendtext')
      .attr('x', rect_dim * 1.2)
      .attr('y', rect_dim / 2)
      .attr('dy', '0.35em')
      .text((d, i) => {
        return that.model.get('labels')[i];
      })
      .style('fill', (d, i) => {
        return colors[i % len];
      });

    const max_length = d3.max(this.model.get('labels'), (d: any[]) => {
      return d.length;
    });

    this.legend_el.exit().remove();
    return [1, max_length];
  }

  draw_legend_elements(elements_added, rect_dim) {
    const colors = this.model.get('colors'),
      stroke = this.model.get('stroke'),
      fill = this.model.get('fill');

    elements_added
      .append('path')
      .attr('transform', (d, i) => {
        return 'translate( ' + rect_dim / 2 + ', ' + rect_dim / 2 + ')';
      })
      .attr('d', this.dot.size(64))
      .style('fill', fill ? colors[0] : 'none')
      .style('stroke', stroke ? stroke : colors[0]);
  }

  update_legend() {
    if (this.legend_el) {
      const colors = this.model.get('colors'),
        stroke = this.model.get('stroke'),
        fill = this.model.get('fill');
      this.legend_el
        .select('path')
        .style('fill', fill ? colors[0] : 'none')
        .style('stroke', stroke ? stroke : colors[0]);
      this.legend_el.select('text').style('fill', fill ? colors[0] : 'none');
      if (this.legend_el) {
        this.legend_el
          .select('path')
          .attr('d', this.dot.type(this.model.get('marker')));
      }
    }
  }

  relayout() {
    this.set_ranges();
  }

  compute_view_padding() {
    //This function computes the padding along the x and y directions.
    //The value is in pixels.
    const xPadding = Math.sqrt(this.model.get('default_size')) / 2 + 1.0;

    if (xPadding !== this.xPadding || xPadding !== this.yPadding) {
      this.xPadding = xPadding;
      this.yPadding = xPadding;
      this.trigger('mark_padding_updated');
    }
  }

  draw(animate?) {}
  clear_style(style_dict, indices?, elements?) {}
  set_default_style(indices, elements?) {}
  set_style_on_elements(style, indices, elements?) {}

  transitions: any[];
  x_scale: Scale;
  y_scale: Scale;
  pixel_x: Float64Array;
  pixel_y: Float64Array;
  trottled_selector_changed: any;
  invalidated_pixel_position: boolean;

  private vertexShader: string = require('raw-loader!../shaders/scatter-vertex.glsl').default;
  private fragmentShader: string = require('raw-loader!../shaders/scatter-fragment.glsl').default;

  private positionAttr = new Float32Array([
    -0.5, 0.5, 0,
    0.5, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);
  private uvAttr = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
  private indices = new Uint16Array([0, 2, 1, 2, 3, 1]);

  private xAttr: regl.Attribute;

  private numberMarkers: number = 0;

  markers_number: number;

  legend_el: d3.Selection<any, any, any, any>;
  dot: any;

  model: ScatterREGLModel;
}
