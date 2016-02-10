'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RUN_SAGA_DYNAMIC_ERROR = undefined;
exports.default = sagaMiddlewareFactory;

var _utils = require('./utils');

var _proc = require('./proc');

var _proc2 = _interopRequireDefault(_proc);

var _emitter = require('./emitter');

var _emitter2 = _interopRequireDefault(_emitter);

var _monitorActions = require('./monitorActions');

var _SagaCancellationException = require('./SagaCancellationException');

var _SagaCancellationException2 = _interopRequireDefault(_SagaCancellationException);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var RUN_SAGA_DYNAMIC_ERROR = exports.RUN_SAGA_DYNAMIC_ERROR = 'Before running a Saga dynamically using middleware.run, you must mount the Saga middleware on the Store using applyMiddleware';

function sagaMiddlewareFactory() {
  for (var _len = arguments.length, sagas = Array(_len), _key = 0; _key < _len; _key++) {
    sagas[_key] = arguments[_key];
  }

  var runSagaDynamically = undefined;

  function sagaMiddleware(_ref) {
    var getState = _ref.getState;
    var dispatch = _ref.dispatch;


    var sagaEmitter = (0, _emitter2.default)();
    var monitor = _utils.isDev ? function (action) {
      return (0, _utils.asap)(function () {
        return dispatch(action);
      });
    } : undefined;

    function runSaga(saga) {
      for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        args[_key2 - 1] = arguments[_key2];
      }

      return (0, _proc2.default)(saga.apply(undefined, [getState].concat(args)), sagaEmitter.subscribe, dispatch, monitor, 0, saga.name);
    }

    runSagaDynamically = runSaga;

    sagas.forEach(runSaga);

    return function (next) {
      return function (action) {
        var result = next(action); // hit reducers
        // filter out monitor actions to avoid endless loop
        // see https://github.com/yelouafi/redux-saga/issues/61
        if (!action[_monitorActions.MONITOR_ACTION]) sagaEmitter.emit(action);
        return result;
      };
    };
  }

  sagaMiddleware.run = function (saga) {
    for (var _len3 = arguments.length, args = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
      args[_key3 - 1] = arguments[_key3];
    }

    if (!runSagaDynamically) {
      throw new Error(RUN_SAGA_DYNAMIC_ERROR);
    }
    var task = runSagaDynamically.apply(undefined, [saga].concat(args));
    task.done.catch(function (err) {
      if (!(err instanceof _SagaCancellationException2.default)) throw err;
    });
    return task;
  };

  return sagaMiddleware;
}