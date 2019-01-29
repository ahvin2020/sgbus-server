var express = require('express');
var async = require('async');
var http = require('http');

var app = express();

// config
var config = require('./configs/config.js');

// helper
var util = require('./helpers/util.js');

// mysql
var mysqlLib = require('mysql');
var mysqlPool = mysqlLib.createPool({
    host: config.sql.host,
    user: config.sql.user,
    password: config.sql.password,
    database: config.sql.database,
	connectionLimit: config.sql.connectionLimit,
	multipleStatements: true,
	timezone: '+0800'
});

// global variables
app.locals.async = async;
app.locals.config = config;
app.locals.http = http;
app.locals.mysqlLib = mysqlLib;
app.locals.mysqlPool = mysqlPool;
app.locals.util = util;

// controllers
require('./controllers/busarrivals.js')(app);
require('./controllers/busservices.js')(app);
require('./controllers/busstops.js')(app);
require('./controllers/busroutes.js')(app);

app.get('/', function (req, res) {
  res.send('Sg Bus Server');
});

// start server
var server = app.listen(config.web.port, function() {
	console.log('Example app listening on port ' + config.web.port + '!');
});