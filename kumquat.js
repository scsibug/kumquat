var express = require('express');
var sys = require('sys');
var _ = require('underscore');
var rclient = require('./redisclient');
var client = rclient.initClient();
var RedisStore = require('./connect_redis');
var app = express.createServer();
var io = require('socket.io');
var chat = require('./chat');
app.configure(function() {
    app.use(express.bodyDecoder());
    app.use(express.cookieDecoder());
    app.use(express.session({ store: new RedisStore({ maxAge: 60000 * 60 * 24 * 30 })}));
});

// EJS is our default templating system
app.set('view engine', 'ejs');


// Display login screen
app.get('/', function(req, res) {
    var defaultRadius = req.session.defaultradius;
    console.log("defaultRadius is "+defaultRadius);
    if (!defaultRadius) {defaultRadius = 4;}
    console.log("Using default radius of "+defaultRadius);
    res.render('index', {
        locals: { title: "Kumquat: Local Chat",
                  listeningRadius: defaultRadius
                }
    });
});

// Allow client to set a preference for listening radius
app.post('/user/defaultradius/:size', function(req, res) {
    req.session.defaultradius = req.params.size;
    console.log("Saved new default radius of "+req.session.defaultradius+" into session");
    res.send();
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
            // Store messages, and publish to channels
            // Store message itself
            msgobj = JSON.stringify({user: user, geohash: gh, message: msg, timestamp: ts});
            client.set("msg."+key, msgobj);
            // Store message in global set by timestamp
            client.zadd("msgs.global", ts, key);
            client.publish("chan.msgs.global", msgobj);
            // store the message in geohash sorted sets named with
            // the 4,5,6,7 prefixes, with the timestamp as the score.
            // Store in prefix-4
            client.zadd("msgs.gh."+gh.substr(0,4), ts, key);
            client.publish("chan.msgs.gh."+gh.substr(0,4), msgobj);
            // Store in prefix-5
            client.zadd("msgs.gh."+gh.substr(0,5), ts, key);
            client.publish("chan.msgs.gh."+gh.substr(0,5), msgobj);
            // Store in prefix-6
            client.zadd("msgs.gh."+gh.substr(0,6), ts, key);
            client.publish("chan.msgs.gh."+gh.substr(0,6), msgobj);
            // Store in prefix-7
            client.zadd("msgs.gh."+gh.substr(0,7), ts, key);
            client.publish("chan.msgs.gh."+gh.substr(0,7), msgobj);
        }
    });
});

// Find the date (as millis-since-epoch) for X days ago since the given date.
function date_from_days_ago(days, date_millis) {
    var x = 1000*60*60*24*days;
    return date_millis - x;
}

app.get('/messages/:geohash', function(req,res) {
    get_messages(req.params.geohash,function(err, msgs) {
        res.send(JSON.stringify(msgs));
    });
});

var get_messages = function (geohash, callback) {
    var now = +new Date();
    var messages = [];
    client.zrangebyscore("msgs.gh."+geohash,date_from_days_ago(7,now),now, function(err,reply){
        if (err) {
            callback(err);
            return;
        } else if (_.isNull(reply) || reply.length == 0) {
            callback("No messages found",[]);
            return;
        }
        var replies = 0;
        for(var i=0; i < reply.length; i++) {
            var msg_id = "msg."+reply[i].toString();
            client.get(msg_id, function(err,msg) {
                messages.push(JSON.parse(msg));
                replies++;
                if (replies == reply.length) {
                    callback(err,messages);
                }
            });
        }
    });
}



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

socket.on('connection', function(client){ 
    // create redis listener for this client
    var pubclient = rclient.createPubClient();

    // Send anything sent to subscribed channels back to the client
    pubclient.on("message", function(channel, message) {
        client.send(message);
    });
    pubclient.on("error", function(err) {
        console.log("pub/sub client emitted error: "+err);
    });

    client.on('message', function(message){
        console.log("Message received: "+message);
        var request = JSON.parse(message);
        if (request.action == 'subscribe') {
            pubclient.subscribe("chan.msgs.gh."+request.geohash, function(err,res) {
            });
        } else if (request.action == 'unsubscribe-all') {
            pubclient.unsubscribe();
        }
    });

    client.on('disconnect', function(){
        pubclient.quit();
    });
});
