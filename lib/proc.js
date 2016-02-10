'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MANUAL_CANCEL = exports.RACE_AUTO_CANCEL = exports.PARALLEL_AUTO_CANCEL = exports.CANCEL = exports.undefindInputError = exports.NOT_ITERATOR_ERROR = undefined;
exports.default = proc;

var _utils = require('./utils');

var _io = require('./io');

var _monitorActions = require('./monitorActions');

var monitorActions = _interopRequireWildcard(_monitorActions);

var _SagaCancellationException = require('./SagaCancellationException');

var _SagaCancellationException2 = _interopRequireDefault(_SagaCancellationException);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var NOT_ITERATOR_ERROR = exports.NOT_ITERATOR_ERROR = 'proc first argument (Saga function result) must be an iterator';
var undefindInputError = exports.undefindInputError = function undefindInputError(name) {
  return '\n  ' + name + ' saga was provided with an undefined input action\n  Hints :\n  - check that your Action Creator returns a non undefined value\n  - if the Saga was started using runSaga, check that your subscribe source provides the action to its listeners\n';
};

var CANCEL = exports.CANCEL = '@@redux-saga/cancelPromise';
var PARALLEL_AUTO_CANCEL = exports.PARALLEL_AUTO_CANCEL = 'PARALLEL_AUTO_CANCEL';
var RACE_AUTO_CANCEL = exports.RACE_AUTO_CANCEL = 'RACE_AUTO_CANCEL';
var MANUAL_CANCEL = exports.MANUAL_CANCEL = 'MANUAL_CANCEL';

var nextEffectId = (0, _utils.autoInc)();

