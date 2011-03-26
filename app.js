var express = require('express');
var sys = require('sys');
var _ = require('underscore');
var rclient = require('./redisclient');
var client = rclient.initClient();
var RedisStore = require('./connect_redis');
var app = express.createServer();
var io = require('socket.io');

app.configure(function() {
    app.use(express.bodyDecoder());
    app.use(express.cookieDecoder());
    app.use(express.session({ store: new RedisStore({ maxAge: 60000 * 60 * 24 * 30 })}));
});

// EJS is our default templating system
app.set('view engine', 'ejs');


// Display login screen
app.get('/', function(req, res) {
    res.render('index', {
        locals: { title: "Location-Based Chat" }
    });
});

app.post('/messages', function(req, res) {
    var user = req.body.username;
    var gh = req.body.geohash;
    var msg = req.body.message;
    var ts = +new Date();
    // Nothing to be sent to the client
    res.send();
    console.log("New message @ "+gh+", "+msg);
    // First, get a unique identifier for the message
    client.incr("message.incr", function(err,key) {
        if (!err) {
            // Store message itself
            client.set("msg."+key, {user: user, geohash: gh, message: msg, timestamp: ts});
            // Store message in global set by timestamp
            client.zadd("msgs.global", ts, key);
            // store the message in geohash sorted sets named with
            // the 4,5,6,7 prefixes, with the timestamp as the score.
            // Store in prefix-4
            client.zadd("msgs.gh."+gh.substr(0,4), ts, key);
            // Store in prefix-5
            client.zadd("msgs.gh."+gh.substr(0,5), ts, key);
            // Store in prefix-6
            client.zadd("msgs.gh."+gh.substr(0,6), ts, key);
            // Store in prefix-7
            client.zadd("msgs.gh."+gh.substr(0,7), ts, key);
        }
    });

});


// Static files.  Keep this last so it doesn't interfere with dynamic routes.
app.use(express.staticProvider(__dirname + '/static'));

/*************** Error Handling *************/
function NotFound(msg) {
    this.name = 'NotFound';
    this.msg = msg;
    Error.call(this, msg);
    Error.captureStackTrace(this, arguments.callee);
}

sys.inherits(NotFound, Error);

// Error page
app.get('/error', function(req, res) {
    unknownMethod();
});

app.error(function(err, req, res, next) {
    if (err instanceof NotFound) {
        res.render('404', { status: 404,
                            locals: {
                                title: "Not Found",
                                user: null,
                                nav: "",
                                msg: err.msg
                            }
                          });
    } else {
        next(err);
    }
});

app.error(function(err, req, res) {
    console.log(sys.inspect(err));
    console.log("Stack:",sys.inspect(err.stack));
    console.log("Message:",err.message);
    res.render('500', {
        status: 500,
        locals: {
            title: "Error",
            error: err
        }
    });
});

// Start the server
app.listen(8134);

/************** Socket.IO *****************/
// Broadcast recent events
var socket = io.listen(app);

//actions.set_listener(function(msg) {
//    socket.broadcast(msg);
//});
// on connection, don't do anything...
//socket.on('connection', function(client){
//});