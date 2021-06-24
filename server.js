// npm install express socket.io mathjs redis json2csv express-basic-auth

// node index.js // Run your server

const { Parser } = require('json2csv'); // Converts our objects to CSV

let redis = require('redis');
//let redisClient = redis.createClient(6379, "heartbeat.38wcux.ng.0001.euw1.cache.amazonaws.com"); // External redis
let redisClient = redis.createClient(); // Connect to local redis instance

redisClient.on('error', function (err) {
    console.log('Error ' + err)
}) // Log redis errors in the console

//redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.

let app = require('express')();
const basicAuth = require('express-basic-auth');
let server = require('http').createServer(app);
let io = require('socket.io')(server);

let clients = new Set(); // Set (unique list) of identifiers we have seen so far

const securedRoutes = require('express').Router();

securedRoutes.use(basicAuth({
    users: { admin: 'examplepass' }, // Admin page username and password
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
        const json2csvParser = new Parser({fields: ["hr", "user", "id", "createdAt"]}); // Fields for the CSV
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

    // Handles users registering their name to their connection.
    socket.on('user_joined', (name) => {
        socket.username = socket.handshake.headers["x-forwarded-for"] + " " + socket.handshake.headers["user-agent"]
        socket.id = name
        console.log(name+" joined: "+socket.username); // log client name in server console
        clients.add(socket.username); // Add them to our clients set
    });

    // Receive HR data
    socket.on('send-message', (message) => {
        if(socket.username) { // if known user submits heart rate, send out and record the information
            let data = {hr: message.hr, user: socket.id, id: socket.username, createdAt: new Date()} // attach date to the info

            redisClient.rpush(socket.username, JSON.stringify(data), function(err, reply) { // Push to users Redis List
                if(reply) { // If we get a reply update the clients recorded data length
                }
                else{ // Log our error
                    console.log("Redis push error: "+err);
                }
            }); // push reading to redis list

        }
    });

    // Reset the redis data store and local variables, only for use in emergencies...
    socket.on('reset', () => {
        console.log("RESET TRIGGERED: BETTER BE DELIBERATE!")
        redisClient.flushdb(); // Empties redis database, only use in DEBUG, in production this could wipe valuable data.

        clients = new Set(); // Set (unique list) of identifiers we have seen so far

    });
});

// Start of helper functions
// -------------------------

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
