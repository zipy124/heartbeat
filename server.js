// npm install express  socket.io

// node index.js // Run your server
const { variance, mean, min } = require('mathjs');

let redis = require('redis');
let redisClient = redis.createClient(6379, "heartbeat.38wcux.ng.0001.euw1.cache.amazonaws.com");

redisClient.on('error', function (err) {
    console.log('Error ' + err)
}) // Log redis errors in the console

redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.

let app = require('express')();
const basicAuth = require('express-basic-auth')
let server = require('http').createServer(app);
let io = require('socket.io')(server);

//let before_time;
//let start_time;
//let end_time;


let clients = new Set();
let clients_last_data_point = {};
let clients_data_length = {};

function login (req, res) {
//btoa('yourlogin:yourpassword') -> "eW91cmxvZ2luOnlvdXJwYXNzd29yZA=="
//btoa('otherlogin:otherpassword') -> "b3RoZXJsb2dpbjpvdGhlcnBhc3N3b3Jk"

    // Verify credentials
    if (  req.headers.authorization !== 'Basic eW91cmxvZ2luOnlvdXJwYXNzd29yZA=='
      && req.headers.authorization !== 'Basic b3RoZXJsb2dpbjpvdGhlcnBhc3N3b3Jk')
        return res.status(401).send('Authentication required.') // Access denied.

    // Access granted...
    res.sendFile(__dirname + '/index.html'); // root '/' directory returns index.html
    // or call next() if you use it as middleware (as snippet #1)
}

var securedRoutes = require('express').Router()

securedRoutes.use(basicAuth({
    users: { admin: 'unlimitedheartbeat2020' },
    challenge: true // <--- needed to actually show the login dialog!
}));

securedRoutes.get('', (req, res) => {
    res.sendFile(__dirname + '/index.html'); // root '/' directory returns index.html
});

app.use('/admin', securedRoutes);

app.get('/vis', (req, res) => {
    res.sendFile(__dirname + '/vis.html'); // root '/' directory returns index.html
});

// Start of socket.io endpoints and handling
// -----------------------------------------

io.on('connection', (socket) => {
    socket.on('disconnect', function(){
        if(socket.username) {
            console.log(socket.username+" left");
            io.emit('user_changed', {user: socket.username, event: 'left'});
        } // if known user disconnects emit event 'left'
    });

    socket.on('user_joined', (name) => {

        // Should have an option to say they are connecting for first time, to check against duplicate users??

        if(!(name === "")) { // Check name isn't empty
            if((socket.username) && !(socket.username === name)){ // Changed name, re-associate data
                reassociate_user_data(socket, name);
            }

            socket.username = name;
            console.log(socket.username+" joined");
            clients.add(socket.username);
            if (!(socket.username in clients_last_data_point)) {
                clients_last_data_point[socket.username] = 0;
            }
            io.emit('user_changed', {user: name, event: 'joined'});
        }
    }); // let user be known by a name

    socket.on('vis-request', () => {
        calculate_and_send_vis(socket);
    });

    socket.on('begin-experiment', () => {
        let key = new Date()
        redisClient.set("experiment:start", key.toJSON(), function(err, reply) {
            if(reply) {
                io.emit('e-start', "");
                console.log("Experiment started!")
            }
            else{
                console.log("Redis push error: "+err);
            }
        }); // push reading to redis list
    });

    socket.on('begin-performance', () => {
        let key = new Date()
        redisClient.set("performance:start", key.toJSON(), function(err, reply) {
            if(reply) {
                io.emit('p-start', "");
                console.log("Performance started!")
            }
            else{
                console.log("Redis push error: "+err);
            }
        }); // push reading to redis list
    });

    socket.on('performance-end', () => {
        let key = new Date()
        redisClient.set("performance:ended", key.toJSON(), function(err, reply) {
            if(reply) {
                io.emit('p-end', "");
                console.log("Performance ended!")
            }
            else{
                console.log("Redis push error: "+err);
            }
        }); // push reading to redis list
    });

    socket.on('experiment-end', () => {
        let key = new Date()
        redisClient.set("experiment:ended", key.toJSON(), function(err, reply) {
            if(reply) {
                io.emit('e-end', "");
                console.log("Experiment ended!")
            }
            else{
                console.log("Redis push error: "+err);
            }
        }); // push reading to redis list
    })

    socket.on('send-message', (message) => {
        if(socket.username) { // if known user submits heart rate, send out the information
            let data = {hr: message.hr, user: socket.username, createdAt: new Date()}
            redisClient.rpush(socket.username, JSON.stringify(data), function(err, reply) {
                if(reply) {
                    clients_data_length[socket.username] = reply;
                    console.log(socket.username + ":" +message.hr.toString() + ", " + reply.toString() + " results");
                }
                else{
                    console.log("Redis push error: "+err);
                }
            }); // push reading to redis list

            io.emit('message', data);

        }
    });

    socket.on('print', () => {
        console.log("print requested");
        try {
            print_user_stats(socket.username);
        }
        catch (e) {
            console.log("Failed to print, reason: ");
            console.log(e);
        }
    });

    socket.on('reset', () => {
        console.log("RESET TRIGGERED: BETTER BE DELIBERATE!")
        redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.
        clients = new Set();
        clients_last_data_point = {};
        clients_data_length = {};
    });
});

// Start of helper functions
// -------------------------

