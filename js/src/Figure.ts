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

import * as widgets from '@jupyter-widgets/base';
import * as d3 from 'd3';
import 'd3-selection-multi';
// var d3 =Object.assign({}, require("d3-selection"), require("d3-selection-multi"));
import * as _ from 'underscore';
import * as popperreference from './PopperReference';
import popper from 'popper.js';
import * as THREE from 'three';

THREE.ShaderChunk['scales'] = require('raw-loader!../shaders/scales.glsl')

export class Figure extends widgets.DOMWidgetView {

    initialize() {
        // Internet Explorer does not support classList for svg elements
        this.el.classList.add("bqplot");
        this.el.classList.add("figure");
        this.el.classList.add("jupyter-widgets");
        this.change_theme();

        const svg = document.createElementNS(d3.namespaces.svg, "svg") as SVGElement;
        svg.classList.add("svg-figure");
        this.svg = d3.select<SVGElement, any>(svg);

        const svg_background = document.createElementNS(d3.namespaces.svg, "svg") as SVGElement;
        svg_background.classList.add("svg-background");
        this.svg_background = d3.select<SVGElement, any>(svg_background);

        // a shared webgl context for all marks
        this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, premultipliedAlpha: true});
        if(!this.renderer.capabilities.floatFragmentTextures) {
            console.error("you videocard/driver does not support float fragment textures, you may have limited functionality")
        }
        const gl = this.renderer.context;
        if(!gl.getExtension('OES_texture_float_linear')) {
            console.error("you videocard/driver does not support float fragment linear interpolation, you may have limited functionality")
        }
        this.renderer.setSize(100, 100);
        this.renderer.setClearAlpha(0);
        this.renderer.setPixelRatio(this.model.get('pixel_ratio') || window.devicePixelRatio)

        this.el.appendChild(svg_background)
        this.el.appendChild(this.renderer.domElement);
        this.el.appendChild(svg);

        super.initialize.apply(this, arguments);
    }

    _get_height_width(suggested_height, suggested_width) {
        //Calculates the height and width of the figure from the suggested_height
        //and suggested_width. Looks at the min_aspect_ratio and max_aspect_ratio
        //to determine the final height and width.

        const max_ratio = this.model.get("max_aspect_ratio");
        const min_ratio = this.model.get("min_aspect_ratio");

        const return_value = {};
        const width_undefined = (suggested_width === undefined || isNaN(suggested_width) || suggested_width <= 0);
        const height_undefined = (suggested_height === undefined || isNaN(suggested_height) || suggested_width <= 0);

        if (width_undefined && height_undefined) {
            // Same as the defaults in bqplot.less
            suggested_height = 480;
            suggested_width = 640;
        } else if (height_undefined) {
            suggested_height = suggested_width / min_ratio;
        } else if (width_undefined) {
            suggested_width = suggested_height * min_ratio;
        }

        const ratio = suggested_width / suggested_height;
        if (ratio <= max_ratio && ratio >= min_ratio) {
            // If the available width and height are within bounds in terms
            // of aspect ration, use all the space available.
            return_value["width"] = suggested_width;
            return_value["height"] = suggested_height;
        } else if (ratio > max_ratio) {
            // The available space is too oblong horizontally.
            // Use all vertical space and compute width based on maximum
            // aspect ratio.
            return_value["height"] = suggested_height;
            return_value["width"] = suggested_height * max_ratio;
         } else { // ratio < min_ratio
            // The available space is too oblong vertically.
            // Use all horizontal space and compute height based on minimum
            // aspect ratio.
            return_value["width"] = suggested_width;
            return_value["height"] = suggested_width / min_ratio;
        }
        return return_value;
    }

    render () {
        let min_width = this.model.get("layout").get("min_width");
        let min_height = this.model.get("layout").get("min_height");
        if(typeof min_width === "string" && min_width.endsWith('px')) {
            min_width = Number(min_width.slice(0, -2));
        } else {
            min_width = undefined;
        }
        if(typeof min_height === "string"  && min_height.endsWith('px')) {
            min_height = Number(min_height.slice(0, -2));
        } else {
            min_height = undefined;
        }

        const impl_dimensions = this._get_height_width(min_height, min_width);
        this.width = impl_dimensions["width"];
        this.height = impl_dimensions["height"];

        this.id = widgets.uuid();

        // Dictionary which contains the mapping for each of the marks id
        // to it's padding. Dictionary is required to not recompute
        // everything when a mark is removed.
        this.x_pad_dict = {};
        this.y_pad_dict = {};

        // this is the net padding in pixel to be applied to the x and y.
        // If there is no restriction on the plottable area of the figure,
        // then these two variables are the maximum of the values in the
        // corresponding variables x_pad_dict, y_pad_dict.
        this.x_padding_arr = {};
        this.y_padding_arr = {};

        this.figure_padding_x = this.model.get("padding_x");
        this.figure_padding_y = this.model.get("padding_y");
        this.clip_id = "clip_path_" + this.id;
        this.margin = this.model.get("fig_margin");

        this.update_plotarea_dimensions();
        // this.fig is the top <g> element to be impacted by a rescaling / change of margins

        this.fig = this.svg.append("g")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");
        this.fig_background = this.svg_background.append("g")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");
        this.tooltip_div = d3.select(document.createElement("div"))
            .attr("class", "tooltip_div");
        this.popper_reference = new popperreference.PositionReference({x: 0, y: 0, width: 20, height: 20});
        this.popper = new popper(this.popper_reference, this.tooltip_div.node(), {
            placement: 'auto',
        });

        this.bg = this.fig_background.append("rect")
          .attr("class", "plotarea_background")
          .attr("x", 0).attr("y", 0)
          .attr("width", this.plotarea_width)
          .attr("height", this.plotarea_height)
          .styles(this.model.get("background_style"))
          .style("pointer-events", "inherit");
        this.bg.on("click", function() { that.trigger("bg_clicked"); });

        this.fig_axes = this.fig_background.append("g");
        this.fig_marks = this.fig.append("g");
        this.interaction = this.fig.append("g");

        /*
         * The following was the structure of the DOM element constructed
         *
        <div class="bqplot figure jupyter-widgets">
            <svg>
                <g class="svg-figure" transform="margin translation">
                    <g class="svg-axes"></g>
                    <g class="svg-marks"></g>
                    <g class="svg-interaction"></g>
                </g>
            </svg>
        </div>

        To allow the main/interaction layer on top, and also allowing us to draw
        on top of the canvas (e.g. selectors), we create a new DOM structure.
        When creating a screenshot/image, we collapse all this into one svg.

        <div class="bqplot figure jupyter-widgets">
            <svg class="svg-background">
                <g transform="margin translation">
                    <g class="svg-axes"></g>
                </g>
            </svg>
            <canvas>
            </canvas>
            <svg class="svg-figure">
                <g transform="margin translation">
                    <g class="svg-marks"></g>
                    <g class="svg-interaction"></g>
                </g>
            </svg>
        </div>
        */

        this.clip_path = this.svg.append("svg:defs")
          .append("svg:clipPath")
          .attr("id", this.clip_id)
          .append("rect")
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", this.plotarea_width)
          .attr("height", this.plotarea_height);

        this.title = this.fig.append("text")
          .attr("class", "mainheading")
          .attr("x", 0.5 * (this.plotarea_width))
          .attr("y", -(this.margin.top / 2.0))
          .attr("dy", "1em")
          .styles(this.model.get("title_style"));

        this.title.text(this.model.get("title"));

        // TODO: remove the save png event mechanism.
        this.model.on("save_png", this.save_png, this);
        this.model.on("save_svg", this.save_svg, this);

        const figure_scale_promise = this.create_figure_scales();
        const that = this;
        figure_scale_promise.then(function() {
            that.mark_views = new widgets.ViewList(that.add_mark, that.remove_mark, that);
            that.mark_views.update(that.model.get("marks"));
            Promise.all(that.mark_views.views).then(function(views) {
                that.replace_dummy_nodes(views);
                that.update_marks(views);
                that.update_legend();
                // Update Interaction layer
                // This has to be done after the marks are created
                that.set_interaction(that.model.get("interaction"));
            });

            that.axis_views = new widgets.ViewList(that.add_axis, null, that);
            that.axis_views.update(that.model.get("axes"));

            // TODO: move to the model
            that.model.on_some_change(["fig_margin", "min_aspect_ration", "max_aspect_ratio", "preserve_aspect"], that.relayout, that);
            that.model.on_some_change(["padding_x", "padding_y"], function() {
                this.figure_padding_x = this.model.get("padding_x");
                this.figure_padding_y = this.model.get("padding_y");
                this.trigger("margin_updated");
            }, that);
            that.model.on("change:axes", function(model, value, options) {
                this.axis_views.update(value);
            }, that);
            that.model.on("change:marks", function(model, value, options) {
                this.mark_views.update(value);
                Promise.all(this.mark_views.views).then(function(views) {
                    that.replace_dummy_nodes(views);
                    that.update_marks(views);
                    that.update_legend();
                });
            }, that);
            that.model.on("change:legend_location", that.update_legend, that);
            that.model.on("change:title", that.update_title, that);

            that.model.on("change:interaction", function(model, value) {
                Promise.all(that.mark_views.views).then((views) => {
                    // Like above:
                    // This has to be done after the marks are created
                    this.set_interaction(value);
                })
            }, that);

            that.displayed.then(function(args: any) {
                document.body.appendChild(that.tooltip_div.node());
                that.create_listeners();
                if(args === undefined || args.add_to_dom_only !== true) {
                    //do not relayout if it is only being added to the DOM
                    //and not displayed.
                    that.relayout();
                }
                // In the classic notebook, we should relayout the figure on
                // resize of the main window.
                window.addEventListener('resize', function() {
                    that.relayout();
                })
            });
        });
    }

    replace_dummy_nodes(views) {
        _.each(views, function(view: any) {
            if (view.dummy_node !== null) {
                view.dummy_node.parentNode.replaceChild(view.el, view.dummy_node);
                view.dummy_node = null;
                this.displayed.then(function() {
                    view.trigger("displayed");
                });
            }
        }, this);
    }

    create_listeners() {
        this.listenTo(this.model, "change:title_style", this.title_style_updated);
        this.listenTo(this.model, "change:background_style", this.background_style_updated);
        this.listenTo(this.model, "change:layout", this.change_layout);
        this.listenTo(this.model, "change:legend_style", this.legend_style_updated);
        this.listenTo(this.model, "change:legend_text", this.legend_text_updated);
        this.listenTo(this.model, "change:pixel_ratio", () => {
            this.renderer.setPixelRatio(this.model.get('pixel_ratio') || window.devicePixelRatio)
            this.update_gl()
        })
        this.listenTo(this.model, "change:theme", this.change_theme);
    }

    title_style_updated() {
        this.title.styles(this.model.get("title_style"));
    }

    background_style_updated() {
        this.bg.styles(this.model.get("background_style"));
    }

    legend_style_updated() {
        this.fig_marks.selectAll(".g_legend").selectAll(".axis").selectAll("rect")
            .styles(this.model.get("legend_style"));
    }

    legend_text_updated() {
        this.fig_marks.selectAll(".g_legend").selectAll("text.legendtext")
            .styles(this.model.get("legend_text"));
    }

    create_figure_scales() {
        // Creates the absolute scales for the figure: default domain is [0,1], range is [0,width] and [0,height].
        // See the scale_x and scale_y attributes of the python Figure
        const that = this;
        const x_scale_promise = this.create_child_view(this.model.get("scale_x"))
            .then(function(view) {
                that.scale_x = view;
                that.scale_x.scale.clamp(true);
                that.scale_x.set_range([0, that.plotarea_width]);
            });

        const y_scale_promise = this.create_child_view(this.model.get("scale_y"))
            .then(function(view) {
                that.scale_y = view;
                that.scale_y.scale.clamp(true);
                that.scale_y.set_range([that.plotarea_height, 0]);
            });
        return Promise.all([x_scale_promise, y_scale_promise]);
    }

    padded_range(direction, scale_model) {
        // Functions to be called by mark which respects padding.
        // Typically all marks do this. Axis do not do this.
        // Also, if a mark does not set the domain, it can potentially call
        // the unpadded ranges.
        if(!scale_model.get("allow_padding")) {
            return this.range(direction);
        }
        const scale_id = scale_model.model_id;

        if(direction==="x") {
            const scale_padding = (this.x_padding_arr[scale_id] !== undefined) ?
                this.x_padding_arr[scale_id] : 0;
            const fig_padding = (this.plotarea_width) * this.figure_padding_x;
            return [(fig_padding + scale_padding), (this.plotarea_width - fig_padding - scale_padding)];
        } else if(direction==="y") {
            const scale_padding = (this.y_padding_arr[scale_id] !== undefined) ?
                this.y_padding_arr[scale_id] : 0;
            const fig_padding = (this.plotarea_height) * this.figure_padding_y;
            return [this.plotarea_height - scale_padding - fig_padding, scale_padding + fig_padding];
        }
    }

    range(direction) {
        if(direction==="x") {
            return [0, this.plotarea_width];
        } else if(direction==="y") {
            return [this.plotarea_height, 0];
        }
    }

    get_mark_plotarea_height(scale_model) {
        if(!(scale_model.get("allow_padding"))) {
            return this.plotarea_height;
        }
        const scale_id = scale_model.model_id;
        const scale_padding = (this.y_padding_arr[scale_id] !== undefined) ?
            this.y_padding_arr[scale_id] : 0;
        return (this.plotarea_height) * (1 - this.figure_padding_y) - scale_padding - scale_padding;
    }

    get_mark_plotarea_width (scale_model) {
        if(!(scale_model.get("allow_padding"))) {
            return this.plotarea_width;
        }

        const scale_id = scale_model.model_id;
        const scale_padding = (this.x_padding_arr[scale_id] !== undefined) ?
            this.x_padding_arr[scale_id] : 0;
        return (this.plotarea_width) * (1 - this.figure_padding_x) - scale_padding - scale_padding;
    }

    add_axis(model) {
        // Called when an axis is added to the axes list.
        const that = this;
        return this.create_child_view(model)
          .then(function(view) {
            that.fig_axes.node().appendChild(view.el);
            that.displayed.then(function() {
                view.trigger("displayed");
            });
            return view;
        });
    }

    remove_from_padding_dict(dict, mark_view, scale_model) {
        if(scale_model === undefined || scale_model === null) {
            return;
        }
        const scale_id = scale_model.model_id;
        if(dict[scale_id] !== undefined) {
            delete dict[scale_id][mark_view.model.model_id + "_" + mark_view.cid];
            if(Object.keys(dict[scale_id]).length === 0) {
                delete dict[scale_id];
            }
        }
    }

    update_padding_dict(dict, mark_view, scale_model, value) {
        const scale_id = scale_model.model_id;
        if(!(dict[scale_id])) {
            dict[scale_id]= {};
        }
        dict[scale_id][mark_view.model.model_id + "_" + mark_view.cid] = value;
    }

    mark_scales_updated(view) {
        const model = view.model;
        const prev_scale_models = model.previous("scales");
        this.remove_from_padding_dict(this.x_pad_dict, view, prev_scale_models[model.get_key_for_orientation("horizontal")]);
        this.remove_from_padding_dict(this.y_pad_dict, view, prev_scale_models[model.get_key_for_orientation("vertical")]);

        const scale_models = model.get("scales");
        this.update_padding_dict(this.x_pad_dict, view, scale_models[model.get_key_for_orientation("horizontal")], view.x_padding);
        this.update_padding_dict(this.y_pad_dict, view, scale_models[model.get_key_for_orientation("vertical")], view.y_padding);

        this.update_paddings();
    }

    mark_padding_updated(view) {
        const model = view.model;
        const scale_models = model.get("scales");

        this.update_padding_dict(this.x_pad_dict, view, scale_models[model.get_key_for_orientation("horizontal")], view.x_padding);
        this.update_padding_dict(this.y_pad_dict, view, scale_models[model.get_key_for_orientation("vertical")], view.y_padding);

        this.update_paddings();
    }

    update_marks(mark_views) {
        this.update_paddings();
    }

    remove_mark(view) {
       // Called when a mark is removed from the mark list.
        const model = view.model;
        model.off("redraw_legend", null, this);
        model.off("data_updated", null, this);
        model.off("scales_updated", null, this);
        model.off("mark_padding_updated", null, this);

        const scale_models = model.get("scales");
        this.remove_from_padding_dict(this.x_pad_dict, view, scale_models[model.get_key_for_orientation("horizontal")]);
        this.remove_from_padding_dict(this.y_pad_dict, view, scale_models[model.get_key_for_orientation("vertical")]);
        view.remove();
    }

    add_mark(model) {
        const that = this;
        model.state_change.then(function() {
            model.on("data_updated redraw_legend", that.update_legend, that);
        });

        const dummy_node = that.fig_marks.node().appendChild(document.createElementNS(d3.namespaces.svg, "g"));

        return that.create_child_view(model, {clip_id: that.clip_id}).then(function(view: any) {
            view.dummy_node = dummy_node;
            view.on("mark_padding_updated", function() {
                that.mark_padding_updated(view);
            }, that);
            view.on("mark_scales_updated", function() {
                that.mark_scales_updated(view);
            }, that);
            let child_x_scale = view.model.get("scales")[view.model.get_key_for_dimension("x")];
            let child_y_scale = view.model.get("scales")[view.model.get_key_for_dimension("y")];
            if(child_x_scale === undefined) {
                child_x_scale = that.scale_x.model;
            }
            if(child_y_scale === undefined) {
                child_y_scale = that.scale_y.model;
            }
            that.update_padding_dict(that.x_pad_dict, view, child_x_scale, view.x_padding);
            that.update_padding_dict(that.y_pad_dict, view, child_y_scale, view.y_padding);

            return view;
        });
    }

    update_paddings() {
        // Iterate over the paddings of the marks for each scale and store
        // the maximum padding for each scale on the X and Y in
        // x_padding_arr and y_padding_arr

        this.x_padding_arr = {};
        this.y_padding_arr = {};

        const that = this;
        _.forEach(this.x_pad_dict, function(dict: any, scale_id) {
            let max = 0;
            _.forEach(dict, function(value: any, key) {
                max = Math.max(max, value);
            });
            that.x_padding_arr[scale_id] = max;
        });

        _.forEach(this.y_pad_dict, function(dict: any, scale_id) {
            let max = 0;
            _.forEach(dict, function(value: any, key) {
                max = Math.max(max, value);
            });
            that.y_padding_arr[scale_id] = max;
        });
        // This is for the figure to relayout everything to account for the
        // updated margins.
        this.trigger("margin_updated");

    }

    update_plotarea_dimensions() {
        this.plotarea_width = this.width - this.margin.left - this.margin.right;
        this.plotarea_height = this.height - this.margin.top - this.margin.bottom;
    }

    processPhosphorMessage(msg) {
        super.processPhosphorMessage.apply(this, arguments);
        switch (msg.type) {
        case 'resize':
        case 'after-show':
            this.relayout();
            break;
        }
    }

    relayout() {

        const that = this;

        const impl_dimensions = this._get_height_width(this.el.clientHeight, this.el.clientWidth);
        that.width = impl_dimensions["width"];
        that.height = impl_dimensions["height"];

        window.requestAnimationFrame(function () {
            // update ranges
            that.margin = that.model.get("fig_margin");
            that.update_plotarea_dimensions();

            if (that.scale_x !== undefined && that.scale_x !== null) {
                that.scale_x.set_range([0, that.plotarea_width]);
            }


            if (that.scale_y !== undefined && that.scale_y !== null) {
                that.scale_y.set_range([that.plotarea_height, 0]);
            }

            // transform figure
            that.fig.attr("transform", "translate(" + that.margin.left + "," +
                                                      that.margin.top + ")");
            that.fig_background.attr("transform", "translate(" + that.margin.left + "," +
                                                      that.margin.top + ")");
            that.title.attrs({
                x: (0.5 * (that.plotarea_width)),
                y: -(that.margin.top / 2.0),
                dy: "1em"
            });

            that.bg
                .attr("width", that.plotarea_width)
                .attr("height", that.plotarea_height);


            that.clip_path.attr("width", that.plotarea_width)
                .attr("height", that.plotarea_height);

            that.trigger("margin_updated");
            that.update_legend();
            that.layout_webgl_canvas()
        });

    }

    layout_webgl_canvas() {
        this.renderer.domElement.style = 'left: ' + this.margin.left + 'px; ' +
                                         'top: '+ this.margin.top + 'px;'
        this.renderer.setSize(this.plotarea_width, this.plotarea_height);
        this.update_gl();
    }

    update_legend() {
        this.fig_marks.selectAll(".g_legend").remove();

        const legend_height = 14;
        const legend_width = 24;
        const legend_location = this.model.get("legend_location");

        const legend_g = this.fig_marks.append("g")
          .attr("class", "g_legend");

        const that = this;
        let count = 1;
        let max_label_len = 1;

        if(this.mark_views !== undefined && this.mark_views !== null) {
            Promise.all(this.mark_views.views).then(function(views) {
                views.forEach(function(mark_view: any) {
                    if(mark_view.model.get("display_legend")) {
                        const child_count = mark_view.draw_legend(legend_g, 0, count * (legend_height + 2), 0, legend_height + 2);
                        count = count + child_count[0];
                        max_label_len = (child_count[1]) ?
                            Math.max(max_label_len, child_count[1]) : max_label_len;
                    }
                });

                const coords = that.get_legend_coords(legend_location, legend_width, (count + 1) * (legend_height + 2), 0);
                if(count !== 1) {
                    legend_g.insert("g", ":first-child")
                      .attr("class", "axis")
                    .append("rect")
                      .attr("y", (legend_height + 2) / 2.0)
                      .attr("x", (-0.5 * (legend_height + 2)))
                      .attr("width", (max_label_len + 2) + "em")
                      .attr("height", (count * (legend_height + 2)));

                }
                max_label_len = (legend_location === "top-right" ||
                                 legend_location === "right" ||
                                 legend_location === "bottom-right") ? -(max_label_len + 2) : 1;
                const em = 16;
                legend_g.attr("transform", "translate(" + String(coords[0] + max_label_len * em) + " " +
                                                          String(coords[1]) + ") ");

                legend_g.selectAll("text.legendtext").styles(that.model.get("legend_text"));

                legend_g.selectAll(".axis").selectAll("rect").styles(that.model.get("legend_style"));

            });
        }
    }

    get_legend_coords(legend_location, width, height, disp) {
        let x_start = 0;
        let y_start = 0;
        const fig_width = this.plotarea_width;
        const fig_height = this.plotarea_height;

        switch (legend_location){
            case "top":
                x_start = fig_width * 0.5 - width;
                y_start = 0;
                break;
            case "top-right":
                x_start = fig_width - disp;
                y_start = 0;
                break;
            case "right":
                x_start = fig_width - disp;
                y_start = fig_height* 0.5 - height;
                break;
            case "bottom-right":
                x_start = fig_width - disp;
                y_start = fig_height - height;
                break;
            case "bottom":
                x_start = fig_width * 0.5 - width;
                y_start = fig_height - height;
                break;
            case "bottom-left":
                x_start = 0;
                y_start = fig_height - height;
                break;
            case "left":
                x_start = 0;
                y_start = fig_height * 0.5 - height;
                break;
            default:
                x_start = 0;
                y_start = 0;
        }
        return [x_start, y_start];
    }

    set_interaction(model) {
        if (model) {
            // Capture all interactions with the svg overlay
            this.svg.style("pointer-events", "all");
            // Sets the child interaction
            const that = this;
            model.state_change.then(function() {
                // Sets the child interaction
                that.create_child_view(model).then(function(view) {
                    if (that.interaction_view) {
                        that.interaction_view.remove();
                    }
                    that.interaction_view = view;
                    that.interaction.node().appendChild(view.el);
                    that.displayed.then(function() {
                        view.trigger("displayed");
                    });
                });
            });
        } else {
            // Let interactions pass through to the marks
            this.svg.style("pointer-events", "none");
            if (this.interaction_view) {
                this.interaction_view.remove();
            }
        }
    }

    update_title(model, title) {
        this.title.text(this.model.get("title"));
    }

    remove() {
        if(this.mark_views !== undefined && this.mark_views !== null) {
            this.mark_views.remove();
        }
        if(this.axis_views !== undefined && this.axis_views !== null) {
            this.axis_views.remove();
        }
        if(this.tooltip_div !== undefined) {
            this.tooltip_div.remove();
        }
        return super.remove.apply(this, arguments);
    }

    get_svg() {
        // Returns the outer html of the figure svg

        const  replaceAll = function (find, replace, str) {
            return str.replace(new RegExp(find, "g"), replace);
        };

        const get_css = function(node, regs) {
            /**
             * Gathers all the css rules applied to elements of the svg
             * node. Removes the parent element selectors specified in
             * argument `regs`.
             */
            let css = "";
            const sheets = document.styleSheets;
            let selector;
            for (let i = 0; i < sheets.length; i++) {
                const rules: any = (sheets[i] as CSSStyleSheet).cssRules;
                if (rules) {
                    for (let j = 0; j < rules.length; j++) {
                        const rule = rules[j];
                        if (typeof(rule.style) !== "undefined") {
                            let match = null;
                            try {
                                match = node.querySelectorAll(rule.selectorText);
                            } catch (err) {
                                console.warn("Invalid CSS selector '" +
                                             rule.selectorText + "'", err);
                            }
                            if (match) {
                                const elems = node.querySelectorAll(rule.selectorText);
                                if (elems.length > 0) {
                                    selector = rule.selectorText;
                                    for (let r = 0; r < regs.length; r++) {
                                        selector = replaceAll(regs[r], "", selector);
                                    }
                                    css += `${selector} { ${rule.style.cssText} }
                                    `;
                                }
                            } else if (rule.cssText.match(/^@font-face/)) {
                                css += rule.cssText + "\n";
                            }
                        }
                    }
                }
            }
            // TODO: this is terrible. The previous loop over style sheets
            // does not catch document's top-level properties.
            css += "svg { font-size: 10px; }\n";
            return css;
        };

       const svg2svg = function(node, canvas, node_interaction, width, height) {
           // Creates a standalone SVG string from an inline SVG element
           // containing all the computed style attributes.
           const svg = node.cloneNode(true);
           svg.setAttribute("version", "1.1");
           svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
           svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
           svg.style.background = window.getComputedStyle(document.body).background;
           const s = document.createElement("style");
           s.setAttribute("type", "text/css");
           s.innerHTML = "<![CDATA[\n" +
               get_css(node, ["\.theme-dark", "\.theme-light", ".bqplot > "]) + "\n]]>";
           const defs = document.createElement("defs");
           defs.appendChild(s);
           // we put the svg interaction part after the marks
           const g_root = svg.children[0];
           const svg_interaction = node_interaction.cloneNode(true);
           g_root.insertBefore(svg_interaction.children[0].children[0], g_root.children[3])

           // and add the webgl canvas as an image
           const data_url = canvas.toDataURL('image/png');
           const marks = d3.select(g_root.children[2]);
           marks.append("image")
                .attr("x", 0)
                .attr("y", 0)
                .attr("width", 1)
                .attr("height", 1)
                .attr("preserveAspectRatio", "none")
                .attr("transform", "scale(" + width + ", " + height + ")")
                .attr("href", data_url);

           svg.insertBefore(defs, svg.firstChild);
           // Getting the outer HTML
           return svg.outerHTML;
        };
        // Even though the canvas may display the rendering already, it is not guaranteed it can be read of the canvas
        // or we have to set preserveDrawingBuffer to true, which may impact performance.
        // Instead, we render again, and directly afterwards we do get the pixel data using canvas.toDataURL
        return this.render_gl().then(() => {
            // Create standalone SVG string
            const svg = svg2svg(this.svg.node(), this.renderer.domElement, this.svg_interaction.node(), this.plotarea_width, this.plotarea_height);
            return svg;
            // Save to PNG
            //svg2png(svg, this.width, this.height)
        })

    }

    save_png(filename, scale) {

            // scale up the underlying canvas for high dpi screens
            // such that image is of the same quality
            scale = scale || window.devicePixelRatio;

            // Render a SVG data into a canvas and download as PNG.

    // Render a SVG data into a canvas and download as PNG.
        this.get_svg().then((xml) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.classList.add('bqplot');
                canvas.width = this.width * scale;
                canvas.height = this.height * scale;
                canvas.style.width = this.width;
                canvas.style.height = this.height;
                const context = canvas.getContext("2d");
                context.scale(scale, scale);
                context.drawImage(image, 0, 0);
                const a = document.createElement("a");
                a.download = filename || "image.png";
                a.href = canvas.toDataURL("image/png");
                document.body.appendChild(a);
                a.click();
            };
            image.src = "data:image/svg+xml;base64," + btoa(xml);
        })
    }

    save_svg(filename) {
        this.get_svg().then((xml) => {
            const a = document.createElement("a");
            a.download = filename || "bqplot.svg";
            a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(xml);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }

    update_gl() {
        if(!this._update_requested) {
           this._update_requested = true
           requestAnimationFrame(() => this._update_gl())
       }
    }

    _update_gl() {
        this.render_gl()
        this._update_requested = false;
    }

    render_gl() {
        if(this.mark_views === undefined)
            this.update_gl() // we got call to soon, maybe next frame?
        return Promise.all(this.mark_views.views).then((views) => {
            // render all marks that have a render_gl method
            this.renderer.autoClear = false;
            this.renderer.autoClearColor = new (THREE.Color as (x) => void)(0x000000);
            this.renderer.clear()
            let marks_gl = _.filter(views, (view: any) => view.render_gl)
            _.each(marks_gl, (mark: any) => {
                mark.render_gl()
            })
        });
    }

    change_theme() {
        this.el.classList.remove(this.model.previous("theme"));
        this.el.classList.add(this.model.get("theme"));
    }

    axis_views: any;
    bg: any;
    change_layout: any;
    clip_id: any;
    clip_path: any;
    fig_axes: any;
    fig_interaction: any;
    fig_marks: any;
    fig_background: any;
    fig: any;
    figure_padding_x: any;
    figure_padding_y: any;
    height: any;
    interaction_view: any;
    interaction: any;
    margin: any;
    mark_views: any;
    plotarea_height: any;
    plotarea_width: any;
    popper_reference: any;
    popper: any;
    renderer: any;
    scale_x: any;
    scale_y: any;
    svg_interaction: d3.Selection<SVGElement, any, any, any>;
    svg: d3.Selection<SVGElement, any, any, any>;
    svg_background: d3.Selection<SVGElement, any, any, any>;
    title: any;
    tooltip_div: any;
    width: any;
    x_pad_dict: any;
    x_padding_arr: any;
    y_pad_dict: any;
    y_padding_arr: any;

    private _update_requested: boolean;

}
