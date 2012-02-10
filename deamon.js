var fork = require('child_process').fork;
var Emitter = require('events').EventEmitter;
var emitter = new Emitter();
var MAX_RESTART = 30;
var counter = 0;

var startReplacate = function () {
  counter++;
  if (counter > MAX_RESTART) {
    return;
  }
  var replication = fork(__dirname + '/bin.js', ['http://isaacs.iriscouch.com/registry', 'http://user:pass@yourip/registry']);
  replication.on("exit", function () {
    emitter.emit("exit");
  });
};

emitter.on("exit", startReplacate);
startReplacate();