function print_user_stats(name){
    let before_avg = 0;
    let during_avg = 0;
    let after_avg = 0;
    let before_count = 0;
    let during_count = 0;
    let after_count = 0;

    let estart;
    let pstart;
    let pend;
    let eend;

    let redis_data_returned = 0;

    redisClient.get("experiment:start", function(err, reply) {
        if(!(reply)){
            estart = new Date();
        }
        else {
            estart = new Date(reply);
        }
        redis_data_returned += 1;
    });
    redisClient.get("performance:start", function(err, reply) {
        if(!(reply)){
            pstart = new Date();
        }
        else {
            pstart = new Date(reply);
        }
        redis_data_returned += 1;
    });
    redisClient.get("performance:ended", function(err, reply) {
        if(!(reply)){
            pend = new Date();
        }
        else {
            pend = new Date(reply);
        }
        redis_data_returned += 1;
    });
    redisClient.get("experiment:ended", function(err, reply) {
        if(!(reply)){
            eend = new Date();
        }
        else {
            eend = new Date(reply);
        }
        redis_data_returned += 1;
    });

    function calc_print() {

        if(redis_data_returned === 4) {
            redisClient.lrange(name, 0, -1, function (err, replies) {
                replies.forEach(function (res, i) {

                    let item = JSON.parse(res, function (key, value) {
                        if (key === 'createdAt') {
                            return new Date(value);
                        } else {
                            return value;
                        }
                    });


                    if (item.createdAt < pstart) {
                        before_avg += item.hr;
                        before_count += 1;
                    } else if (item.createdAt > pstart && item.createdAt < pend) {
                        during_avg += item.hr;
                        during_count += 1;
                    } else {
                        after_avg += item.hr;
                        after_count += 1;
                    }

                    console.log("Redis: " + item.user + ":" + item.hr.toString() + " at : " + item.createdAt.toISOString()
                      .replace(/T/, ' ').replace(/\..+/, ''));
                });

                if ((before_avg > 0) && (before_count > 0)) {
                    before_avg = Math.round(before_avg / before_count);
                    console.log("Before: Avg HR: " + before_avg.toString() + " measurements: " + before_count.toString());
                } else {
                    console.log("Before: No data, or bad data");
                }

                if ((during_avg > 0) && (during_count > 0)) {
                    during_avg = Math.round(during_avg / during_count);
                    console.log("During: Avg HR: " + during_avg.toString() + " measurements: " + during_count.toString());
                } else {
                    console.log("During: No data, or bad data");
                }

                if ((after_avg > 0) && (after_count > 0)) {
                    after_avg = Math.round(after_avg / after_count);
                    console.log("After: Avg HR: " + after_avg.toString() + " measurements: " + after_count.toString());
                } else {
                    console.log("After: No data, or bad data");
                }
            });
        }
        else{
            setTimeout(calc_print, 100);
        }
    }

    calc_print();
}


function calculate_and_send_vis(socket) {
    //console.log("vis request");
    let data = {"average": [], "variance": [], "raw": []};

    let new_data = [];
    let clients_with_new_data = [];

    for (let name of clients) {
        //console.log("Checking "+name);
        let length = clients_data_length[name];
        //console.log(length);
        let last_data = clients_last_data_point[name];
        //console.log(last_data);
        if (length - last_data > 0) {
            new_data.push(length - last_data);
            clients_with_new_data.push(name);
        }
    }
    if (new_data.length === 0) {
        return
    }
    let min_new_data_to_send = min(new_data);
    //console.log(new_data);
    //console.log(min_new_data_to_send);

    let results_obtained = 0;
    for (let name of clients_with_new_data) {
        redisClient.lrange(name, 0 - min_new_data_to_send, -1, function (err, replies) {
            if (!(replies === undefined)) {
                replies.forEach(function (res, i) {
                    let redis_data = res;

                    let item = JSON.parse(redis_data, function (key, value) {
                        if (key === 'createdAt') {
                            return new Date(value);
                        } else {
                            return value;
                        }
                    });
                    if (data["raw"][i] === undefined) {
                        data["raw"][i] = [];
                    }
                    data["raw"][i].push(item.hr);
                    results_obtained += 1;
                });
            } else {
                console.log(err);
            }
        });
    }

    function send_results() {
        if (results_obtained === clients_with_new_data.length * min_new_data_to_send) {
            for (i = 0; i < min_new_data_to_send; i++) {
                data["average"][i] = mean(data["raw"][i]);
                data["variance"][i] = variance(data["raw"][i], 'uncorrected');
            }
            for (let name of clients_with_new_data) {
                clients_last_data_point[name] = clients_data_length[name];
            }
            //console.log("Trying to send results!");
            console.log(data);
            socket.emit('visualise', JSON.stringify(data));
        } else {
            setTimeout(send_results, 100)
        }
    }

    send_results();

    // socket.emit('visualise', JSON.stringify(data));
}

function reassociate_user_data(socket, name) {
    clients.delete(socket.username); // Delete old name
    if (socket.username in clients_last_data_point) {
        clients_last_data_point[name] = clients_last_data_point[socket.username];
    }
    if (socket.username in clients_data_length) {
        clients_data_length[name] = clients_data_length[socket.username];
    }

    // Transfer Redis data
    redisClient.lrange(socket.username, 0, -1, function (err, replies) {
        replies.forEach(function (res, i) {
            redisClient.rpush(name, res, function (err, reply) {
                clients_data_length[name] = reply;
            });
        });
        redisClient.del(socket.username); // Delete old username data
    });
}


let port = 80;
let host = '0.0.0.0'
server.listen(port, host, function(){
    console.log('listening on http://'+host+':' + port);

});


/*
...
message.hr //
P1: 65, 66, 70, 66, 59, ...
P2: 70, 62, 72, 69, 59, ...
P3: 70, 62, 72, 69, 59, ...
....
...

Visualisation
Storing.

| Pre- session |  Performance (15mins)  | Post session |
*/
