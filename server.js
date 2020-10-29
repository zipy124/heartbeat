// npm install express socket.io mathjs redis json2csv express-basic-auth

// node index.js // Run your server

const { variance, mean, min } = require('mathjs'); // Statistical functions

const { Parser } = require('json2csv'); // Converts our objects to CSV

let redis = require('redis');
let redisClient = redis.createClient(6379, "heartbeat.38wcux.ng.0001.euw1.cache.amazonaws.com"); // External redis
//let redisClient = redis.createClient(); // Connect to local redis instance

redisClient.on('error', function (err) {
    console.log('Error ' + err)
}) // Log redis errors in the console

//redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.

let app = require('express')();
const basicAuth = require('express-basic-auth')
let server = require('http').createServer(app);
let io = require('socket.io')(server);

let clients = new Set(); // Set (unique list) of identifiers we have seen so far
let clients_last_data_point = {}; // Last data points we visualised for each client
let clients_data_length = {}; // Length of the data sets of each client
let base_data = []; // List of readings to average for our baseline period
let recording = false; // If we are recording the baseline or not
let stored_baseline = 0; // Stored baseline from recorded period

const securedRoutes = require('express').Router();

securedRoutes.use(basicAuth({
    users: { admin: 'examplespass' }, // Admin page username and password
    challenge: true // <--- needed to actually show the login dialog!
}));

securedRoutes.get('', (req, res) => {
    res.sendFile(__dirname + '/index.html'); // put index.html behind the admin password
});


/*
 * @desc Converts our redis datastore into an object format
 * @param function callback - A function to pass our object data into
 * @param object res - the response object from an express response
 */
function redisToJson(callback, res) {

    let data = []; // Where we will store our data
    let numbers = clients.size; // Number of clients we are getting data for
    let reps = 0; // Number of clients we've got data back for from redis
    for (let name of clients) { // For each client name (identifier)
        redisClient.lrange(name, 0, -1, function (err, replies) { // Get all their HR data from redis asynchronously
            replies.forEach(function (res, i) { // For each piece of HR data in the response
                let item = JSON.parse(res, function (key, value) { // Parse the JSON format
                    if (key === 'createdAt') {
                        return new Date(value); // Return the date as a date object not a string
                    } else {
                        return value; // Return all other data in its native type
                    }
                });
                data.push(item); // Push our data to our storage array
            });
            reps++; // Store that we have processed another response
        });
    }

    function waitForRedis(){ // Wait for all our redis callback functions to store the data
        if(reps === numbers){ // If we have all the data we expect pass it on to our callback function
            callback(data,res);
        }
        else{ // Else wait another 100ms
            setTimeout(waitForRedis,100);
        }
    }

    setTimeout(waitForRedis,100); // Wait 100ms (arbitrary time) for redis responses to return
}

// Add the /data endpoint to our secured routes list, requiring authorization to access, returns CSV
securedRoutes.get('/data', (req, res) => {

    /* @desc Callback function to take our object, convert it to CSV and return it as a response
     * @param object Object - Object to transform into CSV
     * @param object res - ExpressJS response object
     */
    function callbackCSV(Object, res) {
        const json2csvParser = new Parser({fields: ["hr", "user", "createdAt"]}); // Fields for the CSV
        const csvString = json2csvParser.parse(Object); // Use our parser to create a CSV string

        res.setHeader('Content-disposition', 'attachment; filename=hrData.csv'); // Set headers
        res.set('Content-Type', 'text/csv'); // Set content/MIME type
        res.status(200).send(csvString); // Return our CSV with a 200 (success) status code
    }

    redisToJson(callbackCSV, res); // Call function to get redis data and return it to our callback function
})

// Add the /api/data endpoint to our secured routes list, requiring authorization to access, returns JSON
securedRoutes.get('/api/data', (req, res) => {

    /* @desc Callback function to take our object, convert it to JSON and return it as a response
     * @param object Object - Object to transform into JSON
     * @param object res - ExpressJS response object
     */
    function callbackJSON(Object, res) {
        res.setHeader('Content-Type', 'application/json'); // Set content/MIME type to indicate our response
        res.end( JSON.stringify(Object)); // Return our JSON string
    }

    redisToJson(callbackJSON, res); // Call function to get redis data and return it to our callback function
})

app.use('/admin', securedRoutes); // Protect the /admin route with a password/username

app.get('/vis', (req, res) => { // Set our /vis route to return the vis.html file
    res.sendFile(__dirname + '/vis.html');
});



// Start of socket.io endpoints and handling
// -----------------------------------------

