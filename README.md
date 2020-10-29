# heartbeat
simple node.js server application to track multiple users heart rates in real-time

# Dependencies

This node.js requires also a redis client, run either on the same server or seperately. After installing both of these you can either install from the package.json using a command such as "npm ci" or to get the latest versions of the packages run "npm install express socket.io mathjs redis json2csv express-basic-auth". 

# Setting up host names and ports

## server.js
At the top of this file you can customize where the redis server lives. For example for a local redis server you un-comment line 11 ```let redisClient = redis.createClient();``` and comment line 10. If running elsewhere you can un-comment line 10 ``` let redisClient = redis.createClient(PORT, "HOSTNAME"); ``` and comment line 11. Note ```"HOSTNAME"``` does not begin with ```"rediss//:"``` like a redis url as it is automitcally handeled.

## index.html
Line 11 should be changed to ```var socket = io.connect('https://HOSTNAME.com');```. Note the "https" not "http" since the App on android atleast can only connect via https since the android manifest did not include permissions to allow for plain-text trasmition.

## vis.html
Line 14 should be changed to ```var socket = io.connect('https://HOSTNAME.com');```.

# Running it
cd into the directory and then run "node index.js"

# Using a fake client
As well as using the app you can connect a fake client at the admin panel at ```https://HOSTNAME.com/admin``` by typing in and setting a username. The client will then send random numbers between 50-80 every 3 seconds (the same interval as the app). In this menu you can also start and stop recording to get a baseline heart-rate for the visulisation

# Seeing the visulisation
You can go to ```"https://HOSTNAME.com/vis"``` to see the visulisation.

# Getting the HR data out of the survey
You can go to ```https://HOSTNAME.com/admin/data``` to get a .csv file of the data or ```https://HOSTNAME.com/admin/api/data``` for data in JSON format.
