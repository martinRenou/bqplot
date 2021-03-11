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

import * as d3 from 'd3';
import { MarkModel } from './MarkModel';
import * as serialize from './serialize';


export
class GraphModel extends MarkModel {
    defaults() {
        return { ...MarkModel.prototype.defaults(),
            _model_name: "GraphModel",
            _view_name: "Graph",
            node_data: [],
            link_matrix: [],
            link_data: [],
            charge: 300,
            link_distance: 100,
            link_type: 'arc',
            directed: true,
            highlight_links: true,
            colors: d3.scaleOrdinal(d3.schemeCategory10).range(),
            x: [],
            y: [],
            color: null,
            link_color: null,
            hovered_point: null,
            scales_metadata: {
                x: { orientation: "horizontal", dimension: "x" },
                y: { orientation: "vertical", dimension: "y" },
                color: { dimension: "color" }
            },
        };
    }

    initialize(attributes, options) {
        super.initialize(attributes, options);

        this.on_some_change(["x", "y", "color", "link_color",
                             "node_data", "link_data", "link_color", ],
                            this.update_data, this);
        this.on_some_change(["preserve_domain"], this.updateDomains, this);
        this.update_data();
    }

    private getShapeAttrs(shape: string, attrs) {
        const newAttrs: any = {};
        switch (shape) {
            case "circle":
                newAttrs.r = attrs.r || 15;
                break;
            case "rect":
                newAttrs.width = attrs.width || 25;
                newAttrs.height = attrs.height || newAttrs.width * 0.8;
                newAttrs.rx = attrs.rx || 0;
                newAttrs.ry = attrs.ry || 0;
                break;
            case "ellipse":
                newAttrs.rx = attrs.rx || 20;
                newAttrs.ry = attrs.ry || newAttrs.rx * 0.6;
                break;
            default:
                console.log("Invalid shape passed - ", shape);
        }
        return newAttrs;
    }

    private updateNodeData() {
        let nodeData = this.get("node_data");
        const x = this.get("x");
        const y = this.get("y");
        const color = this.get("color") || [];

        const scales = this.get("scales");
        const color_scale = scales.color;

        if (nodeData.length > 0 && typeof nodeData[0] === "string") {
            nodeData = nodeData.map((d) => { return {label: d}; });
        }

        this.mark_data = [];
        //populate mark data from node data with meaningful defaults filled in
        nodeData.forEach((d, i) => {
            d.label = d.label || "N" + i;
            d.label_display = d.label_display || "center";
            d.shape = d.shape || "circle";
            d.shape_attrs = this.getShapeAttrs(d.shape, d.shape_attrs || {});
            d.value = d.value || null;
            this.mark_data.push(d);
        });

        // also add x, y and color fields
        if (x.length !== 0 && y.length !== 0) {
            if (color_scale) {
                if (!this.get("preserve_domain").color) {
                    color_scale.compute_and_set_domain(color,
                                                       this.model_id + "_color");
                } else {
                    color_scale.del_domain([], this.model_id + "_color");
                }
            }

            this.mark_data.forEach(function(d, i) {
                d.xval = x[i];
                d.yval = y[i];
                d.color = color[i];
            });
        }
    }

    private updateLinkData() {
        const link_color_scale = this.get("scales").link_color;
        this.link_data = this.get("link_data");
        let link_matrix = this.get("link_matrix");
        const link_color = this.get("link_color");

        if (link_color_scale !== undefined && link_color.length > 0) {
            link_matrix = link_color;
        }

        //coerce link matrix into format understandable by d3 force layout
        if (this.link_data.length === 0 && link_matrix.length > 0) {
            link_matrix.forEach((d, i) => {
                d.forEach((e, j) => {
                    if (e !== null) {
                        this.link_data.push({source: i, target: j, value: e});
                    }
                });
            });
        }
    }

    update_data() {
        this.dirty = true;
        this.updateNodeData();
        this.updateLinkData();
        this.updateDomains();
        this.dirty = false;
        this.trigger("data_updated");
    }

    get_data_dict(data, index) {
        return data;
    }

    updateDomains() {
        const data_scale_key_map = {x: 'xval', y: 'yval'};

        if (!this.mark_data) {
            return;
        }

        const scales = this.get("scales");
        for (let key in scales) {
            if (scales.hasOwnProperty(key)) {
                const scale = scales[key];
                if (!this.get("preserve_domain")[key]) {
                    scale.compute_and_set_domain(this.mark_data.map(function(d) {
                        return d[key] || d[data_scale_key_map[key]];
                    }), this.model_id + key);
                } else {
                    scale.del_domain([], this.model_id + key);
                }
            }
       }
    }

    static serializers = {
        ...MarkModel.serializers,
        x: serialize.array_or_json,
        y: serialize.array_or_json,
        color: serialize.array_or_json,
        link_color: serialize.array_or_json,
        link_matrix: serialize.array_or_json
    }

    link_data: {source: number, target: number, value: number}[];
}
