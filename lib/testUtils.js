'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createMockTask = createMockTask;

var _utils = require('./utils');

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function createMockTask() {
  var _ref;

  var running = true;
  var result = undefined,
      error = undefined;

  return _ref = {}, _defineProperty(_ref, _utils.TASK, true), _defineProperty(_ref, 'isRunning', function isRunning() {
    return running;
  }), _defineProperty(_ref, 'getResult', function getResult() {
    return result;
  }), _defineProperty(_ref, 'getError', function getError() {
    return error;
  }), _defineProperty(_ref, 'setRunning', function setRunning(b) {
    return running = b;
  }), _defineProperty(_ref, 'setResult', function setResult(r) {
    return result = r;
  }), _defineProperty(_ref, 'setError', function setError(e) {
    return error = e;
  }), _ref;
}