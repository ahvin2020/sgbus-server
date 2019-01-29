module.exports = function(app) {
	var async = app.locals.async;
	var config = app.locals.config;
	var http = app.locals.http;
	var mysqlLib = app.locals.mysqlLib;
	var mysqlPool = app.locals.mysqlPool;

	// get all bus stops from server and save
	app.get('/busstops/populate', function(req, res) {
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
							path: '/ltaodataservice/BusStops?$skip=' + currentSkip,
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
								var busStopCount = json["value"].length;

								// still has more bus stops to go?
								if (busStopCount == incrementValue) {
		    						currentSkip += incrementValue;
		    					} else {
		    						currentSkip = -1;
		    					}

		    					// we have any data to insert?
		    					if (busStopCount > 0) {
									var sqlQuery = 'INSERT INTO bus_stops (bus_stop_code, road_name, description, latitude, longitude, point) VALUES ';
									for (var i=0; i<busStopCount; i++) {
										var busStop = json['value'][i];
										var subquery = mysqlLib.format('(?, ?, ?, ?, ?, POINT(?, ?))', 
											[busStop['BusStopCode'], busStop['RoadName'], busStop['Description'], busStop['Latitude'], busStop['Longitude'], busStop['Latitude'], busStop['Longitude']]);

										sqlQuery += subquery;

										if (i + 1 < busStopCount) {
											sqlQuery += ',';
										} else {
											sqlQuery += 'ON DUPLICATE KEY UPDATE road_name=VALUES(road_name), description=VALUES(description), latitude=VALUES(latitude), longitude=VALUES(longitude), point=POINT(VALUES(latitude), VALUES(longitude));';
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

	app.get('/busstops/nearby/:latitude/:longitude', function(req, res) {
		// return type will be json
		res.setHeader('Content-Type', 'application/json');

		var conn = null;
		var latitude = null;
		var longitude = null;

		async.auto({
			validateGetVariable: function(callback) {
				// is this a valid bus stop id?
				if (req.params.latitude != null && req.params.longitude) {
					latitude = req.params.latitude;
					if (isNaN(latitude) == true) {
						callback("invalid variable");
					}

					longitude = req.params.longitude;
					if (isNaN(latitude) == true) {
						callback("invalid variable");
					}

					callback(null);
				} else {
					callback("missing variables");
				}
			},
			getConn: ['validateGetVariable', function(results, callback) {
				mysqlPool.getConnection(function(err, connection) {
					conn = connection;
					if (err) {
						callback(err.code);
					} else {
						callback(null);
					}
				});
			}],
			getBusStops: ['getConn', function(results, callback) {
				// http://gis.stackexchange.com/questions/31628/find-points-within-a-distance-using-mysql
				// http://we-love-programming.blogspot.sg/2012/01/mysql-fastest-distance-lookup-given.html
				var sqlQuery = 'SELECT *, '
      						+ '( 6371 * acos( cos( radians(?) ) '
              				+ '* cos( radians( bus_stops.latitude ) ) '
              				+ '* cos( radians( bus_stops.longitude ) - radians(?) ) '
              				+ '+ sin( radians(?) ) '
              				+ '* sin( radians( bus_stops.latitude ) ) ) ) AS distance '
							+ 'FROM bus_stops '
							+ 'WHERE MBRContains ( '
                    		+ 'LineString ( Point ( '
                            + '? + ? / ( 111.1 / COS(RADIANS(?))), '
                            + '? + ? / 111.1),'
                            + 'Point ( '
                            + '? - ? / ( 111.1 / COS(RADIANS(?))), '
                            + '? - ? / 111.1)), bus_stops.point)'
							+ 'ORDER BY distance';

				// save to db
				conn.query(sqlQuery, [latitude, longitude, latitude, 
					latitude, config.constants.BusStopDistance, latitude, 
					longitude, config.constants.BusStopDistance, 
					latitude, config.constants.BusStopDistance, latitude, 
					longitude, config.constants.BusStopDistance], function(err, dbResult) {
					if (err) {
						callback(err.code);
					} else {
						callback(null, dbResult);
					}
				});
			}],
			getBusServices: ['getBusStops', function(results, callback) {
				var busStops = results.getBusStops;
				var busStopCount = busStops.length;
				var busStopIndexes = {};
				var busStopArray = [];
				
				for (var i=0; i<busStopCount; i++) {
					// take note where is each bus stops
					busStopIndexes[busStops[i]["bus_stop_code"]] = i;

					// get all the bus stop codes so can be converted to string
					busStopArray.push(busStops[i].bus_stop_code);

					// create a holder for bus_services
					busStops[i]["bus_services"] = [];
				}

				// save to db
				//var sqlQuery = "SELECT service_no, bus_stop_code FROM bus_routes WHERE bus_stop_code IN ('" + busStopArray.join("','") + "') ORDER BY service_no + 0";


				var sqlQuery = "SELECT service_no, bus_stop_code FROM bus_routes WHERE bus_stop_code IN (?) ORDER BY service_no + 0";
				conn.query(sqlQuery, [busStopArray], function(err, dbResult) {
					if (err) {
						callback(err.code);
					} else {
						var busServiceCount = dbResult.length;
						for (var i=0; i<busServiceCount; i++) {
							var busStopIndex = busStopIndexes[dbResult[i].bus_stop_code];
							busStops[busStopIndex].bus_services.push(dbResult[i].service_no);
						}

						// remove bus stops with no services
						for (var i=busStopCount - 1; i>=0; i--) {
							if (busStops[i].bus_services.length == 0) {
								busStops.splice(i, 1);
							}
						}


						callback(null, dbResult);
					}
				});

			}]
		}, function(err, results) {
			if (conn) {
				conn.release();
			}

			if (err != null) {
				util.ReturnError(res, err);
			} else {
				//var now = new Date();
				var data = {
					BusStops: results.getBusStops,
				//	FetchTime: now
				};

			    res.end(JSON.stringify(data));
			}
		});
	});
};