io.on('connection', (socket) => {

    // Handle what happens on disconnected users
    socket.on('disconnect', function(){
        if(socket.username) {
            console.log(socket.username+" left");
            io.emit('user_changed', {user: socket.username, event: 'left'});
        } // if known user disconnects emit event 'left' with their username
    });


    /*
     * Handle the start-baseline event, sets local variable recording to true, causing us to include subsequent HR
     * readings in the baseline period. Also emits conformation event telling the admin panel the request was received.
     */
    socket.on('start-baseline', () => {
        recording = true;
        io.emit("start-baseline-c", "");
    });

    // Reset our baseline measurements and stop the recording period
    socket.on('reset-baseline', () => {
        recording = false;
        stored_baseline = 0;
        base_data = [];
    });

    /*
     * End the baseline recording period and average out all our results, emit event telling admin panel that the
     * request was received. Also emit event with the baseline to visualisation clients.
     */
    socket.on('end-baseline', () => {
        recording = false;

        stored_baseline = mean(base_data);

        io.emit("baseline", stored_baseline);

        io.emit("end-baseline-c", "");
    });


    // If a new visualization is opened after the baseline measurement is taken, then send it the baseline measurement
    socket.on('request-baseline', () => {
        io.emit("baseline", stored_baseline);
    })

    // Handles users registering their name to their connection.
    socket.on('user_joined', (name) => {

        // Should have an option to say they are connecting for first time, to check against duplicate users??

        if(!(name === "")) { // Check name isn't empty
            if((socket.username) && !(socket.username === name)){ // If they changed name, re-associate their data
                reassociate_user_data(socket, name);
            }

            socket.username = name; // Register their name for their connection
            console.log(socket.username+" joined"); // log client name in server console
            clients.add(socket.username); // Add them to our clients set
            if (!(socket.username in clients_last_data_point)) { // Set value '0' for their last data point visualized
                clients_last_data_point[socket.username] = 0;
            }
            io.emit('user_changed', {user: name, event: 'joined'}); // Emit confirmation to client
        }
    });

    // Receive HR data
    socket.on('send-message', (message) => {
        if(socket.username) { // if known user submits heart rate, send out and record the information
            let data = {hr: message.hr, user: socket.username, createdAt: new Date()} // attach date to the info
            if(recording){ // If recording our baseline add the measurement
                base_data.push(message.hr);
            }
            redisClient.rpush(socket.username, JSON.stringify(data), function(err, reply) { // Push to users Redis List
                if(reply) { // If we get a reply update the clients recorded data length
                    clients_data_length[socket.username] = reply;
                }
                else{ // Log our error
                    console.log("Redis push error: "+err);
                }
            }); // push reading to redis list

            io.emit('message', data); // Emit the message as confirmation we got it

        }
    });

    // Reset the redis data store and local variables, only for use in emergencies...
    socket.on('reset', () => {
        console.log("RESET TRIGGERED: BETTER BE DELIBERATE!")
        redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.

        clients = new Set(); // Set (unique list) of identifiers we have seen so far
        clients_last_data_point = {}; // Last data points we visualised for each client
        clients_data_length = {}; // Length of the data sets of each client
        base_data = []; // List of readings to average for our baseline period
        recording = false; // If we are recording the baseline or not
        stored_baseline = 0; // Stored baseline from recorded period

    });
});

// Start of helper functions
// -------------------------

// @desc calculates and sends visualisation data
function calculate_and_send_vis() {

    let socket = io.sockets; // Let our socket be the global '/' socket

    let data = {"average": [], "variance": [], "raw": []}; // Base data structure to store results in

    let new_data = []; // List of how many new measurements we have from each client
    let clients_with_new_data = []; // List of clients with new data

    for (let name of clients) { // Check every client
        let length = clients_data_length[name]; // Get length of data the client has submitted

        let last_data = clients_last_data_point[name]; // Get how many data points we've visualised from the client

        if (length - last_data > 0) { // If we have new data
            new_data.push(length - last_data); // Store how much new data we have
            clients_with_new_data.push(name); // Store the name of the client with the new data
        }
    }
    if (new_data.length === 0) { // If we have no new data then just return an empty JSONified response
        socket.emit('visualise', JSON.stringify(data));
        return
    }
    let min_new_data_to_send = min(new_data); // Take the minimum amount of data points we have

    let results_obtained = 0; // Amount of results we've collected from Redis so far
    for (let name of clients_with_new_data) { // For every client with new data
        // Get the set amount of new data for this client asynchronously
        redisClient.lrange(name, 0 - min_new_data_to_send, -1, function (err, replies) {
            // If we have replies then loop through them
            if (!(replies === undefined)) {
                replies.forEach(function (response, i) {
                    // Parse each piece of data from its JSON string
                    let item = JSON.parse(response, function (key, value) {
                        if (key === 'createdAt') {
                            return new Date(value);
                        } else {
                            return value;
                        }
                    });

                    if (data["raw"][i] === undefined) {
                        data["raw"][i] = []; // Create our array for raw data of this user
                    }
                    data["raw"][i].push(item.hr); // Push the heart rate data to the raw data array
                    results_obtained += 1; // Log that we have obtained a result from Redis
                });
            } else {
                console.log(err); // If we got a redis error print it here
            }
        });
    }

    // Function that sends results when we have recieved them all from Redis
    function send_results() {
        // If we have recieved all the results we expected, calculate the variance and mean
        if (results_obtained === clients_with_new_data.length * min_new_data_to_send) {
            for (i = 0; i < min_new_data_to_send; i++) { // Calculate the average and variance
                data["average"][i] = mean(data["raw"][i]);
                data["variance"][i] = variance(data["raw"][i], 'uncorrected');
            }
            for (let name of clients_with_new_data) { // Store that we processed more data from each client
                clients_last_data_point[name] = clients_data_length[name];
            }

            socket.emit('visualise', JSON.stringify(data)); // Finally emit our data to the visualisation clients

        } else { // If we haven't got all our results wait 100ms to get them from Redis then try again
            setTimeout(send_results, 100)
        }
    }
    // Try to send our results
    send_results();
}

/*
 * @desc When a user with a name changes their name, we will re-associate all their data with their new name
 * @param object socket - socket.io socket connection to grab the name for
 * @param String name - new name to update to
 */
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


let port = 80; // HTTP port, requires running as admin/sudo/root
let host = '0.0.0.0' // Host to listen on
server.listen(port, host, function(){
    console.log('listening on http://'+host+':' + port);

    // Get all keys in redis and if they're not a key we use they're a username so add to clients set
    redisClient.keys("*", function(err, replies) {
        replies.forEach(function (key, i) {
            if(!(key.startsWith("performance")) && !(key.startsWith("experiment"))){
                clients.add(key.toString());
            }
        });
    });

    // Calculate and send out visualisation data every 3000ms (3 seconds which is interval of App data)
    setInterval(calculate_and_send_vis, 3000);

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