function proc(iterator) {
  var subscribe = arguments.length <= 1 || arguments[1] === undefined ? function () {
    return _utils.noop;
  } : arguments[1];
  var dispatch = arguments.length <= 2 || arguments[2] === undefined ? _utils.noop : arguments[2];
  var monitor = arguments.length <= 3 || arguments[3] === undefined ? _utils.noop : arguments[3];
  var parentEffectId = arguments.length <= 4 || arguments[4] === undefined ? 0 : arguments[4];
  var name = arguments.length <= 5 || arguments[5] === undefined ? 'anonymous' : arguments[5];


  (0, _utils.check)(iterator, _utils.is.iterator, NOT_ITERATOR_ERROR);

  var UNDEFINED_INPUT_ERROR = undefindInputError(name);

  // tracks the current `take` effects
  var deferredInputs = [];
  var canThrow = _utils.is.throw(iterator);
  // Promise to be resolved/rejected when this generator terminates (or throws)
  var deferredEnd = (0, _utils.deferred)();

  // subscribe to input events, this will resolve the current `take` effects
  var unsubscribe = subscribe(function (input) {
    if (input === undefined) throw UNDEFINED_INPUT_ERROR;

    for (var i = 0; i < deferredInputs.length; i++) {
      var def = deferredInputs[i];
      if (def.match(input)) {
        // cancel all deferredInputs; parallel takes are disallowed
        // and in concurrent takes, first wins
        deferredInputs = [];
        def.resolve(input);
      }
    }
  });

  /**
    cancel : (SagaCancellationException) -> ()
     Tracks the current effect cancellation
    Each time the generator progresses. calling runEffect will set a new value
    on it. It allows propagating cancellation to child effects
  **/
  next.cancel = _utils.noop;

  /**
    Creates a new task descriptor for this generator
  **/
  var task = newTask(parentEffectId, name, iterator, deferredEnd.promise);

  /**
    this maybe called by a parent generator to trigger/propagate cancellation
    W'll simply cancel the current effect, which will reject that effect
    The rejection will throw the injected SagaCancellationException into the flow
    of this generator
  **/
  task.done[CANCEL] = function (_ref) {
    var type = _ref.type;
    var origin = _ref.origin;

    next.cancel(new _SagaCancellationException2.default(type, name, origin));
  };

  // tracks the running status
  iterator._isRunning = true;

  // kicks up the generator
  next();

  // then return the task descriptor to the caller
  return task;

  /**
    This is the generator driver
    It's a recursive aysnc/continuation function which calls itself
    until the generator terminates or throws
  **/
  function next(error, arg) {
    // Preventive measure. If we endup here, then there is really something wrong
    if (!iterator._isRunning) throw new Error('Trying to resume an already finished generator');

    try {
      if (error && !canThrow) throw error;

      // calling iterator.throw on a generator that doesnt defined a correponding try/Catch
      var result = error ? iterator.throw(error) : iterator.next(arg);
      if (!result.done) {
        runEffect(result.value, parentEffectId, '', next);
      } else {
        end(result.value);
      }
    } catch (error) {
      /*eslint-disable no-console*/
      if (_utils.isDev) {
        console.warn(name + ': uncaught', error);
      }
      end(error, true);
    }
  }

  function end(result, isError) {
    iterator._isRunning = false;
    if (!isError) {
      iterator._result = result;
      deferredEnd.resolve(result);
    } else {
      iterator._error = result;
      deferredEnd.reject(result);
    }
    unsubscribe();
  }

  function runEffect(effect, parentEffectId) {
    var label = arguments.length <= 2 || arguments[2] === undefined ? '' : arguments[2];
    var cb = arguments[3];

    var effectId = nextEffectId();
    monitor(monitorActions.effectTriggered(effectId, parentEffectId, label, effect));

    /**
      completion callback and cancel callback are mutually exclusive
      We can't cancel an already completed effect
      And We can't complete an already cancelled effectId
    **/
    var effectSettled = undefined;

    // Completion callback passed to the appropriate effect runner
    function currCb(err, res) {
      if (effectSettled) return;

      effectSettled = true;
      cb.cancel = _utils.noop; // defensive measure
      err ? monitor(monitorActions.effectRejected(effectId, err)) : monitor(monitorActions.effectResolved(effectId, res));

      cb(err, res);
    }
    // tracks down the current cancel
    currCb.cancel = _utils.noop;

    // setup cancellation logic on the parent cb
    cb.cancel = function (cancelError) {
      // prevents cancelling an already completed effect
      if (effectSettled) return;

      effectSettled = true;
      /**
        propagates cancel downward
        catch uncaught cancellations errors,
        because w'll throw our own cancellation error inside this generator
      **/
      try {
        currCb.cancel(cancelError);
      } catch (err) {
        void 0;
      }
      currCb.cancel = _utils.noop; // defensive measure

      /**
        triggers/propagates the cancellation error
      **/
      cb(cancelError);
      monitor(monitorActions.effectRejected(effectId, cancelError));
    };

    /**
      each effect runner must attach its own logic of cancellation to the provided callback
      it allows this generator to propagate cancellation downward.
       ATTENTION! effect runners must setup the cancel logic by setting cb.cancel = [cancelMethod]
      And the setup must occur before calling the callback
       This is a sort of inversion of control: called async functions are responsible
      of completing the flow by calling the provided continuation; while caller functions
      are responsible for aborting the current flow by calling the attached cancel function
       Library users can attach their own cancellation logic to promises by defining a
      promise[CANCEL] method in their returned promises
      ATTENTION! calling cancel must have no effect on an already completed or cancelled effect
    **/
    var data = undefined;
    return(
      // Non declarative effect
      _utils.is.promise(effect) ? resolvePromise(effect, currCb) : _utils.is.iterator(effect) ? resolveIterator(effect, effectId, name, currCb)

      // declarative effects
      : _utils.is.array(effect) ? runParallelEffect(effect, effectId, currCb) : _utils.is.notUndef(data = _io.as.take(effect)) ? runTakeEffect(data, currCb) : _utils.is.notUndef(data = _io.as.put(effect)) ? runPutEffect(data, currCb) : _utils.is.notUndef(data = _io.as.race(effect)) ? runRaceEffect(data, effectId, currCb) : _utils.is.notUndef(data = _io.as.call(effect)) ? runCallEffect(data, effectId, currCb) : _utils.is.notUndef(data = _io.as.cps(effect)) ? runCPSEffect(data, currCb) : _utils.is.notUndef(data = _io.as.fork(effect)) ? runForkEffect(data, effectId, currCb) : _utils.is.notUndef(data = _io.as.join(effect)) ? runJoinEffect(data, currCb) : _utils.is.notUndef(data = _io.as.cancel(effect)) ? runCancelEffect(data, currCb) : /* anything else returned as is        */currCb(null, effect)
    );
  }

  function resolvePromise(promise, cb) {
    var cancelPromise = promise[CANCEL];
    if (typeof cancelPromise === 'function') {
      cb.cancel = cancelPromise;
    }
    promise.then(function (result) {
      return cb(null, result);
    }, function (error) {
      return cb(error);
    });
  }

  function resolveIterator(iterator, effectId, name, cb) {
    resolvePromise(proc(iterator, subscribe, dispatch, monitor, effectId, name).done, cb);
  }

  function runTakeEffect(pattern, cb) {
    var def = {
      match: (0, _io.matcher)(pattern),
      pattern: pattern,
      resolve: function resolve(input) {
        return cb(null, input);
      }
    };
    deferredInputs.push(def);
    // cancellation logic for take effect
    cb.cancel = function () {
      return (0, _utils.remove)(deferredInputs, def);
    };
  }

  function runPutEffect(action, cb) {
    //synchronously nested dispatches can not be performed
    // because on a sync interleaved take/put the receiver will dispatch the
    // action before the sender can take the aknowledge
    // this workaround allows the dispatch to occur on the next microtask
    (0, _utils.asap)(function () {
      return cb(null, dispatch(action));
    });
    // Put effects are non cancellables
  }

  function runCallEffect(_ref2, effectId, cb) {
    var context = _ref2.context;
    var fn = _ref2.fn;
    var args = _ref2.args;

    var result = fn.apply(context, args);
    return _utils.is.promise(result) ? resolvePromise(result, cb) : _utils.is.iterator(result) ? resolveIterator(result, effectId, fn.name, cb) : cb(null, result);
  }

  function runCPSEffect(_ref3, cb) {
    var context = _ref3.context;
    var fn = _ref3.fn;
    var args = _ref3.args;

    // CPS (ie node style functions) can define their own cancellation logic
    // by setting cancel field on the cb
    fn.apply(context, args.concat(cb));
  }

  function runForkEffect(_ref4, effectId, cb) {
    var context = _ref4.context;
    var fn = _ref4.fn;
    var args = _ref4.args;

    var result = undefined,
        _iterator = undefined;

    // we run the function, next we'll check if this is a generator function
    // (generator is a function that returns an iterator)
    result = fn.apply(context, args);

    // A generator function: i.e. returns an iterator
    if (_utils.is.iterator(result)) {
      _iterator = result;
    }

    //simple effect: wrap in a generator
    else {
        _iterator = regeneratorRuntime.mark(function _callee() {
          return regeneratorRuntime.wrap(function _callee$(_context) {
            while (1) {
              switch (_context.prev = _context.next) {
                case 0:
                  _context.next = 2;
                  return result;

                case 2:
                  return _context.abrupt('return', _context.sent);

                case 3:
                case 'end':
                  return _context.stop();
              }
            }
          }, _callee, this);
        })();
      }

    cb(null, proc(_iterator, subscribe, dispatch, monitor, effectId, fn.name, true));
    // Fork effects are non cancellables
  }

  function runJoinEffect(task, cb) {
    resolvePromise(task.done, cb);
  }

  function runCancelEffect(task, cb) {
    // cancel the given task
    // uncaught cancellations errors bubbles upward
    task.done[CANCEL](new _SagaCancellationException2.default(MANUAL_CANCEL, name, name));
    cb();
    // cancel effects are non cancellables
  }

  // Reimplementing Promise.all. We're in 2016
  function runParallelEffect(effects, effectId, cb) {
    if (!effects.length) {
      cb(null, []);
      return;
    }

    var completedCount = 0;
    var completed = undefined;
    var results = Array(effects.length);

    function checkEffectEnd() {
      if (completedCount === results.length) {
        completed = true;
        cb(null, results);
      }
    }

    var childCbs = effects.map(function (eff, idx) {
      var chCbAtIdx = function chCbAtIdx(err, res) {
        // Either we've  been cancelled, or an error aborted the whole effect
        if (completed) return;
        // one of the effects failed
        if (err) {
          // cancel all other effects
          // This is an AUTO_CANCEL (not triggered by a manual cancel)
          // Catch uncaught cancellation errors, because w'll only throw the actual
          // rejection error (err) inside this generator
          try {
            cb.cancel(new _SagaCancellationException2.default(PARALLEL_AUTO_CANCEL, name, name));
          } catch (err) {
            void 0;
          }

          cb(err);
        } else {
          results[idx] = res;
          completedCount++;
          checkEffectEnd();
        }
      };
      chCbAtIdx.cancel = _utils.noop;
      return chCbAtIdx;
    });

    // This is different, a cancellation coming from upward
    // either a MANUAL_CANCEL or a parent AUTO_CANCEL
    // No need to catch, will be swallowed by the caller
    cb.cancel = function (cancelError) {
      // prevents unnecessary cancellation
      if (!completed) {
        completed = true;
        childCbs.forEach(function (chCb) {
          return chCb.cancel(cancelError);
        });
      }
    };

    effects.forEach(function (eff, idx) {
      return runEffect(eff, effectId, idx, childCbs[idx]);
    });
  }

  // And yet; Promise.race
  function runRaceEffect(effects, effectId, cb) {
    var completed = undefined;
    var keys = Object.keys(effects);
    var childCbs = {};

    keys.forEach(function (key) {
      var chCbAtKey = function chCbAtKey(err, res) {
        // Either we've  been cancelled, or an error aborted the whole effect
        if (completed) return;

        if (err) {
          // Race Auto cancellation
          try {
            cb.cancel(new _SagaCancellationException2.default(RACE_AUTO_CANCEL, name, name));
          } catch (err) {
            void 0;
          }

          cb(_defineProperty({}, key, err));
        } else {
          try {
            cb.cancel(new _SagaCancellationException2.default(RACE_AUTO_CANCEL, name, name));
          } catch (err) {
            void 0;
          }
          completed = true;
          cb(null, _defineProperty({}, key, res));
        }
      };
      chCbAtKey.cancel = _utils.noop;
      childCbs[key] = chCbAtKey;
    });

    cb.cancel = function (cancelError) {
      // prevents unnecessary cancellation
      if (!completed) {
        completed = true;
        keys.forEach(function (key) {
          return childCbs[key].cancel(cancelError);
        });
      }
    };
    keys.forEach(function (key) {
      return runEffect(effects[key], effectId, key, childCbs[key]);
    });
  }

  function newTask(id, name, iterator, done, forked) {
    var _ref5;

    return _ref5 = {}, _defineProperty(_ref5, _utils.TASK, true), _defineProperty(_ref5, 'id', id), _defineProperty(_ref5, 'name', name), _defineProperty(_ref5, 'done', done), _defineProperty(_ref5, 'forked', forked), _defineProperty(_ref5, 'cancel', function cancel(error) {
      if (!(error instanceof _SagaCancellationException2.default)) {
        error = new _SagaCancellationException2.default(MANUAL_CANCEL, name, error);
      }
      done[CANCEL](error);
    }), _defineProperty(_ref5, 'isRunning', function isRunning() {
      return iterator._isRunning;
    }), _defineProperty(_ref5, 'getResult', function getResult() {
      return iterator._result;
    }), _defineProperty(_ref5, 'getError', function getError() {
      return iterator._error;
    }), _ref5;
  }
}