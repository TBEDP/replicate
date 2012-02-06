var request = require('request')
  , _ = require('underscore')
  , EventProxy = require('eventproxy').EventProxy
  , events = require('events')
  , util = require('util')
  , follow = require('follow')
  , formidable = require('formidable')
  , r = request.defaults({json:true})
  ;

function requests (from, to, callback) {
  console.log("Checking the source & target registry.");
  var args = Array.prototype.slice.call(arguments)
    , callback = args.pop()
    ;
  var proxy = new EventProxy();
  proxy.after("done", args.length, function (items) {
    var errors = [], results = [];
    items.forEach(function (val) {
      errors[val[0]] = val[1];
      results[val[0]] = val[2];
    });
    var error = _.all(errors, _.identity) ? errors : null;
    var passInArgs = _.flatten([error, results]);
    console.log(passInArgs);
    console.log("Checked the source & target registry.");
    callback.apply(null, passInArgs);
  });

  args.forEach(function (val, index) {
    console.log("Requesting " + val + ".");
    r(val, function (err, response, body) {
      if (response.statusCode !== 200) {
        err = new Error("status is not 200.")
      }
      proxy.fire("done", [index, err, body]);
    });
  });
}

function Replicator (options) {
  for (i in options) {
    this[i] = options[i];
  }
  if (this.from[this.from.length - 1] !== '/') {
    this.from += '/';
  }
  if (this.to[this.to.length - 1] !== '/') {
    this.to += '/';
  }
}
util.inherits(Replicator, events.EventEmitter)
Replicator.prototype.pushDoc = function (id, rev, cb) {
  var options = this
    , headers = {'accept':"multipart/related,application/json"}
    ;
    
  if (!cb) cb = function () {}

  if (options.filter && options.filter(id, rev) === false) return cb({id:id, rev:rev, filter:false})

  if (!options.mutation) {
    request
    .get({url: options.from + encodeURIComponent(id) + '?attachments=true&revs=true&rev=' + rev, headers:headers})
    .pipe(request.put(options.to + encodeURIComponent(id) + '?new_edits=false&rev=' + rev, function (e, resp, b) {
      if (e) {
        cb({error:e, id:id, rev:rev, body:b}) 
      } else if (resp.statusCode > 199 && resp.statusCode < 300) {
        cb({id:id, rev:rev, success:true, resp:resp, body:b})
      } else {
        cb({error:"status code is not 201.", id:id, resp:resp, body:b})
      }
      
    }))
  } else {
    var form = new formidable.IncomingForm();
    request.get(
      { uri: options.from + encodeURIComponent(id) + '?attachments=true&revs=true&rev=' + rev
      , onResponse: function (e, resp) {
          // form.parse(resp)
        }
      }, function (e, resp, body) {
        console.log(resp.statusCode)
        console.log(resp.headers)
        // console.error(body)
      }
    );
  }
};

Replicator.prototype.push = function (callback) {
  var self = this;
  requests(self.from, self.to, function (err, fromInfo, toInfo) {
    if (err) {
      throw err;
    }
    self.fromInfo = fromInfo;
    self.toInfo = toInfo;

    console.log("Requesting " + self.from + '_changes' + ".");
    r(self.from + '_changes', function (e, resp, body) {
      if (e) {
        throw e;
      }
      if (resp.statusCode !== 200) {
        throw new Error("status is not 200.");
      }
      var byid = {};
      //console.log(body);
      self.since = body.results[body.results.length - 1].seq;
      body.results.forEach(function (change) {
        byid[change.id] = change.changes.map(function (r) {
          return r.rev;
        });
      });
      console.log("Requesting " + self.to + '_missing_revs' + ".");
      r.post({url: self.to + '_missing_revs', json: byid}, function (e, response, body) {
        var results = []
          , counter = 0
          ;
        var proxy = new EventProxy();
        var missingRevs = body.missing_revs;
        proxy.after("done", Object.keys(missingRevs).length, callback);
        _.map(missingRevs, function (val, key) {
          if (!key) return;
          val.forEach(function (rev) {
            self.pushDoc(key, rev, function (obj) {
              results.push(obj)
              if (obj.error) self.emit('failed', obj)
              else self.emit('pushed', obj);
            });
            
          })
        });
      })
    })
  })
};
Replicator.prototype.continuous = function () {
  var options = this
  options.push(function () {
    follow({db:options.from, since:options.since}, function (e, change) {
      if (e) return
      change.changes.forEach(function (o) {
        options.pushDoc(change.id, o.rev, function (obj) {
          if (obj.error) options.emit('failed', obj)
          else options.emit('pushed', obj)
        })
      })
    })
  })
}

function replicate(from, to, callback) {
  if (typeof from === 'object') {
    var options = from;
  } else {
    var options = {from:from, to:to}
  }
  var rep = new Replicator(options);
  rep.push(callback);
  return rep
}

module.exports = replicate;
replicate.Replicator = Replicator;