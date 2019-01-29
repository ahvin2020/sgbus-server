module.exports = function(app) {
	var async = app.locals.async;
	var config = app.locals.config;
	var http = app.locals.http;
	var mysqlLib = app.locals.mysqlLib;
	var mysqlPool = app.locals.mysqlPool;

	// get all bus stops from server and save
	app.get('/busroutes/populate', function(req, res) {
		var conn = null;

		async.auto({
			getConn: function(callback) {
				mysqlPool.getConnection(function(err, connection) {
					conn = connection;
					callback(err);
				});
			},
			getBusStops: ['getConn', function(results, callback) {
				var currentSkip = 0; // increment by 50
				var incrementValue = 50;

				async.doWhilst(
					function(whilstCallback) {

						res.write('retrieving ' + currentSkip + '; ');

						var options = {
							host: 'datamall2.mytransport.sg',
							port: 80,
							path: '/ltaodataservice/BusRoutes?$skip=' + currentSkip,
							headers: {
								'AccountKey': config.datamall.AccountKey,
								'UniqueUserID': config.datamall.UniqueUserID,
								'accept': 'application/json'
							}
						};

						var data = '';
						http.get(options, function(httpRes) {
							httpRes.on("data", function(chunk) {
								data += chunk;
							});
							httpRes.on('end', function() {
								var json = JSON.parse(data);
								var busRouteCount = json["value"].length;

								// still has more bus routes to go?
								if (busRouteCount == incrementValue) {
		    						currentSkip += incrementValue;
		    					} else {
		    						currentSkip = -1;
		    					}

		    					// we have any data to insert?
		    					if (busRouteCount > 0) {
									var sqlQuery = 'INSERT INTO bus_routes (service_no, operator, direction, stop_sequence, bus_stop_code, distance, wd_firstbus, wd_lastbus, sat_firstbus, sat_lastbus, sun_firstbus, sun_lastbus) VALUES ';
									for (var i=0; i<busRouteCount; i++) {
										var busRoute = json['value'][i];
										var subquery = mysqlLib.format('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
											[busRoute['ServiceNo'], busRoute['Operator'], busRoute['Direction'], busRoute['StopSequence'], busRoute['BusStopCode'], busRoute['Distance'], 
											busRoute['WD_FirstBus'], busRoute['WD_LastBus'], busRoute['SAT_FirstBus'], busRoute['SAT_LastBus'], busRoute['SUN_FirstBus'], busRoute['SUN_LastBus']]);

										sqlQuery += subquery;

										if (i + 1 < busRouteCount) {
											sqlQuery += ',';
										} else {
											sqlQuery += 'ON DUPLICATE KEY UPDATE operator=VALUES(operator), distance=VALUES(distance), wd_firstbus=VALUES(wd_firstbus), wd_lastbus=VALUES(wd_lastbus), sat_firstbus=VALUES(sat_firstbus), '
												+ 'sat_lastbus=VALUES(sat_lastbus), sun_firstbus=VALUES(sun_firstbus), sun_lastbus=VALUES(sun_lastbus);';
										}
									}

			    					// save to db
			    					conn.query(sqlQuery, function(err) {	
			    						if (err == null) {
			    							res.write('insert done');
			    							whilstCallback(err);
										} else { // if there's an error, straightaway jump to end
			    							callback(err);
			    						}
				    				});
			    				} else {
			    					whilstCallback(null);
			    				}
		    				});
						}).on('error', function(e) {
							whilstCallback(e, null);
						});
					},
					function() {
						res.write("\n");

						if (currentSkip > -1) {
							return true;
						} else {
							return false;
						}
					},
					function(err) {
						callback(err);
					}
				);
			}],
		}, function(err, results) {
			if (conn) {
				conn.release();
			}

			if (err != null) {
				res.end('error: ' + err);
			} else {
				res.end("done");
			}
		});
	});
};