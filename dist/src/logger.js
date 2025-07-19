"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_color_log_1 = __importDefault(require("node-color-log"));
const app = node_color_log_1.default.createNamedLogger("APP");
const oai = node_color_log_1.default.createNamedLogger("OAI");
const twl = node_color_log_1.default.createNamedLogger("TWL");
const log = {
    get app() {
        return app.color("white");
    },
    get oai() {
        return oai.color("cyan");
    },
    get twl() {
        return twl.color("magenta");
    },
};
exports.default = log;
